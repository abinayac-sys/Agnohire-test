import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../config/database.js';
import { requireTenantId, requireOrganizationId, requireWorkspaceId } from '../config/tenantContext.js';
import { chatCompletion } from './aiProviderService.js';
import { recordAudit } from './auditService.js';
import { configService } from './configService.js';
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import {
  ROLES,
  CONFIG_KEYS,
  isScheduleRound,
  type CreateJobInput,
  type UpdateJobInput,
  type JobFilters,
  type GenerateJdInput,
  type CreateJobTemplateInput,
  type UpdateJobTemplateInput,
  type GenerateCompleteRequisitionInput,
  type JobCopilotInput,
  type ReviewRequisitionInput,
} from '@agnohire/shared';
import type { Request } from 'express';

/**
 * If the submitted rounds include a passPercentage, sync the highest one to
 * the system config so the global default stays in step with what's being set
 * on jobs. Failures are swallowed — a config write error must never block a
 * job save.
 */
async function syncPassPercentageConfig(
  rounds: Array<{ passPercentage?: number | null }> | undefined,
  userId: string,
) {
  if (!rounds?.length) return;
  const values = rounds.map((r) => r.passPercentage).filter((v): v is number => v != null);
  if (!values.length) return;
  const max = Math.max(...values);
  try {
    await configService.set(CONFIG_KEYS.INTERVIEW_PASS_SCORE_THRESHOLD, String(max), { updatedById: userId });
  } catch {
    // Non-fatal: config update is best-effort
  }
}

export interface JobContext {
  userId: string;
  role: string;
  sectorId?: string | null;
  permissions: string[];
}

/** Fields returned for a list row. */
const JOB_LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  workMode: true,
  location: true,
  headcount: true,
  filled: true,
  deadline: true,
  aiGeneratedJd: true,
  createdAt: true,
  updatedAt: true,
  domain: { select: { id: true, name: true } },
  sector: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  _count: { select: { applications: true } },
} satisfies Prisma.JobRequisitionSelect;

