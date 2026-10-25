/**
 * D953 (#2371) — Admin › Programs: the catalogue at /admin/programs and one
 * page per program, with its tabs as sub-paths. Pure: no React, no fetch, so
 * the tests read every rule without a browser.
 *
 * The canvas is the owner's "Programs" (PG1–PG20). The pages draw only the
 * blocks whose reads exist, each truthfully; the rest is D953 §6's twelve
 * parts, and this file grows a rule when its read lands.
 *
 * WHAT IS READ (D953 §2; the R-numbers are D953's):
 *   R1  `GET /api/admin/studio/glance`: the `cohort` and `referrals` lanes,
 *       each `{ count, oldest_age_hours, sla }`; a failed lane is `count: null`;
 *   R2  `GET /api/admin/lab-hosts?status=pending`: all-time `counts` by status,
 *       and the newest 500 pending;
 *   R3  `GET /api/perks/admin/queue`: `in_review` only (D1039), the oldest 200;
 *   R4  `GET /api/perks/`: live listings, at most 200;
 *   R5  `GET /api/advisors/admin/cohort-assignments`: the newest 500 rows, with
 *       each holder's current role;
 *   R6  `GET /api/advisors/admin/cohort-assignments/assignable`: at most 500;
 *   R7  `GET /api/admin/cohort/timeline`: the 12 newest cycles and their weeks;
 *   R8  `GET /api/refer-earn/admin/submissions?status=&limit=200`, one status
 *       per call, newest first, no total;
 *   R9  `GET /api/learning/programs/mine`: each program, at most 500;
 *   R10 `GET /api/learning/programs/:uid/learners`: one program's learners;
 *   R11 `GET /api/admin/testing/programmes`: Super Admin only;
 *   R12 `GET /api/admin/insights/scopes`: Super Admin on HQ only.
 *
 * THE WORDS FOR WHAT IS NOT KNOWN are D915's, and each reason is a visible
 * line, never only a `title=`:
 *   "Not recorded"       no store holds it;
 *   "Not read here yet"  it is stored, but no read this page may call serves it;
 *   "Could not be read"  the read failed.
 * A real zero is drawn as 0, and only where every read it covers answered.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { parseStamp } from '../../../ui/parseStamp.js';
import { SCOPE_LABEL, SCOPE_TITLE } from '../insights/insightsModel.js';
import { LEARNING_COMING_SOON } from '../../learning/learningAccess.js';

export { NOT_RECORDED, SCOPE_LABEL, SCOPE_TITLE, parseStamp };

/* ------------------------------------------------------------------ *
 * Addresses (D953 §1)
 * ------------------------------------------------------------------ */

export const PROGRAMS_PATH = '/admin/programs';
export const MENTOR_PATH = '/admin/programs/mentor-cohorts';
export const MENTOR_HOW_PATH = '/admin/programs/mentor-cohorts/how-it-runs';
export const MENTOR_PEOPLE_PATH = '/admin/programs/mentor-cohorts/people';
export const REFER_PATH = '/admin/programs/refer-and-earn';
export const REFER_HOW_PATH = '/admin/programs/refer-and-earn/how-it-runs';
export const REFER_QUEUE_PATH = '/admin/programs/refer-and-earn/queue';
export const REFER_SETTINGS_PATH = '/admin/programs/refer-and-earn/settings';
export const PERKS_PATH = '/admin/programs/perks';
export const PERKS_HOW_PATH = '/admin/programs/perks/how-it-runs';
export const PERKS_QUEUE_PATH = '/admin/programs/perks/queue';
export const LEARNING_PATH = '/admin/programs/learning';
export const LEARNING_HOW_PATH = '/admin/programs/learning/how-it-runs';
export const LEARNING_PEOPLE_PATH = '/admin/programs/learning/people';
export const PARTNERS_PATH = '/admin/programs/referral-partners';
export const PARTNERS_HOW_PATH = '/admin/programs/referral-partners/how-it-runs';
export const INVESTOR_PATH = '/admin/programs/investor-cohorts';
export const AI_NATIVE_PATH = '/admin/programs/ai-native-venture';

/** The three old addresses. Each redirects where its function now lives (D894's rule). */
export const HELD_PROGRAMS_PATH = '/admin/held/programs';
export const ADVISOR_COHORTS_PATH = '/admin/advisor-cohorts';
export const REFER_EARN_PATH = '/admin/refer-earn';

/** The `?moved=` keys the redirects add. */
export const MOVED_HELD = 'held';
export const MOVED_ADVISOR_COHORTS = 'advisor-cohorts';
export const MOVED_REFER_EARN = 'refer-earn';

/** The issue's notices, each drawn where its redirect lands (D953 §1). */
export const MOVED_NOTICES = Object.freeze({
  [MOVED_HELD]: { path: PROGRAMS_PATH, text: 'Programs has a new address. Update your bookmark.' },
  [MOVED_ADVISOR_COHORTS]: { path: MENTOR_PEOPLE_PATH, text: 'Advisor cohort access is now Mentor cohort access, under Programs.' },
  [MOVED_REFER_EARN]: { path: REFER_QUEUE_PATH, text: 'Referral review is now Refer & Earn, under Programs.' },
});

/** The notice for this address, or null: a `?moved=` key shows only where its redirect lands. */
export function movedNotice(pathname, search) {
  const key = new URLSearchParams(search || '').get('moved');
  const hit = key ? MOVED_NOTICES[key] : null;
  if (!hit) return null;
  return trimPath(pathname) === hit.path ? hit.text : null;
}

/** The search without `moved`, for Dismiss. */
export function withoutMoved(search) {
  const q = new URLSearchParams(search || '');
  q.delete('moved');
  const s = q.toString();
  return s ? `?${s}` : '';
}

const trimPath = (p) => String(p || '').replace(/\/+$/, '') || '/';

/** The other pages these pages link to. */
export const SPINOUT_LAB_PATH = '/admin/programs/spinout-lab';
export const PROFILING_TRENDS_PATH = '/admin/profiling-trends';
export const PRODUCT_TESTING_PATH = '/admin?tab=product-testing';
export const COMMISSIONS_PATH = '/admin/commissions';
export const CONTRACT_TEMPLATES_PATH = '/admin/contracts?tab=templates';
export const PARTNER_INVITATIONS_PATH = '/admin/partner-invitations';
export const PARTNER_DEALS_PATH = '/admin/partner-invitations/deals';
export const PARTNER_REFERRALS_PATH = '/admin/partner-invitations/referrals';
export const LEARNING_ASSIGNED_PATH = '/learning/programs';
export const LEARNING_STUDIO_PATH = '/learning/studio/programs';

