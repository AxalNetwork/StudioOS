/**
 * D576 (#1189) — the Week 1 plan store (migration 396): read a member's plan,
 * and (re)compute it from their latest application's tech-transfer answer.
 * The rules are `week1Plan.ts`; this file only reads and writes.
 *
 * EVERY WRITE RECORDS ITS ACTOR: `computed_by` on the plan, and a row in
 * `spinout_week1_plan_history` with the actor and the reason. The plan row
 * and its history row go in one batch, so neither lands without the other.
 */
import type { Env } from '../types';
import { parseStoredAnswers } from './applicationLifecycle';
import { WEEK1_KEYS, parseSteps, planSteps, planView, ruleFor, type PlanRow } from './week1Plan';

export type PlanReason = 'applied' | 'started';

export async function readWeek1Plan(env: Env, userId: number) {
  const row = await env.DB.prepare(
    `SELECT user_id, rule_key, steps_json, started, computed_by, created_at, updated_at
       FROM spinout_week1_plans WHERE user_id = ?`,
  ).bind(userId).first<PlanRow>();
  return planView(row);
}

/**
 * Compute the member's plan from their latest application and store it.
 * Week 1 has started when `users.spinout_lab_started_at` is set; from then
 * on the steps already done keep their places (`planSteps`). Throws on a
 * failed read or write; callers decide whether that blocks them.
 */
export async function writeWeek1Plan(env: Env, userId: number, reason: PlanReason, actor: string) {
  const [app, user, done, prev] = await Promise.all([
    env.DB.prepare(
      `SELECT id, answers_json FROM spinout_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(userId).first<{ id: number; answers_json: string | null }>(),
    env.DB.prepare(`SELECT spinout_lab_started_at FROM users WHERE id = ?`)
      .bind(userId).first<{ spinout_lab_started_at: string | null }>(),
    env.DB.prepare(`SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = ?`)
      .bind(userId).all<{ milestone_key: string }>(),
    env.DB.prepare(`SELECT steps_json FROM spinout_week1_plans WHERE user_id = ?`)
      .bind(userId).first<{ steps_json: string }>(),
  ]);
  const rule = ruleFor(parseStoredAnswers(app?.answers_json ?? null));
  const started = !!user?.spinout_lab_started_at;
  const doneKeys = (done.results || []).map((r) => r.milestone_key).filter((k) => WEEK1_KEYS.includes(k));
  const steps = planSteps(rule, { started, done: doneKeys, previous: parseSteps(prev?.steps_json) });
  const stepsJson = JSON.stringify(steps);
  const appId = app?.id ?? null;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO spinout_week1_plans (user_id, application_id, rule_key, steps_json, started, computed_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         application_id = excluded.application_id, rule_key = excluded.rule_key,
         steps_json = excluded.steps_json, started = excluded.started,
         computed_by = excluded.computed_by, updated_at = datetime('now')`,
    ).bind(userId, appId, rule, stepsJson, started ? 1 : 0, actor),
    env.DB.prepare(
      `INSERT INTO spinout_week1_plan_history (user_id, application_id, rule_key, steps_json, started, reason, actor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(userId, appId, rule, stepsJson, started ? 1 : 0, reason, actor),
  ]);
  return readWeek1Plan(env, userId);
}

/** At Week 1's start: compute a plan only when none was stored when the member applied. */
export async function ensureWeek1Plan(env: Env, userId: number, actor: string) {
  const has = await env.DB.prepare(`SELECT 1 AS x FROM spinout_week1_plans WHERE user_id = ?`)
    .bind(userId).first<{ x: number }>();
  if (has) return readWeek1Plan(env, userId);
  return writeWeek1Plan(env, userId, 'started', actor);
}
