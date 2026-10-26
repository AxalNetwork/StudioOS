/**
 * D1195 (#2382) — HQ › Platform › Product testing's tabs, its overview figures
 * and the words of the blocks that have no read yet, from the canvas "Product
 * Testing" (TST1–TST16). Pure, so `frontend/test/product_testing_d1195.test.mjs`
 * holds each rule.
 *
 * WHAT IS READ TODAY. D812's `GET /api/admin/testing/programmes` (every
 * programme, with places, picked and applicant counts), D1042's
 * `GET /api/admin/product-testers` (the tester store, migration 576) and
 * D1196's `GET /api/admin/testing/overview` (the weekly series, who applies by
 * profile, Mail reach), drawn by D1201. The history, a partner's applicants
 * and the list across programmes have no read here yet, so those blocks say
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
  // D1203 (#3153) filled one program's applicants and Activity, and the Applicants tab: their waits are retired.
  // D1204 (#3154) filled the Tester pool's Approved by and Programs from D1200's read: `testerPrograms` is retired.
  personaSegment: 'Persona segments are not read with the tester pool yet, so the pool cannot be filtered by one.',
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
  const programmes = r.programmes && typeof r.programmes === 'object' ? r.programmes : null;
  return {
    id: r.id,
    // D1204: the read nests the member (services/productTesters.ts present()); the flat names never came.
    name: r.member?.name || 'Name not recorded',
    role: r.member?.role || null,
    since: r.status === 'applied' ? null : (r.decided_at || null),
    // D1200: who decided, as a name; the id stays out of what the page draws.
    decidedBy: r.decided_by_name || null,
    availability: r.availability && String(r.availability).trim() ? r.availability : null,
    // D1200: applications not withdrawn, and picks, all time. Null when the read did not carry them.
    programmes: programmes ? { applied: num(programmes.applied) ?? 0, picked: num(programmes.picked) ?? 0 } : null,
    consentVersion: r.consent_email_at ? (r.consent_version || null) : null,
    status: r.status,
  };
}

/* ------------------------------------------------------------------ *
 * D1204 (#3154) — the Tester pool complete (TST9)
 * ------------------------------------------------------------------ */

/** TST9's sort, default "Tester since, newest". */
export const POOL_SORTS = Object.freeze([
  { key: 'since_desc', label: 'Tester since, newest' },
  { key: 'since_asc', label: 'Tester since, oldest' },
  { key: 'name', label: 'Name' },
]);
export const POOL_PAGE_SIZES = Object.freeze([25, 50, 100]);
export const POOL_FILTERS = Object.freeze({ q: '', role: '', availability: '', inProgramme: '', sort: 'since_desc', page: 1, pageSize: 25 });

/**
 * The table's rows for one status chip, over the whole pool read in memory.
 * Search is by name only, from two characters: the page never holds an email
 * to search by. `inProgramme` is the set of tester ids D1200's `in_programme=yes`
 * read returned; with that filter on and no set, the result says it is unread
 * rather than empty.
 */
