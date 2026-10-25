/**
 * D1025 (#2862) — Cap table part 10, the Worker half: History's two blocks
 * (the record's timeline with its filters, and "Changes to scenarios and
 * access"), each paged with its own exact total, and a close's proposal naming
 * its close for CT11b's drawer.
 *
 * Run on a database built from the baseline and every migration, through the
 * real routes.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cap_table_history_d1025.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import captable from '../src/routes/captable.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1025-0123456789';

// 1 admin · 4 owner · 5 co-founder · 6 advisor · 9 another venture's founder
const USERS: Array<[number, string, number | null, string]> = [[1, 'admin', null, 'Quinn Admin'], [4, 'founder', 40, 'Ada Owner'], [5, 'founder', 50, 'Ben Cofounder'], [6, 'advisor', null, 'Ari Advisor'], [9, 'founder', 90, 'Oz Other']];
const ADMIN = 1, OWNER = 4, COFOUNDER = 5, ADVISOR = 6, OTHER = 9;

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}
const BUILT = built();

function fresh() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const [id, role, founder, name] of USERS) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(id, `u-${id}`, `person${id}@example.test`, name, role, founder, 'studio');
  }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-10', 'Synthetic Venture', 40), (20, 'p-20', 'Other Venture', 90);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (10, ${COFOUNDER}, 'cofounder', 'accepted'), (10, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO cap_table_holders (id, user_id, project_id, name, shares, ownership_pct, founder_role) VALUES (1, 4, 10, 'Ada Owner', 0, 0, 'CEO'), (2, 5, 10, 'Ben Cofounder', 0, 0, 'CTO');
    INSERT INTO data_room_files (id, uid, project_id, name, r2_key, content_type) VALUES (1, 'f-1', 10, 'Founders RSPA.pdf', 'k/rspa', 'application/pdf');
    INSERT INTO raise_rounds (id, uid, project_id, name, status) VALUES (1, 'rd-1', 10, 'Seed', 'active');
    INSERT INTO raise_closes (id, uid, project_id, round_id, name, sequence, state, closed_date) VALUES (1, 'cl-second', 10, 1, 'Second close', 1, 'closed', '2026-10-09');
    INSERT INTO raise_prospects (id, uid, project_id, name, firm, stage, amount, commit_status, instrument, close_id) VALUES
      (1, 'pr-harbor', 10, 'Hal Partner', 'Harbor Seed Fund', 'committed', 600000, 'signed', 'equity', 1);`);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}

async function call(f: any, id: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await captable.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}

/** A worked record: four recorded rows on known dates, one void, one dismissed, one waiting. */
async function seeded() {
  const f = fresh();
  const cls = await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Common', kind: 'common' });
  assert.equal(cls.status, 201, cls.text);
  const common = cls.body.class.uid;
  const pool = (await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Options', kind: 'option_pool', authorized_shares: 1_500_000 })).body.class.uid;
  const rec = async (who: number, body: Record<string, unknown>) => {
    const r = await call(f, who, '/record/10/issuances', 'POST', body);
    assert.equal(r.status, 201, r.text);
    return r.body.issuance.uid as string;
  };
  const ada = await rec(OWNER, { kind: 'founding', holder_id: 1, class_uid: common, shares: 4_000_000, issued_on: '2025-01-03', source: 'document', document_ref: 'data_room_files:1' });
  const ben = await rec(OWNER, { kind: 'founding', holder_id: 2, class_uid: common, shares: 3_600_000, issued_on: '2025-01-03', source: 'typed' });
  await rec(OWNER, { kind: 'safe', holder_name: 'Northwind Angels', amount_cents: 15_000_000, cap_cents: 1_000_000_000, basis: 'post_money', issued_on: '2026-09-02', source: 'typed' });
  const grant = await rec(OWNER, { kind: 'grant', holder_name: 'Kai Engineer', class_uid: pool, shares: 82_000, price_per_share_micros: 420_000, issued_on: '2026-07-01', source: 'typed' });
  // An admin's correction, with the reason the founder reads.
  await rec(ADMIN, { kind: 'correction', holder_id: 2, class_uid: common, related_uid: ben, shares: -100_000, issued_on: '2026-03-03', source: 'typed', reason: 'Fixed a share count typo' });
  const v = await call(f, OWNER, `/record/10/issuances/${grant}/void`, 'POST', { reason: 'Granted to the wrong person' });
  assert.equal(v.status, 200, v.text);
  const p1 = await call(f, COFOUNDER, '/record/10/proposals', 'POST', { kind: 'founding', holder_name: 'Wanda Waiting', class_uid: common, shares: 10, issued_on: '2026-10-01', source: 'typed' });
  assert.equal(p1.status, 201, p1.text);
  const p2 = await call(f, COFOUNDER, '/record/10/proposals', 'POST', { kind: 'founding', holder_name: 'Dee Dismissed', class_uid: common, shares: 10, issued_on: '2026-10-02', source: 'typed' });
  assert.equal((await call(f, OWNER, `/record/10/proposals/${p2.body.issuance.uid}/dismiss`, 'POST', { reason: 'Not ours' })).status, 200);
  return { f, ada, ben, grant, common };
}

const timeline = (f: any, q = '') => call(f, OWNER, `/record/10/history?section=record${q}`);
const names = (r: any) => r.body.rows.map((x: any) => `${x.at} ${x.issuance.kind} ${x.issuance.holder.name} ${x.issuance.status}`);

test('the timeline: every recorded, void and dismissed row, newest by the date issued; a proposal waits in Needs you', async () => {
  const { f } = await seeded();
  const r = await timeline(f);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.section, 'record');
  assert.equal(r.body.total, 6, 'four recorded, one void, one correction... and the dismissed one; the waiting proposal is not in it');
  assert.deepEqual(names(r), [
    '2026-10-02 founding Dee Dismissed dismissed',
    '2026-09-02 safe Northwind Angels recorded',
    '2026-07-01 grant Kai Engineer void',
    '2026-03-03 correction Ben Cofounder recorded',
    '2025-01-03 founding Ben Cofounder recorded',
    '2025-01-03 founding Ada Owner recorded',
  ]);
  const byKind = Object.fromEntries(r.body.rows.map((x: any) => [`${x.issuance.kind}:${x.issuance.holder.name}`, x.issuance]));
  assert.equal(byKind['grant:Kai Engineer'].void_reason, 'Granted to the wrong person');
  assert.equal(byKind['correction:Ben Cofounder'].correction_reason, 'Fixed a share count typo');
  // Who recorded it: the owner by name, an admin as "an admin" (no name leaves the read).
  assert.deepEqual(byKind['founding:Ada Owner'].recorded_by_who, { name: 'Ada Owner', admin: false });
  assert.deepEqual(byKind['correction:Ben Cofounder'].recorded_by_who, { name: null, admin: true });
  assert.ok(!r.text.includes('Quinn Admin'), 'an admin is never named on the timeline');
  assert.equal(byKind['founding:Ada Owner'].document_ref, 'data_room_files:1');
  assert.ok(!r.text.includes('@example.test'), 'no email leaves the read');
});

