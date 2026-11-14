/**
 * D4817 part 2 (#5311, canvas PF-02): Positions, the investor's investment
 * register, in the shared Portfolio frame (`../portfolio/PortfolioFrame.jsx`).
 *
 * A · The register: invested, ownership, latest FMV, multiple, mark date and
 * basis, reporting and health for every recorded position, with mark
 * coverage, stale marks and unusable marks as three separate counts above it.
 * No mark recorded reads as such, and the total says which positions it
 * includes at cost. The book can be read as of a date (addendum PFA06): the
 * positions read honours it; health and reporting stay current reads with
 * their own dates.
 *
 * B · Mark history for one company, in the shared Sheet, with what "stale"
 * means. The book-wide history stays one toolbar action away.
 *
 * Every read stands alone (`usePortfolioReads`): a failed source labels its
 * own column or panel Unreadable with a Retry, and never reads as zero or as
 * an empty book. A Worker `detail` never reaches the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { titleCase } from '../../lib/absence';
import { WorkerRail } from '../../ui';
import Sheet from '../../ui/Sheet.jsx';
import { ZoneHeaderTools } from '../../workspaces/ZoneHeader';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';
import FromMercury from './FromMercury';
import PortfolioFrame from '../portfolio/PortfolioFrame';
import { usePortfolioReads } from '../portfolio/usePortfolioReads';
import { HealthStatus, ObligationStatus, Skeleton, SourceFailure } from '../portfolio/PortfolioParts';
import {
  NOT_RECORDED, SHAPES, ageWords, attentionOf, attentionRulesOf, basisLabel, day, filterRegister, markCountsOf, markHistoryOf,
  markReference, money, registerRowsOf, registerTotalOf,
} from '../portfolio/portfolioModel';

const companyHref = (uid) => `/portfolio/companies/${encodeURIComponent(uid)}`;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The reads, with the book's as-of date on the positions read only. */
const sourcesFor = (asOf) => ({
  positions: { call: () => api.positionsList(asOf || undefined), shape: SHAPES.positions },
  health: { call: () => api.portfolioHealthList({}), shape: SHAPES.health },
  updates: { call: () => api.portfolioUpdatesLatest(), shape: SHAPES.updates },
  compliance: { call: () => api.positionsKpiCompliance(), shape: SHAPES.compliance },
});

const SOURCE_NAMES = { health: 'Health', compliance: 'Reporting', updates: 'Founder updates' };

/**
 * The toolbar's four filters (`investorZoneFilters('portfolio/positions')`).
 * Needs attention is the Overview's queue (`r.attention`), so both pages
 * answer from one rule set (audit F-05).
 */
const REGISTER_FILTERS = {
  all: () => true,
  attention: (r) => r.attention,
  marked: (r) => r.below,
  stage: (r, stage) => stage === 'all' || r.stage === stage,
};

const NotRecorded = ({ children = NOT_RECORDED, title }) => <span className="pf-not-recorded" title={title}>{children}</span>;

/** "Read the book as of": the date the positions read and its totals honour. */
function AsOfBar({ asOf, onApply, compliance }) {
  const [draft, setDraft] = useState(asOf);
  useEffect(() => { setDraft(asOf); }, [asOf]);
  const quarterEnd = compliance.state === 'ok' && compliance.value.period_until && compliance.value.period_complete !== false
    ? { period: compliance.value.period, until: compliance.value.period_until } : null;
  return (
    <form className="pf-asof" onSubmit={(e) => { e.preventDefault(); if (ISO_DAY.test(draft)) onApply(draft); }} data-testid="positions-as-of">
      <label htmlFor="pf-positions-asof">Read the book as of</label>
      <input id="pf-positions-asof" type="date" value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="input-positions-as-of" />
      <button type="submit" className="pf-btn is-primary" disabled={!ISO_DAY.test(draft) || draft === asOf} data-testid="button-positions-as-of">Apply date</button>
      {quarterEnd && quarterEnd.until !== asOf ? (
        <button type="button" className="pf-btn" onClick={() => onApply(quarterEnd.until)} data-testid="button-positions-quarter-end">{quarterEnd.period} end · {day(quarterEnd.until)}</button>
      ) : null}
      {asOf ? <button type="button" className="pf-btn is-quiet" onClick={() => onApply('')} data-testid="button-positions-latest">Latest marks</button> : null}
      <p className="pf-foot">{asOf
        ? `Positions, marks and the total are read as of ${day(asOf)}. Health and reporting are current reads with their own dates.`
        : 'Positions read the latest recorded mark of each company. Health and reporting are current reads with their own dates.'}</p>
    </form>
  );
}

