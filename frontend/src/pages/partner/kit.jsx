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
 *      `({label, hint, children})`. `advisor/network/kit.jsx` exports a READ-ONLY display pair
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

import { cloneElement, isValidElement, useId, useState } from 'react';
import { Card, Pill } from '../../ui';

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

/*
 * D395 — THE TWO HELPERS THE ZONES USE LIVE HERE NOW. They were re-exported
 * from `operations/kit.jsx`, which retired with `/partner/operations/*`; the
 * other five it offered (Badge, ProgressBar, BulletList, RowCard and
 * formatRelativeDay) had no caller outside the retired pages and went with
 * them. The bodies are unchanged.
 */

/** A calendar day, formatted against the real clock; an absent or bad date is a dash. */
export function formatDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Whole DOLLARS for quote and engagement prices (the needs pipeline stores
 * dollars). Not for new money columns — those are integer cents, through
 * `moneyCents`. See trap 3 above.
 */
export function moneyDollars(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}

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
      {/* #4845: grey that reads at 4.5:1 on the chip's ground (axal-faint was 2.3:1). */}
      <span className="whitespace-nowrap rounded border border-axal-hairline bg-axal-ground px-1.5 py-0.5 text-[12px] font-bold text-gray-600 dark:text-gray-400">
        {children || 'Not recorded'}
      </span>
      {why && <span className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{why}</span>}
    </span>
  );
}

/**
 * #4843 (D4843, Offers v2 spec "Not measured / Not recorded"): a figure the product does not
 * measure, as grey words and an ⓘ that discloses the reason on request. Never a zero, and never
 * a paragraph on the page: the reason is one keyboard-reachable press away. `label` defaults to
 * "Not measured"; "Not recorded" is for a value nobody entered.
 */
export function NotMeasured({ label = 'Not measured', why, testId }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex items-center gap-0.5 whitespace-nowrap" data-testid={testId}>
      <span className="text-[12px] text-axal-muted dark:text-gray-400">{label}</span>
      {why ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`Why this is ${label.toLowerCase()}`}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] text-axal-muted hover:text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700 dark:text-gray-400 dark:hover:text-gray-100 max-sm:h-11 max-sm:w-11"
          data-testid={testId ? `${testId}-why` : undefined}
        >
          <span aria-hidden="true">ⓘ</span>
        </button>
      ) : null}
      {why && open ? (
        <span id={id} role="note" className="absolute left-0 top-full z-10 mt-1 w-64 whitespace-normal rounded-lg border border-axal-hairline bg-white p-2 text-[12px] leading-snug text-axal-ink shadow-md dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          data-testid={testId ? `${testId}-reason` : undefined}>
          {why}
        </span>
      ) : null}
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
 * The boundary a partner account with no partner row hits, said ABOVE the zone.
 *
 * NOT AN ERROR AND NOT AN EMPTY STORE. `requirePartnerProfile` throws when a
 * signed-in partner has no `users.partner_id` and no `partners` row matching
 * their email, which `mapError` turns into a 400 — so without this the zone
 * shows "This did not load", which reads as a fault in the page. It is not: the
 * account simply is not linked to a firm, and in production that is currently
 * the majority of partner accounts. A reader deserves to be told which of the
 * two they are looking at.
 *
 * WHY IT IS A LINE AND NOT A CARD ANY MORE. It was a block that stood INSTEAD
 * of the zone, on twelve zones across Offers, Pipeline and Delivery. Three of
 * them were then reported as not matching their artboards — correctly observed
 * and wrongly diagnosed: every one of those artboard bodies is built, and a
 * card was drawn over it. `ensureRoleProfile` backfills `users.partner_id` for
 * `role = 'partner'` alone, so an admin reading this workspace — including
 * anyone checking whether a design shipped — hits this branch on every zone and
 * never once reaches a page.
 *
 * The zone renders underneath now, in its own empty state, which is also the
 * state that explains what the zone HOLDS. So the reader gets the boundary and
 * the orientation instead of the boundary twelve times. Same change, same
 * reasoning and the same week as `AdvisorPreviewNotice` on the other half of
 * the product.
 *
 * ACCESS IS UNTOUCHED. `requirePartnerProfile` is unchanged and every read
 * still 400s for an unattached account; this decides only what is drawn when it
 * does.
 */