/** Fields returned for a detail view (includes description + workflows). */
const JOB_DETAIL_SELECT = {
  ...JOB_LIST_SELECT,
  description: true,
  experienceMin: true,
  experienceMax: true,
  budgetMin: true,
  budgetMax: true,
  skills: true,
  approvedAt: true,
  templateId: true,
  workflowRounds: {
    orderBy: { sequenceOrder: 'asc' as const },
    select: {
      id: true,
      roundNumber: true,
      roundName: true,
      roundType: true,
      passPercentage: true,
      sequenceOrder: true,
      isMandatory: true,
      autoProgression: true,
    },
  },
  approvalWorkflows: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      approverId: true,
      status: true,
      comments: true,
      actionedAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.JobRequisitionSelect;

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/** Build the sector scope filter — non-admins are limited to their own sector. */
function sectorScope(ctx: JobContext): Prisma.JobRequisitionWhereInput {
  if (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) return {};
  if (ctx.sectorId) return { sectorId: ctx.sectorId };
  return {};
}

// ─── STATS ───────────────────────────────────────────────────────────────────

export async function getJobStats(ctx: JobContext) {
  const scope = sectorScope(ctx);
  const [total, open, pending, closed] = await Promise.all([
    prisma.jobRequisition.count({ where: scope }),
    prisma.jobRequisition.count({ where: { ...scope, status: 'OPEN' } }),
    prisma.jobRequisition.count({ where: { ...scope, status: 'PENDING_APPROVAL' } }),
    prisma.jobRequisition.count({ where: { ...scope, status: 'CLOSED' } }),
  ]);
  return { total, open, pending, closed };
}

// ─── LIST ────────────────────────────────────────────────────────────────────

export async function listJobs(filters: JobFilters, ctx: JobContext) {
  const {
    page,
    limit,
    search,
    status,
    domainId,
    sectorId,
    workMode,
    sortBy,
    sortOrder,
  } = filters;

  const where: Prisma.JobRequisitionWhereInput = {
    ...sectorScope(ctx),
    ...(status && { status }),
    ...(domainId && { domainId }),
    ...(sectorId && isSuperOrAdmin(ctx.role) && { sectorId }),
    ...(workMode && { workMode }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [total, items] = await Promise.all([
    prisma.jobRequisition.count({ where }),
    prisma.jobRequisition.findMany({
      where,
      select: JOB_LIST_SELECT,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return paginate(items, total, page, limit);
}

// ─── GET ONE ─────────────────────────────────────────────────────────────────

export async function getJob(id: string, ctx: JobContext) {
  const job = await prisma.jobRequisition.findFirst({
    where: { id, ...sectorScope(ctx) },
    select: JOB_DETAIL_SELECT,
  });
  if (!job) throw new NotFoundError('Job not found');
  // Prisma returns Decimal objects for budget*, which res.json() would serialize
  // to strings — convert to numbers so the client gets the money fields as numbers.
  return {
    ...job,
    budgetMin: job.budgetMin == null ? null : Number(job.budgetMin),
    budgetMax: job.budgetMax == null ? null : Number(job.budgetMax),
    // The shared JobDetail type (and the Launch Interview drawer) expect each
    // workflow round to expose `orderIndex`. The column is stored as
    // `sequenceOrder`, so surface it under the expected name — otherwise every
    // round reads `orderIndex === undefined` and the drawer locks them all.
    workflowRounds: job.workflowRounds.map((r) => ({
      ...r,
      orderIndex: r.sequenceOrder,
    })),
  };
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

export async function resolveSectorAndDomain(
  sectorInput?: string | null,
  domainInput?: string | null,
): Promise<{ sectorId: string; domainId: string; organizationId: string; workspaceId: string }> {
  const tenantId = requireTenantId();
  const organizationId = requireOrganizationId();
  const workspaceId = requireWorkspaceId();
  const isUuid = (val?: string | null) => !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

  const SECTOR_SCOPE_SELECT = { id: true, organizationId: true, workspaceId: true } satisfies Prisma.SectorSelect;
  let sector: { id: string; organizationId: string; workspaceId: string } | null = null;
  if (isUuid(sectorInput)) {
    sector = await prisma.sector.findFirst({ where: { id: sectorInput! }, select: SECTOR_SCOPE_SELECT });
  }
  if (!sector && sectorInput) {
    sector = await prisma.sector.findFirst({
      where: { name: { contains: sectorInput, mode: 'insensitive' }, deletedAt: null },
      select: SECTOR_SCOPE_SELECT,
    });
  }
  if (!sector) {
    sector = await prisma.sector.findFirst({
      where: { deletedAt: null },
      select: SECTOR_SCOPE_SELECT,
    });
  }
  if (!sector) {
    sector = await prisma.sector.create({
      data: {
        name: sectorInput || 'Information Technology',
        type: 'general',
        tenantId,
        organizationId,
        workspaceId,
      },
      select: SECTOR_SCOPE_SELECT,
    });
  }

  let domain: { id: string } | null = null;
  if (isUuid(domainInput)) {
    domain = await prisma.domain.findFirst({ where: { id: domainInput!, sectorId: sector.id } });
  }
  if (!domain && domainInput) {
    domain = await prisma.domain.findFirst({
      where: { name: { contains: domainInput, mode: 'insensitive' }, sectorId: sector.id, deletedAt: null },
      select: { id: true },
    });
  }
  if (!domain) {
    domain = await prisma.domain.findFirst({
      where: { sectorId: sector.id, deletedAt: null },
      select: { id: true },
    });
  }
  if (!domain) {
    domain = await prisma.domain.create({
      data: {
        name: domainInput || 'Engineering',
        sectorId: sector.id,
        tenantId,
      },
      select: { id: true },
    });
  }

  return { sectorId: sector.id, domainId: domain.id, organizationId: sector.organizationId, workspaceId: sector.workspaceId };
}

export async function createJob(
  data: CreateJobInput,
  ctx: JobContext,
  req: Request,
) {
  // Validate or auto-resolve sector/domain
  let sectorId = data.sectorId;
  let domainId = data.domainId;

  const resolved = await resolveSectorAndDomain(sectorId, domainId);
  sectorId = resolved.sectorId;
  domainId = resolved.domainId;

  const job = await prisma.jobRequisition.create({
    data: {
      title: data.title,
      description: data.description,
      sectorId,
      domainId,
      createdById: ctx.userId,
      tenantId: requireTenantId(),
      // Read off the resolved Sector rather than re-reading requireOrganizationId()/
      // requireWorkspaceId() independently, so a JobRequisition's scope can never
      // drift from the Sector it was actually filed under.
      organizationId: resolved.organizationId,
      workspaceId: resolved.workspaceId,
      status: 'DRAFT',
      workMode: data.workMode ?? null,
      location: data.location || null,
      experienceMin: data.experienceMin ?? null,
      experienceMax: data.experienceMax ?? null,
      budgetMin: data.budgetMin != null ? new Prisma.Decimal(data.budgetMin) : null,
      budgetMax: data.budgetMax != null ? new Prisma.Decimal(data.budgetMax) : null,
      headcount: data.headcount,
      skills: data.skills,
      deadline: data.deadline ? new Date(data.deadline) : null,
      templateId: data.templateId ?? null,
      aiGeneratedJd: data.aiGeneratedJd ?? false,
      workflowRounds: {
        create: data.workflowRounds?.map((round, i) => ({
          roundNumber: i + 1,
          roundName: round.roundName,
          roundType: round.roundType,
          passPercentage: isScheduleRound(round.roundType, round.roundName) ? null : round.passPercentage,
          sequenceOrder: i + 1,
          isMandatory: round.isMandatory,
          autoProgression: round.autoProgression,
        })),
      },
    },
    select: JOB_DETAIL_SELECT,
  });

  await syncPassPercentageConfig(data.workflowRounds, ctx.userId);

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'JobRequisition',
    entityId: job.id,
    description: `Created job: ${job.title}`,
    newValue: { title: job.title, status: job.status },
  });

  return job;
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────

export async function updateJob(
  id: string,
  data: UpdateJobInput,
  ctx: JobContext,
  req: Request,
) {
  const job = await prisma.jobRequisition.findFirst({
    where: { id, ...sectorScope(ctx) },
  });
  if (!job) throw new NotFoundError('Job not found');

  if (!['DRAFT', 'PENDING_APPROVAL'].includes(job.status)) {
    throw new BadRequestError('Only draft or pending-approval jobs can be edited');
  }

  if (job.createdById !== ctx.userId && !isSuperOrAdmin(ctx.role)) {
    throw new ForbiddenError('Only the job creator or an admin can edit this job');
  }

  // Validate sector/domain consistency only when the caller is actually changing
  // one of them — re-saving a job's existing (already-persisted) sector/domain pair
  // must never fail this check, even if that pair was left inconsistent by an
  // earlier bug (e.g. AI-created jobs before domain lookups were sector-scoped).
  const newSectorId = data.sectorId ?? job.sectorId;
  const newDomainId = data.domainId ?? job.domainId;
  const sectorChanged = data.sectorId !== undefined && data.sectorId !== job.sectorId;
  const domainChanged = data.domainId !== undefined && data.domainId !== job.domainId;
  if (sectorChanged || domainChanged) {
    const domain = await prisma.domain.findFirst({ where: { id: newDomainId } });
    if (!domain) throw new BadRequestError('Domain not found');
    if (domain.sectorId && domain.sectorId !== newSectorId) {
      throw new BadRequestError('Domain does not belong to the selected sector');
    }
  }

  const old = { title: job.title, status: job.status };

  const updated = await prisma.jobRequisition.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.sectorId !== undefined && { sectorId: data.sectorId }),
      ...(data.domainId !== undefined && { domainId: data.domainId }),
      ...(data.workMode !== undefined && { workMode: data.workMode ?? null }),
      ...(data.location !== undefined && { location: data.location || null }),
      ...(data.experienceMin !== undefined && { experienceMin: data.experienceMin ?? null }),
      ...(data.experienceMax !== undefined && { experienceMax: data.experienceMax ?? null }),
      ...(data.budgetMin !== undefined && {
        budgetMin: data.budgetMin != null ? new Prisma.Decimal(data.budgetMin) : null,
      }),
      ...(data.budgetMax !== undefined && {
        budgetMax: data.budgetMax != null ? new Prisma.Decimal(data.budgetMax) : null,
      }),
      ...(data.headcount !== undefined && { headcount: data.headcount }),
      ...(data.skills !== undefined && { skills: data.skills }),
      ...(data.deadline !== undefined && {
        deadline: data.deadline ? new Date(data.deadline) : null,
      }),
      ...(data.aiGeneratedJd !== undefined && { aiGeneratedJd: data.aiGeneratedJd }),
      ...(data.workflowRounds !== undefined && {
        workflowRounds: {
          deleteMany: {},
          create: data.workflowRounds?.map((round, i) => ({
            roundNumber: i + 1,
            roundName: round.roundName,
            roundType: round.roundType,
            passPercentage: isScheduleRound(round.roundType, round.roundName) ? null : round.passPercentage,
            sequenceOrder: i + 1,
            isMandatory: round.isMandatory,
            autoProgression: round.autoProgression,
          })),
        },
      }),
    },
    select: JOB_DETAIL_SELECT,
  });

  if (data.workflowRounds !== undefined) {
    await syncPassPercentageConfig(data.workflowRounds, ctx.userId);
  }

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'JobRequisition',
    entityId: id,
    description: `Updated job: ${updated.title}`,
    oldValue: old,
    newValue: { title: updated.title, status: updated.status },
  });

  return updated;
}

// ─── DELETE (soft) ───────────────────────────────────────────────────────────

export async function deleteJob(id: string, ctx: JobContext, req: Request) {
  const job = await prisma.jobRequisition.findFirst({
    where: { id, ...sectorScope(ctx) },
  });
  if (!job) throw new NotFoundError('Job not found');
  if (job.createdById !== ctx.userId && !isSuperOrAdmin(ctx.role)) {
    throw new ForbiddenError('Only the job creator or an admin can delete this job');
  }

  // Soft-delete the job and all associated entities in a transaction to ensure referential consistency:
  await tenantTransaction(async (tx) => {
    await tx.jobApplication.deleteMany({ where: { jobRequisitionId: id } });
    await tx.interview.deleteMany({ where: { jobRequisitionId: id } });
    await tx.offer.deleteMany({ where: { jobId: id } });
    await tx.assessment.deleteMany({ where: { jobRequisitionId: id } });
    await tx.candidate.updateMany({
      where: { jobRequisitionId: id },
      data: { jobRequisitionId: null }
    });
    await tx.interviewWorkflowRound.deleteMany({ where: { jobRequisitionId: id } });
    await tx.jobRequisition.delete({ where: { id } });
  });

  await recordAudit(req, {
    action: 'DELETE',
    entity: 'JobRequisition',
    entityId: id,
    description: `Deleted job: ${job.title}`,
  });
}

// ─── SUBMIT FOR APPROVAL ─────────────────────────────────────────────────────

export async function submitJob(
  id: string,
  approverId: string,
  ctx: JobContext,
  req: Request,
) {
  const job = await prisma.jobRequisition.findFirst({
    where: { id, ...sectorScope(ctx) },
  });
  if (!job) throw new NotFoundError('Job not found');
  if (job.status !== 'DRAFT') {
    throw new BadRequestError('Only draft jobs can be submitted for approval');
  }
  if (job.createdById !== ctx.userId && !isSuperOrAdmin(ctx.role)) {
    throw new ForbiddenError('Only the job creator can submit it for approval');
  }

  const approver = await prisma.user.findFirst({ where: { id: approverId } });
  if (!approver) throw new NotFoundError('Selected approver not found');

  await tenantTransaction(async (tx) => {
    await tx.jobRequisition.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });
    await tx.approvalWorkflow.create({
      data: { jobRequisitionId: id, approverId, status: 'PENDING' },
    });
  });

  await recordAudit(req, {
    action: 'SUBMIT',
    entity: 'JobRequisition',
    entityId: id,
    description: `Submitted job for approval: ${job.title}`,
    newValue: { approverId },
  });
}

