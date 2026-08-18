import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma, tenantTransaction } from '../config/database.js';
import { requireTenantId } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { configService } from './configService.js';
import { mapQuestion, type InterviewContext } from './questionBankService.js';
import { sendMailOnce, type MailResult } from './mailerService.js';
import { assessmentResultEmail, assessmentInviteEmail } from './emailTemplates.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import { isRecruiterScoped } from '../utils/accessScope.js';
import {
  ROLES,
  PERMISSIONS,
  type CreateAssessmentInput,
  type UpdateAssessmentInput,
  type AssessmentFilters,
  type AssignAssessmentInput,
  type AssignmentFilters,
  type AssessmentDetail,
  type AssessmentListItem,
  type AssignmentDetail,
  type AssignmentListItem,
  type QuestionItem,
  type SendAssessmentResultInput,
  type BulkSendAssessmentResultInput,
  type ViolationEntry,
} from '@agnohire/shared';

const RESULT_EMAIL_TEMPLATE_PASS = 'assessment-pass';
const RESULT_EMAIL_TEMPLATE_FAIL = 'assessment-fail';

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/** Non-admins see their sector's assessments + sector-less ones. */
function assessmentScope(ctx: InterviewContext): Prisma.AssessmentWhereInput {
  if (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) return {};
  if (ctx.sectorId) return { OR: [{ sectorId: ctx.sectorId }, { sectorId: null }] };
  return {};
}

const QSELECT = {
  id: true, text: true, type: true, difficulty: true, options: true,
  rubric: true, testCases: true, tags: true, aiGenerated: true, orderIndex: true,
} satisfies Prisma.QuestionSelect;

/** Resolve an assessment's questions (plain FK → secondary query), in order. */
async function resolveQuestions(assessmentId: string): Promise<QuestionItem[]> {
  const aqs = await prisma.assessmentQuestion.findMany({
    where: { assessmentId },
    orderBy: { orderIndex: 'asc' },
    select: { questionId: true, orderIndex: true },
  });
  if (aqs.length === 0) return [];
  const qs = await prisma.question.findMany({
    where: { id: { in: aqs.map((a) => a.questionId) }, deletedAt: null },
    select: QSELECT,
  });
  const byId = new Map(qs.map((q) => [q.id, q]));
  return aqs
    .map((a) => {
      const q = byId.get(a.questionId);
      return q ? mapQuestion({ ...q, orderIndex: a.orderIndex }) : null;
    })
    .filter((q): q is QuestionItem => q !== null);
}

async function domainName(domainId: string | null): Promise<{ id: string; name: string } | null> {
  if (!domainId) return null;
  const d = await prisma.domain.findUnique({ where: { id: domainId }, select: { id: true, name: true } });
  return d;
}

async function jobRequisition(jobRequisitionId: string | null): Promise<{ id: string; title: string } | null> {
  if (!jobRequisitionId) return null;
  return prisma.jobRequisition.findUnique({ where: { id: jobRequisitionId }, select: { id: true, title: true } });
}

/** Resolve a set of job-requisition ids to {id,title} in one query. */
async function jobMap(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map<string, { id: string; title: string }>();
  const jobs = await prisma.jobRequisition.findMany({ where: { id: { in: unique } }, select: { id: true, title: true } });
  return new Map(jobs.map((j) => [j.id, j]));
}

// ─── TEMPLATES ────────────────────────────────────────────────────────────────

