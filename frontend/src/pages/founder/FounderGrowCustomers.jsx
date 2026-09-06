import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BarChart3, ChevronRight, Filter, RefreshCw, Sparkles, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderGrowDesk.css';
import './founderGrowCustomers.css';
import ZoneActions from '../../workspaces/ZoneActions';
import { founderZoneActions } from '../../workspaces/founderZoneActions';

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
const statusLabel = (value) => text(value, 'Status not recorded').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const sourceLabel = (value) => text(value, 'Source not recorded');

export default function FounderGrowCustomers() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [view, setView] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      let available = [];
      try { available = list(await api.listProjects(), 'items', 'projects'); } catch (cause) {
        if (!requestedId) throw cause;
        setError('The startup list is unavailable; customer records are still being checked.');
      }
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || (requestedId ? { id: Number(requestedId), name: 'Selected project' } : null);
      setProjects(available.length ? available : selected ? [selected] : []);
      setProject(selected);
      if (!selected) { setCustomers([]); return; }
      if (String(selected.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(selected.id)); return next; }, { replace: true });
      }
      try {
        const response = await api.listWaitlistCustomers(selected.id);
        setCustomers(list(response, 'signups', 'customers'));
      } catch (cause) {
        setCustomers([]);
        setError(cause?.message || 'The customer source is unavailable.');
      }
    } catch (cause) {
      setProject(null); setCustomers([]); setError(cause?.message || 'The project source is unavailable.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const query = project?.id ? `?project_id=${project.id}` : '';
  const sources = useMemo(() => [...new Set(customers.map((row) => sourceLabel(row.source)))], [customers]);
  const visible = useMemo(() => {
    if (view === 'all') return customers;
    if (view === 'stalled') return [];
    return customers.filter((row) => view === 'shortlisted' ? ['invited', 'followed_up', 'promoted'].includes(String(row.crm_status || '').toLowerCase()) : sourceLabel(row.source) === view);
  }, [customers, view]);
  const grouped = useMemo(() => sources.map((source) => {
    const rows = customers.filter((row) => sourceLabel(row.source) === source);
    return { source, rows, latest: rows[0], stages: [...new Set(rows.map((row) => statusLabel(row.crm_status)))] };
  }), [customers, sources]);
  const nav = [['Focus', `/grow/focus${query}`], ['Talent', `/grow/talent${query}`], ['Customers', `/grow/customers${query}`], ['Partnerships', `/grow/partnerships${query}`], ['Capital match', `/grow/capital-match${query}`], ['Brand', `/grow/brand${query}`], ['Launch', `/grow/launch${query}`]];

  return <main className="a5-grow fg-customers" data-testid="founder-grow-customers"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-customers-crumb"><Link to={`/grow/focus${query}`}><ArrowLeft size={13} /> Grow</Link><span>‹</span><b>Customers</b></div><span>Founder / Grow</span><div><h1>Customer pipeline</h1><p>Pipeline, segments, sequences and step conversion.</p></div>{projects.length > 1 && <label className="fg-customers-picker"><span>Startup</span><select data-testid="select-grow-customers-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<nav aria-label="Grow sections">{nav.map(([label, to]) => <Link data-testid={`link-grow-customers-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Customers' ? 'is-active' : ''}>{label}</Link>)}</nav>
    <ZoneActions className="mt-3" items={founderZoneActions('grow/customers', { query, view: { scope: project?.name, header: ['Account', 'Email', 'Source', 'Recorded stage', 'Captured'], rows: visible, cells: (r) => [r.name, r.email, r.source, r.crm_status, r.created_at] } })} /></header>
    {error && <div className="a5-grow-error" data-testid="status-grow-customers-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <CustomersSkeleton /> : !project ? <EmptyCustomers /> : <CustomersContent project={project} customers={customers} visible={visible} grouped={grouped} sources={sources} view={view} setView={setView} query={query} error={error} />}
  </div><CustomersRail project={project} customers={customers} grouped={grouped} error={error} /></div></main>;
}

function CustomersContent({ project, customers, visible, grouped, sources, view, setView, query, error }) {
  return <div className="a5-sections"><div className="fg-customers-context"><div><span>Selected startup</span><strong data-testid="text-grow-customers-project">{text(project.name)}</strong></div><div><span>Customer source</span><strong>{error ? 'Unavailable' : customers.length ? 'Stored discovery records' : 'No records recorded'}</strong></div></div>
    <div className="fg-customers-tabs"><div><button type="button" className={view === 'all' ? 'is-active' : ''} onClick={() => setView('all')}><Filter size={12} /> All</button>{sources.map((source) => <button type="button" className={view === source ? 'is-active' : ''} key={source} onClick={() => setView(source)}>{source}</button>)}<button type="button" className={view === 'stalled' ? 'is-active' : ''} onClick={() => setView('stalled')}>Stalled</button></div><div className="fg-customers-actions"><Link to={`/build/discovery?mode=workspace&project_id=${project.id}`} data-testid="link-open-grow-customers-workspace"><BarChart3 size={13} /> Open workspace</Link></div></div>
    <div className="fg-customers-stats"><Stat label="Accounts" value={error ? 'Unavailable' : customers.length} note={error ? 'Customer source unavailable' : `${grouped.length} source${grouped.length === 1 ? '' : 's'}`} muted={Boolean(error)} /><Stat label="Weighted ARR" value="Unavailable" note="No opportunity-value source connected" muted /><Stat label="Worst step" value="Unavailable" note="No funnel-step events connected" muted /><Stat label="Stalled > 14d" value="Unavailable" note="No activity timeline connected" muted /></div>
    <section className="a5-card fg-customers-table"><Head icon={Users} title="Customer records, by source" meta={view === 'all' ? 'Source rows are grouped from stored records' : view === 'stalled' ? 'Activity source unavailable' : `${visible.length} matching record${visible.length === 1 ? '' : 's'}`} />{error ? <EmptyTable error /> : view === 'stalled' ? <UnavailableTable /> : view === 'all' ? <SourceTable rows={grouped} /> : <CustomerTable rows={visible} />}</section>
    <section className="a5-focus fg-customers-read"><div className="a5-head"><div><Sparkles size={15} /><h2>Read the pipeline honestly</h2></div><span>Source-derived</span></div><p>{error ? 'The selected-project customer source is unavailable, so FG3 cannot determine whether accounts or segments exist. Conversion, weighted value, stalled age, and sequence outcomes remain unavailable.' : customers.length ? `FG3 groups ${customers.length} stored customer record${customers.length === 1 ? '' : 's'} by their recorded source. It does not turn source labels into market segments or infer conversion from CRM status.` : 'No customer discovery records are stored for this startup, so account counts, segments, conversion, weighted value, and sequence outcomes remain unavailable.'}</p><Link className="a5-link" to={`/build/discovery?mode=workspace&project_id=${project.id}`}>Open customer discovery <ChevronRight size={14} /></Link></section>
  </div>;
}
function SourceTable({ rows }) {
  if (!rows.length) return <EmptyTable />;
  return <div className="fg-customers-table-wrap"><table><thead><tr><th>Source</th><th>Accounts</th><th>Recorded stage</th><th>Latest capture</th><th>Read</th></tr></thead><tbody>{rows.map((row) => <tr key={row.source}><td><strong>{row.source}</strong></td><td>{row.rows.length}</td><td>{row.stages.join(', ') || 'Not recorded'}</td><td>{row.latest?.created_at ? dateLabel(row.latest.created_at) : 'Not recorded'}</td><td className="fg-customers-reason">No segment or conversion interpretation recorded.</td></tr>)}</tbody></table></div>;
}
function CustomerTable({ rows }) {
  if (!rows.length) return <EmptyTable />;
  return <div className="fg-customers-table-wrap"><table><thead><tr><th>Account</th><th>Source</th><th>Stage</th><th>Captured</th><th>Sequence result</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}><td><strong>{text(row.name || row.email, 'Customer name not recorded')}</strong><small>{row.email && row.name ? row.email : 'Contact detail not recorded'}</small></td><td>{sourceLabel(row.source)}</td><td><span className="fg-customers-pill">{statusLabel(row.crm_status)}</span></td><td>{dateLabel(row.created_at)}</td><td className="fg-customers-reason">Not recorded</td></tr>)}</tbody></table></div>;
}
function EmptyTable({ error }) { return <div className="a5-empty"><Users size={18} /><div><b>{error ? 'Customer source unavailable.' : 'No selected-project customer records are recorded.'}</b><p>FG3 does not infer accounts, conversion, segments, or sequence outcomes.</p></div></div>; }
function UnavailableTable() { return <div className="a5-empty"><Filter size={18} /><div><b>Stalled filtering is unavailable.</b><p>No activity timeline or last-contact source is connected, so signup dates are not treated as stalled age.</p></div></div>; }
function Head({ icon: Icon, title, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-customers-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function CustomersRail({ project, customers, grouped, error }) {
  return <WorkerRail
    workspace="Grow"
    className="a5-rail"
    stance="Read-only work board"
    note="This rail summarizes stored customer records. It does not sequence, message, score, or modify accounts."
    coverage={[!project ? 'No project selected' : error ? 'Customer source unavailable' : `${customers.length} customer record${customers.length === 1 ? '' : 's'}`, !project || error ? 'Source grouping unavailable' : `${grouped.length} recorded source${grouped.length === 1 ? '' : 's'}`]}
    unavailable={[['Step conversion', 'No funnel event source is connected.'], ['Sequences', 'No outbound sequence or outcome source is connected.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function CustomersSkeleton() { return <div className="a5-skeleton" data-testid="status-grow-customers-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyCustomers() { return <div className="a5-empty fg-customers-empty"><Users size={20} /><div><b>No startup is available.</b><p>Customers is scoped to an authenticated startup and its stored discovery records.</p></div></div>; }