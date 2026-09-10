import { useCallback, useEffect, useMemo, useState } from 'react';
import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import './investorPortfolioCanvas.css';
import './investorPortfolioUpdates.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';

const money = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : `$${Math.round(Number(value)).toLocaleString()}`;
const title = (value, fallback = 'Not recorded') => String(value ?? '').trim().replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || fallback;
const dateLabel = (value) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const kpiText = (update) => Object.entries(update?.kpis || {}).slice(0, 4).map(([key, value]) => `${title(key)} ${typeof value === 'number' ? money(value) : String(value)}`).join(' · ');

export default function InvestorPortfolioUpdates() {
  const [filter, setFilter] = useState('period');
  const [state, setState] = useState({ loading: true, error: '', positions: [], updates: [], compliance: null, health: null, unavailable: { positions: false, updates: false, compliance: false, health: false } });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const positionsResult = await api.positionsList();
      const optional = await Promise.allSettled([api.portfolioUpdatesList(), api.positionsKpiCompliance(), api.portfolioHealthList({})]);
      setState({
        loading: false, error: '',
        positions: list(positionsResult, 'items', 'positions'),
        updates: optional[0].status === 'fulfilled' ? list(optional[0].value, 'items', 'updates') : [],
        compliance: optional[1].status === 'fulfilled' ? optional[1].value : null,
        health: optional[2].status === 'fulfilled' ? optional[2].value : null,
        unavailable: { positions: false, updates: optional[0].status === 'rejected', compliance: optional[1].status === 'rejected', health: optional[2].status === 'rejected' },
      });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error?.message || 'The positions source could not be loaded.', unavailable: { positions: true, updates: true, compliance: true, health: true } }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const complianceByProject = new Map((state.compliance?.companies || []).map((item) => [String(item.project_id), item]));
    const healthByProject = new Map((state.health?.items || []).map((item) => [String(item.project_id), item]));
    const latestByProject = new Map();
    state.updates.forEach((update) => {
      const date = update.submitted_at || update.updated_at || update.created_at;
      const current = latestByProject.get(String(update.project_id));
      if (date && (!current || new Date(date) > new Date(current.submitted_at || current.updated_at || current.created_at))) latestByProject.set(String(update.project_id), update);
    });
    return state.positions.map((position) => {
      const compliance = complianceByProject.get(String(position.project_id)) || null;
      const update = latestByProject.get(String(position.project_id)) || null;
      const current = state.unavailable.compliance ? null : Boolean(compliance?.reported);
      return { ...position, compliance, health: healthByProject.get(String(position.project_id)) || null, update, current, arrived: current === true && update ? update.submitted_at || update.updated_at : null, status: state.unavailable.updates ? 'Unavailable' : current === false ? 'Not reported' : update ? 'Received' : 'Not recorded' };
    });
  }, [state]);
  // `if (filter === 'parse') return false; if (filter === 'rules') return false;`
  // used to sit here — two chips that emptied the inbox. An empty inbox reads
  // as "every update is clean", not "nothing here was ever parsed", which is
  // the actual truth and is now stated in the zone header row instead of being
  // discovered by clicking. Both are prose there; neither reaches this filter.
  const visible = rows.filter((row) => (filter === 'overdue' ? row.current === false : true));
  const complianceUnavailable = state.unavailable.compliance;
  const healthUnavailable = state.unavailable.health;
  /**
   * The KPI set companies are held to.
   *
   * `GET /positions/kpi-compliance` has returned this as `kpi_set` on every
   * load of this page since it was written, and nothing rendered it — which is
   * why the `Rules` chip was marked unbuilt over data already in hand. It is
   * the firm-wide set (`fund_id IS NULL`) at the requested cadence.
   *
   * An unreadable compliance source is NOT an empty rule set: the first says
   * nothing about what companies owe, the second says they owe nothing. So
   * `null` and `[]` are kept apart here and rendered apart below.
   */
  const kpiSet = complianceUnavailable ? null : (state.compliance?.kpi_set || []);
  // The cadence the SERVER answered with, not the one this page asked for.
  // The store holds rules at more than one cadence and the route filters on a
  // single one, so the set shown is a slice — which the panel has to say, or a
  // reader counts these rows as the whole of what companies owe.
  const cadence = state.compliance?.cadence || 'quarterly';
  /**
   * The stored updates the rule set is read against, and why `null` is not `[]`.
   *
   * Each row's `update` is the LATEST stored update for that company, whatever
   * period it speaks for — so "carried by N of M" is a statement about the
   * updates on this page, and the panel words it that way rather than as a
   * compliance rate for the current period, which this list cannot support.
   *
   * With the update source unreadable there is no denominator at all, so the
   * column reads Unavailable rather than counting zero out of zero.
   */
  const storedUpdates = state.unavailable.updates ? null : rows.map((row) => row.update).filter(Boolean);
  // The `Rules` chip is a VIEW, not a row predicate. `period` and `overdue`
  // narrow the inbox; there is no way to narrow an inbox by a rule set, and a
  // chip that emptied it would read as "no update breaks a rule" — the reason
  // the two dead predicates above this were removed. So it swaps the body.
  const showingRules = filter === 'rules';
  const arrived = complianceUnavailable ? 'Unavailable' : state.compliance?.reported_count ?? 0;
  const total = complianceUnavailable ? 'Unavailable' : state.compliance?.total_count ?? rows.length;
  const neverArrived = complianceUnavailable ? 'Unavailable' : Math.max(0, Number(total) - Number(arrived));
  const runwayAlerts = healthUnavailable ? 'Unavailable' : rows.filter((row) => Number(row.health?.runway_months) < 6).length;
  const partial = Object.values(state.unavailable).some(Boolean);

  return <div className="i4-shell ip2-shell"><main className="i4-portfolio ip2-updates" data-testid="investor-portfolio-updates"><header className="i4-heading"><div><h1>Updates &amp; KPI collection</h1><p>Inbox, cadence compliance and source-preserved founder updates from the investor-accessible portfolio.</p></div><button type="button" className="i4-icon-button" onClick={load} aria-label="Refresh portfolio updates"><RefreshCw size={15} /></button></header>
    <ZoneNav bucket={bucketForPath('investor', '/portfolio')} role="investor" className="my-3" />
    <ZoneToolbar
      role="investor"
      className="mb-3"
      filters={investorZoneFilters('portfolio/updates', { value: filter, onChange: setFilter })}
      actions={investorZoneActions('portfolio/updates', { view: { header: ['Company', 'Stage', 'Arrived', 'State', 'Update'], rows, cells: (r) => [r.project?.name, r.project?.stage, r.arrived, r.status, r.update?.title] } })}
    />
    {state.error && <div className="i4-error" data-testid="status-investor-updates-error"><span>{String(state.error).toLowerCase() === 'not found' ? 'Portfolio update source unavailable in local development. No empty inbox claim is being made.' : state.error}</span><button type="button" onClick={load}>Retry</button></div>}
    {partial && !state.loading && <div className="i4-partial" data-testid="status-investor-updates-partial">Some portfolio sources are temporarily unavailable. Affected metrics and cells are labelled rather than treated as zero.</div>}
    {state.loading ? <Skeleton /> : <>
      <section className="i4-stats"><Stat label="Arrived" value={complianceUnavailable ? 'Unavailable' : `${arrived} of ${total}`} note={complianceUnavailable ? 'Cadence source unavailable' : `${rows.filter((row) => row.current === true && row.update).length} with a stored update`} /><Stat label="Never arrived" value={complianceUnavailable ? 'Unavailable' : neverArrived} note={complianceUnavailable ? 'Cadence source unavailable' : 'Current period not reported'} /><Stat label="Parse review" value="Unavailable" note="No parse-review state is stored" muted /><Stat label="Runway alerts" value={runwayAlerts} note={healthUnavailable ? 'Health source unavailable' : 'Below 6 months from health records'} /></section>
      {showingRules
        ? <RuleSet kpiSet={kpiSet} cadence={cadence} storedUpdates={storedUpdates} />
        : <section className="i4-card i4-positions ip2-inbox"><div className="i4-section-head"><div><h2>Update inbox</h2><p>Cadence status and founder-submitted content</p></div><span>Source-preserved · no write</span></div><UpdateTable rows={visible} updatesUnavailable={state.unavailable.updates} complianceUnavailable={complianceUnavailable} /><p className="i4-seam-note"><span>Founder record</span> Submitted updates remain attributable to their source company. IP2 does not edit, parse, chase, or submit an update.</p></section>}
      {/* The artboard's band is "parse N updates … arriving as editable
          proposals". Half of that has somewhere to land and half does not, so
          half is mounted: the read names which asked-for figures are missing
          from a stored update and which arrived as prose. Accepting a draft
          stamps the draft and writes nothing else — there is no proposal queue
          and no KPI ledger to accept INTO — so the label promises a read. */}
      <ZoneDraft
        surface="portfolio/updates"
        label="Proposal · read the updates against the rule set"
        accept="Accept the read"
        run="Draft the read"
        foot="Batch cost estimated before it runs. The read names gaps; it fills none in."
        empty="What arrived measured against what was asked for: which required figures no stored update carries, and which arrived as a sentence rather than a number. Ambiguity is named, never resolved into a figure."
        nothingToDraft="No stored update is recorded against an accessible company, so there is nothing to read the rule set against."
      />
      <section className="i4-card ip2-unavailable"><div className="i4-section-head"><div><h2>Two rule sets, and only one of them exists</h2><p>What companies are asked for is stored; how a sentence becomes a number is not</p></div></div><strong>The collection rules are stored, and the Rules view above shows them.</strong><p>The KPI set companies are held to — the wording, the unit, the cadence and whether each is required — is stored firm-wide, and this page has been reading it on every load since it was written. What is not stored is an extraction rule: nothing records how “a team of ~12” becomes a headcount, so there is no parse-review state, no ambiguity flag and no proposal queue for this page to show. Those stay absent, and the strip above labels them rather than reporting a zero.</p><p>Editing is a third thing again. No write path for the KPI set is exposed anywhere in the API, so the ops row leaves Edit rules unoffered rather than opening an editor that could not save.</p></section>
      <footer className="i4-boundary">Investor workspace · updates shown are restricted to this investor’s accessible portfolio.</footer></>}
  </main><UpdatesRail rows={rows} unavailable={state.unavailable} /></div>;
}

