import type { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit, { type RateLimitRequestHandler, type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { configService } from '../services/configService.js';
import { CONFIG_KEYS } from '@agnohire/shared';
import { fail } from '../utils/response.js';
import { redis, isRedisAvailable } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { verifyAccessToken } from '../utils/tokenHelper.js';

/**
 * Public token routes (candidate-facing, no JWT) mounted in index.ts. The
 * high-entropy token is the FIRST path segment after the mount prefix, e.g.
 * `/interview/<token>/answer`. We bucket these per token so each candidate has
 * an isolated budget — critical for mass hiring, where hundreds of candidates
 * sit behind ONE corporate/campus NAT and must not starve each other's quota.
 * req.path here is already stripped of the `/api` mount prefix (see `skip`).
 */
const PUBLIC_TOKEN_ROUTE = /^\/(interview|assessment|offer)\/([^/?]+)/;

/**
 * Public careers-page routes (job listing/detail/apply, no JWT), mounted at
 * /public/careers in index.ts. The apply route gets its own, much stricter
 * bucket keyed per (tenantSlug, jobId) — unlike the token routes above, this
 * one exists specifically to throttle spam/bot applications, not to give
 * legitimate traffic more headroom. The listing/detail routes are bucketed
 * per tenantSlug so an embedded careers page behind one corporate/campus NAT
 * doesn't starve itself, same rationale as the interview token bucket.
 */
const PUBLIC_CAREERS_APPLY_ROUTE = /^\/public\/careers\/([^/?]+)\/jobs\/([^/?]+)\/apply/;
const PUBLIC_CAREERS_ROUTE = /^\/public\/careers\/([^/?]+)/;

function publicTokenKey(req: Request): string | null {
  const m = PUBLIC_TOKEN_ROUTE.exec(req.path);
  if (m) {
    const [, kind, token] = m;
    return `pub:${kind}:${token}`;
  }
  const apply = PUBLIC_CAREERS_APPLY_ROUTE.exec(req.path);
  if (apply) {
    const [, tenantSlug, jobId] = apply;
    return `careers-apply:${tenantSlug}:${jobId}`;
  }
  const careers = PUBLIC_CAREERS_ROUTE.exec(req.path);
  if (careers) {
    const [, tenantSlug] = careers;
    return `careers:${tenantSlug}`;
  }
  return null;
}

/**
 * SaaS fairness: authenticated requests are bucketed per TENANT + USER so one
 * tenant (or one noisy user) cannot exhaust the global limit for everyone
 * behind the same proxy/NAT. Public token routes are bucketed per candidate
 * token. Everything else falls back to per-IP.
 * The JWT is verified (not just decoded) so the key can't be forged.
 */
function tenantAwareKey(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7));
      return `t:${payload.tenantId ?? 'none'}:u:${payload.sub}`;
    } catch {
      /* invalid token → treat as anonymous */
    }
  }
  return publicTokenKey(req) ?? `ip:${req.ip ?? 'unknown'}`;
}

/**
 * The shared `redis` client is configured with `maxRetriesPerRequest: null`
 * (correct for things like session revocation, which should wait/retry
 * rather than fail) — but that means if Redis so much as hiccups mid-traffic,
 * a command queues indefinitely waiting to reconnect instead of erroring.
 * Left unguarded, every rate-limit check on every request would hang on that
 * queued command, stalling real traffic — a self-inflicted outage caused by
 * the rate limiter's own infra, exactly when load is already highest. Rate
 * limiting is defense-in-depth, not core functionality, so on a timeout we
 * fail OPEN: return a synthetic "0 hits so far" response (the shape RedisStore's
 * Lua scripts return: `[totalHits, timeToExpireMs]`) so the request proceeds
 * instead of hanging. The original slow command is left to resolve in the
 * background (harmless — its result is simply never read).
 */
const REDIS_COMMAND_TIMEOUT_MS = 750;