export function NoPartnerProfile() {
  return (
    <div
      className="mb-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border border-dashed border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] leading-relaxed text-axal-muted"
      data-testid="no-partner-profile"
    >
      <span className="text-[12px] font-extrabold uppercase tracking-[.08em] text-gray-600 dark:text-gray-400">
        Not linked to a firm
      </span>
      <span>
        Everything in this workspace hangs off a firm record and this sign-in is not attached to
        one, so the zone below is showing you nobody’s. An admin can attach it under Advisors &amp;
        Partners → Firms.
      </span>
      {/* THE SENTENCE FOR THE OTHER READER, and for a long time the more common
          one. An admin previewing the Partner role resolves to no firm and never
          will, so "an admin can attach it" is useless to them — they ARE the
          admin, and attaching their own sign-in to somebody's firm is the one
          act with no subject and no audit trail. Impersonation is the way in. */}
      <span className="text-gray-600 dark:text-gray-400">
        Reading this as an admin? Impersonate one of a firm’s accounts — that names whose book is
        being read, and records it.
      </span>
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


/*
 * D4844 (#4844) — THE OFFERS INTERACTION SYSTEM: the type scale, the action
 * hierarchy, the field and the status chip every Offers zone draws, after the
 * Offers v2 canvas's OF-10 rules ("Body text 14px, secondary 13px, metadata
 * never below 12px"; "Each screen has one amber primary action"; "Visible
 * label, field-level error tied with aria-describedby"; "Always icon + word").
 *
 * They live here, beside the amber pair above, rather than in the advisor kit
 * the zones also read: the advisor's `ZoneHeading`, `NothingYet` and `Field`
 * serve every Expertise zone and every Pipeline and Delivery zone too, and
 * this issue is the Offers pass. A zone opts in by importing these names.
 */
const OFFER_FOCUS = ' focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700';

/** A text box, select or textarea at body size (14px), 44px tall on a phone. */
export const offerInputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[14px] text-axal-ink '
  + 'focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 '
  + 'aria-[invalid=true]:border-red-600 max-sm:min-h-[44px] '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:aria-[invalid=true]:border-red-400';

/**
 * The zone's ONE filled primary: amber, 13px, a 48px target below 640px
 * (#4845: OF-10 "primary actions 48px on phones"; every other action is 44px).
 */
export const offerButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-700 px-3.5 py-2 text-[13px] font-semibold text-white '
  + 'hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[48px]' + OFFER_FOCUS;

/** Every other action: outlined, never filled (Export, Cancel, View, Edit). */
export const offerGhostButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3.5 py-2 text-[13px] font-semibold text-axal-ink '
  + 'hover:bg-axal-ground disabled:opacity-50 max-sm:min-h-[44px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800' + OFFER_FOCUS;

/** A destructive action: outlined red, and always placed away from Save. */
export const offerDangerButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-red-700 '
  + 'hover:bg-red-50 disabled:opacity-50 max-sm:min-h-[44px] dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30' + OFFER_FOCUS;

/** A zone's section heading: 18px, with its explanation at body size (14px). */
export function OfferHeading({ title, blurb, action }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3" data-offer-heading="">
      <div className="max-w-2xl">
        <h2 className="text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{title}</h2>
        {blurb && <p className="mt-1 text-[14px] leading-relaxed text-gray-600 dark:text-gray-300">{blurb}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * An empty store the page read: the commercial outcome as an 18px heading,
 * why it matters at body size, and exactly ONE action (OF03b, OF06b).
 */
export function OfferEmpty({ title, body, action, testId = 'offer-empty' }) {
  return (
    <Card variant="dashed" padding="lg" data-testid={testId}>
      <h2 className="text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{title}</h2>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-gray-600 dark:text-gray-300">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

/**
 * One form field: a visible `<label>` at 13px wrapping its control, the help
 * text and the field's own error tied to the control by `aria-describedby`,
 * and `aria-invalid` while the error stands. The error leads with a cross, so
 * it is not told by its colour alone. Help and error sit outside the label so
 * the control's name stays the label's words.
 */
export function OfferField({ label, hint, error, optional = false, children }) {
  const hintId = useId();
  const errorId = useId();
  const control = isValidElement(children)
    ? cloneElement(children, {
      'aria-describedby': [children.props['aria-describedby'], hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined,
      'aria-invalid': error ? 'true' : children.props['aria-invalid'],
    })
    : children;
  return (
    <div className="block" data-offer-field="">
      <label className="block">
        <span className="block text-[13px] font-semibold text-axal-ink dark:text-gray-100">
          {label}
          {optional ? <span className="font-normal text-gray-600 dark:text-gray-400"> · optional</span> : null}
        </span>
        {control}
      </label>
      {hint ? <span id={hintId} className="mt-1 block text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{hint}</span> : null}
      {error ? (
        <span id={errorId} className="mt-1 flex items-start gap-1 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-field-error="">
          <span aria-hidden="true">✕</span>{error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * OF-10's status chip: an icon AND a word, so a greyscale screen still says
 * which state it is. Green only for live or complete, amber for pending or
 * action required, red for rejected or withdrawn, neutral otherwise.
 */
export const OFFER_STATUS = Object.freeze({
  Live: { tone: 'ok', icon: '✓' },
  Complete: { tone: 'ok', icon: '✓' },
  Draft: { tone: 'neutral', icon: '◌' },
  Unlisted: { tone: 'neutral', icon: '‖' },
  Paused: { tone: 'neutral', icon: '‖' },
  'HQ review': { tone: 'warn', icon: '…' },
  'In review': { tone: 'warn', icon: '…' },
  Recruiting: { tone: 'warn', icon: '…' },
  Testing: { tone: 'warn', icon: '…' },
  Rejected: { tone: 'danger', icon: '✕' },
});

export function OfferStatus({ state, children, testId }) {
  const s = OFFER_STATUS[state] || { tone: 'neutral', icon: '○' };
  return (
    <Pill tone={s.tone} className="text-[12px]" data-testid={testId || 'offer-status'}>
      <span aria-hidden="true" data-status-icon="">{s.icon}</span>{children || state}
    </Pill>
  );
}
