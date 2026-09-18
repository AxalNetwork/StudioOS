import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, Landmark } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';
import { useViewAsBranch } from '../../contexts/ViewAsBranchContext';
import HqBranchOverlay from './HqBranchOverlay';

/**
 * HQ · Home — the whole business on one screen (Admin · Super canvas, H1).
 *
 * One request, `GET /api/admin/hq/overview`, and everything on this page is
 * either read from it or said to be not recorded. The canvas draws five
 * totals, a health card per subsidiary, an escalation queue and a licensing
 * feed; the store can answer some of each and the page says which.
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
 * deployed. Revenue per subsidiary stays unrecorded because no branch has
 * reported one, which is a different sentence from the call not existing — it
 * does (D111). A figure the payload lacks renders the same way: `num` returns
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
const branchReason = (b, what) => {
  if (!b) return `No branch is deployed for this licence, so there is no ${what} to read.`;
  if (b.status === 'not_deployed') return b.reason || `This licence has no branch binding yet, so its ${what} cannot be read.`;
  if (b.status === 'unreadable') return b.reason || `This branch did not answer in time, so its ${what} is unknown rather than zero.`;
  return `The branch answered without a ${what}.`;
};

function Pill({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.draft;
  return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${tone}`}>{titleCase(status)}</span>;
}

function Tile({ label, value, note, tone = 'text-axal-ink' }) {
  return (
    <Card>
      <div className="text-[9.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className={`mt-1.5 text-xl font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? <Unrecorded />}</div>
      {note && <div className="mt-1 text-[10.5px] text-axal-faint">{note}</div>}
    </Card>
  );
}

export default function HqHomePage() {
  const [data, setData] = useState(null);       // null = loading, UNAVAILABLE = failed
  const [tenant, setTenant] = useState('');     // '' = all subsidiaries; else a licence uid
  // D153 / H12 — the view-as scope, from the shell. `setViewAs` is what a
  // health card's own button calls; the way OUT is the shell bar's "Return to
  // HQ view", which is chrome rather than a control on this page, because the
  // overlay frames every page it covers and not only this one.
  const { branch: viewAs, setBranch: setViewAs } = useViewAsBranch();

  const load = useCallback(() => {
    // D153 — under the overlay this page does not fetch AT ALL. `HqBranchOverlay`
    // performs its own scoped read, and reading HQ's platform payload beside it
    // would put a licence ledger and a platform account total one render away
    // from a screen whose banner says nothing on it is a platform total.
    if (viewAs) return;
    setData(null);
    api.hqOverview().then(setData, (e) => { reportError('hq-home', e); setData(UNAVAILABLE); });
  }, [viewAs]);
  useEffect(() => { load(); }, [load]);

  const ready = data && data !== UNAVAILABLE;
  const licences = ready ? data.licences || [] : [];
  const selected = tenant ? licences.find((l) => l.uid === tenant) || null : null;
  const shown = selected ? [selected] : licences;
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
  const suspendedCount = ready ? (data.suspended || []).length : 0;
  const queue = ready ? data.queue : null;
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
  // Keyed on `licence_uid`, which is the ONLY join between the two (migration
  // 258). A branch with no deployment row behind it is absent from this map
  // rather than guessed at — attaching one territory's figures to another's
  // contract is the one error this lookup must not make.
  const branchByLicence = useMemo(() => {
    const m = new Map();
    for (const b of branches) if (b?.licence_uid) m.set(b.licence_uid, b);
    return m;
  }, [branches]);

  // The sentence H13 rule 3 requires, derived rather than typed. Three states,
  // and the middle one is the whole point: a branch that did not answer is
  // NAMED, because a total that quietly drops one is worse than no total.
  const branchLine = (() => {
    const c = branchCoverage;
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
  // both sides of this branch, and before the rail: the rail's coverage lines
  // summarise HQ's own ledger and platform totals, and carrying them into a
  // view of one branch would put four false sentences beside four true
  // figures. A rail that can say which scope it answered in is H13's, and
  // `WorkerRail` has no `scope` prop today (#244's remainder) — D153 unblocks
  // that refusal rather than discharging it.
  if (viewAs) {
    return (
      <div className="min-w-0" data-testid="hq-home-page">
        <HqBranchOverlay branch={viewAs} />
      </div>
    );
  }

  const rail = (
    <WorkerRail
      workspace="HQ"
      role="super_admin"
      stance="Read-only overview"
      note="This rail summarises the licence ledger and platform-wide account totals. It takes no action."
      coverage={ready ? [
        `${licences.length} ${plural(licences.length, 'licence', 'licences')} on the ledger`,
        `${countries.length} of 27 EU countries held`,
        accountsTotal === null ? 'Active accounts: not recorded' : `${accountsTotal} active accounts platform-wide`,
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
        //     D111 built `reportUsage` and `revenueSummary`. What is missing is
        //     that no branch has REPORTED one, which is a different sentence.
        //   · "Seat utilisation — needs seat_assignments" was half stale: D127
        //     decided AGAINST that store and counts seats from `users.role`,
        //     which the fan-out returns. What has no store is which seat id a
        //     person holds.
        ['Revenue per subsidiary', 'The reporting call exists (a branch sends its own figure through reportUsage); no branch has sent one yet, so there is nothing to show rather than nothing to read it with.'],
        ['Which seat id a member holds', 'Seats USED is counted from roles and arrives with each branch read. Naming the individual seat needs a seat-assignment store, which nothing writes on either tier.'],
        ['Token P&L per subsidiary', 'Needs per-branch metadata on every model call; nothing meters AI spend per tenant yet.'],
      ]}
      data-testid="hq-home-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-home-page">
      <div className="min-w-0">
        {/* The HQ bar: the tenant switcher sits where a subsidiary's territory
            badge sits, because both answer "whose data am I looking at?". Here
            the honest answer is "everyone's", stated rather than left as the
            absence of a filter. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#881337] px-4 py-2.5 text-white">
          <label className="flex items-center gap-2 text-[12.5px] font-bold">
            <Globe size={15} aria-hidden="true" />
            <span className="sr-only">Narrow this page to one subsidiary</span>
            <select
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              disabled={!ready || licences.length === 0}
              className="rounded-md bg-white/15 px-2 py-1 text-[12.5px] font-bold text-white disabled:opacity-70"
              data-testid="hq-tenant-switcher"
            >
              <option value="" className="text-gray-900 dark:text-gray-100">All subsidiaries</option>
              {licences.map((l) => (
                <option key={l.uid} value={l.uid} className="text-gray-900 dark:text-gray-100">{l.brand_name} · {l.licence_ref}</option>
              ))}
            </select>
            {ready && (
              <span className="text-[11px] font-medium opacity-80 tabular-nums">
                {licences.length} {plural(licences.length, 'tenant', 'tenants')} · {countries.length} {plural(countries.length, 'country', 'countries')}
              </span>
            )}
          </label>
          <span className="rounded bg-white/15 px-2 py-0.5 text-[10px] font-bold tracking-[.05em]">AXAL VC HQ</span>
        </div>
        {selected && (
          <p className="mt-2 text-[11.5px] text-axal-faint">
            Narrowed to {selected.brand_name} on this page only. The rest of the product has no tenant scope yet,
            so nothing else changes.
          </p>
        )}

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Landmark size={13} /> HQ · Home
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Platform</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            {ready
              ? `${accountsTotal === null ? 'An unrecorded number of' : accountsTotal} active accounts across ${licences.length} ${plural(licences.length, 'licence', 'licences')} and ${countries.length} ${plural(countries.length, 'country', 'countries')}. `
              : 'The franchisor’s overview: every licence, every account, the licence trail. '}
            Per-subsidiary figures are not recorded until accounts carry a licence.
          </p>
        </header>

        {data === UNAVAILABLE && <div className="mt-4"><Unreadable what="The HQ overview" claim="This is not a claim that none exist." onRetry={load} /></div>}

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Accounts" value={ready ? accountsTotal : null} note="active, platform-wide" />
          <Tile label="Seats licensed" value={ready ? num(data.seats_licensed) : null} note={<>utilised: <Unrecorded /></>} />
          <Tile label="MTD revenue" value={null} note="no subsidiary attribution" />
          <Tile
            label="Queue backlog"
            value={ready && queue?.available ? num(queue.open) : null}
            note={ready && queue?.available ? 'open + in progress, platform-wide' : 'tickets unreadable'}
            tone={ready && queue?.available && queue.open > 20 ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink'}
          />
          <Tile
            label="Suspended"
            value={ready ? num(suspendedCount) : null}
            // 'none' is a fact about the ledger; an unreadable overview is not
            // the same fact, and must not wear the green either.
            note={!ready ? 'unreadable' : suspendedCount ? data.suspended[0].brand_name : 'none'}
            tone={!ready ? 'text-axal-ink' : suspendedCount ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}
          />
        </div>

        <Card className="mt-4">
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
                    <span className="truncate text-[12.5px] font-extrabold tracking-tight">{l.brand_name}</span>
                    <Pill status={l.status} />
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
                      className="mt-2 rounded border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-muted hover:bg-axal-ground"
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
                          : <Unrecorded reason={branchReason(b, 'account')} />}
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
                          : <Unrecorded reason={live?.seats_used_reason || branchReason(b, 'seat count')} />}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Backlog</dt>
                      <dd className="mt-0.5 font-bold tabular-nums">
                        {live && live.backlog && num(live.backlog.count) !== null
                          ? `${num(live.backlog.count)} open`
                          : <Unrecorded reason={live?.backlog_reason || branchReason(b, 'backlog')} />}
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
            unrecorded: the reporting call exists, and no branch has sent a figure through it yet.
          </p>
        </Card>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-[14.5px] font-extrabold tracking-tight">Escalations awaiting HQ</h2>
              <span className="text-[11.5px] text-axal-faint">Pushed up by subsidiaries</span>
            </div>
            {/* D108 — escalations have a store now (migration 259), so this
                zone stops saying the concept does not exist. Three states, and
                an empty list is NOT the same as an unreadable table: one means
                no branch has pushed anything up, the other means HQ cannot
                tell. */}
            {!ready || data.escalations_available === false ? (
              <p className="text-[12.5px] leading-relaxed text-axal-muted">
                <Unreadable
                  what="Escalations"
                  claim={ready ? data.escalations_reason : 'The overview has not loaded yet.'}
                />{' '}
                The <Link to="/help" className="underline">ticket queue</Link> is platform-wide and is not one.
              </p>
            ) : (data.escalations || []).length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-axal-muted">
                Nothing is waiting on HQ. A branch pushes an item up from its Approvals board —
                moderation, content for brand approval, or a seat increase — and it lands here with
                its clock running. The <Link to="/help" className="underline">ticket queue</Link> is
                platform-wide and is not one.
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="hq-escalations">
                {(data.escalations || []).map((e) => (
                  <li key={e.uid} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{e.branch_code}</span>
                      {' · '}{String(e.kind || '').replace(/_/g, ' ')}
                      {' — '}{e.subject}
                    </span>
                    {/* The band is the server's, derived from the due date on
                        read. A band computed here from `created_at` would be a
                        second answer to the same question. */}
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      e.sla === 'past'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        : e.sla === 'due_soon'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                    }`}>
                      {e.sla === 'past' ? 'past SLA' : e.sla === 'due_soon' ? 'due soon' : 'on time'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {/* D112 — THE LIST IS NOT THE LOOP. Until an escalation could be
                answered, this zone was a queue nobody could clear: a branch
                pushed an item up and HQ could read it and nothing else, so
                every item stayed here forever. Answering happens on its own
                surface rather than inline, because a decision needs its reason
                typed and a one-line list is the wrong place for that. */}
            {ready && data.escalations_available !== false && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-axal-faint">
                Answering one records HQ&rsquo;s decision and pushes it to the branch;
                whether the branch received it is reported separately from whether
                the decision was made.{' '}
                <Link to="/admin/content" className="underline" data-testid="hq-escalations-answer-link">
                  Content submissions &rarr;
                </Link>
              </p>
            )}
          </Card>

          <Card className="border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20">
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
        </div>
      </div>

      <div className="mt-6 lg:mt-0">{rail}</div>
    </div>
  );
}
