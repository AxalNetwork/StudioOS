import React from 'react';
import ZoneNav from './ZoneNav';
import { bucketForPath } from './shellConfig';
import { ZonePrimary, ZonePrimaryTarget } from './ZoneActions';
import ProfileHeaderAsk from './ProfileHeaderAsk';

/**
 * D1424 (#3700) — the zone header for the investor pages that draw their own
 * chrome instead of `WorkspaceShell`: Portfolio's Positions, Reports and
 * Value-add, and Fund's LPs, Calls, Accounting and Reporting.
 *
 * It draws what `WorkspaceShell` draws, in the page's own CSS family: the
 * crumb (Fund pages), the h1, the one-line purpose, then the tools cluster
 * (the primary slot, the gated Ask, and the page's refresh button), and the
 * zone pills below. Two families exist because the two buckets were drawn by
 * two canvases: Portfolio's `i4-heading` and Fund's `i6-header` with its
 * breadcrumb. Both keep their CSS; what they now share is the cluster.
 *
 * THE PRIMARY. The page wraps itself in `ZonePrimaryScope`; its own
 * `ZoneToolbar` finds the row the investor table marks `primary` and portals it
 * here, beside Ask, so the handler stays with the page that owns it. A page
 * may also pass `primary` directly (one action item).
 *
 * The tools cluster alone is exported as `ZoneHeaderTools`, for the two bucket
 * roots whose headers carry more than a zone header does.
 */
export function ZoneHeaderTools({ role = 'investor', primary = null, children = null }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="zone-header-tools">
      {primary ? <ZonePrimary item={primary} /> : null}
      <ZonePrimaryTarget />
      <ProfileHeaderAsk role={role} />
      {children}
    </div>
  );
}

export default function ZoneHeader({
  role = 'investor',
  family = 'i4',
  bucketPath,
  activeSlug,
  crumb = null,
  title,
  intro = null,
  primary = null,
  refresh = null,
  navClassName = 'my-3',
}) {
  const bucket = bucketPath ? bucketForPath(role, bucketPath) : null;
  const i6 = family === 'i6';
  return (
    <>
      <header className={i6 ? 'i6-header' : 'i4-heading'} data-testid="zone-header">
        <div>
          {i6 && crumb && bucket ? <div className="i6-breadcrumb">{bucket.label} <span>‹</span> <b>{crumb}</b></div> : null}
          <h1>{title}</h1>
          {intro ? <p>{intro}</p> : null}
        </div>
        <ZoneHeaderTools role={role} primary={primary}>{refresh}</ZoneHeaderTools>
      </header>
      {bucket ? <ZoneNav bucket={bucket} role={role} activeSlug={activeSlug} className={navClassName} /> : null}
    </>
  );
}
