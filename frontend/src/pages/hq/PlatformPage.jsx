/**
 * HQ · Platform — canvas H6 ("Keys, flags, jobs") and H17 ("Monitoring,
 * Broadcast, Feature flags").
 *
 * EVERY ZONE HAS A STORE BUT ONE, AND THAT ONE SAYS SO.
 *
 *   Keys   `integrations` carries a provider, a status and a connection per
 *          account. The KEY MATERIAL IS NEVER FETCHED BY THIS PAGE — the
 *          endpoint counts and states. The artboard's "reveal on click,
 *          re-hide after thirty seconds" is drawn nowhere because it exists
 *          nowhere (D213): once saved, a key is write-only, promoted to a
 *          Worker secret and never read back. Removing one does exist, on the
 *          Integration keys console, where it is recorded and cannot be undone
 *          — though that console offers it today only for a key held in the
 *          database.
 *   H16 (D213) — four panels, one per console HQ runs the platform on:
 *          Integration keys, GitHub Sync, Payments catalog, Promo codes. Each
 *          summarises its console's own store, in its own state, and ends in
 *          ONE literal link to that console — which is where anything is
 *          changed. The canvas says they retire the /admin tabs; nothing
 *          retires, so the consoles stay and each is linked once, from here.
 *   Jobs   `cron_run_history` records every scheduled tick, and since D201
 *          that includes the tick that found the lease held and ran nothing.
 *          Each DECLARED trigger is read against its own schedule, so a
 *          trigger that never recorded a run, one that went silent, one whose
 *          last run failed and one that is fine are four states, drawn as
 *          four. There is no "running": every row is written as its tick
 *          ends, so no row can say a tick is still going.
 *   Monitoring (D202, H17 P5) — four stats from reads this page already
 *          makes: branch Workers from the deployments registry, cron
 *          triggers from the jobs above, the dead-letter backlog and the
 *          incidents from the summary. Traffic by branch sits under them,
 *          with its average rate over the window the read covered — never a
 *          live rate — and a DLQ column only HQ's own row can fill.
 *   Broadcast (D202, H17 P6) — Telegram channels and X, as they stand. No
 *          chat id reaches this page, and no member count is drawn, because
 *          nothing asks Telegram for one.
 *   Flags  (D203) Every switch the platform has is listed read-only, each as
 *          the code that obeys it reads it: most are set at deploy, one the AI
 *          router throws by itself, and one — Eadwyn off — HQ can throw from
 *          `platform_switches` (migration 283). THROWING ONE IS NOT DONE HERE.
 *          It is Platform → Switches, reached by one link in this zone,
 *          because this page has no handler of its own and a test holds it to
 *          that. Flags and Overrides count what that store holds, and an
 *          unreadable store reads as unreadable, never as none thrown.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';
import { SWITCH_TONE, setByLabel, operatorLine } from '../../lib/platformSwitches';
import { liveChip, residencyLine } from '../../lib/deployTimeline';
import { ConsoleLinkBody, CONSOLE_LINK, CONSOLE_TILE } from './ConsoleLink';

// Re-exported, not redeclared: Platform → Switches draws the same tones, and
// the list lives once in lib/platformSwitches.js (D203).
export { SWITCH_TONE };

export const UNAVAILABLE = Symbol('unavailable');
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);

/**
 * D163 — HQ's own acts against ONE branch, from the telemetry mirror.
 *
 * The rows arrive grouped by (branch, action, outcome); this narrows them to
 * one branch and puts the failures first, because the reason this exists is to
 * answer what HQ tried while a branch was not answering. A branch with nothing
 * recorded returns an empty list and the row simply says nothing — the absence
 * of an act is not a state worth drawing, unlike the store being unreadable,
 * which the zone says once above.
 */
function actionsForBranch(rows, code) {
  return (rows || [])
    .filter((r) => r.branch === code)
    .sort((a, b) => (a.outcome === 'ok' ? 1 : 0) - (b.outcome === 'ok' ? 1 : 0));
}

/**
 * The four job states the platform summary can return (D201), and the one
 * colour each earns. `util/cronHistory.ts` exports the same four as
 * TRIGGER_STATES, and `hq_content_platform_h6.test.mjs` fails when the two
 * lists differ: a tone for a state nothing produces is decoration. A state
 * with no tone here falls back to amber, never to the healthy tone, because
 * a state this page does not know is not one it can vouch for.
 */
const JOB_TONE = {
  never: 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20',
  stale: 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20',
  failed: 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20',
  ok: 'border-axal-hairline bg-axal-ground',
};

/**
 * One sentence for the jobs figures, said the same way on the bar and in the
 * rail. The denominator is the declared triggers, which is what makes "0
 * silent" a statement about every one of them.
 */
function jobsLine(jobs) {
  return `${num(jobs.failing)} failing · ${num(jobs.stale)} silent · ${num(jobs.never)} never recorded, `
    + `of ${num(jobs.triggers.length)} declared triggers`;
}