/* ------------------------------------------------------------------ *
 * The words
 * ------------------------------------------------------------------ */

export const NOT_READ_YET = 'Not read here yet';
export const COULD_NOT_READ = 'Could not be read';
export const READING = 'Reading…';
export const NONE_CLAIM = 'That is not the same as none.';
export const NOTHING_WAITING = 'Nothing is waiting.';
export const HQ_READS_MONEY = 'HQ reads these figures.';
export const HQ_READS_COMMISSIONS = 'HQ reads commissions and payouts.';
export const RAIL_NOTE = 'Eadwyn reads the program figures on this page. Nothing changes until you act.';

export const TITLE = 'Programs';
export const LINE_ADMIN = 'Every program on the accounts HQ holds, and what it needs from you now.';
// D964 (#2797): the line regains "…and what studios propose." with HQ's Proposals tab.
export const LINE_SUPER = 'Every program on StudioOS, what needs HQ now, and what studios propose.';
export const FOOT_PROFILING = 'Profiling trends is not a program. It stays here until its home is decided.';
export const PAGE_UNREADABLE = 'Could not be read';

const nf = (n) => Number(n).toLocaleString('en-US');
export const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ *
 * The nine programs (S-RUN): a frontend constant until part 1's registry
 * ------------------------------------------------------------------ */

/** The canvas's six groups, in its order (a filter in the browser). */
export const GROUPS = ['Ventures', 'Access', 'Network and referrals', 'Rewards', 'Learning', 'Product'];

/** "Not open to members yet" is `LEARNING_COMING_SOON`'s. */
export const LEARNING_WHO = LEARNING_COMING_SOON ? 'Not open to members yet' : 'Every member';

const PLAYBOOK_UNWRITTEN = 'The playbook is not written yet.';
const PARTNER_TERMS_UNBUILT = 'Set with partner terms, which are not built yet.';

/**
 * One entry per card, in the canvas's order. `grant` is the held mode's badge
 * (S-HELD: only "Granted to your studio" becomes "HQ-held"); `hqGrant` is the
 * Super Admin's ("HQ-held" where the canvas draws a studio count, and its own
 * "HQ only"). A `null` purpose or who reads "Not recorded" with its reason.
 */
export const PROGRAMS = Object.freeze([
  {
    key: 'spinout-lab', group: 'Ventures', name: 'Spin-Out Lab',
    purpose: 'Idea to incorporated company in 28 days, one cohort a month.',
    status: 'Live', grant: 'HQ-held', hqGrant: 'HQ-held', who: 'Founders', join: 'By application',
  },
  {
    key: 'ai-native-venture', group: 'Ventures', name: 'AI-native Venture',
    purpose: null, purposeReason: PLAYBOOK_UNWRITTEN,
    status: 'Proposed', grant: 'Not offered yet', hqGrant: 'HQ only', who: null, whoReason: PLAYBOOK_UNWRITTEN,
  },
  {
    key: 'mentor-cohorts', group: 'Access', name: 'Mentor cohort access',
    purpose: 'Advisors who mentor a Lab cohort read that cohort’s founders.',
    status: 'Live', grant: 'HQ-held', hqGrant: 'HQ-held', who: 'Advisors', join: 'Assigned by an admin',
  },
  {
    key: 'investor-cohorts', group: 'Access', name: 'Investor cohort access',
    purpose: 'Verified investors follow one Lab cohort to Demo Day.',
    status: 'Not built yet', grant: 'Not offered yet', hqGrant: 'HQ only', who: 'Investors', join: 'Assigned by an admin',
  },
  {
    key: 'referral-partners', group: 'Network and referrals', name: 'Referral partners',
    purpose: 'People who bring events, startups, deals and LPs.',
    status: 'Partly built', grant: 'HQ-held', hqGrant: 'HQ-held', who: null, whoReason: PARTNER_TERMS_UNBUILT,
  },
  {
    key: 'refer-and-earn', group: 'Network and referrals', name: 'Refer & Earn',
    purpose: 'Members refer founders and platform users. A sign-up through a member’s link earns them an introduction credit.',
    status: 'Live', grant: 'HQ-held', hqGrant: 'HQ-held', who: 'Founders, investors, advisors and partners', join: 'Open',
  },
  {
    key: 'perks', group: 'Rewards', name: 'Perks',
    purpose: 'Partners list perks; founders claim them with credits, a plan or payment.',
    status: 'Live', grant: 'HQ-held', hqGrant: 'HQ-held',
    who: 'Founders claim; other members browse. Partners have their own listings.', join: 'Open',
  },
  {
    key: 'learning', group: 'Learning', name: 'Learning',
    purpose: 'Courses, videos, exercises and exams for a region or a group.',
    status: 'Live', grant: 'HQ-held', hqGrant: 'HQ-held', who: LEARNING_WHO, join: 'Open or by invitation',
  },
  {
    key: 'product-testing', group: 'Product', name: 'Product testing',
    purpose: 'HQ and partners test their products with members, who apply to each program.',
    status: 'Live', grant: 'Runs at HQ', hqGrant: 'HQ only', who: 'The roles each program names', join: 'By application',
  },
]);

export const programByKey = (key) => PROGRAMS.find((p) => p.key === key) || null;

/** The cards a group chip leaves; `null` is All. */
export const cardsIn = (group) => (group ? PROGRAMS.filter((p) => p.group === group) : PROGRAMS);

/** The product testing card's foot for an Admin: no figures and no door. */
export const PRODUCT_TESTING_FOOT = 'Runs at HQ. Its page is for HQ only, so there is nothing to open here.';

/** The status pill: the canvas's glyph and tone for each status. */
export const STATUS_PILL = Object.freeze({
  Live: { glyph: '✓', tone: 'green' },
  'Partly built': { glyph: '◐', tone: 'violet' },
  'Not built yet': { glyph: '○', tone: 'muted' },
  Proposed: { glyph: '✎', tone: 'muted' },
});

/** The grant badge, in the canvas's held mode. Only `HQ-held` stands for a grant. */
export const GRANT_GLYPH = Object.freeze({ 'HQ-held': '⌂', 'HQ only': '⌂', 'Runs at HQ': '⌂', 'Not offered yet': '–' });

