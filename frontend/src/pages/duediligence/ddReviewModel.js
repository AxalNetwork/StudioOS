/**
 * D1252 (#3267, part 8 of #2385) — the reviewer's and the subject's views of
 * Due diligence, pure, so `frontend/test/dd_reviewer_views_d1252.test.mjs`
 * holds each rule:
 *
 *   - My reviews (DDL12a) from `GET /api/dd/my-reviews` (D1249);
 *   - the reviewer's banner and steps on a case (DDL12b) from the case read
 *     when it is scoped to their sections (`case.scoped`);
 *   - the subject's requests (DDL15) from `GET /api/dd/requests/mine`, with
 *     due dates (D1248) and an answer by a data-room file.
 *
 * Access is the Worker's (`routes/dd.ts`): a reviewer's read holds only their
 * sections, and the subject's holds only the requests addressed to them,
 * never the case. Nothing here widens either. A value the read does not carry
 * is "Not recorded", never a zero.
 */
import { caseHref } from './ddModel';
import { NOT_RECORDED } from '../../lib/absence';

export { NOT_RECORDED };

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "21 Oct 2026" from a date or a timestamp, written out; null when it is not a date. */
export function fmtDay(v) {
  const m = DAY.exec(String(v ?? ''));
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${Number(m[3])} ${MONTHS[month - 1]} ${m[1]}`;
}

const dayNumber = (v) => {
  const m = DAY.exec(String(v ?? ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
};

/** A case id as the canvas writes it: "7f3a…21c9". */
export const shortId = (uid) => {
  const s = String(uid ?? '');
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
};

export const VERDICT_WORD = Object.freeze({ pass: 'Pass', warn: 'Warn', fail: 'Fail', n_a: 'Not applicable' });
export const verdictWord = (v) => VERDICT_WORD[v] || 'No verdict yet';

/** A reviewer's conflict declaration (D1249): not answered until they answer. */
export const CONFLICTS_WORD = Object.freeze({ none: 'None declared', declared: 'Declared' });
export const conflictsWord = (c) => CONFLICTS_WORD[c] || 'Not answered';

const count = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * DDL12a: one row per section the caller reviews. "Open section" opens the
 * case on the caller's own base with the section in focus.
 */
export function myReviewRows(items, base) {
  return (Array.isArray(items) ? items : []).map((r) => ({
    key: `${r.case_uid}:${r.section_id}`,
    caseLabel: r.subject_label || NOT_RECORDED,
    caseId: shortId(r.case_uid),
    section: r.section_title || NOT_RECORDED,
    observer: r.role === 'observer',
    invited: fmtDay(r.invited_at),
    ndaOnFile: Boolean(r.nda_signed_at),
    nda: r.nda_signed_at ? 'On file' : 'NDA missing',
    pending: count(r.items_pending),
    verdict: verdictWord(r.verdict),
    conflicts: conflictsWord(r.conflicts),
    expired: r.invite_expired === true,
    closed: r.case_status === 'completed' || r.case_status === 'archived',
    href: `${caseHref(base, r.case_uid, 'overview')}?section=${encodeURIComponent(r.section_id)}`,
  }));
}

/** My reviews' state: reading, could not be read, none, or the rows. */
export function myReviewsView(read, base) {
  if (!read || read.status === 'loading') return { status: 'loading', rows: [] };
  if (read.status !== 'ready' || !Array.isArray(read.data?.items)) return { status: 'unreadable', rows: [] };
  const rows = myReviewRows(read.data.items, base);
  return { status: rows.length ? 'ready' : 'empty', rows };
}

const pendingOf = (checklist, sectionId) => {
  const items = (Array.isArray(checklist) ? checklist : []).filter((i) => Number(i.section_id) === Number(sectionId));
  return { total: items.length, pending: items.filter((i) => i.status === 'pending').length };
};

/**
 * DDL12b: on a case read scoped to the viewer's sections, the banner and, for
 * each section, the steps: sign the NDA, declare conflicts, work the checklist
 * and record the verdict (an observer reads the section and does neither).
 * The current step is the first not done. A case read that is not scoped is
 * the deal team's, and draws none of this.
 */
export function reviewerView(data, userId) {
  if (!data?.case?.scoped) return null;
  const mine = (Array.isArray(data.reviewers) ? data.reviewers : []).filter((r) => Number(r.user_id) === Number(userId));
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const subject = data.case.subject_label || 'the subject';
  const cards = mine.map((r) => {
    const section = sections.find((s) => Number(s.id) === Number(r.section_id)) || {};
    const observer = r.role === 'observer';
    const { total, pending } = pendingOf(data.checklist, r.section_id);
    const steps = [
      { key: 'nda', title: 'Sign the NDA', done: Boolean(r.nda_signed_at),
        sub: r.nda_signed_at ? `Signed ${fmtDay(r.nda_signed_at) || 'on a date not recorded'}` : 'Upload your signed NDA for this section first. PDF, up to 10 MB.' },
      { key: 'conflicts', title: 'Declare conflicts', done: r.conflicts === 'none' || r.conflicts === 'declared',
        sub: r.conflicts === 'none' ? 'You declared no conflict.' : r.conflicts === 'declared' ? 'You declared a conflict. The case lead was told.' : `Tell the case lead about any interest in ${subject}.` },
      observer
        ? { key: 'work', title: 'Read the section', done: false, sub: 'As an observer you read this section. You do not work its checklist or record its verdict.' }
        : { key: 'work', title: 'Work the checklist and record your verdict', done: Boolean(section.verdict),
          sub: section.verdict ? `Verdict recorded: ${verdictWord(section.verdict)}` : total ? `${pending} of ${total} items still pending` : 'No checklist item is recorded on this section.' },
    ];
    const current = steps.find((s) => !s.done)?.key || null;
    return { sectionId: r.section_id, title: section.title || NOT_RECORDED, observer, steps, current };
  });
  const titles = cards.map((c) => c.title);
  const list = titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}` : titles[0] || 'your section';
  const as = cards.length && cards.every((c) => c.observer) ? 'as an observer' : 'as an invited expert';
  return {
    banner: `You’re reviewing ${list} ${as}. You see ${cards.length > 1 ? 'your sections' : 'your section'} only.`,
    cards,
    subject,
    hidden: 'Legal name and email: hidden from section reviewers.',
  };
}

