import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as sourcing from '../controllers/sourcing.controller.js';

const router = Router();

router.use(authenticate);

// ─── REFERRALS ────────────────────────────────────────────────────────────────
router.get('/referrals', requirePermission(PERMISSIONS.SOURCING_VIEW), sourcing.listReferrals);
router.post('/referrals', requirePermission(PERMISSIONS.SOURCING_VIEW), sourcing.createReferral);
router.patch('/referrals/:id', requirePermission(PERMISSIONS.REFERRAL_MANAGE), sourcing.updateReferral);
router.delete('/referrals/:id', requirePermission(PERMISSIONS.REFERRAL_MANAGE), sourcing.deleteReferral);

// ─── SOURCING CHANNELS ────────────────────────────────────────────────────────
router.get('/channels', requirePermission(PERMISSIONS.SOURCING_VIEW), sourcing.listChannels);
router.post('/channels', requirePermission(PERMISSIONS.SOURCING_MANAGE), sourcing.createChannel);
router.patch('/channels/:id', requirePermission(PERMISSIONS.SOURCING_MANAGE), sourcing.updateChannel);
router.post('/channels/:id/sync', requirePermission(PERMISSIONS.SOURCING_MANAGE), sourcing.syncChannel);
router.delete('/channels/:id', requirePermission(PERMISSIONS.SOURCING_MANAGE), sourcing.deleteChannel);

export default router;
