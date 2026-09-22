/**
 * D190 — seven declarations a sub-cutoff migration never applied, each with a
 * live reader, restored by migration 278.
 *
 * THE DEFECT CLASS, in one sentence: 034, 048, 056, 095 and 114 all sit below
 * BASELINE_CUTOFF = 219, so `migrate-d1 --bootstrap` MARKS them applied
 * without running a statement of them, and their effect reaches a database
 * only if `schema_baseline.sql` already carries it — which, the baseline
 * being a dump of production taken before these landed, it does not. D187
 * hit this on a table with three definitions, D188 on eleven columns, and
 * D190 takes the six tables and the one column that were simply absent.
 *
 * WHAT THIS FILE ASSERTS, and in what order.
 *
 * 1 · SHAPE, and it is compared rather than transcribed. Each restored table
 *     is built a second time from ITS OWN DECLARING MIGRATION, read off disk,
 *     and the two `pragma_table_info` rows are deepEqual'd. So the assertion
 *     cannot drift from the migration it is about, and a re-chosen type in
 *     278 fails here rather than months later in a reader — which is D188's
 *     rule ("copy the declaring migration's shape exactly; never re-choose
 *     types") expressed as a check instead of a sentence.
 *
 * 2 · READERS DRIVEN, PAIRED. Every restore is exercised through the real
 *     code that reads it — the exported service function, or the route
 *     through Hono over a real node:sqlite database — twice: once on a build
 *     WITHOUT 278, where it must fail the way production does today, and once
 *     with it, where a satisfying row must come back. Preparability is not
 *     enough; that is D187's M6 lesson, where a restored INSERT wrote no row
 *     and its own `.catch` swallowed the constraint failure.
 *
 * `advisor_state` IS THE ONE TO WATCH, and its before-half is the sharpest
 * thing in this file. All three of its statements sit inside a bare
 * `catch {}` marked best-effort — stateMachine.ts:213-215 says so outright —
 * so today the 5-minute anti-repeat penalty and the answer counter fail
 * SILENTLY on every turn. `onAnswered` reports that as `counter_bumped`,
 * which is `false` today and `true` after 278 for the identical call. The
 * others throw, and their before-half is a 500.
 *
 * 3 · THE TWO THAT ARE NOT HERE. `referral_attributions` and
 *     `admin_publications` are the other two gaps this ledger listed, and
 *     both SELF-HEAL through a D95 runtime bootstrap, so 278 deliberately
 *     leaves them alone. That is asserted rather than trusted: each is shown
 *     absent from a fresh build and created by its own reader.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import founderRisk from '../src/routes/founder_risk.ts';
import services from '../src/routes/services.ts';
import customerChat from '../src/routes/customer_chat.ts';
import partnerPortal from '../src/routes/partner_portal.ts';
import {
  loadRecentlyAsked, markAsked, onAnswered, ANTI_REPEAT_WINDOW_MS,
} from '../src/services/advisor/stateMachine.ts';
import { loadOverrides, upsertOverride } from '../src/services/ventureRisk.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = resolve(HERE, '../sql');
const MIGRATIONS = resolve(SQL_DIR, 'migrations');
const JWT_SECRET = 'd190-test-secret-at-least-32-bytes-long!!';
const M278 = '278_sub_cutoff_restores.sql';

const migrationNames = () =>
  readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations);

/**
 * A freshly provisioned database, exactly as `migrate-d1 --bootstrap` leaves
 * one: the baseline, then every migration ABOVE the cutoff. `skip` drops one
 * by filename so the same builder produces the before-half.
 */
function freshDb(skip: string[] = []) {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(SQL_DIR, 'schema_baseline.sql'), 'utf8'));
  for (const name of migrationNames()) {
    if (migrationNumber(name) <= BASELINE_CUTOFF || skip.includes(name)) continue;
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, name), 'utf8'))) {
      try { db.exec(stmt); } catch { /* error-tolerant, as the runner is */ }
    }
  }
  return db;
}

/** The shape a table has, read from the database rather than from source. */
const shapeOf = (db: InstanceType<typeof DatabaseSync>, table: string) =>
  (db.prepare(
    `SELECT name, type, "notnull" AS nn, dflt_value AS dflt, pk FROM pragma_table_info('${table}')`,
  ).all() as any[]).map((c) => ({ name: c.name, type: c.type, nn: c.nn, dflt: c.dflt, pk: c.pk }));

