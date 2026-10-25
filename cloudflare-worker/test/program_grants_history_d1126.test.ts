/**
 * D1126 (#3006) — HQ's History tab (every licence's program decisions) and
 * Download CSV (the grid, and one studio), on D982's store.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, with D982's defaults seeded, as D983's test builds it.
 * Every studio and person is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_grants_history_d1126.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import grantsRoute from '../src/routes/admin_program_grants.ts';
import dealTypesRoute from '../src/routes/admin_partner_deal_types.ts';
import { ACTION_LABELS, EXPORT_HEADER } from '../src/services/programGrantsHistory.ts';
import { PROGRAMS, TERM_KEYS } from '../src/services/programGrants.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, PLAIN_ADMIN = 2;
const LIVE = 'lic_live', OTHER = 'lic_other', DRAFT = 'lic_draft';
const REASON = 'Approved at the October HQ review.';

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const SEED = (() => {
  const sql = readFileSync(resolve(MIGRATIONS, '553_program_grants.sql'), 'utf8');
  const at = sql.indexOf('INSERT OR IGNORE INTO program_grant_defaults');
  return sql.slice(at, sql.indexOf(';', at) + 1);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Pat Plain', 'pat@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN_ADMIN]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, `totp-${id}`);
  }
  const lic = db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?)');
  lic.run(1, LIVE, 'AXL-001', 'Studio North SAS', 'Studio North', 'active', '2027-10-31');
  lic.run(2, OTHER, 'AXL-002', 'Studio East SAS', 'Studio East', 'active', '2027-10-31');
  lic.run(3, DRAFT, 'AXL-003', 'Studio Draft SAS', 'Studio Draft', 'draft', null);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/program-grants', grantsRoute);
app.route('/api/admin/partner-deal-types', dealTypesRoute);

const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, envOf(db)));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* CSV */ }
    return { status: res.status, body: json, text, headers: res.headers };
  } finally { [console.warn, console.error] = saved; }
}

const H = '/api/admin/program-grants';
const grant = (db: DatabaseSync, uid: string, key: string, terms: Record<string, unknown> = {}) =>
  call(db, SUPER, 'POST', `${H}/licences/${uid}/${key}`, { reason: REASON, terms });

async function story(db: DatabaseSync) {
  assert.equal((await grant(db, LIVE, 'perks', { credits_per_quarter: 300 })).status, 201);
  assert.equal((await call(db, SUPER, 'PATCH', `${H}/licences/${LIVE}/perks`, { reason: 'Referral volume doubled since July.', terms: { credits_per_quarter: 400 } })).status, 200);
  assert.equal((await grant(db, OTHER, 'learning')).status, 201);
  assert.equal((await call(db, SUPER, 'POST', `${H}/licences/${OTHER}/learning/pause`, { reason: 'Paused while the course is rewritten.' })).status, 200);
  assert.equal((await call(db, SUPER, 'PUT', `/api/admin/partner-deal-types/licences/${LIVE}`, { reason: 'The studio hired a deal partner.', types: ['deal_sourcing_revshare'] })).status, 200);
}

// ---------------------------------------------------------------- History

test('History: every licence\'s program decisions, newest first, in HQ\'s words with each reason', async () => {
  const db = fixture();
  await story(db);
  const r = await call(db, SUPER, 'GET', `${H}/history`);
  assert.equal(r.status, 200, r.text);
  const rows = r.body.items;
  assert.deepEqual(rows.map((e: any) => [e.licence?.licence_ref, e.action, e.program_key]), [
    ['AXL-001', 'deal_types_changed', null],
    ['AXL-002', 'paused', 'learning'],
    ['AXL-002', 'granted', 'learning'],
    ['AXL-001', 'terms_changed', 'perks'],
    ['AXL-001', 'granted', 'perks'],
  ]);
  assert.deepEqual(rows.map((e: any) => e.id), [...rows.map((e: any) => e.id)].sort((a: number, b: number) => b - a), 'newest first');
  assert.equal(rows[3].action_label, 'Terms changed');
  assert.equal(rows[3].program_name, 'Perks');
  assert.equal(rows[3].reason, 'Referral volume doubled since July.');
  assert.ok(rows[3].changed.some((c: any) => c.key === 'credits_per_quarter' && c.before === 300 && c.after === 400));
  assert.deepEqual(rows[0].deal_types, { before: null, after: ['deal_sourcing_revshare'] });
  assert.equal(rows[0].by, 'Sue Super');
  assert.equal(r.body.next_before, null);
  for (const a of ['granted', 'terms_changed', 'paused', 'deal_types_changed', 'request_approved']) assert.ok(ACTION_LABELS[a], a);
});

