import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../config/database.js';
import { getTenantContext } from '../config/tenantContext.js';
import { resolveTenantTimezone } from '../utils/tenantTimezone.js';
import { recordAudit } from './auditService.js';
import { sendMailOnce, sendMail } from './mailerService.js';
import { configService } from './configService.js';
import { offerSentEmail, documentRequestEmail, documentReuploadEmail, allDocumentsVerifiedEmail, tentativeOfferEmail, hrDocumentSubmittedEmail, onboardingWelcomeEmail } from './emailTemplates.js';
import { notify } from './notificationService.js';
import { logger } from '../config/logger.js';
import { NotFoundError, BadRequestError, ConflictError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import { env } from '../config/env.js';
import { isRecruiterScoped, assignedCandidateWhere } from '../utils/accessScope.js';
import {
  ROLES,
  OFFER_STATUS,
  ONBOARDING_STATUS,
  BGV_STATUS,
  NOTIFICATION_TYPE,
  type OfferFilters,
  type CreateOfferInput,
  type UpdateOfferInput,
  type RespondOfferInput,
  type AddOfferDocumentInput,
  type UpdateOnboardingInput,
  type SetChecklistInput,
  type ToggleChecklistItemInput,
  type OfferListItem,
  type OfferDetail,
  type OnboardingInfo,
  type ChecklistItem,
  CONFIG_KEYS,
  type OfferStatus,
  type OnboardingStatus,
  type BgvStatus,
} from '@agnohire/shared';
import type { Request } from 'express';

export interface OfferContext {
  userId: string;
  role: string;
  sectorId?: string | null;
  permissions: string[];
}

/** Identifies whether a document belongs to the default onboarding set or is an
 *  additional document requested by HR after onboarding has completed. This enum
 *  lets us scope offer-letter generation and email notifications precisely. */
export const enum DocumentCategory {
  DEFAULT_ONBOARDING = 'DEFAULT_ONBOARDING',
  ADDITIONAL_REQUEST = 'ADDITIONAL_REQUEST',
}



async function getDocumentCategory(docName: string): Promise<DocumentCategory> {
  const docsJson = await configService.getString(CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS, '[]');
  let defaultDocs: Array<{ name: string }> = [];
  try {
    defaultDocs = JSON.parse(docsJson);
  } catch (err) { }
  const names = defaultDocs.map(d => d.name);
  return names.includes(docName)
    ? DocumentCategory.DEFAULT_ONBOARDING
    : DocumentCategory.ADDITIONAL_REQUEST;
}

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/** Non-admins only see offers for jobs in their own sector; recruiters are
 *  further narrowed to offers for the candidates allocated to them. */
function offerScope(ctx: OfferContext): Prisma.OfferWhereInput {
  if (isRecruiterScoped(ctx.role)) return { application: { candidate: assignedCandidateWhere(ctx.userId) } };
  if (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) return {};
  if (ctx.sectorId) return { application: { job: { sectorId: ctx.sectorId } } };
  return {};
}

/** Returns a new Date `days` after the given date. */
function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

const DEFAULT_CHECKLIST = [
  'Signed offer letter received',
  'Identity & address proof collected',
  'Background verification cleared',
  'Equipment provisioned',
  'Day-1 orientation scheduled',
];

function newChecklist(labels: string[]): ChecklistItem[] {
  return labels.map((label) => ({ id: randomUUID(), label, done: false, completedAt: null }));
}

function parseChecklist(json: Prisma.JsonValue | null): ChecklistItem[] {
  if (!Array.isArray(json)) return [];
  return (json as unknown[])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      id: String(x.id ?? randomUUID()),
      label: String(x.label ?? ''),
      done: Boolean(x.done),
      completedAt: x.completedAt ? String(x.completedAt) : null,
    }));
}

function dec(v: Prisma.Decimal | null): number | null {
  return v == null ? null : Number(v);
}

// ─── LIST ────────────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true, applicationId: true, status: true, salaryOffered: true, joiningDate: true, validUntil: true, createdAt: true,
  application: {
    select: {
      candidate: { select: { id: true, fullName: true, email: true } },
      job: { select: { id: true, title: true } },
    },
  },
  onboarding: { select: { status: true } },
} satisfies Prisma.OfferSelect;

type RawList = Prisma.OfferGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(o: RawList): OfferListItem {
  return {
    id: o.id,
    applicationId: o.applicationId,
    status: o.status as OfferStatus,
    salaryOffered: dec(o.salaryOffered),
    joiningDate: o.joiningDate?.toISOString() ?? null,
    validUntil: o.validUntil?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    candidate: o.application.candidate,
    job: o.application.job,
    onboardingStatus: (o.onboarding?.status ?? null) as OnboardingStatus | null,
  };
}

export async function listOffers(filters: OfferFilters, ctx: OfferContext) {
  const { page, limit, search, status, sortBy, sortOrder } = filters;
  const and: Prisma.OfferWhereInput[] = [
    offerScope(ctx),
    { deletedAt: null },
    { application: { candidate: { deletedAt: null } } }
  ];
  if (status) and.push({ status });
  if (search) {
    and.push({
      application: {
        candidate: {
          is: {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ]
          }
        }
      },
    });
  }
  const where: Prisma.OfferWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.offer.count({ where }),
    prisma.offer.findMany({ where, select: LIST_SELECT, orderBy: { [sortBy]: sortOrder }, skip: (page - 1) * limit, take: limit }),
  ]);
  return paginate(rows.map(toListItem), total, page, limit);
}

// ─── DETAIL ──────────────────────────────────────────────────────────────────

