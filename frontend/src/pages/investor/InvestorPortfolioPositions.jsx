import { useCallback, useEffect, useMemo, useState } from 'react';
import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import './investorPortfolioCanvas.css';
import './investorPortfolioPositions.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';

const money = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  const amount = Number(value);
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (Math.abs(amount) >= 1_000) return `$${Math.round(amount / 1_000)}k`;
  return `$${Math.round(amount).toLocaleString()}`;
};
const ratio = (value) => value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : `${Number(value).toFixed(2)}×`;
const title = (value, fallback = 'Not recorded') => String(value ?? '').trim().replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || fallback;
const daysSince = (value) => {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? Math.max(0, Math.floor((Date.now() - at) / 86400000)) : null;
};
const healthLabel = (badge) => badge === 'red' ? 'Red' : badge === 'yellow' ? 'Amber' : badge === 'green' ? 'Green' : 'Not recorded';
const healthRank = (row) => row.health?.badge === 'red' ? 0 : row.health?.badge === 'yellow' ? 1 : row.marked_down ? 2 : row.overdue ? 3 : row.health?.badge === 'green' ? 4 : 5;

export default function InvestorPortfolioPositions() {
  const [filter, setFilter] = useState('attention');
  const [stage, setStage] = useState('all');
  // The `Mark history` op's own state. `null` = never asked; UNREADABLE = asked
  // and the read failed, which must not render as "no marks".
  const [marks, setMarks] = useState(null);
  const [state, setState] = useState({ loading: true, error: '', positions: [], analytics: null, health: null, updates: [], unavailable: { analytics: false, health: false, updates: false } });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const positionsResult = await api.positionsList();
      const optional = await Promise.allSettled([api.positionsAnalytics(), api.portfolioHealthList({}), api.portfolioUpdatesList()]);
      setState({
        loading: false,
        error: '',
        positions: Array.isArray(positionsResult?.items) ? positionsResult.items : [],
        analytics: optional[0].status === 'fulfilled' ? optional[0].value : null,
        health: optional[1].status === 'fulfilled' ? optional[1].value : null,
        updates: optional[2].status === 'fulfilled' && Array.isArray(optional[2].value?.items) ? optional[2].value.items : [],
        unavailable: { analytics: optional[0].status === 'rejected', health: optional[1].status === 'rejected', updates: optional[2].status === 'rejected' },
      });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error?.message || 'The positions book could not be loaded.' }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /**
   * `Mark history` — the op that used to be a gap.
   *
   * Toggling closed sets `null` rather than an empty list, so a reopened panel
   * re-reads instead of showing a stale book. A failed read is its own state:
   * an empty history and an unreadable one are different facts and a reader
   * cannot tell them apart from an empty table.
   */
  const markHistory = useCallback(() => {
    setMarks((current) => {
      if (current !== null) return null;
      api.positionsMarkHistory().then(
        (r) => setMarks({ items: Array.isArray(r?.items) ? r.items : [], basis: r?.basis_counts || {}, projects: r?.projects ?? null }),
        () => setMarks({ error: true }),
      );
      return { loading: true };
    });
  }, []);

  const rows = useMemo(() => {
    const healthByProject = new Map((state.health?.items || []).map((item) => [String(item.project_id), item]));
    const lastUpdateByProject = new Map();
    state.updates.forEach((update) => {
      const date = update.submitted_at || update.updated_at || update.created_at;
      const current = lastUpdateByProject.get(String(update.project_id));
      if (date && (!current || new Date(date) > new Date(current))) lastUpdateByProject.set(String(update.project_id), date);
    });
    return state.positions.map((position) => {
      const health = healthByProject.get(String(position.project_id)) || null;
      const lastUpdate = lastUpdateByProject.get(String(position.project_id)) || null;
      const updateDays = daysSince(lastUpdate);
      const overdue = updateDays !== null && updateDays > 30;
      return { ...position, health, lastUpdate, updateDays, overdue, needsAttention: Boolean(position.marked_down || health?.intervention || health?.badge === 'red' || health?.badge === 'yellow' || overdue) };
    }).sort((a, b) => healthRank(a) - healthRank(b) || (b.updateDays ?? -1) - (a.updateDays ?? -1));
  }, [state.positions, state.health, state.updates]);
  const stages = [...new Set(rows.map((row) => row.project?.stage).filter(Boolean))].sort();
  const visible = rows.filter((row) => {
    if (filter === 'attention') return row.needsAttention;
    if (filter === 'marked') return row.marked_down;
    if (filter === 'stage') return stage === 'all' || row.project?.stage === stage;
    return true;
  });
  const invested = rows.reduce((sum, row) => sum + (Number(row.total_invested) || 0), 0);
  const carryingValue = rows.reduce((sum, row) => sum + (Number(row.fmv) || 0), 0);
  const attentionPartial = state.unavailable.health || state.unavailable.updates;
  const needsAttention = rows.filter((row) => row.needsAttention).length;
  const red = rows.filter((row) => row.health?.badge === 'red').length;
  const amber = rows.filter((row) => row.health?.badge === 'yellow').length;
  const latestMark = rows.map((row) => row.mark_as_of).filter(Boolean).sort().at(-1);
  const anyPartial = Object.values(state.unavailable).some(Boolean);

  return <div className="i4-shell ip1-shell"><main className="i4-portfolio ip1-positions" data-testid="investor-portfolio-positions">
    <header className="i4-heading"><div><h1>Positions book</h1><p>Lots, marks history and ownership changes from the investor-accessible portfolio ledger.</p></div><button type="button" className="i4-icon-button" onClick={load} aria-label="Refresh positions book"><RefreshCw size={15} /></button></header>
    <ZoneNav bucket={bucketForPath('investor', '/portfolio')} role="investor" className="my-3" />
    {/* All four predicates are real and none of them moved. The stage
        `<select>` stays where it was, below, because `By stage` reveals a
        control rather than applying one — there is no single stage a chip
        could pick for you. */}
    <ZoneToolbar
      role="investor"
      className="mb-3"
      filters={investorZoneFilters('portfolio/positions', { value: filter, onChange: setFilter })}
      actions={investorZoneActions('portfolio/positions', { handlers: { markHistory }, view: { header: ['Company', 'Stage', 'Invested', 'FMV', 'Multiple', 'Mark basis'], rows, cells: (r) => [r.project?.name, r.project?.stage, r.total_invested, r.fmv, r.multiple, r.mark_basis] } })}
    />
    {state.error && <div className="i4-error" data-testid="status-investor-positions-error"><span>{String(state.error).toLowerCase() === 'not found' ? 'Position source unavailable in local development. No empty portfolio claim is being made.' : state.error}</span><button type="button" onClick={load}>Retry</button></div>}
    {anyPartial && !state.loading && <div className="i4-partial" data-testid="status-investor-positions-partial">Some supporting portfolio sources are unavailable. Affected metrics and cells are labelled rather than treated as zero.</div>}
    {state.loading ? <Skeleton /> : !state.error && <>{filter === 'stage' && <div className="ip1-filters"><label>Stage<select value={stage} onChange={(event) => setStage(event.target.value)}><option value="all">All recorded stages</option>{stages.map((item) => <option key={item} value={item}>{title(item)}</option>)}</select></label></div>}
      <section className="i4-stats"><Stat label="Invested" value={money(invested)} note="Recorded cost basis, including follow-ons" /><Stat label="Current FMV" value={money(carryingValue)} note={latestMark ? `Latest mark in book: ${latestMark}` : rows.length ? 'Unmarked positions carried at cost' : 'No positions recorded'} /><Stat label="TVPI · gross" value={state.unavailable.analytics ? 'Unavailable' : ratio(state.analytics?.tvpi)} note={state.unavailable.analytics ? 'Analytics source unavailable' : `DPI ${ratio(state.analytics?.dpi)} · gross of fees and carry`} /><Stat label="Needs attention" value={attentionPartial ? `≥ ${needsAttention}` : needsAttention} note={state.unavailable.health ? 'Health source unavailable' : `${red} red, ${amber} amber`} /></section>
      <section className="i4-card i4-positions ip1-ledger"><div className="i4-section-head"><div><h2>Positions</h2><p>{filter === 'attention' ? 'Sorted by recorded attention signals, worst first' : `${visible.length} visible of ${rows.length} recorded positions`}</p></div><span>Read-only ledger</span></div><PositionsTable rows={visible} healthUnavailable={state.unavailable.health} updatesUnavailable={state.unavailable.updates} filter={filter} /><p className="i4-seam-note"><span>Valuation boundary</span> FMV uses the latest stored mark. Unmarked positions are carried at cost and labelled as such; realised cash remains separate in DPI.</p></section>
      {/* WAS a card asserting "History remains read-only on this collection"
          and that IP1 "does not ... write marks, add follow-ons, or accept an
          AI-generated performance narrative". Read-only is right and the rest
          was not: the mark HISTORY is stored and was already being served to
          this reader, so refusing to show it was a claim about the product
          that the product contradicted. The panel below opens it. */}
      <MarkHistory state={marks} onClose={markHistory} />
      {/* The artboard's band, footed "Traces to the mark-history rows" — which
          is the history the ops row above used to say did not exist. */}
      <ZoneDraft
        surface="portfolio/positions"
        label="Proposal · explain the multiple’s move"
        accept="Accept narrative"
        run="Draft the narrative"
        foot="Traces to the mark-history rows."
        empty="A narrative built from the marking events themselves — which company, on what date, on what basis — rather than from portfolio-wide momentum the record does not show."
        nothingToDraft="No marking event is recorded against an accessible position, so there is no move to explain."
      />
      <section className="i4-card ip1-unavailable"><div className="i4-section-head"><div><h2>What this book will not do</h2><p>Read-only, and specific about which writes are elsewhere</p></div></div><strong>Every valuation and ownership write is an admin action.</strong><p>A mark is appended by an admin against a position, and a follow-on is a new round on that position — both are recorded through the governed write path, not from this book. This page reads them: the history below carries each mark with the date it speaks for, the event behind it and the basis it was arrived at on, because a round-priced mark and a GP estimate must not look alike.</p></section>
      {state.analytics?.unmarked_position_count > 0 && <div className="i4-coverage">{state.analytics.unmarked_position_count} of {state.analytics.position_count} positions have no valuation mark and are carried at cost{state.analytics.mark_coverage != null ? ` · ${Math.round(state.analytics.mark_coverage * 100)}% mark coverage` : ''}.</div>}
      <footer className="i4-boundary">Investor workspace · data shown is restricted to this investor’s accessible position book.</footer>
    </>}
  </main><PositionsRail rows={rows} analytics={state.analytics} unavailable={state.unavailable} sourceError={state.error} /></div>;
}

