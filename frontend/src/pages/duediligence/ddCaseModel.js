/**
 * D1251 (#3266, part 7 of #2385) — one case's nine tabs (DDL3–DDL11) and the
 * dialogs (DDL14 A–H), from the case read (`GET /api/dd/cases/:uid`) and the
 * reads parts 2, 3, 4 and 5 added. Pure: the tabs draw what these return, and
 * `frontend/test/dd_case_tabs_d1251.test.mjs` holds each rule.
 *
 * WHAT A VIEWER MAY DO is the case read's `allowed` (D1245, widened by
 * D1251): each control is drawn only when its flag is true; otherwise the tab
 * says who does it, in one sentence, never a disabled button.
 *
 * NEVER A ZERO FOR A MISSING VALUE. A block the read could not carry says so
 * ("Not recorded" with its reason, or Unreadable with Try again); a count of
 * none is a real none only when the read carried the list.
 */
import { NOT_RECORDED, conflictsWord, dueOf, fmtDay, verdictWord } from './ddReviewModel.js';
import { SEVERITY_WORD, dayText, depthWord, refusalText, subjectTypeWord } from './ddListModel.js';
import { CASE_TABS, bandWord, decisionWord } from './ddModel.js';

export { NOT_RECORDED, bandWord, decisionWord, depthWord, fmtDay, refusalText, verdictWord };

const nf = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ *
 * Who may do what (`allowed`)
 * ------------------------------------------------------------------ */

/** A flag of `allowed`, false when the read carried none. */
export const may = (data, flag) => Boolean(data?.allowed?.[flag]);
/** A per-section flag (`verdict`, `work`): false for a section the read did not name. */
export const maySection = (data, flag, sectionId) => Boolean(data?.allowed?.[flag]?.[String(sectionId)]);

/** The sentence drawn in place of a control the viewer may not use. */
export const WHO = Object.freeze({
  decide: 'The case lead or an Admin records the decision.',
  memo: 'The case lead or an Admin writes the memo.',
  ic: 'The case lead or an Admin sends the case to IC.',
  update: 'The case lead or an Admin changes the lead, the target IC date and the archive.',
  widen: 'The case lead or an Admin widens the scope, on an open case.',
  team: 'The case lead or an Admin changes the team.',
  assign: 'Admins and partners on the case assign reviewers.',
  scan: 'Admins and partners on the case run scans.',
  report: 'Admins and partners on the case generate reports.',
  requests: 'The case lead or an Admin sends requests to the subject.',
  notify_founder: 'An Admin notifies the founder, on a startup or founder case.',
  work: 'The section’s reviewer, the case lead or an Admin works it.',
  verdict: 'The section’s reviewer, the case lead or an Admin records its verdict.',
  archived: 'This case is archived. It takes no further change.',
});

/* ------------------------------------------------------------------ *
 * The tabs (DDL3, RT)
 * ------------------------------------------------------------------ */

/** A section reviewer's tabs (RT): the case's other tabs are the deal team's. */
export const REVIEWER_TABS = Object.freeze(['overview', 'checklist', 'flags', 'activity']);
/** The tabs a read draws: all nine for the deal team, RT's four on a read scoped to a reviewer's sections. */
export const tabsFor = (data) => (data?.case?.scoped ? CASE_TABS.filter((t) => REVIEWER_TABS.includes(t.key)) : CASE_TABS);
/** The tab drawn at an address: a scoped reader on a deal-team tab is told so, never shown the tab. */
export const tabOpen = (data, tab) => tabsFor(data).some((t) => t.key === tab);

/* ------------------------------------------------------------------ *
 * The header (DDL3)
 * ------------------------------------------------------------------ */

export const STATUS_WORD = Object.freeze({ open: 'Not started', in_review: 'In review', completed: 'Decided', archived: 'Archived' });
export const statusWord = (s) => STATUS_WORD[s] || NOT_RECORDED;