const DETAIL_SELECT = {
  id: true, status: true, salaryOffered: true, joiningDate: true, validUntil: true,
  offerLetterUrl: true, notes: true, signedAt: true, offeredById: true, createdAt: true, updatedAt: true,
  acceptanceToken: true,
  application: {
    select: {
      candidate: { select: { id: true, fullName: true, email: true, phone: true, currentRole: true } },
      job: { select: { id: true, title: true, budgetMin: true, budgetMax: true } },
    },
  },
  documents: { select: { id: true, name: true, fileUrl: true, type: true, required: true, uploadedAt: true, description: true, maxSizeInt: true, status: true, rejectionReason: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
  onboarding: true,
} satisfies Prisma.OfferSelect;

type RawDetail = Prisma.OfferGetPayload<{ select: typeof DETAIL_SELECT }>;

function toOnboardingInfo(o: RawDetail['onboarding']): OnboardingInfo | null {
  if (!o) return null;
  return {
    id: o.id,
    status: o.status as OnboardingStatus,
    bgvStatus: o.bgvStatus as BgvStatus,
    bgvProvider: o.bgvProvider,
    bgvReportUrl: o.bgvReportUrl,
    checklist: parseChecklist(o.checklistItems),
    completedAt: o.completedAt?.toISOString() ?? null,
  };
}

async function buildDetail(o: RawDetail): Promise<OfferDetail & { initialEmailSent?: boolean }> {
  const offeredBy = o.offeredById
    ? await prisma.user.findUnique({ where: { id: o.offeredById }, select: { fullName: true } })
    : null;
  const prior = await prisma.emailLog.findFirst({
    where: {
      templateId: 'document-request',
      status: 'SENT',
      entityType: 'Offer',
      entityId: o.id,
    },
    select: { id: true },
  });

  const docsJson = await configService.getString(CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS, '[]');
  let defaultDocs: Array<{ name: string }> = [];
  try {
    defaultDocs = JSON.parse(docsJson);
  } catch (err) { }
  const defaultDocNames = defaultDocs.map(d => d.name);

  return {
    id: o.id,
    status: o.status as OfferStatus,
    salaryOffered: dec(o.salaryOffered),
    joiningDate: o.joiningDate?.toISOString() ?? null,
    validUntil: o.validUntil?.toISOString() ?? null,
    offerLetterUrl: o.offerLetterUrl,
    notes: o.notes,
    signedAt: o.signedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    candidate: o.application.candidate,
    job: {
      id: o.application.job.id,
      title: o.application.job.title,
      budgetMin: o.application.job.budgetMin !== null ? Number(o.application.job.budgetMin) : null,
      budgetMax: o.application.job.budgetMax !== null ? Number(o.application.job.budgetMax) : null,
    },
    offeredByName: offeredBy?.fullName ?? null,
    acceptanceToken: o.acceptanceToken,
    documents: o.documents.map((d) => ({
      id: d.id, name: d.name, fileUrl: d.fileUrl, type: d.type, required: d.required,
      uploadedAt: d.uploadedAt?.toISOString() ?? null,
      description: d.description,
      maxSizeInt: d.maxSizeInt,
      status: d.status,
      rejectionReason: d.rejectionReason,
      createdAt: d.createdAt.toISOString(),
      isManual: d.maxSizeInt === null && !defaultDocNames.includes(d.name),
    })),
    onboarding: toOnboardingInfo(o.onboarding),
    initialEmailSent: !!prior,
  };
}

async function findScoped(id: string, ctx: OfferContext): Promise<RawDetail> {
  const o = await prisma.offer.findFirst({ where: { AND: [{ id }, offerScope(ctx)] }, select: DETAIL_SELECT });
  if (!o) throw new NotFoundError('Offer not found');
  return o;
}

export async function getOffer(id: string, ctx: OfferContext): Promise<OfferDetail> {
  return buildDetail(await findScoped(id, ctx));
}

// ─── CREATE / UPDATE ──────────────────────────────────────────────────────────

export async function createOffer(data: CreateOfferInput, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  const app = await prisma.jobApplication.findFirst({
    where: {
      id: data.applicationId,
      ...(isRecruiterScoped(ctx.role)
        ? { candidate: assignedCandidateWhere(ctx.userId) }
        : (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled())
          ? {}
          : ctx.sectorId
            ? { job: { sectorId: ctx.sectorId } }
            : {}),
    },
    select: {
      id: true,
      candidateId: true,
      jobRequisitionId: true,
      candidate: { select: { fullName: true } },
      job: { select: { budgetMin: true } },
    },
  });
  if (!app) throw new NotFoundError('Application not found');

  const existing = await prisma.offer.findFirst({
    where: { applicationId: app.id, status: { in: [OFFER_STATUS.DRAFT, OFFER_STATUS.SENT, OFFER_STATUS.ACCEPTED] } },
    select: { id: true },
  });
  if (existing) throw new ConflictError('An active offer already exists for this application');

  const offer = await prisma.offer.create({
    data: {
      applicationId: app.id,
      candidateId: app.candidateId,
      jobId: app.jobRequisitionId,
      offeredById: ctx.userId,
      status: OFFER_STATUS.DRAFT,
      // Default the offered salary to the job's minimum budget so it's
      // pre-filled; the recruiter can still override it on the draft.
      salaryOffered: data.salaryOffered ?? app.job?.budgetMin ?? null,
      joiningDate: data.joiningDate ?? null,
      validUntil: data.validUntil ?? null,
      offerLetterUrl: data.offerLetterUrl || null,
      notes: data.notes || null,
    },
    select: { id: true },
  });

  await recordAudit(req, { action: 'CREATE', entity: 'Offer', entityId: offer.id, description: `Drafted offer for ${app.candidate.fullName}` });
  return buildDetail(await findScoped(offer.id, ctx));
}

export async function updateOffer(id: string, data: UpdateOfferInput, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  const o = await findScoped(id, ctx);
  const updatesOtherThanJoiningDate =
    data.salaryOffered !== undefined ||
    data.validUntil !== undefined ||
    data.notes !== undefined ||
    data.offerLetterUrl !== undefined;

  if (updatesOtherThanJoiningDate && o.status !== OFFER_STATUS.DRAFT) {
    throw new BadRequestError('Only draft offers can be edited');
  }

  await prisma.offer.update({
    where: { id },
    data: {
      ...(data.salaryOffered !== undefined && { salaryOffered: data.salaryOffered }),
      ...(data.joiningDate !== undefined && { joiningDate: data.joiningDate }),
      ...(data.validUntil !== undefined && { validUntil: data.validUntil }),
      ...(data.offerLetterUrl !== undefined && { offerLetterUrl: data.offerLetterUrl || null }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
    },
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'Offer', entityId: id, description: 'Updated offer details' });
  return buildDetail(await findScoped(id, ctx));
}

// ─── LIFECYCLE ────────────────────────────────────────────────────────────────

export async function sendOffer(id: string, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  const o = await findScoped(id, ctx);
  if (o.status !== OFFER_STATUS.DRAFT) throw new BadRequestError('Only draft offers can be sent');

  const token = randomUUID();
  // On release, default the joining date to 7 days out if it hasn't been set.
  // It's finalised to 7 days after onboarding completion once that happens.
  const tentativeJoining = addDays(new Date(), 7);
  await prisma.offer.update({
    where: { id },
    data: {
      status: OFFER_STATUS.SENT,
      acceptanceToken: token,
      ...(o.joiningDate == null && { joiningDate: tentativeJoining }),
    },
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'Offer', entityId: id, description: 'Sent offer to candidate' });

  // Notify the candidate (graceful no-op when SMTP isn't configured).
  const candidate = o.application.candidate;
  if (candidate?.email) {
    const base = env.clientUrl.replace(/\/+$/, '');
    const acceptUrl = `${base}/offer/accept/${token}`;

    const { subject, html } = await offerSentEmail({
      candidateName: candidate.fullName ?? 'there',
      jobTitle: o.application.job?.title ?? 'the role',
      validUntil: o.validUntil,
      acceptUrl,
      timezone: await resolveTenantTimezone(getTenantContext()?.tenantId),
    });
    const result = await sendMailOnce({ to: candidate.email, subject, html, templateId: 'offer-sent', entityType: 'Offer', entityId: id });
    logger.info('Offer sent notification', { offerId: id, to: candidate.email, emailSent: result.sent });
  }
  return buildDetail(await findScoped(id, ctx));
}

export async function respondOffer(id: string, data: RespondOfferInput, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  const o = await findScoped(id, ctx);
  if (o.status !== OFFER_STATUS.SENT) throw new BadRequestError('Only sent offers can be responded to');

  if (data.status === 'ACCEPTED') {
    // Atomic: marking the offer accepted, creating onboarding, and advancing the
    // application to HIRED must all succeed together — a partial failure would
    // leave an accepted offer with no onboarding or a stuck pipeline stage.
    await tenantTransaction(async (tx) => {
      await tx.offer.update({
        where: { id },
        data: {
          status: OFFER_STATUS.ACCEPTED,
          signedAt: new Date(),
          signerIp: req.ip ?? null,
          eSignatureData: data.signature ? { signature: data.signature, signedAt: new Date().toISOString() } : undefined,
        },
      });
      await tx.onboarding.upsert({
        where: { offerId: id },
        update: {},
        create: {
          offerId: id, candidateId: o.application.candidate.id,
          status: ONBOARDING_STATUS.NOT_STARTED, bgvStatus: BGV_STATUS.PENDING,
          checklistItems: newChecklist(DEFAULT_CHECKLIST) as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.jobApplication.updateMany({ where: { offers: { some: { id } } }, data: { status: 'ONBOARDING', stage: 'HIRED' } });
    });
    await recordAudit(req, { action: 'UPDATE', entity: 'Offer', entityId: id, description: 'Offer accepted — onboarding started, candidate marked ONBOARDING' });
  } else {
    await prisma.offer.update({ where: { id }, data: { status: OFFER_STATUS.DECLINED } });
    await recordAudit(req, { action: 'UPDATE', entity: 'Offer', entityId: id, description: 'Offer declined' });
  }

  // Notify the recruiter who made the offer of the candidate's response.
  if (o.offeredById && o.offeredById !== ctx.userId) {
    const accepted = data.status === 'ACCEPTED';
    await notify({
      recipientId: o.offeredById,
      actorId: ctx.userId,
      type: accepted ? NOTIFICATION_TYPE.OFFER_ACCEPTED : NOTIFICATION_TYPE.OFFER_DECLINED,
      title: accepted ? 'Offer accepted' : 'Offer declined',
      message: `${o.application.candidate.fullName} ${accepted ? 'accepted' : 'declined'} the offer for ${o.application.job?.title ?? 'the role'}.`,
      entityType: 'Offer',
      entityId: id,
    });
  }
  return buildDetail(await findScoped(id, ctx));
}

// ─── DOCUMENTS ──────────────────────────────────────────────────────────────

export async function addDocument(id: string, data: AddOfferDocumentInput, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  await findScoped(id, ctx);
  await prisma.offerDocument.create({
    data: { offerId: id, name: data.name, fileUrl: data.fileUrl, type: data.type, required: data.required, maxSizeInt: data.maxSizeInt, uploadedAt: new Date(), status: 'VERIFIED' },
  });
  await recordAudit(req, { action: 'CREATE', entity: 'OfferDocument', entityId: id, description: `Added document "${data.name}"` });
  return buildDetail(await findScoped(id, ctx));
}

export async function removeDocument(id: string, documentId: string, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  await findScoped(id, ctx);
  await prisma.offerDocument.deleteMany({ where: { id: documentId, offerId: id } });
  await recordAudit(req, { action: 'DELETE', entity: 'OfferDocument', entityId: id, description: `Removed document ${documentId}` });
  return buildDetail(await findScoped(id, ctx));
}

export async function updateDocument(id: string, documentId: string, data: { name: string; fileUrl: string; type: string }, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  await findScoped(id, ctx);
  await prisma.offerDocument.update({
    where: { id: documentId },
    data: { name: data.name, fileUrl: data.fileUrl, type: data.type },
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'OfferDocument', entityId: id, description: `Updated document "${data.name}"` });
  return buildDetail(await findScoped(id, ctx));
}

// ─── ONBOARDING ──────────────────────────────────────────────────────────────

async function requireOnboarding(offerId: string) {
  const ob = await prisma.onboarding.findUnique({ where: { offerId } });
  if (!ob) throw new BadRequestError('Onboarding starts once the offer is accepted');
  return ob;
}

export async function updateOnboarding(id: string, data: UpdateOnboardingInput, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  await findScoped(id, ctx);
  await requireOnboarding(id);
  const completedAt = new Date();
  await prisma.onboarding.update({
    where: { offerId: id },
    data: {
      ...(data.status !== undefined && { status: data.status, ...(data.status === ONBOARDING_STATUS.COMPLETED && { completedAt }) }),
      ...(data.bgvStatus !== undefined && { bgvStatus: data.bgvStatus }),
      ...(data.bgvProvider !== undefined && { bgvProvider: data.bgvProvider || null }),
      ...(data.bgvReportUrl !== undefined && { bgvReportUrl: data.bgvReportUrl || null }),
    },
  });

  if (data.status === ONBOARDING_STATUS.COMPLETED) {
    const docs = await prisma.offerDocument.findMany({
      where: { offerId: id },
    });
    const pendingMandatory = docs.filter(d => d.required && d.status !== 'VERIFIED');
    if (pendingMandatory.length > 0) {
      throw new BadRequestError(
        `Cannot complete onboarding. The following mandatory documents must be verified: ${pendingMandatory.map(d => d.name).join(', ')}`
      );
    }

    await prisma.jobApplication.updateMany({
      where: { offers: { some: { id } } },
      data: {
        status: 'HIRED',
        stage: 'HIRED',
      },
    });

    // Joining date is finalised to 7 days after onboarding completion.
    await prisma.offer.update({
      where: { id },
      data: { joiningDate: addDays(completedAt, 7) },
    });
  }

  await recordAudit(req, { action: 'UPDATE', entity: 'Onboarding', entityId: id, description: 'Updated onboarding' });
  return buildDetail(await findScoped(id, ctx));
}

export async function setChecklist(id: string, data: SetChecklistInput, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  await findScoped(id, ctx);
  await requireOnboarding(id);
  const items: ChecklistItem[] = data.items.map((it) => ({
    id: it.id ?? randomUUID(),
    label: it.label,
    done: it.done ?? false,
    completedAt: it.done ? new Date().toISOString() : null,
  }));
  await prisma.onboarding.update({ where: { offerId: id }, data: { checklistItems: items as unknown as Prisma.InputJsonValue } });
  await recordAudit(req, { action: 'UPDATE', entity: 'Onboarding', entityId: id, description: 'Updated onboarding checklist' });
  return buildDetail(await findScoped(id, ctx));
}

export async function toggleChecklistItem(id: string, data: ToggleChecklistItemInput, ctx: OfferContext, _req: Request): Promise<OfferDetail> {
  await findScoped(id, ctx);
  const ob = await requireOnboarding(id);
  const items = parseChecklist(ob.checklistItems).map((it) =>
    it.id === data.itemId ? { ...it, done: data.done, completedAt: data.done ? new Date().toISOString() : null } : it,
  );
  await prisma.onboarding.update({ where: { offerId: id }, data: { checklistItems: items as unknown as Prisma.InputJsonValue } });
  return buildDetail(await findScoped(id, ctx));
}

// ─── PDF AUTO GENERATION ────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { mkdir } from 'fs/promises';

import { dispatchOfferLetterEmail } from '../jobs/dispatch.js';


export async function generateAndSendTentativeOffer(
  candidateId: string,
  jobId: string,
  offeredById: string,
  salaryOffered?: number,
) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  const job = await prisma.jobRequisition.findUnique({ where: { id: jobId }, include: { domain: true } });
  if (!candidate || !job) throw new Error('Candidate or Job not found');

  const app = await prisma.jobApplication.findFirst({
    where: { candidateId, jobRequisitionId: jobId },
    select: { id: true }
  });
  if (!app) throw new Error('Application not found');

  let offer = await prisma.offer.findFirst({
    where: { applicationId: app.id },
  });

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 7);

  // Default the offered salary to the job's minimum budget, and the joining
  // date to 7 days after this (tentative) release when not already set.
  const resolvedSalary = salaryOffered
    ? new Prisma.Decimal(salaryOffered)
    : job.budgetMin ?? null;
  const tentativeJoining = addDays(new Date(), 7);

  const token = randomUUID();
  if (!offer) {
    offer = await prisma.offer.create({
      data: {
        applicationId: app.id,
        candidateId,
        jobId,
        offeredById,
        status: OFFER_STATUS.TENTATIVE,
        salaryOffered: resolvedSalary,
        joiningDate: tentativeJoining,
        validUntil,
        acceptanceToken: token
      }
    });
  } else {
    offer = await prisma.offer.update({
      where: { id: offer.id },
      data: {
        status: OFFER_STATUS.TENTATIVE,
        salaryOffered: resolvedSalary,
        joiningDate: offer.joiningDate ?? tentativeJoining,
        validUntil,
        acceptanceToken: token
      }
    });
  }

  await prisma.jobApplication.update({
    where: { id: app.id },
    data: { status: 'OFFER', stage: 'OFFER' }
  });

  // Populate document requirements immediately when tentative offer is sent
  const docsJson = await configService.getString(CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS, '[]');
  let defaultDocs: Array<{ name: string; type: string; required: boolean }> = [];
  try {
    defaultDocs = JSON.parse(docsJson);
  } catch (err) {
    logger.error('Failed to parse onboarding required documents config in generateAndSendTentativeOffer', { err, docsJson });
  }

  const existingDocs = await prisma.offerDocument.findMany({
    where: { offerId: offer.id }
  });
  if (existingDocs.length === 0) {
    for (const doc of defaultDocs) {
      await prisma.offerDocument.create({
        data: {
          offerId: offer.id,
          name: doc.name,
          type: doc.type,
          required: doc.required,
          status: 'PENDING',
          maxSizeInt: 5,
        }
      });
    }
  }

  if (candidate.email) {
    const base = env.clientUrl.replace(/\/+$/, '');
    const acceptUrl = `${base}/offer/tentative-accept/${token}`;

    const { subject, html } = await tentativeOfferEmail({
      candidateName: candidate.fullName ?? 'there',
      acceptUrl,
      jobTitle: job.title,
      department: job.domain?.name,
      offerAmount: resolvedSalary ? `₹${Number(resolvedSalary).toLocaleString('en-IN')} per annum` : undefined,
      joiningDate: (offer.joiningDate ?? tentativeJoining).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
    });
    const result = await sendMailOnce({
      to: candidate.email,
      subject,
      html,
      templateId: 'tentative-offer',
      entityType: 'Offer',
      entityId: offer.id
    });
    logger.info('Tentative Offer sent notification', { offerId: offer.id, to: candidate.email, emailSent: result.sent });

    if (candidate.phone) {
      try {
        const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
        await sendWhatsAppIfEnabled({
          phone: candidate.phone,
          template: 'tentative_offer',
          variables: {
            candidateName: candidate.fullName ?? 'there',
            acceptUrl,
            jobTitle: job.title,
            offerAmount: resolvedSalary ? `₹${Number(resolvedSalary).toLocaleString('en-IN')} per annum` : undefined,
            joiningDate: (offer.joiningDate ?? tentativeJoining).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
          },
          preferenceKey: 'tentativeOffer',
        });
      } catch (err: any) {
        logger.error('Failed to send Tentative Offer WhatsApp notification', { error: err.message });
      }
    }
  }
}

export async function resendTentativeOffer(id: string, ctx: OfferContext, req: Request): Promise<OfferDetail> {
  const offer = await findScoped(id, ctx);
  if (offer.status !== OFFER_STATUS.TENTATIVE) {
    throw new BadRequestError('Only tentative offers can be re-sent');
  }

  const candidate = offer.application.candidate;
  if (!candidate.email) {
    throw new BadRequestError('Candidate does not have an email address');
  }

  const base = env.clientUrl.replace(/\/+$/, '');
  const acceptUrl = `${base}/offer/tentative-accept/${offer.acceptanceToken}`;
  const jobTitle = offer.application.job?.title ?? 'the role';

  const { subject, html } = await tentativeOfferEmail({
    candidateName: candidate.fullName ?? 'there',
    acceptUrl,
    jobTitle,
    offerAmount: offer.salaryOffered ? `₹${Number(offer.salaryOffered).toLocaleString('en-IN')} per annum` : undefined,
    joiningDate: offer.joiningDate ? new Date(offer.joiningDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : 'TBD',
  });

  await sendMail({ to: candidate.email, subject, html, templateId: 'tentative-offer', entityType: 'Offer', entityId: offer.id });

  await recordAudit(req, { action: 'UPDATE', entity: 'Offer', entityId: id, description: 'Re-sent tentative offer email to candidate' });

  return buildDetail(await findScoped(id, ctx));
}

export async function acceptTentativeOfferByToken(token: string, req: Request) {
  const offer = await prisma.offer.findUnique({
    where: { acceptanceToken: token },
    include: {
      application: {
        include: {
          candidate: true,
          job: true,
        }
      }
    }
  });

  if (!offer || offer.deletedAt) {
    throw new NotFoundError('Offer not found');
  }

  if (offer.status !== 'TENTATIVE') {
    throw new BadRequestError('This offer is not in a tentative state.');
  }

  const id = offer.id;

  const docsJson = await configService.getString(CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS, '[]');
  let defaultDocs: Array<{ name: string; type: string; required: boolean }> = [];
  try {
    defaultDocs = JSON.parse(docsJson);
  } catch (err) {
    logger.error('Failed to parse onboarding required documents config', { err, docsJson });
  }

  await tenantTransaction(async (tx) => {
    await tx.offer.update({
      where: { id },
      data: {
        status: OFFER_STATUS.DOCUMENTS_PENDING,
      },
    });

    const existing = await tx.offerDocument.findMany({ where: { offerId: id } });
    if (existing.length === 0) {
      for (const doc of defaultDocs) {
        await tx.offerDocument.create({
          data: {
            offerId: id,
            name: doc.name,
            type: doc.type,
            required: doc.required,
            status: 'PENDING',
          }
        });
      }
    }
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'Offer',
    entityId: id,
    description: 'Tentative Offer accepted via email link — waiting for documents',
  });

  // Only send document request email automatically if the flag is enabled.
  // When disabled, HR must send the email manually from the Document tab.
  const automateDocEmail = await configService.getBool(CONFIG_KEYS.OFFER_AUTOMATE_DOCUMENT_EMAIL, true);
  if (automateDocEmail) {
    await sendDocumentRequestEmail(id).catch(err => logger.error('Failed to send document request email', { err: err.message }));
  } else {
    logger.info('acceptTentativeOfferByToken: Automate document email is disabled — skipping automatic send', { offerId: id });
  }

  return { success: true };
}

export async function generateAndSendOfferLetter(
  candidateId: string,
  jobId: string,
  offeredById: string,
  salaryOffered?: number,
  delayMinutes?: number
) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  const job = await prisma.jobRequisition.findUnique({ where: { id: jobId } });
  if (!candidate || !job) throw new Error('Candidate or Job not found');

  const app = await prisma.jobApplication.findFirst({
    where: { candidateId, jobRequisitionId: jobId },
    select: { id: true }
  });
  if (!app) throw new Error('Application not found');

  const companyName = await configService.getString(CONFIG_KEYS.COMPANY_NAME, 'Our Company');
  const referenceNumber = `OFFER-${candidateId.substring(0, 6).toUpperCase()}-${Date.now().toString().slice(-6)}`;

  // Check if an offer already exists
  let offer = await prisma.offer.findFirst({
    where: { applicationId: app.id },
  });

  const pdfDir = join(process.cwd(), 'uploads', 'offers');
  await mkdir(pdfDir, { recursive: true });
  const fileName = `offer_${candidateId}_${Date.now()}.pdf`;
  const pdfPath = join(pdfDir, fileName);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = createWriteStream(pdfPath);
    doc.pipe(stream);

    doc.fontSize(22).text(companyName, { align: 'center' });
    doc.moveDown();
    doc.fontSize(20).text('OFFER OF EMPLOYMENT', { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(10).text(`Reference: ${referenceNumber}`, { align: 'right' });
    doc.fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();
    doc.text(`Dear ${candidate.fullName},`);
    doc.moveDown();
    doc.text(`We are pleased to offer you the position of ${job.title} with ${companyName}.`);

    if (salaryOffered) {
      doc.moveDown();
      doc.text(`Your starting salary will be $${salaryOffered.toLocaleString()} per year.`);
    }

    doc.moveDown();
    doc.text('We look forward to welcoming you to the team!');
    doc.moveDown(4);
    doc.text('Sincerely,');
    doc.moveDown();
    doc.text('Human Resources Department');

    doc.end();

    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 7); // Valid for 7 days

  const token = randomUUID();
  if (!offer) {
    offer = await prisma.offer.create({
      data: {
        applicationId: app.id,
        candidateId,
        jobId,
        offeredById,
        status: OFFER_STATUS.SENT,
        salaryOffered: salaryOffered ? new Prisma.Decimal(salaryOffered) : null,
        validUntil,
        offerLetterUrl: `/uploads/offers/${fileName}`,
        acceptanceToken: token
      }
    });
  } else {
    offer = await prisma.offer.update({
      where: { id: offer.id },
      data: {
        status: OFFER_STATUS.SENT,
        salaryOffered: salaryOffered ? new Prisma.Decimal(salaryOffered) : null,
        validUntil,
        offerLetterUrl: `/uploads/offers/${fileName}`,
        acceptanceToken: token
      }
    });
  }

  // Update application to OFFER
  await prisma.jobApplication.update({
    where: { id: app.id },
    data: { status: 'OFFER', stage: 'OFFER' }
  });

  if (candidate.email) {
    const defaultDelay = await configService.getNumber('offer.email_delay_minutes' as any, 0);
    const delay = delayMinutes !== undefined ? delayMinutes : defaultDelay;

    await dispatchOfferLetterEmail(offer.id, delay);
  }
}

export async function sendOfferLetterEmail(offerId: string) {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      application: {
        include: {
          candidate: true,
          job: true,
        }
      }
    }
  });

  if (!offer || !offer.application.candidate.email || !offer.offerLetterUrl) {
    return;
  }

  const base = env.clientUrl.replace(/\/+$/, '');
  const acceptUrl = offer.acceptanceToken ? `${base}/offer/accept/${offer.acceptanceToken}` : undefined;

  const { subject, html } = await offerSentEmail({
    candidateName: offer.application.candidate.fullName ?? 'there',
    jobTitle: offer.application.job.title ?? 'the role',
    validUntil: offer.validUntil,
    acceptUrl,
    timezone: await resolveTenantTimezone((offer as { tenantId?: string | null }).tenantId),
  });

  const pdfPath = join(process.cwd(), offer.offerLetterUrl);

  await sendMail({
    to: offer.application.candidate.email,
    subject,
    html,
    attachments: [{
      filename: 'Offer_Letter.pdf',
      path: pdfPath
    }]
  });

  if (offer.application.candidate.phone) {
    try {
      const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
      const base = env.clientUrl.replace(/\/+$/, '');
      const pdfUrl = `${base}${offer.offerLetterUrl}`;

      await sendWhatsAppIfEnabled({
        phone: offer.application.candidate.phone,
        template: 'offer_sent',
        variables: {
          candidateName: offer.application.candidate.fullName ?? 'there',
          jobTitle: offer.application.job.title ?? 'the role',
          acceptUrl,
        },
        preferenceKey: 'offerLetter',
        pdfAttachments: [{
          filename: 'Offer_Letter.pdf',
          link: pdfUrl,
        }]
      });
    } catch (err: any) {
      logger.error('Failed to send Offer Letter WhatsApp notification', { error: err.message });
    }
  }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function deleteOffer(id: string, ctx: OfferContext, req: Request) {
  const o = await findScoped(id, ctx);
  await tenantTransaction(async (tx) => {
    await tx.offerDocument.deleteMany({ where: { offerId: id } });
    await tx.offer.delete({ where: { id } });
  });
  await recordAudit(req, {
    action: 'DELETE',
    entity: 'Offer',
    entityId: id,
    description: `Deleted offer for candidate ${o.application.candidate.fullName}`,
  });
}

export async function getPublicOfferByToken(token: string) {
  const offer = await prisma.offer.findUnique({
    where: { acceptanceToken: token },
    include: {
      application: {
        include: {
          candidate: true,
          job: true,
        }
      }
    }
  });

  if (!offer || offer.deletedAt) {
    throw new NotFoundError('Offer not found');
  }

  const alreadyAccepted = offer.status === 'ACCEPTED';
  const expired = offer.validUntil ? new Date() > new Date(offer.validUntil) : false;

  return {
    candidateName: offer.application.candidate.fullName,
    jobTitle: offer.application.job?.title ?? 'the role',
    validUntil: offer.validUntil,
    alreadyAccepted,
    expired,
  };
}

export async function acceptPublicOfferByToken(token: string, req: Request) {
  const offer = await prisma.offer.findUnique({
    where: { acceptanceToken: token },
    include: {
      application: {
        include: {
          candidate: true,
          job: {
            include: {
              domain: true,
            },
          },
        }
      }
    }
  });

  if (!offer || offer.deletedAt) {
    throw new NotFoundError('Offer not found');
  }

  if (offer.status === 'ACCEPTED') {
    throw new BadRequestError('This offer has already been accepted.');
  }

  if (offer.validUntil && new Date() > new Date(offer.validUntil)) {
    throw new BadRequestError('This offer has expired. Please contact HR.');
  }

  const id = offer.id;

  await tenantTransaction(async (tx) => {
    await tx.offer.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        signedAt: new Date(),
        signerIp: req.ip ?? null,
      },
    });
    await tx.candidate.update({
      where: { id: offer.candidateId },
      data: {
        offerAccepted: true,
        offerAcceptedDate: new Date(),
      },
    });
    await tx.onboarding.upsert({
      where: { offerId: id },
      update: {},
      create: {
        offerId: id,
        candidateId: offer.candidateId,
        status: ONBOARDING_STATUS.NOT_STARTED,
        bgvStatus: BGV_STATUS.PENDING,
        checklistItems: newChecklist(DEFAULT_CHECKLIST) as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.jobApplication.updateMany({
      where: { offers: { some: { id } } },
      data: {
        status: 'ONBOARDING',
        stage: 'HIRED',
      },
    });
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'Offer',
    entityId: id,
    description: 'Offer accepted via email link — onboarding started, candidate marked ONBOARDING',
  });

  if (offer.offeredById) {
    await notify({
      recipientId: offer.offeredById,
      type: NOTIFICATION_TYPE.OFFER_ACCEPTED,
      title: 'Offer accepted',
      message: `${offer.application.candidate.fullName} accepted the offer for ${offer.application.job?.title ?? 'the role'}.`,
      entityType: 'Offer',
      entityId: id,
    });
  }

  const candidate = offer.application.candidate;

  // ─── Onboarding Welcome Email ──────────────────────────────────────────────
  if (candidate.email) {
    try {
      const { subject: welcomeSubject, html: welcomeHtml } = await onboardingWelcomeEmail({
        candidateName: candidate.fullName,
        joiningDate: offer.joiningDate ? offer.joiningDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : 'to be decided',
        reportingTime: '09:30 AM',
        officeLocation: offer.application.job.location || 'HQ Office',
        managerName: 'HR Operations',
        startOnboardingUrl: `${env.clientUrl.replace(/\/+$/, '')}/public/offer/documents/${token}`,
      });
      await sendMailOnce({
        to: candidate.email,
        subject: welcomeSubject,
        html: welcomeHtml,
        templateId: 'onboarding-welcome',
        entityType: 'Offer',
        entityId: id,
      }, true);
    } catch (err: any) {
      logger.error('Failed to send onboarding welcome email', { err: err.message });
    }
  }

  // ─── WhatsApp Notifications ────────────────────────────────────────────────
  if (candidate.phone) {
    try {
      const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');

      // 1. Offer Accepted WhatsApp
      await sendWhatsAppIfEnabled({
        phone: candidate.phone,
        template: 'offer_accepted',
        variables: {
          candidateName: candidate.fullName,
          jobTitle: offer.application.job.title ?? 'the role',
        },
        preferenceKey: 'offerAccepted',
      });

      // 2. Onboarding Welcome WhatsApp
      await sendWhatsAppIfEnabled({
        phone: candidate.phone,
        template: 'onboarding_welcome',
        variables: {
          candidateName: candidate.fullName,
        },
        preferenceKey: 'onboarding',
      });
    } catch (err: any) {
      logger.error('Failed to send WhatsApp notifications for final offer acceptance', { error: err.message });
    }
  }

  return { success: true };
}

export async function sendDocumentRequestEmail(offerId: string, documentIds?: string[]) {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      application: {
        include: {
          candidate: true,
        },
      },
      documents: true,
    },
  });

  if (!offer || !offer.application.candidate.email) return;

  // Rule 1 & 2 Checks:
  // 1. Offer must have been tentative-accepted (so it is not in DRAFT or TENTATIVE status)
  if (offer.status === 'DRAFT' || offer.status === 'TENTATIVE') {
    logger.info('sendDocumentRequestEmail: Skipping because offer is still DRAFT or TENTATIVE', { offerId, status: offer.status });
    return;
  }

  // 2. Do not send if candidate has already accepted the final offer (status is ACCEPTED) unless specific documents are requested
  if (offer.status === 'ACCEPTED' && (!documentIds || documentIds.length === 0)) {
    logger.info('sendDocumentRequestEmail: Skipping because final offer is already accepted', { offerId, status: offer.status });
    return;
  }

  const candidate = offer.application.candidate;
  let token = offer.acceptanceToken;
  if (!token) {
    token = randomUUID();
    await prisma.offer.update({
      where: { id: offerId },
      data: { acceptanceToken: token },
    });
  }

  const base = env.clientUrl.replace(/\/+$/, '');
  const uploadUrl = `${base}/public/offer/documents/${token}`;

  let targetDocs: typeof offer.documents = [];
  let isAdditional = false;

  if (documentIds && documentIds.length > 0) {
    // Specific documents requested
    targetDocs = offer.documents.filter(d => documentIds.includes(d.id));

    // If any of these specific documents are rejected, send re-upload emails individually.
    const rejectedDocs = targetDocs.filter(d => d.status === 'REJECTED');
    if (rejectedDocs.length > 0) {
      for (const rejDoc of rejectedDocs) {
        const rejUrl = `${uploadUrl}?docs=${rejDoc.id}`;
        const { subject, html } = await documentReuploadEmail({
          candidateName: candidate.fullName,
          uploadUrl: rejUrl,
          documentName: rejDoc.name,
          rejectionReason: rejDoc.rejectionReason ?? 'Please re-upload the correct document.',
        });
        await sendMailOnce({
          to: candidate.email!,
          subject,
          html,
          templateId: 'document-reupload',
          entityType: 'Offer',
          entityId: offerId,
        }, true);

        if (candidate.phone) {
          try {
            const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
            await sendWhatsAppIfEnabled({
              phone: candidate.phone,
              template: 'document_reupload',
              variables: {
                candidateName: candidate.fullName,
                uploadUrl: rejUrl,
                documentName: rejDoc.name,
                rejectionReason: rejDoc.rejectionReason ?? 'Please re-upload the correct document.',
                isAdditional: true,
              },
              preferenceKey: 'documentUpload',
            });
          } catch (err: any) {
            logger.error('Failed to send Document Re-upload WhatsApp notification', { error: err.message });
          }
        }
      }

      // Filter out rejected ones since they already got emails, keep only PENDING docs for the combined email
      targetDocs = targetDocs.filter(d => d.status === 'PENDING');
      if (targetDocs.length === 0) return;
    }

    isAdditional = (await getDocumentCategory(targetDocs[0]?.name)) === DocumentCategory.ADDITIONAL_REQUEST;
  } else {
    // General "Send Email" button — iterate all offer documents (status-based logic)
    const defaultDocs: typeof offer.documents = [];
    for (const d of offer.documents) {
      if ((await getDocumentCategory(d.name)) === DocumentCategory.DEFAULT_ONBOARDING) {
        defaultDocs.push(d);
      }
    }
    const allDefaultsVerified = defaultDocs.every(d => d.status === 'VERIFIED');

    if (!allDefaultsVerified) {
      // Focus on default documents
      targetDocs = defaultDocs;
      isAdditional = false;

      const rejectedDocs = targetDocs.filter(d => d.status === 'REJECTED');
      if (rejectedDocs.length > 0) {
        for (const rejDoc of rejectedDocs) {
          const { subject, html } = await documentReuploadEmail({
            candidateName: candidate.fullName,
            uploadUrl,
            documentName: rejDoc.name,
            rejectionReason: rejDoc.rejectionReason ?? 'Please re-upload the correct document.',
          });
          await sendMailOnce({
            to: candidate.email!,
            subject,
            html,
            templateId: 'document-reupload',
            entityType: 'Offer',
            entityId: offerId,
          }, true);

          if (candidate.phone) {
            try {
              const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
              await sendWhatsAppIfEnabled({
                phone: candidate.phone,
                template: 'document_reupload',
                variables: {
                  candidateName: candidate.fullName,
                  uploadUrl,
                  documentName: rejDoc.name,
                  rejectionReason: rejDoc.rejectionReason ?? 'Please re-upload the correct document.',
                },
                preferenceKey: 'documentUpload',
              });
            } catch (err: any) {
              logger.error('Failed to send Document Re-upload WhatsApp notification', { error: err.message });
            }
          }
        }
        return;
      }
    } else {
      // Default docs are all verified. Focus on additional requested docs that need action
      const additionalDocs: typeof offer.documents = [];
      for (const d of offer.documents) {
        if ((await getDocumentCategory(d.name)) === DocumentCategory.ADDITIONAL_REQUEST) {
          additionalDocs.push(d);
        }
      }
      const actionableAdditional = additionalDocs.filter(d =>
        d.status === 'PENDING' || d.status === 'REJECTED'
      );

      if (actionableAdditional.length === 0) {
        logger.info('sendDocumentRequestEmail: No actionable documents to send email for', { offerId });
        return;
      }

      targetDocs = actionableAdditional;
      isAdditional = true;

      const rejectedDocs = targetDocs.filter(d => d.status === 'REJECTED');
      if (rejectedDocs.length > 0) {
        for (const rejDoc of rejectedDocs) {
          const rejUrl = `${uploadUrl}?docs=${rejDoc.id}`;
          const { subject, html } = await documentReuploadEmail({
            candidateName: candidate.fullName,
            uploadUrl: rejUrl,
            documentName: rejDoc.name,
            rejectionReason: rejDoc.rejectionReason ?? 'Please re-upload the correct document.',
          });
          await sendMailOnce({
            to: candidate.email!,
            subject,
            html,
            templateId: 'document-reupload',
            entityType: 'Offer',
            entityId: offerId,
          }, true);

          if (candidate.phone) {
            try {
              const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
              await sendWhatsAppIfEnabled({
                phone: candidate.phone,
                template: 'document_reupload',
                variables: {
                  candidateName: candidate.fullName,
                  uploadUrl: rejUrl,
                  documentName: rejDoc.name,
                  rejectionReason: rejDoc.rejectionReason ?? 'Please re-upload the correct document.',
                  isAdditional: true,
                },
                preferenceKey: 'documentUpload',
              });
            } catch (err: any) {
              logger.error('Failed to send Document Re-upload WhatsApp notification', { error: err.message });
            }
          }
        }
        return;
      }
    }
  }

  if (targetDocs.length === 0) return;

  const reqUrl = `${uploadUrl}?docs=${targetDocs.map(d => d.id).join(',')}`;
  const { subject, html } = await documentRequestEmail({
    candidateName: candidate.fullName,
    uploadUrl: reqUrl,
    documents: targetDocs.map(d => ({ name: d.name, required: d.required })),
  });

  await sendMailOnce({
    to: candidate.email,
    subject,
    html,
    templateId: 'document-request',
    entityType: 'Offer',
    entityId: offerId,
  }, true);

  if (candidate.phone) {
    try {
      const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
      await sendWhatsAppIfEnabled({
        phone: candidate.phone,
        template: 'document_request',
        variables: {
          candidateName: candidate.fullName,
          uploadUrl: reqUrl,
          documentName: targetDocs[0]?.name,
          isAdditional,
        },
        preferenceKey: 'documentUpload',
      });
    } catch (err: any) {
      logger.error('Failed to send Document Request WhatsApp notification', { error: err.message });
    }
  }
}