/**
 * Build `table` ALONE, from the statement its declaring migration actually
 * carries. Foreign keys are off by default in node:sqlite, so a REFERENCES
 * clause needs no parent here — which is what lets one statement stand on
 * its own as the reference shape.
 *
 * NO REGEX IS BUILT FROM `table`, and that is a correction rather than a
 * style choice. The first draft did — Semgrep's detect-non-literal-regexp
 * flagged it, and the query was right about the mechanism even though these
 * names are local literals and reach no user input. The literal match it was
 * replaced with is also the STRONGER assertion: a statement must BEGIN with
 * the create, where the regex only needed it to contain the text somewhere.
 * Measured: splitStatements strips comments, and all six declarations open
 * `CREATE TABLE IF NOT EXISTS <name> (` exactly, so the interior-whitespace
 * normalisation below is the only latitude given.
 */
function shapeFromDeclaringMigration(migration: string, table: string) {
  const sql = readFileSync(resolve(MIGRATIONS, migration), 'utf8');
  const needle = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const stmts = splitStatements(sql).filter(
    (s) => s.slice(0, needle.length + 8).replace(/\s+/g, ' ').startsWith(needle),
  );
  assert.equal(stmts.length, 1,
    `expected exactly one CREATE TABLE ${table} in ${migration}, found ${stmts.length}. `
    + 'This helper is the reference shape for the restore, so an ambiguous match would '
    + 'compare against the wrong statement rather than fail.');
  const ref = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  ref.exec(stmts[0]);
  return shapeOf(ref, table);
}

function fakeKV() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    list: async () => ({ keys: [], list_complete: true }),
  };
}

const envFor = (db: InstanceType<typeof DatabaseSync>) => ({
  DB: d1Over(db), RATE_LIMITS: fakeKV(), TOKENS: fakeKV(), JWT_SECRET,
  APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
  OAUTH_CALLBACK_BASE_URL: 'https://axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
  ENVIRONMENT: 'development',
});

const tokenFor = (id: number, role: string, email: string) =>
  new SignJWT({ user_id: id, role, email })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));

/**
 * Mount one router and call it. The worker's own onError shape: an unhandled
 * throw is a 500, which is the state the before-half reproduces.
 */
function mount(db: InstanceType<typeof DatabaseSync>, base: string, router: any) {
  const env = envFor(db);
  const a = new Hono<any>();
  a.route(base, router);
  a.onError((err: any, c) => c.json({ detail: String(err?.message || err) }, 500));
  return async (path: string, token: string, init: RequestInit = {}) => {
    const res = await a.request(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...init,
    }, env);
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  };
}

/**
 * Every FK parent the seven restores reference. The D1 shim enforces foreign
 * keys, so this is not decoration: `venture_risk_overrides.project_id` and
 * `founder_risk_pulls.founder_id` both refuse a row whose parent is missing,
 * which is the constraint surviving the restore rather than being dropped.
 */
function seed(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`
    INSERT INTO users (id, email, name, role, is_active) VALUES (1, 'hq@axal.vc', 'HQ', 'admin', 1);
    INSERT INTO users (id, email, name, role, is_active) VALUES (2, 'buyer@axal.vc', 'Buyer', 'founder', 1);
    INSERT INTO founders (id, name, email) VALUES (5, 'A Founder', 'founder@axal.vc');
    INSERT INTO partners (id, name, email) VALUES (10, 'A Partner', 'partner@axal.vc');
    INSERT INTO service_offerings (id, owner_user_id, title, is_active) VALUES (7, 1, 'An Offering', 1);
    INSERT INTO projects (id, name) VALUES (1, 'A Venture');
  `);
  db.exec(`UPDATE users SET partner_id = 10 WHERE id = 2`);
}

// ── 1 · shape, compared against the declaring migration ───────────────────

const RESTORED: Array<[string, string]> = [
  ['founder_risk_pulls', '034_unmounted_routes.sql'],
  ['service_engagements', '034_unmounted_routes.sql'],
  ['advisor_state', '048_advisor_state.sql'],
  ['customer_chat_threads', '056_customer_chat_threads.sql'],
  ['customer_chat_messages', '056_customer_chat_threads.sql'],
  ['venture_risk_overrides', '114_venture_risk.sql'],
];

