import React from 'react';
import { useLocation } from 'react-router-dom';
import { ACCENT, zonePath as shellZonePath, zoneForPath } from './shellConfig';
import { LensNavLink } from './lens';
import { projectSearch } from '../pages/cycles/founderToolNavigation';

/** A zone's route; the Overview item of an opt-in `row` (#4834) is the bucket root. */
const zonePath = (bucket, zone) => (zone.to || (zone.root ? bucket.prefix : shellZonePath(bucket, zone)));

/**
 * The zone row — the pill strip under a workspace heading.
 *
 * THE BUG THIS EXISTS TO NOT REPEAT. Every one of the eighteen design canvases
 * drew this row, and in all of them it was inert: the pills were built with
 * `href:'#' + id`, so clicking one jumped the page to an anchor that did not
 * exist rather than opening the subpage it named. The canvases were fixed to
 * carry real routes; this is the component that makes that true in the app.
 * Each pill is a NavLink to `/prefix/slug`, so it navigates, it is a real
 * link a person can middle-click or copy, and the active state comes from the
 * URL rather than from local component state that a refresh would lose.
 *
 * ON A PHONE THE PILLS SWITCH LENSES (D575, canvas M2). Below 1024px a plain
 * tap opens the zone in place, with no route change and no history entry; see
 * `lens.jsx`. The pill stays a real link to the zone's route, so a deep link,
 * a long-press "Copy link" and a desktop click all still mean that route. The
 * active pill reads the lens, because inside `<Routes>` the location IS the
 * lens.
 *
 * ACCENT comes from the role, not from the page. Founder violet, Investor
 * indigo, Advisor emerald, Partner amber — one row, four tints, no per-page
 * colour decisions and no cyan: that hue is the seam and is never a product
 * accent.
 *
 * ARCHETYPE BADGES are not rendered here. A zone's archetype describes the
 * page it opens, so it belongs in that page's header beside its own title —
 * putting six of them in a nav row would say six things about a page the
 * reader has not opened yet.
 *
 * `activeSlug={null}` IS THE OVERVIEW MODE, and it exists because
 * `zoneForPath` defaults to the FIRST zone for any path it cannot resolve —
 * which is right for `WorkspaceShell` (a zone route always has a zone) and
 * wrong on a bucket ROOT, where it would light "LPs" while the reader is
 * looking at the Fund overview. On a root, no pill is current: the overview is
 * above the zones, not one of them.
 */
/**
 * #4834 (D4834): `row` is the Practice v2 section row (PX-10), opt-in per
 * bucket so no other workspace changes. `row.overview` puts the bucket root
 * first under that label, current on the root; `row.order` is the canvas's
 * slug order; `row.scroll` keeps the row on one line that scrolls sideways
 * below 1024px instead of wrapping, with 44px targets there.
 *
 * D4817 part 1 (#5311): `row.extra` adds items that are routes of the bucket
 * without being zones of it (`{ slug, label, to }`), placed by `row.order`.
 * Portfolio's local navigation names Performance beside its three zones, and
 * Performance is not a sidebar zone; nothing else passes it.
 */