/** DDL15: the request's state, in the subject's words. */
export const REQUEST_WORD = Object.freeze({ requested: 'Waiting on you', received: 'Sent, under review', reviewed: 'Reviewed' });
export const requestWord = (s) => REQUEST_WORD[s] || NOT_RECORDED;

/** DDL15's chips: Waiting on you, Sent and Reviewed, each with its count. */
export function requestChips(items) {
  const list = Array.isArray(items) ? items : [];
  return [
    { key: 'requested', label: 'Waiting on you', n: list.filter((r) => r.state === 'requested').length },
    { key: 'received', label: 'Sent', n: list.filter((r) => r.state === 'received').length },
    { key: 'reviewed', label: 'Reviewed', n: list.filter((r) => r.state === 'reviewed').length },
  ];
}

/**
 * The request's due date (D1248). Late only while it waits on the subject and
 * the day has passed; a request with no due date is never late.
 */
export function dueOf(req, today) {
  const day = fmtDay(req?.due_date);
  if (!day) return { text: 'No due date', late: null };
  const a = dayNumber(today); const b = dayNumber(req.due_date);
  const late = req.state === 'requested' && a != null && b != null && a > b ? a - b : null;
  return { text: `Due ${day}`, late: late ? `${late} day${late === 1 ? '' : 's'} late` : null };
}

/**
 * The answer's body (`PATCH /api/dd/requests/:id/respond`): a note, a link, a
 * data-room file, or any of them. A link must be http(s), as the Worker asks.
 */
export function answerBody({ note = '', url = '', fileUid = '' } = {}) {
  const n = String(note).trim(); const u = String(url).trim(); const f = String(fileUid).trim();
  if (!n && !u && !f) return { error: 'Write an answer, paste a link or pick a file.' };
  if (u && !/^https?:\/\//i.test(u)) return { error: 'A link starts with https:// or http://.' };
  return { body: { ...(n ? { response_note: n } : {}), ...(u ? { response_url: u } : {}), ...(f ? { file_uid: f } : {}) } };
}

/** The files a subject can pick from their venture's room (`GET /api/data-room/:projectUid`), by name. */
export function fileChoices(room) {
  const files = Array.isArray(room?.files) ? room.files : [];
  return files.filter((f) => f && f.uid).map((f) => ({ uid: f.uid, name: f.name || 'Untitled file' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
