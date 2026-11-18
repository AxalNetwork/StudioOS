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
import { day, daysBetween } from './portfolioModel';

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
    // D6909 (PRM21): a resolved request reads Answered, and says a mark was recorded when it links one.
    const markUid = req.resolved_mark_uid || null;
    const word = req.state === 'resolved' ? (markUid ? 'Answered · mark recorded' : 'Answered') : 'Declined';
    return {
      state: req.state, label: date ? `${word} · ${date}` : word, date, kind, reason: req.reason || null,
      markUid, note: req.resolution_note || null,
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

/* ------------------------------------------------- D6909 part 2 (PRM20–PRM23)
 * Request a mark as Prepare → Review → Confirm → Receipt, with optional
 * evidence, the investor's requests for one company, and HQ's queue across
 * companies. The evidence rules are the Worker's own (routes/mark_requests.ts),
 * so the sheet never offers a request it would refuse.
 */

export const REQUEST_STEPS = Object.freeze(['Prepare', 'Review', 'Confirm', 'Receipt']);
export const DECLINE_STEPS = Object.freeze(['Scope', 'Review', 'Result']);
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_TYPES = Object.freeze(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
export const EVIDENCE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
const EVIDENCE_EXT = /\.(pdf|png|jpe?g|webp)$/i;
export const URL_MAX = 2000;

/** A link as evidence: http or https, no credentials, at most 2,000 characters. Null when it is not one. */
export function evidenceLink(value) {
  const text = String(value || '').trim();
  if (!text || text.length > URL_MAX) return null;
  let u;
  try { u = new URL(text); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return u.toString();
}

/** The draft's evidence problem: null when none is given or it is usable, else the sentence. */
export function evidenceProblem({ link, file } = {}) {
  const hasLink = Boolean(String(link || '').trim());
  if (hasLink && file) return 'Give a link or a file, not both.';
  if (hasLink && !evidenceLink(link)) return 'The link must be an http or https address of at most 2,000 characters.';
  if (file) {
    const typed = EVIDENCE_TYPES.includes(String(file.type || '').toLowerCase()) || EVIDENCE_EXT.test(String(file.name || ''));
    if (!typed) return 'Evidence must be a PDF, PNG, JPEG or WebP file.';
    if (!(Number(file.size) > 0)) return 'The file is empty.';
    if (Number(file.size) > EVIDENCE_MAX_BYTES) return 'Evidence files are at most 10 MB.';
  }
  return null;
}

/** File size in words: `[2.4 MB]`, `[820 KB]`. Null when not a size. */
export function sizeWords(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** A stored request's evidence in words, or null for none. The storage key is never handed out. */
export function evidenceWords(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  if (evidence.kind === 'link' && evidence.url) return evidence.url;
  if (evidence.kind === 'file') {
    const size = sizeWords(evidence.size_bytes);
    return `${evidence.name || 'File'}${size ? ` · ${size}` : ''}`;
  }
  return null;
}

/** The draft's evidence in words, for Review and Confirm. */
export function draftEvidenceWords({ link, file } = {}) {
  if (file) { const size = sizeWords(file.size); return `${file.name || 'File'}${size ? ` · ${size}` : ''}`; }
  const url = evidenceLink(link);
  return url || 'None';
}

/** Everything that stops Prepare from moving to Review: null when it can. */
export function prepareProblem(draft) {
  return draftProblem(draft) || evidenceProblem(draft);
}

/** One company's requests, newest first: what the mark-history Sheet lists. */
export function companyRequests(items, projectUid) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && it.uid && it.project_uid === projectUid)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/** "3 requests · 1 open", never a count that hides an unread list. */
export function requestCountWords(list) {
  const n = list.length;
  const open = list.filter((r) => r.state === 'open').length;
  return `${n} request${n === 1 ? '' : 's'} · ${open} open`;
}

/** HQ's queue as rows: oldest first as the Worker sent it, each with its age in days on `today`. */
export function queueRows(items, today) {
  return (Array.isArray(items) ? items : []).filter((it) => it && it.uid && it.state === 'open').map((it) => {
    const age = daysBetween(it.created_at, today);
    return {
      uid: it.uid, projectUid: it.project_uid, company: it.project_name || 'Company not recorded',
      requester: requesterOf(it), kind: kindLabel(it.kind) || 'Request', reason: it.reason || '',
      evidence: evidenceWords(it.evidence), hasFile: Boolean(it.evidence && it.evidence.kind === 'file'),
      // Only an http or https link becomes an address; anything else is shown as text.
      href: it.evidence && it.evidence.kind === 'link' ? evidenceLink(it.evidence.url) : null,
      requestedOn: day(it.created_at), age: age == null ? null : `${Math.max(0, age)} d`,
      latestMark: it.latest_mark && it.latest_mark.uid ? `${day(it.latest_mark.as_of_date) || 'Date not recorded'}` : null,
    };
  });
}

/** What a decline needs before it can go to Review: null when it can, else the sentence. */
export function declineProblem(note) {
  return answerProblem({ state: 'declined', note });
}
