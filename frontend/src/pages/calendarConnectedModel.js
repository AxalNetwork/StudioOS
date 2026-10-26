/**
 * D1212 (#3178, part 7 of #2420) — the connected calendars (CAL9), the Google
 * connection (CAL10), the disconnect dialog (CAL10d), Subscribe (CAL11) and the
 * phone's week strip (CAL21a). Pure, so
 * `frontend/test/calendar_connected_d1212.test.mjs` holds each rule.
 *
 * What is read:
 * - Google and Outlook: `GET /api/calendar/google/status` and `/microsoft/status`,
 *   with D1209's `sync_error` and `sync_error_read`;
 * - Calendly and Zoom: the member's connections (`GET /api/connectors`), one row each;
 * - Subscribe: `GET /api/calendar/subscription`, which never returns the link.
 * No status read carries a count of copies, so none is drawn.
 */

/** The addresses: the list, and Google's own panel. */
export const CONNECTED_PATH = '/calendar/connected';
export const GOOGLE_PATH = '/calendar/connected/google';

/** Which panel an address opens: 'list', 'google', or null. */
export function connectedOf(pathname = '') {
  const p = String(pathname).replace(/\/+$/, '');
  if (p === GOOGLE_PATH) return 'google';
  if (p === CONNECTED_PATH) return 'list';
  return null;
}

/** CAL9's six states, in the canvas's order, each with its pill and tone. */
export const STATES = Object.freeze([
  { key: 'reading', mark: '◌', label: 'Checking', tone: 'n' },
  { key: 'unconfigured', mark: '–', label: 'Not set up on Axal yet', tone: 'n' },
  { key: 'off', mark: '–', label: 'Not connected', tone: 'n' },
  { key: 'connected', mark: '✓', label: 'Connected', tone: 'g' },
  { key: 'failed', mark: '!', label: 'Last copy failed', tone: 'a' },
  { key: 'unreadable', mark: '✕', label: 'Could not be read', tone: 'r' },
]);
export const stateOf = (key) => STATES.find((s) => s.key === key) || STATES[0];

