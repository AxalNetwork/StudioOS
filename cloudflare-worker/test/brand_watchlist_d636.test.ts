/**
 * D636 (#1394) — the Worker half of the Ops canvas's sp-brand and sp-watchlist
 * screens, on real SQLite (baseline tables, migrations 399, 415 and 426) and
 * the real routers.
 *
 * What is pinned:
 *   - the site address refuses a malformed address, a reserved word and a
 *     taken address, each with its code and its sentence, and changes nothing;
 *     a change records its actor with the old and new address;
 *   - a saved template records the project it came from; the 51st is refused
 *     with its sentence and nothing is written; save and delete record the
 *     actor; a template from before migration 426 answers `project: null`;
 *   - a watchlist item carries `passed_at`, and the journal lists the entries
 *     about one watchlist item, the caller's own only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/brand_watchlist_d636.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import brand, { SITE_ADDRESS_REFUSALS, PAGE_ADDRESS_REFUSALS } from '../src/routes/brand.ts';
import watchlist from '../src/routes/watchlist.ts';
import journal from '../src/routes/journal.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 10, OTHER = 20, INVESTOR = 30, INVESTOR2 = 40;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'landing_pages', 'brand_sites', 'brand_custom_templates', 'activity_logs',
    'watchlist_items', 'decision_journal_entries']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(MIG('399_landing_brand_voice_dark_logo_archive.sql'));
  db.exec(MIG('415_journal_edited_after_outcome.sql'));
  db.exec(MIG('426_brand_template_source_project.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(OWNER, 'founder', 'Fay Owner', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(INVESTOR, 'investor', 'Ivy', 'ivy@example.test', null);
  u.run(INVESTOR2, 'investor', 'Ned', 'ned@example.test', null);
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001), (2, 'Acme Labs', 1001), (3, 'Beta', 1002)");
  db.exec("INSERT INTO brand_sites (project_id, slug) VALUES (1, 'acme'), (3, 'beta')");
  db.exec("INSERT INTO landing_pages (id, project_id, slug, page_slug, name) VALUES (1, 1, 'acme-x1', 'home', 'Home'), (2, 2, 'acme-labs-x2', 'home', 'Labs home')");
  return db;
}

const app = new Hono<any>();
app.route('/brand', brand);
app.route('/api', watchlist);
app.route('/api/journal', journal as any);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: any, who: number, method: string, path: string, body?: unknown) {
  const role = who === INVESTOR || who === INVESTOR2 ? 'investor' : 'founder';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`,
  };
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const slugOf = (db: any, pid: number) => (db.prepare('SELECT slug FROM brand_sites WHERE project_id = ?').get(pid) as any)?.slug;
const logs = (db: any, action: string) => db.prepare('SELECT user_id, project_id, details FROM activity_logs WHERE action = ? ORDER BY id').all(action)
  .map((r: any) => ({ user_id: r.user_id, project_id: r.project_id, details: JSON.parse(r.details) }));

// ---------------------------------------------------------------------------
// M4 — the site address
// ---------------------------------------------------------------------------

test('the site address refuses a malformed, a reserved and a taken address, each as a sentence, and changes nothing', async () => {
  const db = fixture();
  for (const [slug, status, code, message] of [
    ['Not Valid!', 400, 'address_invalid', SITE_ADDRESS_REFUSALS.invalid],
    ['-acme', 400, 'address_invalid', SITE_ADDRESS_REFUSALS.invalid],
    ['x'.repeat(49), 400, 'address_invalid', SITE_ADDRESS_REFUSALS.invalid],
    ['admin', 400, 'address_reserved', SITE_ADDRESS_REFUSALS.reserved],
    ['beta', 409, 'address_taken', SITE_ADDRESS_REFUSALS.taken],
  ] as const) {
    const r = await call(db, OWNER, 'PUT', '/brand/site/by-project/1', { slug });
    assert.equal(r.status, status, slug);
    assert.equal(r.body.error, code, slug);
    assert.equal(r.body.message, message, slug);
  }
  assert.equal(SITE_ADDRESS_REFUSALS.taken, 'That address is already taken.');
  assert.equal(slugOf(db, 1), 'acme', 'a refused address was written');
  assert.deepEqual(logs(db, 'brand_site_address_change'), [], 'a refusal was recorded as a change');
});

test('an address change is saved and records its actor, the project, and both addresses', async () => {
  const db = fixture();
  const r = await call(db, OWNER, 'PUT', '/brand/site/by-project/1', { slug: 'acme-2026' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { slug: 'acme-2026', path: '/p/acme-2026' });
  assert.equal(slugOf(db, 1), 'acme-2026');
  assert.deepEqual(logs(db, 'brand_site_address_change'), [{ user_id: OWNER, project_id: 1, details: { from: 'acme', to: 'acme-2026' } }]);
  // Saving the same address again records nothing more.
  await call(db, OWNER, 'PUT', '/brand/site/by-project/1', { slug: 'acme-2026' });
  assert.equal(logs(db, 'brand_site_address_change').length, 1);
  // Another founder's project is refused.
  assert.equal((await call(db, OTHER, 'PUT', '/brand/site/by-project/1', { slug: 'mine' })).status, 403);
  assert.equal(slugOf(db, 1), 'acme-2026');
});

test('a page\'s own address changes alone, refuses with sentences, and records its actor', async () => {
  const db = fixture();
  db.exec("INSERT INTO landing_pages (id, project_id, slug, page_slug, name, headline) VALUES (5, 1, 'acme-x5', 'pricing', 'Pricing', 'Keep me')");
  const pageSlugOf = (id: number) => ({ ...(db.prepare('SELECT page_slug, headline FROM landing_pages WHERE id = ?').get(id) as any) });
  for (const [slug, status, code, message] of [
    ['Bad Slug', 400, 'page_address_invalid', PAGE_ADDRESS_REFUSALS.invalid],
    ['admin', 400, 'page_address_reserved', PAGE_ADDRESS_REFUSALS.reserved],
    ['home', 409, 'page_address_taken', PAGE_ADDRESS_REFUSALS.taken],
  ] as const) {
    const r = await call(db, OWNER, 'PUT', '/brand/landing/pages/5/address', { page_slug: slug });
    assert.deepEqual([r.status, r.body.error, r.body.message], [status, code, message], slug);
  }
  assert.equal(pageSlugOf(5).page_slug, 'pricing');
  const ok = await call(db, OWNER, 'PUT', '/brand/landing/pages/5/address', { page_slug: 'plans' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(pageSlugOf(5), { page_slug: 'plans', headline: 'Keep me' }, 'the address change touched another field');
  assert.deepEqual(logs(db, 'brand_page_address_change'), [{ user_id: OWNER, project_id: 1, details: { page_id: 5, from: 'pricing', to: 'plans' } }]);
  assert.equal((await call(db, OTHER, 'PUT', '/brand/landing/pages/5/address', { page_slug: 'theirs' })).status, 403);
  assert.equal(pageSlugOf(5).page_slug, 'plans');
});

// ---------------------------------------------------------------------------
// M4 — saved templates
// ---------------------------------------------------------------------------

test('a saved template names the project it came from, across all the founder\'s projects', async () => {
  const db = fixture();
  const a = await call(db, OWNER, 'POST', '/brand/custom-templates', { name: 'Clean hero', from_page_id: 1 });
  const b = await call(db, OWNER, 'POST', '/brand/custom-templates', { name: 'Labs look', from_page_id: 2 });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201);
  // A template saved before migration 426 has no source recorded.
  db.prepare("INSERT INTO brand_custom_templates (user_id, name, snapshot_json, created_at) VALUES (?, 'Old one', '{}', '2020-01-01 00:00:00')").run(OWNER);
  const list = await call(db, OWNER, 'GET', '/brand/custom-templates');
  assert.equal(list.status, 200);
  assert.equal(list.body.limit, 50);
  assert.deepEqual(list.body.templates.map((t: any) => [t.name, t.project]), [
    ['Labs look', { id: 2, name: 'Acme Labs' }],
    ['Clean hero', { id: 1, name: 'Acme' }],
    ['Old one', null],
  ]);
  assert.deepEqual(logs(db, 'brand_template_save').map((l: any) => [l.user_id, l.project_id, l.details.name]),
    [[OWNER, 1, 'Clean hero'], [OWNER, 2, 'Labs look']]);
  // Another founder sees none of them.
  assert.deepEqual((await call(db, OTHER, 'GET', '/brand/custom-templates')).body.templates, []);
});

test('the 51st template is refused with its sentence, and nothing is written', async () => {
  const db = fixture();
  const ins = db.prepare("INSERT INTO brand_custom_templates (user_id, name, snapshot_json, source_project_id) VALUES (?, ?, '{}', 1)");
  for (let i = 0; i < 49; i += 1) ins.run(OWNER, `T${i}`);
  assert.equal((await call(db, OWNER, 'POST', '/brand/custom-templates', { name: 'Fiftieth', from_page_id: 1 })).status, 201, 'the 50th must be allowed');
  const r = await call(db, OWNER, 'POST', '/brand/custom-templates', { name: 'Fifty-first', from_page_id: 2 });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'template_limit_reached');
  assert.equal(r.body.message, 'You have 50 saved templates, the most allowed across all your projects. Delete one before saving another.');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM brand_custom_templates WHERE user_id = ?').get(OWNER) as any).n;
  assert.equal(n, 50);
  assert.equal(logs(db, 'brand_template_save').length, 1, 'the refused save was recorded');
  // Another founder's count is their own.
  db.exec("INSERT INTO landing_pages (id, project_id, slug, page_slug, name) VALUES (3, 3, 'beta-x3', 'home', 'Beta home')");
  assert.equal((await call(db, OTHER, 'POST', '/brand/custom-templates', { name: 'Mine', from_page_id: 3 })).status, 201);
});

test('a template\'s other refusals are sentences, and a delete records its actor', async () => {
  const db = fixture();
  const noName = await call(db, OWNER, 'POST', '/brand/custom-templates', { name: '  ', from_page_id: 1 });
  assert.deepEqual([noName.status, noName.body.error, noName.body.message], [400, 'template_name_required', 'Give the template a name.']);
  const other = await call(db, OTHER, 'POST', '/brand/custom-templates', { name: 'Steal', from_page_id: 1 });
  assert.deepEqual([other.status, other.body.error], [403, 'forbidden']);
  const saved = await call(db, OWNER, 'POST', '/brand/custom-templates', { name: 'Keep', from_page_id: 1 });
  const notMine = await call(db, OTHER, 'DELETE', `/brand/custom-templates/${saved.body.id}`);
  assert.deepEqual([notMine.status, notMine.body.message], [404, 'That template no longer exists.']);
  assert.equal((await call(db, OWNER, 'DELETE', `/brand/custom-templates/${saved.body.id}`)).status, 200);
  assert.deepEqual(logs(db, 'brand_template_delete'), [{ user_id: OWNER, project_id: 1, details: { template_id: saved.body.id, name: 'Keep' } }]);
});

// ---------------------------------------------------------------------------
// M6 — the watchlist item and its journal entries
// ---------------------------------------------------------------------------

test('a watchlist item carries when it was passed on, and the journal lists the entries about it', async () => {
  const db = fixture();
  db.exec(`INSERT INTO watchlist_items (uid, owner_user_id, external_name, sector, stage, thesis, conviction, status, passed_reason, passed_at, created_at, updated_at)
           VALUES ('w-1', ${INVESTOR}, 'Northwind', 'Fintech', 'Seed', 'A thesis', 'high', 'passed_on', 'Too early', '2026-09-01T10:00:00Z', '2026-08-01', '2026-09-01'),
                  ('w-2', ${INVESTOR}, 'Southwind', null, null, null, null, 'watching', null, null, '2026-08-01', '2026-08-01')`);
  const ids = Object.fromEntries((db.prepare('SELECT uid, id FROM watchlist_items').all() as any[]).map((r) => [r.uid, r.id]));
  const je = db.prepare(`INSERT INTO decision_journal_entries (uid, owner_user_id, watchlist_item_id, decision, conviction, thesis, outcome_status, edited_after_outcome_at)
                         VALUES (?, ?, ?, 'defer', 3, 'The thesis text here', ?, ?)`);
  je.run('j-1', INVESTOR, ids['w-1'], 'partial', '2026-09-20T00:00:00Z');
  je.run('j-2', INVESTOR, ids['w-2'], 'pending', null);
  je.run('j-3', INVESTOR2, ids['w-1'], 'pending', null);

  const item = await call(db, INVESTOR, 'GET', '/api/watchlist/w-1');
  assert.equal(item.status, 200);
  assert.equal(item.body.passed_at, '2026-09-01T10:00:00Z');
  assert.equal(item.body.passed_reason, 'Too early');

  const entries = await call(db, INVESTOR, 'GET', '/api/journal?watchlist_uid=w-1');
  assert.equal(entries.status, 200);
  assert.deepEqual(entries.body.items.map((e: any) => [e.uid, e.edited_after_outcome_at]), [['j-1', '2026-09-20T00:00:00Z']],
    'the list must hold this item\'s entries, and only the caller\'s');
  assert.deepEqual((await call(db, INVESTOR, 'GET', '/api/journal?watchlist_uid=nope')).body.items, []);
  // Without the filter the caller's entries for every item are listed.
  assert.equal((await call(db, INVESTOR, 'GET', '/api/journal')).body.items.length, 2);
});
