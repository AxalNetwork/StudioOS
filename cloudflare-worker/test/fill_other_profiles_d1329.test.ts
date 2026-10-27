/**
 * D1329 (#3490, #2431 part 6) — Fill with Eadwyn on records that are not a
 * venture's: an advisor's service, a partner's status report, an event and
 * its agenda, a publication and an IC memo. Each keeps its own route's write
 * check (`services/fills/scopes.ts`): who gets the trigger, who reads marks
 * only, who is refused; and the run, the record, Accept all and the undo on
 * that scope.
 *
 * On the migrated schema, synthetic rows only; the model is a stub runner.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_other_profiles_d1329.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills, { ROW_READS } from '../src/routes/fills.ts';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems } from '../src/services/fills/fields.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { RECORD_SCOPES } from '../src/services/fills/scopes.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const SECRET = 'synthetic-fill-profiles-d1329-'.repeat(3);
test.after(() => removeMigratedDatabases());

const COMMIT = 'Investor · Deals · Commit';
const SERVICES = 'Advisor · Expertise · Services';
const REPORTING = 'Operating Partner · Delivery · Reporting';
const EVENTS = 'Admin · Approvals · Events';
const PUBLICATIONS = 'Super Admin · Content · Publications';
const MONTH = new Date().toISOString().slice(0, 7);

type Run = (env: any, input: any) => Promise<any>;
const answer = (output: unknown): Run => async () => ({
  ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 },
});
const freeQuote = async () => ({ ok: true, hold_microusd: 1200, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }) as any;

// 11 founder (client of engagement 401), 21 advisor, 22 another advisor, 31 partner, 32 another partner,
// 41 investor who wrote IC 501, 42 investor who votes on it, 43 investor outside, 51 admin, 52 event host (founder), 61 explorer.
function fixture(run: Run = answer({ fields: [] })) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(152,'Host','host@example.test');
    INSERT INTO partners(id,uid,name,email) VALUES (301,'p-1','Partner One','p1@example.test'),(302,'p-2','Partner Two','p2@example.test');
    INSERT INTO users(id,name,email,role,founder_id,partner_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,NULL,1),(21,'Advisor','a@example.test','advisor',NULL,NULL,1),(22,'Advisor Two','a2@example.test','advisor',NULL,NULL,1),
      (31,'Partner','p@example.test','partner',NULL,301,1),(32,'Partner Two','p2u@example.test','partner',NULL,302,1),
      (41,'Investor','i@example.test','investor',NULL,NULL,1),(42,'Voter','v@example.test','investor',NULL,NULL,1),(43,'Outsider','o@example.test','investor',NULL,NULL,1),
      (51,'Admin','h@example.test','admin',NULL,NULL,1),(52,'Host','host@example.test','founder',152,NULL,1),(61,'Explorer','e@example.test','exploring',NULL,NULL,1);
    INSERT INTO advisors(id,uid,user_id,display_name,email) VALUES (201,'a-1',21,'Advisor','a@example.test'),(202,'a-2',22,'Advisor Two','a2@example.test');
    INSERT INTO advisor_services(id,uid,advisor_id,title,kind,scope) VALUES (601,'s-1',201,'Pricing sprint','fixed',NULL),(602,'s-2',202,'Theirs','fixed',NULL);
    INSERT INTO advisor_proof_items(id,uid,advisor_id,kind,title) VALUES (701,'o-1',201,'outcome','[Company A] doubled paid pilots'),(702,'o-2',202,'outcome','Not mine');
    INSERT INTO projects(id,uid,name,founder_id) VALUES (801,'v-acme','Acme Field',101);
    INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price,status) VALUES (401,'e-1',1,1,301,101,801,1,'active');
    INSERT INTO engagement_status_reports(id,uid,engagement_id,period,state,shipped,next_up) VALUES (411,'r-1',401,'${MONTH}','draft',NULL,NULL),(412,'r-2',401,'2026-01','sent','Sent text',NULL);
    INSERT INTO engagement_deliverables(id,uid,engagement_id,title,sent_at) VALUES (421,'d-1',401,'Pricing deck v2','${MONTH}-03T10:00:00Z'),(422,'d-2',401,'Old thing','2025-01-03T10:00:00Z');
    INSERT INTO engagement_milestones(id,uid,engagement_id,title,due_at,completed_at) VALUES (431,'m-1',401,'Pilot pricing call',NULL,NULL),(432,'m-2',401,'Done one',NULL,'2026-01-01');
    INSERT INTO events(id,slug,host_user_id,type,title,description,status,visibility,starts_at) VALUES (901,'breakfast',52,'meetup','Founder Breakfast',NULL,'draft','public','2026-11-14T08:30:00Z');
    INSERT INTO event_agenda_items(id,event_id,title,display_order) VALUES (911,901,'Welcome',0);
    INSERT INTO admin_publications(id,slug,title,section,summary_text,created_by) VALUES (951,'letter-q3','Studio letter',' content','',51);
    INSERT INTO ic_decisions(id,uid,project_id,title,memo,status,created_by) VALUES (501,'ic-1',801,'Acme seed',NULL,'voting',41),(502,'ic-2',801,'Acme decided',NULL,'decided',41);
    INSERT INTO ic_votes(ic_decision_id,user_id,vote) VALUES (501,42,'yes');
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote: freeQuote }));
  app.route('/api/fills', fills);
  const call = async (who: number, method: string, path: string, body?: unknown, support = false) => {
    const u = db.prepare('SELECT role, partner_id, founder_id FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(support ? { impersonated_by: 51 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, q: Record<string, string | number>, support = false) => call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`, undefined, support);
  const runForm = async (who: number, body: Record<string, unknown>) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', body);
    const events = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: events.find((e) => e.event === 'done')?.data };
  };
  return { db, env, call, sheet, runForm };
}
const byField = (body: any) => Object.fromEntries(body.fields.map((f: any) => [f.field, f]));

test('the registry: each profile\'s fields in both copies; no amount, legal name, approval, decision, term or member\'s record', () => {
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual(fieldsOf(COMMIT, 'ic-memo').map((f) => f.column), ['memo']);
  assert.deepEqual(fieldsOf(SERVICES, 'service').map((f) => f.column), ['title', 'scope']);
  assert.deepEqual(fieldsOf(REPORTING, 'status-report').map((f) => [f.column, f.sources]), [['shipped', ['module:delivery/engagement']], ['next_up', ['module:delivery/engagement']]]);
  assert.deepEqual(fieldsOf(EVENTS, 'event').map((f) => f.column), ['description']);
  assert.deepEqual(fieldsOf(EVENTS, 'agenda-item').map((f) => f.column), ['title', 'description']);
  assert.deepEqual(fieldsOf(PUBLICATIONS, 'publication').map((f) => f.column), ['summary_text']);
  const scoped = FILL_FIELDS.filter((f) => RECORD_SCOPES[f.table]);
  for (const f of scoped) {
    assert.ok(!/^(price_cents|currency|terms_json|decision|outcome|status|approved_at|review_note|approval_required|admin_published|capacity|full_legal_name|legal_name|is_active|state|sent_at)$/.test(f.column), `${f.table}.${f.column}`);
    assert.ok(UNDO_WRITES[`${f.table}.${f.column}`]?.scoped, `${f.table}.${f.column} has its scoped undo`);
    assert.ok(ROW_READS[f.table], `${f.table} has its read`);
  }
  for (const t of ['users', 'founders', 'advisors', 'partners', 'investors']) assert.ok(!FILL_FIELDS.some((f) => f.table === t), `${t} is a member's record`);
  // The venture's statements are untouched, and the scoped reads bind the id alone.
  for (const [t, s] of Object.entries(RECORD_SCOPES)) assert.equal((s.read.match(/\?/g) || []).length, 1, t);
  assert.doesNotMatch(readFileSync('cloudflare-worker/src/services/fills/scopes.ts', 'utf8'), /\.prepare\(`[^`]*\$\{/);
});

test('AF18: the advisor fills their own service; another advisor, an investor and the Explorer are refused; a support session reads marks only', async () => {
  const f = fixture();
  const own = await f.sheet(21, { page: SERVICES, form: 'service' });
  assert.equal(own.status, 200);
  assert.deepEqual([own.body.project, own.body.scope, own.body.can_fill], [null, 'advisor:201', true]);
  assert.deepEqual(own.body.fields.map((x: any) => x.trigger), [true, true]);
  assert.deepEqual(byField(own.body).scope.choices.map((c: any) => c.label), ['[Company A] doubled paid pilots'], 'the advisor\'s own outcomes only');
  const record = await f.sheet(21, { page: SERVICES, form: 'service', record: 601 });
  assert.deepEqual([record.body.record, byField(record.body).title.trigger, byField(record.body).scope.trigger], ['advisor_services:601', false, true]);
  assert.equal((await f.sheet(21, { page: SERVICES, form: 'service', record: 602 })).status, 403, 'another advisor\'s service');
  assert.equal((await f.sheet(41, { page: SERVICES, form: 'service' })).status, 403, 'an investor has no advisor profile');
  const explorer = await f.sheet(61, { page: SERVICES, form: 'service' });
  assert.deepEqual([explorer.status, explorer.body.detail], [403, 'Fill opens once you hold a venture or a profile.']);
  const support = await f.sheet(21, { page: SERVICES, form: 'service', record: 601 }, true);
  assert.deepEqual([support.status, support.body.can_fill, support.body.fields.some((x: any) => x.trigger)], [200, false, false]);
});

test('AF19: Done and Next come from the engagement record at no AI tokens; a sent report and the client read marks only', async () => {
  const f = fixture();
  const draft = await f.sheet(31, { page: REPORTING, form: 'status-report', record: 411 });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.can_fill, true);
  const by = byField(draft.body);
  assert.deepEqual(by.shipped.waiting.map((w: any) => [w.value, w.label]), [['Pricing deck v2', 'From the engagement record']], 'this month\'s sent deliverables only');
  assert.deepEqual(by.next_up.waiting.map((w: any) => w.value), ['Pilot pricing call'], 'open milestones only');
  assert.deepEqual([by.shipped.offered_to_eadwyn, by.next_up.offered_to_eadwyn], [false, false]);
  const run = await f.runForm(31, { page: REPORTING, option: 'form:status-report', record: { type: 'engagement_status_reports', id: 411 } });
  assert.deepEqual([run.status, run.body.error], [400, 'nothing_to_fill'], 'no model is run for the engagement record');
  const sent = await f.sheet(31, { page: REPORTING, form: 'status-report', record: 412 });
  assert.deepEqual([sent.status, sent.body.can_fill], [200, false], 'a sent report is a record of what the client received');
  const client = await f.sheet(11, { page: REPORTING, form: 'status-report', record: 411 });
  assert.deepEqual([client.status, client.body.can_fill, byField(client.body).shipped.waiting], [200, false, []]);
  assert.equal((await f.sheet(32, { page: REPORTING, form: 'status-report', record: 411 })).status, 403);
  const add = await f.sheet(31, { page: REPORTING, form: 'status-report', parent: 401 });
  assert.deepEqual([add.status, add.body.scope], [200, 'engagement:401']);
  assert.equal((await f.sheet(32, { page: REPORTING, form: 'status-report', parent: 401 })).status, 403);
});

test('AF20 and AF21: an admin or the host fills event content; approvals and publications have no trigger for anyone else', async () => {
  const f = fixture();
  for (const who of [51, 52]) assert.equal((await f.sheet(who, { page: EVENTS, form: 'event', record: 901 })).body.can_fill, true, `user ${who}`);
  assert.equal((await f.sheet(11, { page: EVENTS, form: 'event', record: 901 })).status, 403);
  assert.equal((await f.sheet(51, { page: EVENTS, form: 'review', record: 901 })).status, 404, 'an approval has no form Eadwyn fills');
  assert.equal((await f.sheet(51, { page: EVENTS, form: 'event' })).status, 404, 'an event is edited here, not added');
  assert.equal((await f.sheet(51, { page: PUBLICATIONS, form: 'publication', record: 951 })).body.can_fill, true);
  assert.equal((await f.sheet(52, { page: PUBLICATIONS, form: 'publication', record: 951 })).status, 403);
});

test('AF17: the IC memo\'s author fills it until it is decided; a voter and an admin read marks only; an outsider is refused', async () => {
  const f = fixture();
  assert.equal((await f.sheet(41, { page: COMMIT, form: 'ic-memo', record: 501 })).body.can_fill, true);
  for (const who of [42, 51]) {
    const r = await f.sheet(who, { page: COMMIT, form: 'ic-memo', record: 501 });
    assert.deepEqual([r.status, r.body.can_fill], [200, false], `user ${who}: no trigger on another member's decision record`);
  }
  assert.equal((await f.sheet(43, { page: COMMIT, form: 'ic-memo', record: 501 })).status, 403);
  assert.equal((await f.sheet(41, { page: COMMIT, form: 'ic-memo', record: 502 })).body.can_fill, false, 'a decided memo');
  const run = await f.runForm(51, { page: COMMIT, option: 'form:ic-memo', record: { type: 'ic_decisions', id: 501 } });
  assert.deepEqual([run.status, run.body.error], [403, 'record_not_available']);
});

test('the run, the Save and the undo on a scoped record: filed under the record, kept only as proposed, undone only by its writer', async () => {
  const f = fixture(answer({ fields: [{ field: 'scope', value: 'A two-week pricing sprint' }, { field: 'price_cents', value: '500000' }] }));
  const run = await f.runForm(21, { page: SERVICES, option: 'form:service', record: { type: 'advisor_services', id: 601 } });
  assert.equal(run.status, 200);
  assert.deepEqual(run.done.proposals.map((p: any) => [p.field, p.value]), [['scope', 'A two-week pricing sprint']]);
  assert.deepEqual(run.done.dropped.map((d: any) => [d.field, d.why]), [['price_cents', 'never_fill']]);
  const payload = JSON.parse((f.db.prepare('SELECT payload_json FROM ai_rail_proposals').get() as any).payload_json);
  assert.deepEqual([payload.project, payload.scope], [null, 'advisor_services:601']);
  assert.equal((f.db.prepare('SELECT scope FROM advisor_services WHERE id = 601').get() as any).scope, null, 'the run writes nothing');
  // Another advisor cannot run on it, nor keep it.
  assert.equal((await f.runForm(22, { page: SERVICES, option: 'form:service', record: { type: 'advisor_services', id: 601 } })).status, 403);
  f.db.exec("UPDATE advisor_services SET scope = 'A two-week pricing sprint' WHERE id = 601");
  // A proposal made on one record is never kept on another, even the same advisor's.
  f.db.exec("INSERT INTO advisor_services(id,uid,advisor_id,title,kind,scope) VALUES (604,'s-4',201,'Other','fixed','A two-week pricing sprint')");
  const elsewhere = await f.call(21, 'POST', '/api/fills/record', { page: SERVICES, form: 'service', record: 604, proposals: [run.done.proposals[0].uid] });
  assert.deepEqual(elsewhere.body.outcomes.map((o: any) => [o.outcome, o.why]), [['refused', 'other_record']]);
  assert.equal((await f.call(22, 'POST', '/api/fills/record', { page: SERVICES, form: 'service', record: 601, proposals: [run.done.proposals[0].uid] })).status, 403);
  assert.equal((await f.call(21, 'POST', '/api/fills/record', { page: SERVICES, form: 'service', record: 601, proposals: [run.done.proposals[0].uid] }, true)).status, 403, 'a support session keeps nothing');
  const kept = await f.call(21, 'POST', '/api/fills/record', { page: SERVICES, form: 'service', record: 601, proposals: [run.done.proposals[0].uid] });
  assert.deepEqual(kept.body.outcomes.map((o: any) => o.outcome), ['kept']);
  const id = kept.body.outcomes[0].provenance_id;
  // The mark reads on the record's sheet.
  assert.ok(byField((await f.sheet(21, { page: SERVICES, form: 'service', record: 601 })).body).scope.mark);
  assert.equal((await f.call(22, 'POST', `/api/fills/${id}/undo`)).status, 404, 'another advisor reads it as no fill');
  assert.equal((await f.call(21, 'POST', `/api/fills/${id}/undo`, undefined, true)).status, 403);
  f.db.exec("UPDATE advisor_services SET scope = 'Mine now' WHERE id = 601");
  assert.equal((await f.call(21, 'POST', `/api/fills/${id}/undo`)).body.error, 'edited');
  f.db.exec("UPDATE advisor_services SET scope = 'A two-week pricing sprint' WHERE id = 601");
  const u = await f.call(21, 'POST', `/api/fills/${id}/undo`);
  assert.equal(u.status, 200);
  assert.equal((f.db.prepare('SELECT scope FROM advisor_services WHERE id = 601').get() as any).scope, null);
});

test('an Add form under its parent: a new service\'s Save keeps what was proposed for the advisor; agenda rows are written under their event only', async () => {
  let f = fixture(answer({ fields: [{ field: 'title', value: 'Pilot pricing review' }] }));
  const run = await f.runForm(21, { page: SERVICES, option: 'form:service', input: { values: {} } });
  assert.equal(run.done.proposals.length, 1);
  // The service route's own Save, then the record of what it kept.
  f.db.exec("INSERT INTO advisor_services(id,uid,advisor_id,title,kind) VALUES (603,'s-3',201,'Pilot pricing review','fixed')");
  const kept = await f.call(21, 'POST', '/api/fills/record', { page: SERVICES, form: 'service', record: 603, proposals: [run.done.proposals[0].uid] });
  assert.deepEqual(kept.body.outcomes.map((o: any) => o.outcome), ['kept']);

  f = fixture(answer({ rows: [{ title: 'Pricing workshop', description: 'Bring your price sheet' }, { description: 'No title' }] }));
  const rows = await f.runForm(52, { page: EVENTS, option: 'form:agenda-item', parent: 901, input: { rows: 2 } });
  assert.equal(rows.done.proposals.length, 1, 'a session needs a title');
  assert.equal((await f.call(11, 'POST', '/api/fills/rows/accept', { page: EVENTS, form: 'agenda-item', parent: 901, proposals: [rows.done.proposals[0].uid] })).status, 403);
  f.db.exec("INSERT INTO events(id,slug,host_user_id,type,title,status,visibility,starts_at) VALUES (902,'other',52,'meetup','Other','draft','public','2026-11-20T08:30:00Z')");
  const wrong = await f.call(52, 'POST', '/api/fills/rows/accept', { page: EVENTS, form: 'agenda-item', parent: 902, proposals: [rows.done.proposals[0].uid] });
  assert.deepEqual(wrong.body.outcomes.map((o: any) => [o.outcome, o.why]), [['refused', 'other_record']]);
  const ok = await f.call(52, 'POST', '/api/fills/rows/accept', { page: EVENTS, form: 'agenda-item', parent: 901, proposals: [rows.done.proposals[0].uid] });
  assert.equal(ok.body.outcomes[0].outcome, 'created');
  assert.deepEqual(f.db.prepare('SELECT event_id, title, description, display_order FROM event_agenda_items ORDER BY id').all().map((r: any) => [r.event_id, r.title, r.description, r.display_order]),
    [[901, 'Welcome', null, 0], [901, 'Pricing workshop', 'Bring your price sheet', 1]]);
});

test('a reader never undoes: an IC memo\'s voter and an admin read the fill and get 404 for its undo', async () => {
  const f = fixture(answer({ fields: [{ field: 'memo', value: 'Fits the seed thesis on site software.' }] }));
  const run = await f.runForm(41, { page: COMMIT, option: 'form:ic-memo', record: { type: 'ic_decisions', id: 501 } });
  assert.equal(run.done.proposals.length, 1);
  f.db.exec("UPDATE ic_decisions SET memo = 'Fits the seed thesis on site software.' WHERE id = 501");
  const kept = await f.call(41, 'POST', '/api/fills/record', { page: COMMIT, form: 'ic-memo', record: 501, proposals: [run.done.proposals[0].uid] });
  const id = kept.body.outcomes[0].provenance_id;
  assert.ok(id);
  for (const who of [42, 51]) assert.equal((await f.call(who, 'POST', `/api/fills/${id}/undo`)).status, 404, `user ${who} reads, never undoes`);
  assert.equal((f.db.prepare('SELECT memo FROM ic_decisions WHERE id = 501').get() as any).memo, 'Fits the seed thesis on site software.');
  assert.equal((await f.call(41, 'POST', `/api/fills/${id}/undo`)).status, 200);
});
