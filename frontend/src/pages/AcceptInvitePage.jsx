import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { Users, Check, AlertCircle, LogIn } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';

/**
 * Task #1 (Spin-Out Teams Collaboration) — invitation acceptance landing.
 *
 * Reached via a tokenized share link (`/projects/invitations/accept?token=…`)
 * sent over WhatsApp / Telegram / email. The token is bound server-side to the
 * invitee (by user_id or normalized email), so we simply POST it once the
 * visitor is authenticated. Logged-out visitors are bounced to sign-in with a
 * `?next=` return path so they land right back here after authenticating.
 */
export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = (params.get('token') || '').trim();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [state, setState] = useState('idle'); // idle | working | done | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const accept = useCallback(async () => {
    if (!token) {
      setState('error');
      setError('This invitation link is missing its token.');
      return;
    }
    setState('working');
    try {
      const res = await api.acceptProjectInvitation(token);
      setResult(res);
      setState('done');
    } catch (e) {
      setError(e?.message || 'This invitation could not be accepted.');
      setState('error');
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return; // render the sign-in prompt below
    if (state === 'idle') accept();
  }, [authLoading, user, state, accept]);

  const nextPath = `/projects/invitations/accept${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;
  const registerHref = `/register?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center dark:bg-gray-900 dark:border-gray-800">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
          <Users className="text-violet-600 dark:text-violet-300" size={22} />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Startup invitation</h1>

        {!token && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            This invitation link is missing its token.
          </p>
        )}

        {token && authLoading && (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Checking your session…</p>
        )}

        {token && !authLoading && !user && (
          <>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              Sign in to accept your invitation and join the team.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Link
                to={loginHref}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm text-white font-medium"
              >
                <LogIn size={16} /> Sign in to accept
              </Link>
              <Link
                to={registerHref}
                className="text-xs text-violet-600 hover:underline dark:text-violet-400"
              >
                New here? Create an account
              </Link>
            </div>
          </>
        )}

        {token && user && state === 'working' && (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Accepting your invitation…</p>
        )}

        {state === 'done' && (
          <>
            <div className="mt-4 mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
              <Check className="text-emerald-600 dark:text-emerald-300" size={20} />
            </div>
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
              {result?.already_owner
                ? "You already own this startup — you're all set."
                : `You've joined the startup as ${result?.role === 'advisor' ? 'an advisor' : 'a co-founder'}.`}
            </p>
            <button
              onClick={() => navigate(result?.project_id ? `/projects/${result.project_id}` : '/projects')}
              className="mt-5 inline-flex items-center justify-center px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm text-white font-medium"
            >
              Open project
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="mt-4 mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
              <AlertCircle className="text-red-600 dark:text-red-300" size={20} />
            </div>
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
            <Link
              to="/studio"
              className="mt-5 inline-flex items-center justify-center px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg text-sm text-gray-900 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              Go to dashboard
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
