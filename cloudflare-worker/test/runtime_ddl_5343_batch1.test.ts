/**
 * #5343 batch 1 (#4568 R2-04 follow-up): the request-path bootstraps moved off
 * blind `ALTER TABLE … ADD COLUMN` onto `runSchemaBootstrap`, which reads the
 * table's columns once per binding and skips an ALTER whose column exists.
 *
 *   middleware/lastActive.ts      every authenticated /api request (`users.last_active_at`)
 *   services/notifications.ts     every notification write (`notifications.dedupe_key`)
 *   services/notify.ts            every inbox write and the digest flush (migration 053's columns)
 *   services/aiRouter.ts          every AI call's usage row, on a pre-493 table (`addLogColumns493`)
 *
 * For each, as `runtime_ddl_4568.test.ts` does for the cohort bootstrap:
 *   · on the migrated schema, repeated calls and three fresh isolates issue no
 *     ALTER and raise no duplicate-column error;
 *   · with the columns missing, the bootstrap adds them once and the next
 *     fresh isolate issues none;
 *   · a genuine failure is not remembered as ready and is tried again, and the
 *     binding recovers: `last_active_schema_not_ready` is thrown; the two
 *     notification bootstraps answer false (their callers fail closed);
 *   · two isolates starting together both succeed and add each column once.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/runtime_ddl_5343_batch1.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { LAST_ACTIVE_NOT_READY, ensureLastActiveColumn } from '../src/middleware/lastActive.ts';
import { ensureNotificationsSchema } from '../src/services/notifications.ts';
import { ensureInbox } from '../src/services/notify.ts';
import { __resetForTest as resetAiRouter, recordUsage } from '../src/services/aiRouter.ts';

afterAll(() => removeMigratedDatabases());

/** A fresh isolate's binding over `db`: it records every statement's ALTERs and errors, and may fail chosen statements. */
function isolate(db: DatabaseSync, fail?: (sql: string) => string | null) {
  const base = d1Over(db);
  const log = { alters: [] as string[], errors: [] as string[], statements: 0 };
  const wrap = (sql: string, st: any) => {
    const track = (f: () => Promise<any>) => async () => {
      log.statements++;
      if (/^\s*ALTER\b/i.test(sql)) log.alters.push(sql);
      const forced = fail?.(sql);
      if (forced) { log.errors.push(forced); throw new Error(forced); }
      try { return await f(); } catch (e) { log.errors.push(String((e as Error).message)); throw e; }
    };
    const api: any = { bind: (...a: unknown[]) => { st.bind(...a); return api; } };
    api.run = track(() => st.run()); api.all = track(() => st.all()); api.first = (c?: string) => track(() => st.first(c))();
    api.runSync = () => st.runSync();
    return api;
  };
  const DB = {
    prepare: (sql: string) => wrap(sql, base.prepare(sql)),
    batch: (s: any[]) => base.batch(s),
    exec: async (s: string) => {
      log.statements++;
      if (/^\s*ALTER\b/i.test(s)) log.alters.push(s);
      try { return await base.exec(s); } catch (e) { log.errors.push(String((e as Error).message)); throw e; }
    },
  };
  return { env: { DB, ENVIRONMENT: 'development' } as any, log };
}
const columns = (db: DatabaseSync, t: string) => (db.prepare('SELECT name FROM pragma_table_info(?)').all(t) as any[]).map((r) => String(r.name));
const USAGE = { task: 'chat', model: '@cf/synthetic/model', latency_ms: 1, prompt_tokens: 1, completion_tokens: 1, est_cost_usd: 0, fallback_used: false, cached: false, safety_score: null } as any;
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [e, w] = [console.error, console.warn];
  console.error = () => {}; console.warn = () => {};
  try { return await f(); } finally { console.error = e; console.warn = w; }
};

/** Every bootstrap in the batch, once, in one isolate. */
async function all(env: any) {
  await ensureLastActiveColumn(env);
  assert.equal(await ensureNotificationsSchema(env), true);
  assert.equal(await ensureInbox(env), true);
  assert.notEqual(await recordUsage(env, { userId: 1 }, USAGE, null), null, 'the usage row was written');
}

test('#5343 batch 1: on an up-to-date database the four bootstraps issue no ALTER and no error, across fresh isolates', async () => {
  const db = migratedDatabase();
  try {
    for (let k = 0; k < 3; k++) {
      resetAiRouter();
      const { env, log } = isolate(db);
      await all(env);
      await all(env); // the same isolate: remembered
      // Mutation checked: lastActive back on its blind ALTER → an ALTER and a too-many-columns or duplicate-column error here.
      assert.deepEqual(log.alters, [], `isolate ${k}: no ALTER against an up-to-date database`);
      assert.deepEqual(log.errors.filter((e) => /duplicate column|too many columns/i.test(e)), [], `isolate ${k}: no duplicate-column error`);
    }
  } finally { db.close(); }
});

