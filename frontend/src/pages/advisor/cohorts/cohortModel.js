/**
 * D4813 (#4813, package 1) — the Cohorts workspace's model, with no React in it.
 *
 * Everything the Overview, Founders and the shared cohort selector decide lives
 * here as plain functions, so the decisions are tested directly rather than
 * through a rendered page:
 *
 *   · WHICH COHORT. `?cohort=<cycleId>` is the one selection for the whole
 *     workspace. It is validated against the advisor's own assignments; a value
 *     that is malformed or not theirs falls back to a cohort they hold, and the
 *     fallback is reported so the page can say so rather than silently showing
 *     a different batch.
 *   · WHICH RESPONSE. A read keyed by an older cohort must never replace the
 *     current one's content. `createRequestGate` hands each read a token and
 *     only the newest token may write; `guardedRead` is the one place that rule
 *     is applied.
 *   · WHAT STATE A FOUNDER IS IN. Failed, Grace, At risk, On track or Not
 *     assessed, from the Lab's week record. Failed and Grace need attention
 *     whatever the percentage, and progress that cannot be read is Not
 *     assessed, never 0%.
 *   · WHAT NEEDS THE ADVISOR. Each item names the founder or cohort, a concrete
 *     reason, a date and one action link.
 *
 * Nothing here invents a figure: a count the reads cannot support is `null`,
 * and the page draws `null` as "Not recorded", never as zero.
 */

export const COHORT_PARAM = 'cohort';
export const REMEMBER_KEY = 'axal.cohorts.selected';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 2026" — a cycle is named by its month. */
export function cohortLabel(cohort) {
  if (!cohort) return 'Cohort';
  const month = MONTHS[Number(cohort.month) - 1];
  return `${month || `Month ${cohort.month}`} ${cohort.year}`;
}

/** A cycle id as the URL carries it: a positive integer, or nothing. */
export function parseCohortParam(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return /^[1-9]\d{0,9}$/.test(s) ? Number(s) : null;
}

/**
 * The selected cohort, from the URL first.
 *
 * `items` are `/me/cohort` assignments; `raw` is the `?cohort=` value as typed;
 * `remembered` is the last cohort this browser chose. Returns the cycle id to
 * show, where it came from, and — when the URL named something unusable — a
 * `fallback` the page states in words.
 */
export function resolveCohort({ items, raw, remembered }) {
  const list = Array.isArray(items) ? items : [];
  const ids = list.map((a) => Number(a.cohort_cycle_id));
  const has = (id) => id != null && ids.includes(id);
  const rememberedId = parseCohortParam(remembered);
  const backup = has(rememberedId) ? rememberedId : (ids[0] ?? null);
  const backupSource = has(rememberedId) ? 'remembered' : (ids.length ? 'first' : 'none');
  const named = raw != null && String(raw).trim() !== '';
  if (named) {
    const id = parseCohortParam(raw);
    if (has(id)) return { cycleId: id, source: 'url', fallback: null };
    return {
      cycleId: backup,
      source: backupSource,
      fallback: { reason: id == null ? 'invalid' : 'unassigned', raw: String(raw).slice(0, 40) },
    };
  }
  return { cycleId: backup, source: backupSource, fallback: null };
}

/** A workspace link that keeps the selected cohort. */
export function withCohort(path, cycleId, extra = {}) {
  const params = new URLSearchParams();
  if (cycleId != null) params.set(COHORT_PARAM, String(cycleId));
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') params.set(k, String(v));
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/**
 * One counter per page: each read takes a token, and only the newest token may
 * write. Switching cohort, refreshing or retrying all take a new token, so a
 * response that arrives late — from the cohort the advisor just left — is
 * dropped instead of painting the wrong batch.
 */
export function createRequestGate() {
  let latest = 0;
  return {
    next() { latest += 1; return latest; },
    isCurrent(token) { return token === latest; },
    invalidate() { latest += 1; },
  };
}

/**
 * The one read path every Cohorts section uses.
 *
 * `fetch()` performs the read; `accept(payload)` may return a sentence when a
 * 200 response is itself a failed read (`available: false`). `onState` is
 * called with `{loading, error, data}` and is NEVER called once a newer token
 * has been taken. Returns whether this read was the one that landed.
 */
export async function guardedRead({ gate, fetch, accept, onState, fallbackError }) {
  const token = gate.next();
  onState({ loading: true, error: '', data: null });
  try {
    const payload = await fetch();
    if (!gate.isCurrent(token)) return false;
    const refusal = accept ? accept(payload) : null;
    if (refusal) onState({ loading: false, error: refusal, data: null });
    else onState({ loading: false, error: '', data: payload });
    return true;
  } catch (e) {
    if (!gate.isCurrent(token)) return false;
    onState({ loading: false, error: e?.message || fallbackError || 'This could not be read.', data: null });
    return true;
  }
}

// ── Dates ─────────────────────────────────────────────────────────────────

const LAB_TZ = 'America/New_York';
const ms = (iso) => {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
};

function fmt(t, opts) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: LAB_TZ, ...opts }).format(new Date(t));
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/** "Mar 8" in the Lab's own timezone (cycles start at 00:00 New York). */
export function shortDate(iso) {
  const t = ms(iso);
  return Number.isFinite(t) ? fmt(t, { month: 'short', day: 'numeric' }) : null;
}

