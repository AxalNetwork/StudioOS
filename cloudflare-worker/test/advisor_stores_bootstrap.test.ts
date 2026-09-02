/**
 * The lazy bootstrap and the migrations must describe the same schema.
 *
 * WHY BOTH EXIST. `documentation/architecture/GOTCHAS.md` states the rule: an
 * `ALTER` migration is non-idempotent, so `--baseline` RECORDS it without
 * running it. On a database adopted that way the ledger says
 * `202_advisor_profile_fields` applied and `advisors.headline` does not exist.
 * `services/advisorStoresSchema.ts` heals that; the migration files stay
 * canonical.
 *
 * WHY THIS TEST EXISTS. Two descriptions of one schema drift — that is the
 * whole reason `check-sqlite-table-collisions` and its baseline exist, and
 * `advisor_bookings` is the worked example of what it costs. These tests hold
 * the bootstrap against the migration files themselves: adding a column to one
 * and not the other fails here rather than in production, where the two would
 * silently produce two different databases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureAdvisorStoresSchema,
  ADVISOR_PROFILE_COLUMNS,
  ADVISOR_BOOKING_COLUMNS,
} from '../src/services/advisorStoresSchema.ts';

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql');
const migration = (n: string) => readFileSync(`${SQL}/migrations/${n}.sql`, 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
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
    async batch(x: any[]) { const o = []; for (const st of x || []) o.push(await st.run().catch(() => ({}))); return o; },
  };
}

/** The T13.1 tables the bootstrap deliberately does NOT create. */
const T13 = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, advisor_id INTEGER);
  CREATE TABLE cohort_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER, month INTEGER,
    start_at TEXT, end_at TEXT, status TEXT);
  CREATE TABLE advisors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, user_id INTEGER UNIQUE,
    display_name TEXT NOT NULL, email TEXT, bio TEXT,
    expertise_json TEXT NOT NULL DEFAULT '[]', sectors_json TEXT NOT NULL DEFAULT '[]',
    linkedin_url TEXT, hourly_rate_usd INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE advisor_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, slot_id INTEGER NOT NULL,
    advisor_id INTEGER NOT NULL, founder_user_id INTEGER NOT NULL, topic TEXT, notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending', cancel_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (slot_id, founder_user_id)
  );
`;

const MIGRATIONS = [
  '201_advisors_table_in_ledger', '202_advisor_profile_fields', '203_advisor_services',
  '204_advisor_proof', '205_advisor_booking_amounts', '206_advisor_cohort_assignments',
];

function fresh() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true,
  });
  db.exec(T13);
  return db;
}

const cols = (db: InstanceType<typeof DatabaseSync>, t: string): string[] =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((r) => String(r.name)).sort();

const tables = (db: InstanceType<typeof DatabaseSync>): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[])
    .map((r) => String(r.name));

test('the bootstrap produces the same schema the migrations do', async () => {
  const migrated = fresh();
  for (const m of MIGRATIONS) migrated.exec(migration(m));

  const healed = fresh();
  await ensureAdvisorStoresSchema({ DB: makeD1(healed) } as any);

  assert.deepEqual(tables(healed), tables(migrated), 'same tables');
  for (const t of ['advisors', 'advisor_bookings', 'advisor_services',
                   'advisor_proof_items', 'advisor_proof_consents',
                   'advisor_cohort_assignments']) {
    assert.deepEqual(cols(healed, t), cols(migrated, t), `same columns on ${t}`);
  }
});

test('the exported column lists match what migrations 202 and 205 add', () => {
  const named = (sql: string) => [...sql.matchAll(/ADD COLUMN\s+(\w+)/gi)].map((m) => m[1]).sort();
  assert.deepEqual([...ADVISOR_PROFILE_COLUMNS].sort(), named(migration('202_advisor_profile_fields')));
  assert.deepEqual([...ADVISOR_BOOKING_COLUMNS].sort(), named(migration('205_advisor_booking_amounts')));
});

test('the bootstrap is idempotent and short-circuits on a healthy database', async () => {
  const db = fresh();
  for (const m of MIGRATIONS) db.exec(migration(m));
  const before = cols(db, 'advisors');
  const env = { DB: makeD1(db) } as any;
  await ensureAdvisorStoresSchema(env);
  await ensureAdvisorStoresSchema(env);
  assert.deepEqual(cols(db, 'advisors'), before, 'nothing added twice');
});

test('the bootstrap declines to invent a table it does not own', async () => {
  // No `advisors`, no `advisor_bookings` — the two that live in the hand-applied
  // t13 file and that migration 201 deliberately does not re-declare for
  // advisor_bookings. Inventing a shape for a table this repo already defines
  // twice is the hazard, not the fix.
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true,
  });
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY);');
  await ensureAdvisorStoresSchema({ DB: makeD1(db) } as any);
  const t = tables(db);
  assert.ok(!t.includes('advisor_bookings'), 'no guessed advisor_bookings');
  assert.ok(t.includes('advisor_services'), 'but the tables it does own are created');
  assert.ok(t.includes('advisor_cohort_assignments'));
});

test('a database baselined past the ALTERs is healed on first use', async () => {
  // The exact case the GOTCHAS rule describes: `--baseline` recorded 202 and 205
  // without running them, so the ledger says applied and the columns are absent.
  const db = fresh();
  db.exec(migration('203_advisor_services'));
  db.exec(migration('204_advisor_proof'));
  db.exec(migration('206_advisor_cohort_assignments'));
  assert.ok(!cols(db, 'advisors').includes('headline'), 'precondition: the ALTER never ran');
  assert.ok(!cols(db, 'advisor_bookings').includes('billing_state'));

  await ensureAdvisorStoresSchema({ DB: makeD1(db) } as any);
  for (const c of ADVISOR_PROFILE_COLUMNS) assert.ok(cols(db, 'advisors').includes(c), c);
  for (const c of ADVISOR_BOOKING_COLUMNS) assert.ok(cols(db, 'advisor_bookings').includes(c), c);

  db.prepare("INSERT INTO advisors (uid, display_name) VALUES ('a','Ada')").run();
  db.prepare(`INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id)
              VALUES ('b', 1, 1, 2)`).run();
  const row: any = db.prepare('SELECT billing_state FROM advisor_bookings').get();
  assert.equal(row.billing_state, 'unpriced', 'and the default the migration sets is the same one');
});
