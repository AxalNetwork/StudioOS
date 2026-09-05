/**
 * The slot owner column, and the three shipped handlers it silently broke.
 *
 * `sql/t13_t14_t15.sql` declares `advisor_id` on `advisor_office_hour_slots`
 * and `advisor_bookings`. PRODUCTION HAS `mentor_id` ON BOTH, and no migration
 * in this repository renames anything — they diverged. Every shipped query uses
 * `advisor_id`, so against production:
 *
 *   · `GET /:uid/slots` and `POST /me/slots` fail with "no such column" → 500.
 *   · `DELETE /me/slots/:id` does NOT fail, which is worse: `slot.advisor_id`
 *     is `undefined`, `undefined !== m.id` is always true, and the handler
 *     returns "Slot not found" forever.
 *
 * It has harmed nobody — production has zero advisors, zero slots and zero
 * bookings — and that is exactly why the rename is being done now. It is free
 * while the tables are empty.
 *
 * THE TESTS DID NOT CATCH IT BECAUSE THEY BUILD THE WRONG SHAPE.
 * `advisor_stores.test.ts:102` creates the table with `advisor_id` under a
 * comment reading "in the LIVE (t13) shape" — asserting against a schema
 * production does not have. This file builds BOTH shapes on purpose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ensureAdvisorStoresSchema } from '../src/services/advisorStoresSchema.ts';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

/** A D1-shaped adapter thin enough that PRAGMA and ALTER behave as in prod. */
function makeEnv(db: InstanceType<typeof DatabaseSync>) {
  return {
    DB: {
      prepare(sql: string) {
        const st = () => db.prepare(sql);
        const api: any = {
          bind: (...args: any[]) => ({
            all: async () => ({ results: st().all(...coerce(args)) }),
            first: async () => st().get(...coerce(args)) ?? null,
            run: async () => ({ meta: st().run(...coerce(args)) }),
          }),
          all: async () => ({ results: st().all() }),
          first: async () => st().get() ?? null,
          run: async () => ({ meta: st().run() }),
        };
        return api;
      },
    },
  } as any;
}

/** Production's shape: the owner column is `mentor_id`. */
function legacyDb() {
  const d = new DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT);
    CREATE TABLE advisors (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, user_id INTEGER,
      display_name TEXT NOT NULL, expertise_json TEXT NOT NULL DEFAULT '[]',
      sectors_json TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE advisor_office_hour_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      mentor_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1, is_cancelled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE advisor_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      slot_id INTEGER NOT NULL, mentor_id INTEGER NOT NULL,
      founder_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
  `);
  return d;
}

/** The repository's shape: already `advisor_id`. Dev, preview, every fixture. */
function currentDb() {
  const d = new DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT);
    CREATE TABLE advisors (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, user_id INTEGER,
      display_name TEXT NOT NULL, expertise_json TEXT NOT NULL DEFAULT '[]',
      sectors_json TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE advisor_office_hour_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      advisor_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1, is_cancelled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE advisor_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      slot_id INTEGER NOT NULL, advisor_id INTEGER NOT NULL,
      founder_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
  `);
  return d;
}

const cols = (d: InstanceType<typeof DatabaseSync>, t: string): string[] =>
  d.prepare(`PRAGMA table_info(${t})`).all().map((r: any) => r.name);

test('production\'s mentor_id is renamed to advisor_id, on both tables', async () => {
  const d = legacyDb();
  d.exec("INSERT INTO advisor_office_hour_slots (uid, mentor_id, starts_at, ends_at) VALUES ('s1', 4, '2026-09-10T10:00:00Z', '2026-09-10T11:00:00Z')");
  await ensureAdvisorStoresSchema(makeEnv(d));
  assert.ok(cols(d, 'advisor_office_hour_slots').includes('advisor_id'));
  assert.ok(!cols(d, 'advisor_office_hour_slots').includes('mentor_id'));
  assert.ok(cols(d, 'advisor_bookings').includes('advisor_id'));
  assert.ok(!cols(d, 'advisor_bookings').includes('mentor_id'));
  // A RENAME keeps the data. If this ever became a drop-and-add, every
  // published slot would lose its owner and belong to nobody.
  const row: any = d.prepare('SELECT advisor_id FROM advisor_office_hour_slots').get();
  assert.equal(row.advisor_id, 4, 'the rename must carry the values across');
});

