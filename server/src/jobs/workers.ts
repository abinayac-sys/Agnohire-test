import type { Job } from 'bull';
import { getQueue, runJobInTenant, QUEUE_NAMES } from './queues.js';
import { logger } from '../config/logger.js';
import { parseResume } from '../services/resumeParseService.js';
import { scoreApplication } from '../services/fitScoreService.js';
import { processBulkUpload } from '../services/bulkUploadService.js';
import { scoreInterview } from '../services/interviewScoringService.js';
import { scoreAssignment } from '../services/assessmentScoringService.js';
import { analyzeInterview } from '../services/videoIntelligenceService.js';
import { sendScheduleReminder } from '../services/reminderService.js';
import { sendCandidateReminders, activateMaintenanceWindow, completeMaintenanceWindow } from '../services/maintenanceService.js';
import type {
  BulkUploadJob,
  FitScoreJob,
  InterviewScoreJob,
  AssessmentScoreJob,
  VideoAnalysisJob,
  ReminderJob,
  ResumeParseJob,
  CandidateReportJob,
  OfferLetterEmailJob,
  MaintenanceJob,
  BillingReminderJob,
} from './dispatch.js';

/**
 * Registers Bull queue processors. No-op when Redis is unavailable (queues
 * disabled) — in that mode work runs inline via the dispatch fallbacks.
 * Call once at startup, after Redis connects.
 */
export function registerWorkers(): void {
  const resumeQueue = getQueue(QUEUE_NAMES.RESUME_PARSE);
  const fitQueue = getQueue(QUEUE_NAMES.FIT_SCORE);
  const bulkQueue = getQueue(QUEUE_NAMES.BULK_UPLOAD);
  const scoringQueue = getQueue(QUEUE_NAMES.AI_SCORING);
  const assessmentQueue = getQueue(QUEUE_NAMES.ASSESSMENT_SCORING);
  const transcriptQueue = getQueue(QUEUE_NAMES.TRANSCRIPT);
  const reminderQueue = getQueue(QUEUE_NAMES.REMINDER);
  const reportQueue = getQueue(QUEUE_NAMES.REPORT);
  const offerEmailQueue = getQueue(QUEUE_NAMES.OFFER_EMAIL);
  const maintenanceQueue = getQueue(QUEUE_NAMES.MAINTENANCE);
  const billingReminderQueue = getQueue(QUEUE_NAMES.BILLING_REMINDER);

  if (!resumeQueue || !fitQueue || !bulkQueue || !scoringQueue || !assessmentQueue || !transcriptQueue || !reminderQueue || !reportQueue || !offerEmailQueue || !maintenanceQueue || !billingReminderQueue) {
    logger.info('Workers not registered — queues disabled (inline processing active)');
    return;
  }

  // Every processor runs inside the tenant context stamped on the payload at
  // dispatch time (runJobInTenant), so worker DB access is scoped exactly like
  // the request that enqueued the job.
  resumeQueue.process(async (job: Job<ResumeParseJob>) => {
    await runJobInTenant(job, () => parseResume(job.data.resumeId));
  });

  fitQueue.process(async (job: Job<FitScoreJob>) => {
    await runJobInTenant(job, () => scoreApplication(job.data.applicationId));
  });

  bulkQueue.process(async (job: Job<BulkUploadJob>) => {
    await runJobInTenant(job, () =>
      processBulkUpload(job.data.listId, job.data.rows, job.data.jobRequisitionId),
    );
  });

  scoringQueue.process(async (job: Job<InterviewScoreJob>) => {
    await runJobInTenant(job, () => scoreInterview(job.data.interviewId));
  });

  assessmentQueue.process(async (job: Job<AssessmentScoreJob>) => {
    await runJobInTenant(job, () => scoreAssignment(job.data.assignmentId));
  });

  transcriptQueue.process(async (job: Job<VideoAnalysisJob>) => {
    await runJobInTenant(job, () => analyzeInterview(job.data.interviewId));
  });

  reminderQueue.process(async (job: Job<ReminderJob>) => {
    await runJobInTenant(job, () => sendScheduleReminder(job.data.scheduleId));
  });

  reportQueue.process(async (job: Job<CandidateReportJob>) => {
    const { processReportDelivery } = await import('../services/reviewService.js');
    await runJobInTenant(job, () => processReportDelivery(job.data.interviewId));
  });

  offerEmailQueue.process(async (job: Job<OfferLetterEmailJob>) => {
    const { sendOfferLetterEmail } = await import('../services/offerService.js');
    await runJobInTenant(job, () => sendOfferLetterEmail(job.data.offerId));
  });

  // Maintenance jobs are platform-wide (no tenant), so they run without runJobInTenant.
  maintenanceQueue.process(async (job: Job<MaintenanceJob>) => {
    if (job.data.phase === 'reminder') await sendCandidateReminders(job.data.windowId);
    else if (job.data.phase === 'go-live') await activateMaintenanceWindow(job.data.windowId);
    else await completeMaintenanceWindow(job.data.windowId);
  });

  // Billing tables are platform-wide too (not tenant-scoped models), so this
  // also runs without runJobInTenant — same as maintenance.
  billingReminderQueue.process(async (job: Job<BillingReminderJob>) => {
    const { sendRenewalReminder } = await import('../services/billing/billingService.js');
    await sendRenewalReminder(job.data.tenantId);
  });

  logger.info('Bull workers registered: resume-parse, fit-score, bulk-upload, ai-scoring, assessment-scoring, transcript, reminder, report, offer-email, maintenance, billing-reminder');
}
