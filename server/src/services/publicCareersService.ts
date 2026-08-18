import { prisma, tenantTransaction } from '../config/database.js';
import { recordAudit } from './auditService.js';
import { configService } from './configService.js';
import { dispatchFitScore, dispatchResumeParse } from '../jobs/dispatch.js';
import { NotFoundError, BadRequestError, ConflictError } from '../utils/errors.js';
import { ALLOWED_RESUME_TYPES } from '../utils/storage.js';
import { paginate } from '../utils/response.js';
import { CONFIG_KEYS, type PublicJobFilters, type PublicApplyInput } from '@agnohire/shared';
import type { Request } from 'express';

/**
 * Public careers-page service — deliberately separate from jobService.ts /
 * candidateService.ts so this feature stays isolated and revertible. Every
 * function below takes the already-resolved `tenantId` explicitly and puts it
 * in `where`, on top of running inside runWithTenant (set by
 * publicCareersScope.middleware) — belt-and-suspenders tenant isolation on a
 * brand-new, unauthenticated surface.
 */

// Job cards on the public list show ONLY: title, location + work type,
// skills, experience, salary (per-job, admin-gated), and posted date — no
// free-text description select needed here at all.
const PUBLIC_JOB_LIST_SELECT = {
  id: true,
  title: true,
  location: true,
  workMode: true,
  skills: true,
  experienceMin: true,
  experienceMax: true,
  createdAt: true,
  showSalaryPublicly: true,
  budgetMin: true,
  budgetMax: true,
} as const;

/**
 * AI-generated job descriptions (jobService.ts's generateJd()) bake a
 * "## Salary Information" heading straight into the markdown body, with the
 * exact budget range as plain text — so hiding the structured budgetMin/Max
 * fields alone isn't enough on the detail page, the same figures are still
 * readable inside the description. Drop any heading section whose title
 * mentions "salary" (any heading level/numbering) when the job hasn't opted
 * into public salary visibility, keeping every other section intact.
 */