test('the shipped queries work after it — the point of the whole exercise', async () => {
  const d = legacyDb();
  d.exec("INSERT INTO advisor_office_hour_slots (uid, mentor_id, starts_at, ends_at) VALUES ('s1', 4, '2026-09-10T10:00:00Z', '2026-09-10T11:00:00Z')");
  // Before: the exact SELECT from `routes/advisors.ts:446` throws.
  assert.throws(
    () => d.prepare('SELECT * FROM advisor_office_hour_slots WHERE advisor_id = ?').all(4),
    /no such column/,
  );
  await ensureAdvisorStoresSchema(makeEnv(d));
  // After: it returns the row.
  const rows = d.prepare('SELECT * FROM advisor_office_hour_slots WHERE advisor_id = ?').all(4);
  assert.equal(rows.length, 1);
  // And the INSERT from `POST /me/slots`, which could not run at all before.
  d.prepare(
    'INSERT INTO advisor_office_hour_slots (uid, advisor_id, starts_at, ends_at) VALUES (?,?,?,?)',
  ).run('s2', 4, '2026-09-11T10:00:00Z', '2026-09-11T11:00:00Z');
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM advisor_office_hour_slots').get() as any).n, 2);
});

test('a database that is already correct is left alone', async () => {
  // Dev, preview and every fixture built from t13. This is the case a plain
  // `ALTER TABLE … RENAME COLUMN` migration would have aborted the deploy on:
  // SQLite has no RENAME COLUMN IF EXISTS, and the runner stops at the first
  // failing statement.
  const d = currentDb();
  d.exec("INSERT INTO advisor_office_hour_slots (uid, advisor_id, starts_at, ends_at) VALUES ('s1', 7, '2026-09-10T10:00:00Z', '2026-09-10T11:00:00Z')");
  await ensureAdvisorStoresSchema(makeEnv(d));
  assert.deepEqual(cols(d, 'advisor_office_hour_slots').filter((c) => c.endsWith('_id')), ['advisor_id']);
  const row: any = d.prepare('SELECT advisor_id FROM advisor_office_hour_slots').get();
  assert.equal(row.advisor_id, 7, 'an untouched database keeps its rows');
});

test('running it twice changes nothing', async () => {
  const d = legacyDb();
  const env = makeEnv(d);
  await ensureAdvisorStoresSchema(env);
  // A fresh env object defeats the per-isolate READY latch, so the second call
  // genuinely re-runs the logic rather than returning early.
  await ensureAdvisorStoresSchema(makeEnv(d));
  assert.deepEqual(cols(d, 'advisor_office_hour_slots').filter((c) => c.endsWith('_id')), ['advisor_id']);
});

test('a table carrying BOTH names is SKIPPED, not attempted and swallowed', async () => {
  // A half-finished rename somebody else is in the middle of.
  //
  // THE END STATE CANNOT TELL THE TWO OUTCOMES APART, which is how the first
  // version of this test managed to be vacuous. Dropping the
  // `|| have.has('advisor_id')` half of the guard left it passing: the ALTER
  // then runs, SQLite rejects it as a duplicate column, the catch swallows it,
  // and the table looks untouched either way. Deleting the guard changed
  // nothing observable about the columns.
  //
  // What differs is whether a failure happened at all. Skipping deliberately is
  // silent; attempting and failing logs a warning on every fresh isolate, for a
  // statement that can never succeed. So the assertion is on the log.
  const d = legacyDb();
  d.exec('ALTER TABLE advisor_office_hour_slots ADD COLUMN advisor_id INTEGER');

  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    await ensureAdvisorStoresSchema(makeEnv(d));
  } finally {
    console.warn = realWarn;
  }

  const c = cols(d, 'advisor_office_hour_slots');
  assert.ok(c.includes('mentor_id') && c.includes('advisor_id'),
    'both columns survive — this shape is for a person to resolve, not a bootstrap');
  assert.deepEqual(
    warnings.filter((w) => w.includes('advisor_office_hour_slots') && w.includes('rename')),
    [],
    'the guard must SKIP this table, not attempt a rename that cannot succeed',
  );
  // And the other table, which is cleanly legacy, is still renamed — the guard
  // is per-table, not a global bail-out.
  assert.ok(cols(d, 'advisor_bookings').includes('advisor_id'));
  assert.ok(!cols(d, 'advisor_bookings').includes('mentor_id'));
});

