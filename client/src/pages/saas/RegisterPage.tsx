import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Check, CheckCircle2, CreditCard, Eye, EyeOff } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import {
  fetchBillingConfig,
  registerTenant,
  openRazorpayCheckout,
  verifyCheckout,
  type BillingConfig,
} from '../../services/billingApi.js';
import { apiErrorMessage } from '../../services/api.js';

interface DetailsValues {
  companyName: string;
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

type Step = 'details' | 'plan' | 'payment' | 'done';

const LIMIT_LABELS: { key: keyof BillingConfig['plans'][number]; label: (n: number | null) => string }[] = [
  { key: 'maxUsers', label: (n) => (n == null ? 'Unlimited team members' : `Up to ${n} team member${n === 1 ? '' : 's'}`) },
  { key: 'maxOrganizations', label: (n) => (n == null ? 'Unlimited organizations' : `${n} organization${n === 1 ? '' : 's'}`) },
  { key: 'maxWorkspaces', label: (n) => (n == null ? 'Unlimited workspaces' : `${n} workspace${n === 1 ? '' : 's'}`) },
  { key: 'maxActiveJobs', label: (n) => (n == null ? 'Unlimited active jobs' : `${n} active job${n === 1 ? '' : 's'}`) },
  { key: 'maxInterviewedCandidates', label: (n) => (n == null ? 'Unlimited interviewed candidates' : `${n} interviewed candidates / mo`) },
  { key: 'maxCandidates', label: (n) => (n == null ? 'Unlimited candidates' : `${n.toLocaleString('en-IN')} candidates`) },
  { key: 'storageMb', label: (n) => (n == null ? 'Unlimited storage' : `${n >= 1024 ? `${(n / 1024).toFixed(0)} GB` : `${n} MB`} storage`) },
];

function planFeatureList(p: BillingConfig['plans'][number]): string[] {
  const bullets: string[] = [];
  for (const { key, label } of LIMIT_LABELS) {
    const v = p[key];
    if (typeof v === 'number' || v === null) bullets.push(label(v));
  }
  if (p.aiEnabled) bullets.push('AI-powered scoring & sourcing');
  if (p.proctoringEnabled) bullets.push('Proctored assessments');
  if (Array.isArray(p.features)) bullets.push(...p.features);
  return bullets;
}

/**
 * Public SaaS self-registration, as a 4-step wizard: workspace details → plan
 * selection → payment (paid plans only) → confirmation. Signups are NOT
 * activated immediately — the workspace is created inert and our team
 * qualifies it (phone call) before approving; paid plans additionally must
 * complete Razorpay Checkout before they're even eligible for that approval
 * (server-enforced in approveTenant — this wizard just mirrors the gate).
 */
export function RegisterPage() {
  const [step, setStep] = useState<Step>('details');
  const [details, setDetails] = useState<DetailsValues | null>(null);
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [planCode, setPlanCode] = useState('FREE');
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    fetchBillingConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  const plans = config?.plans ?? [{ code: 'FREE', name: 'Free', features: [] }];
  const selectedPlan = plans.find((p) => p.code === planCode);
  const isPaidPlan = planCode !== 'FREE';

  async function completeRegistration() {
    if (!details) return;
    setSubmitting(true);
    setPaymentError(null);
    try {
      let timezone: string | undefined;
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        timezone = undefined;
      }
      const result = await registerTenant({ ...details, planCode, billingInterval: interval, timezone });
      if (result.checkout && config) {
        setStep('payment');
        openRazorpayCheckout({
          keyId: result.checkout.keyId,
          razorpaySubscriptionId: result.checkout.razorpaySubscriptionId,
          name: details.fullName,
          email: details.email,
          onSuccess: async (payload) => {
            try {
              await verifyCheckout(payload);
              setStep('done');
            } catch (err) {
              setPaymentError(apiErrorMessage(err, 'Payment verification failed'));
            }
          },
          onDismiss: () => {
            setPaymentError('Payment was not completed. Your workspace request needs a successful payment before it can be reviewed.');
          },
        });
      } else {
        setStep('done');
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Registration failed'));
      setStep('plan');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-raised p-4">
      <div className={`w-full rounded-2xl border border-border bg-surface p-8 shadow-sm ${step === 'plan' ? 'max-w-5xl' : 'max-w-lg'}`}>
        {step !== 'done' && <Stepper step={step} isPaidPlan={isPaidPlan} />}

        {step === 'details' && (
          <DetailsStep
            initial={details}
            onNext={(values) => {
              setDetails(values);
              setStep('plan');
            }}
          />
        )}

        {step === 'plan' && (
          <PlanStep
            plans={plans}
            planCode={planCode}
            interval={interval}
            onSelectPlan={setPlanCode}
            onSelectInterval={setInterval}
            onBack={() => setStep('details')}
            onNext={completeRegistration}
            submitting={submitting}
          />
        )}

        {step === 'payment' && (
          <PaymentStep planName={selectedPlan?.name ?? planCode} error={paymentError} onRetry={completeRegistration} submitting={submitting} />
        )}

        {step === 'done' && <DoneStep isPaidPlan={isPaidPlan} phone={details?.phone ?? ''} />}
      </div>
    </div>
  );
}

function Stepper({ step, isPaidPlan }: { step: Step; isPaidPlan: boolean }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'details', label: 'Workspace' },
    { key: 'plan', label: 'Plan' },
    ...(isPaidPlan || step === 'payment' ? [{ key: 'payment' as Step, label: 'Payment' }] : []),
  ];
  const activeIdx = steps.findIndex((s) => s.key === step);
  return (
    <div className="mb-6 flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              i <= activeIdx ? 'bg-accent text-accent-fg' : 'bg-surface-raised text-text-muted'
            }`}
          >
            {i + 1}
          </div>
          <span className={`text-sm ${i <= activeIdx ? 'text-text-primary' : 'text-text-muted'}`}>{s.label}</span>
          {i < steps.length - 1 && <div className="h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}

function DetailsStep({ initial, onNext }: { initial: DetailsValues | null; onNext: (v: DetailsValues) => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DetailsValues>({ defaultValues: initial ?? undefined });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Create your workspace</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Start hiring with AgnoHire — tell us about your company.
      </p>
      <form onSubmit={handleSubmit(onNext)} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-text-secondary">Company name</label>
          <Input
            placeholder="Acme Corp"
            {...register('companyName', { required: 'Company name is required', minLength: { value: 2, message: 'Too short' } })}
          />
          {errors.companyName && <p className="mt-1 text-xs text-danger">{errors.companyName.message}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-text-secondary">Your full name</label>
          <Input placeholder="Jane Doe" {...register('fullName', { required: 'Your name is required' })} />
          {errors.fullName && <p className="mt-1 text-xs text-danger">{errors.fullName.message}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-text-secondary">Work email</label>
          <Input type="email" placeholder="jane@acme.com" {...register('email', { required: 'Email is required' })} />
          {errors.email && <p className="mt-1 text-xs text-danger">{errors.email.message}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-text-secondary">Phone number</label>
          <Input
            type="tel"
            placeholder="+91 98765 43210"
            {...register('phone', { required: 'Phone number is required', minLength: { value: 6, message: 'Enter a valid phone number' } })}
          />
          <p className="mt-1 text-xs text-text-muted">Used to verify your account and activate your workspace.</p>
          {errors.phone && <p className="mt-1 text-xs text-danger">{errors.phone.message}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-text-secondary">Password</label>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Min 8 chars, upper/lower/digit"
              className="pr-10"
              {...register('password', {
                required: 'Password is required',
                minLength: { value: 8, message: 'At least 8 characters' },
                validate: (v) =>
                  (/[A-Z]/.test(v) && /[a-z]/.test(v) && /[0-9]/.test(v)) ||
                  'Must include upper, lower and a digit',
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

        <Button type="submit" className="w-full">Next: choose a plan</Button>
      </form>

      <p className="mt-4 text-center text-sm text-text-secondary">
        Already have an account?{' '}
        <Link to="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function PlanStep({
  plans,
  planCode,
  interval,
  onSelectPlan,
  onSelectInterval,
  onBack,
  onNext,
  submitting,
}: {
  plans: BillingConfig['plans'];
  planCode: string;
  interval: 'monthly' | 'yearly';
  onSelectPlan: (code: string) => void;
  onSelectInterval: (i: 'monthly' | 'yearly') => void;
  onBack: () => void;
  onNext: () => void;
  submitting: boolean;
}) {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Choose your plan</h1>
      <p className="mb-6 text-sm text-text-secondary">You can change plans later from Billing &amp; Plan.</p>

      <div className="mb-6 flex gap-2 text-sm">
        {(['monthly', 'yearly'] as const).map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelectInterval(i)}
            className={`rounded-lg border px-3 py-1.5 capitalize ${
              interval === i ? 'border-primary text-text-primary' : 'border-border text-text-secondary'
            }`}
          >
            {i}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => {
          const isFree = p.code === 'FREE';
          const price = interval === 'yearly' ? p.priceYearly : p.priceMonthly;
          const selected = planCode === p.code;
          return (
            <button
              key={p.code}
              type="button"
              onClick={() => onSelectPlan(p.code)}
              className={`flex flex-col rounded-xl border p-5 text-left transition ${
                selected ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
              }`}
            >
              <div className="text-lg font-semibold text-text-primary">{p.name}</div>
              <div className="mt-4">
                {isFree ? (
                  <>
                    <div className="text-2xl font-bold text-text-primary">{p.trialDays ?? 14}-day free trial</div>
                    <div className="text-xs text-text-muted">No card required</div>
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-bold text-text-primary">
                      {price != null ? `₹${Number(price).toLocaleString('en-IN')}` : 'Custom'}
                    </div>
                    <div className="text-xs text-text-muted">{price != null ? `/ ${interval === 'yearly' ? 'year' : 'month'}` : 'contact sales'}</div>
                  </>
                )}
              </div>
              <ul className="mt-4 space-y-2 text-sm text-text-secondary">
                {planFeatureList(p).map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>Back</Button>
        <Button type="button" onClick={onNext} disabled={submitting}>
          {submitting ? 'Please wait…' : planCode === 'FREE' ? 'Next: request workspace' : 'Next: payment'}
        </Button>
      </div>
    </div>
  );
}

function PaymentStep({
  planName,
  error,
  onRetry,
  submitting,
}: {
  planName: string;
  error: string | null;
  onRetry: () => void;
  submitting: boolean;
}) {
  return (
    <div className="py-4 text-center">
      <CreditCard className="mx-auto mb-4 h-12 w-12 text-accent" />
      <h1 className="mb-2 text-xl font-semibold text-text-primary">Complete payment for {planName}</h1>
      <p className="mb-6 text-sm text-text-secondary">
        A secure Razorpay checkout window should have opened. Your workspace request won't be sent for review until payment is completed.
      </p>
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <Button type="button" onClick={onRetry} disabled={submitting}>
        {submitting ? 'Please wait…' : 'Retry payment'}
      </Button>
    </div>
  );
}

function DoneStep({ isPaidPlan, phone }: { isPaidPlan: boolean; phone: string }) {
  return (
    <div className="text-center">
      <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-success" />
      <h1 className="mb-2 text-2xl font-semibold text-text-primary">
        {isPaidPlan ? 'Payment received — your workspace is under review' : 'Your workspace is under review'}
      </h1>
      <p className="mb-6 text-sm text-text-secondary">
        {isPaidPlan
          ? 'Thanks for your payment! Our team will call you at '
          : 'Thanks for signing up! Our team will call you at '}
        <span className="font-medium text-text-primary">{phone}</span> shortly to get you set up.
        Once approved, you'll be able to sign in{isPaidPlan ? '' : ' and start your free trial'}.
      </p>
      <Link to="/login">
        <Button variant="outline" className="w-full">Back to sign in</Button>
      </Link>
    </div>
  );
}

export default RegisterPage;