/* ------------------------------------------------------------------ *
 * The program pages: header, facts and tabs (D953 §3)
 * ------------------------------------------------------------------ */

/**
 * One entry per program page. `tabs` are the tabs it has today, each a static
 * sub-path; Investor cohort access and AI-native Venture are one page each, so
 * they have none. `workspace` is the board the frame names (D953 §1).
 */
export const PAGES = Object.freeze({
  'mentor-cohorts': {
    title: 'Mentor cohort access', workspace: 'Advisor cohort access',
    line: 'Advisors who mentor a Spin-Out Lab cohort can read that cohort’s founders.',
    facts: ['Who: Advisors', 'Join: Assigned by an admin', 'Cycle: monthly cohorts of four weeks'],
    tabs: [
      { key: 'overview', label: 'Overview', path: MENTOR_PATH },
      { key: 'how', label: 'How it runs', path: MENTOR_HOW_PATH },
      { key: 'people', label: 'People', path: MENTOR_PEOPLE_PATH },
    ],
  },
  'refer-and-earn': {
    title: 'Refer & Earn', workspace: 'Referrals',
    line: 'Founders, investors, advisors and partners refer founders and platform users.',
    facts: ['Who: Founders, investors, advisors and partners', 'Join: Open'],
    tabs: [
      { key: 'overview', label: 'Overview', path: REFER_PATH },
      { key: 'how', label: 'How it runs', path: REFER_HOW_PATH },
      { key: 'queue', label: 'Queue', path: REFER_QUEUE_PATH },
      { key: 'settings', label: 'Settings', path: REFER_SETTINGS_PATH },
    ],
  },
  perks: {
    title: 'Perks', workspace: 'Programs',
    line: 'Partners list perks. Founders claim them with credits, through their plan, or by paying the partner.',
    facts: ['Who: Founders claim; other members browse. Partners have their own listings.', 'Join: Open'],
    tabs: [
      { key: 'overview', label: 'Overview', path: PERKS_PATH },
      { key: 'how', label: 'How it runs', path: PERKS_HOW_PATH },
      { key: 'queue', label: 'Queue', path: PERKS_QUEUE_PATH },
    ],
  },
  learning: {
    title: 'Learning', workspace: 'Programs',
    line: 'Programs of courses, videos, exercises and exams for a region or a group.',
    facts: [`Who: ${LEARNING_WHO}`, 'Join: Open or by invitation', 'Cycle: self-paced'],
    tabs: [
      { key: 'overview', label: 'Overview', path: LEARNING_PATH },
      { key: 'how', label: 'How it runs', path: LEARNING_HOW_PATH },
      { key: 'people', label: 'People', path: LEARNING_PEOPLE_PATH },
    ],
  },
  'referral-partners': {
    title: 'Referral partners', workspace: 'Programs',
    line: 'People who bring the studio events, startups, deals and LPs.',
    facts: null,
    tabs: [
      { key: 'overview', label: 'Overview', path: PARTNERS_PATH },
      { key: 'how', label: 'How it runs', path: PARTNERS_HOW_PATH },
    ],
  },
  'investor-cohorts': {
    title: 'Investor cohort access', workspace: 'Programs',
    line: 'Verified investors follow one Lab cohort and meet its founders at Demo Day.',
    facts: ['Who: Verified investors', 'Join: Assigned by an admin', 'Cycle: one Lab cohort'],
    tabs: [],
  },
  'ai-native-venture': {
    title: 'AI-native Venture', workspace: 'Programs',
    line: null, lineReason: PLAYBOOK_UNWRITTEN,
    facts: null, whoReason: PLAYBOOK_UNWRITTEN,
    tabs: [],
  },
});

/** What an address opens: `{ program, tab }`, `program` null for the catalogue. */
export function routeFor(pathname) {
  const path = trimPath(pathname);
  if (path === PROGRAMS_PATH) return { program: null, tab: 'catalogue' };
  for (const [program, page] of Object.entries(PAGES)) {
    const base = `${PROGRAMS_PATH}/${program}`;
    if (path === base) return { program, tab: page.tabs.length ? 'overview' : 'page' };
    const hit = page.tabs.find((t) => t.path === path);
    if (hit) return { program, tab: hit.key };
  }
  return { program: null, tab: 'catalogue' };
}

/** The crumb: "Programs › [Program]", or "‹ Programs" on a phone. */
export const crumbText = (program, phone) => (phone ? '‹ Programs' : `Programs › ${PAGES[program]?.title || ''}`);

/* ------------------------------------------------------------------ *
 * How it runs (S-RUN): the constant's text, one card per section
 * ------------------------------------------------------------------ */

export const PLAYBOOK_ADMIN_FOOT = 'HQ writes the playbook.';
export const PLAYBOOK_SUPER_LINE = 'Editing arrives with the playbook store.';
export const SET_BY_HQ = 'Set by HQ';

/**
 * Each program's sections, corrected against the code (D953 §3). A section is
 * `{ title, lines }`, or `{ title, kind }` for the ones a read or a link
 * fills: Mentor's cycle, its contracts link and its measures.
 */
