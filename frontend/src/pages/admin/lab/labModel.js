/**
 * D937 (#2374) — the Spin-Out Lab's admin page, as pure functions: its
 * address and tabs, the moved notices, and the Overview's blocks built from
 * the reads that exist today. No React here, so `node --test` loads it alone.
 *
 * The reads (each answers alone; D937 §2):
 *   - `glance`        GET /api/admin/studio/glance — the `cohort` lane: pending
 *                     `cohort_applicants`, with `oldest_age_hours`. A failed lane
 *                     is `count: null`.
 *   - `applications`  GET /api/admin/cohort/applications — the 12 newest cycles,
 *                     each with `applicant_counts` by status (uncapped), the
 *                     window `applications_open_at` / `applications_close_at`,
 *                     `app_status`, and `settings` (null when unreadable).
 *   - `timeline`      GET /api/admin/cohort/timeline — the same 12 cycles with
 *                     their week windows and `participant_count`.
 *   - `review`        GET /api/admin/cohort/review — `at_risk` this week, and the
 *                     newest 200 failed or grace rows.
 *   - `hosts`         GET /api/admin/lab-hosts?status=pending — all-time `counts`.
 *   - `certificates`  GET /api/spinout-lab/certificates — `eligible_total`, the
 *                     newest 500 certificates, and `awaiting` (null when unread).
 *
 * Guard H (D953 §2): `GET /api/admin/spinout-applications` and
 * `GET /api/admin/spinout-participants` answer `[]` with 200 on an error, so
 * no figure here comes from them. Their fix is D953's part 7.
 */
import { parseStamp } from '../../../ui/parseStamp.js';

export const LAB_PATH = '/admin/programs/spinout-lab';
export const LAB_PREVIEW_PATH = '/admin/programs/spinout-lab/preview';
export const PROGRAMS_PATH = '/admin/held/programs';
export const LAB_TITLE = 'Spin-Out Lab';
export const PAGE_LINE = 'A four-week sprint from idea to incorporated company. A new cohort starts on the 1st of each month.';
export const FACTS = 'Who: Founders and Explorers · Join: By application · Cycle: monthly, four weeks · Times: ET';
export const DATES_FIXED = 'Dates follow the Lab’s rule. They cannot be moved here.';
export const NOT_YET = 'Not read here yet';
export const ZONE = 'America/New_York';
const DAY = 86400000;

/** The old addresses and the sentence each one's `?moved=` shows (#2375's three forms). */
export const MOVED_NOTICES = {
  'lab-applications': 'The Admin Console has moved: Spin-Out Lab now lives under Programs.',
  'spinout-lab': 'Spin-Out Lab has a new address. Update your bookmark.',
};

/**
 * The tabs this integration draws: the canvas's order, only those whose
 * console exists (D937 §1, D970 and D971). Each tab has its mounted read.
 */
export const TABS = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'applications', label: 'Applications', path: '/applications' },
  { key: 'cohorts', label: 'Cohorts', path: '/cohorts' },
  { key: 'participants', label: 'Participants', path: '/participants' },
  { key: 'hosts', label: 'Hosts', path: '/hosts' },
  { key: 'formation', label: 'Formation', path: '/formation' },
  { key: 'graduation', label: 'Graduation', path: '/graduation' },
  { key: 'how-it-runs', label: 'How it runs', path: '/how-it-runs' },
  { key: 'settings', label: 'Settings', path: '/settings' },
  { key: 'activity', label: 'Activity', path: '/activity' },
];

/** Which tab an address opens, or null when the address is not one of them. */
export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === LAB_PATH) return 'overview';
  // D947: one cohort's page (SL6) is under Cohorts.
  if (/^\/admin\/programs\/spinout-lab\/cohorts\/\d{4}-(0[1-9]|1[0-2])$/.test(p)) return 'cohorts';
  const t = TABS.find((x) => x.path && p === `${LAB_PATH}${x.path}`);
  if (t) return t.key;
  // D948: one application, /applications/:id, opens over the Applications tab.
  if (/^\/admin\/programs\/spinout-lab\/applications\/\d+$/.test(p)) return 'applications';
  // D949: one founder, /participants/:uid, opens over the Participants tab.
  return /^\/admin\/programs\/spinout-lab\/participants\/[^/]+$/.test(p) ? 'participants' : null;
}