for (const [table, migration] of RESTORED) {
  test(`${table} exists on a fresh build after 278, in ${migration}'s exact shape`, () => {
    const after = shapeOf(freshDb(), table);
    assert.ok(after.length > 0,
      `${table} is absent from a fresh build even with 278 applied. Migration 278 is the only `
      + `thing standing between ${migration}'s declaration and every database, so if it is `
      + 'absent here it is absent in production too and its readers are still broken.');
    assert.deepEqual(after, shapeFromDeclaringMigration(migration, table),
      `${table}'s shape in 278 differs from ${migration}'s own. A restore that re-chooses a `
      + 'type, a default or a NOT NULL gives the reader a column it did not ask for — D188\'s '
      + 'rule, and the reason this compares pragma_table_info rather than source text.');

    const before = shapeOf(freshDb([M278]), table);
    assert.equal(before.length, 0,
      `${table} is on a fresh build WITHOUT 278, so this test proves nothing about 278. Either `
      + 'the baseline gained it — in which case 278\'s entry is redundant and should come out — '
      + 'or another migration now creates it and the two definitions can disagree (#183, #202).');
  });
}

test('partners.accepting_intros lands with 095\'s own column definition', () => {
  const after = shapeOf(freshDb(), 'partners').find((c) => c.name === 'accepting_intros');
  assert.ok(after, 'accepting_intros is absent from partners on a fresh build with 278 applied, '
    + 'so routes/partner_portal.ts:152 still selects a column that is not there');

  // 095's ALTER, read off disk and rebuilt as a one-column table, so the type,
  // the NOT NULL and the default are compared rather than re-typed here.
  const alter = readFileSync(resolve(MIGRATIONS, '095_partner_accepting_intros.sql'), 'utf8');
  const m = /ALTER TABLE partners ADD COLUMN\s+(.+?);/is.exec(alter);
  assert.ok(m, '095 no longer carries an ALTER TABLE partners ADD COLUMN, so this comparison '
    + 'has nothing to compare against and the restore is unanchored');
  const ref = new DatabaseSync(':memory:');
  ref.exec(`CREATE TABLE probe (${m![1]})`);
  const want = shapeOf(ref, 'probe')[0];
  assert.deepEqual(
    { type: after!.type, nn: after!.nn, dflt: after!.dflt },
    { type: want.type, nn: want.nn, dflt: want.dflt },
    'accepting_intros does not match 095\'s declaration. The opt-out toggle reads it as a '
    + 'boolean with a default of 1; a restore that drops the default makes an existing partner '
    + 'read as NULL, which the toggle would render as opted OUT.');

  assert.equal(
    shapeOf(freshDb([M278]), 'partners').some((c) => c.name === 'accepting_intros'), false,
    'accepting_intros is on partners WITHOUT 278, so the before-half of this restore cannot be '
    + 'reproduced and the test asserts nothing');
});

// ── 2 · every index the five declaring migrations name ────────────────────

test('278 carries all eleven indexes, including 048\'s one on a different table', () => {
  const db = freshDb();
  const present = new Set((db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index'",
  ).all() as any[]).map((r) => r.name));

  const WANT = [
    'idx_founder_risk_pulls_founder',
    'idx_service_engagements_owner', 'idx_service_engagements_requester',
    'idx_venture_risk_overrides_project',
    'idx_cct_user', 'idx_cct_thread', 'idx_cct_msg_thread',
    'idx_advisor_state_user', 'idx_advisor_state_user_asked',
    'idx_partners_accepting_intros',
    // 048's THIRD index, and it is on `advisor_answers`, not `advisor_state`.
    // check-migration-declarations tracks tables and columns, not indexes, so
    // nothing reported this one missing — it is 048's own declaration and it
    // rides with the rest. Its table exists in the baseline with the two
    // columns it needs, which is why it can be created at all.
    'idx_advisor_answers_user_status',
  ];
  for (const name of WANT) {
    assert.ok(present.has(name),
      `${name} is absent from a fresh build. Every index here is declared by one of the five `
      + 'sub-cutoff migrations 278 restores; a table restored without its indexes is a restore '
      + 'that changes the reader\'s cost rather than only its correctness.');
  }

  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM pragma_index_info('idx_advisor_answers_user_status')")
      .get() as any).n, 2,
    'idx_advisor_answers_user_status is not the two-column index 048 declares on '
    + '(user_id, saved_status)');
});

