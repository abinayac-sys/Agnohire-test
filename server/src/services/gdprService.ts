import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma, tenantTransaction } from '../config/database.js';
import { recordAudit } from './auditService.js';
import { paginate } from '../utils/response.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../utils/errors.js';
import {
  ROLES,
  GDPR_REQUEST_TYPE,
  type GdprFilters,
  type CreateGdprRequestInput,
  type ProcessGdprRequestInput,
  type SetConsentInput,
  type RetentionPolicyInput,
  type GdprRequestItem,
  type GdprRequestStatus,
  type GdprExportBundle,
  type ConsentRow,
  type RetentionPolicyItem,
  type ComplianceSummary,
} from '@agnohire/shared';

export interface GdprContext {
  userId: string;
  role: string;
  sectorId?: string | null;
}

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/** Loads a candidate, enforcing the caller's sector boundary (fail-closed). */
async function loadScopedCandidate(ctx: GdprContext, candidateId: string) {
  const c = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, fullName: true, email: true, sectorId: true, userId: true, gdprDeletedAt: true },
  });
  if (!c) throw new NotFoundError('Candidate not found');
  if (!isSuperOrAdmin(ctx.role)) {
    if (ctx.sectorId && c.sectorId !== ctx.sectorId) {
      throw new ForbiddenError('This candidate is outside your sector');
    }
  }
  return c;
}

// GdprRequest has no Prisma relation to Candidate (plain candidateId FK), so we
// scope by first resolving the candidate ids visible in the caller's sector.
async function requestScope(ctx: GdprContext): Promise<Prisma.GdprRequestWhereInput> {
  if (isSuperOrAdmin(ctx.role)) return {};
  if (!ctx.sectorId) return {};
  const ids = await prisma.candidate.findMany({ where: { sectorId: ctx.sectorId }, select: { id: true } });
  return { candidateId: { in: ids.map((c) => c.id) } };
}

// GdprRequest has no relation in the schema (plain candidateId FK); resolve
// candidate fields via a name map rather than a Prisma include.
async function candidateMap(ids: string[]) {
  const rows = ids.length
    ? await prisma.candidate.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true, sectorId: true } })
    : [];
  return new Map(rows.map((r) => [r.id, r]));
}

async function userMap(ids: string[]) {
  const clean = ids.filter(Boolean) as string[];
  const rows = clean.length
    ? await prisma.user.findMany({ where: { id: { in: clean } }, select: { id: true, fullName: true } })
    : [];
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

// ─── REQUESTS ────────────────────────────────────────────────────────────────

export async function listGdprRequests(ctx: GdprContext, filters: GdprFilters) {
  const and: Prisma.GdprRequestWhereInput[] = [await requestScope(ctx)];
  if (filters.status) and.push({ status: filters.status });
  if (filters.type) and.push({ type: filters.type });
  if (filters.search) {
    const matches = await prisma.candidate.findMany({
      where: { OR: [
        { fullName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ] },
      select: { id: true },
    });
    and.push({ candidateId: { in: matches.map((m) => m.id) } });
  }
  const where: Prisma.GdprRequestWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    prisma.gdprRequest.findMany({
      where,
      orderBy: { requestedAt: filters.sortOrder },
      skip: (filters.page - 1) * filters.limit, take: filters.limit,
    }),
    prisma.gdprRequest.count({ where }),
  ]);

  const cMap = await candidateMap(rows.map((r) => r.candidateId));
  const uMap = await userMap(rows.map((r) => r.processedById).filter(Boolean) as string[]);
  const items: GdprRequestItem[] = rows.map((r) => {
    const c = cMap.get(r.candidateId);
    return {
      id: r.id,
      candidateId: r.candidateId,
      candidateName: c?.fullName ?? null,
      candidateEmail: c?.email ?? null,
      type: r.type as GdprRequestItem['type'],
      status: r.status as GdprRequestStatus,
      requestedAt: r.requestedAt.toISOString(),
      processedAt: r.processedAt?.toISOString() ?? null,
      processedById: r.processedById,
      processedByName: r.processedById ? uMap.get(r.processedById) ?? null : null,
    };
  });
  return paginate(items, total, filters.page, filters.limit);
}

