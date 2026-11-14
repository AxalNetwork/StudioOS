/**
 * D4817 part 1 (#5311, canvas PF-01): the investor's Portfolio Overview, in
 * the shared Portfolio frame (`../portfolio/PortfolioFrame.jsx`).
 *
 * The decision order is the canvas's: performance with its basis and as-of
 * date, then Needs attention backed by evidence, then the Reporting and
 * Value-add summaries, then the dense company table where the name is the
 * link. Every read stands alone: a failed source labels its own panel
 * Unreadable with a Retry, and the panels beside it keep their figures.
 * A failed positions read never looks like an empty book (#5365 F-01), and a
 * Worker `detail` never reaches the page (F-26).
 *
 * D6208 (#6208): the table narrows by Sector, Stage, Health and Reporting and
 * sorts by health, invested, multiple or last update; its caption states the
 * filters in force. The header's Export writes the rows shown, each with its
 * basis and as-of, through `exportView`.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import { ZoneHeaderTools } from '../../workspaces/ZoneHeader';
import AlsoIn from '../../workspaces/AlsoIn';
import { titleCase } from '../../lib/absence';
import { ACCOUNT_LINK } from '../account/companies/companiesModel.js';
import PortfolioFrame from '../portfolio/PortfolioFrame';
import { usePortfolioReads } from '../portfolio/usePortfolioReads';
import {
  AttentionItem, HealthStatus, ObligationStatus, PerformanceSummary, Skeleton, SourceFailure, SummaryTile,
} from '../portfolio/PortfolioParts';
import {
  HEALTH, NOT_RECORDED, SHAPES, SORTS, attentionOf, companyExportOf, companyRowsOf, filterOptionsOf, filterRows, filterWordsOf,
  performanceOf, reportingSummaryOf, sortRows, tableCaptionOf, valueAddSummaryOf,
} from '../portfolio/portfolioModel';
import PortfolioExport from '../portfolio/PortfolioExport';

const label = (value) => titleCase(value) || 'Unknown';
const ATTENTION_PREVIEW = 5;

const SOURCES = {
  positions: { call: () => api.positionsList(), shape: SHAPES.positions },
  analytics: { call: () => api.positionsAnalytics(), shape: SHAPES.analytics },
  health: { call: () => api.portfolioHealthList({}), shape: SHAPES.health },
  updates: { call: () => api.portfolioUpdatesLatest(), shape: SHAPES.updates },
  support: { call: () => api.portfolioSupportList(), shape: SHAPES.support },
  compliance: { call: () => api.positionsKpiCompliance(), shape: SHAPES.compliance },
};

const SOURCE_NAMES = { analytics: 'Performance', health: 'Health', updates: 'Founder updates', support: 'Support', compliance: 'Reporting' };

/** Needs attention: the evidence-backed queue, most urgent first. */
function NeedsAttention({ attention, reads, retry }) {
  const [all, setAll] = useState(false);
  const loading = reads.positions.state === 'loading';
  let body;
  if (loading) body = <Skeleton />;
  else if (attention.state !== 'ok') {
    body = <p className="pf-note">The queue is built from the positions, which could not be read. Nothing is listed in its place.</p>;
  } else if (attention.items.length === 0) {
    body = attention.missing.length
      ? <p className="pf-note" data-testid="attention-empty-partial">No evidence in the sources that answered. The {attention.missing.join(', ')} read failed, so this is not a claim that nothing needs attention.</p>
      : <p className="pf-note" data-testid="attention-empty">Nothing in the recorded health, reporting, runway or marks needs attention.</p>;
  } else {
    const shown = all ? attention.items : attention.items.slice(0, ATTENTION_PREVIEW);
    body = (
      <>
        <ol className="pf-attn">{shown.map((item) => <AttentionItem key={item.key} item={item} />)}</ol>
        {attention.items.length > ATTENTION_PREVIEW ? (
          <button type="button" className="pf-link-button" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid="button-attention-all">
            {all ? 'Show fewer' : `Show all ${attention.items.length}`}
          </button>
        ) : null}
      </>
    );
  }
  const missing = attention.missing || [];
  return (
    <section className="pf-card" aria-labelledby="pf-attn-title" data-testid="portfolio-attention">
      <div className="pf-card-head">
        <h2 id="pf-attn-title">Needs attention</h2>
        {attention.state === 'ok' && attention.items.length ? <span className="pf-sm">{attention.items.length} {attention.items.length === 1 ? 'company' : 'companies'} · evidence-backed · most urgent first</span> : null}
      </div>
      {missing.length && attention.state === 'ok' && attention.items.length ? (
        <p className="pf-partial" data-testid="attention-partial">The {missing.join(', ')} read failed, so evidence from {missing.length === 1 ? 'that source is' : 'those sources is'} missing below.
          {' '}<button type="button" className="pf-link-button" onClick={() => ['health', 'compliance', 'updates'].forEach((k) => reads[k].state === 'unreadable' && retry(k))}>Retry</button></p>
      ) : null}
      {body}
      <p className="pf-foot">Health never reads Healthy when evidence is missing or a read failed. Each line names its source and date.</p>
    </section>
  );
}

