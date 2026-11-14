/**
 * D1006 (#2821, part 9 of #2378) — the rules behind Unclassified (SEG5),
 * Edit segment and Suggest a change (SEG6), Suggestions (SEG7) and the
 * page-wide Activity (SEG8). Pure, so `frontend/test/persona_segments_d1006.test.mjs`
 * holds each rule without a browser.
 *
 * WHAT IT READS AND WRITES, all already in the Worker:
 *   members({ segment: 'none', why, … })   D1002: the members with no segment, `why_counts`
 *   askToFinish(ids)                       D1002: one notice each, at most once in 30 days
 *   saveSegmentProfile(key, body)          D1000: HQ's edit, with the version it read
 *   suggestSegmentChange(body)             D1003: an Admin's suggestion
 *   segmentSuggestions(status)             D1003: all (HQ's Super Admin) or mine
 *   decideSegmentSuggestion(uid, body)     D1003: accept or decline, HQ only
 *
 * NEVER: a member's answer, alone or by a name; a zero for a reason the
 * store could not read; a decline without its one line.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { profileLabel } from './segModel.js';

const nf = (n) => Number(n).toLocaleString('en-US');

/* ------------------------------------------------------------------ *
 * SEG5: Unclassified
 * ------------------------------------------------------------------ */

/** Why a member has no segment, in the canvas's words and order (D1002 §2). */
export const WHY = [
  { key: 'not_started', label: 'Skipped the sign-up chat' },
  { key: 'started', label: 'Started, did not finish' },
  { key: 'not_offered', label: 'Their profile has no segment yet' },
];

/**
 * The reasons chart: one bar per reason with its count, or Not recorded
 * when the store could not say (the answers store missing leaves `started`
 * and `not_started` null). A null is never drawn as 0.
 */
export function whyBars(read) {
  const c = read?.why_counts || {};
  const known = WHY.map((w) => (typeof c[w.key] === 'number' ? c[w.key] : null));
  const max = Math.max(1, ...known.filter((n) => n !== null));
  return WHY.map((w, i) => ({
    key: w.key, label: w.label, n: known[i],
    text: known[i] === null ? NOT_RECORDED : nf(known[i]),
    pct: known[i] === null ? 0 : (known[i] / max) * 100,
  }));
}

/** The one sentence under the chart, from the counts that were read. */
export function whySummary(read) {
  const bars = whyBars(read);
  const total = Number(read?.total);
  if (bars.some((b) => b.n === null) || !Number.isFinite(total)) return 'Some reasons could not be read, so they are not added up.';
  return `Of ${nf(total)} members with no segment: ${bars.map((b) => `${nf(b.n)} ${b.label.toLowerCase()}`).join(', ')}.`;
}

/** The members read's parameters for Unclassified; an empty filter is left out. */
export function unclassifiedParams(f = {}) {
  return {
    segment: 'none',
    why: f.why || undefined,
    q: f.q && f.q.trim().length >= 2 ? f.q.trim() : undefined,
    profile: f.profile || undefined,
    active: f.active || undefined,
    sort: f.sort || 'joined',
    page: f.page > 1 ? f.page : undefined,
  };
}

const day = (s) => {
  const t = Date.parse(String(s || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s || '')) ? '' : 'Z'));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
};

/** One member with no segment: who, profile, joined, last active, the sign-up chat's state, and the last ask. */
export function unclassifiedRow(m) {
  return {
    id: m.user_id,
    name: m.name || m.email || NOT_RECORDED,
    email: m.name && m.email ? m.email : null,
    profile: profileLabel(m.profile),
    joined: day(m.joined) || NOT_RECORDED,
    lastActive: day(m.last_active) || 'Never',
    chat: WHY.find((w) => w.key === m.why)?.label || NOT_RECORDED,
    asked: m.asked_at ? `Asked ${day(m.asked_at)}` : '',
    member: { user_id: m.user_id, name: m.name, email: m.email, profile: m.profile, is_admin: false, segment: null },
  };
}