export async function createGdprRequest(ctx: GdprContext, data: CreateGdprRequestInput, req: Request): Promise<GdprRequestItem> {
  const candidate = await loadScopedCandidate(ctx, data.candidateId);
  const request = await prisma.gdprRequest.create({
    data: { candidateId: candidate.id, type: data.type, status: 'PENDING' },
  });
  await recordAudit(req, {
    action: 'GDPR_REQUEST',
    entity: 'Candidate',
    entityId: candidate.id,
    description: `Raised ${data.type} GDPR request for ${candidate.fullName}${data.note ? ` — ${data.note}` : ''}`,
  });
  return {
    id: request.id,
    candidateId: candidate.id,
    candidateName: candidate.fullName,
    candidateEmail: candidate.email,
    type: data.type,
    status: 'PENDING',
    requestedAt: request.requestedAt.toISOString(),
    processedAt: null,
    processedById: null,
    processedByName: null,
  };
}

/**
 * Process a pending request. `fulfil` carries out the action (assemble the
 * export for ACCESS/PORTABILITY, erase for DELETION); `reject` closes it.
 * Returns the export bundle when one was produced.
 */
export async function processGdprRequest(
  ctx: GdprContext,
  id: string,
  data: ProcessGdprRequestInput,
  req: Request,
): Promise<{ request: GdprRequestItem; bundle?: GdprExportBundle }> {
  const existing = await prisma.gdprRequest.findFirst({ where: { AND: [{ id }, await requestScope(ctx)] } });
  if (!existing) throw new NotFoundError('GDPR request not found');
  if (existing.status !== 'PENDING') throw new BadRequestError('This request has already been processed');

  const candidate = await loadScopedCandidate(ctx, existing.candidateId);
  let bundle: GdprExportBundle | undefined;
  let erased = false;

  if (data.action === 'fulfil') {
    if (existing.type === GDPR_REQUEST_TYPE.DELETION) {
      await eraseCandidate(candidate.id);
      erased = true;
      await recordAudit(req, { action: 'GDPR_ERASURE', entity: 'Candidate', entityId: candidate.id, description: `Erased candidate data (right to erasure) for ${candidate.fullName}` });
    } else {
      bundle = await buildExportBundle(candidate.id);
      await recordAudit(req, { action: 'GDPR_EXPORT', entity: 'Candidate', entityId: candidate.id, description: `Exported personal data (${existing.type}) for ${candidate.fullName}` });
    }
  } else {
    await recordAudit(req, { action: 'GDPR_REJECT', entity: 'Candidate', entityId: candidate.id, description: `Rejected ${existing.type} GDPR request for ${candidate.fullName}${data.note ? ` — ${data.note}` : ''}` });
  }

  const status: GdprRequestStatus = data.action === 'fulfil' ? 'COMPLETED' : 'REJECTED';
  const updated = await prisma.gdprRequest.update({
    where: { id },
    data: { status, processedAt: new Date(), processedById: ctx.userId },
  });

  // After erasure the row is soft-deleted (hidden from normal reads), so reflect
  // the anonymised identity directly rather than re-reading.
  return {
    request: {
      id: updated.id,
      candidateId: candidate.id,
      candidateName: erased ? 'Erased Candidate' : candidate.fullName,
      candidateEmail: erased ? `erased-${candidate.id}@gdpr.local` : candidate.email,
      type: existing.type as GdprRequestItem['type'],
      status,
      requestedAt: updated.requestedAt.toISOString(),
      processedAt: updated.processedAt?.toISOString() ?? null,
      processedById: updated.processedById,
      processedByName: null,
    },
    bundle,
  };
}

// ─── EXPORT BUNDLE (subject access / portability) ────────────────────────────

/** Sector-checked direct export (subject-access download) + audit trail. */
export async function exportCandidateData(ctx: GdprContext, candidateId: string, req: Request): Promise<GdprExportBundle> {
  const candidate = await loadScopedCandidate(ctx, candidateId);
  const bundle = await buildExportBundle(candidate.id);
  await recordAudit(req, { action: 'GDPR_EXPORT', entity: 'Candidate', entityId: candidate.id, description: `Exported personal data for ${candidate.fullName}` });
  return bundle;
}

