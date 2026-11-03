/**
 * D4251 (#4251, deck v2 B10a) — HQ's AI model policy: the kill switch and the
 * plan floor for a catalogue model, set without a deploy.
 *
 * One row per model in `ai_model_policy` (migration 202611030919), keyed on
 * its catalogue id (`catalogue.ts`). `enabled = 0` switches the model off for
 * everyone; `plan_min` is the lowest plan that may run it. No row is no
 * policy.
 *
 * WHERE IT BITES. The policy joins the feature flags' switched-off set
 * (`MODELS_OFF`), the one set `catalogue.isOffered` and `catalogue.refusalFor`
 * read:
 *   - `featureFlags.modelsOffFor`, which the run path asks on every call
 *     (`aiRouter.chooseModels`), so a model switched off is refused on the
 *     next run;
 *   - `featureFlags.flagsFor`, behind every reply that offers models (the
 *     rail, the deck's element models, the lightbox chips).
 * It is read from D1 on each of those calls, with no cache, so nothing stands
 * between HQ's write and the next refusal. A table that cannot be read (not
 * migrated yet) is no policy; a model switched off by a flag stays off either
 * way.
 *
 * NOT HERE. The agents' own locks (`ai_model_locks`, D4162) apply to agent
 * runs only; this policy applies to every run. The per-deck picks and HQ's
 * defaults and locks (D1503, D1549) still choose among the models this
 * leaves offered.
 */
import type { Env, User } from '../../types';
import { userMeetsTier, type Tier } from '../../middleware/requireTier';
import { modelById } from './catalogue';

export const PLAN_MINS = ['free', 'growth', 'studio'] as const;
export type PlanMin = (typeof PLAN_MINS)[number];
export const NOTE_MAX = 500;
export const REASON_MIN = 10;

/** The safety check runs on every call (aiRouter's `safety` route); switching it off would stop every run, so it cannot be. */
export const REQUIRED_MODELS: ReadonlySet<string> = new Set(['@cf/meta/llama-guard-3-8b']);

export type PolicyRow = { model_id: string; enabled: number; plan_min: string | null; note: string | null; updated_by: number | null; updated_at: string };

/** Every policy row; an unreadable table is none. */
export async function loadPolicy(env: Pick<Env, 'DB'>): Promise<PolicyRow[]> {
  try {
    // `.bind()` with no values, as `loadFlagRows` does: a harness that pairs each query with its binds stays in step.
    return (await env.DB.prepare('SELECT model_id, enabled, plan_min, note, updated_by, updated_at FROM ai_model_policy ORDER BY model_id').bind().all<PolicyRow>()).results ?? [];
  } catch { return []; }
}

/** A plan floor a member's plan does not reach (`requireTier`'s own rule). An unknown floor admits no one. */
function belowFloor(planMin: string | null, user: User | null): boolean {
  if (!planMin || planMin === 'free') return false;
  if (!(PLAN_MINS as readonly string[]).includes(planMin)) return true;
  return !userMeetsTier(user, planMin as Tier);
}

/** The models this policy keeps from a member: every one switched off, and every one above their plan. Pure. */
export function policyOff(rows: readonly PolicyRow[], user: User | null): Set<string> {
  const off = new Set<string>();
  for (const r of rows) if (!Number(r.enabled) || belowFloor(r.plan_min, user)) off.add(r.model_id);
  return off;
}

/** Whether any row needs the member's plan to be read (a floor above free). */
export const needsPlan = (rows: readonly PolicyRow[]): boolean => rows.some((r) => Number(r.enabled) && r.plan_min && r.plan_min !== 'free');

/** The models the policy keeps from a run's member, from the user id alone. A plan that cannot be read reaches no floor. */
export async function policyOffFor(env: Pick<Env, 'DB'>, userId: number): Promise<Set<string>> {
  const rows = await loadPolicy(env);
  if (!rows.length) return new Set();
  let user: User | null = null;
  if (needsPlan(rows) && userId > 0) {
    try { user = (await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(userId).first<User>()) ?? null; } catch { user = null; }
  }
  return policyOff(rows, user);
}

/** Why a policy write is refused, or null. */
export function policyProblem(body: any): { code: string; message: string; status: number } | null {
  const id = body?.model_id;
  if (typeof id !== 'string' || !modelById(id)) return { code: 'unknown_model', message: 'model_id must be a model in the catalogue.', status: 400 };
  if (typeof body?.enabled !== 'boolean') return { code: 'invalid_enabled', message: 'enabled is true or false.', status: 400 };
  if (body.plan_min != null && !(PLAN_MINS as readonly string[]).includes(body.plan_min)) {
    return { code: 'invalid_plan_min', message: 'plan_min is free, growth, studio, or null for any plan.', status: 400 };
  }
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > NOTE_MAX)) {
    return { code: 'invalid_note', message: `A note is text of at most ${NOTE_MAX} characters.`, status: 400 };
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > 500) {
    return { code: 'reason_required', message: `Say why, in at least ${REASON_MIN} characters. It is kept in the admin audit.`, status: 400 };
  }
  if (REQUIRED_MODELS.has(id) && (body.enabled === false || (body.plan_min && body.plan_min !== 'free'))) {
    return { code: 'model_required', message: 'The safety check runs on every call, so it cannot be switched off or kept from a plan.', status: 409 };
  }
  return null;
}
