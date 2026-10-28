/**
 * D1348 (#3555, part 7 of #3547): the People pane and Eadwyn's sources for an
 * investor, an advisor, an operating partner, an admin and an Explorer.
 * Synthetic members, the mounted routes and the real migrated schema; `fetch` throws.
 *
 *   · each profile gets exactly its groups;
 *   · an admin reads only the cases they hold, and no founder module source;
 *   · an Explorer sees only Network matches;
 *   · a source the member cannot open is absent;
 *   · the markers are derived, never stored.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import mailDrafts from '../src/routes/mail_drafts.ts';
import mailShares from '../src/routes/mail_shares.ts';
import mailPeople from '../src/routes/mail_people.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { markerOf, MARKER_LABEL, PROFILE_GROUPS } from '../src/services/mail/people.ts';
import { profileOf, PROFILE_KINDS } from '../src/services/mail/profileRecords.ts';
import { ensureIntroNetworkSchema } from '../src/services/introductions.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d1348-only-not-a-real-credential'.repeat(2);
const NOW = Date.parse('2026-10-28T12:00:00Z');
const ADMIN = 1, FOUNDER = 2, FOUNDER_B = 3, PARTNER = 5, INVESTOR = 6, ADVISOR = 7, EXPLORER = 8,
  OTHER_INVESTOR = 10, OTHER_ADVISOR = 11, OTHER_PARTNER = 12, OTHER_ADMIN = 13;

async function fixture() {
  __resetForTest();
  const db = migratedDatabase();
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, partner_id, name, display_name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, pid] of [
    [ADMIN, 'admin', null, null], [FOUNDER, 'founder', 100, null], [FOUNDER_B, 'founder', 300, null], [PARTNER, 'partner', null, 50],
    [INVESTOR, 'investor', null, null], [ADVISOR, 'advisor', null, null], [EXPLORER, 'exploring', null, null],
    [OTHER_INVESTOR, 'investor', null, null], [OTHER_ADVISOR, 'advisor', null, null], [OTHER_PARTNER, 'partner', null, 60], [OTHER_ADMIN, 'admin', null, null],
  ] as const) insert.run(id, role, fid, pid, `Synthetic member ${id}`, `Synthetic ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (100,'Synthetic Founder A','fa@example.invalid'),(300,'Synthetic Founder B','fb@example.invalid');
    INSERT INTO partners(id,name,company,email) VALUES (50,'Synthetic Partner','Synthetic Firm','p50@example.invalid'),(60,'Other Partner','Other Firm','p60@example.invalid');
    INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic Robotics',100),(3,'Synthetic Health',300);
    INSERT INTO discovery_interviews(id,project_id,interviewee_name,stage,done_at,pains_json,updated_at) VALUES (11,1,'Synthetic Ada','done','2026-10-01','[]','2026-10-02 09:00:00');
    INSERT INTO deals(id,project_id) VALUES (21,1),(23,3);
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  await ensureIntroNetworkSchema(env);
  const app = new Hono<any>().route('/api/mail', mailDrafts).route('/api/mail', mailShares).route('/api/mail', mailPeople);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  return { db, env, app, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const people = async (f: F, who: number) => (await call(f, who, 'GET', '/api/mail/people')).body;
const groupKeys = (p: any) => p.groups.map((g: any) => g.key);
const refsOf = (p: any, key: string) => p.groups.find((g: any) => g.key === key).people.map((r: any) => r.ref);
const pack = (f: F, who: number, ref: string, project?: number) => call(f, who, 'GET', `/api/mail/context?person=${encodeURIComponent(ref)}${project ? `&project=${project}` : ''}`);
/** A Network match between a and b, both accepted, opened through the shares read. */
function match(f: F, a: number, b: number) {
  f.db.prepare("INSERT INTO intro_propositions (uid, user_id, target_user_id, status, source) VALUES (?, ?, ?, 'accepted', 'matching'), (?, ?, ?, 'accepted', 'matching')")
    .run(`p${a}x${b}`, a, b, `p${b}x${a}`, b, a);
}

