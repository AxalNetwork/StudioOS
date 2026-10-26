/**
 * D1244 (#2385) — Due diligence as a case desk, from the owner's canvas "Due
 * diligence" (DDL1–DDL19): the list's tabs and the case's tabs as addresses
 * (never `?tab=`), the risk band's words with "Not scored yet", the decision's
 * words, and the words of every block no read carries yet. Pure, so
 * `frontend/test/due_diligence_d1244.test.mjs` holds each rule.
 *
 * WHAT IS READ TODAY. `GET /api/dd/cases` (the newest 200) and
 * `GET /api/dd/cases/:uid` (case, sections, findings, sources, attachments,
 * reviewers, checklist, requests). There is no decision, no memo, no flag
 * state, no my-reviews read and no template store, so those blocks say "Not
 * read here yet" with their reason and never draw a zero (D1244 §2).
 */

export const ADMIN_BASE = '/admin/due-diligence';
export const MEMBER_BASE = '/due-diligence';

/** The page's title and line (DDL1). */
export const TITLE = 'Due diligence';
export const PAGE_LINE = 'Every diligence case: what is in scope, what is still open, and what the team decided.';

/** The same pages sit under both addresses; a link stays on the caller's. */
export const baseOf = (pathname = '') => (String(pathname).startsWith('/admin') ? ADMIN_BASE : MEMBER_BASE);

/** The list's tabs (DDL1, DDL12, DDL13). Cases is the bare base. */
export const LIST_TABS = Object.freeze([
  { key: 'cases', label: 'Cases', slug: '' },
  { key: 'my-reviews', label: 'My reviews', slug: 'my-reviews' },
  { key: 'templates', label: 'Templates', slug: 'templates' },
]);

/** The case's tabs (DDL3–DDL11). The bare case address opens Overview. */
export const CASE_TABS = Object.freeze([
  { key: 'overview', label: 'Overview' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'flags', label: 'Flags' },
  { key: 'requests', label: 'Requests' },
  { key: 'documents', label: 'Documents' },
  { key: 'cross-checks', label: 'Cross-checks' },
  { key: 'team', label: 'Team' },
  { key: 'sign-off', label: 'Sign-off' },
  { key: 'activity', label: 'Activity' },
]);

const UID = /^[A-Za-z0-9_-]{1,64}$/;
const LIST_SLUGS = LIST_TABS.map((t) => t.slug).filter(Boolean);

/**
 * What the address names: the base, then either a list tab or a case and its
 * tab. An unknown case tab is Overview, so a mistyped tab still opens the case.
 */
export function viewOf(pathname = '') {
  const base = baseOf(pathname);
  const rest = String(pathname).slice(base.length).replace(/^\/+|\/+$/g, '');
  const [first = '', second = ''] = rest.split('/');
  if (!first) return { base, listTab: 'cases', uid: null, caseTab: null };
  if (LIST_SLUGS.includes(first) && !second) return { base, listTab: first, uid: null, caseTab: null };
  if (!UID.test(first)) return { base, listTab: 'cases', uid: null, caseTab: null };
  const caseTab = CASE_TABS.some((t) => t.key === second) ? second : 'overview';
  return { base, listTab: null, uid: first, caseTab };
}

export function listHref(base, key) {
  const t = LIST_TABS.find((x) => x.key === key);
  return t && t.slug ? `${base}/${t.slug}` : base;
}

/** A case tab's address, `/overview` included; the bare case address opens Overview as well. */
export function caseHref(base, uid, tab = 'overview') {
  if (!UID.test(String(uid ?? ''))) return base;
  return `${base}/${uid}/${CASE_TABS.some((t) => t.key === tab) ? tab : 'overview'}`;
}

/** The risk band (DDL3). A case with nothing scored says so; it is never Green by default. */
export const BAND_WORD = Object.freeze({ green: 'Green', yellow: 'Yellow', amber: 'Amber', red: 'Red' });
export const bandWord = (b) => BAND_WORD[b] || 'Not scored yet';

/** The case decision (DDL10, DDL14 D). No column carries it yet (part 2). */
export const DECISION_WORD = Object.freeze({
  proceed: 'Proceed',
  proceed_with_conditions: 'Proceed with conditions',
  do_not_proceed: 'Do not proceed',
  withdrawn: 'Withdrawn',
});
export const decisionWord = (d) => DECISION_WORD[d] || 'Not recorded';

/** Where each case tab's blocks are drawn today, until part 7 draws the tab itself. */
export const ON_OVERVIEW = Object.freeze({
  checklist: 'The checklist’s progress and each section’s items are on Overview today.',
  flags: 'The findings and the severity heat map are on Overview today.',
  requests: 'The requests to the subject, with Compose and Mark reviewed, are on Overview today.',
  documents: 'Reviewer NDAs are recorded on each section on Overview today.',
  'cross-checks': 'The external sources and their state are on Overview today.',
  team: 'The reviewer queue and Assign are on Overview today.',
  'sign-off': 'Each section’s verdict and sign-off line, and Generate report, are on Overview today.',
  activity: 'The audit log opens from the case header today.',
});

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  'my-reviews': 'The sections you are invited to review, across cases, are not read here yet (part 5).',
  templates: 'Versioned templates with weights and blocking sections are not stored yet; Lite, Standard and Deep are fixed in the Worker today (part 5).',
  decision: 'The case decision, its reason and who recorded it are not stored yet (part 2).',
  flags: 'Flags raised by hand, with an owner, a state and a resolution, are not stored yet (part 3).',
  documents: 'Files the subject filed against a request, evidence on checklist items and NDA downloads are not read here yet (part 4).',
  'cross-checks': 'Platform checks (KYC & KYB, Partner profiles) and what is taken on trust are not read here yet (part 5).',
  team: 'Conflict declarations, invitation expiry and Remove are not stored yet (part 5).',
  'sign-off': 'The deal team’s memo, the decision, the hand-off to IC and the list of past reports are not stored yet (part 2).',
  activity: 'The activity timeline with filters is drawn in part 7; the audit log already reads it.',
  checklist: 'Evidence per item and bulk changes are not stored yet (part 4).',
  requests: 'Due dates, reminders and withdraw are not stored yet (part 4).',
});
