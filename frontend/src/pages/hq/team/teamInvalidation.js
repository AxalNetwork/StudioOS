/**
 * D5044 (#5044) — what each HQ Team act changes, and so which of the page's reads it invalidates.
 *
 * The Team page holds two reads of HQ's own data that acts elsewhere on the page change: the
 * administrator ROSTER (with the branch search, `useHqTeamRoster`) and the account DIRECTORY below
 * it (the All accounts table, `UsersConsole`). Every act names what it invalidates here, and the
 * page re-reads exactly those, in place. No act reloads the page.
 *
 * Moves to finish (`../AccountMoveRecovery.jsx`, D5043) is not invalidated by a move: a move made
 * here shows its outcome on its own hit, and listing it again below would draw one move twice. It
 * is read when the page mounts and re-read by its own controls.
 *
 * The authorization and write bars are the routes'; nothing here changes who may do what.
 */
import { useCallback, useState } from 'react';

export const TEAM_READS = Object.freeze(['roster', 'directory']);

export const INVALIDATES = Object.freeze({
  // The Super Admin badge is drawn in the roster, and the directory's record shows the elevation.
  holder_change: ['roster', 'directory'],
  // Signing an administrator out changes sessions, which neither list reads.
  hq_sign_out: [],
  // A move closes the account on its branch, so the branch search asks again.
  branch_move: ['roster'],
  // Unbinding deactivates an administrator on a branch: the branch search re-asks.
  branch_unbind: ['roster'],
  // A role, active-state or access change in the directory can add or remove an administrator.
  directory_change: ['roster'],
});

/** The page's keys, one per read, and `invalidate(act)` which bumps the keys `INVALIDATES` names. */
export function useTeamInvalidation() {
  const [keys, setKeys] = useState({ roster: 0, directory: 0 });
  const invalidate = useCallback((act) => {
    const reads = INVALIDATES[act];
    if (!reads) throw new Error(`Unknown HQ Team act: ${act}`);
    if (reads.length === 0) return;
    setKeys((k) => {
      const next = { ...k };
      for (const r of reads) next[r] = k[r] + 1;
      return next;
    });
  }, []);
  return { keys, invalidate };
}
