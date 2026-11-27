/**
 * #9113 (g38, board C26) — the rules for "Add a custom connector": a member's
 * own remote MCP servers, D852's `/api/connectors/custom`. Kept beside
 * `connectorsModel.js` rather than in it. The component half is
 * `CustomConnectors.jsx`.
 *
 * Everything here waits on the Worker's `CUSTOM_MCP_ENABLED`, which is off.
 * While it is off, `GET /` answers 404 `custom_connectors_off`, `customState`
 * reads that as `off`, and the page draws what it drew before: the Add menu's
 * entry disabled with PRO and Coming soon, and no Custom servers group. Whether
 * the flag is ever turned on is the owner's open question (D852, #2404); this
 * file does not answer it.
 */

/** The Add menu entry's tooltip while the entry waits (flag off, or not this member's). */
export const CUSTOM_OFF_TITLE = 'Custom connectors are not available yet.';
export const CUSTOM_LOADING_TITLE = 'Checking whether you can add a custom connector…';

/** The Worker's limit (`CUSTOM_LIMITS.servers`), used only when the list has not said it. */
const SERVERS_LIMIT = 10;

/**
 * What `list()` answered, as the page draws it:
 *   loading     — not settled: the entry stays disabled;
 *   off         — 404 (the flag is off, or the member is neither a founder nor
 *                 an admin): the entry as on main, and nothing else;
 *   refused     — 403, a support session: the entry disabled, titled with the Worker's sentence;
 *   upsell      — 402, below the plan: the entry opens the plan's upsell;
 *   ready       — 200: the entry opens the C26 form, and the servers are listed;
 *   unreadable  — anything else (a 5xx, a timeout): the group says Unavailable,
 *                 and the servers last read stay on screen.
 */
export function customState(result, { error = null, previous = null } = {}) {
  if (error) {
    const status = Number(error.status) || 0;
    if (status === 404) return { state: 'off', servers: [], limits: null, message: '' };
    if (status === 402) return { state: 'upsell', servers: [], limits: null, message: String(error.data?.message || error.message || '') };
    if (status === 403) return { state: 'refused', servers: [], limits: null, message: String(error.message || '') };
    return { state: 'unreadable', servers: previous?.servers ?? [], limits: previous?.limits ?? null, message: String(error.message || '') };
  }
  if (result === undefined) return { state: 'loading', servers: previous?.servers ?? [], limits: previous?.limits ?? null, message: '' };
  const servers = Array.isArray(result?.servers) ? result.servers.filter((s) => s && typeof s.uid === 'string') : [];
  return { state: 'ready', servers, limits: result?.limits ?? null, message: '' };
}

/** The Add menu entry for a state: whether it is enabled, what it opens, and its tooltip. */
export function customEntry(custom) {
  const state = custom?.state || 'loading';
  if (state === 'ready') return { enabled: true, opens: 'form', title: undefined, comingSoon: false };
  if (state === 'upsell') return { enabled: true, opens: 'upsell', title: undefined, comingSoon: false };
  if (state === 'loading') return { enabled: false, opens: null, title: CUSTOM_LOADING_TITLE, comingSoon: true };
  if (state === 'refused' && custom.message) return { enabled: false, opens: null, title: custom.message, comingSoon: true };
  return { enabled: false, opens: null, title: CUSTOM_OFF_TITLE, comingSoon: true };
}

/** Whether the Custom servers group is drawn: only once the list has been read, or a read of it failed. */
export function showCustomGroup(custom) {
  const state = custom?.state;
  if (state === 'ready') return custom.servers.length > 0;
  return state === 'unreadable';
}

/** A server's name: its host, as the Worker gives it (`view().host`). */
export const serverName = (s) => s?.host || 'A server whose address could not be read';

const LAST_ERROR = {
  token_rejected: 'The sign-in to this server has expired. Remove it and connect it again.',
  unreachable: 'This server could not be reached at the last check.',
  mcp_tool_drift: 'An approved tool changed or is gone since you approved it.',
};

