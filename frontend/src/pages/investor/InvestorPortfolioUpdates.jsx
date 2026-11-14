/**
 * D4817 part 4 (#5311, canvas PF-04): Reports, the investor's reporting
 * obligations inbox and the report detail, in the shared Portfolio frame
 * (`../portfolio/PortfolioFrame.jsx`). The address stays `/portfolio/updates`.
 *
 * A · The obligations inbox: one row per company in the reporting population
 * for the period the Worker measured, companies that have not reported first.
 * Each row has its period, its due date (the cadence read records none, and
 * the row says so rather than counting overdue days), the day the last update
 * arrived, its state as an icon and a word, what is missing, the last chase,
 * and the report detail. The chase, per row and for every company not
 * reported, is today's, unchanged.
 *
 * B · The report detail, in the shared Sheet: what was received (title,
 * period, date, version), each field with its source and date, the required
 * KPI set against it, the health snapshot beside it, the update as written,
 * and its history (received, chased).
 *
 * Duties under signed documents (`PortfolioReports`) keep their own section
 * with their own due dates, and their Ask and Waive stay on each company's
 * Reports, unchanged: #5311 holds those two actions for #4817's addendum.
 *
 * Every read stands alone (`usePortfolioReads`): a failed source labels its
 * own column or panel Unreadable with a Retry for that source, and never reads
 * as zero, as on time or as an empty inbox. A Worker `detail` never reaches
 * the page.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { titleCase } from '../../lib/absence';
import { currencyFromLabel } from '../../lib/money';
import { WorkerRail } from '../../ui';
import Sheet from '../../ui/Sheet.jsx';
import { ZoneHeaderTools } from '../../workspaces/ZoneHeader';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';
import { companyHref } from '../cycles/reportingModel';
import PortfolioFrame from '../portfolio/PortfolioFrame';
import { usePortfolioReads } from '../portfolio/usePortfolioReads';
import { HealthStatus, ObligationStatus, Skeleton, SourceFailure, SummaryTile } from '../portfolio/PortfolioParts';
import {
  NOT_RECORDED, NO_DUE_DATE, SHAPES, day, healthFor, obligationRowsOf, periodCovers, periodName, reportFieldsOf, requiredAgainst,
} from '../portfolio/portfolioModel';
import PortfolioReports from './PortfolioReports';

const money = (value, currency = 'USD') => value == null || value === '' || !Number.isFinite(Number(value))
  ? 'Unavailable'
  : Number(value).toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 0 });
const title = (value, fallback = 'Not recorded') => titleCase(value) || fallback;
const unitFor = (key, units) => units?.get(key) || (/month|runway/i.test(key) ? 'months'
  : /headcount|customer|employee|user|account/i.test(key) ? 'count'
    : /pct|percent|margin|retention|churn/i.test(key) ? '%'
      : /cash|burn|revenue|arr|mrr/i.test(key) ? 'USD' : null);
export const kpiValue = (key, value, units) => {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return 'Not recorded';
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return String(value);
  const unit = unitFor(key, units);
  const currency = currencyFromLabel(unit);
  if (currency) return money(numeric, currency);
  if (/^(%|pct|percent)$/i.test(unit || '')) return `${numeric.toLocaleString()}%`;
  if (unit === 'months') return `${numeric.toLocaleString()} ${numeric === 1 ? 'month' : 'months'}`;
  return numeric.toLocaleString();
};
export const kpiText = (update, rules = []) => {
  const units = new Map((rules || []).map((rule) => [rule.kpi_key, rule.unit]));
  return Object.entries(update?.kpis || {}).slice(0, 4).map(([key, value]) => `${title(key)} ${kpiValue(key, value, units)}`).join(' · ');
};

/** Each source this page reads, on its own. */
const SOURCES = {
  compliance: { call: () => api.positionsKpiCompliance(), shape: SHAPES.compliance },
  updates: { call: () => api.portfolioUpdatesLatest(), shape: SHAPES.updates },
  positions: { call: () => api.positionsList(), shape: SHAPES.positions },
  chases: { call: () => api.portfolioChases(), shape: SHAPES.chases },
  health: { call: () => api.portfolioHealthList({}), shape: SHAPES.health },
};
const SOURCE_NAMES = { compliance: 'Reporting', updates: 'Founder updates', positions: 'Positions', chases: 'The chase log', health: 'Health' };

