import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { text } from '../../lib/absence';
import './founderGrowDesk.css';
import './brandPagesSection.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';

/**
 * #2343 — what Grow's Brand page read, on the one brand page.
 *
 * `/grow/brand` (`FounderGrowBrand`) and `/build/brand` (the builder) were two
 * brand pages; the builder stays because it is the one that edits. What only
 * Grow's page had moves here unchanged: every stored landing page of the
 * venture with its status, views, page-linked leads and rate, the All / Live /
 * Draft / Leads chips, the best-converting read and the leads export (the
 * `grow/brand` zone table, which keeps its key). The builder already picks the
 * venture, so this section takes it rather than offering a second picker; the
 * read-only rail's two "not connected" notes are in the closing read.
 */

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const dateLabel = (value) => {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const isLive = (page) => Boolean(page.published);
const pageLeads = (page, signups) => signups.filter((signup) => signup.landing_page_id != null && String(signup.landing_page_id) === String(page.id)).length;
const slug = (page) => page.page_slug || page.slug || page.name || 'page';

export default function BrandPagesSection({ projectId, projectName }) {
  const [pages, setPages] = useState([]);
  const [signups, setSignups] = useState([]);
  const [view, setView] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    if (!projectId) { setPages([]); setSignups([]); setLoading(false); return; }
    setLoading(true); setError('');
    const [pageResult, signupResult] = await Promise.allSettled([
      api.brandListPages(projectId),
      api.brandListWaitlist(projectId),
    ]);
    setPages(pageResult.status === 'fulfilled' ? list(pageResult.value, 'pages', 'items') : []);
    setSignups(signupResult.status === 'fulfilled' ? list(signupResult.value, 'signups', 'items') : []);
    if (pageResult.status === 'rejected' || signupResult.status === 'rejected') setError('Some selected-project brand sources are unavailable.');
    setLoading(false);
  }
  useEffect(() => { load(); }, [projectId]);

  const query = projectId ? `?project_id=${projectId}` : '';
  const visible = useMemo(() => {
    if (view === 'live') return pages.filter(isLive);
    if (view === 'draft') return pages.filter((page) => !isLive(page));
    if (view === 'leads') return pages.filter((page) => pageLeads(page, signups) > 0);
    return pages;
  }, [pages, signups, view]);
  const liveCount = pages.filter(isLive).length;
  const pageAttributionAvailable = pages.some((page) => signups.some((signup) => signup.landing_page_id != null && String(signup.landing_page_id) === String(page.id)));
  const bestPage = pageAttributionAvailable ? pages.map((page) => ({ page, leads: pageLeads(page, signups), views: Number(page.views_count || 0) })).filter(({ views, leads }) => views > 0 && leads > 0).map((item) => ({ ...item, rate: item.leads / item.views })).sort((a, b) => b.rate - a.rate)[0] : null;

  if (!projectId) return null;
  return <section className="fg-brand mb-6" data-testid="brand-pages-section">
    <div className="a5-head"><div><Sparkles size={15} /><h2>Pages, leads and conversion</h2></div><span data-testid="text-brand-pages-project">{text(projectName)}</span></div>
    <ZoneToolbar
      filters={founderZoneFilters('grow/brand', { value: view, onChange: setView })}
      actions={founderZoneActions('grow/brand', { query, view: { scope: projectName, header: ['Lead', 'Email', 'Source', 'Audience', 'Captured'], rows: signups, cells: (r) => [r.name, r.email, r.source, r.audience, r.created_at] } })}
    />
    {error && <div className="a5-grow-error" data-testid="status-brand-pages-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <div className="a5-skeleton" data-testid="status-brand-pages-loading"><i /><i /><div><i /><i /><i /></div></div> : <div className="a5-sections">
      <div className="fg-brand-stats"><Stat label="Pages" value={error ? 'Unavailable' : pages.length} note={error ? 'Brand source unavailable' : `${liveCount} live`} muted={Boolean(error)} /><Stat label="Leads captured" value={error ? 'Unavailable' : signups.length} note={error ? 'Brand source unavailable' : 'Stored waitlist records'} muted={Boolean(error)} /><Stat label="Best converting" value={error || !bestPage ? 'Unavailable' : `/${slug(bestPage.page).replace(/^\//, '')}`} note={error || !bestPage ? 'Page views or page attribution unavailable' : `${(bestPage.rate * 100).toFixed(1)}% of stored views`} muted={!bestPage || Boolean(error)} /><Stat label="Dead page" value="Unavailable" note="No page activity timeline connected" muted /></div>
      <section className="a5-card fg-brand-table"><Head title="Pages and what they produced" meta={view === 'all' ? 'Stored views · captured leads when page-linked' : `${visible.length} matching page${visible.length === 1 ? '' : 's'}`} />{error ? <EmptyTable error /> : <BrandTable rows={visible} signups={signups} pageAttributionAvailable={pageAttributionAvailable} />}</section>
      <section className="a5-focus fg-brand-read"><div className="a5-head"><div><Sparkles size={15} /><h2>Read the brand honestly</h2></div><span>Source-derived</span></div><p>{error ? 'The selected-project brand source is unavailable, so this read cannot determine which pages or leads are recorded. Page conversion, dead-page status, and template outcomes remain unavailable.' : pages.length ? `${pages.length} stored page${pages.length === 1 ? '' : 's'} and ${signups.length} captured lead${signups.length === 1 ? '' : 's'}. ${pageAttributionAvailable ? 'Page-linked lead rates use only stored page IDs and view counts.' : 'Leads cannot be attributed to individual pages because the returned records do not include a page ID.'}` : 'No project-scoped landing pages are stored for this startup, so page performance and dead-page findings remain unavailable.'} Template outcomes and dead-page age stay unavailable: no template-performance source or page activity timeline is connected.</p></section>
    </div>}
  </section>;
}

function BrandTable({ rows, signups, pageAttributionAvailable }) {
  if (!rows.length) return <EmptyTable />;
  return <div className="fg-brand-table-wrap"><table><thead><tr><th>Page</th><th>Audience</th><th>Status</th><th>Views</th><th>Leads</th><th>Rate and read</th></tr></thead><tbody>{rows.map((page, index) => { const leads = pageAttributionAvailable ? pageLeads(page, signups) : null; const views = Number(page.views_count || 0); const rate = leads != null && views > 0 ? `${((leads / views) * 100).toFixed(1)}%` : 'Unavailable'; return <tr key={page.id || page.uid || index}><td><strong>/{slug(page).replace(/^\//, '')}</strong><small>{page.updated_at ? `Updated ${dateLabel(page.updated_at)}` : 'Date not recorded'}</small></td><td>{text(page.audience || page.goal)}</td><td><span className={`fg-brand-pill ${page.published ? 'is-live' : ''}`}>{page.published ? 'Live' : 'Draft'}</span></td><td>{page.views_count == null ? 'Not recorded' : views}</td><td>{leads == null ? 'Unavailable' : leads}</td><td className="fg-brand-reason">{rate === 'Unavailable' ? 'Page attribution or views not recorded.' : `${rate} of stored views${leads > 0 ? ' · captured leads' : ''}`}</td></tr>; })}</tbody></table></div>;
}
function EmptyTable({ error }) { return <div className="a5-empty"><Sparkles size={18} /><div><b>{error ? 'Brand source unavailable.' : 'No project-scoped pages are recorded.'}</b><p>Page traffic, conversion and dead-page status are never inferred.</p></div></div>; }
function Head({ title, meta }) { return <div className="a5-head"><div><Sparkles size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-brand-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