test('History: by program, by licence, a page at a time, and a licence the ledger lost keeps its row without a name', async () => {
  const db = fixture();
  await story(db);
  const perks = await call(db, SUPER, 'GET', `${H}/history?program=perks`);
  assert.deepEqual(perks.body.items.map((e: any) => e.action), ['terms_changed', 'granted']);
  const other = await call(db, SUPER, 'GET', `${H}/history?licence=${OTHER}`);
  assert.deepEqual(other.body.items.map((e: any) => e.action), ['paused', 'granted']);
  assert.equal((await call(db, SUPER, 'GET', `${H}/history?program=fundraising`)).status, 400);

  const first = await call(db, SUPER, 'GET', `${H}/history?limit=2`);
  assert.equal(first.body.items.length, 2);
  assert.ok(first.body.next_before);
  const second = await call(db, SUPER, 'GET', `${H}/history?limit=2&before=${first.body.next_before}`);
  assert.equal(second.body.items.length, 2);
  assert.ok(second.body.items.every((e: any) => e.id < first.body.next_before));
  const third = await call(db, SUPER, 'GET', `${H}/history?limit=2&before=${second.body.next_before}`);
  assert.equal(third.body.items.length, 1);
  assert.equal(third.body.next_before, null);

  db.exec(`DELETE FROM territory_licences WHERE uid = '${OTHER}'`);
  const after = await call(db, SUPER, 'GET', `${H}/history`);
  const orphan = after.body.items.filter((e: any) => e.program_key === 'learning');
  assert.equal(orphan.length, 2);
  assert.ok(orphan.every((e: any) => e.licence === null), 'never given another licence');
});

test('History and both exports are the Super Admin\'s', async () => {
  const db = fixture();
  for (const p of [`${H}/history`, `${H}/export.csv`, `${H}/licences/${LIVE}/export.csv`]) {
    assert.equal((await call(db, PLAIN_ADMIN, 'GET', p)).status, 403, p);
  }
});

// ---------------------------------------------------------------- Download CSV

const parse = (csv: string) => csv.split('\r\n').map((l) => l.split(','));

test('Download CSV: one row per studio and program, every term its own column, a term nobody set blank, and audited', async () => {
  const db = fixture();
  await story(db);
  const r = await call(db, SUPER, 'GET', `${H}/export.csv`);
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('Content-Type') || '', /text\/csv/);
  assert.match(r.headers.get('Content-Disposition') || '', /program-grants-\d{4}-\d{2}-\d{2}\.csv/);
  const [head, ...rows] = parse(r.text);
  assert.deepEqual(head, [...EXPORT_HEADER]);
  assert.equal(rows.length, 2 * PROGRAMS.length, 'the draft licence is not a studio yet');
  assert.equal(r.headers.get('X-Export-Rows'), String(rows.length));
  const col = (name: string) => head.indexOf(name);
  const row = (ref: string, key: string) => rows.find((x) => x[0] === ref && x[col('program_key')] === key)!;
  assert.equal(row('AXL-001', 'perks')[col('grant')], 'Granted');
  assert.equal(row('AXL-001', 'perks')[col('credits_per_quarter')], '400');
  assert.equal(row('AXL-001', 'perks')[col('cohorts_per_year')], '', 'a term that does not apply, or nobody set, is blank');
  assert.equal(row('AXL-002', 'learning')[col('grant')], 'Paused');
  assert.equal(row('AXL-001', 'spinout-lab')[col('grant')], 'Not recorded', 'never "Not granted"');
  assert.equal(row('AXL-001', 'product-testing')[col('grant')], 'HQ only');
  assert.equal(row('AXL-001', 'investor-cohorts')[col('grant')], 'Not ready to grant');
  assert.ok(!r.text.includes('Not granted'));
  for (const k of TERM_KEYS) assert.ok(head.includes(k), k);
  const audit = db.prepare(`SELECT action, filters_json FROM admin_audit_log WHERE action = 'program_grants.exported'`).all() as any[];
  assert.equal(audit.length, 1);
  assert.deepEqual(JSON.parse(audit[0].filters_json), { rows: rows.length });
});

test('Download CSV for one studio: its rows only, named by its reference; an unknown licence is a 404', async () => {
  const db = fixture();
  await story(db);
  const r = await call(db, SUPER, 'GET', `${H}/licences/${OTHER}/export.csv`);
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('Content-Disposition') || '', /program-grants-AXL-002-/);
  const [, ...rows] = parse(r.text);
  assert.equal(rows.length, PROGRAMS.length);
  assert.ok(rows.every((x) => x[0] === 'AXL-002'));
  assert.equal((await call(db, SUPER, 'GET', `${H}/licences/lic_nope/export.csv`)).status, 404);
});
