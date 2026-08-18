import { Router } from 'express';
import passport from 'passport';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { attachmentUpload } from '../utils/storage.js';
import { devLoginSchema } from '@agnohire/shared';
import * as auth from '../controllers/auth.controller.js';

const router = Router();

router.get('/config', auth.authConfig);
router.post('/dev-login', validate(devLoginSchema), asyncHandler(auth.devLogin));
router.post('/refresh', asyncHandler(auth.refresh));
router.post('/logout', authenticate, asyncHandler(auth.logout));
router.get('/me', authenticate, asyncHandler(auth.me));
router.get('/memberships', authenticate, asyncHandler(auth.memberships));
router.post('/switch-workspace', authenticate, asyncHandler(auth.switchWorkspace));
router.get('/profile', authenticate, asyncHandler(auth.profile));
router.patch('/profile', authenticate, asyncHandler(auth.updateProfile));
router.post('/change-password', authenticate, asyncHandler(auth.changePassword));
router.post(
  '/profile/avatar',
  authenticate,
  attachmentUpload.single('file'),
  asyncHandler(auth.uploadAvatar),
);
router.delete('/profile/avatar', authenticate, asyncHandler(auth.removeAvatar));
// Public — avatar image must load in an <img> without an auth header.
router.get('/avatar/:id', asyncHandler(auth.serveAvatar));

// Google OAuth — only mounted when configured.
if (env.google.enabled) {
  router.get(
    '/google',
    passport.authenticate('google', { scope: ['profile', 'email'], session: false }),
  );
  router.get(
    '/google/callback',
    passport.authenticate('google', {
      session: false,
      failureRedirect: `${env.clientUrl}/login?error=oauth_failed`,
    }),
    asyncHandler(auth.googleCallback),
  );
}

export default router;
