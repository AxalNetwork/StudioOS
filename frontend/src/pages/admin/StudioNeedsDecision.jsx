/**
 * D246 — S1c, "Needs a decision": four link tiles, worst first, and the
 * licence line under them.
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
import { titleCase, Unreadable, Unrecorded } from '../../ui';
import { studioCardTarget } from './AdminStudioOverview';
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
  seats: { title: 'Seats', sidebar: 'Accounts' },
  approvals: { title: 'Approvals', sidebar: 'Approvals' },
  programme: { title: 'Programme', sidebar: 'Programs' },
  contracts: { title: 'Contracts', sidebar: 'Contracts' },
};

const BAND = ['Unreadable', 'Past the window', 'Due soon', null];

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

export function StudioNeedsDecisionView({ user, home, licence, templates, insights, glance: glanceProp }) {
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
  if (ownsFetch && glance == null) {
    return (
      <section className="mt-6" data-testid="studio-needs-decision">
        <h2 className="text-[15px] font-extrabold tracking-tight text-axal-ink">Needs a decision</h2>
        <p className="mt-2 text-[12.5px] text-axal-muted" data-testid="studio-decide-reading">Reading…</p>
      </section>
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
    { key: 'seats', glance: g.seats },
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
  return (
    <section className="mt-6" data-testid="studio-needs-decision">
      <h2 className="text-[15px] font-extrabold tracking-tight text-axal-ink">Needs a decision</h2>
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
  );
}

export default StudioNeedsDecisionView;
