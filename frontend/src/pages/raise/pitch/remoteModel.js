/**
 * D1581 (#3828, canvas PR1 to PR6 in `design/incoming/Pitch · Boards.dc.html`):
 * pairing a phone to Present, in plain words. Pure: no React, no network.
 *
 * The Worker is `routes/deck_remote.ts` (`deckRemoteApi`): a six-digit code,
 * ten minutes, one phone; a new code ends the phone before it; a paired phone
 * stays for up to four hours or until Unpair. A wrong code, an expired code and
 * a deck the member cannot open all answer the same, so the page says one thing.
 */
export const REMOTE_PATH = '/remote';
export const REMOTE_BUTTON = 'Phone remote';
export const REMOTE_ON = 'Phone remote · on';
export const UNPAIR = 'Unpair phone';
export const PANEL_TITLE = 'Use your phone as a remote';
export const NEW_CODE = 'Get a new code';
export const MAKING = 'Getting a code…';
export const EXPIRED = 'This code expired';
export const REMOTE_OFF = 'The phone remote is off right now.';
export const PAIR_FAILED = 'A code couldn’t be made. Try again.';
export const PAGE_TITLE = 'Control a presentation';
export const CONNECT = 'Connect';
export const CONNECTING = 'Connecting…';
export const FIND_CODE = 'Find the code on the screen that’s presenting';
export const DIDNT_WORK = 'That code didn’t work. Check the screen for the current code.';
export const TOO_MANY = 'Too many tries. Wait a minute, then try again.';
export const SIGNED_OUT = 'Sign in to Axal VC to control this presentation';
export const NOT_PRESENTING = 'The deck isn’t open in Present on the screen.';
export const DISCONNECTED = 'This phone was disconnected. A new code was made or the presenter unpaired.';
export const ENTER_NEW = 'Enter a new code';
export const STEP_FAILED = 'Couldn’t reach the screen. Try again.';
export const DISCONNECT = 'Disconnect';

/** "482 913": the code in two groups of three, as PR1 draws it. */
export const groupCode = (code) => {
  const d = String(code || '').replace(/\D/g, '');
  return d.length === 6 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
};

/** What a screen reader hears: the code digit by digit. */
export const spokenCode = (code) => String(code || '').replace(/\D/g, '').split('').join(' ');

/** The digits a box or a paste holds, at most six. */
export const digitsOf = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 6);

/** Six boxes from a string: each one digit or empty. */
export const boxesOf = (code) => Array.from({ length: 6 }, (_, i) => digitsOf(code)[i] || '');

/** Seconds left until `expiresAt`, never below 0; null when it cannot be read. */
export function secondsLeft(expiresAt, now = Date.now()) {
  const t = Date.parse(String(expiresAt || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(expiresAt || '')) ? '' : 'Z'));
  return Number.isFinite(t) ? Math.max(0, Math.floor((t - now) / 1000)) : null;
}

/** "Expires in 9:42". */
export const expiresLine = (left) => (left == null ? null : `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);

/** The countdown read aloud at most once a minute: the whole minutes left, or null between them. */
export const spokenMinute = (left) => (left != null && left % 60 === 0 && left > 0 ? `${left / 60} minute${left === 60 ? '' : 's'} left` : null);

/** The link a QR code opens on the phone. */
export const remoteLink = (origin, code) => `${String(origin || '').replace(/\/+$/, '')}${REMOTE_PATH}?code=${digitsOf(code)}`;

/** The sign-in link that comes back to this page with the code kept (PR2d). */
export const signInHref = (code) => `/login?next=${encodeURIComponent(digitsOf(code) ? `${REMOTE_PATH}?code=${digitsOf(code)}` : REMOTE_PATH)}`;

const statusOf = (e) => Number(e?.status ?? e?.response?.status ?? 0) || null;
const codeOf = (e) => String(e?.code || e?.data?.code || e?.data?.error || '');

/** Present's pair press: the panel's state for a refusal. */
export function pairRefusal(e) {
  if (statusOf(e) === 503 || codeOf(e) === 'remote_off') return 'off';
  return 'error';
}

/** The phone's join press: which PR2 state a refusal is. Wrong, expired and no access are one answer. */
export function joinRefusal(e) {
  const s = statusOf(e);
  if (s === 401) return 'signed_out';
  if (s === 429) return 'too_many';
  if (s === 503 || codeOf(e) === 'remote_off') return 'off';
  return 'didnt_work';
}

/** A step's outcome on the phone (PR4): delivered, not presenting, disconnected or failed. */
export function stepOutcome(result, error = null) {
  if (error) return statusOf(error) === 409 || codeOf(error) === 'remote_not_paired' ? 'disconnected' : 'failed';
  return result?.delivered === false ? 'not_presenting' : 'ok';
}

/** The card a step lands on, from 0 to n - 1: the phone sends that card, so it and the screen agree. */
export function cardAfter(i, step, n) {
  const last = Math.max(0, (Number(n) || 0) - 1);
  const at = Math.min(Math.max(0, Number(i) || 0), last);
  if (step === 'next') return Math.min(at + 1, last);
  if (step === 'prev') return Math.max(at - 1, 0);
  if (step === 'first') return 0;
  if (step === 'last') return last;
  return at;
}
