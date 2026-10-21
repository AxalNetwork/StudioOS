import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { articles as api, publications } from '../lib/api';
import { reportError } from '../lib/log';
import SitePage from '../components/site/SitePage';
import NetworkSubNav from '../components/site/NetworkSubNav';
import { FilterPills, EmptyNote } from '../components/site/SiteBlocks';
import { titleCase } from '../lib/absence';
import { articleFilterOptions, articleMeta, initials, sectorLabel, tintFor } from '../lib/siteResources';
import './site/network.css';

/**
 * Articles — the public reading surface (D679, #1553), drawn to the canvas's
 * ARTICLES view: the Network sub-nav, the "Insight / Articles" header, the
 * filter pills and two-column cards.
 *
 * The pills are the live article taxonomy (`GET /api/articles/sectors`), the
 * field each article carries as `sector`; the canvas's categories are
 * examples. Search, the author-role filter, the featured strip and pagination
 * are the page's own behaviour, kept. Authoring (drafts, the editor, "My
 * Articles") lives in the writing workspace at /articles/draft.
 *
 * #2333 — the one publications list. The HQ briefs (`admin_publications`) that
 * the retired `/insights` index listed are the Briefs section below the
 * articles; `/insights` forwards to `/articles#briefs`, and each brief still
 * opens at its share link, `/insights/public/:slug`.
 */

const ROLE_FILTERS = [
  { id: '', label: 'All authors' },
  { id: 'founder', label: 'Founders' },
  { id: 'investor', label: 'Investors' },
  { id: 'partner', label: 'Partners' },
  { id: 'advisor', label: 'Advisors' },
  { id: 'coach', label: 'Coaches' },
  { id: 'admin', label: 'Axal VC team' },
];

const PAGE_SIZE = 12;

/** One card: category, date and read time, title, excerpt, author, Read →. */
export function ArticleCard({ a, category, featured = false }) {
  const meta = articleMeta(a);
  const excerpt = a.excerpt || a.subtitle;
  return (
    <article className="ax-card ax-art-card">
      <div className="ax-art-body">
        <div className="ax-art-top">
          {featured && <span className="ax-chip ax-chip-amber">Featured</span>}
          {category && <span className="ax-chip">{category}</span>}
          {meta && <span className="ax-mono ax-art-date">{meta}</span>}
        </div>
        <h3 className="ax-art-t"><Link to={`/articles/${a.slug}`}>{a.title}</Link></h3>
        {excerpt && <p className="ax-art-x">{excerpt}</p>}
      </div>
      <div className="ax-art-foot">
        {a.author && (
          <span className="ax-nw-av ax-nw-av-sm" style={{ background: tintFor(a.author_user_id ?? a.author) }} aria-hidden="true">
            {initials(a.author)}
          </span>
        )}
        {a.author && (a.author_user_id
          ? <Link to={`/authors/${a.author_user_id}`} className="ax-art-author">{a.author}</Link>
          : <span className="ax-art-author">{a.author}</span>)}
        <span className="ax-art-read" aria-hidden="true">Read →</span>
      </div>
    </article>
  );
}