// ── 3 · the readers, driven, paired ───────────────────────────────────────

test('advisor_state: the anti-repeat penalty and the answer counter FAIL SILENTLY without 278', async () => {
  const db = freshDb([M278]);
  seed(db);
  const env = envFor(db) as any;

  // markAsked and loadRecentlyAsked swallow their own D1 errors by design, so
  // the before-half is not a throw — it is a lie told quietly.
  await markAsked(env, 1, 'q.pain');
  const asked = await loadRecentlyAsked(env, 1, Date.now() - ANTI_REPEAT_WINDOW_MS);
  assert.equal(asked.size, 0,
    'loadRecentlyAsked returned rows on a build without advisor_state, so the before-half of '
    + 'this defect cannot be reproduced and the pairing proves nothing');

  const out = await onAnswered(env, 1, { id: 'q.pain' } as any, 'a value', 1);
  assert.equal(out.counter_bumped, false,
    'onAnswered reported counter_bumped WITHOUT advisor_state. That flag is the only signal '
    + 'the bump ever landed, and its being false today is the whole reason this failure went '
    + 'unnoticed — if it is true here the fixture is not reproducing production.');
});

test('advisor_state: after 278 the same three calls record, and read back', async () => {
  const db = freshDb();
  seed(db);
  const env = envFor(db) as any;

  await markAsked(env, 1, 'q.pain');
  const asked = await loadRecentlyAsked(env, 1, Date.now() - ANTI_REPEAT_WINDOW_MS);
  assert.equal(asked.size, 1,
    'loadRecentlyAsked found no row after markAsked wrote one. The 5-minute anti-repeat penalty '
    + 'reads exactly this, so the advisor would re-serve a question it had just asked.');
  assert.ok(asked.has('q.pain'),
    'the row that came back is not keyed by the question that was asked, so the penalty would '
    + 'be applied to the wrong question');

  const out = await onAnswered(env, 1, { id: 'q.pain' } as any, 'a value', 1);
  assert.equal(out.counter_bumped, true,
    'onAnswered still reports counter_bumped false with advisor_state present — the INSERT is '
    + 'failing for a second reason and its catch is hiding that too');
  const row = db.prepare(
    "SELECT answer_count FROM advisor_state WHERE user_id = 1 AND question_id = 'q.pain'",
  ).get() as any;
  assert.equal(row?.answer_count, 1,
    'counter_bumped was reported true and no row carries the count. That is D187\'s M6 exactly: '
    + 'a statement that reports success and writes nothing.');
});

test('venture_risk_overrides: an analyst override cannot be stored without 278, and can with it', async () => {
  const dbBefore = freshDb([M278]);
  seed(dbBefore);
  const before = envFor(dbBefore) as any;
  await assert.rejects(
    () => upsertOverride(before, 1, 'founder' as any, { analyst_score: 40 }, 1),
    /no such table/i,
    'upsertOverride did not throw on a build without venture_risk_overrides. The route that '
    + 'calls it has no catch, so today this is a 500 — if it succeeds here the fixture is wrong.');

  const db = freshDb();
  seed(db);
  const env = envFor(db) as any;
  await upsertOverride(env, 1, 'founder' as any, {
    analyst_score: 40, analyst_band: 'medium', analyst_note: 'thin bench', status: 'open',
  }, 1);
  const got = await loadOverrides(env, 1);
  assert.equal(got.size, 1, 'loadOverrides returned nothing after upsertOverride wrote a row, '
    + 'so the computed value would still win and the analyst\'s judgement is discarded');
  assert.equal(got.get('founder' as any)?.analyst_score, 40,
    'the override came back without the score it was stored with');

  // The UNIQUE(project_id, layer_key) the upsert binds ON CONFLICT to.
  await upsertOverride(env, 1, 'founder' as any, { analyst_score: 55 }, 1);
  const again = await loadOverrides(env, 1);
  assert.equal(again.size, 1,
    're-upserting the same (project, layer) produced a second row, so UNIQUE (project_id, '
    + 'layer_key) did not survive the restore and every edit would append instead of replace');
  assert.equal(again.get('founder' as any)?.analyst_score, 55,
    'the second upsert did not replace the first, so ON CONFLICT bound to nothing');
});

