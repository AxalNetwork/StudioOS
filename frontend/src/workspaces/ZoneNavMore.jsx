import React, { useId, useState } from 'react';
import { LensNavLink } from './lens';

/**
 * D4828 (#4828, EX-04) — a section row whose last sections fold under one
 * "More ▾" button below 1024px. `ZoneNav` draws this for a bucket whose `row`
 * names `more` (Expertise: Thinking and Visibility), so a 390px phone shows
 * Overview, Profile, Services, Proof and More, each a 44px target, rather than
 * a row that runs past the screen's edge. From 1024px the folded sections are
 * pills like the rest (ZoneNav hides them below that width) and this button
 * is hidden.
 *
 * The panel is in the page's flow under the row, not a floating menu, so the
 * row's sideways scroll cannot clip it; the button names the folded section
 * that is current, so the row always says where you are.
 *
 *   items     the folded zones, each `{ slug, label, to }`
 *   active    the current zone's slug, or null
 *   rowClass  the row's own classes (ZoneNav's)
 *   children  the row's pills
 */
export default function ZoneNavMore({ label, items, active, accent, rowClass, className = '', scrollTestid, children }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const current = items.find((z) => z.slug === active) || null;
  return (
    <nav aria-label={label} data-testid="zone-nav-more" className={className}>
      <div className={rowClass} data-testid={scrollTestid}>
        {children}
        <button
          type="button"
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[#ececf1] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#615c6e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden dark:border-gray-700 dark:bg-transparent dark:text-gray-300"
          style={{ outlineColor: accent.ink, ...(current ? { fontWeight: 700, color: accent.deep, borderColor: accent.border, background: accent.tint } : {}) }}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          data-testid="link-zone-more"
        >
          {current ? <><span className="sr-only">More: </span>{current.label}</> : 'More'}
          <span aria-hidden="true">▾</span>
        </button>
      </div>
      {open ? (
        <ul id={panelId} className="m-0 mt-1.5 flex list-none flex-col rounded-lg border border-axal-hairline bg-white p-1 lg:hidden dark:border-gray-700 dark:bg-gray-900" data-testid="zone-nav-more-panel">
          {items.map((zone) => (
            <li key={zone.slug}>
              <LensNavLink
                to={zone.to}
                aria-current={zone.slug === active ? 'page' : undefined}
                onClick={() => setOpen(false)}
                data-testid={`link-zone-more-${zone.slug}`}
                className="flex min-h-[44px] items-center rounded-md px-3 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600 dark:text-gray-100 dark:hover:bg-gray-800"
              >
                {zone.label}
                {zone.slug === active ? <span className="ml-auto text-[10.5px] font-bold text-axal-muted dark:text-gray-400">Current</span> : null}
              </LensNavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}
