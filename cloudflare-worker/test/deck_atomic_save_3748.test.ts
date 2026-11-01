/** #3748 (N3): historical duplicate repair and atomic, stale-base deck saves. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks, { ensureSchema, insertVersion } from '../src/routes/decks.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline } from './_baseline.mjs';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../sql/migrations/713_pitch_decks_unique_version.sql', import.meta.url), 'utf8');

function historicalDecks() {
  const db = new DatabaseSync(':memory:');
  db.exec(tableFromBaseline(baseline, 'pitch_decks')!);
  db.exec('CREATE INDEX idx_decks_project ON pitch_decks(project_id, version)');
  return db;
}

test('713 preserves every payload, keeps the latest id for a duplicate version, and numbers older duplicates above the original maximum', () => {
  const db = historicalDecks();
  try {
    const seed = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [id, project, version, current] of [[1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 2, 0], [4, 1, 2, 1], [5, 1, 9, 0], [6, 2, 1, 0], [7, 2, 1, 0], [8, 3, 4, 1], [9, 3, 5, 0]]) {
      seed.run(id, project, version, JSON.stringify([{ title: `Saved ${id}` }]), `Deck ${id}`, current);
    }
    const payloads = db.prepare('SELECT id, project_id, slides, title FROM pitch_decks ORDER BY id').all();
    db.exec(migration);
    assert.deepEqual(db.prepare('SELECT id, project_id, slides, title FROM pitch_decks ORDER BY id').all(), payloads);
    assert.deepEqual(db.prepare('SELECT id, version, is_current FROM pitch_decks ORDER BY id').all().map(r => [r.id, r.version, r.is_current]), [
      [1, 10, 0], [2, 1, 0], [3, 11, 0], [4, 2, 0], [5, 12, 1], [6, 2, 0], [7, 3, 1], [8, 4, 0], [9, 5, 1],
    ]);
    assert.deepEqual(db.prepare('SELECT project_id, SUM(is_current) AS n FROM pitch_decks GROUP BY project_id').all().map(r => [r.project_id, r.n]), [[1, 1], [2, 1], [3, 1]]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pitch_decks d WHERE is_current = 1 AND version <> (SELECT MAX(p.version) FROM pitch_decks p WHERE p.project_id = d.project_id)').get()!.n, 0, 'readers using the highest version see the latest saved payload');
    const once = db.prepare('SELECT * FROM pitch_decks ORDER BY id').all();
    db.exec(migration);
    assert.deepEqual(db.prepare('SELECT * FROM pitch_decks ORDER BY id').all(), once, 'replaying the correction changes no saved version');
  } finally { db.close(); }
});

test('713 enforces unique versions within each project and at most one current row, while allowing other projects and historical versions', () => {
  const db = historicalDecks();
  try {
    db.exec(migration);
    db.exec("INSERT INTO pitch_decks (project_id, version, slides, is_current) VALUES (1, 1, '[]', 1), (2, 1, '[]', 1), (1, 2, '[]', 0)");
    assert.throws(() => db.exec("INSERT INTO pitch_decks (project_id, version, slides, is_current) VALUES (1, 1, '[]', 0)"), /UNIQUE constraint failed: pitch_decks.project_id, pitch_decks.version/);
    assert.throws(() => db.exec("INSERT INTO pitch_decks (project_id, version, slides, is_current) VALUES (1, 3, '[]', 1)"), /UNIQUE constraint failed: pitch_decks.project_id/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pitch_decks').get()!.n, 3);
  } finally { db.close(); }
});

const secret = 'synthetic-atomic-deck-save-3748-secret'.repeat(2);

async function world() {
  const db = historicalDecks();
  for (const table of ['users', 'projects', 'activity_logs']) db.exec(stripForeignKeys(tableFromBaseline(baseline, table)!));
  db.exec("INSERT INTO users (id, name, email, role, founder_id, is_active) VALUES (1, 'Synthetic founder', 'atomic3748@example.test', 'founder', 100, 1); INSERT INTO projects (id, name, founder_id) VALUES (1, 'Atomic fixture', 100)");
  const real = d1Over(db);
  const statements = new WeakMap<object, string>();
  let remaining = 0;
  let release: (() => void) | undefined;
  let gate = Promise.resolve();
  let failInsert = false;
  let saveBatches = 0;
  const DB = {
    ...real,
    prepare(sql: string) {
      const statement = real.prepare(sql);
      const originalFirst = statement.first;
      statement.first = async (column?: string) => {
        const row = await originalFirst(column);
        if (remaining && /SELECT \* FROM pitch_decks WHERE id = \?/i.test(sql)) {
          if (--remaining === 0) release!();
          await gate;
        }
        return row;
      };
      const originalRun = statement.run;
      statement.run = async () => {
        if (failInsert && /INSERT INTO pitch_decks\b/i.test(sql)) throw new Error('synthetic insert failure');
        return originalRun();
      };
      const originalRunSync = statement.runSync;
      statement.runSync = () => {
        if (failInsert && /INSERT INTO pitch_decks\b/i.test(sql)) throw new Error('synthetic insert failure');
        return originalRunSync();
      };
      statements.set(statement, sql);
      return statement;
    },
    async batch(items: any[]) {
      if (items.some(s => /UPDATE pitch_decks SET is_current/i.test(statements.get(s) ?? ''))) saveBatches++;
      return real.batch(items);
    },
  };
  const env: any = { DB, JWT_SECRET: secret };
  await ensureSchema(env);
  db.exec("INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 1, '[{\"title\":\"Original\"}]', 'Original deck', 1, 1)");
  db.exec(migration);
  const app = new Hono<any>().route('/api/decks', decks);
  app.onError((_error, c) => c.json({ error: 'synthetic_request_failed' }, 500));
  const jwt = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  async function save(id: number, title: string, slides: any[] = [{ title }]) {
    const response = await withThrownResponses(() => app.request(`/api/decks/${id}`, {
      method: 'PUT', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title, slides }),
    }, env));
    return { status: response.status, body: await response.json() as any };
  }
  return {
    db, env, save,
    synchronizeBaseReads() { remaining = 2; gate = new Promise<void>(resolve => { release = resolve; }); },
    failNextInsert() { failInsert = true; },
    saveBatches: () => saveBatches,
  };
}

test('two saves of the same base race: exactly one succeeds, the other gets 409 with the current version, and one current row remains', async () => {
  const f = await world();
  try {
    f.synchronizeBaseReads();
    const results = await Promise.all([f.save(10, 'First contender'), f.save(10, 'Second contender')]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const winner = results.find(r => r.status === 200)!.body;
    const conflict = results.find(r => r.status === 409)!.body;
    assert.deepEqual(conflict.current, { id: winner.id, version: 2 });
    assert.deepEqual(f.db.prepare('SELECT id, version, is_current FROM pitch_decks ORDER BY id').all().map(r => [r.id, r.version, r.is_current]), [[10, 1, 0], [winner.id, 2, 1]]);
    assert.equal(f.saveBatches(), 2, 'each attempted version save uses one transactional batch');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'deck_saved'").get()!.n, 1, 'the conflict is not audited as a successful save');
  } finally { f.db.close(); }
});

test('an old version cannot overwrite a newer saved version, and the current version can still be saved', async () => {
  const f = await world();
  try {
    const first = await f.save(10, 'Version two');
    assert.equal(first.status, 200);
    const before = f.db.prepare('SELECT * FROM pitch_decks ORDER BY id').all();
    const stale = await f.save(10, 'Stale edit');
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body.current, { id: first.body.id, version: 2 });
    assert.deepEqual(f.db.prepare('SELECT * FROM pitch_decks ORDER BY id').all(), before);
    const next = await f.save(first.body.id, 'Version three');
    assert.equal(next.status, 200);
    assert.equal(next.body.version, 3);
    assert.deepEqual(f.db.prepare('SELECT version FROM pitch_decks WHERE is_current = 1').all().map(r => r.version), [3]);
  } finally { f.db.close(); }
});

test('a failed insert rolls back the current-row change and leaves every saved payload intact', async () => {
  const f = await world();
  try {
    const before = f.db.prepare('SELECT * FROM pitch_decks ORDER BY id').all();
    f.failNextInsert();
    assert.equal((await f.save(10, 'Failed save')).status, 500);
    assert.deepEqual(f.db.prepare('SELECT * FROM pitch_decks ORDER BY id').all(), before);
  } finally { f.db.close(); }
});

test('first versions racing on an empty project create only one current version', async () => {
  const f = await world();
  try {
    f.db.exec("INSERT INTO projects (id, name, founder_id) VALUES (2, 'Empty fixture', 100)");
    const attempts = await Promise.allSettled([
      insertVersion(f.env, 2, [{ title: 'One' }], 'First', 1),
      insertVersion(f.env, 2, [{ title: 'Two' }], 'Second', 1),
    ]);
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = attempts.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof Response);
    assert.equal(rejected.reason.status, 409);
    assert.deepEqual(f.db.prepare('SELECT version, is_current FROM pitch_decks WHERE project_id = 2').all().map(r => [r.version, r.is_current]), [[1, 1]]);
  } finally { f.db.close(); }
});


test('fresh runtime bootstrap creates both unique deck indexes', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await ensureSchema({ DB: d1Over(db) } as any);
    const indexes = db.prepare('PRAGMA index_list(pitch_decks)').all();
    assert.deepEqual(indexes.filter(r => ['idx_decks_project', 'idx_decks_one_current'].includes(String(r.name))).map(r => [r.name, r.unique, r.partial]).sort(), [['idx_decks_one_current', 1, 1], ['idx_decks_project', 1, 0]]);
    db.exec("INSERT INTO pitch_decks(project_id,version,slides,is_current) VALUES(1,1,'[]',1)");
    assert.throws(() => db.exec("INSERT INTO pitch_decks(project_id,version,slides,is_current) VALUES(1,1,'[]',0)"), /UNIQUE/);
    assert.throws(() => db.exec("INSERT INTO pitch_decks(project_id,version,slides,is_current) VALUES(1,2,'[]',1)"), /UNIQUE/);
  } finally { db.close(); }
});

const spinoutSlides = (problem: string, url: string) => [{
  title: 'Synthetic problem', method_id: 'axal_spinout_demoday',
  fields: [
    { key: 'problem_body', label: 'Problem', kind: 'paragraph', value: problem, source: 'data' },
    { key: 'contact_deal_access_url', label: 'Data room', kind: 'text', value: url, source: 'data' },
  ],
}];

async function spinoutWorld() {
  const f = await world();
  f.db.exec("UPDATE users SET subscription_tier='studio' WHERE id=1; UPDATE projects SET problem_statement='Original project problem', data_room_url='https://example.test/original' WHERE id=1");
  f.db.prepare('UPDATE pitch_decks SET slides=? WHERE id=10').run(JSON.stringify(spinoutSlides('Original project problem', 'https://example.test/original')));
  return f;
}
const projectFields = (f: any) => ({ ...f.db.prepare('SELECT problem_statement, data_room_url FROM projects WHERE id=1').get() });

test('stale and failed saves cannot write project fields; a committed save writes its own values', async () => {
  const f = await spinoutWorld();
  try {
    const first = await f.save(10, 'Committed', spinoutSlides('Committed problem', 'https://example.test/committed'));
    assert.equal(first.status, 200);
    assert.deepEqual(projectFields(f), { problem_statement: 'Committed problem', data_room_url: 'https://example.test/committed' });
    const stale = await f.save(10, 'Stale', spinoutSlides('Stale problem', 'https://example.test/stale'));
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body.current, { id: first.body.id, version: 2 });
    assert.equal(stale.body.message, 'This deck was saved somewhere else. Reload to see the current version.');
    assert.deepEqual(projectFields(f), { problem_statement: 'Committed problem', data_room_url: 'https://example.test/committed' });
    f.failNextInsert();
    const failed = await f.save(first.body.id, 'Failed', spinoutSlides('Failed problem', 'https://example.test/failed'));
    assert.equal(failed.status, 500);
    assert.deepEqual(projectFields(f), { problem_statement: 'Committed problem', data_room_url: 'https://example.test/committed' });
    assert.deepEqual(f.db.prepare('SELECT version FROM pitch_decks WHERE is_current=1').all().map(r => r.version), [2]);
  } finally { f.db.close(); }
});

test('the atomic writer checks both the base id and its version', async () => {
  const f = await world();
  try {
    const before = f.db.prepare('SELECT * FROM pitch_decks ORDER BY id').all();
    for (const base of [{ id: 10, version: 999 }, { id: 999, version: 1 }]) {
      const response = await withThrownResponses(async () => {
        await insertVersion(f.env, 1, [{ title: 'Stale base' }], 'Stale', 1, {}, base);
        return Response.json({ saved: true });
      });
      assert.equal(response.status, 409);
      assert.deepEqual((await response.json() as any).current, { id: 10, version: 1 });
      assert.deepEqual(f.db.prepare('SELECT * FROM pitch_decks ORDER BY id').all(), before);
    }
  } finally { f.db.close(); }
});
