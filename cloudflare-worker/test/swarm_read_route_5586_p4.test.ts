/**
 * D5586 part 4 (#5586): the venture's swarm capacity read (/api/work-graph/swarm) and the recorders behind two of its
 * `not_recorded` signals. The real router over the full migrated schema.
 *
 *   1. Flag off: 404 `swarm_read_off` before any D1 read; the mount.
 *   2. Gate: anonymous is refused; a person not linked, a plain member, an archived company, a company whose records
 *      live under another tenant and a company that does not exist all get the same 404, with no existence leak.
 *   3. Capacity: the coordinator is asked for the caller's venture only; unknowns are `not_recorded` and an unreachable
 *      coordinator `unavailable`, never 0; D1's signals stay readable without it.
 *   4. Audit: D1's copy of the venture only, plus the coordinator's entries not yet copied.
 *   5. Recorders: registered agents and image-model calls counted exactly from `team_agents` and `ai_usage_logs`,
 *      bound to the company; a failing statement is `unavailable`; a rate over no calls is `not_recorded`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/swarm_read_route_5586_p4.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import swarmRead, { SWARM_NOT_RECORDED, SWARM_READ_DEPS, mount } from '../src/routes/swarm_read.ts';
import { IMAGE_MODELS, readImageModelCapacity, readRegisteredAgents } from '../src/services/agents/swarmRecorders.ts';
import { WORKSPACE_ADMISSION_OBJECT } from '../src/services/agents/workspaceAdmissionClient.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 11, MEMBER = 12, OUTSIDER = 13, PRIMARY = 14, ADMIN = 1;
const BASE = '/api/work-graph/swarm';
const Q = 'tenant_id=7&company_id=70';
const SCOPE = { tenantId: 7, companyId: 70, projectId: null };

type W = { db: DatabaseSync; env: any };
function fresh(): W {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'HQ', 'hq@example.test');
  for (const id of [OWNER, MEMBER, OUTSIDER, PRIMARY]) u.run(id, 'founder', `P${id}`, `p${id}@example.test`);
  const s = db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))");
  for (const id of [ADMIN, OWNER, MEMBER, OUTSIDER, PRIMARY]) s.run(`s-${id}`, id);
  const l = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES (?, ?, ?, ?, ?)');
  l.run('l-70-o', 70, OWNER, 'Owner', 0);
  l.run('l-70-m', 70, MEMBER, 'Member', 0);
  l.run('l-70-p', 70, PRIMARY, 'Member', 1);
  l.run('l-80-o', 80, OUTSIDER, 'Owner', 0);
  return { db, env: { DB: d1Over(db) } };
}

const app = new Hono<any>();
app.route(BASE, swarmRead);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));
const token = (who: number) => new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder', jti: `s-${who}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));

/** A coordinator namespace that answers `value` and records every call body. */
function coordinator(value: unknown | (() => Response)) {
  const bodies: any[] = [], names: string[] = [];
  const ns = { idFromName: (n: string) => { names.push(n); return { name: n }; },
    get: () => ({ fetch: async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return typeof value === 'function' ? (value as () => Response)() : Response.json({ ok: true, value }); } }) };
  return { ns, bodies, names };
}
function envOf(w: W | null, over: Record<string, unknown> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: w?.env.DB, WORK_GRAPH_SWARM_READ: 'on', ...over } as any;
}
async function get(env: any, path: string, who: number | null = OWNER) {
  const headers: Record<string, string> = {};
  if (who !== null) headers.Authorization = `Bearer ${await token(who)}`;
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`${BASE}${path}`, { headers }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; console.error = e; }
}

const NOW = Date.parse('2026-11-27T12:00:00Z');
SWARM_READ_DEPS.now = () => NOW;
/** A swarm snapshot of venture 7/70 as the coordinator would scope it. */
const SNAP = {
  tickets: {
    run_a: { ticket_uid: 'run_a', tenant_id: 7, company_id: 70, team_id: 1, agent_id: 9, modality: 'document', provider: 'cloudflare', model: 'm', region: 'weur',
      asset_uid: 'a1', base_revision_uid: null, reserve_microusd: 100, ceiling_microusd: 200, storage_bytes: 0, state: 'waiting', sequence: 1,
      enqueued_at: NOW - 5000, admitted_at: null, settled_at: null, reserve_held_microusd: 100, reserve_basis: 'quote', charged_microusd: null,
      measured: null, wait_reason: 'venture_capacity', end_code: null },
  },
  next_sequence: 2, last_now: NOW, audit: [
    { seq: 3, at: NOW, ticket_uid: 'run_a', tenant_id: 7, company_id: 70, action: 'request', outcome: 'queued', code: 'venture_capacity' },
    { seq: 4, at: NOW, ticket_uid: 'run_b', tenant_id: 7, company_id: 70, action: 'request', outcome: 'refused', code: 'budget_exhausted' },
  ], audit_seq: 4, audit_dropped: 0, audit_flushed_seq: 3,
  retired: { uids: {}, order: [], dropped: 0, tickets: { 't7:c70': 2 }, charged: { 't7:c70': 1500 }, render: {}, audit_compacted: 0 },
};

