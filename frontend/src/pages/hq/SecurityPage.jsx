import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { newOpKey } from '../../lib/opKey';
import { Card, RailFrame, WorkerRail, Unrecorded, Unreadable } from '../../ui';
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import SecurityTabs from './security/SecurityTabs.jsx';
import OverviewWorkspace from './security/OverviewWorkspace.jsx';
import SourceAvailability from './security/SourceAvailability.jsx';
import AccessWorkspace from './security/AccessWorkspace.jsx';
import EventsWorkspace from './security/EventsWorkspace.jsx';
import { activeCount, feedQuery } from './security/eventsModel.js';
import ResilienceWorkspace from './security/ResilienceWorkspace.jsx';
import AiSafetyWorkspace from './security/AiSafetyWorkspace.jsx';
import StatusBadge from './security/StatusBadge.jsx';
import { buildOverview, clockOf } from './security/overviewModel.js';
import { tabFromSearch, tabOf } from './security/securityTabs.js';

/**
 * HQ · Security — canvas H23 (Admin · Super), which "completes Y2/H7".
 *
 * ONE LEDGER, FIVE STORES, AND IT IS DELIBERATELY NOT PRETTY. H23's own
 * subtitle says so. The feed that used to be H7's "Privileged action log" —
 * four stores merged newest-first — is now H23's `security_events` ledger:
 * the same union with a fifth store, the `security_events` table migration
 * 282 created (D200), rendered as a MONOSPACE five-column ledger in the
 * canvas's columns (`ts · actor · branch · event · outcome`). H7 still draws
 * `Time · Actor · Tenant · Action · Target and reason` and five filters; H23
 * draws these five and says it completes H7, so H23 wins for this page and
 * D200 records the disagreement rather than picking silently.
 *
 * WHAT WAS "NOT RECORDED" AND IS NOT ANY MORE. This page used to name three
 * absences in the zones the canvas draws for them: the security ledger, a
 * sanctions screen, and backup / DR status. Measured, two of the three were
 * refusals denying stores the platform has — `sanctions_screenings` has been
 * written by `screenUser` since migration 035 (on request, never on a
 * schedule) and the nightly export writes a heartbeat to R2 the Worker can
 * read. So: the ledger is real (rows today, refused sign-ins in 24 hours, the
 * feed), the Sanctions card carries the store's own figures with the sentence
 * that a count of zero is a measured zero, and Backup / DR is two halves with
 * their own states — the export's heartbeat, and the restore drill's own
 * marker (D263; until then its outcome was written nowhere the platform could
 * read). H23 itself draws Sanctions as "Not recorded"; the canvas's sentence "a list
 * check happens inside KYC at the branch" is false for this repo, and the
 * card says what is true instead.
 *
 * ABSENT IS NOT ZERO. `num` returns null for a missing figure, a failed
 * request is unreadable rather than a quiet platform, and each `available:
 * false` block carries its reason onto the screen. A `security_events` count
 * that could not be read renders its reason in the bar, never `0 rows today`.
 *
 * AND H7'S RULE FOR ITSELF IS KEPT: "no cards, no summary tiles, no chart —
 * an audit log that has been made attractive is an audit log someone has
 * edited for legibility." No tile sits above the ledger. The tiles this page
 * does carry belong to H23's own cards, which are not the log.
 *
 * H7'S "Viewing as: Axal VC France · Return to HQ view" OVERLAY IS BUILT
 * (D153), and this page describes it rather than drawing it: the bar lives in
 * the shell, above every other bar, so it frames Home and Team rather than one
 * page. What this page carries is the sentence, and it comes from the payload
 * rather than from here so there is one copy of it. This page's own figures
 * stay HQ-wide — the ledger is HQ's record of what happened at HQ's door and
 * what HQ did, which is not a branch's to show.
 */
export const UNAVAILABLE = Symbol('unavailable');
/** Workspaces that say for themselves what could not be read (D4803), so the page banner stays off there. */
const OWN_UNREADABLE = new Set(['overview', 'resilience', 'ai-safety']);

const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);
// A number, formatted — or null when there is no number. Never a default.
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const titleCase = (s) => String(s || '').replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());

/**
 * The six filters, in the server's order — the fallback while the feed is
 * still in flight so the bar does not pop into existence. The server sends
 * the same list with what each one reads, and that copy wins once it arrives.
 * The sixth is H23's: the ledger of refusals and step-ups (D200).
 */
const GOV_FILTERS = [
  { key: 'all', label: 'All actions' },
  { key: 'impersonations', label: 'Impersonations' },
  { key: 'licence_changes', label: 'Licence changes' },
  { key: 'suspensions', label: 'Suspensions' },
  { key: 'exports', label: 'Exports' },
  { key: 'auth', label: 'Sign-ins and step-ups' },
];

/** D4803 — the Events filter bar, untouched: exactly the read the ledger always made. */
export const EMPTY_CONTROLS = Object.freeze({ q: '', range: 'any', custom: {}, actor: '', outcome: '', source: '' });


/**
 * D4691 — every actor on this page arrives in one shape (`actor_identity`,
 * services/securityIdentity.ts) and is drawn with its kind, so a support
 * operator never reads as the account holder, a refused attempt never reads
 * as the account it named, and an act with no account reads as the platform
 * rather than as a blank.
 */
export const IDENTITY_KIND_LABEL = {
  user: 'account',
  support: 'support',
  system: 'system',
  network: 'network',
};
export function identityLine(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const kind = IDENTITY_KIND_LABEL[identity.kind] || 'unknown';
  const behalf = identity.kind === 'support' && identity.on_behalf_of ? ` for ${identity.on_behalf_of.label}` : '';
  return { kind, text: `${identity.label}${behalf}` };
}

