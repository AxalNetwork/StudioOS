/** D6039 part 2 (#6039): company-level compliance events as a reminder source, deduplicated on D6713's pack item key. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { transition } from '../src/services/formationCase.ts';
import { filingReminderCandidates, sendFilingReminders } from '../src/services/filingReminders.ts';

const ON = '2026-11-01';
const DUE = '2026-12-01';
const LEAD = '2026-11-17';

/** A registered v2 case whose pack holds one dated item; `companyOnly` drops the venture. */
async function registered(companyOnly: boolean) {
  const db = openSchema();
  db.exec(`INSERT INTO users(id,name,email,role,is_active) VALUES
      (6713,'Synthetic founder','reminders-founder@example.test','founder',1),
      (6714,'Synthetic HQ','reminders-hq@example.test','admin',1),
      (6715,'Synthetic admin','reminders-admin@example.test','founder',1),
      (6716,'Synthetic member','reminders-member@example.test','founder',1),
      (6717,'Synthetic former admin','reminders-former@example.test','founder',0);
    INSERT INTO projects(id,name,company_id) VALUES (6713,'Synthetic project',6713);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (6713,6713,'owner','accepted');
    INSERT INTO company_profiles(id,uid,company_name) VALUES (6713,'company-reminders-6039','Synthetic company');
    INSERT INTO user_company_links(uid,company_id,user_id,role_in_company,is_primary_admin) VALUES
      ('l-6713',6713,6713,'Founder',0), ('l-6715',6713,6715,'Member',1), ('l-6716',6713,6716,'Member',0), ('l-6717',6713,6717,'Admin',0);
    INSERT INTO formation_catalogue_versions(id,version,status) VALUES (6713,6713,'draft');
    INSERT INTO formation_jurisdictions(id,version_id,country) VALUES (6713,6713,'US');
    INSERT INTO formation_entity_forms(id,version_id,jurisdiction_id,form_key,label) VALUES (6713,6713,6713,'us_de_ccorp','Synthetic form');
    INSERT INTO formation_sources(id,kind,title,url) VALUES (6713,'registry','Synthetic test evidence','https://example.test/pack');`);
  db.prepare(`INSERT INTO formation_cases(id,uid,user_id,intent,project_id,company_id,track,stage,form_key,catalogue_version_id,hq_owner_user_id)
    VALUES (6713,'case-reminders-6039',6713,?,?,6713,'v2','submitted','us_de_ccorp',6713,6714)`)
    .run(companyOnly ? 'incorporate_company' : 'convert_project', companyOnly ? null : 6713);
  db.prepare(`INSERT INTO formation_pack_items(version_id,form_id,item_key,phase,kind,acting_party,title,
      obligation_phase,source_id,checked_on,due_rule_json,event_kind,recurrence)
    VALUES (6713,6713,'annual_report','after_filing','step','founder','Synthetic annual report','ongoing',6713,?,?,'annual_report','annual')`)
    .run(ON, JSON.stringify({ due_month: 12, due_day: 1 }));
  const env = { DB: d1Over(db), ENVIRONMENT: 'development' } as any;
  assert.equal((await transition(env, 6713, 'registered', { party: 'hq', userId: 6713 }, { orderSet: { filed_on: ON } })).ok, true);
  const sent: Array<{ userId: number; link: string }> = [];
  const deliver: Parameters<typeof sendFilingReminders>[3] = async (_env, args) => { sent.push({ userId: args.userId, link: String(args.link) }); return 1; };
  return { db, env, sent, deliver, close: () => db.close() };
}

const rows = (db: any, sql: string) => db.prepare(sql).all().map((r: any) => ({ ...r }));
const events = (db: any) => rows(db, `SELECT event_id IS NOT NULL AS event, user_id, company_id, pack_item_key, reminder_date, sent_at IS NOT NULL AS sent
  FROM filing_reminder_event_deliveries ORDER BY reminder_date, user_id`);
const claims = (db: any) => rows(db, 'SELECT source, user_id, reminder_date FROM filing_reminder_pack_claims ORDER BY reminder_date, user_id');
const steps = (db: any) => rows(db, 'SELECT source, user_id, project_id, reminder_date FROM filing_reminder_deliveries ORDER BY reminder_date, user_id');

