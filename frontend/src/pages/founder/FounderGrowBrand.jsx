import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronRight, ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderGrowDesk.css';
import './founderGrowBrand.css';
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
const isLive = (page) => Boolean(page.published);
const pageLeads = (page, signups) => signups.filter((signup) => signup.landing_page_id != null && String(signup.landing_page_id) === String(page.id)).length;
const slug = (page) => page.page_slug || page.slug || page.name || 'page';

export default function FounderGrowBrand() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [pages, setPages] = useState([]);
  const [signups, setSignups] = useState([]);
  const [view, setView] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      let available = [];
      try { available = list(await api.listProjects(), 'items', 'projects'); } catch (cause) {
        if (!requestedId) throw cause;
        setError('The startup list is unavailable; brand records are still being checked.');
      }
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || (requestedId ? { id: Number(requestedId), name: 'Selected project' } : null);
      setProjects(available.length ? available : selected ? [selected] : []);
      setProject(selected);
      if (!selected) { setPages([]); setSignups([]); return; }
      if (String(selected.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(selected.id)); return next; }, { replace: true });
      }
      const results = await Promise.allSettled([
        api.brandListPages(selected.id),
        api.brandListWaitlist(selected.id),
      ]);
      const pageResult = results[0];
      const signupResult = results[1];
      setPages(pageResult.status === 'fulfilled' ? list(pageResult.value, 'pages', 'items') : []);
      setSignups(signupResult.status === 'fulfilled' ? list(signupResult.value, 'signups', 'items') : []);
      if (results.some((result) => result.status === 'rejected')) setError('Some selected-project brand sources are unavailable.');
    } catch (cause) {
      setProject(null); setPages([]); setSignups([]); setError(cause?.message || 'The brand source is unavailable.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const query = project?.id ? `?project_id=${project.id}` : '';
  const visible = useMemo(() => {
    if (view === 'live') return pages.filter(isLive);
    if (view === 'draft') return pages.filter((page) => !isLive(page));
    if (view === 'leads') return pages.filter((page) => pageLeads(page, signups) > 0);
    return pages;
  }, [pages, signups, view]);
  const liveCount = pages.filter(isLive).length;
  const pageAttributionAvailable = pages.some((page) => signups.some((signup) => signup.landing_page_id != null && String(signup.landing_page_id) === String(page.id)));
  const bestPage = pageAttributionAvailable ? pages.map((page) => ({ page, leads: pageLeads(page, signups), views: Number(page.views_count || 0) })).filter(({ views, leads }) => views > 0 && leads > 0).map((item) => ({ ...item, rate: item.leads / item.views })).sort((a, b) => b.rate - a.rate)[0] : null;
  const nav = [['Focus', `/grow/focus${query}`], ['Talent', `/grow/talent${query}`], ['Customers', `/grow/customers${query}`], ['Partnerships', `/grow/partnerships${query}`], ['Capital match', `/grow/capital-match${query}`], ['Brand', `/grow/brand${query}`], ['Launch', `/grow/launch${query}`]];

  return <main className="a5-grow fg-brand" data-testid="founder-grow-brand"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-brand-crumb"><Link to={`/grow/focus${query}`}><ArrowLeft size={13} /> Grow</Link><span>‹</span><b>Brand</b></div><span>Founder / Grow</span><div><h1>Brand &amp; landing</h1><p>Landing pages, templates and captured leads.</p></div>{projects.length > 1 && <label className="fg-brand-picker"><span>Startup</span><select data-testid="select-grow-brand-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<nav aria-label="Grow sections">{nav.map(([label, to]) => <Link data-testid={`link-grow-brand-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Brand' ? 'is-active' : ''}>{label}</Link>)}</nav>
    <ZoneActions className="mt-3" items={founderZoneActions('grow/brand', { query, view: { scope: project?.name, header: ['Lead', 'Email', 'Source', 'Audience', 'Captured'], rows: signups, cells: (r) => [r.name, r.email, r.source, r.audience, r.created_at] } })} /></header>
    {error && <div className="a5-grow-error" data-testid="status-grow-brand-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <BrandSkeleton /> : !project ? <EmptyBrand /> : <BrandContent project={project} pages={pages} signups={signups} visible={visible} view={view} setView={setView} query={query} error={error} liveCount={liveCount} bestPage={bestPage} pageAttributionAvailable={pageAttributionAvailable} />}
  </div><BrandRail project={project} pages={pages} signups={signups} error={error} /></div></main>;
}

function BrandContent({ project, pages, signups, visible, view, setView, query, error, liveCount, bestPage, pageAttributionAvailable }) {
  return <div className="a5-sections"><div className="fg-brand-context"><div><span>Selected startup</span><strong data-testid="text-grow-brand-project">{text(project.name)}</strong></div><div><span>Brand source</span><strong>{error ? 'Unavailable' : pages.length ? 'Stored landing pages' : 'No pages recorded'}</strong></div></div>
    <div className="fg-brand-tabs"><div><button type="button" className={view === 'all' ? 'is-active' : ''} onClick={() => setView('all')}>All pages</button><button type="button" className={view === 'live' ? 'is-active' : ''} onClick={() => setView('live')}>Live</button><button type="button" className={view === 'draft' ? 'is-active' : ''} onClick={() => setView('draft')}>Draft</button><button type="button" className={view === 'leads' ? 'is-active' : ''} onClick={() => setView('leads')}>Leads</button></div><div className="fg-brand-actions"><Link to={`/spinout-lab/brand${query}`} data-testid="link-open-grow-brand-workspace"><ExternalLink size={13} /> Open workspace</Link></div></div>
    <div className="fg-brand-stats"><Stat label="Pages" value={error ? 'Unavailable' : pages.length} note={error ? 'Brand source unavailable' : `${liveCount} live`} muted={Boolean(error)} /><Stat label="Leads captured" value={error ? 'Unavailable' : signups.length} note={error ? 'Brand source unavailable' : 'Stored waitlist records'} muted={Boolean(error)} /><Stat label="Best converting" value={error || !bestPage ? 'Unavailable' : `/${slug(bestPage.page).replace(/^\//, '')}`} note={error || !bestPage ? 'Page views or page attribution unavailable' : `${(bestPage.rate * 100).toFixed(1)}% of stored views`} muted={!bestPage || Boolean(error)} /><Stat label="Dead page" value="Unavailable" note="No page activity timeline connected" muted /></div>
    <section className="a5-card fg-brand-table"><Head title="Pages and what they produced" meta={view === 'all' ? 'Stored views · captured leads when page-linked' : `${visible.length} matching page${visible.length === 1 ? '' : 's'}`} />{error ? <EmptyTable error /> : <BrandTable rows={visible} signups={signups} pageAttributionAvailable={pageAttributionAvailable} />}</section>
    <section className="a5-focus fg-brand-read"><div className="a5-head"><div><Sparkles size={15} /><h2>Read the brand honestly</h2></div><span>Source-derived</span></div><p>{error ? 'The selected-project brand source is unavailable, so FG6 cannot determine which pages or leads are recorded. Page conversion, dead-page status, and template outcomes remain unavailable.' : pages.length ? `FG6 shows ${pages.length} stored page${pages.length === 1 ? '' : 's'} and ${signups.length} captured lead${signups.length === 1 ? '' : 's'}. ${pageAttributionAvailable ? 'Page-linked lead rates use only stored page IDs and view counts.' : 'Leads cannot be attributed to individual pages because the returned records do not include a page ID.'}` : 'No project-scoped landing pages are stored for this startup, so page performance and dead-page findings remain unavailable.'}</p><Link className="a5-link" to={`/spinout-lab/brand${query}`}>Open brand workspace <ChevronRight size={14} /></Link></section>
  </div>;
}
function BrandTable({ rows, signups, pageAttributionAvailable }) {
  if (!rows.length) return <EmptyTable />;
  return <div className="fg-brand-table-wrap"><table><thead><tr><th>Page</th><th>Audience</th><th>Status</th><th>Views</th><th>Leads</th><th>Rate and read</th></tr></thead><tbody>{rows.map((page, index) => { const leads = pageAttributionAvailable ? pageLeads(page, signups) : null; const views = Number(page.views_count || 0); const rate = leads != null && views > 0 ? `${((leads / views) * 100).toFixed(1)}%` : 'Unavailable'; return <tr key={page.id || page.uid || index}><td><strong>/{slug(page).replace(/^\//, '')}</strong><small>{page.updated_at ? `Updated ${dateLabel(page.updated_at)}` : 'Date not recorded'}</small></td><td>{text(page.audience || page.goal)}</td><td><span className={`fg-brand-pill ${page.published ? 'is-live' : ''}`}>{page.published ? 'Live' : 'Draft'}</span></td><td>{page.views_count == null ? 'Not recorded' : views}</td><td>{leads == null ? 'Unavailable' : leads}</td><td className="fg-brand-reason">{rate === 'Unavailable' ? 'Page attribution or views not recorded.' : `${rate} of stored views${leads > 0 ? ' · captured leads' : ''}`}</td></tr>; })}</tbody></table></div>;
}
function EmptyTable({ error }) { return <div className="a5-empty"><Sparkles size={18} /><div><b>{error ? 'Brand source unavailable.' : 'No project-scoped pages are recorded.'}</b><p>FG6 does not infer page traffic, conversion, or dead-page status.</p></div></div>; }
function Head({ title, meta }) { return <div className="a5-head"><div><Sparkles size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-brand-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function BrandRail({ project, pages, signups, error }) {
  return <WorkerRail
    workspace="Grow"
    className="a5-rail"
    stance="Read-only brand collection"
    note="This rail summarizes stored landing pages and leads. It does not create, edit, publish, export, or rewrite content."
    coverage={[!project ? 'No project selected' : error ? 'Brand source unavailable' : `${pages.length} stored page${pages.length === 1 ? '' : 's'}`, !project || error ? 'Lead source unavailable' : `${signups.length} captured lead${signups.length === 1 ? '' : 's'}`]}
    unavailable={[['Template outcomes', 'No template-performance source is connected.'], ['Dead-page age', 'No page activity timeline is connected.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function BrandSkeleton() { return <div className="a5-skeleton" data-testid="status-grow-brand-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyBrand() { return <div className="a5-empty fg-brand-empty"><Sparkles size={20} /><div><b>No startup is available.</b><p>Brand is scoped to an authenticated startup and its stored landing-page records.</p></div></div>; }