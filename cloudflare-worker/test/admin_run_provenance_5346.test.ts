/**
 * #5346 (D4575 update): HQ's read of one run's provenance,
 * `GET /api/admin/ai-agents/runs/:uid/provenance`, through the mounted router
 * over the real migrated schema in memory, synthetic rows only.
 *
 *   · Super Admin only: no token, a founder and a plain admin are refused;
 *   · an unknown run, or a uid of the wrong shape, is 404;
 *   · the body is `runProvenance`'s record unchanged; what no table keeps is
 *     `{ available: false, why }`, never 0;
 *   · no prompt, payload, step summary, task title, email or name (D4575's list).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminAiAgents from '../src/routes/admin_ai_agents.ts';
import { runProvenance } from '../src/services/agents/provenance.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-5346-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const SUPER = 1, FOUNDER = 2, PLAIN_ADMIN = 3;
const EMAILS = ['synthetic-super@example.invalid', 'synthetic-founder@example.invalid', 'synthetic-admin@example.invalid'];
const NAMES = ['Ada Super', 'Femi Founder', 'Pat Admin', 'Vesta'];
const TITLE = 'Synthetic secret title 5346';
const SUMMARY = `Loaded the task for ${EMAILS[1]}`;
const PAYLOAD = 'Synthetic proposal payload 5346';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const user = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  user.run(SUPER, EMAILS[0], NAMES[0], 'admin');
  user.run(FOUNDER, EMAILS[1], NAMES[1], 'founder');
  user.run(PLAIN_ADMIN, EMAILS[2], NAMES[2], 'admin');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec("INSERT INTO projects (id, name) VALUES (20, 'Synthetic Project')");
  db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, project_id, role_key, first_name, model_id, sponsor_user_id, monthly_cap_microusd, status, created_by)
    VALUES (100, 'agent-vesta-0001', 'project', 20, 'finance', 'Vesta', '@cf/zai-org/glm-4.7-flash', ?, 5000000, 'active', ?)`).run(FOUNDER, FOUNDER);
  db.prepare(`INSERT INTO scope_tasks (id, uid, scope_kind, project_id, title, assignee_kind, assignee_agent_id, module, option)
    VALUES (500, 'task-0000-0500', 'project', 20, ?, 'agent', 100, 'use-of-funds', 'draft:raise/use-of-funds-runway')`).run(TITLE);
  // A usage row with no charge recorded: the record must say so, never 0.
  db.prepare(`INSERT INTO ai_usage_logs (id, user_id, task, model, prompt_tokens, completion_tokens, charged_microusd, agent_id)
    VALUES (900, ?, 'agent_run', '@cf/zai-org/glm-4.7-flash', 400, 100, NULL, 100)`).run(FOUNDER);
  db.prepare(`INSERT INTO agent_task_runs (id, uid, agent_id, task_id, attempt, status, steps_json, usage_log_id, proposal_uid, created_at)
    VALUES (1, 'run-0000-0001', 100, 500, 1, 'done', ?, 900, NULL, '2026-11-09 10:00:00')`).run(JSON.stringify([{ name: 'load', status: 'done', summary: SUMMARY }]));
  db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, status, agent_id, run_key)
    VALUES ('prop-0000-0001', ?, 'team', 'draft', 'draft', ?, 'proposed', 100, 'agent:run-0000-0001')`).run(FOUNDER, JSON.stringify({ text: PAYLOAD }));
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/admin/ai-agents', adminAiAgents);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, close: () => db.close() };
}
type F = ReturnType<typeof fixture>;
const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function get(f: F, who: number | null, uid: string) {
  const res = await f.app.request(`${ORIGIN}/api/admin/ai-agents/runs/${uid}/provenance`, { headers: who ? { Authorization: `Bearer ${await token(who)}` } : {} }, f.env);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

test('#5346: only a Super Admin opens a run\'s provenance; a founder, a plain admin and no token are refused', async () => {
  const f = fixture();
  try {
    // Mutation checked: the requireSuperAdmin line removed → the founder and the plain admin get 200 and this fails.
    for (const who of [null, FOUNDER, PLAIN_ADMIN]) {
      const r = await get(f, who, 'run-0000-0001');
      assert.ok(r.status === 401 || r.status === 403, `${who}: ${r.status}`);
      assert.ok(!r.text.includes('run-0000-0001') && !r.text.includes('agent-vesta-0001'), `${who} saw the record`);
    }
    assert.equal((await get(f, SUPER, 'run-0000-0001')).status, 200);
  } finally { f.close(); }
});

test('#5346: an unknown run, or a uid of the wrong shape, is 404', async () => {
  const f = fixture();
  try {
    // Mutation checked: the route's null check dropped → an unknown run answers 200 and this fails.
    for (const uid of ['run-0000-9999', 'x', encodeURIComponent("run' OR 1=1 --")]) {
      const r = await get(f, SUPER, uid);
      assert.equal(r.status, 404, uid);
      assert.equal(r.body.error, 'not_found', uid);
    }
  } finally { f.close(); }
});

test('#5346: the body is runProvenance\'s record unchanged; what is not recorded is unavailable, never 0', async () => {
  const f = fixture();
  try {
    const r = await get(f, SUPER, 'run-0000-0001');
    assert.equal(r.status, 200);
    const direct = JSON.parse(JSON.stringify(await runProvenance(f.env, 'run-0000-0001')));
    // The reconciliation and hold expiry read the clock; neither moves between the two reads here.
    assert.deepEqual(r.body.provenance, direct);
    const p = r.body.provenance;
    assert.deepEqual(p.charge_microusd, { available: false, why: 'the usage row records no charge' });
    assert.equal(p.hold.available, false);
    assert.equal(p.tool_grants_at_admission.available, false);
    assert.equal(p.data_class.available, false);
    assert.deepEqual(p.model_invoked, { available: true, value: '@cf/zai-org/glm-4.7-flash' });
    assert.equal(p.reconciliation, 'unrecorded');
    // The proposal is joined (by run_key), so the payload test below has something to leak.
    assert.deepEqual([p.proposal.available, p.proposal.value?.uid], [true, 'prop-0000-0001']);
  } finally { f.close(); }
});

test('#5346: the answer carries no prompt, payload, step summary, task title, email or name', async () => {
  const f = fixture();
  try {
    const r = await get(f, SUPER, 'run-0000-0001');
    assert.equal(r.status, 200);
    for (const leak of [TITLE, SUMMARY, PAYLOAD, ...EMAILS, ...NAMES]) assert.ok(!r.text.includes(leak), `leaked: ${leak}`);
  } finally { f.close(); }
});
