import { Router } from 'express';
import { prisma } from '../config/database.js';
import { redis, isRedisAvailable } from '../config/redis.js';
import authRoutes from './auth.routes.js';
import systemRoutes from './system.routes.js';
import jobRoutes from './job.routes.js';
import candidateRoutes from './candidate.routes.js';
import applicationRoutes from './application.routes.js';
import sourcingRoutes from './sourcing.routes.js';
import questionBankRoutes from './questionBank.routes.js';
import interviewRoutes from './interview.routes.js';
import publicInterviewRoutes from './publicInterview.routes.js';
import scheduleRoutes from './schedule.routes.js';
import assessmentRoutes from './assessment.routes.js';
import publicAssessmentRoutes from './publicAssessment.routes.js';
import reviewRoutes from './review.routes.js';
import pipelineRoutes from './pipeline.routes.js';
import offerRoutes from './offer.routes.js';
import analyticsRoutes from './analytics.routes.js';
import publicOfferRoutes from './publicOffer.routes.js';
import referenceRoutes from './reference.routes.js';
import attachmentRoutes from './attachment.routes.js';
import notificationRoutes from './notification.routes.js';
import auditRoutes from './audit.routes.js';
import aiRoutes from './ai.routes.js';
import gdprRoutes from './gdpr.routes.js';
import adminRoutes from './admin.routes.js';
import candidatePortalRoutes from './candidatePortal.routes.js';
import hrRoutes from './hr.routes.js';
import registrationRoutes from './registration.routes.js';
import tenantRoutes from './tenant.routes.js';
import billingRoutes from './billing.routes.js';
import platformRoutes from './platform.routes.js';
import publicCareersRoutes from './publicCareers.routes.js';
import careersAdminRoutes from './careersAdmin.routes.js';
import organizationRoutes from './organization.routes.js';
import workspaceRoutes from './workspace.routes.js';
import communicationRoutes from './communication.routes.js';
import automationRoutes from './automation.routes.js';
import { enforceSubscription } from '../middlewares/subscription.middleware.js';

const router = Router();

// Liveness: cheap, dependency-free — "is the process up?".
router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', ts: new Date().toISOString() } });
});

// Readiness: "should this instance receive traffic?". DB is required (hard
// fail → 503 so the orchestrator stops routing here); Redis is optional because
// the app degrades to in-memory fallbacks, so it's reported but never blocks.
router.get('/ready', async (_req, res) => {
  let dbOk = false;
  let redisOk = isRedisAvailable();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), 2000)),
    ]);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  if (redisOk) {
    try {
      await Promise.race([
        redis.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('redis timeout')), 1000)),
      ]);
    } catch {
      redisOk = false;
    }
  }
  const status = dbOk ? 200 : 503;
  res.status(status).json({
    success: dbOk,
    data: { status: dbOk ? 'ready' : 'not-ready', db: dbOk, redis: redisOk, ts: new Date().toISOString() },
  });
});

router.use('/auth', authRoutes);
router.use('/auth', registrationRoutes); // public SaaS self-registration (additive)
// Global read-only gate for delinquent tenants (GETs and /billing itself
// always pass through) — every route below this line is subject to it.
router.use(enforceSubscription);
router.use('/tenant', tenantRoutes); // tenant usage/limits
router.use('/billing', billingRoutes); // subscription management (webhook is mounted in app.ts)
router.use('/platform', platformRoutes); // platform-superadmin: plan catalogue + tenant admin
router.use('/organizations', organizationRoutes); // tenant self-service: Organization CRUD + membership
router.use('/workspaces', workspaceRoutes); // tenant self-service: Workspace CRUD + membership
router.use('/system', systemRoutes);
router.use('/jobs', jobRoutes);
router.use('/candidates', candidateRoutes);
router.use('/applications', applicationRoutes);
router.use('/sourcing', sourcingRoutes);
router.use('/question-banks', questionBankRoutes);
router.use('/interviews', interviewRoutes);
router.use('/interview', publicInterviewRoutes); // public, token-based (singular)
router.use('/schedules', scheduleRoutes);
router.use('/assessments', assessmentRoutes);
router.use('/assessment', publicAssessmentRoutes); // public, token-based (singular)
router.use('/reviews', reviewRoutes);
router.use('/pipeline', pipelineRoutes);
router.use('/offers', offerRoutes);
router.use('/offer', publicOfferRoutes); // public, token-based (singular)
router.use('/analytics', analyticsRoutes);
router.use('/reference', referenceRoutes);
router.use('/files', attachmentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/audit', auditRoutes);
router.use('/ai', aiRoutes);
router.use('/gdpr', gdprRoutes);
router.use('/admin', adminRoutes);
router.use('/me', candidatePortalRoutes); // candidate portal (self-scoped)
router.use('/hr', hrRoutes);
// Public careers page (job listing/detail/apply) — path is /public/careers
// per the explicit endpoint spec, unlike the other public routers above which
// use a bare singular mount; tenant is resolved per-request from :tenantSlug.
router.use('/public/careers', publicCareersRoutes);
// Staff-authenticated admin surface for the careers page (per-job salary visibility).
router.use('/careers-admin', careersAdminRoutes);
// Team communication hub: channels/DMs/calls/meetings/notes/tasks/AI summaries
// (tenantId-scoped only — see schema.prisma's "TEAM COMMUNICATION ..." section).
router.use('/communication', communicationRoutes);
// Light workflow-automation module (tenant-configured triggers/rules/actions).
router.use('/automation', automationRoutes);

export default router;
