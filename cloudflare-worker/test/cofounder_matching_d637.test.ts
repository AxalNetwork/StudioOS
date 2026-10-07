/**
 * D637 (#1395) — the co-founder matching controls: "Unlist me", the interest
 * I sent (and withdrawing it), and each refusal as a sentence. Every write
 * records its actor in `activity_logs`.
 *
 * Driven through the real router (`routes/cofounder.ts`) on real
 * `node:sqlite`, with the tables from `schema_baseline.sql`.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cofounder_matching_d637.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import cofounder from '../src/routes/cofounder.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const NAME: Record<number, string> = { 1: 'Ada', 2: 'Ben', 3: 'Cy', 4: 'Dee' };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cofounder_profiles', 'cofounder_connections', 'cofounder_interests', 'documents']) db.exec(ddl(t));
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER,
    action TEXT NOT NULL, details TEXT, actor TEXT)`);
  const u = db.prepare(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, 'founder', 1)`);
  for (const [id, n] of Object.entries(NAME)) u.run(Number(id), `u-${n.toLowerCase()}`, `${n.toLowerCase()}@example.test`, n);
  const p = db.prepare(`INSERT INTO cofounder_profiles (uid, user_id, commitment, looking_for, listed) VALUES (?, ?, 'full_time', ?, ?)`);
  p.run('p-ada', 1, 'A technical co-founder', 1);
  p.run('p-ben', 2, 'A commercial co-founder', 1);
  p.run('p-cy', 3, 'Someone in climate', 1);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/cofounder', cofounder as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api/cofounder${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const logs = (db: DatabaseSync) => db.prepare('SELECT user_id, action, details, actor FROM activity_logs ORDER BY id').all() as any[];

test('D637: the interest I sent is listed, and withdrawing it takes it off', async () => {
  const db = freshDb();
  assert.equal((await call(db, 1, 'POST', '/interest', { user_uid: 'u-ben' })).status, 200);
  assert.equal((await call(db, 1, 'POST', '/interest', { user_uid: 'u-cy' })).status, 200);
  // Newest first, and the newest is the one sent second, so the order is not insertion order.
  db.prepare(`UPDATE cofounder_interests SET updated_at = '2026-10-02 00:00:00' WHERE to_user_id = 3`).run();
  db.prepare(`UPDATE cofounder_interests SET updated_at = '2026-10-01 00:00:00' WHERE to_user_id = 2`).run();
  const sent = await call(db, 1, 'GET', '/interests/sent');
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.body.items.map((x: any) => x.name), ['Cy', 'Ben'], 'newest first');
  assert.deepEqual(sent.body.items[1], {
    user_uid: 'u-ben', name: 'Ben', looking_for: 'A commercial co-founder', listed: true,
    sent_at: '2026-10-01 00:00:00', connection_uid: null,
  });
  assert.ok(!JSON.stringify(sent.body).includes('@example.test'), 'no email in the sent list');
  assert.deepEqual((await call(db, 2, 'GET', '/interests/sent')).body.items, [], 'only my own interest');

  const w = await call(db, 1, 'DELETE', '/interest/u-ben');
  assert.deepEqual(w.body, { ok: true, withdrew: true });
  assert.deepEqual((await call(db, 1, 'GET', '/interests/sent')).body.items.map((x: any) => x.name), ['Cy']);
  assert.deepEqual((await call(db, 1, 'DELETE', '/interest/u-ben')).body, { ok: true, withdrew: false }, 'twice is a no-op');

  assert.deepEqual(logs(db).map((r) => [r.action, r.user_id]), [
    ['cofounder_interest_sent', 1], ['cofounder_interest_sent', 1], ['cofounder_interest_withdrawn', 1],
  ]);
  for (const r of logs(db)) assert.match(r.actor, /^[0-9a-f]{16,}$/);
  assert.equal(JSON.parse(logs(db)[2].details).to_user_id, 2);
});

test('D637: a mutual interest carries its connection, and an unlisted target says so', async () => {
  const db = freshDb();
  await call(db, 1, 'POST', '/interest', { user_uid: 'u-ben' });
  const mutual = await call(db, 2, 'POST', '/interest', { user_uid: 'u-ada' });
  assert.equal(mutual.body.mutual, true);
  const [mine] = (await call(db, 1, 'GET', '/interests/sent')).body.items;
  assert.equal(mine.connection_uid, mutual.body.connection_uid);
  await call(db, 2, 'DELETE', '/me');
  assert.equal((await call(db, 1, 'GET', '/interests/sent')).body.items[0].listed, false);
});

test('D637: Unlist me hides the profile from browse and from new interest, and keeps it', async () => {
  const db = freshDb();
  const r = await call(db, 2, 'DELETE', '/me');
  assert.deepEqual(r.body, { ok: true, listed: false });
  const me = await call(db, 2, 'GET', '/me');
  assert.equal(me.status, 200, 'the profile is kept');
  assert.equal(me.body.listed, false);
  const refused = await call(db, 1, 'POST', '/interest', { user_uid: 'u-ben' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'target_not_listed');
  assert.equal(refused.body.message, 'This profile is no longer listed, so it cannot receive interest.');
  await call(db, 2, 'DELETE', '/me');
  assert.deepEqual(logs(db).map((x) => x.action), ['cofounder_unlisted'], 'unlisting twice logs once');

  const none = await call(db, 4, 'DELETE', '/me');
  assert.equal(none.status, 404);
  assert.match(none.body.message, /no co-founder profile to unlist/);
});

test('D637: every interest refusal reads as a sentence', async () => {
  const db = freshDb();
  const self = await call(db, 1, 'POST', '/interest', { user_uid: 'u-ada' });
  assert.equal(self.body.message, 'You cannot send interest to your own profile.');
  const noProfile = await call(db, 4, 'POST', '/interest', { user_uid: 'u-ada' });
  assert.equal(noProfile.body.error, 'viewer_has_no_profile');
  assert.match(noProfile.body.message, /Create your own co-founder profile/);
  const missing = await call(db, 1, 'POST', '/interest', { user_uid: 'u-nobody' });
  assert.equal(missing.status, 404);
  assert.match(missing.body.message, /no longer on the platform/);
  db.prepare(`INSERT INTO cofounder_connections (uid, user_a_id, user_b_id, status) VALUES ('c-x', 1, 3, 'closed')`).run();
  const closed = await call(db, 1, 'POST', '/interest', { user_uid: 'u-cy' });
  assert.equal(closed.body.error, 'connection_closed');
  assert.match(closed.body.message, /was closed/);
  const sign = await call(db, 1, 'POST', '/connections/c-x/nda/sign', { accepted: true, signer_name: 'Ada' });
  assert.match(sign.body.message, /closed, so its NDA can no longer be signed/);
});

test('D637: signing and closing a connection record their actor', async () => {
  const db = freshDb();
  await call(db, 1, 'POST', '/interest', { user_uid: 'u-ben' });
  const { connection_uid } = (await call(db, 2, 'POST', '/interest', { user_uid: 'u-ada' })).body;
  await call(db, 1, 'POST', `/connections/${connection_uid}/nda/sign`, { accepted: true, signer_name: 'Ada' });
  await call(db, 2, 'POST', `/connections/${connection_uid}/nda/sign`, { accepted: true, signer_name: 'Ben' });
  await call(db, 1, 'DELETE', `/connections/${connection_uid}?reason=done`);
  const rows = logs(db).filter((r) => r.action.startsWith('cofounder_nda') || r.action.startsWith('cofounder_connection'));
  assert.deepEqual(rows.map((r) => [r.action, r.user_id, JSON.parse(r.details).both_signed ?? null]), [
    ['cofounder_nda_signed', 1, false],
    ['cofounder_nda_signed', 2, true],
    ['cofounder_connection_closed', 1, null],
  ]);
  assert.ok(!rows.some((r) => r.details.includes('done')), 'the close reason is not copied into the log');
});

test('D637: a failed log line never undoes the write', async () => {
  const db = freshDb();
  db.exec('DROP TABLE activity_logs');
  assert.equal((await call(db, 1, 'POST', '/interest', { user_uid: 'u-ben' })).status, 200);
  assert.equal((await call(db, 1, 'DELETE', '/interest/u-ben')).body.withdrew, true);
});
