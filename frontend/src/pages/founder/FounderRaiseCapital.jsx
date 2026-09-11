import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BarChart3, ChevronRight, FileText, Landmark, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderRaiseCapital.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';

const asList = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const money = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? 'Not recorded'
  : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
/**
 * A per-share price, which `money()` cannot render.
 *
 * `money()` is built for whole-dollar amounts — a cap, a SAFE, a payout — and
 * carries `maximumFractionDigits: 0`. A 409A fair market value is cents or
 * fractions of a cent, so the first render of the 409A panel showed a real
 * $0.31 as "$0". A price rounded to nothing is not a rounded price, it is a
 * different number, and this one is the one an option strike is set from.
 */
const perShare = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? 'Not recorded'
  : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value));
const number = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? 'Not recorded'
  : Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
const percent = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? 'Not recorded'
  : `${Number(value).toFixed(1)}%`;
const date = (value) => {
  if (!value) return 'Date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};
const prettyType = (value) => text(value).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function FounderRaiseCapital() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(Number(requestedId) || null);
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});
  // All five of the canvas's views. Every one of them reads a record this page
  // already fetches — the ledger, the SAFE inputs, the compare variants, the
  // 409A read and the derived waterfall are four separate fulfilled calls plus
  // a derivation. Four of the five shipped as `disabled` buttons over data that
  // was sitting in scope.
  const [view, setView] = useState('ownership');
  const [loading, setLoading] = useState(true);
  const lastAutoLoad = useRef(null);

  const load = async () => {
    setLoading(true);
    const nextErrors = {};
    try {
      const available = asList(await api.listProjects(), 'items', 'projects');
      const requested = Number(requestedId);
      const chosen = available.find((item) => Number(item.id) === requested) || available[0];
      setProjects(available);
      setProjectId(chosen?.id || null);
      if (!chosen) {
        setData({});
        setErrors({});
        return;
      }
      if (String(chosen.id) !== requestedId) {
        setParams((old) => {
          const next = new URLSearchParams(old);
          next.set('project_id', String(chosen.id));
          return next;
        }, { replace: true });
      }
      const reads = await Promise.allSettled([
        api.getCapTableByProject(chosen.id),
        api.getCapTableCompare(chosen.id),
        api.get409a(chosen.id),
      ]);
      const [capTable, compare, safeHarbour] = reads;
      if (capTable.status === 'fulfilled') nextData(nextErrors, 'capTable', capTable.value);
      else nextErrors.capTable = capTable.reason?.message || 'Cap-table source unavailable.';
      if (compare.status === 'fulfilled') nextData(nextErrors, 'compare', compare.value);
      else nextErrors.compare = compare.reason?.message || 'Scenario source unavailable.';
      if (safeHarbour.status === 'fulfilled') nextData(nextErrors, 'safeHarbour', safeHarbour.value);
      else nextErrors.safeHarbour = safeHarbour.reason?.message || '409A source unavailable.';
      setData(nextErrors.__data || {});
      delete nextErrors.__data;
    } catch (cause) {
      nextErrors.projects = cause?.message || 'The project list is unavailable.';
      setData({});
    } finally {
      setErrors(nextErrors);
      setLoading(false);
    }
  };

  useEffect(() => {
    const key = requestedId || 'default';
    if (lastAutoLoad.current === key) return;
    lastAutoLoad.current = key;
    load();
  }, [requestedId]);

  const project = projects.find((item) => Number(item.id) === Number(projectId));
  const scenario = data.capTable?.scenario || data.capTable || null;
  const result = scenario?.result || null;
  const inputs = scenario?.inputs || {};
  const latestRound = result?.rounds?.[result.rounds.length - 1] || null;
  const ledger = latestRound?.ledger || [];
  const variants = asList(data.compare, 'variants');
  const safeHarbour = data.safeHarbour || null;
  const query = projectId ? `?project_id=${projectId}` : '';
  const ledgerTotal = latestRound?.shares_post ?? (ledger.length ? ledger.reduce((sum, row) => sum + (Number(row.shares) || 0), 0) : null);
  const foundersNow = useMemo(() => {
    const series = asList(result?.founder_dilution);
    const first = series.flatMap((row) => row.series || []).filter((row) => row.round === 'Founding');
    const latest = series.flatMap((row) => row.series || []).filter((row) => row.round === latestRound?.name);
    return {
      now: first.length ? first.reduce((sum, row) => sum + (Number(row.pct) || 0), 0) : null,
      post: latest.length ? latest.reduce((sum, row) => sum + (Number(row.pct) || 0), 0) : null,
    };
  }, [result, latestRound]);
  const safes = asList(inputs.safes);
  const safeTotal = safes.length ? safes.reduce((sum, safe) => sum + (Number(safe.amount) || 0), 0) : null;
  const waterfall = result?.waterfall || null;

  const selectProject = (value) => {
    const id = Number(value);
    setProjectId(id);
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set('project_id', String(id));
      return next;
    }, { replace: true });
  };

  return <main className="fr-capital" data-testid="founder-raise-capital">
    <div className="fr-capital-shell">
      <section className="fr-capital-main">
        <header className="fr-capital-header">
          <div className="fr-capital-crumb"><Link to={`/raise/status${query}`} data-testid="link-capital-back"><ArrowLeft size={13} /> Raise</Link><span>/</span><strong>Capital</strong></div>
          <div className="fr-capital-title-row"><div><h1>Capital</h1><p className="fr-capital-subtitle">Full cap table, instruments, scenarios, 409A and waterfalls.</p></div>{projects.length > 1 && <label className="fr-capital-picker"><span>Startup</span><select data-testid="select-capital-project" value={projectId || ''} onChange={(event) => selectProject(event.target.value)}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
          <nav className="fr-capital-zone-nav" aria-label="Raise sections">
            <Link to={`/raise/status${query}`}>Status</Link><Link to={`/raise/pitch${query}`}>Pitch</Link><Link to={`/raise/capital${query}`} className="is-active" data-testid="link-capital-zone">Capital</Link><Link to={`/raise/legal${query}`}>Legal</Link><Link to={`/raise/data-room${query}`}>Data room</Link><span className="fr-capital-zone-disabled">Liquidity unavailable</span>
          </nav>
          <ZoneToolbar
              filters={founderZoneFilters('raise/capital', { value: view, onChange: setView })}
              actions={founderZoneActions('raise/capital', { query })}
            />
        </header>
        {Object.keys(errors).length > 0 && <div className="fr-capital-alert" role="alert" data-testid="status-capital-partial"><AlertCircle size={16} /><span>{errors.projects || errors.capTable || 'Some capital sources are unavailable.'}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
        {loading ? <CapitalSkeleton /> : errors.projects ? <UnavailableCapital onRetry={load} /> : !project ? <EmptyCapital /> : <CapitalContent view={view} project={project} scenario={scenario} result={result} latestRound={latestRound} ledger={ledger} ledgerTotal={ledgerTotal} foundersNow={foundersNow} safes={safes} safeTotal={safeTotal} variants={variants} waterfall={waterfall} safeHarbour={safeHarbour} errors={errors} query={query} />}
      </section>
      <PageRail project={project} scenario={scenario} ledger={ledger} variants={variants} waterfall={waterfall} />
    </div>
  </main>;
}

function nextData(errors, key, value) {
  errors.__data = errors.__data || {};
  errors.__data[key] = value;
}

function CapitalContent({ view, project, scenario, result, latestRound, ledger, ledgerTotal, foundersNow, safes, safeTotal, variants, waterfall, safeHarbour, errors, query }) {
  const founderNow = foundersNow.now;
  const founderPost = foundersNow.post;
  const ownershipRows = ledger.map((holder, index) => ({ ...holder, id: holder.id || index, holder: text(holder.holder), type: prettyType(holder.type), shares: number(holder.shares), pct: percent(holder.pct), state: text(holder.state || holder.status) }));
  return <div className="fr-capital-content">
    <div className="fr-capital-context"><div><span className="fr-capital-label">Selected startup</span><strong data-testid="text-capital-project">{text(project.name)}</strong><span>{text(project.sector, 'Sector not recorded')}</span></div><div className="fr-capital-context-right"><span className="fr-capital-label">Canonical cap table</span><strong>{scenario ? text(scenario.name, 'Unnamed scenario') : 'No cap table recorded'}</strong><span>{scenario?.updated_at ? `Updated ${date(scenario.updated_at)}` : 'Scenario date not recorded'}</span></div></div>
    <div className="fr-capital-stat-strip"><Stat label="Fully diluted" value={ledgerTotal === null ? 'Unavailable' : number(ledgerTotal)} note={ledgerTotal === null ? 'No computed ledger returned' : 'Latest computed ownership ledger'} muted={ledgerTotal === null} /><Stat label="Founders now" value={founderNow === null ? 'Unavailable' : percent(founderNow)} note={founderNow === null ? 'Founding series unavailable' : 'From founding dilution series'} muted={founderNow === null} /><Stat label="Founders post-round" value={founderPost === null ? 'Unavailable' : percent(founderPost)} note={founderPost === null ? 'Post-round series unavailable' : 'Latest returned round'} muted={founderPost === null} /><Stat label="Outstanding SAFEs" value={safeTotal === null ? 'Unavailable' : money(safeTotal)} note={safeTotal === null ? 'No SAFE input returned' : `${safes.length} instrument${safes.length === 1 ? '' : 's'}`} muted={safeTotal === null} /></div>
    <section className="fr-capital-card fr-capital-ledger">
      <div className="fr-capital-card-head"><div><Landmark size={16} /><h2>{LEDGER_VIEWS[view].title}</h2></div><span>{LEDGER_VIEWS[view].meta({ ledger, safes, variants, safeHarbour, waterfall, errors })}</span></div>
      {/* The canvas's filter row for this card is the zone header's now. Four
          of its five buttons used to be `disabled` here while the records
          behind them sat in scope — the 409A read and the compare variants
          are their own fulfilled calls in `load()`. */}
      <div className="fr-capital-toolbar"><div className="fr-capital-actions"><span><FileText size={13} /> Read-only ledger</span><Link to={`/raise/capital?mode=workspace${project.id ? `&project_id=${project.id}&project=${project.id}` : ''}`} data-testid="link-open-capital-editor"><Landmark size={13} /> Open editor</Link></div></div>
      <LedgerPanel view={view} ownershipRows={ownershipRows} safes={safes} variants={variants} safeHarbour={safeHarbour} waterfall={waterfall} errors={errors} />
      <p className="fr-capital-note">Ownership rows, shares and percentages come from the server-computed scenario. Filing state, conversion state, and preference terms remain not recorded unless the source returns them.</p>
    </section>
    <div className="fr-capital-lower-grid"><section className="fr-capital-card"><div className="fr-capital-card-head"><div><BarChart3 size={16} /><h2>Instruments & scenarios</h2></div><span>{variants.length ? `${variants.length} draft variants` : (errors.compare ? 'Source unavailable' : 'No variants')}</span></div><div className="fr-capital-coverage-row"><span>SAFE inputs</span><strong>{safes.length || 'Unavailable'}</strong></div><div className="fr-capital-coverage-row"><span>Computed rounds</span><strong>{result?.rounds?.length ?? 'Unavailable'}</strong></div><div className="fr-capital-coverage-row"><span>Draft scenarios</span><strong>{errors.compare ? 'Unavailable' : variants.length}</strong></div><p className="fr-capital-note">Instrument conversion and scenario outcomes are shown only from stored inputs and computed results.</p><Link className="fr-capital-editor-link" to={`/raise/capital?mode=workspace${project.id ? `&project_id=${project.id}&project=${project.id}` : ''}`}>Open cap-table editor <ChevronRight size={13} /></Link></section><section className="fr-capital-card"><div className="fr-capital-card-head"><div><ShieldCheck size={16} /><h2>409A safe harbour</h2></div><span>{errors.safeHarbour ? 'Source unavailable' : (safeHarbour?.status?.state || 'Not recorded')}</span></div>{safeHarbour?.current ? <><div className="fr-capital-coverage-row"><span>Valuation date</span><strong>{date(safeHarbour.current.valuation_date)}</strong></div><div className="fr-capital-coverage-row"><span>Provider</span><strong>{text(safeHarbour.current.provider)}</strong></div><div className="fr-capital-coverage-row"><span>Common FMV</span><strong>{money(safeHarbour.current.fmv_per_share)}</strong></div></> : <div className="fr-capital-unavailable"><ShieldCheck size={17} /><div><strong>{errors.safeHarbour ? '409A source unavailable.' : 'No valuation is recorded.'}</strong><p>FR3 does not calculate a valuation or safe-harbour state.</p></div></div>}<p className="fr-capital-note">{safeHarbour?.status?.reason || 'Safe-harbour reasoning is not recorded.'}</p></section></div>
    <section className="fr-capital-card fr-capital-waterfall"><div className="fr-capital-card-head"><div><Sparkles size={16} /><h2>Exit waterfall</h2></div><span>{waterfall ? `Exit ${money(waterfall.exit_value)}` : 'Unavailable'}</span></div>{waterfall?.totals ? <div className="fr-capital-waterfall-grid"><div><span>Preference paid</span><strong>{money(waterfall.totals.preference_paid)}</strong></div><div><span>Common pool</span><strong>{money(waterfall.totals.common_pool)}</strong></div><div><span>Total distributed</span><strong>{money(waterfall.totals.total_distributed)}</strong></div></div> : <div className="fr-capital-unavailable"><Sparkles size={17} /><div><strong>Waterfall output unavailable.</strong><p>No exit value and computed waterfall were returned for this startup. FR3 does not estimate preference cost.</p></div></div>}<p className="fr-capital-note">{waterfall?.assumptions?.length ? `Assumptions: ${waterfall.assumptions.join(' · ')}` : 'Preference, participation and exit assumptions are not recorded.'}</p></section><p className="fr-capital-footer-note">Canonical scenario: {scenario ? 'stored and read-only here' : 'not recorded'}. Model a round, export, and instrument writes stay in the existing editor.</p>
  </div>;
}

/**
 * The five views the FR3 artboard draws, each over a record this page already
 * loads. A view whose source did not come back says which source, because
 * "no instruments" and "the instrument source failed" are different facts and
 * only one of them is about the company.
 */
const LEDGER_VIEWS = {
  ownership: { title: 'Ownership ledger', meta: ({ ledger }) => (ledger.length ? 'Tabular · fully diluted' : 'Computed ledger unavailable') },
  instruments: { title: 'Instruments', meta: ({ safes }) => (safes.length ? `${safes.length} stored SAFE input${safes.length === 1 ? '' : 's'}` : 'No instrument recorded') },
  scenarios: { title: 'Scenarios', meta: ({ variants, errors }) => (errors.compare ? 'Scenario source unavailable' : `${variants.length} draft variant${variants.length === 1 ? '' : 's'}`) },
  '409a': { title: '409A', meta: ({ safeHarbour, errors }) => (errors.safeHarbour ? '409A source unavailable' : safeHarbour ? 'Latest safe-harbour read' : 'No 409A recorded') },
  waterfall: { title: 'Exit waterfall', meta: ({ waterfall }) => (waterfall ? 'Derived from the ledger above' : 'No waterfall returned') },
};

function LedgerRows({ head, rows, empty }) {
  if (!rows.length) return <div className="fr-capital-unavailable"><Sparkles size={17} /><div><strong>{empty}</strong></div></div>;
  return <div className="fr-capital-table-wrap"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={row.key || index}>{row.cells.map((cell, cellIndex) => <td key={cellIndex}>{cellIndex === 0 ? <strong>{cell}</strong> : cell}</td>)}</tr>)}
  </tbody></table></div>;
}

