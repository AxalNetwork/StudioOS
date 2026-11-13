/**
 * #4046 Group B2 — Ask on /events/new (an event's title and description) and
 * on a member's answers to a product-testing programme (the owner's calls 5
 * and 2). Composition fields only: an event's times, capacity, price and
 * approval, and a tester's availability and email consent, are never listed.
 *
 *   - /events/new: the new event hangs under the caller, its host (`POST
 *     /api/events` makes the caller its host). Any profile the page admits may
 *     draft one; the run reads the host's own last event titles and nothing
 *     else; the Save's record step keeps the title for its host.
 *   - A programme's answers: under the programme, for a member `apply` would
 *     take now (`mayApplyTo`): an active tester, the programme open, their role
 *     eligible, no application of theirs on it. Anyone else is told it does not
 *     exist. The run reads the programme's questions and the member's own role
 *     and headline, asks only the programme's own questions, and never reads
 *     another tester's answers. After Apply the record step keeps the answers;
 *     an Undo is always refused, as the firm reads what was sent.
 *
 * On the migrated schema, synthetic rows only; the model and the quoter are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_events_testing_4046.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills from '../src/routes/fills.ts';
import events from '../src/routes/events.ts';
import { testing } from '../src/routes/testing.ts';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems } from '../src/services/fills/fields.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { RECORD_SCOPES } from '../src/services/fills/scopes.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const SECRET = 'synthetic-fill-events-testing-4046-'.repeat(3);
test.after(() => removeMigratedDatabases());

const EVENTS = 'Admin · Approvals · Events';
const TESTING = 'Member · Studio · Product testing';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// 11 founder (active tester, headline set); 12 founder, not a tester; 21 advisor (active tester; the
// programme is not open to advisors); 13 founder (active tester, already applied); 51 admin; 61 explorer.
// Programme 700: open, founders only, two questions. 701: closed. Event 900 is founder 12's.
function fixture(output: unknown = { fields: [] }) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(102,'Two','two@example.test'),(103,'Three','three@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active,headline) VALUES
      (11,'Founder','f@example.test','founder',101,1,'Runs a two-person fintech; ships weekly'),
      (12,'Host','h@example.test','founder',102,1,NULL),
      (13,'Applied','ap@example.test','founder',103,1,NULL),
      (21,'Advisor','a@example.test','advisor',NULL,1,NULL),
      (51,'Admin','ad@example.test','admin',NULL,1,NULL),
      (61,'Explorer','x@example.test','exploring',NULL,1,NULL);
    INSERT INTO product_testers(user_id,status,decided_at) VALUES (11,'active','2026-10-01'),(13,'active','2026-10-01'),(21,'active','2026-10-01');
    INSERT INTO testing_programmes(id,uid,owner_kind,created_by,product_name,summary,tester_tasks,places,eligible_roles,questions,status) VALUES
      (700,'pg-open','hq',51,'Ledgerly','A ledger for small teams','Reconcile one month of your books','5','["founder"]','["What do you use for books today?","What would make you switch?"]','open'),
      (701,'pg-closed','hq',51,'Closed one','x','x','5','["founder"]','["Why?"]','closed');
    INSERT INTO testing_applications(uid,programme_id,user_id,answers) VALUES ('ap-13',700,13,'["Another tester uses Sheetsy","Price"]');
    INSERT INTO events(id,slug,host_user_id,type,title,starts_at,status,visibility) VALUES
      (900,'e-900',12,'meetup','Host earlier meetup','2099-01-01T10:00:00Z','draft','private'),
      (901,'e-901',51,'meetup','Admin own launch night','2099-01-02T10:00:00Z','draft','private');
  `);
  const runs: any[] = [];
  const quotes: any[] = [];
  const run = async (_env: any, input: any) => {
    runs.push(input);
    return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: MODEL }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
  };
  const quote = async (_env: any, input: any) => { quotes.push(input); return { ok: true, hold_microusd: 1200, model: MODEL } as any; };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  app.route('/api/events', events);
  app.route('/api/testing', testing);
  const call = async (who: number, method: string, path: string, body?: unknown, opts: { support?: boolean } = {}) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(opts.support ? { impersonated_by: 51 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, page: string, form: string, q: Record<string, string | number> = {}, opts: { support?: boolean } = {}) =>
    call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries({ page, form, ...q }).map(([k, v]) => [k, String(v)]))}`, undefined, opts);
  const runForm = async (who: number, page: string, form: string, body: Record<string, unknown>, opts: { support?: boolean } = {}) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', { page, option: `form:${form}`, ...body }, opts);
    const evs = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: evs.find((e) => e.event === 'done')?.data };
  };
  return { db, call, sheet, runForm, runs, quotes };
}
const prompt = (input: any) => input.messages.map((m: any) => m.content).join('\n');

test('the registry: an event\'s title and description; a programme\'s five answers; never times, price, availability or consent', () => {
  // Mutation checked: an entry dropped from the SPA copy → the deepEqual fails.
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual(fieldsOf(EVENTS, 'event').map((f) => [f.column, f.class]), [['title', 'composition'], ['description', 'composition']]);
  assert.deepEqual(fieldsOf(TESTING, 'testing-answers').map((f) => [f.field, f.table, f.class, f.sources]),
    [1, 2, 3, 4, 5].map((n) => [`answer_${n}`, 'testing_applications', 'composition', ['eadwyn']]));
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'testing_applications' && /availability|consent|status/.test(f.column)));
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'events' && /starts|ends|capacity|price|status|visibility|approval/.test(f.column)));
  assert.equal(UNDO_WRITES['events.title']?.required, true, 'an event cannot be left without a title');
  for (let n = 1; n <= 5; n += 1) assert.deepEqual([UNDO_WRITES[`testing_applications.answer_${n}`]?.scoped, UNDO_WRITES[`testing_applications.answer_${n}`]?.required], [true, true]);
  assert.equal(RECORD_SCOPES.testing_applications.concealed, true);
});

test('/events/new: any profile the page admits drafts one under itself; an Explorer and a support session get no trigger', async () => {
  // Mutation checked: the new-event rule answering NONE → every profile here reads 403 and the run test refuses.
  const f = fixture();
  for (const who of [11, 21, 51]) {
    const r = await f.sheet(who, EVENTS, 'event');
    assert.equal(r.status, 200, `user ${who}: ${r.text}`);
    assert.deepEqual([r.body.scope, r.body.can_fill, r.body.fields.map((x: any) => [x.field, x.trigger])], [`owner:${who}`, true, [['title', true], ['description', true]]], `user ${who}`);
  }
  const explorer = await f.sheet(61, EVENTS, 'event');
  assert.deepEqual([explorer.status, explorer.body.error], [403, 'no_profile']);
  assert.equal((await f.sheet(11, EVENTS, 'event', {}, { support: true })).body.can_fill, false, 'a support session keeps nothing');
  // A saved event is still its host's or an admin's.
  assert.equal((await f.sheet(11, EVENTS, 'event', { record: 900 })).status, 403);
  assert.equal((await f.sheet(12, EVENTS, 'event', { record: 900 })).body.can_fill, true);
});

test('/events/new run: the host\'s own last titles, never another host\'s; nothing is written; filed under the host', async () => {
  // Mutation checked: the host filter dropped from the gather → "Admin own launch night" reaches the founder's prompt.
  const f = fixture({ fields: [{ field: 'title', value: 'Founder breakfast: pricing' }, { field: 'description', value: 'Six founders compare pricing pages.' }, { field: 'capacity', value: '40' }] });
  const run = await f.runForm(12, EVENTS, 'event', { input: { values: { title: '', description: '' } } });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.done.proposals.map((p: any) => p.field), ['title', 'description']);
  assert.deepEqual(run.done.dropped.map((d: any) => [d.field, d.why]), [['capacity', 'unknown_field']]);
  const p = prompt(f.runs[0]);
  assert.match(p, /Host earlier meetup/);
  assert.doesNotMatch(p, /Admin own launch night/);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM events').get() as any).n, 2, 'the run writes nothing');
  const payload = JSON.parse((f.db.prepare('SELECT payload_json FROM ai_rail_proposals').get() as any).payload_json);
  assert.deepEqual([payload.project, payload.scope], [null, 'owner:12']);
});

test('/events/new Save: the new event keeps its host\'s title fill; another member keeps nothing; the title cannot be undone to blank', async () => {
  const f = fixture({ fields: [{ field: 'title', value: 'Founder breakfast: pricing' }] });
  const run = await f.runForm(11, EVENTS, 'event', { input: { values: { title: '', description: 'x' } } });
  const uid = run.done.proposals[0].uid;
  const made = await f.call(11, 'POST', '/api/events', { title: 'Founder breakfast: pricing', starts_at: '2099-02-01T09:00:00Z' });
  assert.equal(made.status, 201, made.text);
  const id = made.body.event.id;
  assert.equal((await f.call(12, 'POST', '/api/fills/record', { page: EVENTS, form: 'event', record: id, proposals: [uid] })).status, 403, 'not their event');
  const kept = await f.call(11, 'POST', '/api/fills/record', { page: EVENTS, form: 'event', record: id, proposals: [uid] });
  assert.deepEqual(kept.body.outcomes.map((o: any) => o.outcome), ['kept'], kept.text);
  const undo = await f.call(11, 'POST', `/api/fills/${kept.body.outcomes[0].provenance_id}/undo`);
  assert.deepEqual([undo.status, undo.body.error], [409, 'no_prior']);
  assert.equal((f.db.prepare('SELECT title FROM events WHERE id = ?').get(id) as any).title, 'Founder breakfast: pricing');
});

test('a programme\'s answers: a member apply would take now; a non-tester, an ineligible role, a closed programme and one already applied to read as nothing', async () => {
  // Mutations checked: the tester check dropped → user 12 reads 200; the NOT EXISTS (already applied) dropped → user 13 reads 200;
  // the role check dropped → the advisor reads 200.
  const f = fixture();
  const ok = await f.sheet(11, TESTING, 'testing-answers', { parent: 700 });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.body.scope, ok.body.can_fill], ['programme:700', true]);
  const none = await f.sheet(11, TESTING, 'testing-answers', { parent: 799 });
  for (const [who, parent, why] of [[12, 700, 'not a tester'], [21, 700, 'not an eligible role'], [11, 701, 'closed'], [13, 700, 'already applied']] as const) {
    const r = await f.sheet(who, TESTING, 'testing-answers', { parent });
    assert.deepEqual([r.status, r.body], [none.status, none.body], why);
  }
  assert.equal(none.status, 404);
  // Another member's application is concealed; its own member reads it while it waits.
  assert.equal((await f.sheet(11, TESTING, 'testing-answers', { record: 1 })).status, 404);
  assert.equal((await f.sheet(13, TESTING, 'testing-answers', { record: 1 })).status, 200);
});

test('a programme\'s answers run: the questions, the member\'s role and headline, only the programme\'s two answers; never another tester\'s', async () => {
  // Mutation checked: the `only` filter in rail_run dropped → answer_3 is asked and kept, not dropped as not_asked.
  const f = fixture({ fields: [{ field: 'answer_1', value: 'I use a spreadsheet today.' }, { field: 'answer_2', value: 'Bank sync that works.' }, { field: 'answer_3', value: 'extra' }, { field: 'availability', value: 'Weekends' }] });
  const run = await f.runForm(11, TESTING, 'testing-answers', { parent: 700, input: { values: {} } });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.done.proposals.map((p: any) => p.field), ['answer_1', 'answer_2']);
  assert.deepEqual(run.done.dropped.map((d: any) => [d.field, d.why]), [['answer_3', 'not_asked'], ['availability', 'unknown_field']]);
  const p = prompt(f.runs[0]);
  assert.match(p, /answer_1 replies to the question: What do you use for books today\?/);
  assert.match(p, /Ledgerly/);
  assert.match(p, /Runs a two-person fintech/);
  assert.match(p, /never claim an experience/);
  assert.doesNotMatch(p, /Sheetsy/, 'another tester\'s answers are never read');
  assert.doesNotMatch(p, /- answer_3/, 'only the programme\'s questions are asked');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM testing_applications').get() as any).n, 1, 'the run writes nothing');
  // A refusal before any hold: someone who may not apply.
  const refused = await f.runForm(12, TESTING, 'testing-answers', { parent: 700, input: { values: {} } });
  assert.equal(refused.status, 404);
  assert.equal(f.quotes.length, 1);
});

test('after Apply: the application carries its id; the member keeps the answers they kept; an edited one is let go; an Undo is refused', async () => {
  // Mutation checked: `id` dropped from applicationDto → the record step has no application to name.
  const f = fixture({ fields: [{ field: 'answer_1', value: 'I use a spreadsheet today.' }, { field: 'answer_2', value: 'Bank sync that works.' }] });
  const run = await f.runForm(11, TESTING, 'testing-answers', { parent: 700, input: { values: {} } });
  const uids = run.done.proposals.map((p: any) => p.uid);
  const applied = await f.call(11, 'POST', '/api/testing/programmes/pg-open/apply', { answers: ['I use a spreadsheet today.', 'Bank sync, and an export.'] });
  assert.equal(applied.status, 201, applied.text);
  const id = applied.body.application.id;
  assert.ok(Number.isSafeInteger(id) && id > 1);
  assert.equal((await f.call(13, 'POST', '/api/fills/record', { page: TESTING, form: 'testing-answers', record: id, proposals: uids })).status, 404, 'another member\'s application');
  const kept = await f.call(11, 'POST', '/api/fills/record', { page: TESTING, form: 'testing-answers', record: id, proposals: uids });
  assert.deepEqual(kept.body.outcomes.map((o: any) => [o.field, o.outcome]), [['answer_1', 'kept'], ['answer_2', 'not_kept']], kept.text);
  const undo = await f.call(11, 'POST', `/api/fills/${kept.body.outcomes[0].provenance_id}/undo`);
  assert.deepEqual([undo.status, undo.body.error], [409, 'no_prior']);
  assert.equal((f.db.prepare('SELECT answers FROM testing_applications WHERE id = ?').get(id) as any).answers, '["I use a spreadsheet today.","Bank sync, and an export."]', 'the firm reads what was sent');
});
