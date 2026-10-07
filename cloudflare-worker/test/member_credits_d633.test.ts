/**
 * D633 (#1391, Q2) — the Super Admin's read of one member's credits:
 * `GET /perks/admin/credits/:userId`, over the Perks harness's real schema.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/member_credits_d633.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { JWT_SECRET, freshDb, makeD1, FOUNDER, ADMIN } from './_perks_harness.ts';
import { grantCredits, revokeGrant, manualAdjust } from '../src/services/creditGrants.ts';
import perks from '../src/routes/perks.ts';

const SUPER = 30;
function setup() {
  const db = freshDb();
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT);
           CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT);`);
  db.prepare(`INSERT INTO users (id, role, email) VALUES (?, 'admin', 'super@example.test')`).run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, { beforeBatch: null }) } as any };
}
async function get(env: any, who: number, path: string) {
  const role = who === FOUNDER ? 'founder' : 'admin';
  const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await perks.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, env);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};

test('the Super Admin reads one member\'s balance and ledger, newest first, with what was taken back', async () => {
  const { env } = setup();
  const actor = { id: SUPER, email: 'super@example.test' };
  const g = await quiet(() => grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:1', actor: { kind: 'system', source: 'test' } }));
  await quiet(() => manualAdjust(env, { userId: FOUNDER, delta: 50, reason: 'Goodwill for the outage', note: 'Thanks', actor }));
  await quiet(() => revokeGrant(env, { ledgerId: (g as any).ledger_id, actor, reason: 'Duplicate report' }));
  const r = await quiet(() => get(env, SUPER, `/admin/credits/${FOUNDER}`));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.member.id, FOUNDER);
  assert.equal(r.body.balance, 50);
  assert.deepEqual(r.body.ledger.map((l: any) => [l.delta, l.kind, l.rule_key]), [[-20, 'admin_adjust', 'bug_low'], [50, 'grant', 'manual'], [20, 'grant', 'bug_low']]);
  assert.deepEqual(r.body.ledger.map((l: any) => l.revoked), [false, false, true], 'the taken-back grant says so');
  assert.equal(r.body.ledger[1].note, 'Thanks');
  assert.equal(r.body.truncated, false);
});

test('only the Super Admin reads it; an unknown member and a bad id are refused in sentences', async () => {
  const { env } = setup();
  for (const who of [ADMIN, FOUNDER]) assert.equal((await quiet(() => get(env, who, `/admin/credits/${FOUNDER}`))).status, 403, `user ${who}`);
  const none = await quiet(() => get(env, SUPER, '/admin/credits/9999'));
  assert.deepEqual([none.status, none.body.error], [404, 'user_not_found']);
  assert.match(none.body.message, /No account matches this id/);
  const bad = await quiet(() => get(env, SUPER, '/admin/credits/abc'));
  assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_user']);
  const empty = await quiet(() => get(env, SUPER, `/admin/credits/${FOUNDER}`));
  assert.deepEqual([empty.status, empty.body.balance, empty.body.ledger], [200, 0, []]);
});
