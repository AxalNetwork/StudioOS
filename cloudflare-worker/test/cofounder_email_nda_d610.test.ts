/**
 * D610 (#1310) — a co-founder connection shows the other person's NAME at
 * every status (the NDA names them) and their EMAIL only once BOTH NDA
 * signatures exist, whatever the status. An admin's read is unchanged.
 *
 * Driven through the real router (`routes/cofounder.ts`) on real
 * `node:sqlite`, with the tables from `schema_baseline.sql`.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cofounder_email_nda_d610.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import cofounder, { emailVisible } from '../src/routes/cofounder.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const ROLE: Record<number, string> = { 1: 'founder', 2: 'founder', 3: 'founder', 4: 'founder', 5: 'founder', 6: 'founder', 9: 'admin' };
const NAME: Record<number, string> = { 1: 'Ada', 2: 'Ben', 3: 'Cy', 4: 'Dee', 5: 'Eve', 6: 'Fay', 9: 'Admin' };
const SIGNED = '2026-10-07 10:00:00';

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cofounder_profiles', 'cofounder_connections']) db.exec(ddl(t));
  const u = db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)`);
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), `${NAME[Number(id)].toLowerCase()}@example.test`, NAME[Number(id)], role);
  const c = db.prepare(`INSERT INTO cofounder_connections (uid, user_a_id, user_b_id, nda_signed_at_a, nda_signed_at_b, status) VALUES (?, ?, ?, ?, ?, ?)`);
  c.run('c-none', 1, 2, null, null, 'pending_nda');          // neither signed
  c.run('c-one', 1, 3, SIGNED, null, 'pending_nda');         // only Ada signed
  c.run('c-both', 1, 4, SIGNED, SIGNED, 'active');           // both signed
  c.run('c-closed-early', 1, 5, null, SIGNED, 'closed');     // closed before both signed
  c.run('c-closed-late', 1, 6, SIGNED, SIGNED, 'closed');    // closed after both signed
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

async function get(db: DatabaseSync, who: number, path: string) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api/cofounder${path}`, { headers: { Authorization: `Bearer ${tok}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const cp = (items: any[], uid: string) => items.find((x) => x.uid === uid).counterparty;

test('D610: no email while neither or only one has signed — for either side', async () => {
  const db = freshDb();
  const ada = (await get(db, 1, '/connections')).body.items;
  for (const uid of ['c-none', 'c-one']) {
    assert.deepEqual([cp(ada, uid).email, cp(ada, uid).email_withheld], [null, 'until_both_sign'], uid);
  }
  assert.equal(cp(ada, 'c-none').name, 'Ben', 'the name, which the NDA carries, stays visible');
  const cy = await get(db, 3, '/connections/c-one');
  assert.deepEqual([cy.body.counterparty.name, cy.body.counterparty.email, cy.body.counterparty.email_withheld], ['Ada', null, 'until_both_sign'],
    'the side that has not signed sees no email either');
  assert.doesNotMatch(JSON.stringify((await get(db, 1, '/connections')).body), /ben@|cy@|eve@/);
});

test('D610: the email once both have signed, whatever the status', async () => {
  const db = freshDb();
  const ada = (await get(db, 1, '/connections')).body.items;
  assert.deepEqual([cp(ada, 'c-both').email, 'email_withheld' in cp(ada, 'c-both')], ['dee@example.test', false]);
  assert.equal(cp(ada, 'c-closed-late').email, 'fay@example.test', 'a connection closed after both signed keeps the email');
});

test('D610: a connection closed before both signed keeps the email hidden', async () => {
  const db = freshDb();
  const ada = (await get(db, 1, '/connections')).body.items;
  assert.deepEqual([cp(ada, 'c-closed-early').email, cp(ada, 'c-closed-early').email_withheld], [null, 'until_both_sign']);
  const eve = await get(db, 5, '/connections/c-closed-early');
  assert.equal(eve.body.counterparty.email, null);
});

test('D610: an admin sees the email at every status', async () => {
  const db = freshDb();
  for (const uid of ['c-none', 'c-one', 'c-closed-early']) {
    const r = await get(db, 9, `/connections/${uid}`);
    assert.equal(r.status, 200);
    assert.match(String(r.body.counterparty.email), /@example\.test$/, uid);
    assert.equal('email_withheld' in r.body.counterparty, false);
  }
  assert.equal(emailVisible({ nda_signed_at_a: null, nda_signed_at_b: null }, { role: 'admin' }), true);
  assert.equal(emailVisible({ nda_signed_at_a: SIGNED, nda_signed_at_b: null }, { role: 'founder' }), false);
});

test('D610: the list and the single read agree', async () => {
  const db = freshDb();
  const list = (await get(db, 1, '/connections')).body.items;
  for (const uid of ['c-none', 'c-one', 'c-both', 'c-closed-early', 'c-closed-late']) {
    const one = (await get(db, 1, `/connections/${uid}`)).body;
    assert.deepEqual(one.counterparty, cp(list, uid), uid);
  }
});
