/**
 * D246 — S1c, "Needs a decision": four link tiles, worst first, and the
 * licence line under them.
 *
 * NO READ OF ITS OWN. Every tile renders from `studioGlances`, the same object
 * the overview cards render from, so a tile and its card cannot disagree. The
 * order is computed by `orderNeedsDecision`, never typed. Every tile is a
 * link; nothing here is editable, because a tile that acted in place would be
 * a second home page.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { bpsPercent } from '../../lib/bps';
import { branchLabel } from '../../lib/shellRole';
import { titleCase, Unrecorded } from '../../ui';
import {
  freezeLine,
  fullestSeat,
  offBranchReason,
  orderNeedsDecision,
  studioGlances,
} from './adminStudioOverview';

const TILES = {
  seats: { title: 'Seats', to: '/branch/accounts' },
  approvals: { title: 'Approvals', to: '/branch/approvals' },
  programme: { title: 'Programme', to: '/branch/programs' },
  contracts: { title: 'Contracts', to: '/branch/contracts' },
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

function Tile({ tile, frozen }) {
  const meta = TILES[tile.key];
  const line = tileText(tile.key, tile.glance);
  const band = BAND[tile.urgency];
  return (
    <Link
      to={meta.to}
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

export function StudioNeedsDecisionView({ user, home, licence, templates, insights }) {
  const g = studioGlances({ user, home, licence, templates, insights });
  if (!g.onBranch) {
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
  const frozen = status === 'suspended';
  const territories = Array.isArray(user?.branch?.territories) ? user.branch.territories.filter(Boolean) : [];
  const share = g.lic ? bpsPercent(g.lic.revenue_share_bps) : null;
  return (
    <section className="mt-6" data-testid="studio-needs-decision">
      <h2 className="text-[15px] font-extrabold tracking-tight text-axal-ink">Needs a decision</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => <Tile key={t.key} tile={t} frozen={frozen} />)}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted" data-testid="studio-licence-line">
        <span className="font-semibold text-axal-ink">{branchLabel(user) || 'This territory'}</span>
        {territories.length ? <span>{territories.join(' · ')}</span> : null}
        <span
          data-testid="studio-licence-state"
          className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink"
        >
          {frozen
            ? freezeLine('Suspended', g.lic?.suspended_at || null)
            : status === 'active' ? 'Active' : 'Awaiting HQ'}
        </span>
        {share ? (
          <Link
            to="/branch/insights"
            data-testid="studio-share-chip"
            className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink underline-offset-2 hover:underline"
          >
            Share rate {share} · Insights →
          </Link>
        ) : (
          <Unrecorded reason="The licence copy was not read or carries no share rate, so none is shown.">
            Share rate not recorded
          </Unrecorded>
        )}
      </p>
    </section>
  );
}

export default StudioNeedsDecisionView;
