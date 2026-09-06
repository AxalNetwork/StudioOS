import React from 'react';
import { Link } from 'react-router-dom';
import { Card, Skeleton } from '../ui';
import { accentLinkClass, zonePath } from './shellConfig';
import NoStoreYet from './NoStoreYet';
import useBucketSources from './useBucketSources';

/**
 * The composed body a bucket ROOT renders when the canvas corpus draws one.
 *
 * WHAT THE CANVASES ACTUALLY DRAW, which is not a menu. `Partner Operator
 * Canvas` P3–P7 and `Advisor Canvas` V3–V6 draw a bucket root as an h1, a
 * sub-line, and then ONE SECTION PER ZONE — each with a `.zh` header carrying a
 * real count ("{{ propCount }} open · {{ winRate }} win rate"), a short table of
 * that zone's real rows, and a footnote reading the rows rather than repeating
 * them. `BucketOverview` renders a three-column grid of link cards instead: a
 * label, an archetype badge, one blurb. That is the mismatch this component
 * closes.
 *
 * IT DOES NOT REPLACE `BucketOverview`, and the two are not two ways of doing
 * one thing. A card grid is the honest surface for a bucket root NOBODY
 * DESIGNED; a board is the honest surface for one they did. Six roots have no
 * root artboard anywhere in the corpus — advisor `/cohorts` (whose own canvas,
 * `Pages · Advisor Cohorts.dc.html`, draws its five zones and deliberately no
 * root), plus every founder and investor bucket — and they keep the grid.
 *
 * THE ANCHOR PILLS ARE DELIBERATELY NOT REBUILT. The canvases draw a strip of
 * pills above the sections, and `anchorsFor()` gives them `href="#pl-leads"`
 * because on an artboard every zone IS a section of one page. In the app those
 * zones are five real routes and `ZoneNav` already renders one pill each.
 * `ZoneNav.jsx:8-15` exists precisely because the canvas pills were inert —
 * "clicking one jumped the page to an anchor that did not exist rather than
 * opening the subpage it named". A second identical-looking strip that scrolled
 * instead of navigating would rebuild that bug. The canvas anchor ids survive
 * as each section's `id`, so `/pipeline#pl-proposals` still deep-links, and the
 * wiring runs the other way: a section's TITLE is the link to its zone.
 *
 * (One thing the canvas cannot be followed on: P7's own pill row lists
 * `['Market','rs-market']`, and no `.zh` in that artboard carries that id — it
 * is one of the `resCards`. The canvas's nav and its body disagree. Dropping
 * the strip resolves it; this note is here so nobody "restores" the pills on
 * the grounds that the canvas had them.)
 *
 * A SECTION CANNOT PRINT A COUNT IT CANNOT SOURCE, and that is a property of
 * the signature rather than of anyone's care. `summary`, `rows` and `footnote`
 * are called with the section's source payload as their ONLY argument. They
 * close over nothing. A section with no `source` is therefore handed nothing
 * and has nothing to count — and a section carrying a `gap` declares no source
 * at all, so the two are mutually exclusive by construction, not by review.
 * `bucket_board.test.mjs` fails the build if a registry declares both.
 *
 * NO UNDECLARED TOKENS. `axal-ink-2`, `axal-ink-3`, `axal-surface-2`,
 * `axal-border` and `axal-border-soft` are used ~410 times across `pages/` and
 * `workspaces/` and are declared in no `@theme` block, so they emit nothing.
 * The canvas values map onto tokens that DO exist — `.card` #ececf1 is
 * `axal-hairline`, `.td` #f4f3f7 is `axal-ground` — and everything else uses
 * Tailwind's greys with a dark counterpart, as `ZoneActions.jsx` settled.
 */

const SECTION = 'scroll-mt-24';

export default function BucketBoard({ bucket, role = 'founder', board, className = '' }) {
  const sources = board?.sources || EMPTY;
  const byKey = useBucketSources(sources);
  if (!bucket?.zones?.length || !board?.sections?.length) return null;
  const zoneBySlug = new Map(bucket.zones.map((z) => [z.slug, z]));

  return (
    <div className={`grid gap-3.5 md:grid-cols-2 ${className}`.trim()}>
      {board.sections.map((section) => {
        const zone = zoneBySlug.get(section.slug);
        if (!zone) return null;                       // N4 keeps this unreachable
        const to = zonePath(bucket, zone);
        const span = section.span === 'half' ? '' : 'md:col-span-2';
        return (
          <div key={section.slug} className={span}>
            {section.kind === 'card'
              ? <ZoneCard zone={zone} to={to} section={section} />
              : (
                <Section
                  section={section}
                  zone={zone}
                  to={to}
                  role={role}
                  source={section.source ? byKey[section.source] : null}
                />
              )}
          </div>
        );
      })}
    </div>
  );
}