export async function createDocumentRequirement(
  offerId: string,
  data: {
    name: string;
    description?: string;
    required?: boolean;
    type: string;
    maxSizeInt?: number;
  },
  ctx: OfferContext,
  req: Request
) {
  await findScoped(offerId, ctx);
  const requirement = await prisma.offerDocument.create({
    data: {
      offerId,
      name: data.name,
      description: data.description || null,
      required: data.required ?? false,
      type: data.type,
      maxSizeInt: data.maxSizeInt ?? 5,
      status: 'PENDING',
    },
  });

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'OfferDocument',
    entityId: requirement.id,
    description: `Created document requirement "${data.name}" for offer ${offerId}`,
  });

  return buildDetail(await findScoped(offerId, ctx));
}

export async function getCandidateDocumentsPortal(token: string) {
  const offer = await prisma.offer.findUnique({
    where: { acceptanceToken: token },
    include: {
      application: {
        include: {
          candidate: true,
          job: true,
        },
      },
      documents: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!offer || offer.deletedAt) {
    throw new NotFoundError('Offer not found');
  }

  const hasPendingRequestedDocs = offer.documents.some(d => ['PENDING', 'REJECTED'].includes(d.status));
  const isAllowedStatus = ['DOCUMENTS_PENDING', 'DOCUMENTS_SUBMITTED', 'DOCUMENTS_VERIFIED', 'ACCEPTED'].includes(offer.status);

  if (!isAllowedStatus && !hasPendingRequestedDocs) {
    throw new BadRequestError('Offer must be in document collection stage before uploading documents.');
  }

  return {
    offerId: offer.id,
    candidateName: offer.application.candidate.fullName,
    jobTitle: offer.application.job?.title ?? 'the role',
    validUntil: offer.validUntil,
    status: offer.status,
    documents: offer.documents.map(d => ({
      id: d.id,
      name: d.name,
      description: d.description,
      required: d.required,
      type: d.type,
      maxSizeInt: d.maxSizeInt,
      status: d.status,
      fileUrl: d.fileUrl,
      uploadedAt: d.uploadedAt?.toISOString() ?? null,
      rejectionReason: d.rejectionReason,
    })),
  };
}

export async function uploadCandidateDocument(
  token: string,
  documentId: string,
  data: { fileUrl: string },
  req: Request
) {
  const offer = await prisma.offer.findUnique({
    where: { acceptanceToken: token },
    include: {
      application: {
        include: {
          candidate: true,
          job: true,
        },
      },
    },
  });

  if (!offer || offer.deletedAt) {
    throw new NotFoundError('Offer not found');
  }

  const doc = await prisma.offerDocument.findFirst({
    where: { id: documentId, offerId: offer.id },
  });

  if (!doc) {
    throw new NotFoundError('Document requirement not found');
  }

  const updatedDoc = await prisma.offerDocument.update({
    where: { id: documentId },
    data: {
      fileUrl: data.fileUrl,
      uploadedAt: new Date(),
      status: 'UPLOADED',
      rejectionReason: null,
    },
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'OfferDocument',
    entityId: documentId,
    description: `Candidate uploaded document "${doc.name}"`,
  });

  const allDocs = await prisma.offerDocument.findMany({
    where: { offerId: offer.id }
  });
  const pendingDocs = allDocs.filter(d => d.required && (d.status === 'PENDING' || d.status === 'REJECTED'));

  if (offer.status !== OFFER_STATUS.ACCEPTED && pendingDocs.length === 0 && offer.status !== OFFER_STATUS.DOCUMENTS_SUBMITTED) {
    await prisma.offer.update({
      where: { id: offer.id },
      data: { status: OFFER_STATUS.DOCUMENTS_SUBMITTED }
    });

    const job = offer.application.job;
    const base = env.clientUrl.replace(/\/+$/, '');
    const reviewUrl = `${base}/offers/${offer.id}`;

    if (offer.offeredById) {
      const hrUser = await prisma.user.findUnique({ where: { id: offer.offeredById } });
      if (hrUser && hrUser.email) {
        const { subject, html } = await hrDocumentSubmittedEmail({
          candidateName: offer.application.candidate.fullName,
          jobTitle: job?.title ?? 'the role',
          submissionDate: new Date(),
          uploadedCount: allDocs.length,
          reviewUrl,
          timezone: await resolveTenantTimezone((offer as { tenantId?: string | null }).tenantId),
        });
        await sendMailOnce({
          to: hrUser.email,
          subject,
          html,
          templateId: 'hr-document-submitted',
          entityType: 'Offer',
          entityId: offer.id
        });
      }
    }
  }

  return { success: true, document: updatedDoc };
}

export async function verifyDocument(
  offerId: string,
  documentId: string,
  ctx: OfferContext,
  req: Request
) {
  await findScoped(offerId, ctx);
  const doc = await prisma.offerDocument.findFirst({
    where: { id: documentId, offerId },
  });
  if (!doc) throw new NotFoundError('Document not found');

  await prisma.offerDocument.update({
    where: { id: documentId },
    data: {
      status: 'VERIFIED',
      verifiedById: ctx.userId,
      verifiedAt: new Date(),
    },
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'OfferDocument',
    entityId: documentId,
    description: `Verified document "${doc.name}"`,
  });

  // ── Classify all documents by category ──────────────────────────────────
  const allDocs = await prisma.offerDocument.findMany({ where: { offerId } });

  const onboardingDocs: typeof allDocs = [];
  const additionalDocs: typeof allDocs = [];
  for (const d of allDocs) {
    if ((await getDocumentCategory(d.name)) === DocumentCategory.DEFAULT_ONBOARDING) {
      onboardingDocs.push(d);
    } else {
      additionalDocs.push(d);
    }
  }

  const allOnboardingVerified =
    onboardingDocs.length > 0 && onboardingDocs.every(d => d.status === 'VERIFIED');
  const allAdditionalVerified =
    additionalDocs.length > 0 && additionalDocs.every(d => d.status === 'VERIFIED');

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { application: { include: { candidate: true } } },
  });

  if (offer && offer.application.candidate.email) {
    const category = await getDocumentCategory(doc.name);

    if (category === DocumentCategory.DEFAULT_ONBOARDING && allOnboardingVerified) {
      if (offer.status !== OFFER_STATUS.ACCEPTED && offer.status !== OFFER_STATUS.DOCUMENTS_VERIFIED) {
        await prisma.offer.update({
          where: { id: offerId },
          data: { status: OFFER_STATUS.DOCUMENTS_VERIFIED },
        });
      }
    } else if (category === DocumentCategory.ADDITIONAL_REQUEST && allAdditionalVerified) {
      // ── Send a targeted "additional docs verified" confirmation ───────────
      const { subject, html } = await allDocumentsVerifiedEmail({
        candidateName: offer.application.candidate.fullName,
      });
      await sendMailOnce({
        to: offer.application.candidate.email,
        subject,
        html,
        templateId: 'additional-documents-verified',
        entityType: 'Offer',
        entityId: offerId,
      }, true);

      if (offer.application.candidate.phone) {
        try {
          const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
          await sendWhatsAppIfEnabled({
            phone: offer.application.candidate.phone,
            template: 'documents_verified',
            variables: {
              candidateName: offer.application.candidate.fullName,
              isAdditional: true,
            },
            preferenceKey: 'onboarding',
          });
        } catch (err: any) {
          logger.error('Failed to send Additional Documents Verified WhatsApp notification', { error: err.message });
        }
      }
    }
  }

  return buildDetail(await findScoped(offerId, ctx));
}

