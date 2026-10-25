/**
 * D1124 (#3004) — a program page's Download (CSV): `POST /api/admin/programs/:key/export`.
 *
 * On the baseline and every migration, as production builds it:
 *  1. Each of the four programs exports the catalogue's figures for it, counts
 *     only, with Refer & Earn's funnel; one audit row per export, never a figure.
 *  2. Refusals: not an admin; an unknown program; a program with no figures;
 *     bad weeks; and no file when the audit row cannot be written.
 *  3. The pieces: an unread block is a word, never a zero; strings never copy;
 *     a formula never starts a cell; a file with an email is refused.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_export_d1124.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import adminPrograms from '../src/routes/admin_programs.ts';
import { EXPORTABLE_PROGRAMS, cell, exportCsv, flatten } from '../src/services/programExport.ts';
import { refusesCountsOnly } from '../src/services/insightsExport.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 2, FOUNDER = 5;

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const [id, role, email] of [[ADMIN, 'admin', 'admin@axal.example'], [FOUNDER, 'founder', 'ana@venture.example']] as const) {
    db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)').run(id, email, `Person ${id}`, role);
  }
  // Two referrals, one reaching Qualified: the funnel has something to count, and a name the file must never carry.
  db.exec(`CREATE TABLE IF NOT EXISTS referral_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, referrer_user_id INTEGER NOT NULL,
             category TEXT NOT NULL DEFAULT 'startup', referred_name TEXT NOT NULL, referred_org TEXT, referred_contact TEXT, your_role TEXT, context TEXT,
             status TEXT NOT NULL DEFAULT 'submitted', reward_label TEXT, next_step TEXT, fit_notes TEXT, source TEXT NOT NULL DEFAULT 'form',
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  db.exec(`INSERT INTO referral_submissions (uid, referrer_user_id, referred_name, referred_contact, status) VALUES
             ('x1', ${FOUNDER}, 'Bluefern Health', 'cfo@bluefern.example', 'submitted'), ('x2', ${FOUNDER}, 'Harbor Robotics', NULL, 'qualified')`);
  return db;
}

async function call(env: any, who: number, key: string, body: unknown = { weeks: 12 }) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await adminPrograms.request(`/${key}/export`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const fileOf = (url: string) => Buffer.from(url.split('base64,')[1], 'base64').toString('utf8');

test('1. each program exports its catalogue figures, counts only, with one audit row per export', async () => {
  const db = built();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  try {
    for (const key of EXPORTABLE_PROGRAMS) {
      const r = await call(env, ADMIN, key);
      assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.format, 'csv');
      assert.ok(r.body.rows > 0, `${key} has rows`);
      const csv = fileOf(r.body.download_url);
      assert.match(csv, new RegExp(`^Axal Programs,${key}\\r\\n`));
      assert.match(csv, /Counts only,"?This file holds counts only, never names or emails\./);
      assert.match(csv, /\r\nsection,figure,value\r\n/);
      assert.ok(!refusesCountsOnly(csv), `${key} carries no email`);
      assert.ok(!/Bluefern|Harbor|Person \d/.test(csv), `${key} carries no name`);
    }
    const rae = fileOf((await call(env, ADMIN, 'refer-and-earn')).body.download_url);
    assert.match(rae, /\r\nReferral funnel,Submitted,2\r\n/);
    assert.match(rae, /\r\nReferral funnel,Qualified,1\r\n/);
    assert.match(rae, /\r\nReferral funnel,Reward issued,0\r\n/, 'a real zero is a zero');
    const audit = db.prepare("SELECT admin_user_id, action, report_type, format, filters_json FROM admin_audit_log WHERE action = 'program_export' ORDER BY id").all() as any[];
    assert.deepEqual(audit.map((a) => a.report_type), [...EXPORTABLE_PROGRAMS, 'refer-and-earn']);
    assert.ok(audit.every((a) => a.admin_user_id === ADMIN && a.format === 'csv' && JSON.parse(a.filters_json).weeks === 12));
  } finally { db.close(); }
});

test('2. refusals: not an admin, an unknown program, nothing to export, bad weeks, and no file without its audit row', async () => {
  const db = built();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  try {
    assert.notEqual((await call(env, FOUNDER, 'perks')).status, 200, 'an admin export only');
    assert.equal((await call(env, ADMIN, 'no-such-program')).status, 404);
    const none = await call(env, ADMIN, 'spinout-lab');
    assert.equal(none.status, 409);
    assert.equal(none.body.error, 'nothing_to_export');
    assert.equal((await call(env, ADMIN, 'perks', { weeks: 7 })).body.code, 'bad_weeks');
    const before = (db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'program_export'").get() as any).n;
    assert.equal(before, 0, 'no refused export is logged');
    // The audit row cannot be written: no file, no link.
    const prepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql: string) => { if (/INSERT INTO admin_audit_log/.test(sql)) throw new Error('audit down'); return prepare(sql); };
    const unlogged = await call(env, ADMIN, 'perks');
    assert.equal(unlogged.status, 503);
    assert.equal(unlogged.body.error, 'export_not_logged');
    assert.ok(!('download_url' in unlogged.body));
  } finally { db.close(); }
});

test('3. the pieces: an unread block is a word, strings never copy, formulas are neutralised, an email is refused', () => {
  const rows = flatten('Figures', {
    mentors: { available: true, count: 3 },
    coverage: { available: false, unreadable: true, reason: 'down' },
    claims: { available: false, reason: 'Part 4' },
    note: 'Ana Founder ana@venture.example',
    weeks: [{ week: '2026-10-19', count: 2 }],
  }, [], []);
  assert.deepEqual(rows.map((r) => [r.figure, r.value]), [
    ['mentors · count', '3'], ['coverage', 'Unreadable'], ['claims', 'Not read here yet'], ['weeks · 2026-10-19 · count', '2'],
  ]);
  assert.equal(cell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(cell('-1'), "'-1");
  assert.equal(cell('a,b'), '"a,b"');
  const csv = exportCsv(rows, { program: 'mentor-cohorts', weeks: 12, asOf: '2026-10-25T00:00:00Z', scope: 'HQ' });
  assert.ok(!refusesCountsOnly(csv));
  assert.ok(refusesCountsOnly(`${csv}x,y,ana@venture.example\r\n`), 'the guard sees an email');
});
