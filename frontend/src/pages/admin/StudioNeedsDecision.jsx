/**
 * D246 — S1c, "Needs a decision": four link tiles, worst first, and the
 * licence line under them.
 *
 * D8728 (#8728) — SPLIT IN TWO. "Needs a decision" now holds only what is
 * time-sensitive, worst first: the overdue card (`StudioOverdueCard`, the
 * Inbox's own `age=past` read) and any glance tile other than Approvals that
 * is past its window or due within 24 hours (seats over the licence, a
 * programme gate closing; canvas SAD12 S7). The four tiles and the licence
 * line move under "At a glance" — totals for information, nothing there is
 * due — and carry no band words: "Past the window" is retired, because the
 * Inbox says Overdue for the same 72 hours. Only a tile that could not be
 * read keeps a word, "Unavailable".
 *
 * THE GLANCE IS THE READ (D443, D447). When a glance payload is present, the
 * tiles render from `glancesFromStudioGlance` and `studioGlances` is not
 * called — an undefined legacy prop must not throw. Until the glance arrives,
 * the strip says it is reading. The legacy props are the fallback only when
 * the caller passed `glance={null}`. The order is computed by
 * `orderNeedsDecision`, never typed. Every tile is a link; nothing here is
 * editable, because a tile that acted in place would be a second home page.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bpsPercent } from '../../lib/bps';
import { reportError } from '../../lib/log';
import { branchLabel, branchOfUser } from '../../lib/shellRole';
import { HELD_SCOPE_LABEL, titleCase, Unreadable, Unrecorded } from '../../ui';
import { studioCardTarget } from './AdminStudioOverview';
import StudioOverdueCard, { DECIDE_HEADING_ID } from './StudioOverdueCard';
import {
  freezeLine,
  fullestSeat,
  glancesFromStudioGlance,
  loadStudioGlance,
  offBranchReason,
  orderNeedsDecision,
  studioGlances,
  UNAVAILABLE,
} from './adminStudioOverview';

const TILES = {
  // D555: on HQ the Seats tile is Accounts, with HQ's own counts.
  accounts: { title: 'Accounts', sidebar: 'Accounts' },
  seats: { title: 'Seats', sidebar: 'Accounts' },
  approvals: { title: 'Approvals', sidebar: 'Approvals' },
  programme: { title: 'Programme', sidebar: 'Programs' },
  contracts: { title: 'Contracts', sidebar: 'Contracts' },
};

// D8728: At a glance carries no urgency words; a tile that was not read still says so.
const BAND = ['Unavailable', null, null, null];

/** An exception card's word, by tile and urgency (1 past its window, 2 due soon). */
const EXCEPTION_WORD = {
  seats: { 1: 'Over the licence', 2: 'Near the licence' },
  accounts: { 1: 'Over the licence', 2: 'Near the licence' },
  programme: { 1: 'Past its window', 2: 'Closes within 24 hours' },
  contracts: { 1: 'Past its window', 2: 'Due within 24 hours' },
};

/**
 * D8728: the glance tiles that belong under "Needs a decision" — past their
 * window or due within 24 hours — worst first. Approvals is the overdue
 * card's, from the Inbox's own read, so it is never one of these; an
 * unreadable tile is not an exception either (it says Unavailable under At a
 * glance, and is not a claim that something is due).
 */
export function glanceExceptions(tiles) {
  return orderNeedsDecision(tiles).filter((t) => t.key !== 'approvals' && (t.urgency === 1 || t.urgency === 2));
}

/** The one line a tile shows, from the glance its card also renders. */
export function tileText(key, glance) {
  if (!glance) return { reading: true };
  if (glance.kind === 'unreadable') return { unreadable: glance.reason };
  if (glance.kind === 'unrecorded') return { unrecorded: glance.reason };
  if (key === 'seats') {
    const t = fullestSeat(glance.lines);
    if (!t) return { unrecorded: 'No seat type was measured on this copy, so none is shown as zero.' };
    return { text: `${titleCase(t.type)} ${t.used} of ${t.licensed}${t.state === 'over' ? ' · over' : ''}` };
  }
  return { text: glance.text };
}

