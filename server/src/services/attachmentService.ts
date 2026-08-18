import { prisma } from '../config/database.js';
import { runAsPlatform, getTenantContext } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { ALLOWED_ATTACHMENT_TYPES } from '../utils/storage.js';
import { ROLES, type AttachmentMeta } from '@agnohire/shared';
import type { Request } from 'express';

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Who is requesting a download — used to authorize access. */
export interface AttachmentRequester {
  userId: string;
  role: string;
  sectorId?: string | null;
}

const MAX_BYTES = 15 * 1024 * 1024; // hard ceiling, mirrors multer

function toMeta(a: {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
}): AttachmentMeta {
  return {
    id: a.id,
    url: `/api/files/${a.id}/download`,
    fileName: a.fileName,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Persists an uploaded file and returns its metadata (incl. download URL). */
export async function createAttachment(
  file: UploadedFile | undefined,
  uploadedById: string | undefined,
  req: Request,
): Promise<AttachmentMeta> {
  if (!file) throw new BadRequestError('No file was uploaded');
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)) {
    throw new BadRequestError('Unsupported file type. Supported formats: PDF, Word (.doc/.docx), Excel (.xls/.xlsx), CSV, TXT, PNG, JPG, WEBP.');
  }
  if (file.size > MAX_BYTES) {
    throw new BadRequestError('File exceeds the 15 MB limit');
  }

  const ctx = getTenantContext();
  const created = await prisma.attachment.create({
    data: {
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      fileData: file.buffer,
      uploadedById: uploadedById ?? null,
      tenantId: ctx?.tenantId ?? null,
    },
    select: { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true },
  });

  await recordAudit(req, {
    action: 'UPLOAD',
    entity: 'Attachment',
    entityId: created.id,
    description: `Uploaded file "${file.originalname}"`,
  });

  return toMeta(created);
}

/**
 * Server-side, no-auth byte fetch by attachment id. For internal pipelines
 * (e.g. transcription) that have already authorized the parent record. Returns
 * null when the id is unknown so callers can fall through to other sources.
 */
export async function getAttachmentBytesById(
  id: string,
): Promise<{ fileName: string; mimeType: string; buffer: Buffer } | null> {
  // Only bypass RLS when there is NO ambient tenant context at all (a true
  // background worker resolving an id already authorized by its parent
  // record — e.g. reviewService.fetchRecordingAudio). Attachment carries
  // FORCE ROW LEVEL SECURITY, so with no context the row would otherwise be
  // invisible (the policy fails closed when neither app.bypass nor
  // app.tenant_id is set), hence the explicit bypass for that case only.
  //
  // When this runs inside an authenticated request, a tenant context IS
  // present, so we must NOT force a bypass: some callers (e.g.
  // importCandidateListFromAttachment / importQuestionBankFromAttachment)
  // pass an attachmentId straight from client/agent input with no other
  // ownership check — an unconditional bypass here let any tenant read any
  // other tenant's file bytes by id. Letting the normal Prisma tenancy
  // middleware run (no bypass) scopes the lookup to the caller's own tenant.
  const ctx = getTenantContext();
  const a = ctx
    ? await prisma.attachment.findUnique({
      where: { id },
      select: { fileName: true, mimeType: true, fileData: true },
    })
    : await runAsPlatform(() =>
      prisma.attachment.findUnique({
        where: { id },
        select: { fileName: true, mimeType: true, fileData: true },
      }),
    );
  if (!a || !a.fileData) return null;
  return { fileName: a.fileName, mimeType: a.mimeType, buffer: Buffer.from(a.fileData) };
}

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/**
 * Authorizes a download. Allowed when the requester is an admin, uploaded the
 * file themselves, or the file is referenced by an offer/onboarding record in
 * their own sector (offer document, offer letter, or BGV report). This keeps
 * attachment access in lockstep with the sector-scoped APIs that expose the
 * URLs — a different-sector user can no longer fetch a file by guessing its id.
 */