/** "Thu Mar 18, 23:59" — a deadline with its time. */
export function dayTime(iso) {
  const t = ms(iso);
  return Number.isFinite(t)
    ? fmt(t, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : null;
}

/** "Thu Mar 18" — a calendar day, for grouping an agenda. */
export function dayLabel(iso) {
  const t = ms(iso);
  return Number.isFinite(t) ? fmt(t, { weekday: 'short', month: 'short', day: 'numeric' }) : null;
}

/**
 * The cycle's dates, "Mar 8 – Apr 4". `end_at` is the instant the cycle ends
 * (00:00 on day 29), so the last day shown is the day before it.
 */
export function cohortRange(cohort) {
  const start = ms(cohort?.start_at);
  const end = ms(cohort?.end_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return `${shortDate(cohort.start_at)} – ${fmt(end - 1, { month: 'short', day: 'numeric' })}`;
}

/** "Week 2 of 4", or null when the cycle has no week windows recorded. */
export function weekOfLabel(weeks) {
  if (!weeks || weeks.available === false || !weeks.windows_recorded) return null;
  const total = Array.isArray(weeks.weeks) ? weeks.weeks.length : 0;
  if (!total) return null;
  if (weeks.current_week == null) return `Not started · ${total} weeks`;
  return `Week ${weeks.current_week} of ${total}`;
}

// ── Founder states ───────────────────────────────────────────────────────

/**
 * The five states, in the order the advisor should look at them. The `glyph`
 * is a shape so a state never depends on colour alone (C1: "words and shapes,
 * not colours").
 */
export const FOUNDER_STATES = {
  failed: { label: 'Failed', glyph: '✕', tone: 'danger', rank: 0, attention: true },
  grace: { label: 'Grace', glyph: '◐', tone: 'warn', rank: 1, attention: true },
  at_risk: { label: 'At risk', glyph: '▲', tone: 'warn', rank: 2, attention: true },
  not_assessed: { label: 'Not assessed', glyph: '○', tone: 'neutral', rank: 3, attention: false },
  on_track: { label: 'On track', glyph: '✓', tone: 'ok', rank: 4, attention: false },
};

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** At risk is close to the deadline with work outstanding, or under half done. */
const AT_RISK_HOURS = 48;

function windowFor(weeks, n) {
  return (weeks?.weeks || []).find((w) => Number(w.week_number) === Number(n)) || null;
}

/**
 * One founder's state from the Lab's week record.
 *
 * `founder` is a `/weeks` founder (`{user_id, name, weeks: {n: row}}`) or
 * undefined when the Lab has no rows for them; `weeks` is the `/weeks` payload.
 */
export function founderState(founder, weeks, now = Date.now()) {
  const rows = founder?.weeks || {};
  const numbers = Object.keys(rows).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  const current = weeks?.windows_recorded ? (weeks.current_week ?? null) : null;

  const failedAt = numbers.find((n) => rows[n]?.status === 'failed');
  if (failedAt != null) {
    const r = rows[failedAt];
    const done = num(r.deliverables_done);
    const req = num(r.deliverables_required);
    return {
      state: 'failed', week: failedAt, held: true,
      done, required: req, pct: pctOf(done, req),
      reason: `Week ${failedAt} failed${req ? `: ${done ?? 0} of ${req} deliverables` : ''}`
        + (r.decision_reason ? ` — ${r.decision_reason}` : ''),
      deadline: null,
      date: r.decided_at || windowFor(weeks, failedAt)?.deadline_at || null,
    };
  }

  const graceAt = numbers.find((n) => rows[n]?.status === 'grace');
  if (graceAt != null) {
    const r = rows[graceAt];
    const done = num(r.deliverables_done);
    const req = num(r.deliverables_required);
    const until = r.grace_until || null;
    return {
      state: 'grace', week: graceAt, held: graceAt !== current,
      done, required: req, pct: pctOf(done, req),
      reason: `Week ${graceAt} in grace${until ? ` until ${dayTime(until)}` : ''}`
        + (req ? ` — ${done ?? 0} of ${req} deliverables` : '')
        + (r.grace_reason ? ` (${r.grace_reason})` : ''),
      deadline: until,
      date: until,
    };
  }

  if (current == null) {
    return {
      state: 'not_assessed', week: null, held: false, done: null, required: null, pct: null,
      reason: weeks?.windows_recorded ? 'No week of this cohort has opened yet' : 'No week windows are recorded for this cohort',
      deadline: null, date: null,
    };
  }
  const r = rows[current];
  const deadline = windowFor(weeks, current)?.deadline_at || null;
  if (!r) {
    return {
      state: 'not_assessed', week: current, held: false, done: null, required: null, pct: null,
      reason: `The Lab has no week ${current} record for this founder`, deadline, date: deadline,
    };
  }
  const done = num(r.deliverables_done);
  const req = num(r.deliverables_required);
  const pct = pctOf(done, req);
  if (r.status === 'passed') {
    return { state: 'on_track', week: current, held: false, done, required: req, pct, reason: `Week ${current} passed`, deadline, date: r.decided_at || deadline };
  }
  if (pct == null) {
    return {
      state: 'not_assessed', week: current, held: false, done, required: req, pct: null,
      reason: req === 0 ? `No deliverable is required in week ${current}` : `Week ${current} progress could not be read`,
      deadline, date: deadline,
    };
  }
  const hoursLeft = Number.isFinite(ms(deadline)) ? (ms(deadline) - now) / 3_600_000 : null;
  const outstanding = done < req;
  if (outstanding && (pct < 50 || (hoursLeft != null && hoursLeft <= AT_RISK_HOURS))) {
    const left = hoursLeft == null ? '' : hoursLeft <= 0 ? ', deadline passed' : hoursLeft < 24 ? ', under a day left' : `, ${Math.floor(hoursLeft / 24)} day${Math.floor(hoursLeft / 24) === 1 ? '' : 's'} left`;
    return {
      state: 'at_risk', week: current, held: false, done, required: req, pct,
      reason: `${done} of ${req} week-${current} deliverables${left}`, deadline, date: deadline,
    };
  }
  return {
    state: 'on_track', week: current, held: false, done, required: req, pct,
    reason: outstanding ? `${done} of ${req} week-${current} deliverables` : `All ${req} week-${current} deliverables in`,
    deadline, date: deadline,
  };
}

function pctOf(done, req) {
  if (done == null || req == null || req <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / req) * 100)));
}