// ─── APPROVE ─────────────────────────────────────────────────────────────────

export async function approveJob(
  id: string,
  ctx: JobContext,
  req: Request,
  comments?: string,
) {
  const job = await prisma.jobRequisition.findFirst({
    where: { id, ...sectorScope(ctx) },
  });
  if (!job) throw new NotFoundError('Job not found');
  if (job.status !== 'PENDING_APPROVAL') {
    throw new BadRequestError('Job is not pending approval');
  }

  // SaaS quota: approving opens the job — block when maxActiveJobs is reached.
  {
    const { getTenantContext } = await import('../config/tenantContext.js');
    const tenantId = getTenantContext()?.tenantId;
    if (tenantId) {
      const { assertWithinLimit } = await import('./entitlementService.js');
      await assertWithinLimit(tenantId, 'ACTIVE_JOBS', 1);
    }
  }

  // Must be the designated approver OR an admin
  const workflow = await prisma.approvalWorkflow.findFirst({
    where: { jobRequisitionId: id, approverId: ctx.userId, status: 'PENDING' },
  });
  if (!workflow && !isSuperOrAdmin(ctx.role)) {
    throw new ForbiddenError('You are not the designated approver for this job');
  }

  await tenantTransaction(async (tx) => {
    await tx.jobRequisition.update({
      where: { id },
      data: {
        status: 'OPEN',
        approvedById: ctx.userId,
        approvedAt: new Date(),
      },
    });
    await tx.approvalWorkflow.updateMany({
      where: { jobRequisitionId: id, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        approverId: ctx.userId,
        comments: comments ?? null,
        actionedAt: new Date(),
      },
    });
  });

  await recordAudit(req, {
    action: 'APPROVE',
    entity: 'JobRequisition',
    entityId: id,
    description: `Approved job: ${job.title}`,
    newValue: { comments },
  });
}

