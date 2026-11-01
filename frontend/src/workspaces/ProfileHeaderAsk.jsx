import React from 'react';
import { useLocation } from 'react-router-dom';
import { AskButtonView } from '../ui/AskButton.jsx';
import { openEadwynPanel } from '../ui/eadwynPanel.js';
import { NO_RAIL_ROUTES, pageFor } from '../lib/railPages.js';
import { activeSupportSession } from '../lib/supportSession.js';
import { askAvailability, waitingCount } from './profileAskAdapter.js';

/**
 * D1424 (#3700) — the zone header's "Ask" on the Investor, Advisor and
 * Operating Partner profiles: the shared `ui/AskButton.jsx` button (D1604),
 * beside the zone's primary. Never "Fill".
 *
 * ONE GATE, AND TODAY IT IS SHUT. Ask is drawn only when every one holds:
 *   1. the licence is one of the three (founder headers have their own Ask);
 *   2. the route has an AIRail: it is not in `NO_RAIL_ROUTES` for this licence
 *      (Advisor Studio, the LP workspace, `/account`), and it has a
 *      `railPages` key that is not off-canvas. Both are read: the rail map
 *      still keys `/studio` and the LP workspace, so the key alone would put
 *      Ask on a page whose rail the owner removed. The panel slides out of the
 *      rail, so a page without one has no Ask;
 *   3. no support session is running (PH19b: read only, no Ask);
 *   4. #3706's panel serves these licences (`profileAskAdapter.js`).
 * The fourth is false on `main`, so this renders nothing anywhere, exactly as
 * Team's `AskButton` does. An Explorer never reaches these zone routes: every
 * guard in `App.jsx` for them excludes `exploring` (PH19d).
 */
export const ASK_ROLES = Object.freeze(['investor', 'advisor', 'partner']);

const segs = (p) => String(p || '').split('?')[0].split('/').filter(Boolean);

/** Whether `NO_RAIL_ROUTES` removes the rail from this route for this licence. */
export function noRailFor(pathname, role) {
  const path = segs(pathname);
  return NO_RAIL_ROUTES.some((e) => {
    if (!e.roles?.includes(role)) return false;
    const route = segs(e.route);
    const open = route[route.length - 1] === '*';
    const fixed = open ? route.slice(0, -1) : route;
    if (path.length < fixed.length) return false;
    if (path.length > fixed.length && !(e.prefix || open)) return false;
    return fixed.every((s, i) => s.startsWith(':') || s === path[i]);
  });
}

/** `{ show, reason, pageKey }`. Pure, so the order of the gates is testable. */
export function headerAskGate({ role, pathname, support = false, panel = askAvailability() }) {
  if (!ASK_ROLES.includes(role)) return { show: false, reason: 'not_a_profile', pageKey: null };
  const page = noRailFor(pathname, role) ? null : pageFor(pathname, role);
  if (!page || page.offCanvas) return { show: false, reason: 'no_rail', pageKey: null };
  if (support) return { show: false, reason: 'support_session', pageKey: page.key };
  if (!panel?.available) return { show: false, reason: panel?.reason || 'ask_panel_unbuilt', pageKey: page.key };
  return { show: true, reason: null, pageKey: page.key };
}

export default function ProfileHeaderAsk({ role }) {
  const { pathname } = useLocation();
  const gate = headerAskGate({ role, pathname, support: !!activeSupportSession() });
  if (!gate.show) return null;
  const waiting = waitingCount(gate.pageKey);
  return (
    <AskButtonView
      testId="zone-header-ask"
      waiting={waiting.available ? waiting.count : null}
      onClick={() => openEadwynPanel(gate.pageKey)}
    />
  );
}
