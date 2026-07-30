// Shared UI primitives for the Growth workspace pages (Talent, Customers,
// Capital, Experts). Growth is shared between the Advisor and Partner profiles,
// so this kit re-uses the existing advisory/network primitives (so the section
// reads like the rest of the product) and adds a few Growth-specific pieces:
// a currency formatter, a match/fit badge, a selectable module grid, a pipeline
// strip, and a generic resource view that gives every Growth tab the same
// stats → modules → list → detail-panel scaffold.
import React, { useMemo, useState } from 'react';

export {
  Avatar, Chip, SearchInput, FilterChips, SlideOver, Section, Field, StatCard,
  SubTabs, EmptyState, StatusBadge, ProgressBar, BulletList, Checklist, AiSample, RowCard,
} from '../advisor/advisory/kit';

import {
  SearchInput, StatCard, SlideOver, EmptyState,
} from '../advisor/advisory/kit';

// Compact currency formatter for mock financial figures.
export function money(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

// Fit / match score badge, tone-graded by strength.
export function MatchBadge({ score, label = 'Fit', size = 'md' }) {
  if (score == null) return null;
  const tone = score >= 90 ? 'emerald' : score >= 75 ? 'blue' : score >= 60 ? 'amber' : 'gray';
  const tones = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  };
  const pad = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${pad} ${tones[tone]}`}>
      {label && <span className="opacity-70 font-medium">{label}</span>} {score}
    </span>
  );
}

// Selectable grid of internal modules. `modules` is [{ id, name, desc }]; counts
// are computed from `records[moduleKey]`. An implicit "All" card resets the
// filter. Clicking a module filters the list below.
export function ModuleGrid({ modules, records, moduleKey = 'module', value, onChange }) {
  const counts = useMemo(() => {
    const map = { all: records.length };
    for (const r of records) map[r[moduleKey]] = (map[r[moduleKey]] || 0) + 1;
    return map;
  }, [modules, records, moduleKey]);

  const cards = [{ id: 'all', name: 'All resources', desc: 'Everything in this area' }, ...modules];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((m) => {
        const active = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`text-left rounded-xl border p-3 transition-colors ${
              active
                ? 'border-violet-500 ring-1 ring-violet-500 bg-violet-50/70 dark:bg-violet-900/20'
                : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-violet-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{m.name}</span>
              <span className={`text-[11px] tabular-nums px-1.5 py-0.5 rounded-full ${active ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                {counts[m.id] || 0}
              </span>
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{m.desc}</div>
          </button>
        );
      })}
    </div>
  );
}

// Horizontal stage strip highlighting the active pipeline stage.
export function PipelineStrip({ stages, active }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {stages.map((s, i) => {
        const isActive = s === active;
        const passed = active && stages.indexOf(active) > i;
        return (
          <React.Fragment key={s}>
            <span
              className={`whitespace-nowrap text-[11px] font-medium px-2.5 py-1 rounded-full border ${
                isActive
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : passed
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-900/60 dark:text-emerald-300'
                    : 'bg-white border-gray-200 text-gray-500 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400'
              }`}
            >
              {s}
            </span>
            {i < stages.length - 1 && <span className="text-gray-300 dark:text-gray-700 text-xs">→</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function matchesSearch(record, query, keys) {
  if (!query) return true;
  const q = query.toLowerCase();
  return keys.some((k) => String(record[k] ?? '').toLowerCase().includes(q));
}

// Generic Growth resource view — gives every tab the same scaffold:
// summary stats → selectable module grid → searchable list → slide-over detail.
// Pages supply the data plus `renderRow` and `renderDetail`.
export function GrowthResourceView({
  stats = [],
  modules,
  records,
  moduleKey = 'module',
  searchKeys = [],
  searchPlaceholder = 'Search',
  renderRow,
  renderDetail,
  emptyText = 'Nothing here yet.',
}) {
  const [module, setModule] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const filtered = useMemo(
    () => records.filter((r) => (module === 'all' || r[moduleKey] === module) && matchesSearch(r, query, searchKeys)),
    [records, module, moduleKey, query, searchKeys],
  );
  const selected = records.find((r) => r.id === selectedId) || null;

  return (
    <div className="space-y-5">
      {stats.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} hint={s.hint} />
          ))}
        </div>
      )}

      <ModuleGrid modules={modules} records={records} moduleKey={moduleKey} value={module} onChange={setModule} />

      <div className="flex items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder={searchPlaceholder} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState>{emptyText}</EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((r) => renderRow(r, () => setSelectedId(r.id)))}
        </div>
      )}

      <SlideOver
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? (selected.name || selected.company || selected.customerTarget) : ''}
        subtitle={selected ? renderDetail.subtitle?.(selected) : ''}
      >
        {selected && renderDetail(selected)}
      </SlideOver>
    </div>
  );
}
