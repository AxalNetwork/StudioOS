/**
 * Spin-Out Lab introduction — the token pairs the two surfaces share.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A PILE OF HEX
 * ----------------------------------------------------
 * The canvas this page comes from is drawn in flat hex on a white ground:
 * `#faf9fc`, `#141118`, `#e8e6ee`, `#6b6577`. Porting those literally would
 * ship a page that is unreadable in dark mode — and, worse, would ship it
 * SILENTLY. `scripts/check-dark-mode.mjs` only pairs six bare utilities
 * (`bg-white`, `text-gray-900/800/700`, `border-gray-200/300`); it has no
 * opinion at all about `bg-[#faf9fc]` or `style={{ background: '#141118' }}`,
 * so a hex port passes `npm run test:drift` and fails on a reader's screen.
 * `frontend/test/spinout_lab_intro.test.mjs` is what actually guards this, and
 * it guards it by asserting the hex is not there — which only works if there
 * is one legitimate place for the exceptions, which is this file.
 *
 * WHERE THE VALUES COME FROM. Five of the canvas's colours are already minted
 * in the `@theme` block of `frontend/src/index.css` at exactly the same value:
 *
 *   #6d28d9 → axal-violet-deep      #f4f0fe → axal-lavender
 *   #7c3aed → axal-violet           #f4f3f7 → axal-ground
 *   #6b6577 → axal-muted
 *
 * Two more are minted a shade off, deliberately: `axal-hairline` is `#ececf1`
 * against the canvas's `#e8e6ee`, and `axal-ink` is `#18181b` against
 * `#141118`. Those deltas are DECISIONS.md D2 — the corpus majority beats one
 * canvas's spec for neutrals — and re-litigating them for this page would put
 * the whole product a shade out of step with itself. Use the tokens.
 *
 * THE DARK/LIGHT RULE. No `axal-*` token carries a dark counterpart:
 * `bg-axal-ground` is `#f4f3f7` in both themes. So each pair below states the
 * axal token for light and an ordinary gray utility for dark, in ONE string,
 * which is also the shape `check-dark-mode` understands. Compose these; never
 * retype them on a page.
 *
 * THE TREE-SHAKING TRAP. Tailwind v4 drops any `@theme` token no utility
 * references, so `var(--color-axal-violet)` inside a `style` attribute
 * resolves to nothing in the built CSS while working fine in dev
 * (`index.css:41-46`). Everything here is a utility class for that reason.
 */

/** Section eyebrow — uppercase, tracked, the canvas's 9–10px label. */
export const LAB_EYEBROW =
  'text-[10px] font-extrabold uppercase tracking-axal-label-wide ' +
  'text-axal-muted dark:text-gray-400';

/** Eyebrow on a dark panel, where the light/dark split does not apply. */
export const LAB_EYEBROW_ON_DARK =
  'text-[10px] font-extrabold uppercase tracking-axal-label-wide text-violet-200/80';

/** Section heading. */
export const LAB_H2 =
  'text-[22px] sm:text-[26px] font-black tracking-axal-heading ' +
  'text-axal-ink dark:text-gray-100';

/** Body copy under a heading. */
export const LAB_LEDE =
  'text-[13.5px] leading-relaxed text-gray-600 dark:text-gray-400';

/** The standard card: hairline border, no shadow, separation by surface step. */
export const LAB_CARD =
  'rounded-axal-xl border bg-white border-axal-hairline ' +
  'dark:bg-gray-900 dark:border-gray-800';

/** A quieter card for panels that sit on the white ground. */
export const LAB_CARD_SUNKEN =
  'rounded-axal-lg border bg-axal-ground border-axal-hairline ' +
  'dark:bg-gray-900/60 dark:border-gray-800';

/** The page ground below the hero. */
export const LAB_SURFACE = 'bg-white dark:bg-gray-950';

/** Hairline divider. */
export const LAB_HAIRLINE = 'border-axal-hairline dark:border-gray-800';

/** A tool card in the arsenal that leads on the selected track. */
export const LAB_TOOL_LEAD =
  'rounded-axal-sm border p-2.5 bg-axal-lavender border-violet-200 ' +
  'dark:bg-violet-950/30 dark:border-violet-900';

