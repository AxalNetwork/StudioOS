// Shared UI primitives for the advisor Advisory workspace pages. The base
// primitives (chips, search, slide-over, sections, stat cards, sub-tabs, empty
// state) are reused from the Network kit so both advisor sections read
// identically; this file adds Advisory-specific pieces (status badges, progress
// bars, checklists, timelines) on top.
import React from 'react';
import { Check } from 'lucide-react';

export {
  Avatar, Chip, SearchInput, FilterChips, SlideOver, Section, Field, StatCard,
  SubTabs, EmptyState,
} from '../network/kit';

// Map a free-text status to a chip tone so statuses read consistently.
const STATUS_TONE = {
  // positive / done
  won: 'emerald', 'closed won': 'emerald', active: 'emerald', signed: 'emerald',
  paid: 'emerald', delivered: 'emerald', completed: 'emerald', high: 'emerald',
  // in-flight / neutral-positive
  'in progress': 'blue', 'in review': 'blue', 'under review': 'blue', sent: 'blue',
  scheduled: 'blue', processing: 'blue', onboarding: 'blue', 'call scheduled': 'blue',
  medium: 'blue', qualified: 'blue', 'verbal agreement': 'blue',
  // pending / attention
  proposed: 'amber', 'awaiting signature': 'amber', 'awaiting reply': 'amber',
  'proposal sent': 'amber', draft: 'amber', upcoming: 'amber', pending: 'amber',
  new: 'amber', 'needs assessment done': 'amber', 'kickoff complete': 'amber',
  'in negotiation': 'amber', 'not started': 'gray',
  // negative
  lost: 'rose', 'closed lost': 'rose', overdue: 'rose', low: 'rose',
};

export function StatusBadge({ status }) {
  if (!status) return null;
  const tone = STATUS_TONE[String(status).toLowerCase()] || 'gray';
  const tones = {
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${tones[tone]}`}>
      {status}
    </span>
  );
}

export function ProgressBar({ value, tone = 'violet' }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  const bar = {
    violet: 'bg-violet-500', emerald: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500',
  }[tone] || 'bg-violet-500';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-gray-600 dark:text-gray-400 w-9 text-right">{v}%</span>
    </div>
  );
}

// Checklist of { label, done } items.
export function Checklist({ items }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
            it.done ? 'bg-emerald-500 text-white' : 'border border-gray-300 dark:border-gray-600'
          }`}>
            {it.done && <Check size={11} />}
          </span>
          <span className={it.done ? 'text-gray-500 line-through dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}>
            {it.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Simple bulleted list with a heading, used across detail panels.
export function BulletList({ items, tone = 'gray' }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-gray-400 italic">—</p>;
  }
  const dot = {
    gray: 'bg-gray-400', emerald: 'bg-emerald-500', rose: 'bg-rose-400', violet: 'bg-violet-500',
    blue: 'bg-blue-500', amber: 'bg-amber-500',
  }[tone] || 'bg-gray-400';
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

// Vertical timeline of { date, label, type } events.
const TIMELINE_TONE = {
  engagement: 'bg-violet-500', contract: 'bg-blue-500', meeting: 'bg-amber-500',
  deliverable: 'bg-emerald-500', milestone: 'bg-fuchsia-500', renewal: 'bg-teal-500',
};
export function Timeline({ events, renderMeta }) {
  return (
    <ol className="relative border-l border-gray-200 dark:border-gray-800 ml-1.5 space-y-4">
      {events.map((e, i) => (
        <li key={i} className="ml-4">
          <span className={`absolute -left-[5px] w-2.5 h-2.5 rounded-full ${TIMELINE_TONE[e.type] || 'bg-gray-400'}`} />
          <div className="text-sm text-gray-800 dark:text-gray-200">{e.label}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">{renderMeta ? renderMeta(e) : e.date}</div>
        </li>
      ))}
    </ol>
  );
}

// Labelled placeholder wrapper for AI-generated sample output.
export function AiSample({ children }) {
  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-900/60 bg-violet-50/60 dark:bg-violet-900/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300 mb-1">
        AI summary · sample output
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300">{children}</p>
    </div>
  );
}

// Clickable list-row card used by the pipeline / list surfaces.
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
