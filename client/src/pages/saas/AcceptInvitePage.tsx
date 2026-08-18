import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { acceptInvite } from '../../services/billingApi.js';
import { apiErrorMessage } from '../../services/api.js';

interface FormValues {
  fullName: string;
  password: string;
}

/** Public: invitee sets name + password using the emailed token (?token=...). */
export function AcceptInvitePage() {
  const [showPassword, setShowPassword] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = async (values: FormValues) => {
    try {
      await acceptInvite({ token, ...values });
      toast.success('Invitation accepted — sign in with your new password.');
      navigate('/login');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not accept the invitation'));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-text-primary">Join your team</h1>
        <p className="mb-6 text-sm text-text-secondary">
          Set up your account to accept the invitation.
        </p>
        {!token ? (
          <p className="text-sm text-text-secondary">Missing invite token — use the link from your email.</p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-text-secondary">Full name</label>
              <Input {...register('fullName', { required: 'Your name is required' })} />
              {errors.fullName && <p className="mt-1 text-xs text-danger">{errors.fullName.message}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-text-secondary">Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  className="pr-10"
                  {...register('password', {
                    required: 'Password is required',
                    minLength: { value: 8, message: 'At least 8 characters' },
                  })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-danger">{errors.password.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              Accept invitation
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

export default AcceptInvitePage;
