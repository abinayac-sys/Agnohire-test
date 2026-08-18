import { getQueue, stampTenant, QUEUE_NAMES } from './queues.js';
import { logger } from '../config/logger.js';
import { parseResume } from '../services/resumeParseService.js';
import { scoreApplication } from '../services/fitScoreService.js';
import { processBulkUpload, type CsvRow } from '../services/bulkUploadService.js';
import { scoreInterview } from '../services/interviewScoringService.js';
import { scoreAssignment } from '../services/assessmentScoringService.js';
import { analyzeInterview } from '../services/videoIntelligenceService.js';

export interface ResumeParseJob {
  resumeId: string;
}
export interface FitScoreJob {
  applicationId: string;
}
export interface BulkUploadJob {
  listId: string;
  rows: CsvRow[];
  jobRequisitionId?: string | null;
}
export interface InterviewScoreJob {
  interviewId: string;
}
export interface AssessmentScoreJob {
  assignmentId: string;
}
export interface VideoAnalysisJob {
  interviewId: string;
}
export interface ReminderJob {
  scheduleId: string;
}
export interface CandidateReportJob {
  interviewId: string;
}
export interface OfferLetterEmailJob {
  offerId: string;
}
export interface MaintenanceJob {
  windowId: string;
  phase: 'reminder' | 'go-live' | 'complete';
}
export interface BillingReminderJob {
  tenantId: string;
}

function reminderJobId(scheduleId: string): string {
  return `reminder:${scheduleId}`;
}

function maintenanceJobId(windowId: string, phase: MaintenanceJob['phase']): string {
  return `maintenance:${phase}:${windowId}`;
}

function billingReminderJobId(tenantId: string): string {
  return `billing-reminder:${tenantId}`;
}

/**
 * Enqueue resume parsing. When Bull/Redis is unavailable (dev), fall back to
 * running inline — fire-and-forget so the HTTP request still returns promptly.
 */
export async function dispatchResumeParse(resumeId: string): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.RESUME_PARSE);
  if (queue) {
    await queue.add(stampTenant({ resumeId } satisfies ResumeParseJob));
    return;
  }
  void parseResume(resumeId).catch((err) =>
    logger.error('Inline resume parse failed', { resumeId, err: (err as Error).message }),
  );
}

export async function dispatchFitScore(applicationId: string): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.FIT_SCORE);
  if (queue) {
    await queue.add(stampTenant({ applicationId } satisfies FitScoreJob));
    return;
  }
  void scoreApplication(applicationId).catch((err) =>
    logger.error('Inline fit score failed', { applicationId, err: (err as Error).message }),
  );
}

export async function dispatchBulkUpload(listId: string, rows: CsvRow[], jobRequisitionId?: string | null): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.BULK_UPLOAD);
  if (queue) {
    await queue.add(stampTenant({ listId, rows, jobRequisitionId } satisfies BulkUploadJob));
    return;
  }
  void processBulkUpload(listId, rows, jobRequisitionId).catch((err) =>
    logger.error('Inline bulk upload failed', { listId, err: (err as Error).message }),
  );
}

export async function dispatchInterviewScore(interviewId: string): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.AI_SCORING);
  if (queue) {
    await queue.add(stampTenant({ interviewId } satisfies InterviewScoreJob));
    return;
  }
  void scoreInterview(interviewId).catch((err) =>
    logger.error('Inline interview scoring failed', { interviewId, err: (err as Error).message }),
  );
}

export async function dispatchAssessmentScore(assignmentId: string): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.ASSESSMENT_SCORING);
  if (queue) {
    await queue.add(stampTenant({ assignmentId } satisfies AssessmentScoreJob));
    return;
  }
  void scoreAssignment(assignmentId).catch((err) =>
    logger.error('Inline assessment scoring failed', { assignmentId, err: (err as Error).message }),
  );
}

/** Enqueue transcript intelligence analysis (Module 8). Inline fallback in dev. */
export async function dispatchVideoAnalysis(interviewId: string): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.TRANSCRIPT);
  if (queue) {
    await queue.add(stampTenant({ interviewId } satisfies VideoAnalysisJob));
    return;
  }
  void analyzeInterview(interviewId).catch((err) =>
    logger.error('Inline video analysis failed', { interviewId, err: (err as Error).message }),
  );
}

