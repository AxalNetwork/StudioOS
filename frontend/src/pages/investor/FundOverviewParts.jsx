/**
 * #6234 (D6234) — the Fund overview's blocks (IF0): the four tiles, the
 * Overview / This quarter / Gaps filter, the quarterly chart from issued
 * snapshots and the list of what the next pack still lacks. `FundOverviewPanel`
 * is what `InvestorFundLanding` mounts for the chosen fund; `Tiles` and
 * `GapList` are shared with the quarterly history (`FundHistoryPage.jsx`).
 * The rules live in `fundOverviewModel.js`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { Unreadable } from '../../ui';
import FundQuarterChart from './FundQuarterChart';
import { FILTERS, NOT_RECORDED, chartGroups, money, overviewTiles, packGaps, quarterRows } from './fundOverviewModel';
import './fundOverview.css';

/** Read a fund's reporting periods: `null` while loading, an array, or `'unreadable'`. */
export function useReportPeriods(fundId) {
  const [periods, setPeriods] = useState(null);
  const load = useCallback(() => {
    if (fundId == null) return undefined;
    let live = true;
    setPeriods(null);
    api.fundsReportPeriods(fundId)
      .then((r) => {
        const items = r?.items || r?.periods;
        if (live) setPeriods(Array.isArray(items) ? items : 'unreadable');
      })
      .catch(() => { if (live) setPeriods('unreadable'); });
    return () => { live = false; };
  }, [fundId]);
  useEffect(() => load(), [load]);
  return { periods, reload: load };
}

export function NotRecorded({ reason, testid }) {
  return (
    <span className="fo-nr-block" data-testid={testid}>
      <span className="fo-nr">{NOT_RECORDED}</span>
      {reason ? <small>{reason}</small> : null}
    </span>
  );
}

/** Tiles: `[{ key, label, cents, reason, basis, value? }]`. A tile with `value` shows that text instead of money. */
export function Tiles({ tiles, testPrefix = 'tile' }) {
  return (
    <section className="fo-tiles" aria-label="Fund figures">
      {tiles.map((t) => (
        <div className="fo-tile" key={t.key} data-testid={`${testPrefix}-${t.key}`}>
          <span className="fo-tile-label">{t.label}</span>
          {t.value != null
            ? <b>{t.value}</b>
            : t.cents == null
              ? <NotRecorded reason={t.reason} testid={`${testPrefix}-${t.key}-reason`} />
              : <b>{money(t.cents)}</b>}
          <small>{t.basis}</small>
        </div>
      ))}
    </section>
  );
}

/** What the next pack still lacks. `gaps` is `packGaps(...)`; `periods === 'unreadable'` says so instead. */
export function GapList({ gaps, unreadable, onRetry, openOnly = false }) {
  const rows = gaps?.rows;
  const open = rows ? rows.filter((r) => !r.done).length : null;
  return (
    <section className="fo-card fo-gaps" data-testid="fund-pack-gaps">
      <header>
        <h2>What the next pack still lacks</h2>
        <span>{gaps?.quarter ? `${gaps.quarter.label} · ` : ''}{open == null ? 'from the period records' : `${open} open`}</span>
      </header>
      {unreadable
        ? <Unreadable what="The reporting archive" claim="No gap is claimed open or closed." onRetry={onRetry} />
        : !rows
          ? <div className="fo-skeleton" />
          : (
            <ul>
              {rows.filter((r) => !openOnly || !r.done).map((r) => (
                <li key={r.key} className={r.done ? 'fo-done' : 'fo-open'} data-testid={`gap-${r.key}`} data-done={r.done ? 'true' : 'false'}>
                  <span className="fo-check" aria-hidden="true">{r.done ? <Check size={11} /> : null}</span>
                  <div><b>{r.label}</b><small>{r.detail}</small></div>
                  {!r.done && r.href ? <Link className="fo-fix" to={r.href} data-testid={`gap-${r.key}-fix`}>{r.action} <ArrowUpRight size={12} /></Link> : null}
                  <span className="sr-only">{r.done ? 'Done' : 'Open'}</span>
                </li>
              ))}
              {openOnly && open === 0 ? <li className="fo-done"><div><b>Nothing open.</b><small>Every check for the next pack is met.</small></div></li> : null}
            </ul>
          )}
    </section>
  );
}