/** One of the three counts above the register. */
function Count({ id, label, count, note }) {
  let value;
  if (count.state === 'loading') value = <span className="pf-muted">Reading…</span>;
  else if (count.state === 'unreadable') value = <span className="pf-unreadable">Unreadable</span>;
  else if (count.state === 'not_recorded') value = <NotRecorded />;
  else value = count.value;
  return (
    <div className="pf-metric" data-testid={`positions-count-${id}`} data-state={count.state}>
      <small>{label}</small>
      <b>{value}</b>
      <em>{count.state === 'ok' ? note : count.reason || null}</em>
    </div>
  );
}

function MarkCounts({ counts }) {
  const { coverage, stale, unusable } = counts;
  const list = (items, more) => (items.length ? `${items.slice(0, 2).join(', ')}${items.length > 2 ? ` and ${items.length - 2} more` : ''}${more}` : null);
  return (
    <section className="pf-counts" aria-label="Marks in this book">
      <Count id="coverage" label="Mark coverage" count={coverage.state === 'ok' ? { ...coverage, value: `${coverage.marked} of ${coverage.total}` } : coverage}
        note={coverage.state === 'ok' ? `${coverage.pct}%${coverage.unmarked.length ? ` · ${list(coverage.unmarked, ' at cost')}` : ' · every position marked'}` : null} />
      <Count id="stale" label="Stale marks (older than two quarters)" count={stale.state === 'ok' ? { ...stale, value: String(stale.count) } : stale}
        note={stale.state === 'ok' ? (stale.count ? stale.items.slice(0, 2).map((s) => `${s.name} · ${s.date}`).join('; ') : `None older than two quarters at ${stale.reference}`) : null} />
      <Count id="unusable" label="Marks that cannot be used" count={unusable.state === 'ok' ? { ...unusable, value: String(unusable.count) } : unusable}
        note={unusable.state === 'ok' ? (unusable.count ? `${list(unusable.items, '')} · carried at cost` : 'Measured: every recorded mark is usable') : null} />
    </section>
  );
}

function FmvCell({ r }) {
  if (r.mark.kind === 'marked') return <>{r.fmv}</>;
  return (
    <>
      <NotRecorded title={r.mark.kind === 'unusable' ? r.mark.reason : undefined}>{r.mark.kind === 'unusable' ? 'Mark not usable' : 'No mark recorded'}</NotRecorded>
      <small>At cost for NAV</small>
      {r.mark.kind === 'unusable' ? <small className="pf-reason">{r.mark.reason}</small> : null}
    </>
  );
}

function MarkDateCell({ r, onOpen }) {
  const label = r.mark.kind === 'marked' ? (r.markDate || NOT_RECORDED) : NOT_RECORDED;
  const body = r.uid ? (
    <button type="button" className="pf-link-button pf-mark-open" onClick={() => onOpen(r)} aria-label={`Mark history for ${r.name}`} data-testid={`button-mark-history-${r.key}`}>{label}</button>
  ) : <span className={r.mark.kind === 'marked' && r.markDate ? 'pf-mono' : 'pf-not-recorded'}>{label}</span>;
  return (
    <>
      {body}
      {r.stale ? <span className="pf-chip is-late pf-stale-chip" data-testid={`stale-${r.key}`}>Stale · {ageWords(r.ageDays)}</span> : null}
    </>
  );
}

