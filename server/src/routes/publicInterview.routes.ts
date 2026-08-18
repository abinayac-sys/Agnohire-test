import { Router } from 'express';
import * as pub from '../controllers/publicInterview.controller.js';
import { tenantScopeFromToken } from '../middlewares/publicTenantScope.middleware.js';

/**
 * PUBLIC, token-authenticated interview route — intentionally NO `authenticate`.
 * Access is gated by the high-entropy accessToken in the URL. The global
 * config-driven rate limiter (mounted on /api in app.ts) applies here too.
 */
const router = Router();

// SaaS: derive the tenant context from the interview token so all downstream
// DB access in these handlers is tenant-scoped and tenant-stamped.
router.param('token', tenantScopeFromToken('interview'));

router.get('/:token', pub.getInterview);
router.post('/:token/start', pub.start);
router.post('/:token/answer', pub.answer);
router.post('/:token/violation', pub.violation);
router.post('/:token/snapshot', pub.snapshot);
router.post('/:token/recording', pub.recording);
router.post('/:token/submit', pub.submit);
router.post('/:token/biometric/enroll', pub.biometricEnroll);
router.post('/:token/biometric/verify', pub.biometricVerify);
router.post('/:token/execute', pub.executeCodeHandler);
router.post('/:token/run-tests', pub.runTestsHandler);

export default router;
