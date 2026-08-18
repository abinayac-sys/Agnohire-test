import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { recordAudit } from './auditService.js';
import { configService } from './configService.js';
import { sendMail, sendMailOnce, type MailResult } from './mailerService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import { mapQuestion, type InterviewContext } from './questionBankService.js';
import { isRecruiterScoped, assignedCandidateWhere } from '../utils/accessScope.js';
import {
  ROLES,
  CONFIG_KEYS,
  isScheduleRound,
  type CreateInterviewInput,
  type InterviewFilters,
  type InterviewDecisionInput,
  type InterviewDetail,
  type ViolationEntry,
  type Decision,
  type ResultCandidateItem,
  type BulkEmailResult,
} from '@agnohire/shared';
import type { Request } from 'express';

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/** Non-admins see interviews they created or for candidates in their sector;
 *  recruiters are limited to their own interviews + allocated candidates. */
function interviewScope(ctx: InterviewContext): Prisma.InterviewWhereInput {
  if (isRecruiterScoped(ctx.role)) {
    return { OR: [{ recruiterId: ctx.userId }, { candidate: assignedCandidateWhere(ctx.userId) }] };
  }
  if (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) return {};
  if (ctx.sectorId) return { OR: [{ recruiterId: ctx.userId }, { candidate: { sectorId: ctx.sectorId } }] };
  return { recruiterId: ctx.userId };
}

const LIST_SELECT = {
  id: true,
  status: true,
  type: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  questionBankId: true,
  candidate: { select: { id: true, fullName: true, email: true } },
  jobRequisition: { select: { id: true, title: true } },
  result: { select: { percentageScore: true, decision: true, aiDecision: true } },
  _count: { select: { questions: true } },
} satisfies Prisma.InterviewSelect;