function ReportingCard({ summary, onRetry }) {
  let figures;
  if (summary.state === 'loading') figures = <Skeleton rows={1} />;
  else if (summary.state !== 'ok') figures = <SourceFailure what="Reporting" claim="This is not a claim that any company is late." onRetry={onRetry} testid="status-portfolio-reporting-unreadable" />;
  else if (summary.total === 0) figures = <p className="pf-note" data-testid="portfolio-reporting-empty">No company is in the reporting population{summary.period ? ` for ${summary.period}` : ''}.</p>;
  else {
    figures = (
      <div className="pf-tiles" data-testid="portfolio-reporting-figures">
        <SummaryTile label="Received" value={`${summary.received} of ${summary.total}`} />
        <SummaryTile label={summary.inProgress ? 'Outstanding' : 'Not received'} value={String(summary.outstanding)} tone={summary.outstanding && !summary.inProgress ? 'late' : null} />
        <SummaryTile label="Period" value={summary.period || NOT_RECORDED} note={summary.period ? (summary.inProgress ? 'In progress' : 'Complete') : null} />
      </div>
    );
  }
  return (
    <section className="pf-card" id="portfolio-updates" aria-labelledby="pf-rep-title">
      <div className="pf-card-head">
        <h2 id="pf-rep-title">Reporting{summary.period ? ` · ${summary.period}` : ''}</h2>
        <Link className="pf-btn is-quiet" to="/portfolio/updates" data-testid="link-investor-updates-detail">Open Reports <ArrowUpRight size={13} aria-hidden="true" /></Link>
      </div>
      {figures}
      {summary.state === 'ok' && summary.total > 0 ? (
        <p className="pf-sm" data-testid="portfolio-reporting-line">{summary.received} of {summary.total} portfolio companies reported for {summary.period}{summary.inProgress ? ' (in progress)' : ''}</p>
      ) : null}
      {summary.updatesState === 'unreadable' ? <p className="pf-note">Founder updates could not be read; recent submissions are not listed.</p> : null}
      {summary.submissions?.length ? (
        <ul className="pf-hist" aria-label="Recent submissions">{summary.submissions.map((s) => <li key={s.key}><span>{s.date || NOT_RECORDED}</span>{s.text}</li>)}</ul>
      ) : summary.updatesState === 'ok' ? <p className="pf-note">No founder update has been submitted yet.</p> : null}
    </section>
  );
}

