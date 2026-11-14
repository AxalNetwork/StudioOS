/**
 * D553 (#1146, migration 387) — an LP's type, the comms log, and the
 * `funds/calls` reminder draft surface.
 *
 * THE DATABASE IS BUILT FROM THE MIGRATIONS: the baseline, then every
 * migration after its cutoff in order, as `migrate-d1 --bootstrap` builds a
 * branch database, and migration 387 last, applied whole and required to
 * succeed. The routes then run on that database through `d1Over`, so the
 * CHECKs and the scoping are the real ones.
 *
 * Actors: GP (institutional investor, GP of record of Fund 1), OTHER_GP (of
 * Fund 2), ADMIN, LP_USER (a plain investor holding a position in Fund 1).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import funds from '../src/routes/funds.ts';
import {
  LP_TYPES, COMM_KINDS, callReminderMaterial, parseCommInput, parseSentAt,
} from '../src/services/fundLpComms.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const FILE_387 = readdirSync(MIGRATIONS).find((f) => f.startsWith('387_')) as string;
const SQL_387 = readFileSync(resolve(MIGRATIONS, FILE_387), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1, GP = 40, OTHER_GP = 41, LP_USER = 10;
const ROLE: Record<number, string> = { [ADMIN]: 'admin', [GP]: 'investor', [OTHER_GP]: 'investor', [LP_USER]: 'investor' };

/** Baseline + every migration after the cutoff up to 386, then 387 whole. */
function builtFromMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort(compareMigrations)
    .filter((f) => migrationNumber(f) > BASELINE_CUTOFF && migrationNumber(f) < 387);
  for (const f of files) {
    // As check-migration-declarations' freshBuild: a statement a later
    // migration repeats (an ADD COLUMN the baseline already holds) is skipped.
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  db.exec(SQL_387);
  return db;
}

const BUILT = builtFromMigrations();

function seeded(): DatabaseSync {
  // A fresh copy per test: serialise the built schema once, replay it.
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers that name absent objects */ } }
  db.exec(`
    INSERT INTO users (id, email, name, role, is_active, investor_tier, kyc_status) VALUES
      (${ADMIN}, 'a@example.test', 'Admin', 'admin', 1, 'free', 'approved'),
      (${GP}, 'gp@example.test', 'Gee Pee', 'investor', 1, 'institutional', 'approved'),
      (${OTHER_GP}, 'og@example.test', 'Other GP', 'investor', 1, 'institutional', 'approved'),
      (${LP_USER}, 'lp@example.test', 'Ell Pee', 'investor', 1, 'free', 'approved');
    INSERT INTO vc_funds (id, name, gp_user_id) VALUES (1, 'Fund One', ${GP}), (2, 'Fund Two', ${OTHER_GP});
    INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, status) VALUES
      (100, 1, ${LP_USER}, 'Account LP', 'lp@example.test', 1000, 'committed'),
      (101, 1, NULL, 'Family Co', 'fam@lp.example', 500, 'committed'),
      (200, 2, NULL, 'Other fund LP', 'x@lp.example', 700, 'committed');
    INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, purpose, due_date, line_count, issued_by)
      VALUES (7, 'fc7', 1, 3, 150000, 'Follow-on in Acme', '2026-09-30', 2, ${GP});
    INSERT INTO capital_calls (id, limited_partner_id, amount, amount_cents, status, due_date, fund_call_id) VALUES
      (900, 100, 1000, 100000, 'pending', '2026-09-30', 7),
      (901, 101, 500, 50000, 'pending', '2026-09-30', 7),
      (950, 200, 700, 70000, 'pending', NULL, NULL);
    INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, recorded_by)
      VALUES ('r1', 900, 100, 1, 25000, '2026-09-20', ${GP});
  `);
  return db;
}

