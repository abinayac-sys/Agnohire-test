import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { verifyEmailToken } from '../../services/billingApi.js';
import { apiErrorMessage } from '../../services/api.js';

/** Public: lands from the verification email link (?token=...). */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'verifying' | 'ok' | 'error'>('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState('error');
      setMessage('Missing verification token.');
      return;
    }
    verifyEmailToken(token)
      .then(() => setState('ok'))
      .catch((err) => {
        setState('error');
        setMessage(apiErrorMessage(err, 'Verification failed'));
      });
  }, [params]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        {state === 'verifying' && <p className="text-text-secondary">Verifying your email…</p>}
        {state === 'ok' && (
          <>
            <h1 className="mb-2 text-xl font-semibold text-text-primary">Email verified 🎉</h1>
            <p className="mb-6 text-sm text-text-secondary">Your account is ready.</p>
            <Link to="/login" className="text-primary hover:underline">
              Continue to sign in
            </Link>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 className="mb-2 text-xl font-semibold text-text-primary">Verification failed</h1>
            <p className="text-sm text-text-secondary">{message}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default VerifyEmailPage;
