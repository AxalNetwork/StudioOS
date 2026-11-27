/**
 * D5354 (#5354) — CRM deal moves use D4632's atomic, version-guarded policy.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_system_transitions_5354.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSystemMove, type SystemMoveSource } from '../src/services/dealTransitions.ts';

type Db = InstanceType<typeof DatabaseSync> & { race?: string | null };
const coerce = (values: unknown[]) => values.map((v) => v === undefined ? null : v);

function d1(db: Db) {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const meta = (r: any) => ({ meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } });
      const statement: any = {
        bind: (...values: unknown[]) => { bound = coerce(values); return statement; },
        async first<T>() { return (db.prepare(sql).get(...bound) as T | undefined) ?? null; },
        async run() { return meta(db.prepare(sql).run(...bound)); },
        runSync() { return meta(db.prepare(sql).run(...bound)); },
      };
      return statement;
    },
    async batch(statements: any[]) {
      if (db.race) { db.exec(db.race); db.race = null; }
      db.exec('SAVEPOINT system_move');
      try {
        const out = statements.map((statement) => statement.runSync());
        db.exec('RELEASE system_move');
        return out;
      } catch (error) {
        db.exec('ROLLBACK TO system_move');
        db.exec('RELEASE system_move');
        throw error;
      }
    },
  };
}

function world(): Db {
  const db = new DatabaseSync(':memory:') as Db;
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      stage_changed_at TEXT,
      updated_at TEXT,
      amount REAL,
      pass_reason TEXT,
      pass_note TEXT,
      passed_at TEXT,
      passed_by_user_id INTEGER
    );
    CREATE TABLE deal_stage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      from_stage TEXT,
      to_stage TEXT NOT NULL,
      kind TEXT NOT NULL,
      days_in_from INTEGER,
      actor_user_id INTEGER,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO deals (id, status, stage_changed_at, updated_at)
      VALUES (1, 'applied', '2026-11-01 00:00:00', '2026-11-01 00:00:00');
  `);
  return db;
}

const row = (db: Db) => db.prepare(
  'SELECT status, amount, pass_reason, pass_note, passed_at, passed_by_user_id, stage_changed_at FROM deals WHERE id = 1',
).get() as any;
const events = (db: Db) => db.prepare(
  'SELECT from_stage, to_stage, kind, actor_user_id, source FROM deal_stage_events ORDER BY id',
).all().map((event) => ({ ...event })) as any[];

for (const source of ['hubspot', 'salesforce', 'affinity'] as SystemMoveSource[]) {
  test(`${source} writes one system history row with its guarded move`, async () => {
    const db = world();
    assert.equal(await runSystemMove({ DB: d1(db) } as any, { dealId: 1, to: 'scored', source }), 'moved');
    assert.equal(row(db).status, 'scored');
    assert.deepEqual(events(db), [{ from_stage: 'applied', to_stage: 'scored', kind: 'set', actor_user_id: null, source }]);
  });
}

test('a CRM rejection has a fixed provider-naming reason and no person actor', async () => {
  const db = world();
  assert.equal(await runSystemMove({ DB: d1(db) } as any, { dealId: 1, to: 'rejected', source: 'hubspot' }), 'moved');
  assert.deepEqual([row(db).status, row(db).pass_reason, row(db).passed_by_user_id], ['rejected', 'thesis', null]);
  assert.match(row(db).pass_note, /HubSpot CRM/);
  assert.ok(row(db).passed_at);
  assert.deepEqual(events(db), [{ from_stage: 'applied', to_stage: 'rejected', kind: 'pass', actor_user_id: null, source: 'hubspot' }]);
});

test('a repeated CRM stage is a no-op', async () => {
  const db = world();
  const env = { DB: d1(db) } as any;
  assert.equal(await runSystemMove(env, { dealId: 1, to: 'active', source: 'salesforce' }), 'moved');
  const entered = row(db).stage_changed_at;
  assert.equal(await runSystemMove(env, { dealId: 1, to: 'active', source: 'salesforce' }), 'unchanged');
  assert.equal(row(db).stage_changed_at, entered);
  assert.equal(events(db).length, 1);
});

test('same-stage CRM refreshes owned fields without duplicating stage history', async () => {
  const db = world();
  const env = { DB: d1(db) } as any;
  assert.equal(await runSystemMove(env, { dealId: 1, to: 'applied', source: 'hubspot', fields: { amount: 250_000 } }), 'unchanged');
  assert.equal(row(db).amount, 250_000);
  assert.equal(events(db).length, 0);
  assert.equal(await runSystemMove(env, { dealId: 1, to: 'applied', source: 'hubspot', fields: { amount: 250_000 } }), 'unchanged');
  assert.equal(events(db).length, 0);
});

test('a CRM move that loses its version race writes no event and no stage', async () => {
  const db = world();
  db.race = "UPDATE deals SET status = 'funded', stage_changed_at = '2026-11-10 09:00:00' WHERE id = 1";
  assert.equal(await runSystemMove({ DB: d1(db) } as any, { dealId: 1, to: 'active', source: 'affinity' }), 'lost');
  assert.equal(row(db).status, 'funded');
  assert.equal(events(db).length, 0);
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

test('no deal-stage writer bypasses the transition policy and the dead queue job stays retired', () => {
  const root = resolve(process.cwd(), 'cloudflare-worker/src');
  const offenders = sourceFiles(root)
    .filter((path) => !path.endsWith('/services/dealTransitions.ts'))
    .filter((path) => /UPDATE deals SET status/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(readFileSync(join(root, 'services/queueWorker.ts'), 'utf8'), /case ['"]pipeline_advance['"]/);
  assert.doesNotMatch(readFileSync(join(root, 'models/jobs.ts'), 'utf8'), /\| ['"]pipeline_advance['"]/);
});
