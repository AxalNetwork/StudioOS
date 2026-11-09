import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { superAdminCandidatesApi } from '../../lib/api/superAdminCandidates.js';
import { reportError } from '../../lib/log';
import { Card, Unreadable } from '../../ui';
import { useGovernedAction } from './team/governedAction';
import ActionNotice from './team/ActionNotice';

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
 *
 * D5044 — TWO READS, NEITHER WAITING ON THE OTHER. The holders are
 * `GET /api/admin/super-admins`; the transfer picker is its own read,
 * `GET /api/admin/super-admins/candidates`, filtered on the server to active
 * administrators who do not hold it. The picker used to be filled from HQ
 * Team's whole supervision read (`api.hqAdmins()`), which the Team table makes
 * anyway, so the page read it twice — and the two were awaited together, so a
 * failed picker read threw the holder list away with it. Now the holders
 * render whatever the candidates read does, and a failed candidates read says
 * so beside the picker.
 *
 * D5044 — REVOKE IS NOT A NORMAL ACTION. With one active holder (the enforced
 * state) there is nothing to revoke: the route refuses the last holder and the
 * holder's own row, so no Revoke is drawn and handing it on is the transfer.
 * Only a database that predates D133 can hold more than one; then the console
 * says the invariant is broken and offers Remove elevation on each OTHER
 * holder, as a repair, through the shared review → submit → result model.
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
const friendly = (e) => FRIENDLY[String(e?.message || '')] || null;