/** The facts under the title: type, template, stage, lead, opened and the target IC date. */
export function headerFacts(cs, now = Date.now()) {
  const target = dayText(cs?.target_ic_date);
  let targetSub = null;
  if (target && cs?.status !== 'completed' && cs?.status !== 'archived') {
    const t = Date.parse(`${String(cs.target_ic_date).slice(0, 10)}T00:00:00Z`);
    const today = Math.floor(now / 86400000) * 86400000;
    const diff = Math.round((t - today) / 86400000);
    targetSub = diff > 0 ? `in ${plural(diff, 'day', 'days')}` : diff === 0 ? 'today' : `${plural(-diff, 'day', 'days')} past`;
  }
  return {
    type: subjectTypeWord(cs?.subject_type),
    template: cs?.template_depth ? depthWord(cs.template_depth) : NOT_RECORDED,
    stage: statusWord(cs?.status),
    lead: cs?.lead_name || NOT_RECORDED,
    opened: fmtDay(cs?.created_at) || NOT_RECORDED,
    target: target || NOT_RECORDED,
    targetSub,
    targetPast: Boolean(targetSub && targetSub.endsWith('past')),
  };
}

/* ------------------------------------------------------------------ *
 * Sections, the checklist and the decision rule
 * ------------------------------------------------------------------ */

const WORKED = new Set(['pass', 'flag', 'fail', 'n_a']);

/** One section's checklist figures: worked of total, flagged and failed. */
export function sectionWork(checklist, sectionId) {
  const items = (checklist || []).filter((i) => Number(i.section_id) === Number(sectionId));
  const worked = items.filter((i) => WORKED.has(i.status)).length;
  return {
    total: items.length, worked, pending: items.length - worked,
    flagged: items.filter((i) => i.status === 'flag').length, failed: items.filter((i) => i.status === 'fail').length,
  };
}

/** The flags still open (every state but closed). */
export const openFlags = (flags) => (flags || []).filter((f) => f.state !== 'closed');
const SEVERE = new Set(['high', 'critical']);

/**
 * D1246's rule (owner question 4): Proceed is refused while a blocking section
 * has an open High or Critical flag. The page says so before the dialog;
 * the Worker refuses it either way (409 `blocking_flag_open`).
 */
export function blockedSections(sections, flags) {
  const blocking = new Set((sections || []).filter((s) => Number(s.blocking) === 1 || s.blocking === true).map((s) => Number(s.id)));
  const out = new Set();
  for (const f of openFlags(flags)) if (SEVERE.has(f.severity) && blocking.has(Number(f.section_id))) out.add(Number(f.section_id));
  return [...out];
}

export const BLOCKED_LINE = 'A blocking section has an open High or Critical flag, so Proceed is refused. Record Proceed with conditions, or close the flag first.';

/** The decision strip (DDL3, DDL10): what is recorded, or what the rule allows. */
export function decisionStrip(cs, sections, flags) {
  if (cs?.decision) {
    return {
      recorded: true,
      word: decisionWord(cs.decision),
      by: cs.decided_by_name || NOT_RECORDED,
      at: fmtDay(cs.decided_at) || NOT_RECORDED,
      reason: cs.scoped ? null : cs.decision_reason || null,
    };
  }
  const blocked = blockedSections(sections, flags);
  return { recorded: false, word: 'Decision: not recorded.', line: blocked.length ? BLOCKED_LINE : null };
}

