/**
 * D995 — the class strings the profile record and its dialogs share with the
 * list page (`PartnerProfiles.jsx`), so they look alike in light and dark.
 */
/** D996 (PRF11): below 1024px every tap target is at least 44 by 44 px. */
export const TAP = 'max-lg:min-h-[44px] max-lg:min-w-[44px]';
export const BTN = `inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:opacity-50 ${TAP}`;
export const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
export const PRIMARY = `${BTN} border border-axal-violet bg-axal-violet text-white dark:border-violet-500 dark:bg-violet-600`;
export const DANGER = `${BTN} border border-axal-destructive bg-axal-destructive text-white dark:border-red-500 dark:bg-red-600`;
export const DANGER_GHOST = `${BTN} border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-300`;
export const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
export const MONO = 'font-mono tabular-nums';
export const INPUT = `rounded-[7px] border border-axal-hairline px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 ${TAP}`;
export const PILL = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold';
export const OUTLINE = `${PILL} border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`;
export const REFUSAL = 'm-0 text-[13px] font-semibold text-axal-destructive dark:text-red-300';
/** PRF6's tones; the amber keeps its fill in dark (PRF12). */
export const TONE = {
  green: 'border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  amber: 'border-[#fcd34d] bg-[#fffbeb] text-[#92400e] dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
  note: 'border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
  red: 'border-axal-destructive-edge bg-axal-destructive-tint text-axal-destructive dark:border-red-900 dark:bg-red-900/30 dark:text-red-300',
};
export const TONE_GLYPH = { green: '✓', amber: '!', note: 'i', red: '!' };
/** D996 (PRF11b, c): the phone page's bar of actions, kept at the bottom of the screen. */
export const STICKY_BAR = 'sticky bottom-0 z-10 flex gap-2 border-t border-axal-hairline bg-white px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 dark:border-gray-700 dark:bg-gray-950';
