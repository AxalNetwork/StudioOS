/**
 * D4535 (#4535) slice 2: the store for composable skill workflows — drafts,
 * immutable published versions, and run admission from a frozen plan.
 *
 * ADMISSION IS NOT ACTIVATION. `admitRun` records a run bound to one
 * published version through the plan `planRun` froze, idempotently by the
 * plan's `run_key`, and stops there: it creates no scope task, starts no
 * agent, reserves no budget and calls no model. Nothing in this slice reads an
 * admitted run to execute it; that is the execution slice, gated on #4531/#4588,
 * #4667, #4533 and #4536 (D4535 §8).
 *
 * Every function takes a scope the caller has already authorized and binds it
 * in its SQL, so a workflow or run of another company reads as absent. It
 * takes `env` and plain values, never a Hono context (services/README.md).
 */
import type { Env } from '../../types';
import {
  POLICY_VERSION, canonical, checkShape, validateWorkflow,
  type OwnerScope, type Refusal, type RunPlan, type ValidationContext, type WorkflowDefinition,
} from './skillWorkflow';

export type StoreRefusal = { ok: false; code: string; refusals?: Refusal[] };
const no = (code: string, refusals?: Refusal[]): StoreRefusal => (refusals ? { ok: false, code, refusals } : { ok: false, code });

const UID_RE = /^[0-9a-f]{32}$/;
const RUN_UID_RE = /^[0-9a-f]{32}$/;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const newUid = () => crypto.randomUUID().replaceAll('-', '');

type WorkflowRow = {
  id: number; uid: string; scope: 'hq' | 'company'; company_id: number | null; slug: string;
  status: 'draft' | 'published' | 'retired'; current_version: number; draft_json: string | null;
};

/** The owner scope as the two bound columns, so `hq` and a company never match each other. */
const ownerCols = (o: OwnerScope) => [o.scope, o.scope === 'company' ? o.company_id : null] as const;

/** One workflow, only inside the owner scope the caller is authorized for. */
export async function readWorkflow(env: Env, owner: OwnerScope, uid: string): Promise<WorkflowRow | null> {
  if (typeof uid !== 'string' || !UID_RE.test(uid)) return null;
  const [scope, company] = ownerCols(owner);
  return env.DB.prepare(
    `SELECT id, uid, scope, company_id, slug, status, current_version, draft_json
       FROM agent_skill_workflows WHERE uid = ? AND scope = ? AND IFNULL(company_id, 0) = IFNULL(?, 0)`,
  ).bind(uid, scope, company).first<WorkflowRow>();
}

/**
 * Save a draft. The shape is checked (closed keys, deferred conditions, no
 * grant inheritance); the semantic checks need run-time facts and wait for
 * publication. The definition's own owner must be the caller's scope: a draft
 * cannot be written into another company. A retired workflow takes no draft.
 */
export async function saveDraft(env: Env, actorId: number, owner: OwnerScope, def: unknown):
  Promise<{ ok: true; uid: string; created: boolean } | StoreRefusal> {
  const shape = checkShape(def);
  if (shape.length) return no('definition_invalid', shape);
  const d = def as WorkflowDefinition;
  if (d.lifecycle !== 'draft') return no('not_a_draft');
  if (canonical(d.owner) !== canonical(owner)) return no('workflow_out_of_scope');
  const [scope, company] = ownerCols(owner);
  const existing = await readWorkflow(env, owner, d.uid);
  if (!existing) {
    // A uid held by another scope reads as taken, never as that scope's row.
    const taken = await env.DB.prepare('SELECT 1 AS x FROM agent_skill_workflows WHERE uid = ?').bind(d.uid).first();
    if (taken) return no('uid_taken');
    try {
      await env.DB.prepare(
        `INSERT INTO agent_skill_workflows (uid, scope, company_id, slug, status, current_version, draft_json, created_by)
         VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)`,
      ).bind(d.uid, scope, company, d.slug, canonical(d), actorId).run();
    } catch (e) {
      if (/UNIQUE/i.test(String((e as Error)?.message))) return no('slug_taken');
      throw e;
    }
    return { ok: true, uid: d.uid, created: true };
  }
  if (existing.status === 'retired') return no('workflow_retired');
  if (existing.slug !== d.slug) return no('slug_immutable');
  await env.DB.prepare(
    `UPDATE agent_skill_workflows SET draft_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'retired'`,
  ).bind(canonical(d), existing.id).run();
  return { ok: true, uid: d.uid, created: false };
}