/** Overview's four tiles (DDL3), each from the read; a list the read did not carry is "Not recorded". */
export function caseTiles(data) {
  const checklist = Array.isArray(data?.checklist) ? data.checklist : null;
  const flags = Array.isArray(data?.flags) ? data.flags : null;
  const requests = Array.isArray(data?.requests) ? data.requests : null;
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const tiles = [];
  if (checklist) {
    const worked = checklist.filter((i) => WORKED.has(i.status)).length;
    tiles.push({ key: 'checklist', label: 'Checklist', value: checklist.length ? `${nf(worked)} of ${nf(checklist.length)}` : 'No items', sub: checklist.length ? 'worked' : 'This case has no checklist items.' });
  } else tiles.push({ key: 'checklist', label: 'Checklist', value: NOT_RECORDED, sub: 'The checklist was not read.' });
  if (flags) {
    const open = openFlags(flags);
    const by = (s) => open.filter((f) => f.severity === s).length;
    const parts = ['critical', 'high', 'medium', 'low', 'info'].filter((s) => by(s)).map((s) => `${nf(by(s))} ${SEVERITY_WORD[s]}`);
    tiles.push({ key: 'flags', label: 'Open flags', value: nf(open.length), sub: parts.length ? parts.join(', ') : 'None open', alert: open.some((f) => SEVERE.has(f.severity)) });
  } else tiles.push({ key: 'flags', label: 'Open flags', value: NOT_RECORDED, sub: 'The flags were not read.' });
  if (data?.case?.scoped) {
    tiles.push({ key: 'requests', label: 'Requests waiting', value: NOT_RECORDED, sub: 'Requests to the subject are the deal team’s.' });
  } else if (requests) {
    const waiting = requests.filter((r) => r.state === 'requested' && !r.withdrawn_at);
    const today = new Date().toISOString().slice(0, 10);
    const late = waiting.filter((r) => dueOf(r, today).late).length;
    tiles.push({ key: 'requests', label: 'Requests waiting', value: nf(waiting.length), sub: late ? `${nf(late)} past due` : waiting.length ? 'None past due' : 'Nothing waiting', warn: late > 0 });
  } else tiles.push({ key: 'requests', label: 'Requests waiting', value: NOT_RECORDED, sub: 'The requests were not read.' });
  const signed = sections.filter((s) => s.verdict).length;
  tiles.push({ key: 'signed', label: 'Sections signed off', value: `${nf(signed)} of ${nf(sections.length)}`, sub: sections.length - signed ? `${nf(sections.length - signed)} still to sign` : 'All signed off' });
  return tiles;
}

/** A section card's lines (DDL3) and Sign-off's row (DDL10). */
export function sectionRow(section, data) {
  const work = sectionWork(data?.checklist, section.id);
  const reviewers = (data?.reviewers || []).filter((r) => Number(r.section_id) === Number(section.id) && (r.role || 'reviewer') !== 'observer');
  const blocking = Number(section.blocking) === 1 || section.blocking === true;
  let signedOff;
  if (section.status === 'completed') {
    signedOff = section.signed_off_by_name
      ? { text: `Signed off by ${section.signed_off_by_name}`, at: fmtDay(section.completed_at) }
      : { text: 'Sign-off not recorded', at: null };
  } else {
    signedOff = work.pending ? { text: 'Blocked', sub: `${plural(work.pending, 'item', 'items')} pending`, at: null } : { text: 'Awaiting sign-off', at: null };
  }
  return {
    id: section.id, title: section.title, blocking, weight: Number(section.weight),
    verdict: verdictWord(section.verdict), hasVerdict: Boolean(section.verdict),
    worked: work.total ? `${nf(work.worked)} of ${nf(work.total)}` : 'No items',
    flagged: work.flagged + work.failed,
    reviewers: reviewers.map((r) => r.user_name || NOT_RECORDED),
    noReviewer: reviewers.length === 0,
    signedOff,
  };
}

/* ------------------------------------------------------------------ *
 * Checklist (DDL4)
 * ------------------------------------------------------------------ */

export const ITEM_STATUS_WORD = Object.freeze({ pending: 'Pending', pass: 'Pass', flag: 'Flag', fail: 'Fail', n_a: 'N/A' });
export const ITEM_FILTERS = Object.freeze([
  { key: 'all', label: 'All' }, { key: 'pending', label: 'Pending' }, { key: 'flag', label: 'Flagged' },
  { key: 'fail', label: 'Failed' }, { key: 'pass', label: 'Passed' }, { key: 'n_a', label: 'N/A' },
]);

