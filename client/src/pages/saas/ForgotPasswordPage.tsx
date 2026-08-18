import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { requestPasswordReset } from '../../services/billingApi.js';
import { apiErrorMessage } from '../../services/api.js';

interface FormValues {
  email: string;
}

/** Public: request a password reset link by email. */
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = async (values: FormValues) => {
    try {
      await requestPasswordReset(values.email.trim());
      setSent(true);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not send reset email'));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-text-primary">Reset your password</h1>
        <p className="mb-6 text-sm text-text-secondary">
          Enter your account email and we'll send you a link to reset your password.
        </p>
        {sent ? (
          <p className="text-sm text-text-secondary">
            If an account exists for that email, a reset link is on its way. Check your inbox.
          </p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-text-secondary">Email</label>
              <Input
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                {...register('email', { required: 'Email is required' })}
              />
              {errors.email && <p className="mt-1 text-xs text-danger">{errors.email.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              Send reset link
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-text-secondary">
          <Link to="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default ForgotPasswordPage;
