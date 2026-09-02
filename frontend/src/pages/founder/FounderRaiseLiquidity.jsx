import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BarChart3, Clock3, FileText, Filter, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, Waves } from 'lucide-react';
import { api } from '../../lib/api';
import { FounderWorkerRail } from '../../ui';
import './founderRaiseCapital.css';
import './founderRaiseLiquidity.css';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const money = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not recorded';
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (Math.abs(amount) >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
};
const pct = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : 'Not recorded';

export default function FounderRaiseLiquidity() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [view, setView] = useState('restrictions');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError('');
    try {
      const available = list(await api.listProjects(), 'items', 'projects');
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || null;
      setProjects(available); setProject(selected);
      if (!selected) { setScenario(null); return; }
      if (String(selected.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(selected.id)); return next; }, { replace: true });
      }
      try {
        const response = await api.getCapTableByProject(selected.id);
        setScenario(response?.scenario || null);
      } catch (cause) {
        setScenario(null);
        setError(cause?.message || 'The capital ledger is unavailable.');
      }
    } catch (cause) {
      setProject(null); setScenario(null); setError(cause?.message || 'The project source is unavailable.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const result = scenario?.result || null;
  const rounds = list(result?.rounds);
  const finalLedger = rounds.at(-1)?.ledger || result?.founding || [];
  const waterfall = result?.waterfall;
  const preferenceOverhang = useMemo(() => rounds.reduce((sum, round) => {
    const meta = round?.round_meta || {};
    return sum + Number(meta.investment || 0) + Object.values(meta.safe_preferences || {}).reduce((inner, value) => inner + Number(value || 0), 0);
  }, 0), [rounds]);
  const query = project?.id ? `?project_id=${project.id}` : '';
  const workspaceQuery = project?.id ? `?mode=workspace&project_id=${project.id}` : '?mode=workspace';

  return <main className="fr-capital fr-liquidity" data-testid="founder-raise-liquidity"><div className="fr-capital-shell"><section className="fr-capital-main">
    <header className="fr-capital-header"><div className="fr-capital-crumb"><Link to={`/raise/status${query}`}><ArrowLeft size={13} /> Raise</Link><span>/</span><strong>Liquidity</strong></div><div className="fr-capital-title-row"><div><p className="fr-capital-kicker">Founder / Raise</p><h1>Liquidity &amp; exits</h1><p className="fr-capital-subtitle">Secondaries, ROFR, tender state and the exit waterfall.</p></div>{projects.length > 1 && <label className="fr-capital-picker"><span>Startup</span><select value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div><nav className="fr-capital-zone-nav" aria-label="Raise sections"><Link to={`/raise/status${query}`}>Status</Link><Link to={`/raise/pitch${query}`}>Pitch</Link><Link to={`/raise/capital${query}`}>Capital</Link><Link to={`/raise/legal${query}`}>Legal</Link><Link to={`/raise/data-room${query}`}>Data room</Link><Link to={`/raise/liquidity${query}`} className="is-active">Liquidity</Link></nav></header>
    {error && <div className="fr-capital-alert" role="alert"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <div className="fr-capital-loading"><i /><i /><div><i /><i /><i /></div></div> : !project ? <EmptyState /> : <LiquidityContent project={project} result={result} scenario={scenario} rounds={rounds} finalLedger={finalLedger} waterfall={waterfall} preferenceOverhang={preferenceOverhang} view={view} setView={setView} workspaceQuery={workspaceQuery} error={error} />}
  </section><WorkerRail project={project} result={result} error={error} /></div></main>;
}

function LiquidityContent({ project, result, scenario, rounds, finalLedger, waterfall, preferenceOverhang, view, setView, workspaceQuery, error }) {
  const openEvents = 'Unavailable';
  const restrictions = 'Unavailable';
  const rofr = 'Unavailable';
  return <div className="fr-capital-content"><div className="fr-capital-context"><div><span className="fr-capital-label">Selected startup</span><strong data-testid="text-liquidity-project">{text(project.name)}</strong><span>{text(project.sector, 'Sector not recorded')}</span></div><div className="fr-capital-context-right"><span className="fr-capital-label">Ledger source</span><strong>{result ? text(scenario?.name, 'Canonical cap table') : 'Capital ledger unavailable'}</strong><span>{result ? 'Project-scoped cap-table result' : 'No waterfall values inferred'}</span></div></div>
    <div className="fr-capital-stat-strip"><Stat label="Open events" value={openEvents} note="No project liquidity-event source" muted /><Stat label="Transfer restrictions" value={restrictions} note="No restriction ledger connected" muted /><Stat label="ROFR window" value={rofr} note="No project ROFR record" muted /><Stat label="Preference overhang" value={result && preferenceOverhang ? money(preferenceOverhang) : 'Unavailable'} note={result && preferenceOverhang ? 'Derived from stored SAFE and round investments' : 'No preference source returned'} muted={!result || !preferenceOverhang} /></div>
    <section className="fr-capital-card fr-capital-ledger"><div className="fr-capital-card-head"><div><Waves size={16} /><h2>{view === 'waterfall' ? 'Exit waterfall' : view === 'history' ? 'Liquidity history' : view === 'tender' ? 'Tender state' : 'Transfer restrictions'}</h2></div><span>{view === 'waterfall' ? 'Derived from the capital ledger' : 'Read-only source view'}</span></div><div className="fr-capital-toolbar"><div className="fr-capital-filters"><Filter size={13} />{[['restrictions', 'Restrictions'], ['waterfall', 'Waterfall'], ['tender', 'Tender'], ['history', 'History']].map(([key, label]) => <button type="button" key={key} className={view === key ? 'is-selected' : ''} onClick={() => setView(key)}>{label}</button>)}</div><div className="fr-capital-actions"><span><ShieldCheck size={13} /> Read-only ledger</span><Link to={`/liquidity${project?.id ? `?project_id=${project.id}` : ''}`} data-testid="link-open-liquidity-workspace"><BarChart3 size={13} /> Open workspace</Link></div></div>{view === 'waterfall' ? <Waterfall waterfall={waterfall} rounds={rounds} finalLedger={finalLedger} error={error} /> : <UnavailablePanel view={view} error={error} />}</section>
    <div className="fr-capital-lower-grid"><section className="fr-capital-card"><div className="fr-capital-card-head"><div><LockKeyhole size={16} /><h2>Restriction coverage</h2></div><span>Source unavailable</span></div><Coverage label="Board approval" value="Not recorded" /><Coverage label="Company ROFR" value="Not recorded" /><Coverage label="Investor ROFR" value="Not recorded" /><Coverage label="Lockup" value="Not recorded" /><p className="fr-capital-note">No Bylaws, SAFE, transfer-restriction, or project ROFR source is connected to this collection.</p></section><section className="fr-capital-card"><div className="fr-capital-card-head"><div><FileText size={16} /><h2>Capital basis</h2></div><span>{result ? 'Stored result' : 'Unavailable'}</span></div><Coverage label="Completed rounds" value={result ? rounds.length : 'Unavailable'} /><Coverage label="Ledger holders" value={result ? finalLedger.length : 'Unavailable'} /><Coverage label="Shares outstanding" value={result?.totals?.shares_outstanding ? Number(result.totals.shares_outstanding).toLocaleString() : 'Not recorded'} /><p className="fr-capital-note">{result ? 'Waterfall values are only shown when the stored scenario includes one.' : 'No cap-table result was returned for this startup.'}</p></section></div>
    <section className="fr-capital-card fr-capital-waterfall"><div className="fr-capital-card-head"><div><Sparkles size={16} /><h2>Read-only assumptions</h2></div><span>Source-derived</span></div><div className="fr-capital-unavailable"><Sparkles size={17} /><div><strong>{result ? 'No restriction summary is generated here.' : 'No capital ledger is available.'}</strong><p>This collection does not model an exit, save a restriction summary, create a tender, or mutate ROFR state. Use the workspace for supported actions.</p></div></div></section>
  </div>;
}
function Waterfall({ waterfall, rounds, finalLedger, error }) {
  if (!waterfall) return <div className="fr-capital-inline-empty"><Waves size={18} /><div><strong>{error ? 'Exit waterfall source unavailable.' : 'No exit waterfall is recorded.'}</strong><p>{rounds.length ? 'The stored cap-table result has no exit value, so no payout values are inferred.' : 'A stored cap-table result is required before an exit waterfall can be shown.'}</p></div></div>;
  return <div className="fr-capital-table-wrap"><table className="fr-room-matrix"><thead><tr><th>Holder</th><th>Type</th><th>Ownership</th><th>Preference</th><th>Payout</th><th>Source</th></tr></thead><tbody>{list(waterfall.rows).map((row, index) => <tr key={`${row.holder}-${index}`}><td><strong>{text(row.holder, 'Holder not recorded')}</strong></td><td>{text(row.type)}</td><td>{pct(row.pct)}</td><td>{money(row.preference)}</td><td>{money(row.payout)}</td><td>{text(row.source)}</td></tr>)}</tbody><tfoot><tr><td colSpan="3"><strong>Exit {money(waterfall.exit_value)}</strong></td><td>{money(waterfall.totals?.preference_paid)}</td><td>{money(waterfall.totals?.total_distributed)}</td><td>Recorded result</td></tr></tfoot></table><p className="fr-capital-note">{list(waterfall.assumptions).join(' ') || 'Assumptions not recorded.'}</p></div>;
}
function UnavailablePanel({ view, error }) { const label = view === 'restrictions' ? 'transfer restriction source' : view === 'tender' ? 'tender-event source' : 'liquidity-history source'; return <div className="fr-capital-inline-empty"><Clock3 size={18} /><div><strong>{error ? `${label} unavailable.` : `No ${label} is connected.`}</strong><p>FR6 does not infer seed-stage events, ROFR windows, or historical activity from another workspace.</p></div></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fr-capital-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function Coverage({ label, value }) { return <div className="fr-capital-coverage-row"><span>{label}</span><strong>{value}</strong></div>; }
function WorkerRail({ project, result, error }) {
  return <FounderWorkerRail
    workspace="Raise"
    className="fr-capital-rail"
    stance="Inherited from Raise"
    note="This page reads the selected project and its stored capital result. It does not model an exit or propose legal terms."
    coverage={[project ? (result ? 'Capital ledger connected' : 'Capital ledger unavailable') : 'No project selected']}
    coverageNote={error ? 'Some project-scoped sources could not be read.' : result ? 'Preference exposure and any stored waterfall are visible.' : 'No payout values are inferred.'}
    unavailable={[['Restriction summary', 'No Bylaws or SAFE clause source is connected.'], ['Exit model', 'No scenario input or AI proposal is accepted from this read-only collection.']]}
    footer="Read-only ledger · source records only"
  />;
}
function EmptyState() { return <div className="fr-capital-empty"><Waves size={24} /><h2>No startup is available</h2><p>This liquidity collection is scoped to authenticated startup records.</p><Link to="/raise/status">Back to raise</Link></div>; }