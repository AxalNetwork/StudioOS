/**
 * D609 (#1309) — Reference checks: an investor reads and changes only the
 * references on deals they can open (invited or committed).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/reference_checks_deal_access_d609.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { createJWT } from '../src/auth.ts';
import references from '../src/routes/references.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1;
const INV_INVITED = 2;
const INV_COMMITTED = 3;
const INV_NEITHER = 4;
const FOUNDER = 5;
const PARTNER = 6;

const DEAL_A = 10;
const DEAL_B = 20;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'deals', 'deal_invitations', 'commitments', 'reference_checks']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }

  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Admin User', 'admin@axal.test');
  u.run(INV_INVITED, 'investor', 'Invited Investor', 'invited@investor.test');
  u.run(INV_COMMITTED, 'investor', 'Committed Investor', 'committed@investor.test');
  u.run(INV_NEITHER, 'investor', 'Neither Investor', 'neither@investor.test');
  u.run(FOUNDER, 'founder', 'Founder User', 'founder@startup.test');
  u.run(PARTNER, 'partner', 'Partner User', 'partner@partner.test');

  const d = db.prepare('INSERT INTO deals (id, project_id, status) VALUES (?, 1, ?)');
  d.run(DEAL_A, 'active');
  d.run(DEAL_B, 'active');

  // INV_INVITED has deal invitation on DEAL_A
  db.prepare('INSERT INTO deal_invitations (deal_id, investor_user_id, status) VALUES (?, ?, ?)').run(DEAL_A, INV_INVITED, 'invited');

  // INV_COMMITTED has commitment on DEAL_B
  db.prepare('INSERT INTO commitments (deal_id, investor_user_id, amount) VALUES (?, ?, ?)').run(DEAL_B, INV_COMMITTED, 50000);

  // References on DEAL_A and DEAL_B
  const ref = db.prepare(`
    INSERT INTO reference_checks (id, uid, deal_id, reference_name, reference_email, status)
    VALUES (?, ?, ?, ?, ?, 'scheduled')
  `);
  ref.run(101, 'ref-a-1', DEAL_A, 'Referee Alpha', 'alpha@ref.test');
  ref.run(201, 'ref-b-1', DEAL_B, 'Referee Beta', 'beta@ref.test');

  return db;
}

function makeApp(db: InstanceType<typeof DatabaseSync>) {
  const env: any = {
    DB: d1Over(db),
    JWT_SECRET,
  };
  const app = new Hono<any>().route('/api/references', references);
  return { app, env };
}

test('GET / without deal_id is refused with 400 deal_id_required', async () => {
  const db = freshDb();
  const { app, env } = makeApp(db);
  const token = await createJWT(env, ADMIN, 'admin@axal.test', 'admin');

  const res = await app.request('/api/references', {
    headers: { Authorization: `Bearer ${token}` },
  }, env);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.detail || body.error, /deal_id_required/);
});

test('founders and partners are refused with 403 on all reference routes', async () => {
  const db = freshDb();
  const { app, env } = makeApp(db);
  const tokenFounder = await createJWT(env, FOUNDER, 'founder@startup.test', 'founder');
  const tokenPartner = await createJWT(env, PARTNER, 'partner@partner.test', 'partner');

  for (const token of [tokenFounder, tokenPartner]) {
    const listRes = await app.request(`/api/references?deal_id=${DEAL_A}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, env);
    assert.equal(listRes.status, 403);

    const getRes = await app.request('/api/references/101', {
      headers: { Authorization: `Bearer ${token}` },
    }, env);
    assert.equal(getRes.status, 403);

    const postRes = await app.request('/api/references', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ deal_id: DEAL_A, reference_name: 'Test' }),
    }, env);
    assert.equal(postRes.status, 403);

    const patchRes = await app.request('/api/references/101', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'Updated' }),
    }, env);
    assert.equal(patchRes.status, 403);

    const deleteRes = await app.request('/api/references/101', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, env);
    assert.equal(deleteRes.status, 403);

    const consentRes = await app.request('/api/references/101/consent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ consent_given: true }),
    }, env);
    assert.equal(consentRes.status, 403);
  }
});

test('admin has access to any deal across reads and writes', async () => {
  const db = freshDb();
  const { app, env } = makeApp(db);
  const token = await createJWT(env, ADMIN, 'admin@axal.test', 'admin');

  // Reads both deals
  const resA = await app.request(`/api/references?deal_id=${DEAL_A}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(resA.status, 200);
  const listA = await resA.json();
  assert.equal(listA.length, 1);
  assert.equal(listA[0].id, 101);

  const resB = await app.request(`/api/references?deal_id=${DEAL_B}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(resB.status, 200);

  // Single get on both
  const get1 = await app.request('/api/references/101', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(get1.status, 200);
  const get2 = await app.request('/api/references/201', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(get2.status, 200);

  // Create on Deal A
  const postRes = await app.request('/api/references', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ deal_id: DEAL_A, reference_name: 'Admin Ref' }),
  }, env);
  assert.equal(postRes.status, 200);
});

test('invited investor can access only invited deal; other deal returns 404', async () => {
  const db = freshDb();
  const { app, env } = makeApp(db);
  const token = await createJWT(env, INV_INVITED, 'invited@investor.test', 'investor');

  // Can list Deal A
  const listA = await app.request(`/api/references?deal_id=${DEAL_A}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(listA.status, 200);

  // Cannot list Deal B (404)
  const listB = await app.request(`/api/references?deal_id=${DEAL_B}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(listB.status, 404);

  // Can read Ref 101 on Deal A
  const getA = await app.request('/api/references/101', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(getA.status, 200);

  // Cannot read Ref 201 on Deal B (404)
  const getB = await app.request('/api/references/201', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(getB.status, 404);

  // Can create on Deal A
  const postA = await app.request('/api/references', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ deal_id: DEAL_A, reference_name: 'Invited Ref' }),
  }, env);
  assert.equal(postA.status, 200);

  // Cannot create on Deal B (404)
  const postB = await app.request('/api/references', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ deal_id: DEAL_B, reference_name: 'Invited Ref' }),
  }, env);
  assert.equal(postB.status, 404);

  // Can update Ref 101 on Deal A
  const patchA = await app.request('/api/references/101', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'Invited note' }),
  }, env);
  assert.equal(patchA.status, 200);

  // Cannot update Ref 201 on Deal B (404)
  const patchB = await app.request('/api/references/201', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'Intruder note' }),
  }, env);
  assert.equal(patchB.status, 404);

  // Cannot delete Ref 201 on Deal B (404)
  const deleteB = await app.request('/api/references/201', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }, env);
  assert.equal(deleteB.status, 404);
  const refBStillExists = db.prepare('SELECT id FROM reference_checks WHERE id = 201').get();
  assert.ok(refBStillExists, 'Ref 201 on Deal B must remain in DB after refused delete');

  // Invited investor refused consent on other deal's reference (Deal B Ref 201)
  const consentB = await app.request('/api/references/201/consent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ consent_given: true }),
  }, env);
  assert.equal(consentB.status, 404);
  const refBConsent = db.prepare('SELECT consent_given FROM reference_checks WHERE id = 201').get() as any;
  assert.equal(refBConsent.consent_given, 0, 'Consent on Ref 201 must remain unchanged (0)');

  // Invited investor allowed consent on invited deal's reference (Deal A Ref 101)
  const consentA = await app.request('/api/references/101/consent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ consent_given: true, consent_text: 'Agreed' }),
  }, env);
  assert.equal(consentA.status, 200);
  const refAConsent = db.prepare('SELECT consent_given FROM reference_checks WHERE id = 101').get() as any;
  assert.equal(refAConsent.consent_given, 1, 'Consent on Ref 101 must be recorded');

  // Can delete Ref 101 on Deal A
  const deleteA = await app.request('/api/references/101', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }, env);
  assert.equal(deleteA.status, 200);
});

test('committed investor can access committed deal across reads and writes; uncommitted deal returns 404', async () => {
  const db = freshDb();
  const { app, env } = makeApp(db);
  const token = await createJWT(env, INV_COMMITTED, 'committed@investor.test', 'investor');

  // Can list Deal B
  const listB = await app.request(`/api/references?deal_id=${DEAL_B}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(listB.status, 200);

  // Cannot list Deal A (404)
  const listA = await app.request(`/api/references?deal_id=${DEAL_A}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(listA.status, 404);

  // Can read Ref 201 on Deal B
  const getB = await app.request('/api/references/201', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(getB.status, 200);

  // Cannot read Ref 101 on Deal A (404)
  const getA = await app.request('/api/references/101', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(getA.status, 404);

  // Allowed write on committed deal: update Ref 201 on Deal B
  const patchB = await app.request('/api/references/201', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'Committed investor note' }),
  }, env);
  assert.equal(patchB.status, 200);
  const row201 = db.prepare('SELECT notes FROM reference_checks WHERE id = 201').get() as any;
  assert.equal(row201.notes, 'Committed investor note');

  // Allowed write on committed deal: create on Deal B
  const postB = await app.request('/api/references', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ deal_id: DEAL_B, reference_name: 'Committed New Ref' }),
  }, env);
  assert.equal(postB.status, 200);

  // Refused writes on uncommitted deal (Deal A Ref 101)
  const postA = await app.request('/api/references', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ deal_id: DEAL_A, reference_name: 'Intruder Ref' }),
  }, env);
  assert.equal(postA.status, 404);

  const patchA = await app.request('/api/references/101', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'Intruder note' }),
  }, env);
  assert.equal(patchA.status, 404);

  const deleteA = await app.request('/api/references/101', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }, env);
  assert.equal(deleteA.status, 404);
  assert.ok(db.prepare('SELECT id FROM reference_checks WHERE id = 101').get(), 'Ref 101 must remain untouched');

  const consentA = await app.request('/api/references/101/consent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ consent_given: true }),
  }, env);
  assert.equal(consentA.status, 404);
  const row101Consent = db.prepare('SELECT consent_given FROM reference_checks WHERE id = 101').get() as any;
  assert.equal(row101Consent.consent_given, 0, 'Ref 101 consent must remain unchanged (0)');
});

test('uninvited and uncommitted investor cannot access any deal or reference across reads and writes', async () => {
  const db = freshDb();
  const { app, env } = makeApp(db);
  const token = await createJWT(env, INV_NEITHER, 'neither@investor.test', 'investor');

  // Reads refused 404
  assert.equal((await app.request(`/api/references?deal_id=${DEAL_A}`, { headers: { Authorization: `Bearer ${token}` } }, env)).status, 404);
  assert.equal((await app.request(`/api/references?deal_id=${DEAL_B}`, { headers: { Authorization: `Bearer ${token}` } }, env)).status, 404);
  assert.equal((await app.request('/api/references/101', { headers: { Authorization: `Bearer ${token}` } }, env)).status, 404);
  assert.equal((await app.request('/api/references/201', { headers: { Authorization: `Bearer ${token}` } }, env)).status, 404);

  // Writes refused 404 with rows untouched
  const countBefore = (db.prepare('SELECT COUNT(*) AS c FROM reference_checks').get() as any).c;

  const postRes = await app.request('/api/references', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ deal_id: DEAL_A, reference_name: 'Intruder' }),
  }, env);
  assert.equal(postRes.status, 404);
  const countAfter = (db.prepare('SELECT COUNT(*) AS c FROM reference_checks').get() as any).c;
  assert.equal(countAfter, countBefore, 'No row inserted');

  const patchRes = await app.request('/api/references/101', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'Intruder' }),
  }, env);
  assert.equal(patchRes.status, 404);
  const row101 = db.prepare('SELECT notes FROM reference_checks WHERE id = 101').get() as any;
  assert.equal(row101.notes, null, 'Row 101 notes must remain null');

  const deleteRes = await app.request('/api/references/101', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }, env);
  assert.equal(deleteRes.status, 404);
  assert.ok(db.prepare('SELECT id FROM reference_checks WHERE id = 101').get(), 'Row 101 must not be deleted');

  const consentRes = await app.request('/api/references/101/consent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ consent_given: true }),
  }, env);
  assert.equal(consentRes.status, 404);
  const consentRow = db.prepare('SELECT consent_given FROM reference_checks WHERE id = 101').get() as any;
  assert.equal(consentRow.consent_given, 0, 'Consent must remain 0');
});

test('create checks that the deal exists (404 for unknown deal)', async () => {
  const db = freshDb();
  const { app, env } = makeApp(db);
  const tokenAdmin = await createJWT(env, ADMIN, 'admin@axal.test', 'admin');
  const tokenInvestor = await createJWT(env, INV_INVITED, 'invited@investor.test', 'investor');

  const postAdmin = await app.request('/api/references', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'content-type': 'application/json' },
    body: JSON.stringify({ deal_id: 9999, reference_name: 'Ghost' }),
  }, env);
  assert.equal(postAdmin.status, 404);

  const postInv = await app.request('/api/references', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenInvestor}`, 'content-type': 'application/json' },
    body: JSON.stringify({ deal_id: 9999, reference_name: 'Ghost' }),
  }, env);
  assert.equal(postInv.status, 404);
});
