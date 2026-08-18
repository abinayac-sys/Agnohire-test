import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { BadRequestError } from '../utils/errors.js';
import { parseSpreadsheet } from '../utils/parseSpreadsheet.js';
import * as candidateService from '../services/candidateService.js';
import * as candidateListService from '../services/candidateListService.js';
import type { CandidateContext } from '../services/candidateService.js';
import type { CsvRow } from '../services/bulkUploadService.js';

function ctx(req: Request): CandidateContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

// ─── CANDIDATES ──────────────────────────────────────────────────────────────

export const getCandidateStats = asyncHandler(async (req: Request, res: Response) => {
  const jobRequisitionId = req.query.jobRequisitionId as string | undefined;
  const stats = await candidateService.getCandidateStats({ jobRequisitionId }, ctx(req));
  return ok(res, { stats });
});

export const listCandidates = asyncHandler(async (req: Request, res: Response) => {
  const { candidateFiltersSchema } = await import('@agnohire/shared');
  const filters = candidateFiltersSchema.parse(req.query);
  const result = await candidateService.listCandidates(filters, ctx(req));
  return ok(res, result);
});

export const getCandidate = asyncHandler(async (req: Request, res: Response) => {
  const candidate = await candidateService.getCandidate(req.params.id, ctx(req));
  return ok(res, { candidate });
});

export const searchCandidates = asyncHandler(async (req: Request, res: Response) => {
  const { candidateSearchSchema } = await import('@agnohire/shared');
  const filters = candidateSearchSchema.parse(req.query);
  const result = await candidateService.searchCandidates(filters, ctx(req));
  return ok(res, result);
});

export const createCandidate = asyncHandler(async (req: Request, res: Response) => {
  const { createCandidateSchema } = await import('@agnohire/shared');
  const data = createCandidateSchema.parse(req.body);
  const candidate = await candidateService.createCandidate(data, ctx(req), req);
  return ok(res, { candidate }, 201);
});

export const updateCandidate = asyncHandler(async (req: Request, res: Response) => {
  const { updateCandidateSchema } = await import('@agnohire/shared');
  const data = updateCandidateSchema.parse(req.body);
  const candidate = await candidateService.updateCandidate(req.params.id, data, ctx(req), req);
  return ok(res, { candidate });
});

export const deleteCandidate = asyncHandler(async (req: Request, res: Response) => {
  await candidateService.deleteCandidate(req.params.id, ctx(req), req);
  return ok(res, { deleted: true });
});

// ─── RESUMES ─────────────────────────────────────────────────────────────────

export const uploadResume = asyncHandler(async (req: Request, res: Response) => {
  const resume = await candidateService.uploadResume(req.params.id, req.file, ctx(req), req);
  return ok(res, { resume }, 201);
});

export const importResumeFromUrl = asyncHandler(async (req: Request, res: Response) => {
  const { importResumeUrlSchema } = await import('@agnohire/shared');
  const { url } = importResumeUrlSchema.parse(req.body);
  const resume = await candidateService.importResumeFromUrl(req.params.id, url, ctx(req), req);
  return ok(res, { resume }, 201);
});

export const downloadResume = asyncHandler(async (req: Request, res: Response) => {
  const { fileName, mimeType, buffer } = await candidateService.getResumeFile(
    req.params.id,
    req.params.resumeId,
    ctx(req),
  );
  res.setHeader('Content-Type', mimeType);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(fileName)}"`,
  );
  res.send(buffer);
});

export const reparseResume = asyncHandler(async (req: Request, res: Response) => {
  await candidateService.reparseResume(req.params.id, req.params.resumeId, ctx(req));
  return ok(res, { queued: true });
});

export const deleteResume = asyncHandler(async (req: Request, res: Response) => {
  await candidateService.deleteResume(req.params.id, req.params.resumeId, ctx(req), req);
  return ok(res, { deleted: true });
});

// ─── BULK UPLOAD (candidate lists) ──────────────────────────────────────────── // reload

export const uploadCandidateList = asyncHandler(async (req: Request, res: Response) => {
  const { createCandidateListSchema } = await import('@agnohire/shared');
  const { name, jobRequisitionId, assignedTo } = createCandidateListSchema.parse(req.body);
  if (!req.file) throw new BadRequestError('No CSV/Excel file was uploaded');

  const rows = parseSpreadsheet(req.file.buffer, req.file.originalname);

  await candidateListService.assertJobAccessible(jobRequisitionId, ctx(req));
  const list = await candidateListService.createBulkList(name, rows, ctx(req), req, jobRequisitionId, assignedTo);
  return ok(res, { list }, 201);
});

