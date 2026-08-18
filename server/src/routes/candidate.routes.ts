import { Router } from 'express';
import { authenticate, restoreTenantContext } from '../middlewares/auth.middleware.js';
import { requirePermission, requireAnyPermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import { resumeUpload, csvUpload } from '../utils/storage.js';
import * as candidate from '../controllers/candidate.controller.js';

const router = Router();

router.use(authenticate);

// ─── Static routes first (before /:id) ────────────────────────────────────
router.get('/stats', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.getCandidateStats);
router.get('/search', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.searchCandidates);

// ─── CANDIDATE LISTS (bulk import + curated) — before /:id ────────────────
router.get('/lists', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.listCandidateLists);
router.post(
  '/lists',
  requirePermission(PERMISSIONS.CANDIDATE_UPLOAD),
  csvUpload.single('file'),
  restoreTenantContext,
  candidate.uploadCandidateList,
);
router.post(
  '/lists/import-attachment',
  requirePermission(PERMISSIONS.CANDIDATE_UPLOAD),
  candidate.importCandidateListFromAttachment,
);
router.post(
  '/lists/:listId/upload-csv',
  requirePermission(PERMISSIONS.CANDIDATE_UPLOAD),
  csvUpload.single('file'),
  candidate.uploadCsvToExistingList,
);
router.post(
  '/lists/preview',
  requirePermission(PERMISSIONS.CANDIDATE_UPLOAD),
  csvUpload.single('file'),
  restoreTenantContext,
  candidate.previewCandidateList,
);
router.post(
  '/lists/smart',
  requirePermission(PERMISSIONS.CANDIDATE_UPLOAD),
  candidate.uploadSmartCandidateList,
);
router.post('/lists/curated', requirePermission(PERMISSIONS.SOURCING_MANAGE), candidate.createCuratedList);
router.get('/lists/:listId', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.getCandidateList);
router.delete('/lists/:listId', requirePermission(PERMISSIONS.SOURCING_MANAGE), candidate.deleteCandidateList);
router.get('/lists/:listId/members', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.getListMembers);
router.post('/lists/:listId/items', requirePermission(PERMISSIONS.SOURCING_MANAGE), candidate.addListItems);
router.delete('/lists/:listId/items', requirePermission(PERMISSIONS.SOURCING_MANAGE), candidate.removeListItems);
router.post('/lists/:listId/assign', requirePermission(PERMISSIONS.CANDIDATE_ASSIGN), candidate.assignList);
router.post('/lists/:listId/assign-job', requireAnyPermission(PERMISSIONS.CANDIDATE_EDIT, PERMISSIONS.CANDIDATE_ASSIGN, PERMISSIONS.SOURCING_MANAGE), candidate.assignJobToList);

// ─── CANDIDATE CRUD ─────────────────────────────────────────────────────────
router.get('/', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.listCandidates);
router.post('/', requirePermission(PERMISSIONS.CANDIDATE_CREATE), candidate.createCandidate);
router.get('/export/csv', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.exportCandidatesCsv);
router.get('/export/pdf', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.exportCandidatesPdf);
router.get('/:id', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.getCandidate);
router.patch('/:id', requirePermission(PERMISSIONS.CANDIDATE_EDIT), candidate.updateCandidate);
router.delete('/:id', requirePermission(PERMISSIONS.CANDIDATE_EDIT), candidate.deleteCandidate);

// ─── ASSIGNMENT ─────────────────────────────────────────────────────────────
router.post('/:id/assign', requirePermission(PERMISSIONS.CANDIDATE_ASSIGN), candidate.assignCandidate);
router.delete('/:id/assign', requirePermission(PERMISSIONS.CANDIDATE_ASSIGN), candidate.unassignCandidate);

// ─── RESUMES (nested) ─────────────────────────────────────────────────────
router.post(
  '/:id/resumes',
  requirePermission(PERMISSIONS.CANDIDATE_EDIT),
  resumeUpload.single('file'),
  restoreTenantContext,
  candidate.uploadResume,
);
router.post(
  '/:id/resumes/from-url',
  requirePermission(PERMISSIONS.CANDIDATE_EDIT),
  candidate.importResumeFromUrl,
);
router.get(
  '/:id/resumes/:resumeId/download',
  requirePermission(PERMISSIONS.CANDIDATE_VIEW),
  candidate.downloadResume,
);
router.post(
  '/:id/resumes/:resumeId/reparse',
  requirePermission(PERMISSIONS.CANDIDATE_EDIT),
  candidate.reparseResume,
);
router.delete(
  '/:id/resumes/:resumeId',
  requirePermission(PERMISSIONS.CANDIDATE_EDIT),
  candidate.deleteResume,
);

export default router;
