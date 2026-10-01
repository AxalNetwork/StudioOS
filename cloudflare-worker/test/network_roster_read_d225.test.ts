/**
 * D225 — a failed roster read is not an empty roster.
 *
 * `loadNetworkProfiles` (axalSpinoutDemoDay.ts) used to swallow every error —
 * a missing table included — behind a bare `catch { return [] }`, so the
 * Demo Day deck's Team & Network slide drew "no advisors" for an unreadable
 * `network_profiles` table exactly as it would for a genuinely empty one, on
 * a deck founders show investors. It now answers
 * `{ rows, available, reason }`, and the caller (`fillAxalSpinoutDemoDay`)
 * says the roster could not be read instead of drawing it as empty.
 *
 * Two things are pinned, against real `node:sqlite` (not a mock):
 *   1. `loadNetworkProfiles` itself, with the table present vs. dropped.
 *   2. The read path bootstraps nothing: `ensureNetworkProfilesSchema` used
 *      to run on every read, so a dropped table came back "empty" via a
 *      silent CREATE TABLE IF NOT EXISTS. It no longer does — dropping the
 *      table stays dropped across the read.
 *
 * A third test drives the full `fillAxalSpinoutDemoDay` pipeline (fake env,
 * same pattern as decks.team_radar.test.ts) to pin the slide's own body
 * copy for the unreadable case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadNetworkProfiles, fillAxalSpinoutDemoDay } from '../src/services/decks/axalSpinoutDemoDay.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

function networkProfilesDdl(): string {
  const at = BASELINE.indexOf('\nCREATE TABLE network_profiles (');
  assert.ok(at >= 0, 'network_profiles is no longer defined in schema_baseline.sql');
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, 'network_profiles\' definition in the baseline is unterminated');
  return BASELINE.slice(at, end + 2);
}

function freshDb(opts: { withTable?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  if (opts.withTable !== false) db.exec(networkProfilesDdl());
  return db;
}

function profile(db: InstanceType<typeof DatabaseSync>, p: { name: string; order: number }): void {
  db.prepare(
    `INSERT INTO network_profiles (name, kind, display_order, is_active) VALUES (?, 'advisor', ?, 1)`,
  ).run(p.name, p.order);
}

/** Real-sqlite-backed D1 shim, tracking every statement it is asked to run. */
function makeD1(db: InstanceType<typeof DatabaseSync>, seen: string[]) {
  return {
    prepare(sql: string) {
      seen.push(sql);
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
    async exec(sql: string) { seen.push(sql); db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { seen.push(...x); return x; },
  };
}

test('loadNetworkProfiles: table present — available, rows in display order', async () => {
  const db = freshDb();
  profile(db, { name: 'Zoe', order: 1 });
  profile(db, { name: 'Mia', order: 0 });
  const env = { DB: makeD1(db, []), ENVIRONMENT: 'development' } as any;
  const result = await loadNetworkProfiles(env);
  assert.equal(result.available, true);
  assert.equal(result.reason, undefined);
  assert.deepEqual(result.rows.map((r) => r.name), ['Mia', 'Zoe']);
});

test('loadNetworkProfiles: table present but empty — available, zero rows (not the unreadable case)', async () => {
  const db = freshDb();
  const env = { DB: makeD1(db, []), ENVIRONMENT: 'development' } as any;
  const result = await loadNetworkProfiles(env);
  assert.equal(result.available, true);
  assert.deepEqual(result.rows, []);
  assert.equal(result.reason, undefined, 'an empty table is not the unreadable case and carries no reason');
});

test('loadNetworkProfiles: table dropped — unavailable with a reason, not an empty roster', async () => {
  const db = freshDb({ withTable: false });
  const env = { DB: makeD1(db, []), ENVIRONMENT: 'development' } as any;
  const result = await loadNetworkProfiles(env);
  assert.equal(result.available, false, 'a dropped table must not read as available');
  assert.deepEqual(result.rows, [], 'no rows to draw, but the caller must not treat this as empty');
  assert.match(result.reason ?? '', /has not been created/);
});

test('loadNetworkProfiles: a dropped table stays dropped — the read bootstraps nothing', async () => {
  const db = freshDb({ withTable: false });
  const seen: string[] = [];
  const env = { DB: makeD1(db, seen), ENVIRONMENT: 'development' } as any;
  await loadNetworkProfiles(env);
  assert.ok(
    !seen.some((sql) => /CREATE TABLE/i.test(sql)),
    'a read must never create the table it failed to read',
  );
  assert.throws(
    () => db.prepare('SELECT 1 FROM network_profiles').get(),
    /no such table/i,
    'the table must still be missing after the read',
  );
});

test('fillAxalSpinoutDemoDay: an unreadable roster says so on the slide, not "no advisors"', async () => {
  const project = { id: 1, founder_id: 1, name: 'Test Co', sector: 'B2B SaaS' };
  const user = {
    id: 1, name: 'Founder', display_name: 'Founder', email: 'f@test.co',
    spinout_lab_active: 1, spinout_lab_week: 4, spinout_lab_started_at: null,
  };
  const resolve2 = (sql: string) => {
    const s = sql.toLowerCase();
    if (s.includes('from network_profiles')) throw new Error('no such table: network_profiles');
    if (s.includes('from projects')) return { first: async () => project, all: async () => ({ results: [project] }) };
    if (s.includes('from users')) return { first: async () => user, all: async () => ({ results: [user] }) };
    return { first: async () => null, all: async () => ({ results: [] }) };
  };
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (..._args: any[]) => ({
            first: () => resolve2(sql).first(),
            all: () => resolve2(sql).all(),
            run: async () => ({ success: true }),
          }),
          first: () => resolve2(sql).first(),
          all: () => resolve2(sql).all(),
          run: async () => ({ success: true }),
        };
      },
      batch: async (_stmts: any[]) => [],
      exec: async (_sql: string) => ({ count: 0, duration: 0 }),
    },
  } as any;
  const data = await fillAxalSpinoutDemoDay(env, 1, 1);
  assert.deepEqual(data.mentor_network.profiles, []);
  assert.match(
    data.mentor_network.body,
    /unreadable/i,
    'an unreadable roster must not read as an empty one',
  );
  assert.doesNotMatch(
    data.mentor_network.body,
    /^0 mentors|^—$/,
    'the unreadable case must not fall through to the empty-roster copy',
  );
});
