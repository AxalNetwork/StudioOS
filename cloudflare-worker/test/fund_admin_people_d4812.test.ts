/**
 * D4812 part 3 (#4812, FA-04 B) — `GET /api/fund-admin/funds/:id/people`, the
 * person picker's read.
 *
 *   · any HQ admin reads who holds the role, by name and kind, never email;
 *   · only the Super Admin is shown candidates, each with the Worker's own
 *     eligibility (GP of record: an active HQ admin; ledger administrator: an
 *     active investor account) and the reason when not eligible;
 *   · a fund not administered here is a 404; a bad role or a long q is a 400;
 *     the search text is bound, its wildcards escaped;
 *   · a founder, a support session and a branch Worker are refused.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_admin_people_d4812.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import fundAdmin from '../src/routes/fund_admin.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ADMIN, SUPER, FOUNDER, INVESTOR, JTI, envFor, freshDb, tokenFor } from './_mercury_fixture.ts';

const app = new Hono<any>();
app.route('/api/fund-admin', fundAdmin);
app.onError((err: any, c) => c.json({ detail: err?.message }, AUTH_ERROR_STATUSES[err?.message ?? ''] ?? 500));

function seeded() {
  const db = freshDb();
  db.exec(`ALTER TABLE vc_funds ADD COLUMN fund_admin_user_id INTEGER;
INSERT INTO users (id, role, name, email, is_active) VALUES
  (950, 'admin', 'R. Haddad', 'haddad@example.invalid', 1),
  (951, 'investor', 'M. Okafor', 'okafor@example.invalid', 1),
  (952, 'investor', 'Dormant Investor', 'dormant@example.invalid', 0),
  (953, 'founder', 'Hidden Founder', 'founder@example.invalid', 1),
  (954, 'investor', 'Percent_Name 100%', 'pct@example.invalid', 1);
INSERT INTO vc_funds (id, name, gp_user_id, fund_admin_user_id) VALUES (1, 'Spin-Out Fund I', ${SUPER}, 951), (2, 'Outside Fund', ${FOUNDER}, NULL);`);
  return db;
}

async function get(db: any, as: number, path: string, opts: { jti?: string; impersonated?: boolean; env?: Record<string, unknown> } = {}) {
  const res: Response = await (app.request(`/api/fund-admin/funds${path}`, {
    headers: { Authorization: `Bearer ${await tokenFor(as, opts)}` },
  }, envFor(db, opts.env)) as Promise<Response>).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

test('roles: a founder, an investor, a support session and a branch are refused', async () => {
  const db = seeded();
  for (const u of [FOUNDER, INVESTOR]) assert.equal((await get(db, u, '/1/people?role=gp')).status, 403);
  const support = await get(db, SUPER, '/1/people?role=gp', { jti: JTI.superFresh, impersonated: true });
  assert.equal(support.status, 403);
  assert.equal((await get(db, ADMIN, '/1/people?role=gp', { jti: JTI.adminTotp, env: { BRANCH_CODE: 'fr' } })).status, 403);
});

test('an Admin reads who holds each role, by name, and is shown no candidates', async () => {
  const db = seeded();
  const gp = await get(db, ADMIN, '/1/people?role=gp', { jti: JTI.adminTotp });
  assert.equal(gp.status, 200, gp.text);
  assert.deepEqual([gp.body.current.name, gp.body.current.kind, gp.body.current.current, gp.body.candidates], [`User ${SUPER}`, 'HQ admin', true, null]);
  const ledger = await get(db, ADMIN, '/1/people?role=ledger', { jti: JTI.adminTotp });
  assert.deepEqual([ledger.body.current.name, ledger.body.current.kind, ledger.body.current.eligible], ['M. Okafor', 'Investor account', true]);
  assert.ok(!gp.text.includes('@') && !ledger.text.includes('@'), 'no email leaves');
});

test('the Super Admin sees candidates with the Worker\'s eligibility and reasons', async () => {
  const db = seeded();
  const gp = await get(db, SUPER, '/1/people?role=gp', { jti: JTI.superFresh });
  const byName = Object.fromEntries(gp.body.candidates.map((p: any) => [p.name, p]));
  assert.equal(byName['R. Haddad'].eligible, true);
  assert.equal(byName['M. Okafor'].eligible, false);
  assert.match(byName['M. Okafor'].reason, /general partner of record of an administered fund is an HQ admin/);
  assert.ok(!('Hidden Founder' in byName), 'only admin and investor accounts are searched');
  assert.ok(!('Dormant Investor' in byName), 'an inactive account is not offered');
  assert.equal(gp.body.candidates[0].kind, 'HQ admin', 'eligible kinds first');
  const ledger = await get(db, SUPER, '/1/people?role=ledger', { jti: JTI.superFresh });
  const l = Object.fromEntries(ledger.body.candidates.map((p: any) => [p.name, p]));
  assert.deepEqual([l['M. Okafor'].eligible, l['M. Okafor'].current], [true, true]);
  assert.equal(l['R. Haddad'].eligible, false);
  assert.match(l['R. Haddad'].reason, /active investor account/);
  assert.ok(!ledger.text.includes('@'));
});

test('the search is bound and its wildcards are literal', async () => {
  const db = seeded();
  const hit = await get(db, SUPER, `/1/people?role=ledger&q=${encodeURIComponent('Haddad')}`, { jti: JTI.superFresh });
  assert.deepEqual(hit.body.candidates.map((p: any) => p.name), ['R. Haddad']);
  const pct = await get(db, SUPER, `/1/people?role=ledger&q=${encodeURIComponent('%')}`, { jti: JTI.superFresh });
  assert.deepEqual(pct.body.candidates.map((p: any) => p.name), ['Percent_Name 100%'], '% matches only a literal %');
  const inj = await get(db, SUPER, `/1/people?role=ledger&q=${encodeURIComponent("' OR 1=1 --")}`, { jti: JTI.superFresh });
  assert.deepEqual(inj.body.candidates, []);
});

test('a fund not administered is a 404; bad parameters are a 400', async () => {
  const db = seeded();
  assert.equal((await get(db, SUPER, '/2/people?role=gp', { jti: JTI.superFresh })).status, 404);
  assert.equal((await get(db, SUPER, '/99/people?role=gp', { jti: JTI.superFresh })).status, 404);
  for (const q of ['/1/people', '/1/people?role=owner', `/1/people?role=gp&q=${'x'.repeat(61)}`, '/0/people?role=gp', '/1x/people?role=gp']) {
    const r = await get(db, SUPER, q, { jti: JTI.superFresh });
    assert.deepEqual([r.status, r.body?.code], [400, 'invalid_people_query'], q);
  }
});