function LedgerPanel({ view, ownershipRows, safes, variants, safeHarbour, waterfall, errors }) {
  if (view === 'instruments') {
    return <LedgerRows head={['Instrument', 'Amount', 'Cap', 'Discount', 'Source']}
      empty={errors.capTable ? 'The cap-table source did not return, so instruments cannot be listed.' : 'No SAFE or note is recorded on this cap table.'}
      rows={safes.map((safe, index) => ({ key: safe.id || index, cells: [
        text(safe.name || safe.holder, 'Unnamed instrument'), money(safe.amount),
        safe.cap != null ? money(safe.cap) : 'Not recorded',
        safe.discount != null ? `${safe.discount}%` : 'Not recorded', 'Cap-table input'] }))} />;
  }
  if (view === 'scenarios') {
    return <LedgerRows head={['Scenario', 'Rounds', 'Founders after', 'Source']}
      empty={errors.compare ? 'The scenario source did not return.' : 'No draft scenario is saved on this cap table.'}
      rows={variants.map((variant, index) => ({ key: variant.id || index, cells: [
        text(variant.name || variant.label, 'Unnamed scenario'),
        variant.rounds?.length ?? 'Not recorded',
        variant.founder_pct != null ? percent(variant.founder_pct) : 'Not recorded', 'Draft variant'] }))} />;
  }
  if (view === '409a') {
    const rows = safeHarbour ? [{ key: '409a', cells: [
      text(safeHarbour.valuation_date || safeHarbour.date, 'Date not recorded'),
      safeHarbour.fair_market_value != null ? perShare(safeHarbour.fair_market_value) : 'Not recorded',
      text(safeHarbour.provider || safeHarbour.method, 'Provider not recorded'),
      text(safeHarbour.status, 'Status not recorded')] }] : [];
    return <LedgerRows head={['Valuation date', 'FMV per share', 'Provider', 'State']} rows={rows}
      empty={errors.safeHarbour ? 'The 409A source did not return.' : 'No 409A valuation is recorded for this startup.'} />;
  }
  if (view === 'waterfall') {
    return <LedgerRows head={['Holder', 'Type', 'Preference', 'Payout']}
      empty={waterfall ? 'The waterfall returned totals but no per-holder rows.' : 'No exit waterfall is derived, because the ledger it needs did not return.'}
      rows={asList(waterfall?.rows).map((row, index) => ({ key: row.id || index, cells: [
        text(row.holder, 'Holder not recorded'), text(row.type, 'Not recorded'),
        row.preference != null ? money(row.preference) : 'Not recorded',
        row.payout != null ? money(row.payout) : 'Not recorded'] }))} />;
  }
  return <LedgerRows head={['Holder', 'Class', 'Shares', 'FD %', 'State']}
    empty="The computed ownership ledger did not return."
    rows={ownershipRows.map((row) => ({ key: row.id, cells: [row.holder, row.type, row.shares, row.pct, row.state] }))} />;
}

