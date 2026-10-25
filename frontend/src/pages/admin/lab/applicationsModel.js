/**
 * D948 (#2753) — Applications (SL2), one application (SL3) and the seven
 * decision dialogs (SL4 A–G), pure. No React, no fetch, so `node --test`
 * reads it alone.
 *
 * WHAT IS READ (each answers alone):
 *   queue     D944's `GET /api/admin/cohort/applications/list`: the Worker
 *             filters, sorts and pages every application, with its total;
 *   counts    the same read, one status at a time and one row asked for, so a
 *             chip's number is the total that chip's filter would list;
 *   cohorts   D944's overview (`GET /api/admin/cohort/overview`): each cohort's
 *             window, approved count and force-proceed, and Settings' minimum
 *             and places (D948 adds both);
 *   one       D948's `GET /api/admin/cohort/applications/:id`: the queue's row,
 *             what the founder was told, the latest interview, its cohort and
 *             the next, and the Week 1 plan.
 *
 * A failed read says so with Try again; nothing is a zero for it. A figure no
 * store holds says "Not recorded". Every change opens an in-page dialog that
 * says what it changes; the internal reason and the founder's note are
 * separate fields. Times are the Lab's clock (ET); D1's zone-less stamps are
 * UTC.
 */
import { ORIGIN_OPTIONS, TTO_OPTIONS, statusLede } from '../../../lib/applicationLifecycle';
import { LAB_PATH } from './labModel';
import { dataOf, etDay, parseStamp, plural } from './labDesksModel';
import { cohortWord, etTime } from './participantsModel';

export { cohortWord };

const nf = (n) => Number(n).toLocaleString('en-US');
const HOUR = 3600000;
const DAY = 24 * HOUR;

export const APPLICATIONS_PATH = `${LAB_PATH}/applications`;
export const applicationHref = (id) => `${APPLICATIONS_PATH}/${encodeURIComponent(id)}`;

