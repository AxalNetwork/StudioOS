/**
 * D1328 (#3489, #2431 part 5), part one — the founder's forms in FILL_FIELDS:
 * Validate's New theme, New segment and New hypothesis, and Build's Add
 * must-have. Their reads, their writers for Accept all, their undo columns,
 * and the rules every form keeps: a typed value is never asked, a Save keeps
 * only what still equals the proposal, an edited field is never undone.
 *
 * On the migrated schema, synthetic rows only; the model is a stub runner.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_founder_forms_d1328.test.ts
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
import { EXISTING_READS, fieldsToAsk } from '../src/services/fills/formRun.ts';
import { FORM_ROW_WRITERS, ROW_WRITERS, UNDO_WRITES } from '../src/services/fills/keep.ts';
import { neverFillReason } from '../src/services/fills/neverFill.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const SECRET = 'synthetic-fill-forms-d1328-'.repeat(3);
test.after(() => removeMigratedDatabases());

const PROBLEM = 'Founder · Validate · Problem discovery';
const ICP = 'Founder · Validate · Ideal customer profile';
const EXPERIMENTS = 'Founder · Validate · Experiments and evidence';
const PROTOTYPE = 'Founder · Build · Prototype / MVP';
const FORMS: Array<[string, string, string]> = [[PROBLEM, 'theme', 'pain_groups'], [ICP, 'segment', 'customer_segments'], [EXPERIMENTS, 'hypothesis', 'hypotheses'], [PROTOTYPE, 'must-have', 'mvp_features']];

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
    INSERT INTO pain_groups(id,project_id,title,sort_order) VALUES (51,701,'Inspections run late',0);
    INSERT INTO hypotheses(id,project_id,code,claim,sort_order,retired_at,success_bar) VALUES (61,701,'H1','Crews will book a slot',0,NULL,NULL),(62,701,'H2','Retired claim',1,'2026-10-01',NULL),(63,702,'H1','Theirs',0,NULL,NULL);
    INSERT INTO customer_segments(id,project_id,name,name_norm,source,who_they_are) VALUES (71,701,'Site managers','site managers','manual','Typed by the founder');
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote: freeQuote }));
  app.route('/api/fills', fills);
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
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

test('the registry: the four forms in both copies, every rule held; no judgement, score or owner is listed', () => {
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)), 'the two copies agree');
  assert.deepEqual(fieldsOf(PROBLEM, 'theme').map((f) => f.field), ['title']);
  assert.deepEqual(fieldsOf(ICP, 'segment').map((f) => f.field), ['name', 'who_they_are', 'job_to_be_done', 'value_promised']);
  assert.deepEqual(fieldsOf(EXPERIMENTS, 'hypothesis').map((f) => f.field), ['claim', 'success_bar', 'disproof']);
  assert.deepEqual(fieldsOf(PROTOTYPE, 'must-have').map((f) => [f.field, f.class]), [['title', 'composition'], ['hypothesis_id', 'restatement']]);
  const listed = new Set(FILL_FIELDS.map((f) => `${f.form}.${f.field}`));
  for (const judged of ['theme.severity', 'theme.quotes', 'segment.urgency', 'segment.score_against', 'segment.score_since', 'hypothesis.direction',
    'hypothesis.pain_group_id', 'hypothesis.owner_deadline', 'must-have.state', 'must-have.owner_due', 'must-have.linked']) {
    assert.ok(!listed.has(judged), `${judged} is the founder's, never Eadwyn's`);
  }
  for (const [page, form, table] of FORMS) {
    for (const f of fieldsOf(page, form)) {
      assert.equal(f.table, table);
      assert.equal(neverFillReason(`${f.table}.${f.column}`), null, `${f.table}.${f.column}`);
      assert.ok(offeredToEadwyn(f), `${form}.${f.field} is offered`);
    }
    assert.ok(ROW_READS[table], `${table} has its literal read`);
    assert.ok(ROW_REQUIRED[table]?.length, `${table} names its required field`);
    assert.ok(EXISTING_READS[table], `${table} names what is already on file`);
    assert.ok(FORM_ROW_WRITERS[`${page} / ${form}`] || ROW_WRITERS[table], `${form} has a writer for Accept all`);
  }
  // Every composition column has its undo, except a segment's name, whose writer keeps name_norm beside it.
  const undoable = FILL_FIELDS.filter((f) => FORMS.some(([p, fo]) => p === f.page && fo === f.form)).map((f) => `${f.table}.${f.column}`);
  assert.deepEqual(undoable.filter((k) => !UNDO_WRITES[k]), ['customer_segments.name']);
});

test('a typed value is never asked or proposed; a record\'s run asks only its blank fields', async () => {
  assert.deepEqual(fieldsToAsk(fieldsOf(ICP, 'segment'), { name: 'Mine', job_to_be_done: 'Typed' }).map((f) => f.field), ['who_they_are', 'value_promised']);
  const f = fixture(answer({ fields: [{ field: 'who_they_are', value: 'Overwrite' }, { field: 'job_to_be_done', value: 'Book inspections' }, { field: 'urgency', value: 'high' }] }));
  const r = await f.runForm(ICP, 'segment', { record: { type: 'customer_segments', id: 71 }, input: { values: { value_promised: 'Typed in the open form' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.done.proposals.map((p: any) => [p.field, p.value]), [['job_to_be_done', 'Book inspections']]);
  assert.deepEqual(r.done.dropped.map((d: any) => [d.field, d.why]), [['who_they_are', 'not_asked'], ['urgency', 'unknown_field']]);
  assert.equal((f.db.prepare('SELECT who_they_are FROM customer_segments WHERE id = 71').get() as any).who_they_are, 'Typed by the founder');
  assert.equal((f.db.prepare('SELECT job_to_be_done FROM customer_segments WHERE id = 71').get() as any).job_to_be_done, null, 'the run writes nothing');
  // Another venture's record is not this venture's.
  const theirs = await f.runForm(EXPERIMENTS, 'hypothesis', { record: { type: 'hypotheses', id: 63 } });
  assert.equal(theirs.status, 404);
});

test('Accept all writes each row through its form\'s own writer, and says why a row was refused', async () => {
  const rows = { rows: [{ title: 'Paper checklists get lost' }, { title: 'Inspections run late' }] };
  let f = fixture(answer(rows));
  let r = await f.runForm(PROBLEM, 'theme', { input: { rows: 2 } });
  assert.equal(r.done.proposals.length, 2);
  let a = await f.call(11, 'POST', '/api/fills/rows/accept', { page: PROBLEM, form: 'theme', project: 701, proposals: r.done.proposals.map((p: any) => p.uid) });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.outcomes.map((o: any) => o.outcome), ['created', 'created'], 'a theme is a title; a second of the same title is the writer\'s to allow');
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM pain_groups WHERE project_id = 701 AND title = 'Paper checklists get lost'").get() as any).n, 1);
  assert.ok((f.db.prepare("SELECT COUNT(*) AS n FROM fill_provenance WHERE target_table = 'pain_groups'").get() as any).n >= 2, 'each kept value has its provenance');

  f = fixture(answer({ rows: [{ name: 'Site managers', who_they_are: 'A repeat' }, { name: 'Safety leads', job_to_be_done: 'Pass audits' }] }));
  r = await f.runForm(ICP, 'segment', { input: { rows: 2 } });
  a = await f.call(11, 'POST', '/api/fills/rows/accept', { page: ICP, form: 'segment', project: 701, proposals: r.done.proposals.map((p: any) => p.uid) });
  assert.deepEqual(a.body.outcomes.map((o: any) => [o.outcome, o.why ?? null]), [['refused', 'duplicate'], ['created', null]]);
  assert.equal((f.db.prepare("SELECT status FROM ai_rail_proposals WHERE uid = ?").get(r.done.proposals[0].uid) as any).status, 'proposed', 'a refused row waits again');
  assert.equal((f.db.prepare("SELECT job_to_be_done FROM customer_segments WHERE name = 'Safety leads'").get() as any).job_to_be_done, 'Pass audits');

  f = fixture(answer({ rows: [{ claim: 'Leads pay per site', success_bar: '3 of 10 say yes' }, { success_bar: 'No claim' }] }));
  r = await f.runForm(EXPERIMENTS, 'hypothesis', { input: { rows: 2 } });
  assert.equal(r.done.proposals.length, 1, 'a row with no claim is not proposed');
  a = await f.call(11, 'POST', '/api/fills/rows/accept', { page: EXPERIMENTS, form: 'hypothesis', project: 701, proposals: [r.done.proposals[0].uid] });
  assert.equal(a.body.outcomes[0].outcome, 'created');
  assert.equal((f.db.prepare('SELECT success_bar FROM hypotheses WHERE id = ?').get(a.body.outcomes[0].id) as any).success_bar, '3 of 10 say yes');

  // Add must-have: a must-have, never a feature; a retired hypothesis is not a choice.
  f = fixture(answer({ rows: [{ title: 'Crews can book', hypothesis_id: 61 }, { title: 'Offline mode', hypothesis_id: 62 }] }));
  r = await f.runForm(PROTOTYPE, 'must-have', { input: { rows: 2 } });
  assert.deepEqual(r.done.proposals.map((p: any) => p.row), [{ title: 'Crews can book', hypothesis_id: 61 }, { title: 'Offline mode' }], 'the retired hypothesis is dropped by the parse');
  a = await f.call(11, 'POST', '/api/fills/rows/accept', { page: PROTOTYPE, form: 'must-have', project: 701, proposals: r.done.proposals.map((p: any) => p.uid) });
  assert.deepEqual(a.body.outcomes.map((o: any) => o.outcome), ['created', 'created']);
  const made = f.db.prepare('SELECT title, is_must_have, hypothesis_id FROM mvp_features WHERE project_id = 701 ORDER BY id').all() as any[];
  assert.deepEqual(made.map((m) => [m.title, m.is_must_have, m.hypothesis_id]), [['Crews can book', 1, 61], ['Offline mode', 1, null]]);
});

test('the must-have writer refuses a hypothesis that is retired or another venture\'s', async () => {
  const f = fixture();
  const write = FORM_ROW_WRITERS[`${PROTOTYPE} / must-have`];
  assert.equal(await write(f.env, { projectId: 701, userId: 11, row: { title: 'X', hypothesis_id: 62 } }), 'unmatched');
  assert.equal(await write(f.env, { projectId: 701, userId: 11, row: { title: 'X', hypothesis_id: 63 } }), 'unmatched');
  assert.equal(await write(f.env, { projectId: 701, userId: 11, row: { title: '  ' } }), 'no_title');
  assert.equal(await ROW_WRITERS.hypotheses(f.env, { projectId: 701, userId: 11, row: { claim: '' } }), 'invalid');
});

test('a Save keeps only what still equals the proposal; an edited field is never undone; a blank one is put back', async () => {
  const f = fixture(answer({ fields: [{ field: 'success_bar', value: '3 of 10 book' }, { field: 'disproof', value: 'Nobody books' }] }));
  const r = await f.runForm(EXPERIMENTS, 'hypothesis', { record: { type: 'hypotheses', id: 61 } });
  const [bar, disproof] = r.done.proposals;
  // The founder changes Disproof before Save; the Save writes the rest as proposed.
  f.db.exec("UPDATE hypotheses SET success_bar = '3 of 10 book', disproof = 'Fewer than one books' WHERE id = 61");
  const kept = await f.call(11, 'POST', '/api/fills/record', { page: EXPERIMENTS, form: 'hypothesis', project: 701, record: 61, proposals: [bar.uid, disproof.uid] });
  assert.equal(kept.status, 200);
  assert.deepEqual(kept.body.outcomes.map((o: any) => [o.field, o.outcome]), [['success_bar', 'kept'], ['disproof', 'not_kept']]);
  const id = kept.body.outcomes[0].provenance_id;
  // Edited since: refused, and the field stays the founder's.
  f.db.exec("UPDATE hypotheses SET success_bar = 'Mine now' WHERE id = 61");
  let u = await f.call(11, 'POST', `/api/fills/${id}/undo`);
  assert.deepEqual([u.status, u.body.error], [409, 'edited']);
  // Holding the fill again: the blank it replaced is put back.
  f.db.exec("UPDATE hypotheses SET success_bar = '3 of 10 book' WHERE id = 61");
  u = await f.call(11, 'POST', `/api/fills/${id}/undo`);
  assert.equal(u.status, 200);
  assert.equal((f.db.prepare('SELECT success_bar FROM hypotheses WHERE id = 61').get() as any).success_bar, null);
  // Another founder cannot undo it, and cannot read it.
  assert.equal((await f.call(22, 'POST', `/api/fills/${id}/undo`)).status, 404);
});
