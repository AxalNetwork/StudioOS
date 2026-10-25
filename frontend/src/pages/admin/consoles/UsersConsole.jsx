import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { reportError } from '../../../lib/log';
import { api } from '../../../lib/api';
import { UserCheck, UserX, LogIn, ChevronDown, MessageSquare, X, Check, ShieldCheck, Search } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { useAuth } from '../../../hooks/useAuthSync';
import { Unrecorded, Unreadable } from '../../../ui';
// D128 — the scope caption is fed from `/me.branch` through the same reader
// the territory badge uses, so the two cannot disagree about which
// deployment this is.
import { branchOfUser } from '../../../lib/shellRole';
// D223 — the elevation the secret-writing consoles gate on; its own line so
// the `branchOfUser` import D128's test pins stays exactly as it was.
import { isSuperAdminUser } from '../../../lib/shellRole';
import { drawsAccountControls } from '../../../lib/accountControls';
import TrustScoreBadge from '../../../components/TrustScoreBadge';
import { ROLE_BADGES, Field, ConsoleUnreadable, CONSOLE_LOADING } from './shared';
import useRecordCrumb from '../useRecordCrumb';

/**
 * D648 (#1448) — the Users console: the account directory, its role picker,
 * support sessions and the account drawer. It reads the users list and their
 * trust scores, and nothing else; Partner Profiles and the KYC queue are their
 * own consoles now. HQ · Accounts (`pages/hq/AccountsPage.jsx`) mounts this
 * console alone.
 */