export const HOW_IT_RUNS = Object.freeze({
  'mentor-cohorts': [
    { title: 'Purpose', lines: ['Give each Lab cohort advisors who follow its founders week by week.'] },
    { title: 'Who it is for', lines: ['Members with the Advisor role. An advisor needs no profile to be assigned.'] },
    { title: 'How people join', lines: ['An admin assigns one advisor to one cohort.'] },
    {
      title: 'What a mentor sees',
      lines: [
        'Founders’ names and email addresses, week-by-week status, who acted on their guidance, and Lab dates. Nothing else in the Lab.',
        'A mentor sees a founder once that founder’s first week is recorded.',
      ],
    },
    {
      title: 'What founders can do',
      lines: ['Founders are told when a mentor can read them, and can hide from one mentor, once their first week is recorded. They are told when an admin ends the access.'],
    },
    { title: 'The cycle', kind: 'cycle' },
    {
      title: 'What you do',
      lines: [
        'Before a cohort starts: assign at least one mentor.',
        'Each week: check for mentors whose role changed.',
        'When a cohort ends: end access, or assign the mentor to the next cohort.',
      ],
    },
    { title: 'Terms and contracts', kind: 'contracts' },
    { title: 'Rewards', lines: ['None set.'] },
    { title: 'How we measure it', kind: 'measures' },
    {
      title: 'Admin tools',
      rows: [
        ['Assign a mentor', 'Admin and Super Admin'],
        ['End access', 'Admin and Super Admin'],
        ['Approve office-hours hosts', 'Admin, on Spin-Out Lab › Hosts'],
        ['Edit this playbook', 'Super Admin'],
      ],
    },
  ],
  'refer-and-earn': [
    { title: 'Who refers whom', lines: ['Founders, investors, advisors and partners refer founders and platform users.'] },
    { title: 'Strategic and capital introductions', lines: ['Strategic and capital introductions are invite-only. No one can be granted access yet.'] },
    {
      title: 'Review',
      lines: ['An admin moves each referral through its statuses and writes the next step, the reward label and the fit notes. The referrer sees them on their page and is not notified.'],
    },
    {
      title: 'Rewards',
      lines: ['No referral pays perk credits. A sign-up through a member’s referral link earns them one introduction credit once the new member verifies their email. Other rewards are milestone labels, settled off the platform.'],
    },
  ],
  perks: [
    { title: 'Purpose', lines: ['Partners list perks. Founders claim them with credits, through their plan, or by paying the partner.'] },
    { title: 'Who it is for', lines: ['Founders claim; other members browse. Partners have their own listings.'] },
    {
      title: 'Review',
      lines: ['A new listing waits for review, and so does a live one its partner edits, unless the edit only raises its claim cap. An admin approves it, or rejects it with a reason the partner sees on their listing. A rejection is final.'],
    },
    { title: 'Paid perks', lines: ['A paid perk records the claim, and the partner invoices directly.'] },
    {
      title: 'Credits',
      lines: ['1 credit is worth $1 of perk value. Credits are paid by the credit rules a Super Admin sets, for Spin-Out Lab milestones, bug bounties and approved tasks, and a Super Admin can also grant or deduct them by hand.'],
    },
  ],
  learning: [
    { title: 'Purpose', lines: ['Programs of courses, videos, exercises and exams for a region or a group.'] },
    { title: 'Who writes it', lines: ['HQ writes and publishes each program, and assigns the admins who follow it.'] },
    { title: 'How people join', lines: ['Each program is open, or by invitation.'] },
    { title: 'Members', lines: ['Members cannot open Learning yet: courses, videos and webinars are coming soon, and Articles are open now.'] },
    { title: 'What an assigned admin does', lines: ['An assigned admin follows its learners, read only, by name.'] },
  ],
  'referral-partners': [
    { title: 'Purpose', lines: ['People who bring the studio events, startups, deals and LPs.'] },
    { title: 'Partner deals', lines: ['Partner deals, their codes and the sign-ups with them are on Partner invitations.'] },
    { title: 'Terms', lines: ['Per-partner terms are not built yet.'] },
  ],
  'investor-cohorts': [
    {
      title: 'How it runs',
      lines: [
        'An admin gives a verified investor access to one cohort.',
        'The investor signs the cohort NDA first.',
        'They see each venture’s summary and weekly progress. Never founders’ email addresses.',
        'Founders are told and can hide themselves from one investor.',
        'An introduction request goes to the founder, who accepts or declines.',
      ],
    },
  ],
});

export const INVESTOR_BANNER = 'New program. This is the design; nothing runs yet.';
export const INVESTOR_UNDECIDED = 'Who counts as verified, the cohort NDA, what an investor sees and how a founder answers an introduction are not decided yet.';
export const AI_NATIVE_WAITS = 'The playbook card and the tiles wait for the playbook.';

/** Mentor's "How we measure it": mentors per cohort, then two figures no read serves yet. */
export const MENTOR_MEASURES = Object.freeze([
  { label: 'Mentors per cohort', word: null, reason: 'Read from the assignments; Overview counts the cohorts covered, and the chart per cohort is not drawn yet.' },
  { label: 'Founders hidden', word: NOT_READ_YET, reason: 'Founders’ choices are stored; no admin read counts them yet.' },
  { label: 'Sessions booked with a mentor', word: NOT_READ_YET, reason: 'Bookings are stored; no read counts the ones made with a mentor yet.' },
]);

/* ------------------------------------------------------------------ *
 * Reads, and Guard L
 * ------------------------------------------------------------------ */

/**
 * A read as the hook holds it: `{ status: 'loading' | 'ready' | 'error',
 * data, error, at }`. A read that failed after an earlier success keeps that
 * success's `data`; this page draws a block from fresh data only.
 */
export const isReady = (read) => read?.status === 'ready';
export const isFailed = (read) => read?.status === 'error';
export const isLoading = (read) => !read || read.status === 'loading';
export const dataOf = (read) => (isReady(read) ? read.data : null);

/**
 * GUARD L (D953 §2, as D923's). A list that returns exactly its cap is
 * incomplete, so a figure drawn from it says what it covers.
 */
export const CAPS = Object.freeze({ hosts: 500, perkQueue: 200, perks: 200, assignments: 500, assignable: 500, referrals: 200, learning: 500 });
export const atCap = (list, cap) => Array.isArray(list) && list.length >= cap;
export const capped = (n, isCapped) => (isCapped ? `${nf(n)}+` : nf(n));

/** The state of a block fed by several reads: unreadable if any failed, loading if any is out, else ready. */
export function stateOf(...reads) {
  if (reads.some(isFailed)) return 'unreadable';
  if (reads.some((r) => !isReady(r))) return 'loading';
  return 'ready';
}

/**
 * "Updated": the oldest answer among the reads the page draws, "Reading…"
 * until the first lands, and "Could not be read" when every one failed
 * (D915's E6 and E7).
 */
export function asOfState(reads) {
  const drawn = reads.filter(Boolean);
  const stamps = drawn.filter(isReady).map((r) => r.at).filter(Number.isFinite);
  if (stamps.length) return { kind: 'updated', at: Math.min(...stamps) };
  if (drawn.length && drawn.every(isFailed)) return { kind: 'failed' };
  return { kind: 'reading' };
}

