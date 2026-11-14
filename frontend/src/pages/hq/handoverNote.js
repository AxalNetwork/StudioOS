/**
 * D5040 (#5040) — the one line a former Super Admin keeps after handing the
 * elevation on.
 *
 * A successful transfer takes HQ's pages away from the account that made it, and
 * `hqOnly` then draws `SuperAdminOnlyNotice` where the Team page was. The holder
 * console's own "Handed to …" card unmounts with the page, so the confirmation
 * would vanish with the thing it confirms. It is kept in `sessionStorage` for one
 * read: the notice shows it once, in a status region, and clears it.
 *
 * Storage may be absent or full (private windows, blocked site data); every call
 * is wrapped, and the page works without it.
 */
const KEY = 'hq_handover_note';

/** Remember who the elevation went to. Never throws. */
export function rememberHandover(name, now = new Date()) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ name: String(name || 'the new holder'), at: now.toISOString() }));
  } catch { /* storage unavailable: the page still leaves HQ, only the line is lost */ }
}

/** The remembered handover, or null. Reading does not clear it; `clearHandover` does. */
export function peekHandover() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const note = JSON.parse(raw);
    return note && typeof note.name === 'string' ? note : null;
  } catch { return null; }
}

export function clearHandover() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Leave HQ, now. Called once the server has CONFIRMED a transfer.
 *
 * `hqOnly` (App.jsx) draws HQ's pages only while the signed-in user is a Super Admin, so
 * clearing that flag on the user in context is what removes every HQ-only screen from the
 * browser in the same render: the team table, the directory, the holder console. It is not
 * waiting for a reload. /me is then read again to reconcile with the server; if that read
 * fails nothing changes, because the answer it would give is already known.
 *
 * Returns nothing and never throws.
 */
export async function leaveHq({ name, user, setUser, refresh, onRefreshError }) {
  rememberHandover(name);
  if (user && typeof setUser === 'function') setUser({ ...user, is_super_admin: 0 });
  try { await refresh?.({ force: true }); } catch (e) { onRefreshError?.(e); }
}
