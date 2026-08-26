import React from 'react';

/**
 * The status pill — 46 canvases render one directly, and another 40 define a
 * local `pill(tone)` style factory to build them.
 *
 * Those 40 factories are why this component exists with a single exported
 * tone map. The canvases disagree on the ARGUMENT ORDER for the same tone:
 * `ok` appears as ['#a7f3d0','#f2fdf7','#047857'], as
 * ['#ecfdf5','#047857','#a7f3d0'], and as ['#f2fdf7','#a7f3d0','#047857']
 * across different files. That is copy-paste rot in the design source, not a
 * deliberate variation — so the tones are named here once and the positional
 * form is not reproduced at all.
 *
 *   <Pill tone="ok">Signed</Pill>
 *   <Pill tone="warn" dot>Expiring</Pill>
 *
 * Tone names are semantic, not colours: a caller should ask for `danger`, not
 * for red, so a later palette change lands in one place.
 */
export const PILL_TONES = {
  neutral: 'bg-axal-ground text-axal-muted border-axal-hairline dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  warn: 'bg-amber-50 text-axal-amber-deep border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  danger: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  info: 'bg-axal-lavender text-axal-violet-deep border-axal-violet/25 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
};

const DOTS = {
  neutral: 'bg-axal-faint',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-axal-violet',
};

export default function Pill({
  children,
  tone = 'neutral',
  dot = false,
  className = '',
  'data-testid': testId,
}) {
  return (
    <span
      data-testid={testId || 'pill'}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-axal-pill border text-[11px] font-semibold whitespace-nowrap ${
        PILL_TONES[tone] ?? PILL_TONES.neutral
      } ${className}`}
    >
      {dot && <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full flex-none ${DOTS[tone] ?? DOTS.neutral}`} />}
      {children}
    </span>
  );
}
