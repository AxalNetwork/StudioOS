/**
 * D8251 (#8251, Grow Markets, GR-24) — Eadwyn's sourced proposals on a market, decided by the founder.
 *
 *   1  A proposal is validated by its kind before it is stored (a score needs a part, 0 to 10 and a source; a plan
 *      has steps; a comparison is text; an https source only), and only for the venture's own market.
 *   2  Accept on a score writes the score and its source once, through Edit market; deciding again is a 409.
 *   3  Dismiss writes nothing, and a dismissed proposal cannot then be accepted.
 *   4  Accept on a plan adds its steps through Add entry step; a comparison writes nothing to the market.
 *   5  Nothing reaches the market without Accept: storing, listing and reading change no market field.
 *   6  A reader sees the open proposals but no actions, and is refused (403) if it posts one; another market's or
 *      venture's proposal is a 404.
 *   7  A failed write puts the proposal back so Accept can be tried again; a failed read is `proposals: null`.
 *
 * Mutation checked (each broke a test below, then was restored): the conditional claim `AND state = 'proposed'`
 *   dropped (2); Dismiss also writing the score (3); the plan branch skipped (4); the market scoping of the proposal
 *   lookup dropped (6); the revert on a failed write dropped (7); the source requirement on a score dropped (1).
 *
 * Every name and value is made up. The database is the baseline plus every migration, in memory.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_market_proposals_8251.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { recordMarketProposal } from '../src/services/growWriters.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'market', 'proposals', '8251'].join('-');
const FOUNDER = 10, ADVISOR = 12, OTHER = 13;
const A = 1, B = 2;

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, name] of [[FOUNDER, 'Ana Wren'], [ADVISOR, 'Dee Advisor'], [OTHER, 'Oli Other']] as const) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, name, `f${id}@example.test`);
    db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, 'founder', name, `u${id}@example.test`, id);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Other Venture', ${OTHER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  db.exec(`INSERT INTO markets (id, uid, project_id, name, state, regulation_score, regulation_source, created_by) VALUES
    (1, 'mkp', ${A}, 'Portugal', 'considering', 2, 'Old memo', ${FOUNDER}), (2, 'mks', ${A}, 'Spain', 'considering', NULL, NULL, ${FOUNDER}),
    (9, 'mkx', ${B}, 'Elsewhere', 'considering', NULL, NULL, ${OTHER})`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
const envOf = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }, envOf(db)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const decide = (db: DatabaseSync, market: string, key: 'accept-proposal' | 'dismiss-proposal', proposal: string, who = FOUNDER) =>
  call(db, who, 'POST', `/api/cycles/grow/modules/market-expansion/records/${market}/actions/${key}?project=${A}`, { proposal });
const record = (db: DatabaseSync, market = 'mkp', who = FOUNDER) => call(db, who, 'GET', `/api/cycles/grow/modules/market-expansion/records/${market}?project=${A}`);
const row = (db: DatabaseSync, sql: string, ...a: any[]) => ({ ...(db.prepare(sql).get(...a) as any) });
const state = (db: DatabaseSync, uid: string) => row(db, 'SELECT state FROM market_proposals WHERE uid = ?', uid).state;
const SRC = [{ label: 'Licence memo 2026', url: 'https://example.test/memo' }, { label: 'Two calls' }];
const score = (db: DatabaseSync, market = 'mkp', over: Record<string, unknown> = {}) =>
  recordMarketProposal(envOf(db), A, market, { kind: 'score', payload: { part: 'regulation', score: 6 }, sources: SRC, ...over });

test('1: a proposal is validated by its kind, and only for the venture\'s own market', async () => {
  const db = fixture(); const env = envOf(db);
  const refused = async (input: any, field: string, market = 'mkp') => {
    await assert.rejects(() => recordMarketProposal(env, A, market, input), (e: any) => e?.status === 400 && e?.field === field, JSON.stringify(input));
  };
  await refused({ kind: 'score', payload: { part: 'regulation', score: 6 }, sources: [] }, 'sources');
  await refused({ kind: 'score', payload: { part: 'weather', score: 6 }, sources: SRC }, 'part');
  await refused({ kind: 'score', payload: { part: 'demand', score: 11 }, sources: SRC }, 'score');
  await refused({ kind: 'score', payload: { part: 'demand', score: 5 }, sources: [{ label: 'x', url: 'javascript:alert(1)' }] }, 'sources');
  await refused({ kind: 'plan', payload: { steps: [] } }, 'steps');
  await refused({ kind: 'comparison', payload: { text: '  ' } }, 'text');
  await refused({ kind: 'guess', payload: {} }, 'kind');
  await assert.rejects(() => recordMarketProposal(env, A, 'mkx', { kind: 'comparison', payload: { text: 'x' } }), (e: any) => e?.status === 404);
  assert.equal(row(db, 'SELECT COUNT(*) AS n FROM market_proposals').n, 0, 'a refused proposal stores nothing');
  const ok = await recordMarketProposal(env, A, 'mkp', { kind: 'plan', payload: { steps: [{ text: 'Register the entity', due_on: '2027-02-01' }], extra: 'dropped' } });
  assert.deepEqual(JSON.parse(row(db, 'SELECT payload FROM market_proposals WHERE uid = ?', ok.uid).payload), { steps: [{ text: 'Register the entity', due_on: '2027-02-01' }] });
});

test('2: Accept on a score writes the score and source once through Edit market; a second decision is 409', async () => {
  const db = fixture(); const { uid } = await score(db);
  const before = row(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'grow_market_updated'").n;
  assert.equal((await decide(db, 'mkp', 'accept-proposal', uid)).status, 200);
  assert.deepEqual(row(db, "SELECT regulation_score AS s, regulation_source AS src FROM markets WHERE uid = 'mkp'"), { s: 6, src: 'Licence memo 2026; Two calls' });
  assert.equal(state(db, uid), 'accepted');
  assert.deepEqual(row(db, 'SELECT decided_by FROM market_proposals WHERE uid = ?', uid), { decided_by: FOUNDER });
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'grow_market_updated'").n, before + 1, 'one Market updated line, from the Edit path');
  assert.equal((await decide(db, 'mkp', 'accept-proposal', uid)).status, 409);
  assert.equal((await decide(db, 'mkp', 'dismiss-proposal', uid)).status, 409);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'grow_market_updated'").n, before + 1, 'the second decision wrote nothing');
});

test('3: Dismiss writes nothing, and a dismissed proposal cannot then be accepted', async () => {
  const db = fixture(); const { uid } = await score(db);
  assert.equal((await decide(db, 'mkp', 'dismiss-proposal', uid)).status, 200);
  assert.deepEqual(row(db, "SELECT regulation_score AS s, regulation_source AS src FROM markets WHERE uid = 'mkp'"), { s: 2, src: 'Old memo' });
  assert.equal(state(db, uid), 'dismissed');
  assert.equal((await decide(db, 'mkp', 'accept-proposal', uid)).status, 409);
  assert.equal(row(db, "SELECT regulation_score AS s FROM markets WHERE uid = 'mkp'").s, 2);
});

test('4: Accept on a plan adds its steps; a comparison writes nothing to the market', async () => {
  const db = fixture(); const env = envOf(db);
  const plan = await recordMarketProposal(env, A, 'mkp', { kind: 'plan', payload: { steps: [{ text: 'Register the entity', due_on: '2027-02-01' }, { text: 'Open a bank account' }] } });
  const cmp = await recordMarketProposal(env, A, 'mkp', { kind: 'comparison', payload: { text: 'Spain is cheaper to enter.' } });
  assert.equal((await decide(db, 'mkp', 'accept-proposal', plan.uid)).status, 200);
  assert.deepEqual((db.prepare("SELECT text, due_on FROM market_entry_steps WHERE market_id = 1 ORDER BY id").all() as any[]).map((r) => [r.text, r.due_on]), [['Register the entity', '2027-02-01'], ['Open a bank account', null]]);
  const marketBefore = JSON.stringify(row(db, "SELECT * FROM markets WHERE uid = 'mkp'"));
  assert.equal((await decide(db, 'mkp', 'accept-proposal', cmp.uid)).status, 200);
  assert.equal(state(db, cmp.uid), 'accepted');
  assert.equal(JSON.stringify(row(db, "SELECT * FROM markets WHERE uid = 'mkp'")), marketBefore, 'a comparison has no market field to write');
  assert.equal(row(db, 'SELECT COUNT(*) AS n FROM market_entry_steps').n, 2);
});

test('5: storing and reading proposals change no market field', async () => {
  const db = fixture();
  const snapshot = () => JSON.stringify(db.prepare('SELECT * FROM markets ORDER BY id').all());
  const before = snapshot();
  await score(db); await score(db, 'mkp', { payload: { part: 'demand', score: 9 } });
  const r = await record(db);
  assert.equal(r.status, 200);
  const m = r.body.parts.market;
  assert.equal(m.proposals_state, 'ok');
  assert.deepEqual(m.proposals.map((p: any) => [p.kind, p.payload.part]), [['score', 'demand'], ['score', 'regulation']], 'newest first');
  assert.deepEqual(m.proposals[0].sources, SRC.map((s) => ({ label: s.label, url: s.url ?? null })));
  assert.equal(snapshot(), before);
  assert.deepEqual((await record(db, 'mks')).body.parts.market.proposals, [], 'none proposed is an empty list');
});

test('6: a reader sees the proposals but no actions, and cannot decide; other markets\' and ventures\' proposals are 404', async () => {
  const db = fixture(); const { uid } = await score(db);
  const reader = await record(db, 'mkp', ADVISOR);
  assert.equal(reader.body.parts.market.proposals.length, 1);
  assert.ok(!reader.body.actions.some((a: any) => /proposal/.test(a.key)), 'no Accept or Dismiss for a reader');
  assert.ok((await record(db)).body.actions.some((a: any) => a.key === 'accept-proposal'));
  assert.equal((await decide(db, 'mkp', 'accept-proposal', uid, ADVISOR)).status, 403);
  assert.equal(state(db, uid), 'proposed');
  assert.equal((await decide(db, 'mks', 'accept-proposal', uid)).status, 404, 'a proposal of another market');
  assert.equal(state(db, uid), 'proposed');
  assert.equal((await decide(db, 'mkp', 'accept-proposal', 'nope')).status, 404);
});

test('7: a failed write puts the proposal back; a failed read is unreadable, never an empty list', async () => {
  const db = fixture();
  db.prepare("INSERT INTO market_proposals (uid, market_id, kind, payload, sources) VALUES ('bad', 1, 'score', ?, '[{\"label\":\"x\"}]')").run(JSON.stringify({ part: 'demand', score: 99 }));
  const r = await decide(db, 'mkp', 'accept-proposal', 'bad');
  assert.equal(r.status, 400);
  assert.equal(state(db, 'bad'), 'proposed', 'the failed Accept left it open');
  assert.equal(row(db, "SELECT demand_score AS s FROM markets WHERE uid = 'mkp'").s, null);
  db.exec('DROP TABLE market_proposals');
  const m = (await record(db)).body.parts.market;
  assert.equal(m.proposals, null); assert.equal(m.proposals_state, 'unreadable');
  assert.equal(m.replies_state, 'ok');
});