/** The chips' counts, and the items a chip and the search keep. */
export function itemCounts(checklist) {
  const items = checklist || [];
  return Object.fromEntries(ITEM_FILTERS.map((f) => [f.key, f.key === 'all' ? items.length : items.filter((i) => i.status === f.key).length]));
}
export function filterItems(checklist, chip = 'all', q = '') {
  const needle = String(q || '').trim().toLowerCase();
  return (checklist || []).filter((i) => (chip === 'all' || i.status === chip) && (!needle || String(i.title || '').toLowerCase().includes(needle)));
}

/** Who an owner id is: the case's team, by name, never an email. */
export function peopleOf(data) {
  const m = new Map();
  if (data?.case?.lead_user_id && data?.case?.lead_name) m.set(Number(data.case.lead_user_id), data.case.lead_name);
  for (const r of data?.reviewers || []) if (r.user_name) m.set(Number(r.user_id), r.user_name);
  return m;
}
export const personName = (people, id) => (id == null ? null : people.get(Number(id)) || `Account #${id}`);

/** The bulk changes (DDL4) as one PATCH body per item; nothing for an item a viewer may not work. */
export function bulkPatch(kind, value) {
  if (kind === 'n_a') return { status: 'n_a' };
  if (kind === 'owner') return { owner_user_id: value == null || value === '' ? null : Number(value) };
  if (kind === 'due') return { due_date: value || null };
  return null;
}

/** Item evidence (D1248) by item, from the case read's `evidence`; null when the read could not carry it. */
export function evidenceByItem(data) {
  if (!Array.isArray(data?.evidence)) return null;
  const m = new Map();
  for (const e of data.evidence) {
    const list = m.get(Number(e.item_id)) || [];
    list.push(e);
    m.set(Number(e.item_id), list);
  }
  return m;
}

/* ------------------------------------------------------------------ *
 * Flags (DDL5, DDL14 B and C)
 * ------------------------------------------------------------------ */

export const FLAG_STATE_WORD = Object.freeze({ open: 'Open', in_progress: 'In progress', condition_to_close: 'Condition to close', accepted: 'Accepted', closed: 'Closed' });
export const FLAG_STATES = Object.freeze(Object.keys(FLAG_STATE_WORD));
export const SOURCE_WORD = Object.freeze({ raised: 'Raised by hand', connector: 'External source', checklist: 'Checklist' });
export const flagSourceWord = (f) => SOURCE_WORD[f.source] || (f.kind === 'checklist' ? 'Checklist' : NOT_RECORDED);
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** The flags the filters keep, severest first. Not closed (the default) lists the closed ones apart; a chosen state lists only its own. */
export function flagRows(flags, { severity = '', state = 'not_closed', section = '', source = '' } = {}) {
  const keep = (f) => (!severity || f.severity === severity)
    && (!section || String(f.section_id) === String(section))
    && (!source || (f.source || (f.kind === 'checklist' ? 'checklist' : '')) === source)
    && (state === 'any' || (state === 'not_closed' ? f.state !== 'closed' : f.state === state));
  const sorted = (list) => [...list].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const all = flags || [];
  if (state !== 'not_closed') return { open: sorted(all.filter(keep)), closed: [] };
  return { open: sorted(all.filter(keep)), closed: sorted(all.filter((f) => f.state === 'closed')) };
}

/** The flags' headline (DDL5): the severest open and where. */
export function flagsHeadline(flags, sections) {
  const open = openFlags(flags);
  if (!open.length) return 'No flag is open.';
  const blocked = blockedSections(sections, flags);
  const by = (s) => open.filter((f) => f.severity === s).length;
  const parts = ['critical', 'high', 'medium', 'low', 'info'].filter((s) => by(s)).map((s) => `${nf(by(s))} ${SEVERITY_WORD[s]}`);
  return `${parts.join('. ')}.${blocked.length ? ` ${plural(blocked.length, 'blocking section has', 'blocking sections have')} one open.` : ''}`;
}

/** A flag that may be worked: a finding (a checklist item is worked on the Checklist), in a section the viewer works. */
export function canWorkFlag(data, f) {
  if (f.kind !== 'finding' || f.id == null) return false;
  return f.section_id == null ? may(data, 'work_case_wide') : maySection(data, 'work', f.section_id);
}