/** D5044 — one extra holder's repair: review, then Remove elevation, then the server's answer. */
function RepairHolder({ holder, onRepaired }) {
  const [ack, setAck] = useState(false);
  const repair = useGovernedAction(() => api.superAdminRevoke(holder.id), {
    fallback: 'The elevation was not removed.', translate: friendly, tag: 'super-admin-repair',
  });
  const who = holder.name || holder.email;
  if (repair.state === 'confirmed') {
    return (
      <li className="py-2 text-[12px] text-axal-muted" data-testid="super-admin-repaired" data-state="confirmed">
        {who} no longer holds the elevation.
      </li>
    );
  }
  return (
    <li className="grid gap-1.5 py-2" data-testid="super-admin-repair-row" data-state={repair.state}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-axal-ink">{who}</div>
          <div className="truncate text-[11.5px] text-axal-faint">{holder.email}{Number(holder.is_active) === 1 ? '' : ' · inactive'}</div>
        </div>
        {repair.state === 'idle' && (
          <button
            type="button"
            onClick={repair.open}
            data-testid="super-admin-repair-open"
            className="rounded-md border border-red-300 px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            Remove elevation…
          </button>
        )}
      </div>
      {repair.isOpen && (
        <div className="grid gap-1.5 rounded-md border border-axal-hairline bg-axal-ground p-2">
          <label className="flex items-start gap-2 text-[11.5px] text-axal-muted">
            <input type="checkbox" checked={ack} disabled={repair.busy} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
            <span>
              I understand this removes the Super Admin elevation from {who}. Their administrator role
              and account stay as they are, and Security records the change.
            </span>
          </label>
          <ActionNotice action={repair} prefix="super-admin-repair" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!ack || repair.busy || repair.state === 'unknown'}
              onClick={async () => { const out = await repair.submit(); if (out?.ok) onRepaired?.(); }}
              data-testid="super-admin-repair-confirm"
              className="rounded-md bg-red-700 px-3 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {repair.busy ? <Loader2 size={13} className="inline animate-spin" /> : 'Remove elevation'}
            </button>
            <button type="button" onClick={repair.cancel} disabled={repair.busy} className="px-2 py-1.5 text-[12px] font-semibold text-axal-muted">
              {repair.state === 'unknown' ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function SuperAdminHolders({ onChanged, onTransferred, viewerId = null }) {
  const [holders, setHolders] = useState(null);   // null = not loaded yet
  const [holdersError, setHoldersError] = useState(null);
  // D5044 — the picker's own read: undefined loading, null unreadable, else the list.
  const [pickable, setPickable] = useState(undefined);
  const [pickableError, setPickableError] = useState('');
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  // D221 — WHO THIS ACCOUNT JUST HANDED THE PLATFORM TO. After a transfer it no
  // longer holds the elevation, so the reads this card and the Team table make
  // answer 403. Reloading them read that refusal back as an error on a change
  // that had SUCCEEDED ("Only a current holder can change who holds the
  // elevation"), which is the one message a successful handover must never
  // show. The card says what happened instead, and stops reading.
  const [handed, setHanded] = useState(null);

  const loadHolders = useCallback(async () => {
    setHoldersError(null);
    try {
      const h = await api.superAdmins();
      setHolders(Array.isArray(h?.holders) ? h.holders : []);
    } catch (e) {
      reportError('super-admin-holders', e);
      setHoldersError(messageOf(e));
    }
  }, []);

  const loadCandidates = useCallback(async () => {
    setPickableError('');
    try {
      const c = await superAdminCandidatesApi.list();
      setPickable(Array.isArray(c?.candidates) ? c.candidates : []);
    } catch (e) {
      reportError('super-admin-candidates', e);
      setPickable(null);
      setPickableError(messageOf(e));
    }
  }, []);

  const load = useCallback(() => Promise.all([loadHolders(), loadCandidates()]), [loadHolders, loadCandidates]);

  useEffect(() => { loadHolders(); loadCandidates(); }, [loadHolders, loadCandidates]);

  const holderIds = new Set((holders || []).map((h) => h.id));
  // D221 / D5044 — the server answers only active administrators who do not
  // hold the elevation. A holder is still never offered, in case the two reads
  // were taken either side of a change.
  const candidates = (pickable || []).filter((a) => !holderIds.has(a.id));
  // One active holder is the enforced state, so the form's verb follows it.
  const hasHolder = (holders || []).some((h) => Number(h.is_active) === 1);
  const activeHolders = (holders || []).filter((h) => Number(h.is_active) === 1);
  // D5044 — more than one holder breaks the D133 invariant; the console says so and offers the repair.
  const invariantBroken = (holders || []).length > 1;
  const reasonReady = reason.trim().length >= HOLDER_REASON_MIN;

  const transfer = useGovernedAction(
    () => api.superAdminGrant(Number(pick), { transfer: hasHolder, reason: reason.trim() }),
    { fallback: 'The change was refused.', translate: friendly, tag: 'super-admin-transfer' },
  );
  const busy = transfer.busy;

  const afterChange = async () => {
    await load();
    // The Team table above renders the super-admin badge from the same
    // elevation, so it is told rather than left stale until a reload.
    onChanged?.();
  };

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
          and your reason are recorded in Security.
        </p>
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

      {holdersError && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300" data-testid="super-admin-holders-unreadable">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {holdersError}
        </p>
      )}

      {!invariantBroken && (
        <ul className="mt-3 divide-y divide-axal-hairline" data-testid="super-admin-holder-list">
          {holders === null && !holdersError && (
            <li className="py-2 text-[12px] text-axal-faint"><Loader2 size={13} className="inline animate-spin" /> Loading holders…</li>
          )}
          {holders !== null && holders.length === 0 && (
            <li className="py-2 text-[12px] text-axal-faint">No holder is recorded. Migration 207 names one; until it has applied to this database, nobody can franchise.</li>
          )}
          {(holders || []).map((h) => (
            <li key={h.id} className="py-2">
              <div className="truncate text-[13px] font-semibold text-axal-ink">{h.name || h.email}</div>
              <div className="truncate text-[11.5px] text-axal-faint">{h.email}{Number(h.is_active) === 1 ? '' : ' · inactive'}</div>
            </li>
          ))}
        </ul>
      )}
      {holders !== null && holders.length === 1 && (
        <p className="mt-1 text-[11.5px] text-axal-faint" data-testid="super-admin-one-holder">
          One holder, as enforced. There is nothing to revoke: to hand it on, transfer it below.
        </p>
      )}

      {invariantBroken && (
        <section className="mt-3 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/20" data-testid="super-admin-repair">
          <p className="text-[12.5px] font-semibold text-amber-900 dark:text-amber-200">
            Invariant broken: {holders.length} accounts hold the elevation ({activeHolders.length} active). Exactly one is enforced.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-amber-900 dark:text-amber-200">
            This database predates the one-holder rule (D133). Remove the elevation from every account
            but one to repair it. You cannot remove your own, and the last active holder cannot be removed.
          </p>
          <ul className="mt-2 divide-y divide-axal-hairline">
            {holders.map((h) => (viewerId != null && Number(h.id) === Number(viewerId)
              ? (
                <li key={h.id} className="py-2 text-[12px] text-axal-muted">
                  <span className="font-semibold text-axal-ink">{h.name || h.email}</span> — you. Another holder removes yours, if anyone does.
                </li>
              )
              : <RepairHolder key={h.id} holder={h} onRepaired={afterChange} />))}
          </ul>
        </section>
      )}

      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        data-state={transfer.state}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!pick || !reasonReady || busy) return;
          // WITH A HOLDER, THE ONLY LAWFUL MOVE IS A TRANSFER, so the form asks for
          // one rather than sending a grant the server will refuse with 409. A
          // button that reliably errors is the "bare error" D132 was written about.
          const to = candidates.find((a) => String(a.id) === String(pick)) || null;
          const out = await transfer.submit();
          if (!out?.ok) return; // refused or unknown: the reason and the choice stay as typed (D5040)
          if (hasHolder) {
            const name = (to && (to.name || to.email)) || `account ${pick}`;
            setHanded({ name, at: new Date() });
            // D5040 — THE SECURITY TRANSITION IS NOT A RELOAD. The server has moved the elevation, so the
            // page above this one (AccountsPage) is told, and takes HQ's screens away from this browser now
            // (`leaveHq` never throws: a failed /me re-read is reported there and changes nothing).
            await onTransferred?.(name);
            return;
          }
          setPick('');
          setReason('');
          await afterChange();
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
          <option value="">
            {pickable === undefined ? 'Loading administrators…'
              : pickable === null ? 'The administrators could not be read'
                : candidates.length ? 'Choose an admin…' : 'No other active admin to hand it to'}
          </option>
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
        <div className="basis-full">
          <ActionNotice action={transfer} prefix="super-admin-transfer" />
          {transfer.state === 'unknown' && (
            <button type="button" onClick={load} className="mt-1 text-[12px] font-bold text-axal-violet dark:text-violet-300" data-testid="super-admin-reread">
              Read the holders again
            </button>
          )}
        </div>
      </form>
      {pickable === null && (
        <div className="mt-2" data-testid="super-admin-candidates-unreadable">
          <Unreadable
            what="The administrators the elevation can be handed to"
            claim={`The holders above are read separately and are as shown. This is a read that failed, not a claim that there is nobody to hand it to. ${pickableError}`.trim()}
            onRetry={loadCandidates}
          />
        </div>
      )}
    </Card>
  );
}
