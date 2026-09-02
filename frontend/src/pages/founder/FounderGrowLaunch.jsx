import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CalendarDays, ChevronRight, RefreshCw, Rocket, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderGrowDesk.css';
import './founderGrowLaunch.css';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const linked = (row, project) => row?.project_id != null && project?.id != null && String(row.project_id) === String(project.id);
const dateLabel = (value) => {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const kindLabel = (value) => text(value, 'Event').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusLabel = (value) => text(value, 'State not recorded').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function FounderGrowLaunch() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [events, setEvents] = useState([]);
  const [attributions, setAttributions] = useState([]);
  const [view, setView] = useState('upcoming');
  const [loading, setLoading] = useState(true);
  const [sourceErrors, setSourceErrors] = useState([]);

  async function load() {
    setLoading(true); setSourceErrors([]);
    try {
      let available = [];
      try { available = list(await api.listProjects(), 'items', 'projects'); } catch (cause) {
        if (!requestedId) throw cause;
        setSourceErrors(['startup list']);
      }
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || (requestedId ? { id: Number(requestedId), name: 'Selected project' } : null);
      setProjects(available.length ? available : selected ? [selected] : []);
      setProject(selected);
      if (!selected) { setEvents([]); setAttributions([]); return; }
      if (String(selected.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(selected.id)); return next; }, { replace: true });
      }
      const now = new Date();
      const from = new Date(now); from.setFullYear(from.getFullYear() - 1);
      const to = new Date(now); to.setFullYear(to.getFullYear() + 1);
      const results = await Promise.allSettled([
        api.listCalendarEvents({ from: from.toISOString(), to: to.toISOString() }),
        api.listMyCoMarketingAttributions(),
      ]);
      const eventResult = results[0];
      const attributionResult = results[1];
      setEvents(eventResult.status === 'fulfilled' ? list(eventResult.value, 'items', 'events').filter((row) => linked(row, selected)) : []);
      setAttributions(attributionResult.status === 'fulfilled' ? list(attributionResult.value, 'items', 'attributions').filter((row) => linked(row, selected)) : []);
      const failed = [];
      if (eventResult.status === 'rejected') failed.push('calendar');
      if (attributionResult.status === 'rejected') failed.push('co-marketing attribution');
      setSourceErrors((current) => [...new Set([...current, ...failed])]);
    } catch (cause) {
      setProject(null); setEvents([]); setAttributions([]); setSourceErrors(['project']);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const query = project?.id ? `?project_id=${project.id}` : '';
  const upcoming = useMemo(() => events.filter((row) => {
    const value = new Date(row.start_at || row.date || row.created_at).getTime();
    return Number.isFinite(value) && value >= Date.now();
  }), [events]);
  const visible = view === 'events' ? events : view === 'upcoming' ? upcoming : [];
  const leadsAttributed = attributions.filter((row) => String(row.event_kind || '').toLowerCase() === 'lead').length;
  const nav = [['Focus', `/grow/focus${query}`], ['Talent', `/grow/talent${query}`], ['Customers', `/grow/customers${query}`], ['Partnerships', `/grow/partnerships${query}`], ['Capital match', `/grow/capital-match${query}`], ['Brand', `/grow/brand${query}`], ['Launch', `/grow/launch${query}`]];

  return <main className="a5-grow fg-launch" data-testid="founder-grow-launch"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-launch-crumb"><Link to={`/grow/focus${query}`}><ArrowLeft size={13} /> Grow</Link><span>‹</span><b>Launch</b></div><span>Founder / Grow</span><div><h1>Launch calendar</h1><p>Events, co-marketing and the article calendar.</p></div>{projects.length > 1 && <label className="fg-launch-picker"><span>Startup</span><select data-testid="select-grow-launch-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<nav aria-label="Grow sections">{nav.map(([label, to]) => <Link data-testid={`link-grow-launch-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Launch' ? 'is-active' : ''}>{label}</Link>)}</nav></header>
    {sourceErrors.length > 0 && <div className="a5-grow-error" data-testid="status-grow-launch-partial"><AlertCircle size={15} /><span>{`Some selected-project sources are unavailable: ${sourceErrors.join(', ')}.`}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <LaunchSkeleton /> : !project ? <EmptyLaunch /> : <LaunchContent project={project} events={events} attributions={attributions} upcoming={upcoming} visible={visible} view={view} setView={setView} query={query} sourceErrors={sourceErrors} leadsAttributed={leadsAttributed} />}
  </div><LaunchRail project={project} events={events} attributions={attributions} sourceErrors={sourceErrors} /></div></main>;
}

function LaunchContent({ project, events, attributions, upcoming, visible, view, setView, query, sourceErrors, leadsAttributed }) {
  const calendarUnavailable = sourceErrors.includes('calendar');
  const attributionUnavailable = sourceErrors.includes('co-marketing attribution');
  const unsupported = view === 'published' || view === 'articles';
  return <div className="a5-sections"><div className="fg-launch-context"><div><span>Selected startup</span><strong data-testid="text-grow-launch-project">{text(project.name)}</strong></div><div><span>Launch source</span><strong>{calendarUnavailable ? 'Calendar unavailable' : events.length ? 'Project-linked calendar events' : 'No events recorded'}</strong></div></div>
    <div className="fg-launch-tabs"><div><button type="button" className={view === 'upcoming' ? 'is-active' : ''} onClick={() => setView('upcoming')}>Upcoming</button><button type="button" className={view === 'published' ? 'is-active' : ''} onClick={() => setView('published')}>Published</button><button type="button" className={view === 'events' ? 'is-active' : ''} onClick={() => setView('events')}>Events</button><button type="button" className={view === 'articles' ? 'is-active' : ''} onClick={() => setView('articles')}>Articles</button></div><div className="fg-launch-actions"><Link to={`/calendar${query}`} data-testid="link-open-grow-launch-calendar"><CalendarDays size={13} /> Open calendar</Link></div></div>
    <div className="fg-launch-stats"><Stat label="Items" value={calendarUnavailable ? 'Unavailable' : events.length} note={calendarUnavailable ? 'Calendar source unavailable' : `${upcoming.length} upcoming project event${upcoming.length === 1 ? '' : 's'}`} muted={calendarUnavailable} /><Stat label="Registered" value="Unavailable" note="No registration source connected" muted /><Stat label="Best performer" value="Unavailable" note="No content performance source connected" muted /><Stat label="Leads attributed" value={attributionUnavailable ? 'Unavailable' : leadsAttributed} note={attributionUnavailable ? 'Attribution source unavailable' : `${attributions.length} project-linked event${attributions.length === 1 ? '' : 's'} total`} muted={attributionUnavailable} /></div>
    <section className="a5-card fg-launch-table"><Head title="Calendar" meta={unsupported ? 'Capability unavailable' : 'Project-linked events · no inferred outcomes'} />{unsupported ? <UnavailableFeed type={view} /> : calendarUnavailable ? <EmptyFeed error /> : <LaunchTable rows={visible} />}</section>
    <section className="a5-focus fg-launch-read"><div className="a5-head"><div><Sparkles size={15} /><h2>Read the launch honestly</h2></div><span>Source-derived</span></div><p>{calendarUnavailable ? 'The project calendar source is unavailable. FG7 does not invent scheduled items, publication results, registration counts, article readership, or launch outcomes.' : events.length ? `FG7 shows ${events.length} project-linked calendar event${events.length === 1 ? '' : 's'} and ${attributions.length} project-linked co-marketing attribution event${attributions.length === 1 ? '' : 's'}. Calendar participation is not presented as launch performance.` : 'No project-linked calendar events are stored for this startup. Published content, articles, registration counts, and performance outcomes remain unavailable.'}</p><div className="fg-launch-handoffs"><Link className="a5-link" to={`/calendar${query}`}>Open unified calendar <ChevronRight size={14} /></Link><Link className="a5-link" to={`/comarketing${query}`} data-testid="link-open-grow-launch-workspace">Open co-marketing workspace <ChevronRight size={14} /></Link></div></section>
  </div>;
}
function LaunchTable({ rows }) {
  if (!rows.length) return <EmptyFeed />;
  return <div className="fg-launch-table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>State</th><th>Outcome</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || row.uid || index}><td><strong>{dateLabel(row.start_at || row.date || row.created_at)}</strong></td><td><strong>{kindLabel(row.kind)} · {text(row.title, 'Untitled event')}</strong><small>{row.end_at ? `Ends ${dateLabel(row.end_at)}` : 'End date not recorded'}</small></td><td><span className="fg-launch-pill">{statusLabel(row.status || row.state)}</span></td><td className="fg-launch-reason">No launch outcome is recorded for this calendar event.</td></tr>)}</tbody></table></div>;
}
function UnavailableFeed({ type }) { return <div className="a5-empty"><Rocket size={18} /><div><b>{type === 'articles' ? 'Article filtering is unavailable.' : 'Published-content filtering is unavailable.'}</b><p>{type === 'articles' ? 'No project-scoped article pipeline is connected.' : 'Calendar status is not a publication record, so FG7 does not treat it as published content.'}</p></div></div>; }
function EmptyFeed({ error }) { return <div className="a5-empty"><CalendarDays size={18} /><div><b>{error ? 'Project calendar source unavailable.' : 'No project-linked calendar events are recorded.'}</b><p>FG7 does not infer registrations, readership, publication state, or outcomes.</p></div></div>; }
function Head({ title, meta }) { return <div className="a5-head"><div><CalendarDays size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-launch-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function LaunchRail({ project, events, attributions, sourceErrors }) {
  return <WorkerRail
    workspace="Grow"
    className="a5-rail"
    stance="Read-only launch feed"
    note="This rail summarizes stored project events and attributions. It does not create, publish, export, send, or draft content."
    coverage={[!project ? 'No project selected' : sourceErrors.includes('calendar') ? 'Calendar source unavailable' : `${events.length} project event${events.length === 1 ? '' : 's'}`, !project ? 'No project selected' : sourceErrors.includes('co-marketing attribution') ? 'Attribution source unavailable' : `${attributions.length} attribution event${attributions.length === 1 ? '' : 's'}`]}
    unavailable={[['Article pipeline', 'No project-scoped content calendar is connected.'], ['Performance outcomes', 'No readership or registration source is connected.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function LaunchSkeleton() { return <div className="a5-skeleton" data-testid="status-grow-launch-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyLaunch() { return <div className="a5-empty fg-launch-empty"><Rocket size={20} /><div><b>No startup is available.</b><p>Launch is scoped to an authenticated startup and its project-linked records.</p></div></div>; }