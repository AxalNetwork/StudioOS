import React from 'react';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { RailFrame, WorkerRail } from '../../ui';

/**
 * D774 (#2100) — the rail on an Admin board that drew none.
 *
 * The canvas gives every Admin board (S1–S39) a rail, and about half of the
 * consoles a plain admin opens drew none: each was a page of its own, outside
 * the five Held landings (`HeldZone`) and Contracts (`ContractsDesk`). This is
 * their one frame, written once, as `HeldZone` is the landings'. A board
 * wraps its whole page in it, so the frame is the page's outermost element and
 * the rail docks to the edge (D556).
 *
 * The rail takes the viewer's tier, as `ContractsDesk` does: HQ's colour for a
 * Super Admin, the admin's for everyone else on the admin tier. A viewer
 * outside that tier gets the page alone. Due diligence is the one board such a
 * viewer reaches (its route admits partners, investors and advisors), and
 * their own profiles' rollouts decide their rail there.
 *
 * `workspace` is the board's name on the canvas (`lib/railOptions/admin.js`
 * lists them), and `note` is the board's own sentence under the switch.
 * `rail={false}` draws the frame with no rail, for a board D317 keeps
 * rail-less inside a page that frames its other boards (`/admin`'s Spin-Out
 * Lab tab).
 */
export default function AdminBoardFrame({ workspace, note, rail: drawRail = true, children, 'data-testid': testId }) {
  const user = useAuth()?.user ?? null;
  let rail = null;
  if (!drawRail) {
    // The page alone (D317).
  } else if (isSuperAdminUser(user)) {
    rail = <WorkerRail workspace={workspace} note={note} role="super_admin" data-testid="hq-board-rail" />;
  } else if (user?.role === 'admin') {
    rail = <WorkerRail workspace={workspace} note={note} role="admin" data-testid="admin-board-rail" />;
  }
  return <RailFrame rail={rail} data-testid={testId}>{children}</RailFrame>;
}
