import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../config/database.js';
import { requireTenantId } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { dispatchBulkUpload } from '../jobs/dispatch.js';
import type { CsvRow } from './bulkUploadService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import { ROLES, type CandidateListFilters } from '@agnohire/shared';
import type { Request } from 'express';
import type { CandidateContext } from './candidateService.js';
import { isRecruiterScoped, assignedCandidateWhere } from '../utils/accessScope.js';
import { autoAdvanceReferralFirstRound } from './workflowProgressionService.js';
import { logger } from '../config/logger.js';

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

function sectorScope(ctx: CandidateContext): Prisma.CandidateListWhereInput {
  if (isSuperOrAdmin(ctx.role)) return {};
  if (ctx.sectorId) return { OR: [{ sectorId: ctx.sectorId }, { sectorId: null }] };
  return {};
}

/**
 * Guard a bulk import targeting a specific job: the job must exist and be in the
 * caller's sector (admins/superadmins are unscoped). Throws before any rows are
 * processed so a stale/cross-sector job id can't silently fail in the worker or
 * attach candidates to another sector's pipeline. No-op when no job is targeted.
 */
export async function assertJobAccessible(
  jobRequisitionId: string | null | undefined,
  ctx: CandidateContext,
): Promise<void> {
  if (!jobRequisitionId) return;
  const job = await prisma.jobRequisition.findFirst({
    where: { id: jobRequisitionId },
    select: { id: true, sectorId: true },
  });
  // Fail closed without leaking existence across sectors.
  const accessible =
    job && (isSuperOrAdmin(ctx.role) || !job.sectorId || !ctx.sectorId || job.sectorId === ctx.sectorId);
  if (!accessible) throw new NotFoundError('Selected job was not found');
}