test('the filters narrow the count and the page, each on bound values', async () => {
  const { f } = await seeded();
  const n = async (q: string) => (await timeline(f, q)).body.total;
  assert.equal(await n('&kind=founding'), 3, 'two recorded and the dismissed one');
  assert.equal(await n('&source=document'), 1);
  assert.equal(await n('&has_document=1'), 1);
  assert.equal(await n('&has_document=0'), 5);
  assert.equal(await n('&from=2026-01-01'), 4);
  assert.equal(await n('&from=2026-03-03&to=2026-07-01'), 2, 'both ends are inclusive');
  assert.equal(await n('&q=northwind'), 1, 'the holder name, in any case');
  assert.equal(await n('&q=ben'), 2, 'a register holder\'s name is searched');
  assert.equal(await n('&q=%25'), 0, 'a percent sign is a character, not a wildcard');
  assert.equal(await n('&kind=founding&from=2026-01-01'), 1);
  // Pages of 25 by default; a page past the end is empty with the same total.
  const p = await timeline(f, '&page_size=2&page=2');
  assert.equal(p.body.total, 6);
  assert.deepEqual(names(p), ['2026-07-01 grant Kai Engineer void', '2026-03-03 correction Ben Cofounder recorded']);
  assert.equal((await timeline(f, '&page=9')).body.rows.length, 0);
  // A bad filter is refused, never ignored.
  for (const bad of ['section=everything', 'section=record&kind=gift', 'section=record&source=fax', 'section=record&has_document=yes',
    'section=record&from=2026-13-01', 'section=record&from=2026-05-01&to=2026-04-01']) {
    const r = await call(f, OWNER, `/record/10/history?${bad}`);
    assert.equal(r.status, 400, `${bad}: ${r.text}`);
  }
});