export const importCandidateListFromAttachment = asyncHandler(async (req: Request, res: Response) => {
  const { attachmentId, name, jobRequisitionId, assignedTo } = req.body;
  if (!attachmentId) throw new BadRequestError('attachmentId is required');

  const { getAttachmentBytesById } = await import('../services/attachmentService.js');
  const attachment = await getAttachmentBytesById(attachmentId);
  if (!attachment) throw new BadRequestError('Attachment not found or empty');

  const rows = parseSpreadsheet(attachment.buffer, attachment.fileName);
  const listName = name || `Bulk Import (${attachment.fileName})`;

  await candidateListService.assertJobAccessible(jobRequisitionId, ctx(req));
  const list = await candidateListService.createBulkList(listName, rows, ctx(req), req, jobRequisitionId, assignedTo);
  return ok(res, { list }, 201);
});

export const previewCandidateList = asyncHandler(async (req: Request, res: Response) => {
  const { createCandidateListSchema } = await import('@agnohire/shared');
  const { jobRequisitionId } = createCandidateListSchema.parse(req.body);
  if (!req.file) throw new BadRequestError('No CSV/Excel file was uploaded');

  const rows = parseSpreadsheet(req.file.buffer, req.file.originalname);

  await candidateListService.assertJobAccessible(jobRequisitionId, ctx(req));
  const bulkUploadService = await import('../services/bulkUploadService.js');
  const preview = await bulkUploadService.previewCandidateList(rows, ctx(req), jobRequisitionId);
  return ok(res, preview);
});

export const uploadSmartCandidateList = asyncHandler(async (req: Request, res: Response) => {
  const { smartUploadCandidateListSchema } = await import('@agnohire/shared');
  const { name, jobRequisitionId, candidates, assignedTo } = smartUploadCandidateListSchema.parse(req.body);

  await candidateListService.assertJobAccessible(jobRequisitionId, ctx(req));
  const list = await candidateListService.createSmartBulkList(name, candidates, ctx(req), req, jobRequisitionId, assignedTo);
  return ok(res, { list }, 201);
});

export const listCandidateLists = asyncHandler(async (req: Request, res: Response) => {
  const { candidateListFiltersSchema } = await import('@agnohire/shared');
  const filters = candidateListFiltersSchema.parse(req.query);
  const result = await candidateListService.listCandidateLists(filters, ctx(req));
  return ok(res, result);
});

export const getCandidateList = asyncHandler(async (req: Request, res: Response) => {
  const list = await candidateListService.getCandidateList(req.params.listId, ctx(req));
  return ok(res, { list });
});

export const deleteCandidateList = asyncHandler(async (req: Request, res: Response) => {
  const cascade = req.query.cascade === 'true';
  await candidateListService.deleteCandidateList(req.params.listId, ctx(req), req, cascade);
  return ok(res, { deleted: true });
});

// ─── CURATED LISTS ────────────────────────────────────────────────────────

export const createCuratedList = asyncHandler(async (req: Request, res: Response) => {
  const { createCuratedListSchema } = await import('@agnohire/shared');
  const { name } = createCuratedListSchema.parse(req.body);
  const list = await candidateListService.createCuratedList(name, ctx(req), req);
  return ok(res, { list }, 201);
});

export const getListMembers = asyncHandler(async (req: Request, res: Response) => {
  const members = await candidateListService.getListMembers(req.params.listId, ctx(req));
  return ok(res, { members });
});

export const addListItems = asyncHandler(async (req: Request, res: Response) => {
  const { listItemsSchema } = await import('@agnohire/shared');
  const { candidateIds } = listItemsSchema.parse(req.body);
  const list = await candidateListService.addListItems(req.params.listId, candidateIds, ctx(req), req);
  return ok(res, { list });
});

export const removeListItems = asyncHandler(async (req: Request, res: Response) => {
  const { listItemsSchema } = await import('@agnohire/shared');
  const { candidateIds } = listItemsSchema.parse(req.body);
  const list = await candidateListService.removeListItems(req.params.listId, candidateIds, ctx(req), req);
  return ok(res, { list });
});

export const assignList = asyncHandler(async (req: Request, res: Response) => {
  const { assignListSchema } = await import('@agnohire/shared');
  const { recruiterId } = assignListSchema.parse(req.body);
  const result = await candidateListService.assignListToRecruiter(
    req.params.listId,
    recruiterId,
    ctx(req),
    req,
  );
  return ok(res, result);
});

export const assignJobToList = asyncHandler(async (req: Request, res: Response) => {
  const { assignJobToListSchema } = await import('@agnohire/shared');
  const { jobRequisitionId } = assignJobToListSchema.parse(req.body);
  const result = await candidateListService.assignJobToList(
    req.params.listId,
    jobRequisitionId,
    ctx(req),
    req,
  );
  return ok(res, result);
});

// ─── ASSIGNMENT ─────────────────────────────────────────────────────────────