function ValueAddCard({ summary, onRetry }) {
  let figures;
  if (summary.state === 'loading') figures = <Skeleton rows={1} />;
  else if (summary.state !== 'ok') figures = <SourceFailure what="Support" claim="This is not a claim that no support was given." onRetry={onRetry} testid="status-portfolio-support-unreadable" />;
  else {
    figures = (
      <div className="pf-tiles" data-testid="portfolio-support-figures">
        <SummaryTile label="Open commitments" value={String(summary.open ?? NOT_RECORDED)} note="Promised, not yet delivered" />
        <SummaryTile label="Delivered" value={String(summary.delivered ?? NOT_RECORDED)} note="Every recorded entry" />
        <SummaryTile label="No support recorded" value={summary.untouched == null ? NOT_RECORDED : String(summary.untouched)} note={summary.inBook != null ? `${summary.supported} of ${summary.inBook} companies supported` : null} />
      </div>
    );
  }
  return (
    <section className="pf-card" id="portfolio-value-add" aria-labelledby="pf-va-title">
      <div className="pf-card-head">
        <h2 id="pf-va-title">Value-add</h2>
        <Link className="pf-btn is-quiet" to="/portfolio/value-add" data-testid="link-investor-value-add-detail">Open Value-add <ArrowUpRight size={13} aria-hidden="true" /></Link>
      </div>
      {figures}
      <p className="pf-foot">Meetings resulting from introductions: <span className="pf-not-recorded">{NOT_RECORDED}</span> — the support ledger records promised and delivered work, not meeting outcomes.</p>
    </section>
  );
}

const HEALTH_FILTERS = ['all', ...HEALTH];
const NO_FILTERS = { query: '', sector: 'all', stage: 'all', health: 'all', reporting: 'all' };

/** One filter select; the visible first option names the filter, so the label stays for screen readers. */
function FilterSelect({ name, value, onChange, options, testid }) {
  return (
    <label className="pf-select"><span className="pf-sr">{name}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
        <option value="all">{`${name}: all`}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{`${name}: ${o.label}`}</option>)}
      </select>
    </label>
  );
}

/**
 * D6208 (#6208): the table's filters and sort live on the page, not in the
 * table, because the header's Export writes exactly the rows shown.
 */
