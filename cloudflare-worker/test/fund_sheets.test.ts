/**
 * Funds ↔ Google Sheets: mapping, owner scoping of a push, and OAuth shape.
 *
 * The Worker is the only thing that talks to D1. These tests drive the service
 * against in-process SQLite so a missing owner filter, a blank cheque becoming
 * zero, or a push that deleted a row fail here rather than on a founder's
 * shortlist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  parseSpreadsheetRef, usdCellToCents, centsToUsdCell, headerIndex, parseSheetValues,
  fundsToSheetValues, applySheetRecords, listOwnerFunds, preflightSheetsOAuthSecrets,
  googleSheetsOAuthAvailable, buildSheetsAuthUrl, googleSheetsRedirectUri,
  SHEETS_SCOPES, SHEET_HEADERS, SUGGESTED_SHEET_URL,
} from '../src/services/fundSheets.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const d1: any = {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
  return d1;
}

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY)');
  db.exec(read('cloudflare-worker/sql/migrations/216_research_funds.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/274_research_fund_sheets.sql'));
  db.exec(`INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')`);
  return { db, env: { DB: makeD1(db), JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef' } as any };
}

test('parseSpreadsheetRef reads id and gid from a docs.google.com URL', () => {
  const parsed = parseSpreadsheetRef(
    'https://docs.google.com/spreadsheets/d/1aLFMMqZYXdnIcutEnggadAFOunDKEyDeB5sWuhFk1OQ/edit?gid=100#gid=100',
  );
  assert.equal('error' in parsed, false);
  if ('error' in parsed) return;
  assert.equal(parsed.spreadsheet_id, '1aLFMMqZYXdnIcutEnggadAFOunDKEyDeB5sWuhFk1OQ');
  assert.equal(parsed.sheet_gid, 100);
});

test('parseSpreadsheetRef accepts a bare spreadsheet id', () => {
  const parsed = parseSpreadsheetRef('1aLFMMqZYXdnIcutEnggadAFOunDKEyDeB5sWuhFk1OQ');
  assert.equal('error' in parsed, false);
  if ('error' in parsed) return;
  assert.equal(parsed.spreadsheet_id, '1aLFMMqZYXdnIcutEnggadAFOunDKEyDeB5sWuhFk1OQ');
  assert.equal(parsed.sheet_gid, null);
});

test('parseSpreadsheetRef refuses a non-sheet URL', () => {
  const parsed = parseSpreadsheetRef('https://example.com/not-a-sheet');
  assert.equal('error' in parsed, true);
});

test('a blank cheque cell is not zero cents', () => {
  assert.equal(usdCellToCents(''), null);
  assert.equal(usdCellToCents('  '), null);
  assert.equal(usdCellToCents(null), null);
  assert.equal(usdCellToCents(undefined), null);
  assert.equal(usdCellToCents('0'), 0);
  assert.equal(usdCellToCents('$25,000'), 2_500_000);
  assert.equal(usdCellToCents('1500.50'), 150050);
  assert.equal(centsToUsdCell(null), '');
  assert.equal(centsToUsdCell(0), '0');
  assert.equal(centsToUsdCell(2_500_000), '25000');
  assert.equal(centsToUsdCell(150050), '1500.50');
});

test('sheet values round-trip uid, dollars, and the three independent axes', () => {
  const values = fundsToSheetValues([{
    uid: 'abc',
    name: 'First Round',
    cheque_min_cents: 100_000_00,
    cheque_max_cents: null,
    stage_fit: 'right',
    path: null,
    status: 'researching',
    pass_reason: null,
    thesis: 'We write at seed.',
    note: 'Warm intro via Jane',
    source_url: null,
  }]);
  assert.deepEqual(values[0], [...SHEET_HEADERS]);
  const rows = parseSheetValues(values);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uid, 'abc');
  assert.equal(rows[0].name, 'First Round');
  assert.equal(rows[0].cheque_min_cents, 100_000_00);
  assert.equal(rows[0].cheque_max_cents, null);
  assert.equal(rows[0].stage_fit, 'right');
  assert.equal(rows[0].path, null);
  assert.equal(rows[0].status, 'researching');
});

test('header aliases still find Fund / State / Cheque min', () => {
  const idx = headerIndex(['UID', 'Fund', 'Cheque min', 'State']);
  assert.equal(idx.uid, 0);
  assert.equal(idx.name, 1);
  assert.equal(idx.cheque_min_cents, 2);
  assert.equal(idx.status, 3);
});

test('push creates a row with no uid, updates an owned uid, and skips another owner', async () => {
  const { db, env } = fresh();
  db.exec(`INSERT INTO research_funds (uid, owner_user_id, name, status, created_at, updated_at)
           VALUES ('mine', 1, 'Old Name', 'researching', '2026-01-01', '2026-01-01'),
                  ('theirs', 2, 'Secret', 'passed', '2026-01-01', '2026-01-01')`);
  const result = await applySheetRecords(env, { id: 1 }, [
    { uid: 'mine', name: 'New Name', cheque_min_cents: 50000, cheque_max_cents: null,
      stage_fit: 'right', path: 'warm', status: 'researching', pass_reason: null,
      thesis: null, note: 'updated', source_url: null },
    { uid: 'theirs', name: 'Stolen', cheque_min_cents: null, cheque_max_cents: null,
      stage_fit: null, path: null, status: 'researching', pass_reason: null,
      thesis: null, note: null, source_url: null },
    { uid: null, name: 'Brand New', cheque_min_cents: null, cheque_max_cents: null,
      stage_fit: null, path: null, status: null, pass_reason: null,
      thesis: null, note: null, source_url: null },
  ]);
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.created, 1);
  assert.equal(result.uid_writes.length, 1);

  const mine = db.prepare('SELECT name, note, cheque_min_cents FROM research_funds WHERE uid = ?').get('mine') as any;
  assert.equal(mine.name, 'New Name');
  assert.equal(mine.note, 'updated');
  assert.equal(mine.cheque_min_cents, 50000);

  const theirs = db.prepare('SELECT name, owner_user_id FROM research_funds WHERE uid = ?').get('theirs') as any;
  assert.equal(theirs.name, 'Secret');
  assert.equal(theirs.owner_user_id, 2);

  const created = db.prepare('SELECT name, owner_user_id FROM research_funds WHERE uid = ?')
    .get(result.uid_writes[0].uid) as any;
  assert.equal(created.name, 'Brand New');
  assert.equal(created.owner_user_id, 1);

  const count = (db.prepare('SELECT COUNT(*) AS n FROM research_funds').get() as any).n;
  assert.equal(count, 3, 'push deleted a row — a pass is a state, not a delete');
});

test('listOwnerFunds never returns another account', async () => {
  const { db, env } = fresh();
  db.exec(`INSERT INTO research_funds (uid, owner_user_id, name, status, created_at, updated_at)
           VALUES ('a', 1, 'Mine', 'researching', '2026-01-01', '2026-01-01'),
                  ('b', 2, 'Theirs', 'researching', '2026-01-01', '2026-01-01')`);
  const rows = await listOwnerFunds(env, { id: 1 });
  assert.deepEqual(rows.map((r) => r.uid), ['a']);
});

test('Sheets OAuth is unavailable until a client id, secret and redirect resolve', () => {
  const empty = {} as any;
  assert.equal(googleSheetsOAuthAvailable(empty), false);
  assert.ok(preflightSheetsOAuthSecrets(empty).includes('GOOGLE_SHEETS_CLIENT_ID'));
  const full = {
    JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef',
    GOOGLE_SHEETS_CLIENT_ID: 'sheets-id',
    GOOGLE_SHEETS_CLIENT_SECRET: 'sheets-secret',
    APP_URL: 'https://axal.vc',
    PUBLIC_BASE_URL: 'https://axal.vc',
  } as any;
  assert.deepEqual(preflightSheetsOAuthSecrets(full), []);
  assert.equal(googleSheetsOAuthAvailable(full), true);
});

test('the legacy Google client satisfies Sheets preflight without calendar scopes', () => {
  const env = {
    JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef',
    GOOGLE_CLIENT_ID: 'legacy-id',
    GOOGLE_CLIENT_SECRET: 'legacy-secret',
    APP_URL: 'https://axal.vc',
  } as any;
  assert.deepEqual(preflightSheetsOAuthSecrets(env), []);
  const url = new URL(buildSheetsAuthUrl(env, 'nonce.sig'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), 'legacy-id');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://axal.vc/api/research/funds/sheet/callback',
  );
  const scope = url.searchParams.get('scope') || '';
  assert.match(scope, /spreadsheets/);
  assert.doesNotMatch(scope, /calendar/);
  assert.doesNotMatch(scope, /gmail/);
  assert.deepEqual(SHEETS_SCOPES.filter((s) => s.includes('spreadsheets')).length, 1);
});

test('redirect URI prefers the Sheets override and rejects workers.dev in production', () => {
  const env = {
    ENVIRONMENT: 'production',
    GOOGLE_SHEETS_REDIRECT_URI: 'https://studioos.workers.dev/api/research/funds/sheet/callback',
    APP_URL: 'https://axal.vc',
  } as any;
  assert.equal(googleSheetsRedirectUri(env), 'https://axal.vc/api/research/funds/sheet/callback');
});

test('the suggested URL is a placeholder, not a hardcoded exclusive target', () => {
  assert.match(SUGGESTED_SHEET_URL, /1aLFMMqZYXdnIcutEnggadAFOunDKEyDeB5sWuhFk1OQ/);
  const service = read('cloudflare-worker/src/services/fundSheets.ts');
  assert.match(service, /Placeholder only/);
  assert.doesNotMatch(service, /spreadsheet_id = '1aLFMMqZYXdnIcutEnggadAFOunDKEyDeB5sWuhFk1OQ'/);
});
