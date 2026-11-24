#!/usr/bin/env node
/**
 * D8080 (#8080): sync the agent registry after a deploy.
 *
 * Reads every manifest in `agents/<name>.agent.yml` (D8079), refuses to post when the folder does not pass
 * `scripts/check-agent-manifests.mjs`, and POSTs them with the shipped commit to
 * `POST /api/internal/agent-registry/sync`, which upserts and records drift. It reads no secret but its token,
 * and prints none.
 *
 * Environment:
 *   AGENT_REGISTRY_TOKEN  bearer token the route checks (required; never printed)
 *   AGENT_REGISTRY_URL    the route (default https://axal.vc/api/internal/agent-registry/sync)
 *   GITHUB_SHA            the commit the deploy shipped (set by Actions)
 *
 * Exit 0 when the sync is accepted; 1 otherwise. A failure leaves the registry as the last sync wrote it and
 * does not undo the deploy. The deploy workflow line that runs this is proposed on #8069.
 *
 *   node scripts/deploy/sync-agent-registry.mjs [--dry-run]   (--dry-run prints the body and posts nothing)
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkFolder, readManifest } from '../check-agent-manifests.mjs';

export const DEFAULT_SYNC_URL = 'https://axal.vc/api/internal/agent-registry/sync';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** One manifest file's bytes → the sync entry. Only fields the manifest schema records; nothing is invented. */
export function entryFor(text) {
  const { doc, error } = readManifest(text);
  if (error || !doc) throw new Error(`unreadable manifest: ${error ?? 'empty'}`);
  return {
    name: doc.name,
    kind: doc.kind,
    owner: String(doc.owner),
    identity: String(doc.identity),
    runner_pool: doc.runner_pool,
    status: doc.status,
    manifest_sha: createHash('sha256').update(text).digest('hex'),
    capabilities: [...(doc.capabilities ?? [])],
    models: [...(doc.models?.allowed ?? [])],
  };
}

/** The sync body for a folder, or { problems } when the folder fails the manifest guard. */
export function syncBody(dir, commit) {
  const checked = checkFolder(dir);
  if (checked.problems.length) return { problems: checked.problems.map((p) => `${p.file}: ${p.code}: ${p.message}`) };
  if (!/^[0-9a-f]{40}$/.test(String(commit ?? ''))) return { problems: ['GITHUB_SHA is not a 40-character commit sha'] };
  const files = readdirSync(dir).filter((f) => f.endsWith('.agent.yml')).sort();
  return { body: { commit, manifests: files.map((f) => entryFor(readFileSync(join(dir, f), 'utf8'))) } };
}

export async function run({ env = process.env, argv = process.argv.slice(2), fetchImpl = globalThis.fetch, dir = join(ROOT, 'agents'), log = console.log, error = console.error } = {}) {
  const built = syncBody(dir, String(env.GITHUB_SHA ?? '').toLowerCase());
  if (built.problems) { for (const p of built.problems) error(`[sync-agent-registry] ${p}`); return 1; }
  if (argv.includes('--dry-run')) { log(JSON.stringify(built.body, null, 2)); return 0; }
  const token = String(env.AGENT_REGISTRY_TOKEN ?? '').trim();
  if (!token) { error('[sync-agent-registry] AGENT_REGISTRY_TOKEN is not set; nothing synced.'); return 1; }
  const url = String(env.AGENT_REGISTRY_URL ?? '').trim() || DEFAULT_SYNC_URL;
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(built.body) });
  } catch (err) {
    error(`[sync-agent-registry] request failed: ${String(err?.message ?? err).slice(0, 200)}`);
    return 1;
  }
  const answer = await res.json().catch(() => null);
  if (!res.ok) { error(`[sync-agent-registry] HTTP ${res.status}: ${String(answer?.error ?? 'no code')}`); return 1; }
  log(`[sync-agent-registry] ${answer?.synced ?? '?'} manifest(s) synced; new versions: ${(answer?.new_versions ?? []).join(', ') || 'none'}; removed: ${(answer?.removed ?? []).join(', ') || 'none'}; drift rows: ${answer?.drift ?? '?'}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) run().then((code) => { process.exitCode = code; });
