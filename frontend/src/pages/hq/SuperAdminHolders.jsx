import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card } from '../../ui';

/**
 * The holder console — who holds the Super Admin elevation.
 *
 * Backed by routes/admin_super_admins.ts. Reads need the elevation; grant and
 * revoke need a TOTP-minted session with a recent step-up, the bar
 * impersonation sets. `lib/api.js` already turns a 403 `step_up_required`
 * into the StepUpModal and retries, so a write here prompts for a fresh code
 * rather than failing. A session that was never minted with TOTP cannot be
 * stepped up; the worker says 'TOTP required' and this says what to do.
 *
 * The worker refuses a non-admin target, self-revoke and the last active
 * holder. Those refusals are shown verbatim: each is a sentence written for a
 * person, not a code to translate.
 *
 * D221 — A GRANT OR TRANSFER CARRIES A TYPED REASON. It was the one act H20
 * draws as HQ's with no why: opening a support session, demoting an admin and
 * overriding a binding agreement each take ten characters, and the elevation
 * that governs all three took none. The floor is the server's
 * (`HOLDER_REASON_MIN` in routes/admin_super_admins.ts); the form mirrors it so
 * it never offers a submission the server can only refuse.
 */
const HOLDER_REASON_MIN = 10;

const FRIENDLY = {
  'TOTP required': 'Changing holders needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.',
  'Super admin required': 'Only a current holder can change who holds the elevation.',
};

function messageOf(e) {
  const msg = String(e?.message || e || 'Request failed');
  return FRIENDLY[msg] || msg;
}

