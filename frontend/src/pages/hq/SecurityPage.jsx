import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

/**
 * HQ · Security (Support Security · Super canvas, Y2; the row Governance
 * became under decision A4).
 *
 * Eight zones in the canvas's order, over `GET /api/admin/security/overview`.
 * Five are real — sessions and access (with the platform-wide force re-auth),
 * data subject requests, KYC, the admin action audit, and AI safety — and
 * three are named as not recorded in the zone the canvas draws for them:
 * security events, sanctions, backup and DR. The canvas calls the
 * `security_events` ledger "the one real backend build"; it is not built, and
 * this page says so where the feed would be rather than rendering the canvas's
 * sample rows.
 *
 * AI SAFETY MOVED FROM THE SECOND LIST TO THE FIRST IN D152, AND IT SHOULD
 * NEVER HAVE BEEN IN THE SECOND. The zone rendered "No guardrail-hit,
 * flagged-output or token-anomaly counter is stored" — a sentence that was
 * false on two of its three clauses about a rollup `AiUsageTab` was already
 * drawing one click away. It now reads real counters from two stores and keeps
 * a narrowed list of what they still cannot say (the D111 pattern).
 *
 * ABSENT IS NOT ZERO. `num` returns null for a missing figure, a failed
 * request is unreadable rather than a quiet platform, and each `available:
 * false` block carries its reason onto the screen.
 *
 * CANVAS H7 IS RECONCILED INTO THIS PAGE, NOT DRAWN BESIDE IT. H7 is the
 * older "Governance" artboard the A4 rename folded into Security, and most
 * of it is Y2's zones under other names. Three things were genuinely missing
 * and are here now:
 *
 *   The feed is a UNION, not one table. Y2's audit zone read
 *   `admin_audit_log` alone; three of H7's five filters have no rows in it.
 *   The feed now merges four stores server-side — see routes/admin_security.ts.
 *   TENANT is a real column for licence rows only, and unrecorded elsewhere
 *   because no account names its licence (U1).
 *   DATA ACCESS is H7's own zone: impersonations and exports together,
 *   because the question is not "what changed" but "who read someone else's
 *   rows".
 *
 * AND H7'S RULE FOR ITSELF IS KEPT: "no cards, no summary tiles, no chart —
 * an audit log that has been made attractive is an audit log someone has
 * edited for legibility." No tile sits above the feed. The tiles this page
 * does carry belong to Y2's own zones, which are not the log.
 *
 * WHAT H7 DRAWS AND THIS PAGE DOES NOT: the "Viewing as: Axal VC France ·
 * Return to HQ view" overlay. It is a tenant-scoped read-only view, and it is
 * UNBUILT rather than blocked — D150 corrected the reason, which used to cite
 * U1. U1 is about HQ's own rows; HQ has been able to read a branch since D108,
 * so what is missing is shell state that routes a page through one branch
 * (#235). The reason comes from the payload rather than from here so there is
 * one copy of it.
 */
const UNAVAILABLE = Symbol('unavailable');

const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);
// A number, formatted — or null when there is no number. Never a default.
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const titleCase = (s) => String(s || '').replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());

/**
 * H7's five filters, in its order — the fallback while the feed is still in
 * flight so the bar does not pop into existence. The server sends the same
 * list with what each one reads, and that copy wins once it arrives.
 */
const GOV_FILTERS = [
  { key: 'all', label: 'All actions' },
  { key: 'impersonations', label: 'Impersonations' },
  { key: 'licence_changes', label: 'Licence changes' },
  { key: 'suspensions', label: 'Suspensions' },
  { key: 'exports', label: 'Exports' },
];

