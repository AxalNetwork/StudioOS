import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

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
const UNAVAILABLE = Symbol('unavailable');

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

/**
 * The artboard's one piece of decoration: "Rows involving impersonation or a
 * licence suspension carry a tint — the only decoration on the page, and it
 * is there to be scanned for." Three tones, and `note` is deliberately no
 * tint at all rather than a fourth colour. A refused sign-in is `alert` too.
 */
const ROW_TINT = {
  alert: 'bg-red-50/40 dark:bg-red-950/20',
  warn: 'bg-amber-50/40 dark:bg-amber-950/20',
  note: '',
};
const ACTION_INK = {
  alert: 'text-red-700 dark:text-red-300',
  warn: 'text-amber-800 dark:text-amber-300',
  note: 'text-axal-ink dark:text-white',
};
/**
 * H23's fifth column. `refused` and `not closed` are the two that want
 * finding; `live` is a state worth a second look; `ok` and `ended` are the
 * quiet majority.
 */
const OUTCOME_INK = {
  refused: 'text-red-700 dark:text-red-300',
  'not closed': 'text-red-700 dark:text-red-300',
  live: 'text-amber-800 dark:text-amber-300',
  ok: 'text-axal-muted',
  ended: 'text-axal-muted',
};

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
function AiSafety({ block }) {
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
          note={v?.available ? `llama-guard calls ${windowNote}` : (v?.reason || 'unreadable')}
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
      {e?.available && (
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
      ? <p className="text-[12.5px] text-axal-muted"><Unrecorded /> — the security overview could not be read.</p>
      : <p className="text-[12px] text-axal-faint">Loading…</p>;
  }
  if (!block.available) {
    return (
      <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-sanctions-unreadable">
        <Unrecorded /> — {block.reason}
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
  if (!drill || drill.state === 'unreadable' || drill.available === false) {
    return `Unreadable — ${drill?.reason || 'the drill marker could not be read.'}`;
  }
  if (drill.state === 'never_run') return `Never run — ${drill.reason}`;
  const when = day(drill.at) || 'an unstamped date';
  if (drill.state === 'last_run_failed') {
    const exit = drill.exit_code === null || drill.exit_code === undefined ? 'no exit code recorded' : `exit ${drill.exit_code}`;
    return `Last run failed on ${when}, at step ${drill.step || 'not recorded'} (${exit}).`;
  }
  if (drill.state === 'last_run_passed') {
    return `Last run passed on ${when}, restoring ${drill.backup_key || 'a backup it did not name'}.`;
  }
  return `Unreadable — the drill marker is in a state this page does not know (${String(drill.state)}).`;
}

function DrillState({ drill }) {
  const failed = drill?.state === 'last_run_failed';
  const passed = drill?.state === 'last_run_passed';
  const tone = failed ? 'text-red-700 dark:text-red-300' : passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-muted';
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
      ? <p className="text-[12.5px] text-axal-muted"><Unrecorded /> — the security overview could not be read.</p>
      : <p className="text-[12px] text-axal-faint">Loading…</p>;
  }
  const b = block.backup;
  return (
    <div className="space-y-2" data-testid="hq-backup-dr">
      <div>
        <div className="text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-faint">Nightly export</div>
        {b?.available ? (
          <p className="mt-0.5 text-[12px] text-axal-muted" data-testid="hq-backup-heartbeat">
            Last {b.kind === 'd1' ? 'D1' : 'KV'} export <b className="font-mono">{day(b.at) || <Unrecorded>unstamped</Unrecorded>}</b>
            {b.source ? ` · ${b.source}` : ''}
            {b.size_bytes !== null && b.size_bytes !== undefined ? ` · ${num(b.size_bytes)} bytes` : ''}
          </p>
        ) : (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-backup-unreadable">
            <Unrecorded /> — {b?.reason || 'the heartbeat could not be read.'}
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

function ForceReauth({ onDone }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.hqSecurityForceReauth(reason.trim());
      setDone(res);
      onDone?.();
    } catch (err) {
      const msg = String(err?.message || err || 'Request failed');
      setError(msg === 'TOTP required'
        ? 'This needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.'
        : msg);
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        {done.message} {num(done.affected) !== null ? `${num(done.affected)} accounts affected.` : ''}{' '}
        <a href="/login" className="underline">Sign in again →</a>
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2" data-testid="hq-force-reauth">
      <label className="block text-[11px] font-semibold text-axal-muted">
        Reason · required, stored with the action
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. credential stuffing observed against three admin accounts"
          className="mt-1 w-full rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-normal text-axal-ink dark:bg-gray-900"
        />
      </label>
      <label className="flex items-start gap-2 text-[11.5px] text-axal-muted">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        <span>I understand this signs out every active account on every tenant, including my own session.</span>
      </label>
      {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={busy || !ack || reason.trim().length < 8}
        className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-red-700 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} Force re-auth · all tenants
      </button>
    </form>
  );
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
function DsrClose({ row, onDone }) {
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.hqCloseDsrRequest(row.id, outcome, reason.trim());
      onDone?.();
    } catch (err) {
      const msg = String(err?.message || err || 'Request failed');
      setError(msg === 'TOTP required'
        ? 'This needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.'
        : msg);
    } finally {
      setBusy(false);
    }
  };
  if (!outcome) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="hq-dsr-actions">
        <button
          type="button"
          onClick={() => setOutcome('fulfilled')}
          className="rounded-md border border-axal-hairline bg-white px-2 py-1 text-[11px] font-semibold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          Record as fulfilled
        </button>
        <button
          type="button"
          onClick={() => setOutcome('denied')}
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
      {error && <p role="alert" className="text-[11.5px] text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={busy || reason.trim().length < 8}
          className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-amber-700 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500 dark:bg-gray-900 dark:text-amber-300 dark:hover:bg-amber-950/30"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null} Close as {outcome}
        </button>
        <button
          type="button"
          onClick={() => { setOutcome(''); setError(null); }}
          className="rounded-md px-2 py-1 text-[11px] font-semibold text-axal-faint hover:text-axal-ink dark:hover:text-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function HqSecurityPage() {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqSecurityOverview().then(setData, (e) => { reportError('hq-security', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // H23's ledger, its own request. The filter is applied SERVER-side because
  // the feed is a merged page of sixty rows across five stores: filtering
  // that page in the browser would show whichever few of the sixty matched
  // and read as "that is all there is".
  const [feed, setFeed] = useState(null);
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    let live = true;
    setFeed(null);
    api.hqGovernance(filter).then(
      (r) => { if (live) setFeed(r); },
      (e) => { reportError('hq-governance', e); if (live) setFeed(UNAVAILABLE); },
    );
    return () => { live = false; };
  }, [filter]);
  const feedReady = feed && feed !== UNAVAILABLE;
  const access = feedReady ? feed.data_access : null;

  const ready = data && data !== UNAVAILABLE;
  const imp = ready ? data.impersonations : null;
  const sessions = ready ? data.sessions : null;
  const mfa = ready ? data.mfa : null;
  const kyc = ready ? data.kyc || {} : {};
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
  const backupDetail = !ready ? 'unreadable'
    : (data.backup_dr?.backup?.available
      ? `Read from the export heartbeat — last ${day(data.backup_dr.backup.at) || 'unstamped'}.`
      : (data.backup_dr?.backup?.reason || 'unreadable'));
  const drillDetail = !ready ? 'unreadable' : drillSentence(data.backup_dr?.drill);

  const rail = (
    <WorkerRail
      workspace="Security"
      role="super_admin"
      stance="Read-only, except force re-auth"
      note="The security ledger, the admin action log, sessions, KYC, deletion clocks, the sanctions runs and the backup heartbeat are read from their stores. The one action here signs everyone out and is recorded."
      coverage={ready ? [
        se?.available ? `${num(se.today)} security event${se.today === 1 ? '' : 's'} recorded today` : 'Security events: unreadable',
        `${num(data.audit?.total) ?? 'an unrecorded number of'} admin actions on record`,
        imp?.available ? `${num(imp.active)} impersonation${imp.active === 1 ? '' : 's'} live` : 'Impersonations: unreadable',
        `${num(dsr.length)} deletion request${dsr.length === 1 ? '' : 's'} open`,
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

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-security-page">
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

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <ShieldCheck size={13} /> HQ · Security
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Security</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Was Governance, which described the audit log and nothing else. The ledger here is H23&apos;s: five
            stores — the security_events ledger of refusals and step-ups, the admin action log, the activity log,
            impersonation sessions and licence events — merged newest-first into one monospace feed. Sanctions and
            backup read their own stores; the restore drill reads the marker each run writes. Only a licence
            event names a subsidiary and only a security event names its deployment — nothing else here is
            scoped per subsidiary yet, the guardrail counters included.
          </p>
        </header>

        {data === UNAVAILABLE && <div className="mt-4"><Unreadable what="The security overview" claim="This is not a claim that nothing happened." onRetry={load} /></div>}

        <div className="mt-4 space-y-4">
          {/* Canvas H23's ledger. ts · actor · branch · event · outcome, one
              filter bar, monospace on every cell, and NO tile above it — H7's
              rule, which H23 restates: a summary tile over an audit log is a
              dashboard, and legibility is not the property you want from a
              log. */}
          <Zone
            title="Security events"
            sub={feedReady
              ? `${feed.rows.length} newest${feed.more ? ' of more' : ''} · ${feed.sources.filter((x) => x.available).length} of ${feed.sources.length} stores read`
              : 'five stores, one ledger · append-only'}
          >
            <div className="flex flex-wrap items-center gap-2" data-testid="hq-gov-filters">
              {(feedReady ? feed.filters : GOV_FILTERS).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  title={f.reads ? `reads ${f.reads}` : undefined}
                  className={`rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold ${
                    filter === f.key
                      ? 'border-rose-200 bg-rose-50 text-[#881337] dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
                      : 'border-axal-hairline bg-white text-axal-muted hover:bg-axal-ground dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {feed === UNAVAILABLE && (
              <div className="mt-3">
                <Unreadable
                  what="The security ledger"
                  claim="This is not a claim that nobody did anything."
                  onRetry={() => setFilter((f) => f)}
                />
              </div>
            )}
            {feed === null && <p className="mt-3 text-[12px] text-axal-faint">Loading…</p>}

            {feedReady && feed.rows.length === 0 && (
              <p className="mt-3 text-[12px] text-axal-faint" data-testid="hq-gov-empty">
                No event matches this filter. Every store below was read and none held a row —
                which is a different fact from a store that could not be read.
              </p>
            )}

            {feedReady && feed.rows.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full font-mono text-[11px]" data-testid="hq-gov-feed">
                  <thead>
                    <tr className="text-left text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-faint">
                      <th className="py-1 pr-3">ts</th>
                      <th className="py-1 pr-3">actor</th>
                      <th className="py-1 pr-3">branch</th>
                      <th className="py-1 pr-3">event</th>
                      <th className="py-1">outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feed.rows.map((r) => (
                      <tr key={r.key} className={`border-t border-axal-hairline align-top ${ROW_TINT[r.tone] || ''}`}>
                        <td className="py-1.5 pr-3 font-mono text-[10.5px] text-axal-faint">
                          {day(r.at) || <Unrecorded>no timestamp</Unrecorded>}
                        </td>
                        <td className="py-1.5 pr-3 font-mono font-semibold">{r.actor || <Unrecorded>unnamed</Unrecorded>}</td>
                        <td className="py-1.5 pr-3 font-mono text-axal-muted">{r.tenant || <Unrecorded />}</td>
                        <td className={`py-1.5 pr-3 font-mono font-bold ${ACTION_INK[r.tone] || ACTION_INK.note}`}>
                          {r.action}
                          {r.target ? <span className="ml-2 font-normal text-axal-muted">{r.target}</span> : null}
                        </td>
                        <td className={`py-1.5 font-mono font-semibold ${OUTCOME_INK[r.outcome] || 'text-axal-muted'}`}>
                          {r.outcome || <Unrecorded />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {feedReady && (
              <>
                <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-gov-tenant-reason">
                  <b>Branch.</b> {feed.tenant_reason}
                </p>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-axal-faint" data-testid="hq-gov-sources">
                  {feed.sources.map((src) => (
                    <li key={src.table} className={src.available ? 'font-mono' : 'font-mono text-red-700 dark:text-red-300'}>
                      {src.table} ·{' '}
                      {src.available ? `${num(src.rows)} read` : (src.reason || 'unreadable')}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
                  Newest first, no pagination above the fold, and no summary tile over it: the first question of
                  an audit log is what just happened, never page four, and a count of refusals is a dashboard
                  where the refusals themselves are the record. Refused sign-ins, impersonations and suspensions
                  carry a tint — the only decoration here, and it is there to be scanned for. A refusal is one row
                  per minute per email address and network, carrying the first reason in that minute: the ledger records
                  that someone was refused, not how many times. Whether an HQ act landed on its branch is on
                  Platform → Deployments, which reads the audit mirror.
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-gov-tenant-view">
                  <b>Viewing as a branch.</b> {feed.tenant_view_reason}
                </p>
              </>
            )}
            {(se?.not_counted || []).length > 0 && (
              <ul className="mt-3 space-y-1.5" data-testid="hq-security-events-not-counted">
                {se.not_counted.map((n) => (
                  <li key={n.what} className="text-[11px] leading-relaxed text-axal-faint">
                    <b className="text-axal-muted">{n.what}</b> — <Unrecorded />. {n.reason}
                  </li>
                ))}
              </ul>
            )}
            {se && !se.available && (
              <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-security-events-unreadable">
                The ledger&apos;s counts could not be read: {se.reason} The feed above still shows what the other
                stores hold; a security_events row absent from it is a store that answered nothing, not a quiet day.
              </p>
            )}
            {se?.available && (
              <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-security-events-retention">
                Kept for {se.retention_days} days, and the ledger&apos;s own seal refuses any delete inside that window.
              </p>
            )}
          </Zone>

          <div className="grid gap-4 md:grid-cols-3">
            <Zone title="Sanctions review" sub="from the store's own runs">
              <Sanctions block={ready ? data.sanctions : null} unreadable={data === UNAVAILABLE} />
            </Zone>
            <Zone title="Backup / DR drill" sub="two facts, each its own state">
              <BackupDr block={ready ? data.backup_dr : null} unreadable={data === UNAVAILABLE} />
            </Zone>
            <Zone title="Sessions and access" sub="Revoke is recorded">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Active sessions" value={sessions?.available ? num(sessions.active) : null} note={sessions?.available ? `seen in ${sessions.window_days} days, not revoked` : (sessions?.reason || 'unreadable')} />
                <Stat label="Impersonations live" value={imp?.available ? num(imp.active) : null} note={imp?.available ? 'no ended_at yet' : (imp?.reason || 'unreadable')} tone={imp?.available && imp.active ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'} />
                <Stat label="Admins with MFA" value={mfa ? `${num(mfa.admins_with_mfa)} of ${num(mfa.admins_total)}` : null} note={withoutMfa === null ? 'unreadable' : withoutMfa > 0 ? `${num(withoutMfa)} without` : 'every admin enrolled'} tone={withoutMfa ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
                {/* D200 — this tile was `value={null}` under "no security_events".
                    It reads the ledger now: refused sign-ins in the last 24
                    hours, and its reason when the ledger could not be read. */}
                <Stat label="Failed sign-ins" value={se?.available ? num(se.failed_signins_24h) : null} note={se?.available ? 'refused in 24 hours, from security_events' : (se?.reason || 'unreadable')} tone={se?.available && se.failed_signins_24h ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
              </div>
              {imp?.available && imp.recent.length > 0 && (
                <ul className="mt-3 space-y-1.5" data-testid="hq-impersonations">
                  {imp.recent.slice(0, 5).map((s) => (
                    <li key={s.id} className={`rounded-lg border px-3 py-2 text-[11.5px] ${s.ended_at ? 'border-axal-hairline bg-axal-ground' : 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'}`}>
                      <b>{s.admin_name || s.admin_email}</b> as <b>{s.target_name || s.target_email}</b>
                      <span className="ml-2 font-mono text-[10px] text-axal-faint">{day(s.started_at)}{s.ended_at ? ` → ${day(s.ended_at)}` : ' · live'}</span>
                      {s.context && <span className="ml-2 text-axal-faint">· {s.context}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <ForceReauth onDone={load} />
              <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
                An impersonation is a session like any other, which is why it sits here. Per-device revocation stays
                with each account under Settings; the platform-wide action above bumps every account&apos;s token floor.
              </p>
            </Zone>
          </div>

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
            {ready && dsr.length === 0 && <p className="text-[12px] text-axal-faint">No deletion request is open.</p>}
            {ready && dsr.length > 0 && (
              <ul className="space-y-1.5" data-testid="hq-dsr">
                {dsr.map((d) => (
                  <li key={d.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12px] dark:border-amber-900 dark:bg-gray-900">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate"><b>{d.name || d.email}</b> <span className="text-axal-faint">· {titleCase(d.role)} · erasure</span></span>
                      <span className={`shrink-0 font-bold tabular-nums ${d.days_left === null ? 'text-axal-faint' : d.days_left < 0 ? 'text-red-700 dark:text-red-300' : d.days_left <= 14 ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-white'}`}>
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

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="AI safety" sub="guardrail hits · Advisor-AI outputs the screen caught">
              <AiSafety block={ready ? data.ai_safety : null} />
            </Zone>
            <Zone title="KYC" sub="the review queue">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="KYC pending" value={ready ? num(kyc.pending) ?? '0' : null} note="documents submitted, unverified" tone={kyc.pending ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
                <Stat label="KYC approved" value={ready ? num(kyc.approved) ?? '0' : null} note="active accounts" />
                <Stat label="KYC rejected" value={ready ? num(kyc.rejected) ?? '0' : null} note="active accounts" />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
                KYC status is one trust fact; sanctions screening is another and has its own card above, because the
                two are different stores that fail apart.
              </p>
            </Zone>
          </div>

          {/* H7's own zone. Not "what changed" — who read rows they do not
              own. The two halves are separate blocks so one unreadable store
              cannot make the other half look like the whole answer. */}
          <Zone title="Data access" sub="impersonations and exports">
            {feed === UNAVAILABLE && (
              <p className="text-[12.5px] text-axal-muted">
                <Unrecorded /> — the security ledger could not be read, so neither half of this zone can be shown.
              </p>
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
        </div>
      </div>

      <div className="mt-6 lg:mt-0">{rail}</div>
    </div>
  );
}
