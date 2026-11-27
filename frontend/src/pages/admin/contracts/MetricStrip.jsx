import React from 'react';
import { Link } from 'react-router-dom';
import { metricCells } from './contractMetrics';

/**
 * D4811 (#4811) part 3 — the Agreements metric strip (board CT-01, CT-91
 * MetricLinkStrip): six cells, each a control that opens the records behind
 * its count. A count the Worker did not return reads "Unreadable", never 0.
 * Two cells (Legal review required, Restricted) count templates and
 * governance records; their governance part has its own link.
 */
export default function MetricStrip({ stats, onDrill }) {
  const cells = metricCells(stats);
  if (!cells) return <p role="status" className="text-[12px] text-axal-muted">The attention counts were not returned. The agreements below are unaffected.</p>;
  return <nav aria-label="Agreements needing attention" data-testid="contracts-metric-strip"
    className="grid grid-cols-2 overflow-hidden rounded-xl border border-axal-hairline bg-white dark:bg-gray-900 md:grid-cols-3 xl:grid-cols-6">
    {cells.map((m) => <div key={m.key} className="flex flex-col border-b border-r border-axal-hairline p-3" data-testid={`metric-${m.key}`}>
      <button type="button" onClick={() => onDrill(m.drill)} aria-label={`${m.label}: ${m.value == null ? 'unreadable' : m.value}. Open these records.`}
        className="min-h-[44px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-axal-faint">{m.label}</span>
        <span className="block font-mono text-2xl font-bold">{m.value == null ? <span className="text-sm font-semibold text-axal-muted">Unreadable</span> : m.value}</span>
        {m.lines.map((line) => <span key={line} className="block text-[11px] text-axal-muted">{line}</span>)}
        <span className="mt-1 block text-[11px] font-semibold text-violet-700 dark:text-violet-300" aria-hidden="true">View →</span>
      </button>
      {m.also && <Link to={m.also.to} className="mt-1 text-[11px] font-semibold text-violet-700 underline dark:text-violet-300">{m.also.label}</Link>}
    </div>)}
  </nav>;
}