export default function SuperAdminHolders({ onChanged }) {
  const [holders, setHolders] = useState(null);   // null = not loaded yet
  const [admins, setAdmins] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  // D221 — WHO THIS ACCOUNT JUST HANDED THE PLATFORM TO. After a transfer it no
  // longer holds the elevation, so the reads this card and the Team table make
  // answer 403. Reloading them read that refusal back as an error on a change
  // that had SUCCEEDED ("Only a current holder can change who holds the
  // elevation"), which is the one message a successful handover must never
  // show. The card says what happened instead, and stops reading.
  const [handed, setHanded] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // D138 — THE PICKER USED TO BE FED A PAGE, WHICH IS A FUNCTIONAL BUG AND
      // NOT A DISPLAY ONE. This was `api.adminListUsers()` with no arguments —
      // `ORDER BY created_at DESC LIMIT 100` — filtered to `role === 'admin'`
      // in the browser. Admins are among the OLDEST accounts, so past a hundred
      // rows an admin is not in the list at all, and the `<select>` below reads
      // "No other admin to hand it to" about a database that has several. You
      // cannot grant the elevation to somebody who is not in the list.
      //
      // `api.hqAdmins()` filters on role SERVER-SIDE with no LIMIT, which is
      // sound because the query has a predicate: admins are one per licence
      // plus HQ, not a directory.
      const [h, u] = await Promise.all([api.superAdmins(), api.hqAdmins()]);
      setHolders(Array.isArray(h?.holders) ? h.holders : []);
      // The Team payload names the account `user_id`; the grant route and the
      // holder list both key on `id`, so the shape is normalised here rather
      // than at four render sites.
      const list = Array.isArray(u?.items) ? u.items : [];
      setAdmins(list.map((x) => ({
        id: x.user_id, name: x.name, email: x.email, is_active: x.is_active,
      })));
    } catch (e) {
      reportError('super-admin-holders', e);
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, handedTo = null) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (handedTo) {
        setHanded({ name: handedTo.name || handedTo.email, at: new Date() });
        return;
      }
      await load();
      // The Team table above renders the super-admin badge from the same
      // elevation, so it is told rather than left stale until a reload.
      onChanged?.();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  const holderIds = new Set((holders || []).map((h) => h.id));
  // D221 — A DEACTIVATED ADMIN IS NOT OFFERED. The route refuses one
  // (`not_active`): an account that cannot sign in would hold an elevation
  // nobody could use, and the holder would have given it up. A choice the
  // server can only refuse is not drawn (D134's rule).
  const candidates = admins.filter((a) => !holderIds.has(a.id) && Number(a.is_active) === 1);
  // One active holder is the enforced state, so the form's verb follows it.
  const hasHolder = (holders || []).some((h) => Number(h.is_active) === 1);
  const reasonReady = reason.trim().length >= HOLDER_REASON_MIN;

  if (handed) {
    return (
      <Card className="p-5" data-testid="super-admin-holders">
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <ShieldCheck size={13} /> Super Admin holders
        </div>
        <p className="mt-2 text-[13px] font-semibold text-axal-ink" data-testid="super-admin-handed">
          Handed to {handed.name} · {handed.at.toLocaleString()}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-axal-muted">
          You no longer hold the elevation, so HQ's pages stop answering this account. The change
          and your reason are recorded in Security. Reload to leave HQ.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 rounded-md border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold text-axal-ink hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Reload
        </button>
      </Card>
    );
  }

  return (
    <Card className="p-5" data-testid="super-admin-holders">
      <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
        <ShieldCheck size={13} /> Super Admin holders
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-axal-muted">
        The account that licenses the platform to subsidiaries. <strong>Exactly one holder,
        enforced</strong> — not a convention: a second elevation is refused. Handing it on is a
        transfer, which grants and revokes in one act so the set is never two nor empty. Changes
        need your authenticator and a typed reason, and Security records both.
      </p>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <ul className="mt-3 divide-y divide-axal-hairline" data-testid="super-admin-holder-list">
        {holders === null && !error && (
          <li className="py-2 text-[12px] text-axal-faint"><Loader2 size={13} className="inline animate-spin" /> Loading holders…</li>
        )}
        {holders !== null && holders.length === 0 && (
          <li className="py-2 text-[12px] text-axal-faint">No holder is recorded. Migration 207 names one; until it has applied to this database, nobody can franchise.</li>
        )}
        {(holders || []).map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-axal-ink">{h.name || h.email}</div>
              <div className="truncate text-[11.5px] text-axal-faint">{h.email}{Number(h.is_active) === 1 ? '' : ' · inactive'}</div>
            </div>
            <button
              type="button"
              disabled={busy || (holders || []).filter((x) => Number(x.is_active) === 1 && x.id !== h.id).length === 0}
              onClick={() => run(() => api.superAdminRevoke(h.id))}
              className="rounded-md border border-red-300 px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
              title="The last active holder cannot be revoked."
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>

      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pick || !reasonReady) return;
          // WITH A HOLDER, THE ONLY LAWFUL MOVE IS A TRANSFER, so the form asks for
          // one rather than sending a grant the server will refuse with 409. A
          // button that reliably errors is the "bare error" D132 was written about.
          const to = candidates.find((a) => String(a.id) === String(pick)) || null;
          run(
            () => api.superAdminGrant(Number(pick), { transfer: hasHolder, reason: reason.trim() }),
            hasHolder ? to || { name: `account ${pick}` } : null,
          ).then(() => { setPick(''); setReason(''); });
        }}
      >
        <label htmlFor="super-admin-grant" className="text-[12px] font-semibold text-axal-muted">
          {hasHolder ? 'Transfer to an admin' : 'Elevate an admin'}
        </label>
        <select
          id="super-admin-grant"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          disabled={busy || candidates.length === 0}
          className="rounded-md border border-axal-hairline bg-white px-2 py-1.5 text-[12.5px] text-axal-ink dark:bg-gray-900"
        >
          <option value="">{candidates.length ? 'Choose an admin…' : 'No other active admin to hand it to'}</option>
          {candidates.map((a) => (
            <option key={a.id} value={a.id}>{a.name ? `${a.name} · ${a.email}` : a.email}</option>
          ))}
        </select>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          disabled={busy || candidates.length === 0}
          placeholder={`Why — at least ${HOLDER_REASON_MIN} characters, recorded in Security`}
          aria-label="Reason for the change"
          data-testid="super-admin-reason"
          className="min-w-[16rem] flex-1 rounded-md border border-axal-hairline bg-white px-2 py-1.5 text-[12.5px] text-axal-ink dark:bg-gray-900"
        />
        <button
          type="submit"
          disabled={busy || !pick || !reasonReady}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
        >
          {busy ? <Loader2 size={13} className="inline animate-spin" /> : (hasHolder ? 'Transfer' : 'Grant')}
        </button>
        <span className="text-[11.5px] text-axal-faint">
          {hasHolder
            ? 'You hand it on and stop holding it, in one recorded act.'
            : 'Only an existing admin can be elevated.'}
        </span>
      </form>
    </Card>
  );
}