/** `/applications/:id` → the id, else null. Ids are digits (D948's route). */
export function applicationOf(pathname) {
  const m = /^\/admin\/programs\/spinout-lab\/applications\/(\d+)\/?$/.exec(String(pathname || ''));
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ *
 * Statuses (D944's display_status), in the canvas's words and order
 * ------------------------------------------------------------------ */

export const STATUSES = [
  { key: 'waiting', word: 'Waiting', glyph: '◷', tone: 'amber' },
  { key: 'interview_set', word: 'Interview set', glyph: '☏', tone: 'violet' },
  { key: 'approved', word: 'Approved', glyph: '✓', tone: 'green' },
  { key: 'waitlisted', word: 'Waitlisted', glyph: '⏸', tone: 'muted' },
  { key: 'declined', word: 'Declined', glyph: '✕', tone: 'red' },
  { key: 'withdrawn', word: 'Withdrawn', glyph: '–', tone: 'muted' },
  { key: 'carried_forward', word: 'Carried forward', glyph: '→', tone: 'muted' },
  { key: 'started', word: 'Started', glyph: '▶', tone: 'green' },
];
/** The seven chips SL2 draws; Started is a status a row can show, not a chip. */
export const CHIPS = STATUSES.slice(0, 7);
export const statusOf = (key) => STATUSES.find((s) => s.key === key) || { key, word: 'Status not recorded', glyph: '·', tone: 'muted' };

/** Statuses D943 still decides: the rest are closed (activated, carried forward, withdrawn). */
const DECIDABLE = ['pending', 'waitlisted', 'approved', 'rejected'];
/** Statuses D945 moves to another cohort. */
const MOVABLE = ['pending', 'waitlisted', 'approved'];

/* ------------------------------------------------------------------ *
 * The toolbar (SL2): filters and sort, each a parameter of D944's read
 * ------------------------------------------------------------------ */

export const PAGE_SIZE = 25;
export const BULK_MAX = 25;
export const SORTS = [
  { value: 'waiting_longest', label: 'Sort: Waiting longest' },
  { value: 'newest', label: 'Sort: Newest' },
  { value: 'company', label: 'Sort: Company' },
  { value: 'team_size', label: 'Sort: Team size' },
];
export const ORIGIN_FILTERS = [{ value: '', label: 'Origin: any' }, ...ORIGIN_OPTIONS.map((o) => ({ value: o.key, label: `Origin: ${originWord(o.key)}` })), { value: 'unknown', label: 'Origin: not recorded' }];
export const TTO_FILTERS = [{ value: '', label: 'Tech transfer: any' }, ...TTO_OPTIONS.map((o) => ({ value: o.key, label: `Tech transfer: ${ttoWord(o.key)}` })), { value: 'unknown', label: 'Tech transfer: not recorded' }];
/** The apply form's three stages, stored as written (`SpinoutLabApplyPage`). */
export const STAGE_FILTERS = [{ value: '', label: 'Stage: any' }, ...['Idea / pre-formation', 'Prototype in progress', 'Early revenue'].map((s) => ({ value: s, label: `Stage: ${s}` }))];
export const INCORPORATED_FILTERS = [{ value: '', label: 'Incorporated: any' }, { value: 'yes', label: 'Incorporated: yes' }, { value: 'no', label: 'Incorporated: no' }, { value: 'unknown', label: 'Incorporated: not recorded' }];
export const INTERVIEW_FILTERS = [{ value: '', label: 'Interview: any' }, { value: 'scheduled', label: 'Interview: set' }, { value: 'cancelled', label: 'Interview: cancelled' }, { value: 'none', label: 'Interview: none' }];

export const EMPTY_FILTERS = Object.freeze({ cohort: null, status: 'waiting', origin: '', tech_transfer: '', stage: '', incorporated: '', interview: '', carried: false, q: '', sort: 'waiting_longest', page: 1 });

/** The query for D944's read: only what is set, the page as limit and offset. */
export function listQuery(f, size = PAGE_SIZE) {
  const out = { limit: size, offset: (Math.max(1, f.page || 1) - 1) * size, sort: f.sort || 'waiting_longest' };
  if (f.cohort) out.cohort = f.cohort;
  for (const k of ['status', 'origin', 'tech_transfer', 'stage', 'incorporated', 'interview']) if (f[k]) out[k] = f[k];
  if (f.carried) out.carried_forward = 'yes';
  const q = String(f.q || '').trim();
  if (q) out.q = q.slice(0, 200);
  return out;
}

/** The query that counts one chip: its status in the chosen cohort, one row asked for. */
export const countQuery = (cohort, status) => ({ ...(cohort ? { cohort } : {}), status, limit: 1, offset: 0 });

/** Whether any filter beyond the cohort and the status chip is on. */
export const narrowed = (f) => Boolean(f.origin || f.tech_transfer || f.stage || f.incorporated || f.interview || f.carried || String(f.q || '').trim());

/** D944's reply, or a thrown error when it did not answer with a total: a list with no total is not a list. */
export function listReply(r) {
  if (!r || r.available !== true || !Array.isArray(r.items) || !Number.isFinite(Number(r.total))) {
    throw new Error(r?.reason || 'The applications did not come back with a total.');
  }
  return r;
}

/** "1–25 of 30", from the Worker's total. */
export function rangeOf(page, shown, total) {
  if (!total) return 'None';
  const from = (page - 1) * PAGE_SIZE + 1;
  return `${nf(from)}–${nf(from + shown - 1)} of ${nf(total)}`;
}

/* ------------------------------------------------------------------ *
 * Words for one row
 * ------------------------------------------------------------------ */

function originWord(key) {
  return { university: 'University', corporate: 'Corporate', independent: 'Independent' }[key] || null;
}
function ttoWord(key) {
  return { not_disclosed: 'Not disclosed', disclosed: 'Disclosed', negotiating: 'Negotiating', signed: 'Signed', not_applicable: 'Not applicable' }[key] || null;
}
const ROLE_WORDS = { founder: 'Founder', explorer: 'Explorer' };

/** How long an application has waited since the last change: "5 hours", "3 days". */
export function waitedText(since, now = Date.now()) {
  const ms = parseStamp(since);
  if (ms === null) return null;
  const d = Math.max(0, now - ms);
  if (d < HOUR) return 'under an hour';
  if (d < DAY) return plural(Math.floor(d / HOUR), 'hour', 'hours');
  return plural(Math.floor(d / DAY), 'day', 'days');
}
/** 72 hours or more is overdue, as the Overview's Waiting tile says (D937). */
export const OVERDUE_MS = 72 * HOUR;

/** One row of the queue as the table and the cards draw it. */
export function applicationRow(r, now = Date.now()) {
  const since = parseStamp(r.waiting_since);
  const iv = r.interview_status === 'scheduled' ? parseStamp(r.interview_at) : null;
  const answers = r.answers_status;
  return {
    id: String(r.id),
    applicantId: Number(r.id),
    userId: r.user_id ?? null,
    cycleId: r.cohort_cycle_id ?? null,
    rawStatus: r.status,
    status: statusOf(r.display_status),
    company: r.company_name || 'Company not named',
    idea: r.idea || null,
    name: r.name || r.email || 'Founder not named',
    role: ROLE_WORDS[r.role] || null,
    cohort: r.cohort || null,
    carried: r.rolled_from_cycle_id != null,
    origin: answers !== 'ready' ? (answers === 'unreadable' ? 'Unreadable' : 'Not recorded')
      : [originWord(r.origin), r.institution].filter(Boolean).join(' · ') || 'Not answered',
    tto: answers !== 'ready' ? (answers === 'unreadable' ? 'Unreadable' : 'Not recorded') : ttoWord(r.tech_transfer) || 'Not answered',
    team: answers !== 'ready' ? '—' : r.team_size != null ? nf(r.team_size) : 'Not answered',
    applied: etDay(r.applied_at, now) || 'Not recorded',
    waited: since === null ? null : waitedText(r.waiting_since, now),
    overdue: since !== null && now - since >= OVERDUE_MS,
    interview: iv === null ? null : etTime(iv, now),
    decidable: DECIDABLE.includes(r.status),
    movable: MOVABLE.includes(r.status),
    interviewable: ['pending', 'waitlisted'].includes(r.status),
    hasInterview: r.interview_status === 'scheduled',
    approved: r.status === 'approved',
  };
}

/* ------------------------------------------------------------------ *
 * Cohorts: the switch and the capacity bar, from D944's overview
 * ------------------------------------------------------------------ */

function cohortsOf(overviewRead) {
  const b = dataOf(overviewRead)?.blocks?.cohorts;
  if (!b || b.available !== true || !Array.isArray(b.items)) return null;
  return [...b.items].sort((a, z) => (Number(a.year) - Number(z.year)) || (Number(a.month) - Number(z.month)));
}

/** The cohort after `key` in the calendar, or null when none is stored. */
export function nextCohort(overviewRead, key) {
  const all = cohortsOf(overviewRead);
  if (!all) return null;
  const at = all.findIndex((c) => c.cohort === key);
  return at >= 0 && at + 1 < all.length ? all[at + 1] : null;
}

/** A cohort as the switch names it: "Dec 2026 · Open · closes in 14 days". */
export function cohortChoice(c, now = Date.now()) {
  const word = cohortWord(c.cohort);
  const start = parseStamp(c.start_at);
  const end = parseStamp(c.end_at);
  const opens = parseStamp(c.applications_open_at);
  const closes = parseStamp(c.applications_close_at);
  if (start !== null && end !== null && start <= now && now < end) return `${word} · Running`;
  if (c.app_status === 'open' && opens !== null && opens > now) return `${word} · opens ${etDay(opens, now)}`;
  if (c.app_status === 'open') {
    if (closes === null) return `${word} · Open`;
    const left = closes - now;
    return `${word} · Open · closes ${left < DAY ? `in ${plural(Math.max(1, Math.ceil(left / HOUR)), 'hour', 'hours')}` : `in ${plural(Math.ceil(left / DAY), 'day', 'days')}`}`;
  }
  if (c.app_status === 'reviewing') return `${word} · Reviewing · starts ${etDay(start, now) || 'on a date not recorded'}`;
  if (c.app_status === 'postponed') return `${word} · Postponed`;
  return `${word} · Closed`;
}

/**
 * The switch: the cohorts still taking or reviewing applications and the one
 * running, then All cohorts. `chosen` is the open cohort when there is one,
 * else All. Null cohorts means the read failed: only All is offered.
 */
export function cohortSwitch(overviewRead, now = Date.now()) {
  const all = cohortsOf(overviewRead);
  if (!all) return { options: [{ value: '', label: 'All cohorts' }], fallback: '', unreadable: true };
  const live = all.filter((c) => {
    const start = parseStamp(c.start_at); const end = parseStamp(c.end_at);
    return ['open', 'reviewing'].includes(c.app_status) || (start !== null && end !== null && start <= now && now < end);
  });
  const open = live.find((c) => c.app_status === 'open' && !(parseStamp(c.applications_open_at) > now));
  return {
    options: [...live.map((c) => ({ value: c.cohort, label: cohortChoice(c, now) })), { value: '', label: 'All cohorts' }],
    fallback: open ? open.cohort : '',
    unreadable: false,
  };
}

/** Cohorts that take a move or an admission: open only (D945 §2), with the canvas's line. */
export function openCohorts(overviewRead, now = Date.now(), except = null) {
  const all = cohortsOf(overviewRead);
  if (!all) return null;
  return all.filter((c) => c.app_status === 'open' && c.cohort !== except).map((c) => {
    const opens = parseStamp(c.applications_open_at);
    const closes = parseStamp(c.applications_close_at);
    const parts = [cohortWord(c.cohort)];
    if (opens !== null) parts.push(`opens ${etDay(opens, now)}`);
    if (closes !== null) parts.push(`closes ${etDay(closes - 60000, now)} 23:59 ET`);
    return { value: String(c.id), cohort: c.cohort, label: parts.join(' · ') };
  });
}

/**
 * SL2's capacity bar for one cohort, and SL2b's callout when it is below the
 * minimum. `unreadable` when either the cohort's approved count or Settings
 * could not be read: nothing is judged against a minimum nobody read.
 */
export function capacityOf(overviewRead, key, now = Date.now()) {
  if (!key) return null;
  const blocks = dataOf(overviewRead)?.blocks;
  const c = (cohortsOf(overviewRead) || []).find((x) => x.cohort === key);
  const s = blocks?.settings;
  const word = cohortWord(key);
  const label = `Capacity · ${word}`;
  if (!c || !s || s.available !== true || c.approved?.available !== true) {
    return { state: 'unreadable', label, reason: (s && s.available === false && s.reason) || 'Minimum and places could not be read, so no cohort is judged against them.' };
  }
  const approved = Number(c.approved.value);
  const places = Number(s.places);
  const min = Number(s.min);
  const next = nextCohort(overviewRead, key);
  const deciding = ['open', 'reviewing'].includes(c.app_status);
  const below = approved < min;
  const forced = Number(c.force_proceed) === 1;
  return {
    state: 'ready', label, cohort: c, word, approved, places, min,
    text: `${nf(approved)} approved of ${nf(places)} places`,
    pct: places > 0 ? Math.min(100, (approved / places) * 100) : 100,
    over: approved > places,
    minimum: below ? { met: false, text: `Below the minimum of ${nf(min)}` } : { met: true, text: `Minimum ${nf(min)} met` },
    callout: below && deciding && !forced
      ? `Below the minimum: ${nf(approved)} of ${nf(min)} approved. ${word} moves to ${next ? cohortWord(next.cohort) : 'the next cohort'} about 12 hours before it starts, unless you run it anyway.`
      : null,
    forced: below && forced ? `${word} is set to run below the minimum.` : null,
    canRun: below && deciding && !forced,
    next,
    startDay: etDay(c.start_at, now),
  };
}

/* ------------------------------------------------------------------ *
 * One application (SL3)
 * ------------------------------------------------------------------ */

/** D948's reply, or a thrown error: a 404 keeps its status so the drawer says there is none. */
export function detailReply(r) {
  if (!r || r.available !== true || !r.item) throw new Error(r?.reason || 'This application could not be read.');
  return r;
}
const blockOk = (b) => Boolean(b) && b.available === true;

/** The founder's own status screen's lede, from the same record (`statusLede`), so this never says what they do not see. */
export function founderSees(d, now = Date.now()) {
  const it = d.item;
  // Their screen shows an interview only while the application is undecided (`phaseOf`).
  const open = ['pending', 'waitlisted'].includes(it.status);
  const iv = open && blockOk(d.interview) && d.interview.latest?.status === 'scheduled' ? d.interview.latest : null;
  const lede = statusLede({
    status: it.status === 'rejected' ? 'refused' : it.status === 'approved' || it.status === 'activated' ? 'accepted' : it.status,
    pool: { status: it.status },
    interview: iv,
  });
  const lines = [lede];
  const ivAt = iv ? parseStamp(iv.scheduled_at) : null;
  if (ivAt !== null) lines.push(`Their interview is on ${etTime(ivAt, now)}.`);
  if (blockOk(d.founder) && d.founder.applicant_note) lines.push(`Your note: ‘${d.founder.applicant_note}’`);
  return lines.filter(Boolean).join(' ');
}

/** The history the record holds, oldest first. Nothing is invented for a step with no stamp. */
export function historyOf(d, now = Date.now()) {
  const it = d.item;
  const from = blockOk(d.cohort) ? d.cohort.carried_from : null;
  const rows = [];
  if (it.applied_at) rows.push({ key: 'applied', glyph: '↑', text: `Applied${from ? ` for ${cohortWord(from.cohort)}` : it.cohort ? ` for ${cohortWord(it.cohort)}` : ''}`, at: etDay(it.applied_at, now) });
  if (from) rows.push({ key: 'carried', glyph: '→', text: `Carried forward from ${cohortWord(from.cohort)}`, at: etDay(it.pool_created_at, now) });
  if (it.decided_at && ['approved', 'waitlisted', 'rejected'].includes(it.status)) {
    rows.push({ key: 'decided', glyph: statusOf(it.display_status).glyph, text: `${statusOf(it.display_status).word} by an admin`, at: etDay(it.decided_at, now) });
  }
  const iv = blockOk(d.interview) ? d.interview.latest : null;
  if (iv?.status === 'scheduled') rows.push({ key: 'interview', glyph: '☏', text: 'Interview set by an admin', at: null });
  if (blockOk(d.founder) && d.founder.withdrawn_at) rows.push({ key: 'withdrawn', glyph: '–', text: 'The founder withdrew', at: etDay(d.founder.withdrawn_at, now) });
  return rows;
}

/** SL3b: the line that says why a decision is closed, or null when it is open. */
export function closedLine(d, now = Date.now()) {
  const it = d.item;
  const own = blockOk(d.cohort) ? d.cohort.own : null;
  if (it.status === 'activated') return `${cohortWord(it.cohort)} started${own?.start_at ? ` on ${etDay(own.start_at, now)}` : ''}. Decisions are closed.`;
  if (it.status === 'withdrawn') {
    const at = blockOk(d.founder) ? etDay(d.founder.withdrawn_at, now) : null;
    return at ? `The founder withdrew on ${at}.` : 'The founder withdrew.';
  }
  if (it.status === 'rolled_forward') return 'This application was carried forward to the next cohort. It is decided there.';
  return null;
}

/** The interview block: its time in ET, length, place, the admin's own clock, and the founder's ask to move it. */
export function interviewOf(d, now = Date.now(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!blockOk(d.interview)) return { state: 'unreadable' };
  const iv = d.interview.latest;
  if (!iv || iv.status !== 'scheduled') return { state: 'none' };
  const at = parseStamp(iv.scheduled_at);
  const yours = at === null ? null : new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
  return {
    state: 'set',
    line: [etTime(at, now), iv.duration_min ? `${iv.duration_min} min` : null, iv.location].filter(Boolean).join(' · '),
    yours: zone === 'America/New_York' || !yours ? null : `Your time ${yours}`,
    note: iv.note || null,
    ask: iv.reschedule_requested_at ? (iv.reschedule_reason ? `The founder asked to move it: ‘${iv.reschedule_reason}’` : 'The founder asked to move it.') : null,
  };
}

/* ------------------------------------------------------------------ *
 * The dialogs (SL4 A–G)
 * ------------------------------------------------------------------ */

export const REASON_MAX = 500;
export const NOTE_MAX = 2000;
export const ASKS_MAX = 3;
export const LENGTHS = [15, 30, 45, 60];

/** Refusals in the page's words, by the Worker's code (D943, D945). */
export const APPLICATION_REFUSALS = Object.freeze({
  over_places: 'This is over the places set in Settings. Confirm approving past the places to continue.',
  decision_conflict: 'This application changed while you were deciding it. Close this, and read it again.',
  applicant_terminal: 'This application is closed: it started, was carried forward or was withdrawn.',
  admin_not_admissible: 'An admin cannot be admitted to the Lab.',
  cohort_settings_unreadable: 'The cohort places could not be read, so nothing was saved. Try again.',
  cohort_not_open: 'That cohort is not open. Only an open cohort takes a move or an admission.',
  same_cohort: 'The application is already in that cohort.',
  already_in_cohort: 'This application has been in that cohort before, so it cannot move there again.',
  not_movable: 'This application cannot move: it is declined, started, withdrawn or carried forward.',
  lab_alumnus: 'This founder has been through the Lab already.',
  already_in_lab: 'This founder is already in the Lab.',
  already_in_queue: 'This founder already has an application in the queue. Decide or move it there.',
  not_interviewable: 'Only an undecided application gets an interview.',
  time_in_past: 'An interview cannot be scheduled in the past.',
  invalid_time: 'Give the interview a date and a time.',
  no_scheduled_interview: 'There is no interview to cancel.',
});
/** The refusal codes that a confirmation answers: the dialog shows the checkbox for them. */
export const needsConfirm = (e) => (e?.code || e?.data?.error) === 'over_places';

/** SL4 A: approve. `after` is the places line, or null when places could not be read. */
export function approveCopy(row, cap) {
  const word = cohortWord(row.cohort) || 'its cohort';
  const sub = cap?.state === 'ready' && cap.startDay
    ? `The founder is told now. Their workspace opens on ${cap.startDay} at 00:00 ET, at Week 1.`
    : 'The founder is told now. Their workspace opens on the cohort’s 1st at 00:00 ET, at Week 1.';
  let after = null; let over = false;
  if (cap?.state === 'ready') {
    const n = cap.approved + (row.approved ? 0 : 1);
    after = `${nf(n)} of ${nf(cap.places)} places after this.`;
    over = n > cap.places;
  }
  return {
    title: `Approve ${row.company} for ${word}?`, sub, after, over,
    overLine: cap?.state === 'ready' ? `This is over the ${nf(cap.places)} places set in Settings.` : 'This is over the places set in Settings.',
    unread: cap?.state === 'ready' ? null : 'The places could not be read here. The Worker still checks them, and says so if this goes over.',
    action: 'Approve',
  };
}

/** SL4 B: waitlist. */
export function waitlistCopy(row, next) {
  const word = cohortWord(row.cohort) || 'this cohort’s';
  return {
    title: `Waitlist ${row.company}?`,
    sub: `They stay in the ${word} pool. If still undecided at the start, they move to ${next ? cohortWord(next.cohort) : 'the next cohort'}.`,
    action: 'Waitlist',
  };
}

/** SL4 C: decline. */
export function declineCopy(row, next) {
  return {
    title: `Decline ${row.company}?`,
    sub: next ? `They can apply again for ${cohortWord(next.cohort)}.` : 'They can apply again for a later cohort.',
    action: 'Decline',
  };
}

/** The asks, as the Worker stores them: up to three non-empty lines. */
export const asksOf = (lines) => lines.map((s) => String(s || '').trim()).filter(Boolean).slice(0, ASKS_MAX);

/** What a saved decision says, in the dialog that made it. */
export function decidedLine(status, reply, row) {
  const word = { approved: 'approved', waitlisted: 'waitlisted', rejected: 'declined' }[status];
  const parts = [`${row.company} is ${word}.`];
  if (reply?.emailed === false) parts.push('The decision email was not sent.');
  if (reply?.applicant_note_saved === false) parts.push('The decision was saved, but the note to the founder was not. Open the application and send it again.');
  return parts.join(' ');
}

/** SL4 D: move. */
export const moveCopy = (row) => ({ title: `Move ${row.company} to another cohort?`, sub: 'Open cohorts only. The founder is told.', action: 'Move' });
export function movedLine(reply, row, target) {
  const to = target ? cohortWord(target.cohort) : 'the other cohort';
  return reply?.founder_told === false ? `${row.company} moved to ${to}. The founder was not told; tell them yourself.` : `${row.company} moved to ${to}. The founder is told.`;
}

/** SL4 E: schedule an interview. */
export const interviewCopy = (row, again) => ({
  title: `${again ? 'Move the interview with' : 'Schedule an interview with'} ${row.company}`,
  sub: again ? 'The founder sees the new time, the place and your note. The old time is cancelled.' : 'The founder sees the time, the place and your note.',
  action: again ? 'Move it' : 'Schedule',
});

/**
 * A date and time on the Lab's clock (ET) as a UTC instant, or null.
 * ET is America/New_York: the offset is the zone's at that wall-clock time,
 * so a date across a DST change is right.
 */
export function etToUtc(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!d || !t) return null;
  const want = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
    guess += want - seen;
  }
  return new Date(guess).toISOString();
}

