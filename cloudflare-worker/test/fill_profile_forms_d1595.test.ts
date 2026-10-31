/**
 * D1595 (#3868) — Ask on three profile forms: Value-add's Log support,
 * Catalog's New service and Perk deals' New perk. Each fills one text field,
 * under its own route's write gate (`services/profileWriteGates.ts`, shared
 * with `services/fills/scopes.ts`): who gets the trigger, who reads marks
 * only, who is answered as if the record did not exist; what the run reads,
 * what it may never ask, and that it never adds rows.
 *
 * On the migrated schema, synthetic rows only; the model and the quoter are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_profile_forms_d1595.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills from '../src/routes/fills.ts';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems } from '../src/services/fills/fields.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const SECRET = 'synthetic-fill-profile-forms-d1595-'.repeat(3);
test.after(() => removeMigratedDatabases());

const VALUE_ADD = 'Investor · Portfolio · Value-add';
const CATALOG = 'Operating Partner · Offers · Catalog';
const PERK_DEALS = 'Operating Partner · Offers · Perk deals';
/** Never asked on these forms: a result, a measure, a term, money. */
const NEVER = ['outcome', 'hours', 'detail', 'price_usd', 'price_cents', 'value_cents', 'credits'];

type Run = (env: any, input: any) => Promise<any>;
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const answer = (output: unknown) => async () => ({
  ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: MODEL }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 },
});

