// D717 (#1782) decisions 5 and 6 — page-1 thumbnails and the documents not in
// the catalog.
//
// PR 1a ships `/templates/outside` (rows only). The thumbnail routes come with
// PR 1b, after #1776's renderer, and their tests join this file then.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'unit-test-secret-d717-thumbs-0123456789abcd';
const MIGRATIONS = 'cloudflare-worker/sql/migrations';
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
  for (const t of ['users', 'legal_templates', 'legal_template_versions']) db.exec(tableFromBaseline(baseline, t));
  for (const f of ['085_seed_legal_templates', '105_fill_legal_template_bodies', '113_refresh_legal_template_bodies']) {
    db.exec(readFileSync(`${MIGRATIONS}/${f}.sql`, 'utf8'));
  }
  db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)').run(1, 'admin', 'HQ owner', 'hq@example.test', 1);
  db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)').run(3, 'founder', 'Founder', 'founder@example.test', 1);
  return db;
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function get(db: DatabaseSync, path: string, who: number | null = 1) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: who === 1 ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  const res = await app.request(`/contracts${path}`, { headers }, { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

test('D717 /templates/outside lists exactly the five keys, each with the row it counts under', async () => {
  const db = fixture();
  const r = await get(db, '/templates/outside');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i: any) => [i.key, i.counted_under.slug]), [
    ['investor_nda_v1', 'investor_nda_axal'],
    ['mentor_nda_v1', 'mentor_nda_axal'],
    ['mentor_disclaimer_v1', 'mentor_engagement_disclaimer'],
    ['partner_msa_v1', 'partner_services'],
    ['nda_3way_founder_investor_axal_v1', 'nda_3way_founder_investor_axal'],
  ]);
  for (const i of r.body.items) {
    const row = db.prepare('SELECT title FROM legal_templates WHERE slug = ? AND is_active = 1').get(i.counted_under.slug) as any;
    assert.equal(i.counted_under.title, row?.title ?? null, i.key);
    assert.ok(i.title.length > 5, i.key);
  }
  assert.ok(r.body.items.some((i: any) => i.counted_under.title), 'at least one row is in the seed catalog');
  assert.equal((await get(db, '/templates/outside', null)).status, 401);
  assert.equal((await get(db, '/templates/outside', 3)).status, 403);
});
