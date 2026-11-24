/**
 * D8080 (#8080): the agent registry sync. Mounted at /api/internal.
 *
 *   POST /agent-registry/sync   the deploy job posts every manifest in agents/<name>.agent.yml (D8079), with the
 *                               commit it shipped. No member session: the caller sends
 *                               `Authorization: Bearer <AGENT_REGISTRY_TOKEN>`, compared in constant time. With the
 *                               secret unset the route refuses (503), so nothing is accepted until it is set.
 *
 * The sync is idempotent. Each manifest version is upserted by (name, version). Every other version of a posted
 * name, and every version of a name the post no longer carries, is marked superseded. The drift table is replaced
 * whole, so it always says what the last sync saw. Drift is read only where the platform records the running agent:
 *   - a `venture` manifest against its live `team_agents` copies, bound by `role_key = name` until the deploy flow
 *     (part 2) records the registry entry on the copy;
 *   - `status`: the manifest's status against each copy's status;
 *   - `capabilities`: a copy's live `agent_capabilities` grants (#8070) that the manifest does not name;
 *   - budgets: #8071's tables are not on main, so they are not compared and the answer says so.
 * A `platform` manifest has no D1 copy, so its drift is "not compared", never "none".
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';
import { constantTimeEqual } from '../rpc/secret';

export const MAX_BYTES = 256 * 1024;
export const MAX_MANIFESTS = 200;

const NAME = /^[a-z][a-z0-9-]{0,59}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const CAP = /^[a-z]+\.(?:[a-z][a-z-]{0,39}|\*)$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,99}$/;
const KINDS = ['platform', 'venture'] as const;
const POOLS = ['trusted', 'untrusted', 'none'] as const;
const STATUSES = ['live', 'paused', 'retired'] as const;
const SHORT = /^[A-Za-z0-9:._-]{1,60}$/;

export type ManifestEntry = {
  name: string;
  kind: (typeof KINDS)[number];
  owner: string;
  identity: string;
  runner_pool: (typeof POOLS)[number];
  status: (typeof STATUSES)[number];
  manifest_sha: string;
  capabilities: string[];
  models: string[];
};
export type SyncInput = { commit: string; manifests: ManifestEntry[] };
type Invalid = { ok: false; code: string; message: string };

/** The version a manifest's bytes give it: the first 12 hex of its SHA-256 (the manifests carry no version field). */
export const versionOf = (sha: string) => sha.slice(0, 12);

const strings = (v: unknown, re: RegExp, max: number): string[] | null =>
  Array.isArray(v) && v.length <= max && v.every((s) => typeof s === 'string' && re.test(s)) ? [...new Set(v as string[])].sort() : null;

