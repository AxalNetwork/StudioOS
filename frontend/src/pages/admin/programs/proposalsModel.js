// D964 (#2797, Programs part 11) — the proposal flow's words and rules, pure.
// Every read and write is part 2's (D955, #2788); this file holds what the
// pages draw from them: the proposal's statuses (dc:325), PG14's steps and
// lists, the playbook HQ will read (dc:467), PG15a's choices, PG19b, the list
// parameters and the refusals, each one sentence keyed on its `code`.
import { GROUPS, FROZEN, SUSPENDED, TRY_AGAIN, parseStamp } from './programsModel.js';

export const PROPOSE_PATH = '/admin/programs/propose';
export const PROPOSALS_PATH = '/admin/programs/proposals';
/** A proposal opened in the form or read only: `?proposal=<uid>`. */
export const proposalHref = (uid) => `${PROPOSE_PATH}?proposal=${encodeURIComponent(uid)}`;

/* ------------------------------------------------------------------ *
 * Statuses: a proposal's, never a program's "Proposed" pill (dc:325)
 * ------------------------------------------------------------------ */

export const PROPOSAL_STATUS = Object.freeze({
  draft: { word: 'Draft', glyph: '✎', tone: 'muted' },
  sent: { word: 'Sent to HQ', glyph: '◷', tone: 'amber' },
  approved: { word: 'Approved', glyph: '✓', tone: 'green' },
  sent_back: { word: 'Sent back', glyph: '↩', tone: 'muted' },
  declined: { word: 'Declined', glyph: '✕', tone: 'red' },
});
/** The studio may edit and send these again (D955 §2); any other opens read only. */
export const EDITABLE = Object.freeze(['draft', 'sent_back']);
export const isEditable = (status) => EDITABLE.includes(status);

/* ------------------------------------------------------------------ *
 * PG14: the five steps and their lists
 * ------------------------------------------------------------------ */

export const PROPOSE_TITLE = 'Propose a program';
export const PROPOSE_CRUMB = 'Programs';
export const PROPOSE_LINE = 'Five steps. HQ reviews every proposal and answers under Your proposals.';
export const STEPS = Object.freeze(['Basics', 'How it runs', 'Terms', 'Tools', 'Review']);

/** "Product testers" waits for #2377, so it is not offered. */
export const WHO_WORDS = Object.freeze(['Founders', 'Investors', 'Advisors', 'Operating partners', 'Explorers']);
export const PROPOSAL_GROUPS = GROUPS;
export const JOIN_METHODS = Object.freeze(['Open', 'By application', 'By invitation', 'Assigned by an admin']);
export const REWARDS = Object.freeze(['None', 'Credits', 'Cash', 'Equity']);
/** The seven switches, as part 2 stores them (declarations only). */
export const TOOLS = Object.freeze([
  ['application_queue', 'Application queue'],
  ['cohort_calendar', 'Cohort calendar'],
  ['assignments', 'Assignments'],
  ['referral_codes', 'Referral codes'],
  ['credits_perks', 'Credits and perks'],
  ['learning_content', 'Learning content'],
  ['events', 'Events'],
]);

export const CYCLE_LINE = 'Saved as text. It sets no calendar: the only cohort calendar today is the Spin-Out Lab’s, four weeks a month.';
export const REWARDS_LINE = 'What your studio asks for. Nothing pays from it until HQ sets a rule.';
export const TERMS_FOOT = 'These are the participant terms. HQ sets your studio’s grant terms when it grants the program, on Licences.';
export const TOOLS_LINE = 'The tools this program needs. HQ reads them with the proposal; nothing is switched on for the program.';
export const REVIEW_LINE = 'The playbook as HQ will read it.';
export const REVIEW_FOOT = 'HQ reviews every proposal. You will see HQ’s answer under Your proposals.';
export const NOT_SET = 'Not set';
export const NOT_SAVED = 'Not saved yet';
/** Part 2's own sentence for 403 `proposals_closed` (D955 §3, OD-PROP). */
export const PROPOSALS_CLOSED = 'HQ has not opened program proposals yet, so this proposal cannot be sent. It stays saved as a draft.';