// ─── REJECT ──────────────────────────────────────────────────────────────────

export async function rejectJob(
  id: string,
  comments: string,
  ctx: JobContext,
  req: Request,
) {
  const job = await prisma.jobRequisition.findFirst({
    where: { id, ...sectorScope(ctx) },
  });
  if (!job) throw new NotFoundError('Job not found');
  if (job.status !== 'PENDING_APPROVAL') {
    throw new BadRequestError('Job is not pending approval');
  }

  const workflow = await prisma.approvalWorkflow.findFirst({
    where: { jobRequisitionId: id, approverId: ctx.userId, status: 'PENDING' },
  });
  if (!workflow && !isSuperOrAdmin(ctx.role)) {
    throw new ForbiddenError('You are not the designated approver for this job');
  }

  await tenantTransaction(async (tx) => {
    await tx.jobRequisition.update({
      where: { id },
      data: { status: 'DRAFT' },
    });
    await tx.approvalWorkflow.updateMany({
      where: { jobRequisitionId: id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        approverId: ctx.userId,
        comments,
        actionedAt: new Date(),
      },
    });
  });

  await recordAudit(req, {
    action: 'REJECT',
    entity: 'JobRequisition',
    entityId: id,
    description: `Rejected job: ${job.title}`,
    newValue: { comments },
  });
}