/**
 * The founder rows the board and the table draw. `roster` is the founders read
 * (already filtered server-side for opt-outs and hidden founders); `weeks` may
 * be null when the week record could not be read, in which case every founder
 * is Not assessed — the roster is still true.
 */
export function founderRows(roster, weeks, now = Date.now()) {
  const byUser = new Map((weeks?.founders || []).map((f) => [Number(f.user_id), f]));
  const readable = weeks && weeks.available !== false;
  const why = weeks ? 'The Lab’s week record could not be read' : 'The Lab’s week record is not loaded';
  return (roster || []).map((f) => {
    const s = readable
      ? founderState(byUser.get(Number(f.user_id)), weeks, now)
      : { state: 'not_assessed', week: null, held: false, done: null, required: null, pct: null, reason: why, deadline: null, date: null };
    return { user_id: f.user_id, name: f.name || null, email: f.email || null, ...s, meta: FOUNDER_STATES[s.state] };
  });
}

export const needsAttention = (row) => Boolean(FOUNDER_STATES[row.state]?.attention);

/** The board's columns (C2). Failed and Grace always sit in Needs attention. */
export const BOARD_COLUMNS = [
  { key: 'attention', label: 'Needs attention', test: needsAttention },
  { key: 'on_track', label: 'On track', test: (r) => r.state === 'on_track' },
  { key: 'not_assessed', label: 'Not assessed', test: (r) => r.state === 'not_assessed' },
];