test('a company-only pack item reminds the company admins once per window, and the pack says so', async () => {
  const f = await registered(true);
  try {
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM formation_steps').get()!.n, 0);
    const evidence = JSON.parse(String(f.db.prepare("SELECT evidence_json FROM formation_case_stages WHERE case_id=6713 AND stage='registered'").get()!.evidence_json));
    assert.equal(evidence.pack_items[0].reminders, true, 'the company event is a reminder source now');
    // A project-level event keeps its own reminder days (growDaily.ts); this job does not read it.
    f.db.exec(`INSERT INTO compliance_events(project_id,company_id,jurisdiction,event_type,title,due_date)
      VALUES (6713,6713,'us_de_ccorp','other','Synthetic project obligation','${DUE}')`);
    assert.equal(await sendFilingReminders(f.env, '2026-11-16', 14, f.deliver), 0, 'outside both windows');
    // The Founder seat and the primary admin; never a plain member or an inactive admin.
    assert.equal(await sendFilingReminders(f.env, LEAD, 14, f.deliver), 2);
    assert.deepEqual(f.sent.map(s => s.userId), [6713, 6715]);
    assert.ok(f.sent.every(s => s.link === '/account/companies/company-reminders-6039/settings/compliance'));
    assert.equal(await sendFilingReminders(f.env, LEAD, 14, f.deliver), 0, 'a rerun sends nothing');
    assert.equal(await sendFilingReminders(f.env, DUE, 14, f.deliver), 2, 'the due day is its own window');
    assert.equal(await sendFilingReminders(f.env, DUE, 14, f.deliver), 0);
    const key = '6713:us_de_ccorp:annual_report';
    assert.deepEqual(events(f.db), [
      { event: 1, user_id: 6713, company_id: 6713, pack_item_key: key, reminder_date: LEAD, sent: 1 },
      { event: 1, user_id: 6715, company_id: 6713, pack_item_key: key, reminder_date: LEAD, sent: 1 },
      { event: 1, user_id: 6713, company_id: 6713, pack_item_key: key, reminder_date: DUE, sent: 1 },
      { event: 1, user_id: 6715, company_id: 6713, pack_item_key: key, reminder_date: DUE, sent: 1 },
    ]);
    assert.deepEqual(claims(f.db), [
      { source: 'event', user_id: 6713, reminder_date: LEAD }, { source: 'event', user_id: 6715, reminder_date: LEAD },
      { source: 'event', user_id: 6713, reminder_date: DUE }, { source: 'event', user_id: 6715, reminder_date: DUE },
    ]);
    assert.deepEqual(steps(f.db), [], 'the venture ledger is untouched');
    f.db.exec("UPDATE compliance_events SET completion_status = 'completed'");
    assert.equal((await filingReminderCandidates(f.env, DUE, 14)).length, 0, 'a completed event is not reminded');
    f.db.exec("UPDATE compliance_events SET completion_status = 'snoozed'");
    assert.equal((await filingReminderCandidates(f.env, DUE, 14)).length, 0, 'a snoozed event is not reminded');
  } finally { f.close(); }
});

test('a project pack item seeded as a step and an event is reminded once, through the step', async () => {
  const f = await registered(false);
  try {
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM formation_steps WHERE pack_item_key IS NOT NULL').get()!.n, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM compliance_events WHERE pack_item_key IS NOT NULL AND project_id IS NULL').get()!.n, 1);
    const candidates = await filingReminderCandidates(f.env, LEAD, 14);
    assert.deepEqual(candidates.map(c => [c.source, c.userId]), [['step', 6713]]);
    const concurrent = await Promise.all([sendFilingReminders(f.env, LEAD, 14, f.deliver), sendFilingReminders(f.env, LEAD, 14, f.deliver)]);
    assert.equal(concurrent[0] + concurrent[1], 1, 'two concurrent runs send it once');
    assert.equal(await sendFilingReminders(f.env, LEAD, 14, f.deliver), 0);
    assert.deepEqual(f.sent.map(s => s.userId), [6713]);
    assert.deepEqual(claims(f.db), [{ source: 'step', user_id: 6713, reminder_date: LEAD }]);
    assert.deepEqual(steps(f.db), [{ source: 'step', user_id: 6713, project_id: 6713, reminder_date: LEAD }]);
    assert.match(f.sent[0].link, /^\/build\/company-creation\/step-\d+\?project_id=6713$/);
    // A done step still owns the item: the company's copy does not take over.
    f.db.exec("UPDATE formation_steps SET state = 'done'");
    assert.equal((await filingReminderCandidates(f.env, DUE, 14)).length, 0);
  } finally { f.close(); }
});

test('the pack item claim refuses a second reminder for one item, recipient and day from the other source', async () => {
  const f = await registered(false);
  try {
    assert.equal(await sendFilingReminders(f.env, LEAD, 14, f.deliver), 1);
    // The venture is removed the same day: the company event becomes eligible. The founder
    // already had this item's reminder through the step; only the other admin is reminded.
    f.db.exec("UPDATE projects SET deleted_at = '2026-11-17 06:00:00' WHERE id = 6713");
    assert.deepEqual((await filingReminderCandidates(f.env, LEAD, 14)).map(c => [c.source, c.userId]), [['event', 6713], ['event', 6715]]);
    assert.equal(await sendFilingReminders(f.env, LEAD, 14, f.deliver), 1);
    assert.deepEqual(f.sent.map(s => s.userId), [6713, 6715]);
    assert.deepEqual(claims(f.db).map((r: any) => [r.source, r.user_id]), [['step', 6713], ['event', 6715]]);
    assert.deepEqual(events(f.db).map((r: any) => r.user_id), [6715], 'no event row for the founder the step already reminded');
    assert.equal(await sendFilingReminders(f.env, LEAD, 14, f.deliver), 0, 'a rerun sends nothing');
  } finally { f.close(); }
});
