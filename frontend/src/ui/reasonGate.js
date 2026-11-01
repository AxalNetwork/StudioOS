/**
 * D1463 (#3713): the words and rules of the one reason gate an admin meets
 * before reading a founder's private record (`ui/ReasonGate.jsx`), and of the
 * banner that heads the record while the read lasts. Pure, so the tests read
 * it without a page.
 *
 * Each record keeps its own Worker rule (Q2 A, pending owner):
 *   - the Investor narrative: a grant, 8 hours, 3–200 characters (D914);
 *   - the Cap table: one open, 10–500 characters (D1019);
 *   - the Data room: one open, 1–500 characters (D1191);
 *   - Capital relationships: one open, 1–500 characters (D1191).
 * The limits come from the record (`min`, `max`), never one shared number.
 */

/** Q5 A (pending owner): four fixed picks. Each is long enough for every record's minimum. */
export const REASON_CHIPS = Object.freeze(['Quarterly portfolio review', 'Support request', 'Due diligence', 'Programme review']);

export const FOUNDER_SEES = 'The founder sees this reason, who gave it and when.';
export const EVERY_OPEN = 'Every open is recorded.';
export const FIELD_LABEL = 'Reason the founder will see · required';
export const PLACEHOLDER = 'For example: quarterly portfolio review';
export const PREVIEW_LINE = 'Opens read only after you give a reason.';
export const SAVE_REFUSED = 'The reason could not be saved. Try again.';
export const OPEN_LABEL = 'Open read only';
export const OPENING = 'Opening…';
export const FOUNDER_RECORD_OFF = 'Eadwyn is off while you read a founder’s record.';
export const END_ACCESS = 'End access now';
export const END_TITLE = 'End your read now?';
export const END_BODY = 'The founder’s list shows it ended early. To read again you give a new reason.';
export const END_FAILED = 'Your read could not be ended. Try again.';
export const ENDED_EARLY = 'Ended early';
export const ONE_OPEN = 'one open';

const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** "Why are you opening this narrative?" — `what` is "this narrative", "this cap table", … */
export const gateQuestion = (what) => `Why are you opening ${what}?`;

/** The record's duration rule, in the gate's second line. */
export function ruleLine(rule) {
  if (rule?.kind === 'grant') {
    const h = Number(rule.hours);
    if (!Number.isFinite(h) || h <= 0) return null;
    return `Access lasts ${h} ${h === 1 ? 'hour' : 'hours'}.`;
  }
  if (rule?.kind === 'per_open') return 'This opens once; each open asks again.';
  return null;
}

/**
 * The reason as the field holds it, checked as the record's Worker checks it.
 *   - `count`: the characters that will be sent (spaces squashed, trimmed);
 *   - `ok`: it may be sent;
 *   - `tone`: 'hint' for too short (muted: nothing is wrong yet), 'error' for
 *     over the limit (red), null when there is nothing to say;
 *   - `message`: the line under the field.
 * `short` replaces the too-short sentence where a record has its own words.
 */
export function reasonCheck(text, { min = 1, max = 500, short = null } = {}) {
  const count = squash(text).length;
  if (count === 0) return { count, ok: false, tone: null, message: null };
  if (count < min) return { count, ok: false, tone: 'hint', message: short || `Write a reason of at least ${min} ${min === 1 ? 'character' : 'characters'}.` };
  if (count > max) return { count, ok: false, tone: 'error', message: `A reason is at most ${max} characters.` };
  return { count, ok: true, tone: null, message: null };
}

/** A D1 time ("YYYY-MM-DD HH:MM:SS", UTC) or an ISO string, as epoch ms; null when unreadable. */
export function timeOf(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The banner's countdown to `endsAt`, in whole minutes rounded up, so the
 * last minute reads "1 m" until it is over. Null when the end is not read:
 * the banner then draws no countdown, never a guessed one.
 */
export function countdown(endsAt, now = Date.now()) {
  const end = timeOf(endsAt);
  if (end == null) return null;
  const ms = end - now;
  if (ms <= 0) return { ms: 0, text: '0 m', lastMinute: true, over: true };
  const minutes = Math.ceil(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { ms, text: h ? `${h} h ${m} m` : `${m} m`, lastMinute: ms <= 60_000, over: false };
}

/** RR06: the line above the gate once a grant has run out. */
export function endedLine(hours, endedAt) {
  const at = timeOf(endedAt);
  const clock = at == null ? null : new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const span = Number.isFinite(Number(hours)) && Number(hours) > 0 ? `${Number(hours)}-hour ` : '';
  return clock ? `Your ${span}read ended at ${clock}.` : `Your ${span}read ended.`;
}

/** The banner's words: who it is for, and for what. */
export function bannerLine({ access, reason }) {
  const who = access ? `Read only · ${access} access` : 'Read only';
  const why = squash(reason);
  return why ? `${who} for ${why}` : who;
}

/** "HQ" for the Super Admin, "Studio admin" for an Admin — the pill and the banner. */
export const accessWord = (viewer) => (viewer === 'super_admin' ? 'HQ' : viewer === 'admin' ? 'Studio admin' : null);

/**
 * What a refused open draws. A refusal no button can clear draws no Try
 * again and no form (RR17, RR18):
 *   - 'owner'    the venture's owner can't be resolved (409 `support_owner_unresolved`): muted;
 *   - 'refused'  the Worker refuses this admin (403): plain, no form;
 *   - 'reason'   the Worker refused the reason's length (400): at the field, the field kept;
 *   - 'save'     anything else: red under the field, the field kept, Try again by sending.
 */
export function refusalView(error) {
  const status = Number(error?.status);
  const code = String(error?.data?.code || error?.code || '');
  if (code === 'support_owner_unresolved' || status === 409) {
    return { kind: 'owner', retry: false, message: error?.data?.message || 'Support access cannot be recorded for this venture owner.' };
  }
  if (status === 403 && code !== 'read_reason_required') {
    return { kind: 'refused', retry: false, message: error?.data?.message || error?.message || 'You do not have access to this record.' };
  }
  if (status === 400 || /reason/.test(code)) {
    return { kind: 'reason', retry: true, message: error?.data?.message || error?.message || SAVE_REFUSED };
  }
  return { kind: 'save', retry: true, message: SAVE_REFUSED };
}

/**
 * The founder's row's right-hand word for one grant: "Ended early" once the
 * Worker records an early end (D1463 G1, `ended_at`), else its length in
 * hours from its own times, else nothing.
 */
export function grantSpan(read) {
  if (read?.ended_at) return ENDED_EARLY;
  const from = timeOf(read?.created_at);
  const to = timeOf(read?.expires_at);
  if (from == null || to == null || to <= from) return null;
  const h = Math.round((to - from) / 3_600_000);
  return h > 0 ? `${h} h` : null;
}
