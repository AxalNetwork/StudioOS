/**
 * D946 (#2751) — THE SPIN-OUT LAB PARTICIPANTS READ: SL7's table and SL8's
 * drawer from one read, filtered, sorted and paged in the Worker.
 *
 * WHO IS A PARTICIPANT. `LAB_PARTICIPANT_WHERE`, the rule
 * `GET /api/admin/spinout-participants` has always used: admitted, active, or
 * graduated (the incorporation milestone). The 83(b) and formation desks'
 * `?scope=lab` filter uses the same rule, so "Lab ventures" there are the
 * founders listed here.
 *
 * EACH ROW'S WEEK IS THE FOUNDER'S GATE. The cycle is the one whose window
 * holds the founder's start, and the week, the deadline, grace and the freeze
 * come from `gateFromRows`, the arithmetic `getCohortGate` gives the founder's
 * own workspace. This week's outcome is:
 *   · `graduated` — the incorporation milestone is recorded;
 *   · `failed` — a week failed and the founder is paused at it;
 *   · `grace` — a week is in grace, until `grace_until`;
 *   · `on_track` / `at_risk` — this week's required items are all done, or not
 *     yet, by `evaluateWeekOutcome` with now as the cutoff (the cohort review's
 *     `at_risk` rule);
 *   · `not_in_cohort` — not active, or a start no cycle holds (a legacy founder).
 *
 * A READ THAT FAILED IS SAID, NEVER A ZERO. The participants list failing is a
 * 503. Each inner read (cycles and windows, week statuses, milestones,
 * moderation) that fails nulls only the fields it feeds, and the answer names
 * it in `unreadable`. A filter or sort on a field that could not be read is
 * refused as a 503 rather than answered from nothing.
 *
 * NAMES, NOT EMAILS. A row carries the founder's name and uid and the company,
 * as the canvas draws them; no email address leaves this read.
 */
import type { Env } from '../types';
import { evaluateWeekOutcome, gateFromRows, sqliteUtcToMs } from './cohortTiming';
import { MILESTONES, unlockedFeaturesThrough } from './spinoutLabCatalog';

/** Who is in the Lab: admitted, active, or graduated. One rule for every Lab read. */
export const LAB_PARTICIPANT_WHERE =
  "usf.spinout_lab_admitted = 1 OR u.spinout_lab_active = 1 "
  + "OR u.id IN (SELECT user_id FROM spinout_lab_milestones WHERE milestone_key = 'incorporation_completed')";

/** The user ids `LAB_PARTICIPANT_WHERE` selects, as a sub-select the desks filter on. */
export const LAB_PARTICIPANT_IDS =
  'SELECT u.id FROM users u LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id WHERE ' + LAB_PARTICIPANT_WHERE;

export const SPRINT_DAYS = 28;
/** The most participants one read considers; a full read says `truncated`. */
export const PARTICIPANTS_MAX = 5000;

export const THIS_WEEK = ['on_track', 'at_risk', 'grace', 'failed', 'graduated', 'not_in_cohort'] as const;
export type ThisWeek = typeof THIS_WEEK[number];
/** SL7's "Needs a decision": at risk, in grace, or a failed week. */
export const NEEDS_DECISION: readonly ThisWeek[] = ['at_risk', 'grace', 'failed'];
export const STATUSES = ['active', 'admitted', 'graduated'] as const;
export const SORTS = ['days_left', 'progress', 'cohort', 'name'] as const;

/** Every required item in the four weeks: `requiredAll`, plus one for each `requiredAny`. */
export const REQUIRED_ITEMS = MILESTONES.reduce((t, w) => t + w.requiredAll.length + ((w.requiredAny ?? []).length ? 1 : 0), 0);
const ALL_TOOLS = MILESTONES.flatMap((w) => w.unlockedFeatures);

