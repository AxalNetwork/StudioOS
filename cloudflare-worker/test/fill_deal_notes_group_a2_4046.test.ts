/**
 * #4046 Group A2 — Ask on a deal page's note (`deal_notes.body`): a scoped
 * record under its deal, by the notes route's own rule (routes/deal_context.ts
 * `context`, shared as `dealFirm` and `investorDeal`). An investor, for the
 * firm the request is for, on a deal they hold an invitation or a commitment
 * on. The firm reads a note's marks; only its author fills it. No staff
 * bypass: an admin is answered as if the record did not exist.
 *
 * On the migrated schema, synthetic rows only; the model and the quoter are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_deal_notes_group_a2_4046.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills from '../src/routes/fills.ts';
import dealContext from '../src/routes/deal_context.ts';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems } from '../src/services/fills/fields.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const SECRET = 'synthetic-fill-deal-notes-4046-'.repeat(3);
test.after(() => removeMigratedDatabases());

const PAGE = 'Investor · Deals · Deal page';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// 41 investor (firm 5, invited to deal 4), 42 colleague (firm 5, invited too), 43 investor of firm 6 (no invitation),
// 44 investor in two firms (5 and 6), 51 admin.
function fixture(output: unknown = { fields: [] }) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,1),
      (41,'Investor','i@example.test','investor',NULL,1),(42,'Colleague','c@example.test','investor',NULL,1),
      (43,'Other firm','o@example.test','investor',NULL,1),(44,'Two firms','t@example.test','investor',NULL,1),
      (45,'Firm six on the deal','s@example.test','investor',NULL,1),
      (51,'Admin','h@example.test','admin',NULL,1);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('l-41',5,41),('l-42',5,42),('l-43',6,43),('l-44a',5,44),('l-44b',6,44),('l-45',6,45);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (801,'v-acme','Acme Field',101);
    INSERT INTO deals(id,project_id,status) VALUES (4,801,'active'),(7,801,'active');
    INSERT INTO deal_invitations(deal_id,investor_user_id,company_id) VALUES (4,41,5),(4,42,5),(4,44,5),(4,45,6);
    INSERT INTO deal_notes(id,uid,deal_id,author_user_id,company_id,tag,body) VALUES
      (501,'n-1',4,41,5,'Thesis','Pilots convert in a quarter'),
      (502,'n-2',4,42,5,'','Colleague private words, never sent to the model');
  `);
  const runs: any[] = [];
  const run = async (_env: any, input: any) => {
    runs.push(input);
    return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: MODEL }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
  };
  const quote = async () => ({ ok: true, hold_microusd: 1200, model: MODEL }) as any;
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  app.route('/api/deals', dealContext);
  const call = async (who: number, method: string, path: string, body?: unknown, extra: Record<string, string> = {}, support = false) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(support ? { impersonated_by: 51 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, q: Record<string, string | number>, extra: Record<string, string> = {}) =>
    call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries({ page: PAGE, form: 'deal-note', ...q }).map(([k, v]) => [k, String(v)]))}`, undefined, extra);
  const runForm = async (who: number, body: Record<string, unknown>, support = false) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', { page: PAGE, option: 'form:deal-note', ...body }, {}, support);
    const events = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: events.find((e) => e.event === 'done')?.data };
  };
  return { db, call, sheet, runForm, runs };
}
const prompt = (input: any) => input.messages.map((m: any) => m.content).join('\n');

test('the registry: one composition field, both copies; the tag is never asked; a scoped undo that refuses a blank note', () => {
  // Mutation checked: dropping the scoped undo, or listing the tag, turns this red.
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual(fieldsOf(PAGE, 'deal-note').map((f) => [f.field, f.table, f.column, f.class, f.sources]), [['body', 'deal_notes', 'body', 'composition', ['eadwyn']]]);
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'deal_notes' && f.column !== 'body'), 'never the tag');
  assert.equal(UNDO_WRITES['deal_notes.body']?.scoped, true);
  assert.equal(UNDO_WRITES['deal_notes.body']?.required, true);
});

test('who: the author fills, a colleague reads marks, another firm and an admin are told it does not exist', async () => {
  // Mutation checked: the scope without `investorDeal` lets an uninvited firm add under deal 4; write for any reader
  // gives the colleague a trigger; an admin bypass reads the note; the firm match dropped lets firm 6 read firm 5's note.
  const f = fixture();
  const add = await f.sheet(41, { parent: 4 });
  assert.equal(add.status, 200, add.text);
  assert.deepEqual([add.body.scope, add.body.can_fill], ['deal:4', true]);
  assert.equal((await f.sheet(41, { parent: 7 })).status, 404, 'a deal not held');
  assert.equal((await f.sheet(41, { record: 501 })).body.can_fill, true, 'the author');
  const colleague = await f.sheet(42, { record: 501 });
  assert.deepEqual([colleague.status, colleague.body.can_fill], [200, false], 'the firm reads, never fills');
  const other = await f.sheet(43, { record: 501 });
  const missing = await f.sheet(43, { record: 599 });
  assert.deepEqual([other.status, other.body], [missing.status, missing.body], 'another firm: as if it did not exist');
  assert.equal((await f.sheet(43, { parent: 4 })).status, 404);
  // Another firm on the same deal: it adds its own notes, and never reads firm 5's.
  assert.equal((await f.sheet(45, { parent: 4 })).body.can_fill, true);
  assert.equal((await f.sheet(45, { record: 501 })).status, 404, 'another firm on the same deal');
  assert.equal((await f.sheet(51, { record: 501 })).status, 404, 'no staff bypass, as on the route');
  assert.equal((await f.sheet(11, { parent: 4 })).status, 404, 'a founder');
});

test('the firm: two firms and no claim is refused; a claim that does not verify never falls back', async () => {
  // Mutation checked: `dealFirm`'s ambiguous branch dropped lets an investor in two firms add with no firm named.
  const f = fixture();
  assert.equal((await f.sheet(44, { parent: 4 })).status, 404, 'two firms, none named');
  assert.equal((await f.sheet(41, { parent: 4 }, { 'X-Company-Id': '999' })).status, 404, 'an unverified claim');
});

test('the run reads the company and the author\'s own notes, never a colleague\'s; Save keeps the placed words', async () => {
  // Mutation checked: the existing read without `author_user_id = ?` sends a colleague's words to the model.
  const f = fixture({ fields: [{ field: 'body', value: 'Ask how pilots convert after the first quarter.' }, { field: 'tag', value: 'Risk' }] });
  const r = await f.runForm(41, { parent: 4 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.done.proposals.map((p: any) => p.field), ['body'], 'the tag is never proposed');
  const text = prompt(f.runs[0]);
  assert.match(text, /Company: Acme Field/);
  assert.match(text, /Pilots convert in a quarter/, 'the author\'s own notes, so a note is not repeated');
  assert.doesNotMatch(text, /Colleague private words/);
  // The route's own Save, which now answers the row's id; then the record step keeps the placed words.
  const saved = await f.call(41, 'POST', '/api/deals/4/notes', { body: r.done.proposals[0].value, tag: 'Thesis' });
  assert.equal(saved.status, 201, saved.text);
  assert.ok(Number(saved.body.id) > 0 && saved.body.uid, 'the Save names its row');
  const kept = await f.call(41, 'POST', '/api/fills/record', { page: PAGE, form: 'deal-note', record: saved.body.id, proposals: [r.done.proposals[0].uid] });
  assert.equal(kept.status, 200, kept.text);
  assert.deepEqual(kept.body.outcomes.map((o: any) => o.outcome), ['kept']);
  const notes = await f.call(41, 'GET', '/api/deals/4/notes');
  assert.ok(notes.body.items.every((n: any) => Number(n.id) > 0), 'the list names each note\'s id, for its Edit');
});

test('a support session never fills', async () => {
  const f = fixture();
  assert.equal((await f.runForm(41, { parent: 4 }, true)).status, 403);
});