const EMPTY = {};

/**
 * A zone the artboard drew no section for. V6 draws three sections for a
 * five-zone bucket and P7 three for a four-zone one, so `markets` and
 * `companies` have live stores and no design. They render as a link card in
 * zone order rather than as a section the design never drew — composing one
 * would be the same offence as inventing a number.
 */
function ZoneCard({ zone, to, section }) {
  return (
    <Link
      to={to}
      className="block h-full rounded-axal-lg border border-axal-hairline bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-axal-ink dark:text-gray-100">{section.title || zone.label}</span>
        <span
          className="rounded-[3px] border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[.07em]"
          style={{ background: zone.archetype.colors[0], color: zone.archetype.colors[1], borderColor: zone.archetype.colors[2] }}
        >
          {zone.archetype.label}
        </span>
      </div>
      {section.blurb && (
        <p className="mt-2 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">{section.blurb}</p>
      )}
    </Link>
  );
}

function Section({ section, zone, to, role, source }) {
  const title = section.title || zone.label;
  // A gapped section states its reason and draws no table, no count and no
  // control. `gap` is the SAME object the zone's own page renders, handed over
  // by the registry — never a second, gentler sentence written here.
  if (section.gap) {
    return (
      <Card padding="lg" className={SECTION} id={section.anchor}>
        <Head title={title} to={to} sub="No store behind this yet" />
        <NoStoreYet {...section.gap} accentClass={accentLinkClass(role)} />
      </Card>
    );
  }

  const state = source?.state || 'loading';
  const payload = source?.data;
  return (
    <Card padding="lg" className={SECTION} id={section.anchor}>
      <Head title={title} to={to} sub={state === 'ready' ? section.summary?.(payload) : null} />
      {state === 'loading' && (
        <div className="space-y-2" aria-busy="true"><Skeleton className="h-7" /><Skeleton className="h-20" /></div>
      )}
      {state === 'error' && (
        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
          {source.error} Nothing is shown rather than an empty list, because an empty list here
          would say you have no records — and that is not something this page can currently know.
        </p>
      )}
      {state === 'ready' && <Body section={section} payload={payload} to={to} />}
    </Card>
  );
}

/** `.zh` — the zone title, linked, and the count line the canvas puts beside it. */
function Head({ title, to, sub }) {
  return (
    <div className="mb-[11px] flex items-baseline justify-between gap-3">
      <Link to={to} className="text-[15px] font-extrabold tracking-[-.015em] text-axal-ink hover:underline dark:text-gray-100">
        {title}
      </Link>
      {sub && <span className="text-[11.5px] text-gray-600 dark:text-gray-300">{sub}</span>}
    </div>
  );
}

function Body({ section, payload, to }) {
  const rows = section.rows ? section.rows(payload) || [] : [];
  const note = section.footnote ? section.footnote(payload) : null;
  if (!rows.length) {
    return (
      <>
        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
          {section.empty || 'Nothing is stored here yet.'}
        </p>
        {note && <Note>{note}</Note>}
      </>
    );
  }
  const cols = section.cols || `repeat(${section.columns.length}, minmax(0, 1fr))`;
  return (
    <>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="grid gap-3" style={{ gridTemplateColumns: cols }}>
            {section.columns.map((head) => (
              <span key={head} className="pb-2 text-left text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-600 dark:text-gray-300">
                {head}
              </span>
            ))}
          </div>
          {rows.map((cells, i) => (
            <div key={i} className="grid items-center gap-3" style={{ gridTemplateColumns: cols }}>
              {cells.map((cell, j) => (
                <span key={j} className="border-t border-axal-ground py-2 text-[11.5px] tabular-nums text-gray-700 dark:border-gray-800 dark:text-gray-300">
                  {cell ?? <span className="text-gray-500 dark:text-gray-400">Not recorded</span>}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      {note && <Note>{note}</Note>}
      <p className="mt-3 text-[11px]">
        <Link to={to} className="font-semibold text-gray-600 underline dark:text-gray-300">Open {section.title || 'the zone'}</Link>
      </p>
    </>
  );
}

function Note({ children }) {
  return (
    <p className="mt-3 border-t border-axal-ground pt-[11px] text-[11px] leading-[1.55] text-gray-600 dark:border-gray-800 dark:text-gray-300">
      {children}
    </p>
  );
}
