/**
 * D6205 (#6205): what an investor's request to HQ for a mark reads as, on
 * Positions. Pure; the page and its tests share it.
 *
 * A request is one of three kinds, answered by HQ in `routes/mark_requests.ts`:
 *   mark        no mark, or a stale one: please record a current mark
 *   correction  the recorded mark is wrong
 *   follow_on   a follow-on round is missing from the book
 * Its state is Requested (open) until HQ resolves or declines it, and the
 * line says the date it speaks for. A Worker `detail` never reaches the page:
 * a refusal is read by its `code`.
 */
import { day } from './portfolioModel';

export const REQUEST_KINDS = Object.freeze([
  { value: 'mark', label: 'Record a current mark' },
  { value: 'correction', label: 'Correct the recorded mark' },
  { value: 'follow_on', label: 'Record a missing follow-on round' },
]);

const KIND_LABEL = Object.fromEntries(REQUEST_KINDS.map((k) => [k.value, k.label]));
export const kindLabel = (kind) => KIND_LABEL[kind] || null;

export const REASON_MAX = 2000;

/**
 * Each company's request as the page shows it: the open one when there is
 * one, else the latest answered one. `items` is `GET /api/mark-requests`'s
 * list, newest first.
 */
export function requestsByCompany(items) {
  const out = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const uid = it && it.project_uid;
    if (!uid) continue;
    const held = out.get(uid);
    if (!held) { out.set(uid, it); continue; }
    if (held.state !== 'open' && it.state === 'open') out.set(uid, it);
  }
  return out;
}

/** `{ state, label, date, kind, reason, markUid, note }` for one request, or null for none. */
export function requestStatusOf(req) {
  if (!req || typeof req !== 'object') return null;
  const kind = kindLabel(req.kind);
  if (req.state === 'open') {
    const date = day(req.created_at);
    return { state: 'requested', label: date ? `Requested · ${date}` : 'Requested', date, kind, reason: req.reason || null, markUid: null, note: null };
  }
  if (req.state === 'resolved' || req.state === 'declined') {
    const date = day(req.resolved_at);
    const word = req.state === 'resolved' ? 'Resolved' : 'Declined';
    return {
      state: req.state, label: date ? `${word} · ${date}` : word, date, kind, reason: req.reason || null,
      markUid: req.resolved_mark_uid || null, note: req.resolution_note || null,
    };
  }
  return null;
}

/** The kind a new request starts on: a correction when a usable mark is recorded and current, otherwise a mark. */
export function defaultKind(row) {
  if (row && row.mark && row.mark.kind === 'marked' && row.stale !== true) return 'correction';
  return 'mark';
}

/** What a draft needs before it can be sent: null when it can be, else the sentence. */
export function draftProblem({ kind, reason }) {
  if (!KIND_LABEL[kind]) return 'Choose what you are asking HQ for.';
  const text = String(reason || '').trim();
  if (!text) return 'Say what is wrong or missing.';
  if (text.length > REASON_MAX) return `Keep the reason under ${REASON_MAX} characters.`;
  return null;
}

/** A refused request, in the page's own words. */
export function refusalWords(err) {
  switch (err && err.code) {
    case 'request_open': return 'You already have an open request for this company. HQ answers it before another can be sent.';
    case 'not_held': return 'A request can be sent only for a company you hold.';
    case 'investor_only': return 'Only an investor can send a request from this book.';
    case 'reason_required': case 'reason_too_long': case 'bad_kind': return 'The request was not accepted. Check what you are asking for and the reason.';
    default: return 'The request could not be sent. Nothing was recorded; try again.';
  }
}

/* ---------------------------------------------------------------- HQ's side
 * D6205 part 2: the admin position sheet lists one company's requests and
 * answers the open ones (`PATCH /api/mark-requests/:uid`). The rules below are
 * the Worker's own, so the form never offers an answer it would refuse:
 *   resolved  a mark or a correction links a mark of this company; a
 *             follow-on says how in a note
 *   declined  always says why in a note
 */

/** One company's requests for HQ: open ones first (oldest first, the queue), then answered ones, newest first. */
export function adminRequestsOf(items) {
  const list = (Array.isArray(items) ? items : []).filter((it) => it && it.uid);
  const open = list.filter((it) => it.state === 'open').sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const answered = list.filter((it) => it.state !== 'open').sort((a, b) => String(b.resolved_at || '').localeCompare(String(a.resolved_at || '')));
  return { open, answered };
}

/** Who asked, as HQ reads it. A requester without a recorded name is said to be not recorded, never guessed. */
export const requesterOf = (req) => (req && req.requester && req.requester.name) || 'Investor (name not recorded)';

/** Whether resolving this kind of request must link a mark. */
export const needsMark = (kind) => kind === 'mark' || kind === 'correction';

/** What an answer needs before it can be sent: null when it can be, else the sentence. */
export function answerProblem({ kind, state, markUid, note }) {
  const text = String(note || '').trim();
  if (text.length > REASON_MAX) return `Keep the note under ${REASON_MAX} characters.`;
  if (state === 'resolved') {
    if (needsMark(kind) && !markUid) return 'Choose the mark recorded for this request.';
    if (!needsMark(kind) && !text) return 'Say how the follow-on round was recorded.';
    return null;
  }
  if (state === 'declined') return text ? null : 'Say why the request is declined.';
  return 'Choose Resolve or Decline.';
}

/** The mark an answer starts on: the one just recorded through the write flow, when it is this company's. */
export function defaultMarkUid(marks, justRecorded) {
  const uids = (Array.isArray(marks) ? marks : []).map((m) => m && m.uid).filter(Boolean);
  return justRecorded && uids.includes(justRecorded) ? justRecorded : '';
}

/** A refused answer, in the sheet's own words. */
export function answerRefusalWords(err) {
  switch (err && err.code) {
    case 'request_answered': return 'This request was already answered. The list is read again.';
    case 'mark_not_found': return 'That mark is not recorded for this company. Choose one from its history.';
    case 'mark_required': return 'Choose the mark recorded for this request.';
    case 'note_required': return 'Say how the request was answered.';
    default: return 'The answer could not be saved. Nothing was changed; try again.';
  }
}