const LIST_SELECT = {
  id: true,
  name: true,
  status: true,
  totalCount: true,
  validCount: true,
  errorCount: true,
  linkedCount: true,
  uploadedById: true,
  sectorId: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CandidateListSelect;

export async function createBulkList(
  name: string,
  rows: CsvRow[],
  ctx: CandidateContext,
  req: Request,
  jobRequisitionId?: string | null,
  assignedTo?: string | null,
) {
  if (rows.length === 0) throw new BadRequestError('The uploaded file has no data rows');
  if (rows.length > 5000) throw new BadRequestError('A single upload is limited to 5000 rows');

  const sectorId = isSuperOrAdmin(ctx.role) ? null : ctx.sectorId ?? null;
  const tenantId = requireTenantId();

  const existingList = await prisma.candidateList.findFirst({
    where: {
      name: name.trim(),
      deletedAt: null,
      tenantId,
    },
    select: { id: true },
  });
  if (existingList) {
    throw new BadRequestError('A candidate list with this name already exists.');
  }

  const list = await prisma.candidateList.create({
    data: {
      name: name.trim(),
      uploadedById: ctx.userId,
      sectorId,
      assignedTo,
      tenantId,
      totalCount: rows.length,
      status: 'PROCESSING',
      source: 'BULK_IMPORT',
    },
    select: LIST_SELECT,
  });

  await recordAudit(req, {
    action: 'UPLOAD',
    entity: 'CandidateList',
    entityId: list.id,
    description: `Bulk upload "${name}" — ${rows.length} rows`,
  });

  await dispatchBulkUpload(list.id, rows, jobRequisitionId);

  return list;
}

export async function createSmartBulkList(
  name: string,
  candidates: any[],
  ctx: CandidateContext,
  req: Request,
  jobRequisitionId?: string | null,
  assignedTo?: string | null,
) {
  if (candidates.length === 0) throw new BadRequestError('No candidates selected for import');
  if (candidates.length > 5000) throw new BadRequestError('A single upload is limited to 5000 candidates');

  const sectorId = isSuperOrAdmin(ctx.role) ? null : ctx.sectorId ?? null;
  const tenantId = requireTenantId();

  const existingList = await prisma.candidateList.findFirst({
    where: {
      name: name.trim(),
      deletedAt: null,
      tenantId,
    },
    select: { id: true },
  });
  if (existingList) {
    throw new BadRequestError('A candidate list with this name already exists.');
  }

  const list = await prisma.candidateList.create({
    data: {
      name: name.trim(),
      uploadedById: ctx.userId,
      sectorId,
      assignedTo,
      tenantId,
      totalCount: candidates.length,
      status: 'PROCESSING',
      source: 'BULK_IMPORT',
    },
    select: LIST_SELECT,
  });

  await recordAudit(req, {
    action: 'UPLOAD',
    entity: 'CandidateList',
    entityId: list.id,
    description: `Smart bulk upload "${name}" — ${candidates.length} candidates`,
  });

  const { processSmartBulkUpload } = await import('./bulkUploadService.js');
  void processSmartBulkUpload(list.id, candidates, jobRequisitionId).catch(async (err) => {
     logger.error('Smart bulk upload failed', { listId: list.id, err: (err as Error).message });
     try {
       await prisma.candidateList.update({
         where: { id: list.id },
         data: { status: 'ERROR', errorCount: candidates.length, errorReport: { message: 'Internal Server Error' } },
       });
     } catch (e) {
       logger.error('Failed to update candidate list status to ERROR', { listId: list.id, err: (e as Error).message });
     }
  });

  return list;
}

export async function listCandidateLists(filters: CandidateListFilters, ctx: CandidateContext) {
  const { page, limit, status, sortBy, sortOrder } = filters;
  const where: Prisma.CandidateListWhereInput = {
    deletedAt: null,
    ...sectorScope(ctx),
    ...(status && { status }),
  };
  const [total, items] = await Promise.all([
    prisma.candidateList.count({ where }),
    prisma.candidateList.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return paginate(items, total, page, limit);
}

export async function getCandidateList(listId: string, ctx: CandidateContext) {
  const list = await prisma.candidateList.findFirst({
    where: { id: listId, deletedAt: null, ...sectorScope(ctx) },
    select: { ...LIST_SELECT, errorReport: true, linkedReport: true },
  });
  if (!list) throw new NotFoundError('Candidate list not found');
  return list;
}

// ─── CURATED LISTS ────────────────────────────────────────────────────────

/** Recompute totalCount/validCount from the actual item count. */
async function recount(listId: string) {
  const count = await prisma.candidateListItem.count({ where: { candidateListId: listId } });
  await prisma.candidateList.update({
    where: { id: listId },
    data: { totalCount: count, validCount: count },
  });
}

export async function createCuratedList(name: string, ctx: CandidateContext, req: Request) {
  const sectorId = isSuperOrAdmin(ctx.role) ? null : ctx.sectorId ?? null;
  const tenantId = requireTenantId();

  const existingList = await prisma.candidateList.findFirst({
    where: {
      name: name.trim(),
      deletedAt: null,
      tenantId,
    },
    select: { id: true },
  });
  if (existingList) {
    throw new BadRequestError('A candidate list with this name already exists.');
  }

  const list = await prisma.candidateList.create({
    data: { name: name.trim(), uploadedById: ctx.userId, sectorId, status: 'COMPLETED', tenantId },
    select: LIST_SELECT,
  });
  await recordAudit(req, {
    action: 'CREATE',
    entity: 'CandidateList',
    entityId: list.id,
    description: `Created curated list "${name}"`,
  });
  return list;
}

async function requireList(listId: string, ctx: CandidateContext) {
  const list = await prisma.candidateList.findFirst({
    where: { id: listId, ...sectorScope(ctx) },
    select: { id: true },
  });
  if (!list) throw new NotFoundError('Candidate list not found');
  return list;
}

export async function addListItems(
  listId: string,
  candidateIds: string[],
  ctx: CandidateContext,
  req: Request,
) {
  await requireList(listId, ctx);
  // Only link candidates that actually exist and are accessible to the user
  const valid = await prisma.candidate.findMany({
    where: {
      id: { in: candidateIds },
      deletedAt: null,
      // Recruiters may only add candidates allocated to them.
      ...(isRecruiterScoped(ctx.role) ? assignedCandidateWhere(ctx.userId) : {}),
    },
    select: { id: true },
  });
  if (valid.length === 0) throw new BadRequestError('No valid candidates to add');

  await prisma.candidateListItem.createMany({
    data: valid.map((c) => ({ candidateListId: listId, candidateId: c.id })),
    skipDuplicates: true,
  });
  await recount(listId);

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'CandidateList',
    entityId: listId,
    description: `Added ${valid.length} candidate(s) to list`,
  });
  return getCandidateList(listId, ctx);
}

export async function removeListItems(
  listId: string,
  candidateIds: string[],
  ctx: CandidateContext,
  req: Request,
) {
  await requireList(listId, ctx);
  await prisma.candidateListItem.deleteMany({
    where: { candidateListId: listId, candidateId: { in: candidateIds } },
  });
  await recount(listId);
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'CandidateList',
    entityId: listId,
    description: `Removed ${candidateIds.length} candidate(s) from list`,
  });
  return getCandidateList(listId, ctx);
}