export async function listAssessments(filters: AssessmentFilters, ctx: InterviewContext) {
  const { page, limit, search, domainId, isActive, sortBy, sortOrder } = filters;
  const where: Prisma.AssessmentWhereInput = {
    deletedAt: null,
    ...assessmentScope(ctx),
    ...(domainId && { domainId }),
    ...(isActive !== undefined && { isActive }),
    ...(search && { title: { contains: search, mode: 'insensitive' } }),
  };
  const [total, rows] = await Promise.all([
    prisma.assessment.count({ where }),
    prisma.assessment.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, title: true, description: true, passingScore: true, durationMin: true,
        isActive: true, createdAt: true, domainId: true, jobRequisitionId: true,
        _count: { select: { questions: true, assignments: true } },
      },
    }),
  ]);

  const domainIds = [...new Set(rows.map((r) => r.domainId).filter((x): x is string => !!x))];
  const domains = domainIds.length
    ? await prisma.domain.findMany({ where: { id: { in: domainIds } }, select: { id: true, name: true } })
    : [];
  const dmap = new Map(domains.map((d) => [d.id, d]));
  const jmap = await jobMap(rows.map((r) => r.jobRequisitionId));

  const items: AssessmentListItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    passingScore: r.passingScore,
    durationMin: r.durationMin,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    domain: r.domainId ? dmap.get(r.domainId) ?? null : null,
    jobRequisition: r.jobRequisitionId ? jmap.get(r.jobRequisitionId) ?? null : null,
    questionCount: r._count.questions,
    assignmentCount: r._count.assignments,
  }));
  return paginate(items, total, page, limit);
}

export async function getAssessment(id: string, ctx: InterviewContext): Promise<AssessmentDetail> {
  const a = await prisma.assessment.findFirst({
    where: { id, deletedAt: null, ...assessmentScope(ctx) },
    select: {
      id: true, title: true, description: true, passingScore: true, durationMin: true,
      isActive: true, createdAt: true, domainId: true, jobRequisitionId: true,
      _count: { select: { questions: true, assignments: true } },
    },
  });
  if (!a) throw new NotFoundError('Assessment not found');
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    passingScore: a.passingScore,
    durationMin: a.durationMin,
    isActive: a.isActive,
    createdAt: a.createdAt.toISOString(),
    domain: await domainName(a.domainId),
    jobRequisition: await jobRequisition(a.jobRequisitionId),
    questionCount: a._count.questions,
    assignmentCount: a._count.assignments,
    questions: await resolveQuestions(id),
  };
}

/** Validate the question ids exist (and aren't deleted); returns them deduped. */
async function validateQuestionIds(questionIds: string[]): Promise<string[]> {
  const unique = [...new Set(questionIds)];
  if (unique.length === 0) return [];
  const found = await prisma.question.count({ where: { id: { in: unique }, deletedAt: null } });
  if (found !== unique.length) throw new BadRequestError('One or more selected questions were not found');
  return unique;
}

export async function createAssessment(data: CreateAssessmentInput, ctx: InterviewContext, req: Request) {
  const questionIds = await validateQuestionIds(data.questionIds);
  const sectorId = isSuperOrAdmin(ctx.role) ? null : ctx.sectorId ?? null;

  const assessment = await tenantTransaction(async (tx) => {
    const created = await tx.assessment.create({
      data: {
        title: data.title,
        description: data.description || null,
        domainId: data.domainId ?? null,
        jobRequisitionId: data.jobRequisitionId ?? null,
        sectorId,
        passingScore: data.passingScore,
        durationMin: data.durationMin ?? null,
        createdById: ctx.userId,
        tenantId: requireTenantId(),
      },
      select: { id: true },
    });
    if (questionIds.length) {
      await tx.assessmentQuestion.createMany({
        data: questionIds.map((questionId, i) => ({ assessmentId: created.id, questionId, orderIndex: i })),
      });
    }
    return created;
  });

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'Assessment',
    entityId: assessment.id,
    description: `Created assessment: ${data.title} (${questionIds.length} questions)`,
  });
  return getAssessment(assessment.id, ctx);
}

export async function updateAssessment(
  id: string,
  data: UpdateAssessmentInput,
  ctx: InterviewContext,
  req: Request,
) {
  const existing = await prisma.assessment.findFirst({ where: { id, deletedAt: null, ...assessmentScope(ctx) } });
  if (!existing) throw new NotFoundError('Assessment not found');

  const questionIds = data.questionIds ? await validateQuestionIds(data.questionIds) : undefined;

  await tenantTransaction(async (tx) => {
    await tx.assessment.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description || null }),
        ...(data.domainId !== undefined && { domainId: data.domainId ?? null }),
        ...(data.jobRequisitionId !== undefined && { jobRequisitionId: data.jobRequisitionId ?? null }),
        ...(data.passingScore !== undefined && { passingScore: data.passingScore }),
        ...(data.durationMin !== undefined && { durationMin: data.durationMin ?? null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
    if (questionIds) {
      await tx.assessmentQuestion.deleteMany({ where: { assessmentId: id } });
      if (questionIds.length) {
        await tx.assessmentQuestion.createMany({
          data: questionIds.map((questionId, i) => ({ assessmentId: id, questionId, orderIndex: i })),
        });
      }
    }
  });

  await recordAudit(req, { action: 'UPDATE', entity: 'Assessment', entityId: id, description: `Updated assessment ${id}` });
  return getAssessment(id, ctx);
}