/** Interview has no Prisma relation to QuestionBank — resolve names by id. */
async function bankNameMap(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map<string, { id: string; name: string }>();
  const banks = await prisma.questionBank.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(banks.map((b) => [b.id, b]));
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Chooses which questions an interview gets and in what order. Always shuffles order
 * per interview so back-to-back candidates don't see an identical sequence. When the
 * eligible pool is larger than `questionsPerCandidate`, favors questions least-used by
 * other active interviews for the same bank/job/round, so candidates overlap as little
 * as possible instead of every candidate getting the same fixed set.
 *
 * Shuffling stays WITHIN each section: sections themselves keep a stable order (their
 * first-appearance order in the bank), only the questions inside each one are randomized.
 * A global shuffle would interleave sections in the stored order, which is what candidates
 * would see if the client didn't independently regroup by section — and does show through
 * as scrambled ordering on any view (e.g. the recruiter results page) that lists questions
 * in storage order rather than regrouping them.
 */
async function pickInterviewQuestions(
  bankId: string,
  eligibleQuestions: { id: string; sectionId?: string | null }[],
  data: CreateInterviewInput,
): Promise<string[]> {
  const eligibleIds = eligibleQuestions.map((q) => q.id);

  // Section order = first-appearance order among eligible questions (itself the
  // bank's stable orderIndex order — see the caller's query).
  const sectionOfId = new Map<string, string>();
  const sectionOrder: string[] = [];
  for (const q of eligibleQuestions) {
    const key = q.sectionId ?? '';
    sectionOfId.set(q.id, key);
    if (!sectionOrder.includes(key)) sectionOrder.push(key);
  }
  function shuffleWithinSections(ids: string[]): string[] {
    const bySection = new Map<string, string[]>();
    for (const id of ids) {
      const key = sectionOfId.get(id) ?? '';
      (bySection.get(key) ?? bySection.set(key, []).get(key)!).push(id);
    }
    const out: string[] = [];
    for (const key of sectionOrder) {
      const group = bySection.get(key);
      if (group) out.push(...shuffle(group));
    }
    return out;
  }

  const count = data.questionsPerCandidate
    ? Math.min(data.questionsPerCandidate, eligibleIds.length)
    : eligibleIds.length;

  if (count >= eligibleIds.length) {
    return shuffleWithinSections(eligibleIds);
  }

  const priorUsage = await prisma.interviewQuestion.findMany({
    where: {
      questionId: { in: eligibleIds },
      interview: {
        questionBankId: bankId,
        jobRequisitionId: data.jobRequisitionId ?? null,
        roundNumber: data.roundNumber ?? null,
        status: { notIn: ['CANCELLED', 'EXPIRED'] },
      },
    },
    select: { questionId: true },
  });

  const usageCount = new Map<string, number>();
  for (const id of eligibleIds) usageCount.set(id, 0);
  for (const { questionId } of priorUsage) {
    usageCount.set(questionId, (usageCount.get(questionId) ?? 0) + 1);
  }

  // Draw least-used questions first, shuffling within each usage tier so ties are random.
  const byUsage = new Map<number, string[]>();
  for (const [id, uses] of usageCount) {
    const tier = byUsage.get(uses) ?? [];
    tier.push(id);
    byUsage.set(uses, tier);
  }

  const picked: string[] = [];
  for (const uses of [...byUsage.keys()].sort((a, b) => a - b)) {
    if (picked.length >= count) break;
    const tier = shuffle(byUsage.get(uses)!);
    picked.push(...tier.slice(0, count - picked.length));
  }

  return shuffleWithinSections(picked);
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

export async function createInterview(
  data: CreateInterviewInput,
  ctx: InterviewContext,
  req: Request,
) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: data.candidateId },
    select: { id: true, fullName: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  let application: any = null;
  if (data.jobRequisitionId) {
    application = await prisma.jobApplication.findFirst({
      where: {
        candidateId: data.candidateId,
        jobRequisitionId: data.jobRequisitionId,
      },
    });
    if (!application) {
      throw new BadRequestError('Selected candidate is not mapped to the chosen Job Requisition.');
    }
    
    const rounds = await prisma.interviewWorkflowRound.findMany({
      where: { jobRequisitionId: data.jobRequisitionId },
      orderBy: { sequenceOrder: 'asc' },
    });

    const roundNumber = data.roundNumber ?? application.currentRound;
    const roundDef = rounds.find(r => r.roundNumber === roundNumber);

    if (roundDef && isScheduleRound(roundDef.roundType, roundDef.roundName)) {
      throw new BadRequestError('This round is conducted through the Schedule page.');
    }

    if (data.roundNumber) {
      if (application.currentRound !== data.roundNumber) {
        throw new BadRequestError('Candidate is not currently at this workflow round.');
      }
      if (application.workflowStatus !== 'IN_PROGRESS') {
        throw new BadRequestError('Candidate is not active in the workflow.');
      }
      
      const existingActive = await prisma.interview.findFirst({
        where: {
          candidateId: data.candidateId,
          jobRequisitionId: data.jobRequisitionId,
          roundNumber: data.roundNumber,
          status: { notIn: ['CANCELLED', 'EXPIRED'] },
        },
      });
      if (existingActive) {
        throw new BadRequestError('An active interview is already scheduled or in progress for this candidate and round.');
      }
    } else {
      if (application.workflowStatus === 'FAILED') {
        throw new BadRequestError('Candidate did not qualify for the next interview round.');
      }
    }
  }

  const bank = await prisma.questionBank.findFirst({
    where: { id: data.questionBankId },
    select: { id: true, name: true },
  });
  if (!bank) throw new NotFoundError('Question bank not found');

  const bankQuestions = await prisma.question.findMany({
    where: { bankId: bank.id, ...(data.questionIds?.length ? { id: { in: data.questionIds } } : {}) },
    orderBy: { orderIndex: 'asc' },
    select: { id: true },
  });
  if (bankQuestions.length === 0) {
    throw new BadRequestError('The selected question bank has no matching questions');
  }

  const selectedQuestionIds = await pickInterviewQuestions(bank.id, bankQuestions, data);

  const durationMin =
    data.durationMin ?? (await configService.getNumber(CONFIG_KEYS.INTERVIEW_DEFAULT_DURATION_MIN, 60));

  const interview = await tenantTransaction(async (tx) => {
    const created = await tx.interview.create({
      data: {
        candidateId: data.candidateId,
        recruiterId: ctx.userId,
        questionBankId: bank.id,
        jobRequisitionId: data.jobRequisitionId ?? null,
        status: 'SCHEDULED',
        type: 'AI',
        accessToken: newToken(),
        duration: durationMin,
        roundNumber: data.roundNumber,
      },
      select: { id: true },
    });
    await tx.interviewQuestion.createMany({
      data: selectedQuestionIds.map((questionId, i) => ({
        interviewId: created.id,
        questionId,
        orderIndex: i,
      })),
    });

    if (data.jobRequisitionId && application) {
      const rounds = await tx.interviewWorkflowRound.findMany({
        where: { jobRequisitionId: data.jobRequisitionId },
        orderBy: { roundNumber: 'asc' },
      });
      const roundNumber = data.roundNumber ?? application.currentRound;
      const roundDef = rounds.find(r => r.roundNumber === roundNumber);
      const roundName = roundDef ? roundDef.roundName : `Round ${roundNumber}`;

      await tx.jobApplication.updateMany({
        where: {
          candidateId: data.candidateId,
          jobRequisitionId: data.jobRequisitionId,
        },
        data: {
          status: 'INTERVIEW',
          stage: roundName,
        },
      });
    }

    return created;
  });

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'Interview',
    entityId: interview.id,
    description: `Created AI interview for ${candidate.fullName} (${bankQuestions.length} questions)`,
  });

  return getInterview(interview.id, ctx);
}

// ─── EMAILS ──────────────────────────────────────────────────────────────────

