import React, { createContext, useContext, useLayoutEffect } from 'react';
import './workerRail.css';

/**
 * D556 — THE ONE FRAME THE WORKER AI RAIL SITS IN.
 *
 * The owner, on the admin Approvals and Accounts pages: "The AIRail doesn't
 * appear properly, on the right … For reference check the Founder pages."
 * The founder desks draw the rail as a panel: docked to the right edge, as
 * tall as the page, with a hairline seam against the body, its own ground and
 * its own inner padding, and a track that narrows to the spine through
 * `--fwr-track`. Each desk draws that frame in its own stylesheet
 * (`.fb-worker-rail`, `.a5-rail`, …), and they are the reference this copies.
 * The other hosts drew none: about thirty pages put `<WorkerRail>` in a
 * `lg:grid … 280px` column or a `lg:sticky` wrapper inside the app's padded
 * page, so it read as a column of loose text 24px short of the edge.
 *
 * This component is that frame, written once. Every host that does not draw
 * the founder frame itself passes its rail here, and so does `WorkspaceShell`,
 * whose own slot this replaces. The styles are `.fwr-frame*` in
 * `workerRail.css`, beside the rail's own, not in any page's stylesheet.
 *
 * WHAT IT DOES, AND WHERE.
 *   · At 1024px and up: a row of two. The body takes the rest; the rail
 *     column is `var(--fwr-track, 280px)` wide, white, with a left hairline,
 *     and stretched to the row so the seam runs the page's length. Inside it,
 *     the rail is sticky and scrolls on its own when it is taller than the
 *     window, so its model cards never run the page out to their length.
 *   · Below 1024px: the body alone. The rail column is `display: none`, which
 *     keeps `WorkerRail` mounted, so its floating button and bottom sheet
 *     (D405), portalled to <body>, keep working exactly as before.
 *   · Docked to the edge. Where the app's page container pads its content
 *     (`[data-app-main]` without `edge-to-edge-surface`), a frame that is a
 *     direct child of it cancels that padding on the right and the bottom,
 *     and on the top when nothing sits above it, then gives the same padding
 *     back to the body. The body's content stays where it was; only the rail
 *     moves, to the edge. A frame nested deeper does not bleed, because
 *     cancelling padding it is not adjacent to would pull it over its
 *     siblings — so a host should make the frame its outermost element.
 *
 *   · A section strip, when the shell has one. HQ's Platform and Content
 *     links are drawn by the shell above the page container, so they ran
 *     across the rail's column and the panel started under them. The shell
 *     offers its strip through `RailStripSlot`. A frame with a rail takes it:
 *     it says so (`dock`), the shell leaves its own copy out (`inFrame`), and
 *     the frame draws the strip at the top of the body, where a founder desk
 *     has its tabs. The panel then runs from the header. One copy at a time,
 *     settled in a layout effect, so nothing is painted twice.
 *
 * `rail` is the `<WorkerRail>` element. With no rail the frame draws the body
 * alone, so a host can pass a rail conditionally.
 */
export const RailStripSlot = createContext(null);

export default function RailFrame({ rail = null, children, className = '', 'data-testid': testId }) {
  const slot = useContext(RailStripSlot);
  const dock = rail && slot?.strip ? slot.dock : null;
  useLayoutEffect(() => {
    if (!dock) return undefined;
    dock(true);
    return () => dock(false);
  }, [dock]);
  return (
    <div className={`fwr-frame ${className}`.trim()} data-rail={rail ? 'true' : 'false'} data-testid={testId}>
      <div className="fwr-frame-main">
        {dock && slot.inFrame ? <div className="fwr-frame-strip">{slot.strip}</div> : null}
        {children}
      </div>
      {rail && (
        <div className="fwr-frame-rail" data-testid="worker-rail-frame">
          <div className="fwr-frame-dock">{rail}</div>
        </div>
      )}
    </div>
  );
}
