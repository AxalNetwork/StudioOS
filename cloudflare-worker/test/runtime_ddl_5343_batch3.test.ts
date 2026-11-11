/**
 * #5343 batch 3 (#4568 R2-04 follow-up): six more files off blind runtime ALTERs.
 *
 *   services/authSms.ts and services/authTotp.ts   sign-in factors; both ALTER the full `users` table
 *   integrations/registry.ts                       every integration read (`last_error_at`)
 *   routes/calendar.ts                             calendar OAuth state (`expires_at`)
 *   routes/founder_board.ts                        the founder board's lanes (`mvp_tasks.lane`)
 *   routes/notifications.ts                        no code change: its "ALTER" was a comment the ratchet counted
 *
 * As batches 1 and 2: no ALTER and no duplicate-column or too-many-columns error on the
 * migrated schema across fresh isolates; each missing column added once; a genuine failure
 * is never remembered as ready, is retried and recovers; two isolates together both succeed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/runtime_ddl_5343_batch3.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_SMS_SCHEMA_NOT_READY, ensureAuthSmsSchema } from '../src/services/authSms.ts';
import { AUTH_TOTP_SCHEMA_NOT_READY, ensureAuthTotpSchema } from '../src/services/authTotp.ts';
import { ensureIntegrationsSchema } from '../src/integrations/registry.ts';
import { ensureCalendarOauthStateTable } from '../src/routes/calendar.ts';
import { ensureLanesSchema } from '../src/routes/founder_board.ts';

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
  await ensureAuthSmsSchema(env);
  await ensureAuthTotpSchema(env);
  await ensureIntegrationsSchema(env);
  await ensureCalendarOauthStateTable(env);
  assert.equal(await ensureLanesSchema(env), true);
}

test('#5343 batch 3: on an up-to-date database the five bootstraps issue no ALTER and no duplicate-column error, across fresh isolates', async () => {
  const db = migratedDatabase();
  try {
    for (let k = 0; k < 3; k++) {
      const { env, log } = isolate(db);
      await quiet(() => all(env));
      await quiet(() => all(env));
      // Mutation checked: authSms back on its blind loop → a too-many-columns error on users, on every isolate.
      assert.deepEqual(log.alters, [], `isolate ${k}: no ALTER against an up-to-date database`);
      assert.deepEqual(log.errors.filter((e) => BAD.test(e)), [], `isolate ${k}: no duplicate-column or too-many-columns error`);
    }
  } finally { db.close(); }
});

test('#5343 batch 3: a database missing each column gets it once; the next isolate issues none', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE integrations (id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, status TEXT);
      CREATE TABLE oauth_state_tokens (id INTEGER PRIMARY KEY, state TEXT, user_id INTEGER, provider TEXT, created_at TEXT);
      CREATE TABLE mvp_tasks (id INTEGER PRIMARY KEY);`);
    const first = isolate(db);
    await quiet(() => all(first.env));
    const added = (t: string) => first.log.alters.filter((a) => a.includes(`ALTER TABLE ${t} `)).length;
    assert.deepEqual(['users', 'integrations', 'oauth_state_tokens', 'mvp_tasks'].map(added), [2, 1, 1, 1]);
    for (const c of ['tfa_methods', 'password_reset_required']) assert.ok(columns(db, 'users').includes(c), c);
    assert.ok(columns(db, 'integrations').includes('last_error_at'));
    assert.ok(columns(db, 'oauth_state_tokens').includes('expires_at'));
    assert.ok(columns(db, 'mvp_tasks').includes('lane'));
    const next = isolate(db);
    await quiet(() => all(next.env));
    assert.deepEqual(next.log.alters, [], 'the next fresh isolate finds them and issues none');
  } finally { db.close(); }
});

test('#5343 batch 3: the sign-in bootstraps with no users table throw their readiness error, are tried again, and recover', async () => {
  for (const [name, ensure, code] of [
    ['sms', ensureAuthSmsSchema, AUTH_SMS_SCHEMA_NOT_READY],
    ['totp', ensureAuthTotpSchema, AUTH_TOTP_SCHEMA_NOT_READY],
  ] as const) {
    const db = new DatabaseSync(':memory:');
    try {
      const { env, log } = isolate(db);
      const logged: unknown[][] = [];
      const orig = console.error; console.error = (...a: unknown[]) => { logged.push(a); };
      try {
        // Mutation checked: the old swallowing loop restored → this resolves and the assertion fails.
        await assert.rejects(ensure(env), { message: code }, name);
        const before = log.statements;
        await assert.rejects(ensure(env), { message: code }, name);
        assert.ok(log.statements > before, `${name}: tried again rather than trusting a failed bootstrap`);
      } finally { console.error = orig; }
      assert.equal(logged.length, 2, `${name}: a code is logged each time, never the driver's text`);
      assert.ok(logged.every((l) => l.length === 1 && /schema_not_ready$/.test(String(l[0]))), name);
      db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
      await ensure(env);
    } finally { db.close(); }
  }
});

test('#5343 batch 3: a failing ALTER leaves the lanes, calendar and integrations bootstraps unready; the next call recovers', async () => {
  for (const [name, table, column, run] of [
    ['lanes', 'mvp_tasks', 'lane', async (env: any) => { if (!(await ensureLanesSchema(env))) throw new Error('not ready'); }],
    ['calendar', 'oauth_state_tokens', 'expires_at', ensureCalendarOauthStateTable],
    ['integrations', 'integrations', 'last_error_at', ensureIntegrationsSchema],
  ] as const) {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE mvp_tasks (id INTEGER PRIMARY KEY);
        CREATE TABLE oauth_state_tokens (id INTEGER PRIMARY KEY, state TEXT, user_id INTEGER, provider TEXT, created_at TEXT);
        CREATE TABLE integrations (id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, status TEXT);`);
      let broken = true;
      const { env } = isolate(db, (sql) => (broken && sql.trimStart().startsWith(`ALTER TABLE ${table} `) ? 'disk I/O error' : null));
      await quiet(async () => { try { await (run as any)(env); } catch { /* the failure itself */ } });
      assert.equal(columns(db, table).includes(column), false, `${name}: not added`);
      broken = false;
      // Mutation checked: founder_board's ALTER back inside a swallowing try → the first call latches and this fails.
      await quiet(() => (run as any)(env));
      assert.equal(columns(db, table).includes(column), true, `${name}: the next call tried again and added it`);
    } finally { db.close(); }
  }
});

test('#5343 batch 3: two isolates starting together both succeed and add each users column once', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY);');
    const a = isolate(db), b = isolate(db);
    await quiet(() => Promise.all([
      Promise.all([ensureAuthSmsSchema(a.env), ensureAuthTotpSchema(a.env)]),
      Promise.all([ensureAuthSmsSchema(b.env), ensureAuthTotpSchema(b.env)]),
    ]));
    for (const c of ['tfa_methods', 'password_reset_required']) assert.equal(columns(db, 'users').filter((x) => x === c).length, 1, c);
  } finally { db.close(); }
});
