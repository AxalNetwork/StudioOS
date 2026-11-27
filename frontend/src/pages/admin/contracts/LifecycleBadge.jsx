import React from 'react';
import { OVERLAYS } from '../../../lib/contractLifecycle';

// D4811 (#4811) — the lifecycle badge, the safety overlay badge and the
// safety banner (board CT91: LifecycleBadge, SafetyOverlayBadge, SafetyBanner).
// The words and the treatment come from `lib/contractLifecycle.js`; this file
// only draws them. Each badge is a glyph (aria-hidden) and words, and the
// border style is a third cue: dashed for "Approved for use", a filled ink
// seal only for "Executed", struck through for "Voided".

const BASE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold';
export const TREATMENT_CLASS = Object.freeze({
  plain: 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200',
  progress: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  outline: 'border-dashed border-[#6d28d9] bg-[#f4f0fe] text-[#6d28d9] dark:border-violet-400 dark:bg-transparent dark:text-violet-300',
  seal: 'border-[#18181b] bg-[#18181b] text-white dark:border-white dark:bg-white dark:text-[#18181b]',
  void: 'border-axal-hairline bg-white text-axal-muted line-through dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
});

/** One lifecycle state, or nothing when the state is not known. */
export function LifecycleBadge({ badge, testId }) {
  if (!badge) return null;
  return <span data-testid={testId || `lifecycle-${badge.system}`} data-treatment={badge.treatment}
    className={`${BASE} ${TREATMENT_CLASS[badge.treatment] || TREATMENT_CLASS.plain}`}>
    <span aria-hidden="true">{badge.glyph}</span>{badge.label}
  </span>;
}

/** Restricted or Incomplete, drawn beside the lifecycle badge, never instead of it. */
export function SafetyOverlayBadge({ kind }) {
  const o = OVERLAYS[kind];
  if (!o) return null;
  const tone = kind === 'restricted'
    ? 'border-[#18181b] bg-white text-[#18181b] dark:border-gray-200 dark:bg-gray-900 dark:text-gray-100'
    : 'border-dashed border-[#fcd34d] bg-[#fffbeb] text-[#92400e] dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200';
  return <span data-testid={`overlay-${kind}`} className={`${BASE} ${tone}`}><span aria-hidden="true">{o.glyph}</span>{o.label}</span>;
}

/**
 * The banner a gated template shows where Generate, Use template and Publish
 * would be. It lists them as text; they are not rendered as buttons.
 */
export function SafetyBanner({ banner, unavailable = [] }) {
  if (!banner) return null;
  const restricted = banner.kind === 'restricted';
  return <div role="note" data-testid={`safety-banner-${banner.kind}`}
    className={`rounded-lg border p-3 text-[12.5px] ${restricted
      ? 'border-[#18181b] bg-white dark:border-gray-200 dark:bg-gray-900'
      : 'border-dashed border-[#fcd34d] bg-[#fffbeb] text-[#92400e] dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200'}`}>
    <p className="font-bold"><span aria-hidden="true">{OVERLAYS[banner.kind]?.glyph} </span>{banner.title}</p>
    <p className="mt-0.5">{banner.reason}</p>
    {restricted && unavailable.length > 0 && <p className="mt-1 text-[12px]">Not available while restricted: {unavailable.join(' · ')}.</p>}
  </div>;
}

/** The only amber flag in a table (board CT91 InconsistencyFlag): the text names the contradiction. */
export function InconsistencyFlag({ text }) {
  if (!text) return null;
  return <span role="note" data-testid="agreement-contradiction"
    className="inline-flex items-center gap-1 rounded-full border border-[#fcd34d] bg-[#fffbeb] px-2 py-0.5 text-[11px] font-semibold text-[#92400e] dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
    <span aria-hidden="true">⚠</span>{text}</span>;
}
