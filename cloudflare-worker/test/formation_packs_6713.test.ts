/** D6713 (#6713): catalogue provenance, real registration batches, idempotence and reminder coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { formationPack, registrationPackStatements, packDue } from '../src/services/formationPacks.ts';
import { transition } from '../src/services/formationCase.ts';
import { STANDARD_EVENTS } from '../src/routes/compliance.ts';
import { packObligations } from '../src/services/entityObligations.ts';

const ON = '2026-11-01';
function fixture(companyOnly = false, formKey = 'us_de_ccorp') {
  const db = openSchema();
  db.exec(`INSERT INTO users(id,name,email,role) VALUES (6713,'Synthetic founder','packs@example.test','founder'), (6714,'Synthetic HQ','hq-packs@example.test','admin');
    INSERT INTO projects(id,name,company_id) VALUES (6713,'Synthetic project',6713);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (6713,'company-packs-6713','Synthetic company');
    INSERT INTO formation_catalogue_versions(id,version,status) VALUES (6713,6713,'draft');
    INSERT INTO formation_jurisdictions(id,version_id,country) VALUES (6713,6713,'US');
    INSERT INTO formation_entity_forms(id,version_id,jurisdiction_id,form_key,label) VALUES (6713,6713,6713,'${formKey}','Synthetic form');
    INSERT INTO formation_sources(id,kind,title,url) VALUES (6713,'registry','Synthetic test evidence','https://example.test/pack');`);
  db.prepare(`INSERT INTO formation_cases(id,uid,user_id,intent,project_id,company_id,track,stage,form_key,catalogue_version_id,hq_owner_user_id)
    VALUES (6713,'case-packs-6713',6713,?,?,6713,'v2','submitted',?,6713,6714)`)
    .run(companyOnly ? 'incorporate_company' : 'convert_project', companyOnly ? null : 6713, formKey);
  const env = { DB: d1Over(db), ENVIRONMENT: 'development' } as any;
  return { db, env, close: () => db.close() };
}
function item(f: ReturnType<typeof fixture>, key: string, title: string, kind: string, rule: unknown, sourced = true, recurrence = 'annual') {
  f.db.prepare(`INSERT INTO formation_pack_items(version_id,form_id,item_key,phase,kind,acting_party,title,
      obligation_phase,source_id,checked_on,due_rule_json,event_kind,recurrence)
    VALUES (6713,6713,?,'after_filing','step','founder',?,'ongoing',?,?,?,?,?)`)
    .run(key, title, sourced ? 6713 : null, sourced ? ON : null, sourced ? JSON.stringify(rule) : null, kind, recurrence);
}

test('registering and replaying the seed writes project steps and company events once, with source-backed dates and a named handoff', async () => {
  const f = fixture();
  try {
    for (const spec of STANDARD_EVENTS.us_de_ccorp) item(f, spec.event_type, spec.title, spec.event_type, spec, true, spec.recurrence);
    const actor = { party: 'hq' as const, userId: 6713 };
    assert.equal((await transition(f.env, 6713, 'registered', actor, { orderSet: { filed_on: ON } })).ok, true);
    assert.equal((await transition(f.env, 6713, 'registered', actor, { orderSet: { filed_on: ON } })).ok, false);
    const token = JSON.parse(String(f.db.prepare('SELECT detail_json FROM formation_case_events WHERE case_id=6713 AND to_revision=1').get()!.detail_json)).pack_seed_token;
    await f.env.DB.batch(await registrationPackStatements(f.env, 6713, 1, token, ON));
    const steps = f.db.prepare('SELECT title,due_date,state FROM formation_steps WHERE project_id=6713 ORDER BY title').all();
    assert.equal(steps.length, 4);
    assert.ok(steps.every(row => row.state === 'todo' && typeof row.due_date === 'string'));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM compliance_events WHERE company_id=6713').get()!.n, 4);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM formation_case_stages WHERE case_id=6713 AND stage IN ('activating','handed_off')").get()!.n, 0, 'registration must not pre-open later workflow stages');
    assert.equal((await transition(f.env, 6713, 'activating', actor)).ok, true);
    assert.equal((await transition(f.env, 6713, 'handed_off', actor)).ok, true);
    const stages = f.db.prepare("SELECT stage,owner_user_id,evidence_json FROM formation_case_stages WHERE case_id=6713 AND stage IN ('activating','handed_off') ORDER BY stage").all();
    assert.equal(stages.length, 2);
    for (const stage of stages) {
      assert.equal(stage.owner_user_id, stage.stage === 'activating' ? 6714 : 6713);
      assert.equal(JSON.parse(String(stage.evidence_json)).pack_items.length, 4);
      assert.equal(JSON.parse(String(stage.evidence_json)).handoff_owner_user_id, 6713);
    }
  } finally { f.close(); }
});

test('company-only items seed company events and honestly have no reminder coverage', async () => {
  const f = fixture(true);
  try {
    item(f, 'annual_report', 'Synthetic report', 'annual_report', { due_month: 12, due_day: 1 });
    assert.equal((await transition(f.env, 6713, 'registered', { party: 'hq', userId: 6713 }, { orderSet: { filed_on: ON } })).ok, true);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM formation_steps WHERE project_id=6713').get()!.n, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM compliance_events WHERE company_id=6713 AND project_id IS NULL').get()!.n, 1);
    const pack = await formationPack(f.env, 'us_de_ccorp', { versionId: 6713, today: ON, registeredOn: ON });
    assert.equal(pack[0].reminders, false);
    assert.equal(pack[0].due_date, '2026-12-01');
  } finally { f.close(); }
});

test('both US packs preserve the existing source-backed schedule; no source means no invented date', async () => {
  for (const key of ['us_de_llc', 'us_de_ccorp'] as const) {
    const f = fixture(false, key);
    try {
      for (const spec of STANDARD_EVENTS[key]) item(f, spec.event_type, spec.title, spec.event_type, spec, true, spec.recurrence);
      const pack = await formationPack(f.env, key, { versionId: 6713, today: ON, registeredOn: ON, projectId: 6713 });
      const legacy = packObligations(key, ON, ON).rows;
      assert.deepEqual(pack.map(i => [i.kind,i.title,i.recurrence,i.due_date]), legacy.map(i => [i.kind,i.title,i.cadence,i.due_date]));
      item(f, 'undated', 'Synthetic unsourced item', 'unknown_kind', null, false);
      const undated = (await formationPack(f.env, key, { versionId: 6713, today: ON, registeredOn: ON, projectId: 6713 })).find(i => i.key === 'undated')!;
      assert.equal(undated.due_date, null);
      assert.equal(undated.reminders, false);
      assert.equal(undated.kind, 'other');
    } finally { f.close(); }
  }
  assert.equal(packDue({ offset_days: 30 }, ON, null), null);
  assert.equal(packDue({ due_month: 2, due_day: 30 }, ON, ON), null);
});

test('UK franchise-tax legacy kinds are other, labels survive, and forms without packs return empty', async () => {
  const f = fixture(false, 'uk_ltd');
  try {
    assert.deepEqual(await formationPack(f.env, 'uk_ltd', { versionId: 6713, today: ON }), []);
    item(f, 'ct600', 'Corporation tax (CT600)', 'franchise_tax', { offset_days: 365 });
    const pack = await formationPack(f.env, 'uk_ltd', { versionId: 6713, today: ON, registeredOn: ON });
    assert.equal(pack[0].kind, 'other');
    assert.equal(pack[0].title, 'Corporation tax (CT600)');
    assert.deepEqual(await formationPack(f.env, 'not_a_form', { versionId: 6713, today: ON }), []);
  } finally { f.close(); }
});


test('competing registration batches cannot replace the winner’s pack evidence or registry date', async () => {
  const f = fixture();
  try {
    item(f, 'relative', 'Synthetic relative duty', 'other', { offset_days: 30 });
    const dates = ['2026-11-01', '2026-11-02'];
    const results = await Promise.all(dates.map(on => transition(f.env, 6713, 'registered', { party: 'hq', userId: 6713 }, { orderSet: { filed_on: on } })));
    assert.equal(results.filter(result => result.ok).length, 1);
    const winner = dates[results.findIndex(result => result.ok)];
    const due = packDue({ offset_days: 30 }, winner, winner);
    assert.equal(f.db.prepare('SELECT due_date FROM formation_steps WHERE project_id=6713').get()!.due_date, due);
    const token = JSON.parse(String(f.db.prepare('SELECT detail_json FROM formation_case_events WHERE case_id=6713 AND to_revision=1').get()!.detail_json)).pack_seed_token;
    await f.env.DB.batch(await registrationPackStatements(f.env, 6713, 1, 'wrong-winner-token', '2027-01-01'));
    for (const row of f.db.prepare("SELECT evidence_json FROM formation_case_stages WHERE case_id=6713 AND stage = 'registered'").all()) {
      assert.equal(JSON.parse(String(row.evidence_json)).pack_items[0].due_date, due);
    }
    assert.equal(typeof token, 'string');
  } finally { f.close(); }
});


test('published v1 provisional rules remain undated until actual source evidence is recorded', async () => {
  const f = fixture();
  try {
    const rows = await formationPack(f.env, 'us_de_ccorp', { versionId: 1, today: ON, registeredOn: ON, projectId: 6713 });
    assert.equal(rows.length, STANDARD_EVENTS.us_de_ccorp.length);
    assert.ok(rows.every(row => row.due_date === null && row.reminders === false));
    assert.deepEqual(rows.map(row => row.title), STANDARD_EVENTS.us_de_ccorp.map(row => row.title));
  } finally { f.close(); }
});