test('the profiles and their groups are exactly the canvas\'s', () => {
  assert.deepEqual(PROFILE_GROUPS, {
    investor: ['deal_flow', 'portfolio', 'co_investors', 'network'],
    advisor: ['clients', 'cohort', 'network'],
    partner: ['clients', 'leads', 'network'],
    admin: ['applicants', 'tickets', 'partner_firms'],
    explorer: ['network'],
    founder: ['network'],
  });
  assert.deepEqual([profileOf({ role: 'partner' } as any), profileOf({ role: 'exploring' } as any), profileOf({ role: 'Admin' } as any), profileOf({ role: 'founder' } as any)], ['partner', 'explorer', 'admin', 'founder']);
  assert.deepEqual(PROFILE_KINDS.admin, ['application', 'ticket']);
  assert.deepEqual(PROFILE_KINDS.explorer, []);
});

test('the markers are derived from what the module and the mailbox say now; nothing is stored', () => {
  assert.equal(markerOf({}, NOW), null);
  assert.equal(markerOf({ dueAt: '2026-10-27' }, NOW), 'follow_up_due');
  assert.equal(markerOf({ dueAt: '2026-10-28 11:59:00' }, NOW), 'follow_up_due');
  assert.equal(markerOf({ dueAt: '2026-10-28 12:01:00' }, NOW), null, 'not due yet');
  assert.equal(markerOf({ dueAt: 'soon' }, NOW), null, 'an unreadable date is no marker');
  assert.equal(markerOf({ lastFromThem: true, dueAt: '2026-10-01' }, NOW), 'needs_reply', 'a reply waiting wins');
  assert.equal(markerOf({ lastFromThem: false }, NOW), null);
  assert.deepEqual(MARKER_LABEL, { needs_reply: 'Needs a reply', follow_up_due: 'Follow-up due' });
});

