/**
 * D1152 (#3057, DL14) — the deal's activity names other investors only for
 * an admin and the deal's own founder, as the commitments read does. An
 * investor reads their own rows as "You …", another investor's commitment
 * as "An investor committed" with no name and no amount, and no other
 * investor's invitation.
 *
 * Driven through the real router (`routes/deals.ts`) on real `node:sqlite`,
 * with the tables from `schema_baseline.sql`. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_activity_names_d1152.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals from '../src/routes/deals.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const ADMIN = 1, ADA = 2, BEN = 3, FOUNDER = 5, PARTNER = 6;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'investor', 3: 'investor', 5: 'founder', 6: 'partner' };
const NAMES: Record<number, string> = { 1: 'Sam Staff', 2: 'Ada Angel', 3: 'Ben Backer', 5: 'Fay Founder', 6: 'Pat Partner' };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'deals', 'deal_invitations', 'commitments']) db.exec(ddl(t));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, NAMES[Number(id)], `u${id}@example.test`);
  db.exec(`UPDATE users SET founder_id = 50 WHERE id = ${FOUNDER}`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (10, 'Harbor Ledger', 50)`);
  db.exec(`INSERT INTO deals (id, project_id, created_at) VALUES (1, 10, '2026-10-01 09:00:00')`);
  db.exec(`INSERT INTO deal_invitations (deal_id, investor_user_id, status, created_at) VALUES
    (1, ${ADA}, 'interested', '2026-10-02 09:00:00'), (1, ${BEN}, 'invited', '2026-10-03 09:00:00')`);
  db.exec(`INSERT INTO commitments (deal_id, investor_user_id, amount, status, created_at) VALUES
    (1, ${ADA}, 50000, 'pending', '2026-10-05 09:00:00'), (1, ${BEN}, 75000, 'confirmed', '2026-10-06 09:00:00')`);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/deals', deals as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function activity(db: DatabaseSync, who: number) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request('http://x/api/deals/1/activity', { headers: { Authorization: `Bearer ${tok}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}

test('an investor reads their own rows as "You", another investor\'s commitment with no name or amount, and no other invitation', async () => {
  const db = freshDb();
  try {
    const r = await activity(db, ADA);
    assert.equal(r.status, 200, r.text);
    const labels = r.body.map((e: any) => e.label);
    assert.deepEqual(labels, ['An investor committed', 'You committed 50,000 USD', 'You said you’re interested', 'Deal created']);
    assert.deepEqual(r.body.map((e: any) => e.mine), [false, true, true, false]);
    for (const other of ['Ben Backer', '75,000', 'invited']) assert.ok(!r.text.includes(other), `the reply carries ${other}`);
    const ben = (await activity(db, BEN)).body.map((e: any) => e.label);
    assert.deepEqual(ben, ['You committed 75,000 USD', 'An investor committed', 'You were invited', 'Deal created']);
  } finally { db.close(); }
});

test('an admin, the deal\'s founder and an Operating Partner read every investor by name and amount (D1155, DL15)', async () => {
  const db = freshDb();
  try {
    for (const who of [ADMIN, FOUNDER, PARTNER]) {
      const labels = (await activity(db, who)).body.map((e: any) => e.label);
      assert.ok(labels.includes('Ben Backer committed 75,000 USD'), `${ROLE[who]}: ${labels}`);
      assert.ok(labels.includes('Ada Angel committed 50,000 USD'));
      assert.ok(labels.includes('Ada Angel invited — interested'));
    }
  } finally { db.close(); }
});