export async function buildExportBundle(candidateId: string): Promise<GdprExportBundle> {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new NotFoundError('Candidate not found');

  const [resumes, applications, interviews, offers] = await Promise.all([
    // Resume binary (fileData) is deliberately excluded — metadata only.
    prisma.resume.findMany({ where: { candidateId }, select: { id: true, fileName: true, fileSize: true, mimeType: true, parseStatus: true, parsedData: true, createdAt: true } }),
    prisma.jobApplication.findMany({ where: { candidateId }, select: { id: true, jobRequisitionId: true, status: true, stage: true, fitScore: true, appliedAt: true, notes: true } }),
    prisma.interview.findMany({ where: { candidateId }, select: { id: true, type: true, status: true, startedAt: true, completedAt: true, transcript: true, createdAt: true } }),
    prisma.offer.findMany({ where: { candidateId }, select: { id: true, applicationId: true, status: true, salaryOffered: true, validUntil: true, joiningDate: true, createdAt: true } }),
  ]);

  const json = (v: unknown) => JSON.parse(JSON.stringify(v));
  return {
    exportedAt: new Date().toISOString(),
    candidate: json(candidate),
    resumes: json(resumes),
    applications: json(applications),
    interviews: json(interviews),
    offers: json(offers),
  };
}

// ─── ERASURE (right to be forgotten) ─────────────────────────────────────────

/**
 * Anonymises a candidate's PII in place and soft-deletes the record. Erasure is
 * complete: it also scrubs the free-text PII the candidate produced elsewhere —
 * chat transcripts, interview transcripts/recordings, and application notes —
 * not just the candidate row.
 */
async function eraseCandidate(candidateId: string): Promise<void> {
  const placeholderEmail = `erased-${candidateId}@gdpr.local`;

  await tenantTransaction(async (tx) => {
    // Interview transcripts / recordings can contain the candidate's own words.
    await tx.interview.updateMany({
      where: { candidateId },
      data: { transcript: null, transcriptUrl: null, recordingUrl: null },
    });
    // Recruiter notes on the candidate's applications.
    await tx.jobApplication.updateMany({ where: { candidateId }, data: { notes: null } });
    // Scrub resume content but keep the row for referential integrity.
    await tx.resume.updateMany({
      where: { candidateId },
      data: { fileData: null, parsedData: Prisma.DbNull, parseError: null, fileName: 'erased', fileUrl: 'erased' },
    });
    await tx.candidate.update({
      where: { id: candidateId },
      data: {
        fullName: 'Erased Candidate',
        email: placeholderEmail,
        phone: null,
        linkedinUrl: null,
        githubUrl: null,
        location: null,
        currentRole: null,
        avatarUrl: null,
        skills: [],
        userId: null,
        consentGiven: false,
        gdprDeletedAt: new Date(),
        deletedAt: new Date(),
      },
    });
  });
}

// ─── CONSENT ─────────────────────────────────────────────────────────────────

export async function setConsent(ctx: GdprContext, data: SetConsentInput, req: Request): Promise<ConsentRow> {
  const candidate = await loadScopedCandidate(ctx, data.candidateId);
  if (candidate.gdprDeletedAt) throw new BadRequestError('This candidate has been erased');
  const updated = await prisma.candidate.update({
    where: { id: candidate.id },
    data: { consentGiven: data.given, consentAt: data.given ? new Date() : null },
    select: { id: true, fullName: true, email: true, consentGiven: true, consentAt: true, gdprDeletedAt: true },
  });
  await recordAudit(req, {
    action: 'GDPR_CONSENT',
    entity: 'Candidate',
    entityId: candidate.id,
    description: `${data.given ? 'Recorded' : 'Withdrew'} processing consent for ${candidate.fullName}`,
  });
  return {
    candidateId: updated.id,
    candidateName: updated.fullName,
    candidateEmail: updated.email,
    consentGiven: updated.consentGiven,
    consentAt: updated.consentAt?.toISOString() ?? null,
    gdprDeletedAt: updated.gdprDeletedAt?.toISOString() ?? null,
  };
}