// ─── CLOSE / REOPEN ──────────────────────────────────────────────────────────

export async function closeJob(id: string, ctx: JobContext, req: Request) {
  const job = await prisma.jobRequisition.findFirst({
    where: { id, ...sectorScope(ctx) },
  });
  if (!job) throw new NotFoundError('Job not found');
  if (job.status !== 'OPEN') throw new BadRequestError('Only open jobs can be closed');

  await prisma.jobRequisition.update({
    where: { id },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  await recordAudit(req, {
    action: 'CLOSE',
    entity: 'JobRequisition',
    entityId: id,
    description: `Closed job: ${job.title}`,
  });
}

export async function reopenJob(id: string, ctx: JobContext, req: Request) {
  const job = await prisma.jobRequisition.findFirst({
    where: { id, ...sectorScope(ctx) },
  });
  if (!job) throw new NotFoundError('Job not found');
  if (job.status !== 'CLOSED') throw new BadRequestError('Only closed jobs can be reopened');

  await prisma.jobRequisition.update({
    where: { id },
    data: { status: 'OPEN', closedAt: null },
  });

  await recordAudit(req, {
    action: 'REOPEN',
    entity: 'JobRequisition',
    entityId: id,
    description: `Reopened job: ${job.title}`,
  });
}

// ─── AI JD GENERATION ────────────────────────────────────────────────────────

export async function generateJd(data: GenerateJdInput): Promise<string> {
  const expPart =
    data.experienceMin != null && data.experienceMax != null
      ? `${data.experienceMin}–${data.experienceMax} years`
      : data.experienceMin != null
        ? `${data.experienceMin}+ years`
        : 'Freshers / No prior experience required';

  const budgetPart =
    data.budgetMin != null && data.budgetMax != null
      ? `₹${data.budgetMin.toLocaleString('en-IN')} – ₹${data.budgetMax.toLocaleString('en-IN')} per annum`
      : data.budgetMin != null
        ? `Starting from ₹${data.budgetMin.toLocaleString('en-IN')} per annum`
        : 'Salary undisclosed / Competitive';

  const workflowPart =
    data.workflowRounds && data.workflowRounds.length > 0
      ? data.workflowRounds.map((r, i) => `${i + 1}. ${r.roundName} (${r.roundType})`).join(' \u2192 ')
      : 'Review Application \u2192 Interview \u2192 Decision';

  const prompt = [
    `Write a highly comprehensive, professional, and detailed job description for the following role:`,
    ``,
    `**Job Title:** ${data.title}`,
    `**Domain / Department:** ${data.domain}`,
    `**Experience Range:** ${expPart}`,
    `**Salary Range:** ${budgetPart}`,
    `**Work Environment / Mode:** ${data.workMode ?? 'Not specified'} ${data.location ? `(Location: ${data.location})` : ''}`,
    `**Core Skills Entered:** ${data.skills.join(', ')}`,
    `**Configured Interview Process:** ${workflowPart}`,
    data.additionalContext ? `**Additional Context/Requirements:** ${data.additionalContext}` : null,
    ``,
    `Please structure the job description cleanly with the following 18 sections using Markdown headings (##). Make each section extremely thorough, detailed, and professional (generating up to 5000 words total):`,
    ``,
    `## 1. Job Title`,
    `Reflect the title exactly: "${data.title}"`,
    ``,
    `## 2. Company Overview`,
    `Write a detailed overview of our progressive, tech-first corporate culture and mission.`,
    ``,
    `## 3. About the Role`,
    `Detail the significance of this role within the department and its business impact.`,
    ``,
    `## 4. Key Responsibilities`,
    `A comprehensive list of daily, weekly, and strategic responsibilities (provide 8-12 bullet points).`,
    ``,
    `## 5. Required Skills`,
    `Overview of the skill set needed to succeed.`,
    ``,
    `## 6. Qualifications`,
    `Include education, certifications, and preferred professional backgrounds.`,
    ``,
    `## 7. Experience Requirements`,
    `State exactly the experience: "${expPart}". Detail how this level of experience fits the seniority of the role.`,
    ``,
    `## 8. Salary Information`,
    `Show the exact salary range: "${budgetPart}". Add standard text about compensation terms.`,
    ``,
    `## 9. Who Can Apply`,
    `Describe the ideal profile (e.g. entry-level, experienced professionals, etc.) based on the experience requirement of ${expPart}.`,
    ``,
    `## 10. Technical Skills`,
    `List core technical skills. Include the specified skills: ${data.skills.join(', ')} as well as related modern technologies for a ${data.title} role.`,
    ``,
    `## 11. Preferred Skills`,
    `A detailed list of advanced or highly recommended skills.`,
    ``,
    `## 12. Nice-to-Have Skills`,
    `A list of optional, complementary skills or certifications.`,
    ``,
    `## 13. Benefits`,
    `List compensation benefits (e.g., Health Insurance, Flexible Hours, Learning Budget, Hybrid/Remote Work, Paid Leave, Performance Bonus).`,
    ``,
    `## 14. Career Growth`,
    `Describe the career progression path, mentorship, and advancement opportunities.`,
    ``,
    `## 15. Interview Process`,
    `Explain the interview workflow steps exactly: "${workflowPart}".`,
    ``,
    `## 16. Work Environment`,
    `State the setting: "${data.workMode ?? 'Not specified'}" ${data.location ? `at ${data.location}` : ''}.`,
    ``,
    `## 17. Why Join Us`,
    `Provide a compelling employer value proposition.`,
    ``,
    `## 18. Equal Opportunity Statement`,
    `Include a standard professional non-discrimination statement.`,
    ``,
    `Ensure you write a rich, highly detailed description of each section without using placeholders. Respect maximum output tokens (around 4000 tokens) to deliver a full and complete document.`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const content = await chatCompletion(
    [
      {
        role: 'system',
        content:
          'You are a premier executive recruiter and HR writer. You produce highly detailed, structured, and comprehensive job descriptions.',
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 4000, temperature: 0.7 },
  );
  return content.trim();
}

// ─── APPROVERS ───────────────────────────────────────────────────────────────

export async function listApprovers(sectorId?: string | null) {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(sectorId ? { OR: [{ sectorId }, { sectorId: null }] } : {}),
      role: {
        name: { not: 'CANDIDATE' },
      },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: { select: { name: true, displayName: true } },
    },
    orderBy: { fullName: 'asc' },
  });

  return users.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role.name,
    roleDisplayName: u.role.displayName,
  }));
}