test('Changes to scenarios and access: those rows only, newest first, with their own total; another venture\'s are not in it', async () => {
  const { f } = await seeded();
  f.db.exec(`INSERT INTO activity_logs (project_id, user_id, action, details, actor, created_at) VALUES
    (10, ${COFOUNDER}, 'captable_scenario_updated', '{"scenario_uid":"s-1","is_variant":1}', 'a', '2026-10-10 09:00:00'),
    (10, ${OWNER}, 'captable_variant_created', '{"scenario_uid":"s-2","is_variant":1}', 'a', '2026-10-06 09:00:00'),
    (10, ${OWNER}, 'captable_link_created', '{"level":"summary"}', 'a', '2026-10-02 09:00:00'),
    (10, ${OWNER}, 'captable_access_granted', '{"level":"investor"}', 'a', '2026-06-04 09:00:00'),
    (20, ${OTHER}, 'captable_scenario_updated', '{}', 'a', '2026-10-11 09:00:00'),
    (10, ${OWNER}, 'deck_updated', '{}', 'a', '2026-10-11 09:00:00');`);
  const r = await call(f, OWNER, '/record/10/history?section=changes&page_size=3');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.total, 4, 'the record\'s own audit rows (captable.%) and other modules\' rows are not changes');
  assert.deepEqual(r.body.rows.map((x: any) => [x.activity.action, x.activity.user_name]), [
    ['captable_scenario_updated', 'Ben Cofounder'], ['captable_variant_created', 'Ada Owner'], ['captable_link_created', 'Ada Owner'],
  ]);
  assert.equal((await call(f, OWNER, '/record/10/history?section=changes&page=2&page_size=3')).body.rows[0].activity.action, 'captable_access_granted');
});

test('the gates are the record\'s: an advisor reads, another founder is refused', async () => {
  const { f } = await seeded();
  assert.equal((await call(f, ADVISOR, '/record/10/history?section=record')).status, 200);
  assert.equal((await call(f, COFOUNDER, '/record/10/history?section=changes')).status, 200);
  assert.equal((await call(f, OTHER, '/record/10/history?section=record')).status, 403);
  // With no section, D1017's read is unchanged.
  const old = await call(f, OWNER, '/record/10/history');
  assert.equal(old.status, 200);
  assert.equal(old.body.section, undefined);
  assert.ok(old.body.rows.some((x: any) => x.type === 'activity'), 'the merged read keeps its audit rows');
});

test('a close\'s proposal names its close, so its drawer reads the close; other rows carry none', async () => {
  const { f, common } = await seeded();
  const pref = (await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Series Seed Preferred', kind: 'preferred', price_per_share_micros: 1_030_000 })).body.class.uid;
  const run = await call(f, OWNER, '/record/10/closes/cl-second/proposals', 'POST', { class_uid: pref, price_per_share_micros: 1_030_000 });
  assert.equal(run.status, 200, run.text);
  const rec = await call(f, OWNER, '/record/10');
  const closeRow = rec.body.proposals.rows.find((r: any) => r.origin === 'close');
  assert.ok(closeRow, rec.text);
  assert.equal(closeRow.close_uid, 'cl-second');
  assert.equal(closeRow.origin_ref, 'raise_prospect:pr-harbor');
  const typed = rec.body.proposals.rows.find((r: any) => r.origin === 'cofounder');
  assert.equal(typed.close_uid, undefined, 'only a close\'s row is looked up');
  assert.ok(common);
});