test('founder_risk_pulls: recording a pull 500s without 278, and round-trips with it', async () => {
  const dbBefore = freshDb([M278]);
  seed(dbBefore);
  const tok = await tokenFor(1, 'admin', 'hq@axal.vc');
  const before = mount(dbBefore, '/api/founder-risk', founderRisk);
  const b = await before('/5/pull', tok, { method: 'POST', body: JSON.stringify({ score: 0.4 }) });
  assert.equal(b.status, 500,
    'recording a founder risk pull did not 500 without founder_risk_pulls. The INSERT is '
    + 'unguarded, so that is the production state this restore fixes.');

  const db = freshDb();
  seed(db);
  const call = mount(db, '/api/founder-risk', founderRisk);
  const w = await call('/5/pull', tok, {
    method: 'POST', body: JSON.stringify({ score: 0.4, signals: ['thin runway'], source: 'manual' }),
  });
  assert.equal(w.status, 200, `recording a pull failed with 278 applied: ${JSON.stringify(w.body)}`);
  const r = await call('/by-founder/5', tok, {});
  assert.equal(r.status, 200, 'reading the latest pull failed after one was recorded');
  assert.equal(r.body?.score, 0.4,
    'the pull that came back does not carry the score that was written, so the write landed '
    + 'somewhere the read does not look');
  assert.deepEqual(r.body?.signals, ['thin runway'],
    'signals_json did not round-trip, so the column the reader parses is not the column the '
    + 'writer filled');
});

test('service_engagements: an offering\'s sold count errors without 278, and counts with it', async () => {
  const tok = await tokenFor(2, 'founder', 'buyer@axal.vc');

  const dbBefore = freshDb([M278]);
  seed(dbBefore);
  const before = mount(dbBefore, '/api/services', services);
  const b = await before('/offerings', tok, {});
  assert.equal(b.status, 500,
    'listing offerings did not 500 without service_engagements. routes/services.ts:132 counts '
    + 'engagements in a correlated subquery, so an offering list is unreadable today — if this '
    + 'passes, the count has been removed and this restore is about something else.');

  const db = freshDb();
  seed(db);
  const call = mount(db, '/api/services', services);
  const e = await call('/offerings/7/engage', tok, {
    method: 'POST', body: JSON.stringify({ note: 'interested' }),
  });
  assert.equal(e.status, 200, `engaging an offering failed with 278 applied: ${JSON.stringify(e.body)}`);
  assert.ok(e.body?.uid, 'the engagement came back with no uid, so the DEFAULT on `uid` did not '
    + 'survive the restore');

  const list = await call('/offerings', tok, {});
  assert.equal(list.status, 200, 'listing offerings failed after an engagement was recorded');
  const row = (list.body?.items || []).find((o: any) => o.id === 7);
  assert.ok(row, 'the offering that was engaged is not in the list at all');
  assert.equal(Number(row.sold), 1,
    'the offering reports a sold count that does not include the engagement just written — a '
    + 'correlated count over a table the write did not reach');
});

test('customer chat: sending 500s without 278; with it the thread and its message read back', async () => {
  const tok = await tokenFor(1, 'admin', 'hq@axal.vc');

  const dbBefore = freshDb([M278]);
  seed(dbBefore);
  const before = mount(dbBefore, '/api/customer-chat', customerChat);
  const b = await before('/send', tok, { method: 'POST', body: JSON.stringify({ text: 'hello' }) });
  assert.equal(b.status, 500,
    'sending a customer-chat message did not 500 without customer_chat_threads. The handler '
    + 'persists "no matter what" precisely so the user\'s intent is never lost, and with no '
    + 'table that write throws.');

  const db = freshDb();
  seed(db);
  const call = mount(db, '/api/customer-chat', customerChat);
  const s = await call('/send', tok, { method: 'POST', body: JSON.stringify({ text: 'hello' }) });
  assert.ok(s.status === 200 || s.status === 202,
    `sending failed with 278 applied: ${s.status} ${JSON.stringify(s.body)}`);
  assert.ok(s.body?.thread_id,
    'the send reported no thread_id, so the thread INSERT wrote no row the message could hang '
    + 'off — the shape D187\'s M6 escaped through');

  const t = await call('/thread', tok, {});
  assert.equal(t.status, 200, 'reading the thread failed after a message was sent');
  assert.ok(t.body?.thread, 'no open thread came back, so the two tables do not agree on which '
    + 'row is current');
  assert.equal(t.body?.messages?.length, 1,
    'the thread came back with no messages. The two tables stand or fall together, and a thread '
    + 'whose message is missing is the join being broken rather than the table.');
  assert.equal(t.body?.messages?.[0]?.body, 'hello',
    'the message that came back is not the one that was sent');
});