/** "Your time 20:00", beside the ET field, when the admin is not on ET. */
export function yourTime(iso, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const ms = parseStamp(iso);
  if (ms === null || zone === 'America/New_York') return null;
  return `Your time ${new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms))}`;
}

/** The interview's cancel: no reason is stored for it (D383). */
export const cancelCopy = (row) => ({
  title: `Cancel the interview with ${row.company}?`,
  sub: 'The founder no longer sees an interview time. You can schedule another.',
  action: 'Cancel the interview',
});

/** SL4 F: run below the minimum. */
export function runCopy(cap) {
  return {
    title: `Run ${cap.word} below the minimum?`,
    sub: `${nf(cap.approved)} approved, minimum ${nf(cap.min)}. Without this, the cohort moves to ${cap.next ? cohortWord(cap.next.cohort) : 'the next cohort'} about 12 hours before it starts.`,
    action: 'Run it anyway',
  };
}

/** SL4 G: admit without an application. */
export const admitCopy = (who) => ({
  title: `Admit ${who || 'a founder'} without an application?`,
  sub: 'This creates the application on their behalf, so the queue and the calendar agree.',
  action: 'Admit',
});

/** The bulk bar's dialog: one reason covers every selected application. */
export function bulkCopy(status, n) {
  const verb = status === 'approved' ? 'Approve' : 'Waitlist';
  return {
    title: `${verb} ${plural(n, 'application', 'applications')}?`,
    sub: status === 'approved'
      ? 'Each founder is told now, and each approval takes a place. One reason covers them all.'
      : 'Each stays in its cohort’s pool. One reason covers them all.',
    action: verb,
  };
}