// -------------------------------------------------------------------------------------------------------------------

test('1. flag off: 404 swarm_read_off before any D1 read; mounted at /api/work-graph/swarm', async () => {
  assert.equal(mount.path, '/api/work-graph/swarm');
  const touched: string[] = [];
  const DB = new Proxy({}, { get(_t, k) { touched.push(String(k)); throw new Error('D1 touched'); } });
  for (const flag of [undefined, 'off', 'ON', 'true', 'preview']) {
    const r = await get({ JWT_SECRET, DB, WORK_GRAPH_SWARM_READ: flag }, `/capacity?${Q}`);
    assert.deepEqual([r.status, r.body.error], [404, 'swarm_read_off']);
    assert.equal((await get({ JWT_SECRET, DB, WORK_GRAPH_SWARM_READ: flag }, `/audit?${Q}`)).status, 404);
  }
  assert.deepEqual(touched, []);
});

test('2. gate: every refusal is the same 404, whether not linked, the wrong role, archived, another tenant or no company', async () => {
  const w = fresh();
  const c = coordinator(SNAP);
  const env = envOf(w, { WORKSPACE_ADMISSION: c.ns });
  assert.equal((await get(env, `/capacity?${Q}`, null)).status, 401, 'a session is required');
  assert.equal((await get(env, '/capacity?tenant_id=7&company_id=x')).status, 400);
  const nobody = await get(env, '/capacity?tenant_id=7&company_id=999');
  assert.equal(nobody.status, 404);
  const same = (r: { status: number; body: any }, why: string) => assert.deepEqual([r.status, r.body], [nobody.status, nobody.body], why);
  for (const path of ['/capacity', '/audit']) {
    same(await get(env, `${path}?${Q}`, OUTSIDER), 'not linked');
    same(await get(env, `${path}?${Q}`, MEMBER), 'a plain member');
    same(await get(env, `${path}?${Q}`, ADMIN), 'a platform admin without a seat');
    same(await get(env, `${path}?tenant_id=8&company_id=80`, OWNER), 'another venture');
  }
  assert.equal((await get(env, `/capacity?${Q}`, PRIMARY)).status, 200, 'the primary admin');
  assert.equal((await get(env, `/capacity?${Q}`, OWNER)).status, 200, 'an owner');
  assert.equal(c.bodies.length, 2, 'the coordinator was asked only after the gate passed');
  // Another tenant: company 70's swarm records live under tenant 9, so naming tenant 7 is refused like the rest.
  w.db.prepare("INSERT INTO swarm_admission_events (tenant_id, company_id, seq, at, ticket_uid, action, outcome, code) VALUES (9, 70, 1, 1, 'run_z', 'request', 'applied', NULL)").run();
  same(await get(env, `/capacity?${Q}`, OWNER), 'records under another tenant');
  same(await get(env, `/audit?${Q}`, OWNER), 'records under another tenant');
  assert.equal((await get(env, '/capacity?tenant_id=9&company_id=70', OWNER)).status, 200, 'its own tenant reads');
  w.db.prepare('DELETE FROM user_company_links WHERE company_id = 80').run();
  // Archived: the link no longer counts.
  w.db.prepare("INSERT INTO company_profiles (id, uid, company_name, archived_at) VALUES (71, 'co-71', 'Gone', datetime('now'))").run();
  w.db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company) VALUES ('l-71', 71, ?, 'Owner')").run(OWNER);
  same(await get(env, '/capacity?tenant_id=7&company_id=71', OWNER), 'an archived company');
  assert.equal(c.bodies.length, 3);
});