function Tile({ tile, frozen, onBranch }) {
  const meta = TILES[tile.key];
  const line = tileText(tile.key, tile.glance);
  const band = BAND[tile.urgency];
  const to = studioCardTarget(onBranch, meta.sidebar);
  return (
    <Link
      to={to || '/studio'}
      data-testid={`studio-decide-${tile.key}`}
      data-urgency={tile.urgency}
      className="block rounded-xl border border-axal-hairline bg-white p-3 hover:bg-gray-50 dark:bg-transparent dark:hover:bg-white/5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-extrabold tracking-tight text-axal-ink">{meta.title}</span>
        {band ? <span className="text-[11px] font-semibold text-axal-muted">{band}</span> : null}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-axal-ink">
        {line.reading ? 'Reading…' : null}
        {line.unreadable ? <span className="text-red-700 dark:text-red-300">{line.unreadable}</span> : null}
        {line.unrecorded ? <Unrecorded reason={line.unrecorded} /> : null}
        {line.text || null}
      </p>
      {frozen ? (
        <p className="mt-1 text-[11px] font-semibold text-rose-800 dark:text-rose-200">Suspended — writes are blocked</p>
      ) : null}
    </Link>
  );
}

/** SAD12 S7: a second exception, its own card under the same heading. */
function ExceptionCard({ tile, onBranch }) {
  const meta = TILES[tile.key];
  const line = tileText(tile.key, tile.glance);
  const to = studioCardTarget(onBranch, meta.sidebar);
  const word = EXCEPTION_WORD[tile.key]?.[tile.urgency] || null;
  return (
    <div className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid={`studio-exception-${tile.key}`} data-urgency={tile.urgency}>
      <h3 className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13.5px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
        {meta.title}
        {word ? <span className="text-[11.5px] font-bold text-amber-800 dark:text-amber-300">· {word}</span> : null}
      </h3>
      <p className="m-0 mt-1 text-[12.5px] leading-snug text-axal-ink dark:text-gray-100">{line.text || null}</p>
      {to ? (
        <Link to={to} className="mt-1 inline-flex min-h-[44px] items-center text-[12.5px] font-bold text-axal-violet underline-offset-2 hover:underline sm:min-h-0 dark:text-violet-300">
          Open {meta.sidebar} →
        </Link>
      ) : null}
    </div>
  );
}

function DecideHeading() {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <h2 id={DECIDE_HEADING_ID} tabIndex={-1} className="text-[15px] font-extrabold tracking-tight text-axal-ink outline-none">Needs a decision</h2>
      <span className="text-[12px] text-axal-muted">Time-sensitive, worst first</span>
    </div>
  );
}

function GlanceHeading() {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <h2 id="studio-glance-heading" className="text-[15px] font-extrabold tracking-tight text-axal-ink">At a glance</h2>
      <span className="text-[12px] text-axal-muted">Totals for information · nothing here is due</span>
    </div>
  );
}

/**
 * `overdue`: the overdue card's read, passed only by a render test; in
 * production it is undefined and the card reads itself (D8728 ⚑1 A).
 */