function stripSalarySection(description: string): string {
  const lines = description.split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      skipping = /salary/i.test(line);
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * AI-generated job descriptions (jobService.ts's generateJd()) write the
 * placeholder "[Company Name]" into the markdown body rather than the real
 * tenant name, so the public page would otherwise literally show
 * "At [Company Name], we are...". Replace it with the resolved tenant's
 * actual name before this ever reaches a candidate.
 */
function substituteCompanyName(description: string, companyName: string): string {
  return description.replace(/\[\s*company(?:\s*name)?\s*\]/gi, companyName);
}

/** Only surface budget fields when the job itself has opted in (per-job, set
 *  by staff via the careers-admin endpoints — not a tenant-wide switch). */
function budgetForPublic(showSalaryPublicly: boolean, budgetMin: unknown, budgetMax: unknown) {
  if (!showSalaryPublicly) return { budgetMin: null, budgetMax: null };
  return {
    budgetMin: budgetMin != null ? Number(budgetMin) : null,
    budgetMax: budgetMax != null ? Number(budgetMax) : null,
  };
}

/**
 * Tenant-configurable display toggles for the public careers page (System
 * Config, category CAREERS). Read via configService, which resolves the
 * caller's tenant override from the ambient runWithTenant context already
 * established by publicCareersScope.middleware — no explicit tenantId needed.
 */
export async function getCareersDisplaySettings(): Promise<{ showHeader: boolean }> {
  const showHeader = await configService.getBool(CONFIG_KEYS.CAREERS_SHOW_HEADER, true);
  return { showHeader };
}

export async function listPublicJobs(tenantId: string, filters: PublicJobFilters) {
  const { page, limit, search, location } = filters;

  const where = {
    tenantId,
    status: 'OPEN',
    deletedAt: null,
    ...(location && { location: { contains: location, mode: 'insensitive' as const } }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' as const } },
        { location: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [total, items] = await Promise.all([
    prisma.jobRequisition.count({ where }),
    prisma.jobRequisition.findMany({
      where,
      select: PUBLIC_JOB_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return paginate(
    items.map(({ showSalaryPublicly, budgetMin, budgetMax, ...job }) => ({
      ...job,
      postedAt: job.createdAt,
      ...budgetForPublic(showSalaryPublicly, budgetMin, budgetMax),
    })),
    total,
    page,
    limit,
  );
}

export async function getPublicJob(tenantId: string, jobId: string, companyName: string) {
  const job = await prisma.jobRequisition.findFirst({
    where: { id: jobId, tenantId, status: 'OPEN', deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      workMode: true,
      headcount: true,
      skills: true,
      experienceMin: true,
      experienceMax: true,
      deadline: true,
      createdAt: true,
      showSalaryPublicly: true,
      budgetMin: true,
      budgetMax: true,
      sector: { select: { name: true } },
      domain: { select: { name: true } },
    },
  });
  if (!job) throw new NotFoundError('This job is no longer accepting applications');
  const { showSalaryPublicly, budgetMin, budgetMax, description, ...rest } = job;
  const shaped = showSalaryPublicly ? description : stripSalarySection(description);
  return {
    ...rest,
    description: substituteCompanyName(shaped, companyName),
    postedAt: job.createdAt,
    ...budgetForPublic(showSalaryPublicly, budgetMin, budgetMax),
  };
}

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export async function applyToJob(
  tenantId: string,
  jobId: string,
  data: PublicApplyInput,
  file: UploadedFile | undefined,
  req: Request,
): Promise<void> {
  if (!file) throw new BadRequestError('A resume file is required');
  if (!ALLOWED_RESUME_TYPES[file.mimetype]) {
    throw new BadRequestError('Unsupported file type. Upload a PDF, DOCX, TXT, or image file.');
  }

  const maxMb = await configService.getNumber(CONFIG_KEYS.RESUME_MAX_SIZE_MB, 5);
  if (file.size > maxMb * 1024 * 1024) {
    throw new BadRequestError(`File exceeds the ${maxMb} MB limit`);
  }

  const job = await prisma.jobRequisition.findFirst({
    where: { id: jobId, tenantId, status: 'OPEN', deletedAt: null },
    select: { id: true, title: true, sectorId: true, domainId: true },
  });
  if (!job) throw new BadRequestError('This job is no longer accepting applications');

  const email = data.email.toLowerCase();
  const phone = data.phone && data.phone.length ? data.phone : null;
  const coverNote = data.coverNote && data.coverNote.length ? data.coverNote : null;

  const result = await tenantTransaction(async (tx) => {
    let candidate = await tx.candidate.findFirst({ where: { tenantId, email, deletedAt: null } });

    if (!candidate) {
      const softDeleted = await tx.candidate.findFirst({ where: { tenantId, email, deletedAt: { not: null } } });
      if (softDeleted) {
        candidate = await tx.candidate.update({
          where: { id: softDeleted.id },
          data: {
            fullName: data.fullName,
            phone,
            source: 'CAREER_SITE',
            // Sourced from the job row above (already verified to belong to
            // this tenant) — not a fallback lookup — see the two production
            // incidents on unscoped default-sector/domain lookups.
            sectorId: job.sectorId,
            domainId: job.domainId,
            deletedAt: null,
          },
        });
      } else {
        candidate = await tx.candidate.create({
          data: {
            tenantId,
            fullName: data.fullName,
            email,
            phone,
            source: 'CAREER_SITE',
            sectorId: job.sectorId,
            domainId: job.domainId,
            consentGiven: true,
            consentAt: new Date(),
          },
        });
      }
    }

    const existingApplication = await tx.jobApplication.findFirst({
      where: { tenantId, candidateId: candidate.id, jobRequisitionId: jobId },
    });
    if (existingApplication) throw new ConflictError('You have already applied to this job');

    const application = await tx.jobApplication.create({
      data: {
        tenantId,
        candidateId: candidate.id,
        jobRequisitionId: jobId,
        status: 'APPLIED',
        stage: 'APPLIED',
        notes: coverNote,
      },
      select: { id: true },
    });

    await tx.resume.updateMany({ where: { tenantId, candidateId: candidate.id }, data: { isPrimary: false } });
    const resume = await tx.resume.create({
      data: {
        tenantId,
        candidateId: candidate.id,
        fileUrl: '',
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        fileData: file.buffer,
        isPrimary: true,
        parseStatus: 'PENDING',
      },
      select: { id: true },
    });
    await tx.resume.update({
      where: { id: resume.id, tenantId },
      data: { fileUrl: `/api/candidates/${candidate.id}/resumes/${resume.id}/download` },
    });

    return { candidateId: candidate.id, applicationId: application.id, resumeId: resume.id };
  });

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'JobApplication',
    entityId: result.applicationId,
    description: `Public careers-page application for "${job.title}"`,
  });

  // Fire-and-forget: never block the HTTP response on parsing/scoring.
  await dispatchResumeParse(result.resumeId);
  const autoScore = await configService.getBool(CONFIG_KEYS.FIT_SCORE_AUTO, true);
  if (autoScore) await dispatchFitScore(result.applicationId);
}
