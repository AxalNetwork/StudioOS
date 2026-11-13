import React, { createContext, useContext, useState } from 'react';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { RailFrame, WorkerRail } from '../../ui';

/**
 * D4873 (#4873, part 2): a board's next steps for its rail (`ui/RailSteps.jsx`). The board's body knows them,
 * from what it read; the frame holds them and hands them to the rail, so the frame stays the page's outermost
 * element. `useBoardSteps()` returns the setter, a no-op outside a frame.
 */
const BoardSteps = createContext(() => {});
export const useBoardSteps = () => useContext(BoardSteps);

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
 */
/**
 * D4814 part 5 (AP-19): `operations` gives the board the operations rail
 * (D4860): collapsed to its spine on every visit, opened on purpose, pinnable,
 * and never touching the shared collapse preference. Approvals passes it so
 * the queue keeps the width.
 */
export default function AdminBoardFrame({ workspace, note, children, operations = false, 'data-testid': testId }) {
  const user = useAuth()?.user ?? null;
  const [steps, setSteps] = useState(null);
  let rail = null;
  if (isSuperAdminUser(user)) {
    rail = <WorkerRail workspace={workspace} note={note} steps={steps} role="super_admin" operations={operations} data-testid="hq-board-rail" />;
  } else if (user?.role === 'admin') {
    rail = <WorkerRail workspace={workspace} note={note} steps={steps} role="admin" operations={operations} data-testid="admin-board-rail" />;
  }
  return <RailFrame rail={rail} data-testid={testId}><BoardSteps.Provider value={setSteps}>{children}</BoardSteps.Provider></RailFrame>;
}
