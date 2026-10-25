/**
 * D947 (#2752) — the Spin-Out Lab's Overview and Cohorts, as pure functions
 * over part 2's read (D944): `GET /api/admin/cohort/overview` (`adminLabApi.overview`)
 * and, for one cohort's applicants, `GET /api/admin/cohort/applications/list`.
 * Places and the minimum come from Settings, on `GET /api/admin/cohort/applications`
 * (`settings`, null when unreadable). No React here, so `node --test` loads it alone.
 *
 * Every block is one of:
 *   { state: 'loading' }
 *   { state: 'unreadable', reason }   — its read failed; never a zero
 *   { state: 'empty', text }          — read, and truly nothing to draw
 *   { state: 'ready', … }
 * A metric is `{ available: true, value }`, `{ available: false, reason }` or
 * `{ recorded: false, reason }` (D944); `metricOf` turns each into what a cell says.
 *
 * Times: stored stamps are UTC (`ui/parseStamp.js`); every date drawn is ET.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { parseStamp } from '../../../ui/parseStamp.js';
import { LAB_PATH, cohortLabel, cohortWord, dayET, stampET } from './labModel.js';

export { NOT_RECORDED };
export const UNREADABLE = 'Unreadable';
const DAY = 86400000;
const nf = (n) => Number(n).toLocaleString('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One cohort's address: `/admin/programs/spinout-lab/cohorts/2026-11`. */
export const cohortPath = (ym) => `${LAB_PATH}/cohorts/${ym}`;

/** The cohort key an address names, or null. */
export function cohortOf(pathname) {
  const m = String(pathname || '').replace(/\/+$/, '').match(/\/cohorts\/(\d{4}-(?:0[1-9]|1[0-2]))$/);
  return m && String(pathname).startsWith(`${LAB_PATH}/cohorts/`) ? m[1] : null;
}

/** "YYYY-MM" for a cohort item. */
export const keyOf = (c) => `${c.year}-${String(c.month).padStart(2, '0')}`;

const READ_FAILED = 'The Lab’s overview read could not be read. That is not the same as none.';

/** The overview read's state, or the block it holds, as a block state. */
export function blockOf(read, name) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') return { state: 'unreadable', reason: READ_FAILED };
  const b = read.data?.blocks?.[name];
  if (!b) return { state: 'unreadable', reason: READ_FAILED };
  if (b.available === false) return { state: 'unreadable', reason: b.reason || READ_FAILED };
  return { state: 'ready', block: b };
}

/** What a metric says: its number, Not recorded with its reason, or Unreadable with its reason. */
export function metricOf(m) {
  if (m && m.decided === false) return { kind: 'not_decided', text: 'Not decided yet', reason: m.reason || null };
  if (m && m.available === true && Number.isFinite(Number(m.value))) return { kind: 'value', value: Number(m.value), text: nf(m.value) };
  if (m && m.recorded === false) return { kind: 'not_recorded', text: NOT_RECORDED, reason: m.reason || null };
  return { kind: 'unreadable', text: UNREADABLE, reason: m?.reason || 'This figure could not be read.' };
}
const val = (m) => (metricOf(m).kind === 'value' ? Number(m.value) : null);

/** The cohorts, oldest first. */
export function cohortsOf(read) {
  const b = blockOf(read, 'cohorts');
  if (b.state !== 'ready') return null;
  return [...(b.block.items || [])].sort((a, z) => (Number(a.year) - Number(z.year)) || (Number(a.month) - Number(z.month)));
}

/** Settings' places and minimum, or null when they could not be read. */
export function settingsOf(appsRead) {
  if (!appsRead || appsRead.status !== 'ready') return null;
  const s = appsRead.data?.settings;
  if (!s || !Number.isFinite(Number(s.min)) || !Number.isFinite(Number(s.max))) return null;
  return { min: Number(s.min), places: Number(s.max) };
}

