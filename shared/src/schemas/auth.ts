import { z } from 'zod';

/** Dev-only email/password login (used when Google OAuth is not configured). */
export const devLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});
export type DevLoginInput = z.infer<typeof devLoginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Authenticated self-service password change — used both for the voluntary
 *  "change my password" flow and the forced first-login reset. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'New password must be different from your current password',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Self-service profile edit. All fields optional; empty string clears a field. */
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(''));

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required').max(120).optional(),
  phone: optionalText(40),
  jobTitle: optionalText(120),
  department: optionalText(120),
  location: optionalText(120),
  gender: optionalText(40),
  bio: optionalText(1000),
  address: optionalText(300),
  // ISO date string (YYYY-MM-DD) or empty to clear.
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Switch the signed-in user's current Workspace — server re-validates membership before re-issuing tokens. */
export const switchWorkspaceSchema = z.object({
  workspaceId: z.string().uuid(),
});
export type SwitchWorkspaceInput = z.infer<typeof switchWorkspaceSchema>;
