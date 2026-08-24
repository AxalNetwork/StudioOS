/**
 * Spin-Out Lab shared chip + button styles.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * An audit of all 20 Lab tool pages found that every page had hand-rolled its
 * own status chip and its own quick-action button. The drift was not cosmetic
 * noise, it was measurable:
 *
 *   "Active" chip     — 5 different class strings across the 20 pages
 *                       (rounded vs rounded-full, 10px vs 10.5px, emerald-50
 *                       vs emerald-100, tracking-wide vs tracking-wider,
 *                       px-1.5 vs px-2 vs px-2.5).
 *   "Unlocked · Wk n" — 4 treatments: bare gray text, bordered violet pill,
 *                       emerald pill, and absent entirely.
 *   Quick actions     — at least 6 private `QA_BTN` constants, each declared
 *                       at module scope in its own page file, with heights of
 *                       h-8 / h-9 / py-1.5 and text of 11.5px / 12px / xs.
 *
 * Every one of those was someone reasonably copying the nearest neighbour.
 * The fix is not more discipline, it is one place to copy from. These helpers
 * are that place; `LabPageHeader.jsx` consumes them and re-exports them so a
 * page needs a single import.
 *
 * DESIGN MEASUREMENTS ENCODED HERE
 * --------------------------------
 * From the Claude Design exports in attached_assets (the same handoff that
 * produced LabBackLink and LabPageIcon):
 *
 *   status chip   10.5px / 700 · radius full · padding 2px 10px
 *                 bg #ecfdf5 · text #047857                    (tone 'active')
 *   week pill     11px / 600 · radius full · padding 4px 12px
 *                 bg #f5f3ff · text #6d28d9 · 1px #ede9fe border
 *                                                            (tone 'unlocked')
 *   action button height 34px (h-9) · padding 0 14px (px-3.5) · radius 8px
 *                 12px / 600 · glyph 18px box rendered at size 13
 *
 * HOW TO EXTEND
 * -------------
 * Add a tone or variant HERE, never inline on a page. If a page needs a
 * one-off, pass the extra classes as the second argument — that keeps the
 * deviation visible in review instead of spawning a seventh QA_BTN.
 *
 * NOTE ON CLASS COMPOSITION: the base strings deliberately contain no
 * font-size, font-weight, padding or colour utilities. Tailwind resolves
 * conflicting utilities by their order in the generated stylesheet, not by
 * their order in the className string, so a `font-bold` base would silently
 * beat a `font-semibold` tone. Each tone/variant owns those properties whole.
 */

/** Every icon inside a Lab header control renders at this size. */
export const LAB_ICON_SIZE = 13;

/* ------------------------------------------------------------------ chips */

const CHIP_BASE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full';

/**
 * Tones the audit actually found in use, normalised to one string each.
 *
 *   active   — "Active" / "Graduated" / "Not started": the page's own status.
 *   unlocked — "Unlocked · Wk 4" / "Foundational · Wk 1": program position.
 *   admin    — admin-bypass and read-only notices (was ad-hoc amber text).
 *   muted    — inert or unavailable state ("Carta not connected").
 *   warn     — sub-threshold readiness (Market's 40-69% pill).
 *   danger   — failing readiness (Market's <40% pill).
 */
export const LAB_CHIP_TONES = {
  active:
    'text-[10.5px] font-bold px-2.5 py-0.5 ' +
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  unlocked:
    'text-[11px] font-semibold px-3 py-1 border ' +
    'bg-violet-50 text-violet-700 border-violet-100 ' +
    'dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  admin:
    'text-[10.5px] font-bold px-2.5 py-0.5 border ' +
    'bg-amber-50 text-amber-700 border-amber-100 ' +
    'dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-900/50',
  muted:
    'text-[10.5px] font-bold px-2.5 py-0.5 ' +
    'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  warn:
    'text-[10.5px] font-bold px-2.5 py-0.5 ' +
    'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  danger:
    'text-[10.5px] font-bold px-2.5 py-0.5 ' +
    'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

/**
 * Class string for a Lab status chip.
 *
 *   <span className={labChip('active')}>Active</span>
 *   <span className={labChip('unlocked')}>Unlocked · Wk {week}</span>
 *
 * Unknown tones fall back to 'muted' rather than rendering an unstyled chip,
 * so a typo degrades to something legible instead of to bare text.
 */
export function labChip(tone = 'muted', className = '') {
  const t = LAB_CHIP_TONES[tone] || LAB_CHIP_TONES.muted;
  return `${CHIP_BASE} ${t}${className ? ` ${className}` : ''}`;
}

/* ---------------------------------------------------------------- buttons */

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg ' +
  'text-xs font-semibold transition-colors ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Three variants, matching what the pages already reach for:
 *
 *   primary   — the one committing action per header (Edit, Log interview,
 *               Mark as filed, Preview as investor on Incorporate).
 *   secondary — bordered white/gray-900 control; the default for everything
 *               else (Share, Export, Copy link, Open data room, Full tool).
 *   ghost     — borderless chrome that only outlines on hover; used for the
 *               quick-action rows (Capital, Profiling, Scoring, Office Hours).
 *   accent    — tinted violet outline. Not one of the three canonical
 *               variants; kept because Startup's "Preview as investor" and
 *               Market's "Copy research summary" both already use it and
 *               flattening them to `secondary` would be a visible regression.
 *
 * The `disabled:hover:*` overrides matter: several pages ship deliberately
 * disabled actions ("Sharing isn't supported yet") whose `title` tooltip is
 * the whole point, so they must stay hoverable — `pointer-events-none` would
 * suppress the native tooltip — while not lighting up as if they were live.
 */
export const LAB_BTN_VARIANTS = {
  primary:
    'bg-violet-600 text-white hover:bg-violet-700 disabled:hover:bg-violet-600',
  secondary:
    'border border-gray-200 bg-white text-gray-600 ' +
    'hover:bg-gray-50 hover:border-violet-200 ' +
    'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 ' +
    'dark:hover:bg-gray-800 dark:hover:border-violet-800 ' +
    'disabled:hover:bg-white disabled:hover:border-gray-200 ' +
    'dark:disabled:hover:bg-gray-900 dark:disabled:hover:border-gray-700',
  ghost:
    'border border-transparent text-gray-500 ' +
    'hover:bg-white hover:border-gray-200 ' +
    'dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:border-gray-700 ' +
    'disabled:hover:bg-transparent disabled:hover:border-transparent',
  accent:
    'border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 ' +
    'dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300 ' +
    'dark:hover:bg-violet-900/50 ' +
    'disabled:hover:bg-violet-50 dark:disabled:hover:bg-violet-900/30',
};

/**
 * Class string for a Lab header/quick-action control. Works on <button>,
 * <a> and react-router <Link> alike — no `enabled:` variants are used,
 * because `:enabled` never matches an anchor and the hover state would
 * silently die on every link.
 *
 *   <button className={labBtn('primary')}>
 *     <Pencil size={LAB_ICON_SIZE} /> Edit Market Data
 *   </button>
 */
export function labBtn(variant = 'secondary', className = '') {
  const v = LAB_BTN_VARIANTS[variant] || LAB_BTN_VARIANTS.secondary;
  return `${BTN_BASE} ${v}${className ? ` ${className}` : ''}`;
}
