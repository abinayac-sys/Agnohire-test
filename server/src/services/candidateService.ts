import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../config/database.js';
import { requireTenantId } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { configService } from './configService.js';
import { dispatchFitScore, dispatchResumeParse } from '../jobs/dispatch.js';
import { scoreApplication } from './fitScoreService.js';
import { autoAdvanceReferralFirstRound } from './workflowProgressionService.js';
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from '../utils/errors.js';
import { ALLOWED_RESUME_TYPES } from '../utils/storage.js';
import { fetchRemoteResume } from '../utils/remoteFile.js';
import { paginate } from '../utils/response.js';
import { isRecruiterScoped, assignedCandidateWhere } from '../utils/accessScope.js';
import {
  CONFIG_KEYS,
  ROLES,
  type CreateCandidateInput,
  type UpdateCandidateInput,
  type CandidateFilters,
  type CreateApplicationInput,
  type UpdateApplicationInput,
  type ApplicationFilters,
  type CandidateSearchFilters,
} from '@agnohire/shared';
import type { Request } from 'express';

export interface CandidateContext {
  userId: string;
  role: string;
  sectorId?: string | null;
  permissions: string[];
}

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

function sectorScope(ctx: CandidateContext): Prisma.CandidateWhereInput {
  if (isSuperOrAdmin(ctx.role)) return {};
  // Recruiters only ever see candidates allocated to them by a higher role.
  if (isRecruiterScoped(ctx.role)) return assignedCandidateWhere(ctx.userId);
  // HR / hiring managers see their whole sector (they do the allocating).
  if (configService.crossSectorVisibilityEnabled()) return {};
  if (ctx.sectorId) return { sectorId: ctx.sectorId };
  return {};
}

const CANDIDATE_LIST_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  experienceLevel: true,
  currentRole: true,
  location: true,
  skills: true,
  source: true,
  fitScore: true,
  avatarUrl: true,
  consentGiven: true,
  createdAt: true,
  updatedAt: true,
  jobRequisition: { select: { id: true, title: true } },
  sector: { select: { id: true, name: true } },
  domain: { select: { id: true, name: true } },
  _count: { select: { applications: true } },
  resumes: {
    where: { deletedAt: null },
    select: { id: true, fileName: true, parseStatus: true },
    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'desc' as const }],
  },
  // Application fit scores back the candidate-level fit fallback below.
  applications: { where: { deletedAt: null }, select: { fitScore: true } },
} satisfies Prisma.CandidateSelect;

type CandidateListRow = Prisma.CandidateGetPayload<{ select: typeof CANDIDATE_LIST_SELECT }>;

/**
 * Shapes a list row for the API: candidate.fitScore falls back to the best
 * application fit score (scoring writes to JobApplication first), and the
 * single fetched resume becomes `primaryResume`.
 */
function toListItem(row: CandidateListRow) {
  const { resumes, applications, _count, ...rest } = row;
  const appBest = applications.reduce<number | null>(
    (best, a) => (a.fitScore != null && (best == null || a.fitScore > best) ? a.fitScore : best),
    null,
  );
  return {
    ...rest,
    fitScore: rest.fitScore ?? appBest,
    primaryResume: resumes[0] ?? null,
    _count: {
      ..._count,
      resumes: resumes.length,
    },
  };
}

const RESUME_SELECT = {
  id: true,
  fileName: true,
  fileSize: true,
  mimeType: true,
  isPrimary: true,
  parseStatus: true,
  parseError: true,
  parsedData: true,
  parsedAt: true,
  createdAt: true,
} satisfies Prisma.ResumeSelect;

const APPLICATION_LIST_SELECT = {
  id: true,
  status: true,
  stage: true,
  fitScore: true,
  fitScoreData: true,
  notes: true,
  currentRound: true,
  completedRounds: true,
  failedRound: true,
  workflowStatus: true,
  appliedAt: true,
  updatedAt: true,
  candidate: {
    select: {
      id: true,
      fullName: true,
      email: true,
      currentRole: true,
      avatarUrl: true,
      skills: true,
    },
  },
  job: {
    select: {
      id: true,
      title: true,
      domain: { select: { id: true, name: true } },
      workflowRounds: {
        select: {
          id: true,
          roundNumber: true,
          roundName: true,
        },
      },
    },
  },
} satisfies Prisma.JobApplicationSelect;

// ─── STATS ─────────────────────────────────────────────────────────────────

export async function getCandidateStats(filters: { jobRequisitionId?: string } = {}, ctx: CandidateContext) {
  const scope = sectorScope(ctx);
  const baseWhere: Prisma.CandidateWhereInput = {
    ...scope,
    deletedAt: null,
    ...(filters.jobRequisitionId && { jobRequisitionId: filters.jobRequisitionId })
  };
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [total, withResume, scored, newThisWeek] = await Promise.all([
    prisma.candidate.count({ where: baseWhere }),
    prisma.candidate.count({ where: { ...baseWhere, resumes: { some: { deletedAt: null } } } }),
    prisma.candidate.count({ where: { ...baseWhere, fitScore: { not: null } } }),
    prisma.candidate.count({ where: { ...baseWhere, createdAt: { gte: weekAgo } } }),
  ]);
  return { total, withResume, scored, newThisWeek };
}

