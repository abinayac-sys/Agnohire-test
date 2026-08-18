import Bull, { type Queue } from 'bull';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { isRedisAvailable } from '../config/redis.js';
import { getTenantContext, runWithTenant } from '../config/tenantContext.js';

/**
 * SaaS: Bull job payloads carry the dispatching request's tenant so workers
 * (which run outside any HTTP request) restore the same fail-closed tenant
 * scope before touching the database.
 */
export function stampTenant<T extends object>(data: T): T & { __tenantId?: string } {
  const tenantId = getTenantContext()?.tenantId;
  return tenantId ? { ...data, __tenantId: tenantId } : data;
}

/** Run a worker handler inside the tenant context stamped on the job payload. */
export function runJobInTenant<T>(job: { data: unknown }, fn: () => Promise<T>): Promise<T> {
  const tenantId = (job.data as { __tenantId?: string | null } | null)?.__tenantId ?? null;
  return tenantId ? runWithTenant(tenantId, fn) : fn();
}

const queues = new Map<string, Queue>();
let queuesEnabled = false;

export const QUEUE_NAMES = {
  EMAIL: 'email',
  AI_SCORING: 'ai-scoring',
  ASSESSMENT_SCORING: 'assessment-scoring',
  RESUME_PARSE: 'resume-parse',
  TRANSCRIPT: 'transcript',
  BULK_UPLOAD: 'bulk-upload',
  FIT_SCORE: 'fit-score',
  WEBHOOK: 'webhook',
  REMINDER: 'reminder',
  REPORT: 'report',
  RETENTION: 'retention',
  ONBOARDING: 'onboarding',
  OFFER_EMAIL: 'offer-email',
  MAINTENANCE: 'maintenance',
  BILLING_REMINDER: 'billing-reminder',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export function getQueue(name: QueueName): Queue | null {
  if (!queuesEnabled) return null;
  let q = queues.get(name);
  if (!q) {
    q = new Bull(name, env.redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    q.on('error', (err) => logger.error(`Queue ${name} error`, { err: err.message }));
    queues.set(name, q);
  }
  return q;
}

/** Eagerly instantiate all queues (called after Redis connects). */
export function initQueues(): Queue[] {
  queuesEnabled = isRedisAvailable();
  if (!queuesEnabled) {
    logger.warn('Redis unavailable — Bull queues disabled (background jobs will be skipped in dev)');
    return [];
  }
  return Object.values(QUEUE_NAMES).map((n) => getQueue(n) as Queue);
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
}