const NotRecorded = ({ children = NOT_RECORDED, title: why }) => <span className="pf-not-recorded" title={why}>{children}</span>;

/** A cell whose source failed: the word, and a Retry for that source alone. */
function UnreadableCell({ source, retry, testid }) {
  return (
    <span className="pf-unreadable" data-testid={testid}>Unreadable · <button type="button" className="pf-link-button" onClick={() => retry(source)} aria-label={`Retry ${SOURCE_NAMES[source].toLowerCase()}`} data-testid={testid ? `${testid}-retry` : undefined}>Retry</button></span>
  );
}

function MissingCell({ missing, retry }) {
  if (missing.state === 'loading') return <span className="pf-muted">Reading…</span>;
  if (missing.state === 'unreadable') return <UnreadableCell source="updates" retry={retry} />;
  if (missing.state === 'not_measured') return <NotRecorded>{missing.text}</NotRecorded>;
  return <span className={missing.state === 'missing' ? 'pf-missing' : 'pf-muted'}>{missing.text}</span>;
}

function ChaseCell({ chase, retry, testid }) {
  if (chase.state === 'loading') return <span className="pf-muted">Reading…</span>;
  if (chase.state === 'unreadable') return <UnreadableCell source="chases" retry={retry} testid={testid} />;
  if (chase.state === 'none') return <span className="pf-muted">Not chased</span>;
  return <span className="pf-mono">{chase.date}{chase.count > 1 ? <small>{chase.count} chases</small> : null}</span>;
}

/** PF-04 A: who owes what, for the period the Worker measured. */
function Inbox({ inbox, reads, retry, visible, filter, setFilter, chaseOverdue, view, onOpen, onChase, chasing, rules }) {
  const head = (
    <div className="pf-card-head">
      <h2 id="pf-inbox-title">Reporting obligations</h2>
      {inbox.state === 'ok' ? <span className="pf-sm">{inbox.period ? `${inbox.period} · ` : ''}{inbox.cadence ? `${inbox.cadence} cadence` : 'cadence not recorded'}{inbox.inProgress ? ' · period in progress' : ''}</span> : null}
    </div>
  );
  let body;
  if (inbox.state === 'loading') body = <div className="pf-pad"><Skeleton rows={3} /></div>;
  else if (inbox.state !== 'ok') {
    body = <div className="pf-pad"><SourceFailure what="Reporting" claim="This is not a claim that any company is late or that every company has reported." onRetry={() => retry('compliance')} testid="status-reports-inbox-unreadable" retryTestid="button-retry-reports-compliance" /></div>;
  } else if (!inbox.rows.length) {
    body = <p className="pf-note" data-testid="reports-inbox-empty">No company is held in this book, so no reporting obligation is recorded.</p>;
  } else {
    body = (
      <div className="pf-table-wrap">
        <table className="pf-table pf-obligations">
          <caption>Who owes what · {inbox.period || 'period not recorded'} · {visible.length} of {inbox.rows.length}</caption>
          <thead><tr>
            <th scope="col">Company</th><th scope="col">Period</th><th scope="col">Due</th><th scope="col">Received</th>
            <th scope="col">Status</th><th scope="col">Missing</th><th scope="col">Last chase</th><th scope="col"><span className="pf-sr">Actions</span></th>
          </tr></thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.key} data-testid={`row-investor-update-${row.projectId}`}>
                <th scope="row" data-label="Company">
                  {companyHref(row.uid) ? <Link className="pf-co" to={companyHref(row.uid)} data-testid={`link-company-${row.projectId}`}>{row.name}</Link> : <span className="pf-co">{row.name}</span>}
                </th>
                <td data-label="Period">{row.period || <NotRecorded />}</td>
                <td data-label="Due"><NotRecorded title={NO_DUE_DATE}>No due date recorded</NotRecorded></td>
                <td data-label="Received">
                  {row.received ? <span className="pf-mono">{row.received}</span> : <NotRecorded>Never reported</NotRecorded>}
                  {row.update && reads.updates.state === 'ok' ? <small data-testid={`text-update-kpis-${row.projectId}`} title={`${row.update.title || 'Untitled update'}${kpiText(row.update, rules) ? ` · ${kpiText(row.update, rules)}` : ''}`}>{row.update.title || 'Untitled update'}{kpiText(row.update, rules) ? ` · ${kpiText(row.update, rules)}` : ''}</small> : null}
                </td>
                <td data-label="Status" data-testid={`status-obligation-${row.projectId}`}><ObligationStatus reporting={row.reporting} compact /></td>
                <td data-label="Missing"><MissingCell missing={row.missing} retry={retry} /></td>
                <td data-label="Last chase"><ChaseCell chase={row.chase} retry={retry} testid={`status-chase-${row.projectId}-unreadable`} /></td>
                <td data-label="Actions" className="pf-row-actions">
                  <button type="button" className="pf-btn" onClick={() => onOpen(row)} data-testid={`button-open-report-${row.projectId}`} aria-label={`Report detail for ${row.name}`}>Report detail</button>
                  {row.reported === false ? <button type="button" onClick={() => onChase(row)} disabled={chasing} data-testid={`button-chase-${row.projectId}`} className="pf-btn is-primary">Chase</button> : null}
                </td>
              </tr>
            ))}
            {visible.length === 0 ? <tr><td colSpan={8} className="pf-note" data-testid="reports-inbox-no-match">Every company in this book has reported for {inbox.period || 'the period'}.</td></tr> : null}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <section className="pf-card pf-table-card" aria-labelledby="pf-inbox-title" data-testid="reports-obligations">
      {head}
      <ZoneToolbar
        role="investor"
        className="pf-toolbar"
        filters={investorZoneFilters('portfolio/updates', { value: filter, onChange: setFilter })}
        actions={investorZoneActions('portfolio/updates', { handlers: { chaseOverdue }, view })}
      />
      {body}
      <p className="pf-foot">A company has reported when a submitted founder update speaks for the period; a month inside the quarter counts for it. The reporting cadence records no due date, so no row counts days overdue. A chase notifies the founder and is logged; delivery is attempted, not guaranteed.</p>
    </section>
  );
}

