/**
 * D5325 (#5325) — one skill's readiness, computed on the server for the HQ list (`admin_hq_skills.ts`) and the Team
 * list (`team_skills.ts`), from the ten-state model on board SK-13 of the Skill Library v2 canvas (D4956). The
 * screens show it and never derive it.
 *
 *   retired            status = retired
 *   in_review          an open review on the current evidence (`lifecycleStatus` = in_review), a published skill too
 *   published          status = published, with no open review on its current evidence
 *   changes_requested  the latest review, on the current evidence, sent the draft back
 *   missing_cases      an Axal draft with no live golden case
 *   stale              no run on the current evidence but runs on an older one; or every run in and at the bar, with an
 *                      approval or open review only on an older evidence
 *   needs_evaluation   a required run (live case × required model) with no result on the current evidence
 *   failing            every required run in, below 9 of every 10 (`meetsBar`)
 *   ready_to_publish   every run in, at the bar, and an unspent approval on exactly this evidence: the publish gate
 *                      (`publishRefusal`) would let it through
 *   draft              an Axal draft at the bar that was never sent for review; every company draft (company skills
 *                      have no golden cases or review)
 *   unknown            a fact the state needs could not be read, a status outside the four, or no required model:
 *                      never a passing state
 *
 * "Current evidence" is D4533's evidence hash: the definition, the live cases, the evaluator and the required models.
 * The reads are batched: two queries for the whole list, whatever its length.
 */
import type { Env } from '../../types';
import { draftHash, evidenceHashOf, meetsBar, requiredModels, suiteRevision, type DraftParts } from './skillLifecycle';

export const READINESS = [
  'draft', 'missing_cases', 'needs_evaluation', 'failing', 'stale', 'in_review', 'changes_requested', 'ready_to_publish', 'published', 'retired', 'unknown',
] as const;
export type Readiness = typeof READINESS[number];

/** Results under the current evidence, counted on live cases and required models only. */
export type CurrentResults = { recorded: number; pass: number; last_run: string | null };

/** What the reviews and older runs say about one skill against its current evidence. */
export type ReviewHistory = {
  open_current: boolean; open_older: boolean; changes_requested_current: boolean;
  approved_current: boolean; approved_older: boolean; older_runs: boolean;
};

export type ReadinessFacts = {
  scope: string; status: string; live_cases: number; models: number;
  /** null: the results could not be read. A skill with no result is `{ recorded: 0, … }`. */
  results: CurrentResults | null;
  /** null: the history could not be read. */
  history: ReviewHistory | null;
};

/** The one decision. Pure: the same facts give the same state. */
export function readinessOf(f: ReadinessFacts): Readiness {
  if (f.status === 'retired') return 'retired';
  if (f.status !== 'published' && f.status !== 'draft') return 'unknown';
  if (f.scope === 'company') return f.status === 'published' ? 'published' : 'draft';
  if (f.scope !== 'hq') return 'unknown';
  const h = f.history;
  if (!h) return 'unknown';
  if (h.open_current) return 'in_review';
  if (f.status === 'published') return 'published';
  if (h.changes_requested_current) return 'changes_requested';
  if (f.live_cases <= 0) return 'missing_cases';
  if (f.models <= 0 || !f.results) return 'unknown';
  const total = f.live_cases * f.models;
  if (f.results.recorded <= 0) return h.older_runs ? 'stale' : 'needs_evaluation';
  if (f.results.recorded < total) return 'needs_evaluation';
  if (!meetsBar(f.results.pass, total)) return 'failing';
  if (h.approved_current) return 'ready_to_publish';
  if (h.approved_older || h.open_older) return 'stale';
  return 'draft';
}

export type Want = { skill_id: number; evidence: string; models: readonly string[] };

/**
 * The latest result per live case and REQUIRED model under each skill's current evidence, counted: one query for every
 * skill asked. A skill with no result is absent from the map. Throws on a failed read; the caller decides.
 */
export async function currentResults(env: Env, wants: readonly Want[]): Promise<Map<number, CurrentResults>> {
  if (!wants.length) return new Map();
  const r = await env.DB.prepare(`WITH want AS (
        SELECT CAST(j.key AS INTEGER) AS skill_id, json_extract(j.value, '$.e') AS evidence, json_extract(j.value, '$.m') AS models FROM json_each(?) j
      ), latest AS (
        SELECT MAX(r.id) AS id
        FROM want w JOIN agent_skill_eval_results r ON r.skill_id = w.skill_id AND r.evidence_hash = w.evidence
        WHERE r.model_id IN (SELECT value FROM json_each(w.models))
        GROUP BY r.skill_id, r.case_id, r.model_id
      )
      SELECT r.skill_id, COUNT(*) AS recorded,
        SUM(CASE WHEN r.result = 'pass' THEN 1 ELSE 0 END) AS pass,
        MAX(r.run_at) AS last_run
      FROM latest JOIN agent_skill_eval_results r ON r.id = latest.id
      JOIN agent_skill_cases k ON k.id = r.case_id AND k.skill_id = r.skill_id AND k.removed_at IS NULL
      GROUP BY r.skill_id`).bind(JSON.stringify(Object.fromEntries(wants.map((w) => [w.skill_id, { e: w.evidence, m: w.models }]))))
    .all<{ skill_id: number; recorded: number; pass: number; last_run: string | null }>();
  return new Map((r.results ?? []).map((x) => [Number(x.skill_id), { recorded: Number(x.recorded), pass: Number(x.pass ?? 0), last_run: x.last_run ?? null }]));
}

