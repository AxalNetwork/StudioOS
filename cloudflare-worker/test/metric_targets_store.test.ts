/**
 * `metric_targets` finally has both ends.
 *
 * Migration 173 created the table — `project_id`, `metric_key`, `target_value`,
 * a `direction` CHECK and `UNIQUE (project_id, metric_key)` — and then NOTHING
 * READ OR WROTE IT anywhere in the worker or the SPA, for twenty-one migrations.
 * It is the same orphan shape `interview_pain_severities` had before migration
 * 215's header named that one by example, and the consequence was visible on
 * three surfaces of `/grow/focus` at once: the "Targets" chip refused with "no
 * metric target is stored", the Target stat tile read "Not recorded · No target
 * source connected", and the rail listed "Target tracking" as unavailable.
 *
 * RUN, NOT READ. These call the routes against a real SQLite built from
 * MIGRATION 173 itself, because every failure worth catching here is shaped like
 * a write that succeeds and means the wrong thing:
 *
 *   · A `direction` defaulted from the column rather than the metric would put
 *     'up' on net burn, and migration 173's own comment says what that costs:
 *     the UI "would colour a burn overage green". The store, not the page, is
 *     where lower-is-better is known.
 *   · A second write from a second tab inserting rather than updating would leave
 *     two targets for one metric, and the reader would show whichever the index
 *     handed back first.
 *   · A target on a `metric_key` no snapshot carries can never be compared, so it
 *     would sit in the Targets view forever reading "Not recorded" and look like
 *     a broken reader rather than a metric this product does not store.
 *   · Clearing by sending 0 would make "get churn to zero" unsettable, and
 *     clearing by omission would make a mis-typed key permanent.
 *   · A read that is not narrowed to the caller's own project is the IDOR this
 *     file's neighbours exist to refuse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import progress from '../src/routes/progress.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER_USER = 601;
const FOUNDER_ID = 71;
const OTHER_USER = 602;
const OTHER_FOUNDER_ID = 72;
const ADMIN_USER = 603;
const PROJECT = 8101;
const OTHER_PROJECT = 8102;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first(col?: string) {
          const r = db.prepare(sql).get(...b) ?? null;
          return col === undefined ? r : ((r as any)?.[col] ?? null);
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

/**
 * The target table comes FROM MIGRATION 173, not from a hand-written copy — the
 * rule `partner_pipeline_stores.test.ts` states in its own header, after a shape
 * copied into a test let it pass against a schema production did not have. It
 * matters twice over here, because the route ALSO carries a lazy `CREATE TABLE
 * IF NOT EXISTS` for dev databases: if that copy and the migration drift apart,
 * this fixture is the migration's side and the assertions below run against it.
 */
function tableFromMigration(name: string, table: string): string {
  const src = readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
  const at = src.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(at >= 0, `${table} is no longer created by migration ${name}`);
  return src.slice(at, src.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
                        is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
                        name TEXT, email TEXT, spinout_lab_active INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER NOT NULL,
                           company_id INTEGER, name TEXT);
  `);
  db.exec(tableFromMigration('173_metrics_board_reporting', 'metric_targets'));

  db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)')
    .run(FOUNDER_USER, 'founder', FOUNDER_ID, 'f@example.com');
  db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)')
    .run(OTHER_USER, 'founder', OTHER_FOUNDER_ID, 'other@example.com');
  db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)')
    .run(ADMIN_USER, 'admin', null, 'a@example.com');
  db.prepare('INSERT INTO projects (id, founder_id, name) VALUES (?,?,?)').run(PROJECT, FOUNDER_ID, 'Ours');
  db.prepare('INSERT INTO projects (id, founder_id, name) VALUES (?,?,?)')
    .run(OTHER_PROJECT, OTHER_FOUNDER_ID, 'Theirs');
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) }) as any;

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(e: any, path: string, init: RequestInit, who = FOUNDER_USER, role = 'founder') {
  const res = await progress.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${await token(who, role)}`, 'Content-Type': 'application/json' },
  }, e);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const put = (e: any, projectId: number, body: any, who = FOUNDER_USER, role = 'founder') =>
  call(e, `/metrics/${projectId}/targets`, { method: 'PUT', body: JSON.stringify(body) }, who, role);
