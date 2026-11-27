/**
 * #4046 (#3740 2b) — Ask on the deal page's New note: a firm's private note
 * on a deal, its words only. The scope is the notes route's own rule
 * (`services/dealNotes.ts`, shared with `routes/deal_context.ts`): an
 * investor who may open the deal for a firm reads that firm's notes; only a
 * note's author fills it; a firm-less note is its author's alone; there is no
 * admin and no staff bypass, so anyone else is answered as if the note did
 * not exist. What the run reads, what it never reads, and the kept fill's
 * record and undo.
 *
 * On the migrated schema, synthetic rows only; the model and the quoter are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_deal_notes_4046.test.ts
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

const DEAL_ROOM = 'Investor · Deals · Deal room';
type Run = (env: any, input: any) => Promise<any>;
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// 41 and 42: investors at firm 1 (one link each); 43: investor at firm 2; 44: investor with no firm;
// 45: investor at firm 1 with no invitation; 46: investor at firms 1 and 2; 47: another investor with no firm;
// 11 founder; 51 admin (holding an invitation); 61 explorer.
function fixture(output: unknown = { fields: [] }) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,1),
      (41,'Investor A','a@example.test','investor',NULL,1),(42,'Colleague','b@example.test','investor',NULL,1),
      (43,'Other firm','c@example.test','investor',NULL,1),(44,'Solo','d@example.test','investor',NULL,1),
      (45,'Uninvited','e@example.test','investor',NULL,1),(46,'Two firms','g@example.test','investor',NULL,1),(47,'Solo two','s2@example.test','investor',NULL,1),
      (51,'Admin','h@example.test','admin',NULL,1),(61,'Explorer','x@example.test','exploring',NULL,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'cp1','Firm One'),(2,'cp2','Firm Two');
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('l1',1,41),('l2',1,42),('l3',2,43),('l5',1,45),('l6',1,46),('l7',2,46);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (801,'v-acme','Acme Field',101);
    INSERT INTO deals(id,project_id,status) VALUES (900,801,'scored');
    INSERT INTO deal_invitations(deal_id,investor_user_id,company_id,status) VALUES
      (900,41,1,'interested'),(900,42,1,'interested'),(900,43,2,'interested'),(900,44,NULL,'interested'),(900,46,NULL,'interested'),(900,47,NULL,'interested'),
      -- an admin who still holds an invitation from an investor seat: the role, not the invitation, refuses them.
      (900,51,NULL,'interested');
    INSERT INTO deal_notes(id,uid,deal_id,author_user_id,company_id,tag,body) VALUES
      (701,'n-1',900,41,1,'','Met the CTO; the pilot list is real.'),
      (702,'n-2',900,43,2,'','Other firm view, never read by firm one.'),
      (703,'n-3',900,44,NULL,'','A firm-less note of my own.');
  `);
  const runs: any[] = [];
  const quotes: any[] = [];
  const run: Run = async (_env, input) => {
    runs.push(input);
    return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: MODEL }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
  };
  const quote = async (_env: any, input: any) => { quotes.push(input); return { ok: true, hold_microusd: 1200, model: MODEL } as any; };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  app.route('/api/deals', dealContext);
  const call = async (who: number, method: string, path: string, body?: unknown, opts: { support?: boolean; firm?: number } = {}) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(opts.support ? { impersonated_by: 51 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
    if (opts.firm != null) headers['X-Company-Id'] = String(opts.firm);
    const r = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, q: Record<string, string | number>, opts: { firm?: number } = {}) =>
    call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries({ page: DEAL_ROOM, form: 'deal-note', ...q }).map(([k, v]) => [k, String(v)]))}`, undefined, opts);
  const runForm = async (who: number, body: Record<string, unknown>, opts: { support?: boolean; firm?: number } = {}) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', { page: DEAL_ROOM, option: 'form:deal-note', ...body }, opts);
    const events = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: events.find((e) => e.event === 'done')?.data };
  };
  return { db, call, sheet, runForm, runs, quotes };
}
const prompt = (input: any) => input.messages.map((m: any) => m.content).join('\n');

test('the registry: one composition field, the note\'s words, in both copies; its tag is never listed; its undo is scoped', () => {
  // Mutation checked: the entry dropped from one copy → the deepEqual fails.
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual(fieldsOf(DEAL_ROOM, 'deal-note').map((f) => [f.field, f.table, f.column, f.class, f.sources]), [['body', 'deal_notes', 'body', 'composition', ['eadwyn']]]);
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'deal_notes' && f.column !== 'body'), 'only the words: never the tag');
  assert.equal(UNDO_WRITES['deal_notes.body']?.scoped, true);
  assert.equal(UNDO_WRITES['deal_notes.body']?.required, true, 'a note cannot be left blank');
});

test('who gets Ask on a new note: an investor who may open the deal for their firm; a founder, an admin, an uninvited investor and an Explorer get nothing', async () => {
  // Mutations checked: the visibleDeal check dropped → the uninvited investor reads 200; the role check dropped → the admin reads 200.
  const f = fixture();
  const add = await f.sheet(41, { parent: 900 });
  assert.equal(add.status, 200, add.text);
  assert.deepEqual([add.body.scope, add.body.can_fill, add.body.fields[0].trigger], ['deal:900', true, true]);
  assert.equal((await f.sheet(43, { parent: 900 })).body.can_fill, true, 'another firm, on its own invitation');
  assert.equal((await f.sheet(44, { parent: 900 })).body.can_fill, true, 'an investor with no firm');
  for (const who of [45, 11, 51]) {
    const r = await f.sheet(who, { parent: 900 });
    assert.deepEqual([r.status, r.body.error], [404, 'record_not_found'], `user ${who}`);
  }
  assert.deepEqual((await f.sheet(41, { parent: 999 })).status, 404, 'a deal that does not exist');
  const explorer = await f.sheet(61, { parent: 900 });
  assert.deepEqual([explorer.status, explorer.body.error], [403, 'no_profile']);
});

test('the firm is the route\'s: two firms and none named is no Ask; a named firm the caller holds is; a claimed firm they do not hold never falls back', async () => {
  // Mutation checked: noteFirm falling back after an unverified claim → the claim of firm 2 by 41 reads 200.
  const f = fixture();
  assert.equal((await f.sheet(46, { parent: 900 })).status, 404, 'two firms, none named');
  assert.equal((await f.sheet(46, { parent: 900 }, { firm: 1 })).body.can_fill, true, 'a firm they hold, named');
  assert.equal((await f.sheet(41, { parent: 900 }, { firm: 2 })).status, 404, 'a firm they do not hold');
  // The notes route answers by the same rule.
  assert.equal((await f.call(46, 'GET', '/api/deals/900/notes')).status, 409);
  assert.equal((await f.call(41, 'GET', '/api/deals/900/notes', undefined, { firm: 2 })).status, 403);
});

test('who fills a saved note: its author; a colleague at the firm reads marks only; another firm, or anyone on a firm-less note, is told it does not exist', async () => {
  // Mutations checked: write granted to every reader → the colleague can_fill is true;
  // the firm comparison dropped → firm two reads note 701.
  const f = fixture();
  assert.equal((await f.sheet(41, { record: 701 })).body.can_fill, true);
  const colleague = await f.sheet(42, { record: 701 });
  assert.deepEqual([colleague.status, colleague.body.can_fill], [200, false]);
  const otherFirm = await f.sheet(43, { record: 701 });
  const missing = await f.sheet(43, { record: 799 });
  assert.deepEqual([otherFirm.status, otherFirm.body], [missing.status, missing.body], 'the same answer as no note');
  assert.equal((await f.sheet(44, { record: 703 })).body.can_fill, true, 'a firm-less note, its author');
  assert.equal((await f.sheet(41, { record: 703 })).status, 404, 'a firm-less note is no one else\'s');
  // Mutation checked: the author rule on a firm-less note dropped → another investor with no firm reads note 703.
  assert.equal((await f.sheet(47, { record: 703 })).status, 404, 'not even another investor with no firm');
  assert.equal((await f.sheet(51, { record: 701 })).status, 404, 'no staff bypass');
  // A colleague cannot run on it: refused on the record before the fields are read.
  const run = await f.runForm(42, { record: { type: 'deal_notes', id: 701 } });
  assert.deepEqual([run.status, run.body.error], [403, 'record_not_available']);
  assert.equal(f.quotes.length, 0, 'refused before any hold');
});

test('the run reads the deal\'s company and stage and the firm\'s own notes; never another firm\'s, never a firm-less note of someone else\'s; it writes nothing', async () => {
  // Mutation checked: the company_id filter dropped from the gather → firm two's note reaches the prompt.
  const f = fixture({ fields: [{ field: 'body', value: 'Second call: the pilot list holds; ask for the churn by cohort.' }, { field: 'tag', value: 'Follow-up' }] });
  const run = await f.runForm(41, { parent: 900 });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.done.proposals.map((p: any) => p.field), ['body']);
  assert.deepEqual(run.done.dropped.map((d: any) => [d.field, d.why]), [['tag', 'unknown_field']], 'the tag is the investor\'s own call');
  const p = prompt(f.runs[0]);
  assert.match(p, /Acme Field/);
  assert.match(p, /Deal stage: scored/);
  assert.match(p, /Met the CTO/);
  assert.doesNotMatch(p, /Other firm view|A firm-less note of my own/);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM deal_notes').get() as any).n, 3, 'the run writes nothing');
  const payload = JSON.parse((f.db.prepare('SELECT payload_json FROM ai_rail_proposals').get() as any).payload_json);
  assert.deepEqual([payload.project, payload.scope], [null, 'deal:900']);
});

test('refusals before any hold: rows are not offered; a support session and an Explorer are refused', async () => {
  const f = fixture();
  const rows = await f.runForm(41, { parent: 900, input: { rows: 3 } });
  assert.deepEqual([rows.status, rows.body.error], [400, 'rows_not_offered']);
  const support = await f.runForm(41, { parent: 900 }, { support: true });
  assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
  const explorer = await f.runForm(61, { parent: 900 });
  assert.deepEqual([explorer.status, explorer.body.error], [403, 'no_profile']);
  assert.equal(f.quotes.length, 0);
  assert.equal(f.runs.length, 0);
});

test('the Save, the record and the undo: the notes route returns the new id; a kept fill is the author\'s; the colleague keeps nothing; an undo with no prior is refused', async () => {
  // Mutation checked: POST /notes without `id` → the record step has no row to name and the assert fails.
  const value = 'Second call: the pilot list holds.';
  const f = fixture({ fields: [{ field: 'body', value }] });
  const run = await f.runForm(41, { parent: 900 });
  const uid = run.done.proposals[0].uid;
  const saved = await f.call(41, 'POST', '/api/deals/900/notes', { body: value, tag: '' });
  assert.equal(saved.status, 201, saved.text);
  assert.ok(Number.isSafeInteger(saved.body.id) && saved.body.id > 703, 'the new note\'s id');
  const list = await f.call(41, 'GET', '/api/deals/900/notes');
  assert.equal(list.body.items[0].id, saved.body.id, 'the list carries each note\'s id');
  assert.equal((await f.call(42, 'POST', '/api/fills/record', { page: DEAL_ROOM, form: 'deal-note', record: saved.body.id, proposals: [uid] })).status, 403, 'a colleague keeps nothing');
  assert.equal((await f.call(41, 'POST', '/api/fills/record', { page: DEAL_ROOM, form: 'deal-note', record: saved.body.id, proposals: [uid] }, { support: true })).status, 403);
  const kept = await f.call(41, 'POST', '/api/fills/record', { page: DEAL_ROOM, form: 'deal-note', record: saved.body.id, proposals: [uid] });
  assert.deepEqual(kept.body.outcomes.map((o: any) => o.outcome), ['kept']);
  const id = kept.body.outcomes[0].provenance_id;
  // The colleague reads the mark, read-only; the author reads it and could undo.
  const mark = (await f.sheet(42, { record: saved.body.id })).body.fields[0].mark;
  assert.ok(mark, 'a colleague reads the mark');
  assert.equal((await f.call(42, 'POST', `/api/fills/${id}/undo`)).status, 404, 'a reader never undoes');
  const undo = await f.call(41, 'POST', `/api/fills/${id}/undo`);
  assert.deepEqual([undo.status, undo.body.error], [409, 'no_prior']);
  assert.equal((f.db.prepare('SELECT body FROM deal_notes WHERE id = ?').get(saved.body.id) as any).body, value, 'the note keeps its words');
});