/**
 * Each skill's reviews and older runs against its current evidence: one query for every skill asked. An approval
 * counts as current only while it has not released a version (`approvalFor`'s rule, D4533 step 5). Null when the read
 * failed, so every state that needs it reads `unknown`.
 */
export async function reviewHistory(env: Env, wants: readonly Pick<Want, 'skill_id' | 'evidence'>[]): Promise<Map<number, ReviewHistory> | null> {
  if (!wants.length) return new Map();
  try {
    const r = await env.DB.prepare(`WITH want AS (
          SELECT CAST(j.key AS INTEGER) AS skill_id, j.value AS evidence FROM json_each(?) j
        )
        SELECT w.skill_id,
          EXISTS (SELECT 1 FROM agent_skill_reviews q WHERE q.skill_id = w.skill_id AND q.status = 'requested' AND q.evidence_hash = w.evidence) AS open_current,
          EXISTS (SELECT 1 FROM agent_skill_reviews q WHERE q.skill_id = w.skill_id AND q.status = 'requested' AND q.evidence_hash IS NOT w.evidence) AS open_older,
          (SELECT q.status = 'changes_requested' AND q.evidence_hash = w.evidence FROM agent_skill_reviews q
            WHERE q.skill_id = w.skill_id AND q.status IN ('approved', 'changes_requested', 'requested') ORDER BY q.id DESC LIMIT 1) AS changes_requested_current,
          EXISTS (SELECT 1 FROM agent_skill_reviews q WHERE q.skill_id = w.skill_id AND q.status = 'approved' AND q.evidence_hash = w.evidence
            AND NOT EXISTS (SELECT 1 FROM agent_skill_versions v WHERE v.skill_id = q.skill_id AND json_extract(v.evidence_json, '$.review.review_id') = q.id)) AS approved_current,
          EXISTS (SELECT 1 FROM agent_skill_reviews q WHERE q.skill_id = w.skill_id AND q.status = 'approved' AND q.evidence_hash IS NOT w.evidence) AS approved_older,
          EXISTS (SELECT 1 FROM agent_skill_eval_results x WHERE x.skill_id = w.skill_id AND x.evidence_hash IS NOT w.evidence) AS older_runs
        FROM want w`).bind(JSON.stringify(Object.fromEntries(wants.map((w) => [w.skill_id, w.evidence]))))
      .all<Record<string, number | null> & { skill_id: number }>();
    return new Map((r.results ?? []).map((x) => [Number(x.skill_id), {
      open_current: !!x.open_current, open_older: !!x.open_older, changes_requested_current: !!x.changes_requested_current,
      approved_current: !!x.approved_current, approved_older: !!x.approved_older, older_runs: !!x.older_runs,
    }]));
  } catch {
    return null;
  }
}

export type ReadinessInput = {
  id: number; scope: string; status: string; required_models_json?: string | null;
  /** The current draft's parts and its live golden cases' uids, oldest first: the evidence is built from them. */
  parts: DraftParts; case_uids: readonly string[];
};

/**
 * Every skill's readiness in two reads whatever the count (the Team list, and one card). Only an Axal skill that is
 * not retired needs its evidence; a company skill and a retired one are decided from their status.
 */
export async function readinessOfSkills(env: Env, inputs: readonly ReadinessInput[]): Promise<Map<number, Readiness>> {
  const hq = inputs.filter((i) => i.scope === 'hq' && i.status !== 'retired');
  const wants = await Promise.all(hq.map(async (i) => {
    const models = requiredModels(env, i.required_models_json);
    return { skill_id: i.id, evidence: await evidenceHashOf(await draftHash(i.parts), await suiteRevision(i.case_uids), models), models: models.required };
  }));
  const [results, history] = await Promise.all([currentResults(env, wants).catch(() => null), reviewHistory(env, wants)]);
  const models = new Map(wants.map((w) => [w.skill_id, w.models.length]));
  return new Map(inputs.map((i) => [i.id, readinessOf({
    scope: i.scope, status: i.status, live_cases: i.case_uids.length, models: models.get(i.id) ?? 0,
    results: results ? results.get(i.id) ?? { recorded: 0, pass: 0, last_run: null } : null,
    history: history ? history.get(i.id) ?? null : null,
  })]));
}