/**
 * EVERY ADVISOR HANDLER THAT TOUCHES THE RENAMED TABLES REACHES THE SELF-HEAL.
 *
 * The rename above is correct and, for its first day in production, unreached.
 * `ensureAdvisorStoresSchema` was called from `requireMyAdvisor` — documented
 * as "the single door every store endpoint BELOW goes through" — and seven
 * T13-era handlers are registered ABOVE it, calling `myAdvisor` directly. On
 * any isolate whose first advisor request hit one of those, the rename had
 * never run.
 *
 * `GET /bookings/me` is the one that made this urgent: it is a FOUNDER reading
 * their own booked sessions, and SQLite resolves column names at PREPARE time,
 * so zero bookings does not save it — `no such column: b.advisor_id`, 500.
 *
 * ASSERTED AS THE INVARIANT, NOT THE MECHANISM. A router-level `use('*')` is
 * how it is satisfied today; a future refactor may go back to per-handler
 * calls. Either passes. What must never pass is a handler querying these two
 * tables with no path to the bootstrap at all.
 */
test('no advisor handler queries the renamed tables without the bootstrap', async () => {
  const src = readFileSync(
    new URL('../src/routes/advisors.ts', import.meta.url), 'utf8');
  const lines = src.split('\n');

  // Router-level bootstrap satisfies every handler at once.
  const blanket = /advisors\.use\('\*',[\s\S]{0,200}?ensureAdvisorStoresSchema\(c\.env\)/.test(src);

  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (/^advisors\.(get|post|put|patch|delete)\(/.test(l)) starts.push(i);
  });
  assert.ok(starts.length > 20,
    `parse failed — only ${starts.length} handlers found, so this test proves nothing`);
  starts.push(lines.length);

  const unhealed: string[] = [];
  for (let k = 0; k < starts.length - 1; k += 1) {
    const body = lines.slice(starts[k], starts[k + 1]).join('\n');
    if (!/advisor_office_hour_slots|advisor_bookings/.test(body)) continue;
    if (!/advisor_id/.test(body)) continue;
    const own = /ensureAdvisorStoresSchema|requireMyAdvisor|requireOwnCohort/.test(body);
    if (!blanket && !own) unhealed.push(`line ${starts[k] + 1}: ${lines[starts[k]].trim()}`);
  }

  assert.deepEqual(unhealed, [],
    'these handlers name advisor_id on a table production still calls mentor_id, '
    + 'and never reach the rename that fixes it:\n  ' + unhealed.join('\n  '));

  // The scan must actually be finding the handlers it claims to guard, or the
  // assertion above passes by looking at nothing. Seven is what the gap was.
  const touching = (() => {
    let n = 0;
    for (let k = 0; k < starts.length - 1; k += 1) {
      const body = lines.slice(starts[k], starts[k + 1]).join('\n');
      if (/advisor_office_hour_slots|advisor_bookings/.test(body) && /advisor_id/.test(body)) n += 1;
    }
    return n;
  })();
  assert.ok(touching >= 7,
    `only ${touching} handlers touch the renamed tables — the scan has stopped seeing them`);
});