export class LabReadError extends Error {
  status: 400 | 404 | 503;
  code: string;
  sentence: string;
  constructor(status: 400 | 404 | 503, code: string, sentence: string) {
    super(sentence);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

export type ParticipantQuery = {
  cohort: string | null; status: string | null; week: number | null; this_week: string | null;
  incorporated: 'yes' | 'no' | null; needs: boolean; q: string | null;
  sort: typeof SORTS[number]; limit: number; offset: number;
};

const COHORT_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The query, or the 400 to send. Every value is checked against its list; nothing reaches SQL. */
export function parseParticipantQuery(get: (k: string) => string | undefined):
  { ok: true; query: ParticipantQuery } | { ok: false; code: string; detail: string } {
  const bad = (code: string, detail: string) => ({ ok: false as const, code, detail });
  const cohort = get('cohort') || null;
  if (cohort && !COHORT_RE.test(cohort)) return bad('bad_cohort', 'cohort is YYYY-MM.');
  const status = get('status') || null;
  if (status && !(STATUSES as readonly string[]).includes(status)) return bad('bad_status', 'status is active, admitted or graduated.');
  const rawWeek = get('week');
  const week = rawWeek ? Number(rawWeek) : null;
  if (rawWeek && (!/^[1-4]$/.test(rawWeek))) return bad('bad_week', 'week is 1, 2, 3 or 4.');
  const thisWeek = get('this_week') || null;
  if (thisWeek && !(THIS_WEEK as readonly string[]).includes(thisWeek)) return bad('bad_this_week', `this_week is one of ${THIS_WEEK.join(', ')}.`);
  const inc = get('incorporated') || null;
  if (inc && inc !== 'yes' && inc !== 'no') return bad('bad_incorporated', 'incorporated is yes or no.');
  const needs = get('needs');
  if (needs && needs !== '1' && needs !== '0') return bad('bad_needs', 'needs is 1 or 0.');
  const q = (get('q') || '').trim() || null;
  if (q && q.length > 200) return bad('bad_q', 'q is at most 200 characters.');
  const sort = (get('sort') || 'days_left') as ParticipantQuery['sort'];
  if (!(SORTS as readonly string[]).includes(sort)) return bad('bad_sort', `sort is one of ${SORTS.join(', ')}.`);
  const rawLimit = get('limit');
  const rawOffset = get('offset');
  if ((rawLimit && !/^\d{1,3}$/.test(rawLimit)) || (rawOffset && !/^\d{1,7}$/.test(rawOffset))) return bad('bad_page', 'limit is 1 to 100, and offset a whole number.');
  const limit = rawLimit ? Number(rawLimit) : 25;
  if (limit < 1 || limit > 100) return bad('bad_page', 'limit is 1 to 100, and offset a whole number.');
  return {
    ok: true,
    query: {
      cohort, status, week, this_week: thisWeek, incorporated: inc as 'yes' | 'no' | null,
      needs: needs === '1', q, sort, limit, offset: rawOffset ? Number(rawOffset) : 0,
    },
  };
}

type Base = {
  id: number; uid: string | null; name: string | null; spinout_lab_admitted: number | null; spinout_lab_cohort: string | null;
  spinout_lab_active: number | null; spinout_lab_week: number | null; spinout_lab_started_at: string | null;
  is_incorporated: number | null; project_name: string | null; project_sector: string | null;
};
type Cycle = { id: number; year: number; month: number; start_at: string; end_at: string; status: string };
type Window = { cohort_cycle_id: number; week_number: number; unlock_at: string; deadline_at: string };
type WeekStatus = {
  user_id: number; cohort_cycle_id: number; week_number: number; status: string; grace_until: string | null;
  decided_at: string | null; decided_by: string | null;
};
type Milestone = { user_id: number; milestone_key: string; week: number; completed_at: string };
type Case = { user_id: number; status: string; opened_at: string };

type Inner<T> = { ok: true; rows: T[] } | { ok: false };
async function inner<T>(env: Env, sql: string, binds: unknown[], what: string): Promise<Inner<T>> {
  try {
    const r = await env.DB.prepare(sql).bind(...binds).all<T>();
    return { ok: true, rows: r.results || [] };
  } catch (e) {
    console.error('[lab-participants]', what, (e as Error)?.message);
    return { ok: false };
  }
}

const UNREADABLE = {
  cohorts: 'The cohort calendar could not be read, so each founder\'s week, deadline and outcome are not shown.',
  weeks: 'Week outcomes could not be read, so grace and failed weeks are not shown.',
  milestones: 'Milestones could not be read, so progress, missing items and this week\'s outcome are not shown.',
  moderation: 'Moderation cases could not be read, so whether a founder has an open case is not shown.',
} as const;
type Part = keyof typeof UNREADABLE;

/** Every participant, with the facts each row is built from. */
async function load(env: Env, nowMs: number, onlyUid?: string) {
  let base: Base[];
  try {
    const r = await env.DB.prepare(
      'SELECT u.id, u.uid, u.name, usf.spinout_lab_admitted, usf.spinout_lab_cohort, u.spinout_lab_active, u.spinout_lab_week, '
      + 'u.spinout_lab_started_at, u.is_incorporated, p.name AS project_name, p.sector AS project_sector '
      + 'FROM users u LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id '
      + 'LEFT JOIN projects p ON p.founder_id = u.founder_id '
      + 'WHERE (' + LAB_PARTICIPANT_WHERE + ') AND (? IS NULL OR u.uid = ?) '
      + 'ORDER BY u.id ASC, p.id ASC LIMIT ?',
    ).bind(onlyUid ?? null, onlyUid ?? null, PARTICIPANTS_MAX + 1).all<Base>();
    base = r.results || [];
  } catch (e) {
    console.error('[lab-participants] list', (e as Error)?.message);
    throw new LabReadError(503, 'lab_participants_unreadable', 'Lab participants could not be read. That is not the same as none.');
  }
  // Several projects per founder: the first, as the cohort tracker keeps it.
  // One row past the cap is read only to know the list goes on; it is not listed.
  const seen = new Set<number>();
  const truncated = base.length > PARTICIPANTS_MAX;
  const people = base.slice(0, PARTICIPANTS_MAX).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const ids = JSON.stringify(people.map((p) => p.id));
  const [cycles, windows, weeks, milestones, cases] = await Promise.all([
    inner<Cycle>(env, 'SELECT id, year, month, start_at, end_at, status FROM cohort_cycles', [], 'cycles'),
    inner<Window>(env, 'SELECT cohort_cycle_id, week_number, unlock_at, deadline_at FROM week_windows', [], 'windows'),
    inner<WeekStatus>(env,
      'SELECT user_id, cohort_cycle_id, week_number, status, grace_until, decided_at, decided_by FROM company_week_status '
      + 'WHERE user_id IN (SELECT value FROM json_each(?))', [ids], 'week statuses'),
    inner<Milestone>(env,
      'SELECT user_id, milestone_key, week, completed_at FROM spinout_lab_milestones '
      + 'WHERE user_id IN (SELECT value FROM json_each(?)) ORDER BY week ASC, completed_at ASC', [ids], 'milestones'),
    inner<Case>(env,
      "SELECT user_id, status, opened_at FROM spinout_moderation_cases WHERE resolved_at IS NULL "
      + "AND status IN ('under_review', 'suspended', 'ejected') AND user_id IN (SELECT value FROM json_each(?)) "
      + 'ORDER BY datetime(opened_at) DESC', [ids], 'moderation'),
  ]);
  const unreadable: Partial<Record<Part, string>> = {};
  if (!cycles.ok || !windows.ok) unreadable.cohorts = UNREADABLE.cohorts;
  if (!weeks.ok) unreadable.weeks = UNREADABLE.weeks;
  if (!milestones.ok) unreadable.milestones = UNREADABLE.milestones;
  if (!cases.ok) unreadable.moderation = UNREADABLE.moderation;
  return { people, truncated, cycles, windows, weeks, milestones, cases, unreadable, nowMs };
}

type Loaded = Awaited<ReturnType<typeof load>>;

const label = (c: Cycle) => `${c.year}-${String(c.month).padStart(2, '0')}`;

/** One founder's row, and the facts the drawer adds. */
function build(p: Base, L: Loaded) {
  const nowMs = L.nowMs;
  const started = sqliteUtcToMs(p.spinout_lab_started_at);
  const active = Number(p.spinout_lab_active ?? 0) === 1;
  const ms = L.milestones.ok ? L.milestones.rows.filter((m) => Number(m.user_id) === p.id) : null;
  const graduated = ms ? ms.some((m) => m.milestone_key === 'incorporation_completed') : null;
  const status = active ? 'active' : graduated === null ? null : graduated ? 'graduated' : 'admitted';
  const cycle = L.cycles.ok && started !== null
    ? [...L.cycles.rows].sort((a, b) => b.id - a.id).find((c) => {
      const s = sqliteUtcToMs(c.start_at); const e = sqliteUtcToMs(c.end_at);
      return s !== null && e !== null && s <= started && started < e;
    }) ?? null
    : null;
  const cohortsRead = L.cycles.ok && L.windows.ok;
  const inCohort = active && cycle !== null && cohortsRead;
  const myWeeks = L.weeks.ok && cycle ? L.weeks.rows.filter((w) => Number(w.user_id) === p.id && Number(w.cohort_cycle_id) === cycle.id) : [];
  const gate = inCohort && L.windows.ok && L.weeks.ok
    ? gateFromRows(L.windows.rows.filter((w) => Number(w.cohort_cycle_id) === cycle!.id), myWeeks, nowMs)
    : null;

  const completed = ms ? ms.map((m) => ({ key: m.milestone_key, completed_at_ms: sqliteUtcToMs(m.completed_at) ?? 0 })) : null;
  const progress = completed
    ? { done: MILESTONES.reduce((t, w) => t + evaluateWeekOutcome(w.week, completed, nowMs).doneCount, 0), required: REQUIRED_ITEMS }
    : null;

  const daysIn = started !== null ? Math.max(0, Math.floor((nowMs - started) / 86_400_000)) : null;
  const day = active && daysIn !== null ? Math.min(SPRINT_DAYS, daysIn + 1) : null;
  const daysLeft = active && daysIn !== null ? Math.max(0, SPRINT_DAYS - daysIn) : null;

  // This week's outcome: null when a read it needs failed.
  let thisWeek: ThisWeek | null = null;
  let missing: string[] | null = null;
  if (graduated === true) thisWeek = 'graduated';
  else if (!active || (cohortsRead && cycle === null)) thisWeek = graduated === null && !active ? null : 'not_in_cohort';
  else if (gate && completed) {
    if (gate.frozen) thisWeek = 'failed';
    else if (gate.weeks.some((w) => w.status === 'grace')) thisWeek = 'grace';
    else {
      const o = evaluateWeekOutcome(gate.current_week, completed, nowMs);
      thisWeek = o.passed ? 'on_track' : 'at_risk';
    }
    missing = evaluateWeekOutcome(gate.current_week, completed, nowMs).missing;
  }

  const openCase = L.cases.ok ? L.cases.rows.find((c) => Number(c.user_id) === p.id) ?? null : undefined;
  const row = {
    // D949: the account's id, which the grace, change-a-week and open-workspace
    // writes (admin_cohort.ts, admin.ts) are keyed by. It is not personal data.
    user_id: p.id,
    uid: p.uid ?? null,
    name: p.name ?? null,
    company: p.project_name ?? null,
    sector: p.project_sector ?? null,
    status,
    cohort: cycle ? label(cycle) : null,
    cohort_cycle_id: cycle ? cycle.id : null,
    started_at: p.spinout_lab_started_at ?? null,
    week: gate ? gate.current_week : null,
    day,
    days_left: daysLeft,
    paused: gate ? gate.frozen : null,
    progress,
    this_week: thisWeek,
    failed_week: gate?.frozen ? gate.frozen_week : null,
    deadline_at: gate ? gate.current_deadline_at : null,
    grace_until: gate ? gate.grace_until : null,
    missing,
    incorporated: Number(p.is_incorporated ?? 0) === 1,
    moderation: openCase === undefined ? undefined : openCase ? { state: openCase.status, since: openCase.opened_at } : null,
  };
  return { row, gate, ms, myWeeks, cycle };
}

function compare(sort: ParticipantQuery['sort']) {
  const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) =>
    a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : (a - b) * dir;
  const name = (x: { name: string | null }) => String(x.name ?? '').toLowerCase();
  return (a: ReturnType<typeof build>['row'], b: ReturnType<typeof build>['row']) => {
    let d = 0;
    if (sort === 'days_left') d = nullsLast(a.days_left, b.days_left, 1);
    else if (sort === 'progress') d = nullsLast(a.progress?.done ?? null, b.progress?.done ?? null, 1);
    else if (sort === 'cohort') d = String(b.cohort ?? '').localeCompare(String(a.cohort ?? '')) || (a.cohort === null ? 1 : 0) - (b.cohort === null ? 1 : 0);
    return d || name(a).localeCompare(name(b)) || String(a.uid).localeCompare(String(b.uid));
  };
}

/** GET /api/admin/cohort/participants — one page, its total, and how this cohort stands. */
export async function participantsPage(env: Env, q: ParticipantQuery, nowMs: number = Date.now()) {
  const L = await load(env, nowMs);
  // A filter or sort on a field whose read failed cannot be answered.
  if ((q.this_week || q.needs || q.week) && (L.unreadable.cohorts || L.unreadable.weeks || L.unreadable.milestones)) {
    throw new LabReadError(503, 'lab_participants_unreadable', 'This week\'s outcomes could not be read, so this filter cannot be answered. That is not the same as none.');
  }
  if (q.sort === 'progress' && L.unreadable.milestones) {
    throw new LabReadError(503, 'lab_participants_unreadable', 'Milestones could not be read, so participants cannot be sorted by progress.');
  }
  const all = L.people.map((p) => build(p, L).row);
  const needle = q.q?.toLowerCase() ?? null;
  const base = all.filter((r) =>
    (!q.cohort || r.cohort === q.cohort)
    && (!q.status || r.status === q.status)
    && (!q.week || r.week === q.week)
    && (!q.incorporated || r.incorporated === (q.incorporated === 'yes'))
    && (!needle || `${r.name ?? ''} ${r.company ?? ''}`.toLowerCase().includes(needle)));
  // "Where [cohort] stands" and the two toggles count the rows every other filter keeps.
  const standing = Object.fromEntries(THIS_WEEK.map((k) => [k, 0])) as Record<ThisWeek, number>;
  let unknown = 0;
  for (const r of base) { if (r.this_week) standing[r.this_week] += 1; else unknown += 1; }
  const filtered = base.filter((r) => (!q.this_week || r.this_week === q.this_week)
    && (!q.needs || (r.this_week !== null && NEEDS_DECISION.includes(r.this_week))));
  filtered.sort(compare(q.sort));
  return {
    available: true as const,
    as_of: new Date(nowMs).toISOString(),
    timezone: 'America/New_York',
    items: filtered.slice(q.offset, q.offset + q.limit),
    total: filtered.length,
    limit: q.limit,
    offset: q.offset,
    sort: q.sort,
    filters: { cohort: q.cohort, status: q.status, week: q.week, this_week: q.this_week, incorporated: q.incorporated, needs: q.needs, q: q.q },
    standing: {
      ...standing,
      everyone: base.length,
      needs_decision: NEEDS_DECISION.reduce((t, k) => t + standing[k], 0),
      ...(unknown ? { not_read: unknown } : {}),
    },
    required_items: REQUIRED_ITEMS,
    truncated: L.truncated,
    ...(Object.keys(L.unreadable).length ? { unreadable: L.unreadable } : {}),
    definitions: {
      this_week: 'The Lab\'s clock decides each week at its deadline. Until then a founder with every required item done is on track, and one without is at risk.',
      progress: `Required items done across the four weeks, of ${REQUIRED_ITEMS}. One of a week's "any of" items counts once.`,
      deadline_at: 'The deadline of the week the founder is held at, in UTC; it reads at 00:00 ET, inclusive.',
      missing: 'This week\'s required items not done yet, as milestone keys; "any_of:a|b" needs one of them.',
    },
  };
}

/** GET /api/admin/cohort/participants/:uid — SL8's drawer: the row, the weeks, the tools, the case and the history. */
export async function participantDetail(env: Env, uid: string, nowMs: number = Date.now()) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) throw new LabReadError(404, 'not_a_participant', 'No Lab participant has that uid.');
  const L = await load(env, nowMs, uid);
  const p = L.people[0];
  if (!p) throw new LabReadError(404, 'not_a_participant', 'No Lab participant has that uid.');
  const b = build(p, L);
  const tools = b.gate || b.row.status === 'graduated'
    ? unlockedFeaturesThrough(b.row.status === 'graduated' ? 4 : b.gate!.max_week)
    : b.row.status === 'active' && L.unreadable.cohorts ? null : [];
  // The week decisions, newest first. `by` is the Lab's clock or an admin, never a name.
  const history = L.weeks.ok
    ? b.myWeeks.filter((w) => w.decided_at).map((w) => ({
      at: w.decided_at, week: Number(w.week_number), status: w.status,
      by: String(w.decided_by ?? '').startsWith('admin') ? 'admin' : 'clock',
    })).sort((x, y) => (sqliteUtcToMs(y.at) ?? 0) - (sqliteUtcToMs(x.at) ?? 0))
    : null;
  return {
    available: true as const,
    as_of: new Date(nowMs).toISOString(),
    participant: b.row,
    weeks: b.gate
      ? b.gate.weeks.map((w) => ({
        ...w,
        // Each required item, done or not; null when the milestones could not be read.
        required: b.ms
          ? evaluateWeekOutcome(w.week, b.ms.map((m) => ({ key: m.milestone_key, completed_at_ms: sqliteUtcToMs(m.completed_at) ?? 0 })), nowMs).snapshot
          : null,
      }))
      : null,
    tools: tools === null ? null : { unlocked: tools, total: ALL_TOOLS.length, all: ALL_TOOLS },
    history,
    ...(Object.keys(L.unreadable).length ? { unreadable: L.unreadable } : {}),
  };
}
