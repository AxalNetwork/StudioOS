import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Users, Check, AlertTriangle, LogIn, RefreshCw } from 'lucide-react';
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

/** What an Institutional colleague seat opens. A product fact, not per-invite data. */
export const SEAT_GIVES = [
  'Their deal rooms, pipeline and portfolio views',
  'Their fund pages and reporting',
  'Seats, research and introductions on the firm’s plan',
];

const ROLE_WARNING = 'Accepting turns your account into an investor account. Your current workspace stays, but your role changes.';

/** The invitation's own state, read back from `POST /investor-seats/invitation`. */
export function invitationCase(inv, inviterName) {
  const who = inviterName || 'The inviter';
  switch (inv?.state) {
    case 'wrong_account':
      return {
        tone: 'amber', title: 'Wrong account',
        body: `This invitation was for ${inv.invited_email || 'another email address'}. Sign in with that account.`,
        cta: 'switch',
      };
    case 'revoked':
      return { tone: 'bad', title: 'Revoked', body: `${who} revoked this seat. Ask them for a new link.` };
    case 'accepted':
      return inv.yours
        ? { tone: 'ok', title: 'Already accepted', body: 'This seat is yours. Open your workspace.', cta: 'workspace' }
        : { tone: 'grey', title: 'Already accepted', body: 'This seat has already been accepted by another account.' };
    case 'plan_lapsed':
      return {
        tone: 'amber', title: 'Plan no longer covers seats',
        body: 'The inviter’s plan changed. The seat cannot be accepted until it does again.',
      };
    default:
      return null;
  }
}

const TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100',
  amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
  bad: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100',
  grey: 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200',
};

const BTN = 'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:hover:bg-violet-500 sm:w-auto';
const BTN_QUIET = 'inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800 sm:w-auto';

function CaseCard({ c, children }) {
  return (
    <div data-testid="seat-accept-case" className={`mt-4 rounded-xl border p-4 text-left ${TONE[c.tone]}`}>
      <div className="text-sm font-semibold">{c.title}</div>
      <p className="mt-1 text-sm">{c.body}</p>
      {children}
    </div>
  );
}

/**
 * The colleague's side of a seat (Ops canvas `st-accept`, D632), at
 * `/investor-seats/accept?token=…` — `/invite/:token` is the events RSVP page.
 *
 * Signed out, it says to sign in and come back, and reads nothing. Signed in,
 * it reads the invitation first and shows who invited them, the firm, what the
 * seat gives and — for anyone not already an investor — that accepting turns
 * the account into an investor account. Nothing is accepted until they press
 * Accept. The invitation's other states (wrong account, revoked, already
 * accepted, plan lapsed) each have their sentence; a failed read says so with
 * Try again. Laid out for a 390-wide phone first.
 */