// Task #16 — per-row trust score column on the admin Users table.
// Task #40 — accepts a pre-fetched `data` prop populated by the parent's
// single batch call (POST /api/trust/score/batch); falls back to the
// per-user GET /api/trust/score/:userId only if the parent didn't
// provide one (e.g. a row whose batch entry failed). Renders an em-dash
// placeholder while the batch is in flight to keep the row height stable.
function UserTrustCell({ userId, data }) {
  const [fallback, setFallback] = useState(null);
  useEffect(() => {
    if (data || !userId) return;
    let cancelled = false;
    api.trustScore(userId)
      .then(d => { if (!cancelled) setFallback(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, data]);
  const eff = data || fallback;
  if (!eff) return <span className="text-xs text-gray-400">—</span>;
  return <TrustScoreBadge size="sm" score={eff.score} missing={eff.missing} label={false} />;
}

function RoleDropdown({ user, onRoleChange, canOverride = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  // Where to paint the portalled menu. Null until it opens.
  const [at, setAt] = useState(null);

  // Pick the side with more room, and cap the height to what is actually
  // there. Opening downward unconditionally is what the first version did,
  // and for a row low in the table the menu ran off the bottom of the window
  // — where, being `position: fixed`, it cannot be scrolled to. That trades
  // one unreachable menu for another. Measuring the SPACE rather than the
  // menu keeps this a single pass: whichever side is chosen, maxHeight makes
  // the menu fit it, so its own height never has to be known.
  const place = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const GAP = 6;
    const EDGE = 12;   // never flush against the window edge
    setAt(below >= above
      ? { top: r.bottom + GAP, maxHeight: Math.max(96, below - GAP - EDGE), left: r.left + r.width / 2 }
      : { bottom: window.innerHeight - r.top + GAP, maxHeight: Math.max(96, above - GAP - EDGE), left: r.left + r.width / 2 });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    // The menu is portalled to <body>, so `ref` no longer contains it — both
    // halves have to be checked or the first click inside the menu closes it.
    const close = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    // `position: fixed` does not follow the page, so re-measure rather than
    // leave the menu behind while the table scrolls under it. Capture phase,
    // because the scroll happens on the table's own overflow container.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const OPTIONS = [
    { value: 'founder', label: 'Founder' },
    { value: 'partner', label: 'Partner' },
    { value: 'investor', label: 'Investor' },
    { value: 'advisor', label: 'Advisor' },
    // Task #9 follow-up — lets an admin send any user (e.g. a partner) back
    // into the exploring holding state for re-review. The reverse direction
    // (exploring → founder/partner/investor) is intentionally NOT offered
    // here — that transition requires a signed binding agreement and must
    // go through the Exploring Users queue (/admin/exploring).
    { value: 'exploring', label: 'Exploring' },
  ];
  const currentLabel = OPTIONS.find(o => o.value === user.role)?.label ?? user.role;
  const isExploring = user.role === 'exploring';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={`Change role for ${user.name || user.email}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Click to change this user's role"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border border-transparent hover:border-current hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-1 transition-all cursor-pointer ${ROLE_BADGES[user.role] || 'bg-gray-100 text-gray-700'}`}
      >
        {currentLabel}
        <ChevronDown size={11} className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {/*
        PORTALLED TO <body>, because the menu used to be cut in half.
        It is `absolute` inside a card with `overflow-hidden` (the rounded
        corners) nested in the table's `overflow-x-auto` — and `overflow-x`
        alone computes `overflow-y: auto`, so BOTH ancestors clip it. For any
        row near the bottom of the table the options simply were not there.
        Fixed positioning off the trigger's own rect is the fix that does not
        cost the card its corners or the table its horizontal scroll.
      */}
      {open && at && createPortal((
        <div
          ref={menuRef}
          style={{
            position: 'fixed', left: at.left, transform: 'translateX(-50%)',
            ...(at.top === undefined ? { bottom: at.bottom } : { top: at.top }),
            maxHeight: at.maxHeight,
          }}
          className="z-50 flex min-w-[190px] flex-col overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg"
        >
          {/*
            THE FOOTER IS OUTSIDE THE SCROLLING REGION, and that is the fix
            rather than a nicety. `maxHeight` floors at 96px (see the sizing
            above) while five options alone run to roughly 135px, so for a row
            with little space the note below — the only thing that says why the
            options are dead and where to go instead — scrolled out of sight.
            #152 added that explanation and a short menu could hide it entirely.
            Splitting the menu into a scrolling list and a pinned footer keeps
            it visible at every height.
          */}
          <ul role="listbox" aria-label="Select role" className="min-h-0 flex-1 overflow-y-auto py-1">
          {OPTIONS.map(opt => {
            // Moving OUT of exploring requires a signed binding agreement
            // and must go through the Exploring Users queue — disable those
            // options here rather than let the user hit a 409 on click.
            // Leaving `exploring` needs a signed binding agreement. A super
            // admin may override that with a reason; everyone else is blocked
            // here rather than being allowed to click into a 409.
            const disabled = isExploring && opt.value !== 'exploring' && !canOverride;
            const isOverride = isExploring && opt.value !== 'exploring' && canOverride;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={user.role === opt.value}
                aria-disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  if (disabled) return;
                  setOpen(false);
                  onRoleChange(user, opt.value);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs select-none transition-colors ${
                  disabled
                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                    : user.role === opt.value
                      ? `${ROLE_BADGES[opt.value] || 'bg-gray-100 text-gray-700'} font-semibold cursor-pointer`
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium cursor-pointer'
                }`}
              >
                <span className="w-[11px] shrink-0">
                  {user.role === opt.value && <Check size={11} />}
                </span>
                {opt.label}
                {isOverride && (
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Override
                  </span>
                )}
              </li>
            );
          })}
          {/*
            THE WHOLE POINT OF #152. Every option above is disabled for an
            exploring user, and until now the only thing that said why was a
            `title` on a disabled <li> — invisible to anyone not hovering, and
            to keyboard and screen-reader users entirely. Since every new
            signup lands in `exploring` (routes/auth.ts:334), that made this
            the console's one role control and it read as broken.

            The gate itself stays: moving out of exploring needs a signed
            binding agreement, checked again server-side
            (admin_exploring.ts:259). What changes is that the reason and the
            way through are now on the screen.
          */}
          </ul>
          {isExploring && (
            <div className="shrink-0 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
              <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                {canOverride
                  ? 'Leaving Exploring normally needs a signed binding agreement. Choosing a role here overrides that — you will be asked why, and it is recorded.'
                  : 'Leaving Exploring needs a signed binding agreement.'}
              </p>
              <Link
                to="/admin/exploring"
                onClick={() => setOpen(false)}
                className="mt-1.5 inline-block text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
              >
                Assign from the Exploring queue →
              </Link>
            </div>
          )}
        </div>
      ), document.body)}
    </div>
  );
}

/**
 * Start a support session — canvas H4.
 *
 * Impersonation used to be one click with nothing recorded but "who". The
 * worker now refuses a session without a reason of at least ten characters
 * (routes/admin.ts), so this is where the reason is collected — and the
 * three facts beside it are the ones a person needs before they act as
 * somebody else.
 *
 * SCOPE AND EXPIRY ARE STATED, NOT CHOSEN. The canvas offers no alternative
 * to either and neither does the product: the minted token IS the user, so
 * the scope is read-and-write by construction, and the expiry is
 * IMPERSONATION_EXPIRY_MINUTES, enforced in the token rather than here.
 * Drawing them as pickers would invent options that do not exist.
 */
/**
 * The reason a super admin is skipping the binding agreement.
 *
 * Leaving `exploring` normally requires a signed binding agreement, checked in
 * the UI and twice on the server. A super admin may override that, and this is
 * where the override stops being silent: the reason typed here is written into
 * the `role_changed` audit line, so the override is legible afterwards instead
 * of indistinguishable from a routine assignment.
 *
 * Ten characters is the same bar the support-session dialog uses, for the same
 * reason — "ok" is not an explanation anybody can act on later.
 *
 * D249 — the route also asks for your authenticator and a fresh step-up (the
 * step-up prompt is request()'s), and tells the person: their own activity
 * says the role was assigned by override, and why. The dialog says both.
 */
function RoleOverrideDialog({ target, nextRole, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  useEscapeClose(onCancel);
  const tooShort = reason.trim().length < 10;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Assign without a signed agreement</h3>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          Override · recorded in Governance
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
          <strong className="text-gray-800 dark:text-gray-200">{target.name || target.email}</strong> is in the
          Exploring holding state. Normally their role is assigned from the Exploring queue, after they
          sign the binding agreement. This skips that.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
          It asks for your authenticator and a fresh step-up. Their own activity will say the role was
          assigned by override, and why.
        </p>

        <dl className="mt-4 space-y-2 rounded-lg border border-gray-200 p-3 text-[12px] dark:border-gray-700">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">New role</dt>
            <dd className="font-medium text-gray-800 dark:text-gray-200">{nextRole}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Binding agreement</dt>
            <dd className="font-medium text-amber-700 dark:text-amber-300">Not required for this change</dd>
          </div>
        </dl>

        <label htmlFor="role-override-reason" className="mt-4 block text-[12px] font-medium text-gray-700 dark:text-gray-300">
          Reason · required
        </label>
        <textarea
          id="role-override-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is the agreement being skipped? e.g. Signed on paper, countersigned copy in Drive"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          {tooShort
            ? 'At least ten characters — this is the line someone reads in the audit later.'
            : 'Stored on the role change and shown in Governance.'}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200">
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(reason.trim())} disabled={busy || tooShort}
            className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            Override and assign
          </button>
        </div>
      </div>
    </div>
  );
}

function SupportSessionDialog({ target, busy, onCancel, onBegin }) {
  const [reason, setReason] = useState('');
  useEscapeClose(onCancel);
  const tooShort = reason.trim().length < 10;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Start a support session</h3>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
          Recorded in Governance
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
          You will be signed in as <strong className="text-gray-800 dark:text-gray-200">{target.name || target.email}</strong> until
          the session ends. Everything you do is done as them.
        </p>

        <dl className="mt-4 space-y-2 rounded-lg border border-gray-200 p-3 text-[12px] dark:border-gray-700">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Scope</dt>
            <dd className="font-medium text-gray-800 dark:text-gray-200">Read and write as user</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Expiry</dt>
            <dd className="font-medium text-gray-800 dark:text-gray-200">30 minutes · hard</dd>
          </div>
        </dl>

        <label htmlFor="support-reason" className="mt-4 block text-[12px] font-medium text-gray-700 dark:text-gray-300">
          Reason · required
        </label>
        <textarea
          id="support-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What are you helping with? e.g. Password reset, ticket 4821"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          {tooShort
            ? 'At least ten characters — this is the line someone reads in the audit later.'
            : 'This is stored with the session and shown in Governance.'}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200">
            Cancel
          </button>
          <button type="button" onClick={() => onBegin(reason.trim())} disabled={busy || tooShort}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
            Begin session
          </button>
        </div>
      </div>
    </div>
  );
}

// KYC pill colors for the admin user table. `not_started` and an empty/null
// value are treated the same — no submission yet.
const KYC_BADGES = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
  not_started: 'bg-gray-100 text-gray-600',
};

const KYC_LABELS = {
  approved: 'Approved',
  pending: 'Pending',
  rejected: 'Rejected',
  not_started: 'Not started',
};

export default function UsersConsole({ onImpersonate }) {
  const [users, setUsers] = useState([]);
  // Task #40 — batched trust-score map keyed by user_id, populated by a
  // single POST /api/trust/score/batch after each users-list refresh.
  // Replaces the previous per-row GET /trust/score/:userId fan-out.
  const [trustScores, setTrustScores] = useState({});
  const [loading, setLoading] = useState(true);
  // D648 — a failed read is said, never drawn as "No users found".
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('all');
  // D128 — the free-text account search, and the TOTALS the tiles read.
  // `userQuery` is what the box holds; `userSearch` is what has actually been
  // asked for, debounced. `totals` is null until the first envelope answers —
  // never 0, because "not read yet" and "none" are different things and the
  // tiles must not show a zero for the first.
  const [userQuery, setUserQuery] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [totals, setTotals] = useState(null);
  const [userPage, setUserPage] = useState({ showing: 0, limit: 0, searched: false });
  const [openUser, setOpenUser] = useState(null);

  useEffect(() => { loadAll(); }, []);
  // THE BOX IS GATED AT TWO CHARACTERS, matching the route's own refusal
  // (`query_too_short`). The server is the control — a one-character query is
  // refused there whatever the browser does — and this is what keeps a 400 off
  // the screen while somebody is still typing the first letter.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = userQuery.trim();
      setUserSearch(next.length >= 2 ? next : '');
    }, 250);
    return () => clearTimeout(t);
  }, [userQuery]);
  useEffect(() => { loadUsers(userSearch); }, [userSearch]);

  // The users half on its own, so typing does not re-fetch every trust score
  // with each keystroke.
  const loadUsers = async (q = '') => {
    try {
      const res = await api.adminListUsers({ envelope: 1, ...(q ? { q } : {}) });
      const rows = res?.results || [];
      setUsers(rows);
      setTotals({ total: Number(res?.total) || 0, by_role: res?.by_role || {} });
      setUserPage({
        showing: Number(res?.showing) || rows.length,
        limit: Number(res?.limit) || 0,
        searched: Boolean(res?.searched),
      });
      setFailed(false);
    } catch (e) {
      reportError('UsersConsole:loadUsers', e);
      setFailed(true);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const u = await api.adminListUsers({ envelope: 1 });
      const rows = u?.results || [];
      setUsers(rows);
      setTotals({ total: Number(u?.total) || 0, by_role: u?.by_role || {} });
      setUserPage({
        showing: Number(u?.showing) || rows.length,
        limit: Number(u?.limit) || 0,
        searched: false,
      });
      setFailed(false);
      // Task #40 — fan-in trust scores in one call. Best-effort: if it
      // fails (network blip, 403 mid-role-change), each row's
      // UserTrustCell falls back to the per-user GET.
      const ids = rows.map(row => row.id).filter(Boolean);
      if (ids.length > 0) {
        try {
          const res = await api.trustScoreBatch(ids);
          const map = {};
          for (const s of (res?.scores || [])) map[s.user_id] = s;
          setTrustScores(map);
        } catch (e) {
          reportError('UsersConsole:trustScoreBatch', e);
        }
      } else {
        setTrustScores({});
      }
    } catch (e) {
      reportError('UsersConsole:loadAdminData', e);
      setFailed(true);
    } finally { setLoading(false); }
  };

  // The dialog collects the reason the worker requires; nothing is minted
  // until Begin session. `handleImpersonate` is the one funnel both View As
  // buttons already went through, so intercepting here covers both.
  const [supportTarget, setSupportTarget] = useState(null);
  const [supportBusy, setSupportBusy] = useState(false);
  const handleImpersonate = (user) => setSupportTarget(user);
  const beginSupportSession = async (reason) => {
    if (!supportTarget) return;
    setSupportBusy(true);
    try {
      const res = await api.adminImpersonate(supportTarget.id, reason);
      setSupportTarget(null);
      // D290 — the reason as the worker stored it (null when its write
      // failed), passed on for the H25 bar; the shell never reads the typed
      // text back from this dialog.
      if (onImpersonate) onImpersonate(res.token, res.user, null, res.reason ?? null);
    } catch (e) { alert(e.message || 'The support session could not be started'); }
    finally { setSupportBusy(false); }
  };
  // D247 — an administrator's account takes a typed reason, the way Demote
  // asks for one on the licence's Administrators tab; anyone else's is one
  // click, as before. The route also asks for a fresh step-up, which request()
  // prompts for and retries.
  const handleToggleActive = async (user) => {
    let reason;
    if (user.role === 'admin') {
      reason = window.prompt(
        `Why is this administrator account being ${user.is_active ? 'closed' : 're-opened'}? At least 10 characters, and it is recorded.`,
      );
      if (!reason) return;
    }
    try { await api.adminToggleActive(user.id, reason); loadAll(); } catch (e) { alert(e.message); }
  };
  const handleGrantFullAccess = async (user) => {
    const ok = window.confirm(
      `Grant ${user.name || user.email} full access without requiring KYC?\n\n` +
      `This marks their KYC status as approved, lets them out of the verification gate, ` +
      `and is logged in their activity history. Use this only when you've verified their ` +
      `identity through another channel.`
    );
    if (!ok) return;
    try { await api.kycAdminApprove(user.id); loadAll(); }
    catch (e) { alert(e.message || 'Failed to grant access'); }
  };
  const handleGrantLimitedAccess = async (user) => {
    const ok = window.confirm(
      `Grant ${user.name || user.email} limited access?\n\n` +
      `They will be able to log in and browse the platform without completing KYC, ` +
      `BUT they will NOT be able to sign any legal agreements (subscription docs, SPA, ` +
      `side letters, etc.) until they complete full KYC verification.`
    );
    if (!ok) return;
    try { await api.adminSetAccessLevel(user.id, 'limited'); loadAll(); }
    catch (e) { alert(e.message || 'Failed to grant limited access'); }
  };
  const handleRevokeLimitedAccess = async (user) => {
    const ok = window.confirm(
      `Revoke limited access from ${user.name || user.email}?\n\n` +
      `They will be redirected back to the KYC verification flow on next page load.`
    );
    if (!ok) return;
    try { await api.adminSetAccessLevel(user.id, null); loadAll(); }
    catch (e) { alert(e.message || 'Failed to revoke limited access'); }
  };
  // Task #7 — admit a founder to the next Spin-Out Lab cohort. Sends the
  // "You're in" email (production Worker; dev backend sets flags only).
  const handleSpinoutAdmit = async (user) => {
    const cohort = window.prompt(
      `Admit ${user.name || user.email} to the Spin-Out Lab?\n\n` +
      `They'll receive a congratulations email linking to axal.vc/spinout-lab ` +
      `and see the "You're in" screen on their next visit.\n\nCohort label:`,
      'Cohort 3'
    );
    if (cohort === null) return;
    try {
      const res = await api.adminSpinoutAdmit(user.id, cohort.trim() || undefined);
      alert(res?.already_admitted
        ? `Already admitted — cohort refreshed to ${res.cohort} (no email re-sent).`
        : `Admitted to ${res?.cohort || 'the Lab'}${res?.emailed ? ' — email sent.' : ' — email not sent (dev or send failure).'}`);
      loadAll();
    } catch (e) { alert(e.message || 'Failed to admit'); }
  };
  // The pending binding-agreement override: {user, nextRole} while the reason
  // dialog is open, null otherwise. Only a super admin can get here — the
  // dropdown does not offer the options to anyone else, and the server refuses
  // them regardless.
  const [roleOverride, setRoleOverride] = useState(null);
  const [roleOverrideBusy, setRoleOverrideBusy] = useState(false);
  const { user: viewer } = useAuth();
  const canOverrideRole = Number(viewer?.is_super_admin ?? 0) === 1;

  const ROLE_LABELS = { admin: 'Admin', founder: 'Founder', partner: 'Partner', investor: 'Investor', advisor: 'Advisor', exploring: 'Exploring' };

  const handleRoleChange = async (user, newRole) => {
    if (newRole === user.role) return;
    // Leaving `exploring` skips a signed binding agreement, so it is not a
    // yes/no confirm — it needs a reason that goes into the audit. Everything
    // else keeps the plain confirm it has always had.
    if (String(user.role).toLowerCase() === 'exploring' && newRole !== 'exploring') {
      setRoleOverride({ user, nextRole: newRole });
      return;
    }
    const ok = window.confirm(
      `Change ${user.name || user.email}'s role from ${ROLE_LABELS[user.role] || user.role} ` +
      `to ${ROLE_LABELS[newRole] || newRole}?\n\nThis takes effect immediately and is logged in their activity history.`
    );
    if (!ok) return;
    try { await api.adminUpdateRole(user.id, newRole); loadAll(); } catch (e) { alert(e.message); }
  };

  const confirmRoleOverride = async (reason) => {
    if (!roleOverride) return;
    setRoleOverrideBusy(true);
    try {
      await api.adminUpdateRole(roleOverride.user.id, roleOverride.nextRole, reason);
      setRoleOverride(null);
      loadAll();
    } catch (e) {
      alert(e.message);
    } finally {
      setRoleOverrideBusy(false);
    }
  };

  const filtered = filter === 'all' ? users : users.filter(u => u.role === filter);
  // THE TILES COUNT THE TABLE, NOT THE PAGE (D128). They used to read
  // `users.filter(...).length` over whatever `/admin/users` returned — which
  // defaults to the newest 100 rows — so past a hundred accounts the "All
  // Users" tile showed 100 as though it were the total and every role tile
  // counted one page. `null` while the read is in flight, because a zero there
  // would be the same lie one beat earlier.
  //
  // Task #9 follow-up — new signups land in `exploring` pending admin review,
  // so it is often the largest bucket; it keeps its own filter.
  // S0 WALL RULE 2 — "search says what it searches". On a branch there is one
  // territory and the caption names it. Off a branch the table is HQ's own
  // database — the accounts HQ holds on axal.vc — and since D286 the caption
  // says so (S20's wall rule 2, precedent BranchAccounts.jsx's resting label)
  // rather than saying nothing: "all accounts" would be vague, and no caption
  // left the question open on the one shell where every admin sits today.
  const accountScope = branchOfUser(viewer)
    ? `Searching ${viewer.branch.name || viewer.branch.code} accounts`
    : 'Searching HQ-held accounts';
  const ROLE_TILES = ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'];
  const counts = totals
    ? { all: totals.total, ...Object.fromEntries(ROLE_TILES.map(r => [r, Number(totals.by_role?.[r]) || 0])) }
    : null;

  if (loading) return <div className="text-gray-600 text-center py-20">{CONSOLE_LOADING}</div>;

  return (
    <>
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3" data-testid="admin-user-tiles">
            {Object.entries(counts || { all: null, admin: null, founder: null, partner: null, investor: null, advisor: null, exploring: null }).map(([role, count]) => (
              <button key={role} onClick={() => setFilter(role)}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  filter === role ? 'bg-violet-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-700 hover:border-violet-300'
                }`}>
                <div className="text-lg font-bold">{count === null ? <Unrecorded /> : count}</div>
                <div className="capitalize">{role === 'all' ? 'All Users' : role === 'exploring' ? 'Exploring' : `${role}s`}</div>
              </button>
            ))}
          </div>

          {/* SEARCH, AND A CAPTION THAT SAYS WHAT IS ON SCREEN (D128).
              Until this, the only way to find an account was to scroll the
              newest hundred — the panel filtered by role and nothing else, on
              both tiers. S0's second wall rule is that a search says WHAT it
              searches, which is why the branch caption names the territory and
              HQ's does not: on HQ there is no territory to name. */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <label className="relative flex-1 min-w-[16rem]">
              <span className="sr-only">Search accounts by name or email</span>
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="Search by name or email"
                data-testid="admin-user-search"
                className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-800 dark:bg-gray-900"
              />
            </label>
            {accountScope && (
              <span className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="admin-user-scope">
                {accountScope}
              </span>
            )}
          </div>

          <p className="mb-3 text-[12px] text-gray-500 dark:text-gray-400" data-testid="admin-user-showing">
            {userPage.searched
              ? `${userPage.showing} ${userPage.showing === 1 ? 'account matches' : 'accounts match'} “${userSearch}”${userPage.limit && userPage.showing >= userPage.limit ? ` — the first ${userPage.limit}; narrow the search to see the rest` : ''}`
              : counts === null
                ? 'Reading the directory…'
                : userPage.limit && counts.all > userPage.limit
                  ? `Showing the newest ${userPage.showing} of ${counts.all} accounts. The tiles above count every account; this table is one page. Search to reach the rest.`
                  : `Showing all ${counts.all} ${counts.all === 1 ? 'account' : 'accounts'}.`}
          </p>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
            {failed ? (
              <ConsoleUnreadable what="The accounts" onRetry={() => loadAll()} />
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No users found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                      <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Name</th>
                      <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Email</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Role</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Verified</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">KYC</th>
                      <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs" title="Required legal obligations satisfied">Trust</th>
                      <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Joined</th>
                      <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(u => (
                      <tr key={u.id} onClick={() => setOpenUser(u)}
                        className="border-b border-gray-100 hover:bg-violet-50/40 cursor-pointer">
                        <td className="px-4 py-3 text-gray-900 font-medium dark:text-gray-100">{u.name}</td>
                        <td className="px-4 py-3 text-gray-600">{u.email}</td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          {u.role === 'admin' ? (
                            // Admin role is read-only in THIS picker, and the PATCH
                            // /users/:id/role endpoint refuses to promote into or demote
                            // out of `admin`. D221 — the tooltip used to say those changes
                            // "can only be made via direct database SQL", which stopped
                            // being true in D134: an administrator is opened through a
                            // licence (POST /licences/:uid/admins) and demoted there by the
                            // Super Admin (POST /users/:id/demote-admin), both on the
                            // licence's Administrators tab.
                            <span
                              title="An administrator is opened and demoted on the licence they hold (Licences → Administrators), by the Super Admin — not from this picker"
                              className={`inline-block text-xs font-semibold px-3 py-1 rounded-full ${ROLE_BADGES.admin || 'bg-violet-100 text-violet-700'}`}
                            >
                              Admin
                            </span>
                          ) : (
                            // Admin promotion intentionally not offered — see span branch above.
                            <RoleDropdown user={u} onRoleChange={handleRoleChange} canOverride={canOverrideRole} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {u.email_verified ? <UserCheck size={16} className="text-green-500 mx-auto" /> : <UserX size={16} className="text-gray-400 mx-auto" />}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(() => {
                            const k = u.kyc_status || 'not_started';
                            // Limited-access takes visual precedence ONLY when the user is
                            // not already approved — once they're approved, KYC trumps everything.
                            const isLimited = u.access_level === 'limited' && k !== 'approved';
                            if (isLimited) {
                              return (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-700"
                                  title="Browse-only access. Cannot sign legal agreements until KYC is complete.">
                                  <ShieldCheck size={11} />
                                  Limited
                                </span>
                              );
                            }
                            return (
                              <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${KYC_BADGES[k] || KYC_BADGES.not_started}`}>
                                <ShieldCheck size={11} />
                                {KYC_LABELS[k] || k}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <UserTrustCell userId={u.id} data={trustScores[u.id]} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end flex-wrap">
                            {/* Admins always have access; only show "Grant Full Access" for
                                non-admin users whose KYC isn't already approved. */}
                            {u.role !== 'admin' && u.kyc_status !== 'approved' && (
                              <button onClick={() => handleGrantFullAccess(u)}
                                className="px-2.5 py-1.5 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                                title="Mark KYC approved without requiring submission">
                                <ShieldCheck size={12} /> Grant Access
                              </button>
                            )}
                            {/* Limited access: browse-only without KYC, no signing.
                                Only meaningful for non-admins not yet approved. */}
                            {u.role !== 'admin' && u.kyc_status !== 'approved' && u.access_level !== 'limited' && (
                              <button onClick={() => handleGrantLimitedAccess(u)}
                                className="px-2.5 py-1.5 text-xs bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                                title="Allow login & browsing without KYC. Signing remains blocked.">
                                <ShieldCheck size={12} /> Grant Limited
                              </button>
                            )}
                            {u.role !== 'admin' && u.access_level === 'limited' && u.kyc_status !== 'approved' && (
                              <button onClick={() => handleRevokeLimitedAccess(u)}
                                className="px-2.5 py-1.5 text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                                title="Remove limited access. User will be redirected to KYC.">
                                Revoke Limited
                              </button>
                            )}
                            {/* Task #7 — Spin-Out Lab admission. Admins excluded. */}
                            {u.role !== 'admin' && (
                              <button onClick={() => handleSpinoutAdmit(u)}
                                className="px-2.5 py-1.5 text-xs bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                                title="Admit to the next Spin-Out Lab cohort — sends the congratulations email">
                                Admit to Lab
                              </button>
                            )}
                            {/* D221 — neither is drawn where the server can only
                                refuse: an admin's row, unless the viewer holds the
                                elevation (D132 on the toggle, D133 on impersonation),
                                and the viewer's own row. `lib/accountControls.js`
                                holds the one rule both controls follow. */}
                            {drawsAccountControls(u, viewer) && (
                              <>
                                <button onClick={() => handleImpersonate(u)}
                                  className="px-2.5 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg font-medium transition-colors flex items-center gap-1"
                                  title="Login as this user">
                                  <LogIn size={12} /> View As
                                </button>
                                <button onClick={() => handleToggleActive(u)}
                                  className={`px-2.5 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                                    u.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'
                                  }`}>
                                  {u.is_active ? 'Disable' : 'Enable'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      {/* Mounted beside the drawer, not inside it: the Users table opens a
          support session directly too, and the drawer closes itself before
          the dialog appears. */}
      {supportTarget && (
        <SupportSessionDialog
          target={supportTarget}
          busy={supportBusy}
          onCancel={() => setSupportTarget(null)}
          onBegin={beginSupportSession}
        />
      )}
      {roleOverride && (
        <RoleOverrideDialog
          target={roleOverride.user}
          nextRole={ROLE_LABELS[roleOverride.nextRole] || roleOverride.nextRole}
          busy={roleOverrideBusy}
          onCancel={() => setRoleOverride(null)}
          onConfirm={confirmRoleOverride}
        />
      )}
      {openUser && (
        <UserDetailModal
          userRow={openUser}
          onClose={() => setOpenUser(null)}
          // D221 — the drawer follows the row's rule: where the server can
          // only refuse, it is handed no handler and draws no button.
          onImpersonate={drawsAccountControls(openUser, viewer) ? () => { handleImpersonate(openUser); setOpenUser(null); } : null}
          onToggleActive={drawsAccountControls(openUser, viewer) ? () => { handleToggleActive(openUser); setOpenUser(null); } : null}
          // D633 (#1391, Q2) — the member's credits are the Super Admin's.
          showCredits={isSuperAdminUser(viewer)}
        />
      )}
    </>
  );
}

export function UserDetailModal({ userRow, onClose, onImpersonate, onToggleActive, showCredits = false }) {
  useEscapeClose(onClose);
  // D775 (#2101): the open account is the rail's record while the drawer is shown.
  useRecordCrumb(userRow?.name || userRow?.email || null, 'account', userRow?.id);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('profile');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  // T19 — toast lifecycle now handled by useToast (cleans up on unmount).
  const { toast, showToast: setToastSafe } = useToast(3000);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.adminUserProfile(userRow.id);
        if (!alive) return;
        setData(res);
        setNotes(res.user.admin_notes || '');
      } catch (e) {
        if (alive) setErr(e.message || 'Failed to load profile');
      }
    })();
    return () => { alive = false; };
  }, [userRow.id]);

  const flash = (kind, msg) => setToastSafe({ kind, msg });

  const saveNotes = async () => {
    setSaving(true);
    try {
      await api.adminUpdateNotes(userRow.id, notes);
      flash('ok', 'Notes saved');
    } catch (e) { flash('err', e.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const resend = async () => {
    if (!confirm(`Resend verification email to ${userRow.email}?`)) return;
    setResending(true);
    try {
      const r = await api.adminResendVerification(userRow.id);
      flash('ok', r.already_verified ? 'User is already verified' : 'Verification email sent');
    } catch (e) { flash('err', e.message || 'Failed to send'); }
    finally { setResending(false); }
  };

  const u = data?.user || userRow;
  const stats = data?.stats || {};
  const activity = data?.activity || [];
  const tickets = data?.tickets || [];
  const integrations = data?.integrations || [];
  const kyc = data?.kyc || {};

  // Task #1 (DB) — Onboarding + Ongoing Conversation tabs both fetch
  // through the dedicated, audited transcript endpoints. The Ongoing
  // tab uses a left-rail conversation list + right-pane drilldown,
  // search/date filters, CSV export, and per-message sparkle indicators
  // for messages that triggered a domain write (advisor_answers row).
  const [onboardingDetail, setOnboardingDetail] = useState(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [advisorList, setAdvisorList] = useState([]);
  const [advisorListLoading, setAdvisorListLoading] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState(null);
  const [convDetail, setConvDetail] = useState(null);
  const [convDetailLoading, setConvDetailLoading] = useState(false);
  const [advisorSearch, setAdvisorSearch] = useState('');
  const [advisorSince, setAdvisorSince] = useState('');
  const [advisorUntil, setAdvisorUntil] = useState('');

  useEffect(() => {
    if (tab !== 'onboarding') return;
    let alive = true;
    setOnboardingLoading(true);
    (async () => {
      try {
        const res = await api.adminUserOnboardingConversation(userRow.id);
        if (alive) setOnboardingDetail(res);
      } catch (e) {
        if (alive) flash('err', e.message || 'Failed to load onboarding transcript');
      } finally {
        if (alive) setOnboardingLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, userRow.id]);

  useEffect(() => {
    if (tab !== 'advisor') return;
    let alive = true;
    setAdvisorListLoading(true);
    (async () => {
      try {
        const res = await api.adminUserAdvisorConversations(userRow.id, {
          q: advisorSearch || undefined,
          since: advisorSince || undefined,
          until: advisorUntil || undefined,
          limit: 100,
        });
        if (!alive) return;
        const list = res?.conversations || [];
        setAdvisorList(list);
        if (list.length && !list.find(c => c.id === selectedConvId)) {
          setSelectedConvId(list[0].id);
        }
      } catch (e) {
        if (alive) flash('err', e.message || 'Failed to load conversations');
      } finally {
        if (alive) setAdvisorListLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, userRow.id, advisorSearch, advisorSince, advisorUntil]);

  useEffect(() => {
    if (tab !== 'advisor' || !selectedConvId) { setConvDetail(null); return; }
    let alive = true;
    setConvDetailLoading(true);
    (async () => {
      try {
        const res = await api.adminUserAdvisorConversation(userRow.id, selectedConvId);
        if (alive) setConvDetail(res);
      } catch (e) {
        if (alive) flash('err', e.message || 'Failed to load transcript');
      } finally {
        if (alive) setConvDetailLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, userRow.id, selectedConvId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between dark:border-gray-800">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{u.name}</h3>
              <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${ROLE_BADGES[u.role] || 'bg-gray-100 text-gray-700'}`}>{u.role}</span>
              <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{u.is_active ? 'Active' : 'Inactive'}</span>
              {u.email_verified ? (
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700">Verified</span>
              ) : (
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">Unverified</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">{u.email} · joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        {toast && (
          <div className={`mx-6 mt-3 px-3 py-2 rounded-lg text-xs ${toast.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{toast.msg}</div>
        )}

        <div className="px-6 pt-3 border-b border-gray-200 flex gap-1 overflow-x-auto dark:border-gray-800">
          {['profile', 'registration', 'onboarding', 'advisor', 'kyc', 'agreements', 'activity', 'notes'].map(t => {
            // Task #11 — onboarding tab now reads from the user's first
            // advisor conversation; the new 'advisor' tab reads from their
            // most-recent. Fall back to the legacy `data.onboarding` shape
            // for safety so a stale worker response still renders something.
            const onboardingMsgs = data?.onboarding_conversation?.messages || data?.onboarding || [];
            const ongoingMsgs = data?.ongoing_conversation?.messages || [];
            return (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px capitalize whitespace-nowrap transition-colors ${tab === t ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
                {t === 'kyc' ? 'KYC & Verification' :
                 t === 'registration' ? `Registration${(data?.timeline?.length ?? 0) ? ` · ${data.timeline.length}` : ''}` :
                 t === 'agreements' ? `Agreements${(data?.agreements?.length ?? 0) ? ` · ${data.agreements.length}` : ''}` :
                 t === 'onboarding' ? `Onboarding${onboardingMsgs.length ? ` · ${onboardingMsgs.length}` : ''}` :
                 t === 'advisor' ? `Ongoing Conversation${ongoingMsgs.length ? ` · ${ongoingMsgs.length}` : ''}` :
                 t === 'activity' ? `Activity${(data?.activity?.length ?? 0) ? ` · ${data.activity.length}` : ''}` :
                 t}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {err && <div className="text-sm text-red-600 mb-4">{err}</div>}
          {!data && !err && <div className="text-sm text-gray-500">Loading…</div>}

          {data && tab === 'profile' && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Name" value={u.name} />
              <Field label="Email" value={u.email} />
              <Field label="Role" value={u.role} />
              <Field label="UID" value={u.uid} mono />
              <Field label="Founder ID" value={u.founder_public_id || (u.founder_id ? `#${u.founder_id}` : '—')} mono={!!u.founder_public_id} />
              <Field label="Partner ID" value={u.partner_public_id || (u.partner_id ? `#${u.partner_id}` : '—')} mono={!!u.partner_public_id} />
              <Field label="Joined" value={u.created_at ? new Date(u.created_at).toLocaleString() : '—'} />
              <Field label="Last active" value={u.last_active_at ? new Date(u.last_active_at).toLocaleString() : '—'} />
              <div className="col-span-2 grid grid-cols-4 gap-3 mt-2">
                <Stat label="Activity events" value={stats.activity_count ?? 0} />
                <Stat label="Tickets" value={stats.ticket_count ?? 0} />
                <Stat label="Integrations" value={stats.integration_count ?? 0} />
                <Stat label="Agreements" value={stats.agreement_count ?? 0} />
              </div>
              {(data.founder || data.partner) && (
                <div className="col-span-2 mt-3 bg-violet-50 border border-violet-200 rounded-lg p-3">
                  <div className="text-xs font-semibold text-violet-700 mb-2">
                    {data.founder ? 'Founder profile' : 'Partner profile'}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-800 dark:text-gray-200">
                    {data.founder && (
                      <>
                        {data.founder.domain_expertise && <Field label="Expertise" value={data.founder.domain_expertise} />}
                        {data.founder.experience_years != null && <Field label="Experience" value={`${data.founder.experience_years} yrs`} />}
                        {data.founder.linkedin_url && (
                          <div className="col-span-2">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">LinkedIn</div>
                            <a href={data.founder.linkedin_url} target="_blank" rel="noreferrer"
                              className="text-violet-700 hover:underline break-all">{data.founder.linkedin_url}</a>
                          </div>
                        )}
                        {data.founder.bio && (
                          <div className="col-span-2">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Bio</div>
                            <div className="text-gray-800 whitespace-pre-wrap dark:text-gray-200">{data.founder.bio}</div>
                          </div>
                        )}
                      </>
                    )}
                    {data.partner && (
                      <>
                        {data.partner.company && <Field label="Company" value={data.partner.company} />}
                        {data.partner.specialization && <Field label="Specialization" value={data.partner.specialization} />}
                        {data.partner.status && <Field label="Status" value={data.partner.status} />}
                      </>
                    )}
                  </div>
                </div>
              )}
              {integrations.length > 0 && (
                <div className="col-span-2 mt-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2 dark:text-gray-300">Connected integrations</div>
                  <div className="space-y-1.5">
                    {integrations.map(i => (
                      <div key={i.uid} className="flex items-center justify-between text-xs bg-gray-50 px-3 py-2 rounded-lg">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{i.display_name || i.provider_name}</span>
                        <span className="text-gray-500">{i.status} · {i.last_synced_at ? new Date(i.last_synced_at).toLocaleString() : 'never synced'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {data && tab === 'registration' && (
            <div className="space-y-2">
              {(data.timeline || []).length === 0 && <div className="text-sm text-gray-500">No registration events recorded.</div>}
              {(data.timeline || []).map((ev, i) => (
                <div key={`${ev.kind}-${ev.ts}-${i}`} className="flex gap-3 text-xs">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-violet-500 mt-1.5" />
                    {i < (data.timeline.length - 1) && <div className="w-px flex-1 bg-gray-200 mt-1" />}
                  </div>
                  <div className="flex-1 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900 capitalize dark:text-gray-100">{ev.label}</span>
                      <span className="text-gray-500 whitespace-nowrap">{ev.ts ? new Date(ev.ts).toLocaleString() : ''}</span>
                    </div>
                    {ev.detail && <div className="text-gray-600 mt-0.5">{ev.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data && tab === 'agreements' && (
            <div className="space-y-2">
              {(data.agreements || []).length === 0 && <div className="text-sm text-gray-500">No eSign agreements yet.</div>}
              {(data.agreements || []).map(ag => (
                <div key={`${ag.envelope_id}-${ag.recipient_id || 'na'}`} className="border border-gray-200 rounded-lg p-3 text-xs dark:border-gray-800">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{ag.document_title || ag.document_type || 'Agreement'}</div>
                      <div className="text-gray-500 mt-0.5">
                        {ag.role_in_envelope === 'creator' ? 'Sent by user' : 'Recipient'}
                        {ag.recipient_email ? ` · ${ag.recipient_email}` : ''}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide text-[10px] ${
                      (ag.recipient_status || ag.envelope_status) === 'signed' || (ag.recipient_status || ag.envelope_status) === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                      (ag.recipient_status || ag.envelope_status) === 'pending' || (ag.recipient_status || ag.envelope_status) === 'sent' ? 'bg-amber-100 text-amber-700' :
                      (ag.recipient_status || ag.envelope_status) === 'declined' || (ag.recipient_status || ag.envelope_status) === 'expired' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {ag.recipient_status || ag.envelope_status || 'unknown'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-gray-600">
                    <div>Created: {ag.created_at ? new Date(ag.created_at).toLocaleString() : '—'}</div>
                    <div>Signed: {ag.recipient_signed_at || ag.signed_at ? new Date(ag.recipient_signed_at || ag.signed_at).toLocaleString() : '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'onboarding' && (() => {
            // Task #1 (DB) — Onboarding tab fetches via the dedicated
            // /api/admin/users/:id/conversations/onboarding endpoint so
            // every view is recorded in admin_profile_audit +
            // admin_audit_log. Worker returns summary + completion_pct
            // pre-computed; no client-side derivation.
            if (onboardingLoading && !onboardingDetail) {
              return <div className="text-xs text-gray-500 p-4">Loading onboarding transcript…</div>;
            }
            const msgs = onboardingDetail?.messages || [];
            const conv = onboardingDetail?.conversation || null;
            const completionPct = onboardingDetail?.completion_pct ?? 0;
            const summary = onboardingDetail?.summary || null;
            // Task #34 — distinguish "user never started onboarding"
            // from "user opened the chatbot but never answered". Backend
            // returns one of: 'never_completed' | 'in_progress' | null.
            const emptyReason = onboardingDetail?.empty_reason || null;
            return (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare size={14} className="text-gray-600" />
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Onboarding Conversation</h4>
                  {conv && (
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-violet-50 text-violet-700">
                      {conv.persona} · {conv.state}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-gray-500">
                    {msgs.length} message{msgs.length === 1 ? '' : 's'} · {completionPct}% complete
                  </span>
                </div>
                {summary && (
                  <div className="mb-2 text-[11px] text-gray-600 bg-violet-50 border border-violet-100 rounded-lg p-2">
                    <span className="font-semibold text-violet-800">Summary:</span> {summary}
                  </div>
                )}
                {msgs.length === 0 ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-500 dark:border-gray-800">
                    {emptyReason === 'in_progress' ? (
                      <>
                        <div className="font-semibold text-gray-700 mb-1 dark:text-gray-300">Onboarding in progress</div>
                        This user has opened the Personal Advisor onboarding session but hasn’t answered any questions yet. The transcript will populate as soon as they respond to the first prompt.
                      </>
                    ) : (
                      <>
                        <div className="font-semibold text-gray-700 mb-1 dark:text-gray-300">Never completed onboarding</div>
                        This user has not started the Personal Advisor onboarding chatbot. Conversations sync here once they answer their first question.
                      </>
                    )}
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-[60vh] overflow-y-auto space-y-2 dark:border-gray-800">
                    {msgs.map((m, i) => (
                      <ChatBubble key={i} m={m} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {data && tab === 'advisor' && (
            <div className="flex gap-3 h-[65vh]">
              {/* LEFT RAIL — conversation list with search + date filters + CSV */}
              <div className="w-64 shrink-0 border border-gray-200 rounded-lg bg-white flex flex-col dark:border-gray-800 dark:bg-gray-900">
                <div className="p-2 border-b border-gray-200 space-y-2 dark:border-gray-800">
                  <input
                    type="search"
                    value={advisorSearch}
                    onChange={(e) => setAdvisorSearch(e.target.value)}
                    placeholder="Search persona / state / model"
                    className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded dark:border-gray-700"
                  />
                  <div className="flex gap-1">
                    <input
                      type="date"
                      value={advisorSince}
                      onChange={(e) => setAdvisorSince(e.target.value)}
                      title="From"
                      className="flex-1 text-[11px] px-1.5 py-1 border border-gray-300 rounded dark:border-gray-700"
                    />
                    <input
                      type="date"
                      value={advisorUntil}
                      onChange={(e) => setAdvisorUntil(e.target.value)}
                      title="To"
                      className="flex-1 text-[11px] px-1.5 py-1 border border-gray-300 rounded dark:border-gray-700"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api.adminUserAdvisorTranscriptExport(userRow.id, {
                          from: advisorSince || undefined,
                          to: advisorUntil || undefined,
                        });
                      } catch (e) {
                        flash('error', e.message || 'CSV export failed');
                      }
                    }}
                    className="block w-full text-center text-[11px] px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded font-medium text-gray-700 dark:text-gray-300"
                  >
                    Download CSV
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {advisorListLoading && (
                    <div className="p-3 text-[11px] text-gray-500">Loading…</div>
                  )}
                  {!advisorListLoading && advisorList.length === 0 && (
                    <div className="p-3 text-[11px] text-gray-500">No conversations.</div>
                  )}
                  {advisorList.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedConvId(c.id)}
                      className={`w-full text-left px-2.5 py-2 border-b border-gray-100 text-[11px] hover:bg-gray-50 ${selectedConvId === c.id ? 'bg-violet-50' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-gray-900 truncate dark:text-gray-100">{c.persona || '—'}</span>
                        {(c.write_count ?? 0) > 0 && (
                          <span title={`${c.write_count} writes`} className="text-amber-500">✦</span>
                        )}
                      </div>
                      <div className="text-gray-600 truncate">{c.state || '—'} · {c.completion_pct ?? 0}%</div>
                      <div className="text-gray-400 mt-0.5">{c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}</div>
                      {c.last_model && (
                        <div className="text-gray-400 truncate">{c.last_model}{c.last_latency_ms ? ` · ${c.last_latency_ms}ms` : ''}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* RIGHT PANE — selected conversation transcript */}
              <div className="flex-1 min-w-0 border border-gray-200 rounded-lg bg-gray-50 flex flex-col dark:border-gray-800">
                {!selectedConvId && (
                  <div className="p-4 text-xs text-gray-500">Select a conversation from the list.</div>
                )}
                {selectedConvId && convDetailLoading && (
                  <div className="p-4 text-xs text-gray-500">Loading transcript…</div>
                )}
                {selectedConvId && convDetail && (() => {
                  const c = convDetail.conversation;
                  const msgs = convDetail.messages || [];
                  return (
                    <>
                      <div className="p-3 border-b border-gray-200 bg-white text-xs dark:border-gray-800 dark:bg-gray-900">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{c?.persona || '—'}</span>
                          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-violet-50 text-violet-700">{c?.state || '—'}</span>
                          <span className="text-gray-500">{convDetail.completion_pct ?? 0}% complete · {msgs.length} msg</span>
                        </div>
                        {convDetail.summary && (
                          <div className="mt-1.5 text-[11px] text-gray-700 bg-violet-50 border border-violet-100 rounded px-2 py-1.5 dark:text-gray-300">
                            <span className="font-semibold text-violet-800">Summary:</span> {convDetail.summary}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {msgs.map((m, i) => <ChatBubble key={i} m={m} />)}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {data && tab === 'kyc' && (
            <div className="space-y-3 text-sm">
              <Field label="KYC status" value={kyc.status || 'unknown'} />
              <Field label="Email verified" value={u.email_verified ? 'Yes' : 'No'} />
              <TotpEnrolmentField kyc={kyc} />
              <Field label="ID document uploaded" value={kyc.id_uploaded ? 'Yes' : 'No'} />
              <div className="pt-2">
                <button onClick={resend} disabled={resending || u.email_verified}
                  className="px-3 py-2 text-xs bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:bg-gray-300">
                  {resending ? 'Sending…' : u.email_verified ? 'Already verified' : 'Resend verification email'}
                </button>
              </div>
            </div>
          )}

          {data && tab === 'activity' && (
            <div className="space-y-2">
              {activity.length === 0 && <div className="text-sm text-gray-500">No activity recorded.</div>}
              {activity.map(a => (
                <div key={a.id} className="text-xs border border-gray-200 rounded-lg p-2.5 dark:border-gray-800">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{a.action}</span>
                    <span className="text-gray-500">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                  </div>
                  {a.details && <div className="text-gray-600 mt-1">{a.details}</div>}
                </div>
              ))}
              {tickets.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-gray-700 mt-4 mb-2 dark:text-gray-300">Recent tickets</div>
                  {tickets.map(t => (
                    <div key={t.id} className="text-xs border border-gray-200 rounded-lg p-2.5 flex items-center justify-between dark:border-gray-800">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{t.title}</span>
                      <span className="text-gray-500">{t.status} · {t.priority}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {data && tab === 'notes' && (
            <div className="space-y-3">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Admin notes (visible only to admins)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={8}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700"
                placeholder="Internal notes about this user…" />
              <div className="flex gap-2">
                <button onClick={saveNotes} disabled={saving}
                  className="px-3 py-2 text-xs bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:bg-gray-300">
                  {saving ? 'Saving…' : 'Save notes'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between dark:border-gray-800">
          <div className="flex gap-2">
            {/* D221 — absent, never disabled: a handler of null means the
                server would refuse this viewer on this account. */}
            {onImpersonate && (
              <button onClick={onImpersonate}
                className="px-3 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg font-medium flex items-center gap-1">
                <LogIn size={12} /> View As
              </button>
            )}
            {showCredits && (
              <Link to={`/admin/accounts/credits/${u.id}`} data-testid="user-drawer-credits"
                className="px-3 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900 rounded-lg font-medium">
                Credits
              </Link>
            )}
            {onToggleActive && (
              <button onClick={onToggleActive}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium ${u.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                {u.is_active ? 'Disable account' : 'Enable account'}
              </button>
            )}
          </div>
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900">Close</button>
        </div>
      </div>
    </div>
  );
}

// Task #1 (DB) — shared chat-bubble renderer for the Onboarding +
// Ongoing Conversation tabs. Surfaces the per-message metadata that
// the worker now returns: model, latency_ms, tokens, and a sparkle
// indicator when the assistant turn triggered a domain write
// (advisor_answers row landed in a real table).
function ChatBubble({ m }) {
  const wrote = m.written_to;
  const wroteOk = wrote && (wrote.status === 'ok' || wrote.status === 'success' || wrote.table);
  return (
    <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] text-xs px-3 py-2 rounded-lg whitespace-pre-wrap ${
        m.role === 'user'
          ? 'bg-violet-600 text-white'
          : m.role === 'system'
          ? 'bg-amber-50 border border-amber-200 text-amber-800'
          : m.role === 'tool'
          ? 'bg-blue-50 border border-blue-200 text-blue-800'
          : 'bg-white border border-gray-200 text-gray-800'
      }`}>
        <div className="flex items-start gap-1.5">
          {wroteOk && (
            <span title={`Wrote to ${wrote.table || ''}${wrote.column ? `.${wrote.column}` : ''}`}
                  className="text-amber-500 shrink-0">✦</span>
          )}
          <div className="flex-1 min-w-0">{m.content}</div>
        </div>
        {(m.ts || m.model || m.latency_ms != null || m.tokens != null) && (
          <div className={`mt-1 text-[10px] ${m.role === 'user' ? 'text-violet-100' : 'text-gray-400'}`}>
            {m.ts ? new Date(m.ts).toLocaleString() : ''}
            {m.question_id ? ` · ${m.question_id}` : ''}
            {m.model ? ` · ${m.model}` : ''}
            {m.latency_ms != null ? ` · ${m.latency_ms}ms` : ''}
            {m.tokens != null ? ` · ${m.tokens}t` : ''}
            {wroteOk && wrote.table ? ` · → ${wrote.table}${wrote.column ? `.${wrote.column}` : ''}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * D236 — the drawer's authenticator line, in the three states the server
 * sends. `true` and `false` are answers, read from the same definition sign-in
 * uses. Anything else is not an answer: `null` means the read failed, and a
 * payload without the field said nothing. Printing "No" for either would
 * repeat the hard-coded placeholder this replaced, which told HQ that every
 * account had no second factor.
 *
 * "Yes" does not claim the factor is required at every sign-in: a magic link
 * still signs an enrolled account in, at a lower assurance, so the old
 * "(required at login)" was never true for every route in.
 */
export function TotpEnrolmentField({ kyc }) {
  const enrolled = kyc?.totp_enabled;
  const value = enrolled === true
    ? 'Yes — an authenticator app is enrolled'
    : enrolled === false
      ? 'No — no authenticator app is enrolled'
      : (
        <Unreadable
          what="Authenticator enrolment"
          claim={kyc?.totp_reason || 'The profile did not say whether an authenticator is enrolled.'}
        />
      );
  return <Field label="TOTP enabled" value={value} />;
}

function Stat({ label, value }) {
  return (
    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
      <div className="text-2xl font-bold text-violet-700">{value}</div>
      <div className="text-[11px] text-gray-600 mt-0.5">{label}</div>
    </div>
  );
}