function CompanyTable({ rows, shown, filters, setFilters, sort, setSort, options, positionsState, onRetry }) {
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  if (positionsState === 'loading') return <section className="pf-card"><Skeleton rows={4} /></section>;
  if (positionsState !== 'ok') {
    return (
      <section className="pf-card" id="portfolio-positions" aria-labelledby="pf-co-title">
        <div className="pf-card-head"><h2 id="pf-co-title">Portfolio companies</h2></div>
        <div className="pf-failure" role="alert" data-testid="status-investor-portfolio-error">
          <span>Positions could not be read.</span>
          <button type="button" onClick={onRetry} data-testid="button-retry-investor-portfolio">Retry</button>
        </div>
      </section>
    );
  }
  const words = filterWordsOf(filters, options);
  return (
    <section className="pf-card pf-table-card" id="portfolio-positions" aria-labelledby="pf-co-title">
      <div className="pf-card-head">
        <h2 id="pf-co-title">Portfolio companies</h2>
        <div className="pf-tools pf-filters" data-testid="portfolio-filters">
          <label className="pf-search"><Search size={13} aria-hidden="true" /><span className="pf-sr">Search companies</span>
            <input type="search" value={filters.query} onChange={(e) => set('query')(e.target.value)} placeholder="Search companies" data-testid="input-portfolio-search" />
          </label>
          <FilterSelect name="Sector" value={filters.sector} onChange={set('sector')} options={options.sector} testid="select-portfolio-sector" />
          <FilterSelect name="Stage" value={filters.stage} onChange={set('stage')} options={options.stage} testid="select-portfolio-stage" />
          <label className="pf-select"><span className="pf-sr">Health</span>
            <select value={filters.health} onChange={(e) => set('health')(e.target.value)} data-testid="select-portfolio-health">
              {HEALTH_FILTERS.map((h) => <option key={h} value={h}>{h === 'all' ? 'Health: all' : `Health: ${h}`}</option>)}
            </select>
          </label>
          <FilterSelect name="Reporting" value={filters.reporting} onChange={set('reporting')} options={options.reporting} testid="select-portfolio-reporting" />
          <label className="pf-select"><span className="pf-sr">Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} data-testid="select-portfolio-sort">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{`Sort: ${s.label}`}</option>)}
            </select>
          </label>
          <Link className="pf-btn is-quiet" to="/portfolio/positions" data-testid="link-investor-positions-detail">Open Positions <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </div>
      </div>
      {words.length ? (
        <div className="pf-fchips" data-testid="portfolio-filter-chips">
          <span className="pf-sm">{shown.length} of {rows.length} {rows.length === 1 ? 'company' : 'companies'}</span>
          <button type="button" className="pf-link-button" onClick={() => setFilters(NO_FILTERS)} data-testid="button-portfolio-clear-filters">Clear filters</button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="pf-note" data-testid="portfolio-no-positions">No position is recorded for this investor account yet. Positions appear here once a confirmed commitment is recorded.</p>
      ) : (
        <div className="pf-table-wrap">
          <table className="pf-table">
            <caption data-testid="portfolio-table-caption">{tableCaptionOf(shown.length, rows.length, words, sort)}</caption>
            <thead><tr>
              <th scope="col">Company</th><th scope="col">Sector · stage</th><th scope="col" className="n">Invested</th><th scope="col" className="n">Latest FMV</th>
              <th scope="col" className="n">Ownership</th><th scope="col" className="n">MOIC</th><th scope="col">Reporting</th><th scope="col">Health</th><th scope="col">Last update</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} data-testid={`row-investor-position-${r.key}`}>
                  <th scope="row" data-label="Company">{r.uid ? <Link className="pf-co" to={`/portfolio/companies/${encodeURIComponent(r.uid)}`}>{r.name}</Link> : <span className="pf-co">{r.name}</span>}</th>
                  <td data-label="Sector · stage">{r.sector ? label(r.sector) : <span className="pf-not-recorded">{NOT_RECORDED}</span>}{r.stage ? <small>{label(r.stage)}</small> : null}</td>
                  <td className="n" data-label="Invested">{r.invested || <span className="pf-not-recorded">{NOT_RECORDED}</span>}</td>
                  <td className="n" data-label="Latest FMV">{r.fmv ? <>{r.fmv}{r.markDate ? <small>{r.markDate}</small> : null}</>
                    : <><span className="pf-not-recorded">{r.markReason ? 'Mark not usable' : 'No mark recorded'}</span>{r.atCost ? <small>At cost {r.atCost} for NAV</small> : null}</>}</td>
                  <td className="n" data-label="Ownership">{r.ownership || <span className="pf-not-recorded">{NOT_RECORDED}</span>}</td>
                  <td className={`n${r.below ? ' is-below' : ''}`} data-label="MOIC">{r.moic || <span className="pf-not-recorded">{NOT_RECORDED}</span>}{r.moic && r.moicAtCost ? <small>At cost</small> : null}</td>
                  <td data-label="Reporting"><ObligationStatus reporting={r.reporting} /></td>
                  <td data-label="Health"><HealthStatus health={r.health} /></td>
                  <td data-label="Last update">{r.lastUpdate || <span className="pf-not-recorded">{r.reporting.state === 'Unreadable' ? 'Unreadable' : NOT_RECORDED}</span>}</td>
                </tr>
              ))}
              {shown.length === 0 ? <tr><td colSpan={9} className="pf-note" data-testid="portfolio-no-match">No company matches these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="pf-foot">Ownership is read from each founder’s cap table. This view never edits it.</p>
    </section>
  );
}

