import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ACCENT, zonePath, zoneForPath } from './shellConfig';

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
export default function ZoneNav({ bucket, role = 'founder', activeSlug, className = '' }) {
  const location = useLocation();
  if (!bucket || !bucket.zones?.length) return null;

  const accent = ACCENT[role] || ACCENT.founder;
  const active = activeSlug === undefined
    ? zoneForPath(bucket, location.pathname)
    : (activeSlug === null ? null : bucket.zones.find((z) => z.slug === activeSlug) || null);

  return (
    <nav
      aria-label={`${bucket.label} sections`}
      className={`flex flex-wrap gap-1.5 ${className}`}
    >
      {bucket.zones.map((zone) => {
        const on = zone.slug === active?.slug;
        return (
          <NavLink
            key={zone.slug}
            to={zonePath(bucket, zone)}
            aria-current={on ? 'page' : undefined}
            data-testid={`link-zone-${zone.slug}`}
            // HOVER AND FOCUS (D403). The colours used to be inline `color` /
            // `background` / `borderColor`, and an inline style beats every
            // `hover:` class, so an idle pill never answered the pointer. They
            // are CSS variables now, painted by the classes: an idle pill takes
            // the role's border and ink on hover, and keyboard focus draws the
            // role's outline. The current pill is already accented and does not
            // change on hover. In dark mode an idle pill takes neutral greys (it was
            // painted white there, since no dark skin reads an inline style); the
            // current pill keeps its accent tint.
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-colors text-[color:var(--zn-ink)] bg-[var(--zn-bg)] border-[color:var(--zn-line)] hover:text-[color:var(--zn-hover-ink)] hover:border-[color:var(--zn-hover-line)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:text-[color:var(--zn-hover-ink)] focus-visible:border-[color:var(--zn-hover-line)]${on ? '' : ' dark:bg-transparent dark:text-gray-300 dark:border-gray-700 dark:hover:text-gray-100 dark:hover:border-gray-500'}`}
            style={{
              fontWeight: on ? 700 : 600,
              '--zn-ink': on ? accent.deep : '#615c6e',
              '--zn-bg': on ? accent.tint : '#fff',
              '--zn-line': on ? accent.border : '#ececf1',
              '--zn-hover-ink': accent.deep,
              '--zn-hover-line': on ? accent.border : accent.ink,
              outlineColor: accent.ink,
            }}
          >
            {zone.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
