/**
 * #4715 — the terms of a signed engagement change only as a recorded
 * correction: a reason, and each changed field's value before and after, kept
 * in the engagement's history beside its signing and renewals. A draft is
 * still edited freely, and a stale view writes nothing.
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_engagement_correction_4715.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const ADVISOR = 21;

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES (21,'Advisor','a@example.test','advisor',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (201,'a-1',21,'Advisor','a@example.test',1);
    UPDATE users SET advisor_id = 201 WHERE id = 21;
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const ctx: any = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const call = async (method: string, path: string, body?: unknown) => {
    const jwt = await new SignJWT({ user_id: ADVISOR }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, ctx);
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`); }
  };
  const corrections = (id: number) => db.prepare('SELECT * FROM advisor_engagement_corrections WHERE engagement_id = ? ORDER BY id').all(id) as any[];
  const create = async () => {
    const r = await call('POST', '/me/engagements', { client_name: 'Synthetic Co', shape: 'retainer', scope_label: 'Two sessions a month', amount_cents: 500000 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const sign = async () => {
    const e = await create();
    const s = await call('POST', `/me/engagements/${e.id}/advance`, { lane: 'signed', expected_lane: e.lane });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    return s.body;
  };
  return { db, env, call, corrections, create, sign };
}

test('a draft is edited freely and leaves no correction', async () => {
  const f = fixture();
  const e = await f.create();
  const r = await f.call('PATCH', `/me/engagements/${e.id}`, { amount_cents: 600000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.amount_cents, 600000);
  assert.equal(f.corrections(e.id).length, 0);
});

test('a signed engagement’s terms do not change without a reason, and nothing is written', async () => {
  const f = fixture();
  const e = await f.sign();
  const r = await f.call('PATCH', `/me/engagements/${e.id}`, { amount_cents: 900000, scope_excludes: 'Not in scope: hiring' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'correction_reason_required');
  assert.deepEqual(r.body.fields, ['scope_excludes', 'amount_cents']);
  const row = f.db.prepare('SELECT amount_cents, scope_excludes FROM advisor_engagements WHERE id = ?').get(e.id) as any;
  assert.equal(row.amount_cents, 500000);
  assert.equal(row.scope_excludes, null);
  assert.equal(f.corrections(e.id).length, 0);
});

test('with a reason the correction is applied and recorded, before and after, in the history', async () => {
  const f = fixture();
  const e = await f.sign();
  const r = await f.call('PATCH', `/me/engagements/${e.id}`, { amount_cents: 450000, correction_reason: 'Synthetic: the signed fee was 4,500' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.amount_cents, 450000);
  const rows = f.corrections(e.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'Synthetic: the signed fee was 4,500');
  assert.equal(rows[0].lane, 'signed');
  assert.equal(rows[0].corrected_by_user_id, ADVISOR);
  assert.deepEqual(JSON.parse(rows[0].changes_json), [{ field: 'amount_cents', from: 500000, to: 450000 }]);
  const history = (await f.call('GET', `/me/engagements/${e.id}/events`)).body.items;
  assert.deepEqual(history.map((x: any) => x.kind), ['signed', 'corrected']);
  assert.equal(history[1].note, 'Synthetic: the signed fee was 4,500');
  assert.deepEqual(history[1].changes, [{ field: 'amount_cents', from: 500000, to: 450000 }]);
});

test('a write that changes no term needs no reason and records nothing', async () => {
  const f = fixture();
  const e = await f.sign();
  const r = await f.call('PATCH', `/me/engagements/${e.id}`, { amount_cents: 500000, scope_label: 'Two sessions a month' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(f.corrections(e.id).length, 0);
});

test('a correction made from a stale view writes nothing', async () => {
  const f = fixture();
  const e = await f.sign();
  const first = await f.call('PATCH', `/me/engagements/${e.id}`, { amount_cents: 450000, correction_reason: 'Synthetic: first', expected_updated_at: e.updated_at });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const stale = await f.call('PATCH', `/me/engagements/${e.id}`, { amount_cents: 400000, correction_reason: 'Synthetic: second', expected_updated_at: e.updated_at });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'engagement_changed');
  assert.equal(f.corrections(e.id).length, 1);
  const row = f.db.prepare('SELECT amount_cents FROM advisor_engagements WHERE id = ?').get(e.id) as any;
  assert.equal(row.amount_cents, 450000);
});

test('an ended engagement is corrected the same way: a reason, and a record', async () => {
  const f = fixture();
  const e = await f.sign();
  const ended = await f.call('POST', `/me/engagements/${e.id}/renewal`, { decision: 'ended', expected_cycles: e.cycles });
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  assert.equal((await f.call('PATCH', `/me/engagements/${e.id}`, { scope_label: 'Monthly review' })).status, 409);
  const fixed = await f.call('PATCH', `/me/engagements/${e.id}`, { scope_label: 'Monthly review', correction_reason: 'Synthetic: wrong label' });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.equal(f.corrections(e.id)[0].lane, 'ended');
});

test('a write that lands between the read and the update wins; the correction writes nothing', async () => {
  const f = fixture();
  const e = await f.sign();
  // Another tab corrects the row after this request read it and before its batch runs.
  const batch = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch = async (stmts: any[]) => {
    f.db.prepare("UPDATE advisor_engagements SET amount_cents = 470000, updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(e.id);
    f.env.DB.batch = batch;
    return batch(stmts);
  };
  const r = await f.call('PATCH', `/me/engagements/${e.id}`, { amount_cents: 450000, correction_reason: 'Synthetic: raced' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'engagement_changed');
  assert.equal((f.db.prepare('SELECT amount_cents FROM advisor_engagements WHERE id = ?').get(e.id) as any).amount_cents, 470000);
  assert.equal(f.corrections(e.id).length, 0);
});