/** Raise a flag's body (DDL14 B), or what to fix first. */
export function raiseBody({ title = '', sectionId = '', severity = '', detail = '', ownerId = '', itemId = '' }) {
  if (!String(title).trim()) return { error: 'Give the flag a title.' };
  if (String(title).trim().length > 200) return { error: 'The title is at most 200 characters.' };
  if (!sectionId) return { error: 'Choose the section the flag belongs to.' };
  if (!SEVERITY_WORD[severity]) return { error: 'Choose its severity.' };
  if (String(detail).length > 4000) return { error: 'The detail is at most 4,000 characters.' };
  return {
    body: {
      title: String(title).trim(), section_id: Number(sectionId), severity,
      ...(String(detail).trim() ? { detail: String(detail).trim() } : {}),
      ...(ownerId ? { owner_user_id: Number(ownerId) } : {}),
      ...(itemId ? { checklist_item_id: Number(itemId) } : {}),
    },
  };
}

/** Update a flag's body (DDL14 C): only what changed; accepting or closing needs a resolution. */
export function flagChange(flag, { state, resolution, ownerId }) {
  const out = {};
  if (state && state !== flag.state) out.state = state;
  const res = String(resolution ?? '').trim();
  if (res !== String(flag.resolution || '').trim()) out.resolution = res || null;
  const owner = ownerId === '' || ownerId == null ? null : Number(ownerId);
  if (owner !== (flag.owner_user_id ?? null)) out.owner_user_id = owner;
  const next = out.state || flag.state;
  if ((next === 'accepted' || next === 'closed') && !res) return { error: 'Say how it was resolved. Accepting or closing a flag needs a resolution.' };
  if (!Object.keys(out).length) return { error: 'Nothing has changed yet.' };
  return { body: out };
}

/** The history's lines (`GET …/findings/:id/history`), oldest first; who by name, never an email. */
export function historyLines(items) {
  const ACTION = { finding_raised: 'Raised', finding_updated: 'Updated', finding_closed: 'Closed', finding_reopened: 'Reopened' };
  return (items || []).map((h) => {
    const d = h.details || {};
    const bits = [];
    if (d.from_state && d.to_state && d.from_state !== d.to_state) bits.push(`${FLAG_STATE_WORD[d.from_state] || d.from_state} → ${FLAG_STATE_WORD[d.to_state] || d.to_state}`);
    if (d.owner_from !== d.owner_to && (d.owner_from != null || d.owner_to != null)) bits.push('owner changed');
    if (d.resolution_changed) bits.push('resolution changed');
    return { id: h.id, at: fmtDay(h.at) || NOT_RECORDED, who: h.actor_name || 'An account that is gone', what: [ACTION[h.action] || h.action, ...bits].join(' · ') };
  });
}

/* ------------------------------------------------------------------ *
 * Requests (DDL6, DDL6b)
 * ------------------------------------------------------------------ */

export const REQ_STATE_WORD = Object.freeze({ requested: 'Requested', received: 'Received', reviewed: 'Reviewed', withdrawn: 'Withdrawn' });
export const reqState = (r) => (r.withdrawn_at ? 'withdrawn' : r.state);

/** The four tiles (DDL6). */
export function requestTiles(requests, today) {
  const live = (requests || []).filter((r) => !r.withdrawn_at);
  const waiting = live.filter((r) => r.state === 'requested');
  const late = waiting.filter((r) => dueOf(r, today).late).length;
  return [
    { key: 'total', label: 'Total', value: nf(live.length), sub: 'Sent on this case' },
    { key: 'waiting', label: 'Waiting on the subject', value: nf(waiting.length), sub: late ? `${nf(late)} past due` : 'None past due', warn: late > 0 },
    { key: 'received', label: 'Received', value: nf(live.filter((r) => r.state === 'received').length), sub: 'To review' },
    { key: 'reviewed', label: 'Reviewed', value: nf(live.filter((r) => r.state === 'reviewed').length), sub: 'Closed out' },
  ];
}