export function poolView(rows = [], status, f = POOL_FILTERS, inProgramme = null) {
  const needle = String(f.q || '').trim().toLowerCase();
  const tooShort = needle.length === 1;
  if (f.inProgramme && !(inProgramme instanceof Set)) return { rows: [], total: 0, from: 0, to: 0, page: 1, pages: 1, tooShort, unread: 'inProgramme' };
  let out = (Array.isArray(rows) ? rows : []).map(testerRow).filter((t) => t.status === status);
  if (needle.length >= 2) out = out.filter((t) => t.name.toLowerCase().includes(needle));
  if (f.role) out = out.filter((t) => (f.role === 'none' ? !PROFILE_WORD[t.role] : t.role === f.role));
  if (f.availability === 'yes') out = out.filter((t) => t.availability);
  if (f.availability === 'no') out = out.filter((t) => !t.availability);
  if (f.inProgramme === 'yes') out = out.filter((t) => inProgramme.has(t.id));
  if (f.inProgramme === 'no') out = out.filter((t) => !inProgramme.has(t.id));
  const since = (t) => (t.since ? String(t.since) : '');
  if (f.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  else if (f.sort === 'since_asc') out.sort((a, b) => (since(a) || '￿').localeCompare(since(b) || '￿') || a.id - b.id);
  else out.sort((a, b) => since(b).localeCompare(since(a)) || b.id - a.id);
  const size = POOL_PAGE_SIZES.includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
  const pages = Math.max(1, Math.ceil(out.length / size));
  const page = Math.min(Math.max(1, Math.floor(Number(f.page) || 1)), pages);
  const start = (page - 1) * size;
  return {
    rows: out.slice(start, start + size), total: out.length,
    from: out.length ? start + 1 : 0, to: Math.min(out.length, start + size), page, pages, tooShort, unread: null,
  };
}

/**
 * TST9's "Testers by profile": active testers by profile, in the canvas's
 * order. Paused testers are not counted. A profile with no word of its own is
 * one "Profile not recorded" bar, drawn only when there is one.
 */
export function poolProfileChart(rows = []) {
  const active = (Array.isArray(rows) ? rows : []).filter((r) => r.status === 'active');
  const by = new Map(PROFILE_ORDER.map((k) => [k, 0]));
  let other = 0;
  for (const r of active) {
    const role = r.member?.role;
    if (by.has(role)) by.set(role, by.get(role) + 1);
    else other += 1;
  }
  const PLURAL = { founder: 'Founders', investor: 'Investors', advisor: 'Advisors', partner: 'Operating Partners', exploring: 'Explorers' };
  const bars = PROFILE_ORDER.map((k) => ({ role: k, label: PLURAL[k], n: by.get(k) }));
  if (other) bars.push({ role: 'none', label: 'Profile not recorded', n: other });
  const max = Math.max(1, ...bars.map((b) => b.n));
  return { active: active.length, bars, max, sentence: bars.map((b) => `${b.label} ${b.n}`).join(', ') };
}

/** TST9's ⋯ on a tester: Open, then what the tester's status allows (D1042's transitions). */
export function poolMenu(status) {
  const open = { key: 'open', label: 'Open tester record' };
  if (status === 'active') return [open, { key: 'pause', label: 'Pause…' }, { key: 'remove', label: 'Remove…' }];
  if (status === 'paused') return [open, { key: 'resume', label: 'Resume…' }, { key: 'remove', label: 'Remove…' }];
  return [open];
}

/** TST12b: the pool holds nobody in any status, so the tab shows its one empty card. */
export const poolEmpty = (totals) => !!totals && Number(totals.total ?? 0) === 0;

/** "1–25 of 57", or the empty table's line. */
export const rangeOf = (v) => (v.total ? `${v.from}–${v.to} of ${v.total}` : '0 of 0');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "16 Oct 2026" as the canvas writes it (never "Sept"), or null for a missing or unreadable date. */
export function dayOf(v) {
  if (!v) return null;
  const d = new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ------------------------------------------------------------------ *
 * D1201 (#3151) — Overview complete (TST1, TST11): the blocks part 1's read
 * fills (D1196, `GET /api/admin/testing/overview`), Needs you from the
 * programme list, and the tab counts. Pure, so
 * `frontend/test/product_testing_overview_d1201.test.mjs` holds each rule.
 * ------------------------------------------------------------------ */

/** The canvas's profile order for the grouped bars; `other` (an admin in the pool) last, only when it has anyone. */
export const PROFILE_ORDER = Object.freeze(['founder', 'investor', 'advisor', 'partner', 'exploring']);
const PROFILE_PLURAL = Object.freeze({
  founder: 'Founders', investor: 'Investors', advisor: 'Advisors', partner: 'Operating Partners', exploring: 'Explorers', other: 'Other profiles',
});

/** A block of the overview read: `ready`, or `unreadable` with its reason (never figures). */
export function blockState(block) {
  if (!block || typeof block !== 'object') return { state: 'unreadable', reason: 'The overview did not answer. This is not a claim that there are none.' };
  if (block.available !== true) return { state: 'unreadable', reason: block.reason || 'This block could not be read. This is not a claim that there are none.' };
  return { state: 'ready', reason: null };
}

const wkDay = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

/**
 * The weekly series (TST1's line chart and its table). A week the read marks
 * `recorded: false` keeps null counts, drawn as the dashed "Not recorded"
 * hairline, never a 0; a measured quiet week is a 0. The current week is
 * `toDate` (a hollow point, "to date").
 */
export function weeklySeries(block) {
  const weeks = Array.isArray(block?.weeks) ? block.weeks : [];
  const rows = weeks.map((w) => {
    const recorded = w.recorded === true;
    return {
      week: w.week_start, label: wkDay(w.week_start) || 'Week not recorded', recorded, toDate: w.to_date === true,
      applications: recorded ? num(w.applications) : null, picks: recorded ? num(w.picks) : null,
    };
  });
  const values = rows.flatMap((r) => [r.applications, r.picks]).filter((v) => v != null);
  const unrecorded = rows.filter((r) => !r.recorded).length;
  return {
    rows,
    max: values.length ? Math.max(...values) : null,
    anyRecorded: rows.some((r) => r.recorded),
    unrecorded,
    firstOpened: block?.first_opened ? dayOf(block.first_opened) : null,
  };
}

/** The weekly chart's one-sentence summary, for its `aria-label` and screen readers. */
export function weeklySummary(s) {
  if (!s.rows.length) return 'Applications and picks per week: no weeks were returned.';
  if (!s.anyRecorded) return `Applications and picks per week over ${s.rows.length} weeks: not recorded, because no program has opened yet.`;
  const rec = s.rows.filter((r) => r.recorded);
  const range = (k) => { const v = rec.map((r) => r[k]).filter((x) => x != null); return `${Math.min(...v)} and ${Math.max(...v)}`; };
  const lead = s.unrecorded ? ` No program was open before ${s.firstOpened || 'the first opening'}, so ${s.unrecorded === 1 ? 'the first week is' : `the first ${s.unrecorded} weeks are`} not recorded.` : '';
  const last = s.rows[s.rows.length - 1];
  return `Applications and picks per week over ${s.rows.length} weeks.${lead} Applications ran between ${range('applications')} a week and picks between ${range('picks')}.${last?.toDate ? ' The current week is not finished.' : ''}`;
}

/**
 * Who applies, by profile (TST1's grouped bars). `pool` and `applicants` are
 * the read's two sub-blocks, each answering alone (TST14a: the pool's bars are
 * left out when it cannot be read).
 */
export function profileBars(byProfile) {
  const pool = blockState(byProfile?.pool);
  const apps = blockState(byProfile?.applicants);
  const poolBy = pool.state === 'ready' ? byProfile.pool.by_profile || {} : null;
  const appsBy = apps.state === 'ready' ? byProfile.applicants.by_profile || {} : null;
  const keys = [...PROFILE_ORDER, ...(((poolBy?.other || 0) + (appsBy?.other || 0)) > 0 ? ['other'] : [])];
  const rows = keys.map((k) => ({
    key: k, label: PROFILE_PLURAL[k],
    pool: poolBy ? num(poolBy[k]) ?? 0 : null,
    applicants: appsBy ? num(appsBy[k]) ?? 0 : null,
  }));
  const vals = rows.flatMap((r) => [r.pool, r.applicants]).filter((v) => v != null);
  return {
    rows, pool, applicants: apps,
    poolTotal: poolBy ? num(byProfile.pool.total) : null,
    applicantsTotal: appsBy ? num(byProfile.applicants.total) : null,
    max: vals.length ? Math.max(...vals) : 0,
  };
}

/** Mail reach per open program (TST1): the four steps, counts only, never an address. */
export const REACH_STEPS = Object.freeze([
  { key: 'picked', label: 'Picked' }, { key: 'consented', label: 'Agreed to email' },
  { key: 'emails_on', label: 'Program emails on' }, { key: 'reachable', label: 'Reachable' },
]);
export function reachRows(block) {
  return (Array.isArray(block?.programmes) ? block.programmes : []).map((p) => ({
    uid: p.uid, name: p.product_name || 'Program name not recorded', status: p.status,
    steps: REACH_STEPS.map((s) => ({ ...s, n: num(p[s.key]) ?? 0 })),
  }));
}

const DAY_MS = 86_400_000;
const at = (v) => {
  if (!v) return null;
  const t = Date.parse(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : (String(v).length <= 10 ? 'T00:00:00Z' : 'Z')));
  return Number.isFinite(t) ? t : null;
};
const daysSince = (v, now) => { const t = at(v); return t == null ? null : Math.max(0, Math.floor((now - t) / DAY_MS)); };
const daysWord = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

/**
 * Needs you (TST1), from the programme list alone, oldest first within each
 * kind: a partner's program waiting for review, one approved and not open, an
 * open program whose testing dates have begun, a testing one whose dates have
 * ended, and an open one with applicants and none picked. Each row says what
 * it is and links where it is acted on; a missing date never makes a row.
 * Withdrawal requests have no read, so they are not listed (D1201 §2).
 */
export function needsYou(items = [], now = Date.now()) {
  const list = Array.isArray(items) ? items : [];
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const byAge = (a, b) => (at(a.updated_at) ?? 0) - (at(b.updated_at) ?? 0);
  const out = [];
  for (const p of list.filter((x) => x.status === 'submitted' && x.owner_kind === 'partner').sort(byAge)) {
    const d = daysSince(p.updated_at, now);
    out.push({ key: `review-${p.uid}`, kind: 'review', uid: p.uid,
      text: `${p.product_name} · ${p.owner_name || 'Partner not recorded'} · ${d == null ? 'when it was sent is not recorded' : d === 0 ? 'sent for review today' : `waiting for review ${daysWord(d)}`}`,
      action: { label: 'Review', to: `${BASE}/review` } });
  }
  for (const p of list.filter((x) => x.status === 'approved').sort(byAge)) {
    const d = daysSince(p.updated_at, now);
    out.push({ key: `approved-${p.uid}`, kind: 'approved', uid: p.uid,
      text: `${p.product_name} · approved${d == null ? '' : d === 0 ? ' today' : ` ${daysWord(d)} ago`}, not open`,
      action: { label: 'Open in Programs', to: `${BASE}/programs` } });
  }
  for (const p of list.filter((x) => x.status === 'open')) {
    const t = at(p.testing_starts);
    if (t == null || t > today) continue;
    out.push({ key: `started-${p.uid}`, kind: 'started', uid: p.uid,
      text: `${p.product_name} · testing started ${dayOf(p.testing_starts)}, still Open`,
      action: { label: 'Move to testing in Programs', to: `${BASE}/programs` } });
  }
  for (const p of list.filter((x) => x.status === 'testing')) {
    const t = at(p.testing_ends);
    if (t == null || t >= today) continue;
    out.push({ key: `ended-${p.uid}`, kind: 'ended', uid: p.uid,
      text: `${p.product_name} · testing ended ${dayOf(p.testing_ends)}, still Testing`,
      action: { label: 'Close in Programs', to: `${BASE}/programs` } });
  }
  for (const p of list.filter((x) => x.status === 'open')) {
    const n = num(p.applicant_count) ?? 0;
    if (n <= 0 || (num(p.picked_count) ?? 0) > 0) continue;
    out.push({ key: `unpicked-${p.uid}`, kind: 'unpicked', uid: p.uid,
      text: `${p.product_name} · ${n} ${n === 1 ? 'applicant' : 'applicants'}, none picked yet`,
      action: { label: 'View applicants', to: programHref(p.uid, 'applicants') } });
  }
  return out;
}

/**
 * The tab counts (TST1's header): Review is the amber dot with how many wait;
 * Programs every program; Applicants the applicants on open programs (the
 * Places tile's figure); Tester pool the active testers. A read still
 * answering draws the loading bar; one that failed draws "—" with why, never 0.
 */
export function tabCounts(programmes, testers) {
  const dash = (tip) => ({ kind: 'dash', tip });
  const load = { kind: 'load' };
  let review = load; let programs = load; let applicants = load;
  if (programmes.status === 'unreadable') {
    const d = dash('The testing programs could not be read.');
    review = d; programs = d; applicants = d;
  } else if (programmes.status === 'ready') {
    const f = overviewFigures(programmes.data?.items);
    review = f.waiting > 0 ? { kind: 'flag', value: f.waiting, testId: 'testing-tab-review-count' } : { kind: 'num', value: 0 };
    programs = { kind: 'num', value: f.total };
    applicants = { kind: 'num', value: f.places.applicants };
  }
  let pool = load;
  if (testers.status === 'unreadable' || (testers.status === 'ready' && !testers.data?.totals)) pool = dash('The tester pool could not be read.');
  else if (testers.status === 'ready') pool = { kind: 'num', value: num(testers.data.totals.active) ?? 0 };
  return { review, programs, applicants, testers: pool };
}

/** The rail's line and what Eadwyn reads and never does on this page (TST1). */
export const RAIL = Object.freeze({
  line: 'Eadwyn reads the programs and applicants on this page. Nothing changes until you act.',
  reads: 'Programs, places, applicant counts and the size of the tester pool.',
  never: 'Approves, opens, picks or writes to anyone, and never sees an email address.',
});
