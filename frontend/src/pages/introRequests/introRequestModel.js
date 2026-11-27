/**
 * D9068 (#9068): the pure words and rules of the member's introduction requests through Axal, read from what
 * /api/intro-requests (D7673) answers. No fetch here and no React, so every rule below is tested on its own.
 *
 * Readiness is the server's: `GET /readiness` answers each requirement's status from stored reviews and a `ready`
 * the Worker computed. Nothing here decides a member is ready; it only refuses to say so when the server did not,
 * and an answer it cannot read is Unreadable, which never counts as ready (NRD-00, NRD-10).
 */

/* ---------- readiness: one requirement row (NRD-01 B) ---------- */

/** The Worker's requirement statuses (`readinessGaps`), each with its own glyph and word, never colour alone. */
export const REQUIREMENT_STATUS = Object.freeze({
  missing: { word: 'Not started', glyph: '□', tone: 'plain', group: 'needs_you', next: 'You' },
  rejected: { word: 'Declined', glyph: '✕', tone: 'bad', group: 'needs_you', next: 'You: change it and it is reviewed again' },
  expired: { word: 'Expired', glyph: '⌛', tone: 'warn', group: 'needs_you', next: 'You renew it' },
  awaiting_review: { word: 'Submitted', glyph: '↑', tone: 'violet', group: 'reviewer', next: 'An Axal reviewer' },
  met: { word: 'Approved', glyph: '✓', tone: 'good', group: 'done', next: 'Nobody' },
});
/** A status the Worker sent that this page does not know reads Unreadable: never Approved, never hidden. */
export const UNREADABLE_STATUS = Object.freeze({ word: 'Unreadable', glyph: '▧', tone: 'bad', group: 'needs_you', next: 'Try again, then support' });

export function requirementStatus(status) {
  return REQUIREMENT_STATUS[status] || UNREADABLE_STATUS;
}

/** What each base requirement is. A key a later policy adds and this page does not know shows its own key. */
export const REQUIREMENT_COPY = Object.freeze({
  professional_profile: {
    title: 'Professional profile',
    why: 'Axal reads it to understand who is asking. A headline is required; a profile link is optional.',
    action: 'Edit profile',
  },
  capacity: {
    title: 'Capacity',
    why: 'The capacity you ask in, and the organisation you represent if you ask for one.',
    action: 'Set capacity',
  },
});
export function requirementCopy(key) {
  return REQUIREMENT_COPY[key] || { title: String(key || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), why: null, action: 'Open' };
}

/** Rows grouped as the canvas groups them: Needs you, With a reviewer, Done. */
export function groupRequirements(requirements) {
  const out = { needs_you: [], reviewer: [], done: [] };
  for (const r of requirements || []) out[requirementStatus(r.status).group].push(r);
  return out;
}

/* ---------- readiness: the aggregate, worst first (NRD-00) ---------- */

export const AGGREGATE = Object.freeze({
  unr: { word: 'Unreadable', glyph: '▧', tone: 'bad' },
  blk: { word: 'Blocked', glyph: '✕', tone: 'bad' },
  exp: { word: 'Expired', glyph: '⌛', tone: 'warn' },
  ns: { word: 'Not started', glyph: '□', tone: 'plain' },
  inc: { word: 'Incomplete', glyph: '◐', tone: 'warn' },
  rev: { word: 'In review', glyph: '◷', tone: 'violet' },
  ready: { word: 'Ready to request', glyph: '✓', tone: 'good' },
});

/**
 * One aggregate for the whole readiness answer, worst first. `readiness` is the Worker's answer, or null when the
 * read failed. Ready needs both the server's `ready` and every row Approved: either alone is not enough.
 */
export function aggregateReadiness(readiness) {
  const reqs = readiness?.requirements;
  if (!readiness || !Array.isArray(reqs) || typeof readiness.ready !== 'boolean') return 'unr';
  if (reqs.some((r) => !REQUIREMENT_STATUS[r.status])) return 'unr';
  if (reqs.some((r) => r.status === 'rejected')) return 'blk';
  if (reqs.some((r) => r.status === 'expired')) return 'exp';
  if (reqs.length && reqs.every((r) => r.status === 'missing')) return 'ns';
  if (reqs.some((r) => r.status === 'missing')) return 'inc';
  if (reqs.some((r) => r.status === 'awaiting_review')) return 'rev';
  if (readiness.ready === true && reqs.every((r) => r.status === 'met')) return 'ready';
  // The rows and the server's answer disagree: say nothing is known rather than call it ready.
  return 'unr';
}

