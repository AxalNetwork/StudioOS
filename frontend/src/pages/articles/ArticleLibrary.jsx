import React, { useMemo, useState } from 'react';
import { Copy, ExternalLink, FileText, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import {
  LIBRARY_SORTS, LIBRARY_TABS, libraryRows, libraryStats, libraryTags, tabCounts,
} from './articleCanvas';

/**
 * D1408 (#3694) — AR1, the member's own articles: WRITING / Articles.
 *
 * Tabs by status (Drafts, In review, Scheduled, Published), search, a tag
 * filter and a sort over `/api/articles/mine`, and a table a row of which
 * opens the editor. The canvas's other filters are not drawn (D1408 §3):
 * an article has no type (Insight / Announcement / Guide), and the library
 * lists only the member's own articles, so there is no Author filter. Of the
 * stat cards, published-in-30-days and views are read from the rows, and
 * followers is the member's public follower count (`/api/follows/status`);
 * that card is left out until the count is read.
 */
export default function ArticleLibrary({
  items = [], loading, refreshing, onRefresh, onOpen, onNew, creating, statusPill, relativeTime, coverSrc, onCopyUrl, publicUrl, followers = null, loadError = false,
}) {
  const [tab, setTab] = useState('drafts');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('edited');
  const counts = useMemo(() => tabCounts(items), [items]);
  const rows = useMemo(() => libraryRows(items, { tab, query, tag, sort }), [items, tab, query, tag, sort]);
  const tags = useMemo(() => libraryTags(items), [items]);
  const stats = useMemo(() => libraryStats(items), [items]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-testid="article-library">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Writing</div>
          <h1 className="text-2xl font-semibold mt-0.5">Articles</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh" className="p-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={onNew} disabled={creating} className="text-sm px-3 py-2 rounded bg-violet-600 text-white hover:bg-violet-700 inline-flex items-center gap-1.5 disabled:opacity-50" data-testid="article-new">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} New article
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 mt-5 ${followers == null ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`} data-testid="article-library-stats">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">Published in the last 30 days</div>
          <div className="text-2xl font-semibold mt-1">{stats.publishedLast30}</div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">Views on your published articles</div>
          <div className="text-2xl font-semibold mt-1">{stats.views.toLocaleString()}</div>
        </div>
        {followers != null && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4" data-testid="article-library-followers">
            <div className="text-xs text-slate-500">People following you</div>
            <div className="text-2xl font-semibold mt-1">{Number(followers).toLocaleString()}</div>
          </div>
        )}
      </div>

      <div role="tablist" aria-label="Articles by status" className="flex gap-1 mt-6 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {LIBRARY_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${tab === t.key ? 'border-violet-600 text-violet-700 dark:text-violet-300 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
            {t.label} <span className="text-xs text-slate-400">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center mt-4">
        <label className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
          <span className="sr-only">Search your articles</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles and tags" className="w-full text-sm pl-8 pr-3 py-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900" />
        </label>
        <select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} className="text-sm px-2 py-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900">
          <option value="">All tags</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className="text-sm px-2 py-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900">
          {LIBRARY_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        {loadError && items.length === 0 ? (
          <div role="alert" className="p-10 text-center text-slate-600 dark:text-slate-300" data-testid="article-library-error">
            <p className="m-0">Your articles could not be read.</p>
            <button type="button" onClick={onRefresh} className="mt-3 text-sm px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">Try again</button>
          </div>
        ) : loading ? (
          <div className="p-10 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline" /> Loading your articles…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-500" data-testid="article-library-empty">
            {items.length === 0 ? (
              <>
                <FileText className="w-8 h-8 mx-auto text-slate-300" />
                <p className="mt-2">You have not written an article yet.</p>
                <button type="button" onClick={onNew} className="mt-3 text-sm px-3 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-700">Start your first article</button>
              </>
            ) : query || tag ? 'No article here matches your search.' : `Nothing in ${LIBRARY_TABS.find((t) => t.key === tab).label.toLowerCase()} yet.`}
          </div>
        ) : (
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-2 font-medium" colSpan={2}>Title</th>
                <th className="px-3 py-2 font-medium">Last edit</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Words</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b last:border-0 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => onOpen(a.id)} data-testid="article-library-row">
                  <td className="pl-4 py-2 w-16">
                    {a.cover_url ? <img src={coverSrc(a)} alt="" className="w-12 h-8 object-cover rounded" /> : <div className="w-12 h-8 rounded bg-slate-100 dark:bg-slate-800" />}
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-left font-medium hover:text-violet-700 dark:hover:text-violet-300" onClick={(e) => { e.stopPropagation(); onOpen(a.id); }}>{a.title || 'Untitled draft'}</button>
                    {(a.tags || []).length > 0 && <div className="text-xs text-slate-500 truncate max-w-[340px]">{a.tags.join(' · ')}</div>}
                  </td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{relativeTime(a.updated_at)}</td>
                  <td className="px-3 py-2">{statusPill(a.status)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{(Number(a.word_count) || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {a.status === 'published' && a.slug && (
                      <>
                        <a href={publicUrl(a.slug)} target="_blank" rel="noopener noreferrer" aria-label="View live" className="inline-flex p-1 text-slate-500 hover:text-violet-700"><ExternalLink className="w-4 h-4" /></a>
                        <button type="button" aria-label="Copy the public link" onClick={() => onCopyUrl(a.slug)} className="inline-flex p-1 text-slate-500 hover:text-violet-700"><Copy className="w-4 h-4" /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