function ChartCard({ periods, fundId, onRetry }) {
  const groups = useMemo(() => (Array.isArray(periods) ? chartGroups(periods) : []), [periods]);
  const drafts = Array.isArray(periods) ? periods.filter((p) => String(p?.status || '').toLowerCase() !== 'issued').length : 0;
  return (
    <section className="fo-card fo-chart-card" data-testid="fund-overview-chart">
      <header>
        <h2>Fund size by issued quarter</h2>
        <Link to={`/funds/history?fund=${encodeURIComponent(String(fundId))}`} data-testid="link-fund-history">Quarterly history <ArrowUpRight size={12} /></Link>
      </header>
      {periods === 'unreadable'
        ? <Unreadable what="The reporting archive" claim="This is not a claim that nothing was issued." onRetry={onRetry} />
        : periods === null
          ? <div className="fo-skeleton" />
          : groups.length === 0
            ? <p className="fo-empty" data-testid="text-chart-empty">No issued quarterly snapshot. Not recorded is not $0 committed and not $0 deployed.{drafts ? ` ${drafts} draft${drafts === 1 ? ' is' : 's are'} on record and never plotted.` : ''}</p>
            : <FundQuarterChart groups={groups} compact />}
      {groups.length > 0 && drafts > 0 ? <p className="fo-foot">{drafts} draft{drafts === 1 ? '' : 's'} on the history page, never on this chart.</p> : null}
    </section>
  );
}

function QuarterCard({ periods, today, quarter }) {
  const rows = Array.isArray(periods) ? quarterRows(periods, today) : [];
  return (
    <section className="fo-card" data-testid="fund-quarter-periods">
      <header><h2>{quarter ? quarter.label : 'This quarter'}</h2><span>the quarter the next pack reports on</span></header>
      {periods === null ? <div className="fo-skeleton" /> : periods === 'unreadable' ? null : rows.length === 0
        ? <p className="fo-empty">No period is recorded for {quarter ? quarter.label : 'this quarter'}.</p>
        : (
          <ul className="fo-qrows">
            {rows.map((r) => (
              <li key={r.id ?? r.label}>
                <b>{r.label}</b>
                <span className={`fo-pill ${r.status}`}>{r.status === 'issued' ? `Issued ${r.issuedOn || ''}`.trim() : 'Draft'}</span>
                <small>Committed {r.figures.committed.cents == null ? NOT_RECORDED : money(r.figures.committed.cents)} · NAV {r.figures.nav.cents == null ? NOT_RECORDED : money(r.figures.nav.cents)}</small>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/** IF0 for one fund. `today` is injectable for tests; the page passes nothing. */
export default function FundOverviewPanel({ fund, today }) {
  const now = useMemo(() => today || new Date(), [today]);
  const [filter, setFilter] = useState('overview');
  const { periods, reload } = useReportPeriods(fund?.id);
  const tiles = useMemo(() => overviewTiles(fund), [fund]);
  const gaps = useMemo(() => packGaps({ fundId: fund?.id, periods: Array.isArray(periods) ? periods : null, today: now }), [fund?.id, periods, now]);
  const unreadable = periods === 'unreadable';
  return (
    <div className="fo-panel" data-testid="fund-overview-panel">
      <div className="fo-filters" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)} data-testid={`filter-overview-${f.value}`}>{f.label}</button>
        ))}
      </div>
      {filter !== 'gaps' ? <Tiles tiles={tiles} /> : null}
      <div className={filter === 'overview' ? 'fo-split' : 'fo-stack'}>
        {filter === 'overview' ? <ChartCard periods={periods} fundId={fund?.id} onRetry={reload} /> : null}
        {filter === 'quarter' ? <QuarterCard periods={periods} today={now} quarter={gaps.quarter} /> : null}
        <GapList gaps={gaps} unreadable={unreadable} onRetry={reload} openOnly={filter === 'gaps'} />
      </div>
    </div>
  );
}
