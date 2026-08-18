import { tenantTransaction } from '../config/database.js';
import { runAsPlatform } from '../config/tenantContext.js';

export interface TenantStorageBreakdown {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  resumeBytes: number;
  attachmentBytes: number;
  proctorShotBytes: number;
  assessmentProctorShotBytes: number;
  biometricBytes: number;
  totalBytes: number;
  candidateCount: number;
}

interface RawGroup {
  tenantId: string | null;
  bytes: bigint | number | null;
}

const CACHE_TTL_MS = 5 * 60_000;
interface StorageCacheEntry { byTenant: TenantStorageBreakdown[]; unattributedBytes: number }
let cache: { data: StorageCacheEntry; loadedAt: number } | null = null;

function toNumber(v: bigint | number | null): number {
  if (v === null) return 0;
  return typeof v === 'bigint' ? Number(v) : v;
}

/** Splits grouped rows into a per-tenant map plus a separate "unattributed"
 *  total (rows with no tenantId) — orphaned data isn't billable to any one
 *  tenant so it's excluded from the by-tenant list, but it still occupies
 *  real disk and must not silently vanish from the platform-wide total. */
function mergeByTenant(rows: RawGroup[]): { byTenant: Map<string, number>; unattributed: number } {
  const byTenant = new Map<string, number>();
  let unattributed = 0;
  for (const r of rows) {
    const bytes = toNumber(r.bytes);
    if (!r.tenantId) { unattributed += bytes; continue; }
    byTenant.set(r.tenantId, (byTenant.get(r.tenantId) ?? 0) + bytes);
  }
  return { byTenant, unattributed };
}

/**
 * Aggregates candidate-linked storage (resumes, attachments, proctoring
 * snapshots, biometric images) per tenant directly from Postgres — all of it
 * lives as bytea/text columns, there is no separate object-storage tier to
 * query. Cached for CACHE_TTL_MS since these are full-table
 * SUM(octet_length(...)) scans across several tables — cheap at current
 * volume, but no reason to re-run on every dashboard refresh.
 */
async function computeStorageByTenant(): Promise<StorageCacheEntry> {
  return runAsPlatform(() => tenantTransaction(async (tx) => {
    // Resume/Attachment/Candidate carry FORCE ROW LEVEL SECURITY (see
    // config/database.ts RLS Phase 2): the tenant_isolation policy hides every
    // row unless the `app.bypass`/`app.tenant_id` GUCs are set on the SAME
    // connection as the query. Those GUCs are normally set by the Prisma
    // `$allOperations` extension, but that extension only intercepts MODEL
    // operations — raw `prisma.$queryRaw` calls bypass it entirely and would
    // silently see zero rows despite `runAsPlatform()`'s bypass:true context.
    // `tenantTransaction` sets the GUCs explicitly and pins every statement
    // below to that one transaction/connection so the bypass actually applies.
    //
    // Deliberately NOT filtering deletedAt IS NULL: a soft-deleted Resume
    // row still has its fileData bytes intact on disk (only GDPR erasure
    // nulls them — see gdprService.eraseCandidate) and still costs storage,
    // exactly like the other tables in this aggregation, none of which
    // filter by their parent's soft-delete state either.
    const resumeRows = await tx.$queryRaw<RawGroup[]>`
        SELECT "tenantId", COALESCE(SUM(octet_length("fileData")), 0) AS bytes
        FROM "Resume" GROUP BY "tenantId"`;
    const attachmentRows = await tx.$queryRaw<RawGroup[]>`
        SELECT "tenantId", COALESCE(SUM(octet_length("fileData")), 0) AS bytes
        FROM "Attachment" GROUP BY "tenantId"`;
    const proctorRows = await tx.$queryRaw<RawGroup[]>`
        SELECT i."tenantId" AS "tenantId", COALESCE(SUM(octet_length(p."imageData")), 0) AS bytes
        FROM "ProctorShot" p JOIN "Interview" i ON i.id = p."interviewId" GROUP BY i."tenantId"`;
    const assessmentProctorRows = await tx.$queryRaw<RawGroup[]>`
        SELECT a."tenantId" AS "tenantId", COALESCE(SUM(octet_length(s."imageData")), 0) AS bytes
        FROM "AssessmentProctorShot" s JOIN "AssessmentAssignment" a ON a.id = s."assignmentId" GROUP BY a."tenantId"`;
    const biometricRows = await tx.$queryRaw<RawGroup[]>`
        SELECT i."tenantId" AS "tenantId", COALESCE(SUM(octet_length(b."enrollmentImage") + octet_length(COALESCE(b."latestImage", ''))), 0) AS bytes
        FROM "BiometricReport" b JOIN "Interview" i ON i.id = b."interviewId" GROUP BY i."tenantId"`;
    const candidateRows = await tx.$queryRaw<RawGroup[]>`
        SELECT "tenantId", COUNT(*) AS bytes
        FROM "Candidate" WHERE "deletedAt" IS NULL GROUP BY "tenantId"`;
    const tenants = await tx.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true } });

    const resume = mergeByTenant(resumeRows);
    const attachment = mergeByTenant(attachmentRows);
    const proctor = mergeByTenant(proctorRows);
    const assessmentProctor = mergeByTenant(assessmentProctorRows);
    const biometric = mergeByTenant(biometricRows);
    const candidateCount = mergeByTenant(candidateRows);

    const byTenant = tenants
      .map((t): TenantStorageBreakdown => {
        const resumeBytes = resume.byTenant.get(t.id) ?? 0;
        const attachmentBytes = attachment.byTenant.get(t.id) ?? 0;
        const proctorShotBytes = proctor.byTenant.get(t.id) ?? 0;
        const assessmentProctorShotBytes = assessmentProctor.byTenant.get(t.id) ?? 0;
        const biometricBytes = biometric.byTenant.get(t.id) ?? 0;
        return {
          tenantId: t.id,
          tenantName: t.name,
          tenantSlug: t.slug,
          resumeBytes,
          attachmentBytes,
          proctorShotBytes,
          assessmentProctorShotBytes,
          biometricBytes,
          totalBytes: resumeBytes + attachmentBytes + proctorShotBytes + assessmentProctorShotBytes + biometricBytes,
          candidateCount: candidateCount.byTenant.get(t.id) ?? 0,
        };
      })
      .sort((a, b) => b.totalBytes - a.totalBytes);

    const unattributedBytes = resume.unattributed + attachment.unattributed + proctor.unattributed + assessmentProctor.unattributed + biometric.unattributed;
    return { byTenant, unattributedBytes };
  }));
}

