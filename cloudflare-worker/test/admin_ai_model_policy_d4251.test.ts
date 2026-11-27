/**
 * D4251 (#4251, deck v2 B10a) — HQ's AI model policy and the kill switch,
 * without a deploy.
 *
 *   1. A model HQ switches off is refused on the next call: the run path's
 *      `modelsOffFor` and every reply's `flagsFor` read the policy each time,
 *      and the catalogue then refuses it (`refusalFor` → model_not_offered).
 *   2. A plan floor keeps a model from a member whose plan is below it.
 *   3. Only HQ (a Super Admin, not on a branch) reads or writes; every write
 *      is one admin audit row with the reason, before and after.
 *   4. A model id missing from the catalogue is refused, and so is switching
 *      off the safety model.
 *
 * On the real migrated schema. Every person here is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_ai_model_policy_d4251.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import policyRoutes, { mount } from '../src/routes/admin_ai_element_models.ts';
import { catalogueSwitchesFor, flagsFor, modelsOffFor } from '../src/services/featureFlags.ts';
import { refusalFor, type CatalogueSwitches } from '../src/services/ai/catalogue.ts';
import { policyOff } from '../src/services/ai/modelPolicy.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(() => removeMigratedDatabases());

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, ADMIN = 2, FREE = 3, PAID = 4;
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const OTHER = '@cf/zai-org/glm-4.7-flash';
const PATH = '/api/admin/ai/element-models';

function world(extraEnv: Record<string, unknown> = {}) {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, is_active, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
  u.run(SUPER, 'u-super', 'admin', 'Sana Super', 'sana@example.test', 'free', 'active');
  u.run(ADMIN, 'u-admin', 'admin', 'Abe Admin', 'abe@example.test', 'free', 'active');
  u.run(FREE, 'u-free', 'founder', 'Fern Free', 'fern@example.test', 'free', 'active');
  u.run(PAID, 'u-paid', 'founder', 'Pia Paid', 'pia@example.test', 'studio', 'active');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extraEnv } as any;
  const app = new Hono<any>().route(mount.path, policyRoutes);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  async function call(who: number | null, method: string, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
    const res = await app.request(PATH, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  }
  return { db, env, call };
}

const off = (reason = 'Quality regressed on long decks this week.') => ({ model_id: MODEL, enabled: false, reason });
const audits = (db: DatabaseSync) => (db.prepare("SELECT user_id, details FROM activity_logs WHERE action = 'ai_model_policy_set' ORDER BY id").all() as any[])
  .map((r) => ({ user_id: r.user_id, details: JSON.parse(r.details) }));
const runRefusal = async (env: any, userId: number, model: string) =>
  refusalFor(model, catalogueSwitchesFor(env as CatalogueSwitches, { modelsOff: await modelsOffFor(env, userId) }));

test('D4251: a model switched off is refused on the next call, with no deploy, and back on when HQ says', async () => {
  // Mutation checked: modelsOffFor without the policy → the run still reaches the model; flagsFor without it → the replies still offer it.
  const w = world();
  try {
    assert.equal(await runRefusal(w.env, FREE, MODEL), null, 'offered before any policy');
    const put = await w.call(SUPER, 'PUT', off());
    assert.equal(put.status, 200, put.text);
    assert.deepEqual([put.body.policy.enabled, put.body.policy.updated_by], [false, { uid: 'u-super', name: 'Sana Super' }]);
    // The next call: the same env, the same isolate, nothing redeployed or cleared.
    for (const who of [FREE, PAID, SUPER]) assert.equal(await runRefusal(w.env, who, MODEL), 'model_not_offered', `refused for ${who}`);
    assert.ok((await flagsFor(w.env, { id: PAID, role: 'founder' } as any)).modelsOff.has(MODEL), 'every reply that offers models leaves it out');
    assert.equal(await runRefusal(w.env, FREE, OTHER), null, 'only that model');
    const back = await w.call(SUPER, 'PUT', { model_id: MODEL, enabled: true, reason: 'Fixed upstream; back on for everyone.' });
    assert.equal(back.status, 200);
    assert.equal(await runRefusal(w.env, FREE, MODEL), null);
  } finally { w.db.close(); }
});

test('D4251: a plan floor keeps a model from a plan below it, and from a plan that cannot be read', async () => {
  // Mutation checked: the floor ignored → the free founder runs it; the floor read as "any plan" when unknown → policyOff lets an odd floor through.
  const w = world();
  try {
    const put = await w.call(SUPER, 'PUT', { model_id: MODEL, enabled: true, plan_min: 'studio', note: 'Costly: Raise + Grow only.', reason: 'Keep the costly model on the top plan.' });
    assert.equal(put.status, 200, put.text);
    assert.equal(await runRefusal(w.env, FREE, MODEL), 'model_not_offered');
    assert.equal(await runRefusal(w.env, PAID, MODEL), null);
    assert.equal(await runRefusal(w.env, 0, MODEL), 'model_not_offered', 'a system run reaches no floor above free');
    assert.ok(policyOff([{ model_id: MODEL, enabled: 1, plan_min: 'platinum', note: null, updated_by: null, updated_at: '' }], { id: PAID, role: 'founder', subscription_tier: 'studio' } as any).has(MODEL));
  } finally { w.db.close(); }
});

test('D4251: only HQ reads and writes; every write is one audit row with the reason, before and after', async () => {
  // Mutation checked: requireAdmin in place of requireSuperAdmin → the plain admin writes; the audit dropped → no row; the reason check dropped → a bare write lands.
  const w = world();
  try {
    assert.equal((await w.call(null, 'GET')).status, 401);
    for (const who of [ADMIN, FREE]) {
      assert.equal((await w.call(who, 'GET')).status, 403, `read by ${who}`);
      assert.equal((await w.call(who, 'PUT', off())).status, 403, `write by ${who}`);
    }
    const bare = await w.call(SUPER, 'PUT', { model_id: MODEL, enabled: false, reason: 'short' });
    assert.deepEqual([bare.status, bare.body.error], [400, 'reason_required']);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_model_policy').get()!.n, 0, 'nothing written without a reason');
    assert.equal((await w.call(SUPER, 'PUT', off())).status, 200);
    assert.equal((await w.call(SUPER, 'PUT', { model_id: MODEL, enabled: true, plan_min: 'growth', reason: 'Back on, for paying plans only.' })).status, 200);
    const rows = audits(w.db);
    assert.equal(rows.length, 2, 'one row per write');
    assert.deepEqual(rows[0], { user_id: SUPER, details: { model_id: MODEL, reason: 'Quality regressed on long decks this week.', before: null, after: { enabled: false, plan_min: null, note: null } } });
    assert.deepEqual(rows[1].details.before, { enabled: false, plan_min: null, note: null });
    assert.deepEqual(rows[1].details.after, { enabled: true, plan_min: 'growth', note: null });
    // The read: the grid, names and never an email.
    const read = await w.call(SUPER, 'GET');
    assert.equal(read.status, 200, read.text);
    const row = read.body.models.find((m: any) => m.id === MODEL);
    assert.ok(row && row.elements.length > 0 && row.offered === true, 'a model the grid elements offer');
    assert.deepEqual(row.policy.updated_by, { uid: 'u-super', name: 'Sana Super' });
    assert.ok(read.body.elements.length > 10 && read.body.groups.some((g: any) => g.group === 'text'));
    assert.ok(!/@example\.test/.test(read.text), 'no email in the reply');
  } finally { w.db.close(); }
  // A branch's Super Admin is not HQ.
  const b = world({ BRANCH_CODE: 'lisbon' });
  try { assert.equal((await b.call(SUPER, 'PUT', off())).status, 403); } finally { b.db.close(); }
});

test('D4251: a model the catalogue does not hold is refused, and the safety model cannot be switched off', async () => {
  // Mutation checked: the catalogue check dropped → the made-up id is written; REQUIRED_MODELS emptied → the guard is switched off.
  const w = world();
  try {
    for (const id of ['@cf/made-up/not-a-model', '', 42]) {
      const r = await w.call(SUPER, 'PUT', { model_id: id, enabled: false, reason: 'Testing an unknown model id.' });
      assert.deepEqual([r.status, r.body.error], [400, 'unknown_model'], String(id));
    }
    const guard = await w.call(SUPER, 'PUT', { model_id: '@cf/meta/llama-guard-3-8b', enabled: false, reason: 'Trying to switch the guard off.' });
    assert.deepEqual([guard.status, guard.body.error], [409, 'model_required']);
    const plan = await w.call(SUPER, 'PUT', { model_id: MODEL, enabled: true, plan_min: 'gold', reason: 'An unknown plan floor here.' });
    assert.deepEqual([plan.status, plan.body.error], [400, 'invalid_plan_min']);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_model_policy').get()!.n, 0);
    assert.equal(audits(w.db).length, 0, 'a refused write audits nothing');
  } finally { w.db.close(); }
});
