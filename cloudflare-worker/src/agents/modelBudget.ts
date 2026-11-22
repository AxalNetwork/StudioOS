/**
 * D7077 (#7077) — the platform admission budget per model: how many agent runs
 * the agent queue may START per model per UTC minute, across every team, and
 * how that minute is shared between teams so a noisy one cannot starve a quiet
 * one. It is a platform quota per model, not fairness between ventures (#5586
 * owns that), and not the gateway lease (`services/upstreamLease.ts`, D5338),
 * which still governs each upstream call.
 *
 * The knob is `AGENT_MODEL_RPM`, a JSON object of model id → starts a minute,
 * with `"*"` as the limit for any model not named:
 *
 *   AGENT_MODEL_RPM = '{"*": 250, "@cf/meta/llama-3.3-70b-instruct-fp8-fast": 40}'
 *
 * Unset, empty or unreadable means NO limit (the behaviour before #7077), so
 * merging this changes nothing in production until an operator sets it. One
 * started run is counted as one request: a run makes one model call in its
 * `run` step (`agentRun`), so the figure is set from the provider's published
 * requests-a-minute with a margin (Workers AI: 300 a minute for text
 * generation by default, 20 or 50 for some paid-plan models).
 *
 * Fair share. A minute of model M holds a count per scope (team). A start is
 * admitted while the minute's total is under the limit AND the scope's own
 * count is under `ceil(limit / k)`, where `k` is the number of scopes that
 * already started on M this minute, the asker included, and at least
 * `MODEL_BUDGET_MIN_SHARES` (2). So the first team of a minute can take at
 * most half of it, and once k teams are active none takes more than 1/k of it
 * from then on. The check and the increment are ONE statement, so two
 * consumers racing for the last slot cannot both win.
 *
 * Buckets are keyed (model, minute, scope) in `agent_model_admissions`; the
 * sweep deletes buckets older than `MODEL_BUDGET_KEEP_MINUTES`. A budget read
 * or write that fails lets the start through (`unavailable`): the budget is a
 * throttle, never a reason to fail a run.
 */
import type { Env } from '../types';

/** The fewest shares a minute is cut into: a lone team takes at most half a model's minute. */
export const MODEL_BUDGET_MIN_SHARES = 2;
/** Buckets older than this many minutes are deleted by the sweep. */
export const MODEL_BUDGET_KEEP_MINUTES = 10;
/** The largest limit read from the knob; anything above it is unreadable. */
const RPM_MAX = 100_000;
const MODEL_KEY = /^[A-Za-z0-9@._/:+-]{1,128}$/;
const SCOPE_KEY = /^(company|project):[0-9]{1,16}$/;

export type ModelBudgets = { byModel: Readonly<Record<string, number>>; fallback: number | null };

/** The knob, read. `null` is no limit at all. A malformed value is no limit too, with one warning. */
export function readModelBudgets(env: Pick<Env, 'AGENT_MODEL_RPM'>): ModelBudgets | null {
  const raw = env.AGENT_MODEL_RPM;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not_an_object');
    const byModel: Record<string, number> = {};
    let fallback: number | null = null;
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > RPM_MAX) throw new Error('bad_limit');
      if (k === '*') fallback = v;
      else if (MODEL_KEY.test(k)) byModel[k] = v;
      else throw new Error('bad_model');
    }
    if (fallback == null && !Object.keys(byModel).length) return null;
    return { byModel, fallback };
  } catch {
    console.warn('[agent-queue] model_budget_unreadable');
    return null;
  }
}

/**
 * The limit for one model, and the metric label it is counted under: the model id when the knob
 * names it, else `*`. Labels are therefore bounded by the knob, never by what rows hold.
 */
export function budgetFor(b: ModelBudgets | null, model: string): { limit: number; label: string } | null {
  if (!b) return null;
  if (Object.hasOwn(b.byModel, model)) return { limit: b.byModel[model], label: model };
  return b.fallback == null ? null : { limit: b.fallback, label: '*' };
}

export const minuteOf = (now: Date) => Math.floor(now.getTime() / 60_000);
/** Seconds to the start of the next UTC minute, at least 1: when a throttled start may try again. */
export const secondsToNextMinute = (now: Date) => Math.max(1, 60 - Math.floor((now.getTime() % 60_000) / 1000));

export type BudgetVerdict =
  | { ok: true; counted: boolean }
  | { ok: false; reason: 'model_full' | 'scope_share'; retryAfterSec: number };

/**
 * Admit one start of `model` for `scopeKey` (`company:<id>` or `project:<id>`) this minute, or say
 * why not. With no limit for the model it is admitted uncounted. Throws only if D1 does; the
 * caller treats a throw as `unavailable` and lets the start through.
 */
export async function admitModelStart(env: Env, budgets: ModelBudgets | null, model: string, scopeKey: string, now: Date): Promise<BudgetVerdict> {
  const b = budgetFor(budgets, model);
  if (!b) return { ok: true, counted: false };
  if (!SCOPE_KEY.test(scopeKey)) throw new Error('bad_scope_key');
  const minute = minuteOf(now);
  // One statement: the total and the scope's fair share are read and the bucket incremented
  // together, so racing consumers cannot overrun either bound.
  const r = await env.DB.prepare(
    `INSERT INTO agent_model_admissions (model, minute, scope_key, n)
     SELECT ?1, ?2, ?3, 1
      WHERE (SELECT IFNULL(SUM(n), 0) FROM agent_model_admissions WHERE model = ?1 AND minute = ?2) < ?4
        AND (SELECT IFNULL(SUM(n), 0) FROM agent_model_admissions WHERE model = ?1 AND minute = ?2 AND scope_key = ?3)
            * MAX(?5, 1 + (SELECT COUNT(*) FROM agent_model_admissions WHERE model = ?1 AND minute = ?2 AND scope_key <> ?3)) < ?4
     ON CONFLICT (model, minute, scope_key) DO UPDATE SET n = n + 1`,
  ).bind(model, minute, scopeKey, b.limit, MODEL_BUDGET_MIN_SHARES).run();
  if (Number(r.meta?.changes ?? 0) > 0) return { ok: true, counted: true };
  const total = await env.DB.prepare(
    'SELECT IFNULL(SUM(n), 0) AS n FROM agent_model_admissions WHERE model = ? AND minute = ?',
  ).bind(model, minute).first<{ n: number }>();
  return { ok: false, reason: Number(total?.n ?? 0) >= b.limit ? 'model_full' : 'scope_share', retryAfterSec: secondsToNextMinute(now) };
}

/** The sweep's housekeeping: forget minutes no admission reads any more. Never throws. */
export async function pruneModelBuckets(env: Env, now: Date): Promise<void> {
  try {
    await env.DB.prepare('DELETE FROM agent_model_admissions WHERE minute < ?').bind(minuteOf(now) - MODEL_BUDGET_KEEP_MINUTES).run();
  } catch { console.warn('[agents] model_budget_prune_failed'); }
}