export async function deleteAssessment(id: string, ctx: InterviewContext, req: Request) {
  const existing = await prisma.assessment.findFirst({ where: { id, deletedAt: null, ...assessmentScope(ctx) } });
  if (!existing) throw new NotFoundError('Assessment not found');
  await tenantTransaction(async (tx) => {
    const assignments = await tx.assessmentAssignment.findMany({
      where: { assessmentId: id },
      select: { id: true }
    });
    const assignmentIds = assignments.map((a: { id: string }) => a.id);
    if (assignmentIds.length > 0) {
      await tx.assessmentAnswer.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
      await tx.assessmentAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    }
    await tx.assessmentQuestion.deleteMany({ where: { assessmentId: id } });
    await tx.assessment.delete({ where: { id } });
  });
  await recordAudit(req, { action: 'DELETE', entity: 'Assessment', entityId: id, description: `Deleted assessment: ${existing.title}` });
}

// ─── ASSIGNMENTS ──────────────────────────────────────────────────────────────

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

const ACTIVE_STATUSES = ['PENDING', 'IN_PROGRESS', 'SUBMITTED', 'EVALUATING'];

export async function assignAssessment(
  assessmentId: string,
  data: AssignAssessmentInput,
  ctx: InterviewContext,
  req: Request,
): Promise<{ assigned: number; skipped: number; invited: number }> {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, deletedAt: null, ...assessmentScope(ctx) },
    select: { id: true, isActive: true, title: true, durationMin: true, jobRequisitionId: true, _count: { select: { questions: true } } },
  });
  if (!assessment) throw new NotFoundError('Assessment not found');
  if (!assessment.isActive) throw new BadRequestError('This assessment is inactive');
  if (assessment._count.questions === 0) throw new BadRequestError('Add questions before assigning this assessment');

  const candidateIds = [...new Set(data.candidateIds)];
  const candidates = await prisma.candidate.findMany({
    where: { id: { in: candidateIds }, deletedAt: null },
    select: { id: true, fullName: true, email: true },
  });
  if (candidates.length !== candidateIds.length) throw new BadRequestError('One or more candidates were not found');

  // Skip candidates that already have a live assignment for this assessment.
  const existing = await prisma.assessmentAssignment.findMany({
    where: { assessmentId, candidateId: { in: candidateIds }, status: { in: ACTIVE_STATUSES } },
    select: { candidateId: true },
  });
  const already = new Set(existing.map((e) => e.candidateId));
  const toAssign = candidateIds.filter((id) => !already.has(id));

  let invited = 0;
  if (toAssign.length) {
    // Create one assignment per candidate, capturing the token so we can email
    // each candidate their unique assessment link. createMany doesn't return
    // rows, so create individually (counts are small — a recruiter's selection).
    const candById = new Map(candidates.map((c) => [c.id, c]));
    const base = env.clientUrl.replace(/\/+$/, '');
    for (const candidateId of toAssign) {
      const created = await prisma.assessmentAssignment.create({
        data: { assessmentId, candidateId, assignedById: ctx.userId, accessToken: newToken() },
        select: { id: true, accessToken: true },
      });

      if (assessment.jobRequisitionId) {
        await prisma.jobApplication.updateMany({
          where: {
            candidateId,
            jobRequisitionId: assessment.jobRequisitionId,
          },
          data: {
            status: 'ASSESSMENT',
            stage: 'Assessment',
          },
        });
      }

      const cand = candById.get(candidateId);
      if (!cand?.email) continue;
      try {
        const { subject, html } = await assessmentInviteEmail({
          candidateName: cand.fullName,
          assessmentTitle: assessment.title,
          startUrl: `${base}/assessment/${created.accessToken}`,
          durationMin: assessment.durationMin,
          questionCount: assessment._count.questions,
        });
        const result = await sendMailOnce(
          { to: cand.email, subject, html, templateId: 'assessment-invite', entityType: 'AssessmentAssignment', entityId: created.id },
        );
        if (result.sent) invited += 1;
      } catch (err) {
        logger.warn('Assessment invite email failed', { assignmentId: created.id, err: (err as Error).message });
      }
    }
  }

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'AssessmentAssignment',
    entityId: assessmentId,
    description: `Assigned "${assessment.title}" to ${toAssign.length} candidate(s); emailed ${invited}`,
  });
  return { assigned: toAssign.length, skipped: already.size, invited };
}