/** Loads the minimal fields needed to email a candidate about an interview. */
async function loadForEmail(id: string, ctx: InterviewContext) {
  const iv = await prisma.interview.findFirst({
    where: { id, type: 'AI', ...interviewScope(ctx) },
    select: {
      id: true,
      accessToken: true,
      candidate: { select: { fullName: true, email: true, phone: true } },
      result: { select: { decision: true } },
      jobRequisition: { select: { title: true } },
    },
  });
  if (!iv) throw new NotFoundError('Interview not found');
  if (!iv.candidate.email) throw new BadRequestError('This candidate has no email address on file.');
  return iv;
}

export async function sendInterviewInvite(
  id: string,
  ctx: InterviewContext,
  req: Request,
  opts: { force?: boolean; selectedChannels?: string[] } = {},
): Promise<MailResult> {
  const iv = await loadForEmail(id, ctx);
  logger.info(`Sending interview invite for interview ${id} using channels: ${opts.selectedChannels ? opts.selectedChannels.join(', ') : 'email'}`);
  const base = env.clientUrl.replace(/\/+$/, '');
  const joinUrl = `${base}/interview/${iv.accessToken}`;

  const { renderNotification } = await import('./notificationTemplateRenderer.js');
  const renderResult = await renderNotification({
    template: 'interview_invite',
    channel: opts.selectedChannels?.includes('whatsapp') ? 'whatsapp' : 'email',
    variables: {
      candidateName: iv.candidate.fullName,
      jobTitle: iv.jobRequisition?.title,
      joinUrl,
    },
  });

  const subject = renderResult.subject;
  const html = renderResult.html;

  let whatsappStatus: 'SENT' | 'SKIPPED' | 'FAILED' | undefined;
  let whatsappReason: string | undefined;

  // WhatsApp Sending (Asynchronous & Isolated)
  if (opts.selectedChannels?.includes('whatsapp')) {
    try {
      const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
      const waResult = await sendWhatsAppIfEnabled({
        phone: iv.candidate.phone || '',
        template: 'interview_invite',
        variables: {
          candidateName: iv.candidate.fullName,
          jobTitle: iv.jobRequisition?.title,
          joinUrl,
        },
        preferenceKey: 'interviewInvitation',
      });
      whatsappStatus = waResult.status;
      whatsappReason = waResult.reason || waResult.error;
      if (whatsappStatus === 'SENT') {
        logger.info(`WhatsApp sent successfully for interview ${id}`);
      } else {
        logger.warn(`WhatsApp skipped/failed for interview ${id}: ${whatsappReason}`);
      }
    } catch (err: any) {
      logger.error(`WhatsApp failed for interview ${id} due to unexpected error`, { error: err.message });
      whatsappStatus = 'FAILED';
      whatsappReason = err.message;
    }
  }

  const result = await sendMailOnce(
    { to: iv.candidate.email!, subject, html, templateId: 'interview-invite', entityType: 'Interview', entityId: id },
    opts.force,
  );
  if (result.sent) {
    await recordAudit(req, {
      action: 'EMAIL',
      entity: 'Interview',
      entityId: id,
      description: `Sent interview invite to ${iv.candidate.email}`,
    });
  }
  return {
    ...result,
    whatsappStatus,
    whatsappReason,
    candidateName: iv.candidate.fullName,
  } as any;
}

/**
 * Emails the candidate their interview outcome (requires a finalized PASS/FAIL).
 * Sends exactly once per interview: the result row's `resultEmailedAt` is claimed
 * atomically (null → now), so concurrent double-clicks or a bulk+single race can
 * never both send. `force` re-sends deliberately. If the send doesn't actually go
 * out (SMTP off / error), the claim is released so it can be retried later.
 */
export async function sendInterviewResult(
  id: string,
  ctx: InterviewContext,
  req: Request,
  opts: { force?: boolean } = {},
): Promise<MailResult> {
  const iv = await loadForEmail(id, ctx);
  const decision = iv.result?.decision as Decision | null;
  if (decision !== 'PASS' && decision !== 'FAIL') {
    throw new BadRequestError('Finalize a Pass or Fail decision before emailing the result.');
  }

  if (opts.force) {
    await prisma.interviewResult.updateMany({ where: { interviewId: id }, data: { resultEmailedAt: new Date() } });
  } else {
    // Atomic compare-and-set — only the first caller flips null → now and proceeds.
    const claim = await prisma.interviewResult.updateMany({
      where: { interviewId: id, resultEmailedAt: null },
      data: { resultEmailedAt: new Date() },
    });
    if (claim.count === 0) return { sent: false, skipped: 'already-sent' };
  }

  const { renderNotification } = await import('./notificationTemplateRenderer.js');
  const renderResult = await renderNotification({
    template: 'interview_result',
    channel: 'email',
    variables: {
      candidateName: iv.candidate.fullName,
      jobTitle: iv.jobRequisition?.title,
      passed: decision === 'PASS',
      failed: decision !== 'PASS',
    },
  });
  const { subject, html } = renderResult;
  const result = await sendMail({ to: iv.candidate.email!, subject, html, templateId: 'interview-result', entityType: 'Interview', entityId: id });

  // Release the claim if nothing actually went out (e.g. SMTP not configured),
  // so the result can be sent once email is set up — without leaving it "sent".
  if (!result.sent) {
    await prisma.interviewResult.updateMany({ where: { interviewId: id }, data: { resultEmailedAt: null } });
    return result;
  }

  await recordAudit(req, {
    action: 'EMAIL',
    entity: 'Interview',
    entityId: id,
    description: `Sent interview result (${decision}) to ${iv.candidate.email}`,
  });
  return result;
}