test('3. capacity: the caller\'s venture only; unknowns are not_recorded, an unreachable coordinator unavailable, never 0', async () => {
  const w = fresh();
  const c = coordinator(SNAP);
  const r = await get(envOf(w, { WORKSPACE_ADMISSION: c.ns }), `/capacity?${Q}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(c.names, [WORKSPACE_ADMISSION_OBJECT]);
  assert.deepEqual(c.bodies, [{ op: 'swarm.snapshotFor', caller: { tenantId: 7, companyId: 70 }, args: [{ tenant_id: 7, company_id: 70 }] }]);
  const b = r.body;
  assert.equal(b.admission, 'read');
  assert.equal(b.capacity.backlog.waiting, 1);
  assert.deepEqual(b.capacity.backlog.by_reason, { venture_capacity: 1 });
  const v = b.capacity.by_venture['t7:c70'];
  assert.deepEqual([v.waiting, v.max_concurrent, v.budget, v.storage], [1, 'not_recorded', 'not_recorded', 'not_recorded'], 'no policy record: not 0');
  assert.equal(b.capacity.costs.total, 'not_recorded');
  assert.equal(b.capacity.registered_agents, 0, 'a recorded count of none');
  assert.deepEqual(b.registered_agents, { registered: 0, active: 0, paused: 0 });
  for (const k of ['github_pr_ci_wait', 'preview_transcoding', 'egress']) assert.equal(b.bottlenecks[k], 'not_recorded');
  assert.deepEqual(b.bottlenecks.image_model_capacity, { basis: 'venture_agents', calls: 0, all_models_failed: 0, budget_refused: 0, fallback_used: 0, failure_rate: 'not_recorded' });
  assert.equal(b.bottlenecks.d1_conflicts.conflict_rate, 'not_recorded', 'no attempts is not 0%');
  assert.deepEqual(b.retention, { retention_ms: 30 * 86_400_000, retired_tickets: 2, retired_charged_microusd: 1500 });
  assert.deepEqual(b.not_recorded, [...SWARM_NOT_RECORDED]);
  assert.equal(b.since, new Date(NOW - 7 * 86_400_000).toISOString());

  // No coordinator: the snapshot sections are unavailable; D1's signals still read.
  const off = (await get(envOf(w), `/capacity?${Q}`)).body;
  assert.deepEqual([off.admission, off.capacity, off.retention], [{ state: 'unavailable', code: 'admission_unbound' }, 'unavailable', 'unavailable']);
  assert.equal(typeof off.bottlenecks, 'object');
  const broken = (await get(envOf(w, { WORKSPACE_ADMISSION: coordinator(() => new Response('x', { status: 500 })).ns }), `/capacity?${Q}`)).body;
  assert.deepEqual(broken.admission, { state: 'unavailable', code: 'admission_unavailable' });
  // `since` is bounded to 30 days and must be a past time.
  const far = (await get(envOf(w), `/capacity?${Q}&since=2000-01-01T00:00:00Z`)).body;
  assert.equal(far.since, new Date(NOW - 30 * 86_400_000).toISOString());
  assert.equal((await get(envOf(w), `/capacity?${Q}&since=2999-01-01T00:00:00Z`)).status, 400);
  assert.equal((await get(envOf(w), `/capacity?${Q}&since=nope`)).status, 400);
});

test('4. audit: D1\'s copy of this venture only, and the coordinator\'s entries not yet copied', async () => {
  const w = fresh();
  const ins = w.db.prepare('INSERT INTO swarm_admission_events (tenant_id, company_id, seq, at, ticket_uid, action, outcome, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run(7, 70, 1, 10, 'run_a', 'request', 'applied', null);
  ins.run(7, 70, 2, 11, 'run_b', 'request', 'refused', 'budget_exhausted');
  ins.run(8, 80, 5, 12, 'run_x', 'request', 'applied', null);
  const r = await get(envOf(w, { WORKSPACE_ADMISSION: coordinator(SNAP).ns }), `/audit?${Q}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.events.map((e: any) => [e.tenant_id, e.company_id, e.seq]), [[7, 70, 1], [7, 70, 2]]);
  assert.deepEqual(r.body.pending_copy.map((e: any) => e.seq), [4], 'only above the watermark');
  const one = await get(envOf(w, { WORKSPACE_ADMISSION: coordinator(SNAP).ns }), `/audit?${Q}&ticket_uid=run_b`);
  assert.deepEqual([one.body.events.map((e: any) => e.seq), one.body.pending_copy.map((e: any) => e.seq)], [[2], [4]]);
  const off = await get(envOf(w), `/audit?${Q}&limit=1`);
  assert.deepEqual([off.body.events.length, off.body.pending_copy], [1, 'unavailable']);
  assert.equal((await get(envOf(w), `/audit?${Q}&ticket_uid=${encodeURIComponent('a b')}`)).status, 400);
});

