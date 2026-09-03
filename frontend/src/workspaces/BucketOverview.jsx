import React from 'react';
import { Link } from 'react-router-dom';
import { ACCENT, zonePath } from './shellConfig';
import './bucketOverview.css';

/**
 * The canvas overview a bucket root renders: one card per zone, each linking
 * to its zone route. A sidebar row points at the bucket root; the zone pills
 * below the heading name the same destinations. The overview is above the
 * zones, not one of them — which is why the shell lights no pill here.
 *
 * Shared by every licence: AdvisorBucketRoutes and PartnerBucketRoutes hand it
 * their bucket directly; NetworkWorkspace and ResearchWorkspace resolve the
 * per-role bucket for the shared /network and /research prefixes first.
 *
 * `descriptions` maps zone slug → the one line that says what the zone holds.
 * A zone with no line still renders — its card carries the label and the
 * archetype badge, which is enough to open it.
 *
 * `unbuilt` maps zone slug → the heading that zone's OWN page renders when it
 * has no store. Pass it and the card shows that heading behind a "Not built"
 * marker instead of a description, so an overview card can never promise what
 * the page behind it denies. Callers derive it from the same object the zone
 * body reads (`COPY`, `ZONE_COPY`, `ORG_BACKED`), which is what keeps the two
 * one sentence rather than two that drift.
 *
 * This is not a hypothetical guard. The first draft of these grids described
 * Guidance as "what you have told the batch, and who has acted on it" over a
 * page reading "Cohort guidance has no store", Ask as "cited answers over your
 * own documents" over a withdrawn retrieval stack, and six partner zones —
 * negotiations, deliverables, capacity, catalog, visibility, proof — as
 * working features, every one of them a `NoStoreYet` card. The overview is the
 * surface a reader consults BEFORE choosing where to click, so a false line
 * here is the absent-is-not-empty rule broken at its most persuasive point.
 */

/**
 * Turn a zone-copy map (slug → `{ heading, … }`, the shape every bucket already
 * uses for its no-store cards) into the `unbuilt` map this component wants.
 * Keeping the derivation here means a caller cannot accidentally hand-write a
 * gentler sentence than the one its zone page shows.
 */
export function unbuiltFrom(copy) {
  if (!copy) return {};
  return Object.fromEntries(
    Object.entries(copy)
      .filter(([, v]) => v && typeof v.heading === 'string')
      .map(([slug, v]) => [slug, v.heading]),
  );
}

export default function BucketOverview({
  bucket,
  role = 'founder',
  descriptions = {},
  unbuilt = {},
  className = '',
}) {
  if (!bucket?.zones?.length) return null;
  const accent = ACCENT[role] || ACCENT.founder;
  return (
    <div
      className={`bo-grid ${className}`.trim()}
      style={{ '--bo-tint': accent.tint, '--bo-border': accent.border, '--bo-ink': accent.deep }}
    >
      {bucket.zones.map((zone) => {
        const gap = unbuilt[zone.slug];
        const line = gap || descriptions[zone.slug];
        return (
          <Link
            key={zone.slug}
            to={zonePath(bucket, zone)}
            className={`bo-card${gap ? ' bo-card-unbuilt' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="bo-title text-sm font-bold text-axal-ink">{zone.label}</span>
              <span
                className="rounded-[3px] border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[.07em]"
                style={{ background: zone.archetype.colors[0], color: zone.archetype.colors[1], borderColor: zone.archetype.colors[2] }}
              >
                {zone.archetype.label}
              </span>
            </div>
            {line && (
              <p className="mt-2 text-[12px] leading-relaxed text-axal-ink-2">
                {gap && <span className="bo-unbuilt">Not built</span>}
                {line}
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