/**
 * The artboard's one piece of decoration: "Rows involving impersonation or a
 * licence suspension carry a tint — the only decoration on the page, and it
 * is there to be scanned for." Three tones, and `note` is deliberately no
 * tint at all rather than a fourth colour.
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

function Absent({ block, fallback }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-muted">
      <Unrecorded /> — {block?.reason || fallback}
    </p>
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

export default function HqSecurityPage() {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqSecurityOverview().then(setData, (e) => { reportError('hq-security', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // H7's feed, its own request. The filter is applied SERVER-side because
  // the feed is a merged page of sixty rows across four stores: filtering
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
  const dsrDue = dsr.filter((d) => d.days_left !== null && d.days_left <= 14).length;
  const withoutMfa = mfa ? mfa.admins_total - mfa.admins_with_mfa : null;
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

  const rail = (
    <WorkerRail
      workspace="Security"
      role="super_admin"
      stance="Read-only, except force re-auth"
      note="Audit, sessions, KYC and deletion clocks are read from their stores. The one action here signs everyone out and is recorded."
      coverage={ready ? [
        `${num(data.audit?.total) ?? 'an unrecorded number of'} admin actions on record`,
        imp?.available ? `${num(imp.active)} impersonation${imp.active === 1 ? '' : 's'} live` : 'Impersonations: unreadable',
        `${num(dsr.length)} deletion request${dsr.length === 1 ? '' : 's'} open`,
      ] : []}
      coverageNote={ready ? undefined : (data === UNAVAILABLE ? 'The security overview could not be read.' : 'Loading…')}
      unavailable={[
        // [title, detail] pairs: WorkerRail destructures each entry, so a bare
        // string would render as its first two characters.
        ['Security events', 'No security_events ledger exists yet.'],
        // D152 — THIS ROW SAID "Nothing aggregates guardrail verdicts" AND IT
        // WAS FALSE. Something did: `aiRouter.loadAiUsageReport` had rolled
        // them up all along and `AiUsageTab` rendered them. Correcting it is
        // the sixth time this programme has had to re-aim a rail row the day
        // its refusal stopped being true, and what it says now is named by the
        // SERVER rather than retyped here, so the zone and the rail cannot
        // disagree about what is missing.
        ['AI safety counters', aiSafetyDetail],
        ['Sanctions screening', 'Not run on the platform.'],
        ['Backup and restore-drill status', 'Not recorded where the platform can read it.'],
        ['Per-tenant anything', 'No account names its licence yet (U1) — except a licence event, which is about one.'],
        ['The "Return to HQ view" overlay', 'Not built. HQ can read a branch (D108); what is missing is shell state that routes a page\'s reads through one branch and says so.'],
      ]}
      data-testid="hq-security-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-security-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#881337] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          <span className="text-[11px] opacity-80 tabular-nums">
            {ready ? `${num(dsrDue)} deletion request${dsrDue === 1 ? '' : 's'} inside deadline pressure` : '…'}
          </span>
        </div>

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <ShieldCheck size={13} /> HQ · Security
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Security</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Was Governance, which described the audit log and nothing else. That log is here as one zone of
            eight, reading the four stores a privileged action actually lands in rather than the one. Five
            zones read their stores; three say what is not recorded and why. Only a licence event names a
            subsidiary — nothing else here is scoped per subsidiary yet, the guardrail counters included.
          </p>
        </header>

        {data === UNAVAILABLE && <div className="mt-4"><Unreadable what="The security overview" claim="This is not a claim that nothing happened." onRetry={load} /></div>}

        <div className="mt-4 space-y-4">
          <Zone title="Security events and auth anomalies" sub="the canvas's one real backend build" tone="border-red-200 dark:border-red-900/50">
            <Absent block={ready ? data.security_events : null} fallback="no security_events ledger exists." />
          </Zone>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Sessions and access" sub="Revoke is recorded">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Active sessions" value={sessions?.available ? num(sessions.active) : null} note={sessions?.available ? `seen in ${sessions.window_days} days, not revoked` : (sessions?.reason || 'unreadable')} />
                <Stat label="Impersonations live" value={imp?.available ? num(imp.active) : null} note={imp?.available ? 'no ended_at yet' : (imp?.reason || 'unreadable')} tone={imp?.available && imp.active ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'} />
                <Stat label="Admins with MFA" value={mfa ? `${num(mfa.admins_with_mfa)} of ${num(mfa.admins_total)}` : null} note={withoutMfa === null ? 'unreadable' : withoutMfa > 0 ? `${num(withoutMfa)} without` : 'every admin enrolled'} tone={withoutMfa ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
                <Stat label="Failed sign-ins" value={null} note="not recorded — no security_events" />
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

            <Zone title="AI safety" sub="guardrail hits · Advisor-AI outputs the screen caught">
              <AiSafety block={ready ? data.ai_safety : null} />
            </Zone>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Data subject requests" sub={`${ready ? data.dsr?.clock_days : 30}-day clock from receipt`} tone="border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20">
              {ready && dsr.length === 0 && <p className="text-[12px] text-axal-faint">No deletion request is open.</p>}
              {ready && dsr.length > 0 && (
                <ul className="space-y-1.5" data-testid="hq-dsr">
                  {dsr.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12px] dark:border-amber-900 dark:bg-gray-900">
                      <span className="min-w-0 truncate"><b>{d.name || d.email}</b> <span className="text-axal-faint">· {titleCase(d.role)} · erasure</span></span>
                      <span className={`shrink-0 font-bold tabular-nums ${d.days_left === null ? 'text-axal-faint' : d.days_left < 0 ? 'text-red-700 dark:text-red-300' : d.days_left <= 14 ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-white'}`}>
                        {d.days_left === null ? <Unrecorded>clock unknown</Unrecorded> : d.days_left < 0 ? `${num(-d.days_left)}d overdue` : `${num(d.days_left)}d left`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!ready && data !== UNAVAILABLE && <p className="text-[12px] text-axal-faint">Loading…</p>}
              <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
                The clock is statutory — one month from receipt, not from triage. Requests come from each account&apos;s own
                Settings; erasure itself is still a manual act.
              </p>
            </Zone>

            <div className="space-y-4">
              <Zone title="Sanctions and KYC" sub="the review queue">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="KYC pending" value={ready ? num(kyc.pending) ?? '0' : null} note="documents submitted, unverified" tone={kyc.pending ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
                  <Stat label="KYC approved" value={ready ? num(kyc.approved) ?? '0' : null} note="active accounts" />
                  <Stat label="KYC rejected" value={ready ? num(kyc.rejected) ?? '0' : null} note="active accounts" />
                  <Stat label="Sanctions review" value={null} note={ready ? (data.sanctions?.reason || 'not recorded') : 'unreadable'} />
                </div>
              </Zone>
              <Zone title="Backup and DR" sub="drill status, not just backup status">
                <Absent block={ready ? data.backup_dr : null} fallback="no drill record is kept." />
              </Zone>
            </div>
          </div>

          {/* Canvas H7's feed. Time · Actor · Tenant · Action · Target and
              reason, one filter bar, and NO tile above it — the artboard is
              explicit that a summary tile over an audit log is a dashboard,
              and that legibility is not the property you want from a log. */}
          <Zone
            title="Privileged action log"
            sub={feedReady
              ? `${feed.rows.length} newest${feed.more ? ' of more' : ''} · ${feed.sources.filter((x) => x.available).length} of ${feed.sources.length} stores read`
              : 'four stores, one feed'}
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
                      : 'border-axal-hairline bg-white text-axal-muted hover:bg-axal-ground dark:bg-gray-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {feed === UNAVAILABLE && (
              <div className="mt-3">
                <Unreadable
                  what="The privileged action log"
                  claim="This is not a claim that nobody did anything."
                  onRetry={() => setFilter((f) => f)}
                />
              </div>
            )}
            {feed === null && <p className="mt-3 text-[12px] text-axal-faint">Loading…</p>}

            {feedReady && feed.rows.length === 0 && (
              <p className="mt-3 text-[12px] text-axal-faint" data-testid="hq-gov-empty">
                No privileged action matches this filter. Every store below was read and none held a row —
                which is a different fact from a store that could not be read.
              </p>
            )}

            {feedReady && feed.rows.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[11.5px]" data-testid="hq-gov-feed">
                  <thead>
                    <tr className="text-left text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-faint">
                      <th className="py-1 pr-3">Time</th>
                      <th className="py-1 pr-3">Actor</th>
                      <th className="py-1 pr-3">Tenant</th>
                      <th className="py-1 pr-3">Action</th>
                      <th className="py-1">Target and reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feed.rows.map((r) => (
                      <tr key={r.key} className={`border-t border-axal-hairline align-top ${ROW_TINT[r.tone] || ''}`}>
                        <td className="py-1.5 pr-3 font-mono text-[10.5px] text-axal-faint">
                          {day(r.at) || <Unrecorded>no timestamp</Unrecorded>}
                        </td>
                        <td className="py-1.5 pr-3 font-semibold">{r.actor || <Unrecorded>unnamed</Unrecorded>}</td>
                        <td className="py-1.5 pr-3 text-axal-muted">{r.tenant || <Unrecorded />}</td>
                        <td className={`py-1.5 pr-3 font-bold ${ACTION_INK[r.tone] || ACTION_INK.note}`}>{r.action}</td>
                        <td className="py-1.5 text-axal-muted">{r.target || <Unrecorded>no detail</Unrecorded>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {feedReady && (
              <>
                <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-gov-tenant-reason">
                  <b>Tenant.</b> {feed.tenant_reason}
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
                  an audit log is what just happened, never page four, and a count of suspensions is a dashboard
                  where the suspensions themselves are the record. Impersonations and suspensions carry a tint —
                  the only decoration here, and it is there to be scanned for.
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-gov-tenant-view">
                  <b>No &ldquo;Return to HQ view&rdquo;.</b> {feed.tenant_view_reason}
                </p>
              </>
            )}
          </Zone>

          {/* H7's own zone. Not "what changed" — who read rows they do not
              own. The two halves are separate blocks so one unreadable store
              cannot make the other half look like the whole answer. */}
          <Zone title="Data access" sub="impersonations and exports">
            {feed === UNAVAILABLE && (
              <p className="text-[12.5px] text-axal-muted">
                <Unrecorded /> — the privileged action log could not be read, so neither half of this zone can be shown.
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
