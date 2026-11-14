/**
 * D6113 (#6113) — a market's entry plan can be worked, not only added to.
 *
 *   1  The read: each step names its uid; its own action is Mark done (Open)
 *      or Reopen (Done); its further actions are Edit, carrying that step's
 *      values, and Remove, declared with a confirmation and a danger tone.
 *      A reader who is not a writer gets no row action. "Next" keeps the
 *      step's body, so its CTA runs on that step.
 *   2  Mark done and Reopen: done_at set (kept on a second Mark done) and
 *      cleared, each logged on the market.
 *   3  Edit: only the sent keys change, a blank step is refused, logged.
 *   4  Remove: declared behind a confirmation, deletes the one step, logged.
 *   5  Refusals: a step of another venture's market, a step of this
 *      venture's other market, and no step at all are each a 404 that writes
 *      nothing and logs nothing; `ownedRow` resolves a step within its venture.
 *
 * Every name and value is made up. The database is the baseline plus every
 * migration, in memory, through `_schema_once.mjs`.
 *
 * Mutation checked (each broke a test below, then was restored):
 *   · grow.ts row reads `s.done_at ? 'reopen-entry-step' : 'mark-entry-step-done'` swapped → test 1 fails.
 *   · owned.ts `market_entry_steps` without `AND m.project_id = ?` → test 5 fails (venture B's step is A's).
 *     (`stepRef` returning [] survives: the writer's own market check refuses the same steps, by design.)
 *   · growWriters.ts `entryStep` without `AND m.uid = ?` (bound to the venture only) → test 5 fails
 *     (the other market's step is changed).
 *   · growWriters.ts `s.done_at ?? nowIso()` → `nowIso()` → test 2 fails (first done day not kept).
 *   · growWriters.ts `has(b, 'owner_name') ? … : s.owner_name` → always `str(b.owner_name, 120)` → test 3 fails.
 *   · growWriters.ts removeEntryStep's logCycleWriteStatement dropped from the batch → test 4 fails.
 *   · grow.ts remove-entry-step without `confirm` → test 4 fails.
 *   · grow.ts `rowOnly: true` dropped from edit-entry-step → test 1 fails.
 *   · cycle_records.ts strip of `actions` for non-writers removed → test 1 fails.
 *   · cycle_records.ts nextFor returning only the key → test 1 fails.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/market_entry_steps_6113.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { ownedRow } from '../src/services/records/owned.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'entry', 'steps', '6113'].join('-');
const FOUNDER = 10, OTHER_FOUNDER = 20, ADVISOR = 12;
const A = 1, B = 2;
const PEOPLE: Array<[number, string, string]> = [[FOUNDER, 'founder', 'Ana Wren'], [OTHER_FOUNDER, 'founder', 'Ola Kestrel'], [ADVISOR, 'founder', 'Dee Advisor']];
const OLD = '2026-01-01 00:00:00';

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, role, name] of PEOPLE) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, name, `f${id}@example.test`);
    db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, role, name, `u${id}@example.test`, id);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Kestrel Mill', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  db.exec(`INSERT INTO markets (id, uid, project_id, name, created_by) VALUES
    (1, 'mka1', ${A}, 'Portugal', ${FOUNDER}), (2, 'mka2', ${A}, 'Spain', ${FOUNDER}), (3, 'mkb1', ${B}, 'Chile', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO market_entry_steps (id, uid, market_id, text, owner_name, due_on, done_at, created_at, updated_at) VALUES
    (1, 'stepa1', 1, 'Register the company', 'Ana', '2027-01-15', NULL, '${OLD}', '${OLD}'),
    (2, 'stepa2', 1, 'Open a bank account', NULL, '2027-02-01', '2026-10-01T09:00:00.000Z', '${OLD}', '${OLD}'),
    (3, 'stepa3', 2, 'Hire a local lawyer', NULL, NULL, NULL, '${OLD}', '${OLD}'),
    (4, 'stepb1', 3, 'Translate the site', NULL, NULL, NULL, '${OLD}', '${OLD}')`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, method: string, path: string, who = FOUNDER, body?: unknown) {
  const role = PEOPLE.find(([id]) => id === who)?.[1] ?? 'founder';
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const rec = (db: DatabaseSync, market = 'mka1', who = FOUNDER) =>
  call(db, 'GET', `/api/cycles/grow/modules/market-expansion/records/${market}?project=${A}`, who);
const act = (db: DatabaseSync, key: string, body: unknown, market = 'mka1', who = FOUNDER) =>
  call(db, 'POST', `/api/cycles/grow/modules/market-expansion/records/${market}/actions/${key}?project=${A}`, who, body);

const step = (db: DatabaseSync, uid: string) => db.prepare('SELECT text, owner_name, due_on, done_at, updated_at FROM market_entry_steps WHERE uid = ?').get(uid) as any;
const logs = (db: DatabaseSync) => (db.prepare(
  "SELECT action, entity_type, entity_id, project_id, details FROM activity_logs WHERE action LIKE 'grow_entry_step_%' ORDER BY id",
).all() as any[]).map((r) => ({ ...r }));
const plan = (r: any) => r.body.main.find((s: any) => s.key === 'entry-plan');

test('1: each step names its uid, with Mark done or Reopen, Edit with its own values, and Remove', async () => {
  const db = fixture();
  const r = await rec(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rows = plan(r).rows;
  assert.deepEqual(rows.map((x: any) => [x.a, x.c]), [['Register the company', 'Open'], ['Open a bank account', 'Done']]);
  assert.deepEqual(rows[0].action, { key: 'mark-entry-step-done', body: { step: 'stepa1' } });
  assert.deepEqual(rows[1].action, { key: 'reopen-entry-step', body: { step: 'stepa2' } });
  assert.deepEqual(rows[0].actions, [
    { key: 'edit-entry-step', body: { step: 'stepa1' }, values: { text: 'Register the company', owner_name: 'Ana', due_on: '2027-01-15' } },
    { key: 'remove-entry-step', body: { step: 'stepa1' } },
  ]);
  assert.deepEqual(rows[1].actions[0].values, { text: 'Open a bank account', owner_name: '', due_on: '2027-02-01' });
  const declared = Object.fromEntries(r.body.actions.map((a: any) => [a.key, a]));
  assert.equal(declared['mark-entry-step-done'].label, 'Mark done');
  assert.equal(declared['reopen-entry-step'].label, 'Reopen');
  assert.equal(declared['edit-entry-step'].kind, 'form');
  assert.deepEqual(declared['edit-entry-step'].form.fields.map((f: any) => f.key), ['text', 'owner_name', 'due_on']);
  assert.equal(declared['remove-entry-step'].tone, 'danger');
  assert.equal(declared['edit'].form.title, 'Edit market', 'the record\'s own Edit is unchanged');
  // The step's actions run only from its row, so the record's own actions row never draws them.
  for (const k of ['mark-entry-step-done', 'reopen-entry-step', 'edit-entry-step', 'remove-entry-step']) assert.equal(declared[k].rowOnly, true, k);
  assert.equal(declared['edit'].rowOnly, undefined);
  // The open step is next, and its CTA keeps the step it runs on.
  assert.deepEqual(r.body.next, { text: 'Register the company · Ana · 15 Jan', action: { key: 'mark-entry-step-done', body: { step: 'stepa1' } } });
  // An advisor reads the plan with no action on any row.
  const advisor = await rec(db, 'mka1', ADVISOR);
  assert.equal(advisor.status, 200);
  for (const row of plan(advisor).rows) assert.ok(!('action' in row) && !('actions' in row), JSON.stringify(row));
  assert.deepEqual(advisor.body.actions, []);
  // A writer's action is refused to the advisor.
  assert.equal((await act(db, 'mark-entry-step-done', { step: 'stepa1' }, 'mka1', ADVISOR)).status, 403);
  assert.equal(step(db, 'stepa1').done_at, null);
});

test('2: Mark done sets done_at and keeps its first day; Reopen clears it; each is logged on the market', async () => {
  const db = fixture();
  const done = await act(db, 'mark-entry-step-done', { step: 'stepa1' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual(done.body, { ok: true, record: { uid: 'stepa1', done: true } });
  const first = step(db, 'stepa1').done_at;
  assert.ok(first);
  assert.notEqual(step(db, 'stepa1').updated_at, OLD);
  const again = await act(db, 'mark-entry-step-done', { step: 'stepa2' });
  assert.equal(again.status, 200);
  assert.equal(step(db, 'stepa2').done_at, '2026-10-01T09:00:00.000Z', 'a step already done keeps the day it was done');
  const reopen = await act(db, 'reopen-entry-step', { step: 'stepa1' });
  assert.equal(reopen.status, 200);
  assert.deepEqual(reopen.body.record, { uid: 'stepa1', done: false });
  assert.equal(step(db, 'stepa1').done_at, null);
  assert.equal(step(db, 'stepa1').text, 'Register the company', 'a reopen changes nothing else');
  assert.deepEqual(logs(db).map((l) => [l.action, l.entity_type, l.entity_id, l.project_id]), [
    ['grow_entry_step_done', 'grow.market-expansion', 'mka1', A],
    ['grow_entry_step_done', 'grow.market-expansion', 'mka1', A],
    ['grow_entry_step_reopened', 'grow.market-expansion', 'mka1', A],
  ]);
  // Activity names what happened, never the step's text.
  for (const l of logs(db)) assert.doesNotMatch(String(l.details), /Register|bank/);
  // The record's activity reads them.
  const r = await rec(db);
  assert.ok(r.body.activity.some((a: any) => /Entry step reopened/.test(a.a)), JSON.stringify(r.body.activity));
  assert.equal(plan(r).rows[0].action.key, 'mark-entry-step-done');
});

test('3: Edit changes only the sent keys, refuses a blank step, and is logged', async () => {
  const db = fixture();
  const edit = await act(db, 'edit-entry-step', { step: 'stepa1', text: '  Register the branch  ', due_on: '2027-03-01', stray: 'x' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.deepEqual({ ...step(db, 'stepa1'), updated_at: undefined },
    { text: 'Register the branch', owner_name: 'Ana', due_on: '2027-03-01', done_at: null, updated_at: undefined });
  assert.equal((await act(db, 'edit-entry-step', { step: 'stepa1', owner_name: '' })).status, 200);
  assert.equal(step(db, 'stepa1').owner_name, null, 'an emptied owner is cleared');
  const blank = await act(db, 'edit-entry-step', { step: 'stepa1', text: '   ' });
  assert.equal(blank.status, 400);
  assert.equal(blank.body.field, 'text');
  const badDay = await act(db, 'edit-entry-step', { step: 'stepa1', due_on: '2027-02-30' });
  assert.equal(badDay.status, 400);
  assert.equal(step(db, 'stepa1').text, 'Register the branch');
  // `done` is not an Edit key: the form cannot mark a step done.
  assert.equal((await act(db, 'edit-entry-step', { step: 'stepa1', done: true })).status, 200);
  assert.equal(step(db, 'stepa1').done_at, null);
  assert.deepEqual(logs(db).map((l) => l.action), ['grow_entry_step_updated', 'grow_entry_step_updated', 'grow_entry_step_updated']);
});

test('4: Remove is declared behind a confirmation, deletes the one step, and is logged', async () => {
  const db = fixture();
  const r = await rec(db);
  const remove = r.body.actions.find((a: any) => a.key === 'remove-entry-step');
  assert.equal(remove.kind, 'write');
  assert.equal(remove.confirm.cta, 'Remove');
  assert.match(remove.confirm.title, /Remove this entry step\?/);
  const out = await act(db, 'remove-entry-step', { step: 'stepa1' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.record, { uid: 'stepa1', deleted: true });
  assert.equal(step(db, 'stepa1'), undefined);
  assert.ok(step(db, 'stepa2'), 'the other step stays');
  assert.deepEqual(logs(db).map((l) => [l.action, l.entity_id]), [['grow_entry_step_removed', 'mka1']]);
  assert.equal((await act(db, 'remove-entry-step', { step: 'stepa1' })).status, 404, 'a removed step is gone');
  assert.deepEqual(plan(await rec(db)).rows.map((x: any) => x.a), ['Open a bank account']);
});

test('5: a step of another venture\'s market, of another market, or none at all is refused and writes nothing', async () => {
  const db = fixture();
  const before = db.prepare('SELECT * FROM market_entry_steps ORDER BY id').all().map((r: any) => ({ ...r }));
  for (const key of ['mark-entry-step-done', 'reopen-entry-step', 'edit-entry-step', 'remove-entry-step']) {
    // Venture B's step, named on venture A's market.
    assert.equal((await act(db, key, { step: 'stepb1', text: 'Taken over' })).status, 404, `${key} venture B's step`);
    // Venture A's step of its other market, named on this one.
    assert.equal((await act(db, key, { step: 'stepa3', text: 'Taken over' })).status, 404, `${key} another market's step`);
    // No step, or not a string.
    assert.equal((await act(db, key, { text: 'Taken over' })).status, 404, `${key} no step`);
    assert.equal((await act(db, key, { step: 4, text: 'Taken over' })).status, 404, `${key} a numeric step`);
    // Venture B's market itself, from venture A.
    assert.equal((await act(db, key, { step: 'stepb1', text: 'Taken over' }, 'mkb1')).status, 404, `${key} venture B's market`);
  }
  assert.deepEqual(db.prepare('SELECT * FROM market_entry_steps ORDER BY id').all().map((r: any) => ({ ...r })), before);
  assert.deepEqual(logs(db), []);
  const env = { DB: d1Over(db) } as any;
  assert.equal(await ownedRow(env, 'market_entry_steps', 'stepa1', A), true);
  assert.equal(await ownedRow(env, 'market_entry_steps', 'stepb1', A), false);
  assert.equal(await ownedRow(env, 'market_entry_steps', 'stepb1', B), true);
  assert.equal(await ownedRow(env, 'market_entry_steps', 'Step A1', A), false);
});