/** A tool card that does not lead — present, not emphasised. */
export const LAB_TOOL =
  'rounded-axal-sm border p-2.5 bg-white border-axal-hairline ' +
  'dark:bg-gray-900 dark:border-gray-800';

/** The violet "Leads" tag. */
export const LAB_TAG_LEAD =
  'rounded-axal-pill px-1.5 py-px text-[9px] font-extrabold uppercase ' +
  'tracking-axal-label bg-axal-violet-deep text-white';

/** The amber "Soon" tag on an unavailable jurisdiction. */
export const LAB_TAG_SOON =
  'rounded-axal-pill px-1.5 py-px text-[9px] font-extrabold uppercase ' +
  'tracking-axal-label bg-amber-100 text-amber-800 ' +
  'dark:bg-amber-900/40 dark:text-amber-300';

/** A selected choice in a radiogroup (track, jurisdiction). */
export const LAB_CHOICE_ON =
  'rounded-axal-lg border-2 p-3.5 text-left transition-colors ' +
  'bg-axal-lavender border-axal-violet-deep ' +
  'dark:bg-violet-950/40 dark:border-violet-500';

/** An unselected, selectable choice. */
export const LAB_CHOICE =
  'rounded-axal-lg border-2 p-3.5 text-left transition-colors ' +
  'bg-white border-axal-hairline hover:border-violet-300 ' +
  'dark:bg-gray-900 dark:border-gray-800 dark:hover:border-violet-800';

/** A choice that cannot be picked yet. Not disabled-looking — just quiet. */
export const LAB_CHOICE_SOON =
  'rounded-axal-lg border-2 p-3.5 text-left cursor-not-allowed ' +
  'bg-axal-ground border-axal-hairline ' +
  'dark:bg-gray-900/50 dark:border-gray-800';

/** Primary button on a light ground. */
export const LAB_BTN =
  'inline-flex h-10 items-center gap-2 rounded-axal-sm px-4 text-[13px] ' +
  'font-bold bg-axal-violet-deep text-white hover:bg-axal-violet transition-colors';

/**
 * Primary button on the dark hero — white on the panel in BOTH themes, so no
 * `dark:` variant applies. `text-gray-900` rather than the panel hex: an
 * arbitrary-value colour class here would be a second place a colour lives,
 * and the point of LAB_PANEL_HEX below is that there is exactly one.
 */
export const LAB_BTN_ON_DARK =
  'inline-flex h-10 items-center gap-2 rounded-axal-sm px-4 text-[13px] ' +
  'font-bold bg-white text-gray-900 hover:bg-violet-50 transition-colors';

/** Secondary button on the dark hero. */
export const LAB_BTN_GHOST_ON_DARK =
  'inline-flex h-10 items-center gap-2 rounded-axal-sm px-4 text-[13px] ' +
  'font-bold border border-white/25 text-white hover:bg-white/10 transition-colors';

/**
 * THE ONE PLACE A RAW HEX LIVES.
 *
 * dark-mode-exempt — `#241f38` is the canvas's dark panel, and a panel that is
 * dark in BOTH themes needs no `dark:` counterpart by definition; giving it one
 * would make it lighter in dark mode than in light. Two surfaces already ship
 * exactly this treatment (`ApplyCtaSection` and `CongratulationsScreen` in
 * `frontend/src/pages/SpinoutLabPage.jsx`), so this is the house pattern, not
 * an escape hatch. `#241f38` is also the value the design system's own spec
 * carried for `axal-ink` before D2 chose the corpus majority `#18181b` for
 * text — it is a panel colour here, not an ink, which is why it is not that
 * token.
 */
export const LAB_PANEL_HEX = '#241f38';

/** Muted copy on the dark panel. */
export const LAB_ON_DARK_MUTED = 'text-white/70';

/** A figure on the dark panel — mono, so columns of dates line up. */
export const LAB_ON_DARK_FIGURE =
  'font-mono text-[13px] font-bold text-white tabular-nums';
