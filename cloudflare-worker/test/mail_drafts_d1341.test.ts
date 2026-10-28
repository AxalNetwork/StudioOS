/**
 * D1341 (#3549, part 2 of #3547): Eadwyn's email drafts. Synthetic data, the
 * mounted Worker routes and the real migrated schema; `env.AI` is a stub and
 * `fetch` throws.
 *
 *   · a ref the member cannot read is 404 in the words of one that does not exist;
 *   · an unticked record never reaches the prompt;
 *   · the draft is charged what the router charged, never more than its estimate;
 *   · a short balance is 402 in the top-up sentence, and nothing is stored;
 *   · a block with nothing recorded, or that the member cannot read, is no block;
 *   · a revision is a new row that keeps its parent.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import mail from '../src/routes/mail_drafts.ts';
import { __resetForTest, budgetRefusalMessage, ROUTE } from '../src/services/aiRouter.ts';
import { TASK_LABELS } from '../src/services/aiCatalog.ts';
import { INTENTS, RELATIONSHIP_OF, intentFor } from '../src/services/mail/intents.ts';
import { parseDraft, revisionInstruction } from '../src/services/mail/drafts.ts';
import { kpiValue } from '../src/services/mail/blocks.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d1341-only-not-a-real-credential'.repeat(2);
const UNTICKED = 'Synthetic pain only the interview holds';
const ANSWER = JSON.stringify({ subject: 'Thank you', body: 'Thank you for the conversation.' });

async function fixture(answer: () => string = () => ANSWER) {
  __resetForTest();
  const db = migratedDatabase();
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100], [3, 'founder', 300], [6, 'investor', null], [7, 'advisor', null]] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.exec(`INSERT INTO discovery_interviews(id,project_id,interviewee_name,interviewee_company,stage,done_at,notes,pains_json,updated_at)
           VALUES (11,1,'Synthetic Ada','Synthetic Co','done','2026-10-01','Synthetic notes','["${UNTICKED}"]','2026-10-02 09:00:00'),
                  (31,3,'Synthetic Other','Other Co','done','2026-10-01','Other venture note','[]','2026-10-02 09:00:00')`);
  db.exec("INSERT INTO raise_prospects(id,uid,project_id,name,firm,stage,updated_at) VALUES (21,'p21',1,'Synthetic Investor','Synthetic Fund','talking','2026-10-03 10:00:00')");
  db.exec("INSERT INTO cap_table_holders(id,user_id,project_id,name,security_type,shares,founder_role,updated_at) VALUES (5,2,1,'Synthetic Cofounder','common',1000,'cofounder','2026-10-04 10:00:00')");
  db.exec("INSERT INTO growth_partners(uid,project_id,name,type,stage,updated_at) VALUES ('gp1abc',1,'Synthetic Partner','referral','talking','2026-10-05 10:00:00')");
  db.exec("INSERT INTO advisors(id,uid,user_id,display_name,email) VALUES (4,'adv4',7,'Synthetic Advisor','synthetic-7@example.invalid')");
  db.exec(`INSERT INTO advisor_engagements(id,uid,advisor_id,founder_user_id,client_name,lane,shape,started_at,updated_at)
           VALUES (70,'e70',4,2,'Synthetic venture','signed','retainer','2026-09-01','2026-09-01'),(80,'e80',4,3,'Other venture','signed','retainer','2026-09-01','2026-09-01')`);
  db.exec("INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at) VALUES (9,'s9',4,'2026-10-10T15:00:00Z','2026-10-10T16:00:00Z')");
  db.exec("INSERT INTO advisor_bookings(id,uid,slot_id,advisor_id,founder_user_id,topic,status) VALUES (1,'b1',9,4,2,'Pricing','confirmed')");
  db.exec("INSERT INTO project_metrics(id,project_id,snapshot_date,source,mrr,paying_accounts) VALUES (1,1,'2026-10-10','manual',12000,42)");
  db.exec("INSERT INTO narrative_positioning(project_id,version,kind,position,text,updated_at) VALUES (1,NULL,'one_liner',0,'Books closed in a day for small finance teams.','2026-10-06 10:00:00')");
  db.exec("INSERT INTO roadmap_okrs(project_id,objective,kanban_status,sort_order,updated_at) VALUES (1,'Ship the close checklist','now',1,'2026-10-07 10:00:00'),(1,'Bank feeds','done',2,'2026-10-01 10:00:00')");
  db.exec("INSERT INTO cap_table_holders(id,user_id,project_id,name,security_type,shares,founder_role) VALUES (6,2,1,'Synthetic Angel Holder','common',10,NULL)");
  db.exec("UPDATE growth_partners SET contact_name = 'Synthetic Contact Person' WHERE uid = 'gp1abc'");
  db.exec("INSERT INTO interview_sessions(id,uid,interview_id,project_id,created_by_user_id,channel,status,consent_status) VALUES (40,'sess40',11,1,2,'video','transcribed','given')");
  db.exec("INSERT INTO interview_transcript_segments(session_id,source,start_ms,end_ms,speaker_label,text) VALUES (40,'final',0,1000,'A','Synthetic raw transcript line')");
  db.exec("INSERT INTO partners(id,uid,name,company,email) VALUES (5,'pt5','Synthetic Operator','Synthetic Ops','synthetic-ops@example.invalid')");
  db.exec(`INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price,status,created_at,updated_at)
           VALUES (90,'g90',1,1,5,100,1,0,'accepted','2026-09-15','2026-09-15'),(91,'g91',2,2,5,300,3,0,'accepted','2026-09-15','2026-09-15')`);
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: Array<{ model: string; prompt: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const prompt = (input?.messages || []).map((m: any) => String(m.content || '')).join('\n');
      calls.push({ model, prompt });
      return { response: answer(), usage: { prompt_tokens: 80, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  db.exec("INSERT INTO project_members (project_id, user_id, role, status) VALUES (1, 7, 'advisor', 'accepted')");
  const app = new Hono<any>().route('/api/mail', mail);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT id, user_id, task, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task = 'mail_draft' ORDER BY id").all() as any[];
  const drafts = () => db.prepare('SELECT uid, user_id, person_ref, parent_uid, cost_micro_usd, refs_json FROM mail_drafts ORDER BY id').all() as any[];
  return { db, env, app, calls, runs, drafts, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const ASK = { person: 'interviewee:11', intent: 'thank_follow_up', tone: 'warm', length: 'short' };

// ─────────────────────────────────────────────────────────── pure

test('mail_draft is a routed, labelled task; each relationship has its own intents', () => {
  assert.equal(ROUTE.mail_draft.provider, 'workers-ai');
  assert.ok(ROUTE.mail_draft.alternates!.length >= 2, 'priced alternates');
  assert.equal(TASK_LABELS.mail_draft, 'Draft an email');
  // D1348 adds `founder`, `coinvestor` and `case`, and the other profiles' kinds.
  assert.deepEqual(Object.keys(INTENTS), ['customer', 'investor', 'advisor', 'cofounder', 'network', 'founder', 'coinvestor', 'case']);
  assert.deepEqual(RELATIONSHIP_OF, {
    interviewee: 'customer', prospect: 'investor', cofounder: 'cofounder', advisor: 'advisor', partner: 'advisor', growth_partner: 'advisor', member: 'network',
    deal: 'founder', holding: 'founder', coinvestor: 'coinvestor', client: 'founder', cohort: 'founder', engagement: 'founder', lead: 'founder', application: 'case', ticket: 'case',
  });
  assert.equal(intentFor('customer', 'second_interview')!.label, 'Ask for a second interview');
  assert.equal(intentFor('investor', 'second_interview'), null, 'an intent belongs to its relationship');
  assert.deepEqual(parseDraft('Here: {"subject":" Hi ","body":"Hello"}'), { subject: 'Hi', body: 'Hello' });
  assert.equal(parseDraft('{"subject":"Hi"}'), null);
  assert.equal(parseDraft('no json'), null);
  assert.match(revisionInstruction('shorter'), /shorter/);
  assert.match(revisionInstruction('warmer'), /warmer/);
  assert.equal(revisionInstruction(' Mention the pilot '), 'Mention the pilot');
  assert.throws(() => revisionInstruction(''), /Say how to change/);
  assert.throws(() => revisionInstruction('x'.repeat(501)), /under 500/);
  assert.equal(kpiValue({ value: 1234567, unit: 'usd_cents' } as any), '$12,345');
  assert.equal(kpiValue({ value: 2.25, unit: 'pct' } as any), '2.3%');
  assert.equal(kpiValue({ value: 42, unit: 'count' } as any), '42');
});

// ─────────────────────────────────────────────────────────── context

test('the pack: the person\'s record selected, read through its module; the company\'s items offered, not selected', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 2, 'GET', '/api/mail/context?person=interviewee:11');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.person, { ref: 'interviewee:11', kind: 'interviewee', relationship: 'customer', name: r.body.items[0].text.split('\n')[0], project_id: 1 });
    assert.deepEqual(r.body.intents.map((i: any) => i.key), ['thank_follow_up', 'second_interview', 'share_built']);
    assert.deepEqual(r.body.items.map((i: any) => [i.ref, i.selected]), [['interviewee:11', true], ['one_liner:1', false], ['kpis:1', false]]);
    const [own, line, kpis] = r.body.items;
    assert.equal(own.link, '/validate/customer-research/11?project=1');
    assert.equal(own.as_of, '2026-10-02');
    assert.match(own.label, /^Customer research · /);
    assert.ok(own.text.includes(UNTICKED), 'the interview\'s pains are its text');
    assert.match(own.text, /Recruiting stage: done since 2026-10-01/);
    assert.equal(line.text, 'Books closed in a day for small finance teams.');
    assert.match(kpis.text, /MRR: \$12,000/);
    for (const [ref, link] of [['prospect:21', '/raise/capital-relationships/21?project_id=1'], ['cofounder:h-5', '/build/founding-team/h-5?project=1'], ['growth_partner:gp1abc', '/grow/partner-network/gp1abc?project_id=1']]) {
      const p = await call(f, 2, 'GET', `/api/mail/context?person=${ref}`);
      assert.equal(p.status, 200, `${ref}: ${JSON.stringify(p.body)}`);
      assert.deepEqual([p.body.items[0].ref, p.body.items[0].link, p.body.items[0].selected], [ref, link, true]);
    }
    const a = await call(f, 2, 'GET', '/api/mail/context?person=advisor:70');
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.person.relationship, 'advisor');
    assert.match(a.body.items[0].text, /Last session: 2026-10-10 · Pricing/);
    assert.equal(a.body.items.length, 1, 'an advisor has no venture: no company items unless one is named');
    assert.equal((await call(f, 2, 'GET', '/api/mail/context?person=advisor:70&project=1')).body.items.length, 3);
    assert.ok(!own.text.includes('Synthetic raw transcript line'), 'a raw transcript is never pack text');
    const pe = await call(f, 2, 'GET', '/api/mail/context?person=partner:90');
    assert.equal(pe.status, 200, JSON.stringify(pe.body));
    assert.deepEqual([pe.body.person.name, pe.body.person.project_id, pe.body.items.length], ['Synthetic Operator · Synthetic Ops', 1, 3]);
    const pinned = await call(f, 2, 'GET', '/api/mail/context?person=interviewee:11&project=3');
    assert.deepEqual(pinned.body.items.map((i: any) => i.ref), ['interviewee:11', 'one_liner:1', 'kpis:1'], 'the person\'s own venture wins over a named one');
    const writer = (await call(f, 2, 'GET', '/api/mail/context?person=growth_partner:gp1abc')).body.items[0].text;
    assert.match(writer, /Synthetic Contact Person/);
    const reader = await call(f, 7, 'GET', '/api/mail/context?person=growth_partner:gp1abc');
    assert.equal(reader.status, 200, JSON.stringify(reader.body));
    assert.ok(!reader.body.items[0].text.includes('Synthetic Contact Person'), 'a writers-only section stays hidden from a reader');
  } finally { f.close(); }
});

test('a ref the member cannot read is 404 in exactly the words of one that does not exist', async () => {
  const f = await fixture();
  try {
    const missing = await call(f, 2, 'GET', '/api/mail/context?person=interviewee:999');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.detail, 'Record not found.');
    for (const [who, ref] of [[2, 'interviewee:31'], [6, 'interviewee:11'], [7, 'interviewee:11'], [2, 'advisor:80'], [3, 'prospect:21'], [2, 'member:3'], [2, 'cofounder:5'], [2, 'cofounder:h-6'], [2, 'partner:91'], [3, 'partner:90'], [2, 'nope'], [2, '']] as const) {
      const r = await call(f, who, 'GET', `/api/mail/context?person=${ref}`);
      assert.equal(r.status, 404, `${who} ${ref}`);
      assert.deepEqual(r.body, missing.body, `${who} ${ref}: the same body`);
    }
    const draft = await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, person: 'interviewee:31' });
    assert.deepEqual([draft.status, draft.body.detail], [404, 'Record not found.']);
    assert.equal(f.calls.length, 0, 'nothing ran');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── drafts

test('only the ticked records and blocks reach the prompt; a ref outside the pack is refused', async () => {
  const f = await fixture();
  try {
    const none = await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, refs: ['one_liner:1'], blocks: [] });
    assert.equal(none.status, 201, JSON.stringify(none.body));
    const p1 = f.calls.filter((c) => c.model.includes('llama'))[0].prompt;
    assert.ok(!p1.includes(UNTICKED), 'an unticked record never reaches the prompt');
    assert.ok(!p1.includes('MRR'), 'nor an unticked company item');
    assert.ok(p1.includes('Books closed in a day'), 'the ticked one does');
    assert.deepEqual(none.body.draft.sources.map((s: any) => s.ref), ['one_liner:1']);
    const both = await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, refs: ['interviewee:11'], blocks: ['project_progress', 'raise_status'] });
    assert.equal(both.status, 201, JSON.stringify(both.body));
    const p2 = f.calls.filter((c) => c.model.includes('llama')).at(-1)!.prompt;
    assert.ok(p2.includes(UNTICKED));
    assert.ok(p2.includes('Roadmap: 1 done, 1 now'), 'a block computed now');
    assert.deepEqual(both.body.draft.blocks.map((b: any) => b.kind), ['project_progress'], 'a block with no data is left out');
    const outside = await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, refs: ['interviewee:31'] });
    assert.deepEqual([outside.status, outside.body.detail], [404, 'Record not found.']);
    assert.equal((await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, intent: 'send_update' })).status, 400, 'an investor intent is not a customer\'s');
    assert.equal((await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, tone: 'sarcastic' })).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, length: 'epic' })).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, blocks: ['weather'] })).status, 400);
  } finally { f.close(); }
});

test('the estimate runs nothing; the draft is charged what the router charged, never more than the estimate', async () => {
  const f = await fixture();
  try {
    const q = await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, refs: ['interviewee:11'], estimate: true });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.ok(q.body.estimate.hold_microusd > 0);
    assert.deepEqual(q.body.sources.map((s: any) => s.ref), ['interviewee:11']);
    assert.deepEqual([f.runs(), f.drafts()], [[], []], 'an estimate runs and stores nothing');
    const r = await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, refs: ['interviewee:11'] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const [run] = f.runs();
    assert.equal(run.user_id, 2);
    assert.ok(run.charged_microusd > 0 && run.charged_microusd <= q.body.estimate.hold_microusd);
    assert.equal(r.body.draft.cost.charged_microusd, run.charged_microusd, 'the router\'s charge, as charged');
    assert.equal(f.drafts()[0].cost_micro_usd, run.charged_microusd);
    assert.deepEqual([r.body.draft.subject, r.body.draft.body], ['Thank you', 'Thank you for the conversation.']);
  } finally { f.close(); }
});

test('a short balance is 402 in the top-up sentence, and nothing is stored', async () => {
  const f = await fixture();
  try {
    f.db.exec('UPDATE ai_topup_accounts SET balance_microusd = 0 WHERE user_id = 2');
    const r = await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, refs: ['interviewee:11'] });
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.equal(r.body.detail, budgetRefusalMessage(r.body.error));
    assert.deepEqual(f.drafts(), []);
  } finally { f.close(); }
});

test('an answer that is not an email is not stored', async () => {
  const f = await fixture(() => 'Sure, here you go.');
  try {
    const r = await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, refs: ['interviewee:11'] });
    assert.deepEqual([r.status, r.body.error], [503, 'draft_unreadable']);
    assert.deepEqual(f.drafts(), []);
  } finally { f.close(); }
});

test('a revision is a new row that keeps its parent, read again; the drafts are the member\'s own', async () => {
  const f = await fixture();
  try {
    const first = (await call(f, 2, 'POST', '/api/mail/drafts', { ...ASK, refs: ['interviewee:11'], blocks: ['project_progress'] })).body.draft;
    const rev = await call(f, 2, 'POST', `/api/mail/drafts/${first.uid}/revise`, { instruction: 'shorter' });
    assert.equal(rev.status, 201, JSON.stringify(rev.body));
    assert.notEqual(rev.body.draft.uid, first.uid);
    assert.deepEqual([rev.body.draft.parent_uid, rev.body.draft.person, rev.body.draft.intent, rev.body.draft.tone], [first.uid, 'interviewee:11', 'thank_follow_up', 'warm']);
    assert.deepEqual(rev.body.draft.sources.map((s: any) => s.ref), ['interviewee:11']);
    assert.deepEqual(rev.body.draft.blocks.map((b: any) => b.kind), ['project_progress']);
    const prompt = f.calls.filter((c) => c.model.includes('llama')).at(-1)!.prompt;
    assert.match(prompt, /CURRENT DRAFT\nSubject: Thank you/);
    assert.match(prompt, /Revise the current draft: Make it shorter/);
    assert.equal((await call(f, 2, 'POST', `/api/mail/drafts/${first.uid}/revise`, { instruction: '' })).status, 400);
    assert.equal((await call(f, 3, 'POST', `/api/mail/drafts/${first.uid}/revise`, { instruction: 'shorter' })).status, 404, 'another member\'s draft');
    const list = await call(f, 2, 'GET', '/api/mail/drafts');
    assert.deepEqual(list.body.drafts.map((d: any) => d.uid).sort(), [rev.body.draft.uid, first.uid].sort());
    assert.equal((await call(f, 3, 'GET', '/api/mail/drafts')).body.drafts.length, 0);
    assert.equal((await call(f, 2, 'GET', '/api/mail/drafts?person=prospect:21')).body.drafts.length, 0);
    assert.equal((await call(f, 2, 'GET', `/api/mail/drafts/${first.uid}`)).body.draft.uid, first.uid);
    assert.equal((await call(f, 3, 'GET', `/api/mail/drafts/${first.uid}`)).status, 404);
    assert.equal((await call(f, 3, 'DELETE', `/api/mail/drafts/${first.uid}`)).status, 404);
    assert.equal((await call(f, 2, 'DELETE', `/api/mail/drafts/${first.uid}`)).status, 200);
    assert.equal(f.drafts().find((d) => d.uid === rev.body.draft.uid).parent_uid, first.uid, 'the revision keeps its parent\'s uid');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── blocks

test('each block is computed now under its module\'s gate; nothing recorded or unreadable is no block', async () => {
  const f = await fixture();
  try {
    const one = await call(f, 2, 'POST', '/api/mail/blocks', { kind: 'one_liner', project: 1 });
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.deepEqual(one.body.block, { kind: 'one_liner', text: 'Books closed in a day for small finance teams.', as_of: '2026-10-06', link: '/raise/investor-narrative?project_id=1' });
    const k = (await call(f, 2, 'POST', '/api/mail/blocks', { kind: 'kpis', ref: 'interviewee:11' })).body.block;
    assert.match(k.text, /Customers: 42 \(as of 2026-10-10\)/);
    assert.equal(k.as_of, '2026-10-10');
    assert.ok(!/: (\$0|0)\b/.test(k.text), 'a KPI with nothing recorded is not drawn as zero');
    assert.equal((await call(f, 2, 'POST', '/api/mail/blocks', { kind: 'raise_status', project: 1 })).body.block, null, 'no commitment recorded');
    assert.equal((await call(f, 2, 'POST', '/api/mail/blocks', { kind: 'interview_insights', project: 1 })).body.block?.kind, 'interview_insights');
    assert.equal((await call(f, 3, 'POST', '/api/mail/blocks', { kind: 'kpis', project: 3 })).body.block, null, 'an empty board');
    assert.equal((await call(f, 3, 'POST', '/api/mail/blocks', { kind: 'kpis', project: 1 })).body.block, null, 'another venture');
    // D1348: an admin's email quotes the case only, so no block is computed for them at all.
    const admin = await call(f, 1, 'POST', '/api/mail/blocks', { kind: 'one_liner', project: 1 });
    assert.deepEqual([admin.status, admin.body.block], [403, undefined], 'an admin never reads the narrative through a draft');
    f.db.exec("INSERT INTO raise_prospects(id,uid,project_id,name,firm,stage,commit_status,updated_at) VALUES (22,'p22',1,'Synthetic Angel','','committed','signed','2026-10-08 10:00:00')");
    const unpriced = (await call(f, 2, 'POST', '/api/mail/blocks', { kind: 'raise_status', project: 1 })).body.block;
    assert.equal(unpriced.text, 'Committed amount: not recorded\n1 investor committed', 'an amount not recorded is never $0');
    f.db.exec('UPDATE raise_prospects SET amount = 25000 WHERE id = 22');
    const raise = (await call(f, 2, 'POST', '/api/mail/blocks', { kind: 'raise_status', project: 1 })).body.block;
    assert.match(raise.text, /Committed: \$25,000/);
    assert.match(raise.text, /1 investor committed/);
    assert.equal(raise.as_of, '2026-10-08');
    assert.equal((await call(f, 3, 'POST', '/api/mail/blocks', { kind: 'raise_status', project: 1 })).body.block, null, 'another venture\'s raise');
    assert.equal((await call(f, 1, 'POST', '/api/mail/blocks', { kind: 'raise_status', project: 1 })).status, 403, 'staff never read the pipeline through a draft');
    assert.equal((await call(f, 3, 'POST', '/api/mail/blocks', { kind: 'project_progress', project: 3 })).body.block, null, 'an empty roadmap');
    assert.equal((await call(f, 2, 'POST', '/api/mail/blocks', { kind: 'kpis', ref: 'interviewee:31' })).status, 404);
    assert.equal((await call(f, 2, 'POST', '/api/mail/blocks', { kind: 'kpis' })).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/mail/blocks', { kind: 'weather', project: 1 })).status, 400);
  } finally { f.close(); }
});

test('a support session drafts nothing', async () => {
  const f = await fixture();
  try {
    for (const [method, path, json] of [['GET', '/api/mail/context?person=interviewee:11'], ['POST', '/api/mail/drafts', { ...ASK, refs: [] }], ['POST', '/api/mail/blocks', { kind: 'kpis', project: 1 }]] as const) {
      const r = await call(f, 2, method, path, json, { impersonated_by: 1 });
      assert.deepEqual([r.status, r.body.error], [403, 'support_session_refused'], path);
    }
  } finally { f.close(); }
});
