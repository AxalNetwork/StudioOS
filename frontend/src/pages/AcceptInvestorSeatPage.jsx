import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Users, Check, AlertCircle, LogIn } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';

/** What the accept route's refusal means, in the words the page shows. */
export function seatAcceptErrorCopy(data) {
  const code = data?.error;
  if (code === 'admin_cannot_take_seat') return 'An admin account cannot take a colleague seat.';
  if (code === 'role_change_needs_confirmation') {
    return `Accepting this seat changes your ${data?.role || 'current'} account into an investor account. Confirm to continue.`;
  }
  if (code === 'email_mismatch') return 'This invite was sent to a different email address.';
  if (code === 'invite_revoked') return 'This invite was revoked.';
  if (code === 'already_accepted') return 'This invite was already accepted.';
  if (code === 'primary_not_institutional') return 'The inviter’s plan no longer covers colleague seats.';
  return data?.message || 'This invite could not be accepted.';
}

/**
 * `/investor-seats/accept?token=…` — the colleague's own act.
 *
 * Signed out: sign in, then come back with the token. An admin is refused.
 * A founder or partner is asked before their role becomes investor. An
 * investor is accepted without that question.
 */
export function AcceptInvestorSeatView({ user, authLoading = false, token = '', acceptSeat = api.acceptInvestorSeat, initialFailure = null }) {
  const [state, setState] = useState(initialFailure ? 'error' : 'idle');
  const [error, setError] = useState(initialFailure ? seatAcceptErrorCopy(initialFailure) : '');

  const accept = useCallback(async (confirm) => {
    if (!token) {
      setState('error');
      setError('This invite link is missing its token.');
      return;
    }
    setState('working');
    try {
      await acceptSeat(token, confirm ? { confirm_role_change: true } : {});
      setState('done');
    } catch (e) {
      setError(seatAcceptErrorCopy(e?.data));
      setState('error');
    }
  }, [token, acceptSeat]);

  const needsConfirm = user && user.role !== 'investor' && user.role !== 'admin';
  const adminRefused = user?.role === 'admin';

  useEffect(() => {
    if (authLoading || !user || needsConfirm || adminRefused) return;
    if (state === 'idle') accept(false);
  }, [authLoading, user, needsConfirm, adminRefused, state, accept]);

  const nextPath = `/investor-seats/accept${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center dark:bg-gray-900 dark:border-gray-800">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
          <Users className="text-violet-600 dark:text-violet-300" size={22} aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Colleague seat</h1>

        {authLoading || state === 'working' || (user && !adminRefused && !needsConfirm && state === 'idle') ? (
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Checking your invitation…</p>
        ) : !user ? (
          <>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              Sign in with the address this invite was sent to, then come back. Nothing has changed on your account yet.
            </p>
            <Link to={loginHref} data-testid="seat-accept-signin"
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
              <LogIn size={16} aria-hidden="true" /> Sign in
            </Link>
          </>
        ) : adminRefused ? (
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300" data-testid="seat-accept-error">
            {seatAcceptErrorCopy({ error: 'admin_cannot_take_seat' })}
          </p>
        ) : needsConfirm && state !== 'done' && state !== 'error' ? (
          <>
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-300" data-testid="seat-accept-confirm">
              Accepting this seat changes your {user.role} account into an investor account.
            </p>
            <button type="button" onClick={() => accept(true)} data-testid="seat-accept-confirm-button"
              className="mt-5 inline-flex items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
              Confirm and accept
            </button>
          </>
        ) : state === 'done' ? (
          <>
            <div className="mx-auto mt-4 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
              <Check className="text-emerald-600 dark:text-emerald-300" size={18} aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">You have joined the Institutional account.</p>
          </>
        ) : (
          <>
            <div className="mx-auto mt-4 flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/40">
              <AlertCircle className="text-rose-600 dark:text-rose-300" size={18} aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-300" data-testid="seat-accept-error">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvestorSeatPage() {
  const [params] = useSearchParams();
  const token = (params.get('token') || '').trim();
  const { user, loading } = useAuth();
  return <AcceptInvestorSeatView user={user} authLoading={loading} token={token} />;
}
