/**
 * D358 — the Profiling v2 evolution loop (documentation/architecture/
 * PROFILING_V2.md §7; Session 13 of the programme).
 *
 * Session 7 (D357) made a profile a pure function of the answer ledger, the
 * evidence and the date, and gave it one entry point, `recomputeProfile`.
 * This module makes profiles MOVE as people use the platform:
 *
 *   evaluateUser        the one call every trigger goes through: recompute,
 *                       record a displayed-archetype change once, and stamp
 *                       when the person was last evaluated.
 *   runProfileEvolutionTick
 *                       the nightly run (03:00–03:59 UTC, on the every-minute
 *                       ticker): Session 8's evidence pass once a day, then
 *                       every person with something new — evidence, a
 *                       hysteresis clock running, an engine bump, or a month
 *                       since their last evaluation. Bounded per tick,
 *                       resumable across ticks and nights, idempotent.
 *   reaskOverlay        makes an answer at least six months old askable again
 *                       ("is this still true?"), only once every unanswered
 *                       profiling question has been offered (§7.3).
 *   profilingTrends     the admin read: counts only, small cells suppressed.
 *
 * A person's history is theirs. Nothing here returns another person's
 * answers, archetype or timeline; the admin read is aggregates with every
 * count under SMALL_CELL_MIN hidden.
 */
import type { Env } from '../types';
import { FIT_ID_RE, questionById, type Question } from './advisor/questionBank.ts';
import { selectAdaptiveProfiling } from './advisor/profilingModules.ts';
import {
  ARCHETYPES_PROFILE_V2,
  ENGINE_VERSION,
  PROFILE_V2_PARAMS,
  answerTimeMs,
  dayOf,
  latestAnswers,
} from './archetypeScoring.ts';
import {
  loadLedger,
  recomputeProfile,
  type RecomputeResult,
  type SnapshotTrigger,
} from './profileHistory.ts';
import { recomputeEvidenceBatch } from './skillEvidence.ts';
import { RADAR_AXES } from './skillsTaxonomySchema.ts';
import { notify } from './notify.ts';

const DAY_MS = 86_400_000;

/** The nightly run's hour (UTC) — the existing daily 03:00 slot. */
export const NIGHTLY_HOUR_UTC = 3;
/** Minutes of that hour already taken by heavier jobs (index recompute, history prune). */
export const NIGHTLY_SKIP_MINUTES: ReadonlySet<number> = new Set([15, 45]);
/** People evaluated per tick. ~29 profile ticks a night → ~580 people; the rest carry over. */
export const PROFILE_BATCH = 20;
/** Session 8 evidence users per tick (each reads ~21 sources). */
export const EVIDENCE_BATCH = 10;
/** A person is re-evaluated at least this often, so slow drift from ageing lands. */
export const REFRESH_AFTER_DAYS = 30;
/** Admin trends hide any count below this (owner's decision, 2026-09-29). */
export const SMALL_CELL_MIN = 5;

const PERSONAS = ['founder', 'investor', 'partner', 'advisor', 'coach'] as const;

function labelFor(persona: string, slug: string | null): string | null {
  if (!slug) return null;
  const set = (ARCHETYPES_PROFILE_V2 as Record<string, { slug: string; label: string }[]>)[persona] || [];
  return set.find((a) => a.slug === slug)?.label ?? slug;
}

// ---------------------------------------------------------------------------
// Change events + the one evaluation path
// ---------------------------------------------------------------------------

export interface ChangeEvent {
  persona: string;
  from_slug: string;
  to_slug: string;
  changed_on: string;
  trigger: SnapshotTrigger;
}

export interface EvolutionDeps {
  /** In-app notification; default services/notify. Tests pass a spy. */
  notify?: (env: Env, args: Parameters<typeof notify>[1]) => Promise<unknown>;
}

