/**
 * D1195 (#2382) — HQ › Platform › Product testing's tabs, its overview figures
 * and the words of the blocks that have no read yet, from the canvas "Product
 * Testing" (TST1–TST16). Pure, so `frontend/test/product_testing_d1195.test.mjs`
 * holds each rule.
 *
 * WHAT IS READ TODAY. D812's `GET /api/admin/testing/programmes` (every
 * programme, with places, picked and applicant counts) and D1042's
 * `GET /api/admin/product-testers` (the tester store, migration 576). The
 * weekly series, who applies by profile, Mail reach, the history, a partner's
 * applicants and the list across programmes have no read, so those blocks say
 * "Not read here yet" with their reason and never draw a zero (D1195 §2).
 */
import { STATUS_ORDER, statusLabel } from '../../testing/programmeModel';

export const BASE = '/admin/platform/product-testing';

export const PAGE_LINE = 'Approve partners’ testing programs, run Axal VC’s own, and keep the tester pool healthy.';

/** The canvas's five tabs, in its order, each at its own address. */
export const TABS = Object.freeze([
  { key: 'overview', label: 'Overview', path: BASE },
  { key: 'review', label: 'Review', path: `${BASE}/review` },
  { key: 'programs', label: 'Programs', path: `${BASE}/programs` },
  { key: 'applicants', label: 'Applicants', path: `${BASE}/applicants` },
  { key: 'testers', label: 'Tester pool', path: `${BASE}/testers` },
]);

/**
 * One program's sub-tabs (TST5). They are `?tab=` on the program's address,
 * not paths: a link can prove a door to `/programs/:uid` but not to a path
 * below it (`admin_route_reachability`), so the canvas's `/applicants` and
 * `/activity` are part 8's to route if it finds a door for them (D1195 §3).
 */
export const PROGRAM_SUBS = Object.freeze([
  { key: 'overview', label: 'Overview', query: '' },
  { key: 'applicants', label: 'Applicants', query: '?tab=applicants' },
  { key: 'activity', label: 'Activity', query: '?tab=activity' },
]);

const UID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * What an address names: the tab, and on a program its uid and its sub-tab
 * (from `?tab=`). Anything unknown under the page is Overview; a malformed uid
 * is Programs; an unknown sub-tab is the program's Overview.
 */
export function viewOf(pathname = '', search = '') {
  const p = String(pathname).replace(/\/+$/, '');
  if (p !== BASE && !p.startsWith(`${BASE}/`)) return { tab: 'overview', uid: null, sub: null };
  const [word, uid, extra] = p.slice(BASE.length + 1).split('/');
  if (word === 'programs' && uid && extra === undefined) {
    if (!UID.test(uid)) return { tab: 'programs', uid: null, sub: null };
    const sub = new URLSearchParams(String(search)).get('tab');
    const known = PROGRAM_SUBS.find((s) => s.key === sub && s.key !== 'overview');
    return { tab: 'programs', uid, sub: known ? known.key : 'overview' };
  }
  const tab = TABS.find((t) => t.key === word && t.key !== 'overview');
  return { tab: tab ? tab.key : 'overview', uid: null, sub: null };
}

export const programHref = (uid, sub = 'overview') =>
  `/admin/platform/product-testing/programs/${encodeURIComponent(uid)}${PROGRAM_SUBS.find((s) => s.key === sub)?.query || ''}`;

export const NOT_YET = 'Not read here yet';

/** Why a block draws nothing today. Never a zero, never "none". */
export const WAITS = Object.freeze({
  weekly: 'Applications and picks per week are not read yet. Every application and pick is written to the program history; the weekly read comes next.',
  profiles: 'Who applies, by profile, is not read yet: the pool by profile and the applicants by role on open programs. Any profile can be a tester. Admins cannot apply.',
  mail: 'Whether Axal VC Mail can reach the picked testers is not read yet. When it is, this shows counts only, never an address. Delivery figures are in Axal VC Mail.',
  needs: 'What needs you is not read yet: programs waiting long, approved and not opened, testing dates passed, and withdrawal requests.',
  applicants: 'The list of every applicant across programs is not read yet. Each Axal VC program’s applicants are on that program; a partner firm’s are not read here yet.',
  activity: 'This program’s history is not read yet. Every change is written to it; the read that lists them comes next.',
  partnerApplicants: 'A partner firm’s applicants are not read here yet. The firm picks its testers; HQ will read the list, not change it.',
  testerPrograms: 'Who approved each tester and how many programs they applied to are not read yet.',
});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const LIVE = new Set(['open', 'testing']);

/**
 * TST1's tiles, status chips and places bars, from the programme list alone.
 * A program with no recorded places is left out of the places sum and named
 * in `placesUnrecorded`, never counted as zero.
 */
export function overviewFigures(items = []) {
  const list = Array.isArray(items) ? items : [];
  const count = (s) => list.filter((p) => p.status === s).length;
  const waiting = list.filter((p) => p.status === 'submitted' && p.owner_kind === 'partner');
  const oldest = waiting.map((p) => p.updated_at).filter(Boolean).sort()[0] || null;
  const live = list.filter((p) => LIVE.has(p.status));
  let picked = 0; let places = 0; let applicants = 0; const placesUnrecorded = [];
  for (const p of live) {
    const pl = num(p.places);
    if (pl == null || pl <= 0) { placesUnrecorded.push(p.product_name); continue; }
    places += pl; picked += num(p.picked_count) ?? 0;
  }
  for (const p of list) if (p.status === 'open') applicants += num(p.applicant_count) ?? 0;
  return {
    total: list.length,
    open: count('open'),
    approvedNotOpen: count('approved'),
    waiting: waiting.length,
    oldestWaiting: oldest,
    places: { picked, places, programs: live.length, applicants, placesUnrecorded },
    chips: STATUS_ORDER.map((s) => ({ status: s, label: statusLabel(s), n: count(s) })),
    owners: { hq: list.filter((p) => p.owner_kind === 'hq').length, partner: list.filter((p) => p.owner_kind === 'partner').length },
    bars: live.map((p) => ({ uid: p.uid, name: p.product_name, picked: num(p.picked_count) ?? 0, places: num(p.places) })),
  };
}

/** TST9's chips, in the canvas's order. Applied is Approvals', so it is a link, not a chip. */
export const TESTER_CHIPS = Object.freeze([
  { status: 'active', label: 'Active' },
  { status: 'paused', label: 'Paused' },
  { status: 'declined', label: 'Declined' },
  { status: 'removed', label: 'Removed' },
]);

/** The canvas's profile words for the Worker's roles. */
export const PROFILE_WORD = Object.freeze({
  founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', exploring: 'Explorer',
});
export const profileWord = (role) => PROFILE_WORD[role] || 'Profile not recorded';

/** A tester row as the page draws it: never the email the read also carries. */
export function testerRow(r = {}) {
  return {
    id: r.id,
    name: r.member_name || 'Name not recorded',
    role: r.member_role || null,
    since: r.status === 'applied' ? null : (r.decided_at || null),
    availability: r.availability || null,
    consentVersion: r.consent_email_at ? (r.consent_version || null) : null,
    status: r.status,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "16 Oct 2026" as the canvas writes it (never "Sept"), or null for a missing or unreadable date. */
export function dayOf(v) {
  if (!v) return null;
  const d = new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