function Register({ rows, total, asOf, filter, setFilter, query, setQuery, stage, setStage, onOpen, markHistory }) {
  const shown = filterRegister(rows, { query, keep: (r) => (REGISTER_FILTERS[filter] || REGISTER_FILTERS.all)(r, stage) });
  const stages = [...new Set(rows.map((r) => r.stage).filter(Boolean))].sort();
  const periods = [...new Set(rows.map((r) => r.reporting.period).filter(Boolean))];
  const period = periods.length === 1 ? periods[0] : null;
  const view = {
    header: ['Company', 'Stage', 'Invested', 'Ownership', 'Latest FMV', 'Multiple', 'Mark date', 'Basis', 'Reporting', 'Health'],
    rows: shown,
    cells: (r) => [
      r.name, titleCase(r.stage) || NOT_RECORDED, r.invested || NOT_RECORDED, r.ownership || NOT_RECORDED,
      r.fmv || (r.mark.kind === 'unusable' ? `Mark not usable; at cost ${r.atCost || NOT_RECORDED}` : `No mark recorded; at cost ${r.atCost || NOT_RECORDED}`),
      r.multiple || NOT_RECORDED, r.markDate || NOT_RECORDED, r.basis || (r.mark.kind === 'marked' ? NOT_RECORDED : 'At cost'),
      r.reporting.state, r.health.state,
    ],
  };
  return (
    <section className="pf-card pf-table-card" aria-labelledby="pf-register-title" data-testid="positions-register">
      <div className="pf-card-head">
        <h2 id="pf-register-title">Investment register</h2>
        <div className="pf-tools">
          <label className="pf-search"><Search size={13} aria-hidden="true" /><span className="pf-sr">Search positions</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies" data-testid="input-positions-search" />
          </label>
          {filter === 'stage' ? (
            <label className="pf-select"><span className="pf-sr">Stage</span>
              <select value={stage} onChange={(e) => setStage(e.target.value)} data-testid="select-positions-stage">
                <option value="all">All recorded stages</option>
                {stages.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </div>
      <ZoneToolbar
        role="investor"
        className="pf-toolbar"
        filters={investorZoneFilters('portfolio/positions', { value: filter, onChange: setFilter })}
        actions={investorZoneActions('portfolio/positions', { handlers: { markHistory }, view })}
      />
      {rows.length === 0 ? (
        <p className="pf-note" data-testid="positions-empty">No position is recorded for this investor account yet. Positions appear here once a confirmed commitment is recorded.</p>
      ) : (
        <div className="pf-table-wrap">
          <table className="pf-table pf-register">
            <caption>Investment register · gross · {asOf ? `as of ${day(asOf)}` : 'latest recorded marks'} · {shown.length} of {rows.length}</caption>
            <thead><tr>
              <th scope="col">Company</th><th scope="col" className="n">Invested</th><th scope="col" className="n">Ownership</th>
              <th scope="col" className="n">Latest FMV</th><th scope="col" className="n">Multiple</th><th scope="col">Mark date</th>
              <th scope="col">Basis</th><th scope="col">Reporting{period ? <span className="pf-th-sub"> · {period}</span> : null}</th><th scope="col">Health</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} data-testid={`row-investor-position-ledger-${r.key}`}>
                  <th scope="row" data-label="Company">
                    {r.uid ? <Link className="pf-co" to={companyHref(r.uid)}>{r.name}</Link> : <span className="pf-co">{r.name}</span>}
                    {r.stage ? <small>{titleCase(r.stage)}</small> : null}
                  </th>
                  <td className="n" data-label="Invested">{r.invested || <NotRecorded />}</td>
                  <td className="n" data-label="Ownership">{r.ownership || <NotRecorded />}</td>
                  <td className="n" data-label="Latest FMV"><FmvCell r={r} /></td>
                  <td className={`n${r.below ? ' is-below' : ''}`} data-label="Multiple">
                    {r.multiple || <NotRecorded />}{r.multiple && r.mark.kind !== 'marked' ? <small>At cost</small> : null}{r.below ? <small>Below cost</small> : null}
                  </td>
                  <td data-label="Mark date"><MarkDateCell r={r} onOpen={onOpen} /></td>
                  <td data-label="Basis">{r.basis || (r.mark.kind === 'marked' ? <NotRecorded /> : <span className="pf-muted">At cost</span>)}</td>
                  <td data-label={period ? `Reporting · ${period}` : 'Reporting'}><ObligationStatus reporting={r.reporting} compact={Boolean(period)} /></td>
                  <td data-label="Health"><HealthStatus health={r.health} /></td>
                </tr>
              ))}
              {shown.length === 0 ? <tr><td colSpan={9} className="pf-note" data-testid="positions-no-match">No position matches these filters. {rows.length} {rows.length === 1 ? 'is' : 'are'} recorded.</td></tr> : null}
              {total ? (
                <tr className="pf-total" data-testid="positions-total">
                  <th scope="row" data-label="Total">Total · {total.count} position{total.count === 1 ? '' : 's'}</th>
                  <td className="n" data-label="Invested">{total.invested}</td>
                  <td className="n pf-hide-phone" aria-hidden="true" />
                  <td className="n" data-label="Carrying value">{total.carrying}</td>
                  <td className="n" data-label="Multiple">{total.multiple || <NotRecorded />}{total.multiple ? <small>carrying ÷ invested</small> : null}</td>
                  <td colSpan={4} className="pf-total-note" data-testid="positions-total-note">
                    {total.atCost.length
                      ? `${total.atCost.map((a) => `${a.name}${a.cost ? ` (${a.cost})` : ''}`).join(', ')} included at cost: no usable mark is recorded.`
                      : 'Every position is carried at a recorded mark.'}
                    {total.missingCost ? ` ${total.missingCost} position${total.missingCost === 1 ? ' has' : 's have'} no recorded cost and ${total.missingCost === 1 ? 'is' : 'are'} left out of the totals.` : ''}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="pf-foot">Values are gross of fees and carry. The total is the sum of the rows above; a position with no usable mark carries at cost. Ownership is read from each company’s recorded rounds. This view never edits them.</p>
    </section>
  );
}

/**
 * The attention rules and the evidence each one found (addendum PFA06).
 * Signals stay distinct: a stale update is not a late reporting obligation.
 */
function AttentionRules({ rules, retry }) {
  const cell = (rule) => {
    if (rule.state === 'loading') return <span className="pf-muted">Reading…</span>;
    if (rule.state !== 'ok') {
      return (
        <span className="pf-unreadable" data-testid={`rule-${rule.key}-unreadable`}>Unreadable · {rule.source} could not be read. Not a claim that nothing fired.
          {' '}<button type="button" className="pf-link-button" onClick={() => retry(rule.retry)}>Retry</button></span>
      );
    }
    return (
      <>
        {rule.hits.length === 0 ? <span className="pf-muted">No company in the book</span> : (
          <ul className="pf-rule-hits">{rule.hits.map((x) => <li key={x.key}><b>{x.name}</b> {x.text}</li>)}</ul>
        )}
        {rule.partial?.length ? <small className="pf-muted">History for {rule.partial.join(', ')} could not be read.</small> : null}
      </>
    );
  };
  return (
    <section className="pf-card pf-table-card" aria-labelledby="pf-rules-title" data-testid="positions-attention-rules">
      <div className="pf-card-head">
        <h2 id="pf-rules-title">Attention rules and evidence</h2>
        <Link className="pf-btn is-quiet" to="/portfolio" data-testid="link-positions-overview-attention">Needs attention on the Overview</Link>
      </div>
      <div className="pf-table-wrap">
        <table className="pf-table pf-rules">
          <caption>Signals stay distinct · a stale update is not a late reporting obligation</caption>
          <thead><tr><th scope="col">Rule</th><th scope="col">Queue reason</th><th scope="col">Evidence and date</th></tr></thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.key} data-testid={`rule-${rule.key}`}>
                <th scope="row" data-label="Rule">{rule.rule}<small>{rule.overview ? 'Also in the Overview queue' : 'Shown here, not in the Overview queue'}</small></th>
                <td data-label="Queue reason">{rule.reason}</td>
                <td data-label="Evidence">{cell(rule)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** PF-02b: one company's mark history, in the shared Sheet. */
function MarkDrawer({ drawer, reference, asOf, onClose, onRetry }) {
  const { row } = drawer;
  const history = drawer.state === 'ok' ? markHistoryOf(drawer.detail, reference) : null;
  let body;
  if (drawer.state === 'loading') body = <Skeleton rows={2} />;
  else if (drawer.state !== 'ok') {
    body = <SourceFailure what="This company’s mark history" claim="That is not a claim that no mark is recorded." onRetry={onRetry} testid="status-mark-drawer-unreadable" retryTestid="button-retry-mark-drawer" />;
  } else if (history.rows.length === 0) {
    body = <p className="pf-note" data-testid="mark-drawer-empty">No mark is recorded for {row.name}. The position carries at cost{row.atCost ? ` (${row.atCost})` : ''} for NAV until one is.</p>;
  } else {
    body = (
      <div className="pf-table-wrap">
        <table className="pf-table">
          <caption>Marks · newest first</caption>
          <thead><tr><th scope="col">As of</th><th scope="col" className="n">FMV</th><th scope="col" className="n">Post-money</th><th scope="col">Event</th><th scope="col">Basis · source</th></tr></thead>
          <tbody>
            {history.rows.map((m) => (
              <tr key={m.key} data-testid={`row-mark-${m.key}`}>
                <th scope="row" data-label="As of" className="pf-mono">{m.date || NOT_RECORDED}</th>
                <td className="n" data-label="FMV">{m.fmv || <NotRecorded />}</td>
                <td className="n" data-label="Post-money">{m.postMoney || <NotRecorded />}</td>
                <td data-label="Event">{m.event || <NotRecorded />}</td>
                <td data-label="Basis · source">{m.basis || <NotRecorded />}{m.source ? <small>{m.source}</small> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  let status = null;
  if (history && history.rows.length) {
    if (history.stale === true) status = <span className="pf-chip is-late" data-testid="mark-drawer-stale">Stale · latest mark {ageWords(history.ageDays)}</span>;
    else if (history.stale === false) status = <span className="pf-chip is-ok">Latest mark {ageWords(history.ageDays)}</span>;
    else status = <span className="pf-muted">Mark age not measured: no reference date was read</span>;
  }
  return (
    <Sheet title={row.name} eyebrow="Mark history" label={`Mark history for ${row.name}`} width={560} testId="positions-mark-drawer" onClose={onClose}
      footer={<p className="pf-foot pf-sheet-foot">Recording a mark is an HQ admin act. This book is your read of it.</p>}>
      <div className="pf-sheet" data-testid="mark-drawer-body">
        <div className="pf-sheet-meta">
          {status}
          <span className="pf-muted">{[titleCase(row.stage), row.ownership, row.invested ? `invested ${row.invested}` : null].filter(Boolean).join(' · ') || NOT_RECORDED}</span>
        </div>
        <section><h3>Marks</h3>{body}</section>
        {asOf && history?.rows.length ? <p className="pf-foot">Every recorded mark is listed; the register uses the latest on or before {day(asOf)}.</p> : null}
        <section>
          <h3>What “stale” means</h3>
          <p className="pf-foot">No mark newer than two quarters{reference.date ? `, measured at ${day(reference.date)}` : ''}. The latest mark still counts toward NAV; nothing is extrapolated.</p>
        </section>
        {row.uid ? <Link className="pf-btn" to={companyHref(row.uid)} data-testid="link-mark-drawer-company">Open {row.name}</Link> : null}
      </div>
    </Sheet>
  );
}

/**
 * The book-wide mark history the toolbar's "Mark history" opens.
 *
 * FOUR STATES, AND THEY ARE NOT THREE. `null` is closed; `{loading}` is asked;
 * `{error}` is asked and unreadable; a list is the answer. An empty history and
 * an unreadable one are different facts on a valuation page.
 *
 * A row whose basis is NULL predates the column's default and reads as
 * unrecorded: reporting it as a GP estimate would invent its provenance.
 * Exported for its own tests: it is pure and prop-driven.
 */
export function MarkHistory({ state, onClose }) {
  if (state === null) return null;
  return (
    <section className="pf-card pf-table-card" aria-labelledby="pf-book-marks-title" data-testid="ip1-mark-history">
      <div className="pf-card-head">
        <div>
          <h2 id="pf-book-marks-title">Mark history</h2>
          <p className="pf-sm">Every marking event across the accessible book, newest first</p>
        </div>
        <button type="button" className="pf-btn" onClick={onClose}>Close</button>
      </div>
      {state.loading && <div className="pf-skeleton" aria-busy="true"><i /><i /></div>}
      {state.error && (
        <div className="pf-failure" role="alert" data-testid="ip1-mark-history-error">
          <span>The mark history could not be read. That is not a claim that the book has no marks.</span>
        </div>
      )}
      {state.items && (state.items.length === 0
        ? <p className="pf-note">No marking event is recorded against an accessible position. The book carries positions at cost until one is.</p>
        : (
          <>
            <div className="pf-table-wrap">
              <table className="pf-table">
                <thead><tr><th scope="col">Company</th><th scope="col">As of</th><th scope="col" className="n">FMV</th><th scope="col">Event</th><th scope="col">Basis</th><th scope="col">Source</th></tr></thead>
                <tbody>
                  {state.items.map((m) => (
                    <tr key={m.uid} data-testid={`row-ip1-mark-${m.uid}`}>
                      <th scope="row" data-label="Company">{m.project_uid ? <Link className="pf-co" to={companyHref(m.project_uid)}>{m.project_name || 'Unnamed company'}</Link> : <span className="pf-co">{m.project_name || 'Unnamed company'}</span>}</th>
                      <td data-label="As of">{day(m.as_of_date) || NOT_RECORDED}</td>
                      <td className="n" data-label="FMV">{money(m.fmv) || NOT_RECORDED}{m.post_money != null && <small>Post {money(m.post_money)}</small>}</td>
                      <td data-label="Event">{m.event || NOT_RECORDED}</td>
                      <td data-label="Basis">{basisLabel(m.basis) || NOT_RECORDED}</td>
                      <td data-label="Source">{m.source || m.note || NOT_RECORDED}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pf-foot">
              {Object.entries(state.basis).map(([k, n]) => `${n} ${k === 'unrecorded' ? 'unrecorded' : (basisLabel(k) || k).toLowerCase()}`).join(' · ')}
              {' — a round-priced mark and a GP estimate are both marks and are not the same evidence, so they are never shown alike.'}
            </p>
          </>
        ))}
    </section>
  );
}

/** Each Attention company's 90-day health history: did it turn red inside the window? */
function useHealthFlips(rows, health) {
  const [flips, setFlips] = useState({});
  const asked = useRef(new Set());
  const red = (rows || []).filter((r) => r.health.state === 'Attention' && r.uid).map((r) => r.uid);
  const key = health.state === 'ok' ? red.join(',') : '';
  useEffect(() => {
    let alive = true;
    for (const uid of key ? key.split(',') : []) {
      if (asked.current.has(uid)) continue;
      asked.current.add(uid);
      api.portfolioHealthGet(uid, 90).then(
        (r) => {
          const history = Array.isArray(r?.history) ? r.history : [];
          if (alive) setFlips((f) => ({ ...f, [uid]: history.slice(1).some((s) => s.badge && s.badge !== 'red') }));
        },
        () => { if (alive) setFlips((f) => ({ ...f, [uid]: 'unreadable' })); },
      );
    }
    return () => { alive = false; };
  }, [key]);
  return flips;
}

export default function InvestorPortfolioPositions() {
  const [asOf, setAsOf] = useState('');
  const [filter, setFilter] = useState('all');
  const [stage, setStage] = useState('all');
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState(null);
  const [marks, setMarks] = useState(null);
  const { reads, retry, reload } = usePortfolioReads(sourcesFor(asOf));

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    retry('positions');
  }, [asOf, retry]);

  const reference = useMemo(() => markReference(asOf, reads.compliance, reads.positions), [asOf, reads.compliance, reads.positions]);
  const attention = useMemo(() => {
    const q = attentionOf(reads);
    return new Set(q.state === 'ok' ? q.items.map((i) => i.key) : []);
  }, [reads]);
  const rows = useMemo(() => registerRowsOf(reads, reference, attention), [reads, reference, attention]);
  const counts = useMemo(() => markCountsOf(rows, reference), [rows, reference]);
  const total = useMemo(() => registerTotalOf(rows), [rows]);
  const flips = useHealthFlips(rows, reads.health);
  const rules = useMemo(() => attentionRulesOf(reads, rows, flips), [reads, rows, flips]);
  const failed = Object.entries(SOURCE_NAMES).filter(([k]) => reads[k].state === 'unreadable').map(([, n]) => n);

  /** Mark history, book-wide: toggling closed sets `null`, so a reopen re-reads. */
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

  const readDrawer = useCallback((row) => {
    setDrawer({ row, state: 'loading' });
    api.positionsByProject(row.uid).then(
      (detail) => setDrawer((d) => (d && d.row.key === row.key ? { row, state: detail && typeof detail === 'object' && Array.isArray(detail.marks) ? 'ok' : 'unreadable', detail } : d)),
      () => setDrawer((d) => (d && d.row.key === row.key ? { row, state: 'unreadable' } : d)),
    );
  }, []);

  const positionsState = reads.positions.state;
  return (
    <PortfolioFrame
      tab="positions"
      testid="investor-portfolio-positions"
      description="Every recorded investment: cost, ownership, the latest mark and its basis, reporting and health."
      context={`Gross of fees and carry · ${asOf ? `book as of ${day(asOf)}` : 'latest recorded marks'}`}
      tools={(
        <ZoneHeaderTools role="investor">
          <button type="button" className="pf-icon-button" onClick={reload} aria-label="Refresh positions" data-testid="button-refresh-investor-positions"><RefreshCw size={15} aria-hidden="true" /></button>
        </ZoneHeaderTools>
      )}
      notice={failed.length ? (
        <p className="pf-partial" data-testid="status-investor-positions-partial">{failed.join(', ')} could not be read. Each affected column says so; the others are current.</p>
      ) : null}
      rail={(
        <WorkerRail
          workspace="Portfolio"
          role="investor"
          className="pf-rail"
          note="Figures come from recorded positions, marks, health snapshots and founder updates. Nothing here changes cost, a mark, ownership or a narrative, and no figure is filled in by a model."
        />
      )}
    >
      <AsOfBar asOf={asOf} onApply={setAsOf} compliance={reads.compliance} />
      {positionsState === 'loading' ? <section className="pf-card"><Skeleton rows={4} /></section> : null}
      {positionsState === 'unreadable' ? (
        <section className="pf-card" aria-labelledby="pf-register-title">
          <div className="pf-card-head"><h2 id="pf-register-title">Investment register</h2></div>
          <SourceFailure what="Positions" claim="No empty book or zero is shown in its place." onRetry={() => retry('positions')} testid="status-investor-positions-error" retryTestid="button-retry-investor-positions" />
        </section>
      ) : null}
      {positionsState === 'ok' ? (
        <>
          <MarkCounts counts={counts} />
          <Register rows={rows} total={total} asOf={asOf} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery}
            stage={stage} setStage={setStage} onOpen={readDrawer} markHistory={markHistory} />
        </>
      ) : null}
      <MarkHistory state={marks} onClose={markHistory} />
      <AttentionRules rules={rules} retry={retry} />
      <ZoneDraft
        surface="portfolio/positions"
        railOption="draft:multiple-narrative"
        label="Proposal · explain the multiple’s move"
        accept="Accept narrative"
        run="Draft the narrative"
        foot="Traces to the mark-history rows."
        empty="A narrative built from the marking events themselves — which company, on what date, on what basis — rather than from portfolio-wide momentum the record does not show."
        nothingToDraft="No marking event is recorded against an accessible position, so there is no move to explain."
      />
      <section className="pf-card" aria-labelledby="pf-governed-title">
        <h2 id="pf-governed-title" className="pf-h2">Every valuation and ownership change keeps its source.</h2>
        <p className="pf-foot">Each mark carries its effective date, the event behind it and the recorded basis. New marks and follow-on rounds are recorded through the authorised investment workflow, so a priced round and an estimate stay visibly different.</p>
      </section>
      <FromMercury section="portfolio" />
      <p className="pf-boundary">Investor workspace. Data shown is restricted to this investor’s accessible position book.</p>
      {drawer ? <MarkDrawer drawer={drawer} reference={reference} asOf={asOf} onClose={() => setDrawer(null)} onRetry={() => readDrawer(drawer.row)} /> : null}
    </PortfolioFrame>
  );
}