// ─── TEMPLATES ───────────────────────────────────────────────────────────────

export async function listTemplates(domainId?: string, page = 1, limit = 25) {
  const where = { ...(domainId && { domainId }) };
  const [total, items] = await Promise.all([
    prisma.jobTemplate.count({ where }),
    prisma.jobTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return paginate(items, total, page, limit);
}

export async function getTemplate(id: string) {
  const t = await prisma.jobTemplate.findFirst({ where: { id } });
  if (!t) throw new NotFoundError('Template not found');
  return t;
}

export async function createTemplate(
  data: CreateJobTemplateInput,
  req: Request,
) {
  const t = await prisma.jobTemplate.create({
    data: {
      name: data.name,
      sectorId: data.sectorId ?? null,
      domainId: data.domainId ?? null,
      tenantId: requireTenantId(),
      description: data.description ?? null,
      skills: data.skills,
      experienceMin: data.experienceMin ?? null,
      experienceMax: data.experienceMax ?? null,
      workMode: data.workMode ?? null,
      workflowRounds: data.workflowRounds ? (data.workflowRounds as any) : null,
    },
  });
  await recordAudit(req, {
    action: 'CREATE',
    entity: 'JobTemplate',
    entityId: t.id,
    description: `Created job template: ${t.name}`,
  });
  return t;
}

export async function updateTemplate(
  id: string,
  data: UpdateJobTemplateInput,
  req: Request,
) {
  const existing = await prisma.jobTemplate.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError('Template not found');

  const t = await prisma.jobTemplate.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.sectorId !== undefined && { sectorId: data.sectorId ?? null }),
      ...(data.domainId !== undefined && { domainId: data.domainId ?? null }),
      ...(data.description !== undefined && { description: data.description ?? null }),
      ...(data.skills !== undefined && { skills: data.skills }),
      ...(data.experienceMin !== undefined && { experienceMin: data.experienceMin ?? null }),
      ...(data.experienceMax !== undefined && { experienceMax: data.experienceMax ?? null }),
      ...(data.workMode !== undefined && { workMode: data.workMode ?? null }),
      ...(data.workflowRounds !== undefined && { workflowRounds: data.workflowRounds as any }),
    },
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'JobTemplate',
    entityId: id,
    description: `Updated job template: ${t.name}`,
  });
  return t;
}