test('investor: deal flow, portfolio, co-investors and Network matches, each under its module\'s rule', async () => {
  const f = await fixture();
  try {
    f.db.exec(`
      INSERT INTO deal_flow_entries(id,uid,entered_via,scope_key,investor_user_id,deal_id,stage,note,revisit_at,entered_at,stage_changed_at,updated_at)
        VALUES (31,'df31','added','u:${INVESTOR}',${INVESTOR},21,'diligence','Synthetic note: strong pilot','2026-10-20','2026-10-01','2026-10-10','2026-10-19 08:00:00'),
               (32,'df32','added','u:${OTHER_INVESTOR}',${OTHER_INVESTOR},23,'screening','Not theirs to read',NULL,'2026-10-01','2026-10-01','2026-10-01');
      INSERT INTO investor_introductions(uid,quarter,investor_user_id,project_id) VALUES ('ii1','2026-Q4',${INVESTOR},1),('ii3','2026-Q4',${INVESTOR},3);
      INSERT INTO commitments(deal_id,investor_user_id,amount,status) VALUES (21,${INVESTOR},1000,'confirmed');
      INSERT INTO portfolio_updates(id,uid,project_id,author_user_id,period,title,kpis_json,audience_json,status,submitted_at,updated_at)
        VALUES (41,'u41',1,${FOUNDER},'2026-09','September','{"MRR":"12000"}','{"investors":true}','submitted','2026-10-05','2026-10-05'),
               (42,'u42',1,${FOUNDER},'2026-10','October, team only','{"MRR":"99999"}','{"team":true}','submitted','2026-10-25','2026-10-25');
      INSERT INTO partner_relationships(id,partner_a_id,partner_b_id,relationship_type,status,requested_by,created_at,updated_at)
        VALUES (51,${INVESTOR},${OTHER_INVESTOR},'co_investor','accepted',${INVESTOR},'2026-09-01','2026-10-08'),
               (52,${INVESTOR},${ADVISOR},'mentor','accepted',${INVESTOR},'2026-09-01','2026-10-08');
      INSERT INTO partner_reminders(uid,relationship_id,remind_at,note,done,created_by) VALUES ('r51',51,'2026-10-26','Synthetic follow-up',0,${INVESTOR});
      INSERT INTO syndicates(id,name,created_by,deal_id,status) VALUES (61,'Synthetic syndicate',${OTHER_INVESTOR},21,'open');
      INSERT INTO syndicate_members(syndicate_id,user_id,commitment_cents) VALUES (61,${INVESTOR},100000);
    `);
    match(f, INVESTOR, FOUNDER);
    const p = await people(f, INVESTOR);
    assert.equal(p.profile, 'investor');
    assert.deepEqual(groupKeys(p), ['deal_flow', 'portfolio', 'co_investors', 'network']);
    assert.deepEqual(refsOf(p, 'deal_flow'), ['deal:31'], 'only the investor\'s own deal flow');
    assert.deepEqual(refsOf(p, 'portfolio'), ['holding:1'], 'held: a confirmed commitment, not just a relationship');
    assert.deepEqual(refsOf(p, 'co_investors'), ['coinvestor:51'], 'a mentor relationship is no co-investor');
    assert.equal(refsOf(p, 'network').length, 1);
    const deal = p.groups[0].people[0];
    assert.deepEqual([deal.name, deal.source, deal.last_contact, deal.marker_label], ['Synthetic Robotics', 'From Deals', '2026-10-19', 'Follow-up due']);
    assert.equal(p.groups[2].people[0].marker, 'follow_up_due', 'a reminder past due');

    const d = await pack(f, INVESTOR, 'deal:31');
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal(d.body.person.relationship, 'founder');
    const kinds = d.body.items.map((i: any) => i.kind);
    assert.deepEqual(kinds, ['deal', 'update', 'syndicate']);
    assert.match(d.body.items[0].text, /Synthetic note: strong pilot/);
    assert.match(d.body.items[1].text, /MRR: 12000/, 'the KPIs shared with investors');
    assert.doesNotMatch(JSON.stringify(d.body), /99999/, 'an update shared with the team only is absent');
    assert.ok(d.body.items.every((i: any) => 'as_of' in i));
    assert.equal(d.body.items[1].as_of, '2026-10-05');
    assert.equal((await pack(f, INVESTOR, 'deal:32')).status, 404, 'another investor\'s entry');
    assert.equal((await pack(f, INVESTOR, 'holding:3')).status, 404, 'a relationship that is not a holding');
    assert.equal((await pack(f, INVESTOR, 'coinvestor:52')).status, 404, 'not a co-investor relationship');
    assert.equal((await pack(f, OTHER_INVESTOR, 'holding:1')).status, 404);
    assert.equal((await pack(f, ADVISOR, 'deal:31')).status, 404, 'a kind outside the profile');
    // The profile gate on its own: a founder's row in the deal-flow table is still not a founder's kind to open.
    f.db.exec(`INSERT INTO deal_flow_entries(id,uid,entered_via,scope_key,investor_user_id,deal_id,stage,entered_at) VALUES (33,'df33','added','u:${FOUNDER}',${FOUNDER},21,'screening','2026-10-01')`);
    assert.equal((await pack(f, FOUNDER, 'deal:33')).status, 404, 'a founder opens no deal-flow entry');
    const h = await pack(f, INVESTOR, 'holding:1');
    assert.equal(h.status, 200);
    assert.deepEqual(h.body.items.map((i: any) => i.kind), ['holding', 'update', 'syndicate']);
  } finally { f.close(); }
});