/** Where an old address lands: `pathname`, with `?moved=`, keeping the rest of the query and the hash. */
export function movedTarget(pathname, search, hash, key) {
  const next = new URLSearchParams(search || '');
  next.delete('tab');
  next.set('moved', key);
  return { pathname, search: `?${next.toString()}`, hash: hash || '' };
}


const nf = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;

function failed(read) {
  return !read || read.status === 'error';
}

function pending(read, reason) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (failed(read)) return { state: 'unreadable', reason };
  return null;
}

// Spelled here, not by `toLocaleDateString`: en-GB writes September "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "[14 Nov]" in ET. */
export function dayET(ms) {
  if (ms == null) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'numeric', timeZone: ZONE })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]}`;
}

/** "[14 Nov] 23:59 ET". */
export function stampET(ms) {
  if (ms == null) return null;
  const t = new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONE });
  return `${dayET(ms)} ${t} ET`;
}

/** "[Dec 2026]" from a cycle's year and month. */
export function cohortLabel(cycle) {
  const y = Number(cycle?.year);
  const m = Number(cycle?.month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return 'Not recorded';
  return `${MONTHS[m - 1]} ${y}`;
}

/** "about 3 days" from hours; the shared bands (D953 S-AGE): overdue from 72 hours. */
export function ageWords(hours) {
  if (hours == null || !Number.isFinite(Number(hours))) return null;
  const h = Number(hours);
  if (h < 1) return 'under an hour';
  if (h < 24) return plural(Math.floor(h), 'hour');
  return plural(Math.floor(h / 24), 'day');
}
export const OVERDUE_HOURS = 72;

/**
 * The cohort's word, from the canvas's set: Open for applications · In review
 * · Running · Finished · Moved to [next month]. Read from the Worker's two
 * columns, `status` (scheduled, active, completed) and `app_status` (open,
 * reviewing, postponed, active).
 */
export function cohortWord(cycle) {
  if (!cycle) return 'Not recorded';
  if (cycle.status === 'completed') return 'Finished';
  if (cycle.status === 'active') return 'Running';
  if (cycle.app_status === 'postponed') {
    const y = Number(cycle.year);
    const m = Number(cycle.month);
    const next = m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
    return `Moved to ${cohortLabel(next)}`;
  }
  if (cycle.app_status === 'reviewing') return 'In review';
  if (cycle.app_status === 'open') return 'Open for applications';
  return 'Not recorded';
}

/** The applicant counts a cycle carries, by the canvas's words. */
export function poolOf(cycle) {
  const c = cycle?.applicant_counts || {};
  const n = (k) => Number(c[k] || 0);
  return {
    applied: Object.values(c).reduce((a, b) => a + Number(b || 0), 0),
    approved: n('approved') + n('activated'),
    waitlisted: n('waitlisted'),
    waiting: n('pending'),
    declined: n('rejected'),
  };
}

/** The two reads, joined by cycle id, oldest first, so the table reads like a calendar. */
export function cyclesOf(reads) {
  const apps = reads.applications?.status === 'ready' ? (reads.applications.data?.cycles || []) : [];
  const time = reads.timeline?.status === 'ready' ? (reads.timeline.data?.cycles || []) : [];
  const byId = new Map();
  for (const c of time) byId.set(c.id, { ...c, timeline: true });
  for (const c of apps) byId.set(c.id, { ...(byId.get(c.id) || {}), ...c, applications: true });
  return [...byId.values()].sort((a, b) => (Number(a.year) - Number(b.year)) || (Number(a.month) - Number(b.month)));
}

/** The running cohort's week and day, from its windows: "Week 2, day 10 of 28". */
export function weekDay(cycle, now) {
  const start = parseStamp(cycle?.start_at);
  if (start == null) return null;
  const day = Math.floor((now - start) / DAY) + 1;
  if (day < 1 || day > 28) return null;
  return `Week ${Math.min(4, Math.ceil(day / 7))}, day ${day} of 28`;
}

/** The four tiles of SL1 row 1, in the canvas's order. */
export function buildTiles(reads, now) {
  const tiles = [];

  // Applications waiting: the glance's `cohort` lane, the one count Approvals shows.
  const w = { key: 'waiting', label: 'Applications waiting' };
  const wp = pending(reads.glance, 'The Studio glance could not be read, so this is not a claim that nothing waits.');
  if (wp) tiles.push({ ...w, ...wp });
  else {
    const lane = (reads.glance.data?.approvals?.lanes || []).find((l) => l.key === 'cohort');
    if (!lane || lane.count === null || lane.count === undefined) {
      tiles.push({ ...w, state: 'unreadable', reason: 'The cohort applications lane could not be read, so there is no count.' });
    } else {
      const age = lane.count > 0 ? ageWords(lane.oldest_age_hours) : null;
      const open = cyclesOf(reads).find((c) => c.app_status === 'open' && parseStamp(c.applications_close_at) > now);
      const close = open ? parseStamp(open.applications_close_at) : null;
      const parts = [];
      if (age) parts.push(`oldest ${age}`);
      if (close != null) parts.push(`${cohortLabel(open)} closes ${stampET(close)}`);
      tiles.push({
        ...w,
        state: 'ready',
        value: nf(lane.count),
        sub: parts.join(' · ') || null,
        overdue: lane.count > 0 && Number(lane.oldest_age_hours) >= OVERDUE_HOURS,
      });
    }
  }

  // Next cohort: the first cycle that has not started, against Settings' places and minimum.
  const n = { key: 'next', label: 'Next cohort' };
  const np = pending(reads.applications, 'The cohorts could not be read. That is not the same as none.');
  if (np) tiles.push({ ...n, ...np });
  else {
    const next = cyclesOf(reads).find((c) => c.applications && parseStamp(c.start_at) > now);
    const settings = reads.applications.data?.settings || null;
    if (!next) tiles.push({ ...n, state: 'ready', value: 'None scheduled', sub: 'The Lab’s clock schedules each cohort on its own.' });
    else {
      const pool = poolOf(next);
      let sub;
      if (!settings) sub = `${nf(pool.approved)} approved. Minimum and places could not be read, so no cohort is judged against them.`;
      else {
        const met = pool.approved >= Number(settings.min);
        sub = `${nf(pool.approved)} approved of ${nf(settings.max)} places · minimum ${nf(settings.min)} ${met ? 'met' : 'not met'}`;
      }
      tiles.push({ ...n, state: 'ready', value: cohortLabel(next), sub });
    }
  }

  // In the Lab now: the running cycle's founders, from the timeline.
  const l = { key: 'lab', label: 'In the Lab now' };
  const lp = pending(reads.timeline, 'The cohort calendar could not be read. That is not the same as no one in the Lab.');
  if (lp) tiles.push({ ...l, ...lp });
  else {
    const all = cyclesOf(reads);
    const running = all.find((c) => c.timeline && c.status === 'active');
    if (!running) {
      const next = all.find((c) => c.timeline && parseStamp(c.start_at) > now);
      tiles.push({ ...l, state: 'ready', value: 'None running', sub: next ? `The next cohort starts on ${dayET(parseStamp(next.start_at))}.` : null });
    } else {
      const wd = weekDay(running, now);
      tiles.push({
        ...l,
        state: 'ready',
        value: nf(Number(running.participant_count || 0)),
        sub: [`in the ${cohortLabel(running)} cohort`, wd].filter(Boolean).join(' · '),
      });
    }
  }

  // Graduated: incorporation recorded, the same rule the certificate path uses.
  const g = { key: 'graduated', label: 'Graduated' };
  const gp = pending(reads.certificates, 'The certificate registry could not be read.');
  if (gp) tiles.push({ ...g, ...gp });
  else {
    const d = reads.certificates.data || {};
    if (d.eligible_total === null || d.eligible_total === undefined) {
      tiles.push({ ...g, state: 'unreadable', reason: d.unavailable?.awaiting || 'The graduate list could not be read.' });
    } else {
      const certs = Array.isArray(d.certificates) ? d.certificates : [];
      const issued = certs.filter((c) => c.status === 'issued').length;
      const capped = certs.length >= 500;
      tiles.push({
        ...g,
        state: 'ready',
        value: nf(d.eligible_total),
        sub: capped ? `${nf(issued)} certificates issued among the newest 500 read` : `${plural(issued, 'certificate')} issued`,
      });
    }
  }
  return tiles;
}

/**
 * Needs you (SL1 row 4): one row per queue that can be read, only when it holds
 * something, each with the tab that acts on it. A queue whose read failed says
 * so in its own row; it is never left out silently.
 */
export function buildNeeds(reads) {
  const rows = [];
  const unread = [];
  const settled = ['glance', 'review', 'hosts', 'certificates'].every((k) => reads[k] && reads[k].status !== 'loading');
  if (!settled) return { state: 'loading' };

  if (failed(reads.glance)) unread.push('Applications waiting');
  else {
    const lane = (reads.glance.data?.approvals?.lanes || []).find((l) => l.key === 'cohort');
    if (!lane || lane.count == null) unread.push('Applications waiting');
    else if (lane.count > 0) rows.push({ key: 'applications', text: `${plural(lane.count, 'application')} waiting.`, action: 'Review', tab: '/applications' });
  }

  if (failed(reads.review)) unread.push('Founders at risk and in grace');
  else {
    const atRisk = reads.review.data?.at_risk || [];
    const grace = (reads.review.data?.review || []).filter((r) => r.status === 'grace');
    if (atRisk.length > 0) rows.push({ key: 'at-risk', text: `${plural(atRisk.length, 'founder')} at risk this week.`, action: 'Open', tab: '/cohorts' });
    if (grace.length > 0) {
      const capped = (reads.review.data?.review || []).length >= 200;
      rows.push({ key: 'grace', text: `${capped ? `${nf(grace.length)}+` : nf(grace.length)} ${grace.length === 1 ? 'founder' : 'founders'} in grace.`, action: 'Open', tab: '/cohorts' });
    }
  }

  if (failed(reads.hosts)) unread.push('Office-hours hosts');
  else {
    const n = Number(reads.hosts.data?.counts?.pending ?? NaN);
    if (!Number.isFinite(n)) unread.push('Office-hours hosts');
    else if (n > 0) rows.push({ key: 'hosts', text: `${plural(n, 'office-hours host')} waiting.`, action: 'Review', tab: '/hosts' });
  }

  if (failed(reads.certificates)) unread.push('Graduates without a certificate');
  else {
    const awaiting = reads.certificates.data?.awaiting;
    if (!Array.isArray(awaiting)) unread.push('Graduates without a certificate');
    else if (awaiting.length > 0) {
      const capped = awaiting.length >= 500;
      rows.push({ key: 'certificates', text: `${capped ? `${nf(awaiting.length)}+` : nf(awaiting.length)} ${awaiting.length === 1 ? 'graduate has' : 'graduates have'} no certificate.`, action: 'Issue', tab: '/graduation' });
    }
  }

  return { state: 'ready', rows, unread };
}

/** Every read failed: the page says nothing here is a zero. */
export function pageFailed(reads) {
  return ['glance', 'applications', 'timeline', 'review', 'hosts', 'certificates'].every((k) => failed(reads[k]));
}
