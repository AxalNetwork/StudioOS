import { createContext, useContext } from 'react';

/**
 * D153 / canvas H12 — which branch HQ is currently reading through, if any.
 *
 * THIS IS A SCOPE ON THE READ, NOT A FILTER ON THE RENDER. The canvas states
 * it in its own subtitle: "The overlay is not a filter on an HQ table — it is
 * one private-link read, of one branch, rendered with every action removed."
 * So a page that consumes this does not narrow a payload it already has; it
 * asks the server for a different, smaller one (`hqOverview(branch)`,
 * `hqAdmins(q, branch)`), and every figure it then draws carries the branch
 * and the time it was read.
 *
 * IT PERSISTS NOTHING, on `AdminFrozenBar`'s stated rule: a mode the viewer
 * must not be able to forget they are in does not survive a reload or a sign-
 * out into somebody else's session. `clearSession` clears it for the same
 * reason it clears the support-session payload.
 *
 * Its own module rather than App.jsx, for the reason `ViewModeContext` gives:
 * mixing component and non-component exports breaks Fast Refresh.
 */
const ViewAsBranchContext = createContext(null);

/** `{ branch, setBranch }` — `branch` is a code string, or null for HQ's own view. */
export const useViewAsBranch = () => useContext(ViewAsBranchContext) || { branch: null, setBranch: () => {} };

export default ViewAsBranchContext;
