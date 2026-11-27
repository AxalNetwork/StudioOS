import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterByKind } from '../../lib/licenceKind';
import { Link } from 'react-router-dom';
import { Globe, Landmark } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, DataState, RailFrame, StateChip, WorkerRail, Unrecorded, Unreadable } from '../../ui';
import { useViewAsBranch } from '../../contexts/ViewAsBranchContext';
import HqBranchOverlay from './HqBranchOverlay';
import { registryUnreadable } from './hqTeamBranchModel';
import { revenueAbsenceForLicence } from '../../lib/hqRevenuePerSub';
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import MyTasks from '../work/MyTasks.jsx';
import { EscalationsCard, OtherSignals, useEscalationRead } from './HqAttention.jsx';
import { ANNOUNCE, HQ_WORK_OFF, attentionLine, clockUtc, namesByCode } from './hqHomeModel.js';

/**
 * HQ · Home — the whole business on one screen (Admin · Super canvas, H1).
 *
 * D8727 (#8727) — HQ HOME OPENS ON "WHAT NEEDS MY ATTENTION?". The h1 is
 * "HQ home"; escalations and the scope they affect come before the Platform
 * tiles, the subsidiary cards, the licensing feed and, last, My tasks, which
 * while Work is off is one sentence with no Show or Due filters. Two reads, each
 * with its own Reading, value, All clear and Unavailable state and its own Try
 * again: the overview below, and the escalation board on its own
 * (`HqAttention.jsx`), so a pending read is never drawn as a failure and a
 * failed overview never costs the escalations. One polite live region speaks
 * for the page (`hqHomeModel.js` holds the literal announcements).
 *
 * The overview, `GET /api/admin/hq/overview`: everything else on this page is
 * either read from it or said to be not recorded. The canvas draws the
 * totals, a health card per subsidiary and a licensing feed; the store can
 * answer some of each and the page says which.
 *
 * THE TENANT SWITCHER NARROWS THIS PAGE ONLY. "All subsidiaries ▾" filters
 * the cards and the feed over the payload already loaded and sends nothing
 * back. The read-only overlay that would scope the rest of the product to
 * one tenant is a separate feature (tenancyScope.ts); a switcher that changed
 * this page but nothing else while looking global would be the half-applied
 * scope UNRESOLVED_ITEMS U1 warns about, so it says so beside the control.
 *
 * ABSENT IS NOT ZERO, AND WHICH KIND OF ABSENT MATTERS (D150). The per-branch
 * figures — accounts, seats used, backlog — come from `branches`, the fan-out
 * this page is sent and did not read until D150. Each carries one of three
 * states, and they render differently on purpose: a branch that ANSWERED shows
 * its figures with the time it answered; one that did not is `<Unrecorded/>`
 * with the reason, never a zero; a licence with no branch at all has not been
 * deployed. Revenue per subsidiary stays unrecorded, and since D266 for a
 * third reason rather than the first two: the call exists (D111) and every
 * branch now reports its quarter each morning, but every stream in that report
 * arrives unmeasured, because a branch database records no revenue amounts. A
 * report of "unmeasurable" is not a figure. A figure the payload lacks renders
 * the same way: `num` returns
 * null for a missing value rather than defaulting it, which is the difference
 * between "0 accounts" and "not recorded". A failed request renders as
 * unreadable, never as an empty platform — `InvestorFundLanding` is the
 * in-repo precedent.
 */
const UNAVAILABLE = Symbol('unavailable');

const STATUS_TONE = {
  active: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900',
  suspended: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  pending_activation: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900',
  draft: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  terminated: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
};

const EVENT_LABEL = {
  created: 'Licence created',
  territory_changed: 'Territory changed',
  seats_changed: 'Seats changed',
  terms_changed: 'Terms changed',
  activated: 'Activated',
  suspended: 'Suspended',
  reinstated: 'Reinstated',
  renewed: 'Renewed',
  terminated: 'Terminated',
};

const titleCase = (s) => String(s || '').replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
const day = (v) => (v ? String(v).slice(0, 10) : null);
// A number, formatted — or null when there is no number. Never a default:
// a missing figure is Not recorded, not zero.
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const plural = (count, one, many) => (count === 1 ? one : many);