test('#5343 batch 1: a database missing the columns gets them once; the next isolate issues none', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, meta TEXT, read_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE notifications_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, payload TEXT, channel TEXT DEFAULT 'in_app', read_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE ai_usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, task TEXT NOT NULL, model TEXT NOT NULL, latency_ms INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, est_cost_usd REAL NOT NULL DEFAULT 0, safety_score REAL, fallback_used INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, refusal TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), surface TEXT);`);
    resetAiRouter();
    const first = isolate(db);
    await all(first.env);
    const added = (t: string) => first.log.alters.filter((a) => a.includes(` ${t} `)).length;
    assert.deepEqual([added('users'), added('notifications'), added('notifications_inbox'), added('ai_usage_logs')], [1, 1, 4, 10]);
    assert.ok(columns(db, 'users').includes('last_active_at'));
    assert.ok(columns(db, 'notifications').includes('dedupe_key'));
    for (const c of ['category', 'severity', 'cta_url', 'template_key']) assert.ok(columns(db, 'notifications_inbox').includes(c), c);
    for (const c of ['charged_microusd', 'rail_page', 'units_json', 'agent_id', 'skill_id', 'skill_version']) assert.ok(columns(db, 'ai_usage_logs').includes(c), c);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_last_active'").get());
    resetAiRouter();
    const next = isolate(db);
    await all(next.env);
    assert.deepEqual(next.log.alters, [], 'the next fresh isolate finds them and issues none');
  } finally { db.close(); }
});

test('#5343 batch 1: lastActive with no users table throws its readiness error, is tried again, and recovers', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const { env, log } = isolate(db);
    const logged: unknown[][] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { logged.push(a); };
    try {
      // Mutation checked: the old swallowing try/catch restored → this resolves and the assertion fails.
      await assert.rejects(ensureLastActiveColumn(env), new RegExp(LAST_ACTIVE_NOT_READY));
      const before = log.statements;
      await assert.rejects(ensureLastActiveColumn(env), new RegExp(LAST_ACTIVE_NOT_READY));
      assert.ok(log.statements > before, 'the second call tried again rather than trusting a failed bootstrap');
    } finally { console.error = orig; }
    // A code, never a value or the driver's message.
    assert.deepEqual(logged, [['[lastActive] schema_not_ready'], ['[lastActive] schema_not_ready']]);
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
    await ensureLastActiveColumn(env);
    assert.ok(columns(db, 'users').includes('last_active_at'));
  } finally { db.close(); }
});

test('#5343 batch 1: a failing notification ALTER answers false, is not remembered, and the binding recovers', async () => {
  // The tables as an older database holds them: without the columns, so the bootstrap has an ALTER to run.
  const OLD = {
    notifications: 'CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, meta TEXT, read_at TIMESTAMP, created_at TIMESTAMP)',
    notifications_inbox: 'CREATE TABLE notifications_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, payload TEXT, channel TEXT, read_at TIMESTAMP, created_at TIMESTAMP)',
  };
  for (const [name, ensure, table] of [
    ['notifications', ensureNotificationsSchema, 'notifications'],
    ['inbox', ensureInbox, 'notifications_inbox'],
  ] as const) {
    const db = new DatabaseSync(':memory:');
    db.exec(OLD[table]);
    try {
      let broken = true;
      const { env } = isolate(db, (sql) => (broken && new RegExp(`^\\s*ALTER TABLE ${table} `).test(sql) ? 'disk I/O error' : null));
      // Mutation checked: notify.ts' loop back to `try { … } catch {}` per ALTER → this answers true and fails.
      assert.equal(await quiet(() => ensure(env)), false, `${name}: a failed bootstrap is not ready`);
      broken = false;
      assert.equal(await ensure(env), true, `${name}: the next call tries again and succeeds`);
      assert.ok(columns(db, table).includes(table === 'notifications' ? 'dedupe_key' : 'template_key'), name);
    } finally { db.close(); }
  }
});

test('#5343 batch 1: two isolates starting together both succeed and add each column once', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE notifications_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, payload TEXT, channel TEXT DEFAULT 'in_app', read_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    const a = isolate(db), b = isolate(db);
    const [ia, ib] = await Promise.all([
      Promise.all([ensureLastActiveColumn(a.env), ensureInbox(a.env)]),
      Promise.all([ensureLastActiveColumn(b.env), ensureInbox(b.env)]),
    ]);
    assert.deepEqual([ia[1], ib[1]], [true, true]);
    assert.equal(columns(db, 'users').filter((c) => c === 'last_active_at').length, 1);
    assert.equal(columns(db, 'notifications_inbox').filter((c) => c === 'template_key').length, 1);
  } finally { db.close(); }
});