// 11 founder, 31 partner, 32 another partner, 41 investor (book: 801), 43 investor (book: 802), 51 admin, 61 explorer.
function fixture(output: unknown = { fields: [] }) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO partners(id,uid,name,email) VALUES (301,'p-1','Partner One','p1@example.test'),(302,'p-2','Partner Two','p2@example.test');
    INSERT INTO users(id,name,email,role,founder_id,partner_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,NULL,1),
      (31,'Partner','p@example.test','partner',NULL,301,1),(32,'Partner Two','p2u@example.test','partner',NULL,302,1),
      (41,'Investor','i@example.test','investor',NULL,NULL,1),(43,'Other investor','o@example.test','investor',NULL,NULL,1),
      (51,'Admin','h@example.test','admin',NULL,NULL,1),(61,'Explorer','e@example.test','exploring',NULL,NULL,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (801,'v-acme','Acme Field',101),(802,'v-other','Other Co',101);
    INSERT INTO investor_introductions(uid,investor_user_id,project_id,quarter) VALUES ('ii-1',41,801,'2026-Q4'),('ii-2',43,802,'2026-Q4');
    INSERT INTO portfolio_support_entries(id,uid,project_id,kind,state,summary,outcome,hours,recorded_by,created_at,updated_at) VALUES
      (701,'s-1',801,'intro','promised','Intro to a design partner',NULL,NULL,41,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),
      (702,'s-2',802,'intro','promised','Not on your book',NULL,NULL,43,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
    INSERT INTO service_offerings(id,uid,owner_user_id,title,summary,created_at,updated_at) VALUES
      (601,'o-1',31,'Pricing teardown',NULL,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),
      (602,'o-2',32,'Theirs',NULL,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
    INSERT INTO perks(id,uid,partner_user_id,partner_name,category,offer,blurb,status,created_at,updated_at) VALUES
      (901,'k-1',31,'Partner One','Software','Three months free',NULL,'in_review','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),
      (902,'k-2',32,'Partner Two','Software','Their own offer',NULL,'in_review','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
  `);
  const runs: any[] = [];
  const quotes: any[] = [];
  const run: Run = async (env, input) => { runs.push(input); return answer(output)(); };
  const quote = async (_env: any, input: any) => { quotes.push(input); return { ok: true, hold_microusd: 1200, model: MODEL } as any; };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  const call = async (who: number, method: string, path: string, body?: unknown, support = false) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(support ? { impersonated_by: 51 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, q: Record<string, string | number>) => call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`);
  const runForm = async (who: number, body: Record<string, unknown>, support = false) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', body, support);
    const events = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: events.find((e) => e.event === 'done')?.data };
  };
  return { db, call, sheet, runForm, runs, quotes };
}
const prompt = (input: any) => input.messages.map((m: any) => m.content).join('\n');

test('the registry: one text field per form, in both copies; no outcome, hours, detail, price, value or credit', () => {
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual(fieldsOf(VALUE_ADD, 'support').map((f) => [f.table, f.column, f.class, f.sources]), [['portfolio_support_entries', 'summary', 'composition', ['eadwyn']]]);
  assert.deepEqual(fieldsOf(CATALOG, 'offering').map((f) => [f.table, f.column]), [['service_offerings', 'summary']]);
  assert.deepEqual(fieldsOf(PERK_DEALS, 'perk').map((f) => [f.table, f.column]), [['perks', 'blurb']]);
  for (const t of ['portfolio_support_entries', 'service_offerings', 'perks']) {
    const cols = FILL_FIELDS.filter((f) => f.table === t).map((f) => f.column);
    for (const c of [...NEVER, 'title', 'category', 'offer', 'partner_name']) assert.ok(!cols.includes(c), `${t}.${c} is never asked`);
    for (const c of cols) assert.ok(UNDO_WRITES[`${t}.${c}`]?.scoped, `${t}.${c} has its scoped undo`);
  }
});

test('Log support: an investor fills entries on their own book; another investor is answered as if none existed; an admin reads, never fills', async () => {
  const f = fixture();
  const add = await f.sheet(41, { page: VALUE_ADD, form: 'support', parent: 801 });
  assert.equal(add.status, 200, add.text);
  assert.deepEqual([add.body.scope, add.body.can_fill], ['project:801', true]);
  assert.equal((await f.sheet(41, { page: VALUE_ADD, form: 'support', record: 701 })).body.can_fill, true);
  // Off the book: the same answer as a record that does not exist.
  const offBook = await f.sheet(41, { page: VALUE_ADD, form: 'support', record: 702 });
  const missing = await f.sheet(41, { page: VALUE_ADD, form: 'support', record: 799 });
  assert.deepEqual([offBook.status, offBook.body], [missing.status, missing.body]);
  assert.deepEqual([offBook.status, offBook.body.error], [404, 'record_not_found']);
  assert.equal((await f.sheet(41, { page: VALUE_ADD, form: 'support', parent: 802 })).status, 404);
  assert.equal((await f.sheet(43, { page: VALUE_ADD, form: 'support', record: 701 })).status, 404);
  assert.equal((await f.sheet(11, { page: VALUE_ADD, form: 'support', record: 701 })).status, 404, 'a founder');
  const admin = await f.sheet(51, { page: VALUE_ADD, form: 'support', record: 701 });
  assert.deepEqual([admin.status, admin.body.can_fill], [200, false], 'no admin trigger');
  const adminRun = await f.runForm(51, { page: VALUE_ADD, option: 'form:support', record: { type: 'portfolio_support_entries', id: 701 } });
  assert.deepEqual([adminRun.status, adminRun.body.error], [403, 'record_not_available']);
  assert.equal(f.quotes.length, 0, 'refused before any hold');
});

test('New service: the owner fills their own offering; another partner and a founder get nothing; an admin reads', async () => {
  const f = fixture();
  const add = await f.sheet(31, { page: CATALOG, form: 'offering' });
  assert.deepEqual([add.status, add.body.scope, add.body.can_fill], [200, 'owner:31', true]);
  assert.equal((await f.sheet(31, { page: CATALOG, form: 'offering', record: 601 })).body.can_fill, true);
  for (const who of [32, 11]) assert.equal((await f.sheet(who, { page: CATALOG, form: 'offering', record: 601 })).status, 404, `user ${who}`);
  assert.deepEqual((await f.sheet(51, { page: CATALOG, form: 'offering', record: 601 })).body.can_fill, false);
  assert.equal((await f.runForm(32, { page: CATALOG, option: 'form:offering', record: { type: 'service_offerings', id: 601 } })).status, 404);
});

test('New perk: a partner fills their own listing; another partner and a founder get nothing; the gather reads only the caller\'s offers', async () => {
  const f = fixture({ fields: [{ field: 'blurb', value: 'Three months of the pro plan for studio founders.' }] });
  assert.equal((await f.sheet(31, { page: PERK_DEALS, form: 'perk', record: 901 })).body.can_fill, true);
  assert.deepEqual((await f.sheet(31, { page: PERK_DEALS, form: 'perk' })).body.scope, 'owner:31');
  for (const who of [32, 11]) assert.equal((await f.sheet(who, { page: PERK_DEALS, form: 'perk', record: 901 })).status, 404, `user ${who}`);
  const run = await f.runForm(31, { page: PERK_DEALS, option: 'form:perk' });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.done.proposals.map((p: any) => p.field), ['blurb']);
  const p = prompt(f.runs[0]);
  assert.match(p, /Three months free/);
  assert.doesNotMatch(p, /Their own offer/, "another partner's perk is never read");
  assert.equal((f.db.prepare('SELECT blurb FROM perks WHERE id = 901').get() as any).blurb, null, 'the run writes nothing');
});

