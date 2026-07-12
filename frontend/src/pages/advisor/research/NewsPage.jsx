import React, { useMemo, useState } from 'react';
import { Newspaper } from 'lucide-react';
import { NEWS, NEWS_CATEGORIES, formatRelativeDay, formatDay } from '../../../data/advisor/research';
import {
  SearchInput, FilterChips, SlideOver, Section, Badge, EmptyState, Chip,
} from './kit';

// News — a categorized news feed (Industry, Portfolio, Competitor, Funding,
// Acquisitions, IPO) with category filtering, search, and a detail panel.

const catLabel = (id) => NEWS_CATEGORIES.find((c) => c.id === id)?.label || id;

export default function NewsPage() {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [id, setId] = useState(null);

  const filters = useMemo(() => ([
    { id: 'all', label: 'All', count: NEWS.length },
    ...NEWS_CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: NEWS.filter((n) => n.category === c.id).length })),
  ]), []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return NEWS
      .filter((n) => {
        if (cat !== 'all' && n.category !== cat) return false;
        if (!term) return true;
        return [n.headline, n.summary, n.source, ...(n.companies || [])].some((v) => String(v).toLowerCase().includes(term));
      })
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [cat, q]);

  const sel = NEWS.find((x) => x.id === id) || null;

  return (
    <div className="space-y-4">
      <SearchInput value={q} onChange={setQ} placeholder="Search headlines, companies…" />
      <FilterChips options={filters} value={cat} onChange={setCat} />
      {rows.length === 0 ? <EmptyState>No stories match your filters.</EmptyState> : (
        <div className="space-y-2">
          {rows.map((n) => (
            <button key={n.id} onClick={() => setId(n.id)} className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center flex-shrink-0">
                <Newspaper size={16} className="text-violet-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge>{catLabel(n.category)}</Badge>
                  <Badge>{n.sentiment}</Badge>
                  <span className="text-[11px] text-gray-400">{n.source} · {formatRelativeDay(n.date)}</span>
                </div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{n.headline}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">{n.summary}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.headline} subtitle={`${sel.source} · ${formatDay(sel.date)}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{catLabel(sel.category)}</Badge>
            <Badge>{sel.sentiment}</Badge>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{sel.summary}</p>
          {sel.companies?.length > 0 && (
            <Section title="Companies mentioned">
              <div className="flex flex-wrap gap-1.5">{sel.companies.map((c) => <Chip key={c} tone="violet">{c}</Chip>)}</div>
            </Section>
          )}
        </SlideOver>
      )}
    </div>
  );
}