/**
 * Interview ids with a scored result, scoped + filtered the same way as the
 * Interviews list (search/status). Used by the "download all reports" bulk
 * PDF export so it covers every evaluated candidate currently in view, not
 * just the page the user happens to be on.
 */
export async function listReportableInterviewIds(
  filters: { 
    search?: string; 
    status?: InterviewFilters['status'];
    decision?: Decision;
    jobRequisitionId?: string;
    from?: string;
    to?: string;
  },
  ctx: InterviewContext,
): Promise<string[]> {
  const dateFilter: Prisma.DateTimeFilter = {};
  if (filters.from) dateFilter.gte = new Date(filters.from);
  if (filters.to) {
    const toDate = new Date(filters.to);
    if (toDate.getUTCHours() === 0 && toDate.getUTCMinutes() === 0 && toDate.getUTCSeconds() === 0 && toDate.getUTCMilliseconds() === 0) {
      dateFilter.lte = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
    } else {
      dateFilter.lte = toDate;
    }
  }

  const where: Prisma.InterviewWhereInput = {
    deletedAt: null,
    type: 'AI',
    ...interviewScope(ctx),
    result: { isNot: null },
    candidate: {
      deletedAt: null,
      ...(filters.search && {
        OR: [
          { fullName: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
    },
    ...(filters.status && { status: filters.status }),
    ...(filters.decision && { result: { decision: filters.decision } }),
    ...(filters.jobRequisitionId && { jobRequisitionId: filters.jobRequisitionId }),
    ...((filters.from || filters.to) && { createdAt: dateFilter }),
  };
  const items = await prisma.interview.findMany({ where, select: { id: true } });
  return items.map((i) => i.id);
}

/**
 * Lists candidates whose AI interview has a finalized PASS/FAIL decision, for
 * the bulk result-email screen. Annotates each with when (if ever) the result
 * email was last sent so admins don't double-send.
 */
export async function listResultCandidates(
  ctx: InterviewContext,
  outcome?: 'PASS' | 'FAIL',
  source: 'AI' | 'SCHEDULED' = 'AI',
): Promise<ResultCandidateItem[]> {
  const decisions: Decision[] = outcome ? [outcome] : ['PASS', 'FAIL'];
  // AI = the automated AI interview module; SCHEDULED = human-scheduled
  // (live/panel) interviews whose decision was recorded in Reviews.
  const typeFilter: Prisma.InterviewWhereInput['type'] =
    source === 'SCHEDULED' ? { in: ['LIVE', 'PANEL'] } : 'AI';
  const interviews = await prisma.interview.findMany({
    where: {
      type: typeFilter,
      ...interviewScope(ctx),
      result: { is: { decision: { in: decisions } } },
    },
    select: {
      id: true,
      candidate: { select: { fullName: true, email: true } },
      result: { select: { decision: true, percentageScore: true, decidedAt: true, resultEmailedAt: true } },
    },
  });

  return interviews
    .map((i) => ({
      interviewId: i.id,
      candidateName: i.candidate.fullName,
      candidateEmail: i.candidate.email,
      decision: i.result!.decision as 'PASS' | 'FAIL',
      percentageScore: i.result!.percentageScore,
      decidedAt: i.result!.decidedAt?.toISOString() ?? null,
      lastEmailedAt: i.result!.resultEmailedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
}

/**
 * Bulk-sends finalized result emails. Reuses sendInterviewResult per interview
 * so each send is scope-checked, decision-gated, and audited individually; a
 * single failure never aborts the batch.
 */
export async function sendBulkResults(
  ctx: InterviewContext,
  req: Request,
  interviewIds: string[],
  force = false,
): Promise<BulkEmailResult> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let skippedAlreadySent = 0;
  let skippedNotConfigured = 0;
  for (const id of interviewIds) {
    try {
      const r = await sendInterviewResult(id, ctx, req, { force });
      if (r.sent) sent += 1;
      else if (r.skipped) {
        skipped += 1;
        if (r.skipped === 'already-sent') skippedAlreadySent += 1;
        else if (r.skipped === 'not-configured') skippedNotConfigured += 1;
      } else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, skipped, failed, total: interviewIds.length, skippedAlreadySent, skippedNotConfigured };
}

/**
 * Bulk-sends interview invitations. Reuses sendInterviewInvite per interview.
 */
export async function sendBulkInvites(
  ctx: InterviewContext,
  req: Request,
  interviewIds: string[],
  selectedChannels?: string[],
): Promise<BulkEmailResult & { whatsappSent?: number; whatsappSkipped?: number; whatsappFailed?: number; warnings?: string[] }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  let whatsappSent = 0;
  let whatsappSkipped = 0;
  let whatsappFailed = 0;
  const warnings: string[] = [];

  const hasWhatsApp = selectedChannels?.includes('whatsapp');

  for (const id of interviewIds) {
    try {
      const r = await sendInterviewInvite(id, ctx, req, { force: true, selectedChannels }) as any;
      if (r.sent) sent += 1;
      else if (r.skipped) skipped += 1;
      else failed += 1;

      if (hasWhatsApp) {
        if (r.whatsappStatus === 'SENT') {
          whatsappSent += 1;
        } else if (r.whatsappStatus === 'SKIPPED') {
          whatsappSkipped += 1;
          const candidateName = r.candidateName || `Candidate (${id})`;
          warnings.push(`${candidateName}: ${r.whatsappReason || 'Skipped'}`);
        } else if (r.whatsappStatus === 'FAILED') {
          whatsappFailed += 1;
          const candidateName = r.candidateName || `Candidate (${id})`;
          warnings.push(`${candidateName}: ${r.whatsappReason || 'Failed'}`);
        }
      }
    } catch (err: any) {
      failed += 1;
      if (hasWhatsApp) {
        whatsappFailed += 1;
        warnings.push(`Candidate (${id}): ${err.message || 'Error occurred during dispatch'}`);
      }
    }
  }

  return {
    sent,
    skipped,
    failed,
    total: interviewIds.length,
    ...(hasWhatsApp && {
      whatsappSent,
      whatsappSkipped,
      whatsappFailed,
      warnings,
    }),
  };
}

async function checkAndSubmitOverdue(id: string): Promise<void> {
  const iv = await prisma.interview.findUnique({
    where: { id },
    select: { id: true, status: true, startedAt: true, duration: true, accessToken: true },
  });
  if (iv && iv.status === 'IN_PROGRESS' && iv.startedAt && iv.duration && iv.accessToken) {
    const deadline = iv.startedAt.getTime() + iv.duration * 60_000;
    if (Date.now() > deadline) {
      try {
        const { submitInterview } = await import('./publicInterviewService.js');
        await submitInterview(iv.accessToken);
      } catch (err) {
        logger.warn('Failed to auto-submit overdue interview', { interviewId: id, err: (err as Error).message });
      }
    }
  }
}

async function autoSubmitOverdueInContext(ctx: InterviewContext): Promise<void> {
  const active = await prisma.interview.findMany({
    where: {
      status: 'IN_PROGRESS',
      startedAt: { not: null },
      duration: { not: null },
      type: 'AI',
      ...interviewScope(ctx),
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
          const { submitInterview } = await import('./publicInterviewService.js');
          await submitInterview(iv.accessToken);
        } catch (err) {
          logger.warn('Failed to auto-submit overdue interview', { interviewId: iv.id, err: (err as Error).message });
        }
      }
    }
  }
}

// ─── LIST ────────────────────────────────────────────────────────────────────

export async function listInterviews(filters: InterviewFilters, ctx: InterviewContext) {
  await autoSubmitOverdueInContext(ctx);
  const { page, limit, candidateId, jobRequisitionId, status, decision, from, to, search, sortBy, sortOrder } = filters;
  const dateFilter: Prisma.DateTimeFilter = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) {
    const toDate = new Date(to);
    if (toDate.getUTCHours() === 0 && toDate.getUTCMinutes() === 0 && toDate.getUTCSeconds() === 0 && toDate.getUTCMilliseconds() === 0) {
      dateFilter.lte = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
    } else {
      dateFilter.lte = toDate;
    }
  }
  const where: Prisma.InterviewWhereInput = {
    deletedAt: null,
    // M4 owns AI interviews only; LIVE/PANEL belong to M5 scheduling.
    type: 'AI',
    ...interviewScope(ctx),
    candidate: {
      deletedAt: null,
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    },
    ...(candidateId && { candidateId }),
    ...(jobRequisitionId && { jobRequisitionId }),
    ...(status && { status }),
    ...(decision && { result: { decision } }),
    ...((from || to) && { createdAt: dateFilter }),
  };
  const [total, items] = await Promise.all([
    prisma.interview.count({ where }),
    prisma.interview.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const banks = await bankNameMap(items.map((i) => i.questionBankId));
  const mapped = items.map(({ questionBankId, createdAt, startedAt, completedAt, status, type, result, ...rest }) => ({
    ...rest,
    status: status as InterviewDetail['status'],
    type: type as InterviewDetail['type'],
    createdAt: createdAt.toISOString(),
    startedAt: startedAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
    questionBank: questionBankId ? banks.get(questionBankId) ?? null : null,
    result: result ? { percentageScore: result.percentageScore, decision: result.decision as Decision | null } : null,
  }));
  return paginate(mapped, total, page, limit);
}

// ─── GET ONE ─────────────────────────────────────────────────────────────────

export async function getInterview(id: string, ctx: InterviewContext, allowAnyType = false): Promise<InterviewDetail> {
  await checkAndSubmitOverdue(id);
  const iv = await prisma.interview.findFirst({
    where: { id, ...(allowAnyType ? {} : { type: 'AI' }), ...interviewScope(ctx) },
    select: {
      ...LIST_SELECT,
      accessToken: true,
      duration: true,
      transcript: true,
      violations: true,
      terminatedReason: true,
      recordingUrl: true,
      proctorShots: {
        orderBy: { capturedAt: 'asc' },
        select: { id: true, reason: true, note: true, capturedAt: true },
      },
      questions: {
        orderBy: { orderIndex: 'asc' },
        select: { question: { select: { id: true, text: true, type: true, difficulty: true, options: true, rubric: true, testCases: true, tags: true, aiGenerated: true, orderIndex: true } } },
      },
      answers: {
        select: {
          id: true, questionId: true, answerText: true, answerCode: true, selectedOption: true, language: true,
          isCorrect: true, aiScore: true, maxScore: true, aiEvaluation: true, timeTaken: true,
        },
      },
      result: true,
    },
  });
  if (!iv) throw new NotFoundError('Interview not found');

  const banks = await bankNameMap([iv.questionBankId]);

  const result: InterviewDetail['result'] = iv.result
    ? {
        totalScore: iv.result.totalScore,
        maxScore: iv.result.maxScore,
        percentageScore: iv.result.percentageScore,
        aiScore: iv.result.aiScore,
        finalScore: iv.result.finalScore,
        decision: iv.result.decision as Decision | null,
        aiDecision: iv.result.aiDecision,
        aiReasoning: iv.result.aiReasoning,
        aiSummary: iv.result.aiSummary,
        strengths: iv.result.strengths,
        improvements: iv.result.improvements,
        recruiterNotes: iv.result.recruiterNotes,
        decidedAt: iv.result.decidedAt?.toISOString() ?? null,
        technicalScore: iv.result.technicalScore,
        problemSolvingScore: iv.result.problemSolvingScore,
        communicationScore: iv.result.communicationScore,
        culturalFitScore: iv.result.culturalFitScore,
        skillMatchScore: iv.result.skillMatchScore,
        sentimentResult: iv.result.sentimentResult as any,
        keywordAnalysis: iv.result.keywordAnalysis as any,
        transcriptSummary: iv.result.transcriptSummary,
      }
    : null;

  return {
    id: iv.id,
    status: iv.status as InterviewDetail['status'],
    type: iv.type as InterviewDetail['type'],
    createdAt: iv.createdAt.toISOString(),
    startedAt: iv.startedAt?.toISOString() ?? null,
    completedAt: iv.completedAt?.toISOString() ?? null,
    candidate: iv.candidate,
    questionBank: iv.questionBankId ? banks.get(iv.questionBankId) ?? null : null,
    _count: iv._count,
    accessToken: iv.accessToken,
    duration: iv.duration,
    transcript: iv.transcript ?? null,
    violations: Array.isArray(iv.violations) ? (iv.violations as unknown as ViolationEntry[]) : null,
    terminatedReason: iv.terminatedReason ?? null,
    recordingUrl: iv.recordingUrl ?? null,
    proctorShots: iv.proctorShots.map((s) => ({
      id: s.id,
      reason: s.reason as InterviewDetail['proctorShots'][number]['reason'],
      note: s.note,
      capturedAt: s.capturedAt.toISOString(),
    })),
    questions: iv.questions.map((q) => mapQuestion(q.question)),
    answers: iv.answers,
    result,
  };
}

/** Returns a stored proctoring snapshot's bytes, sector-scoped to the viewer. */
export async function getProctorShot(
  interviewId: string,
  shotId: string,
  ctx: InterviewContext,
): Promise<{ mimeType: string; data: Buffer }> {
  const iv = await prisma.interview.findFirst({
    where: { id: interviewId, type: 'AI', ...interviewScope(ctx) },
    select: { id: true },
  });
  if (!iv) throw new NotFoundError('Interview not found');
  const shot = await prisma.proctorShot.findFirst({
    where: { id: shotId, interviewId },
    select: { mimeType: true, imageData: true },
  });
  if (!shot) throw new NotFoundError('Snapshot not found');
  return { mimeType: shot.mimeType, data: Buffer.from(shot.imageData) };
}

// ─── CANCEL ──────────────────────────────────────────────────────────────────

export async function cancelInterview(id: string, ctx: InterviewContext, req: Request) {
  const iv = await prisma.interview.findFirst({ where: { id, type: 'AI', ...interviewScope(ctx) } });
  if (!iv) throw new NotFoundError('Interview not found');
  if (['EVALUATED', 'COMPLETED', 'EVALUATING'].includes(iv.status)) {
    throw new BadRequestError('Cannot cancel an interview that has been submitted');
  }
  await prisma.interview.update({ where: { id }, data: { status: 'CANCELLED' } });
  await recordAudit(req, {
    action: 'CANCEL',
    entity: 'Interview',
    entityId: id,
    description: `Cancelled interview ${id}`,
  });
}

// ─── DECISION ──────────────────────────────────────────────────────────────

export async function decideInterview(
  id: string,
  data: InterviewDecisionInput,
  ctx: InterviewContext,
  req: Request,
) {
  const iv = await prisma.interview.findFirst({
    where: { id, type: 'AI', ...interviewScope(ctx) },
    select: { id: true, status: true, result: { select: { id: true } } },
  });
  if (!iv) throw new NotFoundError('Interview not found');
  if (!['COMPLETED', 'EVALUATING', 'EVALUATED'].includes(iv.status)) {
    throw new BadRequestError('Only a submitted interview can be decided');
  }

  const decisionData = {
    decision: data.decision,
    recruiterNotes: data.recruiterNotes ?? null,
    decidedById: ctx.userId,
    decidedAt: new Date(),
  };

  await prisma.interviewResult.upsert({
    where: { interviewId: id },
    update: decisionData,
    create: { interviewId: id, ...decisionData },
  });

  await recordAudit(req, {
    action: 'DECIDE',
    entity: 'Interview',
    entityId: id,
    description: `Interview decision: ${data.decision}`,
    newValue: { decision: data.decision },
  });

  try {
    const delayMinutes = await configService.getNumber(CONFIG_KEYS.INTERVIEW_REPORT_DELAY_MINUTES, 5);
    const { dispatchCandidateReport } = await import('../jobs/dispatch.js');
    await dispatchCandidateReport(id, delayMinutes);
  } catch (err) {
    // Ignore queue errors
  }

  try {
    const { processWorkflowProgression } = await import('./workflowProgressionService.js');
    await processWorkflowProgression(id, data.decision, null);
  } catch (err) {
    logger.warn('Failed to process workflow progression', { id, err: (err as Error).message });
  }

  return getInterview(id, ctx);
}

// ─── HR WORKFLOW ────────────────────────────────────────────────────────────

import type { SubmitDecisionInput } from '@agnohire/shared';
import { notify } from './notificationService.js';
import { NOTIFICATION_TYPE } from '@agnohire/shared';

export async function submitDecision(
  id: string,
  data: SubmitDecisionInput,
  ctx: InterviewContext,
  req: Request,
) {
  const iv = await prisma.interview.findFirst({
    where: { id, ...interviewScope(ctx) },
    select: { id: true, status: true, type: true, candidateId: true, jobRequisitionId: true, roundNumber: true, result: { select: { id: true } } },
  });
  if (!iv) throw new NotFoundError('Interview not found');

  let isLastRound = true;
  if (iv.jobRequisitionId && iv.roundNumber != null) {
    const rounds = await prisma.interviewWorkflowRound.findMany({
      where: { jobRequisitionId: iv.jobRequisitionId },
      orderBy: { roundNumber: 'desc' },
      take: 1
    });
    if (rounds.length > 0) {
      isLastRound = rounds[0].roundNumber === iv.roundNumber;
    }
  }

  const isScheduled = iv.type === 'LIVE' || iv.type === 'PANEL';
  const hrStatusValue = (data.decision === 'PASS' || data.decision === 'HOLD') && isLastRound && isScheduled ? 'PENDING' : 'NOT_APPLICABLE';

  const updateData = {
    decision: data.decision,
    interviewerComments: data.interviewerComments ?? null,
    strengths: data.strengths ?? null,
    improvements: data.improvements ?? null,
    recommendedPosition: data.recommendedPosition ?? null,
    recommendedSalary: data.recommendedSalary ?? null,
    recommendation: data.hiringRecommendation ?? null,
    decidedById: ctx.userId,
    decidedAt: new Date(),
    hrStatus: hrStatusValue,
  };

  await prisma.interviewResult.upsert({
    where: { interviewId: id },
    update: updateData,
    create: { interviewId: id, ...updateData },
  });

  if ((data.decision === 'PASS' || data.decision === 'HOLD') && isLastRound && iv.candidateId && iv.jobRequisitionId) {
    await prisma.jobApplication.updateMany({
      where: {
        candidateId: iv.candidateId,
        jobRequisitionId: iv.jobRequisitionId,
      },
      data: {
        workflowStatus: 'SELECTED',
        status: 'SUBMITTED_TO_HR',
      },
    });
  }

  if (data.decision === 'PASS' || data.decision === 'HOLD') {
    // Find HR users to notify
    const hrUsers = await prisma.user.findMany({
      where: { role: { name: 'HR' } },
      select: { id: true }
    });

    for (const hr of hrUsers) {
      await notify({
        recipientId: hr.id,
        type: NOTIFICATION_TYPE.GENERIC,
        title: 'Candidate Submitted for HR Approval',
        message: `A candidate has been submitted for HR review (Decision: ${data.decision}).`,
        entityType: 'Interview',
        entityId: id,
      });
    }
  }

  await recordAudit(req, {
    action: 'DECIDE',
    entity: 'Interview',
    entityId: id,
    description: `Submitted decision to HR: ${data.decision}`,
  });

  try {
    const { processWorkflowProgression } = await import('./workflowProgressionService.js');
    await processWorkflowProgression(id, data.decision, null);
  } catch (err) {
    logger.warn('Failed to process workflow progression', { id, err: (err as Error).message });
  }

  return getInterview(id, ctx, true);
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function deleteInterview(id: string, ctx: InterviewContext, req: Request) {
  const iv = await prisma.interview.findFirst({ where: { id, ...interviewScope(ctx) } });
  if (!iv) throw new NotFoundError('Interview not found');
  await tenantTransaction(async (tx) => {
    await tx.proctorShot.deleteMany({ where: { interviewId: id } });
    await tx.candidateAnswer.deleteMany({ where: { interviewId: id } });
    await tx.interviewQuestion.deleteMany({ where: { interviewId: id } });
    await tx.interviewFeedback.deleteMany({ where: { interviewId: id } });
    await tx.panelMember.deleteMany({ where: { interviewId: id } });
    await tx.interview.delete({ where: { id } });
  });
  await recordAudit(req, {
    action: 'DELETE',
    entity: 'Interview',
    entityId: id,
    description: `Deleted interview ${id}`,
  });
}

import ExcelJS from 'exceljs';

export async function generateInterviewsExcel(ids: string[], ctx: InterviewContext): Promise<{ buffer: Buffer, filename: string }> {
  const where: Prisma.InterviewWhereInput = {
    id: { in: ids },
    deletedAt: null,
    type: 'AI',
    ...interviewScope(ctx)
  };
  
  const items = await prisma.interview.findMany({
    where,
    select: LIST_SELECT,
    orderBy: { createdAt: 'desc' }
  });

  const banks = await bankNameMap(items.map((i) => i.questionBankId));
  
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Interview Reports');

  worksheet.columns = [
    { header: 'Candidate Name', key: 'name', width: 25 },
    { header: 'Candidate Email', key: 'email', width: 30 },
    { header: 'Job Title', key: 'jobTitle', width: 25 },
    { header: 'Question Bank', key: 'questionBank', width: 20 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Score', key: 'score', width: 10 },
    { header: 'Decision', key: 'decision', width: 15 },
    { header: 'Created Date', key: 'createdDate', width: 15 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF007AFF' },
  };

  items.forEach(item => {
    const formattedDate = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    worksheet.addRow({
      name: item.candidate.fullName || '',
      email: item.candidate.email || '',
      jobTitle: item.jobRequisition?.title || 'N/A',
      questionBank: item.questionBankId ? banks.get(item.questionBankId)?.name || 'Unknown' : 'N/A',
      status: item.status || '',
      score: item.result?.percentageScore !== undefined && item.result?.percentageScore !== null ? `${item.result.percentageScore}%` : 'N/A',
      decision: item.result?.decision || 'PENDING',
      createdDate: formattedDate
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
    
  return {
    buffer: Buffer.from(buffer),
    filename: `Interview_Reports_${new Date().toISOString().split('T')[0]}.xlsx`
  };
}

export async function updateInterview(
  id: string,
  data: { scheduledDate?: string | Date; meetingLink?: string; recruiterId?: string; status?: string },
  ctx: InterviewContext,
  req: Request
) {
  const iv = await prisma.interview.findFirst({
    where: { id, ...interviewScope(ctx) }
  });
  if (!iv) throw new NotFoundError('Interview not found');

  const updated = await prisma.interview.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status as any } : {}),
      ...(data.recruiterId ? { recruiterId: data.recruiterId } : {}),
    },
    select: LIST_SELECT
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'Interview',
    entityId: id,
    description: `Updated interview ${id}`,
  });

  return updated;
}

export async function updateInterviewStatus(
  id: string,
  status: string,
  ctx: InterviewContext,
  req: Request
) {
  return await updateInterview(id, { status }, ctx, req);
}