function Zone({ title, sub, children }) {
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{title}</h2>
        {sub && <span className="text-[11.5px] text-axal-faint">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

function Absent({ reason }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-muted">
      <Unrecorded /> — {reason}
    </p>
  );
}

function Stat({ label, value, note, tone = 'text-axal-ink dark:text-white' }) {
  return (
    <div className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className={`mt-1 text-lg font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? <Unrecorded />}</div>
      {note && <div className="mt-0.5 text-[10px] text-axal-faint">{note}</div>}
    </div>
  );
}

/**
 * D202 — a figure that could not be read, drawn as such. The reason is the
 * server's own sentence, on hover; the note says what the blank is NOT, so it
 * cannot be read as a zero.
 */
const unreadable = (reason) => ({
  value: <Unrecorded reason={reason}>Unreadable</Unrecorded>,
  note: 'not a count of zero',
});
const LOADING = { value: '…', note: 'reading' };
const AMBER_INK = 'text-amber-700 dark:text-amber-300';
const RED_INK = 'text-red-700 dark:text-red-300';

/**
 * H17 P5 — "Workers healthy", over the branches HQ actually ASKED.
 *
 * Healthy means answering AND reporting a working database: a branch whose own
 * health read says its D1 is failing is not healthy because its Worker
 * replied. HQ is not a row in the registry and is not counted, which the note
 * says, so "no branch" cannot be read as a platform with no Worker.
 */
export function workersStat(deps) {
  if (deps === null) return LOADING;
  if (deps === UNAVAILABLE) return unreadable('The deployments list could not be read.');
  if (deps.registry_available === false) return unreadable(deps.registry_reason);
  const all = deps.deployments || [];
  if (!all.length) return { value: 'No branch', note: 'none is deployed yet · HQ is not counted here' };
  const asked = all.filter((d) => d.live_state !== 'not_deployed');
  if (!asked.length) return { value: 'None asked', note: 'no deployed branch has a binding yet' };
  const healthy = asked.filter((d) => d.live_state === 'ok' && d.live?.db_ok === true).length;
  return {
    value: `${healthy} / ${asked.length}`,
    note: 'answering, with a working database · HQ is not counted here',
    tone: healthy < asked.length ? AMBER_INK : undefined,
  };
}

/** H17 P5 — "Cron jobs OK": the declared triggers reading `ok` (D201). */
export function triggersStat(data, jobs) {
  if (data === null) return LOADING;
  if (data === UNAVAILABLE) return unreadable('The platform summary could not be read.');
  if (!jobs?.available) return unreadable(jobs?.reason || 'The scheduled-run history could not be read.');
  const ok = jobs.triggers.filter((j) => j.state === 'ok').length;
  return {
    value: `${ok} / ${jobs.triggers.length}`,
    note: 'declared triggers on schedule',
    tone: ok < jobs.triggers.length ? AMBER_INK : undefined,
  };
}

/** H17 P5 — the dead-letter backlog, both of its tables summed (services/deadLetters). */
export function dlqStat(data, dlq) {
  if (data === null) return LOADING;
  if (data === UNAVAILABLE) return unreadable('The platform summary could not be read.');
  if (!dlq?.available) return unreadable(dlq?.reason || 'The dead-letter backlog was not reported.');
  return {
    value: num(dlq.total),
    note: `${num(dlq.legacy)} from the D1 queue · ${num(dlq.mirror)} from Cloudflare Queues`,
    tone: dlq.total > 0 ? RED_INK : undefined,
  };
}

/** H17 P5 — incidents in the window, with what the count can and cannot mean. */
export function incidentsStat(data, incidents) {
  if (data === null) return LOADING;
  if (data === UNAVAILABLE) return unreadable('The platform summary could not be read.');
  if (!incidents?.available) return unreadable(incidents?.reason || 'The incident count was not reported.');
  return {
    value: num(incidents.count),
    note: 'entered for the status page',
    tone: incidents.count > 0 ? RED_INK : undefined,
  };
}

/**
 * D203 — "Flags": the switches an operator can throw, which is what the store
 * behind this zone holds. The registry lists every switch whatever the store
 * says, so this figure stands even when the store is unreadable; the note says
 * how many the platform has in all, so the one is not read as the whole.
 */
export function flagsStat(data, switches) {
  if (data === null) return LOADING;
  if (data === UNAVAILABLE) return unreadable('The platform summary could not be read.');
  if (!switches?.available) return unreadable(switches?.reason || 'The platform switches were not reported.');
  const writable = switches.items.filter((sw) => sw.writable);
  return {
    value: num(writable.length),
    note: `HQ can throw · of ${num(switches.items.length)} switches in all`,
  };
}

/**
 * D203 — "Overrides": the operator switches HQ has thrown, read from the
 * store. If any operator half could not be read, the count is not known, and
 * that is what it says — a zero here would claim no kill is thrown, which is
 * the one thing an unreadable store cannot vouch for.
 */
export function overridesStat(data, switches) {
  if (data === null) return LOADING;
  if (data === UNAVAILABLE) return unreadable('The platform summary could not be read.');
  if (!switches?.available) return unreadable(switches?.reason || 'The platform switches were not reported.');
  const writable = switches.items.filter((sw) => sw.writable);
  const blind = writable.find((sw) => !sw.operator?.available);
  if (blind) return unreadable(blind.operator?.reason || 'The operator switch store could not be read.');
  const thrown = writable.filter((sw) => sw.operator.thrown).length;
  return {
    value: num(thrown),
    note: thrown ? 'thrown by HQ now' : 'none thrown by HQ',
    tone: thrown > 0 ? AMBER_INK : undefined,
  };
}

/**
 * HQ's own dead-letter depth, for HQ's row of the traffic table. No branch
 * reports its backlog to HQ, so a branch row never borrows this figure.
 */
function hqDlqCell(data, dlq) {
  if (data === null) return '…';
  if (!dlq?.available) return <Unrecorded reason={dlq?.reason}>unreadable</Unrecorded>;
  return num(dlq.total);
}

/**
 * An AVERAGE over the window the read covered. `hits` is a count, and a count
 * has no rate until it is divided by the time it was counted over — so this
 * is never a live rate, and the zone says so under the table.
 */
export function perMinute(hits, minutes) {
  const h = Number(hits);
  const m = Number(minutes);
  if (!Number.isFinite(h) || !Number.isFinite(m) || m <= 0) return null;
  const v = h / m;
  return v >= 10
    ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : v.toLocaleString(undefined, { maximumSignificantDigits: 2 });
}

/**
 * A Telegram channel's state, from its own facts (D202). "Disabled" refuses
 * new posts — creating one checks it — but sending does not, so a draft
 * already written for a disabled channel can still go out. The zone says so
 * rather than letting the word read as "cannot send".
 */
export const CHANNEL_STATE = {
  ready: ['Ready', 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'],
  unbound: ['No chat bound', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'],
  disabled: ['Disabled', 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'],
};

/**
 * D202 — H17 P6, the Broadcast console. A component of its own so its states
 * are RENDERED in hq_platform_consoles_d202.test.mjs rather than matched as
 * source text: a branch can keep its words and stop drawing, and only the
 * output notices. `loading` and `unreadable` are the summary's own states;
 * `telegram` and `xStatus` are its two broadcast blocks, as the route sent
 * them. No chat id is in either, and nothing here would draw one.
 */
export function BroadcastConsole({ loading, unreadable, telegram, xStatus }) {
  if (loading) return <p className="text-[12.5px] text-axal-muted">Reading the channels…</p>;
  if (unreadable) return <Absent reason="The platform summary could not be read." />;
  return (
    <>
      {/* SAID ONCE, NOT PER CHANNEL. The token is a fact about
          this deployment; stamping it on every row would read as
          every channel being broken on its own. */}
      {telegram && telegram.token_configured === false && (
        <p
          className="mb-2 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"
          data-testid="hq-telegram-no-token"
        >
          No Telegram bot token is configured on this deployment, so no channel below can send.
        </p>
      )}
      {!telegram?.available ? (
        <Absent reason={telegram?.reason || 'The Telegram channels were not reported.'} />
      ) : telegram.channels.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-axal-muted">
          No Telegram channel is set up. That is an empty list, not an unreadable one.
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="hq-broadcast-channels">
          {telegram.channels.map((ch) => {
            const [stateLabel, stateTone] = CHANNEL_STATE[ch.state]
              || [String(ch.state), 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'];
            return (
              <li key={ch.id} className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[11.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">Telegram · {ch.label}</span>
                    <span className="ml-1.5 text-[10px] text-axal-faint">{ch.audience}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${stateTone}`}>
                    {stateLabel}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-axal-faint">
                  {ch.sent_count > 0
                    ? `${num(ch.sent_count)} sent · last ${day(ch.last_sent_at)}`
                    : 'nothing sent yet'}
                  {ch.last_test_at ? ` · tested ${day(ch.last_test_at)}` : ''}
                </div>
                {ch.last_error && (
                  <div className="mt-1 text-[11px] text-red-700 dark:text-red-300">{ch.last_error}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* X IS LISTED WHETHER OR NOT IT IS SET UP, the canvas's
          own rule: an absent row reads as a decision nobody made,
          a dashed one as the decision it is. No token state is
          shown — admin_x refuses to echo it, and so does this. */}
      {xStatus && (
        <div
          className={`mt-2 rounded-lg border px-3 py-2 text-[11.5px] ${xStatus.client_configured
            ? 'border-axal-hairline bg-axal-ground'
            : 'border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'}`}
          data-testid="hq-broadcast-x"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">X (Twitter)</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${xStatus.client_configured
              ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
              : 'border border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400'}`}>
              {xStatus.client_configured ? 'OAuth configured' : 'Not provisioned'}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-axal-faint">
            {xStatus.available
              ? `${num(xStatus.accounts)} ${xStatus.accounts === 1 ? 'account' : 'accounts'} · ${num(xStatus.enabled_accounts)} enabled`
              : <Unrecorded reason={xStatus.reason}>accounts unreadable</Unrecorded>}
            {xStatus.client_configured
              ? ''
              : ' · its OAuth app is not configured on this deployment, so no account can be authorised'}
          </div>
        </div>
      )}

      {telegram?.available && telegram.channels.some((ch) => ch.state === 'disabled') && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-axal-faint" data-testid="hq-telegram-disabled-note">
          A disabled channel takes no new posts. A post already drafted for it can still be sent.
        </p>
      )}
      {telegram?.available && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-axal-faint" data-testid="hq-telegram-members">
          {telegram.members_reason}
        </p>
      )}
    </>
  );
}

/**
 * D202 — H17 P7's read-only list of the switches the platform does have. A
 * component so the test renders it: every state the registry returns gets
 * its tone, and a state it does not know draws as unreadable, never as on or
 * off. The list throws nothing, and there is nothing here to click.
 *
 * D203 — a switch HQ can throw carries two halves, and both are drawn: what
 * the deployment holds, and what HQ's store holds. The state is the two
 * combined the way the gate combines them, so a reader who sees "on" can tell
 * from the halves whether releasing HQ's would turn it off.
 */
export function SwitchList({ switches }) {
  if (!switches?.available) {
    return (
      <div className="mt-3">
        <Absent reason={switches?.reason || 'The platform switches were not reported.'} />
      </div>
    );
  }
  return (
    <>
      <p className="mt-3 text-[11.5px] leading-relaxed text-axal-muted">
        Read-only. A switch set at deploy changes with a deployment; one set at runtime is thrown by
        the platform itself; one HQ can throw is thrown on Switches, with a reason, and recorded. Each
        is read the way the code that obeys it reads it, and nothing here throws one.
      </p>
      <ul className="mt-2 space-y-1.5" data-testid="hq-platform-switches">
        {switches.items.map((sw) => (
          <li key={sw.key} className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[11.5px]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium">{sw.label}</span>
              <span className="shrink-0 space-x-1.5">
                <span className="font-mono text-[10px] text-axal-faint">
                  {setByLabel(sw.set_by)}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase ${SWITCH_TONE[sw.state] || SWITCH_TONE.unreadable}`}>
                  {sw.state}
                </span>
              </span>
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-axal-muted">{sw.effect}</div>
            {sw.detail && <div className="mt-0.5 font-mono text-[10px] text-axal-faint">{sw.detail}</div>}
            {sw.writable && (
              <div className="mt-0.5 text-[11px] leading-snug text-axal-faint" data-testid={`hq-switch-halves-${sw.key}`}>
                Deployment: {sw.deploy === 'on' ? 'holds it on' : 'does not hold it'} · HQ: {operatorLine(sw)}
              </div>
            )}
            {sw.reason && <div className="mt-0.5 text-[11px] leading-snug text-axal-faint">{sw.reason}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ── H16 (D213) · the four consoles ─────────────────────────────────────── */

// Each panel ends in ONE link, with a literal `to` at its call site so the
// reachability walk counts it and it stands whether or not the panel's own
// block could be read — the console is where you would go to find out. The
// tile and its text are ConsoleLink.jsx's, shared with Content (D214).

/**
 * The console's own names for the managed providers (AdminPage's
 * PROVIDER_LABELS), so a key reads the same on both screens. A test holds the
 * two maps equal; a provider this map does not know shows its key, never
 * nothing.
 */
export const PROVIDER_LABEL = {
  slack: 'Slack',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  docusign: 'DocuSign',
  linkedin: 'LinkedIn',
  calendly: 'Calendly',
  stripe: 'Stripe',
  carta: 'Carta',
  crunchbase: 'Crunchbase',
  affinity: 'Affinity',
  telegram: 'Telegram',
  gcip: 'Google Identity (SMS)',
};

/**
 * Where a key lives, and its one tone. `unreadable` is its own state: the
 * table did not answer and no Worker secret is set, so whether a key is held
 * is unknown — drawing that as "not set" would claim a measurement nobody made.
 */
export const KEY_STATE = {
  env: ['Worker secret', 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'],
  db: ['In the database', 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'],
  unset: ['Not set', 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'],
  unreadable: ['Unknown', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'],
};

/** What a key's date is, or why it has none. Never a date the store did not give. */
export function keyDateLine(item) {
  switch (item.last_set_basis) {
    case 'console_audit': return `saved from the console ${day(item.last_set_at)}`;
    case 'd1_row': return `row written ${day(item.last_set_at)}`;
    case 'no_record': return item.state === 'env'
      ? 'no date: set at deploy, or before the console recorded its saves'
      : 'no date on its row';
    case 'unreadable': return 'date unknown: the audit log could not be read';
    default: return null;
  }
}

/** H16 P1 — where each managed key lives, and when it was last set. No key material. */
export function IntegrationKeysPanel({ loading, unreadable, keys }) {
  let body;
  if (loading) body = <p className="text-[12.5px] text-axal-muted">Reading the keys…</p>;
  else if (unreadable) body = <Absent reason="The platform summary could not be read." />;
  else if (!keys?.available) body = <Absent reason={keys?.reason || 'The managed keys were not reported.'} />;
  else {
    body = (
      <>
        <p className="text-[11.5px] tabular-nums text-axal-muted" data-testid="hq-keys-counts">
          {num(keys.managed)} managed · {num(keys.counts.env)} as Worker secrets · {num(keys.counts.db)} in the
          database · {num(keys.counts.unset)} not set
          {keys.counts.unreadable > 0 ? ` · ${num(keys.counts.unreadable)} unknown` : ''}
        </p>
        {!keys.db_readable && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300" data-testid="hq-keys-db-unreadable">
            {keys.db_reason}
          </p>
        )}
        <ul className="mt-2 space-y-1.5" data-testid="hq-keys-list">
          {keys.items.map((k) => {
            const [label, tone] = KEY_STATE[k.state] || KEY_STATE.unreadable;
            const date = keyDateLine(k);
            return (
              <li key={k.provider_key} className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[11.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{PROVIDER_LABEL[k.provider_key] || k.provider_key}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone}`}>{label}</span>
                </div>
                {date && <div className="mt-0.5 font-mono text-[10px] text-axal-faint">{date}</div>}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">{keys.last_set_reason}</p>
        {keys.notes.map((n) => (
          <p key={n} className="mt-1 text-[11px] leading-relaxed text-axal-faint">{n}</p>
        ))}
      </>
    );
  }
  return (
    <>
      {body}
      <p className="mt-2 text-[11px] leading-relaxed text-axal-muted" data-testid="hq-keys-no-reveal">
        No screen reveals a saved key: once saved it is write-only, so no masked secret is drawn and nothing here
        re-hides after thirty seconds. Nothing stores when a key expires, so none is drawn as expired.
      </p>
      <Link to="/admin?tab=integration-keys" className={CONSOLE_LINK} data-testid="hq-h16-link-keys">
        <ConsoleLinkBody
          title="Integration keys"
          note="Configure or test a key there; rotate and remove are offered only for a key held in the database. This panel changes none."
        />
      </Link>
    </>
  );
}

/** A mirror attempt's one tone, by the three states the mirror writes. */
export const SYNC_STATE = {
  synced: ['Synced', 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'],
  failed: ['Failed', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'],
  not_configured: ['Mirror off', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'],
};

/** H16 P2 — the ticket mirror: where it writes, its day, and its latest attempts. */
export function GithubSyncPanel({ loading, unreadable, sync }) {
  let body;
  if (loading) body = <p className="text-[12.5px] text-axal-muted">Reading the mirror…</p>;
  else if (unreadable || !sync) body = <Absent reason="The platform summary could not be read." />;
  else {
    const { target, window: day24, recent } = sync;
    body = (
      <>
        <p className="text-[11.5px] leading-relaxed text-axal-muted" data-testid="hq-sync-target">
          {target.repo
            ? <>Mirrors tickets to <span className="font-mono">{target.repo}</span></>
            : 'No repository is named: the mirror needs both halves of it set, and never falls back to a default.'}
          {' · '}{target.token_set ? 'token set' : 'no token set'}
        </p>
        {!target.configured && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300" data-testid="hq-sync-off">
            The mirror is off on this deployment: a ticket is still filed, and reaches no issue.
          </p>
        )}
        {day24?.available ? (
          <div className="mt-2 grid grid-cols-3 gap-2" data-testid="hq-sync-stats">
            <Stat label={`Synced (${day24.window_hours}h)`} value={num(day24.synced)} tone="text-green-700 dark:text-green-300" />
            <Stat
              label={`Failed (${day24.window_hours}h)`}
              value={num(day24.failed)}
              tone={day24.failed > 0 ? RED_INK : undefined}
            />
            <Stat label="Average lag" value={null} note="not recorded" />
          </div>
        ) : (
          <div className="mt-2"><Absent reason={day24?.reason || 'The mirror window was not reported.'} /></div>
        )}
        {day24?.available && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-axal-faint">{day24.lag?.reason}</p>
        )}
        <h3 className="mt-3 text-[12px] font-bold text-axal-ink dark:text-white">Latest attempts</h3>
        {!recent?.available ? (
          <Absent reason={recent?.reason || 'The latest attempts were not reported.'} />
        ) : recent.items.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-axal-muted">
            No ticket has been mirrored or tried yet. That is an empty list, not an unreadable one.
          </p>
        ) : (
          <ul className="mt-1 space-y-1" data-testid="hq-sync-recent">
            {recent.items.map((t) => {
              const [label, tone] = SYNC_STATE[t.status]
                || [String(t.status || 'unknown'), 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'];
              return (
                <li key={t.ticket_id} className="border-t border-axal-hairline pt-1.5 text-[11.5px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link to={`/help/tickets/${t.ticket_id}`} className="min-w-0 truncate font-medium underline decoration-axal-hairline">
                      Ticket #{t.ticket_id}
                    </Link>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone}`}>{label}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-axal-faint">
                    {t.issue_number != null ? `issue #${t.issue_number} · ` : ''}{day(t.attempted_at)}
                  </div>
                  {t.error && <div className="mt-0.5 text-[11px] text-red-700 dark:text-red-300">{t.error}</div>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">{sync.recent_note}</p>
      </>
    );
  }
  return (
    <>
      {body}
      <Link to="/admin?tab=github" className={CONSOLE_LINK} data-testid="hq-h16-link-sync">
        <ConsoleLinkBody title="GitHub sync" note="The token, the repository, and the test that says what the token is missing." />
      </Link>
    </>
  );
}

/** One row of P3's field list: a label, and a value or its stated absence. */
function FieldRow({ label, children, testid }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-axal-hairline py-1.5 text-[11.5px]" data-testid={testid}>
      <span className="shrink-0 text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/** H16 P3 — the money rail: the key checkout is served, the mirror, the webhook. */
export function PaymentsCatalogPanel({ loading, unreadable, payments }) {
  let body;
  if (loading) body = <p className="text-[12.5px] text-axal-muted">Reading the catalog…</p>;
  else if (unreadable || !payments) body = <Absent reason="The platform summary could not be read." />;
  else {
    const { publishable, catalog, webhook } = payments;
    const w = webhook?.available ? webhook : null;
    body = (
      <>
        <FieldRow label="Publishable key" testid="hq-pay-key">
          {publishable.configured ? (
            <>
              <span className="font-mono">{publishable.masked}</span>
              <span className="ml-1.5 text-[10.5px] text-axal-faint">
                {publishable.mode === 'unknown' ? 'mode unknown' : `${publishable.mode} mode`}
              </span>
            </>
          ) : (
            <span className="text-amber-700 dark:text-amber-300">Not configured: checkout is served no key</span>
          )}
        </FieldRow>
        {catalog?.available ? (
          <>
            <FieldRow label="Products" testid="hq-pay-products">
              <span className="tabular-nums">{num(catalog.products.active)} active of {num(catalog.products.all)}</span>
            </FieldRow>
            <FieldRow label="Prices" testid="hq-pay-prices">
              <span className="tabular-nums">{num(catalog.prices.active)} active of {num(catalog.prices.all)}</span>
              {catalog.unreadable_price_rows > 0 && (
                <span className="block text-[10.5px] text-amber-700 dark:text-amber-300">
                  {num(catalog.unreadable_price_rows)} {catalog.unreadable_price_rows === 1 ? 'product has' : 'products have'} a
                  price list that could not be read, and {catalog.unreadable_price_rows === 1 ? 'is' : 'are'} not counted
                </span>
              )}
            </FieldRow>
            <FieldRow label="Mirror last written" testid="hq-pay-written">
              <span className="font-mono">{catalog.last_written_at ? day(catalog.last_written_at) : 'never written'}</span>
            </FieldRow>
          </>
        ) : (
          <div className="border-t border-axal-hairline pt-1.5">
            <Absent reason={catalog?.reason || 'The catalog mirror was not reported.'} />
          </div>
        )}
        <FieldRow label="Webhook" testid="hq-pay-webhook">
          {!w ? (
            <span className={RED_INK} data-testid="hq-pay-webhook-unreadable">
              {webhook?.reason || 'The request log could not be read.'}
            </span>
          ) : w.last ? (
            <span className={w.last.status_code != null && (w.last.status_code < 200 || w.last.status_code >= 300) ? RED_INK : ''}>
              {w.last.status_code != null ? `HTTP ${w.last.status_code}` : 'status not recorded'}
              {w.last.latency_ms != null ? ` in ${num(w.last.latency_ms)}ms` : ''} · {day(w.last.at)}
            </span>
          ) : (
            <span className="text-axal-muted">no delivery recorded</span>
          )}
          {w && (
            <span className="block text-[10.5px] tabular-nums text-axal-faint">
              {num(w.deliveries)} in {num(w.window_hours)}h · {num(w.not_2xx)} not 2xx
            </span>
          )}
        </FieldRow>
        {catalog?.available && (
          <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">{catalog.sync_basis}</p>
        )}
        {w && <p className="mt-1 text-[11px] leading-relaxed text-axal-faint">{w.basis}</p>}
        <p className="mt-1 text-[11px] leading-relaxed text-axal-faint">{payments.storefront_note}</p>
      </>
    );
  }
  return (
    <>
      {body}
      <Link to="/admin?tab=payments" className={CONSOLE_LINK} data-testid="hq-h16-link-payments">
        <ConsoleLinkBody title="Payments catalog" note="Products, prices, the publishable key, and the sync." />
      </Link>
    </>
  );
}

/** A code's one state, by the rule checkout applies (services/promos `promoState`). */
export const PROMO_STATE = {
  active: ['Active', 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'],
  inactive: ['Switched off', 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'],
  expired: ['Expired', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'],
  exhausted: ['At its cap', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'],
};

/**
 * A code's terms in the console's own words (AdminPage formats amount_off the
 * same way). Months on a repeating code are Stripe's, so the phrase says so
 * rather than inventing a number.
 */
export function promoTerms(p) {
  const off = p.percent_off != null
    ? `${p.percent_off}% off`
    : p.amount_off != null
      ? `${(p.amount_off / 100).toFixed(2)} ${String(p.currency || '').toUpperCase()} off`
      : 'no discount recorded';
  const how = p.duration === 'forever' ? 'every payment'
    : p.duration === 'repeating' ? 'repeating, for months Stripe keeps'
      : p.duration === 'once' ? 'once' : String(p.duration);
  const scope = p.product_count === null
    ? 'product list unreadable'
    : p.product_count === 0 ? 'all products'
      : `${p.product_count} ${p.product_count === 1 ? 'product' : 'products'}`;
  return `${off} · ${how} · ${scope}`;
}

/** H16 P4 — every code's terms, cap, redemptions and one state. */
export function PromoCodesPanel({ loading, unreadable, promos }) {
  let body;
  if (loading) body = <p className="text-[12.5px] text-axal-muted">Reading the codes…</p>;
  else if (unreadable) body = <Absent reason="The platform summary could not be read." />;
  else if (!promos?.available) body = <Absent reason={promos?.reason || 'The promo codes were not reported.'} />;
  else {
    body = (
      <>
        <p className="text-[11.5px] tabular-nums text-axal-muted" data-testid="hq-promo-counts">
          {num(promos.total)} {promos.total === 1 ? 'code' : 'codes'} · {num(promos.counts.active)} active ·{' '}
          {num(promos.counts.inactive)} switched off · {num(promos.counts.expired)} expired ·{' '}
          {num(promos.counts.exhausted)} at their cap
        </p>
        {promos.items.length === 0 ? (
          <p className="mt-2 text-[12px] leading-relaxed text-axal-muted">
            No promo code exists. That is an empty list, not an unreadable one.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5" data-testid="hq-promo-list">
            {promos.items.map((c) => {
              const [label, tone] = PROMO_STATE[c.state]
                || [String(c.state || 'unknown'), 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'];
              return (
                <li key={c.code} className="flex items-center justify-between gap-3 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2">
                  <div className="min-w-0">
                    <span className="font-mono text-[11.5px] font-bold">{c.code}</span>
                    <div className="mt-0.5 text-[10.5px] text-axal-faint">
                      {promoTerms(c)}{c.expires_at ? ` · expires ${day(c.expires_at)}` : ' · no expiry set'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[12px] font-bold tabular-nums">
                      {num(c.times_redeemed)} recorded{c.max_redemptions != null ? ` of ${num(c.max_redemptions)}` : ' · no cap'}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone}`}>{label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {promos.truncated && (
          <p className="mt-1.5 text-[11px] text-axal-faint" data-testid="hq-promo-truncated">
            The newest {num(promos.listed_limit)} of {num(promos.total)} are listed; the counts above cover every code.
          </p>
        )}
        <ul className="mt-2 space-y-1" data-testid="hq-promo-caveats">
          {promos.caveats.map((line) => (
            <li key={line} className="text-[11px] leading-relaxed text-axal-faint">{line}</li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <>
      {body}
      <Link to="/admin?tab=promos" className={CONSOLE_LINK} data-testid="hq-h16-link-promos">
        <ConsoleLinkBody title="Promo codes" note="Create and switch off codes there. Ceilings are set and listed on Revenue; checkout does not check codes against them yet." />
      </Link>
    </>
  );
}

export default function PlatformPage() {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqPlatform().then(setData, (e) => { reportError('hq-platform', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // D110 — Deployments is its own request: it fans out to every branch Worker
  // for a live health read, which is slower and fails differently from the
  // platform summary. Folding it into `hqPlatform` would make an unreachable
  // branch able to delay or empty the keys-and-jobs half of this page.
  const [deps, setDeps] = useState(null);
  const loadDeps = useCallback(() => {
    setDeps(null);
    api.deployments().then(setDeps, (e) => { reportError('hq-deployments', e); setDeps(UNAVAILABLE); });
  }, []);
  useEffect(() => { loadDeps(); }, [loadDeps]);

  // D161 — traffic by branch, its own read for the same reason `deps` is: it
  // goes out to Analytics Engine over the network and fails differently from
  // both the platform summary and the registry. A third `useState` rather than
  // a field on either, so an unreadable metrics store cannot empty the keys,
  // jobs or deployments halves of this page.
  const [traffic, setTraffic] = useState(null);
  const loadTraffic = useCallback(() => {
    setTraffic(null);
    api.analyticsTrafficByBranch('', '').then(setTraffic, (e) => {
      reportError('hq-platform:trafficByBranch', e);
      setTraffic(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { loadTraffic(); }, [loadTraffic]);

  const ready = data && data !== UNAVAILABLE;
  const integrations = ready ? data.integrations : null;
  const jobs = ready ? data.jobs : null;
  const dlq = ready ? data.monitoring?.dlq : null;
  const incidents = ready ? data.monitoring?.incidents : null;
  const telegram = ready ? data.broadcast?.telegram : null;
  const xStatus = ready ? data.broadcast?.x : null;
  const switches = ready ? data.switches : null;
  // D213 — H16's four consoles. Each block carries its own state, so one
  // store that cannot be read empties its own panel and no other.
  const integrationKeys = ready ? data.integration_keys : null;
  const githubSync = ready ? data.github_sync : null;
  const paymentsCatalog = ready ? data.payments_catalog : null;
  const promoCodes = ready ? data.promo_codes : null;

  // One line per read that answered (D126). `canRun = coverage.length > 0` in
  // WorkerRail, so a mount passing none disables its own button and prints
  // "Not recorded" over a page whose two reads both answer. A source that
  // failed contributes no line and `coverageNote` says which — an empty rail
  // must not be readable as "nothing is connected".
  const depsReady = deps && deps !== UNAVAILABLE && deps.registry_available !== false;
  const coverage = [
    integrations?.available && num(integrations.total) !== null
      ? `${num(integrations.total)} connections across ${integrations.providers.length} providers` : null,
    jobs?.available && num(jobs.failing) !== null ? jobsLine(jobs) : null,
    depsReady
      ? `${(deps.deployments || []).length} branch ${(deps.deployments || []).length === 1 ? 'deployment' : 'deployments'} in the registry` : null,
    dlq?.available ? `${num(dlq.total)} dead letters across both queues` : null,
    incidents?.available
      ? `${num(incidents.count)} incidents entered in the last ${num(incidents.window_days)} days` : null,
    telegram?.available
      ? `${num(telegram.channels.length)} Telegram channels, ${num(telegram.channels.reduce((n, ch) => n + ch.sent_count, 0))} posts sent` : null,
    switches?.available
      ? `${num(switches.items.length)} platform switches, ${num(switches.items.filter((sw) => sw.state === 'on').length)} on` : null,
    integrationKeys?.available
      ? `${num(integrationKeys.managed)} managed keys: ${num(integrationKeys.counts.env)} as Worker secrets, ${num(integrationKeys.counts.db)} in the database, ${num(integrationKeys.counts.unset)} not set${integrationKeys.counts.unreadable > 0 ? `, ${num(integrationKeys.counts.unreadable)} unknown` : ''}` : null,
    githubSync?.window?.available
      ? `Ticket mirror: ${num(githubSync.window.synced)} synced and ${num(githubSync.window.failed)} failed in ${num(githubSync.window.window_hours)}h` : null,
    paymentsCatalog?.catalog?.available
      ? `Catalog mirror: ${num(paymentsCatalog.catalog.products.active)} active products, ${num(paymentsCatalog.catalog.prices.active)} active prices` : null,
    promoCodes?.available
      ? `${num(promoCodes.total)} promo codes, ${num(promoCodes.counts.active)} active` : null,
  ].filter(Boolean);

  const rail = (
    <WorkerRail
      workspace="Platform"
      role="super_admin"
      stance="Read-only summary"
      note="This rail summarises connection counts, where each platform key lives, the ticket mirror, the payments catalog, the promo codes, scheduled-job health, the dead-letter backlog, the broadcast channels, the platform switches and the branch deployment registry. It reads no key material, throws no switch and rolls nothing back."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === UNAVAILABLE || deps === UNAVAILABLE
          ? 'Neither read answered, so there is nothing to read back — this is not a claim that nothing is connected.'
          : 'Loading the platform summary…')}
      unavailable={[
        ['Staged switches', 'A switch is on or off for a whole deployment; none can be staged to one territory or a share of accounts.'],
        ['Branch reach', 'A switch HQ throws stops Eadwyn on HQ\'s own deployment; pushing one to the branches is not built.'],
        ['Key material', 'Never read by this page. A saved key is write-only: promoted to a Worker secret and never read back.'],
        ['Secret reveal', 'No screen reveals a saved key, so no masked secret is drawn here or anywhere.'],
        ['Key expiry', 'Nothing stores when a key expires, so none is drawn as expired or as active.'],
        ['Mirror lag', 'A ticket keeps only its latest mirror attempt, so no delay between a change and its mirror is stored.'],
        ['Catalog schedule', 'Nothing schedules a catalog sync, and a sync that fails leaves no record.'],
        ['Code attribution', 'A promo code names no licence and no cohort, so none is drawn as a branch code.'],
        ['Channel member counts', 'Never asked of Telegram, so not recorded.'],
        ['Dead letters per branch', 'No branch reports its backlog to HQ; the figure here is HQ\'s own.'],
        ['Per-subsidiary integrations', 'No account names its licence yet (U1).'],
      ]}
      data-testid="hq-platform-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-platform-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#3730a3] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          <span className="text-[11px] opacity-80 tabular-nums">
            {jobs?.available ? jobsLine(jobs) : '…'}
          </span>
        </div>

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <SlidersHorizontal size={13} /> HQ · Platform
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Platform</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Keys, the ticket mirror, the payments catalog, promo codes, jobs, deployments, monitoring,
            broadcast and switches, each read from its own store. Each console is one link from its panel,
            and changes are made there; the switches HQ can throw are thrown on Switches. No key material and
            no chat id reaches this page, and nothing on it changes a setting.
          </p>
        </header>

        {data === UNAVAILABLE && (
          <div className="mt-4">
            <Unreadable
              what="The platform summary"
              claim="This is not a claim that nothing is connected."
              onRetry={load}
            />
          </div>
        )}

        <div className="mt-4 space-y-4">
          <Zone title="Keys and connections" sub="counted and stated, never revealed">
            {integrations?.available ? (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <Stat label="Connections" value={num(integrations.total)} note="across every provider" />
                  <Stat
                    label="In error or disconnected"
                    value={num(integrations.unhealthy)}
                    note={integrations.unhealthy ? 'needs attention' : 'all healthy'}
                    tone={integrations.unhealthy ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'}
                  />
                  <Stat label="Providers" value={num(integrations.providers.length)} note="distinct integrations" />
                </div>
                {integrations.providers.length > 0 && (
                  <ul className="mt-3 space-y-1.5" data-testid="hq-platform-providers">
                    {integrations.providers.map((p) => (
                      <li key={p.provider} className="flex items-baseline justify-between gap-3 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[11.5px]">
                        <span className="font-medium">{p.provider}</span>
                        <span className="font-mono text-[10px] text-axal-faint">
                          {Object.entries(p.by_status).map(([s, n]) => `${n} ${s}`).join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-platform-secrets">
                  {integrations.secrets_note} Where each platform key lives is the Integration keys panel
                  below. No screen reveals a saved key: once saved it is write-only. Removing one is done on the
                  Integration keys console, where it is recorded and cannot be undone — not something a
                  read-only summary should be able to do.
                </p>
              </>
            ) : (
              <Absent reason={integrations?.reason || 'The platform summary could not be read.'} />
            )}
          </Zone>

          {/* D213 — H16's four consoles, P1 to P4 in the artboard's order.
              Each panel summarises its console's own store in its own state
              and ends in one literal link to that console, which is where
              anything is changed. They sit before Scheduled jobs on purpose:
              two tests slice from later headings to the Monitoring and
              Broadcast zones, and a zone placed between those would fall
              inside what they count. */}
          <div className="grid gap-4 md:grid-cols-2" data-testid="hq-platform-h16">
            <Zone title="Integration keys" sub="where each managed key lives, never its value">
              <IntegrationKeysPanel loading={data === null} unreadable={data === UNAVAILABLE} keys={integrationKeys} />
            </Zone>
            <Zone title="GitHub Sync" sub="ticket to issue mirroring, HQ only">
              <GithubSyncPanel loading={data === null} unreadable={data === UNAVAILABLE} sync={githubSync} />
            </Zone>
            <Zone title="Payments catalog" sub="the money rail, not a subsidiary billing clerk">
              <PaymentsCatalogPanel loading={data === null} unreadable={data === UNAVAILABLE} payments={paymentsCatalog} />
            </Zone>
            <Zone title="Promo codes" sub="one Stripe coupon each, not the ceilings on Revenue">
              <PromoCodesPanel loading={data === null} unreadable={data === UNAVAILABLE} promos={promoCodes} />
            </Zone>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone
              title="Scheduled jobs"
              sub={jobs?.available
                ? `each declared trigger against its own schedule, allowing ${num(jobs.grace_minutes)} minutes for a run to finish`
                : 'each declared trigger against its own schedule'}
            >
              {jobs?.available ? (
                <>
                  {jobs.triggers.every((j) => j.state === 'never') && (
                    <p className="mb-2 text-[12.5px] text-axal-muted">
                      No scheduled run has been recorded yet. The history is readable and empty, which is not the
                      same as a job that never ran.
                    </p>
                  )}
                  <ul className="space-y-1.5" data-testid="hq-platform-jobs">
                    {jobs.triggers.map((j) => (
                      <li key={j.trigger_name} className={`rounded-lg border px-3 py-2 text-[11.5px] ${JOB_TONE[j.state] || JOB_TONE.never}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate">
                            <span className="font-medium">{j.name}</span>
                            <span className="ml-1.5 font-mono text-[10px] text-axal-faint">{j.trigger_name}</span>
                          </span>
                          <span className="shrink-0 font-mono text-[10px] uppercase text-axal-faint">{j.state}</span>
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-axal-faint">
                          {j.last_started_at
                            ? `last run ${day(j.last_started_at)}${j.status ? ` · ${j.status}` : ''}`
                            : 'no run recorded'}
                          {j.expected_at ? ` · last due ${day(j.expected_at)}` : ''}
                        </div>
                        {j.error && <div className="mt-1 text-[11px] text-red-700 dark:text-red-300">{j.error}</div>}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <Absent reason={jobs?.reason || 'The platform summary could not be read.'} />
              )}
            </Zone>

            <Zone title="Deployments" sub="one row per branch: what HQ provisioned, and what answers now">
              {deps === UNAVAILABLE ? (
                <Unreadable
                  what="The deployments list"
                  claim="This is not a claim that no branch is deployed."
                  onRetry={loadDeps}
                />
              ) : deps === null ? (
                <p className="text-[12.5px] text-axal-muted">Reading every branch…</p>
              ) : deps.registry_available === false ? (
                <Absent reason={deps.registry_reason} />
              ) : (deps.deployments || []).length === 0 ? (
                <p className="text-[12.5px] leading-relaxed text-axal-muted">
                  No branch has been provisioned. A licence gains a deployment from the Deploy step of
                  the issue flow, which runs <code>branch-provision.yml</code>. This is an empty
                  registry, not an unreadable one.
                </p>
              ) : (
                <ul className="divide-y divide-axal-hairline" data-testid="hq-deployments">
                  {deps.deployments.map((d) => (
                    <li key={d.code} className="py-2">
                      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                        <span className="min-w-0 truncate">
                          <span className="font-semibold">{d.code}</span>
                          <span className="text-axal-muted"> · {d.hostname}</span>
                        </span>
                        {/* THE TWO STATES ARE SHOWN SEPARATELY AND NEVER
                            MERGED. `status` is how far provisioning got;
                            `live_state` is whether it answered a moment ago. A
                            branch that reached worker_live last week and is
                            unreachable now has not regressed to requested, and
                            one number could not say both. */}
                        <span className="shrink-0 space-x-1.5">
                          <span className="rounded-full bg-axal-ground px-2 py-0.5 text-[11px] text-axal-muted">
                            {String(d.status || '').replace(/_/g, ' ')}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${liveChip(d)[1]}`}>
                            {liveChip(d)[0]}
                          </span>
                        </span>
                      </div>
                      {d.live_state !== 'ok' && d.live_reason && (
                        <p className="mt-0.5 text-[11.5px] leading-snug text-axal-faint">{d.live_reason}</p>
                      )}
                      {d.live_state === 'ok' && d.live?.db_ok === false && (
                        <p className="mt-0.5 text-[11.5px] leading-snug text-amber-700 dark:text-amber-400" data-testid={`hq-deployment-db-${d.code}`}>
                          {d.live.detail || 'The branch answered and reported its database failing, without saying why.'}
                        </p>
                      )}
                      <div className="mt-0.5 text-[11px] text-axal-faint">
                        {d.d1_name}
                        {residencyLine(d) ? ` · ${residencyLine(d)}` : ''}
                        {d.status_note ? ` · ${d.status_note}` : ''}
                      </div>
                      {/* D163 — WHAT HQ TRIED, beside what the branch says
                          now. `live_state` is this instant; these are the last
                          thirty days, and they survive the branch being down
                          because they were never stored on it. */}
                      {actionsForBranch(deps.branch_actions, d.code).length > 0 && (
                        <ul
                          className="mt-1 space-y-0.5 text-[11px] text-axal-faint"
                          data-testid={`hq-branch-actions-${d.code}`}
                        >
                          {actionsForBranch(deps.branch_actions, d.code).map((a) => (
                            <li key={`${a.action}:${a.outcome}`}>
                              <span className={a.outcome === 'ok' ? '' : 'text-amber-700 dark:text-amber-400'}>
                                {String(a.action || '').replace(/_/g, ' ')} · {a.outcome === 'not_deployed' ? 'no binding' : a.outcome}
                              </span>
                              {' · '}{num(a.count)}× {a.last_at ? `· last ${day(a.last_at)}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {/* SAID ONCE, NOT PER ROW. An unreadable telemetry store is one
                  fact about HQ's own instrumentation; repeating it on every
                  branch would read as every branch being unreachable. */}
              {deps && deps !== UNAVAILABLE && deps.branch_actions_available === false && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-axal-faint" data-testid="hq-branch-actions-absent">
                  <b>HQ&rsquo;s own acts against these branches.</b> {deps.branch_actions_reason}
                </p>
              )}
              {deps && deps !== UNAVAILABLE && deps.dispatch_available === false && (
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-axal-muted">
                  {deps.dispatch_reason}
                </p>
              )}
              {deps && deps !== UNAVAILABLE && deps.coverage && !deps.coverage.complete && (
                <p className="mt-1.5 text-[11.5px] text-axal-faint">
                  {deps.coverage.answered} of {deps.coverage.total} branches answered.
                </p>
              )}
              {/* D209 — H14, the zone's detail: what HQ can read and through
                  what, stated from HQ's own config rather than drawn. A link
                  and not a sidebar row (the HQ group is eleven rows by
                  design), with a literal `to` so the reachability walk counts
                  it. */}
              <Link
                to="/admin/platform/topology"
                className="mt-3 block rounded-xl border border-axal-hairline bg-axal-ground px-3 py-2 hover:border-axal-violet dark:hover:border-violet-700"
                data-testid="hq-deployments-topology-link"
              >
                <div className="text-[12.5px] font-bold text-axal-ink dark:text-white">Topology</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-axal-faint">
                  What HQ can read, and through what: its bindings, the calls in both directions, and what every
                  Worker shares.
                </div>
              </Link>
            </Zone>

            {/* D202 — H17 P5: four stats, then D161's traffic table under them.
                The four come from reads this page already makes, so nothing
                on this zone is fetched twice.

                D161 — the branch dimension's reader. D105 justified sharing
                one Analytics Engine dataset across every branch on the grounds
                it was "indexed by BRANCH_CODE"; it never was, so until now no
                per-branch figure existed to draw. The dimension now rides in
                blob6 of every request, and this is where HQ reads it.

                SUPER ADMIN ONLY, deliberately. `/monitoring/analytics/technical`
                is `requireAdmin` and stays a platform-wide aggregate, because a
                plain admin is a branch admin and attributing traffic to a named
                branch there would show every branch admin every other branch's
                figures. */}
            <Zone title="Monitoring" sub="infra, cron, dead letters and traffic, across every branch">
              <div className="grid grid-cols-2 gap-2" data-testid="hq-monitoring-stats">
                <Stat label="Branch Workers healthy" {...workersStat(deps)} />
                <Stat label="Cron triggers firing" {...triggersStat(data, jobs)} />
                <Stat label="DLQ depth" {...dlqStat(data, dlq)} />
                <Stat
                  label={incidents?.window_days ? `Incidents (${incidents.window_days}d)` : 'Incidents'}
                  {...incidentsStat(data, incidents)}
                />
              </div>
              {incidents?.available && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-axal-faint" data-testid="hq-incidents-basis">
                  {incidents.basis}
                </p>
              )}

              <h3 className="mt-4 text-[12.5px] font-bold text-axal-ink dark:text-white">Traffic by branch</h3>
              <p className="mb-1 text-[11px] text-axal-faint">one row per deployment that served a request</p>
              {traffic === UNAVAILABLE ? (
                <Unreadable
                  what="Traffic by branch"
                  claim="This is not a claim that no branch served traffic."
                  onRetry={loadTraffic}
                />
              ) : traffic === null ? (
                <p className="text-[12.5px] text-axal-muted">Reading the metrics store…</p>
              ) : traffic.available === false ? (
                <Absent reason={traffic.reason} />
              ) : (traffic.rows || []).length === 0 ? (
                <p className="text-[12.5px] leading-relaxed text-axal-muted">
                  The metrics store answered and holds no request in this window. That is an empty
                  result, not an unreadable one.
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-axal-hairline" data-testid="hq-traffic-by-branch">
                    {traffic.rows.map((t) => (
                      <li key={t.branch} className="flex items-baseline justify-between gap-3 py-2 text-[12.5px]">
                        <span className="min-w-0 truncate">
                          <span className="font-semibold">{t.branch === 'hq' ? 'HQ' : t.branch}</span>
                          <span className="text-axal-muted tabular-nums"> · {num(t.hits)} requests</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-axal-faint">
                          {perMinute(t.hits, traffic.window_minutes) ?? <Unrecorded />} req/min avg
                          {' · '}{num(t.p95_ms)}ms p95 · {t.error_rate_pct}% 5xx · DLQ{' '}
                          {t.branch === 'hq'
                            ? hqDlqCell(data, dlq)
                            : <Unrecorded reason="No branch reports its dead-letter backlog to HQ.">not recorded</Unrecorded>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/* With no branch provisioned every row carries `hq`, so say
                      so rather than letting a single row read as a fan-out. */}
                  {traffic.rows.length === 1 && traffic.rows[0].branch === 'hq' && (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-axal-muted">
                      Only HQ has served traffic. Each branch appears here once its Worker is deployed
                      and answering — this is one deployment, not one branch out of several.
                    </p>
                  )}
                  {traffic.range && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-traffic-window">
                      Req/min is the average over the window this read covers, {day(traffic.range.from)} to{' '}
                      {day(traffic.range.to)} UTC — not a live rate. DLQ depth is HQ&rsquo;s own backlog: no
                      branch reports its dead letters to HQ.
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-axal-faint">
                    Read {day(traffic.as_of)}.
                  </p>
                </>
              )}
            </Zone>

            {/* D202 — H17 P6. Platform channels, never a branch's: a
                subsidiary does not send on these. Each channel is read from
                its own row, reduced to what an operator needs to know about
                it; the chat id is turned into a yes/no in the query and never
                reaches this page. */}
            <Zone title="Broadcast" sub="platform channels, not a branch megaphone">
              <BroadcastConsole
                loading={data === null}
                unreadable={data === UNAVAILABLE}
                telegram={telegram}
                xStatus={xStatus}
              />
            </Zone>

            <Zone title="Operator consoles" sub="the controls this summary does not hold">
              <p className="text-[12.5px] leading-relaxed text-axal-muted">
                Keys, the ticket mirror, the catalog and the promo codes are each linked once, from their own
                panel above. These two have no panel here. This page counts; those pages change.
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="hq-platform-consoles">
                <li>
                  <Link to="/monitoring" className={CONSOLE_TILE}>
                    <div className="text-[12.5px] font-bold text-axal-ink dark:text-white">Monitoring</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-axal-faint">
                      Infra, cron, and the platform-wide aggregate.
                    </div>
                  </Link>
                </li>
                <li>
                  <Link to="/admin/telegram" className={CONSOLE_TILE}>
                    <div className="text-[12.5px] font-bold text-axal-ink dark:text-white">Telegram</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-axal-faint">
                      Channels and drafts. X stays off until OAuth is bound.
                    </div>
                  </Link>
                </li>
              </ul>
            </Zone>

            <Zone title="Feature flags" sub="every switch, read-only — HQ throws its own on Switches">
              {/* Loading is its own state. This zone used to say the summary
                  "could not be read" for as long as it was still being read. */}
              {data === null
                ? <p className="text-[12.5px] text-axal-muted">Reading the platform summary…</p>
                : !ready && <Absent reason={'The platform summary could not be read.'} />}
              <div className="mt-3 grid grid-cols-2 gap-2" data-testid="hq-flags-stats">
                <Stat label="Flags" {...flagsStat(data, switches)} />
                <Stat label="Overrides" {...overridesStat(data, switches)} />
              </div>
              {ready && <SwitchList switches={switches} />}
              {/* D203 — THE ONE DOOR TO THE CONTROL, and a link rather than a
                  button: this page holds no handler, and the Switches page is
                  where a throw is confirmed, reasoned and recorded. A literal
                  `to` so the reachability walk counts it. */}
              <Link
                to="/admin/platform/switches"
                className="mt-3 block rounded-xl border border-axal-hairline bg-axal-ground px-3 py-2 hover:border-axal-violet dark:hover:border-violet-700"
                data-testid="hq-flags-switches-link"
              >
                <div className="text-[12.5px] font-bold text-axal-ink dark:text-white">Switches</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-axal-faint">
                  Throw or release the switches HQ owns, with a reason. Each change is recorded in the audit log.
                </div>
              </Link>
            </Zone>
          </div>
        </div>
      </div>

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
