/**
 * #5316 (D5316) — why a signed engagement ended is stored, required when it is
 * ended, and never inferred for an engagement that ended before it was asked.
 *
 * Composes with D4695/D4692's graph: a signed engagement still ends only
 * through `/renewal` (signed → renewal_due → ended keeps its outcome), an
 * unsigned row abandoned through `/advance` has no reason, as it has no outcome.
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_engagement_end_reason_5316.test.ts
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
  const sign = async (client = 'Synthetic Co') => {
    const e = (await call('POST', '/me/engagements', { client_name: client, shape: 'retainer' })).body;
    const s = await call('POST', `/me/engagements/${e.id}/advance`, { lane: 'signed', expected_lane: e.lane });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    return s.body;
  };
  const stored = (id: number) => db.prepare('SELECT lane, outcome, end_reason, cycles FROM advisor_engagements WHERE id = ?').get(id) as any;
  return { db, call, sign, stored };
}

test('ending a signed engagement without a reason is refused and writes nothing', async () => {
  const f = fixture();
  const e = await f.sign();
  for (const body of [{}, { end_reason: '' }, { end_reason: 'hired_in_house' }]) {
    const r = await f.call('POST', `/me/engagements/${e.id}/renewal`, { decision: 'ended', expected_cycles: 1, ...body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'end_reason_required');
    assert.deepEqual(r.body.allowed, ['did_not_renew', 'other']);
  }
  assert.deepEqual({ ...f.stored(e.id) }, { lane: 'signed', outcome: 'active', end_reason: null, cycles: 1 });
  const events = f.db.prepare("SELECT kind FROM advisor_engagement_events WHERE engagement_id = ? AND kind = 'ended'").all(e.id);
  assert.equal(events.length, 0, 'no ending is in the history');
});

test('with a reason the ending is recorded, stored and read back', async () => {
  const f = fixture();
  const a = await f.sign('Did-not-renew Co');
  const b = await f.sign('Other Co');
  const ra = await f.call('POST', `/me/engagements/${a.id}/renewal`, { decision: 'ended', end_reason: 'did_not_renew', expected_cycles: 1 });
  assert.equal(ra.status, 200, JSON.stringify(ra.body));
  assert.deepEqual([ra.body.lane, ra.body.outcome, ra.body.end_reason], ['ended', 'ended', 'did_not_renew']);
  const rb = await f.call('POST', `/me/engagements/${b.id}/renewal`, { decision: 'ended', end_reason: 'other', expected_cycles: 1 });
  assert.equal(rb.body.end_reason, 'other');
  assert.equal(f.stored(a.id).end_reason, 'did_not_renew');
  assert.equal(f.stored(b.id).end_reason, 'other');
  const list = (await f.call('GET', '/me/engagements')).body;
  const byId = new Map(list.items.map((x: any) => [x.id, x]));
  assert.equal((byId.get(a.id) as any).end_reason, 'did_not_renew');
  assert.equal((byId.get(b.id) as any).end_reason, 'other');
  assert.deepEqual(list.totals.ended_by_reason, { did_not_renew: 1, other: 1, not_recorded: 0 });
});

test('signed → renewal due → ended still needs a decision, and the decision needs a reason', async () => {
  const f = fixture();
  const e = await f.sign();
  const due = await f.call('POST', `/me/engagements/${e.id}/advance`, { lane: 'renewal_due', expected_lane: 'signed' });
  assert.equal(due.status, 200);
  assert.equal((await f.call('POST', `/me/engagements/${e.id}/advance`, { lane: 'ended' })).status, 409, 'not through the lane verb');
  assert.equal((await f.call('POST', `/me/engagements/${e.id}/renewal`, { decision: 'ended', expected_cycles: 1 })).status, 400);
  const ended = await f.call('POST', `/me/engagements/${e.id}/renewal`, { decision: 'ended', end_reason: 'did_not_renew', expected_cycles: 1 });
  assert.deepEqual([ended.body.lane, ended.body.outcome, ended.body.end_reason], ['ended', 'ended', 'did_not_renew']);
});

test('a renewal records no reason, and a retry of a recorded ending needs none', async () => {
  const f = fixture();
  const e = await f.sign();
  const renewed = await f.call('POST', `/me/engagements/${e.id}/renewal`, { decision: 'renewed', end_reason: 'other', expected_cycles: 1 });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.end_reason, null);
  assert.equal(f.stored(e.id).end_reason, null);
  const ended = await f.call('POST', `/me/engagements/${e.id}/renewal`, { decision: 'ended', end_reason: 'other', expected_cycles: 2 });
  assert.equal(ended.status, 200);
  const replay = await f.call('POST', `/me/engagements/${e.id}/renewal`, { decision: 'ended', expected_cycles: 2 });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.end_reason, 'other', 'the replay keeps the recorded reason');
});

test('an engagement that ended before the reason existed reads Not recorded, and is not back-filled', async () => {
  const f = fixture();
  const e = await f.sign('Legacy Co');
  // As a row ended before this migration: outcome ended, no reason column written.
  f.db.prepare("UPDATE advisor_engagements SET lane = 'ended', outcome = 'ended', ended_at = '2026-01-01', end_reason = NULL WHERE id = ?").run(e.id);
  const list = (await f.call('GET', '/me/engagements')).body;
  const row = list.items.find((x: any) => x.id === e.id);
  assert.equal(row.outcome, 'ended');
  assert.equal(row.end_reason, null, 'null, never a guessed reason');
  assert.deepEqual(list.totals.ended_by_reason, { did_not_renew: 0, other: 0, not_recorded: 1 });
  assert.equal(f.stored(e.id).end_reason, null, 'the read writes nothing');
});

test('an abandoned draft has no outcome and no reason', async () => {
  const f = fixture();
  const d = (await f.call('POST', '/me/engagements', { client_name: 'Draft Co' })).body;
  const r = await f.call('POST', `/me/engagements/${d.id}/advance`, { lane: 'ended' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.outcome, r.body.end_reason], [null, null]);
  const t = (await f.call('GET', '/me/engagements')).body.totals;
  assert.deepEqual(t.ended_by_reason, { did_not_renew: 0, other: 0, not_recorded: 0 });
});

test('the column refuses a value outside the two reasons', () => {
  const f = fixture();
  f.db.exec("INSERT INTO advisor_engagements(uid, advisor_id, client_name, lane, shape, cycles, created_at, updated_at) VALUES ('x', 201, 'C', 'drafting', 'retainer', 0, 'now', 'now')");
  assert.throws(() => f.db.exec("UPDATE advisor_engagements SET end_reason = 'hired_in_house' WHERE uid = 'x'"), /CHECK/);
});