export async function rejectDocument(
  offerId: string,
  documentId: string,
  data: { reason: string },
  ctx: OfferContext,
  req: Request
) {
  const o = await findScoped(offerId, ctx);
  const doc = await prisma.offerDocument.findFirst({
    where: { id: documentId, offerId },
  });
  if (!doc) throw new NotFoundError('Document not found');

  await prisma.offerDocument.update({
    where: { id: documentId },
    data: {
      status: 'REJECTED',
      rejectionReason: data.reason,
    },
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'OfferDocument',
    entityId: documentId,
    description: `Rejected document "${doc.name}". Reason: ${data.reason}`,
  });

  const candidate = o.application.candidate;
  if (candidate.email && o.acceptanceToken) {
    const base = env.clientUrl.replace(/\/+$/, '');
    const uploadUrl = `${base}/public/offer/documents/${o.acceptanceToken}?docs=${doc.id}`;

    const { subject, html } = await documentReuploadEmail({
      candidateName: candidate.fullName,
      uploadUrl,
      documentName: doc.name,
      rejectionReason: data.reason,
    });

    await sendMailOnce({
      to: candidate.email,
      subject,
      html,
      templateId: 'document-reupload',
      entityType: 'Offer',
      entityId: offerId,
    }, true);
  }

  if (candidate.phone && o.acceptanceToken) {
    try {
      const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
      const base = env.clientUrl.replace(/\/+$/, '');
      const uploadUrl = `${base}/public/offer/documents/${o.acceptanceToken}?docs=${doc.id}`;
      const isAdditional = (await getDocumentCategory(doc.name)) === DocumentCategory.ADDITIONAL_REQUEST;
      await sendWhatsAppIfEnabled({
        phone: candidate.phone,
        template: 'document_reupload',
        variables: {
          candidateName: candidate.fullName,
          uploadUrl,
          documentName: doc.name,
          rejectionReason: data.reason,
          isAdditional,
        },
        preferenceKey: 'documentUpload',
      });
    } catch (err: any) {
      logger.error('Failed to send Document Re-upload WhatsApp notification', { error: err.message });
    }
  }

  return buildDetail(await findScoped(offerId, ctx));
}

