import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { recordAudit } from './auditService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import { ROLES } from '@agnohire/shared';
import type {
  CreateReferralInput,
  UpdateReferralInput,
  ReferralFilters,
  ReferralItem,
} from '@agnohire/shared';
import type { Request } from 'express';
import type { CandidateContext } from './candidateService.js';
import { autoAdvanceReferralFirstRound } from './workflowProgressionService.js';

function isSuperOrAdmin(role: string): boolean {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/**
 * Referral has no Prisma relations (plain candidateId/jobId FKs), so we scope by
 * the candidate's sector — mirroring candidate visibility (own sector + shared
 * null-sector). Fail closed for a null-sector non-admin. Same approach as
 * gdprService's request scoping.
 */
async function inScopeCandidateIds(ctx: CandidateContext): Promise<string[]> {
  const rows = await prisma.candidate.findMany({
    where: { OR: [{ sectorId: ctx.sectorId }, { sectorId: null }] },
    select: { id: true },
  });
  return rows.map((c) => c.id);
}

async function referralScope(ctx: CandidateContext): Promise<Prisma.ReferralWhereInput> {
  if (isSuperOrAdmin(ctx.role)) return {};
  if (!ctx.sectorId) return {};
  return { candidateId: { in: await inScopeCandidateIds(ctx) } };
}

/** True if the caller may act on a candidate (own sector, shared, or admin). */
async function candidateInScope(ctx: CandidateContext, candidateId: string): Promise<boolean> {
  if (isSuperOrAdmin(ctx.role)) return true;
  if (!ctx.sectorId) return true;
  const c = await prisma.candidate.findFirst({
    where: { id: candidateId, OR: [{ sectorId: ctx.sectorId }, { sectorId: null }] },
    select: { id: true },
  });
  return Boolean(c);
}

interface RawReferral {
  id: string;
  status: string;
  bonusAmount: Prisma.Decimal | null;
  bonusPaid: boolean;
  createdAt: Date;
  referrerId: string;
  candidateId: string;
  jobId: string | null;
}

/** Attach candidate/job/referrer names (Referral has no Prisma relations). */
async function enrich(rows: RawReferral[]): Promise<ReferralItem[]> {
  const candidateIds = [...new Set(rows.map((r) => r.candidateId))];
  const jobIds = [...new Set(rows.map((r) => r.jobId).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.map((r) => r.referrerId))];

  const [candidates, jobs, users] = await Promise.all([
    prisma.candidate.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, fullName: true, email: true },
    }),
    jobIds.length
      ? prisma.jobRequisition.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    }),
  ]);

  const cMap = new Map(candidates.map((c) => [c.id, c]));
  const jMap = new Map(jobs.map((j) => [j.id, j]));
  const uMap = new Map(users.map((u) => [u.id, u]));

  return rows.map((r) => ({
    id: r.id,
    status: r.status as ReferralItem['status'],
    bonusAmount: r.bonusAmount != null ? r.bonusAmount.toString() : null,
    bonusPaid: r.bonusPaid,
    createdAt: r.createdAt.toISOString(),
    candidate: cMap.get(r.candidateId) ?? null,
    job: r.jobId ? jMap.get(r.jobId) ?? null : null,
    referrer: uMap.get(r.referrerId) ?? null,
  }));
}

