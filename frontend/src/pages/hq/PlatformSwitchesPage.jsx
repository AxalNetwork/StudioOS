import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Power } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { SWITCH_TONE, operatorLine, setByLabel } from '../../lib/platformSwitches';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

/**
 * HQ · Platform → Switches — the kills HQ can throw without a deploy (D203).
 *
 * WHY IT IS ITS OWN PAGE. Platform is a read-only summary, and a test holds it
 * to that: no handler, no form. This is where the one write lives, reached
 * from Platform's Feature flags zone by a literal link rather than a sidebar
 * row — the HQ group is eleven rows by design.
 *
 * WHAT A SWITCH SHOWS, per switch the worker says an operator can throw:
 *
 *   - its state as the gate decides it, which is the state every Eadwyn
 *     request is refused or served by (services/advisor/rollout.ts);
 *   - the DEPLOY half: whether the Worker variable holds it on. Nothing on
 *     this page can lift that one, and the form says so before a release;
 *   - the OPERATOR half: thrown or released, by whom, when and why — or
 *     unreadable, which is never drawn as "never thrown".
 *
 * THE FORM TAKES RevokeForm's SHAPE (HqTeamTable.jsx): a reason the server
 * stores with the act, an acknowledgement of what the act does, the submit
 * disabled until both are there, and the server's refusals in words — a
 * session minted without TOTP is told what to do about it, and the step-up
 * prompt comes from lib/api.js on the 403.
 *
 * A FORM THE SERVER CAN ONLY REFUSE IS NOT DRAWN. When the operator store
 * cannot be read, this page cannot tell a throw from a release, and the write
 * would fail on the same store — so the switch says why there is no form
 * instead.
 */

export const UNAVAILABLE = Symbol('unavailable');

/**
 * Throw or release one switch. `action` is fixed by the switch's stored half:
 * a switch nobody has thrown offers a throw, a thrown one offers a release.
 */