/** The status pill and the sentence under it, from the row's `status` and `last_error`. */
export function serverStatus(s) {
  const why = s?.last_error ? (LAST_ERROR[s.last_error] || `Last error: ${s.last_error}`) : '';
  if (s?.status === 'active' && !why) return { label: 'Connected', tone: 'ok', why: '' };
  if (s?.status === 'active') return { label: 'Connected', tone: 'warn', why };
  if (s?.status === 'error') return { label: 'Needs attention', tone: 'danger', why };
  return { label: s?.status ? String(s.status) : 'Not recorded', tone: 'neutral', why };
}

/** "N approved tools", from the row's `approved[]`. */
export function approvedLabel(s) {
  const n = Array.isArray(s?.approved) ? s.approved.length : 0;
  return n === 1 ? '1 approved tool' : `${n} approved tools`;
}

/** What one `POST /:uid/health` answered, said in one line. */
export function healthLine(out) {
  const drift = Array.isArray(out?.drift) ? out.drift : [];
  if (out?.status === 'ok') return { tone: 'ok', text: 'Reachable and signed in. Every approved tool is as you approved it.' };
  if (out?.status === 'drift') {
    const names = drift.map((d) => d?.tool).filter((t) => typeof t === 'string');
    return { tone: 'warn', text: `Reachable, but ${names.length === 1 ? 'one approved tool' : `${names.length} approved tools`} changed since you approved ${names.length === 1 ? 'it' : 'them'}${names.length ? `: ${names.join(', ')}` : ''}.` };
  }
  if (out?.status === 'unauthorized') return { tone: 'danger', text: LAST_ERROR.token_rejected };
  return { tone: 'danger', text: 'This server could not be reached. Try again in a minute.' };
}

/**
 * One tool's row in the Tools view. Only a tool the server marks read-only
 * can be approved (`tool_writes`); one approved whose schema has changed since
 * is flagged and offered again.
 */
export function toolRow(t) {
  const approved = t?.approved === true;
  const changed = approved && t?.changed === true;
  if (!t?.read_only) return { can: false, approved, changed, note: approved ? 'Writes: approved earlier, and cannot be approved again.' : 'Writes, so it cannot be approved.' };
  return { can: true, approved, changed, note: changed ? 'Changed since you approved it' : '' };
}

const RETURN_LINES = {
  access_denied: 'The sign-in to that server was cancelled, so nothing was connected.',
  invalid_state: 'That sign-in had expired or was already used, so nothing was connected. Start again.',
  csrf_mismatch: 'That sign-in did not start in this browser, so nothing was connected. Start again here.',
  missing_code: 'The server sent no sign-in code back, so nothing was connected.',
  not_allowed: 'Your account cannot add a custom connector now, so nothing was connected.',
  sign_in_failed: 'The sign-in to that server did not finish, so nothing was connected.',
};

/**
 * The Worker's return from a server's sign-in (`GET /oauth/callback`):
 * `?custom=ok&uid=…` or `?custom=error&reason=…`. One line for each, and the
 * keys to strip from the address once it is shown. Null when there is none.
 */
export function customReturn(search, { servers = [], limits = null } = {}) {
  const p = new URLSearchParams(search || '');
  const outcome = p.get('custom');
  if (outcome !== 'ok' && outcome !== 'error') return null;
  const strip = ['custom', 'uid', 'reason'];
  if (outcome === 'ok') {
    const uid = p.get('uid') || '';
    const server = (servers || []).find((s) => s?.uid === uid);
    const name = server?.host ? `${server.host} is connected.` : 'Your server is connected.';
    return { tone: 'ok', uid, text: `${name} Choose which of its read-only tools Eadwyn may use.`, strip };
  }
  const reason = p.get('reason') || '';
  if (reason === 'too_many') {
    const n = Number(limits?.servers) || SERVERS_LIMIT;
    return { tone: 'danger', uid: '', text: `At most ${n} servers can be connected, so nothing was connected. Remove one first.`, strip };
  }
  // Only the map's own keys: `?reason=constructor` cannot reach Object's methods.
  const line = Object.hasOwn(RETURN_LINES, reason) ? RETURN_LINES[reason] : 'The server’s sign-in did not finish, so nothing was connected.';
  return { tone: 'danger', uid: '', text: line, strip };
}

/** Only an https address the Worker handed back is followed. */
export function safeAuthorizeUrl(u) {
  try {
    const url = new URL(String(u || ''));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}