export const assignCandidate = asyncHandler(async (req: Request, res: Response) => {
  const { assignCandidateSchema } = await import('@agnohire/shared');
  const { recruiterId } = assignCandidateSchema.parse(req.body);
  const assignment = await candidateService.assignCandidate(req.params.id, recruiterId, ctx(req), req);
  return ok(res, { assignment }, 201);
});

export const unassignCandidate = asyncHandler(async (req: Request, res: Response) => {
  await candidateService.unassignCandidate(req.params.id, ctx(req), req);
  return ok(res, { unassigned: true });
});

export const uploadCsvToExistingList = asyncHandler(async (req: Request, res: Response) => {
  const { listId } = req.params;
  if (!req.file) {
    console.error('uploadCsvToExistingList: No file in req.file');
    throw new BadRequestError('No CSV file was uploaded');
  }

  const { prisma } = await import('../config/database.js');
  const { NotFoundError } = await import('../utils/errors.js');

  const list = await prisma.candidateList.findFirst({
    where: { id: listId }
  });
  if (!list) {
    console.error(`uploadCsvToExistingList: List not found for ID ${listId}`);
    throw new NotFoundError('Candidate list not found');
  }

  let rows: CsvRow[];
  try {
    rows = parseSpreadsheet(req.file.buffer, req.file.originalname);
  } catch (err) {
    console.error('uploadCsvToExistingList: file parsing failed', err);
    throw err;
  }

  if (rows.length === 0) {
    console.error('uploadCsvToExistingList: CSV is empty');
    throw new BadRequestError('The uploaded file has no data rows');
  }
  if (rows.length > 5000) {
    console.error(`uploadCsvToExistingList: CSV too large (${rows.length} rows)`);
    throw new BadRequestError('A single upload is limited to 5000 rows');
  }

  try {
    await prisma.candidateList.update({
      where: { id: listId },
      data: {
        totalCount: { increment: rows.length },
        status: 'PROCESSING'
      }
    });

    const { recordAudit } = await import('../services/auditService.js');
    await recordAudit(req, {
      action: 'UPLOAD',
      entity: 'CandidateList',
      entityId: listId,
      description: `Uploaded CSV containing ${rows.length} rows to list "${list.name}"`,
    });

    const { dispatchBulkUpload } = await import('../jobs/dispatch.js');
    await dispatchBulkUpload(listId, rows, null);
  } catch (err) {
    console.error('uploadCsvToExistingList: DB/Dispatch failed', err);
    throw err;
  }

  return ok(res, { success: true }, 200);
});

// ─── APPLICATIONS ─────────────────────────────────────────────────────────────

export const listApplications = asyncHandler(async (req: Request, res: Response) => {
  const { applicationFiltersSchema } = await import('@agnohire/shared');
  const filters = applicationFiltersSchema.parse(req.query);
  const result = await candidateService.listApplications(filters, ctx(req));
  return ok(res, result);
});

export const createApplication = asyncHandler(async (req: Request, res: Response) => {
  const { createApplicationSchema } = await import('@agnohire/shared');
  const data = createApplicationSchema.parse(req.body);
  const application = await candidateService.createApplication(data, ctx(req), req);
  return ok(res, { application }, 201);
});

export const updateApplication = asyncHandler(async (req: Request, res: Response) => {
  const { updateApplicationSchema } = await import('@agnohire/shared');
  const data = updateApplicationSchema.parse(req.body);
  const application = await candidateService.updateApplication(req.params.id, data, ctx(req), req);
  return ok(res, { application });
});

/** Run a synchronous AI fit-score and return the result. */
export const scoreApplication = asyncHandler(async (req: Request, res: Response) => {
  const { scoreApplicationSchema } = await import('@agnohire/shared');
  const { force } = scoreApplicationSchema.parse(req.body ?? {});
  const fit = await candidateService.scoreApplicationForCtx(req.params.id, force, ctx(req));
  return ok(res, { fit });
});

export const deleteApplication = asyncHandler(async (req: Request, res: Response) => {
  await candidateService.deleteApplication(req.params.id, ctx(req), req);
  return ok(res, { deleted: true });
});

export const exportCandidatesCsv = asyncHandler(async (req: Request, res: Response) => {
  const { candidateFiltersSchema } = await import('@agnohire/shared');
  const filters = candidateFiltersSchema.parse(req.query);
  const { buffer, filename } = await candidateService.generateCandidatesExcel(filters, ctx(req));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export const exportCandidatesPdf = asyncHandler(async (req: Request, res: Response) => {
  const { candidateFiltersSchema } = await import('@agnohire/shared');
  const filters = candidateFiltersSchema.parse(req.query);
  const { generateCandidatesPDF } = await import('../services/pdfReportService.js');
  const { buffer, filename } = await generateCandidatesPDF(filters, ctx(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});