/**
 * §7.7 — for each persona whose DISPLAYED archetype changed in this recompute
 * (not the first classification, not a computed-only flip), append one
 * change event and, when that insert is the first for the change, send one
 * in-app notification. The UNIQUE key makes two racing recomputes record and
 * notify once.
 */
export async function recordChangeEvents(
  env: Env,
  userId: number,
  trigger: SnapshotTrigger,
  results: readonly RecomputeResult[],
  now: Date,
  deps: EvolutionDeps = {},
): Promise<ChangeEvent[]> {
  const out: ChangeEvent[] = [];
  for (const r of results) {
    const from = r.previous_displayed_slug;
    const to = r.profile.displayed_slug;
    if (!r.displayed_changed || !from || !to || from === to) continue;
    const changedOn = r.profile.hysteresis.displayed_since ?? dayOf(now.getTime());
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO profile_change_events
         (user_id, persona, from_slug, to_slug, changed_on, trigger_kind, engine_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(userId, r.persona, from, to, changedOn, trigger, r.profile.engine_version).run();
    if (Number(ins.meta?.changes ?? 0) !== 1) continue;
    const event: ChangeEvent = { persona: r.persona, from_slug: from, to_slug: to, changed_on: changedOn, trigger };
    out.push(event);
    const toLabel = labelFor(r.persona, to);
    const fromLabel = labelFor(r.persona, from);
    try {
      await (deps.notify ?? notify)(env, {
        userId,
        type: 'profile.archetype_changed',
        title: `Your archetype is now ${toLabel}`,
        body: `It was ${fromLabel}. Your answers and your work on the platform now point to ${toLabel}.`,
        link: '/studio/archetype',
        channels: ['in_app'],
        category: 'scoring',
        payload: { persona: r.persona, from: from, to: to, changed_on: changedOn },
      });
    } catch (e) {
      console.warn('[profile-evolution] notification failed', (e as Error).message);
    }
    // The person's own activity trail. The archetype itself stays out of the
    // log: admins see aggregates only (§7.9).
    try {
      await env.DB.prepare(
        `INSERT INTO activity_logs (user_id, action, details, actor) VALUES (?, 'profile.archetype_changed', ?, 'system')`,
      ).bind(userId, JSON.stringify({ persona: r.persona, trigger })).run();
    } catch (e) {
      console.warn('[profile-evolution] activity log failed', (e as Error).message);
    }
  }
  return out;
}

async function markEvaluated(env: Env, userId: number, trigger: SnapshotTrigger, now: Date): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO profile_evolution_state (user_id, last_evaluated_at, last_trigger, engine_version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         last_evaluated_at = excluded.last_evaluated_at,
         last_trigger = excluded.last_trigger,
         engine_version = excluded.engine_version`,
    ).bind(userId, now.toISOString(), trigger, ENGINE_VERSION).run();
  } catch (e) {
    // Before migration 364: the recompute already happened; only the
    // nightly bookkeeping is missing.
    console.warn('[profile-evolution] state not recorded', (e as Error).message);
  }
}

/**
 * The single path every trigger takes (§7.8): the advisor /answer route with
 * 'answer', the nightly run with 'evidence' / 'scheduled' / 'engine_bump'.
 */
export async function evaluateUser(
  env: Env,
  userId: number,
  trigger: SnapshotTrigger,
  now: Date = new Date(),
  deps: EvolutionDeps = {},
): Promise<{ results: RecomputeResult[]; events: ChangeEvent[] }> {
  const results = await recomputeProfile(env, userId, { trigger, asOf: now.toISOString() });
  let events: ChangeEvent[] = [];
  try {
    events = await recordChangeEvents(env, userId, trigger, results, now, deps);
  } catch (e) {
    console.warn('[profile-evolution] change events not recorded', (e as Error).message);
  }
  await markEvaluated(env, userId, trigger, now);
  return { results, events };
}

// ---------------------------------------------------------------------------
// The nightly run
// ---------------------------------------------------------------------------

/**
 * Why (if at all) the nightly run should evaluate this person now. Pure over
 * what it is given, so the rules are testable without a database.
 */
export function dueReason(input: {
  state: { last_evaluated_at: string; engine_version: string } | null;
  evidenceComputedAt: string | null;
  pendingHysteresis: boolean;
  nowMs: number;
}): SnapshotTrigger | null {
  const { state } = input;
  if (!state) return 'scheduled';
  if (state.engine_version !== ENGINE_VERSION) return 'engine_bump';
  if (input.evidenceComputedAt && input.evidenceComputedAt > state.last_evaluated_at) return 'evidence';
  if (input.pendingHysteresis) return 'scheduled';
  const last = Date.parse(state.last_evaluated_at);
  if (!Number.isFinite(last) || input.nowMs - last >= REFRESH_AFTER_DAYS * DAY_MS) return 'scheduled';
  return null;
}

async function dueTrigger(env: Env, userId: number, nowMs: number): Promise<SnapshotTrigger | null> {
  const state = await env.DB.prepare(
    'SELECT last_evaluated_at, engine_version FROM profile_evolution_state WHERE user_id = ?',
  ).bind(userId).first<{ last_evaluated_at: string; engine_version: string }>();
  let evidenceComputedAt: string | null = null;
  try {
    const ev = await env.DB.prepare('SELECT MAX(computed_at) AS at FROM skill_evidence WHERE user_id = ?')
      .bind(userId).first<{ at: string | null }>();
    evidenceComputedAt = ev?.at ?? null;
  } catch { /* no evidence store: nothing new from it */ }
  const latest = await env.DB.prepare(
    `SELECT hysteresis_json FROM profile_snapshots
      WHERE id IN (SELECT MAX(id) FROM profile_snapshots WHERE user_id = ? GROUP BY persona)`,
  ).bind(userId).all<{ hysteresis_json: string | null }>();
  const pendingHysteresis = (latest.results || []).some((r) => {
    try { return !!(r.hysteresis_json && JSON.parse(r.hysteresis_json)?.pending); } catch { return false; }
  });
  return dueReason({ state: state ?? null, evidenceComputedAt, pendingHysteresis, nowMs });
}

type Cursor = {
  last_user_id: number;
  pass_started_on: string | null;
  pass_completed_on: string | null;
  evidence_completed_on: string | null;
};

async function readCursor(env: Env): Promise<Cursor> {
  const r = await env.DB.prepare(
    `SELECT last_user_id, pass_started_on, pass_completed_on, evidence_completed_on
       FROM profile_evolution_cursor WHERE id = 1`,
  ).first<Cursor>();
  return r ?? { last_user_id: 0, pass_started_on: null, pass_completed_on: null, evidence_completed_on: null };
}

async function writeCursor(env: Env, c: Cursor, now: Date): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO profile_evolution_cursor (id, last_user_id, pass_started_on, pass_completed_on, evidence_completed_on, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       last_user_id = excluded.last_user_id,
       pass_started_on = excluded.pass_started_on,
       pass_completed_on = excluded.pass_completed_on,
       evidence_completed_on = excluded.evidence_completed_on,
       updated_at = excluded.updated_at`,
  ).bind(c.last_user_id, c.pass_started_on, c.pass_completed_on, c.evidence_completed_on, now.toISOString()).run();
}