/** "10 Nov 09:12", or null when the stamp is missing or not a date. */
export function stamp(at) {
  if (!at) return null;
  const d = new Date(String(at).includes('T') ? at : `${String(at).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
const clock = (at) => stamp(at)?.split(' ').at(-1) || null;

/** A failed state's pill: "! Last copy failed · 10:12 · Reconnect", the time only when recorded. */
export function pillText(key, status = null) {
  const s = stateOf(key);
  if (key !== 'failed') return `${s.mark} ${s.label}`;
  const at = clock(status?.sync_error?.at);
  return `${s.mark} ${s.label}${at ? ` · ${at}` : ''} · Reconnect`;
}

/** Calendly's and Zoom's state from the connections list (`null` when it was not read). */
export function connectorState(items, key) {
  if (items === undefined) return 'reading';
  if (!Array.isArray(items)) return 'unreadable';
  const row = items.find((r) => r?.provider_key === key && r?.status === 'active');
  if (!row) return 'off';
  return row.last_error ? 'failed' : 'connected';
}

const NAMES = { google: 'Google Calendar', microsoft: 'Outlook', calendly: 'Calendly', zoom: 'Zoom' };
const LETTER = { google: 'G', microsoft: 'O', calendly: 'C', zoom: 'Z' };
const CONNECTOR_PAGE = { calendly: '/account/connectors/calendly', zoom: '/account/connectors/zoom' };

/**
 * One CAL9 row: its title, sub-line, pill and actions. Google and Outlook copy
 * out; Calendly brings bookings in; Zoom makes links. The provider's own error
 * text is never shown: D1209 stores a code and its one sentence.
 */
export function connectionRow(key, state, status = null) {
  const name = NAMES[key];
  const base = { key, name, letter: LETTER[key], state, pill: pillText(state, status), tone: stateOf(state).tone };
  if (key === 'calendly' || key === 'zoom') {
    const sub = key === 'calendly'
      ? 'Brings your Calendly bookings in. They are not copied back out.'
      : 'Makes Zoom links for interview calls.';
    const failed = state === 'failed' ? ' The last sync was refused; its connector page says what to do.' : '';
    const unread = state === 'unreadable' ? ' Whether it is connected could not be read. This is not a claim that it is not.' : '';
    const label = state === 'connected' || state === 'failed' ? 'Manage on the connector page ↗' : 'Open its connector page ↗';
    return { ...base, sub: `${sub}${failed}${unread}`, actions: state === 'reading' ? [] : [{ key: 'page', label, to: CONNECTOR_PAGE[key] }] };
  }
  const where = key === 'google' ? 'your Google calendar' : 'Outlook';
  const last = stamp(status?.last_synced_at);
  const lastLine = last ? `Last copy ${last}.` : 'No copy has run yet.';
  switch (state) {
    case 'connected':
      return {
        ...base,
        sub: `Copies your StudioOS meetings, sessions and events to ${where}. ${lastLine}${status?.sync_error_read === false ? ' Whether the last copy worked could not be read.' : ''}`,
        actions: [{ key: 'sync', label: 'Copy now' }, key === 'google' ? { key: 'manage', label: 'Manage', to: GOOGLE_PATH } : { key: 'disconnect', label: 'Disconnect…' }],
      };
    case 'failed':
      return {
        ...base,
        sub: `${status?.sync_error?.message || 'The last copy did not finish.'} ${last ? `The ${last} copy is the latest in ${where}.` : 'No copy has finished yet.'}`,
        actions: [{ key: 'connect', label: 'Reconnect', primary: true }, key === 'google' ? { key: 'manage', label: 'Manage', to: GOOGLE_PATH } : { key: 'disconnect', label: 'Disconnect…' }],
      };
    case 'off':
      return { ...base, sub: `Not connected. Nothing is written to ${key === 'google' ? 'Google' : 'Outlook'} until you connect.`, actions: [{ key: 'connect', label: 'Connect' }] };
    case 'unconfigured':
      return { ...base, sub: `Axal has not set up ${name} yet, so it cannot be connected. An admin adds its sign-in.`, actions: [] };
    case 'unreadable':
      return { ...base, sub: `Whether ${name} is connected could not be read. This is not a claim that it is not.`, actions: [{ key: 'retry', label: 'Try again' }] };
    default:
      return { ...base, sub: 'Checking…', actions: [] };
  }
}

/** CAL9's "What each option does". */
export const OPTIONS = Object.freeze([
  ['Copy', 'Ongoing, per calendar. New and changed items are copied.'],
  ['Copy one item', 'Once, from an item. Its line then reads Copied to Google.'],
  ['Subscribe', 'A private link any calendar app can follow. Read only.'],
]);

const has = (scope, s) => String(scope || '').split(/[\s,]+/).includes(s);
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const CAL_READ = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'];

/** CAL10: what Axal VC can do with this Google connection, from its scope and D1209's status read. */
export function googleAbilities(status = {}) {
  const scope = status?.scope;
  const meet = status?.meet_transcripts;
  return [
    { key: 'write', text: 'Add and update your StudioOS meetings in your Google calendar.', value: 'Always' },
    {
      key: 'read',
      text: 'Read your calendar, only to confirm a Meet link you attach to an interview.',
      value: CAL_READ.some((s) => has(scope, s)) ? 'Allowed' : 'Not allowed',
      ok: CAL_READ.some((s) => has(scope, s)),
    },
    meet === 'granted'
      ? { key: 'meet', text: 'Read Meet transcripts of your interview calls', value: 'Allowed', ok: true }
      : meet === 'available'
        ? { key: 'meet', text: 'Read Meet transcripts of your interview calls', sub: 'It is set up on Axal, and you have not allowed it.', value: 'Not allowed' }
        : { key: 'meet', text: 'Read Meet transcripts of your interview calls', sub: 'Once it is set up and you allow it, this reads Allowed, with Stop.', pill: '– Not set up on Axal yet' },
    { key: 'files', text: 'Open the Google files you choose', sub: 'On the Google Workspace page, /account/connectors/google_workspace.', to: '/account/connectors/google_workspace', link: 'Open ↗' },
  ];
}
export const gmailStillGranted = (status) => status?.connected === true && has(status?.scope, GMAIL_SCOPE);

/** CAL10d, per provider. The count of copies is not read, so the choice names none. */
export function disconnectCopy(provider) {
  const google = provider === 'google';
  return {
    title: google ? 'Disconnect Google?' : 'Disconnect Outlook?',
    note: google ? 'Axal VC’s access is withdrawn at Google.' : 'Axal VC’s saved connection to Outlook is removed.',
    bullets: google
      ? ['You can no longer sign in with Google.', 'Meet transcripts and Google files stop too.']
      : ['Nothing new is copied to Outlook.'],
    keep: { label: 'Keep the copies already in your calendar', sub: 'The default.' },
    remove: { label: 'Remove the copies first', sub: 'They are removed before access ends.' },
  };
}

/** The sentence a refused disconnect is shown with, from the Worker's code. */
export function disconnectRefusal(e) {
  const code = e?.code || e?.data?.code || e?.data?.error?.code;
  if (code === 'copies_not_removed') return { text: 'Some copies could not be removed from your calendar, so nothing was disconnected. Try again, or disconnect and keep them.', local: false };
  if (code === 'google_revocation_failed') return { text: 'Google did not confirm that access was withdrawn. Your connection is still saved, so you can try again.', local: true };
  return { text: 'It could not be disconnected. Try again.', local: false };
}

/** CAL11: the link with its token hidden. Copy copies the real one; the page never prints it. */
export function maskedLink(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/calendar\.ics$/, '')}••••••••.ics`;
  } catch {
    return null;
  }
}

/** Subscribe's state: reading, unreadable, off, on, or made (the link is in hand, once). */
export function subscribeState(read, made) {
  if (made?.url) return 'made';
  if (read === undefined) return 'reading';
  if (read === null) return 'unreadable';
  return read.subscribed ? 'on' : 'off';
}

const DAY = 86_400_000;
const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * CAL21a's week strip: Monday to Sunday of the anchor's week, each day with its
 * items' kinds (up to four markers) and a label that says how many, or nothing
 * when the list was not read.
 */
export function weekStrip(anchor, items, today = new Date()) {
  const a = new Date(anchor); a.setHours(0, 0, 0, 0);
  const monday = new Date(a.getTime() - ((a.getDay() + 6) % 7) * DAY);
  const read = Array.isArray(items);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const list = read ? items.filter((e) => { const s = new Date(e.start_at); return !Number.isNaN(s.getTime()) && key(s) === key(d); }) : [];
    const n = list.length;
    return {
      key: key(d), date: d, letter: LETTERS[i], day: d.getDate(),
      kinds: list.slice(0, 4).map((e) => e.kind),
      isToday: key(d) === key(today), selected: key(d) === key(a),
      label: `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })}${read ? `, ${n} ${n === 1 ? 'item' : 'items'}` : ''}`,
    };
  });
}

/** "Week of 9 November". */
export const stripLabel = (strip) => `Week of ${strip[0].day} ${strip[0].date.toLocaleDateString('en-GB', { month: 'long' })}`;