export function clockLabel(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Ages and bands (S-AGE, S1-BANDS): 24 and 72 hours, as `slaFor`
 * ------------------------------------------------------------------ */

export const DUE_SOON_HOURS = 24;
export const OVERDUE_HOURS = 72;
const HOUR = 3_600_000;

/** Hours since a stored stamp, or null. */
export function hoursSince(stamp, now) {
  const ms = parseStamp(stamp);
  return ms === null ? null : Math.max(0, (now - ms) / HOUR);
}

/** "under an hour", "5 hours", "3 days". */
export function ageText(hours) {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) return null;
  const h = Number(hours);
  if (h < 1) return 'under an hour';
  if (h < 48) return plural(Math.round(h), 'hour', 'hours');
  return plural(Math.round(h / 24), 'day', 'days');
}

export const BANDS = Object.freeze([
  { key: 'fresh', label: 'Under 24 hours' },
  { key: 'soon', label: '24 to 72 hours' },
  { key: 'over', label: '72 hours or more' },
]);

export function bandOf(hours) {
  if (hours >= OVERDUE_HOURS) return 'over';
  if (hours >= DUE_SOON_HOURS) return 'soon';
  return 'fresh';
}

/** Rows counted into the three bands by an age function; a row with no stamp is counted apart. */
export function bandCounts(rows, ageOf) {
  const out = { fresh: 0, soon: 0, over: 0, undated: 0 };
  for (const r of rows) {
    const h = ageOf(r);
    if (h === null) out.undated += 1;
    else out[bandOf(h)] += 1;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * R1: the glance's lanes
 * ------------------------------------------------------------------ */

/**
 * One lane of R1 by its Worker key: `{ state, count, oldestHours, sla }`. A
 * failed glance, a glance with no lanes, a missing lane and a lane whose
 * `count` is null are all unreadable: none of them is a zero.
 */
export function laneFrom(glance, key) {
  if (isLoading(glance)) return { state: 'loading' };
  if (isFailed(glance)) return { state: 'unreadable', reason: 'The Studio glance could not be read.' };
  const lanes = glance.data?.approvals?.lanes;
  if (!Array.isArray(lanes)) return { state: 'unreadable', reason: 'The glance carried no approval lanes.' };
  const lane = lanes.find((l) => l?.key === key);
  if (!lane) return { state: 'unreadable', reason: 'That lane was not on the glance.' };
  if (lane.count === null || lane.count === undefined || !Number.isFinite(Number(lane.count))) {
    return { state: 'unreadable', reason: 'That lane could not be read.' };
  }
  const h = lane.oldest_age_hours;
  return {
    state: 'ready',
    count: Number(lane.count),
    oldestHours: h === null || h === undefined || !Number.isFinite(Number(h)) ? null : Number(h),
    sla: lane.sla || null,
  };
}

/* ------------------------------------------------------------------ *
 * R2: office-hours hosts
 * ------------------------------------------------------------------ */

/** R2's pending count (all time, every capacity) and the oldest pending item's age. */
export function hostsFrom(read, now) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const counts = read.data?.counts || {};
  const pending = Number(counts.pending);
  const approved = Number(counts.approved);
  const items = Array.isArray(read.data?.items) ? read.data.items : [];
  const ages = items.filter((i) => i?.status === 'pending').map((i) => hoursSince(i.created_at, now)).filter((h) => h !== null);
  return {
    state: 'ready',
    pending,
    approved,
    oldestHours: ages.length ? Math.max(...ages) : null,
    // The items stop at 500, newest first: past the cap the oldest is older still.
    oldestAtLeast: atCap(items, CAPS.hosts),
  };
}

export const hostsLine = (h) => `${nf(h.approved)} approved · ${nf(h.pending)} waiting, every host`;

/* ------------------------------------------------------------------ *
 * R3 and R4: Perks
 * ------------------------------------------------------------------ */

/**
 * R3's reviewer backlog: the `in_review` rows only (a draft is not backlog).
 * R3's cap of 200 counts drafts too, so at the cap the count is "at least".
 * A listing waits from `updated_at`, "since last edit".
 */
export function perkQueueFrom(read, now) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const items = Array.isArray(read.data?.items) ? read.data.items : [];
  const rows = items.filter((p) => p?.status === 'in_review');
  const ages = rows.map((p) => hoursSince(p.updated_at || p.created_at, now)).filter((h) => h !== null);
  const full = atCap(items, CAPS.perkQueue);
  return {
    state: 'ready',
    rows,
    count: rows.length,
    atLeast: full,
    text: full ? `at least ${nf(rows.length)}` : nf(rows.length),
    oldestHours: ages.length ? Math.max(...ages) : null,
  };
}

/** R4's live listings: "200+" at the cap. */
export function livePerksFrom(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const items = Array.isArray(read.data?.items) ? read.data.items : [];
  const full = atCap(items, CAPS.perks);
  return { state: 'ready', count: items.length, capped: full, text: capped(items.length, full) };
}