export interface TickResult {
  stage: 'evidence' | 'profiles' | 'idle';
  processed: number;
  evaluated: number;
  failed: number;
  events: number;
  pass_complete: boolean;
}

/** Is this minute one of the nightly run's ticks? */
export function isNightlyTick(now: Date): boolean {
  return now.getUTCHours() === NIGHTLY_HOUR_UTC && !NIGHTLY_SKIP_MINUTES.has(now.getUTCMinutes());
}

/**
 * One tick of the nightly run. Even minutes serve Session 8's evidence pass
 * and odd minutes the profile pass, so a large evidence pass never starves
 * the profiles; once one stage is done for the day, the other gets every
 * tick. Each stage runs at most one complete pass per UTC day; a pass that
 * does not finish tonight resumes tomorrow where it stopped.
 */
export async function runProfileEvolutionTick(
  env: Env,
  now: Date = new Date(),
  opts: {
    profileBatch?: number;
    evidenceBatch?: number;
    /** Default evaluateUser; tests pass one that fails for a chosen person. */
    evaluate?: typeof evaluateUser;
  } & EvolutionDeps = {},
): Promise<TickResult> {
  const today = dayOf(now.getTime());
  const cursor = await readCursor(env);
  const evidenceDue = cursor.evidence_completed_on !== today;
  const profilesDue = cursor.pass_completed_on !== today;
  const idle: TickResult = { stage: 'idle', processed: 0, evaluated: 0, failed: 0, events: 0, pass_complete: false };
  if (!evidenceDue && !profilesDue) return idle;
  const evidenceTurn = evidenceDue && (!profilesDue || now.getUTCMinutes() % 2 === 0);

  if (evidenceTurn) {
    const r = await recomputeEvidenceBatch(env, { limit: opts.evidenceBatch ?? EVIDENCE_BATCH, now });
    if (r.pass_complete) await writeCursor(env, { ...cursor, evidence_completed_on: today }, now);
    return { stage: 'evidence', processed: r.processed, evaluated: 0, failed: 0, events: 0, pass_complete: r.pass_complete };
  }

  const limit = Math.max(1, Math.min(200, Math.floor(opts.profileBatch ?? PROFILE_BATCH)));
  const after = Number(cursor.last_user_id || 0);
  const users = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM advisor_answers
      WHERE user_id > ? AND saved_status = 'saved' AND question_id LIKE 'fit.%'
      ORDER BY user_id
      LIMIT ?`,
  ).bind(after, limit).all<{ user_id: number }>();
  const ids = (users.results || []).map((u) => Number(u.user_id));
  let evaluated = 0;
  let failed = 0;
  let events = 0;
  for (const id of ids) {
    try {
      const why = await dueTrigger(env, id, now.getTime());
      if (!why) continue;
      const r = await (opts.evaluate ?? evaluateUser)(env, id, why, now, opts);
      evaluated += 1;
      events += r.events.length;
    } catch (e) {
      // One person's failure never stops the batch, and the log carries no
      // profile content.
      failed += 1;
      console.warn('[profile-evolution] evaluation failed', (e as Error).name);
    }
  }
  const passComplete = ids.length < limit;
  await writeCursor(env, {
    ...cursor,
    last_user_id: passComplete ? 0 : ids[ids.length - 1],
    pass_started_on: after === 0 ? today : (cursor.pass_started_on ?? today),
    pass_completed_on: passComplete ? today : cursor.pass_completed_on,
  }, now);
  return { stage: 'profiles', processed: ids.length, evaluated, failed, events, pass_complete: passComplete };
}

// ---------------------------------------------------------------------------
// Re-asking (§7.3)
// ---------------------------------------------------------------------------

/** The wording a re-asked question uses: the item's own, else a plain frame around the prompt. */
export function reaskPrompt(q: Pick<Question, 'prompt' | 'reask_prompt'>): string {
  const own = typeof q.reask_prompt === 'string' ? q.reask_prompt.trim() : '';
  return own || `It has been a while since you answered this. Is it still true? ${q.prompt}`;
}

/**
 * Pure: which of `ids` are re-askable at `nowMs`. A question is re-askable
 * when its latest answer is at least reask_after_days old — unless it was
 * already put to the person again after that answer and they left it
 * unanswered, in which case it rests for another reask_after_days. `keepId`
 * (the question currently on screen) is exempt from that rest, so a refresh
 * shows the same question.
 */
export function reaskableIds(
  ids: Iterable<string>,
  latestAnswerAt: ReadonlyMap<string, number>,
  lastAskedAt: ReadonlyMap<string, number>,
  nowMs: number,
  keepId?: string | null,
): Set<string> {
  const window = PROFILE_V2_PARAMS.reask_after_days * DAY_MS;
  const out = new Set<string>();
  for (const id of ids) {
    const at = latestAnswerAt.get(id);
    if (at === undefined || nowMs - at < window) continue;
    const asked = lastAskedAt.get(id);
    if (id !== keepId && asked !== undefined && asked > at && nowMs - asked < window) continue;
    out.add(id);
  }
  return out;
}

/** The person's latest answer time per fit question, and when each was last put to them. */
export async function loadReaskInputs(env: Env, userId: number, nowMs: number): Promise<{
  latestAnswerAt: Map<string, number>;
  lastAskedAt: Map<string, number>;
}> {
  const latestAnswerAt = new Map<string, number>();
  for (const [id, a] of latestAnswers(await loadLedger(env, userId), nowMs)) {
    const t = answerTimeMs(a.answered_at);
    if (Number.isFinite(t)) latestAnswerAt.set(id, t);
  }
  const lastAskedAt = new Map<string, number>();
  try {
    const res = await env.DB.prepare(
      `SELECT question_id, last_asked_at FROM advisor_state WHERE user_id = ? AND question_id LIKE 'fit.%'`,
    ).bind(userId).all<{ question_id: string; last_asked_at: string }>();
    for (const r of res.results || []) {
      const t = answerTimeMs(r.last_asked_at);
      if (Number.isFinite(t)) lastAskedAt.set(r.question_id, t);
    }
  } catch { /* no advisor_state: nothing was asked */ }
  return { latestAnswerAt, lastAskedAt };
}

/**
 * Put re-askable profiling questions back in front of Eadwyn's ranker.
 * Applied at every selection path of routes/advisor.ts, after selectBank:
 *   - only once no unanswered profiling question is left to offer
 *     (selectAdaptiveProfiling is empty) — re-asks come after uncovered ones;
 *   - the returned bank carries the re-ask wording on those questions;
 *   - the returned `answered` omits them, so the ranker may pick them. Module
 *     confidence is still computed from the caller's own `answered`: a
 *     re-askable answer keeps counting (§7.3: re-askability never changes a
 *     score).
 * Nothing is written.
 */
export async function reaskOverlay(
  env: Env,
  userId: number,
  bank: Question[],
  answered: Set<string>,
  opts: { keepId?: string | null; nowMs?: number } = {},
): Promise<{ bank: Question[]; answered: Set<string>; reask: Set<string> }> {
  const same = { bank, answered, reask: new Set<string>() };
  const fitIds = bank.filter((q) => FIT_ID_RE.test(q.id) && !q.retired).map((q) => q.id);
  if (!fitIds.length) return same;
  if (selectAdaptiveProfiling(bank, answered).length > 0) return same;
  const nowMs = opts.nowMs ?? Date.now();
  let reask: Set<string>;
  try {
    const inputs = await loadReaskInputs(env, userId, nowMs);
    reask = reaskableIds(fitIds, inputs.latestAnswerAt, inputs.lastAskedAt, nowMs, opts.keepId);
  } catch (e) {
    console.warn('[profile-evolution] re-ask inputs unreadable', (e as Error).message);
    return same;
  }
  if (!reask.size) return same;
  return {
    bank: bank.map((q) => (reask.has(q.id) ? { ...q, prompt: reaskPrompt(q) } : q)),
    answered: new Set([...answered].filter((id) => !reask.has(id))),
    reask,
  };
}

/**
 * GET /api/profile/reask — the caller's own re-askable answers (a read-only
 * peek, like /advisor/queue): every profiling question they answered at
 * least reask_after_days ago, whatever the queue is currently offering.
 */
export async function reaskList(env: Env, userId: number, nowMs: number = Date.now()) {
  const inputs = await loadReaskInputs(env, userId, nowMs);
  const ids = [...inputs.latestAnswerAt.keys()].filter((id) => FIT_ID_RE.test(id));
  const due = reaskableIds(ids, inputs.latestAnswerAt, new Map(), nowMs);
  const items = [...due]
    .map((id) => ({ id, q: questionById(id), at: inputs.latestAnswerAt.get(id)! }))
    .filter((x) => x.q && !x.q.retired)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .slice(0, 100)
    .map((x) => {
      const asked = inputs.lastAskedAt.get(x.id);
      const resting = asked !== undefined && asked > x.at
        && nowMs - asked < PROFILE_V2_PARAMS.reask_after_days * DAY_MS;
      return {
        question_id: x.id,
        prompt: reaskPrompt(x.q!),
        answered_at: new Date(x.at).toISOString(),
        age_days: Math.floor((nowMs - x.at) / DAY_MS),
        resting_until: resting ? new Date(asked! + PROFILE_V2_PARAMS.reask_after_days * DAY_MS).toISOString() : null,
      };
    });
  return { reask_after_days: PROFILE_V2_PARAMS.reask_after_days, count: due.size, items };
}

// ---------------------------------------------------------------------------
// Admin trends (aggregates only)
// ---------------------------------------------------------------------------

export interface Cell { count: number | null; suppressed: boolean }

/**
 * Hide every count in 1..min−1, and — when that leaves exactly one hidden
 * non-zero cell in a group whose total could be worked out — hide the next
 * smallest too, so no hidden cell can be recovered by subtraction.
 * Returns the cells and whether the group's total may be shown.
 */
export function suppressGroup(counts: readonly number[], min: number = SMALL_CELL_MIN): { cells: Cell[]; totalShown: boolean } {
  const hidden = counts.map((n) => n > 0 && n < min);
  if (hidden.filter(Boolean).length === 1) {
    let best = -1;
    counts.forEach((n, i) => {
      if (!hidden[i] && n > 0 && (best < 0 || n < counts[best])) best = i;
    });
    if (best >= 0) hidden[best] = true;
  }
  // A lone hidden cell with no partner is the whole group, so its total is
  // under `min` too: the total check below covers it.
  const total = counts.reduce((s, n) => s + n, 0);
  return {
    cells: counts.map((n, i) => ({ count: hidden[i] ? null : n, suppressed: hidden[i] })),
    totalShown: total >= min,
  };
}

function one(n: number, min: number = SMALL_CELL_MIN): Cell {
  return n > 0 && n < min ? { count: null, suppressed: true } : { count: n, suppressed: false };
}

function monthsBack(now: Date, months: number): { month: string; endIso: string }[] {
  const out: { month: string; endIso: string }[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = months - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(y, m - i, 1));
    const end = new Date(Math.min(Date.UTC(y, m - i + 1, 1) - 1, now.getTime()));
    out.push({ month: start.toISOString().slice(0, 7), endIso: end.toISOString() });
  }
  return out;
}

const SKILL_STATES = ['not_recorded', 'self_rated_only', 'some_evidence', 'corroborated', 'evidence_only'] as const;

/**
 * The admin trends read (§7.9): archetype distribution per role per month,
 * displayed-archetype changes per month (and their share of profiles),
 * skill-axis coverage today (self-rated vs evidence), and answers revised per
 * month. Counts only; no field names or identifies a person.
 */
export async function profilingTrends(env: Env, opts: { now?: Date; months?: number; min?: number } = {}) {
  const now = opts.now ?? new Date();
  const months = Math.max(1, Math.min(24, Math.floor(opts.months ?? 12)));
  const min = opts.min ?? SMALL_CELL_MIN;
  const span = monthsBack(now, months);

  const distribution: {
    month: string;
    persona: string;
    profiles: Cell;
    archetypes: { slug: string; label: string; count: number | null; suppressed: boolean }[];
  }[] = [];
  const profilesByKey = new Map<string, { n: number; shown: boolean }>();
  for (const { month, endIso } of span) {
    const res = await env.DB.prepare(
      `SELECT s.persona AS persona, s.displayed_slug AS slug, COUNT(*) AS n
         FROM profile_snapshots s
         JOIN (SELECT MAX(id) AS id FROM profile_snapshots WHERE computed_at <= ? GROUP BY user_id, persona) m
           ON m.id = s.id
        WHERE s.displayed_slug IS NOT NULL
        GROUP BY s.persona, s.displayed_slug`,
    ).bind(endIso).all<{ persona: string; slug: string; n: number }>();
    const rows = res.results || [];
    for (const persona of PERSONAS) {
      const set = (ARCHETYPES_PROFILE_V2 as Record<string, { slug: string; label: string }[]>)[persona] || [];
      const counts = set.map((a) => Number(rows.find((r) => r.persona === persona && r.slug === a.slug)?.n ?? 0));
      const total = counts.reduce((s, n) => s + n, 0);
      if (total === 0) continue;
      const g = suppressGroup(counts, min);
      profilesByKey.set(`${month}|${persona}`, { n: total, shown: g.totalShown });
      distribution.push({
        month,
        persona,
        profiles: g.totalShown ? { count: total, suppressed: false } : { count: null, suppressed: true },
        archetypes: set.map((a, i) => ({ slug: a.slug, label: a.label, ...g.cells[i] })),
      });
    }
  }

  const sinceDay = `${span[0].month}-01`;
  const ev = await env.DB.prepare(
    `SELECT substr(changed_on, 1, 7) AS month, persona, COUNT(*) AS n
       FROM profile_change_events
      WHERE changed_on >= ?
      GROUP BY substr(changed_on, 1, 7), persona`,
  ).bind(sinceDay).all<{ month: string; persona: string; n: number }>();
  const changes = (ev.results || [])
    .map((r) => {
      const n = Number(r.n);
      const cell = one(n, min);
      const base = profilesByKey.get(`${r.month}|${r.persona}`);
      const share = !cell.suppressed && base?.shown && base.n > 0 ? Math.round((n / base.n) * 1000) / 1000 : null;
      return { month: r.month, persona: r.persona, ...cell, share };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.persona.localeCompare(b.persona));

  const sk = await env.DB.prepare(
    `SELECT j.key AS axis, json_extract(j.value, '$.state') AS state, COUNT(*) AS n
       FROM profile_snapshots s
       JOIN (SELECT MAX(id) AS id FROM profile_snapshots GROUP BY user_id, persona) m ON m.id = s.id,
            json_each(s.skills_json) j
      GROUP BY j.key, json_extract(j.value, '$.state')`,
  ).all<{ axis: string; state: string; n: number }>();
  const skillRows = sk.results || [];
  const skills = RADAR_AXES.map((a) => {
    const counts = SKILL_STATES.map((st) => Number(skillRows.find((r) => r.axis === a.slug && r.state === st)?.n ?? 0));
    const g = suppressGroup(counts, min);
    return { axis: a.slug, label: a.label, states: SKILL_STATES.map((st, i) => ({ state: st, ...g.cells[i] })) };
  }).filter((a) => a.states.some((s) => s.count !== 0));

  let revisions: { month: string; count: number | null; suppressed: boolean }[] = [];
  try {
    const rv = await env.DB.prepare(
      `SELECT substr(archived_at, 1, 7) AS month, COUNT(*) AS n
         FROM advisor_answer_revisions
        WHERE archived_at >= ?
        GROUP BY substr(archived_at, 1, 7)`,
    ).bind(sinceDay).all<{ month: string; n: number }>();
    revisions = (rv.results || []).map((r) => ({ month: r.month, ...one(Number(r.n), min) }))
      .sort((a, b) => a.month.localeCompare(b.month));
  } catch { /* before migration 364 */ }

  return {
    generated_at: now.toISOString(),
    engine_version: ENGINE_VERSION,
    min_cell: min,
    months: span.map((s) => s.month),
    distribution,
    changes,
    skills,
    revisions,
  };
}
