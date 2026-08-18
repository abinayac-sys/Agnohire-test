import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as offer from '../controllers/offer.controller.js';

const router = Router();
router.use(authenticate);

router.get('/onboarding-documents/config', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.getOnboardingDocumentsConfig);
router.put('/onboarding-documents/config', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.updateOnboardingDocumentsConfig);

router.get('/', requirePermission(PERMISSIONS.OFFER_VIEW), offer.listOffers);
router.get('/:id', requirePermission(PERMISSIONS.OFFER_VIEW), offer.getOffer);

// Offer composing & lifecycle.
router.post('/', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.createOffer);
router.patch('/:id', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.updateOffer);
router.delete('/:id', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.deleteOffer);
router.post('/:id/send', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.sendOffer);
router.post('/:id/respond', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.respondOffer);

// Documents.
router.post('/:id/documents', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.addDocument);
router.delete('/:id/documents/:documentId', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.removeDocument);
router.put('/:id/documents/:documentId', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.updateDocument);
router.post('/:id/documents/requirements', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.createDocumentRequirement);
router.put('/:id/documents/reorder', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.reorderDocuments);
router.post('/:id/documents/send-email', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.sendDocumentRequestEmail);
router.post('/:id/send-final-offer-letter', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.sendFinalOfferLetter);
router.post('/:id/documents/:documentId/verify', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.verifyDocument);
router.post('/:id/documents/:documentId/reject', requirePermission(PERMISSIONS.OFFER_MANAGE), offer.rejectDocument);

// Onboarding (post-acceptance).
router.patch('/:id/onboarding', requirePermission(PERMISSIONS.ONBOARDING_MANAGE), offer.updateOnboarding);
router.put('/:id/onboarding/checklist', requirePermission(PERMISSIONS.ONBOARDING_MANAGE), offer.setChecklist);
router.patch('/:id/onboarding/checklist/item', requirePermission(PERMISSIONS.ONBOARDING_MANAGE), offer.toggleChecklistItem);

export default router;
