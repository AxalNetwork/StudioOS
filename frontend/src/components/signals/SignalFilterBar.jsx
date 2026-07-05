import React from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { facetLabel, prettify } from '../../lib/signalsMeta';

/**
 * SignalFilterBar — the top filter row. Renders one <select> per facet the
 * dataset actually contains (facets come from /api/signals/filters), plus a
 * free-text search. Region / Country / Sector / Industry / Niche / Market-cap
 * band / Employee band / Customer type / Maturity stage / Signal type are all
 * supported per the product spec.
 */
const FILTER_DEFS = [
  { key: 'region', label: 'Region' },
  { key: 'country', label: 'Country' },
  { key: 'sector', label: 'Sector' },
  { key: 'industry', label: 'Industry / niche' },
  { key: 'type', label: 'Signal type' },
  { key: 'market_cap_band', label: 'Market cap' },
  { key: 'employee_band', label: 'Company size' },
  { key: 'customer_type', label: 'Target buyer' },
  { key: 'maturity_stage', label: 'Maturity' },
];

function FacetSelect({ def, value, options, onChange }) {
  if (!options || !options.length) return null;
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{def.label}</span>
      <select
        value={value || ''}
        onChange={(e) => onChange(def.key, e.target.value || undefined)}
        className={`border rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500 ${
          value ? 'ring-1 ring-violet-300 dark:ring-violet-700' : ''
        }`}
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {facetLabel(def.key === 'industry' ? 'industry' : def.key, opt)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function SignalFilterBar({ facets, filters, onChange, onReset, resultCount }) {
  const activeCount = Object.entries(filters).filter(
    ([k, v]) => v && !['mode', 'limit'].includes(k),
  ).length;

  // Merge industry + niche facets into one dropdown (industry is the coarser of
  // the two and what founders scan by).
  const facetOptions = {
    ...facets,
    industry: facets ? [...new Set([...(facets.industry || []), ...(facets.niche || [])])].sort() : [],
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
          <SlidersHorizontal size={15} className="text-violet-500" />
          Filters
          {activeCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
              {activeCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {typeof resultCount === 'number' && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{resultCount} signals</span>
          )}
          {activeCount > 0 && (
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          value={filters.q || ''}
          onChange={(e) => onChange('q', e.target.value || undefined)}
          placeholder="Search theses, niches, sectors…"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>

      {/* Facet dropdowns */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {FILTER_DEFS.map((def) => (
          <FacetSelect
            key={def.key}
            def={def}
            value={filters[def.key]}
            options={facetOptions[def.key]}
            onChange={onChange}
          />
        ))}
      </div>

      {/* Active filter chips */}
      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {Object.entries(filters)
            .filter(([k, v]) => v && !['mode', 'limit', 'q'].includes(k))
            .map(([k, v]) => (
              <button
                key={k}
                onClick={() => onChange(k, undefined)}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/50"
              >
                {facetLabel(k, v)}
                <X size={11} />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