/** The headline under the aggregate: counts from the rows the server sent. */
export function aggregateLine(readiness) {
  const g = groupRequirements(readiness?.requirements);
  const total = (readiness?.requirements || []).length;
  const parts = [];
  if (g.needs_you.length) parts.push(`${g.needs_you.length} ${g.needs_you.length === 1 ? 'item needs' : 'items need'} you`);
  if (g.reviewer.length) parts.push(`${g.reviewer.length} ${g.reviewer.length === 1 ? 'is' : 'are'} with a reviewer`);
  return { done: g.done.length, total, rest: parts.join(' and ') };
}

/** The readiness items that block a submit, each with its word, for the blocked-submit list (NRD-07, NIE05). */
export function blockingItems(readiness) {
  return (readiness?.requirements || [])
    .filter((r) => r.status !== 'met')
    .map((r) => ({ key: r.key, title: requirementCopy(r.key).title, status: requirementStatus(r.status) }));
}

/** How long an approval lasts: the policy's own validity, or none when the policy sets none. */
export function validityLine(req, policy) {
  if (req?.valid_until) return `to ${String(req.valid_until).slice(0, 10)}`;
  if (req?.status === 'met' && policy && policy.validity_days == null) return 'No end date: the policy sets none';
  return null;
}

/* ---------- capacity (NRD-02, NRD-03) ---------- */

/** The three journeys the canvas draws. The Worker stores the capacity as text; these are the words sent. */
export const CAPACITIES = Object.freeze([
  { value: 'founder', label: 'Founder', hint: 'For a company you run' },
  { value: 'investor', label: 'Investor', hint: 'Your own capital or a firm’s' },
  { value: 'advisor', label: 'Advisor', hint: 'In your own name or a practice’s' },
]);
export function capacityLabel(value) {
  const c = CAPACITIES.find((x) => x.value === value);
  return c ? c.label : value || null;
}

/* ---------- validation, before the server is asked (NRD-04 B) ---------- */

const httpsOk = (v) => {
  if (!v) return true;
  try {
    return new URL(v).protocol === 'https:' && v.length <= 500;
  } catch {
    return false;
  }
};

/** The profile form's field errors, in the order the form shows them. The server checks the same again. */
export function profileErrors({ headline, profile_url }) {
  const out = [];
  if (!String(headline || '').trim()) out.push({ field: 'headline', message: 'Headline: add a professional headline.' });
  else if (Array.from(String(headline)).length > 300) out.push({ field: 'headline', message: 'Headline: keep it to 300 characters.' });
  if (!httpsOk(profile_url)) out.push({ field: 'profile_url', message: 'Profile link: enter a full link that starts with https://' });
  return out;
}
export function capacityErrors({ capacity, represented_organization }) {
  const out = [];
  if (!String(capacity || '').trim()) out.push({ field: 'capacity', message: 'Capacity: choose the capacity you ask in.' });
  if (Array.from(String(represented_organization || '')).length > 300) out.push({ field: 'represented_organization', message: 'Organisation: keep it to 300 characters.' });
  return out;
}
export function provisionalErrors({ display_name, organization_text, profile_url }) {
  const out = [];
  if (!String(display_name || '').trim()) out.push({ field: 'display_name', message: 'Full name: name the person.' });
  if (Array.from(String(organization_text || '')).length > 300) out.push({ field: 'organization_text', message: 'Organisation: keep it to 300 characters.' });
  if (!httpsOk(profile_url)) out.push({ field: 'profile_url', message: 'Public page: enter a full link that starts with https://' });
  return out;
}
export const LIMITS = Object.freeze({ purpose: 2000, shareable_brief: 4000, private_notes: 4000 });

/* ---------- a request: the four separate fields (NIE01, NIE10) ---------- */

export const STATE_WORDS = Object.freeze({
  draft: { word: 'Draft', glyph: '✎', tone: 'plain' },
  readiness_needed: { word: 'Readiness needed', glyph: '!', tone: 'warn' },
  submitted: { word: 'Awaiting assignment', glyph: '◷', tone: 'warn' },
  in_review: { word: 'In review', glyph: '◉', tone: 'violet' },
  needs_information: { word: 'Needs information', glyph: '?', tone: 'warn' },
  outreach_ready: { word: 'Outreach ready', glyph: '▸', tone: 'violet' },
  contacted: { word: 'Contacted', glyph: '✉', tone: 'violet' },
  awaiting_target: { word: 'Awaiting target', glyph: '◷', tone: 'warn' },
  declined: { word: 'Declined', glyph: '◌', tone: 'plain' },
  unavailable: { word: 'Unavailable to proceed', glyph: '⊗', tone: 'plain' },
  agreed: { word: 'Agreed', glyph: '✓', tone: 'good' },
  introduction_made: { word: 'Introduction made', glyph: '✓✓', tone: 'good' },
  closed: { word: 'Closed', glyph: '■', tone: 'plain' },
  withdrawn: { word: 'Withdrawn', glyph: '⊘', tone: 'plain' },
});
export function stateWord(state) {
  return STATE_WORDS[state] || { word: 'Unreadable', glyph: '▧', tone: 'bad' };
}

