/**
 * D8080 (#8080): the agent registry. Synthetic data on the real migrated schema in memory, through the mounted
 * routers.
 *
 *   1. the sync refuses with no secret (503) and a missing or wrong token (401), and stores nothing;
 *   2. a bad body is refused (400) with the field it got wrong;
 *   3. the sync upserts idempotently: a re-post changes no row count; a new manifest version supersedes the old one;
 *      a name no longer posted is superseded;
 *   4. drift: a venture manifest against its live team-agent copies, status and capabilities; a platform manifest
 *      is never compared; drift is replaced whole by each sync;
 *   5. the read: Super Admin only, "not recorded" before any sync, current versions only, null (not zero) copies
 *      and drift for platform agents;
 *   6. the sync script builds its body from the real manifests and refuses a folder that fails the guard.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_registry_8080.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import internal, { driftFor, mount as syncMount, parseSync, versionOf } from '../src/routes/internal_agent_registry.ts';
import { mount as rosterMounts } from '../src/routes/admin_ai_agents_roster.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
// @ts-expect-error a plain .mjs script, no declarations
import { entryFor, run as runSync, syncBody } from '../../scripts/deploy/sync-agent-registry.mjs';

const TOKEN = 'agent-registry-test-token-0123456789abcdef';
const JWT_SECRET = 'synthetic-d8080-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const COMMIT = 'c'.repeat(40);
const SUPER = 1, PLAIN_ADMIN = 2, FOUNDER = 3;
const sha = (ch: string) => ch.repeat(64);
const manifest = (name: string, over: Record<string, unknown> = {}) => ({
  name, kind: 'platform', owner: 'S01', identity: 'session', runner_pool: 'none', status: 'live',
  manifest_sha: sha('1'), capabilities: ['code.read'], models: [], ...over,
});
const venture = (over: Record<string, unknown> = {}) => manifest('market-researcher', {
  kind: 'venture', owner: 'owner', manifest_sha: sha('2'), capabilities: ['research.read', 'web.search'], ...over,
});

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, is_active, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, 1, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'synthetic-super@example.invalid', 'Ada Super', 'admin', null);
  user.run(PLAIN_ADMIN, 'u-admin', 'synthetic-admin@example.invalid', 'Pat Admin', 'admin', null);
  user.run(FOUNDER, 'u-founder', 'synthetic-founder@example.invalid', 'Femi Founder', 'founder', 200);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec("INSERT INTO company_profiles (id, uid, company_name) VALUES (10, 'co-10', 'Northwind Labs'), (11, 'co-11', 'Bluefern Health')");
  const agent = db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, company_id, role_key, model_id, sponsor_user_id, monthly_cap_microusd, status, created_by)
    VALUES (?, ?, 'company', ?, ?, 'm', ?, 1000000, ?, ?)`);
  // One live agent per role per team (idx_team_agents_live_role): the copies sit in two companies.
  agent.run(100, 'a100a100a100a100a100a100a100a100', 10, 'market-researcher', FOUNDER, 'active', FOUNDER);
  agent.run(101, 'a101a101a101a101a101a101a101a101', 11, 'market-researcher', FOUNDER, 'paused', FOUNDER);
  agent.run(102, 'a102a102a102a102a102a102a102a102', 10, 'market-researcher', FOUNDER, 'removed', FOUNDER);
  const grant = db.prepare(`INSERT INTO agent_capabilities (agent_id, capability, granted_by, grant_reason, revoked_at, revoked_by, revoke_reason) VALUES (?, ?, ?, 'fixture', ?, ?, ?)`);
  grant.run(100, 'research.read', SUPER, null, null, null);
  grant.run(100, 'code.pr', SUPER, null, null, null);
  grant.run(100, 'email.draft', SUPER, '2026-11-01 00:00:00', SUPER, 'revoked in the fixture');
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AGENT_REGISTRY_TOKEN: TOKEN };
  const app = new Hono<any>();
  app.route(syncMount.path, internal);
  for (const m of rosterMounts) app.route(m.path, m.router);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;

async function sync(f: F, body: unknown, o: { token?: string | null; secret?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = o.token === undefined ? TOKEN : o.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const env = { ...f.env, AGENT_REGISTRY_TOKEN: o.secret === null ? undefined : o.secret ?? TOKEN };
  const res = await f.app.request('/api/internal/agent-registry/sync', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const jwt = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function read(f: F, who: number | null) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (who) headers.Authorization = `Bearer ${await jwt(who)}`;
  const res = await f.app.request(`${ORIGIN}/api/admin/ai-agents/registry`, { headers }, f.env);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}
const count = (f: F, t: string, where = '1=1') => Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`).get() as any).n);

test('8080: the sync and the read are mounted where the issue says', () => {
  assert.equal(syncMount.path, '/api/internal');
  assert.deepEqual(rosterMounts.map((m) => m.path), ['/api/admin/ai-agents/roster', '/api/admin/ai-agents/registry']);
});

test('8080: no secret, no token or a wrong token: refused, nothing stored', async () => {
  const f = fixture();
  const body = { commit: COMMIT, manifests: [manifest('coordinator')] };
  assert.equal((await sync(f, body, { secret: null })).status, 503);
  assert.equal((await sync(f, body, { token: null })).status, 401);
  const wrong = await sync(f, body, { token: 'nope' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'registry_sync_unauthorized');
  assert.equal(count(f, 'agent_registry'), 0);
});

test('8080: a bad body names its field, and stores nothing', async () => {
  const f = fixture();
  const cases: Array<[unknown, RegExp]> = [
    ['not json', /not a JSON object/],
    [{ commit: 'abc', manifests: [manifest('a')] }, /`commit`/],
    [{ commit: COMMIT, manifests: [] }, /`manifests`/],
    [{ commit: COMMIT, manifests: [manifest('a'), manifest('a')] }, /listed twice/],
    [{ commit: COMMIT, manifests: [manifest('a', { kind: 'other' })] }, /kind/],
    [{ commit: COMMIT, manifests: [manifest('a', { status: 'gone' })] }, /status/],
    [{ commit: COMMIT, manifests: [manifest('a', { manifest_sha: 'x' })] }, /manifest_sha/],
    [{ commit: COMMIT, manifests: [manifest('a', { capabilities: ['Bad Name'] })] }, /capabilities/],
    [{ commit: COMMIT, manifests: [manifest('A')] }, /name/],
  ];
  for (const [body, why] of cases) {
    const r = await sync(f, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, 'registry_sync_invalid');
    assert.match(r.body.message ?? r.body.detail, why);
  }
  assert.equal(count(f, 'agent_registry'), 0);
  assert.equal((await sync(f, 'x'.repeat(300 * 1024))).status, 413);
});

test('8080: the sync upserts idempotently, supersedes old versions and names no longer posted', async () => {
  const f = fixture();
  const first = await sync(f, { commit: COMMIT, manifests: [manifest('coordinator'), manifest('keeper', { manifest_sha: sha('3'), status: 'paused' })] });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { synced: 2, new_versions: ['coordinator', 'keeper'], removed: [], drift: 0 });
  const row = f.db.prepare("SELECT * FROM agent_registry WHERE name = 'keeper'").get() as any;
  assert.equal(row.version, '333333333333', 'the first 12 hex of the manifest sha');
  assert.equal(row.status, 'paused');
  assert.equal(row.manifest_commit, COMMIT);
  assert.equal(row.stage, null, 'stage is not in the manifest schema, so it is not invented');
  assert.equal(row.cost_profile, null);
  // The same post again: nothing new.
  const again = await sync(f, { commit: COMMIT, manifests: [manifest('coordinator'), manifest('keeper', { manifest_sha: sha('3'), status: 'paused' })] });
  assert.deepEqual(again.body, { synced: 2, new_versions: [], removed: [], drift: 0 });
  assert.equal(count(f, 'agent_registry'), 2);
  // keeper changes (a new version); coordinator is no longer in the folder.
  const later = await sync(f, { commit: 'd'.repeat(40), manifests: [manifest('keeper', { manifest_sha: sha('4') })] });
  assert.deepEqual(later.body, { synced: 1, new_versions: ['keeper'], removed: ['coordinator'], drift: 0 });
  assert.equal(count(f, 'agent_registry'), 3);
  assert.equal(count(f, 'agent_registry', 'superseded_at IS NULL'), 1);
  assert.equal((f.db.prepare('SELECT version FROM agent_registry WHERE superseded_at IS NULL').get() as any).version, versionOf(sha('4')));
  // A revert to the old bytes revives that version's row, not a duplicate.
  await sync(f, { commit: COMMIT, manifests: [manifest('keeper', { manifest_sha: sha('3') })] });
  assert.equal(count(f, 'agent_registry'), 3);
  assert.equal((f.db.prepare('SELECT version FROM agent_registry WHERE superseded_at IS NULL').get() as any).version, versionOf(sha('3')));
});

test('8080: drift rows for a fixture mismatch, replaced whole by the next sync', async () => {
  const f = fixture();
  const r = await sync(f, { commit: COMMIT, manifests: [manifest('coordinator'), venture()] });
  assert.equal(r.body.drift, 2);
  const rows = f.db.prepare('SELECT name, field, manifest_value, runtime_value, agent_uid FROM agent_registry_drift ORDER BY agent_uid, field').all() as any[];
  assert.deepEqual(rows.map((d) => ({ ...d })), [
    // a100: live grant code.pr is outside the manifest (the revoked email.draft is not counted).
    { name: 'market-researcher', field: 'capabilities', manifest_value: '["research.read","web.search"]', runtime_value: '["code.pr"]', agent_uid: 'a100a100a100a100a100a100a100a100' },
    // a101 is paused while the manifest is live. The removed a102 is not a copy.
    { name: 'market-researcher', field: 'status', manifest_value: 'live', runtime_value: 'paused', agent_uid: 'a101a101a101a101a101a101a101a101' },
  ]);
  // The manifest catches up: a wildcard covers code.*, and it is paused. a100 (active) now disagrees on status.
  const next = await sync(f, { commit: COMMIT, manifests: [venture({ manifest_sha: sha('5'), status: 'paused', capabilities: ['research.read', 'code.*'] })] });
  assert.equal(next.body.drift, 1);
  assert.deepEqual({ ...(f.db.prepare('SELECT field, runtime_value, agent_uid FROM agent_registry_drift').get() as any) },
    { field: 'status', runtime_value: 'active', agent_uid: 'a100a100a100a100a100a100a100a100' });
  // A retired manifest: every live copy is drift.
  assert.equal(driftFor([parseSync({ commit: COMMIT, manifests: [venture({ status: 'retired' })] }).ok ? (parseSync({ commit: COMMIT, manifests: [venture({ status: 'retired' })] }) as any).value.manifests[0] : null],
    [{ uid: 'x', role_key: 'market-researcher', status: 'active', grants: [] }]).length, 1);
  // A platform manifest that shares a role key is never compared.
  assert.deepEqual(driftFor([{ ...(venture() as any), kind: 'platform' }], [{ uid: 'x', role_key: 'market-researcher', status: 'paused', grants: ['code.pr'] }]), []);
});

test('8080: the read is Super Admin only', async () => {
  const f = fixture();
  assert.equal((await read(f, null)).status, 401);
  assert.equal((await read(f, FOUNDER)).status, 403);
  assert.equal((await read(f, PLAIN_ADMIN)).status, 403);
  assert.equal((await read(f, SUPER)).status, 200);
});

test('8080: before any sync the read says not recorded, never an empty catalogue', async () => {
  const f = fixture();
  assert.deepEqual((await read(f, SUPER)).body, { status: 'not_recorded', agents: [], synced_at: null, manifest_commit: null });
});

test('8080: the read lists current versions, with null copies and drift for platform agents', async () => {
  const f = fixture();
  await sync(f, { commit: COMMIT, manifests: [manifest('coordinator', { manifest_sha: sha('6') }), venture()] });
  await sync(f, { commit: COMMIT, manifests: [manifest('coordinator'), venture()] });
  const r = await read(f, SUPER);
  assert.equal(r.body.status, 'recorded');
  assert.equal(r.body.manifest_commit, COMMIT);
  assert.equal(r.body.budgets_compared, false);
  assert.deepEqual(r.body.agents.map((a: any) => [a.name, a.version]), [['coordinator', versionOf(sha('1'))], ['market-researcher', versionOf(sha('2'))]]);
  const [platform, v] = r.body.agents;
  assert.equal(platform.live_copies, null);
  assert.equal(platform.drift, null);
  assert.equal(platform.drift_count, null);
  assert.deepEqual(platform.capabilities, ['code.read']);
  assert.equal(platform.capabilities_json, undefined);
  assert.equal(v.live_copies, 2, 'active and paused; removed is not a copy');
  assert.equal(v.drift_count, 2);
  assert.equal(v.last_run, null);
  assert.doesNotMatch(r.text, /@example\.invalid/);
});

test('8080: the sync script builds its body from the real manifests and refuses a failing folder', async () => {
  const body = syncBody(new URL('../../agents', import.meta.url).pathname, COMMIT);
  assert.ok(body.body, JSON.stringify(body.problems));
  assert.ok(body.body.manifests.length >= 6);
  assert.ok(parseSync(body.body).ok, 'what the script posts, the route accepts');
  const coord = body.body.manifests.find((m: any) => m.name === 'coordinator');
  assert.deepEqual(Object.keys(coord).sort(), ['capabilities', 'identity', 'kind', 'manifest_sha', 'models', 'name', 'owner', 'runner_pool', 'status']);
  assert.match(entryFor('name: x\n').manifest_sha, /^[0-9a-f]{64}$/);
  const dir = mkdtempSync(join(tmpdir(), 'agents-'));
  writeFileSync(join(dir, 'bad.agent.yml'), 'name: bad\n');
  assert.ok(syncBody(dir, COMMIT).problems.length > 0);
  assert.deepEqual(syncBody(new URL('../../agents', import.meta.url).pathname, 'main').problems, ['GITHUB_SHA is not a 40-character commit sha']);
  // No token: nothing posted, exit 1. A refusal from the route: exit 1. Accepted: exit 0, and the token is never logged.
  const posted: any[] = [];
  const logs: string[] = [];
  const fetchImpl = async (url: string, init: any) => { posted.push({ url, init }); return new Response(JSON.stringify({ synced: 6, new_versions: [], removed: [], drift: 0 }), { status: 200 }); };
  const quiet = { log: (s: string) => logs.push(s), error: (s: string) => logs.push(s) };
  assert.equal(await runSync({ env: { GITHUB_SHA: COMMIT }, argv: [], fetchImpl, ...quiet }), 1);
  assert.equal(posted.length, 0);
  assert.equal(await runSync({ env: { GITHUB_SHA: COMMIT, AGENT_REGISTRY_TOKEN: TOKEN }, argv: [], fetchImpl, ...quiet }), 0);
  assert.equal(posted[0].url, 'https://axal.vc/api/internal/agent-registry/sync');
  assert.equal(posted[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  const refusing = async () => new Response(JSON.stringify({ error: 'registry_sync_unauthorized' }), { status: 401 });
  assert.equal(await runSync({ env: { GITHUB_SHA: COMMIT, AGENT_REGISTRY_TOKEN: TOKEN }, argv: [], fetchImpl: refusing, ...quiet }), 1);
  assert.ok(logs.every((l) => !l.includes(TOKEN)), 'the token is never printed');
});