function UpdateTable({ rows, updatesUnavailable, complianceUnavailable }) {
  if (updatesUnavailable) return <div className="i4-empty"><AlertCircle size={16} />Portfolio update source unavailable. No empty-reporting claim is being made.</div>;
  if (!rows.length) return <div className="i4-empty"><Inbox size={16} />No accessible portfolio companies are recorded for this investor.</div>;
  return <div className="i4-table-wrap"><table><thead><tr><th>Company</th><th>Arrived</th><th>State</th><th>What came in</th></tr></thead><tbody>{rows.map((row) => <tr key={row.project_id} data-testid={`row-investor-update-${row.project_id}`}><td><strong>{row.project?.name || `Startup ${row.project_id}`}</strong><small>{row.project?.stage || 'Stage not recorded'}</small></td><td>{row.arrived ? dateLabel(row.arrived) : '—'}{row.update && !row.current && !complianceUnavailable && <small>Last stored update: {dateLabel(row.update.submitted_at || row.update.updated_at)}</small>}</td><td><span className={`ip2-state is-${row.status.toLowerCase().replace(/\s+/g, '-')}`}>{row.status}</span></td><td>{row.update ? <><strong>{row.update.title || 'Untitled update'}</strong><small>{kpiText(row.update) || 'No KPI values recorded'}</small></> : <span className="ip2-muted">{complianceUnavailable ? 'Cadence status unavailable' : 'No current update recorded'}</span>}</td></tr>)}</tbody></table></div>;
}
/**
 * The KPI rule set — what accessible companies are asked for, in the wording
 * they are held to.
 *
 * WHY THIS PANEL EXISTS. `Rules` was marked unbuilt on this zone for want of an
 * extraction layer. That reason is true about extraction and false about rules:
 * the KPI set is a stored, seeded, firm-wide table, and the compliance endpoint
 * has been returning it as `kpi_set` on every load of this page since the page
 * was written. Nothing rendered it. The chip was dark over data already in hand.
 *
 * THREE STATES, NOT TWO. `null` is a rule set that could not be read; `[]` is a
 * rule set with nothing in it. On a page about what companies owe, those are
 * opposite answers — the first says nothing at all, the second says they owe
 * nothing — so they never share a branch.
 *
 * THE SET SHOWN IS A SLICE AND THE PANEL SAYS SO. The route filters
 * `cadence = ?` and this page reads one cadence, so rules collected on the
 * other schedule are stored and absent from this table. Presenting these rows
 * as the whole of what companies are asked for would be the same defect one
 * layer down from the one this panel fixes.
 *
 * "CARRIED BY" IS NOT A COMPLIANCE RATE. It counts the stored updates on this
 * page — each company's latest, whatever period it speaks for — that carry a
 * value under the rule's key. A key present with an empty value is not carried:
 * an asked-for figure that arrived blank is exactly the gap this column is for.
 */