/**
 * Why a branch figure is absent, in the branch's own words where it has them.
 *
 * THE THREE STATES ARE THREE DIFFERENT SENTENCES (D150), which is the whole
 * reason `fanOut` returns a status rather than a nullable payload. Collapsing
 * them would put "we could not reach this branch" and "this licence has no
 * branch" behind one dash, and only the second is a fact about the licence.
 *
 * `unreadable` deliberately does NOT say the branch is down — `services/
 * branches.ts` makes that point where the state is defined, and a deadline
 * this Worker set is at least as likely an explanation as anything at the far
 * end.
 */
const branchReason = (b, what, registryDown = false) => {
  // D5374 — with the registry unreadable, "no branch for this licence" is not known: it is only
  // known that HQ could not look. The sentence for an empty registry needs a registry that was read.
  if (!b && registryDown) return `HQ could not read its deployment registry, so whether this licence has a branch is not established and its ${what} is unknown, not zero.`;
  if (!b) return `No branch is deployed for this licence, so there is no ${what} to read.`;
  if (b.status === 'not_deployed') return b.reason || `This licence has no branch binding yet, so its ${what} cannot be read.`;
  if (b.status === 'unreadable') return b.reason || `This branch did not answer in time, so its ${what} is unknown rather than zero.`;
  return `The branch answered without a ${what}.`;
};

