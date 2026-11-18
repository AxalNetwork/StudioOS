/**
 * D6863 (#6863, canvas D6053) — Calls for Capital follow-through, the Worker:
 * the follow-through read, Remind with the owner's limit (owner only, at most
 * 2 per recipient per call, at least 3 days apart), the CSV and PDF exports
 * and their log, a new call started from a closed one, and a response recorded
 * as a Signed or Wired commitment.
 *
 * Real routes and services over the migrated SQLite schema. Every person and
 * figure is made up. Time runs on the test clock.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/round_call_follow_through_6863.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/round_call_follow_through.ts';
import { INDICATED_HEADER } from '../src/services/roundCallFollowThrough.ts';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d6863-01234567890123456789';
const START = Date.parse('2026-11-16T12:00:00.000Z');
const DAY = 86400000;

/**
 * People: 1 the owner; 6 an accepted co-founder; 2 another founder.
 * Recipients of call 1 (sent, open): 4 Ivy chosen and opened; 10 Moe chosen,
 * not opened; 11 Quinn a match, not opened (never named); 12 Rae chosen,
 * responded with $50,000 indicated (a Soft line in the pipeline); 13 Sol chosen,
 * not delivered, account paused; 14 Tam a match who responded (no pipeline line).
 */
function fixture(on = true) {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS, enableForeignKeyConstraints: false });
  loadSchema(db);
  db.exec("INSERT INTO founders(id,name,email) VALUES(1,'Owner','owner@example.test'),(2,'Other','other@example.test'),(6,'Cofounder','co@example.test')");
  const user = db.prepare('INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES(?,?,?,?,?,?,?)');
  for (const row of [[1, 'Owner', 'owner@example.test', 'founder', 1, 'approved', 1], [2, 'Other', 'other@example.test', 'founder', 2, 'approved', 1],
    [6, 'Cofounder', 'co@example.test', 'founder', 6, 'approved', 1],
    [4, 'Ivy', 'ivy@example.test', 'investor', null, 'approved', 1], [10, 'Moe', 'moe@example.test', 'investor', null, 'approved', 1],
    [11, 'Quinn', 'quinn@example.test', 'investor', null, 'approved', 1], [12, 'Rae', 'rae@example.test', 'investor', null, 'approved', 1],
    [13, 'Sol', 'sol@example.test', 'investor', null, 'approved', 0], [14, 'Tam', 'tam@example.test', 'investor', null, 'approved', 1]]) user.run(...row);
  db.exec(`INSERT INTO projects(id,uid,name,founder_id,company_id,sector,stage,description) VALUES
      (1,'energy','Energy',1,NULL,'climate','seed','energy storage'),(2,'other','Other',2,NULL,'climate','seed','other');
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,6,'cofounder','accepted');
    INSERT INTO data_room_folders(uid,project_id,name) VALUES('folder',1,'Diligence');
    INSERT INTO raise_prospects(id,uid,project_id,name,email,stage,commit_status,amount) VALUES
      (1,'p1',1,'Rae','rae@example.test','committed','soft',50000),(2,'p2',1,'Ivy','ivy@example.test','contacted',NULL,NULL);
    INSERT INTO round_calls(id,uid,project_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,data_room_project_uid,stage,sector,state,terms_hash,created_by,sent_at,valuation_cap_cents,counsel_approved_at)
      VALUES(1,'call',1,'Bridge',40000000,'safe','Plain terms',2500000,'2099-01-15','energy','seed','climate','sent','h',1,'2026-11-06',800000000,'2026-11-05');
    INSERT INTO round_call_recipients(id,call_id,investor_user_id,origin,match_reasons_json,opened_at,responded_at,commitment_cents,delivery_state) VALUES
      (1,1,4,'chosen','[]','2026-11-07',NULL,NULL,'notified'),(2,1,10,'chosen','[]',NULL,NULL,NULL,'notified'),
      (3,1,11,'match','["Climate"]',NULL,NULL,NULL,'notified'),(4,1,12,'chosen','[]','2026-11-07','2026-11-08',5000000,'notified'),
      (5,1,13,'chosen','[]',NULL,NULL,NULL,'not_delivered'),(6,1,14,'match','["Climate"]','2026-11-07','2026-11-09',2500000,'notified');
    INSERT INTO round_call_questions(uid,call_id,investor_user_id,question,answer) VALUES ('q1',1,12,'Is the cap post-money?','Yes'),('q2',1,12,'Where do we wire?',NULL);`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production', ROUND_CALLS_ENABLED: on ? 'true' : 'false' };
  return { db, env };
}