function Stat({ label, value, note, muted }) { return <div className={`fr-capital-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function PageRail({ project, scenario, ledger, variants, waterfall }) {
  return <WorkerRail
    workspace="Raise"
    className="fr-capital-rail"
    stance="Manual capital view"
    note="This page reads the selected project's computed cap table, scenario and 409A records. It does not model, export, or change terms."
    coverage={[project ? `${ledger.length} ownership row${ledger.length === 1 ? '' : 's'}` : 'No project selected']}
    coverageNote={project ? `${variants.length} draft scenario${variants.length === 1 ? '' : 's'} · ${waterfall ? 'waterfall returned' : 'waterfall unavailable'}` : 'Select a startup to read its capital records.'}
    unavailable={[['Term modelling', 'No model-round action is enabled on this read-only surface.'], ['AI waterfall brief', 'No automated proposal or attach action is enabled.']]}
    footer="Read-only ledger · edit through capital workspace"
  />;
}
function EmptyCapital() { return <div className="fr-capital-empty" data-testid="empty-raise-capital"><Landmark size={24} /><h2>No startup is available</h2><p>This founder capital ledger is scoped to authenticated startup records. There is no project to inspect yet.</p><Link to="/raise/status">Back to raise</Link></div>; }
function UnavailableCapital({ onRetry }) { return <div className="fr-capital-empty" data-testid="unavailable-raise-capital"><AlertCircle size={24} /><h2>Project source unavailable</h2><p>The selected startup cannot be read right now. No ownership, dilution, or waterfall values are inferred from a failed request.</p><button type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button></div>; }
function CapitalSkeleton() { return <div className="fr-capital-loading" data-testid="status-raise-capital-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }