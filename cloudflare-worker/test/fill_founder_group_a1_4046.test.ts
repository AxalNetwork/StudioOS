/**
 * #4046 Group A1 — the three #3740 part 2a forms S09 left: Validate › Market
 * intelligence's competitor (`why`, keyed by name in `competitor_tracking`),
 * Grow › Product improvement's feedback (its new theme, keyed by uid; the
 * customer's quote stays out) and Grow › Durable company building's
 * obligation (its title). Composition only. On the migrated schema, synthetic
 * rows only; the model is stubbed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_founder_group_a1_4046.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills, { ROW_KEYS, ROW_READS, venturedRowId } from '../src/routes/fills.ts';
import { ROW_REQUIRED, railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems, offeredToEadwyn } from '../src/services/fills/fields.ts';
import { EXISTING_READS } from '../src/services/fills/formRun.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';
import { KEYED_FILL_TABLES } from '../../frontend/src/lib/fillForms.js';

const JWT_SECRET = 'synthetic-group-a1-4046-only-not-a-real-credential'.repeat(2);
test.after(() => removeMigratedDatabases());

const MARKET_INTEL = 'Founder · Validate · Market intelligence';
const PRODUCT = 'Founder · Grow · Product improvement';
const DURABLE = 'Founder · Grow · Durable company building';
const FORMS: Array<[string, string, string, string, string]> = [
  [MARKET_INTEL, 'competitor', 'why', 'competitor_tracking', 'why_it_matters'],
  [PRODUCT, 'feedback', 'theme', 'product_feedback', 'theme'],
  [DURABLE, 'obligation', 'title', 'compliance_events', 'title'],
];
const QUOTE = 'Synthetic customer: the calendar export drops my Tuesday bookings';

type Run = (env: any, input: any) => Promise<any>;
const seen: string[] = [];
const answer = (output: unknown): Run => async (_env, input) => {
  seen.push(JSON.stringify(input?.messages ?? input));
  return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
};
const freeQuote = async () => ({ ok: true, hold_microusd: 1200, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }) as any;

function fixture(run: Run = answer({ fields: [] })) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',202,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (701,'v-acme','Acme Field',101),(702,'v-theirs','Theirs',202);
    INSERT INTO competitor_analyses(id,user_id,project_id) VALUES ('an-1',11,701),('an-2',22,702);
    INSERT INTO competitor_candidates(id,analysis_id,name) VALUES ('cand-1','an-1','Northwind Tools'),('cand-2','an-2','Northwind Tools'),('cand-3','an-1','Untracked Co');
    INSERT INTO competitor_tracking(id,uid,project_id,name_norm,why_it_matters) VALUES (41,'t-1',701,'northwind tools',NULL),(42,'t-2',702,'northwind tools',NULL);
    INSERT INTO product_feedback(id,uid,project_id,body,source,theme) VALUES (51,'fb-1',701,'${QUOTE}','customer',NULL),(52,'fb-2',702,'Theirs','customer',NULL),(53,'fb-3',701,'Another','team','Calendar sync');
    INSERT INTO compliance_events(id,project_id,jurisdiction,event_type,title,due_date) VALUES (61,701,'Unspecified','board_meeting','Board meeting','2026-12-01'),(62,702,'Unspecified','board_meeting','Theirs','2026-12-01');
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
    assert.ok(!Object.hasOwn(ROW_REQUIRED, table), 'these Add forms offer no "add several rows"');
    for (const sql of [ROW_READS[table], EXISTING_READS[table], UNDO_WRITES[`${table}.${column}`].read]) assert.doesNotThrow(() => db.prepare(sql), sql);
    assert.doesNotThrow(() => db.prepare(UNDO_WRITES[`${table}.${column}`].write.replace('(SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', '1')));
  }
  assert.equal(UNDO_WRITES['compliance_events.title'].required, true, 'an obligation is never left without its title');
  assert.equal(UNDO_WRITES['competitor_tracking.why_it_matters'].required, false);
  // The keyed tables agree on both sides, and feedback's own words are never a fill target.
  assert.deepEqual(Object.keys(ROW_KEYS).sort(), [...KEYED_FILL_TABLES].sort());
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'product_feedback' && f.column !== 'theme'), 'only the theme; never what a customer said');
});

test('a text key reaches its own venture\'s row only; a bad key reads nothing', async () => {
  // Mutation checked: the candidate read without `a.project_id = ?` lets another venture's competitor resolve;
  // the key shape check dropped → a malformed key reaches D1.
  const f = fixture();
  assert.equal(await venturedRowId(f.env, 'competitor_tracking', 'cand-1', 701), 41);
  assert.equal(await venturedRowId(f.env, 'competitor_tracking', 'cand-2', 701), null, 'another venture\'s candidate');
  assert.equal(await venturedRowId(f.env, 'competitor_tracking', 'cand-3', 701), null, 'a candidate not tracked');
  assert.equal(await venturedRowId(f.env, 'product_feedback', 'fb-1', 701), 51);
  assert.equal(await venturedRowId(f.env, 'product_feedback', 'fb-2', 701), null);
  // A malformed key is refused before any read.
  let reads = 0;
  const counted = { ...f.env, DB: { prepare: (sql: string) => { reads += 1; return f.env.DB.prepare(sql); } } };
  assert.equal(await venturedRowId(counted, 'product_feedback', "fb-1' OR '1'='1", 701), null, 'not a key');
  assert.equal(await venturedRowId(counted, 'competitor_tracking', '../cand-1', 701), null);
  assert.equal(reads, 0, 'a malformed key never reaches D1');
  assert.equal(await venturedRowId(f.env, 'compliance_events', 'fb-1', 701), null, 'a table not keyed takes ids only');
  assert.equal(await venturedRowId(f.env, 'compliance_events', '61', 701), 61);
});

test('competitor: the Edit reads the tracked row by its candidate and proposes why; Save keeps it on that row', async () => {
  // Mutation checked: ROW_KEYS dropped for competitor_tracking → the Edit's sheet and run answer 404.
  const f = fixture(answer({ fields: [{ field: 'why', value: 'Sells to the same field-ops buyers at a lower price.' }, { field: 'kind', value: 'adjacent' }] }));
  const sheet = await f.call(11, 'GET', `/api/fills/sheet?page=${encodeURIComponent(MARKET_INTEL)}&form=competitor&project=701&record=cand-1`);
  assert.equal(sheet.status, 200, sheet.text);
  assert.equal(sheet.body.record, 'competitor_tracking:41');
  assert.equal((await f.call(11, 'GET', `/api/fills/sheet?page=${encodeURIComponent(MARKET_INTEL)}&form=competitor&project=701&record=cand-2`)).status, 404);
  const run = await f.runForm(MARKET_INTEL, 'competitor', { record: { type: 'competitor_tracking', id: 'cand-1' } });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.done.proposals.map((p: any) => p.field), ['why'], 'the kind is never proposed');
  assert.equal((f.db.prepare('SELECT why_it_matters FROM competitor_tracking WHERE id = 41').get() as any).why_it_matters, null, 'the run writes nothing');
  // The form's own Save writes it; the record step keeps it on the tracked row.
  f.db.prepare('UPDATE competitor_tracking SET why_it_matters = ? WHERE id = 41').run(run.done.proposals[0].value);
  const kept = await f.call(11, 'POST', '/api/fills/record', { page: MARKET_INTEL, form: 'competitor', project: 701, record: 'cand-1', proposals: [run.done.proposals[0].uid] });
  assert.equal(kept.status, 200, kept.text);
  assert.equal(kept.body.record, 'competitor_tracking:41');
  assert.deepEqual(kept.body.outcomes.map((o: any) => o.outcome), ['kept']);
  const prov = f.db.prepare("SELECT target_table, target_row_id, target_column FROM fill_provenance WHERE target_table = 'competitor_tracking'").all() as any[];
  assert.deepEqual(prov.map((p) => [p.target_row_id, p.target_column]), [[41, 'why_it_matters']]);
  assert.equal((await f.call(11, 'POST', '/api/fills/record', { page: MARKET_INTEL, form: 'competitor', project: 701, record: 'cand-2', proposals: [run.done.proposals[0].uid] })).status, 404);
});

test('feedback: Log feedback proposes a new theme from the venture\'s themes, and never sends what a customer said', async () => {
  // Mutation checked: EXISTING_READS reading `body` for product_feedback → the quote reaches the prompt.
  seen.length = 0;
  const f = fixture(answer({ fields: [{ field: 'theme', value: 'Calendar export' }, { field: 'body', value: 'invented words' }] }));
  const add = await f.runForm(PRODUCT, 'feedback', {});
  assert.equal(add.status, 200, add.text);
  assert.deepEqual(add.done.proposals.map((p: any) => [p.field, p.value]), [['theme', 'Calendar export']], 'the words are never proposed');
  assert.ok(seen.length > 0, 'the model was asked');
  assert.ok(seen.every((m) => !m.includes('Tuesday bookings')), 'a customer\'s quote never reaches the model');
  assert.ok(seen.some((m) => m.includes('Calendar sync')), 'the venture\'s own themes, so a theme is not repeated');
  // Saved through Log feedback (its reply names the uid), then kept on that row.
  f.db.prepare('UPDATE product_feedback SET theme = ? WHERE id = 51').run('Calendar export');
  const kept = await f.call(11, 'POST', '/api/fills/record', { page: PRODUCT, form: 'feedback', project: 701, record: 'fb-1', proposals: [add.done.proposals[0].uid] });
  assert.equal(kept.status, 200, kept.text);
  assert.equal(kept.body.record, 'product_feedback:51');
  assert.deepEqual(kept.body.outcomes.map((o: any) => o.outcome), ['kept']);
});

test('obligation: the Add proposes its title; an Edit reads the venture\'s own obligation by id', async () => {
  // Mutation checked: ROW_READS for compliance_events without `AND project_id = ?` reads another venture's.
  const f = fixture(answer({ fields: [{ field: 'title', value: 'Quarterly board meeting' }, { field: 'due_at', value: '2027-01-01' }, { field: 'owner_name', value: 'Someone' }] }));
  const add = await f.runForm(DURABLE, 'obligation', {});
  assert.equal(add.status, 200, add.text);
  assert.deepEqual(add.done.proposals.map((p: any) => p.field), ['title'], 'a date and an owner are never proposed');
  const sheet = await f.call(11, 'GET', `/api/fills/sheet?page=${encodeURIComponent(DURABLE)}&form=obligation&project=701&record=61`);
  assert.equal(sheet.status, 200, sheet.text);
  assert.equal((await f.call(11, 'GET', `/api/fills/sheet?page=${encodeURIComponent(DURABLE)}&form=obligation&project=701&record=62`)).status, 404);
  // A titled obligation has nothing to ask.
  assert.equal((await f.runForm(DURABLE, 'obligation', { record: { type: 'compliance_events', id: 61 } })).status, 400);
});