async function getAllTenantBreakdowns(): Promise<StorageCacheEntry> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.data;
  const data = await computeStorageByTenant();
  cache = { data, loadedAt: Date.now() };
  return data;
}

/** Invalidate the cache — call after any bulk delete/erasure that would change totals. */
export function invalidateStorageCache(): void {
  cache = null;
}

export async function getStorageByTenant(): Promise<TenantStorageBreakdown[]> {
  return (await getAllTenantBreakdowns()).byTenant;
}

export async function getTenantStorageUsage(tenantId: string): Promise<TenantStorageBreakdown | null> {
  const { byTenant } = await getAllTenantBreakdowns();
  return byTenant.find((t) => t.tenantId === tenantId) ?? null;
}

export interface PlatformStorageSummary {
  totalBytes: number;
  resumeBytes: number;
  attachmentBytes: number;
  proctorShotBytes: number;
  assessmentProctorShotBytes: number;
  biometricBytes: number;
  candidateCount: number;
  tenantCount: number;
  /** Bytes belonging to no tenant (orphaned rows) — included in totalBytes so
   *  the platform total always matches real disk usage, but not attributable
   *  to any row in the by-tenant breakdown. Should normally be 0; a nonzero
   *  value is worth investigating (a tenantId that failed to stamp, or a
   *  cross-tenant test artifact). */
  unattributedBytes: number;
}

export async function getPlatformStorageSummary(): Promise<PlatformStorageSummary> {
  const { byTenant, unattributedBytes } = await getAllTenantBreakdowns();
  const totals = byTenant.reduce(
    (acc, t) => ({
      resumeBytes: acc.resumeBytes + t.resumeBytes,
      attachmentBytes: acc.attachmentBytes + t.attachmentBytes,
      proctorShotBytes: acc.proctorShotBytes + t.proctorShotBytes,
      assessmentProctorShotBytes: acc.assessmentProctorShotBytes + t.assessmentProctorShotBytes,
      biometricBytes: acc.biometricBytes + t.biometricBytes,
      candidateCount: acc.candidateCount + t.candidateCount,
      tenantCount: acc.tenantCount + (t.totalBytes > 0 || t.candidateCount > 0 ? 1 : 0),
    }),
    { resumeBytes: 0, attachmentBytes: 0, proctorShotBytes: 0, assessmentProctorShotBytes: 0, biometricBytes: 0, candidateCount: 0, tenantCount: 0 },
  );
  const attributedTotal = totals.resumeBytes + totals.attachmentBytes + totals.proctorShotBytes + totals.assessmentProctorShotBytes + totals.biometricBytes;
  return { ...totals, unattributedBytes, totalBytes: attributedTotal + unattributedBytes };
}