function RuleSet({ kpiSet, cadence, storedUpdates }) {
  const carried = (key) => (storedUpdates == null ? null : storedUpdates.filter((update) => {
    const value = update?.kpis?.[key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  }).length);
  return (
    <section className="i4-card i4-positions ip2-rules" data-testid="ip2-rule-set">
      <div className="i4-section-head">
        <div>
          <h2>KPI rule set</h2>
          <p>What accessible companies are asked for, and the wording they are held to</p>
        </div>
        <span>Firm-wide · read-only</span>
      </div>
      {kpiSet === null
        ? <div className="i4-error" data-testid="ip2-rule-set-unreadable"><span>The rule set could not be read. That is not a claim that companies are asked for nothing.</span></div>
        : kpiSet.length === 0
          ? <div className="i4-empty"><AlertCircle size={16} />No KPI is defined for the firm-wide set at the {cadence} cadence. Companies reporting on this schedule are held to no stored figure.</div>
          : (
            <>
              <div className="i4-table-wrap">
                <table>
                  <thead><tr><th>KPI</th><th>Unit</th><th>Asked of</th><th>Carried by</th><th>The wording companies are held to</th></tr></thead>
                  <tbody>
                    {kpiSet.map((rule) => {
                      const held = carried(rule.kpi_key);
                      return (
                        <tr key={rule.kpi_key} data-testid={`row-ip2-rule-${rule.kpi_key}`}>
                          <td><strong>{rule.name || title(rule.kpi_key)}</strong><small>{rule.required == null ? 'Requirement not recorded' : Number(rule.required) ? 'Required' : 'Optional'}</small></td>
                          <td>{rule.unit || 'Not recorded'}</td>
                          <td>{!rule.applies_to ? 'Not recorded' : rule.applies_to === 'all' ? 'Every company' : title(rule.applies_to)}</td>
                          <td>{held === null ? <span className="ip2-muted">Unavailable</span> : `${held} of ${storedUpdates.length}`}</td>
                          <td>{rule.definition || <span className="ip2-muted">No wording is stored. The figure is asked for without a stated way to compute it.</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="i4-seam-note"><span>Which set this is</span> The firm-wide rules collected at the {cadence} cadence — the one this page reads. Rules stored against another cadence are collected on that schedule and are not in this table. <em>Carried by</em> counts the stored updates on this page, each company&rsquo;s latest whatever period it speaks for, not compliance for the current period.</p>
            </>
          )}
    </section>
  );
}
function Stat({ label, value, note, muted }) { return <article className={`i4-stat${muted ? ' ip2-muted-stat' : ''}`}><div><span>{label}</span><b>{value}</b><small>{note}</small></div></article>; }
function UpdatesRail({ rows, unavailable }) {
  return (
    <WorkerRail
      workspace="Portfolio"
      role="investor"
      className="i4-rail"
      stance="Read-only update feed"
      note="Source-preserved KPI values and narratives, shown without parsing, editing, chasing or submitting."
      coverage={[
        unavailable.updates ? 'Update source unavailable' : `${rows.length} accessible company record${rows.length === 1 ? '' : 's'}`,
        unavailable.compliance ? 'Cadence compliance unavailable' : 'Reporting status read from cadence compliance',
      ]}
      unavailable={[
        ['Parse review', 'No parse-review or extraction-rule fields are returned by the source.'],
        ['Outbound', 'Nothing is sent to a founder from this page.'],
      ]}
    />
  );
}
function Skeleton() { return <div className="i4-skeleton" aria-busy="true"><i /><i /><i /><i /></div>; }