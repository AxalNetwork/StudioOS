/**
 * #5343 batch 2 (#4568 R2-04 follow-up): six single-column bootstraps moved
 * onto `runSchemaBootstrap`.
 *
 *   services/captableSchema.ts               every cap-table read and write (`is_variant`)
 *   services/exploringSchema.ts              the fetch-path exploring bootstrap (`needs_assessment_completed`)
 *   services/market_intel/extractor_schema.ts  the MI queue consumer (`users.mi_contribution_optout`, on the full users table)
 *   services/decks/cardBlobs.ts              the card-blob prune cron and deck reads (`card_hashes`)
 *   services/eventsSchema.ts                 events outside production (`topics_json`)
 *   services/xSchema.ts                      X posts (`scheduled_by`)
 *
 * As `runtime_ddl_5343_batch1.test.ts`:
 *   · on the migrated schema, three fresh isolates issue no ALTER and no
 *     duplicate-column or too-many-columns error;
 *   · with the column missing, each bootstrap adds it once; the next isolate issues none;
 *   · a genuine failure is not remembered as ready, is tried again and recovers
 *     (the cap table throws `captable_schema_not_ready`);
 *   · two isolates starting together both succeed and add the column once.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/runtime_ddl_5343_batch2.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { CAPTABLE_SCHEMA_NOT_READY, ensureCapTableVariantColumn } from '../src/services/captableSchema.ts';
import { ensureExploringSchema } from '../src/services/exploringSchema.ts';
import { ensureExtractorSchema } from '../src/services/market_intel/extractor_schema.ts';
import { ensureCardBlobSchema } from '../src/services/decks/cardBlobs.ts';
import { ensureEventsSchema } from '../src/services/eventsSchema.ts';
import { ensureXSchema } from '../src/services/xSchema.ts';

afterAll(() => removeMigratedDatabases());

/** A fresh isolate's binding over `db`: it records ALTERs and errors, and may fail chosen statements. */
function isolate(db: DatabaseSync, fail?: (sql: string) => string | null) {
  const base = d1Over(db);
  const log = { alters: [] as string[], errors: [] as string[], statements: 0 };
  const seen = (sql: string) => {
    log.statements++;
    if (/^\s*ALTER\b/i.test(sql)) log.alters.push(sql);
    const forced = fail?.(sql);
    if (forced) { log.errors.push(forced); throw new Error(forced); }
  };
  const wrap = (sql: string, st: any) => {
    const track = (f: () => Promise<any>) => async () => {
      seen(sql);
      try { return await f(); } catch (e) { log.errors.push(String((e as Error).message)); throw e; }
    };
    const api: any = { bind: (...a: unknown[]) => { st.bind(...a); return api; } };
    api.run = track(() => st.run()); api.all = track(() => st.all()); api.first = (c?: string) => track(() => st.first(c))();
    return api;
  };
  const DB = {
    prepare: (sql: string) => wrap(sql, base.prepare(sql)),
    batch: (s: any[]) => base.batch(s),
    exec: async (s: string) => {
      seen(s);
      try { return await base.exec(s); } catch (e) { log.errors.push(String((e as Error).message)); throw e; }
    },
  };
  return { env: { DB, ENVIRONMENT: 'development' } as any, log };
}
const columns = (db: DatabaseSync, t: string) => (db.prepare('SELECT name FROM pragma_table_info(?)').all(t) as any[]).map((r) => String(r.name));
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [e, w] = [console.error, console.warn];
  console.error = () => {}; console.warn = () => {};
  try { return await f(); } finally { console.error = e; console.warn = w; }
};
const BAD = /duplicate column|too many columns/i;

async function all(env: any) {
  await ensureCapTableVariantColumn(env);
  await ensureExploringSchema(env);
  await ensureExtractorSchema(env);
  assert.equal(await ensureCardBlobSchema(env), true);
  assert.equal(await ensureEventsSchema(env), true);
  await ensureXSchema(env);
}

test('#5343 batch 2: on an up-to-date database the six bootstraps issue no ALTER and no duplicate-column error, across fresh isolates', async () => {
  const db = migratedDatabase();
  try {
    for (let k = 0; k < 3; k++) {
      const { env, log } = isolate(db);
      await quiet(() => all(env));
      await quiet(() => all(env));
      // Mutation checked: the extractor's users ALTER back to a blind exec → a too-many-columns error on every isolate here.
      assert.deepEqual(log.alters, [], `isolate ${k}: no ALTER against an up-to-date database`);
      assert.deepEqual(log.errors.filter((e) => BAD.test(e)), [], `isolate ${k}: no duplicate-column error`);
    }
  } finally { db.close(); }
});

