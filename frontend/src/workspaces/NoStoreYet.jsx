import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../ui';

/**
 * The honest state for a zone with no store behind it. It names what the zone
 * would hold, what would fill it, and — where one exists — the live surface
 * that answers the nearest question today.
 *
 * ONE COPY, NOT THREE. `PartnerBucketRoutes`, `AdvisorBucketRoutes` and
 * `ResearchWorkspace` each carried their own, identical but for the link colour
 * and for whether the prop was `link` or `links`. This takes both shapes so no
 * caller had to change, and `BucketBoard` renders it inside a gapped section —
 * which is the reason it had to become shared rather than a fourth copy.
 *
 * TWO THINGS THE COPIES GOT WRONG, FIXED HERE.
 *
 * `Card` has had a `dashed` variant since it was written — its own docblock
 * assigns it to "an add/attach affordance, or a NOT-YET-FILLED SLOT", which is
 * this component exactly. All three copies instead passed `variant` implicitly
 * as `plain` and appended `border-dashed` by hand, so they rendered a white
 * card with a dashed border rather than the transparent one the variant draws.
 *
 * And every copy asked for a tint with `bg-axal-surface-2` and muted text with
 * `text-axal-ink-2` / `-ink-3`. Those three tokens are declared in no `@theme`
 * block — `frontend/src/index.css` declares `axal-ink`, `-ground`, `-hairline`,
 * `-faint`, `-muted`, the violets, the lavender and the ambers, and nothing
 * else — so all three emitted no CSS at all. The tint was never on screen and
 * the "muted" paragraphs were rendering at full ink. Replaced with the greys
 * `workspaces/ZoneActions.jsx` settled on for the same reason, dark counterpart
 * included.
 */
/**
 * `eyebrow` DEFAULTS TO THE SENTENCE THIS COMPONENT WAS NAMED FOR, and exists
 * because that sentence is not always the true one. Every caller until now
 * rendered this INSTEAD of a body, so "No store behind this yet" described the
 * whole zone and was right. `RESEARCH_STORE_GAPS` renders it ABOVE a live body,
 * where the zone does read a store and a named capability inside it does not —
 * and the default sentence over `/research/markets`, whose signals feed is the
 * largest store in the product, would be plainly false.
 *
 * The prop is an override rather than a new component because the anatomy is
 * identical: a label, what the thing would hold, why it does not, and where to
 * go instead. Only the first line changes.
 */
export default function NoStoreYet({
  eyebrow = 'No store behind this yet',
  heading,
  what,
  why,
  link,
  links = [],
  accentClass = 'text-axal-violet',
}) {
  const all = link ? [link, ...links] : links;
  return (
    <Card variant="dashed" padding="lg">
      <div className="max-w-2xl">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-300">
          {eyebrow}
        </div>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{heading}</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">{what}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">{why}</p>
        {all.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-3 text-[12px]">
            {all.map((l) => (
              <Link key={l.to} to={l.to} className={`${accentClass} underline`}>{l.label}</Link>
            ))}
          </p>
        )}
      </div>
    </Card>
  );
}
