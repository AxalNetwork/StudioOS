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
 */
export default function BucketOverview({ bucket, role = 'founder', descriptions = {}, className = '' }) {
  if (!bucket?.zones?.length) return null;
  const accent = ACCENT[role] || ACCENT.founder;
  return (
    <div
      className={`bo-grid ${className}`.trim()}
      style={{ '--bo-tint': accent.tint, '--bo-border': accent.border, '--bo-ink': accent.deep }}
    >
      {bucket.zones.map((zone) => (
        <Link key={zone.slug} to={zonePath(bucket, zone)} className="bo-card">
          <div className="flex items-center justify-between gap-2">
            <span className="bo-title text-sm font-bold text-axal-ink">{zone.label}</span>
            <span
              className="rounded-[3px] border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[.07em]"
              style={{ background: zone.archetype.colors[0], color: zone.archetype.colors[1], borderColor: zone.archetype.colors[2] }}
            >
              {zone.archetype.label}
            </span>
          </div>
          {descriptions[zone.slug] && (
            <p className="mt-2 text-[12px] leading-relaxed text-axal-ink-2">{descriptions[zone.slug]}</p>
          )}
        </Link>
      ))}
    </div>
  );
}