test('5. recorders: exact counts from team_agents and ai_usage_logs, bound to the company; failure is unavailable', async () => {
  const w = fresh();
  w.db.prepare("INSERT INTO projects (id, name, company_id) VALUES (500, 'P', 70), (501, 'Q', 80)").run();
  const agent = w.db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, company_id, project_id, role_key, model_id, sponsor_user_id, monthly_cap_microusd, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'm', ?, 1000, ?, ?)`);
  agent.run(1, 'ag1', 'company', 70, null, 'r1', OWNER, 'active', OWNER);
  agent.run(2, 'ag2', 'company', 70, null, 'r2', OWNER, 'paused', OWNER);
  agent.run(3, 'ag3', 'company', 70, null, 'r1', OWNER, 'removed', OWNER);
  agent.run(4, 'ag4', 'project', null, 500, 'r1', OWNER, 'active', OWNER);
  agent.run(5, 'ag5', 'company', 80, null, 'r1', OUTSIDER, 'active', OUTSIDER);
  agent.run(6, 'ag6', 'project', null, 501, 'r1', OUTSIDER, 'active', OUTSIDER);
  assert.deepEqual(await readRegisteredAgents(w.env, SCOPE), { registered: 3, active: 2, paused: 1 });

  const img = IMAGE_MODELS[0];
  assert.ok(IMAGE_MODELS.length >= 2 && IMAGE_MODELS.every(m => typeof m === 'string'));
  const call = w.db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, refusal, fallback_used, agent_id, created_at) VALUES (?, 'deck_image', ?, ?, ?, ?, ?)");
  const recent = new Date(NOW - 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  const old = new Date(NOW - 20 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  call.run(OWNER, img, null, 0, 1, recent);
  call.run(OWNER, img, null, 1, 4, recent);                  // a project agent of the company, fell back
  call.run(OWNER, IMAGE_MODELS[1], 'all_models_failed', 0, 2, recent);
  call.run(OWNER, img, 'budget_org_month', 0, 3, recent);    // a removed agent's call still happened
  call.run(OWNER, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'all_models_failed', 0, 1, recent); // not an image model
  call.run(OWNER, img, 'all_models_failed', 0, 1, old);       // before the window
  call.run(OUTSIDER, img, 'all_models_failed', 0, 5, recent); // another company
  call.run(OUTSIDER, img, null, 0, 6, recent);                // another company's project
  call.run(OWNER, img, 'all_models_failed', 0, null, recent); // a person's call: no company
  const since = new Date(NOW - 7 * 86_400_000).toISOString();
  assert.deepEqual(await readImageModelCapacity(w.env, SCOPE, since),
    { basis: 'venture_agents', calls: 4, all_models_failed: 1, budget_refused: 1, fallback_used: 1, failure_rate: 0.25 });
  assert.deepEqual(await readImageModelCapacity(w.env, { ...SCOPE, companyId: 71 }, since),
    { basis: 'venture_agents', calls: 0, all_models_failed: 0, budget_refused: 0, fallback_used: 0, failure_rate: 'not_recorded' });

  const down = { DB: { prepare: () => { throw new Error('D1 down'); } } } as any;
  assert.equal(await readRegisteredAgents(down, SCOPE), 'unavailable');
  assert.equal(await readImageModelCapacity(down, SCOPE, since), 'unavailable');
  // Through the route: the counts reach the read model, and a failure there is unavailable, not 0 or not_recorded.
  const r = (await get(envOf(w, { WORKSPACE_ADMISSION: coordinator(SNAP).ns }), `/capacity?${Q}`)).body;
  assert.equal(r.capacity.registered_agents, 3);
  assert.equal(r.bottlenecks.image_model_capacity.calls, 4);
  w.db.exec('DROP TABLE ai_usage_logs');
  const r2 = (await get(envOf(w, { WORKSPACE_ADMISSION: coordinator(SNAP).ns }), `/capacity?${Q}`)).body;
  assert.equal(r2.bottlenecks.image_model_capacity, 'unavailable');
  w.db.exec('DROP TABLE team_agents');
  const r3 = (await get(envOf(w, { WORKSPACE_ADMISSION: coordinator(SNAP).ns }), `/capacity?${Q}`)).body;
  assert.deepEqual([r3.registered_agents, r3.capacity.registered_agents], ['unavailable', 'unavailable']);
});