export function AcceptInvestorSeatView({
  user, authLoading = false, token = '',
  readInvitation = api.readInvestorSeatInvitation,
  acceptSeat = api.acceptInvestorSeat,
  initialRead = null, initialFailure = null,
}) {
  const [read, setRead] = useState(initialRead || { kind: 'loading' });
  const [state, setState] = useState(initialFailure ? 'error' : 'idle');
  const [error, setError] = useState(initialFailure ? seatAcceptErrorCopy(initialFailure) : '');

  const load = useCallback(() => {
    setRead({ kind: 'loading' });
    return readInvitation(token)
      .then((inv) => setRead({ kind: 'ready', inv }))
      .catch((e) => (e?.status === 404 || e?.status === 400
        ? setRead({ kind: 'refused', message: e.message || 'This invitation link is not valid.' })
        : setRead({ kind: 'unreadable', message: e?.message || '' })));
  }, [readInvitation, token]);

  useEffect(() => {
    if (authLoading || !user || !token || initialRead) return;
    load();
  }, [authLoading, user, token, initialRead, load]);

  const accept = useCallback(async () => {
    setState('working');
    try {
      const confirm = user?.role !== 'investor';
      await acceptSeat(token, confirm ? { confirm_role_change: true } : {});
      setState('done');
    } catch (e) {
      setError(seatAcceptErrorCopy({ ...(e?.data || {}), error: e?.code || e?.data?.error, message: e?.message }));
      setState('error');
    }
  }, [token, acceptSeat, user]);

  const nextPath = `/investor-seats/accept${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;
  const inv = read.kind === 'ready' ? read.inv : null;
  const inviter = inv?.inviter || {};
  const inviterName = inviter.name || 'Someone';
  const special = inv ? invitationCase(inv, inviter.name) : null;

  let body;
  if (!token) {
    body = (
      <CaseCard c={{ tone: 'grey', title: 'No seat', body: 'This invitation has no seat attached. Ask the inviter for the full link.' }} />
    );
  } else if (authLoading) {
    body = <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Checking your invitation…</p>;
  } else if (!user) {
    body = (
      <CaseCard c={{ tone: 'grey', title: 'Signed out', body: 'Sign in, then come back to this link. Nothing has changed on your account yet.' }}>
        <Link to={loginHref} data-testid="seat-accept-signin" className={`mt-3 ${BTN}`}>
          <LogIn size={16} aria-hidden="true" /> Sign in
        </Link>
      </CaseCard>
    );
  } else if (state === 'done') {
    body = (
      <CaseCard c={{ tone: 'ok', title: 'Seat accepted', body: `You have joined ${inviterName}’s Institutional plan.` }}>
        <Link to="/studio" className={`mt-3 ${BTN}`}>Open workspace</Link>
      </CaseCard>
    );
  } else if (read.kind === 'loading') {
    body = <p className="mt-3 text-sm text-gray-600 dark:text-gray-400" data-testid="seat-accept-loading">Checking your invitation…</p>;
  } else if (read.kind === 'unreadable') {
    body = (
      <div data-testid="seat-accept-unreadable" className="mt-4 rounded-xl border border-dashed border-rose-300 p-4 text-left dark:border-rose-800">
        <p className="text-sm text-rose-700 dark:text-rose-300">This invitation could not be read just now.</p>
        {read.message ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{read.message}</p> : null}
        <button type="button" onClick={load} className={`mt-3 ${BTN_QUIET}`}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  } else if (read.kind === 'refused') {
    body = <CaseCard c={{ tone: 'bad', title: 'Not a valid link', body: read.message }} />;
  } else if (special) {
    body = (
      <CaseCard c={special}>
        {special.cta === 'switch' ? <Link to={loginHref} className={`mt-3 ${BTN_QUIET}`}>Switch account</Link> : null}
        {special.cta === 'workspace' ? <Link to="/studio" className={`mt-3 ${BTN}`}>Open workspace</Link> : null}
      </CaseCard>
    );
  } else {
    const adminRefused = user.role === 'admin';
    const changesRole = !adminRefused && user.role !== 'investor';
    body = (
      <div className="mt-4 text-left" data-testid="seat-accept-offer">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {inviterName}{inviter.firm ? ` at ${inviter.firm}` : ''} invited you to join their Institutional plan as a colleague.
        </p>
        {!inviter.firm ? (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400" data-testid="seat-accept-firm">
            {inviter.firm_readable === false
              ? 'Firm: the inviter’s firm name could not be read just now.'
              : 'Firm: the inviter has not recorded a firm name.'}
          </p>
        ) : null}
        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">What the seat gives</div>
        <ul className="mt-2 space-y-1.5">
          {SEAT_GIVES.map((g) => (
            <li key={g} className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
              <Check size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {g}
            </li>
          ))}
        </ul>
        {changesRole ? (
          <div data-testid="seat-accept-warning" className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${TONE.amber}`}>
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{ROLE_WARNING}</span>
          </div>
        ) : null}
        {adminRefused ? (
          <p className="mt-4 text-sm text-gray-700 dark:text-gray-300" data-testid="seat-accept-error">
            {seatAcceptErrorCopy({ error: 'admin_cannot_take_seat' })}
          </p>
        ) : (
          <>
            {state === 'error' ? (
              <p className="mt-4 text-sm text-rose-700 dark:text-rose-300" data-testid="seat-accept-error">{error}</p>
            ) : null}
            <button type="button" onClick={accept} disabled={state === 'working'} data-testid="seat-accept-button" className={`mt-4 ${BTN}`}>
              {state === 'working' ? 'Accepting…' : changesRole ? 'Accept and become an investor' : 'Accept the seat'}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50 px-4 py-8 dark:bg-gray-950 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
          <Users className="text-violet-600 dark:text-violet-300" size={22} aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">You have been offered a seat</h1>
        {body}
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