export const FOUNDER_SORTS = {
  attention: (a, b) => (FOUNDER_STATES[a.state].rank - FOUNDER_STATES[b.state].rank)
    || ((a.pct ?? 101) - (b.pct ?? 101)) || String(a.name || '').localeCompare(String(b.name || '')),
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
  progress: (a, b) => ((a.pct ?? -1) - (b.pct ?? -1)) || String(a.name || '').localeCompare(String(b.name || '')),
  deadline: (a, b) => ((Number.isFinite(ms(a.deadline)) ? ms(a.deadline) : Infinity)
    - (Number.isFinite(ms(b.deadline)) ? ms(b.deadline) : Infinity)) || String(a.name || '').localeCompare(String(b.name || '')),
};

/** Search by name or email, narrow by state, sort. Never mutates `rows`. */
export function filterFounders(rows, { q = '', state = 'all', sort = 'attention', founder = null } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const only = founder == null ? null : Number(founder);
  return (rows || [])
    .filter((r) => only == null || Number(r.user_id) === only)
    .filter((r) => !needle || `${r.name || ''} ${r.email || ''}`.toLowerCase().includes(needle))
    .filter((r) => state === 'all' || (state === 'attention' ? needsAttention(r) : r.state === state))
    .slice()
    .sort(FOUNDER_SORTS[sort] || FOUNDER_SORTS.attention);
}

// ── Cohort progress (four-week grid) ─────────────────────────────────────

export const CELL_STATES = {
  passed: { label: 'Passed', glyph: '✓' },
  in_progress: { label: 'In progress', glyph: '◷' },
  grace: { label: 'Grace', glyph: '◐' },
  failed: { label: 'Failed', glyph: '✕' },
  not_assessed: { label: 'Not assessed', glyph: '○' },
  not_open: { label: 'Not open', glyph: '·' },
  missing: { label: 'Missing data', glyph: '?' },
};

/**
 * One row per founder, one cell per week. `pending` in the open week is In
 * progress; `pending` in a past week, or no row in an opened week, is Not
 * assessed; a week that has not unlocked is Not open. No windows → Missing.
 */
export function progressGrid(roster, weeks, now = Date.now()) {
  const windows = weeks?.windows_recorded && Array.isArray(weeks.weeks) ? weeks.weeks : [];
  const byUser = new Map((weeks?.founders || []).map((f) => [Number(f.user_id), f]));
  const columns = windows.map((w) => Number(w.week_number));
  const current = weeks?.current_week ?? null;
  const rows = (roster || []).map((f) => {
    const rec = byUser.get(Number(f.user_id))?.weeks || {};
    const cells = windows.map((w) => {
      const n = Number(w.week_number);
      const opened = Number.isFinite(ms(w.unlock_at)) ? ms(w.unlock_at) <= now : (current != null && n <= current);
      if (!opened) return 'not_open';
      const r = rec[n];
      if (!r) return 'not_assessed';
      if (r.status === 'passed' || r.status === 'failed' || r.status === 'grace') return r.status;
      return n === current ? 'in_progress' : 'not_assessed';
    });
    return { user_id: f.user_id, name: f.name || null, cells };
  });
  const totals = columns.map((_, i) => {
    const t = {};
    for (const r of rows) t[r.cells[i]] = (t[r.cells[i]] || 0) + 1;
    return t;
  });
  return { columns, current, rows, totals, missing: windows.length === 0 };
}

// ── Needs your attention ─────────────────────────────────────────────────

const within = (iso, now, hours) => {
  const t = ms(iso);
  return Number.isFinite(t) && t >= now && t <= now + hours * 3_600_000;
};

/**
 * Everything that needs the advisor, most urgent first. Each item:
 * `{ key, kind, who, reason, date, state, action: { label, to } }`.
 *
 * Inputs may be null when their read failed; an absent input contributes no
 * items and is reported in `unknown` so the page can say the list is partial.
 */
