/**
 * D447 — the glance must not throw away a failed read, and HQ must not read
 * a table it never writes.
 *
 * Run on node:sqlite. No live branch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { studioGlance, HQ_INSIGHTS_REASON } from '../src/services/studioGlance.ts';
import { branchHome } from '../src/services/branchHome.ts';

const OPEN = Date.parse('2026-09-16T12:00:00Z');
const CLOSED = Date.parse('2026-09-30T12:00:00Z');

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
}

function emptyDb() {
  return new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
}

test('HQ does not read branch_benchmarks, and a closed week does not invent a pending count', async () => {
  const db = emptyDb();
  db.exec(`CREATE TABLE legal_templates (
    id INTEGER PRIMARY KEY, slug TEXT, category TEXT, title TEXT, is_active INTEGER,
    body_md TEXT, merge_fields TEXT, version INTEGER, is_stub INTEGER
  )`);
  const open = await studioGlance({ DB: makeD1(db) } as any, OPEN);
  assert.equal(open.tier, 'hq');
  assert.equal(open.insights.recorded, false);
  assert.equal(open.insights.reason, HQ_INSIGHTS_REASON);
  assert.equal(open.programme.open_week, 3);
  assert.equal(open.programme.pending_accounts, null, 'no cohort table means the count is unknown');
  assert.match(String(open.programme.reason), /unknown rather than zero/);
  assert.equal(open.agreements.recorded, true);
  assert.equal(open.agreements.expiring, null);

  const closed = await studioGlance({ DB: makeD1(emptyDb()) } as any, CLOSED);
  assert.equal(closed.programme.open_week, null);
  assert.equal(closed.programme.pending_accounts, null);
  assert.match(String(closed.programme.reason), /No cohort week is open/);
  assert.doesNotMatch(String(closed.programme.reason), /unknown rather than zero/);
});

test('an open week counts the pending rows on HQ, and empty agreement tables are a measured zero', async () => {
  const db = emptyDb();
  db.exec(`
    CREATE TABLE legal_templates (
      id INTEGER PRIMARY KEY, slug TEXT, category TEXT, title TEXT, is_active INTEGER,
      body_md TEXT, merge_fields TEXT, version INTEGER, is_stub INTEGER
    );
    CREATE TABLE cohort_cycles (id INTEGER PRIMARY KEY, year INTEGER, month INTEGER, start_at TEXT, end_at TEXT);
    CREATE TABLE company_week_status (
      user_id INTEGER, cohort_cycle_id INTEGER, week_number INTEGER, status TEXT
    );
    CREATE TABLE pairwise_ndas (status TEXT, valid_until TEXT);
    CREATE TABLE partner_deals (status TEXT, expires_at TEXT);
  `);
  db.prepare('INSERT INTO cohort_cycles (id, year, month, start_at, end_at) VALUES (7, 2026, 9, ?, ?)').run('a', 'b');
  db.prepare('INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status) VALUES (1, 7, 3, ?)').run('pending');
  const body = await studioGlance({ DB: makeD1(db) } as any, OPEN);
  assert.equal(body.programme.pending_accounts, 1);
  assert.equal(body.agreements.expiring, 0);
  assert.equal(body.insights.recorded, false);
});

test('an unreadable licence is not the same claim as a licence HQ has not pushed', async () => {
  const missingTable = await studioGlance({ DB: makeD1(emptyDb()), BRANCH_CODE: 'fr' } as any, OPEN);
  assert.equal(missingTable.tier, 'branch');
  assert.equal(missingTable.licence.available, false);
  assert.match(String(missingTable.licence.reason), /could not be read/);
  assert.equal(missingTable.seats.available, false);
  assert.equal(missingTable.revenue.available, false);
  assert.notEqual(missingTable.licence.recorded, false);

  const present = emptyDb();
  present.exec(`CREATE TABLE branch_licence (
    id INTEGER PRIMARY KEY,
    licence_uid TEXT, licence_ref TEXT, legal_entity TEXT, brand_name TEXT, territory TEXT,
    status TEXT, seats_json TEXT, revenue_share_bps INTEGER, token_split_bps INTEGER,
    annual_fee_cents INTEGER, currency TEXT, term_start TEXT, term_end TEXT, renewal_at TEXT,
    template_version TEXT, suspended_at TEXT, suspended_note TEXT, registered_address TEXT,
    signatory_name TEXT, signatory_title TEXT, term_years INTEGER, terminated_at TEXT,
    kind TEXT, pushed_at TEXT
  )`);
  const notPushed = await studioGlance({ DB: makeD1(present), BRANCH_CODE: 'fr' } as any, OPEN);
  assert.equal(notPushed.licence.recorded, false);
  assert.match(String(notPushed.licence.reason), /has not pushed/);
  assert.equal(notPushed.licence.available, undefined);
});

test('a missing licence row and an unreadable licence copy are different sentences on the digest', async () => {
  const present = emptyDb();
  present.exec('CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, revenue_share_bps INTEGER, pushed_at TEXT)');
  const missing = await branchHome({ DB: makeD1(present) } as any, OPEN);
  assert.equal(missing.revenue.share_bps, null);
  assert.equal(missing.revenue.available, undefined);
  assert.match(missing.revenue.reason, /has not pushed/);

  const unread = await branchHome({ DB: makeD1(emptyDb()) } as any, OPEN);
  assert.equal(unread.revenue.available, false);
  assert.equal(unread.revenue.share_bps, null);
  assert.match(unread.revenue.reason, /could not be read/);
  assert.doesNotMatch(unread.revenue.reason, /has not pushed/);
});
