import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase, prisma } from './config/database.js';
import { connectRedis, isRedisAvailable } from './config/redis.js';
import { configService } from './services/configService.js';
import { configurePassport, passport } from './config/passport.js';
import { initSocket } from './config/socket.js';
import { closeQueues } from './jobs/queues.js';
import { registerWorkers } from './jobs/workers.js';
import { createBullBoardRouter } from './config/bullBoard.js';
import { rateLimiterMiddleware } from './middlewares/rateLimiter.middleware.js';
import { authenticate } from './middlewares/auth.middleware.js';
import { requirePermission } from './middlewares/rbac.middleware.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import apiRoutes from './routes/index.js';
import { assertEncryptionKey } from './config/encryption.js';
import { PERMISSIONS } from '@agnohire/shared';
import './ai/tools/index.js';

async function bootstrap(): Promise<void> {
  // Fail fast on a bad ENCRYPTION_KEY rather than 500ing on the first secret save.
  assertEncryptionKey();
  await connectDatabase();
  await connectRedis();
  await configService.reload();
  configurePassport();

  // In production, Redis backs cluster-wide security controls (session/token
  // revocation and rate limiting). The in-memory fallback is per-process and
  // resets on restart — fine for dev, unsafe for prod. Fail LOUD rather than
  // silently degrading these controls.
  if (env.isProd && !isRedisAvailable()) {
    logger.error(
      'SECURITY: Redis is unavailable in production — session/token revocation ' +
      'and rate limiting are degraded to per-process and will not enforce ' +
      'cluster-wide. Provision Redis (REDIS_URL) before serving traffic.',
    );
  }

  const app = express();
  app.set('trust proxy', env.trustProxyHops);
  app.disable('etag');

  // Helmet's defaults (X-Frame-Options: SAMEORIGIN, CSP frame-ancestors 'self')
  // block iframing everywhere, including the public careers page — the whole
  // point of which is to be embedded on a tenant's own external website. Scope
  // the relaxation to ONLY /careers/* (the SPA route, same static index.html
  // as every other route) so the rest of the app keeps full Helmet defaults.
  app.use((req, res, next) => {
    if (req.path.startsWith('/careers/')) {
      return helmet({ contentSecurityPolicy: false, frameguard: false })(req, res, next);
    }
    return helmet()(req, res, next);
  });
  app.use(
    cors({
      origin: env.clientUrl,
      credentials: true,
    }),
  );
  // Razorpay webhook needs the RAW body for signature verification, so this
  // route is mounted with a raw parser BEFORE the global JSON parser (which
  // would otherwise consume the bytes).
  const { razorpayWebhookHandler } = await import('./routes/billingWebhook.js');
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), razorpayWebhookHandler);

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  // Resolve tenant subdomain (if APP_ROOT_DOMAIN set) → req.hostTenantId. Inert
  // for apex/localhost. The isolation check itself lives in auth.middleware.
  const { resolveTenantHost } = await import('./middlewares/tenantHost.middleware.js');
  app.use(resolveTenantHost);
  app.use(passport.initialize());
  app.use(morgan('dev', { stream: { write: (m) => logger.http(m.trim()) } }));

  // Rate limiter (config-driven) applied to the API surface. Stays live across
  // config changes — see rateLimiterMiddleware's own doc comment.
  app.use('/api', rateLimiterMiddleware);

  // Bull Board dashboard — admin protected. (Also initializes the queues.)
  const bullBoard = createBullBoardRouter();

  // Attach queue processors (no-op when Redis is down → inline fallback).
  registerWorkers();
  app.use(
    '/api/admin/queues',
    authenticate,
    requirePermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE),
    bullBoard.getRouter(),
  );

  app.use('/api', apiRoutes);

  // Expose uploads directory statically (for generated offer letters, etc.)
  const uploadsPath = path.resolve(process.cwd(), 'uploads');
  app.use('/uploads', express.static(uploadsPath));

  // Serve static files from the React client build in production / fallback
  const clientBuildPath = path.resolve(process.cwd(), '../client/dist');
  if (fs.existsSync(clientBuildPath)) {
    app.use(express.static(clientBuildPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
      }
      res.sendFile(path.join(clientBuildPath, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = http.createServer(app);
  const io = initSocket(server);

  // Light workflow-automation module (see AutomationWorkflow in schema.prisma):
  // subscribes to the in-process EventBus so tenant-configured automations
  // (CANDIDATE_APPLIED, INTERVIEW_ENDED, etc.) can react to app events.
  const { WorkflowEngineService } = await import('./services/workflowEngine.service.js');
  WorkflowEngineService.init();

  // Without this listener, a bind failure (most commonly EADDRINUSE — a
  // previous npm run dev never fully stopped and still holds this port)
  // throws synchronously with no promise/catch anywhere in the chain, which
  // falls straight through to the global uncaughtException handler below and
  // kills the whole process. That's a real, confusing failure mode in dev:
  // the crash looks unrelated to the actual cause. Catch it here instead and
  // fail with a clear diagnostic before anything else even tries to start.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `Port ${env.port} is already in use — another instance is likely still running. ` +
          'Stop it (or any stray `node`/`tsx` process still holding this port) and try again.',
      );
    } else {
      logger.error('Server failed to start', { err: err.message });
    }
    process.exit(1);
  });

  server.listen(env.port, () => {
    logger.info(`AgnoHire API listening on http://localhost:${env.port}`);
    logger.info(`Environment: ${env.nodeEnv}`);
    if (!env.google.enabled) logger.info('Auth: dev email login (Google OAuth not configured)');
    if (env.razorpay.enabled) {
      logger.info('Billing: Razorpay configured');
    } else {
      logger.warn(
        'Billing: Razorpay NOT configured (RAZORPAY_KEY_ID/SECRET missing) — paid plan checkout will fail. ' +
          'If you just added these to .env, this process must be restarted to pick them up.',
      );
    }
  });

  // Periodic background sweeper to auto-submit expired active AI interviews
  const timeoutInterval = setInterval(async () => {
    try {
      const active = await prisma.interview.findMany({
        where: {
          status: 'IN_PROGRESS',
          startedAt: { not: null },
          duration: { not: null },
          type: 'AI',
        },
        select: { id: true, accessToken: true, startedAt: true, duration: true },
        take: 100,
      });
      const now = Date.now();
      for (const iv of active) {
        if (iv.startedAt && iv.duration && iv.accessToken) {
          const deadline = iv.startedAt.getTime() + iv.duration * 60_000;
          if (now > deadline) {
            try {
              const { submitInterview } = await import('./services/publicInterviewService.js');
              await submitInterview(iv.accessToken);
            } catch (err) {
              logger.warn('Failed background auto-submit of overdue interview', { interviewId: iv.id, err: (err as Error).message });
            }
          }
        }
      }
    } catch (err) {
      logger.error('Error in background interview timeout sweeper', { err: (err as Error).message });
    }
  }, 60_000);

  // Periodic sweep for trial-expiry reminder/expired emails (see
  // jobs/subscriptionSweeper.ts's own doc comment for scope/rationale).
  const { startSubscriptionExpirySweeper } = await import('./jobs/subscriptionSweeper.js');
  const subscriptionSweeperInterval = startSubscriptionExpirySweeper();

  // Drain in-flight work before exiting so rolling deploys don't sever requests
  // mid-flight. Guarded so a second signal can't re-enter the sequence.
  let shuttingDown = false;
  const shutdown = async (signal: string, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down`);

    // Stop accepting new connections; force-exit if drain hangs.
    const forceTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(code || 1);
    }, 10_000);
    forceTimer.unref();

    try {
      clearInterval(timeoutInterval);
      clearInterval(subscriptionSweeperInterval);
      io.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeQueues();
      await disconnectDatabase();
    } catch (err) {
      logger.error('Error during shutdown', { err: (err as Error).message });
    } finally {
      clearTimeout(forceTimer);
      process.exit(code);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Process-level safety nets: a stray rejection/exception must not silently
  // kill the process. Log loudly; on a truly uncaught exception, drain and exit
  // non-zero so the supervisor restarts a clean instance.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — draining and exiting', {
      err: err.message,
      stack: err.stack,
    });
    void shutdown('uncaughtException', 1);
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', { err: (err as Error).message });
  process.exit(1);
});
