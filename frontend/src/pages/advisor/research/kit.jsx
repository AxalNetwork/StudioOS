// Shared UI primitives for the advisor Research workspace pages. The base
// primitives (chips, search, slide-over, sections, stat cards, sub-tabs, empty
// state) are reused from the Network kit so every advisor section reads
// identically; this file adds Research-specific pieces (trend/momentum badges,
// a labelled sample-AI wrapper, sortable-feeling data rows) on top.
import React from 'react';
import { TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react';

export {
  Avatar, Chip, SearchInput, FilterChips, SlideOver, Section, Field, StatCard,
  SubTabs, EmptyState,
} from '../network/kit';

const TONES = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

const BADGE_TONE = {
  // momentum
  aggressive: 'emerald', growing: 'blue', selective: 'amber', cautious: 'amber', declining: 'rose',
  // trend stage
  emerging: 'violet', mainstream: 'emerald',
  // impact
  high: 'emerald', medium: 'blue', low: 'gray',
  // sentiment
  positive: 'emerald', neutral: 'gray', negative: 'rose',
  // exit type
  ipo: 'emerald', 'm&a': 'blue', spac: 'amber',
  // confidentiality
  public: 'emerald', internal: 'blue', confidential: 'rose',
};

export function Badge({ children, tone }) {
  const t = tone || BADGE_TONE[String(children).toLowerCase()] || 'gray';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${TONES[t]}`}>
      {children}
    </span>
  );
}

// Directional value with an up/down/flat arrow.
export function TrendValue({ trend, children, className = '' }) {
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const color = trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-rose-500' : 'text-gray-500';
  return (
    <span className={`inline-flex items-center gap-1 ${color} ${className}`}>
      <Icon size={14} /> {children}
    </span>
  );
}

// Growth percentage colored by magnitude.
export function GrowthPct({ value }) {
  if (value == null) return <span className="text-gray-400">—</span>;
  const color = value >= 30 ? 'text-emerald-600' : value >= 12 ? 'text-blue-600' : value >= 0 ? 'text-gray-600 dark:text-gray-300' : 'text-rose-500';
  return <span className={`font-medium ${color}`}>{value > 0 ? '+' : ''}{value}%</span>;
}

export function BulletList({ items, tone = 'gray' }) {
  if (!items || items.length === 0) return <p className="text-sm text-gray-400 italic">—</p>;
  const dot = { gray: 'bg-gray-400', emerald: 'bg-emerald-500', rose: 'bg-rose-400', violet: 'bg-violet-500', blue: 'bg-blue-500' }[tone] || 'bg-gray-400';
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <span className={`w-1.5 h-1.5 rounded-full ${dot} mt-1.5 flex-shrink-0`} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function RowCard({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors"
    >
      {children}
    </button>
  );
}

// Banner marking a whole surface as sample AI output (used across AI Research).
export function AiSampleBanner({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/50 px-4 py-2.5 text-sm text-violet-900 dark:text-violet-200">
      <Sparkles size={15} className="mt-0.5 shrink-0 text-violet-500" />
      <span>{children || 'Sample AI output — illustrative placeholder, not generated from live data.'}</span>
    </div>
  );
}

// Small inline "sample output" tag for individual AI cards.
export function SampleTag() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
      <Sparkles size={9} /> Sample
    </span>
  );
}
