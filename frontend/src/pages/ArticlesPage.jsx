import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Loader2, Search, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { articles as api } from '../lib/api';
import { reportError } from '../lib/log';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';

const ROLE_FILTERS = [
  { id: '', label: 'All authors' },
  { id: 'founder', label: 'Founders' },
  { id: 'investor', label: 'Investors' },
  { id: 'partner', label: 'Partners' },
  { id: 'mentor', label: 'Mentors' },
  { id: 'coach', label: 'Coaches' },
  { id: 'admin', label: 'Axal team' },
];

const PAGE_SIZE = 12;

function ArticleCard({ a, featured }) {
  return (
    <Link
      to={`/articles/${a.slug}`}
      className={`group rounded-xl border bg-white dark:bg-slate-900 overflow-hidden transition flex flex-col ${
        featured
          ? 'border-violet-300 dark:border-violet-700 hover:border-violet-500 shadow-sm'
          : 'border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-600'
      }`}
    >
      {a.cover_url ? (
        <img
          src={a.cover_url}
          alt=""
          className="w-full aspect-[16/9] object-cover bg-slate-100 dark:bg-slate-800"
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      ) : (
        <div className="w-full aspect-[16/9] bg-gradient-to-br from-violet-100 to-violet-50 dark:from-violet-900/30 dark:to-slate-800 flex items-center justify-center">
          <FileText className="w-10 h-10 text-violet-400" />
        </div>
      )}
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          {featured && (
            <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300 font-semibold">
              <Star className="w-3 h-3 fill-current" /> Featured
            </span>
          )}
          {featured && (a.sector || a.read_minutes) ? <span>·</span> : null}
          {a.sector && <span>{a.sector.replace(/_/g, ' ')}</span>}
          {a.sector && a.read_minutes ? <span>·</span> : null}
          {a.read_minutes ? <span>{a.read_minutes} min read</span> : null}
        </div>
        <h3 className="font-semibold text-base text-slate-900 dark:text-slate-100 group-hover:text-violet-700 dark:group-hover:text-violet-300 line-clamp-2">
          {a.title}
        </h3>
        {a.subtitle && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{a.subtitle}</p>
        )}
        <div className="mt-auto pt-3 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 flex-wrap">
          <span>by</span>
          <span className="font-medium text-slate-700 dark:text-slate-300">{a.author || '—'}</span>
          {a.author_role && <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{a.author_role}</span>}
          {a.published_at && (
            <>
              <span>·</span>
              <span>{new Date(a.published_at).toLocaleDateString()}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function ArticlesPage() {
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="w-7 h-7 text-violet-600" /> Articles
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Long-form writing from the Axal network — founders, investors, partners, mentors, and the studio.
          </p>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search articles…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="text-xs px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900"
          >
            {ROLE_FILTERS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-4 flex flex-wrap gap-1.5">
          <button
            onClick={() => setSector('')}
            className={`text-xs px-2.5 py-1 rounded-full ${sector === '' ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
          >All sectors</button>
          {sectors.map((s) => (
            <button
              key={s.key}
              onClick={() => setSector(s.key)}
              className={`text-xs px-2.5 py-1 rounded-full ${sector === s.key ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
            >{s.label}</button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        {showFeatured && featuredItems.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-4 h-4 text-violet-600 fill-violet-600" />
              <h2 className="text-lg font-semibold">Featured</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {featuredItems.map((a) => <ArticleCard key={`f-${a.id}`} a={a} featured />)}
            </div>
          </section>
        )}

        <section>
          {showFeatured && featuredItems.length > 0 && (
            <h2 className="text-lg font-semibold mb-4">Latest</h2>
          )}
          {loading ? (
            <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin" />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-slate-500 py-20">
              {debouncedQ ? `No articles matching “${debouncedQ}”.` : 'No articles yet. Be the first to publish.'}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {items.map((a) => <ArticleCard key={a.id} a={a} />)}
              </div>
              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-3 text-sm">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-slate-500">Page {page + 1} of {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
