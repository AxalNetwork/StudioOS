/**
 * D5810 (#5810) — Microsoft Teams in Account › Connectors, on the member's one
 * Microsoft connection. The rules the Teams page draws, and the one marker a
 * Teams sign-in leaves so Microsoft's return lands back on the Teams page.
 *
 * WHAT THE PAGE SAYS, AND FROM WHERE.
 *   · The Microsoft connection: the catalogue's first-party row
 *     (`GET /api/calendar/microsoft/status`, through `useConnectors`), which
 *     Microsoft 365's page reads too.
 *   · Creating a work or school Teams meeting, and Eadwyn AI joining a Teams
 *     call: `GET /api/founder/validate/meetings/capabilities`'s `teams` row,
 *     read for the signed-in member. Its flags only; no token, tenant or link.
 * A read that failed says "Unreadable", never "Not connected" or "Off".
 */

const SIGN_IN_FROM = 'axal.connectors.signInFrom';
const SIGN_IN_TTL_MS = 15 * 60_000;
const FROM_KEYS = new Set(['teams']);

function session() {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/** Remember, for this tab only, that a Microsoft sign-in began on the Teams page. */
export function markSignInFrom(key, now = Date.now(), store = session()) {
  if (!store || !FROM_KEYS.has(key)) return;
  try { store.setItem(SIGN_IN_FROM, JSON.stringify({ key, at: now })); } catch { /* the return lands on Microsoft 365's page instead */ }
}

/** The page a Microsoft sign-in began on, read once and forgotten; null when none, stale or unreadable. */
export function takeSignInFrom(now = Date.now(), store = session()) {
  if (!store) return null;
  let raw = null;
  try { raw = store.getItem(SIGN_IN_FROM); store.removeItem(SIGN_IN_FROM); } catch { return null; }
  try {
    const v = JSON.parse(raw || 'null');
    if (!v || !FROM_KEYS.has(v.key) || !Number.isFinite(v.at) || now - v.at < 0 || now - v.at > SIGN_IN_TTL_MS) return null;
    return v.key;
  } catch { return null; }
}

const row = (id, label, value, tone, note = null) => ({ id, label, value, tone, note });

/**
 * The Teams page's three rows: the Microsoft connection, creating a Teams
 * meeting, and Eadwyn AI. `p` is the catalogue row; `caps` is the capability
 * read: undefined while reading, null when it failed, else the Worker's answer.
 */
export function teamsCapabilityRows(p, caps) {
  const conn = p?.connection || null;
  const connection = p?.unreadable ? row('connection', 'Microsoft connection', 'Unreadable', 'warn', 'Axal could not read your Microsoft connection. This is not a claim that it is disconnected.')
    : conn && conn.last_error ? row('connection', 'Microsoft connection', 'Reconnect required', 'warn', 'Microsoft no longer accepts Axal’s access. Reconnect Microsoft to keep using it.')
      : conn ? row('connection', 'Microsoft connection', 'Connected', 'ok', conn.external_account_name ? `Signed in as ${conn.external_account_name}.` : null)
        : p && p.available === false ? row('connection', 'Microsoft connection', 'Not set up here', 'neutral', 'Microsoft sign-in is not set up on this deployment, so it cannot be connected.')
          : row('connection', 'Microsoft connection', 'Not connected', 'neutral', 'Connect to create Teams meetings and sync your Outlook calendar.');
  const teams = caps && typeof caps === 'object' && caps.providers && typeof caps.providers.teams === 'object' ? caps.providers.teams : null;
  const loading = caps === undefined;
  const unread = !loading && !teams;
  const create = loading ? row('create', 'Create a Teams meeting', 'Checking…', 'neutral')
    : unread ? row('create', 'Create a Teams meeting', 'Unreadable', 'warn', 'Axal could not read whether it can create Teams meetings for you.')
      : teams.create_available === false ? row('create', 'Create a Teams meeting', 'Not available here', 'neutral', 'This deployment cannot create Teams meetings. Create the meeting in Teams and paste its link.')
        : teams.connected === null ? row('create', 'Create a Teams meeting', 'Unreadable', 'warn', 'Axal could not read your Microsoft connection.')
          : teams.can_create_meeting === true ? row('create', 'Create a Teams meeting', 'Available', 'ok', 'Needs a work or school Microsoft 365 account. With a personal account, create the meeting in Teams and paste its link.')
            : row('create', 'Create a Teams meeting', 'Connect first', 'neutral', 'Connect Microsoft to create work or school Teams meetings from Axal.');
  const bot = loading ? row('bot', 'Eadwyn AI joins Teams calls', 'Checking…', 'neutral')
    : unread ? row('bot', 'Eadwyn AI joins Teams calls', 'Unreadable', 'warn', 'Axal could not read whether Eadwyn AI can join Teams calls.')
      : teams.can_join_as_bot === true ? row('bot', 'Eadwyn AI joins Teams calls', 'Available', 'ok', 'It joins as a guest with the meeting link, whichever account hosts it. It does not need this connection.')
        : row('bot', 'Eadwyn AI joins Teams calls', 'Not available here', 'neutral', 'Upload the recording or paste the transcript after the call.');
  return [connection, create, bot];
}