/**
 * Schedule (or reschedule) an interview reminder to fire at `fireAt`. Uses a
 * deterministic jobId so reschedule/cancel can replace or drop it. When Redis
 * is unavailable there is no durable timer — the reminder is simply skipped in
 * dev (logged), which is acceptable since email itself is not yet wired.
 */
export async function dispatchScheduleReminder(scheduleId: string, fireAt: Date): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.REMINDER);
  if (!queue) {
    logger.info('Reminder not scheduled — queues disabled (dev)', { scheduleId });
    return;
  }
  await cancelScheduleReminder(scheduleId);
  const delay = Math.max(0, fireAt.getTime() - Date.now());
  await queue.add(stampTenant({ scheduleId } satisfies ReminderJob), { delay, jobId: reminderJobId(scheduleId) });
}

/** Remove a pending reminder (on cancel/reschedule). No-op if not present. */
export async function cancelScheduleReminder(scheduleId: string): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.REMINDER);
  if (!queue) return;
  try {
    const existing = await queue.getJob(reminderJobId(scheduleId));
    if (existing) await existing.remove();
  } catch (err) {
    logger.warn('Failed to remove reminder job', { scheduleId, err: (err as Error).message });
  }
}

/** Enqueue candidate report PDF generation and email. */
export async function dispatchCandidateReport(interviewId: string, delayMinutes: number): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.REPORT);
  if (queue) {
    await queue.add(stampTenant({ interviewId } satisfies CandidateReportJob), { delay: delayMinutes * 60000 });
    return;
  }
  // Fallback inline if queues are disabled
  void (async () => {
    logger.info('Inline candidate report delivery', { interviewId, delayMinutes });
    // Execute asynchronously to avoid blocking the HTTP request
    setTimeout(async () => {
      try {
        const { processReportDelivery } = await import('../services/reviewService.js');
        await processReportDelivery(interviewId);
      } catch (err) {
        logger.error('Inline report dispatch failed', { err });
      }
    }, 1000);
  })();
}

/** Schedule the three lifecycle jobs for a maintenance window (reminder/go-live/complete). */
async function dispatchMaintenanceJob(windowId: string, phase: MaintenanceJob['phase'], fireAt: Date): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.MAINTENANCE);
  const delay = Math.max(0, fireAt.getTime() - Date.now());
  if (queue) {
    await queue.add(stampTenant({ windowId, phase } satisfies MaintenanceJob), { delay, jobId: maintenanceJobId(windowId, phase) });
    return;
  }
  logger.info('Maintenance job not scheduled — queues disabled (dev), running inline via setTimeout', { windowId, phase });
  setTimeout(async () => {
    try {
      const svc = await import('../services/maintenanceService.js');
      if (phase === 'reminder') await svc.sendCandidateReminders(windowId);
      else if (phase === 'go-live') await svc.activateMaintenanceWindow(windowId);
      else await svc.completeMaintenanceWindow(windowId);
    } catch (err) {
      logger.error('Inline maintenance job failed', { windowId, phase, err: (err as Error).message });
    }
  }, delay);
}

export async function dispatchMaintenanceReminder(windowId: string, fireAt: Date): Promise<void> {
  await dispatchMaintenanceJob(windowId, 'reminder', fireAt);
}
export async function dispatchMaintenanceGoLive(windowId: string, fireAt: Date): Promise<void> {
  await dispatchMaintenanceJob(windowId, 'go-live', fireAt);
}
export async function dispatchMaintenanceComplete(windowId: string, fireAt: Date): Promise<void> {
  await dispatchMaintenanceJob(windowId, 'complete', fireAt);
}