/** What a request's ⋯ menu offers: Mark reviewed, a reminder while it waits, Withdraw unless reviewed. */
export function requestActions(r) {
  if (r.withdrawn_at) return [];
  const out = [];
  if (r.state !== 'reviewed') out.push('review');
  if (r.state === 'requested') out.push('remind');
  if (r.state !== 'reviewed') out.push('due');
  if (r.state !== 'reviewed') out.push('withdraw');
  return out;
}

/** Compose's body (DDL6b), or what to fix. A due date is today or later (the Worker checks it too). */
export function composeBody({ title = '', details = '', sectionId = '', due = '' }, today) {
  if (!String(title).trim()) return { error: 'Say what you need.' };
  if (String(title).trim().length > 200) return { error: 'What you need is at most 200 characters.' };
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || (today && due < today))) return { error: 'The due date is today or later.' };
  return {
    body: {
      title: String(title).trim(),
      ...(String(details).trim() ? { details: String(details).trim() } : {}),
      ...(sectionId ? { section_id: Number(sectionId) } : {}),
      ...(due ? { due_date: due } : {}),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Documents (DDL7)
 * ------------------------------------------------------------------ */

export const sizeText = (b) => {
  const n = Number(b);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};

/** The three lists (DDL7): from the subject, evidence on items, reviewer NDAs. `null` where the read could not carry it. */
export function documentLists(data) {
  const sectionTitle = (id) => (data?.sections || []).find((s) => Number(s.id) === Number(id))?.title || 'Case-wide';
  const unreadable = Boolean(data?.documents_unreadable);
  const fromSubject = data?.case?.scoped || unreadable ? null : (data?.requests || []).flatMap((r) => (Array.isArray(r.files) ? r.files : []).map((f) => ({
    id: f.id, name: f.name, request: r.title, section: sectionTitle(r.section_id), at: fmtDay(f.created_at) || NOT_RECORDED, size: sizeText(f.size_bytes),
  })));
  const items = new Map((data?.checklist || []).map((i) => [Number(i.id), i]));
  const evidence = !Array.isArray(data?.evidence) ? null : data.evidence.map((e) => ({
    key: e.uid, kind: e.kind, attachmentId: e.attachment_id ?? null, url: e.url ?? null, name: e.filename || e.label || e.url || NOT_RECORDED,
    item: items.get(Number(e.item_id))?.title || NOT_RECORDED, section: sectionTitle(e.section_id), by: e.added_by_name || NOT_RECORDED,
    at: fmtDay(e.created_at) || NOT_RECORDED, size: e.kind === 'file' ? sizeText(e.size_bytes) : '—',
  }));
  const evidenceIds = new Set((data?.evidence || []).map((e) => Number(e.attachment_id)).filter(Boolean));
  const ndas = (data?.attachments || []).filter((a) => !evidenceIds.has(Number(a.id))).map((a) => ({
    id: a.id, name: a.filename, section: sectionTitle(a.section_id), at: fmtDay(a.created_at) || NOT_RECORDED, size: sizeText(a.size_bytes),
  }));
  const missing = (data?.reviewers || []).filter((r) => (r.role || 'reviewer') !== 'observer' && !r.nda_signed_at
    && !(data?.attachments || []).some((a) => Number(a.section_id) === Number(r.section_id) && !evidenceIds.has(Number(a.id))))
    .map((r) => `${r.user_name || NOT_RECORDED} has not uploaded an NDA for ${sectionTitle(r.section_id)}.`);
  return { fromSubject, evidence, ndas, missing, unreadable };
}

export const LINK_LINE = 'Links are issued to you alone and expire after two minutes. Downloads are recorded on the case.';

/* ------------------------------------------------------------------ *
 * Cross-checks (DDL8)
 * ------------------------------------------------------------------ */

export const SOURCE_STATE_WORD = Object.freeze({ queued: 'Queued', running: 'Running', ok: 'Done', error: 'Failed', disabled: 'Off' });
export const CHECK_WORD = Object.freeze({
  approved: 'Approved', verified: 'Verified', pending: 'Waiting', submitted: 'Waiting', in_review: 'Waiting', not_started: 'Not started',
  rejected: 'Rejected', failed: 'Failed', expired: 'Expired',
});
export const checkWord = (s) => (s == null ? NOT_RECORDED : CHECK_WORD[s] || String(s).replace(/_/g, ' '));

/** The platform checks (D1249) as rows; a check the Worker could not read says so. */
export function platformRows(pc) {
  if (!pc) return { state: 'none', rows: [] };
  if (pc.available === false) return { state: 'unavailable', reason: pc.reason, rows: [] };
  const row = (key, label, c, at) => {
    if (!c) return null;
    if (c.available === false) return { key, label, state: 'unreadable', reason: c.reason };
    return { key, label, state: 'ready', word: checkWord(c.status), reason: c.status == null ? c.reason : null, at: fmtDay(c[at]), link: c.link || null };
  };
  return {
    state: 'ready',
    rows: [row('identity', 'Identity check', pc.identity, 'decided_at'), row('business', 'Business check (KYB)', pc.business, 'updated_at'), row('partner_profile', 'Partner profile', pc.partner_profile, 'reviewed_at')].filter(Boolean),
  };
}

/* ------------------------------------------------------------------ *
 * Team (DDL9, DDL9b)
 * ------------------------------------------------------------------ */

/** One row per person and section; an observer is marked; an expired invitation that was never accepted says so. */
export function teamRows(data) {
  const sectionTitle = (id) => (data?.sections || []).find((s) => Number(s.id) === Number(id))?.title || `Section #${id}`;
  return (data?.reviewers || []).map((r) => {
    const section = (data?.sections || []).find((s) => Number(s.id) === Number(r.section_id));
    return {
      key: `${r.user_id}-${r.section_id}`, userId: r.user_id, sectionId: r.section_id, name: r.user_name || NOT_RECORDED,
      section: sectionTitle(r.section_id), role: r.role === 'observer' ? 'Observer' : 'Reviewer',
      invited: fmtDay(r.invited_at) || NOT_RECORDED,
      accepted: r.responded_at ? fmtDay(r.responded_at) : r.expired ? 'Invitation expired' : 'Not yet',
      nda: r.nda_signed_at ? 'On file' : (r.role === 'observer' ? '—' : 'NDA missing'),
      conflicts: conflictsWord(r.conflicts),
      conflictsNote: r.conflicts === 'declared' ? r.conflicts_note || null : null,
      verdict: section ? verdictWord(section.verdict) : NOT_RECORDED,
    };
  });
}

/** Sections no one reviews (DDL9's foot). */
export const unstaffed = (data) => (data?.sections || []).filter((s) => !(data?.reviewers || []).some((r) => Number(r.section_id) === Number(s.id) && (r.role || 'reviewer') !== 'observer'));

/* ------------------------------------------------------------------ *
 * Sign-off (DDL10): the memo, the decision, IC and the reports
 * ------------------------------------------------------------------ */

export const MEMO_PARTS = Object.freeze([
  { key: 'summary', label: 'Summary' },
  { key: 'verified', label: 'What we verified' },
  { key: 'on_trust', label: 'What we take on trust' },
  { key: 'conditions', label: 'Conditions to close' },
]);
export const MEMO_MAX = 8000;

/** The decisions DDL14 D offers: Proceed only when no blocking section has an open severe flag. */
export function decisionChoices(sections, flags) {
  const blocked = blockedSections(sections, flags).length > 0;
  return [
    { key: 'proceed', label: 'Proceed', disabled: blocked },
    { key: 'proceed_with_conditions', label: 'Proceed with conditions', sub: 'Conditions come from flags in Condition to close.' },
    { key: 'do_not_proceed', label: 'Do not proceed' },
    { key: 'withdrawn', label: 'Withdrawn' },
  ].filter((c) => !c.disabled);
}

/** Decide's body (DDL14 D), or what to fix. The Worker holds Proceed to the flag rule either way. */
export function decisionBody({ decision = '', reason = '' }, sections, flags) {
  const choices = decisionChoices(sections, flags).map((c) => c.key);
  if (!decision) return { error: 'Choose the decision.' };
  if (!choices.includes(decision)) return { error: BLOCKED_LINE };
  const r = String(reason).trim();
  if (!r) return { error: 'Say why. The reason is recorded with the decision.' };
  if (r.length > 2000) return { error: 'The reason is at most 2,000 characters.' };
  return { body: { decision, reason: r } };
}

const DEPTH_RANK = { lite: 0, standard: 1, deep: 2 };
/** Widen's choices (DDL14 H): only a deeper template than the case has. */
export const widenChoices = (depth) => ['standard', 'deep'].filter((d) => DEPTH_RANK[d] > (DEPTH_RANK[depth || 'standard'] ?? 1));

/** The flags in Condition to close: Sign-off's conditions. */
export const conditionFlags = (flags) => (flags || []).filter((f) => f.state === 'condition_to_close');

/** IC (D1246): sent, ready to send, or why not. */
export function icState(cs, data) {
  if (cs?.ic_record?.uid) return { state: 'sent', text: `With IC · ${String(cs.ic_record.status || '').replace(/_/g, ' ') || NOT_RECORDED}`, uid: cs.ic_record.uid };
  if (cs?.decision !== 'proceed' && cs?.decision !== 'proceed_with_conditions') return { state: 'waits', text: 'Record Proceed or Proceed with conditions before sending the case to IC.' };
  if (!may(data, 'decide')) return { state: 'waits', text: WHO.ic };
  return { state: 'ready', text: 'Send to IC opens a new IC record with this case attached.' };
}

/** The reports list (`GET …/reports`). */
export const reportRows = (items) => (items || []).map((r) => ({
  id: r.id, at: fmtDay(r.created_at) || NOT_RECORDED, by: r.generated_by_name || NOT_RECORDED, format: String(r.format || '').toUpperCase() || NOT_RECORDED,
  band: r.risk_band_at_generation ? bandWord(r.risk_band_at_generation) : 'Not scored yet', stored: r.stored === true,
}));

/* ------------------------------------------------------------------ *
 * Activity (DDL11)
 * ------------------------------------------------------------------ */

/** The audit rows as lines: who by name (never an email), what in words, when; filtered by action and person. */
export function activityRows(items, { action = '', person = '' } = {}) {
  return (items || []).map((it) => ({
    id: it.id, who: it.actor_name || (it.actor_user_id ? 'An account that is gone' : 'The system'), personKey: String(it.actor_user_id ?? 'system'),
    action: it.action, what: String(it.action || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), at: fmtDay(it.created_at) || NOT_RECORDED,
  })).filter((r) => (!action || r.action === action) && (!person || r.personKey === person));
}
export const activityFilters = (items) => ({
  actions: [...new Set((items || []).map((i) => i.action))].sort(),
  people: [...new Map((items || []).map((i) => [String(i.actor_user_id ?? 'system'), i.actor_name || (i.actor_user_id ? 'An account that is gone' : 'The system')])).entries()],
});
export const ACTIVITY_CAP = 200;

/** A refusal in the Worker's words, keyed on its code where the case's routes send one. */
export const CASE_REFUSALS = Object.freeze({
  blocking_flag_open: BLOCKED_LINE,
  finding_changed: 'This flag changed while you were reading it. Nothing was saved; open it again.',
  resolution_required: 'Say how it was resolved. Accepting or closing a flag needs a resolution.',
  reminded_recently: 'A reminder went in the last day. Nothing was sent.',
  no_subject_account: 'The subject has no account to remind. Nothing was sent.',
  withdrawn: 'This request was withdrawn. Nothing changed.',
  reviewed: 'A reviewed request stays as it is. Nothing changed.',
  answered: 'This request is already answered. Nothing was sent.',
  already_sent: 'This case is already with IC.',
  not_stored: 'This file was never stored, so it cannot be opened.',
});
export function caseRefusal(e, fallback) {
  const code = e?.code || e?.data?.code;
  return (code && CASE_REFUSALS[code]) || refusalText(e, fallback);
}