/**
 * Non-admins see assignments they created or in their sector's assessments.
 * Recruiters are narrowed to the candidates allocated to them. Async because
 * AssessmentAssignment has no `candidate` relation — we resolve the recruiter's
 * assigned candidate ids and filter on the scalar `candidateId`.
 */
async function assignmentScope(ctx: InterviewContext): Promise<Prisma.AssessmentAssignmentWhereInput> {
  if (isSuperOrAdmin(ctx.role)) return {};
  if (isRecruiterScoped(ctx.role)) {
    const assigned = await prisma.candidateAssignment.findMany({
      where: { recruiterId: ctx.userId, status: 'ASSIGNED' },
      select: { candidateId: true },
    });
    return { candidateId: { in: assigned.map((a) => a.candidateId) } };
  }
  if (ctx.sectorId) return { OR: [{ assignedById: ctx.userId }, { assessment: { sectorId: ctx.sectorId } }] };
  return { assignedById: ctx.userId };
}

const ASSIGNMENT_SELECT = {
  id: true, status: true, accessToken: true, createdAt: true, startedAt: true,
  submittedAt: true, percentageScore: true, passed: true, candidateId: true,
  assessment: { select: { id: true, title: true, passingScore: true, jobRequisitionId: true } },
} satisfies Prisma.AssessmentAssignmentSelect;

type RawAssignment = Prisma.AssessmentAssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;

async function candidateMap(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<string, { id: string; fullName: string; email: string }>();
  const cands = await prisma.candidate.findMany({
    where: { id: { in: unique }, deletedAt: null },
    select: { id: true, fullName: true, email: true },
  });
  return new Map(cands.map((c) => [c.id, c]));
}

function toAssignmentItem(
  a: RawAssignment,
  cand: { id: string; fullName: string; email: string } | undefined,
  jmap?: Map<string, { id: string; title: string }>,
): AssignmentListItem {
  const jobId = a.assessment?.jobRequisitionId ?? null;
  return {
    id: a.id,
    status: a.status as AssignmentListItem['status'],
    accessToken: a.accessToken,
    createdAt: a.createdAt.toISOString(),
    startedAt: a.startedAt?.toISOString() ?? null,
    submittedAt: a.submittedAt?.toISOString() ?? null,
    percentageScore: a.percentageScore,
    passed: a.passed,
    candidate: cand ?? { id: a.candidateId, fullName: 'Unknown', email: '' },
    assessment: a.assessment
      ? { id: a.assessment.id, title: a.assessment.title, passingScore: a.assessment.passingScore }
      : null,
    jobRequisition: jobId ? jmap?.get(jobId) ?? null : null,
  };
}

