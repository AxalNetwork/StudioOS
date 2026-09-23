/**
 * D203 — the operator switch store: HQ can switch Eadwyn off without a deploy.
 *
 * WHAT THIS FILE HOLDS, and why each part is driven rather than read:
 *
 *   - THE KILL REACHES A REAL REQUEST. Before D203 no test called an advisor
 *     route with the switch on, so the 503 had never been asserted end to
 *     end. `GET /api/advisor/tools` is used because past the gate it returns a
 *     constant list — so "a release lets Eadwyn answer again" is a real 200,
 *     not merely "a status other than the kill's".
 *   - THE TWO HALVES COMBINE AS THE GATE SAYS. Deploy OR operator; an operator
 *     release never lifts a deploy kill; the deploy half is read with no
 *     database at all, which a DB that throws on any touch proves.
 *   - THE READING'S CLOCK. Held thirty seconds per binding, cleared by the
 *     binding that writes, kept through a failure without latching, and never
 *     shared between two databases — each at a fixed clock, because a TTL
 *     asserted against the wall clock is a test that passes by being fast.
 *   - A DATABASE WITHOUT MIGRATION 283. The gate fails OPEN, the console says
 *     why, and a write answers 503 having written nothing and created nothing.
 *   - THE WRITE ROUTE'S REFUSALS, in order, each leaving the store and the
 *     audit log exactly as they were; and exactly one audit row per change,
 *     with no `user_id` key (D159's rule: that key names a target).
 *
 * REAL node:sqlite THROUGHOUT, with `platform_switches` created from migration
 * 283 read off disk and every other table from schema_baseline.sql verbatim —
 * the D139 lesson: a hand-typed fixture that omitted the CHECK would be testing
 * a table production does not have.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import advisor from '../src/routes/advisor.ts';
import platform from '../src/routes/admin_platform.ts';
import {
  OPERATOR_SWITCH_KEYS, OPERATOR_SWITCH_REACH, OPERATOR_SWITCH_TTL_MS, SWITCH_REASON_MIN,
  readOperatorSwitches, setOperatorSwitch,
} from '../src/services/operatorSwitches.ts';
import {
  ADVISOR_DISABLED_MESSAGE, advisorKillState,
} from '../src/services/advisor/rollout.ts';
import { checkKillSwitch } from '../src/services/advisor/guardrails.ts';
import { PLATFORM_SWITCH_KEYS, readPlatformSwitches } from '../src/services/platformSwitches.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 801;      // the Super Admin
const PLAIN_ADMIN = 802; // an admin who does not hold the elevation
const FOUNDER = 7;       // an Eadwyn user
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0); // a fixed clock for the TTL tests

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MIGRATION = read('cloudflare-worker/sql/migrations/283_platform_switches.sql');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
/**
 * One D1 binding over a sqlite handle. TWO wrappers over ONE handle are two
 * bindings over one database — which is exactly two isolates of one Worker:
 * each has its own reading, and both see the same rows.
 */
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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

/** A binding that refuses every touch and counts the attempts. */
function untouchableD1() {
  const touched = { count: 0 };
  const refuse = () => { touched.count += 1; throw new Error('D1 was touched'); };
  return { touched, DB: { prepare: refuse, exec: refuse, batch: refuse } };
}

function freshDb({ withStore = true } = {}) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'advisor_messages']) {
    db.exec(ddl(t));
  }
  if (withStore) db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'The Holder', 'holder@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  u.run(FOUNDER, 'founder', 'A Founder', 'founder@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  // A TOTP session minted just now satisfies both halves of the write bar:
  // requireFactor reads `factor`, requireStepUp accepts a recent created_at.
  const s = db.prepare(
    "INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now', ?))",
  );
  s.run(HOLDER, 'totp-holder', 'totp', '+0 seconds');
  s.run(PLAIN_ADMIN, 'totp-plain', 'totp', '+0 seconds');
  s.run(HOLDER, 'password-holder', 'password', '+0 seconds');
  s.run(HOLDER, 'totp-stale-holder', 'totp', '-2 days');
  return db;
}

const envFor = (db: InstanceType<typeof DatabaseSync>, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), ...extra }) as any;

