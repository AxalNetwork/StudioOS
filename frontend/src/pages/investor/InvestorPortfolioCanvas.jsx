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
 * D6207 (#6207) reverses one D4817 departure: under the hero NAV, the change
 * since the last completed quarter-end, from one extra quarter-end read.
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
  HEALTH, NOT_RECORDED, SHAPES, attentionOf, companyRowsOf, filterRows, lastQuarterEndOf, navChangeOf, performanceOf, quarterShape,
  reportingSummaryOf, valueAddSummaryOf,
} from '../portfolio/portfolioModel';

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

/**
 * D6207 (#6207): one extra read, the book as of the last completed
 * quarter-end, and the line "NAV up $X since 30 Sep 2026 (quarter-end)" under
 * the hero. Mounted once that date is known (keyed by it), so a reload that
 * re-reads the reporting window reads the quarter-end afresh. Draws nothing —
 * no number, no zero — unless both the hero and this read answered with a NAV.
 */
function NavChangeLine({ date, analytics }) {
  const sources = useMemo(() => ({ [date]: { call: () => api.positionsAnalytics(date), shape: quarterShape(date) } }), [date]);
  const { reads } = usePortfolioReads(sources);
  const change = navChangeOf(analytics, date, reads[date]);
  if (!change) return null;
  return <span className="pf-sub" data-testid="portfolio-nav-change" title={change.note}>{change.text}</span>;
}

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

function CompanyTable({ rows, positionsState, onRetry }) {
  const [query, setQuery] = useState('');
  const [health, setHealth] = useState('all');
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
  const shown = filterRows(rows, { query, health });
  return (
    <section className="pf-card pf-table-card" id="portfolio-positions" aria-labelledby="pf-co-title">
      <div className="pf-card-head">
        <h2 id="pf-co-title">Portfolio companies</h2>
        <div className="pf-tools">
          <label className="pf-search"><Search size={13} aria-hidden="true" /><span className="pf-sr">Search companies</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies" data-testid="input-portfolio-search" />
          </label>
          <label className="pf-select"><span className="pf-sr">Health</span>
            <select value={health} onChange={(e) => setHealth(e.target.value)} data-testid="select-portfolio-health">
              {HEALTH_FILTERS.map((h) => <option key={h} value={h}>{h === 'all' ? 'Health: all' : `Health: ${h}`}</option>)}
            </select>
          </label>
          <Link className="pf-btn is-quiet" to="/portfolio/positions" data-testid="link-investor-positions-detail">Open Positions <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="pf-note" data-testid="portfolio-no-positions">No position is recorded for this investor account yet. Positions appear here once a confirmed commitment is recorded.</p>
      ) : (
        <div className="pf-table-wrap">
          <table className="pf-table">
            <caption>{shown.length} of {rows.length} {rows.length === 1 ? 'company' : 'companies'} · sorted by health, then invested · values gross</caption>
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
              {shown.length === 0 ? <tr><td colSpan={9} className="pf-note">No company matches these filters.</td></tr> : null}
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
  const reporting = useMemo(() => reportingSummaryOf(reads.compliance, reads.updates), [reads.compliance, reads.updates]);
  const support = useMemo(() => valueAddSummaryOf(reads.support), [reads.support]);
  const quarterEnd = lastQuarterEndOf(reads.positions, reads.compliance);
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
      <PerformanceSummary
        perf={perf}
        loading={reads.analytics.state === 'loading'}
        onRetry={() => retry('analytics')}
        change={quarterEnd ? <NavChangeLine key={quarterEnd} date={quarterEnd} analytics={reads.analytics} /> : null}
      />
      <NeedsAttention attention={attention} reads={reads} retry={retry} />
      <div className="pf-two">
        <ReportingCard summary={reporting} onRetry={() => retry('compliance')} />
        <ValueAddCard summary={support} onRetry={() => retry('support')} />
      </div>
      <CompanyTable rows={rows || []} positionsState={reads.positions.state} onRetry={() => retry('positions')} />
      <AlsoIn role="investor" row="Portfolio" />
      <p className="pf-boundary">Investor workspace. Data shown is governed by your existing access and permissions.</p>
    </PortfolioFrame>
  );
}