test('partners.accepting_intros: the opt-out toggle 500s without 278, and stores with it', async () => {
  const tok = await tokenFor(2, 'founder', 'buyer@axal.vc');

  const dbBefore = freshDb([M278]);
  seed(dbBefore);
  const before = mount(dbBefore, '/api/partner-portal', partnerPortal);
  const b = await before('/accepting-intros', tok, {
    method: 'PATCH', body: JSON.stringify({ accepting_intros: false }),
  });
  assert.equal(b.status, 500,
    'the intro opt-out did not 500 without partners.accepting_intros. Its UPDATE names the '
    + 'column directly, so this is a throw rather than one of the silent cases.');

  const db = freshDb();
  seed(db);
  const call = mount(db, '/api/partner-portal', partnerPortal);
  const off = await call('/accepting-intros', tok, {
    method: 'PATCH', body: JSON.stringify({ accepting_intros: false }),
  });
  assert.equal(off.status, 200, `the opt-out failed with 278 applied: ${JSON.stringify(off.body)}`);
  assert.equal(off.body?.accepting_intros, 0,
    'the toggle reported a value other than the one it was set to. It reads back through '
    + 'RETURNING, so a mismatch means the UPDATE matched no row.');
  assert.equal(
    (db.prepare('SELECT accepting_intros FROM partners WHERE id = 10').get() as any)
      ?.accepting_intros, 0,
    'the partner row still accepts intros after the toggle was turned off, so the write landed '
    + 'nowhere while the response said it had');

  const on = await call('/accepting-intros', tok, {
    method: 'PATCH', body: JSON.stringify({ accepting_intros: true }),
  });
  assert.equal(on.body?.accepting_intros, 1, 'the toggle cannot be turned back on');
});

// ── 4 · the two this migration deliberately leaves alone ──────────────────

test('referral_attributions and admin_publications SELF-HEAL, which is why 278 skips them', async () => {
  const db = freshDb();
  const has = (t: string) => (db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(t) as any).n === 1;

  assert.equal(has('referral_attributions'), false,
    'referral_attributions is on a fresh build. Its ledger entry says a fresh build lacks it, '
    + 'and that entry is what keeps the gap visible — if the build gained it, the entry is '
    + 'stale and the guard will say so.');
  assert.equal(has('admin_publications'), false,
    'admin_publications is on a fresh build, so its ledger entry is stale');

  const env = envFor(db) as any;
  const { ensureAttributionSchema } = await import('../src/services/referralAttribution.ts');
  await ensureAttributionSchema(env);
  assert.equal(has('referral_attributions'), true,
    'ensureAttributionSchema did not create the table. The ledger entry\'s correction rests on '
    + 'this bootstrap working; if it does not, referral attribution really does record nothing '
    + 'and belongs in a migration after all.');

  // admin_publications' bootstrap is module-private, so it is driven through a
  // handler — which is the honest test anyway: what matters is that a READER
  // creates it, not that a helper can.
  const tok = await tokenFor(1, 'admin', 'hq@axal.vc');
  seed(db);
  const { default: adminPublications } = await import('../src/routes/admin_publications.ts');
  const call = mount(db, '/api/admin/publications', adminPublications);
  const listed = await call('', tok, {});
  assert.equal(listed.status, 200,
    `the publications list did not answer 200 (${listed.status}: ${JSON.stringify(listed.body)}). `
    + 'This test is about whether a READER creates the table, so a gate or a routing miss has to '
    + 'fail as itself rather than read as a bootstrap that did not run.');
  assert.equal(has('admin_publications'), true,
    'a reader ran and admin_publications still does not exist. Its ledger entry says the table '
    + 'self-heals through ensureSchema, awaited by all six handlers; if that is false the entry '
    + 'is wrong a second time and the table needs a migration.');
});