function PositionsTable({ rows, healthUnavailable, updatesUnavailable, filter }) {
  if (!rows.length) return <div className="i4-empty"><AlertCircle size={16} />{filter === 'all' ? 'No accessible positions have been recorded.' : `No positions match the ${filter === 'attention' ? 'needs attention' : filter === 'marked' ? 'marked down' : 'selected stage'} filter.`}</div>;
  return <div className="i4-table-wrap"><table><thead><tr><th>Company</th><th>Stage</th><th>Invested</th><th>FMV</th><th>Multiple</th><th>Health</th><th>Last update</th></tr></thead><tbody>{rows.map((row) => <tr key={row.project_id} data-testid={`row-investor-position-ledger-${row.project_id}`}><td><strong>{row.project?.name || `Startup ${row.project_id}`}</strong><small>{row.marked_down ? 'Marked down' : row.unmarked ? 'Carried at cost' : row.mark_basis ? `Mark basis: ${title(row.mark_basis)}` : 'Mark basis not recorded'}</small></td><td>{title(row.project?.stage)}</td><td>{money(row.total_invested)}</td><td>{money(row.fmv)}{row.unmarked && <small>At cost</small>}</td><td className={Number(row.multiple) < 1 ? 'i4-down' : 'i4-up'}>{ratio(row.multiple)}</td><td>{healthUnavailable ? <span className="ip1-health">Unavailable</span> : <span className={`ip1-health is-${row.health?.badge || 'unknown'}`}>{healthLabel(row.health?.badge)}</span>}</td><td>{updatesUnavailable ? 'Unavailable' : row.updateDays === null ? 'Not recorded' : <>{row.updateDays} d{row.overdue && <span className="ip1-overdue">Overdue</span>}</>}</td></tr>)}</tbody></table></div>;
}
/**
 * The mark history the ops row used to say did not exist.
 *
 * FOUR STATES, AND THEY ARE NOT THREE. `null` is closed; `{loading}` is asked;
 * `{error}` is asked and unreadable; a list is the answer. Collapsing the last
 * two loses the distinction between "this book has no marks" and "the marks
 * could not be read", which on a valuation page is the difference between a
 * fact and a silence.
 *
 * THE BASIS IS THE COLUMN THIS PANEL EXISTS FOR. `portfolio_marks.basis` is
 * round_price | secondary | gp_estimate | write_down | cost, and the schema
 * says why: a round-priced mark and a GP estimate must never look alike to an
 * LP. A row whose basis is NULL predates the column's default and renders as
 * unrecorded — reporting it as a GP estimate would invent the provenance.
 */
