import React from 'react';
import AssistRail from './AssistRail';
import { eadwynConfig } from './eadwynConfig';
import useAiSpend from '../hooks/useAiSpend';

/**
 * Wraps a page's content and puts the AI rail beside it.
 *
 * Mounting the rail meant touching six pages with six different layouts
 * (`max-w-4xl mx-auto`, full-bleed grids, a tabbed workspace). Editing each
 * one by hand would have been six chances to break a layout nobody can see
 * from here, and six slightly different results. This is the one place that
 * knows how the rail sits next to a page, so each mount is:
 *
 *   <AssistLayout surface="deck_review">
 *     …the page exactly as it was…
 *   </AssistLayout>
 *
 * THE RAIL IS SECONDARY, AND THE LAYOUT SAYS SO.
 *
 * `min-w-0 flex-1` on the content, fixed 280px on the rail: the content keeps
 * its own max-width and shrinks first. Without `min-w-0` a flex child refuses
 * to shrink below its content's intrinsic width, which is how a wide table
 * inside a page pushes a sibling rail off-screen instead of scrolling itself.
 *
 * `hidden xl:flex` on the rail: below 1280px there is not room for a 280px
 * column beside a working page, and stacking a spend meter above the tool a
 * user came for puts the least important thing first. It is omitted, not
 * squeezed — the numbers are still on the account page.
 *
 * NOTHING RENDERS WITHOUT DATA. If the surface is unknown or the spend fetch
 * failed, `config` is null and only the children render. That is deliberate:
 * a rail with no figures is worse than no rail, because the empty frame reads
 * as "nothing spent" rather than "not loaded".
 */
export default function AssistLayout({ surface, children, className = '' }) {
  const { spend, pricing, loading } = useAiSpend();
  const config = (!loading && spend) ? eadwynConfig({ surface, spend, pricing }) : null;

  if (!config) return <>{children}</>;

  return (
    <div className={`flex items-start gap-6 ${className}`}>
      <div className="min-w-0 flex-1">{children}</div>
      <AssistRail
        config={config}
        page={surface}
        lastRun={spend?.last_run}
        className="hidden xl:flex sticky top-20"
      />
    </div>
  );
}