export default function ZoneNav({ bucket, role = 'founder', activeSlug, className = '', row = null }) {
  const location = useLocation();
  if (!bucket || !bucket.zones?.length) return null;

  const accent = ACCENT[role] || ACCENT.founder;
  const zones = row?.extra?.length ? [...bucket.zones, ...row.extra] : bucket.zones;
  const active = activeSlug === undefined
    ? zoneForPath(bucket, location.pathname)
    : (activeSlug === null ? null : zones.find((z) => z.slug === activeSlug) || null);
  const ordered = row?.order
    ? [...zones].sort((a, b) => row.order.indexOf(a.slug) - row.order.indexOf(b.slug))
    : zones;
  const items = row?.overview
    ? [{ slug: 'overview', label: row.overview, root: true }, ...ordered]
    : ordered;
  const scroll = Boolean(row?.scroll);

  const zonePill = (zone) => (
    <Pill
      key={zone.slug}
      to={`${zonePath(bucket, zone)}${projectSearch(location.search)}`}
      on={zone.slug === active?.slug}
      testid={`link-zone-${zone.slug}`}
      accent={accent}
    >
      {zone.label}
    </Pill>
  );

  // D4841 (#4841): a bucket that declares `groups` (Offers: Sell · Prove ·
  // Target · Test, canvas OF-01) draws the same pills on the same one row, each
  // under its group's label, with an Overview pill first. Same links, same
  // routes, no second level. Every other bucket declares none and renders the
  // flat row below, unchanged.
  const bySlug = new Map(bucket.zones.map((z) => [z.slug, z]));
  const groups = (bucket.groups || [])
    .map((g) => ({ ...g, zones: (g.zones || []).map((s) => bySlug.get(s)).filter(Boolean) }))
    .filter((g) => g.zones.length);
  if (groups.length) {
    const grouped = new Set(groups.flatMap((g) => g.zones.map((z) => z.slug)));
    const rest = bucket.zones.filter((z) => !grouped.has(z.slug));
    return (
      <nav
        aria-label={`${bucket.label} sections`}
        className={`flex flex-wrap items-end gap-x-4 gap-y-2 ${className}`}
        data-testid="zone-nav-grouped"
      >
        <Pill to={`${bucket.prefix}${projectSearch(location.search)}`} end on={activeSlug === null} testid="link-zone-overview" accent={accent}>
          Overview
        </Pill>
        {groups.map((g) => (
          <div key={g.key || g.label} role="group" aria-label={g.label} className="flex flex-col gap-1">
            <span aria-hidden="true" className="pl-1 text-[10px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">
              {g.label}
            </span>
            <div className="flex flex-wrap gap-1.5">{g.zones.map(zonePill)}</div>
          </div>
        ))}
        {rest.map(zonePill)}
      </nav>
    );
  }

  return (
    <nav
      aria-label={`${bucket.label} sections`}
      data-testid={scroll ? 'zone-nav-scroll' : undefined}
      className={`flex gap-1.5 ${scroll ? 'flex-nowrap overflow-x-auto pb-1 [scrollbar-width:thin] lg:flex-wrap lg:overflow-visible lg:pb-0' : 'flex-wrap'} ${className}`}
    >
      {items.map((zone) => {
        const on = zone.root ? active === null : zone.slug === active?.slug;
        return (
          <LensNavLink
            key={zone.slug}
            to={`${zonePath(bucket, zone)}${projectSearch(location.search)}`}
            // D4817 part 3: the root item matches its own address only. Without
            // `end`, NavLink also matched it under every route of the bucket and
            // set aria-current="page" on Overview beside the current item.
            end={Boolean(zone.root)}
            aria-current={on ? 'page' : undefined}
            data-testid={`link-zone-${zone.slug}`}
            // HOVER AND FOCUS (D403). The colours used to be inline `color` /
            // `background` / `borderColor`, and an inline style beats every
            // `hover:` class, so an idle pill never answered the pointer. They
            // are CSS variables now, painted by the classes: an idle pill takes
            // the role's border and ink on hover, and keyboard focus draws the
            // role's outline. The current pill is already accented and does not
            // change on hover. In dark mode an idle pill takes neutral greys (it was
            // painted white there, since no dark skin reads an inline style).
            // D593: the current pill takes the role's dark pair — `tintDark`
            // ground, `deepDark` ink — where it used to keep its light tint, a
            // pale lozenge on the dark ground that the canvases never drew.
            className={`inline-flex ${scroll ? 'min-h-[44px] shrink-0 whitespace-nowrap lg:min-h-0 ' : ''}items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-colors text-[color:var(--zn-ink)] bg-[var(--zn-bg)] border-[color:var(--zn-line)] hover:text-[color:var(--zn-hover-ink)] hover:border-[color:var(--zn-hover-line)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:text-[color:var(--zn-hover-ink)] focus-visible:border-[color:var(--zn-hover-line)]${on ? ' dark:bg-[var(--zn-bg-dark)] dark:text-[color:var(--zn-ink-dark)] dark:border-[color:var(--zn-line-dark)]' : ' dark:bg-transparent dark:text-gray-300 dark:border-gray-700 dark:hover:text-gray-100 dark:hover:border-gray-500'}`}
            style={{
              fontWeight: on ? 700 : 600,
              '--zn-ink': on ? accent.deep : '#615c6e',
              '--zn-bg': on ? accent.tint : '#fff',
              '--zn-line': on ? accent.border : '#ececf1',
              '--zn-hover-ink': accent.deep,
              '--zn-hover-line': on ? accent.border : accent.ink,
              ...(on ? {
                '--zn-ink-dark': accent.deepDark,
                '--zn-bg-dark': accent.tintDark,
                '--zn-line-dark': `color-mix(in srgb, ${accent.deepDark} 40%, transparent)`,
              } : {}),
              outlineColor: accent.ink,
            }}
          >
            {zone.label}
          </LensNavLink>
        );
      })}
    </nav>
  );
}

/** One pill: a real link to its route, painted through CSS variables (D403). */
function Pill({ to, end, on, testid, accent, children }) {
  // `end` on the Overview pill: a NavLink to the bucket root would otherwise
  // match every zone under it and mark itself current there too.
  return (
    <LensNavLink
      to={to}
      end={end}
      aria-current={on ? 'page' : undefined}
      data-testid={testid}
      // HOVER AND FOCUS (D403). The colours used to be inline `color` /
      // `background` / `borderColor`, and an inline style beats every
      // `hover:` class, so an idle pill never answered the pointer. They
      // are CSS variables now, painted by the classes: an idle pill takes
      // the role's border and ink on hover, and keyboard focus draws the
      // role's outline. The current pill is already accented and does not
      // change on hover. In dark mode an idle pill takes neutral greys (it was
      // painted white there, since no dark skin reads an inline style).
      // D593: the current pill takes the role's dark pair — `tintDark`
      // ground, `deepDark` ink — where it used to keep its light tint, a
      // pale lozenge on the dark ground that the canvases never drew.
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-colors text-[color:var(--zn-ink)] bg-[var(--zn-bg)] border-[color:var(--zn-line)] hover:text-[color:var(--zn-hover-ink)] hover:border-[color:var(--zn-hover-line)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:text-[color:var(--zn-hover-ink)] focus-visible:border-[color:var(--zn-hover-line)]${on ? ' dark:bg-[var(--zn-bg-dark)] dark:text-[color:var(--zn-ink-dark)] dark:border-[color:var(--zn-line-dark)]' : ' dark:bg-transparent dark:text-gray-300 dark:border-gray-700 dark:hover:text-gray-100 dark:hover:border-gray-500'}`}
      style={{
        fontWeight: on ? 700 : 600,
        '--zn-ink': on ? accent.deep : '#615c6e',
        '--zn-bg': on ? accent.tint : '#fff',
        '--zn-line': on ? accent.border : '#ececf1',
        '--zn-hover-ink': accent.deep,
        '--zn-hover-line': on ? accent.border : accent.ink,
        ...(on ? {
          '--zn-ink-dark': accent.deepDark,
          '--zn-bg-dark': accent.tintDark,
          '--zn-line-dark': `color-mix(in srgb, ${accent.deepDark} 40%, transparent)`,
        } : {}),
        outlineColor: accent.ink,
      }}
    >
      {children}
    </LensNavLink>
  );
}