function candidateSectorScope(ctx: GdprContext): Prisma.CandidateWhereInput {
  if (isSuperOrAdmin(ctx.role)) return {};
  if (ctx.sectorId) return { sectorId: ctx.sectorId };
  return { id: { in: [] } };
}

export async function listConsent(ctx: GdprContext, page = 1, limit = 25) {
  const where: Prisma.CandidateWhereInput = candidateSectorScope(ctx);
  const [rows, total] = await Promise.all([
    prisma.candidate.findMany({
      where, orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit, take: limit,
      select: { id: true, fullName: true, email: true, consentGiven: true, consentAt: true, gdprDeletedAt: true },
    }),
    prisma.candidate.count({ where }),
  ]);
  const items: ConsentRow[] = rows.map((c) => ({
    candidateId: c.id,
    candidateName: c.fullName,
    candidateEmail: c.email,
    consentGiven: c.consentGiven,
    consentAt: c.consentAt?.toISOString() ?? null,
    gdprDeletedAt: c.gdprDeletedAt?.toISOString() ?? null,
  }));
  return paginate(items, total, page, limit);
}

// ─── RETENTION POLICIES ──────────────────────────────────────────────────────

function toPolicy(p: { id: string; entityType: string; retentionDays: number; autoDeleteEnabled: boolean; updatedAt: Date }): RetentionPolicyItem {
  return { id: p.id, entityType: p.entityType, retentionDays: p.retentionDays, autoDeleteEnabled: p.autoDeleteEnabled, updatedAt: p.updatedAt.toISOString() };
}

export async function listRetentionPolicies(): Promise<RetentionPolicyItem[]> {
  const rows = await prisma.dataRetentionPolicy.findMany({ orderBy: { entityType: 'asc' } });
  return rows.map(toPolicy);
}

export async function upsertRetentionPolicy(data: RetentionPolicyInput, req: Request): Promise<RetentionPolicyItem> {
  const policy = await prisma.dataRetentionPolicy.upsert({
    where: { entityType: data.entityType },
    update: { retentionDays: data.retentionDays, autoDeleteEnabled: data.autoDeleteEnabled },
    create: { entityType: data.entityType, retentionDays: data.retentionDays, autoDeleteEnabled: data.autoDeleteEnabled },
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'DataRetentionPolicy', entityId: policy.id, description: `Set retention for ${data.entityType} to ${data.retentionDays} days` });
  return toPolicy(policy);
}

export async function deleteRetentionPolicy(id: string, req: Request): Promise<void> {
  const existing = await prisma.dataRetentionPolicy.findUnique({ where: { id }, select: { id: true, entityType: true } });
  if (!existing) throw new NotFoundError('Policy not found');
  await prisma.dataRetentionPolicy.delete({ where: { id } });
  await recordAudit(req, { action: 'DELETE', entity: 'DataRetentionPolicy', entityId: id, description: `Removed retention policy for ${existing.entityType}` });
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

export async function getComplianceSummary(ctx: GdprContext): Promise<ComplianceSummary> {
  const rScope = await requestScope(ctx);
  const cScope = candidateSectorScope(ctx);
  const [pendingRequests, completedRequests, totalCandidates, consentedCandidates, erasedCandidates] = await Promise.all([
    prisma.gdprRequest.count({ where: { AND: [rScope, { status: 'PENDING' }] } }),
    prisma.gdprRequest.count({ where: { AND: [rScope, { status: 'COMPLETED' }] } }),
    prisma.candidate.count({ where: cScope }),
    prisma.candidate.count({ where: { AND: [cScope, { consentGiven: true }] } }),
    // Erased candidates carry deletedAt, which the soft-delete middleware would
    // hide — set deletedAt explicitly at top level to opt out of that filter.
    prisma.candidate.count({ where: { AND: [cScope], gdprDeletedAt: { not: null }, deletedAt: { not: null } } }),
  ]);
  return { pendingRequests, completedRequests, totalCandidates, consentedCandidates, erasedCandidates };
}
