/**
 * D1098 (#2963, #2408 part 3) — a Vercel project's deployments, read by the
 * part 1 sync (`providers/vercel.ts`) once per chosen project and kept in
 * `vercel_deployments` (migration 591).
 *
 * WHAT IS KEPT. The deployment's id, target, state, times, build seconds, the
 * commit SHA, branch, pull request number and repository Vercel names for it,
 * its source and error code, and a preview's address. Never its creator, never
 * its commit message, never a log line. The Git fields come from `meta`, under
 * keys Vercel documents (`githubCommitSha`, `githubCommitRef`, `githubPrId`,
 * `githubCommitOrg`, `githubCommitRepo`); UNVERIFIED until the owner's live
 * check. A SHA is kept only when it is a full 40-character one, lowercased.
 *
 * THE LEDGER. Each row is a `connector_fed_items` row, `deploy:<id>`: a
 * production deploy lands on Product roadmap, a preview on Prototype / MVP.
 * A row the retention (or a person) removed keeps its ledger row with no local
 * row, and the sync never writes it again: a deleted deployment stays deleted.
 *
 * RETENTION. 180 days, or the newest 500 per venture, whichever keeps fewer.
 *
 * Nothing here writes a roadmap item, a must-have, a release or a release check.
 */
import type { Env } from '../../types';
import type { Deployment } from './api';

/** Pages of 100 deployments read per project per sync: the newest 200. */
export const DEPLOYMENT_PAGES = 2;
export const KEEP_DAYS = 180;
export const KEEP_NEWEST = 500;

export interface DeploymentRow {
  deployment_id: string;
  target: 'production' | 'preview';
  state: string;
  created_at: string;
  ready_at: string | null;
  build_seconds: number | null;
  commit_sha: string | null;
  branch: string | null;
  pr_number: number | null;
  repository: string | null;
  source: string | null;
  error_code: string | null;
  is_rollback: 0 | 1;
  promoted_at: string | null;
  preview_url: string | null;
}

const iso = (ms: unknown): string | null => (typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);
const word = (v: unknown, max: number, re: RegExp): string | null => (typeof v === 'string' && v.length <= max && re.test(v) ? v : null);
const NAME = /^[A-Za-z0-9_.-]+$/;

/** A full commit SHA, lowercased, or null: a short or malformed one never marks anything. */
export function fullSha(v: unknown): string | null {
  return typeof v === 'string' && /^[a-f0-9]{40}$/i.test(v) ? v.toLowerCase() : null;
}

/** A deployment as it is kept, or null when it has no id or no creation time. `fallbackRepo` is the project's linked repository. */
export function deploymentRow(d: Deployment, fallbackRepo: string | null): DeploymentRow | null {
  const id = word(d.uid ?? d.id, 128, /^[A-Za-z0-9_-]+$/);
  const created = iso(d.createdAt ?? d.created);
  if (!id || !created) return null;
  const meta = d.meta && typeof d.meta === 'object' ? d.meta : {};
  const org = word(meta.githubCommitOrg ?? meta.githubOrg, 100, NAME);
  const repo = word(meta.githubCommitRepo ?? meta.githubRepo, 100, NAME);
  const pr = /^[1-9][0-9]{0,9}$/.test(String(meta.githubPrId ?? '')) ? Number(meta.githubPrId) : null;
  const ready = typeof d.ready === 'number' && d.ready > 0 ? d.ready : null;
  const building = typeof d.buildingAt === 'number' && d.buildingAt > 0 ? d.buildingAt : null;
  const target = d.target === 'production' ? 'production' : 'preview';
  const source = word(d.source, 40, /^[a-z-]+$/);
  const host = word(d.url, 253, /^[a-z0-9.-]+$/i);
  return {
    deployment_id: id,
    target,
    state: String(d.readyState ?? d.state ?? 'UNKNOWN').toUpperCase().slice(0, 20),
    created_at: created,
    ready_at: iso(ready),
    build_seconds: ready && building && ready >= building ? Math.round((ready - building) / 1000) : null,
    commit_sha: fullSha(meta.githubCommitSha),
    branch: word(meta.githubCommitRef, 200, /^[^\s\x00-\x1f]+$/),
    pr_number: pr,
    repository: org && repo ? `${org}/${repo}` : fallbackRepo,
    source,
    error_code: word(d.errorCode, 64, /^[A-Za-z0-9_]+$/),
    // UNVERIFIED: how Vercel names a rollback and a promotion on a deployment.
    is_rollback: source === 'rollback' ? 1 : 0,
    promoted_at: source === 'promote' ? iso(ready ?? (d.createdAt ?? d.created)) : null,
    // A preview's address is a link for members; the Worker never fetches it.
    preview_url: target === 'preview' && host ? `https://${host.toLowerCase()}` : null,
  };
}

