import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Building2, Check, AlertCircle, LogIn } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';

/**
 * Task #121 — where a company invitation is accepted.
 *
 * The other half of the feature. `POST /company/:uid/invitations` mails a
 * hashed, expiring token; this is the page that token points at, and the
 * accept is the invitee's own act rather than something done to them — which
 * is the whole difference from what the settings page used to do, which was
 * link an existing account to a company without asking it.
 *
 * MODELLED ON `AcceptInvitePage`, the project equivalent, deliberately: same
 * bounce-to-sign-in with a `?next=` return path, same accept-once-authed
 * effect. Two things differ, and both are the server's rules made visible:
 *
 *   · A company invitation is bound to an EMAIL ADDRESS, not to an account.
 *     Signing in as somebody else and clicking the link is refused with 403
 *     `wrong_account`, and this page says which address it was for rather
 *     than a flat "not allowed" — a forwarded invitation is a normal thing to
 *     receive and the reader needs to know what to do about it.
 *   · `already_member` is a success, not an error. Somebody added directly
 *     while their invitation was in flight has the outcome the invitation
 *     asked for; saying "that failed" would be false.
 */
export default function AcceptCompanyInvitePage() {
  const [params] = useSearchParams();
  const token = (params.get('token') || '').trim();
  const { user, loading: authLoading } = useAuth();

  const [state, setState] = useState('idle'); // idle | working | done | error
  const [error, setError] = useState('');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [result, setResult] = useState(null);

  const accept = useCallback(async () => {
    if (!token) {
      setState('error');
      setError('This invitation link is missing its token.');
      return;
    }
    setState('working');
    try {
      setResult(await api.acceptCompanyInvitation(token));
      setState('done');
    } catch (e) {
      // The address the invitation was actually for, when the server sends
      // it. Without this the reader cannot tell which of their accounts to
      // use, which is the only thing they need to know here.
      setInvitedEmail(e?.data?.invited_email || '');
      setError(e?.message || 'This invitation could not be accepted.');
      setState('error');
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return; // the sign-in prompt below renders instead
    if (state === 'idle') accept();
  }, [authLoading, user, state, accept]);

  const nextPath = `/company/invitations/accept${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;
  const registerHref = `/register?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center dark:bg-gray-900 dark:border-gray-800">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
          <Building2 className="text-violet-600 dark:text-violet-300" size={22} aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Company invitation</h1>

        {authLoading || state === 'working' ? (
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Checking your invitation…</p>
        ) : !user ? (
          <>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              Sign in with the address this invitation was sent to, and it will be accepted
              automatically. Nothing has changed on your account yet.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Link to={loginHref}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
                <LogIn size={16} aria-hidden="true" /> Sign in
              </Link>
              <Link to={registerHref}
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                Create an account
              </Link>
            </div>
          </>
        ) : state === 'done' ? (
          <>
            <div className="mx-auto mt-4 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
              <Check className="text-emerald-600 dark:text-emerald-300" size={18} aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
              {result?.already_member
                ? `You were already a member of ${result?.company_name || 'this company'}, so nothing changed.`
                : `You have joined ${result?.company_name || 'the company'}${result?.role_in_company ? ` as ${result.role_in_company}` : ''}.`}
            </p>
            <Link to="/company-settings"
              className="mt-5 inline-flex items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
              Open company settings
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto mt-4 flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/40">
              <AlertCircle className="text-rose-600 dark:text-rose-300" size={18} aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{error}</p>
            {invitedEmail ? (
              <p className="mt-2 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
                It was sent to <strong className="text-gray-700 dark:text-gray-300">{invitedEmail}</strong>, and
                you are signed in as {user.email}. Sign in with that address, or ask whoever invited
                you to send a new one to this address.
              </p>
            ) : (
              <p className="mt-2 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
                An invitation expires after 14 days and can be revoked. Ask whoever invited you to
                send a new one — the old link stops working as soon as they do.
              </p>
            )}
            <Link to="/"
              className="mt-5 inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              Back to StudioOS
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