export function attentionItems({ cycleId, cohortName, rows, guidance, calendar, now = Date.now() }) {
  const items = [];
  const unknown = [];
  const founderHref = (r) => withCohort('/cohorts/founders', cycleId, { founder: r.user_id });
  if (rows) {
    for (const r of rows.filter(needsAttention).sort(FOUNDER_SORTS.attention)) {
      items.push({
        key: `founder:${r.user_id}`, kind: 'founder', who: r.name || 'Founder (name not recorded)',
        reason: r.reason, date: r.date, state: r.state,
        action: { label: 'Open founder', to: founderHref(r) },
      });
    }
  } else unknown.push('founders');

  if (guidance) {
    const names = new Map((rows || []).map((r) => [Number(r.user_id), r.name]));
    const open = (guidance.items || [])
      .filter((g) => g.kind === 'question' && !g.answer && !g.retired_at)
      .sort((a, b) => (ms(a.posted_at) || 0) - (ms(b.posted_at) || 0));
    for (const g of open) {
      const name = names.get(Number(g.asked_by_user_id));
      const text = String(g.body || '').trim();
      items.push({
        key: `question:${g.uid}`, kind: 'question', who: name ? `Question from ${name}` : 'A founder’s question',
        reason: text.length > 140 ? `“${text.slice(0, 139)}…”` : `“${text}”`,
        date: g.posted_at, state: 'needs_response',
        action: { label: 'Answer', to: withCohort('/cohorts/guidance', cycleId) },
      });
    }
  } else unknown.push('guidance');

  if (calendar) {
    for (const it of (calendar.items || []).filter((i) => i.kind === 'client' && within(i.starts_at, now, 48))) {
      items.push({
        key: `session:${it.ref}`, kind: 'session', who: it.title,
        reason: 'Booked session in the next 48 hours', date: it.starts_at, state: 'upcoming',
        action: { label: 'Open calendar', to: withCohort('/cohorts/calendar', cycleId) },
      });
    }
    for (const it of (calendar.items || []).filter((i) => /^week:\d+:deadline$/.test(String(i.ref || '')) && within(i.starts_at, now, 72))) {
      items.push({
        key: `deadline:${it.ref}`, kind: 'deadline', who: cohortName || 'This cohort',
        reason: it.title, date: it.starts_at, state: 'deadline',
        action: { label: 'This week', to: withCohort('/cohorts/this-week', cycleId) },
      });
    }
  } else unknown.push('calendar');

  return { items, unknown };
}

/** The 7-day agenda from the calendar read: cohort windows, Demo Day and booked sessions. */
export function upcomingDays(calendar, now = Date.now(), days = 7) {
  if (!calendar) return null;
  const groups = new Map();
  for (const it of (calendar.items || []).filter((i) => within(i.starts_at, now, days * 24))) {
    const day = dayLabel(it.starts_at);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(it);
  }
  return [...groups.entries()].map(([day, list]) => ({ day, items: list }));
}

/**
 * Recent activity — ONLY what the guidance store records: what you posted,
 * what you answered, and which founders recorded acting on it. Submissions,
 * sessions held and Lab decisions have no activity feed (D4813: new backend),
 * so they are not reconstructed here.
 */
export function guidanceActivity(guidance, limit = 6) {
  if (!guidance) return null;
  const ev = [];
  for (const g of guidance.items || []) {
    const title = String(g.body || '').trim().slice(0, 60) + (String(g.body || '').trim().length > 60 ? '…' : '');
    if (g.kind !== 'question' && g.posted_at) ev.push({ at: g.posted_at, text: `You posted “${title}”` });
    if (g.kind === 'question' && g.answered_at) ev.push({ at: g.answered_at, text: `You answered “${title}”` });
    for (const a of g.acted_by || []) {
      if (a.acted_at) ev.push({ at: a.acted_at, text: `${a.name || 'A founder'} acted on “${title}”` });
    }
  }
  return ev.filter((e) => Number.isFinite(ms(e.at))).sort((a, b) => ms(b.at) - ms(a.at)).slice(0, limit);
}

/**
 * The four summary figures. `null` is unknown and is drawn as Not recorded; a
 * capped list is never presented as a total (`capped: true` draws "n+").
 */
export function summaryFigures({ roster, rosterTruncated, rows, weeksReadable, guidance, calendar, now = Date.now() }) {
  const sessions = calendar
    ? (calendar.items || []).filter((i) => i.kind === 'client' && within(i.starts_at, now, 7 * 24)).length
    : null;
  return {
    founders: roster ? { value: roster.length, capped: Boolean(rosterTruncated) } : { value: null },
    attention: rows && weeksReadable ? { value: rows.filter(needsAttention).length, capped: Boolean(rosterTruncated) } : { value: null },
    questions: guidance?.counts && Number.isFinite(Number(guidance.counts.open))
      ? { value: Number(guidance.counts.open), capped: Boolean(guidance.truncated) }
      : { value: null },
    sessions: sessions == null ? { value: null } : { value: sessions, capped: Boolean(calendar?.sessions_truncated) },
  };
}
