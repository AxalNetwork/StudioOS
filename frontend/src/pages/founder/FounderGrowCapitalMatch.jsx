import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronRight, CircleDot, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { FounderWorkerRail } from '../../ui';
import './founderGrowDesk.css';
import './founderGrowCapitalMatch.css';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const dateLabel = (value) => {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const labelStage = (value) => text(value, 'Stage not recorded').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const normalizedStage = (row) => String(row.stage || row.status || '').toLowerCase();

export default function FounderGrowCapitalMatch() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [view, setView] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      let available = [];
      try { available = list(await api.listProjects(), 'items', 'projects'); } catch (cause) {
        if (!requestedId) throw cause;
        setError('The startup list is unavailable; capital prospects are still being checked.');
      }
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || (requestedId ? { id: Number(requestedId), name: 'Selected project' } : null);
      setProjects(available.length ? available : selected ? [selected] : []);
      setProject(selected);
      if (!selected) { setProspects([]); return; }
      if (String(selected.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(selected.id)); return next; }, { replace: true });
      }
      try {
        const response = await api.raiseProspects(selected.id);
        setProspects(list(response, 'items', 'prospects'));
      } catch (cause) {
        setProspects([]);
        setError(cause?.message || 'The capital prospect source is unavailable.');
      }
    } catch (cause) {
      setProject(null); setProspects([]); setError(cause?.message || 'The project source is unavailable.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const query = project?.id ? `?project_id=${project.id}` : '';
  const stages = useMemo(() => [...new Set(prospects.map(normalizedStage).filter(Boolean))], [prospects]);
  const visible = useMemo(() => {
    if (view === 'all') return prospects;
    return prospects.filter((row) => normalizedStage(row) === view);
  }, [prospects, view]);
  const passedCount = prospects.filter((row) => normalizedStage(row) === 'passed').length;
  const contactedCount = prospects.filter((row) => !['', 'to_contact', 'new'].includes(normalizedStage(row))).length;
  const nav = [['Focus', `/grow/focus${query}`], ['Talent', `/grow/talent${query}`], ['Customers', `/grow/customers${query}`], ['Partnerships', `/grow/partnerships${query}`], ['Capital match', `/grow/capital-match${query}`], ['Brand', `/grow/brand${query}`], ['Launch', `/grow/launch${query}`]];

  return <main className="a5-grow fg-capital-match" data-testid="founder-grow-capital-match"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-capital-match-crumb"><Link to={`/grow/focus${query}`}><ArrowLeft size={13} /> Grow</Link><span>‹</span><b>Capital match</b></div><span>Founder / Grow</span><div><h1>Capital match</h1><p>Investor fit, warm paths and outreach state.</p></div>{projects.length > 1 && <label className="fg-capital-match-picker"><span>Startup</span><select data-testid="select-grow-capital-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<nav aria-label="Grow sections">{nav.map(([label, to]) => <Link data-testid={`link-grow-capital-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Capital match' ? 'is-active' : ''}>{label}</Link>)}</nav></header>
    {error && <div className="a5-grow-error" data-testid="status-grow-capital-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <CapitalSkeleton /> : !project ? <EmptyCapital /> : <CapitalContent project={project} prospects={prospects} visible={visible} stages={stages} view={view} setView={setView} query={query} error={error} passedCount={passedCount} contactedCount={contactedCount} />}
  </div><CapitalRail project={project} prospects={prospects} error={error} /></div></main>;
}

function CapitalContent({ project, prospects, visible, stages, view, setView, query, error, passedCount, contactedCount }) {
  return <div className="a5-sections"><div className="fg-capital-context"><div><span>Selected startup</span><strong data-testid="text-grow-capital-project">{text(project.name)}</strong></div><div><span>Capital source</span><strong>{error ? 'Unavailable' : prospects.length ? 'Stored raise prospects' : 'No prospects recorded'}</strong></div></div>
    <div className="fg-capital-tabs"><div><button type="button" className={view === 'all' ? 'is-active' : ''} onClick={() => setView('all')}>All prospects</button>{stages.map((stage) => <button type="button" className={view === stage ? 'is-active' : ''} key={stage} onClick={() => setView(stage)}>{labelStage(stage)}</button>)}</div><div className="fg-capital-actions"><Link to={`/raise/capital/pipeline${query}`} data-testid="link-open-grow-capital-workspace"><CircleDot size={13} /> Open workspace</Link></div></div>
    <div className="fg-capital-stats"><Stat label="Prospects tracked" value={error ? 'Unavailable' : prospects.length} note={error ? 'Capital source unavailable' : 'Project-scoped records'} muted={Boolean(error)} /><Stat label="With a warm path" value="Unavailable" note="No connector-path source connected" muted /><Stat label="Contacted" value={error ? 'Unavailable' : contactedCount} note={error ? 'Capital source unavailable' : 'Derived from recorded stage'} muted={Boolean(error)} /><Stat label="Passed" value={error ? 'Unavailable' : passedCount} note={error ? 'Capital source unavailable' : 'Recorded passed stage'} muted={Boolean(error)} /></div>
    <section className="a5-card fg-capital-table"><Head icon={CircleDot} title="Investor prospects" meta={view === 'all' ? 'Project-scoped records' : `${visible.length} matching record${visible.length === 1 ? '' : 's'}`} />{error ? <EmptyTable error /> : <ProspectTable rows={visible} />}</section>
    <section className="a5-focus fg-capital-read"><div className="a5-head"><div><Sparkles size={15} /><h2>Read the match honestly</h2></div><span>Source-derived</span></div><p>{error ? 'The selected-project capital source is unavailable, so FG5 cannot determine which prospects are tracked. Fit, warm paths, outreach state, and commitment outcomes remain unavailable.' : prospects.length ? `FG5 shows ${prospects.length} stored project-scoped prospect${prospects.length === 1 ? '' : 's'} and their recorded stages. It does not turn a prospect row into a fit score, warm path, ranking rationale, or commitment.` : 'No project-scoped investor prospects are stored for this startup, so fit, warm paths, outreach state, and commitment outcomes remain unavailable.'}</p><Link className="a5-link" to={`/raise/capital/pipeline${query}`}>Open capital pipeline <ChevronRight size={14} /></Link></section>
  </div>;
}
function ProspectTable({ rows }) {
  if (!rows.length) return <EmptyTable />;
  return <div className="fg-capital-table-wrap"><table><thead><tr><th>Fund / prospect</th><th>Fit</th><th>Path</th><th>Stage</th><th>Why this rank</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || row.uid || index}><td><strong>{text(row.firm || row.name || row.title, 'Prospect name not recorded')}</strong><small>{row.email || (row.updated_at ? `Updated ${dateLabel(row.updated_at)}` : 'Contact detail not recorded')}</small></td><td><span className="fg-capital-pill">Not scored</span></td><td><span className="fg-capital-pill">Not recorded</span></td><td><span className="fg-capital-pill is-stage">{labelStage(row.stage || row.status)}</span></td><td className="fg-capital-reason">No ranking rationale recorded.</td></tr>)}</tbody></table></div>;
}
function EmptyTable({ error }) { return <div className="a5-empty"><CircleDot size={18} /><div><b>{error ? 'Capital prospect source unavailable.' : 'No project-scoped prospects are recorded.'}</b><p>FG5 does not infer fit, warm paths, ranking, or commitments.</p></div></div>; }
function Head({ icon: Icon, title, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-capital-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function CapitalRail({ project, prospects, error }) {
  return <FounderWorkerRail
    workspace="Grow"
    className="a5-rail"
    stance="Read-only match board"
    note="This rail summarizes stored raise prospects. It does not score funds, draft outreach, or record commitments."
    coverage={[!project ? 'No project selected' : error ? 'Capital source unavailable' : `${prospects.length} stored prospect${prospects.length === 1 ? '' : 's'}`, !project || error ? 'Match signals unavailable' : 'Fit and path not recorded']}
    unavailable={[['Fit scoring', 'No score or ranking rationale source is connected.'], ['Warm paths', 'No network connector source is connected.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function CapitalSkeleton() { return <div className="a5-skeleton" data-testid="status-grow-capital-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyCapital() { return <div className="a5-empty fg-capital-empty"><CircleDot size={20} /><div><b>No startup is available.</b><p>Capital match is scoped to an authenticated startup and its stored raise prospects.</p></div></div>; }