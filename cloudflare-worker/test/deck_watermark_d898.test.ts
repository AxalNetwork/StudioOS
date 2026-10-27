/**
 * D898 group E (#2676) — the deck watermark, saved from the studio's Branding
 * card, through the real mounted route on SQLite.
 *
 *   1. A save that names the venture is one `raise.pitch-deck` row on that
 *      venture's ledger; a clear is another. The row never carries the URL.
 *   2. A save that names no venture writes the watermark and no row, as before.
 *   3. A venture the caller cannot write is refused before anything is saved;
 *      a venture id that is not one is refused too.
 *   4. The plan still decides: a free account is refused, and writes nothing.
 *
 * Every principal and URL is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_watermark_d898.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks from '../src/routes/decks.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const SECRET = 'synthetic-deck-watermark-secret-d898'.repeat(2);
const MARK = 'https://example.test/synthetic-mark.png';

// [id, role, founder_id, tier]
const OWNER = 2, FREE_OWNER = 4, OTHER_FOUNDER = 10, ADMIN = 21;
const principals = [[OWNER, 'founder', 20, 'studio'], [FREE_OWNER, 'founder', 40, 'free'],
  [OTHER_FOUNDER, 'founder', 30, 'studio'], [ADMIN, 'admin', null, 'studio']] as const;

async function call(f: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await f.app.request(path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  const text = await res.text();
  let value: any; try { value = JSON.parse(text); } catch { value = text; }
  return { status: res.status, body: value };
}

async function fixture() {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec('PRAGMA foreign_keys=OFF; ALTER TABLE users ADD COLUMN founder_id INTEGER; ALTER TABLE activity_logs ADD COLUMN project_id INTEGER; ALTER TABLE activity_logs ADD COLUMN entity_type TEXT; ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;');
  f.db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'projects')));
  f.db.exec(`CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    INSERT INTO user_company_links VALUES(${OWNER},101),(${FREE_OWNER},104),(${OTHER_FOUNDER},102);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic venture',20,101),(2,'Synthetic other venture',30,102),(4,'Synthetic free venture',40,104);`);
  for (const [id, role, founder, tier] of principals) {
    f.db.prepare('INSERT OR IGNORE INTO users(id,email,name,role) VALUES(?,?,?,?)').run(id, `synthetic${id}@example.test`, `Synthetic ${id}`, role);
    f.db.prepare('UPDATE users SET role = ?, founder_id = ?, subscription_tier = ?, is_active = 1 WHERE id = ?').run(role, founder, tier, id);
  }
  const env: any = { DB: f.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/decks', decks);
  app.onError((err: any, c: any) => c.json({ error: err?.message === 'Unauthorized' ? 'unauthorized' : 'error' }, err?.message === 'Unauthorized' ? 401 : 500));
  await ensureProjectMembershipSchema(env);
  return { ...f, app, env };
}

const rows = (f: any) => (f.db.prepare("SELECT project_id, user_id, action, details FROM activity_logs WHERE action LIKE 'deck_watermark_%' ORDER BY id").all() as any[]).map((r) => ({ ...r }));
const markOf = (f: any, uid: number) => {
  try { return (f.db.prepare('SELECT watermark_url FROM deck_brand_watermarks WHERE user_id = ?').get(uid) as any)?.watermark_url ?? null; } catch { return null; }
};

test('a save that names the venture is one row on its ledger; a clear is another; neither carries the URL', async () => {
  const f = await fixture();
  const set = await call(f, OWNER, 'PUT', '/api/decks/brand/watermark', { watermark_url: MARK, project_id: 1 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.brand.watermark_url, MARK);
  assert.equal(markOf(f, OWNER), MARK);
  const clear = await call(f, OWNER, 'PUT', '/api/decks/brand/watermark', { watermark_url: null, project_id: 1 });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.brand.watermark_url ?? null, null);
  const logged = rows(f);
  assert.deepEqual(logged.map((r) => [r.project_id, r.user_id, r.action]), [[1, OWNER, 'deck_watermark_set'], [1, OWNER, 'deck_watermark_cleared']]);
  assert.equal(logged.every((r) => !String(r.details || '').includes('example.test')), true, 'the URL is not on the ledger');
});

test('a save that names no venture writes the watermark and no row', async () => {
  const f = await fixture();
  const set = await call(f, OWNER, 'PUT', '/api/decks/brand/watermark', { watermark_url: MARK });
  assert.equal(set.status, 200);
  assert.equal(markOf(f, OWNER), MARK);
  assert.deepEqual(rows(f), []);
});

test('a venture the caller cannot write, or an id that is not one, is refused before anything is saved', async () => {
  const f = await fixture();
  const other = await call(f, OWNER, 'PUT', '/api/decks/brand/watermark', { watermark_url: MARK, project_id: 2 });
  assert.equal(other.status, 403);
  // An admin reads the studio; the deck's writes are not theirs (PD21).
  const admin = await call(f, ADMIN, 'PUT', '/api/decks/brand/watermark', { watermark_url: MARK, project_id: 1 });
  assert.equal(admin.status, 403);
  for (const project_id of [0, -1, 1.5, 'one']) {
    const bad = await call(f, OWNER, 'PUT', '/api/decks/brand/watermark', { watermark_url: MARK, project_id });
    assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_project_id'], String(project_id));
  }
  assert.equal(markOf(f, OWNER), null);
  assert.equal(markOf(f, ADMIN), null);
  assert.deepEqual(rows(f), []);
});

test('the plan still decides: a free account is refused and nothing is written', async () => {
  const f = await fixture();
  const free = await call(f, FREE_OWNER, 'PUT', '/api/decks/brand/watermark', { watermark_url: MARK, project_id: 4 });
  assert.deepEqual([free.status, free.body.error], [402, 'studio_tier_required']);
  assert.equal(markOf(f, FREE_OWNER), null);
  assert.deepEqual(rows(f), []);
});