export async function createReferral(
  data: CreateReferralInput,
  ctx: CandidateContext,
  req: Request,
) {
  // Sector-scope the candidate lookup so you can't refer a candidate outside
  // your sector (404 rather than 403 to avoid cross-sector enumeration).
  if (!(await candidateInScope(ctx, data.candidateId))) {
    throw new NotFoundError('Candidate not found');
  }
  const candidate = await prisma.candidate.findFirst({
    where: { id: data.candidateId },
    select: { id: true, fullName: true, source: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  if (data.jobId) {
    const job = await prisma.jobRequisition.findFirst({
      where: {
        id: data.jobId,
        ...(isSuperOrAdmin(ctx.role) ? {} : { sectorId: ctx.sectorId ?? '__none__' }),
      },
    });
    if (!job) throw new NotFoundError('Job not found');
  }

  const existing = await prisma.referral.findFirst({
    where: { candidateId: data.candidateId, jobId: data.jobId ?? null },
  });
  if (existing) {
    throw new BadRequestError('This candidate has already been referred for this job');
  }

  const referral = await prisma.referral.create({
    data: {
      referrerId: ctx.userId,
      candidateId: data.candidateId,
      jobId: data.jobId ?? null,
      status: 'PENDING',
      bonusAmount: data.bonusAmount != null ? new Prisma.Decimal(data.bonusAmount) : null,
    },
  });

  // Reflect the referral on the candidate's source if it was unset.
  if (!candidate.source) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { source: 'REFERRAL' },
    });
  }

  // Create JobApplication if it doesn't already exist for this candidate and job
  if (data.jobId) {
    const existingApp = await prisma.jobApplication.findFirst({
      where: {
        candidateId: data.candidateId,
        jobRequisitionId: data.jobId,
        deletedAt: null,
      },
    });
    if (!existingApp) {
      const app = await prisma.jobApplication.create({
        data: {
          candidateId: data.candidateId,
          jobRequisitionId: data.jobId,
          status: 'APPLIED',
          stage: 'APPLIED',
        },
      });
      await autoAdvanceReferralFirstRound(app.id);
    }

    // Set primary job requisition on candidate if not set
    const cand = await prisma.candidate.findFirst({
      where: { id: data.candidateId },
      select: { jobRequisitionId: true },
    });
    if (cand && !cand.jobRequisitionId) {
      await prisma.candidate.update({
        where: { id: data.candidateId },
        data: { jobRequisitionId: data.jobId },
      });
    }
  }

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'Referral',
    entityId: referral.id,
    description: `Referred ${candidate.fullName}`,
  });

  return (await enrich([referral]))[0];
}

/**
 * Auto-create a referral row for every in-scope candidate whose source is
 * REFERRAL but that doesn't have one yet. This makes referral-sourced
 * candidates (e.g. from a bulk import) show up on the Referrals page
 * automatically — no manual "New Referral" step needed. Idempotent.
 */
async function ensureReferralsForSourcedCandidates(ctx: CandidateContext): Promise<void> {
  const where: Prisma.CandidateWhereInput = { source: 'REFERRAL', deletedAt: null };
  if (!isSuperOrAdmin(ctx.role)) {
    if (!ctx.sectorId) return; // fail closed — nothing in scope
    where.OR = [{ sectorId: ctx.sectorId }, { sectorId: null }];
  }

  const sourced = await prisma.candidate.findMany({ where, select: { id: true } });
  if (sourced.length === 0) return;

  const ids = sourced.map((c) => c.id);
  const existing = await prisma.referral.findMany({
    where: { candidateId: { in: ids } },
    select: { candidateId: true },
  });
  const have = new Set(existing.map((e) => e.candidateId));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length === 0) return;

  await prisma.referral.createMany({
    data: missing.map((candidateId) => ({
      candidateId,
      referrerId: ctx.userId,
      jobId: null,
      status: 'PENDING',
    })),
    skipDuplicates: true,
  });
}

/**
 * Map a candidate's application status (where they are in the pipeline /
 * interview workflow) to a referral status. A referral only tracks four
 * coarse states, so we collapse the richer application lifecycle:
 *   - terminal hire          → HIRED
 *   - terminal rejection     → REJECTED
 *   - just applied / sourced → PENDING
 *   - anything in between     → ACCEPTED (candidate is actively progressing)
 */
function applicationStatusToReferralStatus(appStatus: string): ReferralItem['status'] {
  switch (appStatus) {
    case 'HIRED':
    case 'ONBOARDING':
    case 'OFFER_ACCEPTED':
      return 'HIRED';
    case 'REJECTED':
    case 'OFFER_DECLINED':
      return 'REJECTED';
    case 'APPLIED':
      return 'PENDING';
    default:
      // SCREENING, ASSESSMENT, INTERVIEW, SCHEDULE, SUBMITTED_TO_HR,
      // HR_VERIFICATION_PENDING, APPROVED, OFFER, OFFER_SENT, …
      return 'ACCEPTED';
  }
}

/**
 * Auto-advance referral statuses to reflect each candidate's real progress
 * through the interview pipeline. A referral with a jobId tracks that specific
 * application; a job-less referral tracks the candidate's most-recently-updated
 * application. Idempotent — only writes when the derived status differs.
 */
