/**
 * D1022 (#2859) — the record read names each register holder's kind, so
 * Overview's Who owns groups founders, investors and people from the record
 * rather than guessing from the class they hold. A holder named only on an
 * issuance has no register row and reads `kind: null`; another venture's
 * holder never lends its kind.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cap_table_overview_d1022.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { readRecord } from '../src/services/capTableRecord.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');

function database() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations).filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-10', 'Synthetic Venture', 40), (20, 'p-20', 'Other Venture', 90);
    INSERT INTO cap_table_holders (id, user_id, project_id, name, kind) VALUES
      (101, 4, 10, 'Ada Founder', 'founder'), (102, 4, 10, 'Jo Employee', 'employee'), (103, 4, 10, 'Bare Holder', NULL), (201, 9, 20, 'Elsewhere', 'investor');
    INSERT INTO cap_table_share_classes (id, uid, project_id, name, kind, authorized_shares) VALUES
      (1, 'c-common', 10, 'Common', 'common', 10000000), (2, 'c-pool', 10, 'Options', 'option_pool', 1000000);
    INSERT INTO cap_table_issuances (uid, project_id, kind, holder_id, holder_name, class_id, shares, issued_on, source, status, origin) VALUES
      ('i1', 10, 'founding', 101, NULL, 1, 4000000, '2025-01-03', 'signed', 'recorded', 'owner'),
      ('i2', 10, 'grant', 102, NULL, 2, 100000, '2026-02-02', 'typed', 'recorded', 'owner'),
      ('i3', 10, 'founding', 103, NULL, 1, 50000, '2025-05-01', 'typed', 'recorded', 'owner'),
      ('i4', 10, 'founding', NULL, 'Named Only', 1, 20000, '2025-05-01', 'typed', 'recorded', 'owner'),
      -- Written past the route's venture check, as a stale row could be: the kind read stays this venture's.
      ('i5', 10, 'founding', 201, NULL, 1, 10000, '2025-05-01', 'typed', 'recorded', 'owner');`);
  return { DB: d1Over(db) } as any;
}

test('each holder on the record carries its register kind, or null', async () => {
  const record = await readRecord(database(), 10);
  assert.equal(record.by_holder.available, true);
  const kinds = Object.fromEntries((record.by_holder as any).rows.map((h: any) => [h.name, h.kind]));
  assert.deepEqual(kinds, { 'Ada Founder': 'founder', 'Jo Employee': 'employee', 'Bare Holder': null, 'Named Only': null, Elsewhere: null },
    'another venture\'s holder lends no kind');
});

test('an empty record still carries no number', async () => {
  const env = database();
  const other = await readRecord(env, 20);
  assert.equal(other.by_holder.available, false);
  assert.equal((other.by_holder as any).reason, 'nothing_recorded');
  assert.ok(!('rows' in other.by_holder));
});
