import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Clock, Loader2, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import * as offerApi from '../../services/offerApi.js';
import { apiErrorMessage } from '../../services/api.js';

type Phase = 'loading' | 'error' | 'already-accepted' | 'expired' | 'valid' | 'success';

export function OfferAcceptPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [offerInfo, setOfferInfo] = useState<{
    candidateName: string;
    jobTitle: string;
    validUntil: string | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadOffer() {
      try {
        const info = await offerApi.getPublicOffer(token);
        setOfferInfo({
          candidateName: info.candidateName,
          jobTitle: info.jobTitle,
          validUntil: info.validUntil,
        });

        if (info.alreadyAccepted) {
          setPhase('already-accepted');
        } else if (info.expired) {
          setPhase('expired');
        } else {
          setPhase('valid');
        }
      } catch (e) {
        setErrorMsg(apiErrorMessage(e));
        setPhase('error');
      }
    }
    loadOffer();
  }, [token]);

  async function handleAccept() {
    setSubmitting(true);
    try {
      await offerApi.acceptPublicOffer(token);
      setPhase('success');
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-text-secondary">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm font-medium">Loading offer details…</p>
        </div>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell>
        <Centered
          icon={<AlertTriangle className="h-12 w-12 text-danger" />}
          title="Invalid Offer Link"
          body={errorMsg || 'This link is invalid or incorrect.'}
        />
      </Shell>
    );
  }

  if (phase === 'already-accepted') {
    return (
      <Shell>
        <Centered
          icon={<CheckCircle2 className="h-12 w-12 text-success" />}
          title="Offer Already Accepted"
          body="This offer has already been accepted."
        />
      </Shell>
    );
  }

  if (phase === 'expired') {
    return (
      <Shell>
        <Centered
          icon={<AlertTriangle className="h-12 w-12 text-danger" />}
          title="Offer Expired"
          body="This offer has expired. Please contact HR."
        />
      </Shell>
    );
  }

  if (phase === 'success') {
    return (
      <Shell>
        <Centered
          icon={<CheckCircle2 className="h-16 w-16 text-success animate-bounce" />}
          title="Offer Accepted Successfully"
          body="Thank you for accepting the offer. Our onboarding team will contact you shortly."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Sparkles className="h-7 w-7" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">
            Review Your Job Offer
          </h1>
          <p className="mt-1.5 text-sm text-text-secondary">
            Hi {offerInfo?.candidateName}, we are excited to have you join our team!
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-6 text-left space-y-4">
          <div className="flex justify-between border-b border-border pb-3">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Candidate</span>
            <span className="text-sm font-medium text-text-primary">{offerInfo?.candidateName}</span>
          </div>
          <div className="flex justify-between border-b border-border pb-3">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Position</span>
            <span className="text-sm font-medium text-text-primary">{offerInfo?.jobTitle}</span>
          </div>
          {offerInfo?.validUntil && (
            <div className="flex justify-between">
              <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Offer Valid Until</span>
              <span className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-warning" />
                {new Date(offerInfo.validUntil).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        <Button
          className="w-full py-3"
          size="lg"
          loading={submitting}
          onClick={handleAccept}
        >
          Accept Offer
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-xl">
        {children}
      </div>
    </div>
  );
}

function Centered({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center space-y-4 py-4">
      <div>{icon}</div>
      <h1 className="font-heading text-xl font-bold text-text-primary">{title}</h1>
      <p className="max-w-xs text-sm text-text-secondary leading-relaxed">{body}</p>
    </div>
  );
}