async function token(userId: number, role: string, jti?: string): Promise<string> {
  return new SignJWT({ user_id: userId, role, ...(jti ? { jti } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** The router behind production's own auth-error table, so a refusal gets its real status. */
function appFor(router: any) {
  const a = new Hono<any>();
  a.route('/', router);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  return a;
}
const advisorApp = appFor(advisor);
const platformApp = appFor(platform);

async function askEadwyn(env: any) {
  const res = await advisorApp.request('/tools', {
    headers: { Authorization: `Bearer ${await token(FOUNDER, 'founder')}` },
  }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

async function post(env: any, key: string, body: unknown, { as = HOLDER, jti = 'totp-holder' } = {}) {
  const res = await platformApp.request(`/switches/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token(as, 'admin', jti)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

async function getSwitches(env: any, as = HOLDER) {
  const res = await platformApp.request('/switches', {
    headers: { Authorization: `Bearer ${await token(as, 'admin')}` },
  }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

const REASON = 'Eadwyn is answering from a bad index; stopping it while we rebuild.';
const storeRows = (db: any) => db.prepare('SELECT * FROM platform_switches ORDER BY switch_key').all() as any[];
const auditRows = (db: any) =>
  db.prepare("SELECT * FROM admin_audit_log WHERE action LIKE 'platform_switch_%' ORDER BY id").all() as any[];
const tableExists = (db: any, name: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/* ── The migration ────────────────────────────────────────────────────── */

test('migration 283 creates the table the code reads and writes, and seeds nothing', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION);
  const cols = (db.prepare('PRAGMA table_info(platform_switches)').all() as any[]).map((c) => c.name);
  assert.deepEqual(cols, ['switch_key', 'thrown', 'reason', 'set_by_user_id', 'set_at']);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM platform_switches').get() as any).n, 0,
    'the migration seeds a row — a switch nobody threw would read as thrown or released by nobody');
  // The constraints that make a row a claim somebody made.
  assert.throws(() => db.prepare("INSERT INTO platform_switches (switch_key, thrown, reason) VALUES ('eadwyn_off', 2, 'x')").run(),
    /CHECK/, 'thrown admits a value other than 0 and 1');
  assert.throws(() => db.prepare("INSERT INTO platform_switches (switch_key, thrown) VALUES ('eadwyn_off', 1)").run(),
    /NOT NULL/, 'a switch can be thrown without a reason');
  // Idempotent, as every migration here must be, and no transaction statement.
  db.exec(MIGRATION);
  assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, ''), /\b(BEGIN|COMMIT)\b/i);
});

/* ── The gate, end to end ─────────────────────────────────────────────── */

test('an operator throw refuses Eadwyn on the next request, and a release lets it answer again', async () => {
  const db = freshDb();
  const env = envFor(db);

  const before = await askEadwyn(env);
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.ok(Array.isArray(before.body.tools), 'the ungated route did not answer');

  // Through the store directly: the route's own write path is asserted below.
  // THE SAME BINDING asks next, so this is the isolate that wrote — it must see
  // the change at once, not after its thirty-second reading runs out.
  await setOperatorSwitch(env, 'eadwyn_off', true, REASON, HOLDER);
  const killed = await askEadwyn(env);
  assert.equal(killed.status, 503, 'an operator throw did not reach the request');
  assert.equal(killed.body.reason, 'disabled');
  assert.equal(killed.body.error, ADVISOR_DISABLED_MESSAGE);

  await setOperatorSwitch(env, 'eadwyn_off', false, 'Index rebuilt and checked.', HOLDER);
  const after = await askEadwyn(env);
  assert.equal(after.status, 200, 'a release did not let Eadwyn answer again');
  assert.ok(Array.isArray(after.body.tools));
});

test('the per-user gate refuses through the same predicate, in the same words', async () => {
  // checkKillSwitch is the gate a caller reaches without the route's own check.
  // Asking only the deploy half there served Eadwyn under an operator's kill.
  const db = freshDb();
  const env = envFor(db);
  const user = { id: FOUNDER, role: 'founder' } as any;
  assert.equal((await checkKillSwitch(env, user)).blocked, false);
  await setOperatorSwitch(env, 'eadwyn_off', true, REASON, HOLDER);
  const ks = await checkKillSwitch(env, user);
  assert.equal(ks.blocked, true, "the per-user gate does not see an operator's kill");
  assert.equal(ks.reason, 'disabled');
  assert.equal(ks.message, ADVISOR_DISABLED_MESSAGE, 'the two refusals disagree about what to say');
});

test("a deploy kill survives an operator release, and is the half that is named", async () => {
  const db = freshDb();
  const env = envFor(db, { ADVISOR_DISABLED: '1' });
  await setOperatorSwitch(env, 'eadwyn_off', true, REASON, HOLDER);
  await setOperatorSwitch(env, 'eadwyn_off', false, 'Operator side released.', HOLDER);

  const state = await advisorKillState(env);
  assert.equal(state.off, true, 'releasing the operator half turned off a kill the deployment set');
  assert.equal(state.by, 'deploy');
  assert.equal((await askEadwyn(env)).status, 503);
  // The gate above never reads the store while the deployment holds Eadwyn
  // off, so it cannot show a verdict computed from the store alone. The
  // console reads the store every time — it is where that verdict would show.
  const [released] = (await getSwitches(env)).body.items;
  assert.equal(released.state, 'on', 'the console shows Eadwyn on while the deployment holds it off');
  assert.equal(released.operator.thrown, false);
  assert.match(String(released.reason), /only a deployment does/);

  // Both halves on: the deployment is named, because only it can lift that one.
  await setOperatorSwitch(env, 'eadwyn_off', true, REASON, HOLDER);
  const both = await advisorKillState(env, { inspect: true });
  assert.equal(both.by, 'deploy');
  const [entry] = (await getSwitches(env)).body.items;
  assert.equal(entry.state, 'on');
  assert.equal(entry.deploy, 'on');
  assert.equal(entry.operator.thrown, true);
  assert.match(String(entry.reason), /only a deployment does/);
});

test('with the deploy half on, the gate never touches the database', async () => {
  // The break-glass must work when D1 does not — the case it exists for.
  const { touched, DB } = untouchableD1();
  for (const v of [{ ADVISOR_DISABLED: '1' }, { ADVISOR_V2_DISABLED: 'true' }]) {
    const state = await advisorKillState({ DB, ...v } as any);
    assert.equal(state.off, true);
    assert.equal(state.by, 'deploy');
    assert.equal(state.operator, null, 'the store was asked although the deployment had decided');
  }
  assert.equal(touched.count, 0, 'the deploy half read the database');

  // Only the console asks both halves when the deployment has decided — and it
  // says what the store answered rather than claiming a reading it never got.
  const inspected = await advisorKillState({ DB, ADVISOR_DISABLED: '1' } as any, { inspect: true, now: T0 });
  assert.ok(touched.count > 0, 'inspect did not read the store');
  assert.equal(inspected.off, true);
  assert.equal(inspected.operator?.readable, false);
});

/* ── A database without migration 283 ────────────────────────────────── */

test('without 283 the gate fails open, the console says why, and a write changes nothing', async () => {
  const db = freshDb({ withStore: false });
  const env = envFor(db);

  // FAILS OPEN: a store that was never created must not switch Eadwyn off for
  // everyone with nobody having decided to.
  assert.equal((await askEadwyn(env)).status, 200, 'an uncreated store switched Eadwyn off');
  const read1 = await readOperatorSwitches(env, { now: T0 });
  assert.equal(read1.readable, false);
  assert.match((read1 as any).reason, /has not been created on this database yet/);

  const list = await getSwitches(env);
  assert.equal(list.status, 200);
  assert.equal(list.body.available, true, 'the console failed outright instead of saying why');
  const [entry] = list.body.items;
  assert.equal(entry.state, 'unreadable', 'an uncreated store read as a switch nobody threw');
  assert.equal(entry.operator.available, false);
  assert.match(String(entry.operator.reason), /has not been created/);
  assert.match(String(entry.reason), /fails open/);

  const w = await post(env, 'eadwyn_off', { action: 'throw', reason: REASON });
  assert.equal(w.status, 503);
  assert.equal(w.body.code, 'store_unavailable');
  assert.match(String(w.body.error), /nothing was changed/);
  assert.equal(tableExists(db, 'platform_switches'), false,
    'the write created the table — a second definition beside migration 283 (the D191 collision)');
  assert.equal(auditRows(db).length, 0, 'a write that changed nothing was recorded as an act');
});

/* ── The reading's clock ──────────────────────────────────────────────── */

test('a reading is held for thirty seconds per binding; the writing binding sees its own change at once', async () => {
  const db = freshDb();
  const A = envFor(db); // the isolate that writes
  const B = envFor(db); // another isolate of the same Worker

  assert.equal((await advisorKillState(B, { now: T0 })).off, false);
  await setOperatorSwitch(A, 'eadwyn_off', true, REASON, HOLDER);

  assert.equal((await advisorKillState(A, { now: T0 + 1 })).off, true,
    'the binding that wrote kept its old reading');
  assert.equal((await advisorKillState(B, { now: T0 + OPERATOR_SWITCH_TTL_MS - 1 })).off, false,
    'the TTL is shorter than the console states — or the reading is not held at all');
  assert.equal((await advisorKillState(B, { now: T0 + OPERATOR_SWITCH_TTL_MS })).off, true,
    'another isolate never followed the throw');
});

test('a failed read keeps the last good reading, is retried after the TTL, and is never latched', async () => {
  const db = freshDb();
  const env = envFor(db);
  db.prepare(
    "INSERT INTO platform_switches (switch_key, thrown, reason, set_by_user_id) VALUES ('eadwyn_off', 1, ?, ?)",
  ).run(REASON, HOLDER);

  const good = await readOperatorSwitches(env, { now: T0 });
  assert.equal(good.readable, true);

  // The store goes away. Past the TTL the read is attempted, fails, and the
  // last good reading stands — a kill that was thrown stays thrown.
  db.exec('DROP TABLE platform_switches');
  const t1 = T0 + OPERATOR_SWITCH_TTL_MS;
  const stale = await readOperatorSwitches(env, { now: t1 });
  assert.equal(stale.readable, true, 'one failed read threw away the last good reading');
  assert.ok((stale as any).stale_reason, 'a stale reading is not marked as stale');
  assert.equal((stale as any).rows.get('eadwyn_off')?.thrown, true, 'the kill lifted on a failed read');
  assert.equal((await advisorKillState(env, { now: t1 })).off, true);

  // The store comes back — released, now. Inside the TTL of the failed
  // attempt nothing is re-read: an outage costs one failing read per TTL.
  db.exec(MIGRATION);
  db.prepare(
    "INSERT INTO platform_switches (switch_key, thrown, reason, set_by_user_id) VALUES ('eadwyn_off', 0, 'Released.', ?)",
  ).run(HOLDER);
  const within = await readOperatorSwitches(env, { now: t1 + OPERATOR_SWITCH_TTL_MS - 1 });
  assert.ok((within as any).stale_reason, 'a failed read was retried before its TTL ran out');

  // Past it, the next read answers — the failure was not latched.
  const recovered = await readOperatorSwitches(env, { now: t1 + OPERATOR_SWITCH_TTL_MS });
  assert.equal(recovered.readable, true);
  assert.equal((recovered as any).stale_reason, undefined, 'a failure was latched after the store recovered');
  assert.equal((recovered as any).rows.get('eadwyn_off')?.thrown, false);
});

test('a first read that fails is unreadable, and is retried after the TTL', async () => {
  const db = freshDb({ withStore: false });
  const env = envFor(db);
  assert.equal((await readOperatorSwitches(env, { now: T0 })).readable, false);
  db.exec(MIGRATION);
  assert.equal((await readOperatorSwitches(env, { now: T0 + 1 })).readable, false,
    'a failed first read was retried inside its TTL');
  assert.equal((await readOperatorSwitches(env, { now: T0 + OPERATOR_SWITCH_TTL_MS })).readable, true,
    'a failed first read was latched');
});

test('two databases in one isolate keep separate readings', async () => {
  // The #203 bug, for this cache: a module-level reading would let one
  // database's kill switch Eadwyn off on another.
  const dbA = freshDb();
  const dbB = freshDb();
  const A = envFor(dbA);
  const B = envFor(dbB);
  await setOperatorSwitch(A, 'eadwyn_off', true, REASON, HOLDER);
  assert.equal((await advisorKillState(A, { now: T0 })).off, true);
  assert.equal((await advisorKillState(B, { now: T0 })).off, false, "one database's kill reached another");

  // And a write on one clears only its own reading.
  dbB.prepare(
    "INSERT INTO platform_switches (switch_key, thrown, reason, set_by_user_id) VALUES ('eadwyn_off', 1, ?, ?)",
  ).run(REASON, HOLDER);
  await setOperatorSwitch(A, 'eadwyn_off', false, 'Released on A only.', HOLDER);
  assert.equal((await advisorKillState(B, { now: T0 + 1 })).off, false,
    "a write on one database cleared another's reading");
});

/* ── The write ────────────────────────────────────────────────────────── */

test('the conditional write reports whether anything changed, and records who and why', async () => {
  const db = freshDb();
  const env = envFor(db);
  assert.deepEqual(await setOperatorSwitch(env, 'eadwyn_off', false, 'Nothing to release.', HOLDER), { changed: false },
    'a release of a switch nobody threw reported a change');
  assert.equal(storeRows(db).length, 0, 'a release of nothing wrote a row');

  assert.deepEqual(await setOperatorSwitch(env, 'eadwyn_off', true, REASON, HOLDER), { changed: true });
  assert.deepEqual(await setOperatorSwitch(env, 'eadwyn_off', true, 'A second throw.', PLAIN_ADMIN), { changed: false },
    'throwing a thrown switch reported a change');
  let [row] = storeRows(db);
  assert.equal(row.thrown, 1);
  assert.equal(row.reason, REASON, 'a refused second throw overwrote the reason');
  assert.equal(row.set_by_user_id, HOLDER);
  assert.match(String(row.set_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "set_at is not SQLite's clock");

  assert.deepEqual(await setOperatorSwitch(env, 'eadwyn_off', false, 'Index rebuilt.', PLAIN_ADMIN), { changed: true });
  [row] = storeRows(db);
  assert.equal(row.thrown, 0);
  assert.equal(row.reason, 'Index rebuilt.');
  assert.equal(row.set_by_user_id, PLAIN_ADMIN);
  assert.equal(storeRows(db).length, 1, 'a release added a row instead of updating the one');
});

test('the route throws and releases, audited once per change, with no user_id key', async () => {
  const db = freshDb();
  const env = envFor(db);

  const t = await post(env, 'eadwyn_off', { action: 'throw', reason: `  ${REASON}  ` });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.ok, true);
  assert.equal(t.body.switch.state, 'on');
  assert.equal(t.body.switch.operator.thrown, true);
  assert.equal(t.body.switch.operator.set_by_name, 'The Holder');
  assert.match(t.body.message, new RegExp(`within ${OPERATOR_SWITCH_TTL_MS / 1000} seconds`));
  assert.equal(storeRows(db)[0].reason, REASON, 'the stored reason was not trimmed');
  assert.equal((await askEadwyn(env)).status, 503, 'the route wrote a row the gate does not obey');

  const r = await post(env, 'eadwyn_off', { action: 'release', reason: 'Index rebuilt and checked.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.switch.state, 'off');
  assert.equal((await askEadwyn(env)).status, 200);

  const audit = auditRows(db);
  assert.deepEqual(audit.map((a) => a.action), ['platform_switch_thrown', 'platform_switch_released'],
    'not exactly one audit row per change');
  for (const a of audit) {
    assert.equal(a.admin_user_id, HOLDER);
    assert.equal(a.viewed_user_id, null, 'a switch act was recorded as being about an account');
    const details = JSON.parse(a.filters_json);
    assert.equal(details.switch_key, 'eadwyn_off');
    assert.ok(String(details.reason).length >= SWITCH_REASON_MIN);
    assert.ok(!('user_id' in details), 'the audit detail carries user_id, which names a target (D159)');
  }
});

test('every refusal answers in order and leaves the store and the audit log untouched', async () => {
  const db = freshDb();
  const env = envFor(db);
  const cases: Array<[string, () => Promise<{ status: number; body: any }>, number, string]> = [
    ['no TOTP session', () => post(env, 'eadwyn_off', { action: 'throw', reason: REASON }, { jti: 'password-holder' }), 403, 'TOTP required'],
    ['no session id at all', () => post(env, 'eadwyn_off', { action: 'throw', reason: REASON }, { jti: '' }), 403, 'TOTP required'],
    ['no recent step-up', () => post(env, 'eadwyn_off', { action: 'throw', reason: REASON }, { jti: 'totp-stale-holder' }), 403, 'step_up_required'],
    ['not the holder', () => post(env, 'eadwyn_off', { action: 'throw', reason: REASON }, { as: PLAIN_ADMIN, jti: 'totp-plain' }), 403, 'Super admin required'],
    ['an unknown key', () => post(env, 'lights_off', { action: 'throw', reason: REASON }), 404, 'unknown_switch'],
    ['a deploy-only key', () => post(env, 'stripe_tax', { action: 'throw', reason: REASON }), 409, 'not_operator_switch'],
    ['a runtime-only key', () => post(env, 'ai_budget_trip', { action: 'release', reason: REASON }), 409, 'not_operator_switch'],
    ['no action', () => post(env, 'eadwyn_off', { reason: REASON }), 400, 'invalid_action'],
    ['an unknown action', () => post(env, 'eadwyn_off', { action: 'toggle', reason: REASON }), 400, 'invalid_action'],
    ['a short reason', () => post(env, 'eadwyn_off', { action: 'throw', reason: 'bad index' }), 400, 'reason_required'],
    ['a padded short reason', () => post(env, 'eadwyn_off', { action: 'throw', reason: '     bad     ' }), 400, 'reason_required'],
    ['a release of nothing', () => post(env, 'eadwyn_off', { action: 'release', reason: REASON }), 409, 'no_change'],
  ];
  for (const [what, call, status, code] of cases) {
    const r = await call();
    assert.equal(r.status, status, `${what}: expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code ?? r.body.detail, code, `${what}: refused for the wrong reason`);
    assert.equal(storeRows(db).length, 0, `${what}: the refusal wrote to the store`);
    assert.equal(auditRows(db).length, 0, `${what}: the refusal was recorded as an act`);
  }
  // …and a second throw of a thrown switch is refused without a second row.
  assert.equal((await post(env, 'eadwyn_off', { action: 'throw', reason: REASON })).status, 200);
  const again = await post(env, 'eadwyn_off', { action: 'throw', reason: 'Throwing it once more.' });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'no_change');
  assert.equal(auditRows(db).length, 1, 'a refused second throw was audited');
});

test('a branch cannot throw HQ\'s switch, and its own console is HQ-only', async () => {
  const db = freshDb();
  const env = envFor(db, { BRANCH_CODE: 'fr', APP_URL: 'https://fr.axal.vc' });
  const w = await post(env, 'eadwyn_off', { action: 'throw', reason: REASON });
  assert.equal(w.status, 403);
  assert.equal(w.body.detail, 'HQ only');
  assert.equal((await getSwitches(env)).status, 403);
  assert.equal(storeRows(db).length, 0);
});

/* ── The console ──────────────────────────────────────────────────────── */

test('the console lists exactly the operator keys, with both halves and what it cannot reach', async () => {
  const db = freshDb();
  const env = envFor(db);
  assert.equal((await getSwitches(env, PLAIN_ADMIN)).status, 403, 'a plain admin read the operator console');

  const r = await getSwitches(env);
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.deepEqual(r.body.items.map((s: any) => s.key), [...OPERATOR_SWITCH_KEYS]);
  assert.equal(r.body.reason_min, SWITCH_REASON_MIN);
  assert.equal(r.body.propagation_seconds, OPERATOR_SWITCH_TTL_MS / 1000);
  assert.equal(r.body.reach, OPERATOR_SWITCH_REACH);
  const [sw] = r.body.items;
  assert.equal(sw.writable, true);
  assert.equal(sw.deploy, 'off');
  assert.equal(sw.operator.available, true);
  assert.equal(sw.operator.thrown, false);
  assert.equal(sw.operator.set_at, null, 'a switch nobody threw carries a date');
  assert.equal(sw.state, 'off');
});

test('the registry lists every switch once, and marks exactly the operator keys writable', async () => {
  const db = freshDb();
  const items = await readPlatformSwitches(envFor(db));
  assert.deepEqual(items.map((s) => s.key), [...PLATFORM_SWITCH_KEYS],
    'PLATFORM_SWITCH_KEYS and the registry disagree — the write route would refuse the wrong keys');
  assert.deepEqual(items.filter((s) => s.writable).map((s) => s.key), [...OPERATOR_SWITCH_KEYS]);
  assert.deepEqual(items.filter((s) => s.set_by === 'operator').map((s) => s.key), [...OPERATOR_SWITCH_KEYS]);
  for (const k of OPERATOR_SWITCH_KEYS) {
    assert.ok((PLATFORM_SWITCH_KEYS as readonly string[]).includes(k), `${k} is writable and not in the registry`);
  }
});

test("the refusal is in Eadwyn's voice, and true for both halves", () => {
  assert.doesNotMatch(ADVISOR_DISABLED_MESSAGE, /advisor|advice|recommend|fiduciary/i);
  assert.doesNotMatch(ADVISOR_DISABLED_MESSAGE, /update|maintenance/i,
    "the message names a cause an operator's kill is not");
  assert.match(ADVISOR_DISABLED_MESSAGE, /^Eadwyn /);
});
