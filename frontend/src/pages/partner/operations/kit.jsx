// Shared UI primitives for the Partner Operations workspace pages. The base
// primitives (avatar, chips, search, filter chips, slide-over, sections, fields,
// stat cards, sub-tabs, empty state) are reused from the advisor Network kit so
// every workspace in the app reads identically; this file adds the pieces the
// operations pages need on top (status badges, progress bars, star ratings,
// bullet lists, clickable row cards).
import React from 'react';
import { Star } from 'lucide-react';

export {
  Avatar, Chip, SearchInput, FilterChips, SlideOver, Section, Field, StatCard,
  SubTabs, EmptyState, StrengthBar,
} from '../../advisor/network/kit';

const TONES = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

// Maps common status/label words to a tone so callers can pass a bare label.
const STATUS_TONE = {
  active: 'emerald', completed: 'blue', closed: 'gray', done: 'emerald',
  in_progress: 'blue', 'in progress': 'blue', review: 'amber', not_started: 'gray',
  'not started': 'gray', 'renewal due': 'amber', pending: 'amber',
  core: 'emerald', activeFit: 'blue', selective: 'amber',
  expert: 'emerald', advanced: 'blue', intermediate: 'amber',
  primary: 'emerald',
};
const STATUS_LABEL = {
  in_progress: 'In progress', not_started: 'Not started', done: 'Done', review: 'In review',
};

export function Badge({ children, tone }) {
  const key = String(children).toLowerCase();
  const t = tone || STATUS_TONE[key] || 'gray';
  const label = STATUS_LABEL[children] || children;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${TONES[t]}`}>
      {label}
    </span>
  );
}

export function ProgressBar({ value, tone = 'violet' }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  const bar = { violet: 'bg-violet-500', emerald: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500' }[tone] || 'bg-violet-500';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-gray-600 dark:text-gray-400 w-8 text-right">{v}%</span>
    </div>
  );
}

// Star rating out of 5 (supports halves via rounding to nearest half).
export function Stars({ value, size = 14, showValue = true }) {
  const rounded = Math.round((value || 0) * 2) / 2;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map((i) => {
          // Round halves up so a 4.5 shows five lit stars; the numeric value
          // beside the stars communicates the precise score.
          const lit = rounded >= i - 0.5;
          return (
            <Star
              key={i}
              size={size}
              className={lit ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'}
              fill={lit ? 'currentColor' : 'none'}
            />
          );
        })}
      </span>
      {showValue && <span className="text-xs font-medium text-gray-600 dark:text-gray-400 tabular-nums">{(value || 0).toFixed(1)}</span>}
    </span>
  );
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

export function RowCard({ onClick, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

// ---- Live-data formatters (Wave 1a) ---------------------------------------
// These replace the helpers that lived in data/partner/operations.js, which
// formatted against a fixed demo "today" (2026-07-11). Real pages format
// against the real clock.
export function formatDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function formatRelativeDay(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.round((t - Date.now()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${-diff}d ago`;
  if (diff === 1) return 'Tomorrow';
  return `in ${diff}d`;
}

// Whole-dollar display for quote/engagement prices (the needs pipeline stores
// dollars). Not for new money columns — those are integer cents by rule.
export function moneyUsd(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}
