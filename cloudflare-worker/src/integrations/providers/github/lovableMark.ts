/**
 * D1084 (#2949, Lovable part 5 of #2398) — "Synced with Lovable", a founder-set
 * mark on a picked GitHub repository.
 *
 * A Lovable project synced to GitHub is an ordinary repository: the founder
 * picks it in the GitHub connector and D782's feeds run unchanged. The mark
 * only says where the code comes from. It lives in the connection's
 * `config_json` as `synced_with: { "<owner/repo>": "lovable" }`, is set and
 * cleared by the connection's owner through `PATCH /api/connectors/:uid/config`
 * (GitHub's `validateConfig`), and is never set, cleared or guessed by a sync.
 * It is config, not a fact: no migration, no fed item.
 */
import type { Env } from '../../../types';

/** The one source a repository can be marked as synced with today. */
export const SYNCED_WITH = ['lovable'] as const;
export type SyncedWith = typeof SYNCED_WITH[number];

/** The marks that still name a picked repository: a repository no longer picked carries none. */
export function syncedWithOf(config: Record<string, unknown>): Record<string, SyncedWith> {
  const picked = new Set(Array.isArray(config.repositories) ? config.repositories.filter((r): r is string => typeof r === 'string') : []);
  const raw = config.synced_with;
  const out: Record<string, SyncedWith> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [repo, value] of Object.entries(raw as Record<string, unknown>)) {
    if (picked.has(repo) && (SYNCED_WITH as readonly unknown[]).includes(value)) out[repo] = value as SyncedWith;
  }
  return out;
}

/**
 * A config patch's `synced_with`: `{ "<owner/repo>": "lovable" | null }`, for
 * picked repositories only. `null` clears. The result is the whole map, so
 * the route's shallow merge replaces it.
 */
export function checkSyncedWith(patchValue: unknown, existing: Record<string, unknown>):
  { ok: true; synced_with: Record<string, SyncedWith> } | { ok: false; error: string } {
  if (!patchValue || typeof patchValue !== 'object' || Array.isArray(patchValue)) return { ok: false, error: 'invalid_synced_with' };
  const picked = new Set(Array.isArray(existing.repositories) ? existing.repositories.filter((r): r is string => typeof r === 'string') : []);
  const next = syncedWithOf(existing);
  const entries = Object.entries(patchValue as Record<string, unknown>);
  if (!entries.length) return { ok: false, error: 'invalid_synced_with' };
  for (const [repo, value] of entries) {
    if (!picked.has(repo)) return { ok: false, error: 'repository_not_chosen' };
    if (value === null) delete next[repo];
    else if ((SYNCED_WITH as readonly unknown[]).includes(value)) next[repo] = value as SyncedWith;
    else return { ok: false, error: 'invalid_synced_with' };
  }
  return { ok: true, synced_with: next };
}

/** The repositories marked synced with Lovable on the GitHub connections that feed this project. */
export async function lovableRepositories(env: Env, projectId: number): Promise<Set<string>> {
  const rows = (await env.DB.prepare(
    "SELECT config_json FROM integrations WHERE provider_key = 'github' AND json_extract(config_json, '$.project_id') = ?",
  ).bind(projectId).all<{ config_json: string | null }>()).results || [];
  const out = new Set<string>();
  for (const r of rows) {
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(r.config_json || '{}'); } catch { continue; }
    for (const [repo, v] of Object.entries(syncedWithOf(cfg))) if (v === 'lovable') out.add(repo);
  }
  return out;
}
