import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';
import { ROLES } from '@agnohire/shared';
import * as portal from '../controllers/candidatePortal.controller.js';

const router = Router();

// All candidate-portal endpoints require a signed-in candidate; data is scoped
// to their own linked candidate profile (resolved server-side, never trusted
// from the client).
router.use(authenticate, requireRole(ROLES.CANDIDATE));

router.get('/interviews', portal.listMyInterviews);
router.get('/interviews/:id/report', portal.downloadMyReport);
router.get('/applications', portal.listMyApplications);
router.get('/offers', portal.listMyOffers);

export default router;