export async function deleteTemplate(id: string, req: Request) {
  const existing = await prisma.jobTemplate.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError('Template not found');
  await prisma.jobTemplate.delete({ where: { id } });
  await recordAudit(req, {
    action: 'DELETE',
    entity: 'JobTemplate',
    entityId: id,
    description: `Deleted job template: ${existing.name}`,
  });
}

// --- AI COPILOT & REQUISITION ------------------------------------------------

export async function generateCompleteRequisition(data: GenerateCompleteRequisitionInput) {
  const prompt = `You are a Senior HR Director with expertise in recruitment planning.
Based on the following job information, generate a complete recruitment plan.

Job Title: ${data.jobTitle}
Department/Domain: ${data.department || "Not specified"}
Experience Required: ${data.experience || "Not specified"}
Location: ${data.location || "Not specified"}
Employment Type: ${data.employmentType || "Not specified"}
Industry/Sector: ${data.industry || "Not specified"}

Return a structured JSON output matching this schema exactly:
{
  "jobDescription": "Full professional markdown job description text. CRITICAL: This must be very long and highly descriptive (around 1500 words). It MUST include and detail the skills, experience, location, salary, employment type, industry, and all other provided data in the description.",
  "responsibilities": ["Array of 8-12 string responsibilities"],
  "requiredSkills": ["Array of strings"],
  "preferredSkills": ["Array of strings"],
  "qualifications": ["Array of strings (education, certifications, etc)"],
  "salaryRecommendation": { "min": 0, "max": 0, "recommended": 0, "confidence": 0, "basedOn": "string explanation" },
  "interviewWorkflow": [ { "roundName": "string", "roundType": "string (e.g., ASSESSMENT, INTERVIEW)" } ],
  "assessmentRecommendation": { "type": "string", "difficulty": "string", "duration": "string", "passingScore": 0, "topics": ["strings"] },
  "hiringTimeline": { "applicationCollection": "string", "screening": "string", "assessment": "string", "interview": "string", "offer": "string", "estimatedTimeToFill": "string" },
  "recruitmentStrategy": ["Array of strings (e.g., LinkedIn, Campus)"],
  "executiveSummary": "String summary of the hiring plan"
}

IMPORTANT REQUIREMENTS for the JSON output:
1. The "jobDescription" must be around 1500 words and be highly detailed, explicitly incorporating the provided location, experience, industry, and employment type.
2. The "interviewWorkflow" MUST consist of exactly these three rounds in order: 
   - Round 1: "Assessment" (roundType: "ASSESSMENT")
   - Round 2: "Technical Interview" (roundType: "INTERVIEW")
   - Round 3: "Final Discussion" (roundType: "INTERVIEW")
3. The "requiredSkills" MUST be populated with a comprehensive list of at least 10 relevant skills for this job title and industry.

Keep the output professional, concise in non-description fields, and enterprise-ready.`;

  const content = await chatCompletion([
    { role: "system", content: "You are an AI recruitment copilot." },
    { role: "user", content: prompt }
  ], { maxTokens: 4000, temperature: 0.7, json: true });
  
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error("Failed to parse AI output as JSON.");
  }
}

