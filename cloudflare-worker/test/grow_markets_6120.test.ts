/**
 * D6120 (#6120, Grow v2 Markets) — what the Markets page reads beside the scores.
 *
 *   1  The list read (`GET /api/cycles/grow/modules/market-expansion`): each row's attached country and region,
 *      its entry steps (all, open, overdue: due before today and not done) and its localisation checks (done,
 *      and the keys still open in order); `parts.state_counts` counts every market whatever the filter;
 *      `parts.can_write` is the viewer's; unscored markets still sort after scored ones.
 *   2  A failed replies read is `replies: null` with `parts.replies_state: 'unreadable'`, never an empty list;
 *      a failed plan read leaves the counts null with `plan_state: 'unreadable'`, never zeros.
 *   3  The record read's `parts.market`: the four scores with their sources, readiness, the decision and its day,
 *      the country, the size, the steps with due and done days, the localisation checks and the replies; a
 *      failed replies read there is `replies: null`, `replies_state: 'unreadable'`.
 *
 * Mutation checked (each broke a test below, then was restored): the overdue test `<` → `<=` (1); marketRepliesRead
 *   returning the empty map on failure (2); `can_write: writer` → `true` (1); the record's `replies_state` always 'ok' (3);
 *   a failed plan read's `localisation_open` → `[]` (2).
 *
 * Every name and value is made up. The database is the baseline plus every migration, in memory.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_markets_6120.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'grow', 'markets', '6120'].join('-');
const FOUNDER = 10, ADVISOR = 12;
const A = 1;
const PEOPLE: Array<[number, string, string]> = [[FOUNDER, 'founder', 'Ana Wren'], [ADVISOR, 'founder', 'Dee Advisor']];
const OLD = '2026-01-01 00:00:00';
const TODAY = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, role, name] of PEOPLE) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, name, `f${id}@example.test`);
    db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, role, name, `u${id}@example.test`, id);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  db.exec(`INSERT OR IGNORE INTO research_countries (code, name, region) VALUES ('PT', 'Portugal', 'Europe')`);
  db.exec(`INSERT INTO markets (id, uid, project_id, name, state, demand_score, demand_source, regulation_score, regulation_source,
      partners_score, partners_source, cost_score, cost_source, decision, decided_on, geography_ref, size_cents, size_currency, size_source, created_by) VALUES
    (1, 'mka1', ${A}, 'Portugal', 'entering', 8, 'Twelve calls', 0, 'Licence memo', 6, 'Two resellers', 7, 'Budget v3', 'enter', '2026-10-02', 'PT', 420000000, 'EUR', 'Analyst note', ${FOUNDER}),
    (2, 'mka2', ${A}, 'Spain', 'considering', 7, 'Interviews', NULL, NULL, 5, 'One reseller', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${FOUNDER}),
    (3, 'mka3', ${A}, 'Chile', 'considering', 5, 'Survey', 8, 'Memo', 4, 'Talks', 6, 'Budget', 'not_yet', '2026-10-20', NULL, NULL, NULL, NULL, ${FOUNDER})`);
  db.exec(`INSERT INTO market_entry_steps (id, uid, market_id, text, owner_name, due_on, done_at, created_at, updated_at) VALUES
    (1, 'st1', 1, 'Register the company', 'Ana', '${day(-4)}', NULL, '${OLD}', '${OLD}'),
    (2, 'st2', 1, 'Open a bank account', NULL, '${day(-10)}', '2026-10-01T09:00:00.000Z', '${OLD}', '${OLD}'),
    (3, 'st3', 1, 'Hire a country lead', NULL, NULL, NULL, '${OLD}', '${OLD}'),
    (4, 'st4', 1, 'Price the entity', NULL, '${TODAY}', NULL, '${OLD}', '${OLD}')`);
  db.exec(`INSERT INTO market_localisation (uid, market_id, key, done_at) VALUES ('lo1', 1, 'language', '2026-11-12T16:20:00.000Z'), ('lo2', 1, 'payments', NULL)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, path: string, who = FOUNDER) {
  const role = PEOPLE.find(([id]) => id === who)?.[1] ?? 'founder';
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}` } },
      { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const list = (db: DatabaseSync, q = '', who = FOUNDER) => call(db, `/api/cycles/grow/modules/market-expansion?project=${A}${q}`, who);
const rec = (db: DatabaseSync, uid = 'mka1', who = FOUNDER) => call(db, `/api/cycles/grow/modules/market-expansion/records/${uid}?project=${A}`, who);
const byName = (r: any) => Object.fromEntries(r.body.records.rows.map((x: any) => [x.name, x]));

test('1: the list read carries the country, the plan counts, the state counts over every market, and the viewer', async () => {
  const db = fixture();
  const r = await list(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Readiness first, unscored last, never as a zero.
  assert.deepEqual(r.body.records.rows.map((x: any) => [x.name, x.readiness]), [['Chile', 23], ['Portugal', 21], ['Spain', null]]);
  const m = byName(r);
  assert.equal(m.Portugal.country_name, 'Portugal');
  assert.equal(m.Portugal.country_region, 'Europe');
  assert.equal(m.Spain.country_name, null);
  // Four steps: one done, three open, one overdue (due before today); due today is not overdue, nor is an undated one.
  assert.deepEqual([m.Portugal.steps_total, m.Portugal.steps_open, m.Portugal.steps_overdue], [4, 3, 1]);
  assert.deepEqual([m.Portugal.localisation_done, m.Portugal.localisation_open], [1, ['payments', 'legal_entity']]);
  // A market with no step and no check is a measured zero, with every check open.
  assert.deepEqual([m.Spain.steps_total, m.Spain.steps_open, m.Spain.steps_overdue, m.Spain.localisation_done], [0, 0, 0, 0]);
  assert.deepEqual(m.Spain.localisation_open, ['language', 'payments', 'legal_entity']);
  assert.deepEqual(r.body.parts.state_counts, { considering: 2, entering: 1, served: 0, not_now: 0 });
  assert.equal(r.body.parts.can_write, true);
  assert.equal(r.body.parts.replies_state, 'ok');
  assert.equal(r.body.parts.plan_state, 'ok');
  assert.deepEqual(m.Portugal.replies, []);
  // The chips count every market, whatever the filter narrows the rows to.
  const filtered = await list(db, '&filter=state:entering');
  assert.deepEqual(filtered.body.records.rows.map((x: any) => x.name), ['Portugal']);
  assert.deepEqual(filtered.body.parts.state_counts, { considering: 2, entering: 1, served: 0, not_now: 0 });
  // An advisor reads the same list, as a reader.
  const advisor = await list(db, '', ADVISOR);
  assert.equal(advisor.status, 200);
  assert.equal(advisor.body.parts.can_write, false);
});

test('2: a failed replies read or plan read says so, never an empty list or a zero', async () => {
  const db = fixture();
  db.exec('DROP TABLE update_ask_replies');
  db.exec('DROP TABLE market_localisation');
  const r = await list(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = byName(r);
  assert.equal(m.Portugal.replies, null);
  assert.equal(r.body.parts.replies_state, 'unreadable');
  assert.equal(r.body.parts.plan_state, 'unreadable');
  for (const k of ['steps_total', 'steps_open', 'steps_overdue', 'localisation_done', 'localisation_open']) assert.equal(m.Portugal[k], null, k);
  // The scores still read.
  assert.equal(m.Portugal.readiness, 21);
});

test('3: the record read carries the market as stored, each store on its own', async () => {
  const db = fixture();
  const r = await rec(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = r.body.parts.market;
  assert.deepEqual(m.scores.map((s: any) => [s.key, s.score, s.source]),
    [['demand', 8, 'Twelve calls'], ['regulation', 0, 'Licence memo'], ['partners', 6, 'Two resellers'], ['cost', 7, 'Budget v3']]);
  assert.equal(m.readiness, 21);
  assert.deepEqual([m.state, m.decision, m.decided_on], ['entering', 'enter', '2026-10-02']);
  assert.deepEqual(m.country, { code: 'PT', name: 'Portugal', region: 'Europe' });
  assert.equal(m.country_state, 'ok');
  assert.deepEqual(m.size, { cents: 420000000, currency: 'EUR', source: 'Analyst note' });
  assert.equal(m.steps_total, 4);
  assert.equal(m.steps_state, 'ok');
  assert.deepEqual(m.steps.find((s: any) => s.uid === 'st1'), { uid: 'st1', text: 'Register the company', owner_name: 'Ana', due_on: day(-4), done_at: null });
  assert.deepEqual(m.localisation.map((l: any) => [l.key, !!l.done_at]), [['language', true], ['payments', false], ['legal_entity', false]]);
  assert.deepEqual(m.replies, []);
  assert.equal(m.replies_state, 'ok');

  const spain = (await rec(db, 'mka2')).body.parts.market;
  assert.equal(spain.readiness, null);
  assert.deepEqual(spain.missing, ['Regulation', 'Cost to enter']);
  assert.equal(spain.country, null);
  assert.equal(spain.country_state, 'none');
  assert.equal(spain.size, null);
  assert.deepEqual(spain.steps, []);

  db.exec('DROP TABLE update_ask_replies');
  const failed = (await rec(db)).body.parts.market;
  assert.equal(failed.replies, null);
  assert.equal(failed.replies_state, 'unreadable');
  assert.equal(failed.steps_state, 'ok', 'the other stores still read');
});