const CONSENT = Object.freeze({
  not_asked: { word: 'Not asked yet', glyph: '○', tone: 'plain' },
  asked: { word: 'Awaiting answer', glyph: '◷', tone: 'warn' },
  granted: { word: 'Agreed', glyph: '✓', tone: 'good' },
  declined: { word: 'Declined', glyph: '◌', tone: 'plain' },
});

const eventsOf = (r) => (Array.isArray(r?.events) ? r.events : []);
const lastEvent = (r, type) => [...eventsOf(r)].reverse().find((e) => e.type === type) || null;

/**
 * Request, target response, contact attempt and introduction, kept apart. Each comes from its own field or event:
 * the state, `consent_status`, a requester-visible `contact_attempted` event, and the introduction-made move.
 */
export function fourFields(r) {
  const contact = lastEvent(r, 'contact_attempted');
  const made = r?.state === 'introduction_made' || !!lastEvent(r, 'moved_introduction_made');
  const response = r?.state === 'unavailable'
    ? { word: 'Unavailable to proceed', glyph: '⊗', tone: 'plain' }
    : CONSENT[r?.consent_status] || { word: 'Unreadable', glyph: '▧', tone: 'bad' };
  return {
    request: stateWord(r?.state),
    response,
    contact: contact ? { word: 'Contact recorded', glyph: '✓', tone: 'good', at: contact.at } : { word: 'No contact yet', glyph: '○', tone: 'plain' },
    introduction: made ? { word: 'Introduction made', glyph: '✓✓', tone: 'good' } : { word: 'Not made', glyph: '○', tone: 'plain' },
  };
}

/** Who acts next, in the requester's words; the Worker's `next_actor` decides, the state only words it. */
export function nextLine(r) {
  const s = r?.state;
  if (s === 'draft') return 'You: finish the draft and submit it to Axal';
  if (s === 'readiness_needed') return 'You: the readiness items below, then submit again';
  if (s === 'needs_information') return 'You: answer Axal’s question';
  if (r?.next_actor === 'operator') {
    if (s === 'submitted') return 'Axal assigns an operator';
    if (s === 'in_review') return 'An Axal operator reviews the person and your brief';
    if (s === 'outreach_ready') return 'An Axal operator decides how to contact the person';
    if (s === 'contacted') return 'An Axal operator records the person’s answer';
    return 'An Axal operator records what happens next';
  }
  if (r?.next_actor === 'target') return 'The person answers Axal';
  if (r?.next_actor === 'none') return 'Nobody: this request is finished';
  return null;
}

/** The desk's four lanes, one per `next_actor` value, counted by the server (`lanes`). */
export const LANES = Object.freeze([
  { key: 'requester', label: 'Needs you' },
  { key: 'operator', label: 'Awaiting Axal' },
  { key: 'target', label: 'Awaiting target' },
  { key: 'none', label: 'History' },
]);
export function laneOf(value) {
  return LANES.find((l) => l.key === value) ? value : 'requester';
}

/** Who the request names. An organisation alone is context: the person is still to be identified. */
export function targetLine(r) {
  const t = r?.target || {};
  if (t.display_name) {
    const kind = t.kind === 'provisional'
      ? t.provisional_status === 'resolved' ? 'named by you · identified by Axal' : 'named by you · Axal reviews who they are'
      : 'from the shared directory';
    return { name: t.display_name, kind, organization: t.organization_name || null };
  }
  if (t.organization_name) return { name: `Person to be identified at ${t.organization_name}`, kind: 'organisation only · Axal identifies the person', organization: t.organization_name };
  return { name: null, kind: null, organization: null };
}

/* ---------- activity (NIE10) ---------- */