function Pill({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.draft;
  return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${tone}`}>{titleCase(status)}</span>;
}

/**
 * A Platform tile. D8727 — the tile carries its read's state: Reading is a
 * skeleton, a failed overview is Unavailable ("not read"), and only a read that
 * answered shows its value, where a missing figure is still Not recorded.
 */
function Tile({ label, value, note, state = 'ok', tone = 'text-axal-ink' }) {
  return (
    <Card data-read={state}>
      <div className="text-[9.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className={`mt-1.5 text-xl font-extrabold tracking-tight tabular-nums ${tone}`}>
        {state === 'reading'
          ? <span aria-hidden="true" className="my-[3px] block h-5 w-16 rounded-[5px] bg-gray-200 dark:bg-gray-700" />
          : state === 'failed' ? <StateChip kind="unavailable" /> : <>{value ?? <Unrecorded />}</>}
      </div>
      {state === 'failed'
        ? <div className="mt-1 text-[10.5px] text-axal-faint">not read</div>
        : state === 'ok' && note ? <div className="mt-1 text-[10.5px] text-axal-faint">{note}</div> : null}
    </Card>
  );
}

export default function HqHomePage() {
  const [data, setData] = useState(null);       // null = loading, UNAVAILABLE = failed
  const [tenant, setTenant] = useState('');     // '' = all subsidiaries; else a licence uid
  const [kindFilter, setKindFilter] = useState('all'); // all | subsidiary | white_label (H28)
  // D153 / H12 — the view-as scope, from the shell. `setViewAs` is what a
  // health card's own button calls; the way OUT is the shell bar's "Return to
  // HQ view", which is chrome rather than a control on this page, because the
  // overlay frames every page it covers and not only this one.
  const { branch: viewAs, setBranch: setViewAs } = useViewAsBranch();
  const [readAt, setReadAt] = useState(null);   // when the overview answered
  // D8727 — the page's one polite live region. Each line is keyed, so the same
  // sentence twice is spoken twice.
  const [said, setSaid] = useState({ text: '', n: 0 });
  const announce = useCallback((text) => setSaid((s) => ({ text, n: s.n + 1 })), []);
  const overviewReady = useRef(false);
  const overviewFailSaid = useRef(false);
  // D8727 — the escalation board, read on its own beside the overview, with
  // its own state and its own Try again. Not read under the overlay (D153).
  const { read: esc, retry: retryEscalations } = useEscalationRead({
    enabled: !viewAs, announce, overviewReady: () => overviewReady.current,
  });
  const escFailed = useRef(false);
  escFailed.current = esc.phase === 'failed';

  const load = useCallback(() => {
    // D153 — under the overlay this page does not fetch AT ALL. `HqBranchOverlay`
    // performs its own scoped read, and reading HQ's platform payload beside it
    // would put a licence ledger and a platform account total one render away
    // from a screen whose banner says nothing on it is a platform total.
    if (viewAs) return;
    setData(null);
    api.hqOverview().then((d) => { setData(d); setReadAt(Date.now()); }, (e) => {
      reportError('hq-home', e);
      setData(UNAVAILABLE);
      // Announced once per page view; a failed Try again is the block's own alert.
      if (!overviewFailSaid.current) {
        overviewFailSaid.current = true;
        announce(escFailed.current ? ANNOUNCE.overviewFailedToo : ANNOUNCE.overviewFailed);
      }
    });
  }, [viewAs, announce]);
  useEffect(() => { if (!viewAs) announce(ANNOUNCE.coldLoad); }, [viewAs, announce]);
  useEffect(() => { load(); }, [load]);

  const ready = data && data !== UNAVAILABLE;
  overviewReady.current = Boolean(ready);
  const overviewState = data === null ? 'reading' : data === UNAVAILABLE ? 'failed' : 'ok';
  const names = useMemo(() => namesByCode(ready ? data : null), [ready, data]);
  const licences = ready ? data.licences || [] : [];
  const selected = tenant ? licences.find((l) => l.uid === tenant) || null : null;
  const kindScoped = filterByKind(licences, kindFilter);
  const shown = selected ? [selected] : kindScoped;
  const events = useMemo(() => {
    if (!ready) return [];
    const all = data.events || [];
    return selected ? all.filter((e) => e.licence_uid === selected.uid) : all;
  }, [ready, data, selected]);
  const renewals = useMemo(() => {
    if (!ready) return [];
    const all = data.renewals_soon || [];
    return selected ? all.filter((r) => r.uid === selected.uid) : all;
  }, [ready, data, selected]);

  const countries = ready ? data.countries_held || [] : [];
  // D8727 — the kind filter is drawn only when it can change the cards: both kinds hold a licence.
  const kindCount = useMemo(() => ({
    subsidiary: licences.filter((l) => l.kind !== 'white_label').length,
    white_label: licences.filter((l) => l.kind === 'white_label').length,
  }), [licences]);
  const bothKinds = ready && kindCount.subsidiary > 0 && kindCount.white_label > 0;
  const accountsTotal = ready ? num(data.accounts?.total) : null;

  // D150 — THE FAN-OUT THIS PAGE WAS ALREADY BEING SENT. `/admin/hq/overview`
  // has returned `branches` and `branches_coverage` since D108 and this page
  // read NEITHER: the health cards below were drawn from the licence ledger
  // alone, so Accounts and backlog rendered Unrecorded under a footnote
  // blaming U1 — a blocker that does not apply to a branch at all. A branch is
  // physically isolated (D.2), so every account in its database IS the
  // branch's; that is exactly why `branchOverview` can count them and why
  // D148 could publish medians of them. The page was refusing figures the
  // server was sending it.
  //
  // Same shape as #252 (a table with no writer and no reader), D142
  // (`/me.branch`'s status and as_of, shipped and consumed by nothing) and
  // D149 (`revenue_share_bps`, on the row and thrown away).
  const branches = ready ? data.branches || [] : [];
  const branchCoverage = ready ? data.branches_coverage || null : null;
  // D5374 — `registry_available: false` is "HQ could not read the deployment registry", which is
  // not "no branch is deployed". An older payload without the field makes no claim either way.
  const registryDown = ready && registryUnreadable(data);
  const usageCoverage = ready ? data.usage_coverage || null : null;
  // Keyed on `licence_uid`, which is the ONLY join between the two (migration
  // 258). A branch with no deployment row behind it is absent from this map
  // rather than guessed at — attaching one territory's figures to another's
  // contract is the one error this lookup must not make.
  const branchByLicence = useMemo(() => {
    const m = new Map();
    for (const b of branches) if (b?.licence_uid) m.set(b.licence_uid, b);
    return m;
  }, [branches]);

  /** Seats used summed from branch reads — the fan-out HQ Home already receives (D150). */
  const seatsUtilised = useMemo(() => {
    if (!ready) return { value: null, reason: null };
    if (!branches.length && registryDown) {
      return {
        value: null,
        reason: 'The deployment registry could not be read, so which branches exist is not established and seat utilisation cannot be summed.',
      };
    }
    if (!branches.length) {
      return {
        value: null,
        reason: 'No branch is deployed yet, so seat utilisation cannot be summed from branch reads.',
      };
    }
    let sum = 0;
    let answered = 0;
    let silent = 0;
    for (const b of branches) {
      if (b.status !== 'ok' || !b.data) { silent += 1; continue; }
      // D8727 — `num` formats for display ("1,102"); adding its string joined the
      // digits ("268" + "251" read as 268,251). The sum is of numbers.
      if (num(b.data.seats_used) === null) { silent += 1; continue; }
      sum += Number(b.data.seats_used);
      answered += 1;
    }
    if (answered === 0) {
      return {
        value: null,
        reason: 'Every deployed branch withheld its seat count or did not answer in time.',
      };
    }
    if (silent > 0) {
      return {
        value: sum,
        reason: `Summed over ${answered} ${answered === 1 ? 'branch' : 'branches'} that answered; ${silent} did not, so this is not a complete total.`,
      };
    }
    if (registryDown) {
      return {
        value: sum,
        reason: `Summed over ${answered} ${answered === 1 ? 'branch' : 'branches'} that answered; the deployment registry could not be read, so other branches may exist and this is not a complete total.`,
      };
    }
    return { value: sum, reason: null };
  }, [ready, branches, registryDown]);

  // The sentence H13 rule 3 requires, derived rather than typed. Three states,
  // and the middle one is the whole point: a branch that did not answer is
  // NAMED, because a total that quietly drops one is worse than no total.
  const branchLine = (() => {
    const c = branchCoverage;
    if (registryDown) {
      return 'Deployment registry: unreadable, so the set of branches is not established and no branch total here is complete';
    }
    if (!c || !num(c.total)) {
      return 'No branch is deployed, so every figure above is HQ\'s own database.';
    }
    const unread = Array.isArray(c.unreadable) ? c.unreadable : [];
    const base = `${c.answered} of ${c.total} ${plural(c.total, 'branch', 'branches')} answered`;
    return unread.length
      ? `${base} — ${unread.join(', ')} did not, so any total here excludes ${plural(unread.length, 'it', 'them')}`
      : `${base}, so branch figures here are complete`;
  })();

  // D153 / H12 — frame 1. AFTER every hook, so the hook order is the same on
  // both sides of this branch, and before the rail below: THAT rail's coverage
  // lines summarise HQ's own ledger and platform totals, and carrying them
  // into a view of one branch would put four false sentences beside four true
  // figures.
  //
  // D154 — the overlay now carries a rail OF ITS OWN, built from the branch's
  // read and chipped with the branch it read. D153 shipped without one because
  // `WorkerRail` had no `scope` prop and a rail that could not say which scope
  // it answered in was worse on this screen than none; that was the last thing
  // standing between H13's rule 1 and the page, and it is built.
  if (viewAs) {
    // D556 — the overlay is the page's outermost element, so its rail frame
    // docks to the edge like every other HQ page's. It used to sit inside a
    // wrapper div, which would leave the frame one level too deep to bleed.
    return <HqBranchOverlay branch={viewAs} data-testid="hq-home-page" />;
  }

  const rail = (
    <WorkerRail
      workspace="HQ"
      role="super_admin"
      // D154 / H13 rule 1 — the scope the page READ IN, reported. Here it is
      // every branch at once, which is a real answer and not a default: the
      // fan-out is what this page performed, and the coverage line below says
      // how many of them answered.
      scope="All branches"
      stance="Read-only overview"
      note="This rail summarises the licence ledger and active accounts on HQ's database. It takes no action."
      coverage={ready ? [
        `${licences.length} ${plural(licences.length, 'licence', 'licences')} on the ledger`,
        `${countries.length} of 27 EU countries held`,
        accountsTotal === null ? 'Active accounts: not recorded' : `${accountsTotal} active accounts on HQ's database`,
        // H13 RULE 3 — "unreadable is a word in the answer" (D150). The rail
        // summarises the lines below it, so a line that omits an unanswered
        // branch produces an answer that silently totals over the rest. That
        // is the failure this architecture makes likely and the reason the
        // canvas states the rule. `branches_coverage.unreadable` is a list of
        // branch CODES, so the sentence names them rather than counting them.
        branchLine,
      ] : []}
      coverageNote={ready ? undefined : (data === UNAVAILABLE ? 'The overview could not be read.' : 'Loading the overview…')}
      unavailable={[
        // [title, detail] pairs: WorkerRail destructures each entry, so a bare
        // string would render as its first two characters.
        // D108 — three of these four moved. Per-branch accounts and queue
        // depth now come from the fan-out, and escalations have a store, so
        // both lines are GONE rather than reworded: a stale "not connected"
        // note that still reads plausibly is what the next surface cites.
        // What remains is what genuinely has no source.
        // D150 — TWO OF THESE THREE HAD OUTLIVED THEIR BLOCKERS, which is the
        // sixth time this programme has deleted a reason rather than reworded
        // it (D129's seat store, D131's six blocks, D140's adjustable dates,
        // D147's templates_reason, D149's "only place a fraction is computed").
        // A stale reason that still reads plausibly is what the next surface
        // cites, so each is replaced by what is actually missing now.
        //
        //   · "Revenue per subsidiary — that call is not built" was FALSE:
        //     D111 built `reportUsage` and `revenueSummary`. D150 then said no
        //     branch had REPORTED one, which D266 made false in turn: every
        //     branch reports its quarter each morning. What is missing now is
        //     a MEASUREMENT — every stream in the report arrives unmeasured.
        //   · "Seat utilisation — needs seat_assignments" was half stale: D127
        //     decided AGAINST that store and counts seats from `users.role`,
        //     which the fan-out returns. What has no store is which seat id a
        //     person holds.
        ['Revenue per subsidiary', 'Each branch reports its quarter to HQ every morning, and every stream in that report arrives unmeasured: a branch database records no revenue amounts, so there is no figure to show.'],
        ['Which seat id a member holds', 'Seats USED is counted from roles and arrives with each branch read. Naming the individual seat needs a seat-assignment store, which nothing writes on either tier.'],
        ['Token P&L per subsidiary', 'Only Eadwyn’s two gatewayed task classes carry branch metadata (D261); every other model call carries none, and nothing meters AI spend per tenant yet.'],
      ]}
      data-testid="hq-home-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="hq-home-page">
      <div className="min-w-0">
        {/* D8727 — the page's one polite live region (SHQ20). */}
        <div role="status" aria-live="polite" className="sr-only" data-testid="hq-home-live">
          {said.text ? <span key={said.n}>{said.text}</span> : null}
        </div>
        {/* The HQ bar: the tenant switcher sits where a subsidiary's territory
            badge sits, because both answer "whose data am I looking at?". Here
            the honest answer is "everyone's", stated rather than left as the
            absence of a filter.
            D8727 — controls are drawn only when they can change the result:
            the switcher once the ledger has loaded (never drawn disabled), the
            kind filter only when both kinds hold a licence. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#881337] px-4 py-2.5 text-white" data-testid="hq-scope-bar">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-bold">
            <Globe size={15} aria-hidden="true" />
            {ready && licences.length > 0 ? (
              <label className="flex items-center gap-2">
                <span className="sr-only">Narrow this page to one subsidiary</span>
                <select
                  value={tenant}
                  onChange={(e) => setTenant(e.target.value)}
                  className="min-h-[44px] rounded-md bg-white/15 px-2 py-1 text-[12.5px] font-bold text-white sm:min-h-0"
                  data-testid="hq-tenant-switcher"
                >
                  <option value="" className="text-gray-900 dark:text-gray-100">All subsidiaries</option>
                  {licences.map((l) => (
                    <option key={l.uid} value={l.uid} className="text-gray-900 dark:text-gray-100">{l.brand_name} · {l.licence_ref}</option>
                  ))}
                </select>
              </label>
            ) : <span>All subsidiaries</span>}
            {ready ? (
              <span className="text-[11px] font-medium opacity-80 tabular-nums">
                {licences.length} {plural(licences.length, 'tenant', 'tenants')} · {countries.length} {plural(countries.length, 'country', 'countries')}
              </span>
            ) : (
              <span className="text-[12px] font-medium opacity-85">{data === UNAVAILABLE ? 'Licence ledger unavailable' : 'Reading the licence ledger…'}</span>
            )}
          </div>
          <span className="hidden rounded bg-white/15 px-2 py-0.5 text-[10px] font-bold tracking-[.05em] sm:inline">AXAL VC HQ</span>
          {bothKinds && (
            <div className="flex w-full flex-wrap gap-2 pt-1 sm:w-auto sm:pt-0" role="group" aria-label="Licence kind" data-testid="hq-kind-filter">
              {[
                ['all', 'All'],
                ['subsidiary', 'Axal'],
                ['white_label', 'White-label'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={kindFilter === id}
                  onClick={() => setKindFilter(id)}
                  className={`min-h-[44px] rounded-full border px-3 py-1 text-[11px] font-semibold sm:min-h-0 ${
                    kindFilter === id
                      ? 'border-white bg-white/25 text-white'
                      : 'border-white/50 text-white/95 hover:bg-white/15'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {selected && (
          <p className="mt-2 text-[11.5px] text-axal-faint">
            Narrowed to {selected.brand_name} on this page only. Elsewhere, use View as on a deployed branch
            to read that tenant's database — the tenant switcher here does not change other routes.
          </p>
        )}

        <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
              <Landmark size={13} aria-hidden="true" /> HQ › Home
            </nav>
            {/* D8727 — the first heading names HQ. It was "Platform", which is now the h2 below. */}
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">HQ home</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-axal-muted">
              <span className="sm:hidden">Escalations first, then the platform.</span>
              <span className="hidden sm:inline">Escalations waiting on HQ come first, then the platform: licences, seats and each branch’s own read.</span>
            </p>
          </div>
          <HeaderAsk />
        </header>

        {/* D8727 — WHAT NEEDS MY ATTENTION? Escalations over their own read,
            beside the other signals from the overview. Each card keeps its own
            state; neither waits on, or fails with, the other. */}
        <section aria-labelledby="hq-attn" className="mt-5 flex flex-col gap-2.5" data-testid="hq-attention">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 id="hq-attn" className="m-0 text-[17px] font-extrabold tracking-tight text-axal-ink">What needs my attention?</h2>
            <span className="text-[12.5px] text-axal-muted">{attentionLine(esc)}</span>
          </div>
          <div className="grid items-start gap-3.5 md:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
            <EscalationsCard read={esc} onRetry={retryEscalations} names={names} overview={overviewState} now={Date.now()} />
            <OtherSignals overview={overviewState} data={ready ? data : null} readAt={readAt} />
          </div>
        </section>

        <section aria-labelledby="hq-plat" className="mt-6 flex flex-col gap-2.5" data-testid="hq-platform">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 id="hq-plat" className="m-0 text-[17px] font-extrabold tracking-tight text-axal-ink">Platform</h2>
            <span className="text-[12.5px] text-axal-muted">
              {ready
                ? [!registryDown && branchCoverage && num(branchCoverage.total) ? `${branchCoverage.answered} of ${branchCoverage.total} ${plural(branchCoverage.total, 'branch', 'branches')} answered` : null, readAt ? `read ${clockUtc(readAt)}` : null].filter(Boolean).join(' · ')
                : data === UNAVAILABLE ? '' : 'Reading…'}
            </span>
          </div>
          {data === UNAVAILABLE && (
            <div data-testid="hq-home-overview-unavailable">
              {/* The overview's one Try again: it reads the overview again and
                  leaves the escalation card as it is. Polite on first load (the
                  page's region says it once); an alert only after Try again. */}
              <DataState
                state="unavailable"
                size="block"
                what="The HQ overview"
                claim="This is not a claim that the platform is empty."
                reason={esc.phase === 'ok' ? 'Escalations above come from their own read and are current.' : undefined}
                onRetry={load}
                retryLabel="Try again"
                announce="after-action"
              />
            </div>
          )}
          {registryDown && (
            <div data-testid="hq-home-registry-unreadable">
              <Unreadable
                what="HQ's deployment registry"
                claim={`${data.registry_reason || 'The set of provisioned branches is not established.'} This is not a claim that no branch is deployed, and branch figures below are not a complete total.`}
                onRetry={load}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
            <Tile
              label="Licences"
              state={overviewState}
              value={ready ? num(licences.length) : null}
              note={ready ? `${kindCount.subsidiary} Axal · ${kindCount.white_label} white-label · ${countries.length} ${plural(countries.length, 'country', 'countries')}` : null}
            />
            <Tile
              label="Seats licensed"
              state={overviewState}
              value={ready ? num(data.seats_licensed) : null}
              note={(
                <>
                  utilised:{' '}
                  {seatsUtilised.value !== null
                    ? (
                      <>
                        {num(seatsUtilised.value)}
                        {seatsUtilised.reason ? ` · ${seatsUtilised.reason}` : ' · summed from branch reads'}
                      </>
                    )
                    : <Unrecorded reason={seatsUtilised.reason} />}
                </>
              )}
            />
            {/* D210 — H15 is reached from here. Its own nav lights Home, and the HQ
                group is eleven rows by design (D146), so the page is a link on the
                tile whose figure it draws over time, not a twelfth row. */}
            <Tile
              label="Accounts · HQ"
              state={overviewState}
              value={ready ? accountsTotal : null}
              note={<>active on HQ's database · <Link to="/admin/analytics" className="underline">weekly activity, by branch</Link></>}
            />
            <Tile
              label="MTD revenue"
              state={overviewState}
              value={null}
              note={ready ? (data.mtd_revenue_reason || 'every stream in the morning report arrives unmeasured') : null}
            />
          </div>
        </section>

        <Card className="mt-6">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[14.5px] font-extrabold tracking-tight">Subsidiary health</h2>
            <span className="text-[11.5px] text-axal-faint">One card per licence</span>
          </div>
          {ready && licences.length === 0 && (
            <p className="text-[12.5px] text-axal-muted">
              No licences have been issued yet. The ledger is empty, which is a different fact from every
              subsidiary being healthy. <Link to="/admin/licences" className="underline">Issue the first licence →</Link>
            </p>
          )}
          {ready && licences.length > 0 && shown.length === 0 && (
            <p className="text-[12.5px] text-axal-muted" data-testid="hq-kind-filter-empty">
              No licences match this filter. Choose All, Axal subsidiary, or White-label above.
            </p>
          )}
          {ready && shown.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="hq-subsidiary-cards">
              {shown.map((l) => {
                // D150 — the branch read for THIS licence, or nothing. Three
                // states, and they must render differently: `ok` carries
                // figures with the time they were read, `unreadable` is not a
                // claim the branch is down and is certainly not a zero, and a
                // licence with no branch at all has not been deployed.
                const b = branchByLicence.get(l.uid) || null;
                const live = b && b.status === 'ok' ? b.data || null : null;
                return (
                <div key={l.uid} data-branch-state={b ? b.status : 'none'} className={`rounded-xl border p-3 ${l.status === 'suspended' ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20' : 'border-axal-hairline bg-axal-ground'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      {l.kind === 'white_label' && l.brand_kit?.primary_hex && (
                        <span
                          aria-hidden="true"
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
                          style={{ backgroundColor: l.brand_kit.primary_hex }}
                        />
                      )}
                      <span className="truncate text-[12.5px] font-extrabold tracking-tight">{l.brand_name}</span>
                    </span>
                    <Pill status={l.status} />
                  </div>
                  <div className="mt-0.5 text-[10px] font-semibold text-axal-faint" data-testid="hq-card-kind-pill">
                    {l.kind === 'white_label' ? 'White-label' : 'Axal subsidiary'}
                  </div>
                  {/* D153 / H12 — the way IN, and it is drawn only where there
                      is something behind it. A licence whose branch is not
                      bound, or did not answer, gets NO control: a "view as"
                      that opens a screen of absences would be the
                      `still_an_admin` mistake D134 named, one tier up. The way
                      OUT is the shell bar, because the overlay frames every
                      page rather than this one. */}
                  {b && b.status === 'ok' && (
                    <button
                      type="button"
                      data-testid="hq-view-as-enter"
                      onClick={() => setViewAs(b.code)}
                      className="mt-2 rounded border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-muted hover:bg-axal-ground dark:hover:bg-gray-800"
                    >
                      View as {b.code}
                    </button>
                  )}
                  <div className="mt-1 font-mono text-[10px] text-axal-faint">{l.licence_ref} · {l.territories.length ? l.territories.join(' · ') : 'no territory'}</div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-axal-hairline pt-2 text-[11px]">
                    <div><dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Seats licensed</dt><dd className="mt-0.5 font-bold tabular-nums">{num(l.seats_licensed) ?? <Unrecorded />}</dd></div>
                    <div><dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Renews</dt><dd className="mt-0.5 font-bold tabular-nums">{day(l.renews_on) || <Unrecorded />}</dd></div>
                    <div>
                      <dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Accounts</dt>
                      <dd className="mt-0.5 font-bold tabular-nums">
                        {live && num(live.accounts?.total) !== null
                          ? num(live.accounts.total)
                          : <Unrecorded reason={branchReason(b, 'account', registryDown)} />}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Seats used</dt>
                      <dd className="mt-0.5 font-bold tabular-nums">
                        {/* `seats_used` is a number on a branch and null on HQ,
                            and `seats_used_reason` travels with it — the union
                            branchOps.ts:51-66 declares precisely so every
                            consumer has to handle both. */}
                        {live && num(live.seats_used) !== null
                          ? num(live.seats_used)
                          : <Unrecorded reason={live?.seats_used_reason || branchReason(b, 'seat count', registryDown)} />}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
                        Revenue{usageCoverage?.available ? ` · ${usageCoverage.period}` : ''}
                      </dt>
                      <dd className="mt-0.5 text-[11px] leading-relaxed text-axal-muted">
                        <Unrecorded reason={revenueAbsenceForLicence(usageCoverage, l.uid)} />
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Backlog</dt>
                      <dd className="mt-0.5 font-bold tabular-nums">
                        {live && live.backlog && num(live.backlog.count) !== null
                          ? (
                            <>
                              {num(live.backlog.count)} open
                              {live.backlog.oldest_at ? ` · oldest ${day(live.backlog.oldest_at)}` : ''}
                            </>
                          )
                          : <Unrecorded reason={live?.backlog_reason || branchReason(b, 'backlog', registryDown)} />}
                      </dd>
                    </div>
                  </dl>
                  {/* WHEN the figures above were read, never omitted: a pushed
                      or fanned-out number without its stamp is the defect D147
                      and D149 both landed on. */}
                  {b && b.status === 'ok' && b.as_of && (
                    <p className="mt-2 text-[10px] text-axal-faint">Read {b.as_of}</p>
                  )}
                  {b && b.status !== 'ok' && b.reason && (
                    <p className="mt-2 text-[10px] text-axal-faint">{b.reason}</p>
                  )}
                </div>
                );
              })}
            </div>
          )}
          {!ready && data !== UNAVAILABLE && <p className="text-[12px] text-axal-faint">Loading the ledger…</p>}
          <p className="mt-3 text-[11.5px] leading-relaxed text-axal-faint">
            {/* D150 — THE FOOTNOTE THAT WAS WRONG. It said accounts, revenue
                and backlog "need every account to name its licence; none does
                yet" — U1, which is a fact about HQ's OWN database and has
                never been the blocker for a branch. A branch is its own Worker
                over its own D1 (D.2), so every account there is that branch's
                by construction, which is why its read can count them. */}
            Status, territory, seats licensed and renewal date are the ledger&apos;s own. Accounts, seats used
            and backlog come from each branch&apos;s own read over its own database, stamped with the time it
            answered — and a branch that did not answer says so rather than reading as a zero. Revenue stays
            unrecorded: each branch reports its quarter every morning, and every stream arrives unmeasured
            because a branch database records no revenue amounts.
          </p>
        </Card>

        <Card className="mt-4 border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[14.5px] font-extrabold tracking-tight">Licensing events</h2>
            <span className="text-[11.5px] text-axal-faint">Renewals ≤ {ready ? data.renewals_within_days : 60}d and the trail</span>
          </div>
          {ready && renewals.length > 0 && (
            <ul className="mb-2 space-y-1.5" data-testid="hq-renewals">
              {renewals.map((rw) => (
                <li key={rw.uid} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12px] dark:border-amber-900 dark:bg-gray-900">
                  <span className="font-bold">{rw.brand_name} renews</span>
                  <span className="font-mono text-[10.5px] text-amber-800 dark:text-amber-300">{day(rw.renews_on)}</span>
                </li>
              ))}
            </ul>
          )}
          {ready && events.length === 0 && (
            <p className="text-[12px] text-axal-faint">No licence events {selected ? 'for this subsidiary' : 'recorded'} yet.</p>
          )}
          {ready && events.length > 0 && (
            <ul className="space-y-1" data-testid="hq-events">
              {events.map((e) => (
                <li key={e.id} className="grid grid-cols-[92px_1fr] gap-2 text-[11.5px]">
                  <span className="font-mono text-[10px] text-axal-faint">{day(e.created_at)}</span>
                  <span><b>{EVENT_LABEL[e.event] || titleCase(e.event)}</b> · {e.brand_name}{e.note ? ` — ${e.note}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {!ready && data !== UNAVAILABLE && <p className="text-[12px] text-axal-faint">Loading…</p>}
          <p className="mt-2"><Link to="/admin/licences" className="text-[11.5px] font-bold text-rose-800 underline dark:text-rose-300">View more · Licences →</Link></p>
        </Card>

        {/* D1614 W8 (#3994): every task given to me, across my Teams. Not under View as: that is a branch's page.
            D8727 — last, after everything that needs HQ (⚑ Q1, option A): while Work is
            off it is one sentence with no Show or Due filters, and names no issue. */}
        <div className="mt-6"><MyTasks licence="admin" testId="hq-my-tasks" offReason={HQ_WORK_OFF} hideControlsWhenOff /></div>
      </div>

    </RailFrame>
  );
}