const FIELD_WORDS = { name: 'a name', purpose: 'a one-line purpose', who: 'who it is for', group: 'a group', join_method: 'a join method' };

/** An empty form, as a draft nobody has filled. */
export function emptyForm() {
  return {
    name: '', purpose: '', who: [], group: null, join_method: null, cycle: null, cohort_weeks: '', seats: '',
    eligibility: '', rewards: [], template_keys: [], hq_receives: '',
    tools: Object.fromEntries(TOOLS.map(([k]) => [k, false])),
  };
}

/** The form from part 2's stored proposal; a field nobody set stays empty. */
export function formFrom(p) {
  const f = emptyForm();
  if (!p) return f;
  return {
    ...f,
    name: p.name ?? '', purpose: p.purpose ?? '', who: (p.who ?? []).filter((w) => WHO_WORDS.includes(w)),
    group: p.group ?? null, join_method: p.join_method ?? null, cycle: p.cycle ?? null,
    cohort_weeks: p.cohort_weeks == null ? '' : String(p.cohort_weeks), seats: p.seats == null ? '' : String(p.seats),
    eligibility: p.eligibility ?? '', rewards: p.rewards ?? [], template_keys: p.template_keys ?? [],
    hq_receives: p.hq_receives ?? '', tools: { ...f.tools, ...(p.tools || {}) },
  };
}

const textOrNull = (s) => (String(s ?? '').trim() ? String(s).trim() : null);
const wholeOrNull = (s) => (String(s ?? '').trim() === '' ? null : Number(s));

/** What the form saves: every field, an empty one as null (part 2 reads null as "Not set"). */
export function fieldsFrom(form) {
  return {
    name: textOrNull(form.name), purpose: textOrNull(form.purpose), who: form.who.length ? form.who : null,
    group: form.group, join_method: form.join_method, cycle: form.cycle,
    cohort_weeks: form.cycle === 'cohorts' ? wholeOrNull(form.cohort_weeks) : null, seats: wholeOrNull(form.seats),
    eligibility: textOrNull(form.eligibility), rewards: form.rewards.length ? form.rewards : null,
    template_keys: form.template_keys, hq_receives: textOrNull(form.hq_receives), tools: form.tools,
  };
}

/** New program takes Basics and How it runs only (D955 §5). */
export function newProgramFields(form) {
  const f = fieldsFrom(form);
  return Object.fromEntries(['name', 'purpose', 'who', 'group', 'join_method', 'cycle', 'cohort_weeks', 'seats', 'eligibility']
    .map((k) => [k, f[k]]).filter(([, v]) => v !== null));
}

/** None stands alone (part 2's `bad_rewards`): picking None clears the rest, and the rest clear None. */
export function toggleReward(list, word) {
  if (list.includes(word)) return list.filter((w) => w !== word);
  if (word === 'None') return ['None'];
  return [...list.filter((w) => w !== 'None'), word];
}

export const toggleWord = (list, word) => (list.includes(word) ? list.filter((w) => w !== word) : [...list, word]);

/* ------------------------------------------------------------------ *
 * Review: the playbook HQ will read, as part 2 writes it (dc:467)
 * ------------------------------------------------------------------ */

const lower = (w) => w.charAt(0).toLowerCase() + w.slice(1);
const listLine = (words) => words.map((w, i) => (i ? lower(w) : w)).join(', ');

export function cycleLine(cycle, weeks) {
  if (cycle === 'rolling') return 'rolling';
  if (cycle === 'cohorts') {
    const n = Number(weeks);
    // As part 2's `joinLine`: cohorts with no length set say nothing yet.
    return Number.isInteger(n) && n > 0 ? `cohorts of ${n} ${n === 1 ? 'week' : 'weeks'}` : null;
  }
  return null;
}

