import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

/**
 * D630 (#1388) — the four states every deal-room screen draws, as the Ops
 * canvas words them: loading; empty; "Not recorded" with its one-line reason;
 * "Unreadable" with "Try again". A failed read never renders a zero or an
 * empty list — `Unreadable` is the only thing a failed read draws.
 */

export function Loading({ what }) {
  return (
    <div className="py-8 text-center text-sm text-gray-500" data-testid="dr-loading">
      <Loader2 className="mr-2 inline animate-spin" size={15} /> Loading {what}…
    </div>
  );
}

export function Empty({ children, action }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-800" data-testid="dr-empty">
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Unreadable({ children, onRetry }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert" data-testid="dr-unreadable">
      <span className="font-semibold">Unreadable.</span> {children}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-1 inline-flex items-center gap-1 font-semibold underline">
          <RefreshCw size={11} /> Try again
        </button>
      )}
    </div>
  );
}

/** "Not recorded", with the reason beside it rather than behind a hover. */
export function NotRecorded({ reason }) {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400" title={reason} data-testid="dr-not-recorded">
      {reason}
    </span>
  );
}

const TONES = {
  grey: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  violet: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
};

export function StatusPill({ tone = 'grey', children, testid }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONES[tone] || TONES.grey}`} data-testid={testid}>
      {children}
    </span>
  );
}

/** A refusal, as its sentence: a title and the line under it. */
export function Refusal({ refusal, tone = 'bad' }) {
  if (!refusal) return null;
  const cls = tone === 'warn'
    ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
    : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300';
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`} role="alert" data-testid="dr-refusal">
      <div className="font-semibold">{refusal.title}</div>
      {refusal.body && <div className="mt-0.5">{refusal.body}</div>}
    </div>
  );
}

export const BTN = {
  primary: 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60',
  ghost: 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800',
  danger: 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300',
  link: 'text-sm font-semibold text-violet-700 underline-offset-2 hover:underline dark:text-violet-300',
};

export const INPUT = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