test('the gather: a support entry reads its company and the caller\'s own last entries there; an offering, the caller\'s own titles', async () => {
  const f = fixture({ fields: [{ field: 'summary', value: 'Introduced the CFO of a design partner.' }] });
  f.db.exec("INSERT INTO portfolio_support_entries(id,uid,project_id,kind,state,summary,recorded_by,created_at,updated_at) VALUES (703,'s-3',801,'intro','promised','Someone else on Acme',43,'2026-10-02T00:00:00Z','2026-10-02T00:00:00Z')");
  assert.equal((await f.runForm(41, { page: VALUE_ADD, option: 'form:support', parent: 801 })).status, 200);
  const p = prompt(f.runs[0]);
  assert.match(p, /Acme Field/);
  assert.match(p, /Intro to a design partner/);
  assert.doesNotMatch(p, /Someone else on Acme|Not on your book/);
  assert.equal((await f.runForm(31, { page: CATALOG, option: 'form:offering' })).status, 200);
  assert.match(prompt(f.runs[1]), /Pricing teardown/);
  assert.doesNotMatch(prompt(f.runs[1]), /Theirs/);
});

test('never asked: an outcome, hours, a perk\'s detail, a price, a value or credits that a model names is dropped', async () => {
  const named = Object.fromEntries(NEVER.map((n) => [n, 'x']));
  const f = fixture({ fields: [{ field: 'summary', value: 'Ran a board prep session.' }, ...NEVER.map((field) => ({ field, value: named[field] })), { field: 'blurb', value: 'One line.' }] });
  f.db.exec("UPDATE portfolio_support_entries SET summary = '' WHERE id = 701");
  const support = await f.runForm(41, { page: VALUE_ADD, option: 'form:support', record: { type: 'portfolio_support_entries', id: 701 } });
  const perk = await f.runForm(31, { page: PERK_DEALS, option: 'form:perk', record: { type: 'perks', id: 901 } });
  for (const r of [support, perk]) {
    assert.equal(r.status, 200, r.text);
    const kept = r.done.proposals.map((p: any) => p.field);
    for (const n of NEVER) assert.ok(!kept.includes(n), `${n} is never proposed`);
    for (const n of NEVER) assert.ok(r.done.dropped.some((d: any) => d.field === n), `${n} is dropped`);
  }
  assert.deepEqual(perk.done.proposals.map((p: any) => p.field), ['blurb']);
  assert.equal(f.runs.length, 2);
  for (const input of f.runs) for (const n of NEVER) assert.doesNotMatch(prompt(input), new RegExp(`^- ${n} `, 'm'), `${n} is never asked`);
});

test('rows are not offered on these forms: 400 rows_not_offered before any quote; a support session and an Explorer are refused before any hold', async () => {
  const f = fixture();
  for (const [who, body] of [
    [41, { page: VALUE_ADD, option: 'form:support', parent: 801, input: { rows: 3 } }],
    [31, { page: CATALOG, option: 'form:offering', input: { rows: 2 } }],
    [31, { page: PERK_DEALS, option: 'form:perk', input: { rows: 2 } }],
  ] as const) {
    const r = await f.runForm(who, body as any);
    assert.deepEqual([r.status, r.body?.error], [400, 'rows_not_offered'], body.option);
  }
  const explorer = await f.runForm(61, { page: PERK_DEALS, option: 'form:perk' });
  assert.deepEqual([explorer.status, explorer.body.error], [403, 'no_profile']);
  const support = await f.runForm(31, { page: PERK_DEALS, option: 'form:perk' }, true);
  assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
  assert.equal(f.quotes.length, 0, 'no quote and no hold');
  assert.equal(f.runs.length, 0);
});