export async function getListMembers(listId: string, ctx: CandidateContext) {
  await requireList(listId, ctx);
  const items = await prisma.candidateListItem.findMany({
    where: {
      candidateListId: listId,
      candidate: {
        deletedAt: null,
        // Recruiters only see the members allocated to them.
        ...(isRecruiterScoped(ctx.role) ? assignedCandidateWhere(ctx.userId) : {}),
      },
    },
    select: {
      candidate: {
        select: {
          id: true,
          fullName: true,
          email: true,
          currentRole: true,
          skills: true,
          fitScore: true,
        },
      },
    },
  });
  return items.map((i) => i.candidate);
}

export async function assignListToRecruiter(
  listId: string,
  recruiterId: string,
  ctx: CandidateContext,
  req: Request,
) {
  await requireList(listId, ctx);
  const recruiter = await prisma.user.findFirst({
    where: { id: recruiterId, isActive: true },
    select: { id: true, fullName: true },
  });
  if (!recruiter) throw new BadRequestError('Selected recruiter not found or inactive');

  const items = await prisma.candidateListItem.findMany({
    where: { candidateListId: listId },
    select: { candidateId: true },
  });
  if (items.length === 0) throw new BadRequestError('This list has no candidates to assign');

  const candidateIds = items.map((i) => i.candidateId);

  await tenantTransaction(async (tx) => {
    await tx.candidateAssignment.updateMany({
      where: { candidateId: { in: candidateIds }, status: 'ASSIGNED' },
      data: { status: 'REASSIGNED' },
    });
    await tx.candidateAssignment.createMany({
      data: candidateIds.map((candidateId) => ({
        candidateId,
        recruiterId,
        listId,
        assignedById: ctx.userId,
        status: 'ASSIGNED',
      })),
    });
  });

  await recordAudit(req, {
    action: 'ASSIGN',
    entity: 'CandidateList',
    entityId: listId,
    description: `Assigned list (${candidateIds.length} candidates) to ${recruiter.fullName}`,
  });

  return { assigned: candidateIds.length };
}

/**
 * Bulk-apply every candidate in a list to a single job — the list-driven
 * counterpart to applying candidates one at a time. Skips candidates already
 * applied to the job, and lets referred candidates auto-clear the first round
 * via the shared progression helper. HR/admins act list-wide; recruiters are
 * limited to the members allocated to them.
 */
