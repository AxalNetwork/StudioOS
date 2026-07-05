import React from 'react';
import { Activity, MapPin, Layers, Clock, ShieldCheck } from 'lucide-react';
import { timeAgo } from '../../lib/signalsMeta';

/**
 * SignalKPIStrip — the dashboard header metrics. Deliberately NOT a market
 * ticker: it summarises the SIGNAL population (how many, where, which sectors,
 * how fresh, how credible) so a founder gets situational awareness at a glance.
 */
function Kpi({ icon: Icon, label, children, tone = 'gray' }) {
  const iconTone = {
    gray: 'text-gray-400 dark:text-gray-500',
    violet: 'text-violet-500',
    emerald: 'text-emerald-500',
  }[tone];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Icon size={13} className={iconTone} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className="text-sm text-gray-900 dark:text-gray-100 min-w-0">{children}</div>
    </div>
  );
}

function PillList({ items, labelKey }) {
  if (!items || !items.length) return <span className="text-gray-400 dark:text-gray-500">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.slice(0, 3).map((it) => (
        <span
          key={it[labelKey]}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          {it[labelKey]}
          <span className="text-gray-400 dark:text-gray-500">{it.count}</span>
        </span>
      ))}
    </div>
  );
}

export default function SignalKPIStrip({ kpis, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-[76px] animate-pulse" />
        ))}
      </div>
    );
  }
  if (!kpis) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi icon={Activity} label="Active signals" tone="violet">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold">{kpis.active_signals}</span>
          <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <ShieldCheck size={12} className="text-emerald-500" />
            {kpis.avg_confidence}% avg confidence
          </span>
        </div>
      </Kpi>
      <Kpi icon={MapPin} label="Top regions">
        <PillList items={kpis.top_regions} labelKey="region" />
      </Kpi>
      <Kpi icon={Layers} label="Top sectors">
        <PillList items={kpis.top_sectors} labelKey="sector" />
      </Kpi>
      <Kpi icon={Clock} label="Freshness">
        <div className="flex flex-col">
          <span className="font-medium">Newest {timeAgo(kpis.freshest_updated_at)}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">Refreshed {timeAgo(kpis.last_refreshed_at)}</span>
        </div>
      </Kpi>
    </div>
  );
}
