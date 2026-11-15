/** D5624 (#5624): a team's Landing settings — flag, gates, the contract's refusals, null reads, the change log, stale saves. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamLanding, { mount } from '../src/routes/team_landing.ts';
import agentEngineRoutes from '../src/routes/agent_engine.ts';
import { HQ_LANDING_CAPS, validateLandingPolicy } from '../../merge-control/contract/landingPolicy.ts';
import { PROVIDERS } from '../src/services/agents/workspaceSpec.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MIGRATION = sql('migrations/202611132316_5624_agent_landing_settings.sql');

const EDITOR = 10, MEMBER = 11, STRANGER = 12, OTHER_EDITOR = 13;
const REPO = 'a'.repeat(32), OTHER_REPO = 'b'.repeat(32), REVOKED = 'c'.repeat(32);
const AGENT = 'agent-cfo-1';

function world(flags: Record<string, string | undefined> = {}) {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'project_members'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(stripForeignKeys(sql('migrations/712_team_agents.sql')));
  db.exec(stripForeignKeys(sql('migrations/202611122104_5569_venture_git_installations.sql')));
  db.exec(stripForeignKeys(MIGRATION));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, 'founder', ?, 'growth', 'active')");
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 100);
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 101);
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 102);
  user.run(OTHER_EDITOR, 'u-other', 'other@example.test', 'Oz Other', 103);
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-1', 'Acme'), (2, 'co-2', 'Globex')").run();
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', EDITOR, 1, 'Founder'); link.run('l2', MEMBER, 1, 'Member'); link.run('l3', OTHER_EDITOR, 2, 'Founder');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (7, 'p7', 'Rocket', 100, 1), (9, 'p9', 'Other', 103, 2)").run();
  const repo = db.prepare(`INSERT INTO venture_git_installations (uid, tenant_id, company_id, project_id, app_id, installation_id, repository_id,
    repository_full_name, base_ref, approved_at, approved_by_user_id, revoked_at) VALUES (?, ?, ?, ?, 1, 2, ?, ?, 'refs/heads/main', '2026-11-12', ?, ?)`);
  repo.run(REPO, 1, 1, 7, 30, 'acme/rocket', EDITOR, null);
  repo.run(OTHER_REPO, 2, 2, 9, 31, 'globex/other', OTHER_EDITOR, null);
  repo.run(REVOKED, 1, 1, 7, 32, 'acme/old', EDITOR, '2026-11-12');
  db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, project_id, role_key, model_id, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'company', 1, NULL, 'cfo', 'm', ?, 1000, ?)`).run(AGENT, EDITOR, EDITOR);
  const env: any = {
    DB, JWT_SECRET: 'd5624-fixture-only-secret', ENVIRONMENT: 'development',
    TEAM_AGENTS_ENABLED: 'true', AGENT_ENGINE: 'do', TEAM_LANDING: 'true', ...flags,
  };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamLanding);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
}
const CO = '/company/co-1/landing';
const rows = (w: W) => (w.db.prepare('SELECT COUNT(*) AS n FROM agent_landing_settings').get() as any).n as number;
const logs = (w: W) => w.db.prepare('SELECT * FROM agent_landing_setting_changes ORDER BY id').all() as any[];

test('flag unset, or the agent engine off: both routes answer 404 team_landing_off', async () => {
  for (const flags of [{ TEAM_LANDING: undefined }, { TEAM_LANDING: 'false' }, { AGENT_ENGINE: 'off' }, { TEAM_AGENTS_ENABLED: undefined }]) {
    const w = world(flags);
    for (const [method, body] of [['GET', undefined], ['PUT', { max_parallel_per_repo: 2 }]] as const) {
      const r = await call(w, EDITOR, method, CO, body);
      assert.equal(r.status, 404, `${JSON.stringify(flags)} ${method}`);
      assert.equal(r.body.error, 'team_landing_off');
    }
    assert.equal(rows(w), 0);
  }
});

test('mounted ahead of agent_engine, so team_agents\' `*` middleware never answers for it', () => {
  assert.equal(mount.path, '/api/teams');
  assert.deepEqual(mount.before, [agentEngineRoutes]);
});

test('a member reads every field as null; a member may not save; a non-member gets 404 for both', async () => {
  const w = world();
  const r = await call(w, MEMBER, 'GET', CO);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.landing, {
    repository: null, landing: null, repair: null, path_owners: null,
    max_parallel_per_repo: null, compute_budget_microusd: null, executors: null,
  });
  assert.equal(r.body.version, 0);
  assert.equal(r.body.can_manage, false);
  assert.deepEqual(r.body.caps.executors, [...PROVIDERS]);

  const put = await call(w, MEMBER, 'PUT', CO, { max_parallel_per_repo: 2 });
  assert.equal(put.status, 403);
  assert.equal(put.body.error, 'not_manager');

  for (const method of ['GET', 'PUT']) {
    const s = await call(w, STRANGER, method, CO, method === 'PUT' ? { max_parallel_per_repo: 2 } : undefined);
    assert.equal(s.status, 404, method);
    assert.equal(s.body.error, 'not_found');
  }
  // Another company's editor cannot reach this one either.
  assert.equal((await call(w, OTHER_EDITOR, 'PUT', CO, { max_parallel_per_repo: 2 })).status, 404);
  assert.equal(rows(w), 0);
  assert.equal(logs(w).length, 0);
});

test('refusals name the field and store nothing', async () => {
  const w = world();
  const cases: Array<[unknown, string]> = [
    [{ landing: { auto_tiers: ['T0', 'T2'], t2_signers: [] } }, 'landing.auto_tiers'],
    [{ landing: { auto_tiers: ['T0'], t2_signers: [{ kind: 'agent', uid: AGENT }] } }, 'landing.t2_signers'],
    // A person reference carrying an agent's uid is not a person on the team.
    [{ landing: { auto_tiers: ['T0'], t2_signers: [{ kind: 'person', uid: AGENT }] } }, 'landing.t2_signers'],
    [{ landing: { auto_tiers: ['T0'], t2_signers: [{ kind: 'person', uid: 'u-stranger' }] } }, 'landing.t2_signers'],
    [{ landing: { auto_tiers: ['T0'], t2_signers: [], extra: 1 } }, 'landing.extra'],
    [{ merge_everything: true }, 'merge_everything'],
    [{}, 'body'],
    [{ max_parallel_per_repo: HQ_LANDING_CAPS.max_parallel_per_repo + 1 }, 'max_parallel_per_repo'],
    [{ compute_budget_microusd: HQ_LANDING_CAPS.compute_budget_microusd + 1 }, 'compute_budget_microusd'],
    [{ repair: { max_attempts: HQ_LANDING_CAPS.repair_max_attempts + 1, max_spend_microusd: 0, pushers: [] } }, 'repair.max_attempts'],
    [{ repair: { max_attempts: 1, max_spend_microusd: 0, pushers: [{ kind: 'agent', uid: 'not-ours' }] } }, 'repair.pushers'],
    [{ executors: ['cloudflare', 'mainframe'] }, 'executors'],
    [{ repository: OTHER_REPO }, 'repository'],
    [{ repository: REVOKED }, 'repository'],
    [{ repository: 'https://github.com/acme/rocket' }, 'repository'],
    [{ path_owners: [{ path: '../secrets', owners: [{ kind: 'person', uid: 'u-editor' }] }] }, 'path_owners.path'],
    [{ path_owners: [{ path: 'src/**', owners: [] }] }, 'path_owners.owners'],
    [{ version: 'x', max_parallel_per_repo: 2 }, 'version'],
  ];
  for (const [body, field] of cases) {
    const r = await call(w, EDITOR, 'PUT', CO, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, 'invalid_landing', JSON.stringify(body));
    assert.equal(r.body.field, field, JSON.stringify(body));
  }
  assert.equal(rows(w), 0);
  assert.equal(logs(w).length, 0);
});

test('a save stores what was sent, leaves the rest null, and writes one change-log row each time', async () => {
  const w = world();
  const first = await call(w, EDITOR, 'PUT', CO, {
    repository: REPO,
    landing: { auto_tiers: ['T1', 'T0', 'T1'], t2_signers: [{ kind: 'person', uid: 'u-member' }, { kind: 'person', uid: 'u-editor' }] },
    repair: { max_attempts: 2, max_spend_microusd: 1_000_000, pushers: [{ kind: 'agent', uid: AGENT }] },
    executors: ['cloudflare'],
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.version, 1);
  assert.deepEqual(first.body.landing.landing, {
    auto_tiers: ['T0', 'T1'], t2_signers: [{ kind: 'person', uid: 'u-editor' }, { kind: 'person', uid: 'u-member' }],
  });
  assert.equal(first.body.landing.max_parallel_per_repo, null);
  assert.equal(first.body.landing.path_owners, null);
  assert.equal(first.body.landing.compute_budget_microusd, null);

  let log = logs(w);
  assert.equal(log.length, 1);
  assert.equal(log[0].actor_user_id, EDITOR);
  assert.equal(JSON.parse(log[0].before_json).repository, null);
  assert.equal(JSON.parse(log[0].after_json).repository, REPO);

  const second = await call(w, EDITOR, 'PUT', CO, { repository: null, max_parallel_per_repo: 3, version: 1 });
  assert.equal(second.status, 200);
  assert.equal(second.body.version, 2);
  assert.equal(second.body.landing.repository, null);
  assert.equal(second.body.landing.max_parallel_per_repo, 3);
  assert.deepEqual(second.body.landing.executors, ['cloudflare']);

  log = logs(w);
  assert.equal(log.length, 2);
  assert.equal(JSON.parse(log[1].before_json).repository, REPO);
  assert.equal(JSON.parse(log[1].after_json).max_parallel_per_repo, 3);
  assert.equal(rows(w), 1);

  const read = await call(w, MEMBER, 'GET', CO);
  assert.deepEqual(read.body.landing, second.body.landing);
});

test('a save from a stale read is 409 landing_changed and logs nothing', async () => {
  const w = world();
  assert.equal((await call(w, EDITOR, 'PUT', CO, { max_parallel_per_repo: 2 })).status, 200);
  const stale = await call(w, EDITOR, 'PUT', CO, { max_parallel_per_repo: 4, version: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'landing_changed');
  assert.equal((await call(w, MEMBER, 'GET', CO)).body.landing.max_parallel_per_repo, 2);
  assert.equal(logs(w).length, 1);
});

test('a save that loses a race between its read and its write is 409 and logs nothing', async () => {
  const w = world();
  assert.equal((await call(w, EDITOR, 'PUT', CO, { max_parallel_per_repo: 2 })).status, 200);
  // Another save lands after this request read version 1 and before its batch runs.
  const DB = w.env.DB;
  w.env.DB = new Proxy(DB, { get(t, k) {
    if (k === 'batch') return async (stmts: unknown[]) => { w.db.exec('UPDATE agent_landing_settings SET version = version + 1, max_parallel_per_repo = 5'); return t.batch(stmts); };
    const v = (t as any)[k]; return typeof v === 'function' ? v.bind(t) : v;
  } });
  const r = await call(w, EDITOR, 'PUT', CO, { max_parallel_per_repo: 4 });
  w.env.DB = DB;
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'landing_changed');
  assert.equal((await call(w, MEMBER, 'GET', CO)).body.landing.max_parallel_per_repo, 5);
  assert.equal(logs(w).length, 1);
});

test('a project scope keeps its own row; the change log refuses updates and deletes', async () => {
  const w = world();
  const p = await call(w, EDITOR, 'PUT', '/project/7/landing', { repository: REPO });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await call(w, EDITOR, 'GET', CO)).body.landing.repository, null);
  assert.throws(() => w.db.exec('UPDATE agent_landing_setting_changes SET actor_user_id = 1'), /insert-only/);
  assert.throws(() => w.db.exec('DELETE FROM agent_landing_setting_changes'), /insert-only/);
});

test('the migration applies twice', () => {
  const w = world();
  w.db.exec(stripForeignKeys(MIGRATION));
  w.db.exec(stripForeignKeys(MIGRATION));
  assert.equal(rows(w), 0);
});

test('the contract alone: T2 is never an auto tier, signers are never agents, executors stay within HQ\'s list', () => {
  const caps = { ...HQ_LANDING_CAPS, executors: ['cloudflare'] };
  const t2 = validateLandingPolicy({ landing: { auto_tiers: ['T2'], t2_signers: [] } }, caps);
  assert.equal(t2.ok, false);
  const agent = validateLandingPolicy({ landing: { auto_tiers: [], t2_signers: [{ kind: 'agent', uid: 'a' }] } }, caps);
  assert.equal(agent.ok, false);
  assert.equal(validateLandingPolicy({ executors: ['aws'] }, caps).ok, false);
  assert.deepEqual(validateLandingPolicy({ executors: ['cloudflare'], landing: null }, caps), { ok: true, patch: { executors: ['cloudflare'], landing: null } });
});