/**
 * Publish the saved draft as the next version. The draft is validated in full
 * against `ctx` (the facts the caller read through the existing gates), stored
 * with `lifecycle: 'published'` and its version number, and hashed exactly as
 * `planRun` hashes it, so a plan can be checked against the row it names. The
 * version number moves by compare-and-set, so two publishes of one draft make
 * one version.
 */
export async function publishDraft(env: Env, actorId: number, owner: OwnerScope, uid: string, ctx: ValidationContext):
  Promise<{ ok: true; version: number; definition_hash: string } | StoreRefusal> {
  const w = await readWorkflow(env, owner, uid);
  if (!w) return no('workflow_not_found');
  if (w.status === 'retired') return no('workflow_retired');
  if (!w.draft_json) return no('no_draft');
  const version = w.current_version + 1;
  const def = { ...(JSON.parse(w.draft_json) as WorkflowDefinition), lifecycle: 'published' as const, version };
  const v = validateWorkflow(def, ctx);
  if (!v.ok) return no('definition_invalid', v.refusals);
  const definition_hash = await sha256(canonical(v.definition));
  // One batch, so the version row and the workflow's pointer land together or
  // not at all. A concurrent publish of the same next number fails the
  // (workflow_id, version) unique key and the whole batch rolls back.
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO agent_skill_workflow_versions (workflow_id, version, definition_json, definition_hash, policy_version, published_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(w.id, version, canonical(v.definition), definition_hash, POLICY_VERSION, actorId),
      env.DB.prepare(
        `UPDATE agent_skill_workflows SET current_version = ?, status = 'published', draft_json = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND current_version = ?`,
      ).bind(version, w.id, w.current_version),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) return no('version_conflict');
    throw e;
  }
  return { ok: true, version, definition_hash };
}

/** A published version's definition, inside the caller's owner scope. */
export async function readVersion(env: Env, owner: OwnerScope, uid: string, version: number):
  Promise<{ id: number; definition: WorkflowDefinition; definition_hash: string } | null> {
  const w = await readWorkflow(env, owner, uid);
  if (!w || !Number.isInteger(version) || version < 1) return null;
  const row = await env.DB.prepare(
    `SELECT id, definition_json, definition_hash FROM agent_skill_workflow_versions WHERE workflow_id = ? AND version = ?`,
  ).bind(w.id, version).first<{ id: number; definition_json: string; definition_hash: string }>();
  return row ? { id: row.id, definition: JSON.parse(row.definition_json), definition_hash: row.definition_hash } : null;
}

export type RunScope = { kind: 'company'; company_id: number } | { kind: 'project'; project_id: number };
const runScopeCols = (s: RunScope) => [s.kind, s.kind === 'company' ? s.company_id : null, s.kind === 'project' ? s.project_id : null] as const;

export type AdmittedRun = {
  uid: string; run_key: string; version_id: number; status: string;
  cancel_requested_at: string | null; created_at: string; plan: RunPlan;
};

/**
 * Admit a run from a plan `planRun` made. Refused unless the plan names a
 * version that exists in the owner's scope with the same definition hash and
 * policy, and unless the plan's scope is the run scope. Idempotent by the
 * plan's `run_key`: a repeated start answers the run the first one admitted
 * (`replayed: true`) and writes nothing. Creates no task and runs nothing.
 */