/** D945's bulk answer, as one line per application that was refused, and the count that landed. */
export function bulkResult(reply, rows, known = APPLICATION_REFUSALS) {
  const results = Array.isArray(reply?.results) ? reply.results : [];
  const byId = new Map(rows.map((r) => [Number(r.applicantId), r]));
  const ok = results.filter((x) => x.ok === true || x.result === 'ok').length;
  const refused = results.filter((x) => !(x.ok === true || x.result === 'ok')).map((x) => {
    const id = Number(x.applicant_id ?? x.id);
    const code = x.code || x.error || x.result;
    return `${byId.get(id)?.company || `Application ${id}`}: ${known[code] || x.message || 'not saved'}`;
  });
  return { line: `${plural(ok, 'application was', 'applications were')} saved.`, refused };
}

/** Why an action cannot open for this row, or null when it can. */
export function cannotAct(kind, row) {
  if (kind === 'move') return row.movable ? null : `${row.company} cannot move: it is ${row.status.word.toLowerCase()}.`;
  if (kind === 'interview') return row.interviewable ? null : 'Only an undecided application gets an interview.';
  if (kind === 'cancel') return row.hasInterview ? null : 'There is no interview to cancel.';
  return row.decidable ? null : `Decisions are closed for ${row.company}: it is ${row.status.word.toLowerCase()}.`;
}