/** Validate a sync body. Pure; the script builds the same shape (`scripts/deploy/sync-agent-registry.mjs`). */
export function parseSync(body: unknown): { ok: true; value: SyncInput } | Invalid {
  const bad = (field: string, what: string): Invalid => ({ ok: false, code: 'registry_sync_invalid', message: `\`${field}\` ${what}.` });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'registry_sync_invalid', message: 'The body is not a JSON object.' };
  const b = body as Record<string, unknown>;
  const commit = typeof b.commit === 'string' ? b.commit.toLowerCase() : '';
  if (!SHA40.test(commit)) return bad('commit', 'is not a 40-character commit sha');
  if (!Array.isArray(b.manifests) || b.manifests.length === 0 || b.manifests.length > MAX_MANIFESTS) {
    return bad('manifests', `must list 1 to ${MAX_MANIFESTS} manifests`);
  }
  const seen = new Set<string>();
  const manifests: ManifestEntry[] = [];
  for (const [i, raw] of b.manifests.entries()) {
    const at = `manifests[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad(at, 'is not an object');
    const m = raw as Record<string, unknown>;
    if (typeof m.name !== 'string' || !NAME.test(m.name)) return bad(`${at}.name`, 'is not a manifest name');
    if (seen.has(m.name)) return bad(`${at}.name`, 'is listed twice');
    seen.add(m.name);
    if (!KINDS.includes(m.kind as never)) return bad(`${at}.kind`, 'is not platform or venture');
    if (typeof m.owner !== 'string' || !SHORT.test(m.owner)) return bad(`${at}.owner`, 'is not an owner');
    if (typeof m.identity !== 'string' || !SHORT.test(m.identity)) return bad(`${at}.identity`, 'is not an identity');
    if (!POOLS.includes(m.runner_pool as never)) return bad(`${at}.runner_pool`, 'is not trusted, untrusted or none');
    if (!STATUSES.includes(m.status as never)) return bad(`${at}.status`, 'is not live, paused or retired');
    const sha = typeof m.manifest_sha === 'string' ? m.manifest_sha.toLowerCase() : '';
    if (!SHA64.test(sha)) return bad(`${at}.manifest_sha`, 'is not a SHA-256');
    const capabilities = strings(m.capabilities, CAP, 100);
    if (!capabilities) return bad(`${at}.capabilities`, 'is not a list of capability names');
    const models = strings(m.models ?? [], MODEL, 50);
    if (!models) return bad(`${at}.models`, 'is not a list of model keys');
    manifests.push({
      name: m.name, kind: m.kind as ManifestEntry['kind'], owner: m.owner, identity: m.identity,
      runner_pool: m.runner_pool as ManifestEntry['runner_pool'], status: m.status as ManifestEntry['status'],
      manifest_sha: sha, capabilities, models,
    });
  }
  return { ok: true, value: { commit, manifests } };
}

export type RuntimeCopy = { uid: string; role_key: string; status: string; grants: string[] };
export type DriftRow = { name: string; field: 'status' | 'capabilities'; manifest_value: string; runtime_value: string; agent_uid: string };

/** A copy's status that agrees with each manifest status. A retired manifest should have no copy at all. */
const AGREES: Record<ManifestEntry['status'], string[]> = { live: ['active'], paused: ['paused'], retired: [] };

/** Where a venture manifest and its running copies disagree. Pure. Platform manifests are never compared here. */
export function driftFor(manifests: ManifestEntry[], copies: RuntimeCopy[]): DriftRow[] {
  const out: DriftRow[] = [];
  for (const m of manifests) {
    if (m.kind !== 'venture') continue;
    const allowed = (cap: string) => m.capabilities.some((c) => c === cap || (c.endsWith('.*') && cap.startsWith(c.slice(0, -1))));
    for (const copy of copies.filter((c) => c.role_key === m.name).sort((a, b) => (a.uid < b.uid ? -1 : 1))) {
      if (!AGREES[m.status].includes(copy.status)) {
        out.push({ name: m.name, field: 'status', manifest_value: m.status, runtime_value: copy.status, agent_uid: copy.uid });
      }
      const extra = [...new Set(copy.grants)].filter((g) => !allowed(g)).sort();
      if (extra.length) {
        out.push({ name: m.name, field: 'capabilities', manifest_value: JSON.stringify(m.capabilities), runtime_value: JSON.stringify(extra), agent_uid: copy.uid });
      }
    }
  }
  return out;
}

/** The running copies of the posted venture manifests: live team agents bound by role_key, with their live grants. */
export async function readCopies(db: D1Database, names: string[]): Promise<RuntimeCopy[]> {
  if (!names.length) return [];
  const rows = await db.prepare(
    `SELECT t.uid, t.role_key, t.status, c.capability
       FROM team_agents t
       LEFT JOIN agent_capabilities c ON c.agent_id = t.id AND c.revoked_at IS NULL
      WHERE t.status != 'removed' AND t.role_key IN (SELECT value FROM json_each(?))
      ORDER BY t.uid, c.capability`,
  ).bind(JSON.stringify(names)).all<{ uid: string; role_key: string; status: string; capability: string | null }>();
  const by = new Map<string, RuntimeCopy>();
  for (const r of rows.results ?? []) {
    const copy = by.get(r.uid) ?? { uid: r.uid, role_key: r.role_key, status: r.status, grants: [] };
    if (r.capability) copy.grants.push(r.capability);
    by.set(r.uid, copy);
  }
  return [...by.values()];
}

/** Apply one sync. Returns what changed; every statement runs in one batch, so a failure leaves the registry as it was. */
export async function applySync(db: D1Database, input: SyncInput) {
  const names = input.manifests.map((m) => m.name);
  const before = await db.prepare(
    `SELECT name, version FROM agent_registry WHERE superseded_at IS NULL`,
  ).all<{ name: string; version: string }>();
  const current = new Map((before.results ?? []).map((r) => [r.name, r.version]));
  const ventureNames = input.manifests.filter((m) => m.kind === 'venture').map((m) => m.name);
  const drift = driftFor(input.manifests, await readCopies(db, ventureNames));
  const stmts = [
    ...input.manifests.map((m) => db.prepare(
      `INSERT INTO agent_registry (name, version, kind, owner, identity, runner_pool, status, manifest_sha, manifest_commit, capabilities_json, models_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name, version) DO UPDATE SET
         status = excluded.status, owner = excluded.owner, identity = excluded.identity, runner_pool = excluded.runner_pool,
         manifest_commit = excluded.manifest_commit, synced_at = CURRENT_TIMESTAMP, superseded_at = NULL`,
    ).bind(m.name, versionOf(m.manifest_sha), m.kind, m.owner, m.identity, m.runner_pool, m.status, m.manifest_sha, input.commit,
      JSON.stringify(m.capabilities), JSON.stringify(m.models))),
    ...input.manifests.map((m) => db.prepare(
      `UPDATE agent_registry SET superseded_at = CURRENT_TIMESTAMP WHERE name = ? AND version != ? AND superseded_at IS NULL`,
    ).bind(m.name, versionOf(m.manifest_sha))),
    db.prepare(
      `UPDATE agent_registry SET superseded_at = CURRENT_TIMESTAMP
        WHERE superseded_at IS NULL AND name NOT IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(names)),
    db.prepare('DELETE FROM agent_registry_drift'),
    ...drift.map((d) => db.prepare(
      `INSERT INTO agent_registry_drift (name, field, manifest_value, runtime_value, agent_uid) VALUES (?, ?, ?, ?, ?)`,
    ).bind(d.name, d.field, d.manifest_value, d.runtime_value, d.agent_uid)),
  ];
  await db.batch(stmts);
  const added = input.manifests.filter((m) => current.get(m.name) !== versionOf(m.manifest_sha)).map((m) => m.name);
  const removed = [...current.keys()].filter((n) => !names.includes(n)).sort();
  return { synced: names.length, new_versions: added, removed, drift: drift.length };
}

const r = new Hono<{ Bindings: Env }>();

r.post('/agent-registry/sync', async (c) => {
  const secret = c.env.AGENT_REGISTRY_TOKEN;
  if (!secret) {
    return refuse(c, 503, { code: 'registry_sync_not_configured', message: 'The agent registry sync is not configured on this deployment.' });
  }
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !constantTimeEqual(token, secret)) {
    return refuse(c, 401, { code: 'registry_sync_unauthorized', message: 'The agent registry token is missing or wrong.' });
  }
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) {
    return refuse(c, 413, { code: 'registry_sync_too_large', message: `A registry sync is at most ${MAX_BYTES} bytes.` });
  }
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = null; }
  const parsed = parseSync(body);
  if (!parsed.ok) return refuse(c, 400, { code: parsed.code, message: parsed.message });
  return c.json(await applySync(c.env.DB, parsed.value));
});

export default r;
export const mount: RouteMount = { path: '/api/internal', router: r };
