/**
 * #3740 part 2a — Ask on three founder Add forms whose rows have an id and a
 * project: Build › Product roadmap's item (its words, `roadmap_okrs.objective`),
 * Raise › Capital relationships' investor (its notes) and Grow › Team
 * expansion's role (its title). Composition only. On the migrated schema,
 * synthetic rows only; the model is stubbed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_founder_part2a_3740.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills, { ROW_READS } from '../src/routes/fills.ts';
import { ROW_REQUIRED, railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems, offeredToEadwyn } from '../src/services/fills/fields.ts';
import { EXISTING_READS } from '../src/services/fills/formRun.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const JWT_SECRET = 'synthetic-part2a-3740-only-not-a-real-credential'.repeat(2);
test.after(() => removeMigratedDatabases());

const ROADMAP = 'Founder · Build · Product roadmap';
const CAPITAL = 'Founder · Raise · Capital relationships';
const TEAM = 'Founder · Grow · Team expansion';
const FORMS: Array<[string, string, string, string, string]> = [
  [ROADMAP, 'item', 'title', 'roadmap_okrs', 'objective'],
  [CAPITAL, 'investor', 'notes', 'raise_prospects', 'notes'],
  [TEAM, 'role', 'title', 'job_postings', 'title'],
];

type Run = (env: any, input: any) => Promise<any>;
const answer = (output: unknown): Run => async () => ({
  ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 },
});
const freeQuote = async () => ({ ok: true, hold_microusd: 1200, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }) as any;

function fixture(run: Run = answer({ fields: [] })) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',202,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (701,'v-acme','Acme Field',101),(702,'v-theirs','Theirs',202);
    INSERT INTO roadmap_okrs(id,project_id,objective) VALUES (81,701,'Ship booking'),(82,702,'Theirs');
    INSERT INTO raise_prospects(id,uid,project_id,name,notes) VALUES (91,'p-1',701,'Northwind Seed',NULL),(92,'p-2',702,'Their fund',NULL);
    INSERT INTO job_postings(id,slug,title,project_id) VALUES (95,'role-1','Founding engineer',701),(96,'role-2','Their role',702);
  `);
  const env: any = { JWT_SECRET: JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote: freeQuote }));
  app.route('/api/fills', fills);
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const runForm = async (page: string, form: string, body: Record<string, unknown>) => {
    const r = await call(11, 'POST', '/api/ai/rail/run', { page, option: `form:${form}`, project: 701, ...body });
    const events = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: events.find((e) => e.event === 'done')?.data };
  };
  return { db, env, call, runForm };
}

test('the registry: one composition field per form, both copies, every read and undo named; no rows offered', () => {
  // Mutation checked: dropping a ROW_READS, EXISTING_READS or UNDO_WRITES entry turns this red.
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)), 'the two copies agree');
  const db = migratedDatabase();
  for (const [page, form, field, table, column] of FORMS) {
    const fs = fieldsOf(page, form);
    assert.deepEqual(fs.map((f) => [f.field, f.table, f.column, f.class]), [[field, table, column, 'composition']]);
    assert.ok(offeredToEadwyn(fs[0]));
    assert.ok(ROW_READS[table] && EXISTING_READS[table] && UNDO_WRITES[`${table}.${column}`], `${table}: its reads and its undo`);
    assert.ok(!Object.hasOwn(ROW_REQUIRED, table), 'an Add form here offers no "add several rows"');
    // Every statement names columns the migrated schema has.
    for (const sql of [ROW_READS[table], EXISTING_READS[table], UNDO_WRITES[`${table}.${column}`].read]) assert.doesNotThrow(() => db.prepare(sql), sql);
    assert.doesNotThrow(() => db.prepare(UNDO_WRITES[`${table}.${column}`].write.replace('(SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', '1')));
  }
  assert.equal(UNDO_WRITES['roadmap_okrs.objective'].required, true, 'an item is never left without its words');
  assert.equal(UNDO_WRITES['job_postings.title'].required, true);
  assert.equal(UNDO_WRITES['raise_prospects.notes'].required, false);
});

test('an Add form proposes its one field; an Edit reads the venture\'s own row, and only its blank field', async () => {
  // Mutation checked: ROW_READS without `AND project_id = ?` lets another venture's prospect be read.
  const f = fixture(answer({ fields: [{ field: 'title', value: 'Self-serve booking' }, { field: 'notes', value: 'Met at a demo day; leads seed rounds in field ops.' }, { field: 'target_date', value: '2027-01-01' }] }));
  const add = await f.runForm(ROADMAP, 'item', {});
  assert.equal(add.status, 200, add.text);
  assert.deepEqual(add.done.proposals.map((p: any) => [p.field, p.value]), [['title', 'Self-serve booking']]);
  assert.ok(add.done.dropped.some((d: any) => d.field === 'target_date'), 'a date is never proposed');
  const edit = await f.runForm(CAPITAL, 'investor', { record: { type: 'raise_prospects', id: 91 } });
  assert.equal(edit.status, 200, edit.text);
  assert.deepEqual(edit.done.proposals.map((p: any) => p.field), ['notes']);
  assert.equal((f.db.prepare('SELECT notes FROM raise_prospects WHERE id = 91').get() as any).notes, null, 'the run writes nothing');
  assert.equal((await f.runForm(CAPITAL, 'investor', { record: { type: 'raise_prospects', id: 92 } })).status, 404, 'another venture\'s prospect');
  assert.equal((await f.runForm(TEAM, 'role', { record: { type: 'job_postings', id: 96 } })).status, 404, 'another venture\'s role');
  // A role whose title is typed has nothing to ask.
  assert.equal((await f.runForm(TEAM, 'role', { record: { type: 'job_postings', id: 95 } })).status, 400);
  const sheet = await f.call(11, 'GET', `/api/fills/sheet?page=${encodeURIComponent(CAPITAL)}&form=investor&project=701&record=91`);
  assert.equal(sheet.status, 200, sheet.text);
  assert.equal((await f.call(11, 'GET', `/api/fills/sheet?page=${encodeURIComponent(CAPITAL)}&form=investor&project=701&record=92`)).status, 404);
});
