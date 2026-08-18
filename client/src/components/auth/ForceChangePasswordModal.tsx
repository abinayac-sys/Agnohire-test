import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { useAuthStore } from '../../store/authStore.js';
import { apiErrorMessage } from '../../services/api.js';

interface FormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Blocking, non-dismissable modal shown right after login when
 * `user.mustChangePassword` is set — i.e. this account's current password
 * was chosen by a platform operator (superadmin), either when the tenant
 * was provisioned or via an admin-triggered reset. The operator therefore
 * knows that password; this is the account holder's one required step to
 * replace it with one only they know. No close button, no backdrop-click
 * dismiss — it clears itself only once authStore.changePassword() succeeds.
 */
export function ForceChangePasswordModal() {
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const user = useAuthStore((s) => s.user);
  const changePassword = useAuthStore((s) => s.changePassword);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  if (!user?.mustChangePassword) return null;

  const onSubmit = async (values: FormValues) => {
    try {
      await changePassword(values);
      toast.success('Password updated — you\'re all set.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update your password'));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-change-password-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl sm:p-8">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h1 id="force-change-password-title" className="text-lg font-semibold text-text-primary">
              Set a new password
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Your current password was set by a platform administrator, so
              it's known outside this account. For your security, choose a
              new one that only you know before continuing.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-text-secondary">Current password</label>
            <div className="relative">
              <Input
                type={showCurrent ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus
                className="pr-10"
                {...register('currentPassword', { required: 'Current password is required' })}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                onClick={() => setShowCurrent(!showCurrent)}
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.currentPassword && (
              <p className="mt-1 text-xs text-danger">{errors.currentPassword.message}</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-secondary">New password</label>
            <div className="relative">
              <Input
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                className="pr-10"
                {...register('newPassword', {
                  required: 'New password is required',
                  minLength: { value: 8, message: 'At least 8 characters' },
                  validate: (v) => v !== watch('currentPassword') || 'Choose a password different from your current one',
                })}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                onClick={() => setShowNew(!showNew)}
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.newPassword && <p className="mt-1 text-xs text-danger">{errors.newPassword.message}</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-secondary">Confirm new password</label>
            <div className="relative">
              <Input
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                className="pr-10"
                {...register('confirmPassword', {
                  required: 'Please confirm your new password',
                  validate: (v) => v === watch('newPassword') || 'Passwords do not match',
                })}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                onClick={() => setShowConfirm(!showConfirm)}
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-danger">{errors.confirmPassword.message}</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Updating…' : 'Set new password'}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default ForceChangePasswordModal;