test('advisor: clients from sessions, cohort founders and Network matches; notes, the next session, the week plan, their services', async () => {
  const f = await fixture();
  try {
    f.db.exec(`
      INSERT INTO advisors(id,uid,user_id,display_name) VALUES (70,'adv70',${ADVISOR},'Synthetic Advisor'),(71,'adv71',${OTHER_ADVISOR},'Other Advisor');
      INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at) VALUES (1,'sl1',70,'2026-10-20T10:00:00Z','2026-10-20T11:00:00Z'),(2,'sl2',70,'2026-11-03T10:00:00Z','2026-11-03T11:00:00Z'),(3,'sl3',71,'2026-10-21T10:00:00Z','2026-10-21T11:00:00Z');
      INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,topic,status) VALUES ('b1',1,70,${FOUNDER},'Pricing','completed'),('b2',2,70,${FOUNDER},'Hiring','confirmed'),('b3',3,71,${FOUNDER_B},'GTM','completed');
      INSERT INTO advisor_engagements(uid,client_name,advisor_id,founder_user_id,lane,shape,term_ends_at) VALUES ('ae1','Synthetic client',70,${FOUNDER},'signed','retainer','2026-10-25');
      INSERT INTO advisor_client_notes(uid,advisor_user_id,client_user_id,body,updated_at) VALUES ('n1',${ADVISOR},${FOUNDER},'Synthetic session note: pricing tiers','2026-10-20');
      INSERT INTO advisor_services(advisor_id,uid,title,kind,price_cents,currency,is_active) VALUES (70,'s1','Pricing review','fixed',50000,'USD',1),(70,'s2','Retired','fixed',100,'USD',0);
      INSERT INTO cohort_cycles(id,year,month,start_at,end_at) VALUES (9,2026,11,'2026-10-01','2026-12-01');
      INSERT INTO week_windows(cohort_cycle_id,week_number,unlock_at,deadline_at) VALUES (9,1,'2026-10-01','2026-10-08'),(9,2,'2026-10-08','2026-11-05');
      INSERT INTO company_week_status(user_id,cohort_cycle_id,week_number,status,deliverables_done,deliverables_required) VALUES (${FOUNDER_B},9,1,'pending',1,3),(${FOUNDER_B},9,2,'pending',0,3);
      INSERT INTO advisor_cohort_assignments(uid,advisor_user_id,cohort_cycle_id,is_active,assigned_at) VALUES ('a1',${ADVISOR},9,1,'2026-10-01');
    `);
    const p = await people(f, ADVISOR);
    assert.deepEqual(groupKeys(p), ['clients', 'cohort', 'network']);
    assert.deepEqual(refsOf(p, 'clients'), [`client:${FOUNDER}`], 'only founders who booked this advisor');
    assert.deepEqual(refsOf(p, 'cohort'), [`cohort:9-${FOUNDER_B}`]);
    const c = p.groups[0].people[0];
    assert.deepEqual([c.source, c.last_contact, c.marker_label], ['From Practice · sessions', '2026-10-20', 'Follow-up due'], 'the term ended: a due date the module sets');
    assert.equal(p.groups[1].people[0].marker_label, 'Follow-up due', 'week 1 past its deadline, neither passed nor failed');
    assert.match(p.groups[1].people[0].source, /^From Cohorts · 2026-11 cohort$/);

    const cl = await pack(f, ADVISOR, `client:${FOUNDER}`);
    assert.equal(cl.status, 200, JSON.stringify(cl.body));
    assert.deepEqual(cl.body.items.map((i: any) => i.kind), ['client', 'session_notes', 'next_session', 'service']);
    assert.match(cl.body.items[1].text, /pricing tiers/);
    assert.equal(cl.body.items[2].as_of, '2026-11-03');
    assert.doesNotMatch(JSON.stringify(cl.body), /Retired/, 'an inactive service is absent');
    assert.equal((await pack(f, ADVISOR, `client:${FOUNDER_B}`)).status, 404, 'another advisor\'s client');
    assert.equal((await pack(f, OTHER_ADVISOR, `client:${FOUNDER}`)).status, 404);
    const co = await pack(f, ADVISOR, `cohort:9-${FOUNDER_B}`);
    assert.equal(co.status, 200);
    assert.match(co.body.items[1].text, /Week 1: pending, 1 of 3 deliverables, due 2026-10-08/);
    assert.equal((await pack(f, OTHER_ADVISOR, `cohort:9-${FOUNDER_B}`)).status, 404, 'not assigned to the cohort');
    // A founder who hid themselves from this advisor is neither listed nor readable.
    f.db.prepare('INSERT INTO cohort_advisor_optouts(founder_user_id, advisor_user_id) VALUES (?, ?)').run(FOUNDER_B, ADVISOR);
    assert.deepEqual(refsOf(await people(f, ADVISOR), 'cohort'), [], 'opted out');
    assert.equal((await pack(f, ADVISOR, `cohort:9-${FOUNDER_B}`)).status, 404, 'opted out');
    f.db.exec('DELETE FROM cohort_advisor_optouts');
    f.db.exec(`UPDATE advisor_cohort_assignments SET is_active = 0`);
    assert.equal((await pack(f, ADVISOR, `cohort:9-${FOUNDER_B}`)).status, 404, 'an assignment ended');
    assert.deepEqual(refsOf(await people(f, ADVISOR), 'cohort'), []);
  } finally { f.close(); }
});