/** A route call, with a thrown gate Response unwrapped as the Worker's fetch does. */
async function call(db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await (funds as any).request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const lpType = (db: DatabaseSync, id: number) => (db.prepare('SELECT lp_type FROM limited_partners WHERE id = ?').get(id) as any).lp_type;
const comms = (db: DatabaseSync) => db.prepare('SELECT * FROM fund_lp_communications ORDER BY id').all() as any[];

// ---- the migration ------------------------------------------------------------

test('387 applies to a database built from the migrations; its sets match the API', () => {
  const cols = (t: string) => (BUILT.prepare('SELECT name FROM pragma_table_info(?)').all(t) as any[]).map((r) => r.name);
  assert.ok(cols('limited_partners').includes('lp_type'));
  assert.deepEqual(cols('fund_lp_communications').sort(),
    ['capital_call_id', 'created_at', 'fund_id', 'id', 'kind', 'logged_by', 'lp_id', 'sent_at', 'subject'].sort());
  assert.ok(!cols('fund_lp_communications').some((c) => /body|message|content|html|text/.test(c)), 'no column can hold a message body');
  // The CHECK lists are the service's lists, word for word.
  const set = (re: RegExp) => [...(SQL_387.match(re)?.[1] || '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(set(/lp_type IN \(([^)]*)\)/), [...LP_TYPES]);
  assert.deepEqual(set(/kind IN \(([^)]*)\)/), [...COMM_KINDS]);
  const db = seeded();
  assert.throws(() => db.prepare(`UPDATE limited_partners SET lp_type = 'whale' WHERE id = 100`).run(), /CHECK/);
  assert.equal(lpType(db, 100), null, 'no default: an untyped LP stays untyped');
});

// ---- LP type --------------------------------------------------------------------

test("the GP sets and clears an LP's type; the actor is in the activity log", async () => {
  const db = seeded();
  const r = await call(db, GP, '/1/lps/101/type', { method: 'PUT', body: { lp_type: 'family_office' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(lpType(db, 101), 'family_office');
  const log = db.prepare(`SELECT user_id, action, entity_id, metadata FROM activity_logs WHERE action = 'lp_type_set'`).get() as any;
  assert.ok(log, 'the type change is not in the activity log');
  assert.deepEqual([log.user_id, String(log.entity_id), JSON.parse(log.metadata)], [GP, '101', { fund_id: 1, lp_type: 'family_office' }]);
  assert.equal((await call(db, GP, '/1/lps/101/type', { method: 'PUT', body: { lp_type: null } })).status, 200);
  assert.equal(lpType(db, 101), null);
  const listed = await call(db, GP, '/1/lps');
  assert.ok(listed.body.items.every((x: any) => 'lp_type' in x), 'the register carries the type');
});

test("another fund's LP, another GP and a bad type are refused, and nothing is written", async () => {
  const db = seeded();
  assert.equal((await call(db, GP, '/1/lps/200/type', { method: 'PUT', body: { lp_type: 'corporate' } })).status, 404, 'an LP of Fund Two through Fund One');
  assert.equal((await call(db, GP, '/2/lps/200/type', { method: 'PUT', body: { lp_type: 'corporate' } })).status, 404, 'a fund the caller does not run');
  assert.equal((await call(db, LP_USER, '/1/lps/100/type', { method: 'PUT', body: { lp_type: 'corporate' } })).status !== 200, true);
  const bad = await call(db, GP, '/1/lps/101/type', { method: 'PUT', body: { lp_type: 'whale' } });
  assert.deepEqual([bad.status, bad.body.error], [400, 'lp_type_invalid']);
  assert.equal(lpType(db, 200), null);
  assert.equal(lpType(db, 101), null);
  assert.equal((await call(db, ADMIN, '/2/lps/200/type', { method: 'PUT', body: { lp_type: 'corporate' } })).status, 200, 'an admin operates every fund');
});

// ---- the comms log --------------------------------------------------------------

test('a log entry records the actor from the session, never from the body, and no message body', async () => {
  const db = seeded();
  const r = await call(db, GP, '/1/comms', { method: 'POST', body: {
    lp_id: 101, kind: 'call_reminder', subject: 'Reminder: capital call 3', sent_at: '2026-10-01',
    capital_call_id: 901, logged_by: OTHER_GP, body: 'Dear LP, please wire SECRET-BODY-TEXT', message: 'SECRET-BODY-TEXT',
  } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const [row] = comms(db);
  assert.deepEqual([row.fund_id, row.lp_id, row.kind, row.subject, row.sent_at, row.logged_by, row.capital_call_id],
    [1, 101, 'call_reminder', 'Reminder: capital call 3', '2026-10-01 00:00:00', GP, 901]);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM fund_lp_communications').all()), /SECRET-BODY-TEXT/);
  const list = await call(db, GP, '/1/comms');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((m: any) => [m.lp_name, m.logged_by_name, m.subject]), [['Family Co', 'Gee Pee', 'Reminder: capital call 3']]);
  assert.equal(list.body.truncated, false);
});

test("another fund's LP or call line, or another GP, cannot be logged against", async () => {
  const db = seeded();
  const base = { kind: 'call_reminder', subject: 'S', sent_at: '2026-10-01' };
  assert.equal((await call(db, GP, '/1/comms', { method: 'POST', body: { ...base, lp_id: 200 } })).status, 404, 'an LP of Fund Two');
  assert.equal((await call(db, GP, '/1/comms', { method: 'POST', body: { ...base, lp_id: 101, capital_call_id: 950 } })).status, 404, "another fund's line");
  assert.equal((await call(db, GP, '/1/comms', { method: 'POST', body: { ...base, lp_id: 101, capital_call_id: 900 } })).status, 404, "another LP's line on the same fund");
  assert.equal((await call(db, OTHER_GP, '/1/comms', { method: 'POST', body: { ...base, lp_id: 101 } })).status, 404, 'a GP of another fund');
  assert.equal((await call(db, OTHER_GP, '/1/comms')).status, 404, 'nor read its log');
  assert.deepEqual(comms(db), []);
  const filtered = await call(db, GP, '/1/comms?lp=101');
  assert.deepEqual(filtered.body.items, []);
  assert.equal((await call(db, GP, '/1/comms?lp=abc')).status, 400);
});

test('the log reads newest first and narrows to one LP; a bad entry is refused with a code', async () => {
  const db = seeded();
  for (const [lp, d] of [[101, '2026-09-01'], [100, '2026-10-02'], [101, '2026-09-15']] as const) {
    assert.equal((await call(db, GP, '/1/comms', { method: 'POST', body: { lp_id: lp, kind: 'update', subject: `on ${d}`, sent_at: d } })).status, 201);
  }
  assert.deepEqual((await call(db, GP, '/1/comms')).body.items.map((m: any) => m.subject), ['on 2026-10-02', 'on 2026-09-15', 'on 2026-09-01']);
  assert.deepEqual((await call(db, GP, '/1/comms?lp=101')).body.items.map((m: any) => m.subject), ['on 2026-09-15', 'on 2026-09-01']);
  for (const [body, code] of [
    [{ lp_id: 101, kind: 'tweet', subject: 'x' }, 'kind_invalid'],
    [{ lp_id: 101, kind: 'update', subject: '   ' }, 'subject_required'],
    [{ lp_id: 101, kind: 'update', subject: 'x'.repeat(201) }, 'subject_too_long'],
    [{ kind: 'update', subject: 'x' }, 'lp_required'],
    [{ lp_id: 101, kind: 'update', subject: 'x', sent_at: '2999-01-01' }, 'sent_at_future'],
    [{ lp_id: 101, kind: 'update', subject: 'x', sent_at: 'yesterday' }, 'sent_at_invalid'],
  ] as const) {
    const r = await call(db, GP, '/1/comms', { method: 'POST', body });
    assert.deepEqual([r.status, r.body.error], [400, code], code);
  }
  assert.equal(comms(db).length, 3);
});

test('sent_at: a date, a date and time, or now; never the future', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  assert.equal(parseSentAt(undefined, now), '2026-10-05 12:00:00');
  assert.equal(parseSentAt('2026-10-01', now), '2026-10-01 00:00:00');
  assert.equal(parseSentAt('2026-10-01T09:30', now), '2026-10-01 09:30:00');
  assert.equal(parseSentAt('2026-10-05T12:04:00Z', now), '2026-10-05 12:04:00', 'a clock a few minutes ahead is allowed');
  assert.throws(() => parseSentAt('2026-10-05T12:10:00Z', now), /future/);
  assert.equal(parseCommInput({ lp_id: '5', kind: 'other', subject: ' S ' }, now).subject, 'S');
});

// ---- the reminder draft surface -------------------------------------------------

test('the reminder draft reads one line of a fund the caller runs, with the facts and nothing else', async () => {
  const db = seeded();
  db.prepare(`INSERT INTO fund_lp_communications (fund_id, lp_id, kind, subject, sent_at, logged_by, capital_call_id)
              VALUES (1, 100, 'call_reminder', 'First nudge', '2026-10-01 00:00:00', ?, 900)`).run(GP);
  // An update about the same line is not a reminder, and is not counted as one.
  db.prepare(`INSERT INTO fund_lp_communications (fund_id, lp_id, kind, subject, sent_at, logged_by, capital_call_id)
              VALUES (1, 100, 'update', 'Quarterly letter', '2026-10-03 00:00:00', ?, 900)`).run(GP);
  const env = { DB: d1Over(db) } as any;
  const m = await callReminderMaterial(env, GP, '900');
  assert.deepEqual(m, [
    'LP: Ell Pee',
    'Fund: Fund One',
    'Call: call 3, for Follow-on in Acme',
    "This LP's share: $1,000.00; received so far: $250.00; still owed: $750.00",
    'Due: 2026-09-30',
    'Reminders already logged for this line: 1, the last sent 2026-10-01 00:00:00',
  ]);
  assert.ok((await callReminderMaterial(env, ADMIN, '950')).length > 0, 'an admin drafts on any fund');
});

test('the reminder draft is for this licence only: another fund, a plain LP, a founder or a bad scope get nothing', async () => {
  const db = seeded();
  db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (60, 'f@example.test', 'Founder', 'founder', 1)`).run();
  db.prepare(`UPDATE vc_funds SET gp_user_id = 60 WHERE id = 2`).run();
  const env = { DB: d1Over(db) } as any;
  assert.deepEqual(await callReminderMaterial(env, OTHER_GP, '900'), [], "a GP of another fund");
  assert.deepEqual(await callReminderMaterial(env, LP_USER, '900'), [], 'an investor who is not the GP');
  assert.deepEqual(await callReminderMaterial(env, 60, '950'), [], 'a founder named as GP is not this licence');
  for (const scope of ['', 'null', '900abc', '-1', '9999', '900.0', ' 900', '0900']) {
    assert.deepEqual(await callReminderMaterial(env, GP, scope), [], `scope ${JSON.stringify(scope)}`);
  }
  db.prepare(`INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, recorded_by)
              VALUES ('r2', 901, 101, 1, 50000, '2026-09-21', ?)`).run(GP);
  assert.deepEqual(await callReminderMaterial(env, GP, '901'), [], 'a paid line owes nothing to remind about');
});

test('the surface is registered as funds/calls with no accept hook: accepting it writes and sends nothing', () => {
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/research.ts'), 'utf8');
  const at = src.indexOf("'funds/calls': {");
  assert.ok(at > 0, 'the funds/calls draft surface is not registered');
  const entry = src.slice(at, src.indexOf('\n  },', at));
  assert.match(entry, /gather: \(c, userId, scope\) => callReminderMaterial\(c\.env, userId, scope\)/);
  assert.doesNotMatch(entry, /accept:/, 'an accept hook would write or send on Accept');
});
