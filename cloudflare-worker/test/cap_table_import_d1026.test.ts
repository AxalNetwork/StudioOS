/**
 * D1026 (#2863) — the two Worker routes Cap table part 11 draws on: a
 * spreadsheet's rows as proposals (origin 'import', never on the record) and
 * the record with its history as one CSV, audited. Same fixture as D1017's.
 *
 * Originally D1017 (#2854) — Cap table part 2: the record (migration 573). Issuances,
 * share classes, outstanding and fully diluted, proposals, record and void,
 * the admin's reason, the history read and a currency per venture.
 *
 * Run on a database built from the baseline and every migration, as
 * production builds it; 573 is applied whole and must apply.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cap_table_record_d1017.test.ts
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
const RECORD = '573_cap_table_record.sql';
const JWT_SECRET = 'unit-test-jwt-secret-d1026-0123456789';

// 1 admin · 2 partner (unrelated) · 3 investor member · 4 owner · 5 co-founder · 6 advisor
// 7 co-founder on the free plan · 8 a member whose recorded role is owner · 9 another venture's founder
const USERS: Array<[number, string, number | null, string]> = [
  [1, 'admin', null, 'studio'], [2, 'partner', null, 'studio'], [3, 'investor', null, 'studio'], [4, 'founder', 40, 'studio'],
  [5, 'founder', 50, 'studio'], [6, 'advisor', null, 'studio'], [7, 'founder', 70, 'free'], [8, 'founder', 80, 'studio'], [9, 'founder', 90, 'studio'],
];
const ADMIN = 1, PARTNER = 2, INVESTOR = 3, OWNER = 4, COFOUNDER = 5, ADVISOR = 6, FREE = 7, MEMBER_OWNER = 8, OTHER = 9;

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x !== RECORD).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  // Whole, as the deploy applies it: a failure here fails the file.
  db.exec(readFileSync(resolve(MIGRATIONS, RECORD), 'utf8'));
  return db;
}
const BUILT = built();

function fresh() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const [id, role, founder, tier] of USERS) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(id, `u-${id}`, `person${id}@example.test`, `Person ${id}`, role, founder, tier);
  }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-10', 'Synthetic Venture', 40), (20, 'p-20', 'Other Venture', 90);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES
      (10, ${COFOUNDER}, 'cofounder', 'accepted'), (10, ${ADVISOR}, 'advisor', 'accepted'), (10, ${INVESTOR}, 'cofounder', 'accepted'),
      (10, ${FREE}, 'cofounder', 'accepted'), (10, ${MEMBER_OWNER}, 'owner', 'accepted');
    INSERT INTO cap_table_holders (id, user_id, project_id, name) VALUES (101, ${OWNER}, 10, 'Ada Founder'), (201, ${OTHER}, 20, 'Elsewhere');`);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}

async function call(f: any, id: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await captable.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}
const one = (f: any, sql: string, ...args: any[]) => f.db.prepare(sql).get(...args) as any;
const FILE = 'a'.repeat(64);

async function classes(f: any) {
  const common = (await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Common', kind: 'common' })).body.class;
  const pool = (await call(f, OWNER, '/record/10/classes', 'POST', { name: '2026 Plan', kind: 'option_pool', authorized_shares: 1000 })).body.class;
  return { common, pool };
}

test('an import proposes each row, origin import, and nothing lands on the record', async () => {
  const f = fresh();
  try {
    const c = await classes(f);
    const rows = [
      { row: 1, kind: 'founding', holder_name: 'Ada Founder', class_uid: c.common.uid, shares: 8000, issued_on: '2025-01-03' },
      { row: 2, kind: 'grant', holder_name: 'Cy', class_uid: c.pool.uid, shares: 100, issued_on: '2026-09-01' },
      { row: 4, kind: 'safe', holder_name: 'Angel', amount_cents: 2_500_000 },
    ];
    const r = await call(f, COFOUNDER, '/record/10/proposals/import', 'POST', { file_ref: FILE, rows });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.proposed, 3);
    const got = f.db.prepare(`SELECT status, origin, origin_ref, source, kind, currency FROM cap_table_issuances ORDER BY id`).all() as any[];
    assert.deepEqual(got.map((x: any) => [x.status, x.origin, x.origin_ref, x.source]), [
      ['proposed', 'import', `${FILE}:1`, 'document'], ['proposed', 'import', `${FILE}:2`, 'document'], ['proposed', 'import', `${FILE}:4`, 'document'],
    ]);
    assert.deepEqual(got.map((x: any) => x.currency), [null, null, 'USD'], 'money carries the venture’s currency');
    const read = (await call(f, OWNER, '/record/10')).body;
    assert.equal(read.outstanding.available, false, 'nothing counts until accepted');
    assert.equal(read.proposals.rows.length, 3);
    assert.equal(one(f, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'captable.import.proposed' AND project_id = 10`).n, 1, 'one audit row for the import');
    // The same file again is refused, whole.
    const again = await call(f, OWNER, '/record/10/proposals/import', 'POST', { file_ref: FILE, rows: [rows[0]] });
    assert.deepEqual([again.status, again.body.error], [409, 'already_imported']);
    assert.equal(one(f, 'SELECT COUNT(*) AS n FROM cap_table_issuances').n, 3);
  } finally { f.db.close(); }
});

test('one bad row refuses the import with its row number, and nothing is written', async () => {
  const f = fresh();
  try {
    const c = await classes(f);
    const good = { row: 1, kind: 'founding', holder_name: 'Ada', class_uid: c.common.uid, shares: 10, issued_on: '2025-01-03' };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ row: 2, kind: 'safe', holder_name: 'A', amount_cents: 100, shares: 5 }, 'bad_shares'],
      [{ row: 2, kind: 'founding', class_uid: c.common.uid, shares: 5 }, 'incomplete'],
      [{ row: 2, kind: 'founding', holder_name: 'A', class_uid: 'nope', shares: 5 }, 'unknown_class'],
      [{ row: 2, kind: 'founding', holder_name: 'A', shares: -5 }, 'bad_shares'],
      [{ row: 1, kind: 'safe', holder_name: 'A', amount_cents: 100 }, 'bad_row'],
    ];
    for (const [bad, code] of cases) {
      const r = await call(f, OWNER, '/record/10/proposals/import', 'POST', { file_ref: FILE, rows: [good, bad] });
      assert.equal(r.status, 400, r.text);
      assert.equal(r.body.error, code, JSON.stringify(bad));
      if (code !== 'bad_row') assert.equal(r.body.row, 2);
      if (code !== 'bad_row') assert.match(r.body.message, /^Row 2: /);
    }
    assert.equal((await call(f, OWNER, '/record/10/proposals/import', 'POST', { file_ref: 'x', rows: [good] })).body.error, 'bad_file_ref');
    assert.equal((await call(f, OWNER, '/record/10/proposals/import', 'POST', { file_ref: FILE, rows: [] })).body.error, 'nothing_to_import');
    const many = Array.from({ length: 501 }, (_, i) => ({ ...good, row: i + 1 }));
    assert.equal((await call(f, OWNER, '/record/10/proposals/import', 'POST', { file_ref: FILE, rows: many })).body.error, 'too_many_rows');
    assert.equal((await call(f, ADMIN, '/record/10/proposals/import', 'POST', { file_ref: FILE, rows: [good] })).body.error, 'reason_required');
    assert.equal((await call(f, ADVISOR, '/record/10/proposals/import', 'POST', { file_ref: FILE, rows: [good] })).status, 403);
    assert.equal((await call(f, FREE, '/record/10/proposals/import', 'POST', { file_ref: FILE, rows: [good] })).status, 402);
    assert.equal(one(f, 'SELECT COUNT(*) AS n FROM cap_table_issuances').n, 0, 'no refused import wrote a row');
  } finally { f.db.close(); }
});

test('the record and its history as one CSV: every status, formulas neutralised, a missing value blank, audited', async () => {
  const f = fresh();
  try {
    const c = await classes(f);
    const rec = (await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'founding', holder_name: '=HYPERLINK("x")', class_uid: c.common.uid, shares: 100, issued_on: '2025-01-03' })).body.issuance;
    await call(f, OWNER, `/record/10/issuances/${rec.uid}/void`, 'POST', { reason: 'Typed in error' });
    await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'note', holder_name: 'Bridge', amount_cents: 100 });
    const r = await captable.request('/record/10/export.csv', { headers: { Authorization: `Bearer ${await new SignJWT({ user_id: ADVISOR }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}` } }, f.env);
    assert.equal(r.status, 200, 'an advisor reads it');
    assert.match(r.headers.get('Content-Type') || '', /text\/csv/);
    const csv = await r.text();
    assert.match(csv, /^"Cap table record, as of \d{4}-\d{2}-\d{2}"/, 'the title, quoted for its comma');
    assert.match(csv, /'=HYPERLINK/, 'a formula is neutralised');
    assert.match(csv, /founding,void,/);
    assert.match(csv, /Typed in error/);
    assert.match(csv, /\r\nnote,recorded,Bridge,,,,100,USD,,,/, 'a missing value is an empty cell, never 0');
    assert.match(csv, /\r\nHistory\r\n/);
    assert.match(csv, /captable\.issuance\.voided/);
    assert.equal(one(f, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'cap_table_record_exported' AND project_id = 10`).n, 1);
    assert.equal((await call(f, PARTNER, '/record/10/export.csv')).status, 403);
  } finally { f.db.close(); }
});

test('an export whose audit row cannot be written is refused, and nothing is downloaded', async () => {
  const f = fresh();
  try {
    await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'note', holder_name: 'Bridge', amount_cents: 100 });
    f.db.exec(`CREATE TRIGGER no_export BEFORE INSERT ON activity_logs WHEN NEW.action = 'cap_table_record_exported' BEGIN SELECT RAISE(ABORT, 'audit down'); END;`);
    const r = await call(f, OWNER, '/record/10/export.csv');
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'cap_record_export_failed');
  } finally { f.db.close(); }
});
