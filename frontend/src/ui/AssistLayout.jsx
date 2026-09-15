import React from 'react';
import AssistRail from './AssistRail';
import { eadwynConfig } from './eadwynConfig';
import useAiSpend from '../hooks/useAiSpend';
import useAssistMode from '../hooks/useAssistMode';

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
  // THE SWITCH WAS ALREADY BUILT AND HAD NOTHING BEHIND IT. `AssistRail` renders
  // the toggle when its config declares `kind: 'choice'` and takes `mode` /
  // `onModeChange` for it; this wrapper never passed either, so the first surface
  // to declare a choice here — the market page — would have drawn a switch that
  // reported `true` and changed nothing. That is exactly the dead control D17
  // refused, so the hook is wired rather than the switch suppressed.
  //
  // The PAGE calls the same hook for its own band, and reads the same answer:
  // `useAssistMode` is a module store precisely so the rail and the page cannot
  // disagree. Nothing is passed down, because nothing needs to be.
  const [mode, setMode] = useAssistMode(surface);

  if (!config) return <>{children}</>;

  return (
    <div className={`flex items-start gap-6 ${className}`}>
      <div className="min-w-0 flex-1">{children}</div>
      <AssistRail
        config={config}
        page={surface}
        mode={mode}
        onModeChange={setMode}
        lastRun={spend?.last_run}
        className="hidden xl:flex sticky top-20"
      />
    </div>
  );
}
