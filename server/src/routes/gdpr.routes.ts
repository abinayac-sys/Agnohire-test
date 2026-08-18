import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as gdpr from '../controllers/gdpr.controller.js';

const router = Router();

router.use(authenticate, requirePermission(PERMISSIONS.GDPR_MANAGE));

router.get('/summary', gdpr.getSummary);

// Requests (static before any :id).
router.get('/requests', gdpr.listRequests);
router.post('/requests', gdpr.createRequest);
router.post('/requests/:id/process', gdpr.processRequest);

// Consent.
router.get('/consent', gdpr.listConsent);
router.post('/consent', gdpr.setConsent);

// Retention policies.
router.get('/retention', gdpr.listRetention);
router.post('/retention', gdpr.upsertRetention);
router.delete('/retention/:id', gdpr.deleteRetention);

// Direct candidate data export.
router.get('/export/:candidateId', gdpr.exportCandidate);

export default router;