export default function InvestorPortfolioCanvas() {
  const { reads, retry, reload } = usePortfolioReads(SOURCES);
  const perf = useMemo(() => performanceOf(reads.analytics, reads.positions), [reads.analytics, reads.positions]);
  const attention = useMemo(() => attentionOf(reads), [reads]);
  const rows = useMemo(() => companyRowsOf(reads), [reads]);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [sort, setSort] = useState('health');
  const options = useMemo(() => filterOptionsOf(rows || []), [rows]);
  const shown = useMemo(() => sortRows(filterRows(rows || [], filters), sort), [rows, filters, sort]);
  const exportPlan = useMemo(() => companyExportOf(reads, rows, shown), [reads, rows, shown]);
  const reporting = useMemo(() => reportingSummaryOf(reads.compliance, reads.updates), [reads.compliance, reads.updates]);
  const support = useMemo(() => valueAddSummaryOf(reads.support), [reads.support]);
  const failed = Object.entries(SOURCE_NAMES).filter(([k]) => reads[k].state === 'unreadable').map(([, n]) => n);
  const positionCount = reads.positions.state === 'ok' ? reads.positions.value.items.length : null;

  return (
    <PortfolioFrame
      tab={null}
      testid="investor-portfolio-canvas"
      context={perf.asOf ? `Gross of fees and carry · ${perf.asOf.replace(/^As of/, 'as of')}` : null}
      tools={(
        // The root has no primary; Ask stays gated (ProfileHeaderAsk).
        <ZoneHeaderTools role="investor">
          <PortfolioExport choices={[{ key: 'companies', label: 'Export', zone: 'overview', plan: exportPlan }]} testid="button-export-portfolio-overview" />
          <Link to={ACCOUNT_LINK.to} className="pf-btn is-quiet" data-testid="link-account-portfolio">{ACCOUNT_LINK.label}</Link>
          <button type="button" className="pf-icon-button" onClick={reload} data-testid="button-refresh-investor-portfolio" aria-label="Refresh Portfolio"><RefreshCw size={15} aria-hidden="true" /></button>
        </ZoneHeaderTools>
      )}
      notice={failed.length ? (
        <p className="pf-partial" data-testid="status-investor-portfolio-partial">{failed.join(', ')} could not be read. Each affected panel says so; the others are current.</p>
      ) : null}
      rail={(
        <WorkerRail
          workspace="Portfolio"
          role="investor"
          className="pf-rail"
          data-testid="investor-portfolio-rail"
          stance="Manual"
          note="Tables, updates, health sweeps and portfolio tools work without AI. Returns are computed from recorded positions, marks and distributions. Missing values stay blank rather than being estimated."
          coverage={[
            positionCount == null ? 'Positions unreadable' : `${positionCount} position${positionCount === 1 ? '' : 's'} readable`,
            reads.analytics.state === 'unreadable' ? 'Return analytics unreadable' : perf.asOf || 'Mark date not recorded',
          ]}
          coverageNote="Updates and cap-table ownership stay linked to the company records they came from."
          unavailable={[
            ['Valuation marks', 'A position without a recorded mark is carried at cost when its cost is known.'],
            ['Outbound', 'Nothing is sent to a founder from this page.'],
          ]}
          action={<Link to="/portfolio/performance" data-testid="link-rail-portfolio-performance">Open performance methodology <ArrowUpRight size={13} /></Link>}
        />
      )}
    >
      <PerformanceSummary perf={perf} loading={reads.analytics.state === 'loading'} onRetry={() => retry('analytics')} />
      <NeedsAttention attention={attention} reads={reads} retry={retry} />
      <div className="pf-two">
        <ReportingCard summary={reporting} onRetry={() => retry('compliance')} />
        <ValueAddCard summary={support} onRetry={() => retry('support')} />
      </div>
      <CompanyTable rows={rows || []}
        shown={shown} filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} options={options}
        positionsState={reads.positions.state} onRetry={() => retry('positions')}
      />
      <AlsoIn role="investor" row="Portfolio" />
      <p className="pf-boundary">Investor workspace. Data shown is governed by your existing access and permissions.</p>
    </PortfolioFrame>
  );
}