export async function listAssignments(filters: AssignmentFilters, ctx: InterviewContext) {
  const { page, limit, assessmentId, candidateId, jobRequisitionId, status, passed, search, sortBy, sortOrder } = filters;
  const where: Prisma.AssessmentAssignmentWhereInput = {
    ...(await assignmentScope(ctx)),
    ...(assessmentId && { assessmentId }),
    ...(candidateId && { candidateId }),
    ...(jobRequisitionId && { assessment: { jobRequisitionId } }),
    ...(status && { status }),
    ...(passed !== undefined && { passed }),
  };

  const [total, rows] = await Promise.all([
    prisma.assessmentAssignment.count({ where }),
    prisma.assessmentAssignment.findMany({
      where,
      select: ASSIGNMENT_SELECT,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const cmap = await candidateMap(rows.map((r) => r.candidateId));
  const jmap = await jobMap(rows.map((r) => r.assessment?.jobRequisitionId ?? null));
  let items = rows
    .map((r) => {
      const cand = cmap.get(r.candidateId);
      if (!cand) return null;
      return toAssignmentItem(r, cand, jmap);
    })
    .filter((i): i is AssignmentListItem => i !== null);

  // Search filters on candidate name/email (resolved post-query since it's a plain FK).
  if (search) {
    const q = search.toLowerCase();
    items = items.filter((i) => i.candidate.fullName.toLowerCase().includes(q) || i.candidate.email.toLowerCase().includes(q));
  }
  return paginate(items, total, page, limit);
}

export async function getAssignment(id: string, ctx: InterviewContext): Promise<AssignmentDetail> {
  const a = await prisma.assessmentAssignment.findFirst({
    where: { id, ...(await assignmentScope(ctx)) },
    select: {
      ...ASSIGNMENT_SELECT,
      assessmentId: true,
      totalScore: true,
      maxScore: true,
      aiSummary: true,
      violations: true,
      terminatedReason: true,
      recordingUrl: true,
      transcript: true,
      proctorShots: {
        orderBy: { capturedAt: 'asc' },
        select: { id: true, reason: true, note: true, capturedAt: true },
      },
      answers: {
        select: {
          id: true, questionId: true, answerText: true, answerCode: true, selectedOption: true, language: true,
          isCorrect: true, aiScore: true, maxScore: true, aiEvaluation: true,
        },
      },
    },
  });
  if (!a) throw new NotFoundError('Assignment not found');
  const cmap = await candidateMap([a.candidateId]);
  const jmap = await jobMap([a.assessment?.jobRequisitionId ?? null]);

  // Check whether a result email was already sent for this assignment.
  const emailLog = await prisma.emailLog.findFirst({
    where: {
      entityId: id,
      templateId: { in: [RESULT_EMAIL_TEMPLATE_PASS, RESULT_EMAIL_TEMPLATE_FAIL] },
      status: 'SENT',
    },
    select: { sentAt: true },
    orderBy: { sentAt: 'desc' },
  });

  return {
    ...toAssignmentItem(a, cmap.get(a.candidateId), jmap),
    totalScore: a.totalScore,
    maxScore: a.maxScore,
    aiSummary: a.aiSummary,
    questions: await resolveQuestions(a.assessmentId),
    answers: a.answers,
    resultEmailSentAt: emailLog?.sentAt?.toISOString() ?? null,
    violations: Array.isArray(a.violations) ? (a.violations as unknown as ViolationEntry[]) : null,
    terminatedReason: a.terminatedReason ?? null,
    recordingUrl: a.recordingUrl ?? null,
    transcript: a.transcript ?? null,
    proctorShots: a.proctorShots.map((s) => ({
      id: s.id,
      reason: s.reason as AssignmentDetail['proctorShots'][number]['reason'],
      note: s.note,
      capturedAt: s.capturedAt.toISOString(),
    })),
  };
}

/** Returns a stored assessment proctoring snapshot's bytes, sector-scoped to the viewer. */
export async function getAssignmentProctorShot(
  assignmentId: string,
  shotId: string,
  ctx: InterviewContext,
): Promise<{ mimeType: string; data: Buffer }> {
  const a = await prisma.assessmentAssignment.findFirst({
    where: { id: assignmentId, ...(await assignmentScope(ctx)) },
    select: { id: true },
  });
  if (!a) throw new NotFoundError('Assignment not found');
  const shot = await prisma.assessmentProctorShot.findFirst({
    where: { id: shotId, assignmentId },
    select: { mimeType: true, imageData: true },
  });
  if (!shot) throw new NotFoundError('Snapshot not found');
  return { mimeType: shot.mimeType, data: Buffer.from(shot.imageData) };
}

export async function cancelAssignment(id: string, ctx: InterviewContext, req: Request) {
  const a = await prisma.assessmentAssignment.findFirst({ where: { id, ...(await assignmentScope(ctx)) }, select: { id: true, status: true } });
  if (!a) throw new NotFoundError('Assignment not found');
  if (['SUBMITTED', 'EVALUATING', 'EVALUATED'].includes(a.status)) {
    throw new BadRequestError('This assessment has already been submitted');
  }
  await prisma.assessmentAssignment.update({ where: { id }, data: { status: 'CANCELLED' } });
  await recordAudit(req, { action: 'CANCEL', entity: 'AssessmentAssignment', entityId: id, description: `Cancelled assignment ${id}` });
  return { cancelled: true };
}

// ─── RESULT EMAILS ────────────────────────────────────────────────────────────

interface AssignmentWithCandidate {
  id: string;
  status: string;
  passed: boolean | null;
  percentageScore: number | null;
  totalScore: number | null;
  maxScore: number | null;
  candidateId: string;
  assessment: { title: string; passingScore: number } | null;
}

async function resolveAssignmentForEmail(
  id: string,
  ctx: InterviewContext,
): Promise<AssignmentWithCandidate> {
  const a = await prisma.assessmentAssignment.findFirst({
    where: { id, ...(await assignmentScope(ctx)) },
    select: {
      id: true, status: true, passed: true, percentageScore: true,
      totalScore: true, maxScore: true, candidateId: true,
      assessment: { select: { title: true, passingScore: true } },
    },
  });
  if (!a) throw new NotFoundError('Assignment not found');
  if (a.status !== 'EVALUATED') {
    throw new BadRequestError('Assessment result emails can only be sent after the assignment has been evaluated');
  }
  if (a.passed === null) {
    throw new BadRequestError('Assessment has not been scored yet');
  }
  return a;
}

export async function sendAssessmentResultEmail(
  id: string,
  data: SendAssessmentResultInput,
  ctx: InterviewContext,
  req: Request,
): Promise<MailResult> {
  // force=true requires ASSESSMENT_MANAGE permission.
  if (data.force && !ctx.permissions.includes(PERMISSIONS.ASSESSMENT_MANAGE)) {
    throw new ForbiddenError('Force re-send requires assessment management permission');
  }

  const a = await resolveAssignmentForEmail(id, ctx);
  const cmap = await candidateMap([a.candidateId]);
  const candidate = cmap.get(a.candidateId);
  if (!candidate?.email) {
    throw new BadRequestError('This candidate has no email address on file');
  }

  const templateId = a.passed ? RESULT_EMAIL_TEMPLATE_PASS : RESULT_EMAIL_TEMPLATE_FAIL;
  const mail = await assessmentResultEmail({
    candidateName: candidate.fullName,
    assessmentTitle: a.assessment?.title ?? 'Skill Assessment',
    percentageScore: a.percentageScore ?? 0,
    totalScore: a.totalScore,
    maxScore: a.maxScore,
    passed: a.passed!,
    passingScore: a.assessment?.passingScore ?? 60,
    nextSteps: data.nextSteps || null,
  });

  const result = await sendMailOnce(
    { to: candidate.email, subject: mail.subject, html: mail.html, templateId, entityType: 'AssessmentAssignment', entityId: id },
    data.force,
  );

  if (result.sent) {
    await recordAudit(req, {
      action: 'EMAIL',
      entity: 'AssessmentAssignment',
      entityId: id,
      description: `Sent assessment result email (${a.passed ? 'PASS' : 'FAIL'}) to ${candidate.email}`,
    });
  }

  return result;
}

export async function bulkSendAssessmentResultEmail(
  data: BulkSendAssessmentResultInput,
  ctx: InterviewContext,
  req: Request,
): Promise<{ sent: number; skipped: number; failed: number; errors: string[] }> {
  if (data.force && !ctx.permissions.includes(PERMISSIONS.ASSESSMENT_MANAGE)) {
    throw new ForbiddenError('Force re-send requires assessment management permission');
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const assignmentId of data.assignmentIds) {
    try {
      const result = await sendAssessmentResultEmail(assignmentId, { nextSteps: '', force: data.force }, ctx, req);
      if (result.sent) sent++;
      else if (result.skipped) skipped++;
      else { failed++; if (result.error) errors.push(`${assignmentId}: ${result.error}`); }
    } catch (err) {
      failed++;
      errors.push(`${assignmentId}: ${(err as Error).message}`);
    }
  }

  return { sent, skipped, failed, errors };
}