export function StudioNeedsDecisionView({ user, home, licence, templates, insights, glance: glanceProp, overdue }) {
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (glanceProp !== undefined) return undefined;
    let cancelled = false;
    loadStudioGlance().then(
      (value) => { if (!cancelled) setFetched(value); },
      (e) => {
        reportError('admin-studio:glance', e);
        if (!cancelled) setFetched(UNAVAILABLE);
      },
    );
    return () => { cancelled = true; };
  }, [glanceProp]);
  const ownsFetch = glanceProp === undefined;
  const glance = ownsFetch ? fetched : glanceProp;
  const onBranchUser = Boolean(branchOfUser(user));
  const scopeOf = (tier) => (tier === 'hq' || (tier == null && !onBranchUser)
    ? HELD_SCOPE_LABEL
    : (branchLabel(user) || 'this territory'));

  if (ownsFetch && glance == null) {
    // The overdue card does not wait on the glance: it has its own read.
    return (
      <>
        <section className="mt-6" aria-labelledby={DECIDE_HEADING_ID} data-testid="studio-needs-decision">
          <DecideHeading />
          <div className="mt-3 flex flex-col gap-3">
            <StudioOverdueCard read={overdue} scope={scopeOf(null)} />
          </div>
        </section>
        <section className="mt-6" aria-labelledby="studio-glance-heading" data-testid="studio-at-a-glance">
          <GlanceHeading />
          <p className="mt-2 text-[12.5px] text-axal-muted" data-testid="studio-decide-reading">Reading…</p>
        </section>
      </>
    );
  }
  const g = glance
    ? glancesFromStudioGlance(glance, user)
    : studioGlances({ user, home, licence, templates, insights });
  if (!glance && !g.onBranch) {
    return (
      <section className="mt-6" data-testid="studio-needs-decision">
        <h2 className="text-[15px] font-extrabold tracking-tight text-axal-ink">Needs a decision</h2>
        <p className="mt-2 text-[12.5px] text-axal-muted" data-testid="studio-decide-off-branch">
          <Unrecorded reason={offBranchReason()}>{offBranchReason()}</Unrecorded>
        </p>
      </section>
    );
  }
  const tiles = orderNeedsDecision([
    g.hq ? { key: 'accounts', glance: g.hq.accounts } : { key: 'seats', glance: g.seats },
    { key: 'approvals', glance: g.approvals },
    { key: 'programme', glance: g.programme },
    { key: 'contracts', glance: g.contracts },
  ]);
  const status = user?.branch?.status;
  const linkOnBranch = g.tier === 'branch' || (g.tier == null && Boolean(branchOfUser(user)));
  const frozen = linkOnBranch && status === 'suspended';
  const territories = Array.isArray(user?.branch?.territories) ? user.branch.territories.filter(Boolean) : [];
  const share = g.lic ? bpsPercent(g.lic.revenue_share_bps) : null;
  const insightsTo = studioCardTarget(linkOnBranch, 'Insights');
  const exceptions = glanceExceptions(tiles);
  return (
    <>
      <section className="mt-6" aria-labelledby={DECIDE_HEADING_ID} data-testid="studio-needs-decision">
        <DecideHeading />
        <div className="mt-3 flex flex-col gap-3">
          <StudioOverdueCard read={overdue} scope={scopeOf(g.tier)} frozen={frozen} othersWaiting={exceptions.length > 0} />
          {exceptions.map((t) => <ExceptionCard key={t.key} tile={t} onBranch={linkOnBranch} />)}
        </div>
      </section>
      <section className="mt-6" aria-labelledby="studio-glance-heading" data-testid="studio-at-a-glance">
        <GlanceHeading />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => <Tile key={t.key} tile={t} frozen={frozen} onBranch={linkOnBranch} />)}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted" data-testid="studio-licence-line">
          <span className="font-semibold text-axal-ink">{g.tier === 'hq' ? 'HQ' : (branchLabel(user) || 'This territory')}</span>
          {territories.length ? <span>{territories.join(' · ')}</span> : null}
          <span
            data-testid="studio-licence-state"
            className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink"
          >
            {g.tier === 'hq'
              ? 'HQ-held'
              : frozen
                ? freezeLine('Suspended', g.lic?.suspended_at || null)
                : status === 'active' ? 'Active' : 'Awaiting HQ'}
          </span>
          {g.insights?.share?.kind === 'unreadable' ? (
            <Unreadable what="Share rate" claim={g.insights.share.reason} />
          ) : share && insightsTo ? (
            <Link
              to={insightsTo}
              data-testid="studio-share-chip"
              className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink underline-offset-2 hover:underline"
            >
              Share rate {share} · Insights →
            </Link>
          ) : (
            <Unrecorded reason={g.insights?.share?.kind === 'unrecorded' && g.insights.share.reason
              ? g.insights.share.reason
              : 'The licence copy was not read or carries no share rate, so none is shown.'}>
              Share rate not recorded
            </Unrecorded>
          )}
        </p>
      </section>
    </>
  );
}

export default StudioNeedsDecisionView;
