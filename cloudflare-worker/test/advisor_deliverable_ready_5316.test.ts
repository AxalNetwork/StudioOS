/**
 * #5316 (D5316) — a deliverable version can be marked "ready to send" (who,
 * when), the mark sends nothing, and the send clears it.
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_deliverable_ready_5316.test.ts
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
const CLIENT = 22;
const OTHER_ADVISOR = 23;

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES (21,'Advisor One','a@example.test','advisor',1);
    INSERT INTO users(id,name,email,role,is_active) VALUES (22,'Client','c@example.test','founder',1);
    INSERT INTO users(id,name,email,role,is_active) VALUES (23,'Advisor Two','b@example.test','advisor',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (201,'a-1',21,'Advisor One','a@example.test',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (202,'a-2',23,'Advisor Two','b@example.test',1);
    UPDATE users SET advisor_id = 201 WHERE id = 21;
    UPDATE users SET advisor_id = 202 WHERE id = 23;
    INSERT INTO advisor_engagements(id, uid, advisor_id, founder_user_id, client_name, lane, shape, cycles, created_at, updated_at)
      VALUES (301, 'e-1', 201, 22, 'Client Co', 'signed', 'retainer', 1, '2026-01-01', '2026-01-01');
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const ctx: any = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, ctx);
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`); }
  };
  const deliverable = async () => {
    const d = await call(ADVISOR, 'POST', '/me/deliverables', { title: 'Synthetic memo', engagement_id: 301, link_url: 'https://example.test/v1', summary: 'First draft' });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    return d.body;
  };
  const version = (id: number, v: number) => db.prepare('SELECT * FROM advisor_deliverable_versions WHERE deliverable_id = ? AND version = ?').get(id, v) as any;
  const listed = async (id: number) => (await call(ADVISOR, 'GET', '/me/deliverables')).body;
  return { db, call, deliverable, version, listed };
}

test('marking a version ready records who and when, and sends nothing', async () => {
  const f = fixture();
  const d = await f.deliverable();
  const r = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/ready`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.ready_at, 'when');
  assert.equal(r.body.ready_by_user_id, ADVISOR, 'who');
  assert.equal(r.body.ready_by_name, 'Advisor One');
  const v = f.version(d.id, 1);
  assert.equal(v.ready_at, r.body.ready_at);
  assert.equal(v.ready_by_user_id, ADVISOR);
  // Nothing is sent by marking it.
  assert.equal(v.sent_at, null);
  assert.equal(v.recipient_user_id, null);
  const list = await f.listed(d.id);
  const item = list.items.find((i: any) => i.id === d.id);
  assert.equal(item.state, 'not_started');
  assert.equal(item.ready_version, 1);
  assert.equal(item.latest_version.ready_at, r.body.ready_at);
  assert.equal(list.totals.ready, 1);
  assert.equal(list.totals.sent, 0);
  // The client sees nothing: an unsent version is not theirs to read.
  const received = await f.call(CLIENT, 'GET', '/received/deliverables');
  assert.deepEqual(received.body.items, []);
});

test('the first mark stands; marking again changes nothing', async () => {
  const f = fixture();
  const d = await f.deliverable();
  const first = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/ready`);
  f.db.prepare("UPDATE advisor_deliverable_versions SET ready_at = '2026-01-02T00:00:00.000Z' WHERE deliverable_id = ?").run(d.id);
  const again = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/ready`);
  assert.equal(again.status, 200);
  assert.equal(again.body.ready_at, '2026-01-02T00:00:00.000Z');
  assert.equal(first.body.ready_by_user_id, again.body.ready_by_user_id);
});

test('sending the version clears the mark', async () => {
  const f = fixture();
  const d = await f.deliverable();
  await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/ready`);
  const sent = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/send`);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const v = f.version(d.id, 1);
  assert.ok(v.sent_at);
  assert.equal(v.ready_at, null);
  assert.equal(v.ready_by_user_id, null);
  const list = await f.listed(d.id);
  const item = list.items.find((i: any) => i.id === d.id);
  assert.equal(item.state, 'sent');
  assert.equal(item.ready_version, null);
  assert.equal(item.latest_version.ready_at, null);
  assert.equal(list.totals.ready, 0);
  // And a sent version cannot be marked again, or have a mark taken off.
  const remark = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/ready`);
  assert.deepEqual([remark.status, remark.body.code], [409, 'already_sent']);
  const unmark = await f.call(ADVISOR, 'DELETE', `/me/deliverables/${d.id}/versions/1/ready`);
  assert.deepEqual([unmark.status, unmark.body.code], [409, 'already_sent']);
  assert.equal(f.version(d.id, 1).ready_at, null);
});

test('the mark can be taken off before sending, and nothing else changes', async () => {
  const f = fixture();
  const d = await f.deliverable();
  await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/ready`);
  const r = await f.call(ADVISOR, 'DELETE', `/me/deliverables/${d.id}/versions/1/ready`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.ready_at, r.body.ready_by_user_id], [null, null]);
  const v = f.version(d.id, 1);
  assert.deepEqual([v.ready_at, v.ready_by_user_id, v.sent_at], [null, null, null]);
  assert.equal((await f.listed(d.id)).totals.ready, 0);
});

test('a version with no content cannot be ready, and a version that exists already is not ready until marked', async () => {
  const f = fixture();
  const d = (await f.call(ADVISOR, 'POST', '/me/deliverables', { title: 'Title only', engagement_id: 301 })).body;
  const r = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/ready`);
  assert.deepEqual([r.status, r.body.code], [422, 'empty_version']);
  assert.equal(f.version(d.id, 1).ready_at, null);
  const item = (await f.listed(d.id)).items.find((i: any) => i.id === d.id);
  assert.equal(item.ready_version, null, 'not inferred from anything');
  assert.equal(item.latest_version.ready_at, null);
});

test("another advisor's version is Not Found, and an unknown version too", async () => {
  const f = fixture();
  const d = await f.deliverable();
  const theirs = await f.call(OTHER_ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/ready`);
  assert.equal(theirs.status, 404);
  assert.equal((await f.call(OTHER_ADVISOR, 'DELETE', `/me/deliverables/${d.id}/versions/1/ready`)).status, 404);
  assert.equal((await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/9/ready`)).status, 404);
  assert.equal(f.version(d.id, 1).ready_at, null);
});