function MarkHistory({ state, onClose }) {
  if (state === null) return null;
  return (
    <section className="i4-card ip1-marks" data-testid="ip1-mark-history">
      <div className="i4-section-head">
        <div>
          <h2>Mark history</h2>
          <p>Every marking event across the accessible book, newest first</p>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {state.loading && <div className="i4-skeleton" aria-busy="true"><i /><i /></div>}
      {state.error && (
        <div className="i4-error" data-testid="ip1-mark-history-error">
          <span>The mark history could not be read. That is not a claim that the book has no marks.</span>
        </div>
      )}
      {state.items && (state.items.length === 0
        ? <div className="i4-empty"><AlertCircle size={16} />No marking event is recorded against an accessible position. The book carries positions at cost until one is.</div>
        : (
          <>
            <div className="i4-table-wrap">
              <table>
                <thead><tr><th>Company</th><th>As of</th><th>FMV</th><th>Event</th><th>Basis</th><th>Source</th></tr></thead>
                <tbody>
                  {state.items.map((m) => (
                    <tr key={m.uid} data-testid={`row-ip1-mark-${m.uid}`}>
                      <td><strong>{m.project_name || `Startup ${m.project_id}`}</strong></td>
                      <td>{m.as_of_date || 'Not recorded'}</td>
                      <td>{money(m.fmv)}{m.post_money != null && <small>Post {money(m.post_money)}</small>}</td>
                      <td>{m.event || 'Not recorded'}</td>
                      <td>{m.basis ? title(m.basis) : 'Not recorded'}</td>
                      <td>{m.source || m.note || 'Not recorded'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="i4-seam-note">
              <span>Why the basis is a column</span>
              {Object.entries(state.basis).map(([k, n]) => `${n} ${k === 'unrecorded' ? 'unrecorded' : title(k).toLowerCase()}`).join(' · ')}
              {' — a round-priced mark and a GP estimate are both marks and are not the same evidence, so they are never shown alike.'}
            </p>
          </>
        ))}
    </section>
  );
}

function Stat({ label, value, note }) { return <article className="i4-stat"><div><span>{label}</span><b>{value}</b><small>{note}</small></div></article>; }
function PositionsRail({ rows, analytics, unavailable, sourceError }) {
  return (
    <WorkerRail
      workspace="Portfolio"
      role="investor"
      className="i4-rail"
      stance="Read-only positions ledger"
      note="Figures come from stored lots, marks, distributions, health snapshots and founder-submitted updates. Nothing here changes cost basis, FMV, ownership or narrative."
      coverage={[
        sourceError ? 'Position source unavailable' : `${rows.length} accessible position${rows.length === 1 ? '' : 's'}`,
        unavailable.analytics ? 'Return analytics unavailable'
          : analytics?.mark_coverage == null ? 'Mark coverage not recorded'
            : `${Math.round(analytics.mark_coverage * 100)}% carry an explicit current mark`,
      ]}
      coverageNote={sourceError
        ? 'The backend does not expose the positions ledger, so this page does not present an empty book as fact.'
        : undefined}
      unavailable={[
        ['Mark history and follow-ons', 'Governed write workflows, not exposed by this read-only collection.'],
        ['Outbound', 'No marks, ownership records or founder updates are changed here.'],
      ]}
    />
  );
}
function Skeleton() { return <div className="i4-skeleton" aria-busy="true"><i /><i /><i /><i /></div>; }