/** "By application · cohorts of 12 weeks · 12 seats". */
export function joinLine(form) {
  const seats = Number(form.seats);
  const parts = [
    form.join_method,
    cycleLine(form.cycle, form.cohort_weeks),
    String(form.seats ?? '').trim() && Number.isInteger(seats) && seats > 0 ? `${seats} ${seats === 1 ? 'seat' : 'seats'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function reviewRows(form) {
  const tools = TOOLS.filter(([k]) => form.tools?.[k]).map(([, label]) => label);
  return [
    { key: 'purpose', title: 'Purpose', body: textOrNull(form.purpose) },
    { key: 'who', title: 'Who it is for', body: form.who.length ? listLine(form.who) : null },
    { key: 'join', title: 'How people join', body: joinLine(form) },
    { key: 'rewards', title: 'Rewards', body: form.rewards.length ? form.rewards.join(', ') : null },
    { key: 'tools', title: 'Tools', body: tools.length ? listLine(tools) : null },
  ];
}

/** What Send still needs, as part 2's `missing` would name it. */
export function missingFor(form) {
  return [
    !textOrNull(form.name) && 'name', !textOrNull(form.purpose) && 'purpose', !form.who.length && 'who',
    !form.group && 'group', !form.join_method && 'join_method',
  ].filter(Boolean);
}

export function missingSentence(missing) {
  const words = (missing || []).map((k) => FIELD_WORDS[k] || k);
  if (!words.length) return null;
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `Add ${list} before sending to HQ.`;
}

/* ------------------------------------------------------------------ *
 * Times
 * ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Oct", in UTC as D1 stores it; null when there is no stamp. */
export function dayLabel(stamp) {
  const ms = parseStamp(stamp);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Draft saved 10:41", only from part 2's stored `updated_at`. */
export function savedLabel(proposal) {
  const ms = parseStamp(proposal?.updated_at);
  if (!proposal?.uid || !Number.isFinite(ms)) return NOT_SAVED;
  const d = new Date(ms);
  return `Draft saved ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * The lists: Your proposals (PG1) and Proposals from studios (PG2)
 * ------------------------------------------------------------------ */

export const MINE_TITLE = 'Your proposals';
export const QUEUE_TITLE = 'Proposals from studios';
export const MINE_EMPTY = 'Your studio has not proposed a program yet.';
export const QUEUE_EMPTY = 'No studio has sent a proposal to HQ yet.';
export const NO_MATCH = 'No proposal matches these filters.';
export const NO_NOTE = 'No note yet';
export const NOT_SENT = 'Not sent';
export const HQ_HELD = 'HQ-held';

export const MINE_STATUSES = Object.freeze(['draft', 'sent', 'approved', 'sent_back', 'declined']);
/** HQ's queue holds no drafts (D955 §2). */
export const QUEUE_STATUSES = Object.freeze(['sent', 'approved', 'sent_back', 'declined']);
export const MINE_SORTS = Object.freeze([['newest', 'Newest'], ['oldest', 'Oldest']]);
export const QUEUE_SORTS = Object.freeze([['oldest', 'Oldest first'], ['newest', 'Newest first']]);

/** The list read's parameters: only what is set. */
export function listParams({ q = '', status = null, sort, page = 1, licence = null }) {
  const out = {};
  if (q.trim().length >= 2) out.q = q.trim();
  if (status) out.status = status;
  if (sort) out.sort = sort;
  if (licence) out.licence = licence;
  if (page > 1) out.page = page;
  return out;
}

/** "1–5 of 5". */
export function pageLabel({ page, page_size: size, total, rows }) {
  if (!total) return '0 of 0';
  const from = (page - 1) * size + 1;
  return `${from}–${from + (rows?.length || 0) - 1} of ${total.toLocaleString('en-US')}`;
}

export const lastPage = ({ page_size: size, total }) => Math.max(1, Math.ceil((total || 0) / (size || 1)));

/** The studios HQ can filter by: every licence the grants read lists, and HQ-held. */
export function studioOptions(grid) {
  const rows = (grid?.licences || []).map((l) => [l.uid, l.brand_name?.trim() || l.licence_ref || l.uid]);
  return [...rows.sort((a, b) => a[1].localeCompare(b[1])), ['hq-held', HQ_HELD]];
}

/** The amber count on HQ's Proposals tab: proposals sent and not yet decided. */
export const waitingCount = (queue) => (queue && Number.isFinite(Number(queue.counts?.sent)) ? Number(queue.counts.sent) : null);

/* ------------------------------------------------------------------ *
 * HQ's side
 * ------------------------------------------------------------------ */

export const NEW_PROGRAM = 'New program';
export const NEW_PROGRAM_LINE = 'It joins the catalogue as Proposed, with an empty playbook draft you edit and publish on its page.';

/** PG15a's four choices, with what part 2 records for each today. */
export const OUTCOMES = Object.freeze([
  { key: 'approve_studio', label: 'Approve for this studio only', records: 'Adds the program to this studio’s catalogue only, as Proposed, with its playbook as a draft.' },
  { key: 'approve_catalogue', label: 'Approve for the catalogue (any studio may request it)', records: 'Adds the program to every studio’s catalogue, as Proposed, with its playbook as a draft.' },
  { key: 'send_back', label: 'Send back', records: 'The studio can change it and send it again. They read your note under Your proposals.' },
  { key: 'decline', label: 'Decline', records: 'This is final. The studio reads your note under Your proposals.' },
]);
export const NOTE_LABEL = 'Note to the studio · required for Send back and Decline';
export const GRANT_LATER = 'Program grants come later: an approval sets no grant yet. HQ sets grant terms on Licences › Program grants once that part lands.';
export const noteNeeded = (outcome) => outcome === 'send_back' || outcome === 'decline';

export const decideTitle = (name) => `Decide on ${name || 'this proposal'}`;
export function decideSub(p) {
  const day = dayLabel(p?.sent_at);
  return `From ${p?.studio || HQ_HELD}${day ? ` · sent ${day}` : ''}.`;
}

/** PG19b: an Admin at HQ's proposals address. */
export const ONLY_HQ = 'Only HQ decides on proposals.';
export const YOURS_UNDER_PROGRAMS = 'Your own proposals are under Programs.';

/* ------------------------------------------------------------------ *
 * Refusals: one sentence in place, keyed on `code`
 * ------------------------------------------------------------------ */

const SENTENCES = {
  proposals_closed: PROPOSALS_CLOSED,
  not_editable: 'This proposal can no longer be changed: HQ has it, or has decided it. Reload to see where it is.',
  unknown_proposal: 'This proposal no longer exists, or belongs to another studio.',
  note_required: 'Write a note to the studio. It is required to send a proposal back or decline it.',
  note_too_long: 'Keep the note to 2,000 characters.',
  not_waiting: 'Another decision landed first, or this proposal is no longer waiting. Reload to see it.',
  no_studio: 'This proposal came from no studio, so it cannot be approved for one studio only.',
  program_key_taken: 'A program with this name already exists. Change the name and try again.',
  unknown_template: 'One of the contract templates is no longer in the library. Choose again.',
  nothing_to_change: 'There is nothing new to save.',
  bad_field: 'New program takes Basics and How it runs only.',
  admin_frozen: FROZEN,
  branch_suspended: SUSPENDED,
};

export function proposalRefusal(err) {
  const code = err?.code || err?.data?.code || (typeof err?.data?.error === 'string' ? err.data.error : null);
  if (code === 'incomplete') return missingSentence(err?.data?.missing) || 'Fill in the required fields before sending to HQ.';
  if (code && SENTENCES[code]) return SENTENCES[code];
  if (typeof code === 'string' && code.startsWith('bad_')) return 'One of the fields was refused. Check it and save again.';
  if (Number(err?.status) === 403) return 'Only HQ can do this.';
  return TRY_AGAIN;
}