/**
 * Schedules the pre-renewal reminder (notify admins + auto-collect the
 * recurring add-on/overage amount if enabled — see
 * billingService.sendRenewalReminder). Billing jobs are platform-wide, not
 * stamped to an ambient tenant context (they carry their own tenantId and
 * run under runAsPlatform), matching the maintenance job convention.
 *
 * Deterministic jobId (one per tenant) so re-dispatching on every renewal —
 * subscription.activated AND subscription.charged both call this with the
 * NEW currentPeriodEnd — replaces any still-pending reminder for a stale
 * period rather than firing twice. Same dual-path fallback as maintenance
 * jobs: inline via setTimeout when Redis/Bull is unavailable (dev), so this
 * still works without new infrastructure, just without surviving a restart.
 */
// setTimeout's delay is a signed 32-bit int internally (~24.8 days) — a
// larger value doesn't throw, Node silently clamps it and fires almost
// immediately instead. For a billing notice ("your card will be charged in
// 5 days") that would be actively wrong, not just late, so the inline
// fallback below refuses to schedule past this rather than misfire.
const MAX_SETTIMEOUT_DELAY_MS = 2_147_483_647;

export async function dispatchBillingRenewalReminder(tenantId: string, fireAt: Date): Promise<void> {
  await cancelBillingRenewalReminder(tenantId);
  const queue = getQueue(QUEUE_NAMES.BILLING_REMINDER);
  const delay = Math.max(0, fireAt.getTime() - Date.now());
  if (queue) {
    // Bull persists the job and computes its own fire time from `delay` at
    // read time — no 32-bit ms ceiling here, arbitrarily distant renewals
    // (yearly plans) schedule correctly.
    await queue.add({ tenantId } satisfies BillingReminderJob, { delay, jobId: billingReminderJobId(tenantId) });
    return;
  }
  if (delay > MAX_SETTIMEOUT_DELAY_MS) {
    logger.warn(
      'Billing reminder NOT scheduled — queues disabled (dev) and the renewal is too far out (>~24.8 days) for the inline setTimeout fallback to schedule correctly. Run with Redis available to get this reminder for distant renewals.',
      { tenantId, fireAt },
    );
    return;
  }
  logger.info('Billing reminder not scheduled — queues disabled (dev), running inline via setTimeout', { tenantId, fireAt });
  setTimeout(async () => {
    try {
      const { sendRenewalReminder } = await import('../services/billing/billingService.js');
      await sendRenewalReminder(tenantId);
    } catch (err) {
      logger.error('Inline billing reminder failed', { tenantId, err: (err as Error).message });
    }
  }, delay);
}

/** Remove a pending renewal reminder (on cancellation/replacement). No-op if not present. */
export async function cancelBillingRenewalReminder(tenantId: string): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.BILLING_REMINDER);
  if (!queue) return;
  try {
    const existing = await queue.getJob(billingReminderJobId(tenantId));
    if (existing) await existing.remove();
  } catch (err) {
    logger.warn('Failed to remove billing reminder job', { tenantId, err: (err as Error).message });
  }
}

/** Remove all pending lifecycle jobs for a maintenance window (on cancel). */
export async function cancelMaintenanceJobs(windowId: string): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.MAINTENANCE);
  if (!queue) return;
  await Promise.all(
    (['reminder', 'go-live', 'complete'] as const).map(async (phase) => {
      try {
        const existing = await queue.getJob(maintenanceJobId(windowId, phase));
        if (existing) await existing.remove();
      } catch (err) {
        logger.warn('Failed to remove maintenance job', { windowId, phase, err: (err as Error).message });
      }
    }),
  );
}

export async function dispatchOfferLetterEmail(offerId: string, delayMinutes: number): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.OFFER_EMAIL);
  if (queue) {
    await queue.add(stampTenant({ offerId } satisfies OfferLetterEmailJob), { delay: delayMinutes * 60000 });
    return;
  }
  // Fallback inline if queues are disabled
  void (async () => {
    logger.info('Inline offer letter email delivery', { offerId, delayMinutes });
    setTimeout(async () => {
      try {
        const { sendOfferLetterEmail } = await import('../services/offerService.js');
        await sendOfferLetterEmail(offerId);
      } catch (err) {
        logger.error('Inline offer email dispatch failed', { err });
      }
    }, delayMinutes * 60000);
  })();
}