const get = (e: any, projectId: number, who = FOUNDER_USER, role = 'founder') =>
  call(e, `/metrics/${projectId}/targets`, { method: 'GET' }, who, role);

test('a target written is a target the zone reads back', async () => {
  const db = freshDb();
  const e = env(db);

  const before = await get(e, PROJECT);
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.deepEqual(before.body.items, [], 'an untouched project already has a target');

  const w = await put(e, PROJECT, { metric_key: 'mrr', target_value: 42000, label: 'Q4 plan' });
  assert.equal(w.status, 200, JSON.stringify(w.body));

  const after = await get(e, PROJECT);
  assert.equal(after.body.items.length, 1, 'the read cannot see the row the write just made');
  assert.deepEqual(
    { ...after.body.items[0], id: undefined, updated_at: undefined },
    { id: undefined, metric_key: 'mrr', target_value: 42000, direction: 'up', label: 'Q4 plan', updated_at: undefined },
  );
});

test('lower-is-better comes from the store, so a burn overage is never good news', async () => {
  const db = freshDb();
  const e = env(db);
  // No `direction` sent: the caller does not have to know, and the three metrics
  // where being over the number is BAD are exactly where a column default of
  // 'up' would mislead. Migration 173's comment is the source of this list.
  for (const key of ['net_burn', 'cac', 'monthly_churn_pct']) {
    const w = await put(e, PROJECT, { metric_key: key, target_value: 10 });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal(w.body.target.direction, 'down', `${key} defaulted to up, so over-target would read as a win`);
  }
  for (const key of ['mrr', 'active_users', 'nrr_pct']) {
    const w = await put(e, PROJECT, { metric_key: key, target_value: 10 });
    assert.equal(w.body.target.direction, 'up', `${key} defaulted to down`);
  }
  // A caller MAY override — "hold headcount down" is a real plan — but only to a
  // value the CHECK constraint admits, or the write fails at the database.
  const forced = await put(e, PROJECT, { metric_key: 'headcount', target_value: 12, direction: 'down' });
  assert.equal(forced.body.target.direction, 'down', 'an explicit direction was ignored');
  const junk = await put(e, PROJECT, { metric_key: 'ltv', target_value: 5, direction: 'sideways' });
  assert.equal(junk.status, 200, 'a nonsense direction must fall back, not 500 at the CHECK');
  assert.equal(junk.body.target.direction, 'up');
});

test('setting the same metric twice revises one row, it does not make a second', async () => {
  const db = freshDb();
  const e = env(db);
  await put(e, PROJECT, { metric_key: 'mrr', target_value: 1000, label: 'first' });
  const first = (await get(e, PROJECT)).body.items[0];
  await put(e, PROJECT, { metric_key: 'mrr', target_value: 2500 });

  const rows = (await get(e, PROJECT)).body.items;
  assert.equal(rows.length, 1, 'one metric now has two targets, and the reader shows whichever comes back first');
  assert.equal(rows[0].id, first.id, 'the revision replaced the row instead of updating it');
  assert.equal(rows[0].target_value, 2500);
  // Omitting the label CLEARS it rather than keeping the old one: the upsert
  // writes the row it was given, and a label left behind would describe a
  // number that is no longer there ("first" against 2500).
  assert.equal(rows[0].label, null, 'a stale label survived onto a revised number');
});

test('null clears a target, and zero is a target', async () => {
  const db = freshDb();
  const e = env(db);
  // Zero is the whole reason `null` is the clear signal: "get churn to zero" is
  // a real plan, so 0 cannot double as "no target".
  const zero = await put(e, PROJECT, { metric_key: 'monthly_churn_pct', target_value: 0 });
  assert.equal(zero.status, 200, JSON.stringify(zero.body));
  assert.equal((await get(e, PROJECT)).body.items.length, 1, 'a target of zero was discarded');
  assert.equal((await get(e, PROJECT)).body.items[0].target_value, 0);

  const cleared = await put(e, PROJECT, { metric_key: 'monthly_churn_pct', target_value: null });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.cleared, 'monthly_churn_pct');
  assert.deepEqual((await get(e, PROJECT)).body.items, [], 'the target survived being cleared');
});