test('#5343 batch 2: a database missing each column gets it once; the next isolate issues none', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE cap_table_scenarios (id INTEGER PRIMARY KEY);
      CREATE TABLE user_role_review (user_id INTEGER PRIMARY KEY, suggested_role TEXT, role_confirmed INTEGER NOT NULL DEFAULT 0, onboarded_at TEXT, binding_envelope_id INTEGER, binding_document_type TEXT, binding_sent_at TEXT, assigned_role TEXT, assigned_by_user_id INTEGER, assigned_at TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE pitch_decks (id INTEGER PRIMARY KEY);
      CREATE TABLE x_accounts (id INTEGER PRIMARY KEY, enabled INTEGER);
      CREATE TABLE x_posts (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT, account_id INTEGER, thread_continuation_of INTEGER, thread_position INTEGER);`);
    const first = isolate(db);
    await quiet(async () => {
      await ensureCapTableVariantColumn(first.env);
      await ensureExploringSchema(first.env);
      await ensureExtractorSchema(first.env);
      await ensureCardBlobSchema(first.env);
      await ensureXSchema(first.env);
    });
    const added = (t: string) => first.log.alters.filter((a) => a.includes(`ALTER TABLE ${t} `)).length;
    assert.deepEqual(['cap_table_scenarios', 'user_role_review', 'users', 'pitch_decks', 'x_posts'].map(added), [1, 1, 1, 1, 1]);
    assert.ok(columns(db, 'cap_table_scenarios').includes('is_variant'));
    assert.ok(columns(db, 'user_role_review').includes('needs_assessment_completed'));
    assert.ok(columns(db, 'users').includes('mi_contribution_optout'));
    assert.ok(columns(db, 'pitch_decks').includes('card_hashes'));
    assert.ok(columns(db, 'x_posts').includes('scheduled_by'));
    const next = isolate(db);
    await quiet(async () => {
      await ensureCapTableVariantColumn(next.env);
      await ensureExploringSchema(next.env);
      await ensureExtractorSchema(next.env);
      await ensureCardBlobSchema(next.env);
      await ensureXSchema(next.env);
    });
    assert.deepEqual(next.log.alters, [], 'the next fresh isolate finds them and issues none');
  } finally { db.close(); }
});

test('#5343 batch 2: the cap table with no table throws its readiness error, is tried again, and recovers', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const { env, log } = isolate(db);
    const logged: unknown[][] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { logged.push(a); };
    try {
      // Mutation checked: the old swallowing try/catch restored → this resolves and the assertion fails.
      await assert.rejects(ensureCapTableVariantColumn(env), { message: CAPTABLE_SCHEMA_NOT_READY });
      const before = log.statements;
      await assert.rejects(ensureCapTableVariantColumn(env), { message: CAPTABLE_SCHEMA_NOT_READY });
      assert.ok(log.statements > before, 'tried again rather than trusting a failed bootstrap');
    } finally { console.error = orig; }
    assert.deepEqual(logged, [['[captable] schema_not_ready'], ['[captable] schema_not_ready']]);
    db.exec('CREATE TABLE cap_table_scenarios (id INTEGER PRIMARY KEY)');
    await ensureCapTableVariantColumn(env);
    assert.ok(columns(db, 'cap_table_scenarios').includes('is_variant'));
  } finally { db.close(); }
});

test('#5343 batch 2: a failing ALTER leaves the extractor, X and card-blob bootstraps unready; the next call recovers', async () => {
  for (const [name, table, run, ok] of [
    ['extractor', 'users', ensureExtractorSchema, (db: DatabaseSync) => columns(db, 'users').includes('mi_contribution_optout')],
    ['x', 'x_posts', ensureXSchema, (db: DatabaseSync) => columns(db, 'x_posts').includes('scheduled_by')],
    ['card blobs', 'pitch_decks', async (env: any) => { if (!(await ensureCardBlobSchema(env))) throw new Error('not ready'); }, (db: DatabaseSync) => columns(db, 'pitch_decks').includes('card_hashes')],
  ] as const) {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE pitch_decks (id INTEGER PRIMARY KEY);');
      let broken = true;
      const { env } = isolate(db, (sql) => (broken && sql.trimStart().startsWith(`ALTER TABLE ${table} `) ? 'disk I/O error' : null));
      await quiet(async () => { try { await (run as any)(env); } catch { /* the failure itself */ } });
      assert.equal(ok(db), false, `${name}: the column was not added`);
      broken = false;
      // Mutation checked: extractor_schema's `if (!failed)` dropped (READY set after a failure) → the next call does nothing and this fails.
      await quiet(() => (run as any)(env));
      assert.equal(ok(db), true, `${name}: the next call tried again and added it`);
    } finally { db.close(); }
  }
});

test('#5343 batch 2: two isolates starting together both succeed and add each column once', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE cap_table_scenarios (id INTEGER PRIMARY KEY); CREATE TABLE pitch_decks (id INTEGER PRIMARY KEY);');
    const a = isolate(db), b = isolate(db);
    const [ra, rb] = await quiet(() => Promise.all([
      Promise.all([ensureCapTableVariantColumn(a.env), ensureCardBlobSchema(a.env)]),
      Promise.all([ensureCapTableVariantColumn(b.env), ensureCardBlobSchema(b.env)]),
    ]));
    assert.deepEqual([ra[1], rb[1]], [true, true]);
    assert.equal(columns(db, 'cap_table_scenarios').filter((c) => c === 'is_variant').length, 1);
    assert.equal(columns(db, 'pitch_decks').filter((c) => c === 'card_hashes').length, 1);
  } finally { db.close(); }
});