// ─── LIST ──────────────────────────────────────────────────────────────────

export async function listCandidates(filters: CandidateFilters, ctx: CandidateContext) {
  const {
    page,
    limit,
    search,
    sectorId,
    domainId,
    source,
    experienceLevel,
    skill,
    hasResume,
    jobRequisitionId,
    sortBy,
    sortOrder,
    from,
    to,
  } = filters;

  // Combine the sector scope and the search under AND so neither top-level
  // `OR` clobbers the other (a duplicate `OR` key would silently drop scope).
  const and: Prisma.CandidateWhereInput[] = [sectorScope(ctx), { deletedAt: null }];
  if (search) {
    and.push({
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { currentRole: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  if (jobRequisitionId) {
    and.push({
      OR: [
        { jobRequisitionId },
        { applications: { some: { jobRequisitionId } } },
      ],
    });
  }

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

  const where: Prisma.CandidateWhereInput = {
    ...(domainId && { domainId }),
    ...(sectorId && isSuperOrAdmin(ctx.role) && { sectorId }),
    ...(source && { source }),
    ...(experienceLevel && { experienceLevel }),
    ...(skill && { skills: { has: skill } }),
    ...(hasResume !== undefined &&
      (hasResume ? { resumes: { some: { deletedAt: null } } } : { resumes: { none: { deletedAt: null } } })),
    ...((from || to) && { createdAt: dateFilter }),
    AND: and,
  };

  const [total, items] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({
      where,
      select: CANDIDATE_LIST_SELECT,
      orderBy:
        sortBy === 'fitScore'
          ? { fitScore: { sort: sortOrder, nulls: 'last' } }
          : { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return paginate(items.map(toListItem), total, page, limit);
}

// ─── ADVANCED TALENT SEARCH ───────────────────────────────────────────────────

export async function searchCandidates(
  filters: CandidateSearchFilters,
  ctx: CandidateContext,
) {
  const {
    page,
    limit,
    q,
    skillsAll,
    skillsAny,
    experienceLevel,
    source,
    sectorId,
    domainId,
    hasResume,
    unassignedOnly,
    minFitScore,
    sortBy,
    sortOrder,
  } = filters;

  // Start the AND chain with the sector scope so its `OR` is never clobbered
  // by the free-text search `OR` below.
  const and: Prisma.CandidateWhereInput[] = [sectorScope(ctx), { deletedAt: null }];
  // Skill matching is case-insensitive ("python" must match a stored "Python").
  // Prisma array filters are case-sensitive, so resolve matching ids via SQL.
  if (skillsAll.length || skillsAny.length) {
    const all = skillsAll.map((s) => s.toLowerCase());
    const any = skillsAny.map((s) => s.toLowerCase());
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM "Candidate" c
      WHERE c."deletedAt" IS NULL
        AND (${all.length} = 0 OR (
          SELECT count(DISTINCT lower(s)) FROM unnest(c.skills) AS s
          WHERE lower(s) = ANY(${all})
        ) = ${all.length})
        AND (${any.length} = 0 OR EXISTS (
          SELECT 1 FROM unnest(c.skills) AS s WHERE lower(s) = ANY(${any})
        ))`;
    and.push({ id: { in: rows.map((r) => r.id) } });
  }
  if (q) {
    and.push({
      OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { currentRole: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (filters.jobRequisitionId) {
    and.push({
      OR: [
        { jobRequisitionId: filters.jobRequisitionId },
        { applications: { some: { jobRequisitionId: filters.jobRequisitionId } } },
      ],
    });
  }

  const where: Prisma.CandidateWhereInput = {
    ...(sectorId && isSuperOrAdmin(ctx.role) && { sectorId }),
    ...(domainId && { domainId }),
    ...(experienceLevel && { experienceLevel }),
    ...(source && { source }),
    ...(hasResume !== undefined &&
      (hasResume ? { resumes: { some: { deletedAt: null } } } : { resumes: { none: { deletedAt: null } } })),
    ...(minFitScore !== undefined && { fitScore: { gte: minFitScore } }),
    ...(unassignedOnly && { assignments: { none: { status: 'ASSIGNED' } } }),
    AND: and,
  };

  const orderBy: Prisma.CandidateOrderByWithRelationInput =
    sortBy === 'fitScore'
      ? { fitScore: { sort: sortOrder, nulls: 'last' } }
      : { [sortBy]: sortOrder };

  const [total, items] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({
      where,
      select: CANDIDATE_LIST_SELECT,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return paginate(items.map(toListItem), total, page, limit);
}

// ─── GET ONE ─────────────────────────────────────────────────────────────────

export async function getCandidate(id: string, ctx: CandidateContext) {
  const candidate = await prisma.candidate.findFirst({
    where: { id, deletedAt: null, ...sectorScope(ctx) },
    select: {
      ...CANDIDATE_LIST_SELECT,
      linkedinUrl: true,
      githubUrl: true,
      consentAt: true,
      resumes: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, select: RESUME_SELECT },
      applications: {
        where: { deletedAt: null },
        orderBy: { appliedAt: 'desc' },
        select: APPLICATION_LIST_SELECT,
      },
      assignments: {
        orderBy: { assignedAt: 'desc' },
        select: {
          id: true,
          recruiterId: true,
          assignedById: true,
          status: true,
          assignedAt: true,
        },
      },
    },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');
  // Same fallback as the list: surface the best application fit score when the
  // candidate-level column hasn't been backfilled yet.
  const appBest = candidate.applications.reduce<number | null>(
    (best, a) => (a.fitScore != null && (best == null || a.fitScore > best) ? a.fitScore : best),
    null,
  );
  return { ...candidate, fitScore: candidate.fitScore ?? appBest };
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

function emptyToNull(v?: string | null): string | null {
  return v && v.length ? v : null;
}

export async function createCandidate(
  data: CreateCandidateInput,
  ctx: CandidateContext,
  req: Request,
) {
  if (data.domainId) {
    const domain = await prisma.domain.findFirst({ where: { id: data.domainId } });
    if (!domain) throw new BadRequestError('Domain not found');
    if (data.sectorId && domain.sectorId && domain.sectorId !== data.sectorId) {
      throw new BadRequestError('Domain does not belong to the selected sector');
    }
  }

  // Default a non-admin's candidates into their own sector when unset.
  const sectorId = data.sectorId ?? (isSuperOrAdmin(ctx.role) ? null : ctx.sectorId ?? null);

  try {
    let existingCandidate = await prisma.candidate.findFirst({
      where: { email: data.email.toLowerCase(), deletedAt: null },
    });

    if (!existingCandidate) {
      existingCandidate = await prisma.candidate.findFirst({
        where: { email: data.email.toLowerCase(), deletedAt: { not: null } },
      });
    }

    if (existingCandidate) {
      if (existingCandidate.deletedAt) {
        // Restore soft-deleted candidate and update with new details
        const candidate = await prisma.candidate.update({
          where: { id: existingCandidate.id },
          data: {
            fullName: data.fullName,
            phone: emptyToNull(data.phone),
            experienceLevel: data.experienceLevel ?? null,
            skills: data.skills,
            linkedinUrl: emptyToNull(data.linkedinUrl),
            githubUrl: emptyToNull(data.githubUrl),
            location: emptyToNull(data.location),
            currentRole: emptyToNull(data.currentRole),
            source: data.source ?? 'DIRECT',
            sectorId,
            domainId: data.domainId ?? null,
            jobRequisitionId: data.jobRequisitionId ?? null,
            consentGiven: data.consentGiven ?? false,
            consentAt: data.consentGiven ? new Date() : null,
            deletedAt: null, // restore
          },
          select: CANDIDATE_LIST_SELECT,
        });

        await recordAudit(req, {
          action: 'UPDATE',
          entity: 'Candidate',
          entityId: candidate.id,
          description: `Restored and updated candidate: ${candidate.fullName}`,
          newValue: { email: candidate.email },
        });

        if (!isSuperOrAdmin(ctx.role)) {
          const existingAssignment = await prisma.candidateAssignment.findFirst({
            where: { candidateId: candidate.id, recruiterId: ctx.userId, status: 'ASSIGNED' },
          });
          if (!existingAssignment) {
            await prisma.candidateAssignment.create({
              data: {
                candidateId: candidate.id,
                recruiterId: ctx.userId,
                assignedById: ctx.userId,
                status: 'ASSIGNED',
              },
            });
          }
        }

        return candidate;
      } else {
        throw new ConflictError('A candidate with this email already exists');
      }
    }

    // SaaS quota: only a genuinely new candidate row consumes the plan limit
    // (restore/update of an existing candidate above does not).
    {
      const { getTenantContext } = await import('../config/tenantContext.js');
      const tenantId = getTenantContext()?.tenantId;
      if (tenantId) {
        const { assertWithinLimit } = await import('./entitlementService.js');
        await assertWithinLimit(tenantId, 'CANDIDATES', 1);
      }
    }

    const candidate = await prisma.candidate.create({
      data: {
        fullName: data.fullName,
        email: data.email.toLowerCase(),
        phone: emptyToNull(data.phone),
        experienceLevel: data.experienceLevel ?? null,
        skills: data.skills,
        linkedinUrl: emptyToNull(data.linkedinUrl),
        githubUrl: emptyToNull(data.githubUrl),
        location: emptyToNull(data.location),
        currentRole: emptyToNull(data.currentRole),
        source: data.source ?? 'DIRECT',
        sectorId,
        domainId: data.domainId ?? null,
        jobRequisitionId: data.jobRequisitionId ?? null,
        consentGiven: data.consentGiven ?? false,
        consentAt: data.consentGiven ? new Date() : null,
      },
      select: CANDIDATE_LIST_SELECT,
    });

    if (data.jobRequisitionId) {
      const app = await prisma.jobApplication.create({
        data: {
          candidateId: candidate.id,
          jobRequisitionId: data.jobRequisitionId,
          status: 'APPLIED',
          stage: 'APPLIED',
        },
        select: { id: true },
      });
      // Referred candidates skip the first interview round automatically.
      await autoAdvanceReferralFirstRound(app.id);
    }

    await recordAudit(req, {
      action: 'CREATE',
      entity: 'Candidate',
      entityId: candidate.id,
      description: `Created candidate: ${candidate.fullName}`,
      newValue: { email: candidate.email },
    });

    if (!isSuperOrAdmin(ctx.role)) {
      const existingAssignment = await prisma.candidateAssignment.findFirst({
        where: { candidateId: candidate.id, recruiterId: ctx.userId, status: 'ASSIGNED' },
      });
      if (!existingAssignment) {
        await prisma.candidateAssignment.create({
          data: {
            candidateId: candidate.id,
            recruiterId: ctx.userId,
            assignedById: ctx.userId,
            status: 'ASSIGNED',
          },
        });
      }
    }

    return candidate;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A candidate with this email already exists');
    }
    throw err;
  }
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────

export async function updateCandidate(
  id: string,
  data: UpdateCandidateInput,
  ctx: CandidateContext,
  req: Request,
) {
  const existing = await prisma.candidate.findFirst({
    where: { id, ...sectorScope(ctx) },
  });
  if (!existing) throw new NotFoundError('Candidate not found');

  if (data.domainId) {
    const domain = await prisma.domain.findFirst({ where: { id: data.domainId } });
    if (!domain) throw new BadRequestError('Domain not found');
    const sectorId = data.sectorId ?? existing.sectorId;
    if (sectorId && domain.sectorId && domain.sectorId !== sectorId) {
      throw new BadRequestError('Domain does not belong to the selected sector');
    }
  }

  const consentChanged =
    data.consentGiven !== undefined && data.consentGiven !== existing.consentGiven;

  try {
    const updated = await prisma.candidate.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.email !== undefined && { email: data.email.toLowerCase() }),
        ...(data.phone !== undefined && { phone: emptyToNull(data.phone) }),
        ...(data.experienceLevel !== undefined && {
          experienceLevel: data.experienceLevel ?? null,
        }),
        ...(data.skills !== undefined && { skills: data.skills }),
        ...(data.linkedinUrl !== undefined && { linkedinUrl: emptyToNull(data.linkedinUrl) }),
        ...(data.githubUrl !== undefined && { githubUrl: emptyToNull(data.githubUrl) }),
        ...(data.location !== undefined && { location: emptyToNull(data.location) }),
        ...(data.currentRole !== undefined && { currentRole: emptyToNull(data.currentRole) }),
        ...(data.source !== undefined && { source: data.source ?? null }),
        ...(data.sectorId !== undefined && { sectorId: data.sectorId }),
        ...(data.domainId !== undefined && { domainId: data.domainId }),
        ...(data.jobRequisitionId !== undefined && { jobRequisitionId: data.jobRequisitionId }),
        ...(consentChanged && {
          consentGiven: data.consentGiven,
          consentAt: data.consentGiven ? new Date() : null,
        }),
      },
      select: CANDIDATE_LIST_SELECT,
    });

    if (data.jobRequisitionId !== undefined && data.jobRequisitionId !== null) {
      const existingApp = await prisma.jobApplication.findFirst({
        where: { candidateId: id, jobRequisitionId: data.jobRequisitionId },
        select: { id: true },
      });
      if (!existingApp) {
        const app = await prisma.jobApplication.create({
          data: {
            candidateId: id,
            jobRequisitionId: data.jobRequisitionId,
            status: 'APPLIED',
            stage: 'APPLIED',
          },
          select: { id: true },
        });
        // Referred candidates skip the first interview round automatically.
        await autoAdvanceReferralFirstRound(app.id);
      }
    }

    await recordAudit(req, {
      action: 'UPDATE',
      entity: 'Candidate',
      entityId: id,
      description: `Updated candidate: ${updated.fullName}`,
    });

    return updated;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A candidate with this email already exists');
    }
    throw err;
  }
}

// ─── DELETE (soft) ─────────────────────────────────────────────────────────

/**
 * Core soft-delete: renames the email (frees it up for reuse) and cascades
 * deletedAt/cleanup across dependent rows. Deliberately NOT permission-gated
 * — callers that already established authorization for this candidate through
 * some other path (e.g. deleting the BULK_IMPORT list it belongs to, gated on
 * SOURCING_MANAGE rather than candidate.edit) call this directly instead of
 * re-deriving a permission check that may not hold for their caller.
 */
export async function softDeleteCandidateRecord(id: string, email: string): Promise<void> {
  await tenantTransaction(async (tx) => {
    const emailSuffix = `.deleted-${Date.now()}`;
    const targetEmail = email.includes('.deleted-') ? email : `${email}${emailSuffix}`;

    await tx.candidate.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        email: targetEmail,
      },
    });

    await tx.jobApplication.updateMany({
      where: { candidateId: id },
      data: { deletedAt: new Date() },
    });

    await tx.resume.updateMany({
      where: { candidateId: id },
      data: { deletedAt: new Date() },
    });

    await tx.interview.updateMany({
      where: { candidateId: id },
      data: { deletedAt: new Date() },
    });

    await tx.offer.updateMany({
      where: { candidateId: id },
      data: { deletedAt: new Date() },
    });

    await tx.candidateAssignment.deleteMany({
      where: { candidateId: id },
    });

    await tx.candidateListItem.deleteMany({
      where: { candidateId: id },
    });
  });
}

export async function deleteCandidate(id: string, ctx: CandidateContext, req: Request) {
  let candidate = await prisma.candidate.findFirst({
    where: { id, ...sectorScope(ctx) },
  });
  if (!candidate) {
    const alreadyDeleted = await prisma.candidate.findFirst({
      where: { id, ...sectorScope(ctx), deletedAt: { not: null } },
    });
    if (alreadyDeleted) {
      return;
    }
    throw new NotFoundError('Candidate not found');
  }
  if (!isSuperOrAdmin(ctx.role) && !ctx.permissions.includes('candidate.edit')) {
    throw new ForbiddenError('You do not have permission to delete candidates');
  }
  const { assertAboveMinimum } = await import('./entitlementService.js');
  await assertAboveMinimum(requireTenantId(), 'CANDIDATES', 1);

  await softDeleteCandidateRecord(id, candidate.email);

  await recordAudit(req, {
    action: 'DELETE',
    entity: 'Candidate',
    entityId: id,
    description: `Deleted candidate: ${candidate.fullName}`,
  });
}

// ─── RESUMES ─────────────────────────────────────────────────────────────────

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export async function uploadResume(
  candidateId: string,
  file: UploadedFile | undefined,
  ctx: CandidateContext,
  req: Request,
) {
  if (!file) throw new BadRequestError('No file was uploaded');
  if (!ALLOWED_RESUME_TYPES[file.mimetype]) {
    throw new BadRequestError('Unsupported file type. Upload a PDF, DOCX, TXT, or image file.');
  }

  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, ...sectorScope(ctx) },
    select: { id: true, sectorId: true, tenantId: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  const existingResume = await prisma.resume.findFirst({
    where: { candidateId },
  });
  if (existingResume) {
    throw new BadRequestError('Candidate already has an uploaded resume. Please delete the existing resume first.');
  }

  const maxMb = await configService.getNumber(
    CONFIG_KEYS.RESUME_MAX_SIZE_MB,
    5,
    candidate.sectorId ?? null,
  );
  if (file.size > maxMb * 1024 * 1024) {
    throw new BadRequestError(`File exceeds the ${maxMb} MB limit`);
  }

  const resume = await tenantTransaction(async (tx) => {
    // New upload becomes primary; demote the others.
    await tx.resume.updateMany({
      where: { candidateId },
      data: { isPrimary: false },
    });
    const created = await tx.resume.create({
      data: {
        candidateId,
        fileUrl: '', // set below once the id is known
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        fileData: file.buffer,
        isPrimary: true,
        parseStatus: 'PENDING',
        tenantId: candidate.tenantId,
      },
      select: RESUME_SELECT,
    });
    await tx.resume.update({
      where: { id: created.id },
      data: { fileUrl: `/api/candidates/${candidateId}/resumes/${created.id}/download` },
    });
    return created;
  });

  await recordAudit(req, {
    action: 'UPLOAD',
    entity: 'Resume',
    entityId: resume.id,
    description: `Uploaded resume "${file.originalname}" for candidate ${candidateId}`,
  });

  // Kick off parsing (queued, or inline when Redis is unavailable).
  await dispatchResumeParse(resume.id);

  return resume;
}

/** Attach a resume by fetching it from a public URL (same flow as file upload). */
export async function importResumeFromUrl(
  candidateId: string,
  url: string,
  ctx: CandidateContext,
  req: Request,
) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, ...sectorScope(ctx) },
    select: { id: true, fullName: true, sectorId: true, tenantId: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  const existingResume = await prisma.resume.findFirst({
    where: { candidateId },
  });
  if (existingResume) {
    throw new BadRequestError('Candidate already has an uploaded resume. Please delete the existing resume first.');
  }

  const maxMb = await configService.getNumber(
    CONFIG_KEYS.RESUME_MAX_SIZE_MB,
    5,
    candidate.sectorId ?? null,
  );
  let fetched;
  try {
    fetched = await fetchRemoteResume(url, {
      maxBytes: maxMb * 1024 * 1024,
      fallbackName: candidate.fullName,
    });
  } catch (err) {
    throw new BadRequestError(`Could not fetch the resume: ${(err as Error).message}`);
  }

  const resume = await tenantTransaction(async (tx) => {
    await tx.resume.updateMany({ where: { candidateId }, data: { isPrimary: false } });
    const created = await tx.resume.create({
      data: {
        candidateId,
        fileUrl: '',
        fileName: fetched.fileName,
        fileSize: fetched.size,
        mimeType: fetched.mimeType,
        fileData: fetched.buffer,
        isPrimary: true,
        parseStatus: 'PENDING',
        tenantId: candidate.tenantId,
      },
      select: RESUME_SELECT,
    });
    await tx.resume.update({
      where: { id: created.id },
      data: { fileUrl: `/api/candidates/${candidateId}/resumes/${created.id}/download` },
    });
    return created;
  });

  await recordAudit(req, {
    action: 'UPLOAD',
    entity: 'Resume',
    entityId: resume.id,
    description: `Imported resume from URL for candidate ${candidateId}`,
  });
  await dispatchResumeParse(resume.id);
  return resume;
}

export async function getResumeFile(
  candidateId: string,
  resumeId: string,
  ctx: CandidateContext,
) {
  // Authorize via candidate scope first.
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, ...sectorScope(ctx) },
    select: { id: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  const resume = await prisma.resume.findFirst({
    where: { id: resumeId, candidateId },
    select: { fileName: true, mimeType: true, fileData: true },
  });
  if (!resume || !resume.fileData) throw new NotFoundError('Resume file not found');

  return {
    fileName: resume.fileName,
    mimeType: resume.mimeType,
    buffer: Buffer.from(resume.fileData),
  };
}

export async function reparseResume(
  candidateId: string,
  resumeId: string,
  ctx: CandidateContext,
) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, ...sectorScope(ctx) },
    select: { id: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  const resume = await prisma.resume.findFirst({ where: { id: resumeId, candidateId } });
  if (!resume) throw new NotFoundError('Resume not found');

  await prisma.resume.update({
    where: { id: resumeId },
    data: { parseStatus: 'PENDING', parseError: null },
  });
  await dispatchResumeParse(resumeId);
}

export async function deleteResume(
  candidateId: string,
  resumeId: string,
  ctx: CandidateContext,
  req: Request,
) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, ...sectorScope(ctx) },
    select: { id: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  const resume = await prisma.resume.findFirst({ where: { id: resumeId, candidateId } });
  if (!resume) throw new NotFoundError('Resume not found');

  await prisma.resume.delete({ where: { id: resumeId } });

  // If we removed the primary, promote the most recent remaining one.
  if (resume.isPrimary) {
    const next = await prisma.resume.findFirst({
      where: { candidateId },
      orderBy: { createdAt: 'desc' },
    });
    if (next) {
      await prisma.resume.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
  }

  await recordAudit(req, {
    action: 'DELETE',
    entity: 'Resume',
    entityId: resumeId,
    description: `Deleted resume "${resume.fileName}"`,
  });
}

// ─── APPLICATIONS ───────────────────────────────────────────────────────────

function applicationScope(ctx: CandidateContext): Prisma.JobApplicationWhereInput {
  // Recruiters only see applications for the candidates allocated to them.
  if (isRecruiterScoped(ctx.role)) return { candidate: assignedCandidateWhere(ctx.userId) };
  if (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) return {};
  if (ctx.sectorId) return { job: { sectorId: ctx.sectorId } };
  return {};
}

export async function createApplication(
  data: CreateApplicationInput,
  ctx: CandidateContext,
  req: Request,
) {
  const [candidate, job] = await Promise.all([
    prisma.candidate.findFirst({
      where: { id: data.candidateId, ...sectorScope(ctx) },
      select: { id: true, fullName: true },
    }),
    prisma.jobRequisition.findFirst({
      where: { id: data.jobRequisitionId },
      select: { id: true, title: true, status: true },
    }),
  ]);
  if (!candidate) throw new NotFoundError('Candidate not found');
  if (!job) throw new NotFoundError('Job not found');
  if (job.status !== 'OPEN') {
    throw new BadRequestError('Candidates can only be applied to OPEN jobs');
  }

  const existing = await prisma.jobApplication.findFirst({
    where: { candidateId: data.candidateId, jobRequisitionId: data.jobRequisitionId },
  });
  if (existing) {
    throw new ConflictError('This candidate has already been applied to this job');
  }

  const application = await prisma.jobApplication.create({
    data: {
      candidateId: data.candidateId,
      jobRequisitionId: data.jobRequisitionId,
      status: 'APPLIED',
      stage: 'APPLIED',
      notes: data.notes ?? null,
    },
    select: APPLICATION_LIST_SELECT,
  });

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'JobApplication',
    entityId: application.id,
    description: `Applied ${candidate.fullName} to ${job.title}`,
  });

  // Referred candidates skip the first interview round automatically.
  await autoAdvanceReferralFirstRound(application.id);

  // Auto fit-score if enabled.
  const auto = await configService.getBool(CONFIG_KEYS.FIT_SCORE_AUTO, true);
  if (auto) await dispatchFitScore(application.id);

  return application;
}

export async function listApplications(filters: ApplicationFilters, ctx: CandidateContext) {
  const {
    page,
    limit,
    jobRequisitionId,
    candidateId,
    status,
    stage,
    search,
    minFitScore,
    sortBy,
    sortOrder,
    roundNumber,
  } = filters;

  // Merge (don't overwrite) the scope's candidate filter — for recruiters it
  // carries the assigned-candidate restriction, which a plain `candidate: {…}`
  // key would silently clobber, leaking every candidate onto the Screening page.
  const scope = applicationScope(ctx);
  
  const candidateFilter: Prisma.CandidateWhereInput = {
    ...((scope.candidate as Prisma.CandidateWhereInput | undefined) ?? {}),
    deletedAt: null,
    ...(search && {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  if (roundNumber !== undefined) {
    candidateFilter.interviews = {
      none: {
        roundNumber: roundNumber,
        status: { notIn: ['CANCELLED', 'EXPIRED'] },
        deletedAt: null,
        ...(jobRequisitionId && { jobRequisitionId }),
      },
    };
  }

  const where: Prisma.JobApplicationWhereInput = {
    ...scope,
    candidate: candidateFilter,
    ...(jobRequisitionId && { jobRequisitionId }),
    ...(candidateId && { candidateId }),
    ...(status && { status }),
    ...(stage && { stage }),
    ...(minFitScore !== undefined && { fitScore: { gte: minFitScore } }),
    ...(roundNumber !== undefined && {
      currentRound: roundNumber,
      workflowStatus: 'IN_PROGRESS',
    }),
  };

  // Null fit scores sort last regardless of direction.
  const orderBy: Prisma.JobApplicationOrderByWithRelationInput =
    sortBy === 'fitScore'
      ? { fitScore: { sort: sortOrder, nulls: 'last' } }
      : { [sortBy]: sortOrder };

  const [total, items] = await Promise.all([
    prisma.jobApplication.count({ where }),
    prisma.jobApplication.findMany({
      where,
      select: APPLICATION_LIST_SELECT,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return paginate(items, total, page, limit);
}

/**
 * Each application status maps to the identically-named pipeline stage. When a
 * status is changed (e.g. from the Screening page) we also move the application
 * to the matching stage so the ATS Pipeline board — which groups by `stage` —
 * stays in lockstep. This is the reverse of pipelineService.moveApplication,
 * which keeps `status` in lockstep when a card is dragged on the board.
 */
// The application status enum is broader than the pipeline stages (it also
const STATUS_TO_STAGE: Record<string, string> = {
  APPLIED: 'APPLIED',
  SCREENING: 'SCREENING',
  ASSESSMENT: 'ASSESSMENT',
  INTERVIEW: 'INTERVIEW',
  SCHEDULE: 'SCHEDULE',
  SUBMITTED_TO_HR: 'HR_APPROVAL',
  OFFER: 'OFFER',
  ONBOARDING: 'HIRED',
  HIRED: 'HIRED',
  REJECTED: 'REJECTED',
};

export async function updateApplication(
  id: string,
  data: UpdateApplicationInput,
  ctx: CandidateContext,
  req: Request,
) {
  const existing = await prisma.jobApplication.findFirst({
    where: { id, ...applicationScope(ctx) },
  });
  if (!existing) throw new NotFoundError('Application not found');

  const job = await prisma.jobRequisition.findFirst({
    where: { id: existing.jobRequisitionId },
    select: { id: true, workflowRounds: { orderBy: { sequenceOrder: 'asc' as const } } },
  });
  const configuredRounds = job?.workflowRounds || [];

  let derivedStage = data.stage;
  if (derivedStage === undefined && data.status !== undefined) {
    const targetStage = STATUS_TO_STAGE[data.status];
    if (targetStage) {
      derivedStage = targetStage;
      if (['SCREENING', 'ASSESSMENT', 'INTERVIEW', 'SCHEDULE'].includes(targetStage)) {
        const round = configuredRounds.find(r => {
          const rType = r.roundType.toLowerCase();
          const rName = r.roundName.toLowerCase();
          const statusLower = data.status!.toLowerCase();
          return rType.includes(statusLower) || rName.includes(statusLower);
        });
        if (round) {
          derivedStage = round.roundName;
        }
      }
    }
  }

  const updated = await prisma.jobApplication.update({
    where: { id },
    data: {
      ...(data.status !== undefined && { status: data.status }),
      ...(derivedStage !== undefined && { stage: derivedStage }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
    select: APPLICATION_LIST_SELECT,
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'JobApplication',
    entityId: id,
    description: `Updated application ${id}`,
    oldValue: { status: existing.status, stage: existing.stage },
    newValue: { status: updated.status, stage: updated.stage },
  });

  return updated;
}

/** Scope-check an application and run a synchronous AI fit-score, returning it. */
export async function scoreApplicationForCtx(
  id: string,
  force: boolean,
  ctx: CandidateContext,
) {
  const application = await prisma.jobApplication.findFirst({
    where: { id, ...applicationScope(ctx) },
    select: { id: true, fitScore: true },
  });
  if (!application) throw new NotFoundError('Application not found');
  if (application.fitScore != null && !force) {
    throw new BadRequestError('Application is already scored. Use force to re-score.');
  }
  return scoreApplication(id);
}

export async function deleteApplication(
  id: string,
  ctx: CandidateContext,
  req: Request,
) {
  const application = await prisma.jobApplication.findFirst({
    where: { id, ...applicationScope(ctx) },
    select: {
      id: true,
      candidateId: true,
      jobRequisitionId: true,
      candidate: { select: { fullName: true } },
    },
  });
  if (!application) throw new NotFoundError('Application not found');

  const { candidateId, jobRequisitionId } = application;

  // Collect interview IDs for this candidate × job so we can delete children first
  const interviews = await prisma.interview.findMany({
    where: { candidateId, jobRequisitionId },
    select: { id: true },
  });
  const interviewIds = interviews.map((i) => i.id);

  await tenantTransaction(async (tx) => {
    // ── Interview children (must go before Interview) ──────────────────────
    if (interviewIds.length > 0) {
      await tx.candidateAnswer.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await tx.interviewQuestion.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await tx.interviewFeedback.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await tx.interviewResult.deleteMany({ where: { interviewId: { in: interviewIds } } });
      await tx.panelMember.deleteMany({ where: { interviewId: { in: interviewIds } } });
      // ProctorShot & BiometricReport have onDelete:Cascade in schema — auto-removed
      await tx.interview.deleteMany({ where: { id: { in: interviewIds } } });
    }

    // ── Offer children then Offers ─────────────────────────────────────────
    const offers = await tx.offer.findMany({
      where: { applicationId: id },
      select: { id: true },
    });
    const offerIds = offers.map((o) => o.id);
    if (offerIds.length > 0) {
      await tx.onboarding.deleteMany({ where: { offerId: { in: offerIds } } });
      await tx.offerDocument.deleteMany({ where: { offerId: { in: offerIds } } });
      await tx.offer.deleteMany({ where: { id: { in: offerIds } } });
    }

    // ── Pipeline notes then Application ───────────────────────────────────
    await tx.pipelineNote.deleteMany({ where: { applicationId: id } });
    await tx.jobApplication.delete({ where: { id } });
  });

  await recordAudit(req, {
    action: 'DELETE',
    entity: 'JobApplication',
    entityId: id,
    description: `Deleted application (and related interviews/offers) for ${application.candidate.fullName} on job ${jobRequisitionId}`,
  });
}


// ─── ASSIGNMENT ─────────────────────────────────────────────────────────────

export async function assignCandidate(
  candidateId: string,
  recruiterId: string,
  ctx: CandidateContext,
  req: Request,
) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, ...sectorScope(ctx) },
    select: { id: true, fullName: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  const recruiter = await prisma.user.findFirst({
    where: { id: recruiterId, isActive: true },
    select: { id: true, fullName: true },
  });
  if (!recruiter) throw new BadRequestError('Selected recruiter not found or inactive');

  const assignment = await tenantTransaction(async (tx) => {
    // Mark prior active assignments as reassigned; latest one is current.
    await tx.candidateAssignment.updateMany({
      where: { candidateId, status: 'ASSIGNED' },
      data: { status: 'REASSIGNED' },
    });
    return tx.candidateAssignment.create({
      data: {
        candidateId,
        recruiterId,
        assignedById: ctx.userId,
        status: 'ASSIGNED',
      },
      select: {
        id: true,
        recruiterId: true,
        assignedById: true,
        status: true,
        assignedAt: true,
      },
    });
  });

  await recordAudit(req, {
    action: 'ASSIGN',
    entity: 'Candidate',
    entityId: candidateId,
    description: `Assigned ${candidate.fullName} to ${recruiter.fullName}`,
    newValue: { recruiterId },
  });

  return assignment;
}

export async function unassignCandidate(
  candidateId: string,
  ctx: CandidateContext,
  req: Request,
) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, ...sectorScope(ctx) },
    select: { id: true, fullName: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  await prisma.candidateAssignment.updateMany({
    where: { candidateId, status: 'ASSIGNED' },
    data: { status: 'UNASSIGNED' },
  });

  await recordAudit(req, {
    action: 'UNASSIGN',
    entity: 'Candidate',
    entityId: candidateId,
    description: `Unassigned ${candidate.fullName}`,
  });
}

import ExcelJS from 'exceljs';

export async function generateCandidatesExcel(filters: CandidateFilters, ctx: CandidateContext): Promise<{ buffer: Buffer, filename: string }> {
  const exportFilters = { ...filters, page: 1, limit: 10000 };
  const result = await listCandidates(exportFilters, ctx);
  
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Candidates');

  worksheet.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 20 },
    { header: 'Source', key: 'source', width: 15 },
    { header: 'Experience Level', key: 'experience', width: 20 },
    { header: 'Current Role', key: 'role', width: 25 },
    { header: 'Fit Score', key: 'fitScore', width: 15 },
    { header: 'Added', key: 'added', width: 25 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF007AFF' },
  };

  result.items.forEach(c => {
    worksheet.addRow({
      name: c.fullName || '',
      email: c.email || '',
      phone: c.phone || '',
      source: c.source || '',
      experience: c.experienceLevel || '',
      role: c.currentRole || '',
      fitScore: c.fitScore !== null ? `${c.fitScore}%` : 'N/A',
      added: c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
    });
  });
  
  const buffer = await workbook.xlsx.writeBuffer();
    
  return {
    buffer: Buffer.from(buffer),
    filename: `Candidates_Export_${new Date().toISOString().split('T')[0]}.xlsx`
  };
}