// The public feed of everyone's published articles, with search, the live
// sector pills, the author-role filter, a featured strip and pagination.
function BrowseArticles() {
  const [items, setItems] = useState([]);
  const [featuredItems, setFeaturedItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [sectors, setSectors] = useState([]);
  const [sector, setSector] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);

  // Debounce search so we don't fire on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset pagination when filters change.
  useEffect(() => { setPage(0); }, [sector, role]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sector: sector || undefined,
        role: role || undefined,
        q: debouncedQ || undefined,
      };
      const r = await api.list(params);
      setItems(r.items || []);
      setTotal(r.total || 0);
    } catch (e) {
      reportError('Articles:list', e);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [sector, role, debouncedQ, page]);

  // Featured strip — only visible on page 1 with no active search/filter
  // so the editorial picks don't compete with the user's intent.
  const showFeatured = page === 0 && !debouncedQ && !sector && !role;
  useEffect(() => {
    if (!showFeatured) { setFeaturedItems([]); return; }
    api.list({ featured: 1, limit: 3 })
      .then((r) => setFeaturedItems((r.items || []).slice(0, 3)))
      .catch(() => setFeaturedItems([]));
  }, [showFeatured]);

  useEffect(() => {
    api.sectors().then((r) => setSectors(r.sectors || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
  const pills = useMemo(() => articleFilterOptions(sectors), [sectors]);
  const category = (key) => sectorLabel(sectors, key);
  const featuredShown = showFeatured && featuredItems.length > 0;

  return (
    <>
      <div className="ax-art-pills">
        <FilterPills options={pills} value={sector} onChange={setSector} label="Article categories" />
      </div>
      <div className="ax-nw-tools">
        <div className="ax-nw-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search articles…"
            aria-label="Search articles"
            className="ax-nw-input"
          />
        </div>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Author" className="ax-nw-select">
          {ROLE_FILTERS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>

      {featuredShown && (
        <section aria-labelledby="ax-art-featured-h">
          <h2 id="ax-art-featured-h" className="ax-lbl-q ax-nw-panel-k ax-art-k">Featured</h2>
          <div className="ax-art-grid">
            {featuredItems.map((a) => <ArticleCard key={`f-${a.id}`} a={a} category={category(a.sector)} featured />)}
          </div>
        </section>
      )}

      <section aria-labelledby={featuredShown ? 'ax-art-latest-h' : undefined}>
        {featuredShown && <h2 id="ax-art-latest-h" className="ax-lbl-q ax-nw-panel-k ax-art-k">Latest</h2>}
        {loading ? (
          <EmptyNote>Loading…</EmptyNote>
        ) : items.length === 0 ? (
          <EmptyNote>
            {debouncedQ ? `No articles matching “${debouncedQ}”.` : 'No articles yet. Be the first to publish.'}
          </EmptyNote>
        ) : (
          <>
            <div className="ax-art-grid">
              {items.map((a) => <ArticleCard key={a.id} a={a} category={category(a.sector)} />)}
            </div>
            {totalPages > 1 && (
              <div className="ax-nw-pager">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="ax-btn ax-btn-sm ax-btn-quiet"
                >
                  <ChevronLeft size={15} aria-hidden="true" /> Previous
                </button>
                <span>Page {page + 1} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="ax-btn ax-btn-sm ax-btn-quiet"
                >
                  Next <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function formatBriefDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// The HQ briefs, each opening at its public share link. A failed read says so:
// "none" would be a claim the page cannot make.
export function Briefs() {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const { hash } = useLocation();
  useEffect(() => {
    let cancelled = false;
    publications.publicList()
      .then((d) => { if (!cancelled) setItems(Array.isArray(d?.publications) ? d.publications : []); })
      .catch((e) => {
        reportError('Articles:briefs', e);
        if (!cancelled) { setFailed(true); setItems([]); }
      });
    return () => { cancelled = true; };
  }, []);
  // `/insights` lands here as `/articles#briefs`; scroll once the list is drawn.
  useEffect(() => {
    if (hash === '#briefs' && items) document.getElementById('briefs')?.scrollIntoView?.();
  }, [hash, items]);

  return <BriefsView items={items} failed={failed} />;
}

/** The Briefs section for one read: `items` null while loading. */
export function BriefsView({ items, failed = false }) {
  return (
    <section id="briefs" aria-labelledby="ax-art-briefs-h" data-testid="articles-briefs">
      <h2 id="ax-art-briefs-h" className="ax-lbl-q ax-nw-panel-k ax-art-k">Briefs</h2>
      {items === null ? (
        <EmptyNote>Loading…</EmptyNote>
      ) : failed ? (
        <EmptyNote>Unreadable: the briefs could not be read, so this is not a claim that there are none.</EmptyNote>
      ) : items.length === 0 ? (
        <EmptyNote>No published briefs yet.</EmptyNote>
      ) : (
        <div className="ax-art-grid">
          {items.map((p) => {
            const meta = [p.section ? titleCase(p.section) : '', formatBriefDate(p.published_at)].filter(Boolean).join(' · ');
            return (
              <article key={p.slug} className="ax-card ax-art-card">
                <div className="ax-art-body">
                  <div className="ax-art-top">
                    <span className="ax-chip">Brief</span>
                    {meta && <span className="ax-mono ax-art-date">{meta}</span>}
                  </div>
                  <h3 className="ax-art-t"><Link to={`/insights/public/${encodeURIComponent(p.slug)}`}>{p.title}</Link></h3>
                  {p.subtitle && <p className="ax-art-x">{p.subtitle}</p>}
                </div>
                <div className="ax-art-foot">
                  <span className="ax-art-author">Axal VC</span>
                  <span className="ax-art-read" aria-hidden="true">Read →</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function ArticlesPage() {
  return (
    <SitePage title="Articles">
      <NetworkSubNav />
      <div className="ax-wrap ax-nw">
        <div className="ax-lbl-q ax-nw-eyebrow">Insight</div>
        <h1 className="ax-nw-h1">Articles</h1>
        <p className="ax-nw-lede">
          Writing on company formation, pre-seed underwriting, and what we learn from running cohorts. Published as we learn it, not on a content calendar.
        </p>
        <BrowseArticles />
        <Briefs />
      </div>
    </SitePage>
  );
}
