import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import ZoneNav from './ZoneNav';
import RailFrame from '../ui/RailFrame';
import { useActiveCompany } from '../contexts/ActiveCompanyContext';
import { bucketForPath, zoneForPath } from './shellConfig';
import { boardFor } from './boards/index.js';

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
 *
 * AND IT NOW SAYS WHICH ONE. Every caller that passed a `scope` passed a LITERAL
 * — `"One venture"`, `"One fund"`, `"One firm"` — in the only three places the
 * prop was used at all. Three pages restated the rule and every other workspace
 * surface in the product said nothing, so the slot the rule is visible in was
 * empty on most of the product and a slogan on the rest.
 *
 * So the shell reads `ActiveCompanyContext` itself and defaults the slot to the
 * active company's NAME. One place rather than thirty callers, which is also the
 * only way the four profiles end up with the same treatment.
 *
 * `useActiveCompany` had exactly three consumers before this — the switcher, the
 * context file, and Company settings — so no workspace page knew which company
 * was active. `ui/CompanySwitcher.jsx`'s own docblock states the rule this
 * honours: "pages read ActiveCompanyContext, and this component is the single
 * writer." The shell reads; it never writes.
 *
 * AN EXPLICIT `scope` STILL WINS, because a page genuinely scoped to something
 * narrower than a company — one fund, one client engagement — is telling the
 * truth about a different unit and the shell cannot know it. What is gone is the
 * literal that names no one.
 *
 * NO COMPANY MEANS NO BADGE. An empty slot is honest; `"One venture"` over an
 * account with no company membership is a claim about data that is not there.
 *
 * ONE `<h1>` PER PAGE (D593). The title line is the page's heading, unless the
 * page heads its own content: `/research/markets/:uid` draws the metric as the
 * h1 of its header card, as its canvas does. Such a page passes `titleAs="p"`
 * and the same line renders as a paragraph. Every other caller leaves it
 * unset and keeps the h1.
 */
export default function WorkspaceShell({
  role = 'founder',
  title,
  titleAs = 'h1',
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
  // READ, NEVER WRITTEN. `useContext` on a provider-less tree returns the
  // context's own default (`{ company: null, … }`), so a page rendered outside
  // `ProtectedLayout` — a test harness, a public route — gets no badge rather
  // than an exception.
  const { company } = useActiveCompany();
  const companyName = String(company?.company_name || '').trim();
  const scopeLabel = scope || companyName || null;
  // `activeSlug === null` is the overview mode: a bucket root is above its
  // zones, so no zone is current — not in the pill row, and not in the crumb
  // or title either. `zoneForPath` answers the first zone on a bucket root and
  // null for a slug the shell does not list, which is right on a zone route
  // and wrong here.
  //
  // A STRING `activeSlug` is the child-page case. `/research/funds/:uid` is not
  // a zone slug, so `zoneForPath` returns null and the crumb would otherwise
  // drop Funds. The explicit slug names the zone the page belongs to. Undefined
  // still means "resolve from the path", which is every zone page that does
  // not pass the prop.
  const resolved = activeSlug === null ? null : zoneForPath(bucket, location.pathname);
  const namedZone = typeof activeSlug === 'string'
    ? (bucket?.zones?.find((z) => z.slug === activeSlug) || null)
    : null;
  const zone = resolved || namedZone;
  const crumbTitle = typeof title === 'string' && zone && title !== zone.label ? title : null;
  // BACK TO THE ZONE, NOT THE TOP OF THE BUCKET (D403). Where the root is a
  // board (`boards/index.js`), each zone has a section there with its own
  // anchor, and the crumb returns the reader to it: `/pipeline#pl-proposals`.
  // BucketBoard scrolls to the hash. A root that is a card grid has no such
  // section, and the crumb keeps the bare prefix. `boardFor` is only read for
  // its section list — its sources are functions that nothing calls here, so
  // no `api` is needed.
  const crumbAnchor = zone && bucket
    ? (boardFor(role, bucket.prefix, null)?.sections || []).find((s) => s.slug === zone.slug)?.anchor || null
    : null;
  const crumbTo = bucket ? (crumbAnchor ? `${bucket.prefix}#${crumbAnchor}` : bucket.prefix) : null;
  // No accent is read here on purpose. In the canvases the shell chrome —
  // crumb, title, divider — is neutral in all four roles; the accent lives on
  // the zone pills (ZoneNav) and the AI rail, which is where a reader looks to
  // tell one licence from another. An earlier draft computed one here and
  // never used it, which CodeQL caught.
  const arch = zone?.archetype;
  const Title = titleAs || 'h1';

  return (
    // THE ROW IS `RailFrame` (D556): the body takes the rest and shrinks
    // first (`min-w-0`, so a wide table cannot shove the rail off-screen), the
    // rail is a fixed column beside it, and the two meet at the rail's own
    // seam with no gap. The row's `min-height: 100%` is what lets the panel
    // stretch to the footer rather than stop under its last block, and it is
    // `min-` so a page longer than the window still grows. All of that used
    // to be written here; it is the same frame every other host now uses,
    // so it lives once, in ui/RailFrame.jsx and the `.fwr-frame` rules of
    // ui/workerRail.css.
    <RailFrame rail={rail}>
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
      <div className="p-5">
        {bucket && (
          <div className="mb-2 flex items-center gap-2 text-[11.5px] text-axal-faint">
            <Link to={crumbTo} className="hover:underline" data-testid="link-workspace-crumb">
              {bucket.label}
            </Link>
            {zone && (
              <>
                <span aria-hidden="true">‹</span>
                {crumbTitle ? (
                  <Link to={`${bucket.prefix}/${zone.slug}`} className="hover:underline">
                    {zone.label}
                  </Link>
                ) : (
                  <b className="font-bold text-axal-ink">{zone.label}</b>
                )}
              </>
            )}
            {crumbTitle && (
              <>
                <span aria-hidden="true">‹</span>
                <b className="font-bold text-axal-ink">{crumbTitle}</b>
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <Title className="m-0 text-xl font-extrabold tracking-tight">
              {title || zone?.label}
            </Title>
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
            {scopeLabel && (
              scopeHref ? (
                <Link
                  to={scopeHref}
                  className="inline-flex items-center gap-1.5 rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[11px] font-bold text-axal-muted hover:border-axal-faint"
                >
                  {scopeLabel}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[11px] font-bold text-axal-muted">
                  {scopeLabel}
                </span>
              )
            )}
          </div>
        </div>

        {intro && <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-axal-muted">{intro}</p>}

        {bucket && <ZoneNav bucket={bucket} role={role} activeSlug={activeSlug} className="mt-3" />}

        <div
          className="mt-3.5 border-t pt-3.5"
          style={{ borderColor: '#ececf1' }}
        >
          {children}
        </div>
      </div>
      {/*
        THE RAIL IS A PANEL — and since D556 the panel is `RailFrame`, the
        one frame every host shares, rather than a slot drawn here. Its
        figures are this slot's: 280px through `--fwr-track`, a white ground,
        a hairline seam, 18px of inset and 28px under. Two things changed with
        the move: the panel shows from 1024px instead of 1280px, the width at
        which the rail stops being the phone button (D405) — between the two
        a workspace page drew neither — and the rail scrolls inside its panel
        when it is taller than the window.
      */}
    </RailFrame>
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
    <span className="inline-flex whitespace-nowrap rounded border border-axal-hairline bg-axal-ground px-1.5 py-0.5 text-[10px] font-bold text-axal-faint">
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