async function call(f: any, path: string, who: number | null = 1, method = 'GET', body?: unknown) {
  const app = new Hono<any>(); app.route('/round-calls', routes);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const headers: any = {};
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = console.error; console.error = () => {};
  try {
    const res = await app.request('/round-calls' + path, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } }, f.env);
    const type = res.headers.get('Content-Type') || '';
    if (type.includes('json')) return { status: res.status, body: await res.json() as any, type };
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, body: null as any, text: new TextDecoder().decode(bytes), type, disposition: res.headers.get('Content-Disposition') };
  } finally { console.error = saved; }
}
const clock = () => { mock.timers.enable({ apis: ['Date'], now: START }); };
const at = (ms: number) => mock.timers.setTime(ms);
const counts = (f: any) => f.db.prepare('SELECT id,reminder_count AS n FROM round_call_recipients ORDER BY id').all().map((r: any) => [r.id, r.n]);
const notices = (f: any) => Number((f.db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type='round_call_reminder'").get() as any).n);

test.afterEach(() => mock.timers.reset());

test('the read groups recipients, keeps an unresponsive match nameless and says what this viewer may do', async () => {
  // Mutation checked: a match named before responding; the not-delivered group read as not opened; remind open to a co-founder.
  clock();
  const f = fixture();
  const r = await call(f, '/call/follow-through');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.counts, { recipients: 6, not_opened: 2, opened_unanswered: 1, not_delivered: 1, responded: 2 });
  const quinn = r.body.recipients.find((x: any) => x.recipient_id === 3);
  assert.deepEqual([quinn.named, quinn.name, quinn.investor_user_id, quinn.group], [false, undefined, undefined, 'not_opened']);
  assert.doesNotMatch(JSON.stringify(r.body), /quinn|@example/i, 'no unresponsive match and no email');
  const tam = r.body.recipients.find((x: any) => x.recipient_id === 6);
  assert.deepEqual([tam.named, tam.name, tam.in_pipeline], [true, 'Tam', false]);
  const rae = r.body.recipients.find((x: any) => x.recipient_id === 4);
  assert.deepEqual([rae.line.status, rae.in_pipeline], ['soft', true]);
  assert.deepEqual([r.body.relation, r.body.can.remind, r.body.can.export, r.body.can.record], ['owner', true, true, true]);
  const member = await call(f, '/call/follow-through', 6);
  assert.deepEqual([member.body.relation, member.body.can.remind, member.body.can.export, member.body.can.record], ['member', false, false, true]);
  assert.equal((await call(f, '/call/follow-through', 2)).status, 404, 'another founder does not find the call');
  assert.equal((await call(fixture(false), '/call/follow-through')).status, 503, 'calls switched off');
});

test('Remind is the owner\'s, reaches the chosen recipients in the app and names who was not reminded and why', async () => {
  // Mutation checked: the owner check dropped (member 200); a responded recipient reminded; a paused account reminded;
  // the in-app notice not sent.
  clock();
  const f = fixture();
  const member = await call(f, '/call/remind', 6, 'POST', { recipient_ids: [1] });
  assert.deepEqual([member.status, member.body.code], [403, 'owner_only']);
  const r = await call(f, '/call/remind', 1, 'POST', { recipient_ids: [1, 2, 3, 4, 5] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.asked, r.body.reminded], [5, 3]);
  assert.deepEqual(r.body.not_reminded.map((x: any) => [x.recipient_id, x.reason]), [[4, 'responded'], [5, 'account_unavailable']]);
  assert.equal(notices(f), 3);
  assert.deepEqual(counts(f), [[1, 1], [2, 1], [3, 1], [4, 0], [5, 0], [6, 0]]);
  assert.equal((await call(f, '/call/remind', 1, 'POST', { recipient_ids: [99] })).status, 404, 'a recipient of no call');
  assert.equal((await call(f, '/call/remind', 1, 'POST', { recipient_ids: [] })).status, 400);
});

test('the limit: at most 2 reminders per recipient per call, at least 3 days apart, enforced by the Worker', async () => {
  // Mutation checked: REMIND_LIMIT 3 (a third reminder goes); the spacing check removed from blockOf (day 2 goes)
  // and from the claim's SQL (a stale read still cannot remind early); spacing of 2 days.
  clock();
  const f = fixture();
  assert.equal((await call(f, '/call/remind', 1, 'POST', { recipient_ids: [2] })).body.reminded, 1);
  const soon = await call(f, '/call/remind', 1, 'POST', { recipient_ids: [2] });
  assert.deepEqual([soon.body.reminded, soon.body.not_reminded[0].reason, soon.body.not_reminded[0].next_reminder_from], [0, 'too_soon', '2026-11-19T12:00:00.000Z']);
  at(START + 2 * DAY + 23 * 3600000);
  assert.equal((await call(f, '/call/remind', 1, 'POST', { recipient_ids: [2] })).body.not_reminded[0]?.reason, 'too_soon', 'two days and 23 hours is too soon');
  at(START + 3 * DAY);
  assert.equal((await call(f, '/call/remind', 1, 'POST', { recipient_ids: [2] })).body.reminded, 1, 'three days later');
  at(START + 30 * DAY);
  const third = await call(f, '/call/remind', 1, 'POST', { recipient_ids: [2] });
  assert.deepEqual([third.body.reminded, third.body.not_reminded[0].reason], [0, 'limit']);
  assert.deepEqual(counts(f)[1], [2, 2]);
  assert.equal(notices(f), 2);
  // The claim re-checks the limit and spacing itself: a row the read thought free still cannot pass them.
  f.db.exec("UPDATE round_call_recipients SET reminder_count=1,last_reminded_at='2026-12-16T00:00:00.000Z' WHERE id=1");
  const stale = await call(f, '/call/remind', 1, 'POST', { recipient_ids: [1] });
  assert.equal(stale.body.not_reminded[0].reason, 'too_soon');
});

test('Remind is off with its reason on a call that cannot take reminders', async () => {
  // Mutation checked: remindState ignoring a past close date; a closed call reminded.
  clock();
  const f = fixture();
  f.db.exec("UPDATE round_calls SET target_close='2026-11-01'");
  const past = await call(f, '/call/remind', 1, 'POST', { recipient_ids: [1] });
  assert.deepEqual([past.status, past.body.code], [409, 'call_past_close']);
  f.db.exec("UPDATE round_calls SET state='closed',closed_at='2026-11-02'");
  assert.equal((await call(f, '/call/remind', 1, 'POST', { recipient_ids: [1] })).body.code, 'call_closed');
  const read = await call(f, '/call/follow-through');
  assert.deepEqual([read.body.can.remind, read.body.remind.reason], [false, 'call_closed']);
  assert.equal(notices(f), 0);
});

test('Export: the owner\'s, CSV and PDF, indicated never committed, emails and unnamed matches withheld, each export logged', async () => {
  // Mutation checked: the owner check dropped; an email written to the file; the unnamed match written; the log row skipped;
  // the questions failure swallowed as zero.
  clock();
  const f = fixture();
  assert.equal((await call(f, '/call/export.csv', 6)).status, 403);
  const csv = await call(f, '/call/export.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.disposition!, /call-responses-2026-11-16\.csv/);
  assert.ok(csv.text!.includes(INDICATED_HEADER));
  assert.match(csv.text!, /Rae,Chosen,2026-11-07,,2026-11-08,50000\.00,2 · 1 answered/);
  assert.match(csv.text!, /Tam,"?Matching, responded"?/);
  assert.match(csv.text!, /1 matching investors, not named \(counted only\)/);
  assert.doesNotMatch(csv.text!, /@example|Quinn/);
  const pdf = await call(f, '/call/export.pdf?scope=terms');
  assert.deepEqual([pdf.status, pdf.text!.slice(0, 5)], [200, '%PDF-']);
  const log = f.db.prepare('SELECT format,scope,questions_state,named_count,responded_count,withheld_matches,exported_by FROM round_call_exports ORDER BY id').all();
  assert.deepEqual(log.map((r: any) => ({ ...r })), [
    { format: 'csv', scope: 'responses', questions_state: 'read', named_count: 5, responded_count: 2, withheld_matches: 1, exported_by: 1 },
    { format: 'pdf', scope: 'terms', questions_state: 'not_included', named_count: 0, responded_count: 0, withheld_matches: 0, exported_by: 1 }]);
  const read = await call(f, '/call/follow-through');
  assert.deepEqual(read.body.exports.map((e: any) => [e.format, e.scope, e.exported_by_name, e.exported_by_you]), [['pdf', 'terms', 'Owner', true], ['csv', 'responses', 'Owner', true]]);
  f.db.exec('DROP TABLE round_call_questions');
  const partial = await call(f, '/call/export.csv');
  assert.match(partial.text!, /^.*\r\n.*\r\nQuestions could not be read/);
  assert.equal((f.db.prepare('SELECT questions_state FROM round_call_exports ORDER BY id DESC LIMIT 1').get() as any).questions_state, 'unreadable');
  f.db.exec("UPDATE round_calls SET state='draft'");
  assert.equal((await call(f, '/call/export.csv')).body.code, 'call_draft');
});

test('A new call from a closed one: terms and the data room carry, the close date, counsel and deck do not; one call at a time', async () => {
  // Mutation checked: the closed-state check dropped; the open-call block dropped; the deck carried; source_call_id not written.
  clock();
  const f = fixture();
  const input = { name: 'Bridge two', target_close: '2099-03-01' };
  assert.equal((await call(f, '/call/successor', 1, 'POST', input)).body.code, 'source_not_closed');
  f.db.exec("UPDATE round_calls SET state='closed',closed_at='2026-11-10',deck_id=1,deck_version=2,counsel_approved_hash='h',counsel_approved_by=9,counsel_approval_reference='ref' WHERE id=1");
  f.db.exec("INSERT INTO round_calls(id,uid,project_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,state,terms_hash,created_by) VALUES(2,'open',1,'Open now',100000,'safe','t',100000,'2099-01-01','sent','h2',1)");
  const blocked = await call(f, '/call/successor', 6, 'POST', input);
  assert.deepEqual([blocked.status, blocked.body.code, blocked.body.message], [409, 'another_call_open', 'One call at a time. Open now is open.']);
  assert.deepEqual((await call(f, '/call/follow-through')).body.start_new, { on: false, sentence: 'One call at a time. Open now is open.' });
  f.db.exec("UPDATE round_calls SET state='closed' WHERE id=2");
  assert.equal((await call(f, '/call/successor', 6, 'POST', { ...input, name: 'Bridge' })).body.code, 'new_name_required');
  const made = await call(f, '/call/successor', 6, 'POST', input);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const row = f.db.prepare("SELECT * FROM round_calls WHERE uid=?").get(made.body.call.uid) as any;
  assert.deepEqual([row.state, row.source_call_id, row.amount_cents, row.minimum_cheque_cents, row.valuation_cap_cents, row.terms, row.data_room_project_uid, row.target_close, row.deck_id, row.counsel_approved_hash, row.created_by],
    ['draft', 1, 40000000, 2500000, 800000000, 'Plain terms', 'energy', '2099-03-01', null, null, 6]);
  const read = await call(f, `/${made.body.call.uid}/follow-through`, 6);
  assert.deepEqual(read.body.source, { uid: 'call', name: 'Bridge', closed_at: '2026-11-10' });
  assert.equal((await call(f, '/call/successor', 1, 'POST', { ...input, name: 'Third' })).body.code, 'another_call_open', 'the new draft blocks another');
});

test('Record a commitment: only the typed amount moves the line to Signed or Wired, linked to the call; conflicts are refused', async () => {
  // Mutation checked: Wired overwritten; another currency recorded; a blank amount recorded as 0; the call uid not stored;
  // the indicated amount moved instead of the typed one.
  clock();
  const f = fixture();
  const blank = await call(f, '/call/commitments', 6, 'POST', { recipient_id: 4, status: 'signed', amount_cents: '' });
  assert.deepEqual([blank.status, blank.body.code], [400, 'amount_required']);
  const signed = await call(f, '/call/commitments', 6, 'POST', { recipient_id: 4, status: 'signed', amount_cents: 4500000 });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const line = () => ({ ...f.db.prepare('SELECT stage,commit_status,amount,amount_cents,round_call_uid FROM raise_prospects WHERE id=1').get() as any });
  assert.deepEqual(line(), { stage: 'committed', commit_status: 'signed', amount: 45000, amount_cents: 4500000, round_call_uid: 'call' });
  assert.equal((f.db.prepare('SELECT commitment_cents FROM round_call_recipients WHERE id=4').get() as any).commitment_cents, 5000000, 'the indicated amount is untouched');
  assert.equal((await call(f, '/call/commitments', 1, 'POST', { recipient_id: 4, status: 'signed', amount_cents: 4500000 })).body.code, 'already_signed');
  assert.equal((await call(f, '/call/commitments', 1, 'POST', { recipient_id: 4, status: 'wired', amount_cents: 4500000 })).status, 200);
  const wired = await call(f, '/call/commitments', 1, 'POST', { recipient_id: 4, status: 'wired', amount_cents: 1000000 });
  assert.deepEqual([wired.status, wired.body.code, line().amount_cents], [409, 'already_wired', 4500000]);
  assert.equal((await call(f, '/call/commitments', 1, 'POST', { recipient_id: 6, status: 'signed', amount_cents: 100 })).body.code, 'no_pipeline_line');
  assert.equal((await call(f, '/call/commitments', 1, 'POST', { recipient_id: 1, status: 'signed', amount_cents: 100 })).body.code, 'not_responded');
  f.db.exec("UPDATE raise_prospects SET currency='EUR',commit_status=NULL WHERE id=1");
  assert.equal((await call(f, '/call/commitments', 1, 'POST', { recipient_id: 4, status: 'signed', amount_cents: 100 })).body.code, 'other_currency');
  assert.equal((await call(f, '/call/commitments', 2, 'POST', { recipient_id: 4, status: 'signed', amount_cents: 100 })).status, 404, 'another founder');
});