const UPSERT = `INSERT INTO vercel_deployments
  (integration_id, project_id, vercel_project_id, deployment_id, target, state, created_at, ready_at, build_seconds, commit_sha, branch,
   pr_number, repository, source, error_code, is_rollback, promoted_at, preview_url, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(integration_id, deployment_id) DO UPDATE SET
    project_id = excluded.project_id, vercel_project_id = excluded.vercel_project_id, target = excluded.target, state = excluded.state,
    ready_at = excluded.ready_at, build_seconds = excluded.build_seconds, commit_sha = excluded.commit_sha, branch = excluded.branch,
    pr_number = excluded.pr_number, repository = excluded.repository, source = excluded.source, error_code = excluded.error_code,
    is_rollback = excluded.is_rollback, promoted_at = excluded.promoted_at, preview_url = excluded.preview_url, synced_at = CURRENT_TIMESTAMP`;
const LEDGER = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
  VALUES (?, ?, ?, 'deployment', ?, 'vercel_deployments', (SELECT id FROM vercel_deployments WHERE integration_id = ? AND deployment_id = ?))
  ON CONFLICT(integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`;
// Gone: unlinked by the retention, or its row removed since the last sync.
const DELETED = `SELECT external_id FROM connector_fed_items
  WHERE integration_id = ? AND kind = 'deployment' AND external_id IN (SELECT value FROM json_each(?))
    AND (local_table IS NULL OR local_id IS NULL OR local_id NOT IN (SELECT id FROM vercel_deployments WHERE integration_id = ?))`;

/** The landing's module: a production deploy feeds Product roadmap's cadence, a preview Prototype / MVP's chips. */
export const moduleOf = (r: Pick<DeploymentRow, 'target'>) => (r.target === 'production' ? 'product_roadmap' : 'prototype_mvp');

/** Writes one page's deployments, skipping any whose ledger row says it was deleted. Returns how many it wrote. */
export async function landDeployments(env: Env, integrationId: number, projectId: number, vercelProjectId: string, found: DeploymentRow[]): Promise<number> {
  if (!found.length) return 0;
  const keys = found.map((r) => `deploy:${r.deployment_id}`);
  const gone = new Set(((await env.DB.prepare(DELETED).bind(integrationId, JSON.stringify(keys), integrationId).all<{ external_id: string }>()).results ?? []).map((r) => r.external_id));
  const stmts: D1PreparedStatement[] = [];
  let n = 0;
  for (const r of found) {
    if (gone.has(`deploy:${r.deployment_id}`)) continue;
    stmts.push(env.DB.prepare(UPSERT).bind(integrationId, projectId, vercelProjectId, r.deployment_id, r.target, r.state, r.created_at, r.ready_at,
      r.build_seconds, r.commit_sha, r.branch, r.pr_number, r.repository, r.source, r.error_code, r.is_rollback, r.promoted_at, r.preview_url));
    stmts.push(env.DB.prepare(LEDGER).bind(integrationId, projectId, moduleOf(r), `deploy:${r.deployment_id}`, integrationId, r.deployment_id));
    n += 1;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return n;
}

const RETAIN = `DELETE FROM vercel_deployments WHERE integration_id = ? AND project_id = ? AND (
    created_at < ? OR id NOT IN (SELECT id FROM vercel_deployments WHERE integration_id = ? AND project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?))`;
// A removed row's ledger row stays, without its local row, so the sync never brings it back.
const UNLINK = `UPDATE connector_fed_items SET local_table = NULL, local_id = NULL
  WHERE integration_id = ? AND kind = 'deployment' AND local_table = 'vercel_deployments'
    AND local_id NOT IN (SELECT id FROM vercel_deployments WHERE integration_id = ?)`;
// Unchoosing a project is not deleting its deployments: their ledger rows go too, so choosing it again brings them back.
const PRUNE_LEDGER = `DELETE FROM connector_fed_items WHERE integration_id = ? AND kind = 'deployment' AND local_table = 'vercel_deployments'
  AND local_id IN (SELECT id FROM vercel_deployments WHERE integration_id = ? AND (project_id <> ? OR vercel_project_id NOT IN (SELECT value FROM json_each(?))))`;
const PRUNE = `DELETE FROM vercel_deployments WHERE integration_id = ?
  AND (project_id <> ? OR vercel_project_id NOT IN (SELECT value FROM json_each(?)))`;

/** Retention for a venture: 180 days, or its newest 500. `now` is injectable for tests. */
export async function retainDeployments(env: Env, integrationId: number, projectId: number, now = Date.now()): Promise<void> {
  const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(RETAIN).bind(integrationId, projectId, cutoff, integrationId, projectId, KEEP_NEWEST),
    env.DB.prepare(UNLINK).bind(integrationId, integrationId),
  ]);
}

/** A project no longer chosen, or a venture no longer fed, takes its deployments with it. */
export async function pruneDeployments(env: Env, integrationId: number, projectId: number, kept: string[]): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(PRUNE_LEDGER).bind(integrationId, integrationId, projectId, JSON.stringify(kept)),
    env.DB.prepare(PRUNE).bind(integrationId, projectId, JSON.stringify(kept)),
  ]);
}
