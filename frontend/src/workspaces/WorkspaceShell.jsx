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
 * pages that have something true to show pass `ui/WorkerRail`.
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
  activeSlug,
  children,
}) {
  const location = useLocation();
  const bucket = bucketForPath(role, location.pathname);
  // `activeSlug === null` is the overview mode: a bucket root is above its
  // zones, so no zone is current — not in the pill row, and not in the crumb
  // or title either. `zoneForPath` defaults to the first zone, which is right
  // on a zone route and wrong here.
  const zone = activeSlug === null ? null : zoneForPath(bucket, location.pathname);
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
    //
    // NO `gap` WHEN THE RAIL IS A PANEL. The rail draws its own left border and
    // its own inner padding (see below), so a gap would put a stripe of page
    // ground between the body and a border that is meant to be the seam
    // between them. The canvases have the two columns meeting exactly.
    <div className={rail ? 'flex items-stretch' : ''}>
      {/*
        THE SHELL OWNS ITS OWN PADDING, and this is the whole of the "one
        padding rule". Every one of the twenty-nine canvases specifies the same
        frame — `.main { flex:1; min-width:0; padding:20-24px }` beside a
        `.rail` with its own `padding:17-18px` — and until now no part of this
        component set either. Padding came from `App.jsx`'s page container
        instead, which gives it per ROLE rather than per component, and the
        four roles disagreed:

          · founder and investor workspace routes are full-bleed (`p-0`), so
            `/validate/interviews` and `/deals/pipeline` rendered plain cards
            flush against the viewport with zero padding on either side;
          · advisor routes were padded and full width;
          · partner routes were padded AND centred at `max-w-7xl` — the only
            profile constrained to 1280px, which is why Partner looked least
            like its canvas;
          · and `/research/*` was carved out of the full-bleed lists for all of
            them, on the stated reasoning that "a page that does not draw its
            own canvas does not want the canvas layout" — which was true, and
            is exactly the gap this padding closes. `/validate/*` has the same
            shape and was never carved out, so the two treatments disagreed
            inside one role as well as across four.

        One component, one number, and `App.jsx` now hands every workspace
        route `p-0` on all four licences. The `pr-6` this replaces was the
        gutter between the body and the rail; the right-hand padding is that
        gutter now, and it lands at the canvases' figure.
      */}
      <div className="min-w-0 flex-1 p-5">
        {bucket && (
          <div className="mb-2 flex items-center gap-2 text-[11.5px] text-axal-ink-3">
            <Link to={bucket.prefix} className="hover:underline">
              {bucket.label}
            </Link>
            {zone && (
              <>
                <span aria-hidden="true">‹</span>
                <b className="font-bold text-axal-ink">{zone?.label}</b>
              </>
            )}
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

        {bucket && <ZoneNav bucket={bucket} role={role} activeSlug={activeSlug} className="mt-3" />}

        <div
          className="mt-3.5 border-t pt-3.5"
          style={{ borderColor: '#ececf1' }}
        >
          {children}
        </div>
      </div>
      {/*
        THE RAIL IS A PANEL, not a floating column, and that is the whole of
        why it looked detached and clipped at once. `WorkerRail` itself sets no
        background, no border and no padding — so on a full-bleed route, where
        `App.jsx` gives the page container `p-0`, the rail was bare text on the
        page's grey ground running flush into the viewport's right edge, with
        the last words of every line cut off.

        All four design canvases draw it the same way and this matches them:
        a white ground, a hairline on the left as the seam against the body,
        its own inner padding, and full height so the seam runs the length of
        the page rather than stopping where the text happens to end.
      */}
      {/*
        The width is the SAME custom property the twenty host declarations read, so
        the shell's rail collapses with them rather than staying 280px wide
        around a 44px spine. `w-[280px]` moved into the fallback: while
        `--fwr-track` is undefined this is byte-for-byte the width it was.
        Padding goes with it — 18px of inset either side of a 44px column
        leaves 8px for the control.
      */}
      {rail && (
        <div
          className="fwr-shell-slot hidden shrink-0 border-l border-axal-border-soft bg-white px-[18px] pb-7 pt-[18px] xl:block dark:border-gray-800 dark:bg-gray-900"
          style={{ width: 'var(--fwr-track, 280px)' }}
        >
          <div className="sticky top-20">{rail}</div>
        </div>
      )}
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
