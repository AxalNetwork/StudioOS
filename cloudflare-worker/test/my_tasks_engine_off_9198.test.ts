// #9198: GET /api/teams/me/tasks is read on every Studio, HQ and workspace load, so
// with the agent engine off it answers 200 `{ available: false }` with an empty list
// (still behind sign-in) instead of a failed 404 `agent_engine_off`. Every row synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import engine from '../src/routes/agent_engine.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const secret = 'fixture'.repeat(12);

function world(env: Record<string, string>) {
  const { DB, db } = makeD1(stripForeignKeys(tableFromBaseline(baseline, 'users')));
  db.prepare("INSERT INTO users (id,uid,email,name,role,subscription_tier,subscription_status,is_active) VALUES (10,'u-10','fixture-10@example.test','Pat Owner','founder','growth','active',1)").run();
  const app = new Hono(); app.route('/api/teams', engine);
  return { app, env: { DB, JWT_SECRET: secret, ENVIRONMENT: 'development', ...env } as any };
}
async function get(w: ReturnType<typeof world>, who: number | null, path: string) {
  const token = who === null ? null : await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const r = await w.app.request(`/api/teams${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, w.env);
  return { status: r.status, body: await r.json() as any };
}

for (const [label, env] of [
  ['AGENT_ENGINE off', { AGENT_ENGINE: 'off', TEAM_AGENTS_ENABLED: 'true' }],
  ['TEAM_AGENTS_ENABLED unset', { AGENT_ENGINE: 'on' }],
] as const) {
  test(`#9198 ${label}: my tasks answers 200 available:false with an empty list`, async () => {
    const r = await get(world(env), 10, '/me/tasks');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { available: false, projects: [], compliance: [], has_more: false });
  });
}

test('#9198 engine off: my tasks still needs sign-in', async () => {
  const r = await get(world({ AGENT_ENGINE: 'off', TEAM_AGENTS_ENABLED: 'true' }), null, '/me/tasks');
  assert.equal(r.status, 401);
});

test('#9198 engine off: the other engine routes keep their 404 agent_engine_off', async () => {
  const r = await get(world({ AGENT_ENGINE: 'off', TEAM_AGENTS_ENABLED: 'true' }), 10, '/project/7/assignable');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'agent_engine_off');
});
