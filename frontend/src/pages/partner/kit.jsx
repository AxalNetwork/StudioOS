/**
 * The one import surface for every partner workspace zone.
 *
 * WHY THIS FILE EXISTS. The partner zones build on primitives that live in the
 * advisor tree, and three of those primitives are booby-trapped for a partner
 * caller — not through anyone's carelessness, but because they were written for
 * one licence and are now reached by two. Each trap is silent: none produces a
 * build error, and two produce a wrong number rather than a broken page.
 *
 *   1. `Field` IS EXPORTED TWICE, MEANING DIFFERENT THINGS.
 *      `advisor/expertise/kit.jsx` exports a FORM INPUT wrapper
 *      `({label, hint, children})`. `advisor/network/kit.jsx` — re-exported by
 *      `partner/operations/kit.jsx` — exports a READ-ONLY display pair
 *      `({label, children})` that renders an italic em-dash when empty. A zone
 *      importing from both gets whichever the bundler resolved last, and the
 *      wrong one still renders. Here they are `Field` and `ReadField`.
 *
 *   2. `inputClass` AND `buttonClass` ARE EMERALD, hard-coded — the advisor
 *      accent from `shellConfig.js`. Partner is amber (`ink #b45309`,
 *      `deep #92400e`). The amber pair below is the partner's; the advisor
 *      originals are not re-exported from this file at all, so a partner zone
 *      cannot reach them by habit.
 *
 *   3. `money` TAKES CENTS AND `moneyUsd` TAKES DOLLARS. Migrations 208 and 209
 *      store `amount_cents` and `floor_cents`; `engagements.price` beside them
 *      is grandfathered REAL dollars. Picking the wrong helper is a silent 100×
 *      error on a money figure — the kind that looks plausible on screen. So
 *      neither original name survives: they are `moneyCents` and `moneyDollars`,
 *      and `frontend/test/partner_zone_bodies.test.mjs` fails any partner file
 *      that imports `money` or `moneyUsd` by name.
 *
 * Everything else is a straight re-export, so a zone has one import line and
 * the shared four-state handling stays shared.
 */
export {
  // The four states, in one place, with error beating empty. See its own
  // docblock — the ordering is the whole point.
  ZoneBody,
  // A store genuinely read and empty, as against one that could not be read.
  NothingYet,
  // What a zone cannot answer, said on the zone rather than left as a blank.
  StatedLimit,
  // Section headings INSIDE a zone. Never a page title: the shell owns the
  // single <h1>, and this emits an <h2>.
  ZoneHeading,
  // Absent renders as absent — never a zero, never an em-dash pretending to be
  // one.
  Unrecorded,
  // Typed dollars to integer cents, or an error a person can act on.
  dollarsToCents,
  // Saved / failed, said once, above the thing that was saved.
  SaveNote,
  Pill,
  // Accent-free, so it is the advisor's and the partner's alike.
  ghostButtonClass,
} from '../advisor/expertise/kit';

export { money as moneyCents } from '../advisor/expertise/kit';
export { Field } from '../advisor/expertise/kit';

export {
  Chip,
  Section,
  StatCard,
  SearchInput,
  FilterChips,
  SlideOver,
  EmptyState,
  Field as ReadField,
} from '../advisor/network/kit';

export {
  Badge,
  ProgressBar,
  BulletList,
  RowCard,
  formatDay,
  formatRelativeDay,
  moneyUsd as moneyDollars,
} from './operations/kit';

/**
 * The partner accent, as Tailwind literals.
 *
 * Written out rather than composed from `ACCENT.partner`'s hex, because
 * Tailwind scans source for class names and a string built at runtime is a
 * class that never ships. The hexes these track are `#b45309` / `#92400e`,
 * which `amber-700` / `amber-800` match, and which `ZoneNav` and the rail are
 * already drawing beside these forms.
 */
export const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] '
  + 'focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 '
  + 'dark:border-gray-700 dark:bg-gray-900';

export const buttonClass =
  'rounded-lg bg-amber-700 px-3 py-1.5 text-[12px] font-semibold text-white '
  + 'hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * A figure the platform could have but cannot state honestly yet, with the
 * reason beside it.
 *
 * DISTINCT FROM `Unrecorded`, and the canvases draw the two differently on
 * purpose. `Unrecorded` is a value nobody entered. This is a value nobody can
 * COMPUTE — a median over four opens, a firm-wide satisfaction average where
 * one engagement has no score, a utilisation with no hours sold. The canvases
 * render the first as an em-dash and the second as a chip carrying its reason,
 * because "you have not filled this in" and "we will not average four opinions
 * into a fact" are different sentences to be told.
 */
export function NotComputable({ children, why }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="whitespace-nowrap rounded border border-axal-border bg-axal-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-axal-ink-3">
        {children || 'Not recorded'}
      </span>
      {why && <span className="text-[11px] leading-relaxed text-axal-ink-3">{why}</span>}
    </span>
  );
}

/**
 * A figure this page READ from another page rather than recomputing.
 *
 * The Delivery · Health canvas is explicit about why this mark exists: its
 * utilisation column is "a read of the retainer record on Pipeline · Retainers
 * — the same number, not a second one computed from a different source",
 * because "two pages disagreeing about the same client's utilisation is worse
 * than either number". The chip is how a reader can tell which page owns it.
 */
export function SeamRead({ children }) {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[9.5px] font-bold text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-300">
      Read · {children}
    </span>
  );
}

/**
 * The boundary a partner account with no partner row hits.
 *
 * NOT AN ERROR AND NOT AN EMPTY STORE. `requirePartnerProfile` throws when a
 * signed-in partner has no `users.partner_id` and no `partners` row matching
 * their email, which `mapError` turns into a 400 — so without this the zone
 * shows "This did not load", which reads as a fault in the page. It is not: the
 * account simply is not linked to a firm, and in production that is currently
 * the majority of partner accounts. A reader deserves to be told which of the
 * two they are looking at.
 */
export function NoPartnerProfile() {
  return (
    <div className="rounded-xl border border-dashed border-axal-border p-5">
      <h3 className="text-sm font-extrabold tracking-tight">
        This account is not linked to a firm yet
      </h3>
      <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-ink-2">
        Everything in the partner workspace hangs off a firm record, and this
        sign-in is not attached to one. That is an account link rather than
        anything you have or have not done here — nothing is missing from your
        data, because there is no firm for it to be missing from yet.
      </p>
      <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-ink-2">
        An admin can attach it. Until then every zone in this workspace will say
        the same thing.
      </p>
    </div>
  );
}

/**
 * Does this error mean "no firm attached" rather than "the read failed"?
 *
 * Matched on the sentence the worker sends, because `mapError` flattens every
 * non-auth throw to a 400 with the message as `detail` — there is no code to
 * switch on. Narrow on purpose: anything else is a real failure and must keep
 * rendering as one.
 */
export function isNoPartnerProfile(error) {
  return /no partner profile/i.test(String(error || ''));
}