export async function jobCopilot(data: JobCopilotInput) {
  const prompt = `You are an AI Recruitment Copilot helping a recruiter create a job requisition.
You MUST ALWAYS return a structured JSON response.

Current Form Context:
${JSON.stringify(data.context, null, 2)}

Instructions:
1. Act as a conversational assistant.
2. If the user provides info, update the extractedFields.
3. If they ask to generate the full JD, generate it and put it in generatedContent.
4. Identify missingFields if essential fields are missing before generating the full JD.
5. In updatedForm, output any specific keys to update in the UI state immediately.

Return a JSON matching this structure exactly:
{
  "intent": "string (e.g., GATHER_INFO, GENERATE, MODIFY)",
  "extractedFields": { "key": "value" },
  "missingFields": ["array of strings"],
  "generatedContent": "Markdown string if generated, else null",
  "updatedForm": { "key": "new form value" }
}`;

  const messages = [
    { role: "system", content: prompt } as any,
    ...data.messages
  ];

  const content = await chatCompletion(messages, { maxTokens: 4000, temperature: 0.7, json: true });
  
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error("Failed to parse AI output as JSON.");
  }
}

export async function reviewRequisition(data: ReviewRequisitionInput, tenantId: string) {
  let duplicateContext = "No existing jobs found to compare against.";
  if (data.sectorId) {
    const existingJobs = await prisma.jobRequisition.findMany({
      where: { tenantId, sectorId: data.sectorId, status: "OPEN" },
      select: { id: true, title: true, location: true, workMode: true },
      take: 5
    });
    if (existingJobs.length > 0) {
      duplicateContext = "Existing Open Jobs in the same Sector:\n" + 
        existingJobs.map((j: any) => `- ${j.title} (${j.location}, ${j.workMode})`).join("\n");
    }
  }

  const prompt = `You are an expert Recruitment Compliance and Quality Analyst.
Review the following job requisition draft and evaluate its quality.

Job Draft:
Title: ${data.title || "N/A"}
Experience: ${data.experienceMin ?? "0"}-${data.experienceMax ?? "8"} years
Location: ${data.location || "N/A"}
Work Mode: ${data.workMode || "N/A"}
Headcount: ${data.headcount || "N/A"}
Skills: ${data.skills ? data.skills.join(", ") : "N/A"}

Description:
${data.description || "N/A"}

Duplicate Checking Context:
${duplicateContext}

Return a structured JSON output matching this schema exactly:
{
  "qualityScore": number (0-100),
  "missingInformation": ["array of strings identifying missing crucial info"],
  "biasCheck": "string pointing out gender/age/racial bias, or null if none",
  "complianceCheck": "string pointing out labor law issues, or null if compliant",
  "readabilityScore": "string e.g. Grade 10 - Easy to read",
  "duplicateWarning": "string warning if it looks like a duplicate of an existing job, or null if none",
  "suggestions": ["array of actionable suggestions to improve the JD"]
}
`;

  const content = await chatCompletion([
    { role: "system", content: "You are an AI Recruitment Analyst." },
    { role: "user", content: prompt }
  ], { maxTokens: 2000, temperature: 0.2, json: true });

  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error("Failed to parse AI output as JSON.");
  }
}