async function canAccess(
  id: string,
  uploadedById: string | null,
  r: AttachmentRequester,
): Promise<boolean> {
  if (isSuperOrAdmin(r.role)) return true;
  if (uploadedById && uploadedById === r.userId) return true;
  if (!r.sectorId) return false; // fail closed

  const sectorId = r.sectorId;
  const [doc, offer, onboarding] = await Promise.all([
    prisma.offerDocument.findFirst({
      where: {
        AND: [
          { fileUrl: { contains: id } },
          { offer: { application: { job: { sectorId } } } }
        ]
      },
      select: { id: true },
    }),
    prisma.offer.findFirst({
      where: {
        AND: [
          { offerLetterUrl: { contains: id } },
          { application: { job: { sectorId } } }
        ]
      },
      select: { id: true },
    }),
    prisma.onboarding.findFirst({
      where: {
        AND: [
          { bgvReportUrl: { contains: id } },
          { offer: { application: { job: { sectorId } } } }
        ]
      },
      select: { id: true },
    }),
  ]);
  return Boolean(doc || offer || onboarding);
}

/**
 * Streams an attachment's bytes with NO access control — only for assets that
 * are intentionally public (e.g. the company logo referenced from the public
 * `/api/system/bootstrap`). Callers must restrict which attachment ids reach
 * this path (see the branding-image allowlist in the system controller).
 */
export async function getPublicAttachmentFile(
  id: string,
): Promise<{ fileName: string; mimeType: string; buffer: Buffer }> {
  // Intentionally public (logo, avatar): no auth context and access is gated by
  // an id allowlist at the controller, so bypass RLS to serve the bytes.
  const a = await runAsPlatform(() =>
    prisma.attachment.findUnique({
      where: { id },
      select: { fileName: true, mimeType: true, fileData: true },
    }),
  );
  if (!a || !a.fileData) throw new NotFoundError('File not found');
  return { fileName: a.fileName, mimeType: a.mimeType, buffer: Buffer.from(a.fileData) };
}

/**
 * Streams an attachment's bytes, scoped to the requester. Unauthorized access
 * returns a 404 (not 403) so the existence of a file is never disclosed.
 */
export async function getAttachmentFile(
  id: string,
  requester?: AttachmentRequester,
  publicOfferToken?: string,
): Promise<{ fileName: string; mimeType: string; buffer: Buffer }> {
  // Bypass the tenant RLS middleware for this fetch: `Attachment` is a
  // TENANT_MODEL, so a plain prisma.attachment.findUnique() silently appends
  // `tenantId = <current>` and returns null for rows created under a different
  // tenant context (e.g. candidate upload via public token, or null tenantId).
  // The authorization check that follows still enforces access correctly.
  const a = await runAsPlatform(() =>
    prisma.attachment.findUnique({
      where: { id },
      select: { fileName: true, mimeType: true, fileData: true, uploadedById: true },
    }),
  );
  if (!a || !a.fileData) throw new NotFoundError('File not found');

  if (publicOfferToken) {
    const [doc, offer, onboarding] = await Promise.all([
      prisma.offerDocument.findFirst({
        where: {
          AND: [
            { fileUrl: { contains: id } },
            { offer: { acceptanceToken: publicOfferToken } }
          ]
        },
        select: { id: true },
      }),
      prisma.offer.findFirst({
        where: {
          AND: [
            { offerLetterUrl: { contains: id } },
            { acceptanceToken: publicOfferToken }
          ]
        },
        select: { id: true },
      }),
      prisma.onboarding.findFirst({
        where: {
          AND: [
            { bgvReportUrl: { contains: id } },
            { offer: { acceptanceToken: publicOfferToken } }
          ]
        },
        select: { id: true },
      }),
    ]);
    if (!doc && !offer && !onboarding) {
      throw new NotFoundError('File not found');
    }
  } else if (requester) {
    if (!(await canAccess(id, a.uploadedById, requester))) {
      throw new NotFoundError('File not found');
    }
  } else {
    throw new NotFoundError('File not found');
  }

  return { fileName: a.fileName, mimeType: a.mimeType, buffer: Buffer.from(a.fileData) };
}
