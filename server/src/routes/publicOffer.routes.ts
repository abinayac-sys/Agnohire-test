import { Router } from 'express';
import * as publicOffer from '../controllers/publicOffer.controller.js';
import { attachmentUpload } from '../utils/storage.js';
import { tenantScopeFromToken } from '../middlewares/publicTenantScope.middleware.js';

// PUBLIC — token-based, no authentication (candidate-facing).
// Mounted at /offer (singular).
const router = Router();

// SaaS: derive the tenant context from the offer/document token (see middleware).
router.param('token', tenantScopeFromToken('offer'));

router.get('/accept/:token', publicOffer.getOfferInfo);
router.post('/accept/:token', publicOffer.acceptOffer);

router.get('/tentative-accept/:token', publicOffer.getOfferInfo);
router.post('/tentative-accept/:token', publicOffer.acceptTentativeOffer);

// Candidate document portal routes (public)
router.get('/documents/:token', publicOffer.getCandidateDocuments);
router.post('/documents/:token/file', attachmentUpload.single('file'), publicOffer.uploadCandidateFile);
router.post('/documents/:token/upload/:documentId', publicOffer.uploadCandidateDocument);

export default router;