test('operating partner: clients from Delivery, leads from Pipeline; status reports, milestones, proposals and Offers', async () => {
  const f = await fixture();
  try {
    f.db.exec(`
      INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price,status,created_at,updated_at) VALUES (81,'e81',91,92,50,100,1,1000,'active','2026-09-01','2026-10-20'),(82,'e82',91,93,60,300,3,1000,'active','2026-09-01','2026-10-20');
      INSERT INTO engagement_status_reports(uid,engagement_id,period,state,shipped,next_up,sent_at,updated_at) VALUES ('sr1',81,'2026-W42','sent','Synthetic onboarding playbook','Workshop','2026-10-18','2026-10-18'),('sr2',81,'2026-W43','draft','Unsent draft text','x',NULL,'2026-10-26');
      INSERT INTO engagement_milestones(uid,engagement_id,title,due_at,completed_at) VALUES ('m1',81,'Kick-off','2026-10-01','2026-10-02'),('m2',81,'Playbook','2026-10-25',NULL);
      INSERT INTO founder_needs(id,uid,project_id,founder_id,category,title,description) VALUES (91,'n91',3,300,'gtm','Synthetic GTM sprint','desc');
      INSERT INTO quotes(id,uid,need_id,partner_id,price,timeline_weeks,deliverables,status,created_at,updated_at) VALUES (92,'q92',91,50,12000,6,'Synthetic plan','submitted','2026-10-12','2026-10-12'),(93,'q93',91,60,9000,4,'Theirs','submitted','2026-10-12','2026-10-12');
      INSERT INTO service_offerings(owner_user_id,title,category,price_usd,is_active) VALUES (${PARTNER},'GTM sprint','gtm',12000,1);
    `);
    const p = await people(f, PARTNER);
    assert.deepEqual(groupKeys(p), ['clients', 'leads', 'network']);
    assert.deepEqual(refsOf(p, 'clients'), ['engagement:81']);
    assert.deepEqual(refsOf(p, 'leads'), ['lead:92']);
    const e = p.groups[0].people[0];
    assert.equal(e.name, 'Synthetic Founder A · Synthetic Robotics', 'founder_id is a founders.id');
    assert.equal(e.marker_label, 'Follow-up due', 'a milestone past due and not done');
    assert.equal(p.groups[1].people[0].source, 'From Pipeline · proposal sent');
    f.db.exec("UPDATE engagement_milestones SET completed_at = '2026-10-26' WHERE title = 'Playbook'");
    assert.equal((await people(f, PARTNER)).groups[0].people[0].marker, null, 'a completed milestone is no follow-up');
    f.db.exec("UPDATE engagement_milestones SET completed_at = NULL WHERE title = 'Playbook'");

    const en = await pack(f, PARTNER, 'engagement:81');
    assert.equal(en.status, 200, JSON.stringify(en.body));
    assert.deepEqual(en.body.items.map((i: any) => i.kind), ['engagement', 'status_report', 'milestones', 'offer']);
    assert.match(en.body.items[1].text, /Synthetic onboarding playbook/);
    assert.doesNotMatch(JSON.stringify(en.body), /Unsent draft text/, 'a draft report is not sent');
    assert.equal(en.body.items[2].label, 'Milestones · 1 of 2 done');
    const ld = await pack(f, PARTNER, 'lead:92');
    assert.equal(ld.status, 200);
    assert.match(ld.body.items[0].text, /Price: \$12,000/);
    assert.equal((await pack(f, PARTNER, 'engagement:82')).status, 404, 'another partner\'s engagement');
    assert.equal((await pack(f, PARTNER, 'lead:93')).status, 404, 'another partner\'s proposal');
    assert.equal((await pack(f, INVESTOR, 'engagement:81')).status, 404, 'a kind outside the profile');
  } finally { f.close(); }
});