export async function sendFinalOfferLetter(
  offerId: string,
  ctx: OfferContext,
  req: Request
): Promise<OfferDetail> {
  await findScoped(offerId, ctx);

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { application: { include: { candidate: true } } },
  });
  if (!offer) throw new NotFoundError('Offer not found');



  // Update offer status to DOCUMENTS_VERIFIED if not already
  if (offer.status !== OFFER_STATUS.ACCEPTED && offer.status !== OFFER_STATUS.DOCUMENTS_VERIFIED) {
    await prisma.offer.update({
      where: { id: offerId },
      data: { status: OFFER_STATUS.DOCUMENTS_VERIFIED },
    });
  }

  // Generate and send the PDF offer letter
  if (offer.jobId && offer.offeredById) {
    await generateAndSendOfferLetter(
      offer.application.candidate.id,
      offer.jobId,
      offer.offeredById,
      offer.salaryOffered ? Number(offer.salaryOffered) : undefined
    );
  }

  // Send "documents verified" confirmation email
  if (offer.application.candidate.email) {
    const { subject, html } = await allDocumentsVerifiedEmail({
      candidateName: offer.application.candidate.fullName,
    });
    await sendMailOnce({
      to: offer.application.candidate.email,
      subject,
      html,
      templateId: 'documents-verified',
      entityType: 'Offer',
      entityId: offerId,
    });
  }

  // Send WhatsApp notification
  if (offer.application.candidate.phone) {
    try {
      const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
      await sendWhatsAppIfEnabled({
        phone: offer.application.candidate.phone,
        template: 'documents_verified',
        variables: {
          candidateName: offer.application.candidate.fullName,
        },
        preferenceKey: 'onboarding',
      });
    } catch (err: any) {
      logger.error('Failed to send Default Documents Verified WhatsApp notification', { error: err.message });
    }
  }

  // Record audit log
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'Offer',
    entityId: offerId,
    description: 'Manually sent final offer letter to candidate',
  });

  return buildDetail(await findScoped(offerId, ctx));
}

export async function reorderDocuments(
  offerId: string,
  documentIds: string[],
  ctx: OfferContext,
  req: Request
) {
  await findScoped(offerId, ctx);

  await tenantTransaction(async (tx) => {
    await Promise.all(
      documentIds.map((id, index) =>
        tx.offerDocument.updateMany({
          where: { id, offerId },
          data: { order: index }
        })
      )
    );
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'OfferDocument',
    entityId: offerId,
    description: `Reordered document requirements`,
  });

  return buildDetail(await findScoped(offerId, ctx));
}
