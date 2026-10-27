/**
 * D1324 (#3485), Fill with Eadwyn part 1 — the founder's brand Save records
 * provenance. `PUT /api/brand/landing/by-project/:pid` (the page at
 * `/build/brand`) files one `fill_provenance` row per field Eadwyn's
 * "Auto-fill with AI" proposed and the founder kept, as the Lab editor's
 * `PUT /landing/pages/:id` does. The page sends only the kept ones
 * (`frontend/src/lib/brand/proposals.js`), so a field the founder rewrote
 * carries no Eadwyn row. On the migrated schema, synthetic rows only; no
 * model runs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/brand_save_provenance_d1324.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import brand from '../src/routes/brand.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { keptProposals, proposalsFrom } from '../../frontend/src/lib/brand/proposals.js';

const SECRET = 'synthetic-brand-provenance-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',202,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (701,'v-acme','Acme Field',101);
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.route('/api/brand', brand);
  const put = async (who: number, body: unknown) => {
    const jwt = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request('/api/brand/landing/by-project/701', { method: 'PUT', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const rows = () => db.prepare("SELECT target_table, target_column, proposed_value, written_value, edited, model, task, decided_by FROM fill_provenance ORDER BY id").all().map((r: any) => ({ ...r }));
  return { db, put, rows };
}

const ANSWER = { ai_generated: true, model: '@cf/test/stub', name: 'Harbour', headline: 'Ship together', subheadline: 'A shared dispatch screen', tagline: 'Every shipment visible' };
const DRAFT = { name: 'Harbour', headline: 'Ship together', subheadline: 'Our own words, typed', tagline: 'Every shipment visible', cta_text: 'Join the waitlist', template: 'minimal', theme_color: '#7c3aed' };

test('the brand Save files one row per field Eadwyn proposed and the founder kept, and none for a field the founder changed', async () => {
  const t = fixture();
  const kept = keptProposals(DRAFT, proposalsFrom(ANSWER));
  assert.deepEqual(Object.keys(kept).sort(), ['headline', 'name', 'tagline'], 'the rewritten subheadline is the founder’s');
  const r = await t.put(11, { ...DRAFT, ai_proposals: kept, ai_model: ANSWER.model });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rows = t.rows();
  assert.deepEqual(rows.map((x: any) => x.target_column).sort(), ['headline', 'name', 'tagline']);
  for (const x of rows) {
    assert.equal(x.target_table, 'landing_pages');
    assert.equal(x.proposed_value, x.written_value);
    assert.equal(x.edited, 0);
    assert.deepEqual([x.task, x.decided_by], ['brand_autofill', 11]);
  }
  assert.equal(rows.find((x: any) => x.target_column === 'subheadline'), undefined);
});

test('a Save with nothing from Eadwyn files nothing; a heuristic answer proposes nothing; a non-owner saves nothing', async () => {
  const t = fixture();
  assert.equal((await t.put(11, DRAFT)).status, 200);
  assert.deepEqual(t.rows(), []);
  assert.deepEqual(proposalsFrom({ ...ANSWER, ai_generated: false }), {}, 'a fallback answer is not Eadwyn’s');
  assert.deepEqual(proposalsFrom({ ...ANSWER, headline: '  ' }).headline, undefined, 'an empty proposal is not one');
  assert.deepEqual(keptProposals({ ...DRAFT, headline: ' Ship together ' }, { headline: 'Ship together' }), { headline: 'Ship together' }, 'whitespace is not an edit');
  assert.deepEqual(keptProposals(DRAFT, { content_json: 'x', headline: 'Ship together' }), { headline: 'Ship together' }, 'only the page’s own columns');
  const other = await t.put(22, { ...DRAFT, ai_proposals: { headline: 'Ship together' } });
  assert.equal(other.status, 403);
  assert.deepEqual(t.rows(), []);
});
