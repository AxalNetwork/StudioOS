/**
 * D6098 (#6098) — rename or merge one feedback theme in one venture, on real
 * SQLite (the production baseline plus every migration after the cutoff, as
 * `grow_writes_d691.test.ts` builds it). Every venture, person and theme
 * below is made up.
 *
 * Mutation checks (each made by hand, the suite run, and reverted; each
 * failed at least one test here):
 *   - growWriters.ts: drop `project_id = ?` from the product_feedback UPDATE   → "another venture untouched"
 *   - growWriters.ts: drop the roadmap_okrs UPDATE from the batch             → "rename … roadmap items follow", "merge"
 *   - growWriters.ts: drop `project_id = ?` from the roadmap_okrs UPDATE      → "another venture untouched"
 *   - growWriters.ts: drop `if (!to) throw …`                                  → "an empty name is refused"
 *   - growWriters.ts: drop `&& b.merge !== true` guard (merge without asking)  → "merge asks first"
 *   - cycle_grow.ts: register PATCH /feedback/themes after /feedback/:uid      → every write test (404)
 *   - cycle_grow.ts: `project(c, user, b.project, true)` → `false` in write()  → "an advisor cannot"
 *   - cycle_grow.ts: send `parts.themes` to every reader                      → "parts.themes is a writer's"
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_feedback_themes_6098.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1; const COFOUNDER = 2; const ADVISOR = 3; const OTHER = 6;
const PA = 7; const PB = 8;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [COFOUNDER]: 'founder', [ADVISOR]: 'founder', [OTHER]: 'founder' };

const newer = readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(BASELINE);
  for (const name of newer) db.exec(readFileSync(resolve(M, name), 'utf8'));
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');`);
  const u = db.prepare('INSERT INTO users (id, email, name, role, founder_id) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder@example.test', 'Fay Founder', 'founder', 10);
  u.run(COFOUNDER, 'cofounder@example.test', 'Cal Cofounder', 'founder', null);
  u.run(ADVISOR, 'advisor@example.test', 'Ada Advisor', 'founder', null);
  u.run(OTHER, 'other@example.test', 'Oli Other', 'founder', 20);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10), (${PB}, 'Heron Works', 20);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PA}, ${COFOUNDER}, 'cofounder', 'accepted'), (${PA}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO product_feedback (uid, project_id, body, source, theme, status) VALUES
      ('fa1', ${PA}, 'Export is slow', 'customer', 'Exprot', 'open'),
      ('fa2', ${PA}, 'Export lacks columns', 'customer', 'Exprot', 'open'),
      ('fa3', ${PA}, 'Need a CSV', 'team', 'Export', 'open'),
      ('fa4', ${PA}, 'Onboarding is long', 'investor', 'Onboarding', 'open'),
      ('fa5', ${PA}, 'Lowercase twin', 'customer', 'exprot', 'open'),
      ('fb1', ${PB}, 'Other venture row', 'customer', 'Exprot', 'open');
    INSERT INTO roadmap_okrs (id, project_id, objective, feedback_theme) VALUES
      (1, ${PA}, 'Faster export', 'Exprot'), (2, ${PA}, 'CSV export', 'Export'), (3, ${PB}, 'Heron export', 'Exprot');`);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);

async function call(f: { env: any }, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}
const themes = (f: any, who: number, body: Record<string, unknown>, project = PA) =>
  call(f, who, 'PATCH', '/api/cycles/grow/feedback/themes', { project, ...body });
const plain = (r: any) => (r == null ? r : { ...r });
const all = (f: any, sql: string, ...args: any[]) => (f.db.prepare(sql).all(...args) as any[]).map(plain);
const themeOf = (f: any, uid: string) => (f.db.prepare('SELECT theme FROM product_feedback WHERE uid = ?').get(uid) as any).theme;
const itemTheme = (f: any, id: number) => (f.db.prepare('SELECT feedback_theme FROM roadmap_okrs WHERE id = ?').get(id) as any).feedback_theme;
const logs = (f: any) => all(f, "SELECT project_id, entity_type, entity_id, action, details FROM activity_logs WHERE entity_type = 'grow.product-improvement' ORDER BY id");

test('rename: every row of the theme in the venture changes, the roadmap items follow, and one activity row holds the counts', async () => {
  const f = fixture();
  const r = await themes(f, FOUNDER, { from: 'Exprot', to: 'Export speed' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { from: 'Exprot', to: 'Export speed', merged: false, feedback: 2, roadmap_items: 1 });
  assert.equal(themeOf(f, 'fa1'), 'Export speed'); assert.equal(themeOf(f, 'fa2'), 'Export speed');
  assert.equal(itemTheme(f, 1), 'Export speed');
  assert.equal(themeOf(f, 'fa5'), 'exprot', 'matching is exact: another case is another theme');
  assert.equal(themeOf(f, 'fa3'), 'Export'); assert.equal(itemTheme(f, 2), 'Export');
  const l = logs(f);
  assert.equal(l.length, 1, 'one activity row');
  assert.deepEqual(l[0], { project_id: PA, entity_type: 'grow.product-improvement', entity_id: null, action: 'grow_feedback_theme_renamed',
    details: 'Theme renamed on 2 feedback rows and 1 roadmap item' });
  assert.doesNotMatch(l[0].details, /Exprot|Export speed/, 'the summary never holds the theme');
  const who = all(f, "SELECT updated_by FROM product_feedback WHERE uid IN ('fa1','fa2')");
  assert.ok(who.every((w) => w.updated_by === FOUNDER));
});

test('rename: another venture\'s rows and roadmap items are never touched', async () => {
  const f = fixture();
  assert.equal((await themes(f, FOUNDER, { from: 'Exprot', to: 'Export speed' })).status, 200);
  assert.equal(themeOf(f, 'fb1'), 'Exprot');
  assert.equal(itemTheme(f, 3), 'Exprot');
  // The other venture's founder cannot reach this venture's themes.
  assert.equal((await themes(f, OTHER, { from: 'Export speed', to: 'X' })).status, 403);
  // A theme only another venture holds is not found here.
  const f2 = fixture();
  f2.db.exec(`UPDATE product_feedback SET theme = 'Heron only' WHERE uid = 'fb1'`);
  assert.equal((await themes(f2, FOUNDER, { from: 'Heron only', to: 'Mine now' })).status, 404);
  assert.equal(themeOf(f2, 'fb1'), 'Heron only');
});

test('merge asks first: without merge: true a 409 carries the counts and nothing moves', async () => {
  const f = fixture();
  const r = await themes(f, FOUNDER, { from: 'Exprot', to: 'Export' });
  assert.equal(r.status, 409);
  assert.equal(r.body.merge_needed, true);
  assert.equal(r.body.feedback, 2); assert.equal(r.body.roadmap_items, 1);
  assert.equal(r.body.field, 'to');
  assert.match(r.body.detail, /moves 2 feedback rows and 1 roadmap item/);
  assert.equal(themeOf(f, 'fa1'), 'Exprot'); assert.equal(itemTheme(f, 1), 'Exprot');
  assert.equal(logs(f).length, 0);
});

test('merge: with merge: true the rows and roadmap items join the other theme, logged once', async () => {
  const f = fixture();
  const r = await themes(f, COFOUNDER, { from: 'Exprot', to: 'Export', merge: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { from: 'Exprot', to: 'Export', merged: true, feedback: 2, roadmap_items: 1 });
  assert.deepEqual(all(f, `SELECT uid FROM product_feedback WHERE project_id = ${PA} AND theme = 'Export' ORDER BY uid`).map((x) => x.uid), ['fa1', 'fa2', 'fa3']);
  assert.deepEqual(all(f, `SELECT id FROM roadmap_okrs WHERE project_id = ${PA} AND feedback_theme = 'Export' ORDER BY id`).map((x) => x.id), [1, 2]);
  assert.equal(all(f, `SELECT 1 FROM product_feedback WHERE project_id = ${PA} AND theme = 'Exprot'`).length, 0);
  assert.equal(themeOf(f, 'fb1'), 'Exprot'); assert.equal(itemTheme(f, 3), 'Exprot');
  const l = logs(f);
  assert.equal(l.length, 1);
  assert.equal(l[0].action, 'grow_feedback_theme_merged');
  assert.equal(l[0].details, 'Theme merged: 2 feedback rows and 1 roadmap item moved');
});

test('an empty name is refused, and so are a blank source and the same name', async () => {
  const f = fixture();
  for (const to of ['', '   ', null, 7]) {
    const r = await themes(f, FOUNDER, { from: 'Exprot', to });
    assert.equal(r.status, 400, `to=${JSON.stringify(to)}`);
    assert.equal(r.body.field, 'to');
  }
  assert.equal((await themes(f, FOUNDER, { from: '', to: 'X' })).body.field, 'from');
  assert.equal((await themes(f, FOUNDER, { from: 'Exprot', to: '  Exprot ' })).status, 400, 'trimmed, it is the same name');
  assert.equal((await themes(f, FOUNDER, { from: 'Nope', to: 'X' })).status, 404);
  assert.equal(themeOf(f, 'fa1'), 'Exprot');
  assert.equal(logs(f).length, 0);
});

test('writers only: an advisor cannot rename, and the counts part is a writer\'s', async () => {
  const f = fixture();
  const r = await themes(f, ADVISOR, { from: 'Exprot', to: 'Export speed' });
  assert.equal(r.status, 403);
  assert.equal(themeOf(f, 'fa1'), 'Exprot');
  const asAdvisor = await call(f, ADVISOR, 'GET', `/api/cycles/grow/modules/product-improvement?project=${PA}`);
  assert.equal(asAdvisor.status, 200);
  assert.equal(asAdvisor.body.parts?.themes, undefined, 'parts.themes is a writer\'s');
  const asFounder = await call(f, FOUNDER, 'GET', `/api/cycles/grow/modules/product-improvement?project=${PA}`);
  assert.deepEqual(asFounder.body.parts.themes, [
    { theme: 'Export', feedback: 1, roadmap_items: 1 },
    { theme: 'Exprot', feedback: 2, roadmap_items: 1 },
    { theme: 'Onboarding', feedback: 1, roadmap_items: 0 },
    { theme: 'exprot', feedback: 1, roadmap_items: 0 },
  ]);
});

test('PATCH /feedback/:uid still edits one row: `themes` is not read as a uid', async () => {
  const f = fixture();
  const r = await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/feedback/fa4', { project: PA, theme: 'Setup' });
  assert.equal(r.status, 200);
  assert.equal(themeOf(f, 'fa4'), 'Setup');
});