export async function admitRun(env: Env, actorId: number, owner: OwnerScope, scope: RunScope, plan: RunPlan):
  Promise<{ ok: true; run: AdmittedRun; replayed: boolean } | StoreRefusal> {
  if (!plan || plan.plan_schema !== 1 || typeof plan.run_key !== 'string' || !/^wfrun:[0-9a-f]{40}$/.test(plan.run_key)) return no('plan_invalid');
  if (plan.policy_version !== POLICY_VERSION) return no('plan_incompatible');
  const [kind, company, project] = runScopeCols(scope);
  // The plan was made for exactly this scope. A project run's plan also names
  // the project's company (the validator checks agents against it); a company
  // run's plan names no project.
  const inScope = kind === 'company'
    ? plan.scope.company_id === company && plan.scope.project_id == null
    : plan.scope.project_id === project;
  if (!inScope) return no('plan_out_of_scope');
  // A company workflow runs only inside its own company (D4535 §4 `workflow_out_of_scope`).
  if (owner.scope === 'company' && plan.scope.company_id !== owner.company_id) return no('workflow_out_of_scope');
  const version = await readVersion(env, owner, plan.workflow.uid, plan.workflow.version);
  if (!version) return no('version_not_found');
  if (version.definition_hash !== plan.workflow.definition_hash) return no('plan_incompatible');
  const uid = newUid();
  const wrote = await env.DB.prepare(
    `INSERT OR IGNORE INTO agent_skill_workflow_runs (uid, run_key, version_id, scope_kind, company_id, project_id, plan_json, status, started_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'admitted', ?)`,
  ).bind(uid, plan.run_key, version.id, kind, company, project, JSON.stringify(plan), actorId).run();
  const run = await runByKey(env, scope, plan.run_key);
  // A run_key held in another scope cannot occur (the key hashes the scope); refused rather than read across.
  if (!run) return no('run_key_taken');
  return { ok: true, run, replayed: !wrote.meta?.changes };
}

async function runByKey(env: Env, scope: RunScope, runKey: string): Promise<AdmittedRun | null> {
  const [kind, company, project] = runScopeCols(scope);
  const row = await env.DB.prepare(
    `SELECT uid, run_key, version_id, status, cancel_requested_at, created_at, plan_json FROM agent_skill_workflow_runs
      WHERE run_key = ? AND scope_kind = ? AND IFNULL(company_id, 0) = IFNULL(?, 0) AND IFNULL(project_id, 0) = IFNULL(?, 0)`,
  ).bind(runKey, kind, company, project).first<any>();
  return row ? toRun(row) : null;
}

const toRun = (row: any): AdmittedRun => ({
  uid: row.uid, run_key: row.run_key, version_id: row.version_id, status: row.status,
  cancel_requested_at: row.cancel_requested_at ?? null, created_at: row.created_at, plan: JSON.parse(row.plan_json),
});

/** One run, only inside the run scope the caller is authorized for. */
export async function readRun(env: Env, scope: RunScope, uid: string): Promise<AdmittedRun | null> {
  if (typeof uid !== 'string' || !RUN_UID_RE.test(uid)) return null;
  const [kind, company, project] = runScopeCols(scope);
  const row = await env.DB.prepare(
    `SELECT uid, run_key, version_id, status, cancel_requested_at, created_at, plan_json FROM agent_skill_workflow_runs
      WHERE uid = ? AND scope_kind = ? AND IFNULL(company_id, 0) = IFNULL(?, 0) AND IFNULL(project_id, 0) = IFNULL(?, 0)`,
  ).bind(uid, kind, company, project).first<any>();
  return row ? toRun(row) : null;
}

const TERMINAL = ['finished', 'partial', 'stopped', 'cancelled'];

/**
 * Ask a run to stop. An admitted run that never started is cancelled at once;
 * any other live run keeps its status and records the request, which
 * `readiness()` turns into "start nothing more" (D4535 §7.6). A terminal run
 * is left alone. Idempotent: the first request's time is kept.
 */
export async function requestCancel(env: Env, scope: RunScope, uid: string):
  Promise<{ ok: true; status: string; cancel_requested_at: string | null } | StoreRefusal> {
  const run = await readRun(env, scope, uid);
  if (!run) return no('run_not_found');
  if (TERMINAL.includes(run.status)) return { ok: true, status: run.status, cancel_requested_at: run.cancel_requested_at };
  await env.DB.prepare(
    `UPDATE agent_skill_workflow_runs
        SET cancel_requested_at = COALESCE(cancel_requested_at, CURRENT_TIMESTAMP),
            status = CASE WHEN status = 'admitted' THEN 'cancelled' ELSE status END,
            ended_at = CASE WHEN status = 'admitted' THEN CURRENT_TIMESTAMP ELSE ended_at END
      WHERE uid = ? AND status NOT IN ('finished', 'partial', 'stopped', 'cancelled')`,
  ).bind(uid).run();
  const after = (await readRun(env, scope, uid))!;
  return { ok: true, status: after.status, cancel_requested_at: after.cancel_requested_at };
}