const EVENT_WORDS = Object.freeze({
  draft_created: 'You started the draft',
  draft_updated: 'You saved the draft',
  readiness_needed: 'Submit checked: readiness items are needed',
  submitted: 'You submitted the request to Axal',
  assigned: 'An Axal operator took the request',
  information_supplied: 'You answered Axal',
  moved_needs_information: 'Axal asked you for more information',
  moved_outreach_ready: 'Axal marked the request ready for outreach',
  contact_attempted: 'Axal recorded contact with the person',
  moved_awaiting_target: 'Waiting for the person’s answer',
  moved_agreed: 'The person agreed',
  moved_declined: 'The person declined',
  moved_unavailable: 'Axal found no way to proceed',
  moved_introduction_made: 'Introduction made',
  moved_closed: 'Axal closed the request',
  withdrawn: 'You withdrew the request',
});
export function eventSentence(e) {
  if (!e) return null;
  if (EVENT_WORDS[e.type]) return EVENT_WORDS[e.type];
  return String(e.type || 'An event').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
/** The operator's question, from the requester-visible event that asked it. */
export function openQuestion(r) {
  if (r?.state !== 'needs_information') return null;
  const e = lastEvent(r, 'moved_needs_information');
  return e ? { text: e.detail?.question || null, at: e.at } : { text: null, at: null };
}

/* ---------- withdraw (NIE17) ---------- */

export const WITHDRAWABLE = Object.freeze(['draft', 'readiness_needed', 'submitted', 'in_review', 'needs_information', 'outreach_ready', 'contacted', 'awaiting_target']);
export const EDITABLE = Object.freeze(['draft', 'readiness_needed']);
export function withdrawCopy(r) {
  const after = r?.state === 'contacted' || r?.state === 'awaiting_target';
  return after
    ? { stage: 'after contact', effect: 'Axal stops coordinating. The person already received Axal’s contact, which cannot be undone; an Axal operator decides whether to send them a short close note.' }
    : { stage: 'before contact', effect: 'Axal stops. The person was never contacted and will not be.' };
}

/* ---------- refusals: our sentence for each code the routes send ---------- */

const REFUSALS = Object.freeze({
  revision_conflict: 'This request changed since you opened it. The newer version is shown; what you typed here is kept.',
  request_not_found: 'This request is not available to you.',
  request_not_editable: 'This request can no longer be edited.',
  request_not_submittable: 'This request has already been submitted.',
  request_not_withdrawable: 'This request is already finished.',
  target_not_found: 'That person is not available to you in the directory.',
  organization_not_found: 'That organisation is not available to you in the directory.',
  target_required: 'Name a person, or an organisation whose right person Axal should identify.',
  one_target_only: 'Name the person from the directory or as someone new, not both.',
  display_name_required: 'Name the person, in up to 300 characters.',
  organization_text_invalid: 'Their organisation can be up to 300 characters.',
  profile_url_invalid: 'A link must be a full https address of up to 500 characters.',
  headline_required: 'Add a professional headline of up to 300 characters.',
  capacity_required: 'Choose the capacity you ask in.',
  represented_organization_invalid: 'The organisation you represent can be up to 300 characters.',
  purpose_invalid: 'The purpose is longer than 2,000 characters.',
  shareable_brief_invalid: 'The brief is longer than 4,000 characters.',
  private_notes_invalid: 'The private note is longer than 4,000 characters.',
  support_session_read_only: 'A support session can read requests but not change them.',
  intro_policy_unavailable: 'Introduction requests are not open: no readiness policy is active.',
  expected_revision_required: 'Reload the request and try again.',
});
/** The sentence for a failed write. A dropped connection is its own case: the write may or may not have landed. */
export function refusalSentence(err) {
  if (err && err.code && REFUSALS[err.code]) return REFUSALS[err.code];
  if (!err || err.status == null) return 'The answer did not arrive. Nothing is lost here.';
  return 'Not saved. What you typed is kept here.';
}

/** One idempotency key per new request, so a retried or double-clicked create returns the first draft. */
export function newIdempotencyKey(rand = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`)) {
  return `ir-${String(rand()).replace(/[^A-Za-z0-9-]/g, '')}`.slice(0, 128);
}

/* ---------- what Axal will share (NRD-06) ---------- */

/** The target brief, field by field: only what the Worker's target projection carries. */
export function sharePreview(readiness, r) {
  const value = (key) => (readiness?.requirements || []).find((x) => x.key === key)?.value || null;
  const profile = value('professional_profile');
  const cap = value('capacity');
  return [
    { label: 'Headline', value: profile?.headline || null },
    { label: 'Profile link', value: profile?.profile_url || null },
    { label: 'Capacity', value: capacityLabel(cap?.capacity) },
    { label: 'Organisation you represent', value: cap?.represented_organization || null },
    { label: 'Purpose', value: r?.purpose || null },
    { label: 'Brief', value: r?.shareable_brief || null },
  ];
}
export const STAYS_PRIVATE = Object.freeze([
  'Your private note on this request',
  'Readiness statuses, reviews and evidence references',
  'Your email and other contact channels',
  'Your other requests',
]);

/** A stored stamp as "YYYY-MM-DD HH:MM UTC"; null when none. */
export function stamp(v) {
  if (!v) return null;
  const s = String(v).replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
  return `${s.slice(0, 16)} UTC`;
}
export const shortUid = (uid) => String(uid || '').replace(/^ir_/, '').slice(0, 8);