/** The ask-to-finish dialog's words, before it sends: the notice, the 30-day rule, and who is skipped. */
export function askView(rows) {
  const list = rows.filter(Boolean);
  const recent = list.filter((r) => r.asked_at && Date.now() - Date.parse(r.asked_at) < 30 * 86400000).length;
  const n = list.length - recent;
  return {
    title: 'Ask to finish their profile',
    notice: `We will send ${nf(list.length)} ${list.length === 1 ? 'member' : 'members'} one notice: ‘Tell us a bit more about what you do, so we can show you what fits.’ It links to their profile questions.`,
    rule: recent
      ? `A member gets it at most once every 30 days; ${nf(recent)} had one recently and ${recent === 1 ? 'is' : 'are'} skipped.`
      : 'A member gets it at most once every 30 days.',
    send: n > 0 ? `Send to ${nf(n)}` : 'Nothing to send',
    canSend: n > 0,
  };
}

/** What the ask did, from D1002's outcomes. */
export function askedLine(reply) {
  const results = Array.isArray(reply?.results) ? reply.results : [];
  const asked = Number(reply?.asked) || results.filter((r) => r.outcome === 'asked').length;
  const recent = results.filter((r) => r.outcome === 'asked_recently').length;
  const other = results.length - asked - recent;
  return [
    `${nf(asked)} ${asked === 1 ? 'member was' : 'members were'} asked to finish their profile.`,
    recent ? `${nf(recent)} had been asked in the last 30 days.` : '',
    other > 0 ? `${nf(other)} could not be asked.` : '',
  ].filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ *
 * SEG6: Edit segment (Super Admin) and Suggest a change (Admin)
 * ------------------------------------------------------------------ */

export const STATUSES = [
  { key: 'active', label: 'Active', line: 'Offered at sign-up.' },
  { key: 'draft', label: 'Draft', line: 'Only admins place members in it.' },
  { key: 'retired', label: 'Retired', line: 'Takes no new members.' },
];
export const LIMITS = { name: 80, who: 280, typical: 4, typicalLine: 120, needs: 6, needText: 200, reason: 280 };

const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

/** The form's draft from a segment profile: one line per typical member and per need. */
export function editDraftOf(seg) {
  return {
    name: seg?.name || '',
    status: seg?.status || 'draft',
    who: seg?.who || '',
    typical: (seg?.typical || []).join('\n'),
    needs: (seg?.needs || []).map((n) => n.text).join('\n'),
    reason: '',
  };
}

/**
 * What the draft changes, as D1000's PATCH body and one line per change for
 * the confirm. A kept need keeps its id and what answers it; a new need
 * starts with nothing answering it. Nothing changed is `{ body: null }`.
 */
export function editChanges(seg, d) {
  const body = {};
  const say = [];
  if (d.name.trim() !== (seg.name || '')) { body.name = d.name.trim(); say.push(`The name becomes ‘${body.name}’.`); }
  if (d.status !== seg.status) { body.status = d.status; say.push(`Status goes from ${STATUSES.find((s) => s.key === seg.status)?.label || seg.status} to ${STATUSES.find((s) => s.key === d.status)?.label}.`); }
  if (d.who.trim() !== (seg.who || '')) { body.who = d.who.trim(); say.push('Who they are is rewritten.'); }
  const typical = lines(d.typical);
  if (typical.join('\n') !== (seg.typical || []).join('\n')) { body.typical = typical; say.push(`The typical member list has ${typical.length} ${typical.length === 1 ? 'line' : 'lines'}.`); }
  const oldNeeds = seg.needs || [];
  const needTexts = lines(d.needs);
  if (needTexts.join('\n') !== oldNeeds.map((n) => n.text).join('\n')) {
    body.needs = needTexts.map((text) => {
      const kept = oldNeeds.find((n) => n.text === text);
      return kept ? { id: kept.id, text, answered_by: kept.answered_by || [] } : { text, answered_by: [] };
    });
    const added = needTexts.filter((t) => !oldNeeds.some((n) => n.text === t));
    const removed = oldNeeds.filter((n) => !needTexts.includes(n.text));
    for (const t of added) say.push(`Need ‘${t}’ is added, with nothing answering it yet.`);
    for (const n of removed) say.push(`Need ‘${n.text}’ is removed.`);
    if (!added.length && !removed.length) say.push('The needs are put in a new order.');
  }
  if (!Object.keys(body).length) return { body: null, say: [] };
  return { body: { expected_version: seg.version, ...(d.reason.trim() ? { reason: d.reason.trim() } : {}), ...body }, say };
}

/** Why Save waits, in the form's words; null when it may save. */
export function editProblem(d) {
  if (!d.name.trim()) return 'A segment needs a name.';
  if (d.name.trim().length > LIMITS.name) return `The name is at most ${LIMITS.name} characters.`;
  if (d.who.length > LIMITS.who) return `Who they are is at most ${LIMITS.who} characters.`;
  const t = lines(d.typical);
  if (t.length > LIMITS.typical || t.some((x) => x.length > LIMITS.typicalLine)) return `The typical member is at most ${LIMITS.typical} lines of ${LIMITS.typicalLine} characters.`;
  const n = lines(d.needs);
  if (n.length > LIMITS.needs || n.some((x) => x.length > LIMITS.needText)) return `Needs are at most ${LIMITS.needs} lines of ${LIMITS.needText} characters.`;
  if (new Set(n).size !== n.length) return 'The same need is written twice.';
  if (d.reason.length > LIMITS.reason) return `The reason is at most ${LIMITS.reason} characters.`;
  return null;
}

/** What an Admin may suggest (D1003 §1). */
export const SUGGEST_KINDS = [
  { key: 'who', label: 'Who they are' },
  { key: 'need', label: 'A need' },
  { key: 'offer', label: 'An offer' },
  { key: 'new_segment', label: 'A new segment' },
  { key: 'other', label: 'Something else' },
];

/** Why a suggestion cannot be sent yet; null when it can. */
export function suggestProblem({ kind, segment_key: key, text }) {
  if (!SUGGEST_KINDS.some((k) => k.key === kind)) return 'Pick what should change.';
  if (kind !== 'new_segment' && !key) return 'Pick the segment it is about.';
  const t = String(text || '').trim();
  if (!t) return 'Describe the change.';
  if (t.length > 500) return 'The description is at most 500 characters.';
  return null;
}

/** The body D1003's suggestion takes: no segment for a new one. */
export function suggestBody({ kind, segment_key: key, text }) {
  return { kind, text: String(text).trim(), ...(kind === 'new_segment' ? {} : { segment_key: key }) };
}

/* ------------------------------------------------------------------ *
 * SEG7: Suggestions
 * ------------------------------------------------------------------ */

const STATUS = { open: 'Waiting for HQ', accepted: 'Accepted', declined: 'Declined' };

/** One suggestion as a row: where it came from, what it asks, when, and its state. */
export function suggestionRow(s, segName = (k) => k) {
  const kind = SUGGEST_KINDS.find((k) => k.key === s.kind)?.label || s.kind;
  const about = s.kind === 'new_segment' ? 'A new segment' : (segName(s.segment_key) || s.segment_key || NOT_RECORDED);
  const from = [s.suggested_by_name || 'An admin', s.studio === 'hq' ? 'HQ-held' : s.studio].filter(Boolean).join(' · ');
  return {
    uid: s.uid,
    title: `${about} · ${kind}`,
    text: s.text || '',
    from,
    when: day(s.created_at) || NOT_RECORDED,
    status: STATUS[s.status] || s.status,
    open: s.status === 'open',
    decline: s.status === 'declined' && s.decline_reason ? `Declined by HQ: ‘${s.decline_reason}’` : '',
    delivery: s.delivery === 'undelivered' ? `Not yet with HQ: ${s.delivery_reason || 'the studio could not reach HQ'}.` : '',
  };
}

/** Why a decline cannot be sent: one line the Admin will read, at most 200 characters. */
export function declineProblem(reason) {
  const t = String(reason || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Write one line the admin will read.';
  if (t.length > 200) return 'One line, at most 200 characters.';
  return null;
}
