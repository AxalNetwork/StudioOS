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
 */
export default function ZoneNav({ bucket, role = 'founder', className = '' }) {
  const location = useLocation();
  if (!bucket || !bucket.zones?.length) return null;

  const accent = ACCENT[role] || ACCENT.founder;
  const active = zoneForPath(bucket, location.pathname);

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
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              fontWeight: on ? 700 : 600,
              color: on ? accent.deep : '#615c6e',
              background: on ? accent.tint : '#fff',
              borderColor: on ? accent.border : '#ececf1',
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