test('a metric no snapshot carries is refused, not stored where it can never be compared', async () => {
  const db = freshDb();
  const e = env(db);
  for (const key of ['runway', 'burn', 'MRR', '', 'nps']) {
    const w = await put(e, PROJECT, { metric_key: key, target_value: 5 });
    assert.equal(w.status, 400, `"${key}" was accepted, and nothing will ever compare against it`);
    assert.ok(Array.isArray(w.body.keys), 'the 400 does not say which keys are allowed');
  }
  // `runway` in particular: migration 173 deliberately did NOT store it
  // ("Runway is derived (cash ÷ net burn)"), so a target on it would be a plan
  // for a column that does not exist.
  assert.deepEqual((await get(e, PROJECT)).body.items, []);
  // And the refusal is not a blanket one — the good path still works after it.
  assert.equal((await put(e, PROJECT, { metric_key: 'cash_balance', target_value: 250000 })).status, 200);
});

test('a target_value that is not a number is a 400, not a NULL in a NOT NULL column', async () => {
  const db = freshDb();
  const e = env(db);
  for (const value of ['soon', {}, [], 'NaN', undefined]) {
    const w = await put(e, PROJECT, { metric_key: 'mrr', target_value: value });
    assert.equal(w.status, 400, `${JSON.stringify(value)} was accepted as a target`);
  }
  assert.deepEqual((await get(e, PROJECT)).body.items, []);
});

test('targets are narrowed to the caller’s own project, in both directions', async () => {
  const db = freshDb();
  const e = env(db);
  await put(e, PROJECT, { metric_key: 'mrr', target_value: 1000 });
  await put(e, OTHER_PROJECT, { metric_key: 'mrr', target_value: 9999 }, OTHER_USER);

  // Neither founder may read the other's plan number, and neither may write it.
  for (const [who, theirs] of [[FOUNDER_USER, OTHER_PROJECT], [OTHER_USER, PROJECT]] as const) {
    const read = await get(e, theirs, who);
    assert.notEqual(read.status, 200, `founder ${who} read project ${theirs}'s targets`);
    const write = await put(e, theirs, { metric_key: 'arr', target_value: 1 }, who);
    assert.notEqual(write.status, 200, `founder ${who} set a target on project ${theirs}`);
  }
  // And the rows stayed as each owner left them.
  assert.equal((await get(e, PROJECT)).body.items[0].target_value, 1000);
  assert.equal((await get(e, OTHER_PROJECT, OTHER_USER)).body.items[0].target_value, 9999);
});

test('the keys the read advertises are exactly the keys a write accepts', async () => {
  const db = freshDb();
  const e = env(db);
  // The editor's picker is built from `keys` on the read. If the two lists could
  // differ, the picker would offer an option the write rejects — a form whose
  // own dropdown produces a 400, which is the class of failure
  // `zone_actions.test.mjs` calls a button that 404s.
  const keys = (await get(e, PROJECT)).body.keys;
  const names = Object.keys(keys);
  assert.ok(names.length >= 10, `only ${names.length} metric keys advertised`);
  for (const key of names) {
    const w = await put(e, PROJECT, { metric_key: key, target_value: 1 });
    assert.equal(w.status, 200, `the read advertises ${key} and the write refuses it`);
    assert.equal(w.body.target.direction, keys[key],
      `${key} is advertised as ${keys[key]} and stored as ${w.body.target.direction}`);
  }
  assert.equal((await get(e, PROJECT)).body.items.length, names.length);
});

test('an admin may set a target on a project they do not own', async () => {
  const db = freshDb();
  const e = env(db);
  const w = await put(e, PROJECT, { metric_key: 'mrr', target_value: 5000 }, ADMIN_USER, 'admin');
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal((await get(e, PROJECT, ADMIN_USER, 'admin')).body.items.length, 1);
});
