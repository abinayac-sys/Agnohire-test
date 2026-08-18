import { prisma } from '../config/database.js';
import { getTenantContext } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import type { Request } from 'express';

/**
 * Staff-authenticated admin surface for the public careers page's per-job
 * salary visibility toggle. Deliberately separate from jobService.ts: the
 * generic job update endpoint only allows edits while a job is DRAFT/
 * PENDING_APPROVAL, but salary visibility is only meaningful for OPEN jobs
 * (the ones actually visible on the public careers page), so reusing it
 * would reject exactly the edits this feature needs. Runs inside the normal
 * authenticated request's tenant context — reads/writes are auto-scoped by
 * the standard TENANT_MODELS Prisma middleware (see config/database.ts).
 */

/**
 * Defense-in-depth: the Integrations UI already hides this feature entirely
 * for a tenant that hasn't been granted it (Tenant.careersPageEnabled, set
 * only by a platform superadmin — see tenantAdminService.ts), but these
 * endpoints must refuse it too in case of a direct API call.
 */
async function assertCareersFeatureGranted(): Promise<void> {
  const tenantId = getTenantContext()?.tenantId;
  if (!tenantId) throw new ForbiddenError('No tenant on session');
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId }, select: { careersPageEnabled: true } });
  if (!tenant?.careersPageEnabled) {
    throw new ForbiddenError('The careers page feature has not been enabled for your workspace');
  }
}

const CAREERS_ADMIN_JOB_SELECT = {
  id: true,
  title: true,
  showSalaryPublicly: true,
  budgetMin: true,
  budgetMax: true,
} as const;

function toItem(job: {
  id: string;
  title: string;
  showSalaryPublicly: boolean;
  budgetMin: unknown;
  budgetMax: unknown;
}) {
  return {
    id: job.id,
    title: job.title,
    showSalaryPublicly: job.showSalaryPublicly,
    budgetMin: job.budgetMin != null ? Number(job.budgetMin) : null,
    budgetMax: job.budgetMax != null ? Number(job.budgetMax) : null,
  };
}

/** Lists this tenant's OPEN jobs for the "show salary per job" admin list. */
export async function listCareersJobs() {
  await assertCareersFeatureGranted();
  const jobs = await prisma.jobRequisition.findMany({
    where: { status: 'OPEN' },
    select: CAREERS_ADMIN_JOB_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  return jobs.map(toItem);
}

export async function setJobSalaryVisibility(
  jobId: string,
  showSalaryPublicly: boolean,
  req: Request,
) {
  await assertCareersFeatureGranted();
  const job = await prisma.jobRequisition.findFirst({ where: { id: jobId } });
  if (!job) throw new NotFoundError('Job not found');

  const updated = await prisma.jobRequisition.update({
    where: { id: jobId },
    data: { showSalaryPublicly },
    select: CAREERS_ADMIN_JOB_SELECT,
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'JobRequisition',
    entityId: jobId,
    description: `${showSalaryPublicly ? 'Enabled' : 'Disabled'} public salary visibility for "${job.title}"`,
  });

  return toItem(updated);
}
