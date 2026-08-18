import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../store/authStore.js';
import { useThemeStore } from '../store/themeStore.js';
import { fetchAuthMethods, type AuthMethods } from '../services/auth.service.js';
import { apiErrorMessage } from '../services/api.js';
import { ROLE_HOME } from '@agnohire/shared';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { DEFAULT_LOGO, DEFAULT_LOGO_DARK, DEFAULT_LOGIN_BACKGROUND, hexLuminance } from '../config/brand.js';
import { withTenant } from '../utils/tenantPath.js';

interface FormValues {
  email: string;
  password: string;
}

export function LoginPage({ previewMode = false }: { previewMode?: boolean } = {}) {
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.loginWithPassword);
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const companyName = useThemeStore((s) => s.companyName);
  const appIcon = useThemeStore((s) => s.appIcon);
  // Admin theme upload wins; otherwise fall back to the bundled brand banner.
  const loginBackground = useThemeStore((s) => s.loginBackground) ?? DEFAULT_LOGIN_BACKGROUND;
  const tokens = useThemeStore((s) => s.tokens);
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const params = new URLSearchParams(location.search);
  const isPreviewParam = params.get('preview') === 'true';
  const activePreview = previewMode || isPreviewParam;

  useEffect(() => {
    fetchAuthMethods().then(setMethods).catch(() => setMethods(null));
  }, []);

  // Already authenticated → bounce to role home.
  useEffect(() => {
    if (activePreview) return;
    const isPreview = params.get('preview') === 'true';
    if (status === 'authenticated' && user && !isPreview) {
      const target =
        (location.state as { from?: string } | null)?.from ?? withTenant(ROLE_HOME[user.role], user.tenantSlug);
      navigate(target, { replace: true });
    }
  }, [status, user, navigate, location.state, location.search, activePreview]);

  const onSubmit = async (values: FormValues) => {
    if (activePreview) return;
    try {
      await login(values.email, values.password);
      toast.success('Welcome back');
    } catch (err) {
      const message = apiErrorMessage(err, 'Login failed');
      // Pending-approval is a "come back later" state — surface it as a
      // longer-lived popup toast so it reads as a warning, not an inline banner.
      if (/under review|not approved/i.test(message)) toast.error(message, { duration: 6000 });
      else toast.error(message);
    }
  };

  // The official logo carries the wordmark, so we show it on its own (no
  // duplicate company-name heading) over the tagline. On a dark page background
  // the default logo swaps to its white variant for readability.
  const lum = hexLuminance(tokens.bg) ?? hexLuminance(tokens.surface);
  const brandLogo = appIcon ?? (lum !== null && lum < 128 ? DEFAULT_LOGO_DARK : DEFAULT_LOGO);
  const brandHeader = (
    <div className="animate-fade-up mb-8 flex flex-col items-center text-center">
      <img
        src={brandLogo}
        alt={companyName}
        // Intrinsic size of the default logo (760×216). Providing width/height
        // gives the element an aspect-ratio box so `h-20 w-auto` reserves the
        // correct width BEFORE the image loads — otherwise the unsized img
        // briefly paints at the browser's default box and visibly stretches.
        width={760}
        height={216}
        className="mb-4 h-20 w-auto max-w-[18rem] rounded-2xl object-contain"
      />
      <p className="mt-2 text-sm text-text-secondary">Enterprise AI Recruitment Platform</p>
    </div>
  );

  const formBody = (
    <>
      {methods?.googleEnabled && (
        <a
          href={activePreview ? undefined : "/api/auth/google"}
          onClick={(e) => activePreview && e.preventDefault()}
          className={`mb-4 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm font-medium text-text-primary ${
            activePreview ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-raised'
          }`}
        >
          Continue with Google
        </a>
      )}

      {methods?.googleEnabled && methods?.devLoginEnabled && (
        <div className="my-4 flex items-center gap-3 text-xs text-text-muted">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>
      )}

      {methods?.devLoginEnabled !== false && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-text-secondary">Email</label>
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              disabled={activePreview}
              {...register('email', { required: 'Email is required' })}
            />
            {errors.email && <p className="mt-1 text-xs text-danger">{errors.email.message}</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-secondary">Password</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                disabled={activePreview}
                className="pr-10"
                {...register('password', { required: 'Password is required' })}
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
            {errors.password && (
              <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
            )}
          </div>
          <Button type="submit" className="w-full" loading={isSubmitting} disabled={activePreview}>
            Sign in
          </Button>
          <div className="text-center">
            <Link
              to={activePreview ? '#' : '/forgot-password'}
              tabIndex={activePreview ? -1 : 0}
              className="text-xs text-accent hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </form>
      )}

      {/* SaaS self-service: create a new company workspace (plan + payment) */}
      <p className="mt-4 text-center text-sm text-text-secondary">
        New to AgnoHire?{' '}
        <Link to="/register" className="font-medium text-accent hover:underline">
          Create your workspace
        </Link>
      </p>
    </>
  );

  const blueThemeStyles = {
    '--color-accent': '#2563eb',
    '--color-accent-hover': '#1d4ed8',
    '--color-accent-muted': '#eff6ff',
    '--color-accent-fg': '#ffffff',
    '--color-text-primary': '#0f172a',
    '--color-text-secondary': '#475569',
    '--color-text-muted': '#94a3b8',
    '--color-border': '#e2e8f0',
    '--color-surface': '#ffffff',
    '--color-surface-overlay': '#f8fafc',
  } as React.CSSProperties;

  const formCard = (
    <div className="card animate-fade-up p-8 shadow-elev-3 [animation-delay:0.12s]">{formBody}</div>
  );

  // Branded background: the full banner fills the screen and the sign-in box
  // floats in the banner's open right-hand area. The banner already carries the
  // logo + tagline, so we drop the duplicate header here.
  if (loginBackground) {
    return (
      <div 
        className="relative min-h-screen overflow-hidden"
        style={{ backgroundColor: '#e9f1f9', ...blueThemeStyles }}
      >
        {/* Fill the screen edge-to-edge, anchored to the top so the logo is never
            cropped (only the desk bottom trims on very wide screens). */}
        <img
          src={loginBackground}
          alt={companyName}
          className="absolute inset-0 h-full w-full object-cover [object-position:50%_top]"
        />
        <div className="relative flex min-h-screen items-center lg:items-start lg:pt-[35vh] justify-center px-6 py-10 lg:justify-end lg:pr-[8%]">
          <div className="animate-fade-up w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-xl">
            <h2 className="font-heading text-2xl font-bold tracking-tight text-text-primary">Welcome back</h2>
            <p className="mb-6 mt-1 text-sm text-text-secondary">Sign in to your {companyName} account</p>
            {formBody}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4"
      style={blueThemeStyles}
    >
      {/* Vibrant atmospheric mesh (default) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="animate-blob absolute -left-28 -top-28 h-[30rem] w-[30rem] rounded-full blur-3xl"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 38%, transparent)' }}
        />
        <div
          className="animate-blob absolute -bottom-32 -right-20 h-[28rem] w-[28rem] rounded-full blur-3xl [animation-delay:5s]"
          style={{ background: 'color-mix(in srgb, var(--color-info) 34%, transparent)' }}
        />
        <div
          className="animate-blob absolute right-1/4 top-1/3 h-[22rem] w-[22rem] rounded-full blur-3xl [animation-delay:9s]"
          style={{ background: 'color-mix(in srgb, var(--color-danger) 20%, transparent)' }}
        />
      </div>

      <div className="relative w-full max-w-md">
        {brandHeader}
        {formCard}
      </div>
    </div>
  );
}
