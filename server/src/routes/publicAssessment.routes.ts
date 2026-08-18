import { Router } from 'express';
import * as publicAssessment from '../controllers/publicAssessment.controller.js';
import { tenantScopeFromToken } from '../middlewares/publicTenantScope.middleware.js';

// PUBLIC — token-based, no authentication (candidate-facing). Relies on the
// global /api rate limiter. Mounted at /assessment (singular).
const router = Router();

// SaaS: derive the tenant context from the assignment token (see middleware).
router.param('token', tenantScopeFromToken('assessment'));

router.get('/:token', publicAssessment.getAssessment);
router.post('/:token/start', publicAssessment.start);
router.post('/:token/answer', publicAssessment.answer);
router.post('/:token/violation', publicAssessment.violation);
router.post('/:token/snapshot', publicAssessment.snapshot);
router.post('/:token/recording', publicAssessment.recording);
router.post('/:token/submit', publicAssessment.submit);

export default router;
