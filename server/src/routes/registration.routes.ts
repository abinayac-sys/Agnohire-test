import { Router } from 'express';
import {
  registerTenantSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '@agnohire/shared';
import {
  registerTenant,
  verifyEmail,
  resendVerification,
  requestPasswordReset,
  resetPasswordWithToken,
} from '../services/tenantProvisioningService.js';
import { ok } from '../utils/response.js';

/**
 * Public self-service tenant registration (mounted under /api/auth alongside
 * the existing auth routes — additive, no existing route changed).
 */
const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const input = registerTenantSchema.parse(req.body);
    const result = await registerTenant(input);
    return ok(res, result, 201);
  } catch (err) {
    next(err);
  }
});

router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = verifyEmailSchema.parse(req.body);
    return ok(res, await verifyEmail(token));
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', async (req, res, next) => {
  try {
    const { email } = resendVerificationSchema.parse(req.body);
    return ok(res, await resendVerification(email));
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    return ok(res, await requestPasswordReset(email));
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);
    return ok(res, await resetPasswordWithToken(token, password));
  } catch (err) {
    next(err);
  }
});

export default router;