async function syncReferralStatuses(ctx: CandidateContext): Promise<void> {
  const referrals = await prisma.referral.findMany({
    where: await referralScope(ctx),
    select: { id: true, candidateId: true, jobId: true, status: true },
  });
  if (referrals.length === 0) return;

  const candidateIds = [...new Set(referrals.map((r) => r.candidateId))];
  const apps = await prisma.jobApplication.findMany({
    where: { candidateId: { in: candidateIds }, deletedAt: null },
    select: { candidateId: true, jobRequisitionId: true, status: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });

  // Latest application per candidate, plus a precise candidate+job lookup.
  const latestByCandidate = new Map<string, string>(); // candidateId → status
  const byCandidateJob = new Map<string, string>(); // `${candidateId}:${jobId}` → status
  for (const a of apps) {
    if (!latestByCandidate.has(a.candidateId)) latestByCandidate.set(a.candidateId, a.status);
    const key = `${a.candidateId}:${a.jobRequisitionId}`;
    if (!byCandidateJob.has(key)) byCandidateJob.set(key, a.status);
  }

  // Group referrals that need an update by their new status for batched writes.
  const updates = new Map<ReferralItem['status'], string[]>();
  for (const r of referrals) {
    const appStatus = r.jobId
      ? byCandidateJob.get(`${r.candidateId}:${r.jobId}`)
      : latestByCandidate.get(r.candidateId);
    if (!appStatus) continue; // no application yet — leave as-is (PENDING)
    const derived = applicationStatusToReferralStatus(appStatus);
    if (derived === r.status) continue;
    const list = updates.get(derived) ?? [];
    list.push(r.id);
    updates.set(derived, list);
  }

  await Promise.all(
    [...updates.entries()].map(([status, ids]) =>
      prisma.referral.updateMany({ where: { id: { in: ids } }, data: { status } }),
    ),
  );
}

async function ensureApplicationsForReferrals(ctx: CandidateContext): Promise<void> {
  const referrals = await prisma.referral.findMany({
    where: {
      jobId: { not: null },
      ...(await referralScope(ctx)),
    },
    select: { candidateId: true, jobId: true },
  });

  for (const r of referrals) {
    if (!r.jobId) continue;
    const existingApp = await prisma.jobApplication.findFirst({
      where: {
        candidateId: r.candidateId,
        jobRequisitionId: r.jobId,
        deletedAt: null,
      },
    });
    if (!existingApp) {
      const app = await prisma.jobApplication.create({
        data: {
          candidateId: r.candidateId,
          jobRequisitionId: r.jobId,
          status: 'APPLIED',
          stage: 'APPLIED',
        },
      });
      await autoAdvanceReferralFirstRound(app.id);
    }
  }
}

export async function listReferrals(filters: ReferralFilters, ctx: CandidateContext) {
  // Ensure that all referrals with a jobId have an associated JobApplication record.
  await ensureApplicationsForReferrals(ctx);
  // Reflect referral-sourced candidates automatically before listing.
  await ensureReferralsForSourcedCandidates(ctx);
  // Auto-advance statuses based on each candidate's interview pipeline progress.
  await syncReferralStatuses(ctx);

  const { page, limit, status, jobId, sortOrder } = filters;
  const where: Prisma.ReferralWhereInput = {
    ...(await referralScope(ctx)), // sector isolation (fail-closed)
  };

  const rows = await prisma.referral.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const candidateIds = [...new Set(rows.map((r) => r.candidateId))];
  const referrerIds = [...new Set(rows.map((r) => r.referrerId))];
  const referencedJobIds = [...new Set(rows.map((r) => r.jobId).filter((x): x is string => !!x))];

  const [candidates, jobApplications, referencedJobs, users] = await Promise.all([
    prisma.candidate.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, fullName: true, email: true },
    }),
    prisma.jobApplication.findMany({
      where: { candidateId: { in: candidateIds }, deletedAt: null },
      select: {
        id: true,
        candidateId: true,
        jobRequisitionId: true,
        status: true,
        job: {
          select: { id: true, title: true }
        }
      }
    }),
    referencedJobIds.length ? prisma.jobRequisition.findMany({
      where: { id: { in: referencedJobIds } },
      select: { id: true, title: true }
    }) : Promise.resolve([]),
    prisma.user.findMany({
      where: { id: { in: referrerIds } },
      select: { id: true, fullName: true }
    })
  ]);

  const cMap = new Map(candidates.map((c) => [c.id, c]));
  const rjMap = new Map(referencedJobs.map((j) => [j.id, j]));
  const uMap = new Map(users.map((u) => [u.id, u]));

  const appsByCandidate = new Map<string, typeof jobApplications>();
  for (const app of jobApplications) {
    const list = appsByCandidate.get(app.candidateId) ?? [];
    list.push(app);
    appsByCandidate.set(app.candidateId, list);
  }

  const allEntries: ReferralItem[] = [];

  for (const r of rows) {
    const candidate = cMap.get(r.candidateId) ?? null;
    const referrer = uMap.get(r.referrerId) ?? null;
    const apps = appsByCandidate.get(r.candidateId) ?? [];

    if (r.jobId) {
      const specificApp = apps.find(a => a.jobRequisitionId === r.jobId);
      const jobObj = rjMap.get(r.jobId) ?? null;
      
      const derivedStatus = specificApp 
        ? applicationStatusToReferralStatus(specificApp.status)
        : (r.status as ReferralItem['status']);

      allEntries.push({
        id: `${r.id}:${specificApp?.id || 'none'}`,
        status: derivedStatus,
        bonusAmount: r.bonusAmount != null ? r.bonusAmount.toString() : null,
        bonusPaid: r.bonusPaid,
        createdAt: r.createdAt.toISOString(),
        candidate: candidate ? { ...candidate, email: candidate.email ?? '' } : null,
        job: specificApp?.job ?? jobObj,
        referrer,
      });
    } else {
      if (apps.length > 0) {
        for (const app of apps) {
          const derivedStatus = applicationStatusToReferralStatus(app.status);
          allEntries.push({
            id: `${r.id}:${app.id}`,
            status: derivedStatus,
            bonusAmount: r.bonusAmount != null ? r.bonusAmount.toString() : null,
            bonusPaid: r.bonusPaid,
            createdAt: r.createdAt.toISOString(),
            candidate: candidate ? { ...candidate, email: candidate.email ?? '' } : null,
            job: app.job,
            referrer,
          });
        }
      } else {
        allEntries.push({
          id: `${r.id}:none`,
          status: r.status as ReferralItem['status'],
          bonusAmount: r.bonusAmount != null ? r.bonusAmount.toString() : null,
          bonusPaid: r.bonusPaid,
          createdAt: r.createdAt.toISOString(),
          candidate: candidate ? { ...candidate, email: candidate.email ?? '' } : null,
          job: null,
          referrer,
        });
      }
    }
  }

  const deduped: ReferralItem[] = [];
  const seenKeys = new Set<string>();
  for (const entry of allEntries) {
    const key = `${entry.candidate?.id || ''}:${entry.job?.id || 'none'}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      deduped.push(entry);
    }
  }

  let filtered = deduped;
  if (status) {
    filtered = filtered.filter(e => e.status === status);
  }
  if (jobId) {
    filtered = filtered.filter(e => e.job?.id === jobId);
  }

  filtered.sort((a, b) => {
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    return sortOrder === 'desc' ? db - da : da - db;
  });

  const total = filtered.length;
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  return paginate(paginated, total, page, limit);
}

export async function updateReferral(
  id: string,
  data: UpdateReferralInput,
  ctx: CandidateContext,
  req: Request,
) {
  const existing = await prisma.referral.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError('Referral not found');
  // Enforce sector boundary: can't modify a referral for a candidate outside
  // your sector (404 to avoid revealing its existence).
  if (!(await candidateInScope(ctx, existing.candidateId))) {
    throw new NotFoundError('Referral not found');
  }

  const updated = await prisma.referral.update({
    where: { id },
    data: {
      ...(data.status !== undefined && { status: data.status }),
      ...(data.bonusAmount !== undefined && {
        bonusAmount: data.bonusAmount != null ? new Prisma.Decimal(data.bonusAmount) : null,
      }),
      ...(data.bonusPaid !== undefined && { bonusPaid: data.bonusPaid }),
    },
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'Referral',
    entityId: id,
    description: `Updated referral ${id}`,
    oldValue: { status: existing.status, bonusPaid: existing.bonusPaid },
    newValue: { status: updated.status, bonusPaid: updated.bonusPaid },
  });

  return (await enrich([updated]))[0];
}
