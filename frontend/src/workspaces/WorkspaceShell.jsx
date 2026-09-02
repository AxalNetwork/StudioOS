import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import ZoneNav from './ZoneNav';
import { bucketForPath, zoneForPath } from './shellConfig';

/**
 * The chrome every workspace subpage sits in — one component, four shells.
 *
 * WHY ONE. Before this, the same header was built four ways:
 * FounderWorkspaceTabs, PartnerWorkspaceTabs, the generic WorkspaceTabs, and
 * three bespoke investor workspaces that each drew their own. They disagreed
 * about spacing, about whether the archetype was a badge or body text, and —
 * more consequentially — about whose tab bar an investor sees on a founder
 * route. Composing the chrome from the shell config means the role decides,
 * once, and a page cannot accidentally render another license's navigation.
 *
 * WHAT IT RENDERS, top to bottom, matching the canvases:
 *   · a crumb (bucket ‹ zone)
 *   · the page title, with the zone's ARCHETYPE badge beside it — the badge
 *     belongs here, next to the thing it describes, not in the nav row
 *   · the zone pill row, which navigates to real routes (see ZoneNav)
 *   · the page's own content
 *   · the Worker AI rail, right — passed in as `rail`, because what it reports
 *     is the PAGE's coverage and only the page knows it
 *
 * THE RAIL USED TO COME FROM AssistLayout, and rendered nothing at all. That
 * wrapper keys a surface to an aiRouter task class through `ASSIST_SURFACES`;
 * this shell passed `validate`, `research`, `network`, `deals`, `practice`,
 * `offers` and the rest, and `eadwynConfig` registers none of them. An unknown
 * surface returns null and AssistLayout renders `<>{children}</>` — so every
 * workspace subpage in the product had an AI rail in its source and a blank
 * space on screen, silently, which is the "it looks blank, probably not
 * connected to anything" report. Registering the keys was not the fix: the
 * task class decides the model and price the rail reports, and none of these
 * surfaces runs one. So the shell takes the rail as a slot instead, and the
 * pages that have something true to show pass `ui/FounderWorkerRail`.
 *
 * SCOPE LINE. `scope` is where a page states whose data it is showing — one
 * company, one client, one fund. It is deliberately a required-feeling prop
 * rather than an optional flourish: no page in this product may show more than
 * one company's data, and a header that always has room to say which one makes
 * that rule visible rather than assumed.
 */
export default function WorkspaceShell({
  role = 'founder',
  title,
  scope,
  scopeHref,
  intro,
  actions,
  rail = null,
  children,
}) {
  const location = useLocation();
  const bucket = bucketForPath(role, location.pathname);
  const zone = zoneForPath(bucket, location.pathname);
  // No accent is read here on purpose. In the canvases the shell chrome —
  // crumb, title, divider — is neutral in all four roles; the accent lives on
  // the zone pills (ZoneNav) and the AI rail, which is where a reader looks to
  // tell one licence from another. An earlier draft computed one here and
  // never used it, which CodeQL caught.
  const arch = zone?.archetype;

  return (
    // `min-w-0 flex-1` on the content, a fixed column on the rail: the content
    // shrinks first. Without `min-w-0` a wide table refuses to shrink below its
    // intrinsic width and shoves the rail off-screen. `hidden xl:flex`: below
    // 1280px there is no room for a rail beside a working page, and stacking a
    // meter above the tool puts the least important thing first.
    <div className={rail ? 'flex items-start gap-6' : ''}>
      <div className="min-w-0 flex-1">
        {bucket && (
          <div className="mb-2 flex items-center gap-2 text-[11.5px] text-axal-ink-3">
            <Link to={`${bucket.prefix}/${bucket.zones[0].slug}`} className="hover:underline">
              {bucket.label}
            </Link>
            <span aria-hidden="true">‹</span>
            <b className="font-bold text-axal-ink">{zone?.label}</b>
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h1 className="m-0 text-xl font-extrabold tracking-tight">
              {title || zone?.label}
            </h1>
            {arch && (
              <span
                className="rounded-[3px] border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[.07em]"
                style={{ background: arch.colors[0], color: arch.colors[1], borderColor: arch.colors[2] }}
              >
                {arch.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {scope && (
              scopeHref ? (
                <Link
                  to={scopeHref}
                  className="inline-flex items-center gap-1.5 rounded-md border border-axal-border bg-white px-2.5 py-1.5 text-[11px] font-bold text-axal-ink-2 hover:border-axal-ink-3"
                >
                  {scope}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-axal-border bg-white px-2.5 py-1.5 text-[11px] font-bold text-axal-ink-2">
                  {scope}
                </span>
              )
            )}
          </div>
        </div>

        {intro && <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-axal-ink-2">{intro}</p>}

        {bucket && <ZoneNav bucket={bucket} role={role} className="mt-3" />}

        <div
          className="mt-3.5 border-t pt-3.5"
          style={{ borderColor: '#ececf1' }}
        >
          {children}
        </div>
      </div>
      {rail && <div className="hidden w-[280px] shrink-0 xl:block sticky top-20">{rail}</div>}
    </div>
  );
}

/**
 * The honest-empty primitive the canvases use everywhere: a fact nobody has
 * recorded renders as this, never as a zero, a placeholder, or a plausible
 * guess. It exists as a component so "Not recorded" reads identically on every
 * surface and so a reviewer can grep for the ones that are missing it.
 */
export function NotRecorded({ children }) {
  return (
    <span className="inline-flex whitespace-nowrap rounded border border-axal-border bg-axal-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-axal-ink-3">
      {children || 'Not recorded'}
    </span>
  );
}

/**
 * The seam chip. Cyan marks an object that came from the founder — their own
 * record, or the Lab — and is read-only to whoever is looking at it. It is the
 * one hue reserved system-wide, so it never doubles as a product accent and
 * never marks anything else, including a cross-page read.
 */
export function SeamChip({ children }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-1.5 py-0.5 text-[9.5px] font-bold"
      style={{ color: '#0e7490', background: '#f0fdff', borderColor: '#a5edf5' }}
    >
      {children || 'From the founder'}
    </span>
  );
}