export function SwitchForm({ sw, action, propagationSeconds, reasonMin, onDone }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const throwing = action === 'throw';
  const deployHolds = sw.deploy === 'on';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.hqSetPlatformSwitch(sw.key, action, reason.trim());
      setReason('');
      setAck(false);
      onDone(res);
    } catch (err) {
      reportError('hq-platform-switches:set', err);
      const msg = String(err?.message || err || 'Request failed');
      // The same translation RevokeForm makes: "TOTP required" is the server's
      // word for a session minted the wrong way, and it reads as a fault
      // rather than as the one thing the operator has to do about it.
      setError(msg === 'TOTP required'
        ? 'This needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.'
        : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 border-t border-axal-hairline pt-3" data-testid="hq-switch-form">
      <label className="block text-[11px] font-semibold text-axal-muted">
        Reason · required, stored with the switch and in the audit log
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={throwing ? 'e.g. Eadwyn is answering from a bad index — stopping it while we rebuild' : 'e.g. The index is rebuilt and checked'}
          className="mt-1 w-full max-w-xl rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-normal text-axal-ink dark:bg-gray-900"
          data-testid="hq-switch-reason"
        />
      </label>
      <label className="flex items-start gap-2 text-[11.5px] text-axal-muted">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        <span data-testid="hq-switch-ack">
          {throwing
            ? deployHolds
              // The deployment already holds it off, so the throw changes
              // nothing a user sees today. What it does is outlast the
              // deployment's own release — said, so it is not thrown for an
              // effect it will not have.
              ? `I understand the deployment already holds Eadwyn off. HQ's switch keeps it off after the deployment releases it, until HQ releases it too, and this is recorded with my name and this reason.`
              : `I understand every user on HQ's deployment gets the unavailable notice instead of Eadwyn within ${propagationSeconds} seconds, and that this is recorded with my name and this reason.`
            : deployHolds
              ? `I understand this releases HQ's switch only. The deployment still holds Eadwyn off, so nobody gets Eadwyn back until the deployment changes.`
              : `I understand Eadwyn answers again for every user on HQ's deployment within ${propagationSeconds} seconds, and that this is recorded with my name and this reason.`}
        </span>
      </label>
      {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={busy || !ack || reason.trim().length < reasonMin}
        className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-red-700 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
        data-testid="hq-switch-submit"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
        {throwing ? `Throw: ${sw.label}` : `Release: ${sw.label}`}
      </button>
      <p className="text-[10.5px] text-axal-faint">
        Needs a session signed in with your authenticator app and a code entered in the last few minutes.
        At least {reasonMin} characters of reason.
      </p>
    </form>
  );
}

/**
 * One operator switch: its state, both halves, and the form — or the reason
 * there is no form.
 */
export function SwitchCard({ sw, propagationSeconds, reasonMin, onDone }) {
  const op = sw.operator;
  const line = operatorLine(sw);
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3" data-testid="hq-switch-card">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{sw.label}</h2>
        <span className="space-x-1.5">
          <span className="font-mono text-[10px] text-axal-faint">{setByLabel(sw.set_by)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase ${SWITCH_TONE[sw.state] || SWITCH_TONE.unreadable}`}>
            {sw.state}
          </span>
        </span>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-axal-muted">While on: {sw.effect}</p>
      <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
        <div className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2">
          <dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Deployment</dt>
          <dd className="mt-0.5" data-testid="hq-switch-deploy">
            {sw.deploy === 'on'
              ? 'Holds it on. Only a deployment turns this half off.'
              : 'Does not hold it.'}
          </dd>
        </div>
        <div className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2">
          <dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">HQ</dt>
          <dd className="mt-0.5" data-testid="hq-switch-operator">
            {op && !op.available
              ? <Unrecorded reason={op.reason}>{line}</Unrecorded>
              : line}
          </dd>
        </div>
      </dl>
      {sw.reason && <p className="mt-2 text-[11.5px] leading-snug text-axal-faint">{sw.reason}</p>}
      {op?.available && op.stale_reason && (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{op.stale_reason}</p>
      )}
      {op?.available
        ? (
          <SwitchForm
            sw={sw}
            action={op.thrown ? 'release' : 'throw'}
            propagationSeconds={propagationSeconds}
            reasonMin={reasonMin}
            onDone={onDone}
          />
        )
        : (
          <p className="mt-3 border-t border-axal-hairline pt-3 text-[12px] text-axal-muted" data-testid="hq-switch-no-form">
            No control is drawn: the stored half could not be read, so this page cannot tell whether a throw or a
            release is the act on offer, and the write would meet the same store. The deployment can still switch
            Eadwyn off.
          </p>
        )}
    </Card>
  );
}

export default function PlatformSwitchesPage() {
  const [data, setData] = useState(null);
  const [done, setDone] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqPlatformSwitches().then(setData, (e) => {
      reportError('hq-platform-switches', e);
      setData(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = data && data !== UNAVAILABLE && data.available;
  const items = ready ? data.items || [] : [];

  // One line per read that answered (D126), so the rail can run over what
  // this page actually holds and says so when it holds nothing.
  const coverage = [
    ready ? `${items.length} switch${items.length === 1 ? '' : 'es'} HQ can throw` : null,
    ...items.map((sw) => (sw.operator?.available
      ? `${sw.label}: ${sw.state}, ${sw.operator.thrown ? 'thrown by HQ' : 'not thrown by HQ'}, deployment ${sw.deploy === 'on' ? 'holds it on' : 'does not hold it'}`
      : null)),
  ].filter(Boolean);

  const onDone = (res) => {
    setDone(res?.message || 'Done.');
    load();
  };

  const rail = (
    <WorkerRail
      workspace="Switches"
      role="super_admin"
      stance="Throws and releases HQ's switches"
      note="This rail reads back the operator switches as stored: each one's state, what the deployment holds, and what HQ last did with it and why. It throws nothing itself; the form on the page does, and records who and why."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === null ? 'Loading the switches…' : 'The switches could not be read, so there is nothing to read back.')}
      unavailable={[
        ['Branch reach', 'A switch thrown here stops Eadwyn on HQ\'s deployment only; a branch reads its own database.'],
        ['Switches set at deploy', 'Only a deployment changes them. They are listed read-only on Platform.'],
      ]}
      data-testid="hq-switches-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-switches-page">
      <div className="min-w-0 space-y-4">
        <div>
          <Link to="/admin/platform" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-muted hover:text-axal-ink dark:hover:text-gray-100">
            <ArrowLeft size={13} /> Platform
          </Link>
          <h1 className="mt-1 text-xl font-extrabold tracking-tight">Switches</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            A switch here can only switch something off, and never lifts what a deployment set. Every throw and every
            release is recorded with who did it and why.
          </p>
        </div>

        {done && (
          <p role="status" className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12px]" data-testid="hq-switches-done">
            <Check size={12} className="mr-1 inline" /> {done}
          </p>
        )}

        {data === null && <p className="text-[12.5px] text-axal-muted">Reading the switches…</p>}
        {/* A request that failed and a worker that answered "could not read
            them" are one state to the reader: nothing is known about any
            switch, and that is not the same as none being thrown. */}
        {(data === UNAVAILABLE || (data && !data.available)) && (
          <Unreadable what="The switches" claim="This is not a claim that none is thrown." onRetry={load} />
        )}

        {ready && (
          <>
            {items.map((sw) => (
              <SwitchCard
                key={sw.key}
                sw={sw}
                propagationSeconds={data.propagation_seconds}
                reasonMin={data.reason_min}
                onDone={onDone}
              />
            ))}
            <p className="text-[11.5px] leading-relaxed text-axal-faint" data-testid="hq-switches-reach">
              {data.reach} This deployment sees a change at once; every other instance within
              {' '}{data.propagation_seconds} seconds.
            </p>
          </>
        )}
      </div>

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