function Zone({ title, sub, children, tone = '' }) {
  return (
    <Card className={tone}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{title}</h2>
        {sub && <span className="text-[11.5px] text-axal-faint">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

/**
 * D4691 — the "Live support sessions" tile's note. `active` is the shared rule's
 * `live`, the same rows the Sessions zone offers to End; an open record past
 * its limit is counted apart, by name, never as live and never dropped.
 */
export function impersonationNote(imp) {
  const nc = Number.isFinite(Number(imp?.not_closed)) ? Number(imp.not_closed) : 0;
  return nc > 0
    ? `token could still be valid · ${nc.toLocaleString()} open record${nc === 1 ? '' : 's'} past the limit, not live`
    : 'token could still be valid';
}

/**
 * D152 — the "AI safety" zone stopped being one `<Absent>` line.
 *
 * It rendered `data.ai_safety.reason`, which said no guardrail, flagged-output
 * or token-anomaly counter was stored. Two of those three were false, and the
 * verdict rollup was ALREADY on screen elsewhere — `AiUsageTab` draws it as
 * "Guardrail safety (llama-guard)". So HQ's security desk denied a figure the
 * platform was showing one click away.
 *
 * FOUR TILES, TWO STORES, AND THE SPLIT IS THE POINT. A verdict is what the
 * guard THOUGHT; a block and a flag are what the platform DID about it. They
 * come from different tables and fail independently (`advisor_turn_audit` is
 * lazily bootstrapped), so each pair reads its own availability and an
 * unreadable half renders `<Unrecorded/>` with its reason rather than a zero —
 * on a safety counter, a false zero is the worst possible direction to be
 * wrong in.
 *
 * `!block` is loading-or-unreadable, never "nothing was recorded": the page's
 * own `<Unreadable/>` above says which, and these tiles must not answer a
 * question they were not able to ask.
 */
export function AiSafety({ block }) {
  // D4691 — a rollup that could not be read is unreadable as a whole, and the
  // token anomalies and the not-counted list (their own reads) still render.
  if (block && block.available === false) {
    return (
      <div data-testid="hq-ai-safety">
        <div data-testid="hq-ai-safety-unreadable">
          <Unreadable what="The AI guardrail counters" claim="This is not a claim that nothing was blocked or flagged." />
        </div>
        <TokenAnomalies block={block.token_anomalies} />
      </div>
    );
  }
  const v = block?.verdicts;
  const e = block?.enforcement;
  // `windowNote`, not `window`: a local of that name shadows the browser global
  // inside this component, which is legal and quietly confusing.
  const windowNote = block ? `in ${block.window_days} days` : 'unreadable';
  // A rate over an empty denominator is not 0%. The server sends null; the
  // note says what actually happened instead of printing a percentage.
  const rate = v?.available && v.safe_rate !== null && v.safe_rate !== undefined
    ? `${(v.safe_rate * 100).toFixed(1)}% judged safe`
    : (v?.available ? 'the guard did not run in this window' : (v?.reason || 'unreadable'));
  return (
    <div data-testid="hq-ai-safety">
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Guard verdicts"
          value={v?.available ? num(v.evaluated) : null}
          note={v?.available ? `completed safety verdicts ${windowNote}` : (v?.reason || 'unreadable')}
        />
        <Stat
          label="Judged unsafe"
          value={v?.available ? num(v.unsafe_count) : null}
          note={rate}
          tone={v?.available && v.unsafe_count ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'}
        />
        <Stat
          label="Turns blocked"
          value={e?.available ? num(e.blocked) : null}
          note={e?.available ? 'refused before the model answered' : (e?.reason || 'unreadable')}
          tone={e?.available && e.blocked ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'}
        />
        <Stat
          label="Outputs flagged"
          value={e?.available ? num(e.flagged) : null}
          note={e?.available ? 'shadow-flagged, the turn still answered' : (e?.reason || 'unreadable')}
          tone={e?.available && e.flagged ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'}
        />
      </div>
      {/*
        D158 — WHICH RULE FIRED. Until migration 270 this panel could say how
        often the guard fired and never what for, and the list below carried a
        row saying so. Three things here follow the payload rather than the
        layout: `rules` and `states` are rendered apart, because a router
        failure is the guard NOT running and does not belong in a list headed
        "what tripped it"; `unclassified` is stated rather than folded in,
        because every turn recorded before 270 has no category and calling one
        `safe` would be a verdict nothing reached; and the whole block is
        absent, not zeroed, when `advisor_turn_audit` could not be read.
      */}
      {e?.available && e.breakdown_available === false && (
        <div className="mt-3" data-testid="hq-ai-safety-rules-unreadable">
          <div className="text-[11px] font-semibold text-axal-muted">What tripped the guard</div>
          <p className="mt-1 text-[11px] text-axal-faint">
            Unreadable — {e.breakdown_reason || 'the breakdown by rule could not be read.'} The totals above were read.
          </p>
        </div>
      )}
      {e?.available && e.breakdown_available !== false && (
        <div className="mt-3" data-testid="hq-ai-safety-rules">
          <div className="text-[11px] font-semibold text-axal-muted">What tripped the guard</div>
          {e.rules?.length ? (
            <ul className="mt-1 space-y-0.5">
              {e.rules.map((rr) => (
                <li key={rr.category} className="text-[11px] text-axal-faint tabular-nums">
                  <b className="text-axal-muted">{rr.category}</b> — {num(rr.turns)} {rr.turns === 1 ? 'turn' : 'turns'}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 text-[11px] text-axal-faint" data-testid="hq-ai-safety-rules-none">
              No turn in this window named a violated rule.
            </div>
          )}
          {e.unclassified > 0 && (
            <div className="mt-1 text-[11px] text-axal-faint" data-testid="hq-ai-safety-unclassified">
              {num(e.unclassified)} {e.unclassified === 1 ? 'turn was' : 'turns were'} recorded without a
              category. Turns written before the category was stored carry none — that is not a turn judged safe.
            </div>
          )}
          {e.states?.length > 0 && (
            <div className="mt-1 text-[11px] text-axal-faint" data-testid="hq-ai-safety-states">
              Classification outcomes: {e.states.map((ss) => `${ss.category} ${ss.turns}`).join(' · ')}. These
              describe the check itself, not a rule that fired.
            </div>
          )}
        </div>
      )}
      {v?.available && <p className="mt-3 text-[11px] text-axal-muted dark:text-gray-400" data-testid="hq-verdict-breakdown">
        {num(v.safe_count)} safe · {num(v.unsafe_count)} unsafe · {v.no_verdict_count == null ? 'Not recorded' : num(v.no_verdict_count)} without a verdict.
        {' '}Checks without a verdict are excluded from the safe rate. Check volume is not a measure of safety quality.
      </p>}
      <p className="mt-3 text-[11px] text-axal-muted dark:text-gray-400">
        Unsafe verdicts are historical checks, not unresolved incidents. Turns blocked and
        outputs flagged above cover the legacy chat audit; they do not include the router
        enforcement below. These totals cannot establish whether a particular output was delivered.
      </p>
      {block?.guard?.available ? (
        <div className="mt-3" data-testid="hq-router-enforcement">
          <h3 className="text-[11px] font-semibold text-axal-muted">Router enforcement · {windowNote}</h3>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Stat label="Inputs blocked" value={num(block.guard.by_page.reduce((n, p) => n + p.blocked_input, 0))} note="refused by the router guard" />
            <Stat label="Outputs withheld" value={num(block.guard.by_page.reduce((n, p) => n + p.withheld_output, 0))} note="stopped before delivery" />
          </div>
        </div>
      ) : block && <p className="mt-3 text-[11px] text-axal-muted">Router enforcement: {block.guard?.reason || 'Not recorded'}</p>}
      <TokenAnomalies block={block?.token_anomalies} />
      {(block?.not_counted || []).length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid="hq-ai-safety-not-counted">
          {block.not_counted.map((n) => (
            <li key={n.what} className="text-[11px] leading-relaxed text-axal-faint">
              <b className="text-axal-muted">{n.what}</b> — <Unrecorded />. {n.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * D481 — H23's "Token anomalies" tile, from `ai_usage_logs`.
 *
 * It was the last row of D152's not-counted list, and the one that was true:
 * nothing computed a spike. The server computes it now and sends its own
 * `how`, because the threshold is a judgement and the reader should see it
 * beside the figure rather than infer it. Three states: absent (the overview
 * is still loading or failed — the page says which, so this says nothing),
 * UNREADABLE (the table could not be read: never a zero, and never "Not
 * recorded", which would claim the platform keeps no such figure), and the
 * figure with the accounts behind it.
 */
export function TokenAnomalies({ block }) {
  if (!block) return null;
  if (!block.available) {
    return (
      <div className="mt-3" data-testid="hq-token-anomalies-unreadable">
        <Unreadable
          what="Token consumption (ai_usage_logs)"
          claim="No account was checked — this is not a claim that nothing spiked."
        />
      </div>
    );
  }
  return (
    <div className="mt-3" data-testid="hq-token-anomalies">
      <Stat
        label="Token anomalies"
        value={num(block.count)}
        note={`last ${block.window_hours} hours against each account's own ${block.baseline_days}-day average · ${num(block.accounts_checked)} account${block.accounts_checked === 1 ? '' : 's'} checked`}
        tone={block.count ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'}
      />
      {block.rows.length > 0 && (
        <ul className="mt-1.5 space-y-0.5" data-testid="hq-token-anomaly-rows">
          {block.rows.map((a) => (
            <li key={a.user_id} className="text-[11px] text-axal-faint tabular-nums">
              <b className="text-axal-muted">{a.name || a.email || `user ${a.user_id}`}</b> — {num(a.tokens_24h)} tokens
              in 24 hours, {a.ratio}× an average day of {num(a.daily_avg_baseline)}
            </li>
          ))}
        </ul>
      )}
      {block.no_baseline > 0 && (
        <p className="mt-1 text-[11px] text-axal-faint" data-testid="hq-token-anomalies-no-baseline">
          {num(block.no_baseline)} account{block.no_baseline === 1 ? '' : 's'} crossed the floor with no usage in the
          {' '}{block.baseline_days} days before, so there is no usual to compare with. Not counted as anomalies, and
          not hidden: a dormant account waking up looks exactly like this.
        </p>
      )}
      <p className="mt-1 text-[10.5px] leading-relaxed text-axal-faint">{block.how}</p>
    </div>
  );
}

/**
 * D481 — a stated absence with its reason, for H23's tiles the platform does
 * not record (Accreditation lapsed, Failover test). Read from the payload so
 * the server and the page cannot disagree about what is missing.
 */
export function NotRecordedList({ items, testid }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-2 space-y-1.5" data-testid={testid}>
      {items.map((n) => (
        <li key={n.what} className="text-[11px] leading-relaxed text-axal-faint">
          <b className="text-axal-muted">{n.what}</b> — <Unrecorded />. {n.reason}
        </li>
      ))}
    </ul>
  );
}

/**
 * D481 — one open request's subject line. The kind is the row's own field
 * (`kind`, set by the store that holds the row); the zone used to print the
 * word "erasure" as a literal, true today only because the ledger holds
 * nothing else.
 */
export function DsrSubject({ row }) {
  return (
    <span className="min-w-0 truncate">
      <b>{row.name || row.email}</b>{' '}
      <span className="text-axal-faint">
        · {titleCase(row.role)} · {row.kind || <Unrecorded>kind not recorded</Unrecorded>}
      </span>
    </span>
  );
}

/** D481 — the request kinds the ledger does not hold, each Not recorded with its reason. */
export function DsrKindsNotRecorded({ kinds }) {
  const missing = (kinds || []).filter((k) => !k.recorded).map((k) => ({ what: titleCase(k.kind), reason: k.reason }));
  return <NotRecordedList items={missing} testid="hq-dsr-kinds-not-recorded" />;
}

/**
 * D481 — which route each of the Access workspace's acts goes to. Sign out
 * account is D165's per-account route, reached from a row rather than
 * duplicated; the other three are D481's. D4801 — emergency
 * re-authentication goes through here too, so every write the workspace
 * makes leaves this page by one door (`security/README.md`: no request from
 * the workspace files).
 */
export async function runSessionAct(client, kind, arg, reason) {
  if (kind === 'revoke') return client.hqRevokeSession(arg, reason);
  if (kind === 'revoke_selected') return client.hqRevokeSessions(arg, reason);
  if (kind === 'end') return client.hqEndImpersonation(arg, reason);
  if (kind === 'sign_out') return client.hqForceReauthUser(arg, reason);
  if (kind === 'emergency') return client.hqSecurityForceReauth(reason);
  throw new Error(`Unknown session act: ${kind}`);
}

/**
 * D481's list, drawn by the Access workspace (D4801). A caller that still
 * mounts SessionsPanel gets that workspace: the row shows the network bucket,
 * never the address, and names a support-held session as held.
 */
export function SessionsPanel(props) {
  return <AccessWorkspace unavailable={UNAVAILABLE} onRetry={() => {}} {...props} />;
}

// `unread` (D4801): an absent figure on the Access tiles is a store that could
// not be read, so it draws the vocabulary's Unavailable, never "Not recorded"
// and never 0. The other zones' tiles keep their words until their slice.
function Stat({ label, value, note, tone = 'text-axal-ink dark:text-white', unread = false }) {
  return (
    <div className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className={`mt-1 text-lg font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? (unread ? <StatusBadge state="unavailable" /> : <Unrecorded />)}</div>
      {note && <div className="mt-0.5 text-[10px] text-axal-faint">{note}</div>}
    </div>
  );
}

/**
 * D200 — H23's bar: `security_events · append-only · N rows today`.
 *
 * Three states, and only one of them is a figure. Before the overview answers
 * the slot says it is waiting; under a FAILED overview read it says the ledger
 * is unreadable rather than keeping the ellipsis, which would claim an answer
 * is on its way; and an unreadable ledger inside a readable overview carries
 * the server's own reason. None of the three is ever `0 rows today`.
 */
export function securityEventsBar(ready, se, overviewUnreadable) {
  if (!ready) {
    return overviewUnreadable ? 'security_events · unreadable · the security overview could not be read' : 'security_events · …';
  }
  if (se?.available) return `security_events · append-only · ${num(se.today)} rows today`;
  return `security_events · unreadable · ${se?.reason || 'the ledger could not be read'}`;
}

/**
 * D200 — why the DSR grouping has one group. The count of bound branches is
 * the server's; `null` means the env could not be scanned, which is not "no
 * branch is bound" and so gets a sentence of its own.
 */
export function dsrBranchesSentence(branches) {
  if (branches.bound === 0) return 'No branch is bound; every open request is HQ-held.';
  if (branches.bound === null) return `Whether a branch is bound could not be read. ${branches.reason}`;
  return `${num(branches.bound)} branch${branches.bound === 1 ? ' is' : 'es are'} bound. ${branches.reason}`;
}

/**
 * D200 — H23's Sanctions card, from the store's own figures.
 *
 * The card this replaced was one `<Stat value={null}>` reading the server's
 * refusal, and that refusal — "No sanctions screening runs on the platform" —
 * was false: `sanctions_screenings` has existed since migration 035 and
 * `screenUser` writes one row per on-request run. Four figures now, plus the
 * server's sentence about HOW a run happens, because a count of zero on a
 * store nothing schedules is a measured zero and must not read as a store
 * that does not exist. Unreadable is its own state, with the reason.
 */
export function Sanctions({ block, unreadable }) {
  // `!block` is loading OR a failed overview read, and those are different
  // claims: under a failed read "Loading…" would say an answer is coming.
  if (!block) {
    return unreadable
      ? (
        <Unreadable
          what="The security overview"
          claim="This is not a claim that nothing happened."
        />
      )
      : <p className="text-[12px] text-axal-faint">Loading…</p>;
  }
  if (!block.available) {
    return (
      <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-sanctions-unreadable">
        <Unrecorded reason={block.reason} />
      </p>
    );
  }
  return (
    <div data-testid="hq-sanctions">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Screening runs" value={num(block.runs_total)} note={block.runs_total === 0 ? 'none has been asked for' : 'recorded, one row per run'} />
        <Stat label="Last run" value={block.last_run_at ? day(block.last_run_at) : 'never'} note="on request, never scheduled" />
        <Stat label="Hits" value={num(block.hits_total)} note="runs that matched a list" tone={block.hits_total ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'} />
        <Stat label="Unreviewed hits" value={num(block.unreviewed_hits)} note="awaiting a reviewer's note" tone={block.unreviewed_hits ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
        {block.how} <a href={block.path} className="underline">Open the Trust Center →</a>
      </p>
    </div>
  );
}

/**
 * D200 — H23's Backup / DR card, as TWO facts with their own states.
 *
 * The backup half reads the heartbeat the nightly export writes to R2: absent
 * with its reason when the binding is unbound or nothing was ever written,
 * present with the export's own stamp otherwise. D263 — the drill half reads
 * the marker the restore drill writes on every exit, in four states of its
 * own (unreadable, never run, last run failed, last run passed), and none of
 * them is inferred from the backup half however green that is. The canvas's
 * own words: "stated in words rather than a green light."
 */
export function drillSentence(drill) {
  // D4691 — invalid is its own word: something was read, and it is not a
  // drill marker this page can believe.
  if (drill?.state === 'invalid') return `Invalid — ${drill.reason || 'the drill marker is not valid evidence.'}`;
  if (!drill || drill.state === 'unreadable' || drill.available === false) {
    return `Unreadable — ${drill?.reason || 'the drill marker could not be read.'}`;
  }
  if (drill.state === 'never_run') return `Never run — ${drill.reason}`;
  const when = day(drill.at) || 'an unstamped date';
  // D4691 — a result older than its window is history, said so before the result.
  const stale = drill.fresh === false
    ? `Stale — older than ${drill.stale_after_days} days, so it does not vouch for recovery today. `
    : '';
  if (drill.state === 'last_run_failed') {
    const exit = drill.exit_code === null || drill.exit_code === undefined ? 'no exit code recorded' : `exit ${drill.exit_code}`;
    return `${stale}Last run failed on ${when}, at step ${drill.step || 'not recorded'} (${exit}).`;
  }
  if (drill.state === 'last_run_passed') {
    const missed = [drill.rpo_met === false ? 'its recovery-point target' : null, drill.rto_met === false ? 'its recovery-time target' : null]
      .filter(Boolean);
    return `${stale}Last run passed on ${when}, restoring ${drill.backup_key || 'a backup it did not name'}.`
      + (missed.length ? ` It missed ${missed.join(' and ')}.` : '');
  }
  return `Unreadable — the drill marker is in a state this page does not know (${String(drill.state)}).`;
}

/**
 * D4691 — the export heartbeat in one sentence, by its own state. A heartbeat
 * that is not valid evidence, or is older than its window, never reads as a
 * recorded backup.
 */
export function backupSentence(b) {
  if (!b) return 'Unreadable — the heartbeat could not be read.';
  if (b.available === false) {
    if (b.state === 'invalid') return `Invalid — ${b.reason}`;
    if (b.state === 'never_written') return `Not recorded — ${b.reason}`;
    return `Unreadable — ${b.reason || 'the heartbeat could not be read.'}`;
  }
  const what = `${b.kind === 'kv' ? 'KV' : 'D1'} export of ${day(b.recovery_point || b.at) || 'an unstamped time'}`;
  if (b.fresh === false) {
    return `Stale — the last ${what} is older than ${b.stale_after_hours} hours, so it is not a current backup.`;
  }
  return `Last ${what}${b.source ? ` · ${b.source}` : ''}${b.size_bytes !== null && b.size_bytes !== undefined ? ` · ${num(b.size_bytes)} bytes` : ''}.`;
}

function DrillState({ drill }) {
  // D4691 — a stale result is amber whatever it says: it is history, not a status.
  const stale = drill?.fresh === false;
  const failed = drill?.state === 'last_run_failed' || drill?.state === 'invalid';
  const passed = drill?.state === 'last_run_passed' && !stale;
  const tone = stale ? 'text-amber-800 dark:text-amber-300'
    : failed ? 'text-red-700 dark:text-red-300' : passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-muted';
  return (
    <p className={`text-[12.5px] leading-relaxed ${tone}`} data-state={drill?.state || 'unreadable'}>
      {drillSentence(drill)}
    </p>
  );
}

export function BackupDr({ block, unreadable }) {
  // Same rule as Sanctions: a failed overview read is not a load in progress.
  if (!block) {
    return unreadable
      ? (
        <Unreadable
          what="The security overview"
          claim="This is not a claim that nothing happened."
        />
      )
      : <p className="text-[12px] text-axal-faint">Loading…</p>;
  }
  const b = block.backup;
  return (
    <div className="space-y-2" data-testid="hq-backup-dr">
      <div>
        <div className="text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-faint">Nightly export</div>
        {b?.available && b.fresh !== false ? (
          <p className="mt-0.5 text-[12px] text-axal-muted" data-testid="hq-backup-heartbeat" data-state={b.state || 'fresh'}>
            {backupSentence(b)}
          </p>
        ) : (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-amber-800 dark:text-amber-300" data-testid={b?.available ? 'hq-backup-stale' : 'hq-backup-unreadable'} data-state={b?.state || 'unreadable'}>
            {backupSentence(b)}
          </p>
        )}
      </div>
      <div>
        <div className="text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-faint">Restore drill</div>
        <div className="mt-0.5" data-testid="hq-restore-drill">
          <DrillState drill={block.drill} />
        </div>
      </div>
    </div>
  );
}

/** The write bar's refusal, in words the operator can act on (D4675 keeps it for the DSR close). */
export function writeBarMessage(err) {
  const msg = String(err?.message || err || 'Request failed');
  return msg === 'TOTP required'
    ? 'This needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.'
    : msg;
}

/**
 * D168 — one open erasure request, and the two outcomes HQ may record.
 *
 * WHY THIS EXISTS. Before it, this zone rendered a statutory clock in amber,
 * turned it red when it ran out, and offered nothing: the only way a row left
 * the list was the subject cancelling their own request. HQ watched a legal
 * deadline it could not stop.
 *
 * `withdrawn` IS NOT OFFERED, and the server refuses it too. A withdrawal is
 * the subject's act, recorded when they cancel in their own Settings; a
 * control here would let an operator record that someone changed their mind
 * when they did not.
 *
 * `Fulfilled` RECORDS A MANUAL ACT, IT DOES NOT PERFORM ONE — the platform
 * erases nothing, and the button's own note says so. A control labelled as if
 * it deleted the account would be the `still_an_admin` mistake D134 named, in
 * the one place where the lie is also a compliance record.
 */
export function DsrClose({ row, onDone }) {
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // D4675 — ONE KEY PER CLOSE, resent on every retry of it, so a retry after a
  // lost response or a step-up prompt is recorded once. A new outcome is a
  // different close and gets a new key.
  const [closeKey, setCloseKey] = useState(newOpKey);
  // Set when the server recorded nothing because the request changed or was
  // closed first: the row is out of date, and only a reload shows what is open.
  const [outdated, setOutdated] = useState(false);
  const choose = (next) => { setOutcome(next); setCloseKey(newOpKey()); setError(null); setOutdated(false); };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.hqCloseDsrRequest(row.id, outcome, reason.trim(), {
        requested_at: row.requested_at,
        request_id: row.request_id ?? null,
        close_key: closeKey,
      });
      // 202: sent, and not confirmed. The key is kept, so Try again is safe.
      if (res?.code === 'outcome_unconfirmed') { setError(res.error); return; }
      onDone?.();
    } catch (err) {
      if (err?.code === 'stale_request' || err?.code === 'no_open_request') {
        setOutdated(true);
        setError(writeBarMessage(err));
      } else if (err?.code !== 'ledger_unavailable' && (!err?.status || err.status >= 500)) {
        // No answer, or the server could not confirm: say unknown, not failed.
        setError(`${writeBarMessage(err)} Whether it was recorded is not confirmed. Try again: the same close is recorded at most once.`);
      } else {
        setError(writeBarMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };
  if (!outcome) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="hq-dsr-actions">
        <button
          type="button"
          onClick={() => choose('fulfilled')}
          className="rounded-md border border-axal-hairline bg-white px-2 py-1 text-[11px] font-semibold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          Record as fulfilled
        </button>
        <button
          type="button"
          onClick={() => choose('denied')}
          className="rounded-md border border-axal-hairline bg-white px-2 py-1 text-[11px] font-semibold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          Record as denied
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-1.5 space-y-1.5" data-testid="hq-dsr-close-form">
      <p className="text-[11px] leading-relaxed text-axal-muted">
        {outcome === 'fulfilled'
          ? 'This records that the erasure was carried out. It does not erase anything — the platform performs no deletion, so what you are recording is the manual act.'
          : 'This records a refusal, with your reason stored against it. The subject can make a new request.'}
      </p>
      <label className="block text-[11px] font-semibold text-axal-muted">
        Reason · required, stored with the action
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={outcome === 'fulfilled'
            ? 'e.g. records purged from D1 and R2 on 2026-09-19, ticket DSR-14'
            : 'e.g. retained under an open legal hold, ticket DSR-15'}
          className="mt-1 w-full rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[12px] font-normal text-axal-ink dark:bg-gray-900"
        />
      </label>
      {error && <p role="alert" className="text-[11.5px] text-red-700 dark:text-red-300" data-testid="hq-dsr-close-error">{error}</p>}
      <div className="flex items-center gap-1.5">
        {outdated && (
          <button
            type="button"
            onClick={() => onDone?.()}
            className="rounded-md border border-axal-hairline bg-white px-2.5 py-1 text-[11px] font-bold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            data-testid="hq-dsr-reload"
          >
            Reload requests
          </button>
        )}
        <button
          type="submit"
          disabled={busy || outdated || reason.trim().length < 8}
          className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-amber-700 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500 dark:bg-gray-900 dark:text-amber-300 dark:hover:bg-amber-950/30"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null} Close as {outcome}
        </button>
        <button
          type="button"
          onClick={() => choose('')}
          className="rounded-md px-2 py-1 text-[11px] font-semibold text-axal-faint hover:text-axal-ink dark:hover:text-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A read as the Overview model takes it: in flight, failed, or answered. */
const readOf = (v, at) => (v === null ? { state: 'loading' } : v === UNAVAILABLE ? { state: 'unreadable' } : { state: 'ready', value: v, at });

/**
 * D4800 (#4800, D4803) — the page is Security v2's shell: one header, seven
 * workspaces (`security/securityTabs.js`) at `?tab=`, and the three reads it
 * has always made. The reads live HERE, once, so moving between workspaces
 * never re-reads and every workspace sees the same answer. The view below
 * (`SecurityConsole`) takes them as props so a test can render any workspace
 * with a payload.
 */
export default function HqSecurityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromSearch(searchParams.get('tab'));
  const onTab = useCallback((key) => {
    setSearchParams((cur) => {
      const next = new URLSearchParams(cur);
      next.set('tab', key);
      return next;
    });
  }, [setSearchParams]);

  // When each read answered, in the browser — the "Observed" time. The
  // platform records no per-store collection time (#4800 question C).
  const [readAt, setReadAt] = useState({ overview: null, feed: null });
  const stampRead = (k) => setReadAt((cur) => ({ ...cur, [k]: new Date().toISOString() }));

  const [data, setData] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqSecurityOverview().then((r) => { setData(r); stampRead('overview'); }, (e) => { reportError('hq-security', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // D481 — the Sessions zone's list, its own request: it is a page of rows the
  // zone acts on, and an unreadable list must cost that zone alone.
  const [sessionList, setSessionList] = useState(null);
  const loadSessions = useCallback(() => {
    setSessionList(null);
    api.hqSecuritySessions().then(setSessionList, (e) => { reportError('hq-sessions', e); setSessionList(UNAVAILABLE); });
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);
  // D4801 — the act alone; NOTHING IS RE-READ BEHIND IT. The workspace marks
  // what the server confirmed (a revoked row reads Revoked, in the dialog's
  // word) and offers Re-read. Re-reading on its own would also be wrong after
  // the two acts that sign the operator out: the next request answers 401 and
  // the page leaves for /login before the result could be read.
  const onSessionAct = useCallback((kind, arg, reason) => runSessionAct(api, kind, arg, reason), []);

  // H23's ledger, its own request. The filter is applied SERVER-side because
  // the feed is a merged page of sixty rows across five stores: filtering
  // that page in the browser would show whichever few of the sixty matched
  // and read as "that is all there is".
  const [feed, setFeed] = useState(null);
  const [filter, setFilter] = useState('all');
  // D4803 — the Events workspace's filters, sent with the category. The same
  // request feeds Overview's source count, which says which filter it counted under.
  const [controls, setControls] = useState(EMPTY_CONTROLS);
  const query = JSON.stringify(feedQuery(controls));
  const loadFeed = useCallback(() => {
    setFeed(null);
    api.hqGovernance(filter, JSON.parse(query)).then(
      (r) => { setFeed(r); stampRead('feed'); },
      (e) => { reportError('hq-governance', e); setFeed(UNAVAILABLE); },
    );
  }, [filter, query]);
  const loadOlder = useCallback((before) => api.hqGovernance(filter, { ...JSON.parse(query), before }), [filter, query]);
  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  return (
    <SecurityConsole
      tab={tab}
      onTab={onTab}
      data={data}
      load={load}
      feed={feed}
      filter={filter}
      setFilter={setFilter}
      controls={controls}
      setControls={setControls}
      loadOlder={loadOlder}
      loadFeed={loadFeed}
      sessionList={sessionList}
      loadSessions={loadSessions}
      onSessionAct={onSessionAct}
      readAt={readAt}
    />
  );
}

export function SecurityConsole({
  tab = 'overview', onTab = () => {}, data, load, feed, filter, setFilter, loadFeed, sessionList, loadSessions, onSessionAct, readAt = {},
  controls = EMPTY_CONTROLS, setControls = () => {}, loadOlder = () => Promise.reject(new Error('no cursor reader')),
}) {
  const feedReady = feed && feed !== UNAVAILABLE;
  const access = feedReady ? feed.data_access : null;

  const ready = data && data !== UNAVAILABLE;
  const imp = ready ? data.impersonations : null;
  const sessions = ready ? data.sessions : null;
  // D4691 — each of these is its own read: `available: false` is drawn as
  // unreadable in its own tile, never as a zero or an empty list.
  const mfa = ready && data.mfa?.available !== false ? data.mfa : null;
  const kycReadable = ready && data.kyc_available !== false && data.kyc;
  const kyc = kycReadable ? data.kyc : {};
  const dsrReadable = ready && data.dsr?.available !== false;
  const dsr = ready ? data.dsr?.rows || [] : [];
  const dsrGroups = ready ? data.dsr?.by_branch || [] : [];
  const dsrBranches = ready ? data.dsr?.branches : null;
  const dsrDue = dsr.filter((d) => d.days_left !== null && d.days_left <= 14).length;
  const withoutMfa = mfa ? mfa.admins_total - mfa.admins_with_mfa : null;
  // D200 — the ledger's own block: rows today and refused sign-ins, or the
  // reason neither could be read. `se.available === false` is a state the
  // bar and the Sessions tile each render as such, never as a zero.
  const se = ready ? data.security_events : null;
  // D152 — the rail's AI-safety row, built from the SERVER's list rather than
  // retyped, but kept to ONE literal pair. Spreading the mapped rows straight
  // into `unavailable` was the first shape and it was wrong: two guards read
  // that array line by line to prove every entry is a `[title, detail]` pair —
  // WorkerRail destructures each one, so a bare string renders as its first
  // two characters — and a spread hides the row shape from exactly the check
  // that exists to see it. The gaps' full reasons are in the zone; the rail
  // names them.
  const aiGaps = ready ? (data.ai_safety?.not_counted || []).map((n) => n.what) : [];
  // Computed here rather than inline, because the rail's `unavailable` entries
  // are ONE PER LINE by convention and two guards read that array line by
  // line — a wrapped pair is still a pair, and still invisible to them.
  const aiSafetyDetail = !ready ? 'unreadable'
    : (aiGaps.length
      ? `Guardrail verdicts and enforcement ARE counted — the zone above reads them. Not counted: ${aiGaps.join(' · ')}, each with its reason there.`
      : 'Counted, with nothing named as still missing.');
  // D200 — the same shape for the ledger: what it deliberately does not
  // record comes from the server's list, and the rail names it in one pair.
  const seGaps = ready ? (se?.not_counted || []).map((n) => n.what) : [];
  const securityGapsDetail = !ready ? 'unreadable'
    : (seGaps.length
      ? `Refusals and step-ups ARE recorded — the ledger above reads them. Not recorded: ${seGaps.join(' · ')}, each with its reason there.`
      : 'Recorded, with nothing named as still missing.');
  const sanctionsDetail = !ready ? 'unreadable'
    : (data.sanctions?.available
      ? `Read from sanctions_screenings — ${num(data.sanctions.runs_total)} run${data.sanctions.runs_total === 1 ? '' : 's'} recorded. Runs happen on request from the Trust Center; nothing schedules one.`
      : (data.sanctions?.reason || 'unreadable'));
  const backupDetail = !ready ? 'unreadable' : backupSentence(data.backup_dr?.backup);
  const drillDetail = !ready ? 'unreadable' : drillSentence(data.backup_dr?.drill);

  const rail = (
    <WorkerRail
      workspace="Security"
      role="super_admin"
      stance="Read-only, except sessions and force re-auth"
      note="The security ledger, the admin action log, sessions, KYC, deletion clocks, the sanctions runs and the backup heartbeat are read from their stores. The acts here revoke sessions, sign accounts out and close data-subject requests, and each is recorded with its reason."
      coverage={ready ? [
        se?.available ? `${num(se.today)} security event${se.today === 1 ? '' : 's'} recorded today` : 'Security events: unreadable',
        data.audit?.available === false ? 'Admin actions: unreadable' : `${num(data.audit?.total) ?? 'an unrecorded number of'} admin actions on record`,
        imp?.available ? `${num(imp.active)} impersonation${imp.active === 1 ? '' : 's'} live` : 'Impersonations: unreadable',
        dsrReadable ? `${num(dsr.length)} deletion request${dsr.length === 1 ? '' : 's'} open` : 'Deletion requests: unreadable',
      ] : []}
      coverageNote={ready ? undefined : (data === UNAVAILABLE ? 'The security overview could not be read.' : 'Loading…')}
      unavailable={[
        // [title, detail] pairs: WorkerRail destructures each entry, so a bare
        // string would render as its first two characters.
        // D200 — THE ROW THAT SAID "No security_events ledger exists yet." IS
        // GONE, because the ledger exists (migration 282). What replaces it is
        // named by the SERVER: the events the ledger deliberately does not
        // count, each with its reason in the zone.
        ['Security events not counted', securityGapsDetail],
        // D152 — THIS ROW SAID "Nothing aggregates guardrail verdicts" AND IT
        // WAS FALSE. Something did: `aiRouter.loadAiUsageReport` had rolled
        // them up all along and `AiUsageTab` rendered them. Correcting it is
        // the sixth time this programme has had to re-aim a rail row the day
        // its refusal stopped being true, and what it says now is named by the
        // SERVER rather than retyped here, so the zone and the rail cannot
        // disagree about what is missing.
        ['AI safety counters', aiSafetyDetail],
        // D200 — "Not run on the platform." was FALSE: screenUser has written
        // sanctions_screenings since migration 035. The row now says what the
        // store holds and how a run happens.
        ['Sanctions screening', sanctionsDetail],
        // D200 — one absence became two facts. The backup half reads the
        // export's heartbeat. D263 — the drill half reads the drill's own
        // marker, in the same sentence the zone draws.
        ['Backup heartbeat', backupDetail],
        ['Restore drill', drillDetail],
        ['Per-tenant anything', 'No account names its licence yet (U1) — except a licence event, which is about one, and a security event, which names the deployment that recorded it.'],
        // D153 — THIS ROW IS GONE, not reworded: the overlay is built, so a
        // rail row saying it is not would be the stale-refusal defect this
        // programme keeps deleting. What the overlay does NOT cover is this
        // page, and that is a fact about scope rather than about a gap:
        // governance is HQ's own record of HQ's own acts.
        ['The security ledger under the overlay', 'Out of scope. Viewing as a branch scopes Home and Team; this ledger is HQ\'s record of what happened at HQ\'s door and what HQ did, which no branch holds.'],
      ]}
      data-testid="hq-security-rail"
    />
  );

  // D4800 — the Overview workspace's findings, clear row, areas and sources,
  // from the two reads above and nothing else.
  const overviewModel = buildOverview({ overview: readOf(data, readAt.overview), feed: readOf(feed, readAt.feed) });
  const categoryLabel = feedReady && feed.filter && feed.filter !== 'all'
    ? (feed.filters || GOV_FILTERS).find((f) => f.key === feed.filter)?.label || feed.filter
    : null;
  // D4803 — a search or date filter narrows the same read, and the count says so.
  const narrowedBy = feedReady ? activeCount(feed.applied) : 0;
  const filterLabel = categoryLabel && narrowedBy
    ? `${categoryLabel} and ${narrowedBy} more`
    : categoryLabel || (narrowedBy ? `${narrowedBy}-filter` : null);
  const refreshAll = () => { load(); loadFeed(); loadSessions(); };
  const observed = clockOf(readAt.overview);
  const here = tabOf(tab);

  // The implementation notes that used to open the page. They are true and
  // they stay, behind "Source details" (#4800: out of the primary reading path).
  const sourceNotes = (
    <>
      <p>
        Was Governance, which described the audit log and nothing else. The ledger here is H23&apos;s: five
        stores — the security_events ledger of refusals and step-ups, the admin action log, the activity log,
        impersonation sessions and licence events — merged newest-first into one monospace feed. Sanctions and
        backup read their own stores; the restore drill reads the marker each run writes. Only a licence
        event names a subsidiary and only a security event names its deployment — nothing else here is
        scoped per subsidiary yet, the guardrail counters included.
      </p>
      <p>
        Freshness is the time this browser received each read. No store records when it was last collected,
        so no source here can be marked Stale yet.
      </p>
    </>
  );

  /**
   * D4800 — THE WORKSPACES, keyed by `securityTabs.js`. Overview is Security
   * v2's; the other six hold today's zones for their area, moved here intact
   * so nothing the page did before has gone. #4801 to #4803 replace an entry
   * (Access first) rather than adding a second switch.
   */
  const workspaces = {
    overview: (
      <OverviewWorkspace
        model={overviewModel}
        onRetry={{ overview: load, feed: loadFeed }}
        filterLabel={filterLabel}
        sourceNotes={sourceNotes}
      />
    ),
    events: (
      <EventsWorkspace
        feed={feed}
        unavailable={UNAVAILABLE}
        filter={filter}
        setFilter={setFilter}
        controls={controls}
        setControls={setControls}
        onRetry={loadFeed}
        loadOlder={loadOlder}
        se={se}
        categories={GOV_FILTERS}
      />
    ),
    access: (
      <>
        <Zone title="Sessions and access" sub="each act recorded with its reason">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat unread label="Active sessions" value={sessions?.available ? num(sessions.active) : null} note={sessions?.available ? `token under ${sessions.token_hours}h old, not revoked or signed out` : (sessions?.reason || 'unreadable')} />
            <Stat unread label="Live support sessions" value={imp?.available ? num(imp.active) : null} note={imp?.available ? impersonationNote(imp) : (imp?.reason || 'unreadable')} tone={imp?.available && imp.active ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'} />
            <Stat unread label="Admins with MFA" value={mfa ? `${num(mfa.admins_with_mfa)} of ${num(mfa.admins_total)}` : null} note={withoutMfa === null ? 'unreadable' : withoutMfa > 0 ? `${num(withoutMfa)} without` : 'every admin enrolled'} tone={withoutMfa ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
            {/* D200 — this tile was `value={null}` under "no security_events".
                It reads the ledger now: refused sign-ins in the last 24
                hours, and its reason when the ledger could not be read. */}
            <Stat unread label="Failed sign-ins" value={se?.available ? num(se.failed_signins_24h) : null} note={se?.available ? 'refused in 24 hours, from security_events' : (se?.reason || 'unreadable')} tone={se?.available && se.failed_signins_24h ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
            Each account can also revoke its own devices under Settings.
          </p>
        </Zone>
        <AccessWorkspace list={sessionList} unavailable={UNAVAILABLE} onAct={onSessionAct} onRetry={loadSessions} onRefresh={refreshAll} />


        {/* H7's own zone. Not "what changed" — who read rows they do not
            own. The two halves are separate blocks so one unreadable store
            cannot make the other half look like the whole answer. */}
        <Zone title="Data access" sub="impersonations and exports">
          {feed === UNAVAILABLE && (
            <Unreadable
              what="The security ledger"
              claim="This is not a claim that nothing happened."
              onRetry={loadFeed}
            />
          )}
          {feed === null && <p className="text-[12px] text-axal-faint">Loading…</p>}
          {access && (
            <div className="grid gap-3 md:grid-cols-2" data-testid="hq-data-access">
              <div>
                <div className="text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-faint">
                  Impersonations · {access.expiry_minutes}-minute limit
                </div>
                {access.impersonations.available ? (
                  access.impersonations.items.length === 0
                    ? <p className="mt-1.5 text-[12px] text-axal-faint">No support session is on record.</p>
                    : (
                      <ul className="mt-1.5 space-y-1.5">
                        {access.impersonations.items.map((d) => (
                          <li
                            key={d.what + d.meta}
                            className={`rounded-lg border px-3 py-2 text-[11.5px] ${
                              d.live
                                ? 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'
                                : 'border-axal-hairline bg-axal-ground'
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate font-semibold">{d.what}</span>
                              <span className={`shrink-0 font-mono text-[10px] ${d.overdue ? 'text-red-700 dark:text-red-300' : 'text-axal-faint'}`}>
                                {d.dur || <Unrecorded>clock unknown</Unrecorded>}
                              </span>
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] text-axal-faint">{d.meta}</div>
                          </li>
                        ))}
                      </ul>
                    )
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-axal-muted"><Unrecorded /> — {access.impersonations.reason}</p>
                )}
              </div>
              <div>
                <div className="text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-faint">Exports</div>
                {access.exports.available ? (
                  access.exports.items.length === 0
                    ? <p className="mt-1.5 text-[12px] text-axal-faint">No export is on record.</p>
                    : (
                      <ul className="mt-1.5 space-y-1.5">
                        {access.exports.items.map((d) => (
                          <li key={d.what + d.meta} className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[11.5px]">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate font-semibold">{d.what}</span>
                              <span className="shrink-0 font-mono text-[10px] text-axal-faint">{d.dur}</span>
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] text-axal-faint">{d.meta}</div>
                          </li>
                        ))}
                      </ul>
                    )
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-axal-muted"><Unrecorded /> — {access.exports.reason}</p>
                )}
              </div>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">
            A session that ran to its limit is recorded exactly like one ended early — the log does not
            distinguish diligence from the clock running out, and it should not. A row still open past the
            limit reads <b>not closed</b>: the token expired on time, the closing write is best-effort, and
            &ldquo;0m left&rdquo; would say somebody is still inside.
          </p>
        </Zone>
      </>
    ),
    privacy: (
      <>
        <Zone title="Data subject requests" sub={`${ready ? data.dsr?.clock_days : 30}-day clock from receipt · by territory`} tone="border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20">
          {/* D200 — H23 draws the DSR clocks "by territory · runs against the
              holding branch". Every request this database holds is HQ-held
              by construction, so the grouping has one group and the sentence
              below says why there is not a second, from the server. */}
          {ready && dsrGroups.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-axal-muted" data-testid="hq-dsr-groups">
              {dsrGroups.map((g) => (
                <span key={g.branch} className="font-mono">{g.branch} · {num(g.open)} open</span>
              ))}
            </div>
          )}
          {ready && !dsrReadable && (
            <div data-testid="hq-dsr-unreadable">
              <Unreadable what="The open deletion requests" claim="This is not a claim that none are open." />
            </div>
          )}
          {ready && dsrReadable && dsr.length === 0 && <p className="text-[12px] text-axal-faint">No deletion request is open.</p>}
          {ready && dsr.length > 0 && (
            <ul className="space-y-1.5" data-testid="hq-dsr">
              {dsr.map((d) => (
                <li key={d.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12px] dark:border-amber-900 dark:bg-gray-900">
                  <div className="flex items-center justify-between gap-3">
                    <DsrSubject row={d} />
                    <span title={d.deadline_at ? `The clock runs out ${String(d.deadline_at).slice(0, 16).replace('T', ' ')} UTC: ${data.dsr?.clock_days} × 24 hours from receipt.` : undefined} className={`shrink-0 font-bold tabular-nums ${d.days_left === null ? 'text-axal-faint' : d.days_left < 0 ? 'text-red-700 dark:text-red-300' : d.days_left <= 14 ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-white'}`}>
                      {d.days_left === null ? <Unrecorded>clock unknown</Unrecorded> : d.days_left < 0 ? `${num(-d.days_left)}d overdue` : `${num(d.days_left)}d left`}
                    </span>
                  </div>
                  {/* D168 — HAS THIS SUBJECT ASKED BEFORE? `prior_requests` is
                      null, never 0, when the ledger could not be read: "never
                      asked before" is a claim, and an unreadable store has not
                      made it. A third ask read as a first is the thing this
                      line exists to prevent. */}
                  {d.prior_requests === null ? (
                    <p className="mt-0.5 text-[11px] text-axal-faint" data-testid="hq-dsr-history-unreadable">
                      <Unrecorded>earlier requests unknown</Unrecorded>
                    </p>
                  ) : d.prior_requests > 0 ? (
                    <p className="mt-0.5 text-[11px] text-axal-faint" data-testid="hq-dsr-history">
                      {num(d.prior_requests)} earlier request{d.prior_requests === 1 ? '' : 's'}
                      {d.last_outcome ? ` · last ${d.last_outcome}` : ''}
                      {d.last_outcome_at ? ` on ${String(d.last_outcome_at).slice(0, 10)}` : ''}
                    </p>
                  ) : null}
                  <DsrClose row={d} onDone={load} />
                </li>
              ))}
            </ul>
          )}
          {!ready && data !== UNAVAILABLE && <p className="text-[12px] text-axal-faint">Loading…</p>}
          {/* D481 — the zone printed "erasure" as a literal on every row.
              The kinds the ledger does NOT hold are named here, from the
              payload, each Not recorded with its reason. */}
          {ready && <DsrKindsNotRecorded kinds={data.dsr?.kinds} />}
          {ready && dsrBranches && (
            <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-dsr-branches">
              {dsrBranchesSentence(dsrBranches)}
            </p>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
            The clock is statutory — one month from receipt, not from triage. Requests come from each account&apos;s own
            Settings; <b>erasure itself is still a manual act</b>, and closing a request here records that act rather
            than performing one. A withdrawal is the subject&apos;s own and is recorded when they cancel.
          </p>
        </Zone>

      </>
    ),
    trust: (
      <div className="grid gap-4 md:grid-cols-2">
        <Zone title="Sanctions review" sub="from the store's own runs">
          <Sanctions block={ready ? data.sanctions : null} unreadable={data === UNAVAILABLE} />
        </Zone>
        <Zone title="KYC" sub="the review queue">
          {ready && !kycReadable && (
            <div className="mb-2" data-testid="hq-kyc-unreadable">
              <Unreadable what="The KYC queue" claim="This is not a claim that the queue is empty." />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="KYC pending" value={kycReadable ? num(kyc.pending) ?? '0' : null} note="documents submitted, unverified" tone={kyc.pending ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
            <Stat label="KYC approved" value={kycReadable ? num(kyc.approved) ?? '0' : null} note="active accounts" />
            <Stat label="KYC rejected" value={kycReadable ? num(kyc.rejected) ?? '0' : null} note="active accounts" />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
            KYC status is one trust fact; sanctions screening is another and has its own card above, because the
            two are different stores that fail apart.
          </p>
          {ready && <NotRecordedList items={data.kyc_not_recorded} testid="hq-kyc-not-recorded" />}
        </Zone>
      </div>
    ),
    // D4803 slice 2: SE08 leads; the previous zone stays whole behind "How this is measured".
    'ai-safety': (
      <AiSafetyWorkspace block={ready ? data.ai_safety : null} unreadable={data === UNAVAILABLE} onRetry={load}>
        <Zone title="AI safety" sub="guardrail hits · Advisor-AI outputs the screen caught">
          <AiSafety block={ready ? data.ai_safety : null} />
        </Zone>
      </AiSafetyWorkspace>
    ),
    // D4803 slice 2: SE09 leads; the previous zone stays whole behind "How this is measured".
    resilience: (
      <ResilienceWorkspace block={ready ? data.backup_dr : null} unreadable={data === UNAVAILABLE} onRetry={load}>
        <Zone title="Backup / DR drill" sub="two facts, each its own state">
          <BackupDr block={ready ? data.backup_dr : null} unreadable={data === UNAVAILABLE} />
          {ready && <NotRecordedList items={data.backup_dr?.not_recorded} testid="hq-dr-not-recorded" />}
        </Zone>
      </ResilienceWorkspace>
    ),
  };

  return (
    <RailFrame rail={rail} data-testid="hq-security-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#881337] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] opacity-80 tabular-nums">
            <span>{ready ? `${num(dsrDue)} deletion request${dsrDue === 1 ? '' : 's'} inside deadline pressure` : '…'}</span>
            {/* H23's bar: `security_events · append-only · N rows today`. An
                unreadable ledger says so here, in the same slot, never `0`. */}
            <span className="font-mono" data-testid="hq-security-events-bar">
              {securityEventsBar(ready, se, data === UNAVAILABLE)}
            </span>
          </span>
        </div>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
              <ShieldCheck size={13} /> HQ · Security
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">
              {tab === 'overview' ? 'Security' : here.label}
            </h1>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted" data-testid="security-workspace-sub">{here.sub}</p>
            <p className="mt-1 text-[12.5px]">
              <Link to="/admin/security/obligations" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Trust obligations by role</Link>
              {' · '}
              {/* D1079 (#2971): TRU14, the public trust center's content. */}
              <Link to="/admin/security/trust-center" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="security-trust-content-link">Trust center content</Link>
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <HeaderAsk />
            {/* SE01's freshness and scope line: when the overview was read,
                Refresh, and the scope every figure here is drawn from. */}
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-axal-muted" data-testid="security-observed">
              <span aria-live="polite">{observed ? <>Observed <b>{observed}</b></> : (data === UNAVAILABLE ? 'Not read' : 'Reading…')}</span>
              <button type="button" onClick={refreshAll} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Refresh</button>
              <span className="rounded-md border border-axal-hairline px-1.5 py-0.5 text-[10.5px] font-semibold dark:border-gray-700" title="Scope">HQ-held accounts</span>
            </div>
            <SourceAvailability sources={overviewModel.sources} onRetry={loadFeed} filterLabel={filterLabel} compact data-testid="security-header-sources" />
          </div>
        </header>

        <SecurityTabs current={tab} onSelect={onTab} marks={overviewModel.marks} />

        {data === UNAVAILABLE && !OWN_UNREADABLE.has(tab) && <div className="mt-4"><Unreadable what="The security overview" claim="This is not a claim that nothing happened." onRetry={load} /></div>}

        <div className="mt-4 space-y-4" data-testid={`security-ws-${tab}`}>
          {workspaces[tab] || workspaces.overview}
        </div>
      </div>

    </RailFrame>
  );
}