test('admin: only the cases they hold, and the pack is the case only', async () => {
  const f = await fixture();
  try {
    f.db.exec(`
      INSERT INTO spinout_applications(id,user_id,company_name,idea,status,created_at) VALUES (101,${FOUNDER},'Synthetic Robotics','idea','pending','2026-10-09'),(102,${FOUNDER_B},'Synthetic Health','idea','pending','2026-10-09'),(103,${FOUNDER_B},'Decided Co','idea','accepted','2026-10-01');
      INSERT INTO spinout_application_interviews(application_id,user_id,scheduled_at,status,scheduled_by) VALUES (101,${FOUNDER},'2026-10-21T09:30:00Z','scheduled',${ADMIN}),(102,${FOUNDER_B},'2026-10-21T09:30:00Z','scheduled',${OTHER_ADMIN});
      INSERT INTO cohort_applicants(application_id,user_id,cohort_cycle_id,status,decided_at,decided_by) VALUES (103,${FOUNDER_B},9,'accepted','2026-10-02','admin:${ADMIN}');
      INSERT INTO tickets(id,title,description,status,assigned_to,user_id,created_at,updated_at) VALUES
        (4821,'Synthetic billing question','Synthetic detail','open','Synthetic-1@Example.invalid',${INVESTOR},'2026-10-20','2026-10-20'),
        (4822,'Assigned by name','x','in_progress','Synthetic member ${ADMIN}',${FOUNDER},'2026-10-19','2026-10-19'),
        (4823,'Another admin case','x','open','synthetic-13@example.invalid',${FOUNDER},'2026-10-19','2026-10-19'),
        (4824,'Closed','x','closed','synthetic-1@example.invalid',${FOUNDER},'2026-10-19','2026-10-19');
    `);
    match(f, ADMIN, FOUNDER);
    const p = await people(f, ADMIN);
    assert.deepEqual(groupKeys(p), ['applicants', 'tickets', 'partner_firms'], 'no Network matches, no founder module group');
    assert.deepEqual(refsOf(p, 'applicants').sort(), ['application:101', 'application:103'], 'scheduled or decided by them');
    assert.deepEqual(refsOf(p, 'tickets').sort(), ['ticket:4821', 'ticket:4822'], 'open and assigned to them, by address or name');
    assert.equal(p.groups[2].people.length, 0);
    assert.match(p.groups[2].empty, /No partner firm records an Axal holder/);
    assert.match(p.note, /never a member’s own records/);
    assert.equal(p.groups[0].people.find((r: any) => r.ref === 'application:101').marker_label, 'Follow-up due', 'an interview held with no outcome');
    assert.equal(p.groups[1].people.find((r: any) => r.ref === 'ticket:4821').source, 'From Support · ticket #4821');
    f.db.exec("UPDATE spinout_application_interviews SET status = 'completed' WHERE application_id = 101");
    assert.equal((await people(f, ADMIN)).groups[0].people.find((r: any) => r.ref === 'application:101').marker, null, 'an interview with an outcome is no follow-up');

    const a = await pack(f, ADMIN, 'application:101', 1);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.person.relationship, 'case');
    assert.deepEqual(a.body.items.map((i: any) => i.kind), ['application'], 'the case only, even with a project named');
    assert.equal((await pack(f, ADMIN, 'application:102')).status, 404, 'another admin\'s case');
    assert.equal((await pack(f, OTHER_ADMIN, 'application:101')).status, 404);
    assert.equal((await pack(f, ADMIN, 'ticket:4823')).status, 404);
    assert.equal((await pack(f, ADMIN, 'ticket:4824')).status, 404, 'a closed ticket');
    const t = await pack(f, ADMIN, 'ticket:4821');
    assert.deepEqual(t.body.items.map((i: any) => i.kind), ['ticket']);
    // No founder module source is reachable from an admin's pack.
    for (const ref of ['interviewee:11', 'member:anything', 'advisor:1', 'partner:81', 'deal:31']) {
      assert.equal((await pack(f, ADMIN, ref)).status, 404, ref);
    }
    const block = await call(f, ADMIN, 'POST', '/api/mail/blocks', { kind: 'kpis', project: 1 });
    assert.deepEqual([block.status, block.body.code ?? block.body.error], [403, 'case_only']);
    const est = await call(f, ADMIN, 'POST', '/api/mail/drafts', { person: 'ticket:4821', intent: 'answer_case', tone: 'warm', length: 'short', refs: ['ticket:4821'], blocks: ['kpis'], project: 1, estimate: true });
    assert.equal(est.status, 200, JSON.stringify(est.body));
    assert.deepEqual(est.body.blocks, [], 'no live block in an admin\'s draft');
    assert.equal((await call(f, ADMIN, 'POST', '/api/mail/drafts', { person: 'ticket:4821', intent: 'send_update', tone: 'warm', length: 'short', refs: [], blocks: [], estimate: true })).status, 400, 'an investor intent is not a case\'s');
  } finally { f.close(); }
});