/** PF-04 b: one company's report as received, with each field's source and date. */
function ReportDetail({ row, reads, retry, rules, cadence, onClose }) {
  const updates = reads.updates;
  const update = updates.state === 'ok' ? row.update : null;
  const units = new Map((rules || []).map((r) => [r.kpi_key, r.unit]));
  const fields = reportFieldsOf(update, (k, v) => kpiValue(k, v, units));
  const forPeriod = update && periodCovers(cadence, reads.compliance.value?.population?.period ?? reads.compliance.value?.period, update.period);
  const health = healthFor({ project_id: row.projectId, project: { uid: row.uid } }, reads.health);
  let received;
  if (updates.state === 'loading') received = <Skeleton rows={2} />;
  else if (updates.state !== 'ok') {
    received = <SourceFailure what="Founder updates" claim="That is not a claim that nothing was received." onRetry={() => retry('updates')} testid="status-report-detail-unreadable" retryTestid="button-retry-report-updates" />;
  } else if (!update) {
    received = <p className="pf-note" data-testid="report-detail-none">No founder update from {row.name} is readable here. {row.received ? `The reporting read records one on ${row.received}; its content is not shared with this account.` : 'The reporting read records none.'}</p>;
  } else {
    received = (
      <>
        <dl className="pf-kv" data-testid="report-detail-received">
          <div><dt>Update</dt><dd>{update.title || 'Untitled update'}</dd></div>
          <div><dt>Period</dt><dd>{periodName(update.period) || <NotRecorded />}{update.period && !forPeriod ? ' · not the period measured' : ''}</dd></div>
          <div><dt>Submitted</dt><dd>{day(update.submitted_at || update.published_at) || <NotRecorded />}</dd></div>
          <div><dt>Version</dt><dd>{update.version != null ? `Version ${update.version}` : <NotRecorded />}</dd></div>
          <div><dt>Source</dt><dd>Founder update, shown as submitted</dd></div>
        </dl>
        <section>
          <h3>Fields</h3>
          {fields.length === 0 ? <p className="pf-note" data-testid="report-detail-no-fields">The update carries no KPI value.</p> : (
            <div className="pf-table-wrap">
              <table className="pf-table" data-testid="report-detail-fields">
                <caption>As submitted · each with its source</caption>
                <thead><tr><th scope="col">Field</th><th scope="col" className="n">Value</th><th scope="col">Source</th><th scope="col">As of</th></tr></thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.key} data-testid={`row-report-field-${f.key}`}>
                      <th scope="row" data-label="Field">{f.label}</th>
                      <td className="n" data-label="Value">{f.value ?? <NotRecorded title={f.reason}>{NOT_RECORDED}</NotRecorded>}{f.value == null && f.reason && f.reason !== NOT_RECORDED ? <small>{f.reason}</small> : null}</td>
                      <td data-label="Source">{f.source || <span className="pf-muted">None stored</span>}</td>
                      <td data-label="As of" className="pf-mono">{f.asOf || <NotRecorded />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
    );
  }

  let required;
  if (reads.compliance.state !== 'ok') required = <SourceFailure what="The required KPI set" claim="That is not a claim that nothing is required." onRetry={() => retry('compliance')} testid="status-report-required-unreadable" />;
  else if (!update) required = <p className="pf-muted">Nothing to measure: no update is readable here.</p>;
  else {
    const list = requiredAgainst(rules, update);
    required = list.length === 0
      ? <p className="pf-muted">No KPI is required at the {cadence} cadence.</p>
      : (
        <ul className="pf-required" data-testid="report-detail-required">
          {list.map((r) => <li key={r.key} data-state={r.carried ? 'carried' : 'missing'}>{r.carried ? <span className="pf-chip is-ok">Carried</span> : <span className="pf-chip is-late">Missing</span>}{r.name}</li>)}
        </ul>
      );
  }

  let history;
  if (row.chase.state === 'unreadable') history = <SourceFailure what="The chase log" claim="That is not a claim that nobody was chased." onRetry={() => retry('chases')} testid="status-report-history-unreadable" />;
  else {
    const items = [
      ...(update ? [{ key: 'submitted', date: day(update.submitted_at || update.published_at), text: 'Submitted by the founder' }] : []),
      ...(row.chase.state === 'ok' ? row.chase.items.map((c) => ({ key: c.key, date: c.date, text: `Chase logged${c.by ? ` by ${c.by}` : ''}` })) : []),
    ];
    history = items.length ? <ul className="pf-hist" data-testid="report-detail-history">{items.map((x) => <li key={x.key}><span>{x.date || NOT_RECORDED}</span><span>{x.text}</span></li>)}</ul>
      : <p className="pf-muted">No submission or chase is recorded.</p>;
  }

  return (
    <Sheet title={row.name} eyebrow={`Report detail${row.period ? ` · ${row.period}` : ''}`} label={`Report detail for ${row.name}`} width={560} testId="reports-detail" onClose={onClose}
      footer={<p className="pf-foot pf-sheet-foot">Shown as submitted. Nothing on this page edits an update, fills in a figure or converts the narrative into a number.</p>}>
      <div className="pf-sheet" data-testid="report-detail-body">
        <div className="pf-sheet-meta"><ObligationStatus reporting={{ ...row.reporting, period: row.period }} /><span className="pf-muted">{row.received ? `Last update received ${row.received}` : 'No update received'}</span></div>
        <section><h3>What was received</h3>{received}</section>
        <section><h3>Required KPI set</h3>{required}</section>
        <section>
          <h3>Health beside it</h3>
          {health.state === 'loading' ? <span className="pf-muted">Reading…</span> : health.state === 'Unreadable'
            ? <SourceFailure what="Health" claim="That is not a claim that the company is healthy." onRetry={() => retry('health')} testid="status-report-health-unreadable" />
            : <p className="pf-sheet-meta"><HealthStatus health={health} /><span className="pf-muted">{health.date ? `Snapshot of ${day(health.date)}. It is the latest snapshot, not a reading of this report.` : health.reason}</span></p>}
        </section>
        <section>
          <h3>Update as written</h3>
          {update ? (update.body ? <blockquote className="pf-quote" data-testid="report-detail-body-text">{update.body}</blockquote> : <p className="pf-muted">No narrative was written.</p>) : <p className="pf-muted">{updates.state === 'unreadable' ? 'Unreadable.' : NOT_RECORDED}</p>}
        </section>
        <section><h3>History</h3>{history}</section>
        {row.uid && companyHref(row.uid) ? <Link className="pf-btn" to={companyHref(row.uid, 'reports')} data-testid="link-report-detail-company">Open {row.name} · Reports</Link> : null}
      </div>
    </Sheet>
  );
}

export default function InvestorPortfolioUpdates() {
  const [filter, setFilter] = useState('period');
  const [open, setOpen] = useState(null);
  const [chasing, setChasing] = useState(false);
  const [chaseNote, setChaseNote] = useState('');
  const { reads, retry, reload } = usePortfolioReads(SOURCES);

  const inbox = useMemo(() => obligationRowsOf(reads), [reads]);
  const rows = inbox.rows;
  const complianceUnavailable = reads.compliance.state === 'unreadable';
  /**
   * The KPI set companies are held to (`kpi_set` on the compliance read).
   * An unreadable compliance source is NOT an empty rule set: the first says
   * nothing about what companies owe, the second says they owe nothing. So
   * `null` and `[]` are kept apart here and rendered apart below.
   */
  const kpiSet = complianceUnavailable ? null : (reads.compliance.value?.kpi_set || []);
  // The cadence the SERVER answered with, not the one this page asked for.
  const cadence = reads.compliance.value?.cadence || 'quarterly';
  // Each company's latest stored update the rule set is read against; with the
  // update source unreadable there is no denominator at all.
  const storedUpdates = reads.updates.state !== 'ok' ? null : rows.map((row) => row.update).filter(Boolean);
  // `Rules` is a VIEW, not a row predicate: it swaps the body.
  const showingRules = filter === 'rules';
  const visible = rows.filter((row) => (filter === 'overdue' ? row.reported === false : true));

  /**
   * THE CHASE (D464), as today. The set is the page's own: the companies the
   * reporting read says have not reported. The route re-checks the tenancy of
   * each id; one row per chase lands in the log and the founder is notified;
   * a repeat inside the hour answers the existing row.
   */
  const overdueRows = rows.filter((row) => row.reported === false);
  const afterChase = useCallback(() => { retry('chases'); retry('compliance'); }, [retry]);
  const chaseOne = useCallback(async (row) => {
    setChasing(true); setChaseNote('');
    try {
      const r = await api.portfolioChase([row.projectId]);
      const already = (r?.chased || []).some((c) => c.already);
      setChaseNote(already
        ? `${row.name || 'That company'} was already asked inside the hour — the existing chase stands.`
        : `${row.name || 'The company'} has been asked. The founder is notified and the chase is logged.`);
      afterChase();
    } catch (cause) {
      setChaseNote(cause?.message || 'The chase could not be sent.');
    } finally { setChasing(false); }
  }, [afterChase]);

  const chaseOverdue = useMemo(() => {
    if (reads.compliance.state !== 'ok') {
      return { onClick: () => {}, disabled: true, title: 'The cadence record is unavailable, so which companies are overdue is unknown — chasing blind is not offered.' };
    }
    if (!overdueRows.length) {
      return { onClick: () => {}, disabled: true, title: 'No company is overdue this period, so there is nobody to chase.' };
    }
    return {
      onClick: async () => {
        setChasing(true); setChaseNote('');
        try {
          const r = await api.portfolioChase(overdueRows.map((row) => row.projectId));
          const n = (r?.chased || []).filter((c) => !c.already).length;
          const already = (r?.chased || []).filter((c) => c.already).length;
          setChaseNote(`${n} ${n === 1 ? 'company' : 'companies'} chased${already ? ` · ${already} already asked inside the hour` : ''}${r?.skipped?.length ? ` · ${r.skipped.length} skipped as outside your book` : ''}.`);
          afterChase();
        } catch (cause) {
          setChaseNote(cause?.message || 'The chase could not be sent.');
        } finally { setChasing(false); }
      },
      busy: chasing,
    };
  }, [overdueRows, reads.compliance.state, chasing, afterChase]);

  const view = {
    header: ['Company', 'Period', 'Due', 'Received', 'Status', 'Missing', 'Last chase'],
    rows: visible,
    cells: (r) => [r.name, r.period || NOT_RECORDED, 'No due date recorded', r.received || 'Never reported', r.reporting.state,
      r.missing.text || NOT_RECORDED, r.chase.state === 'ok' ? r.chase.date : r.chase.state === 'none' ? 'Not chased' : 'Unreadable'],
  };

  const failed = Object.keys(SOURCE_NAMES).filter((k) => reads[k].state === 'unreadable').map((k) => SOURCE_NAMES[k]);
  const openRow = open ? rows.find((r) => r.key === open) || null : null;
  const received = inbox.state === 'ok' ? rows.filter((r) => r.reported).length : null;

  return (
    <PortfolioFrame
      tab="updates"
      testid="investor-portfolio-updates"
      description="Who owes you a report, what arrived, and what is missing, each shown as the company submitted it."
      context={inbox.state === 'ok' && inbox.period ? `${inbox.period} · ${inbox.inProgress ? 'in progress' : 'last completed period'}` : null}
      tools={(
        <ZoneHeaderTools role="investor">
          <button type="button" className="pf-icon-button" onClick={reload} aria-label="Refresh portfolio reports" data-testid="button-refresh-investor-reports"><RefreshCw size={15} aria-hidden="true" /></button>
        </ZoneHeaderTools>
      )}
      notice={failed.length ? (
        <p className="pf-partial" data-testid="status-investor-updates-partial">{failed.join(', ')} could not be read. Each affected column or panel says so and offers a Retry; the others are current.</p>
      ) : null}
      rail={<UpdatesRail rows={rows} reads={reads} />}
    >
      {chaseNote ? <p className="pf-partial" role="status" data-testid="status-chase-note">{chaseNote}</p> : null}
      <section className="pf-tiles pf-tiles-4" aria-label="This period" data-testid="reports-tiles">
        <SummaryTile label="Received" value={inbox.state === 'ok' ? `${received} of ${rows.length}` : inbox.state === 'loading' ? 'Reading…' : 'Unreadable'} note={inbox.state === 'ok' ? `for ${inbox.period || 'the period measured'}` : 'Reporting source'} />
        <SummaryTile label="Not received" tone={inbox.state === 'ok' && rows.length - received > 0 ? 'late' : null} value={inbox.state === 'ok' ? String(rows.length - received) : inbox.state === 'loading' ? 'Reading…' : 'Unreadable'} note={inbox.state === 'ok' ? (inbox.inProgress ? 'period still in progress' : 'period complete') : 'Reporting source'} />
        <SummaryTile label="Due date" value={NOT_RECORDED} note="The cadence records none; no days overdue are counted" />
        <SummaryTile label="Source handling" value="Source-preserved" note="KPI values and narrative are shown as submitted" />
      </section>
      {showingRules
        ? (reads.compliance.state === 'loading' ? <section className="pf-card"><Skeleton rows={3} /></section> : <RuleSet kpiSet={kpiSet} cadence={cadence} storedUpdates={storedUpdates} retry={retry} />)
        : <Inbox inbox={inbox} reads={reads} retry={retry} visible={visible} filter={filter} setFilter={setFilter} chaseOverdue={chaseOverdue} view={view}
          onOpen={(row) => setOpen(row.key)} onChase={chaseOne} chasing={chasing} rules={kpiSet || []} />}
      {/* D1061 (#2931): RPT9, what each company the investor signed into owes them under a document, with its own due dates. */}
      <PortfolioReports />
      {/* The artboard's band is "parse N updates … arriving as editable
          proposals". Half of that has somewhere to land and half does not, so
          half is mounted: the read names which asked-for figures are missing
          from a stored update and which arrived as prose. */}
      <ZoneDraft
        surface="portfolio/updates"
        railOption="draft:updates-read"
        label="Proposal · read the updates against the rule set"
        accept="Accept the read"
        run="Draft the read"
        foot="Batch cost estimated before it runs. The read names gaps; it fills none in."
        empty="What arrived measured against what was asked for: which required figures no stored update carries, and which arrived as a sentence rather than a number. Ambiguity is named, never resolved into a figure."
        nothingToDraft="No stored update is recorded against an accessible company, so there is nothing to read the rule set against."
      />
      <section className="pf-card ip2-unavailable" aria-labelledby="pf-handling-title"><h2 id="pf-handling-title" className="pf-h2">How updates are handled</h2><strong>The Rules view shows the KPI set companies report against.</strong><p className="pf-foot">Narrative text is kept as submitted and is not converted into KPI figures. If a value is absent or written only in prose, this workspace names the gap instead of inferring a number.</p><p className="pf-foot">The reporting rules are read-only here. Changes to what companies report are handled through the authorised portfolio workflow.</p></section>
      <p className="pf-boundary">Investor workspace · updates shown are restricted to this investor’s accessible portfolio.</p>
      {openRow ? <ReportDetail row={openRow} reads={reads} retry={retry} rules={kpiSet || []} cadence={cadence} onClose={() => setOpen(null)} /> : null}
    </PortfolioFrame>
  );
}

/**
 * The KPI rule set — what accessible companies are asked for, in the wording
 * they are held to.
 *
 * THREE STATES, NOT TWO. `null` is a rule set that could not be read; `[]` is a
 * rule set with nothing in it. On a page about what companies owe, those are
 * opposite answers — the first says nothing at all, the second says they owe
 * nothing — so they never share a branch.
 *
 * THE SET SHOWN IS A SLICE AND THE PANEL SAYS SO. The route filters
 * `cadence = ?` and this page reads one cadence, so rules collected on the
 * other schedule are stored and absent from this table.
 *
 * "CARRIED BY" IS NOT A COMPLIANCE RATE. It counts the stored updates on this
 * page — each company's latest, whatever period it speaks for — that carry a
 * value under the rule's key. A key present with an empty value is not carried.
 */
function RuleSet({ kpiSet, cadence, storedUpdates, retry }) {
  const carried = (key) => (storedUpdates == null ? null : storedUpdates.filter((update) => {
    const value = update?.kpis?.[key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  }).length);
  return (
    <section className="pf-card pf-table-card" aria-labelledby="pf-rules-set-title" data-testid="ip2-rule-set">
      <div className="pf-card-head">
        <h2 id="pf-rules-set-title">KPI rule set</h2>
        <span className="pf-sm">Firm-wide · read-only</span>
      </div>
      {kpiSet === null
        ? <div className="pf-pad" data-testid="ip2-rule-set-unreadable"><SourceFailure what="The rule set" claim="That is not a claim that companies are asked for nothing." onRetry={() => retry('compliance')} /></div>
        : kpiSet.length === 0
          ? <p className="pf-note"><AlertCircle size={14} aria-hidden="true" /> No KPI is defined for the firm-wide set at the {cadence} cadence. Companies reporting on this schedule are held to no stored figure.</p>
          : (
            <>
              <div className="pf-table-wrap">
                <table className="pf-table pf-ruleset">
                  <caption>What accessible companies are asked for, and the wording they are held to</caption>
                  <thead><tr><th scope="col">KPI</th><th scope="col">Unit</th><th scope="col">Asked of</th><th scope="col">Carried by</th><th scope="col">The wording companies are held to</th></tr></thead>
                  <tbody>
                    {kpiSet.map((rule) => {
                      const held = carried(rule.kpi_key);
                      return (
                        <tr key={rule.kpi_key} data-testid={`row-ip2-rule-${rule.kpi_key}`}>
                          <th scope="row" data-label="KPI">{rule.name || title(rule.kpi_key)}<small>{rule.required == null ? 'Requirement not recorded' : Number(rule.required) ? 'Required' : 'Optional'}</small></th>
                          <td data-label="Unit">{rule.unit || 'Not recorded'}</td>
                          <td data-label="Asked of">{!rule.applies_to ? 'Not recorded' : rule.applies_to === 'all' ? 'Every company' : title(rule.applies_to)}</td>
                          <td data-label="Carried by">{held === null ? <span className="pf-unreadable">Unavailable</span> : `${held} of ${storedUpdates.length}`}</td>
                          <td data-label="Wording">{rule.definition || <span className="pf-muted">No wording is stored. The figure is asked for without a stated way to compute it.</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="pf-foot pf-pad"><b>Which set this is.</b> The firm-wide rules collected at the {cadence} cadence — the one this page reads. Rules stored against another cadence are collected on that schedule and are not in this table. <em>Carried by</em> counts the stored updates on this page, each company&rsquo;s latest whatever period it speaks for, not compliance for the current period.</p>
            </>
          )}
    </section>
  );
}

function UpdatesRail({ rows, reads }) {
  return (
    <WorkerRail
      workspace="Portfolio"
      role="investor"
      className="pf-rail"
      stance="Read-only update feed"
      note="Source-preserved KPI values and narratives, shown without parsing, editing or submitting. The chase asks a silent company for its update and is logged."
      coverage={[
        reads.updates.state === 'unreadable' ? 'Update source unavailable' : `${rows.length} accessible company record${rows.length === 1 ? '' : 's'}`,
        reads.compliance.state === 'unreadable' ? 'Cadence compliance unavailable' : 'Reporting status read from cadence compliance',
      ]}
      unavailable={[
        ['Narrative extraction', 'Narrative text stays source-preserved; no figures are inferred from it.'],
        ['Editing', 'No update is edited or submitted from this page — the chase asks for one and is logged.'],
      ]}
    />
  );
}
