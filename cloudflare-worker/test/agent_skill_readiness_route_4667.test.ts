/**
 * D4667 (#4667, second slice): the skill readiness surface for HQ (#4537) and discovery (#4538), on the mounted
 * `/api/teams` router over the real migrated schema. Synthetic records; no model runs and nothing is read from a
 * connector.
 *
 *   · `GET /skills/inputs` is the static matrix: every input, its read and whether a reader is built;
 *   · `GET /agents/:uid/skills/:slug/readiness` is the preflight read as the agent's sponsor, for the team only, with
 *     statuses and reasons and none of the records' figures;
 *   · an unknown skill, a bad period and a project outside a company agent's company are refused.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import teamAgents from '../src/routes/team_agents.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { world, hex, AGENT, COMPANY, PROJECT, SPONSOR, STRANGER } from './_agent_engine_fixture.ts';
import { removeMigratedDatabases } from './_storage_schema.ts';

after(removeMigratedDatabases);
type W = ReturnType<typeof world>;

async function call(w: W, who: number, path: string) {
  const a = new Hono();
  a.onError((e: any, c) => { const s = AUTH_ERROR_STATUSES[e?.message]; return s ? c.json({ detail: e.message }, s) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500); });
  a.route('/api/teams', teamAgents);
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await a.request(`/api/teams${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}

test('the matrix lists the ten skills with each input\'s read and reader; the typed readers are built', async () => {
  const w = world();
  try {
    const r = await call(w, SPONSOR, '/skills/inputs');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.skills.length, 10);
    const cash = r.body.skills.find((s: any) => s.slug === 'cash-runway-snapshot');
    assert.deepEqual(cash.inputs.map((i: any) => [i.read, i.reader]), [['mercury.balances', 'built'], ['grow.burn', 'built']]);
  } finally { w.close(); }
});

test('readiness: the team reads the preflight as the sponsor, with statuses and no figures; others are refused', async () => {
  const w = world();
  try {
    w.agent(AGENT, 'cfo');
    w.db.prepare("INSERT INTO mercury_grow_facts(integration_id, project_id, module, kind, period, amount_cents, as_of) VALUES (1, ?, 'durable_company_building', 'cash', 'current', 98765432, ?)")
      .run(PROJECT, new Date().toISOString().slice(0, 10));
    const uid = hex(AGENT, 'b');
    const r = await call(w, SPONSOR, `/agents/${uid}/skills/monthly-investor-update/readiness`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.readiness.slug, 'monthly-investor-update');
    assert.equal(r.body.readiness.inputs.find((i: any) => i.read === 'mercury.balances').status, 'available');
    assert.ok(!r.text.includes('98765432'), 'statuses and reasons only: never a figure');
    assert.ok(['ready', 'conditional', 'not_ready'].includes(r.body.readiness.state));

    assert.equal((await call(w, STRANGER, `/agents/${uid}/skills/monthly-investor-update/readiness`)).status, 403);
    assert.equal((await call(w, SPONSOR, `/agents/${uid}/skills/write-a-poem/readiness`)).body.error, 'unknown_skill');
    assert.equal((await call(w, SPONSOR, `/agents/${uid}/skills/monthly-investor-update/readiness?from=2026-10`)).body.error, 'invalid_period');
    assert.equal((await call(w, SPONSOR, `/agents/${uid}/skills/monthly-investor-update/readiness?from=2026-11-01&to=2026-10-01`)).body.error, 'invalid_period');
    assert.equal((await call(w, SPONSOR, `/agents/${hex(999, 'b')}/skills/monthly-investor-update/readiness`)).status, 404);
  } finally { w.close(); }
});

test('a company agent reads a venture only when it is the company\'s', async () => {
  const w = world();
  try {
    w.agent(AGENT + 1, 'cfo', { scope: 'company' });
    w.db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('ucl-4667', ?, ?, 'founder')").run(SPONSOR, COMPANY);
    w.db.exec("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (99, 'p99', 'Elsewhere', 100, NULL)");
    const uid = hex(AGENT + 1, 'b');
    const own = await call(w, SPONSOR, `/agents/${uid}/skills/cash-runway-snapshot/readiness?project=${PROJECT}`);
    assert.equal(own.status, 200, own.text);
    assert.equal((await call(w, SPONSOR, `/agents/${uid}/skills/cash-runway-snapshot/readiness?project=99`)).body.error, 'project_not_in_company');
    assert.equal((await call(w, SPONSOR, `/agents/${uid}/skills/cash-runway-snapshot/readiness?project=1%20OR%201`)).body.error, 'invalid_project');
  } finally { w.close(); }
});