function timedRedisCommand(...args: string[]): Promise<RedisReply> {
  const call = (redis as unknown as { call: (...a: string[]) => Promise<RedisReply> }).call(...args);
  return Promise.race([
    call,
    new Promise<RedisReply>((resolve) => {
      setTimeout(() => {
        logger.warn('Rate limiter Redis command timed out — failing open for this request', {
          timeoutMs: REDIS_COMMAND_TIMEOUT_MS,
        });
        resolve([0, 10_000_000]);
      }, REDIS_COMMAND_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Builds a rate limiter instance for a given window. `limit` is a live
 * function (re-read from config on every request by express-rate-limit
 * itself), but `windowMs` is baked into the instance/store at construction
 * time — the library has no dynamic-window API — so a NEW instance is the
 * only way to pick up a changed window.
 *
 * Uses a shared Redis store when Redis is available so the limit is enforced
 * GLOBALLY across instances (the default MemoryStore counts per-process, which
 * multiplies the effective limit by the instance count and resets on deploy).
 * Falls back to the in-memory store when Redis is down — matching the rest of
 * the app's graceful degradation.
 */
function buildRateLimiter(windowMs: number): RateLimitRequestHandler {
  let store: Store | undefined;
  if (isRedisAvailable()) {
    store = new RedisStore({
      sendCommand: timedRedisCommand,
      prefix: 'rl:',
    });
    logger.info('Rate limiter using shared Redis store (global enforcement)', { windowMs });
  } else {
    logger.warn('Rate limiter using in-memory store (per-instance) — Redis unavailable', { windowMs });
  }

  return rateLimit({
    windowMs,
    ...(store && { store }),
    keyGenerator: tenantAwareKey,
    // Public candidate token buckets get a much higher ceiling than the strict
    // global/per-user limit: a single proctored interview is chatty (answers +
    // periodic snapshots/violations/recordings) and legitimately makes many
    // requests over the window. Read live so it can be tuned without a restart.
    limit: async (req) => {
      const key = publicTokenKey(req);
      if (key?.startsWith('careers-apply:')) {
        return configService.getNumber(CONFIG_KEYS.RATE_LIMIT_CAREERS_APPLY_MAX, 20);
      }
      if (key) {
        return configService.getNumber(CONFIG_KEYS.RATE_LIMIT_INTERVIEW_MAX, 10_000_000);
      }
      return configService.getNumber(CONFIG_KEYS.RATE_LIMIT_MAX, 10_000_000);
    },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Never rate-limit liveness/readiness probes, or during tests/development.
    // Also skip the cheap, unauthenticated branding/theme reads: they carry no
    // sensitive data, are effectively static, and load on every candidate's
    // page before any token exists — so they'd otherwise share one IP bucket
    // and 429 whole cohorts behind a shared NAT (the reported failure).
    skip: (req) =>
      process.env.NODE_ENV === 'test' ||
      process.env.NODE_ENV === 'development' ||
      req.path === '/health' ||
      req.path === '/ready' ||
      req.path === '/system/bootstrap' ||
      req.path === '/system/themes' ||
      req.path.startsWith('/system/branding/'),
    // NOTE: express-rate-limit calls THIS handler directly when a request is
    // blocked — it does NOT call the `next` passed into rateLimiterMiddleware's
    // wrapper below, so this is the only place a blocked request's utilization
    // can be logged.
    handler: (req, res) => {
      const info = (req as Request & { rateLimit?: { used: number; limit: number; remaining: number } }).rateLimit;
      console.log("**********Checking Rate Limit**********");
      console.log(
        `[RATE-LIMIT-BLOCKED] key=${tenantAwareKey(req)} path=${req.path} used=${info?.used}/${info?.limit} remaining=${info?.remaining}`,
      );
      fail(res, 429, 'RATE_LIMITED', 'Too many requests, please slow down.');
    },
  });
}

/** Backward-compatible one-shot factory, kept in case anything else builds a
 *  limiter directly; the app itself now mounts `rateLimiterMiddleware` below,
 *  which stays live across config changes instead of freezing the window at
 *  the moment this is called. */
export async function createRateLimiter(): Promise<RateLimitRequestHandler> {
  const windowMs = await configService.getNumber(CONFIG_KEYS.RATE_LIMIT_WINDOW_MS, 10_000_000);
  return buildRateLimiter(windowMs);
}

let active: { windowMs: number; handler: RateLimitRequestHandler } | null = null;
let rebuilding: Promise<RateLimitRequestHandler> | null = null;

async function getCurrentLimiter(): Promise<RateLimitRequestHandler> {
  const windowMs = await configService.getNumber(CONFIG_KEYS.RATE_LIMIT_WINDOW_MS, 10_000_000);
  if (active && active.windowMs === windowMs) return active.handler;
  // Config reads are cheap (in-memory, 30s TTL) but building a limiter isn't
  // free — if a rebuild for this exact window is already in flight, reuse it
  // instead of racing multiple concurrent requests into separate rebuilds.
  if (!rebuilding) {
    rebuilding = (async () => {
      const handler = buildRateLimiter(windowMs);
      active = { windowMs, handler };
      rebuilding = null;
      return handler;
    })();
  }
  return rebuilding;
}

/**
 * Stable middleware to mount once at boot (`app.use('/api', rateLimiterMiddleware)`).
 * Unlike `createRateLimiter()`, this keeps working after the window is changed
 * in System Config — it re-checks the configured window on every request and
 * transparently rebuilds the underlying limiter when it differs, so an admin's
 * edit takes effect on the next request instead of requiring a restart.
 */
export const rateLimiterMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  getCurrentLimiter()
    .then((handler) =>
      handler(req, res, () => {
        const info = (req as Request & { rateLimit?: { used: number; limit: number; remaining: number } }).rateLimit;
        if (info) {
          console.log("**********Checking Rate Limit**********");
          console.log(
            `[RATE-LIMIT-OK] key=${tenantAwareKey(req)} path=${req.path} used=${info.used}/${info.limit} remaining=${info.remaining}`,
          );
        }
        next();
      }),
    )
    .catch(next);
};
