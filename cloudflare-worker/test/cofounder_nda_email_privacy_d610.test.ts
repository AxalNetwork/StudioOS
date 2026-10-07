/**
 * D610 (#1310) — Co-founder matching: the counterparty's email stays hidden
 * until both sides have signed the NDA. The name remains visible.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/cofounder_nda_email_privacy_d610.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { createJWT } from '../src/auth.ts';
import cofounder from '../src/routes/cofounder.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const cofounderRouteSrc = readFileSync('cloudflare-worker/src/routes/cofounder.ts', 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const USER_A = 10;
const USER_B = 20;
const USER_ADMIN = 99;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cofounder_connections', 'cofounder_profiles', 'documents']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }

  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(USER_A, 'founder', 'Alice Founder', 'alice@founder.test');
  u.run(USER_B, 'founder', 'Bob Candidate', 'bob@candidate.test');
  u.run(USER_ADMIN, 'admin', 'Super Admin', 'admin@axal.test');

  const p = db.prepare('INSERT INTO cofounder_profiles (user_id, commitment, skills_json, sectors_json) VALUES (?, ?, ?, ?)');
  p.run(USER_A, 'full_time', '["engineering"]', '["ai"]');
  p.run(USER_B, 'full_time', '["growth"]', '["fintech"]');

  return db;
}

function makeApp(db: InstanceType<typeof DatabaseSync>) {
  const env: any = {
    DB: d1Over(db),
    JWT_SECRET,
  };
  const app = new Hono<any>().route('/api/cofounder', cofounder);
  return { app, env };
}

test('header comment describes name and email visibility separately (D610)', () => {
  assert.match(cofounderRouteSrc, /name is visible before signing/i);
  assert.match(cofounderRouteSrc, /email remains[\s*]+withheld until both sides have signed/i);
});

test('counterparty email is withheld when neither party has signed', async () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO cofounder_connections (id, uid, user_a_id, user_b_id, status)
    VALUES (1, 'conn-none-signed', ?, ?, 'pending_nda')
  `).run(USER_A, USER_B);

  const { app, env } = makeApp(db);
  const tokenA = await createJWT(env, USER_A, 'alice@founder.test', 'founder');
  const tokenB = await createJWT(env, USER_B, 'bob@candidate.test', 'founder');

  // User A view
  const resA = await app.request('/api/cofounder/connections/conn-none-signed', {
    headers: { Authorization: `Bearer ${tokenA}` },
  }, env);
  assert.equal(resA.status, 200);
  const bodyA = await resA.json();
  assert.equal(bodyA.counterparty.name, 'Bob Candidate');
  assert.equal(bodyA.counterparty.email, null);
  assert.equal(bodyA.counterparty.email_withheld, 'until_both_sign');

  // User B view
  const resB = await app.request('/api/cofounder/connections/conn-none-signed', {
    headers: { Authorization: `Bearer ${tokenB}` },
  }, env);
  assert.equal(resB.status, 200);
  const bodyB = await resB.json();
  assert.equal(bodyB.counterparty.name, 'Alice Founder');
  assert.equal(bodyB.counterparty.email, null);
  assert.equal(bodyB.counterparty.email_withheld, 'until_both_sign');
});

test('counterparty email is withheld when only one party has signed', async () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO cofounder_connections (id, uid, user_a_id, user_b_id, status, nda_signed_at_a)
    VALUES (2, 'conn-one-signed', ?, ?, 'pending_nda', '2026-10-06T12:00:00Z')
  `).run(USER_A, USER_B);

  const { app, env } = makeApp(db);
  const tokenA = await createJWT(env, USER_A, 'alice@founder.test', 'founder');
  const tokenB = await createJWT(env, USER_B, 'bob@candidate.test', 'founder');

  // User A view (signed)
  const resA = await app.request('/api/cofounder/connections/conn-one-signed', {
    headers: { Authorization: `Bearer ${tokenA}` },
  }, env);
  assert.equal(resA.status, 200);
  const bodyA = await resA.json();
  assert.equal(bodyA.counterparty.email, null);
  assert.equal(bodyA.counterparty.email_withheld, 'until_both_sign');

  // User B view (unsigned)
  const resB = await app.request('/api/cofounder/connections/conn-one-signed', {
    headers: { Authorization: `Bearer ${tokenB}` },
  }, env);
  assert.equal(resB.status, 200);
  const bodyB = await resB.json();
  assert.equal(bodyB.counterparty.email, null);
  assert.equal(bodyB.counterparty.email_withheld, 'until_both_sign');
});

test('counterparty email is revealed once both sides have signed', async () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO cofounder_connections (id, uid, user_a_id, user_b_id, status, nda_signed_at_a, nda_signed_at_b)
    VALUES (3, 'conn-both-signed', ?, ?, 'active', '2026-10-06T12:00:00Z', '2026-10-06T12:05:00Z')
  `).run(USER_A, USER_B);

  const { app, env } = makeApp(db);
  const tokenA = await createJWT(env, USER_A, 'alice@founder.test', 'founder');
  const tokenB = await createJWT(env, USER_B, 'bob@candidate.test', 'founder');

  // User A view sees Bob's email
  const resA = await app.request('/api/cofounder/connections/conn-both-signed', {
    headers: { Authorization: `Bearer ${tokenA}` },
  }, env);
  assert.equal(resA.status, 200);
  const bodyA = await resA.json();
  assert.equal(bodyA.counterparty.email, 'bob@candidate.test');
  assert.equal(bodyA.counterparty.email_withheld, undefined);

  // User B view sees Alice's email
  const resB = await app.request('/api/cofounder/connections/conn-both-signed', {
    headers: { Authorization: `Bearer ${tokenB}` },
  }, env);
  assert.equal(resB.status, 200);
  const bodyB = await resB.json();
  assert.equal(bodyB.counterparty.email, 'alice@founder.test');
  assert.equal(bodyB.counterparty.email_withheld, undefined);
});

test('connection closed before both signed keeps email hidden', async () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO cofounder_connections (id, uid, user_a_id, user_b_id, status, nda_signed_at_a, closed_at, closed_reason)
    VALUES (4, 'conn-closed-early', ?, ?, 'closed', '2026-10-06T12:00:00Z', '2026-10-06T13:00:00Z', 'Not interested')
  `).run(USER_A, USER_B);

  const { app, env } = makeApp(db);
  const tokenA = await createJWT(env, USER_A, 'alice@founder.test', 'founder');
  const tokenB = await createJWT(env, USER_B, 'bob@candidate.test', 'founder');

  const resA = await app.request('/api/cofounder/connections/conn-closed-early', {
    headers: { Authorization: `Bearer ${tokenA}` },
  }, env);
  assert.equal(resA.status, 200);
  const bodyA = await resA.json();
  assert.equal(bodyA.counterparty.email, null);
  assert.equal(bodyA.counterparty.email_withheld, 'until_both_sign');

  const resB = await app.request('/api/cofounder/connections/conn-closed-early', {
    headers: { Authorization: `Bearer ${tokenB}` },
  }, env);
  assert.equal(resB.status, 200);
  const bodyB = await resB.json();
  assert.equal(bodyB.counterparty.email, null);
  assert.equal(bodyB.counterparty.email_withheld, 'until_both_sign');
});

test('admin sees counterparty email even if neither has signed', async () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO cofounder_connections (id, uid, user_a_id, user_b_id, status)
    VALUES (5, 'conn-admin-check', ?, ?, 'pending_nda')
  `).run(USER_A, USER_B);

  const { app, env } = makeApp(db);
  const tokenAdmin = await createJWT(env, USER_ADMIN, 'admin@axal.test', 'admin');

  const res = await app.request('/api/cofounder/connections/conn-admin-check', {
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.counterparty.email, 'Admin sees counterparty email');
  assert.equal(body.counterparty.email_withheld, undefined);
});

test('list endpoint (/connections) and single read (/connections/:uid) agree on withheld email', async () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO cofounder_connections (id, uid, user_a_id, user_b_id, status)
    VALUES (6, 'conn-list-agree', ?, ?, 'pending_nda')
  `).run(USER_A, USER_B);

  const { app, env } = makeApp(db);
  const tokenA = await createJWT(env, USER_A, 'alice@founder.test', 'founder');

  const listRes = await app.request('/api/cofounder/connections', {
    headers: { Authorization: `Bearer ${tokenA}` },
  }, env);
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  const listItem = listBody.items.find((i: any) => i.uid === 'conn-list-agree');
  assert.ok(listItem);

  const singleRes = await app.request('/api/cofounder/connections/conn-list-agree', {
    headers: { Authorization: `Bearer ${tokenA}` },
  }, env);
  assert.equal(singleRes.status, 200);
  const singleBody = await singleRes.json();

  assert.equal(listItem.counterparty.email, singleBody.counterparty.email);
  assert.equal(listItem.counterparty.email_withheld, singleBody.counterparty.email_withheld);
  assert.equal(listItem.counterparty.email, null);
  assert.equal(listItem.counterparty.email_withheld, 'until_both_sign');
});

test('closed connection after both have signed: email is revealed (status-independent, keyed on signatures)', async () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO cofounder_connections (id, uid, user_a_id, user_b_id, status, nda_signed_at_a, nda_signed_at_b, closed_at, closed_reason)
    VALUES (7, 'conn-closed-both-signed', ?, ?, 'closed', '2026-10-06T10:00:00Z', '2026-10-06T11:00:00Z', '2026-10-06T12:00:00Z', 'mutually dissolved')
  `).run(USER_A, USER_B);

  const { app, env } = makeApp(db);
  const tokenA = await createJWT(env, USER_A, 'alice@founder.test', 'founder');

  const res = await app.request('/api/cofounder/connections/conn-closed-both-signed', {
    headers: { Authorization: `Bearer ${tokenA}` },
  }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.counterparty.email, 'bob@candidate.test');
  assert.equal(body.counterparty.email_withheld, undefined);
});