/** The recorded week windows of a cohort, or null when they could not be read. */
function weeksOf(c) {
  if (!c?.weeks || c.weeks.available === false) return null;
  return [...(c.weeks.items || [])].sort((a, z) => Number(a.week_number) - Number(z.week_number));
}

// ── SL1 · the calendar timeline (and SL5's "Next twelve cohorts") ─────────

/**
 * One lane per cohort: the application window, the review window (closed,
 * pool frozen, until the start), the four weeks from the recorded windows,
 * the Week 4 deadline, and Today. `mode` 'overview' draws the cohorts around
 * today (up to five, from the last one finished); 'twelve' draws up to twelve
 * from the one running (or the last finished).
 */
export function buildTimeline(read, now, mode = 'overview') {
  const b = blockOf(read, 'cohorts');
  if (b.state !== 'ready') return b;
  const all = cohortsOf(read);
  if (!all.length) return { state: 'empty', text: 'The Lab’s calendar holds no cohort yet. The Lab’s clock schedules each one on its own.' };
  const started = all.filter((c) => (parseStamp(c.start_at) ?? Infinity) <= now);
  const anchor = started.length ? all.indexOf(started[started.length - 1]) : 0;
  const from = mode === 'overview' ? Math.max(0, anchor - 1) : anchor;
  const lanes = all.slice(from, from + (mode === 'overview' ? 5 : 12)).map((c) => laneOf(c, now));
  const times = lanes.flatMap((l) => [l.open, l.close, l.start, l.end].filter((t) => t != null));
  if (!times.length) return { state: 'empty', text: 'No cohort here has recorded dates yet.' };
  const lo = Math.min(...times, now);
  const hi = Math.max(...times, now);
  const startMonth = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
  const range = { from: startMonth(lo), to: startMonth(hi + 31 * DAY) };
  const months = [];
  for (let t = range.from; t < range.to;) {
    const d = new Date(t);
    months.push({ at: t, label: `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 || t === range.from ? ` ${d.getUTCFullYear()}` : ''}` });
    t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const lead = mode === 'overview'
    ? `Cohort calendar, ${lanes[0].label} to ${lanes[lanes.length - 1].label}: ${lanes.map((l) => `${l.label} ${l.word.toLowerCase()}`).join('; ')}.`
    : `${lanes.length} cohorts from ${lanes[0].label} to ${lanes[lanes.length - 1].label}, each with its application window, review window and four weeks.`;
  return { state: 'ready', range, months, lanes, today: now, alt: lead };
}

function laneOf(c, now) {
  const open = parseStamp(c.applications_open_at);
  const close = parseStamp(c.applications_close_at);
  const start = parseStamp(c.start_at);
  const end = parseStamp(c.end_at);
  const windows = weeksOf(c);
  const weeks = (windows || []).map((w) => ({
    n: Number(w.week_number),
    from: parseStamp(w.unlock_at),
    to: parseStamp(w.deadline_at),
  })).filter((w) => w.from != null && w.to != null);
  const w4 = weeks.find((w) => w.n === 4) || null;
  const label = cohortLabel(c);
  const tips = [];
  if (open != null && close != null) tips.push({ part: 'open', text: `${label} · Applications open ${stampET(open)}, close ${stampET(close)}` });
  if (close != null && start != null) tips.push({ part: 'review', text: `${label} · In review · pool frozen until ${stampET(start)}` });
  for (const w of weeks) tips.push({ part: `w${w.n}`, text: `${label} · Week ${w.n} · opens ${stampET(w.from)} · deadline ${stampET(w.to)}` });
  if (w4) tips.push({ part: 'deadline', text: `${label} · Week 4 deadline ${stampET(w4.to)}` });
  return {
    key: keyOf(c), id: c.id, label, word: cohortWord(c), href: cohortPath(keyOf(c)),
    open, close, start, end, weeks, week4: w4 ? w4.to : null,
    weeksUnreadable: windows === null, weeksMissing: windows !== null && weeks.length === 0,
    now: start != null && end != null && start <= now && now < end,
    tips,
  };
}

// ── SL1 · Applications by cohort ──────────────────────────────────────────

export const POOL_PARTS = [
  { key: 'approved', label: 'Approved or started', tone: 'violet' },
  { key: 'waitlisted', label: 'Waitlisted', tone: 'sky' },
  { key: 'undecided', label: 'Waiting', tone: 'amber' },
  { key: 'declined_withdrawn', label: 'Declined or withdrawn', tone: 'muted' },
  { key: 'carried_forward', label: 'Carried forward', tone: 'emerald' },
];

/**
 * One stacked column per cohort that has opened for applications, the last
 * seven: approved or started, waitlisted, waiting, declined or withdrawn,
 * carried forward. Each column is the cohort's applied total. Places and the
 * minimum are reference lines when Settings could be read.
 */
export function buildByCohort(read, appsRead, now) {
  const b = blockOf(read, 'cohorts');
  if (b.state !== 'ready') return b;
  const opened = cohortsOf(read).filter((c) => (parseStamp(c.applications_open_at) ?? Infinity) <= now).slice(-7);
  if (!opened.length) return { state: 'empty', text: 'No cohort has opened for applications yet.' };
  const settings = settingsOf(appsRead);
  let unread = 0;
  const rows = opened.map((c) => {
    const nums = {
      approved: val(c.approved), waitlisted: val(c.waitlisted), undecided: val(c.undecided),
      declined_withdrawn: val(c.declined) != null && val(c.withdrawn) != null ? val(c.declined) + val(c.withdrawn) : null,
      carried_forward: val(c.carried_forward),
    };
    const applied = val(c.applied);
    const label = MONTHS[Number(c.month) - 1] || cohortLabel(c);
    const current = parseStamp(c.applications_close_at) > now;
    if (applied == null || Object.values(nums).some((v) => v == null)) {
      unread += 1;
      return { key: keyOf(c), label, cohort: cohortLabel(c), value: 0, open: true, text: UNREADABLE, unreadable: true };
    }
    return {
      key: keyOf(c), label, cohort: cohortLabel(c), value: applied,
      text: current ? `${nf(applied)} so far` : nf(applied),
      parts: POOL_PARTS.map((p) => ({ key: p.key, label: p.label, tone: p.tone, value: nums[p.key] })),
      carriedIn: val(c.carried_in),
    };
  });
  const drawn = rows.filter((r) => !r.unreadable);
  const references = settings ? [{ value: settings.places, label: `Places ${nf(settings.places)}` }, { value: settings.min, label: `Minimum ${nf(settings.min)}`, dashed: true }] : [];
  const carried = drawn.filter((r) => r.carriedIn > 0).map((r) => `${nf(r.carriedIn)} of ${r.cohort}’s were carried from the cohort before`);
  return {
    state: 'ready',
    chart: { type: 'columns', rows, references },
    table: {
      head: ['Cohort', ...POOL_PARTS.map((p) => p.label), 'Applied'],
      rows: rows.map((r) => [r.cohort, ...POOL_PARTS.map((p) => (r.unreadable ? UNREADABLE : nf(r.parts.find((x) => x.key === p.key).value))), r.text]),
    },
    alt: `Applications by cohort, ${rows[0].cohort} to ${rows[rows.length - 1].cohort}: ${drawn.map((r) => `${r.cohort} ${r.text}`).join(', ')}${settings ? `. Places ${settings.places}, minimum ${settings.min}` : ''}.`,
    settingsUnreadable: !settings,
    unreadCohorts: unread,
    foot: carried.length ? `${carried.join('; ')}.` : null,
  };
}

// ── SL1 · Weeks passed, by cohort ─────────────────────────────────────────

/**
 * A row per cohort that has started (and the next one), a cell per week:
 * Not started; Now, with its deadline; or the outcomes recorded for it.
 * "Of those who reached it" is not recorded (D944: nothing stores a
 * reached-week ledger), so a cell says how many passed, never a share.
 */
export function buildHeat(read, now) {
  const b = blockOf(read, 'cohorts');
  if (b.state !== 'ready') return b;
  const all = cohortsOf(read);
  const started = all.filter((c) => (parseStamp(c.start_at) ?? Infinity) <= now);
  if (!started.length) return { state: 'empty', text: 'No cohort has started yet, so no week has been decided.' };
  const next = all.find((c) => (parseStamp(c.start_at) ?? -Infinity) > now);
  const rows = [...started.slice(-4), ...(next ? [next] : [])].map((c) => {
    const windows = weeksOf(c);
    const cells = [1, 2, 3, 4].map((n) => {
      if (windows === null) return { n, kind: 'unreadable', text: UNREADABLE };
      const w = windows.find((x) => Number(x.week_number) === n);
      if (!w) return { n, kind: 'not_recorded', text: NOT_RECORDED };
      const from = parseStamp(w.unlock_at);
      const to = parseStamp(w.deadline_at);
      if (from == null || from > now) return { n, kind: 'not_started', text: 'Not started' };
      if (to != null && now <= to) return { n, kind: 'now', text: `Now · ${dayET(to)}`, deadline: stampET(to) };
      return {
        n, kind: 'counts', passed: Number(w.passed || 0), failed: Number(w.failed || 0),
        grace: Number(w.in_grace || 0), pending: Number(w.pending || 0),
        text: `${nf(w.passed || 0)} passed`,
      };
    });
    return { key: keyOf(c), label: cohortLabel(c), cells };
  });
  return {
    state: 'ready', rows,
    note: 'Each cell is the founders who passed that week. How many reached a week is not recorded, so no cell is a share.',
  };
}

// ── SL1 · From application to company ─────────────────────────────────────

export const FUNNEL_STEPS = [
  { key: 'applied', label: 'Applied' },
  { key: 'approved', label: 'Approved' },
  { key: 'started_week_1', label: 'Started Week 1' },
  { key: 'passed_week_4', label: 'Passed Week 4' },
  { key: 'incorporated', label: 'Incorporated' },
  { key: 'certificate_issued', label: 'Certificate issued' },
];

/**
 * The funnel steps for one cohort item, the same mapping the Worker's funnel
 * block uses, except that a Week 4 whose deadline has not passed (or has no
 * recorded window) is not decided yet rather than a zero.
 */
export function funnelStepsOf(c, now = Date.now()) {
  const w4 = (weeksOf(c) || []).find((w) => Number(w.week_number) === 4);
  const weeks = c?.weeks;
  const decided = w4 && (parseStamp(w4.deadline_at) ?? Infinity) < now;
  return {
    applied: c.applied,
    interviewed: c.interviewed,
    approved: c.approved,
    started_week_1: c.started,
    passed_week_4: weeks && weeks.available === false ? weeks
      : decided ? { available: true, value: Number(w4.passed || 0) }
        : { decided: false, reason: 'Week 4’s deadline has not passed yet.' },
    incorporated: c.incorporated,
    certificate_issued: c.certificates_issued,
  };
}

/** The funnel for the chosen cohort (default: the Worker's), each step its own state; interviews beside it. */
export function buildFunnel(read, chosen) {
  const b = blockOf(read, 'cohorts');
  if (b.state !== 'ready') return b;
  const all = cohortsOf(read);
  if (!all.length) return { state: 'empty', text: 'No cohort to follow yet.' };
  const f = read.data?.blocks?.funnel;
  const defaultKey = f?.available ? f.cohort : null;
  const key = chosen || defaultKey || keyOf(all[all.length - 1]);
  const cohort = all.find((c) => keyOf(c) === key);
  if (!cohort) return { state: 'unreadable', reason: 'That cohort is not in the read.' };
  const asOf = read.data?.as_of ? Date.parse(read.data.as_of) : Date.now();
  const steps = funnelStepsOf(cohort, asOf);
  const applied = val(steps.applied);
  const rows = FUNNEL_STEPS.map((s) => {
    const m = metricOf(steps[s.key]);
    const pct = m.kind === 'value' && applied ? Math.round((m.value / applied) * 100) : null;
    return { key: s.key, label: s.label, ...m, pct, share: m.kind === 'value' && applied ? m.value / applied : null };
  });
  const iv = metricOf(steps.interviewed);
  return {
    state: 'ready', cohort: key, label: cohortLabel(cohort),
    options: all.filter((c) => (parseStamp(c.applications_open_at) ?? Infinity) <= asOf)
      .map((c) => ({ key: keyOf(c), label: cohortLabel(c) })),
    rows,
    interviewed: iv,
    alt: `${cohortLabel(cohort)}: ${rows.map((r) => `${r.label.toLowerCase()} ${r.text}`).join(', ')}.`,
    foot: `Interviewed: ${iv.text}${iv.reason ? ` (${iv.reason})` : ''}. Interviews are optional, so they sit beside the steps, not in them.`,
  };
}

// ── SL1 · Applications per week ───────────────────────────────────────────

/** Twelve Monday weeks in ET, the current one so far. A read week with none is a real zero. */
export function buildPerWeek(read) {
  const b = blockOf(read, 'applications_per_week');
  if (b.state !== 'ready') return b;
  const items = b.block.items || [];
  if (!items.length) return { state: 'empty', text: 'No week to show yet.' };
  const labels = items.map((w) => dayET(parseStamp(w.start)) || NOT_RECORDED);
  const values = items.map((w) => Number(w.applied || 0));
  const total = values.reduce((a, v) => a + v, 0);
  return {
    state: 'ready',
    chart: { type: 'line', values, labels },
    table: { head: ['Week of', 'Applications'], rows: items.map((w, i) => [w.partial ? `${labels[i]} (so far)` : labels[i], nf(values[i])]) },
    alt: `Applications per week for ${items.length} weeks: ${total ? `between ${Math.min(...values)} and ${Math.max(...values)}` : 'none'}; the current week is not finished.`,
  };
}

// ── SL5 · Cohorts: the list ───────────────────────────────────────────────

export const LIST_SORTS = { starts: 'Starts, soonest first', starts_desc: 'Starts, latest first' };

/** SL5's list: every cohort the read holds, searched, filtered by status word and sorted by start. */
export function buildCohortList(read, { q = '', status = '', sort = 'starts' } = {}, now = Date.now()) {
  const b = blockOf(read, 'cohorts');
  if (b.state !== 'ready') return b;
  const all = cohortsOf(read);
  if (!all.length) return { state: 'empty', text: 'The Lab’s calendar holds no cohort yet.' };
  let rows = all.map((c) => {
    const w4 = (weeksOf(c) || []).find((w) => Number(w.week_number) === 4);
    const pool = ['applied', 'approved', 'waitlisted', 'waiting'].map((k) => metricOf(c[k]));
    const notOpen = (parseStamp(c.applications_open_at) ?? Infinity) > now && pool[0].kind === 'value' && pool[0].value === 0;
    return {
      key: keyOf(c), label: cohortLabel(c), word: cohortWord(c), href: cohortPath(keyOf(c)),
      start: parseStamp(c.start_at),
      opens: stampET(parseStamp(c.applications_open_at)) || NOT_RECORDED,
      closes: stampET(parseStamp(c.applications_close_at)) || NOT_RECORDED,
      starts: stampET(parseStamp(c.start_at)) || NOT_RECORDED,
      week4: w4 ? stampET(parseStamp(w4.deadline_at)) : (weeksOf(c) === null ? UNREADABLE : NOT_RECORDED),
      pool: notOpen ? 'Not open yet' : pool.map((m) => m.text).join(' · '),
      started: c.status === 'scheduled' ? '—' : metricOf(c.started).text,
      graduated: c.status === 'scheduled' ? '—' : metricOf(c.incorporated).text,
    };
  });
  const needle = String(q).trim().toLowerCase();
  if (needle) rows = rows.filter((r) => r.label.toLowerCase().includes(needle) || r.key.includes(needle));
  if (status) rows = rows.filter((r) => r.word === status);
  rows.sort((a, z) => ((a.start ?? Infinity) - (z.start ?? Infinity)) * (sort === 'starts_desc' ? -1 : 1));
  return { state: 'ready', rows, total: all.length, statuses: [...new Set(all.map(cohortWord))] };
}

// ── SL6 · one cohort ──────────────────────────────────────────────────────

/** SL6: one cohort's page from the same read, plus Settings for its capacity. */
export function buildCohortPage(read, appsRead, ym, now) {
  const b = blockOf(read, 'cohorts');
  if (b.state !== 'ready') return b;
  const c = cohortsOf(read).find((x) => keyOf(x) === ym);
  if (!c) return { state: 'missing', text: `The Lab’s calendar holds no ${ym} cohort.` };
  const label = cohortLabel(c);
  const open = parseStamp(c.applications_open_at);
  const close = parseStamp(c.applications_close_at);
  const start = parseStamp(c.start_at);
  const windows = weeksOf(c);
  const w4 = (windows || []).find((w) => Number(w.week_number) === 4);
  const line = [
    open != null && close != null ? `Applications ${stampET(open)} → ${stampET(close)}` : null,
    start != null ? `${start <= now ? 'started' : 'starts'} ${stampET(start)}` : null,
    w4 ? `Week 4 deadline ${stampET(parseStamp(w4.deadline_at))}` : null,
  ].filter(Boolean).join(' · ');

  const started = metricOf(c.started);
  const w1 = (windows || []).find((w) => Number(w.week_number) === 1);
  const w1Started = w1 && (parseStamp(w1.deadline_at) ?? Infinity) < now;
  const tiles = [
    { key: 'applied', label: 'Applied', ...metricOf(c.applied) },
    { key: 'approved', label: 'Approved', ...metricOf(c.approved) },
    { key: 'started', label: 'Started', ...(c.status === 'scheduled' ? { kind: 'not_started', text: 'Not started' } : started) },
    windows === null
      ? { key: 'passed_w1', label: 'Passed Week 1', kind: 'unreadable', text: UNREADABLE, reason: c.weeks?.reason || null }
      : !w1Started
        ? { key: 'passed_w1', label: 'Passed Week 1', kind: 'not_started', text: 'Not decided yet' }
        : { key: 'passed_w1', label: 'Passed Week 1', kind: 'value', value: Number(w1.passed || 0), text: nf(w1.passed || 0), sub: started.kind === 'value' ? `of ${started.text} started` : null },
  ];

  const poolKeys = c.status === 'scheduled'
    ? [['approved', 'Approved', 'violet'], ['waitlisted', 'Waitlisted', 'sky'], ['undecided', 'Waiting', 'amber'], ['declined', 'Declined', 'muted'], ['withdrawn', 'Withdrawn', 'muted'], ['carried_forward', 'Carried forward', 'emerald']]
    : [['started', 'Started', 'violet'], ['waitlisted', 'Waitlisted', 'sky'], ['undecided', 'Waiting', 'amber'], ['declined', 'Declined', 'muted'], ['withdrawn', 'Withdrawn', 'muted'], ['carried_forward', 'Carried forward', 'emerald']];
  const poolVals = poolKeys.map(([k, l, tone]) => ({ key: k, label: l, tone, m: metricOf(c[k]) }));
  const applied = metricOf(c.applied);
  const pool = poolVals.some((p) => p.m.kind !== 'value') || applied.kind !== 'value'
    ? { state: 'unreadable', reason: [applied, ...poolVals.map((p) => p.m)].find((m) => m.kind !== 'value')?.reason || 'The pool could not be read.' }
    : {
      state: 'ready', applied: applied.value,
      chart: { type: 'stackbars', head: 'Pool', parts: poolVals.map((p) => ({ key: p.key, label: p.label, tone: p.tone })),
        rows: [{ key: ym, label: `Where the ${label} pool went`, parts: poolVals.map((p) => ({ key: p.key, label: p.label, tone: p.tone, value: p.m.value })), total: nf(applied.value) }] },
      alt: `Pool of ${applied.value}: ${poolVals.map((p) => `${p.m.value} ${p.label.toLowerCase()}`).join(', ')}.`,
    };

  const settings = settingsOf(appsRead);
  const approved = metricOf(c.approved);
  const capacity = !settings
    ? { state: 'unreadable', reason: 'Minimum and places could not be read, so no cohort is judged against them.' }
    : {
      state: 'ready', min: settings.min, places: settings.places,
      text: `Minimum ${nf(settings.min)} · Places ${nf(settings.places)}`,
      approved: approved.kind === 'value' ? `${approved.text} approved of ${nf(settings.places)} places` : `Approved: ${approved.text}`,
      met: approved.kind === 'value' ? approved.value >= settings.min : null,
      check: 'The capacity check’s own result is not read here yet: no read returns it.',
    };

  const weeks = windows === null
    ? { state: 'unreadable', reason: c.weeks?.reason || 'The week windows could not be read.' }
    : !windows.length
      ? { state: 'empty', text: 'No week window is recorded for this cohort yet.' }
      : {
        state: 'ready',
        rows: windows.map((w) => {
          const from = parseStamp(w.unlock_at);
          const to = parseStamp(w.deadline_at);
          const notStarted = from == null || from > now;
          const running = !notStarted && to != null && now <= to;
          return {
            n: Number(w.week_number), label: `Week ${w.week_number}${running ? ' · now' : ''}`, now: running,
            opens: stampET(from) || NOT_RECORDED, deadline: stampET(to) || NOT_RECORDED,
            passed: notStarted ? 'Not started' : running ? '—' : nf(w.passed || 0),
            failed: notStarted || running ? '—' : nf(w.failed || 0),
            grace: notStarted ? '—' : nf(w.in_grace || 0),
            waiting: notStarted ? '—' : nf(w.pending || 0),
          };
        }),
      };

  return {
    state: 'ready', key: ym, label, title: `${label} cohort`, word: cohortWord(c), line,
    tiles, pool, capacity, weeks,
    messages: { state: 'not_read', text: 'The messages the Lab sent this cohort are not read here yet: no admin read returns them.' },
    history: { state: 'not_read', text: 'This cohort’s history is not read here yet: no admin read returns the Lab clock’s events.' },
  };
}

/** One page of a cohort's applicants (the D944 list read), as rows. */
export function buildApplicants(listRead) {
  if (!listRead || listRead.status === 'loading') return { state: 'loading' };
  if (listRead.status === 'error' || listRead.data?.available === false) {
    return { state: 'unreadable', reason: listRead.data?.reason || 'The applicants could not be read. That is not the same as none.' };
  }
  const d = listRead.data || {};
  const items = Array.isArray(d.items) ? d.items : [];
  if (!items.length && Number(d.total) === 0) return { state: 'empty', text: 'No one has applied for this cohort yet.' };
  const words = {
    waiting: 'Waiting', interview_set: 'Interview set', approved: 'Approved', waitlisted: 'Waitlisted', declined: 'Declined',
    withdrawn: 'Withdrawn', carried_forward: 'Carried forward', started: 'Started',
  };
  return {
    state: 'ready', total: Number(d.total), offset: Number(d.offset || 0), limit: Number(d.limit || 25),
    rows: items.map((r) => ({
      id: r.id, company: r.company_name || NOT_RECORDED, founder: r.name || NOT_RECORDED,
      status: words[r.display_status] || r.display_status || NOT_RECORDED,
      applied: r.applied_at ? dayET(parseStamp(r.applied_at)) : NOT_RECORDED,
    })),
  };
}