export async function assignJobToList(
  listId: string,
  jobRequisitionId: string,
  ctx: CandidateContext,
  req: Request,
) {
  await requireList(listId, ctx);

  const job = await prisma.jobRequisition.findFirst({
    where: { id: jobRequisitionId },
    select: { id: true, title: true, status: true, sectorId: true },
  });
  // Fail closed without leaking existence across sectors.
  const accessible =
    job && (isSuperOrAdmin(ctx.role) || job.sectorId == null || ctx.sectorId == null || job.sectorId === ctx.sectorId);
  if (!accessible) throw new NotFoundError('Job not found');
  if (job.status !== 'OPEN') {
    throw new BadRequestError('Candidates can only be assigned to OPEN jobs');
  }

  const items = await prisma.candidateListItem.findMany({
    where: {
      candidateListId: listId,
      candidate: {
        deletedAt: null,
        // Recruiters can only assign the members allocated to them.
        ...(isRecruiterScoped(ctx.role) ? assignedCandidateWhere(ctx.userId) : {}),
      },
    },
    select: { candidateId: true },
  });
  if (items.length === 0) throw new BadRequestError('This list has no candidates to assign');

  const candidateIds = items.map((i) => i.candidateId);

  // Skip candidates already applied to this job (no duplicate applications).
  const existing = await prisma.jobApplication.findMany({
    where: { jobRequisitionId, candidateId: { in: candidateIds } },
    select: { candidateId: true },
  });
  const alreadyApplied = new Set(existing.map((e) => e.candidateId));
  const toApply = candidateIds.filter((id) => !alreadyApplied.has(id));

  let applied = 0;
  for (const candidateId of toApply) {
    const app = await prisma.jobApplication.create({
      data: {
        candidateId,
        jobRequisitionId,
        status: 'APPLIED',
        stage: 'APPLIED',
      },
      select: { id: true },
    });
    // Referred candidates skip the first interview round automatically.
    await autoAdvanceReferralFirstRound(app.id);
    applied += 1;
  }

  await recordAudit(req, {
    action: 'ASSIGN',
    entity: 'CandidateList',
    entityId: listId,
    description: `Assigned list (${applied} candidate(s)) to job ${job.title}`,
  });

  return { applied, skipped: alreadyApplied.size };
}

export async function deleteCandidateList(
  listId: string,
  ctx: CandidateContext,
  req: Request,
  cascade: boolean,
) {
  const list = await prisma.candidateList.findFirst({
    where: { id: listId, deletedAt: null, ...sectorScope(ctx) },
    select: { id: true, name: true },
  });
  if (!list) throw new NotFoundError('Candidate list not found');

  // Deleting a list — from either the Sourcing > Lists page or the Bulk
  // Import drawer's "Recent imports" — also permanently removes every
  // candidate it contains, regardless of whether the list itself was
  // created as a curated pointer or via bulk import. Both callers always
  // pass cascade=true; the flag stays so any future non-cascading caller
  // (e.g. a bulk "clean up empty lists" job) can opt out explicitly.
  if (cascade) {
    const items = await prisma.candidateListItem.findMany({
      where: { candidateListId: listId },
      select: { candidate: { select: { id: true, email: true, deletedAt: true } } },
    });
    const liveCandidateCount = items.filter((i) => !i.candidate.deletedAt).length;
    if (liveCandidateCount > 0) {
      const { assertAboveMinimum } = await import('./entitlementService.js');
      await assertAboveMinimum(requireTenantId(), 'CANDIDATES', liveCandidateCount);
    }
    const { softDeleteCandidateRecord } = await import('./candidateService.js');
    for (const { candidate } of items) {
      if (candidate.deletedAt) continue;
      await softDeleteCandidateRecord(candidate.id, candidate.email).catch((err) =>
        logger.error('Failed to delete candidate while deleting list', {
          listId,
          candidateId: candidate.id,
          err: (err as Error).message,
        }),
      );
    }
  }

  await tenantTransaction(async (tx) => {
    await tx.candidateList.update({
      where: { id: listId },
      data: { deletedAt: new Date() },
    });
  });

  await recordAudit(req, {
    action: 'DELETE',
    entity: 'CandidateList',
    entityId: listId,
    description: cascade
      ? `Deleted list "${list.name}" and its candidates`
      : `Deleted candidate list "${list.name}"`,
  });
}