const dollars = (cents) => `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: Number(cents) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * A listing's price. A zero-credit listing reads "No credit cost", never
 * "0 credits". `tierName` names a plan by its label, as `/perks` does.
 */
export function perkPrice(p, tierName = () => '') {
  if (p?.kind === 'tier') {
    const name = tierName(p.required_tier);
    return name ? `Included in ${name}` : 'Included in a plan';
  }
  if (p?.kind === 'money') {
    const cents = Number(p.price_cents);
    return p.price_cents === null || p.price_cents === undefined || !Number.isFinite(cents)
      ? 'Paid to the partner, at a price they quote'
      : `${dollars(cents)}, paid to the partner`;
  }
  const credits = Number(p?.credits);
  if (!Number.isFinite(credits) || credits <= 0) return 'No credit cost';
  return plural(credits, 'credit', 'credits');
}

/**
 * What Approve sends: the typed note, or the stored one when none is typed,
 * so a seeded listing keeps its provenance note. The Worker clears it
 * otherwise. The feature tick and the editorial line go only when set.
 */
export function approveBody(row, { note = '', featured = false, editorial = '' } = {}) {
  const typed = String(note || '').trim();
  const body = { action: 'approve', review_note: typed || row?.review_note || '' };
  if (featured) body.featured = true;
  const line = String(editorial || '').trim();
  if (line) body.editorial_note = line;
  return body;
}

/** What Reject sends: the reason the partner sees, which the Worker requires. */
export function rejectBody({ note = '' } = {}) {
  return { action: 'reject', review_note: String(note || '').trim() };
}

export const REJECT_NEEDS_NOTE = 'Type the reason. The partner sees it on their listing.';
export const PERKS_EMPTY = 'Partners list perks, and each new or edited listing waits here for review.';
export const PERK_APPROVED = 'Approved. The listing is live.';
export const PERK_REJECTED = 'Rejected. The partner sees your reason on their listing.';

/* ------------------------------------------------------------------ *
 * R5 and R7: Mentor cohort access (S-CNT, S-COV)
 * ------------------------------------------------------------------ */

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const ET = 'America/New_York';

export const cohortName = (c) => `${MONTHS_LONG[Number(c?.month) - 1] || `Month ${c?.month}`} ${c?.year}`;

/** "1 Nov" in the Lab's zone. */
export function etDay(stamp) {
  const ms = parseStamp(stamp);
  if (ms === null) return null;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: ET });
}

/** "00:00" in the Lab's zone. */
export function etTime(stamp) {
  const ms = parseStamp(stamp);
  if (ms === null) return null;
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ET });
}

/** A cohort deadline is 00:00 ET and inclusive, so it reads "8 Nov 00:00 ET", never "7 Nov 23:59". */
export const etStamp = (stamp) => (parseStamp(stamp) === null ? null : `${etDay(stamp)} ${etTime(stamp)} ET`);

const isAdvisor = (row) => String(row?.advisor_role || '').toLowerCase() === 'advisor';
/** D960's account rule: the holder's account is active (`advisor_is_active`, true only when `users.is_active` is 1). */
const isActiveAccount = (row) => row?.advisor_is_active === true;
const isOpen = (row) => row?.is_active === true || row?.is_active === 1;

/** An open row whose holder's current role is no longer Advisor (the body's own rule). */
export const isStaleRow = (row) => isOpen(row) && Boolean(row?.advisor_role) && !isAdvisor(row);

/**
 * S-COV: a cohort that needs a mentor is scheduled or running and not
 * postponed. A postponed cycle still turns `active` at its first unlock, so it
 * is left out by name. A scheduled cycle with no week windows still counts.
 */
export const needsMentor = (c) => (c?.status === 'scheduled' || c?.status === 'active') && c?.app_status !== 'postponed';

/**
 * The mentor figures, one rule for the card, Overview and Needs you:
 *   mentors   distinct holders of an open row whose current role is Advisor
 *             and whose account is active (D960);
 *   cycles    R7's cycles that need a mentor ([b]);
 *   covered   those with at least one open row held by a current, active Advisor ([a]);
 *   uncovered the rest, each a Needs-you row;
 *   stale     open rows whose holder is no longer an Advisor.
 * `capped` when R5 returned its 500 rows: the counts cover the newest 500.
 */
export function mentorFigures(assignRead, timelineRead) {
  const state = stateOf(assignRead, timelineRead);
  if (state !== 'ready') return { state };
  const rows = Array.isArray(assignRead.data?.items) ? assignRead.data.items : [];
  const cycles = Array.isArray(timelineRead.data?.cycles) ? timelineRead.data.cycles : [];
  const live = rows.filter((r) => isOpen(r) && isAdvisor(r) && isActiveAccount(r));
  const mentors = new Set(live.map((r) => Number(r.advisor_user_id))).size;
  const staffed = new Set(live.map((r) => Number(r.cohort_cycle_id)));
  const due = cycles.filter(needsMentor);
  const uncovered = due.filter((c) => !staffed.has(Number(c.id)));
  return {
    state,
    mentors,
    total: due.length,
    covered: due.length - uncovered.length,
    uncovered,
    stale: rows.filter(isStaleRow),
    capped: atCap(rows, CAPS.assignments),
  };
}

/** The holder's name in a sentence, never their id. */
export const holderName = (row) => row?.advisor_name || row?.advisor_email || 'An account with no name recorded';

/** Needs you, by the same rules: each row links to People. */
export function mentorNeeds(f) {
  if (f.state !== 'ready') return [];
  const cohorts = f.uncovered.map((c) => ({
    key: `cycle-${c.id}`,
    kind: 'No mentor',
    text: c.status === 'active'
      ? `${cohortName(c)} is running with no mentor.`
      : `${cohortName(c)} starts ${etDay(c.start_at) || 'on a date not recorded'} with no mentor.`,
  }));
  const roles = f.stale.map((r) => ({
    key: `row-${r.id}`,
    kind: 'Role changed',
    text: `${holderName(r)} is no longer an Advisor. Their access is already refused, but the assignment is still open.`,
  }));
  return [...cohorts, ...roles];
}

/** Active mentors' line: a deactivated account is left out (D960). */
export const ACTIVE_MENTORS_LINE = 'Advisors with an active account.';
/** People's Assign success line, which agrees with How it runs (the map's F2, until O-FND). */
export const ASSIGNED_LINE = 'Assigned. The advisor sees a founder in that cohort once that founder’s first week is recorded.';
export const WITHIN_500 = 'within the newest 500';

/** The card's figure: "[n] mentors · [a] of [b] cohorts covered". */
export const mentorCardLine = (f) => `${plural(f.mentors, 'mentor', 'mentors')} · ${nf(f.covered)} of ${nf(f.total)} ${f.total === 1 ? 'cohort' : 'cohorts'} covered`;

/** Overview's Cohorts covered. */
export const coveredLine = (f) => (f.total === 0
  ? 'No cohort is scheduled or running'
  : `${nf(f.covered)} of ${nf(f.total)} ${f.total === 1 ? 'cohort' : 'cohorts'}, scheduled or running`);

/**
 * The cycle strip: the running cohort, or else the next scheduled one, from
 * R7's windows; never a postponed one.
 */
export function cycleForStrip(timelineRead) {
  if (!isReady(timelineRead)) return null;
  const cycles = (Array.isArray(timelineRead.data?.cycles) ? timelineRead.data.cycles : []).filter(needsMentor);
  const running = cycles.find((c) => c.status === 'active');
  if (running) return running;
  const next = cycles.filter((c) => c.status === 'scheduled')
    .sort((a, b) => (parseStamp(a.start_at) ?? Infinity) - (parseStamp(b.start_at) ?? Infinity));
  return next[0] || null;
}

/** "Week 1 · opens 1 Nov 00:00 ET · deadline 8 Nov 00:00 ET". */
export function weekLines(cycle) {
  const windows = Array.isArray(cycle?.windows) ? [...cycle.windows] : [];
  return windows.sort((a, b) => Number(a.week_number) - Number(b.week_number)).map((w) => ({
    week: Number(w.week_number),
    text: `Week ${w.week_number} · opens ${etStamp(w.unlock_at) || NOT_RECORDED} · deadline ${etStamp(w.deadline_at) || NOT_RECORDED}`,
  }));
}

export const CYCLE_FIXED = 'Cohort dates are fixed by the Lab’s calendar.';

/* ------------------------------------------------------------------ *
 * R8 and R1: Refer & Earn
 * ------------------------------------------------------------------ */

/** The open statuses are the lane's, so the page and the Approvals lane agree. */
export const OPEN_STATUSES = Object.freeze(['submitted', 'under_review', 'more_info_needed']);
export const OPEN_WORDS = Object.freeze({ submitted: 'Submitted', under_review: 'Under review', more_info_needed: 'Waiting on the member' });

/** One R8 call: its rows, and whether it came back full (newest first, so it dropped the oldest). */
function referralCall(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const rows = Array.isArray(read.data) ? read.data : [];
  const full = atCap(rows, CAPS.referrals);
  return { state: 'ready', rows, count: rows.length, capped: full, text: capped(rows.length, full) };
}

/**
 * Waiting for review: each open status from its own R8 call, their total and
 * the bands. A call at its cap reads "200+", and the bands then say "of the
 * newest 200". The oldest and Overdue come from R1's `referrals` lane, which
 * covers the same three statuses with no cap.
 */
export function referralOverview(sets, glance, now) {
  const calls = Object.fromEntries(OPEN_STATUSES.map((s) => [s, referralCall(sets?.[s])]));
  const all = Object.values(calls);
  const ready = all.every((c) => c.state === 'ready');
  const anyCapped = ready && all.some((c) => c.capped);
  const rows = ready ? all.flatMap((c) => c.rows) : [];
  const total = ready ? rows.length : null;
  const lane = laneFrom(glance, 'referrals');
  return {
    calls,
    state: all.some((c) => c.state === 'unreadable') ? 'unreadable' : ready ? 'ready' : 'loading',
    total,
    totalText: ready ? capped(total, anyCapped) : null,
    capped: anyCapped,
    bands: ready ? bandCounts(rows, (r) => hoursSince(r.created_at, now)) : null,
    bandsCover: anyCapped ? 'of the newest 200 in each status' : null,
    lane,
    oldest: lane.state === 'ready' ? ageText(lane.oldestHours) : null,
    overdue: lane.state === 'ready' && lane.sla === 'past',
  };
}

/** The open statuses' rows merged newest first: the Queue's default view and its count. */
export function openReferrals(sets) {
  const calls = OPEN_STATUSES.map((s) => referralCall(sets?.[s]));
  if (calls.some((c) => c.state === 'unreadable')) return { state: 'unreadable' };
  if (calls.some((c) => c.state !== 'ready')) return { state: 'loading' };
  // Newest first; a row with no stamp sorts last.
  const when = (r) => parseStamp(r.created_at) ?? Number.NEGATIVE_INFINITY;
  const rows = calls.flatMap((c) => c.rows).sort((a, b) => (when(b) > when(a) ? 1 : when(b) < when(a) ? -1 : 0));
  const anyCapped = calls.some((c) => c.capped);
  return { state: 'ready', rows, capped: anyCapped, text: capped(rows.length, anyCapped) };
}

export const REFERRALS_EMPTY = 'Members submit referrals from their Refer & Earn page, and each one waits here for review.';
export const STRATEGIC_NOT_READ = 'Members’ requests are stored; no admin read lists them yet.';
export const STRATEGIC_INVITE_ONLY = 'Strategic and capital introductions are invite-only. No one can be granted access yet.';
export const WHO_CAN_REFER = 'Founders, investors, advisors and partners can open Refer & Earn. Explorers cannot today; whether they may is not decided yet.';

/* ------------------------------------------------------------------ *
 * R9 and R10: Learning
 * ------------------------------------------------------------------ */

const LEARNING_STATUS = { draft: 'Draft', published: 'Published', archived: 'Archived' };
const ENROLMENT = { open: 'Open', invite: 'By invitation' };
export const learningStatusWord = (s) => LEARNING_STATUS[s] || 'Status not recorded';
export const enrolmentWord = (e) => ENROLMENT[e] || NOT_RECORDED;

/**
 * Learning counts enrolments, not people, in published programs only: R9
 * returns draft and archived programs too, and those can still hold active
 * enrolments. A person in two programs is two enrolments.
 */
export function learningFigures(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const rows = Array.isArray(read.data?.programs) ? read.data.programs : [];
  const published = rows.filter((p) => p?.status === 'published');
  const enrolments = published.reduce((t, p) => t + (Number.isFinite(Number(p.learners)) ? Number(p.learners) : 0), 0);
  return { state: 'ready', rows, published: published.length, enrolments, capped: atCap(rows, CAPS.learning) };
}

/** The Super Admin's derived Join, from the published programs' enrolment. */
export function learningJoin(rows) {
  const kinds = new Set((rows || []).filter((p) => p?.status === 'published').map((p) => p.enrolment));
  if (kinds.has('open') && kinds.has('invite')) return 'Open or by invitation';
  if (kinds.has('open')) return 'Open';
  if (kinds.has('invite')) return 'By invitation';
  return 'No program is published';
}

export const learningCardLine = (f) => `${plural(f.published, 'published program', 'published programs')} · ${plural(f.enrolments, 'active enrolment', 'active enrolments')} in them`;
export const ENROLMENTS_NOTE = 'A person in two programs is two enrolments.';
export const LEARNING_ADMIN_LINE = 'You follow the programs HQ assigns you. Progress is read only.';
export const ASSIGNED_TO_YOU = 'assigned to you';

/** One program's learners (R10): a 403 `not_assigned` is said as such, never as none. */
export function learnersFrom(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) {
    const code = read.error?.code || read.error?.data?.code || null;
    if (Number(read.error?.status) === 403 || code === 'not_assigned') return { state: 'refused', text: 'This program is not assigned to you, so its learners are not read here.' };
    return { state: 'unreadable' };
  }
  const learners = Array.isArray(read.data?.learners) ? read.data.learners : [];
  return { state: 'ready', learners };
}

/* ------------------------------------------------------------------ *
 * R11 and R12: the Super Admin's figures
 * ------------------------------------------------------------------ */

/** Product testing for a Super Admin: "[n] open · [m] applied, not withdrawn". */
export function testingFrom(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const items = Array.isArray(read.data?.items) ? read.data.items : [];
  const open = items.filter((p) => p?.status === 'open').length;
  const applied = items.reduce((t, p) => t + (Number.isFinite(Number(p?.applicant_count)) ? Number(p.applicant_count) : 0), 0);
  return { state: 'ready', text: `${nf(open)} open · ${nf(applied)} applied, not withdrawn` };
}

export const SCOPE_READING = 'Reading the scope…';
export const SCOPE_UNREAD = 'The deployments could not be read, so whether a subsidiary is deployed is not known here.';
export const SCOPE_NOT_PER_STUDIO = 'Programs reads the accounts HQ holds. No Programs read is per studio yet, so a deployed studio is not shown here.';

/**
 * The scope chip (D893). For a Super Admin it is keyed on R12. R12 answers 200
 * with HQ-held alone and a `reason` when the registry cannot be read, so the
 * title then gives the reason: the read has not established that no
 * subsidiary is deployed.
 */
export function scopeChip(superAdmin, scopes) {
  if (!superAdmin) return { label: SCOPE_LABEL, title: SCOPE_TITLE };
  if (isLoading(scopes)) return { label: SCOPE_READING, title: SCOPE_READING };
  if (isFailed(scopes)) return { label: SCOPE_LABEL, title: SCOPE_UNREAD };
  const reason = typeof scopes.data?.reason === 'string' && scopes.data.reason.trim() ? scopes.data.reason.trim() : null;
  if (reason) return { label: SCOPE_LABEL, title: reason };
  const branch = (Array.isArray(scopes.data?.scopes) ? scopes.data.scopes : []).some((s) => s?.kind === 'branch');
  return { label: SCOPE_LABEL, title: branch ? SCOPE_NOT_PER_STUDIO : SCOPE_TITLE };
}

/* ------------------------------------------------------------------ *
 * The catalogue's tiles (D953 §2, §3)
 * ------------------------------------------------------------------ */

export const WAITING_LABEL = 'cohort applications, Refer & Earn reviews, office-hours hosts and perk listings';
export const STRATEGIC_LINE = 'Strategic referral access is not read here yet.';
export const RUNNING_REASON = 'No registry records which programs run yet.';
export const PEOPLE_REASON = 'Each program stores its own members; no read counts them across programs yet.';

/**
 * Waiting for you: the labelled total of the four admin queues that can be
 * read. "Could not be read" when any of them cannot be read, because a total
 * that misses a queue is smaller than the truth; "at least [n]" when R3 is at
 * its cap; a real 0 with "Nothing is waiting." when all four read none.
 */
export function waitingForYou({ glance, hosts, perkQueue, now }) {
  const cohort = laneFrom(glance, 'cohort');
  const referrals = laneFrom(glance, 'referrals');
  const h = hostsFrom(hosts, now);
  const p = perkQueueFrom(perkQueue, now);
  const parts = [
    ['cohort applications', cohort], ['Refer & Earn reviews', referrals], ['office-hours hosts', h], ['perk listings', p],
  ];
  const failed = parts.filter(([, x]) => x.state === 'unreadable').map(([w]) => w);
  if (failed.length) {
    return { state: 'unreadable', failed, reason: `${failed.join(', ')} could not be read, so no total is drawn.` };
  }
  if (parts.some(([, x]) => x.state !== 'ready')) return { state: 'loading' };
  if (!Number.isFinite(h.pending)) return { state: 'unreadable', failed: ['office-hours hosts'], reason: 'office-hours hosts could not be read, so no total is drawn.' };
  const total = cohort.count + referrals.count + h.pending + p.count;
  const ages = [cohort.oldestHours, referrals.oldestHours, h.oldestHours, p.oldestHours].filter((x) => x !== null && x !== undefined);
  const oldest = ages.length ? Math.max(...ages) : null;
  const atLeast = h.oldestAtLeast || p.atLeast;
  return {
    state: 'ready',
    total,
    value: p.atLeast ? `at least ${nf(total)}` : nf(total),
    oldest: total > 0 && oldest !== null ? `oldest ${atLeast ? 'at least ' : ''}${ageText(oldest)}` : null,
    overdue: total > 0 && oldest !== null && oldest >= OVERDUE_HOURS,
    empty: total === 0 && !p.atLeast,
  };
}

/** The Spin-Out Lab card: the glance's cohort lane, labelled as cohort applications. */
export function labCard(glance, hosts, now) {
  const cohort = laneFrom(glance, 'cohort');
  const h = hostsFrom(hosts, now);
  const figure = cohort.state === 'ready' ? { state: 'ready', text: plural(cohort.count, 'cohort application waiting', 'cohort applications waiting') } : { state: cohort.state };
  const needs = cohort.state === 'ready' && h.state === 'ready' && Number.isFinite(h.pending)
    ? { state: 'ready', count: cohort.count + h.pending }
    : { state: cohort.state === 'unreadable' || h.state === 'unreadable' ? 'unreadable' : 'loading' };
  return { figure, needs };
}

export const LAB_APPLICATIONS_REASON = 'Their read cannot yet tell a failure from none.';
export const CLAIMS_REASON = 'No admin read counts claims yet.';
export const INCLUDING_MEMBER = 'including those waiting on the member';

/** The Refer & Earn card: R1's referrals lane, which includes referrals waiting on the member. */
export function referCard(glance) {
  const lane = laneFrom(glance, 'referrals');
  if (lane.state !== 'ready') return { state: lane.state };
  return { state: 'ready', count: lane.count, text: plural(lane.count, 'open referral', 'open referrals') };
}

/* ------------------------------------------------------------------ *
 * Refusals: one sentence in place, keyed on `code` (D953 §3)
 * ------------------------------------------------------------------ */

export const FROZEN = 'Changes are refused while HQ has paused your admin access. Reading still works.';
export const SUSPENDED = 'This studio’s licence is suspended, so changes here are paused until HQ lifts it.';
export const TRY_AGAIN = 'That did not go through. Try again.';

export function refusalText(err, fallback = TRY_AGAIN) {
  const code = err?.code || err?.data?.code || (typeof err?.data?.error === 'string' ? err.data.error : null);
  if (code === 'admin_frozen') return FROZEN;
  if (code === 'branch_suspended') return SUSPENDED;
  if (Number(err?.status) === 404) return 'This record no longer exists. Refresh to see the queue as it is.';
  return fallback;
}