test('an Explorer sees only Network matches, with the canvas\'s empty line; other profiles\' kinds are not found', async () => {
  const f = await fixture();
  try {
    const empty = await people(f, EXPLORER);
    assert.deepEqual(groupKeys(empty), ['network']);
    assert.equal(empty.empty, 'Pick a Network match to write to them. Email opens once you have both shared an address.');
    assert.match(empty.groups[0].empty, /No Network match yet/);
    match(f, EXPLORER, FOUNDER);
    const p = await people(f, EXPLORER);
    assert.equal(p.groups[0].people.length, 1);
    assert.match(p.groups[0].people[0].source, /^Network · accepted /);
    assert.equal(p.groups[0].people[0].marker, null);
    for (const ref of ['deal:31', 'client:2', 'engagement:81', 'application:101', 'ticket:4821']) {
      assert.equal((await pack(f, EXPLORER, ref)).status, 404, ref);
    }
    const mine = await pack(f, EXPLORER, p.groups[0].people[0].ref);
    assert.equal(mine.status, 200);
  } finally { f.close(); }
});

test('a group whose module cannot be read says so; it is never shown as empty', async () => {
  const f = await fixture();
  try {
    f.db.exec('DROP TABLE deal_flow_entries');
    const p = await people(f, INVESTOR);
    const g = p.groups.find((x: any) => x.key === 'deal_flow');
    assert.deepEqual([g.people.length, g.empty, g.error], [0, null, 'Founders · deal flow could not be read. Try again.']);
    assert.equal(p.groups.find((x: any) => x.key === 'co_investors').error, null, 'the other groups still read');
  } finally { f.close(); }
});
