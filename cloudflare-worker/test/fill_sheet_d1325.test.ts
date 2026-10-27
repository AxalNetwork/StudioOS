/**
 * D1325 (#3486, #2431 part 2) — the Fill with Eadwyn read: FILL_FIELDS (two
 * copies), migration 643's source columns, the never-fill kinds, marksForRows
 * and `GET /api/fills/sheet`. On the migrated schema, synthetic rows only. No
 * model runs and no provider is reached.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_sheet_d1325.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills, { ROW_READS } from '../src/routes/fills.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems, offeredToEadwyn, sourceKind } from '../src/services/fills/fields.ts';
import { FILL_SOURCE_COLUMNS, RAIL_PROPOSAL_SOURCE_COLUMNS, ensureFillProvenanceSchema, ensureRailProposalSourceColumns, marksForRows } from '../src/services/fills/provenance.ts';
import { NEVER_FILL_RULES, neverFillReason } from '../src/services/fills/neverFill.ts';
import * as spa from '../../frontend/src/lib/fillFields.js';
import * as spaNever from '../../frontend/src/lib/neverFill.js';

const SECRET = 'synthetic-fill-sheet-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());

const SD = 'Founder · Build · Solution design';
const REV = 'Founder · Grow · Revenue and traction';

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',202,1),(33,'Advisor','adv@example.test','advisor',NULL,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (701,'v-acme','Acme Field',101),(702,'v-theirs','Theirs',202);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (701,33,'advisor','accepted');
    INSERT INTO pain_groups(id,project_id,title,sort_order) VALUES (51,701,'Inspections run late',0),(52,702,'Their pain',0);
    INSERT INTO hypotheses(id,project_id,code,claim,sort_order,retired_at) VALUES (61,701,'H3','Crews will book a slot',0,NULL),(62,701,'H4','Retired claim',1,'2026-10-01');
    INSERT INTO mvp_features(id,project_id,title,added_value,effort,pain_group_id,hypothesis_id) VALUES (81,701,'Scheduling','High','M',51,61);
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type,last_synced_at) VALUES (5,'i-gh',11,'github','active','oauth2','2026-10-02T09:00:00Z');
    INSERT INTO fill_provenance(target_table,target_row_id,target_column,fill_class,proposed_value,written_value,edited,source_kind,source_ref,source_label,source_as_of)
      VALUES ('mvp_features',81,'title','composition','Scheduling','Scheduling',0,'connector','github','connector','2026-10-02');
    INSERT INTO fill_provenance(target_table,target_row_id,target_column,fill_class,proposed_value,written_value,edited)
      VALUES ('mvp_features',81,'effort','composition','M','M',0);
    INSERT INTO ai_rail_proposals(id,uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,status)
      VALUES (1,'p-title-old',11,'${SD}','form:feature',NULL,'proposal','{"field":"title","value":"An older idea"}','proposed');
    INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,status)
      VALUES ('p-title',11,'${SD}','form:feature',NULL,'proposal','{"field":"title","value":"Crew slot booking"}','proposed'),
             ('p-signed',11,'${SD}','form:feature',NULL,'proposal','{"field":"signature","value":"x"}','proposed'),
             ('p-other',22,'${SD}','form:feature',NULL,'proposal','{"field":"effort","value":"L"}','proposed'),
             ('p-done',11,'${SD}','form:feature',NULL,'proposal','{"field":"effort","value":"S"}','discarded'),
             ('p-adv',33,'${SD}','form:feature','mvp_features:81','proposal','{"field":"effort","value":"L"}','proposed');
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/fills', fills);
  const get = async (who: number, q: Record<string, string | number>, support = false) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(support ? { impersonated_by: 99 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
    const r = await app.request(`/api/fills/sheet?${qs}`, { headers: { Authorization: `Bearer ${jwt}` } }, env);
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  return { db, env, get };
}
const byField = (b: any) => Object.fromEntries(b.fields.map((f: any) => [f.field, f]));

test('FILL_FIELDS: the two copies agree, the registry holds its rules, and a measured or never-fill field is never offered to Eadwyn', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(spa.FILL_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual([...spa.FILL_FIELD_CLASSES], ['restatement', 'sourced', 'composition', 'measured']);
  for (const f of FILL_FIELDS) assert.equal(spa.offeredToEadwyn(f), offeredToEadwyn(f), f.field);
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(fieldsOf(SD, 'feature').map((f) => f.field), ['title', 'pain_group_id', 'hypothesis_id', 'effort']);
  assert.equal(fieldsOf(SD, 'feature').some((f) => f.column === 'added_value'), false, 'Impact is the founder’s call');
  const mrr = fieldsOf(REV, 'kpi')[0];
  assert.deepEqual([mrr.class, offeredToEadwyn(mrr)], ['measured', false]);
  // The rules catch what they exist to catch.
  const base = fieldsOf(SD, 'feature')[0];
  assert.match(fillFieldProblems([{ ...mrr, sources: ['eadwyn'] }]).join(), /a measured field lists Eadwyn/);
  assert.match(fillFieldProblems([{ ...base, table: 'commitments', column: 'amount' }]).join(), /never filled \(Money amounts and terms\)/);
  assert.match(fillFieldProblems([{ ...base, class: 'guess' as any }]).join(), /unknown class/);
  assert.match(fillFieldProblems([{ ...base, sources: ['connector:Bad Key'] }]).join(), /unknown source/);
  assert.match(fillFieldProblems([base, base]).join(), /listed twice/);
  assert.match(fillFieldProblems([base, { ...base, field: 'x', table: 'project_metrics' }]).join(), /writes mvp_features and project_metrics/);
  assert.match(fillFieldProblems([{ ...base, sources: [] }]).join(), /no source/);
  assert.equal(offeredToEadwyn({ ...base, table: 'safe_issuances', column: 'notes' }), false, 'a never-fill table is never offered');
  assert.deepEqual([sourceKind('eadwyn'), sourceKind('connector:github'), sourceKind('module:validate/experiments'), sourceKind('typed')], ['eadwyn', 'connector', 'module', null]);
});

test('the never-fill kinds: score_rating and money_term, "Money amounts and terms", in both copies', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(spaNever.NEVER_FILL_RULES)), JSON.parse(JSON.stringify(NEVER_FILL_RULES)));
  const kinds = Object.fromEntries(NEVER_FILL_RULES.map((r) => [r.category, r.label]));
  assert.equal(kinds.score_rating, 'Scores and ratings');
  assert.equal(kinds.money_term, 'Money amounts and terms');
  for (const f of ['commitments.amount_usd', 'safe_issuances.discount', 'cap_table_issuances.shares', 'captable_scenarios.notes', 'fund_position_valuations.value', 'deals.valuation_cap', 'rounds.pre_money_valuation']) {
    assert.equal(neverFillReason(f)?.category, 'money_term', f);
    assert.equal(spaNever.neverFillReason(f)?.category, 'money_term', f);
  }
  assert.equal(neverFillReason('venture_scorecards.summary')?.category, 'score_rating');
  assert.equal(neverFillReason('mvp_features.title'), null, 'a feature’s name is fillable');
  assert.equal(neverFillReason('narrative_sections.discount_story'), null, 'a word is not a money term on its own');
});

test('migration 643 and the ensures carry the same source columns', async () => {
  const sql = readFileSync('cloudflare-worker/sql/migrations/643_fill_provenance_sources.sql', 'utf8');
  for (const c of FILL_SOURCE_COLUMNS) assert.match(sql, new RegExp(`ALTER TABLE fill_provenance ADD COLUMN ${c} `), c);
  // ai_rail_proposals' three came with migration 581 (D1065), not here.
  const m581 = readFileSync('cloudflare-worker/sql/migrations/581_build_plans.sql', 'utf8');
  for (const c of RAIL_PROPOSAL_SOURCE_COLUMNS) { assert.match(m581, new RegExp(`ALTER TABLE ai_rail_proposals ADD COLUMN ${c} `), c); assert.doesNotMatch(sql, new RegExp(`ai_rail_proposals ADD COLUMN ${c}`), c); }
  assert.deepEqual([...FILL_SOURCE_COLUMNS], ['source_kind', 'source_ref', 'source_label', 'source_as_of', 'prior_value', 'undone_at', 'undone_by']);
  assert.deepEqual([...RAIL_PROPOSAL_SOURCE_COLUMNS], ['source_kind', 'source_ref', 'source_label']);
  // A database made before 643: the ensures add exactly these.
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(':memory:');
  old.exec(`CREATE TABLE fill_provenance (id INTEGER PRIMARY KEY, target_table TEXT, target_row_id INTEGER, target_column TEXT, proposal_id INTEGER, fill_class TEXT, proposed_value TEXT, written_value TEXT, edited INTEGER, citation_json TEXT, model TEXT, task TEXT, decided_by INTEGER, created_at TEXT);
    CREATE TABLE ai_rail_proposals (id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, rail_page TEXT, rail_option TEXT, record_ref TEXT, kind TEXT, payload_json TEXT, status TEXT);`);
  const env: any = { DB: d1Over(old) };
  await ensureFillProvenanceSchema(env);
  await ensureRailProposalSourceColumns(env);
  const cols = (t: string) => (old.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((r) => r.name);
  for (const c of FILL_SOURCE_COLUMNS) assert.ok(cols('fill_provenance').includes(c), c);
  for (const c of RAIL_PROPOSAL_SOURCE_COLUMNS) assert.ok(cols('ai_rail_proposals').includes(c), c);
});

test('marksForRows: a value still as filled is marked with its source; a value typed over, an undone fill and an old row read right', async () => {
  const t = fixture();
  const row = t.db.prepare('SELECT * FROM mvp_features WHERE id = 81').get() as any;
  let m = (await marksForRows(t.env, 'mvp_features', [81], new Map([[81, row]]))).get(81)!;
  assert.deepEqual([m.get('title')?.source_kind, m.get('title')?.source_ref, m.get('title')?.source_label, m.get('title')?.source_as_of], ['connector', 'github', 'connector', '2026-10-02']);
  assert.deepEqual([m.get('effort')?.source_kind, m.get('effort')?.source_label], ['eadwyn', null], 'a row from before 643 is Eadwyn’s');
  assert.equal('model' in m.get('effort')!, false, 'a mark names no model');
  // Typed over by hand: the member's.
  m = (await marksForRows(t.env, 'mvp_features', [81], new Map([[81, { ...row, title: 'Booking' }]]))).get(81)!;
  assert.equal(m.has('title'), false);
  // Only the newest row per column counts: an older fill that wrote today's value does not make it Eadwyn's again.
  t.db.exec("INSERT INTO fill_provenance(id,target_table,target_row_id,target_column,fill_class,proposed_value,written_value,edited) VALUES (0,'mvp_features',81,'title','composition','Booking','Booking',0)");
  m = (await marksForRows(t.env, 'mvp_features', [81], new Map([[81, { ...row, title: 'Booking' }]]))).get(81)!;
  assert.equal(m.has('title'), false, 'the newest row wrote Scheduling');
  // Undone: never a mark.
  t.db.exec("UPDATE fill_provenance SET undone_at = '2026-10-27', undone_by = 11 WHERE target_column = 'effort'");
  m = (await marksForRows(t.env, 'mvp_features', [81], new Map([[81, row]]))).get(81)!;
  assert.equal(m.has('effort'), false);
  assert.equal((await marksForRows(t.env, 'mvp_features', [], new Map())).size, 0);
  assert.equal((await marksForRows(t.env, 'mvp_features', [999], new Map([[999, {}]]))).size, 0);
});

test('GET /api/fills/sheet: per field the value, mark, waiting values and choices; the sources; the quote; nothing for Eadwyn on a never-fill or measured field', async () => {
  const t = fixture();
  // The Add form: nothing on file yet.
  const add = await t.get(11, { page: SD, form: 'feature', project: 701 });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.can_fill, true);
  const f = byField(add.body);
  assert.deepEqual(Object.keys(f), ['title', 'pain_group_id', 'hypothesis_id', 'effort']);
  assert.deepEqual(f.title.waiting.map((w: any) => [w.source, w.value, w.ref]), [['eadwyn', 'Crew slot booking', 'p-title']]);
  assert.deepEqual(f.effort.waiting, [], 'another member’s proposal and a decided one are not waiting');
  assert.equal(JSON.stringify(add.body).includes('p-signed'), false, 'a proposal for a field the form does not have is not offered');
  assert.deepEqual(f.pain_group_id.choices.map((c: any) => [c.value, c.label]), [[51, 'Inspections run late']], 'this venture’s themes only');
  assert.deepEqual(f.hypothesis_id.choices.map((c: any) => c.label), ['H3: Crews will book a slot'], 'unretired only');
  for (const x of Object.values(f) as any[]) assert.equal(x.trigger, true, x.field);
  assert.deepEqual(add.body.sources.map((s: any) => [s.key, s.state, s.as_of]), [
    ['connector:github', 'ok', '2026-10-02T09:00:00Z'], ['eadwyn', 'ok', add.body.sources[1].as_of],
    ['module:validate/problem-discovery', 'ok', add.body.sources[2].as_of], ['module:validate/experiments', 'ok', add.body.sources[3].as_of],
  ]);
  assert.deepEqual(add.body.quote, { option: 'form:feature', state: 'ok', runs: 0, average_microusd: null }, 'no run yet: Not recorded, never a zero');
  // Eadwyn's average from the member's own settled runs.
  t.db.exec(`INSERT INTO ai_usage_logs(user_id, task, model, rail_option, charged_microusd) VALUES (11,'t','m','form:feature',1000),(11,'t','m','form:feature',3000),(11,'t','m','form:feature',NULL),(22,'t','m','form:feature',9000)`);
  assert.deepEqual((await t.get(11, { page: SD, form: 'feature', project: 701 })).body.quote, { option: 'form:feature', state: 'ok', runs: 2, average_microusd: 2000 });
  // The record: its values and marks; a filled field shows no trigger.
  const rec = await t.get(11, { page: SD, form: 'feature', project: 701, record: 81 });
  const r = byField(rec.body);
  assert.equal(rec.body.record, 'mvp_features:81');
  assert.deepEqual([r.title.value, r.title.mark.source_kind, r.title.trigger], ['Scheduling', 'connector', false]);
  assert.equal(r.effort.mark.source_kind, 'eadwyn');
  // The measured field: never offered to Eadwyn, a connector's only.
  const kpi = byField((await t.get(11, { page: REV, form: 'kpi', project: 701 })).body);
  assert.deepEqual([kpi.value.class, kpi.value.offered_to_eadwyn, kpi.value.never_fill], ['measured', false, null]);
  assert.deepEqual(kpi.value.sources, ['connector:stripe', 'connector:mercury']);
});

test('who sees what: a reader gets marks and no trigger; a support session gets no trigger; another founder and an unknown form are refused; a failed read is unreadable', async () => {
  const t = fixture();
  const reader = await t.get(33, { page: SD, form: 'feature', project: 701, record: 81 });
  assert.equal(reader.status, 200);
  assert.equal(reader.body.can_fill, false);
  for (const x of reader.body.fields) { assert.equal(x.trigger, false); assert.deepEqual([x.waiting, x.choices], [[], []]); }
  assert.equal(byField(reader.body).title.mark.source_kind, 'connector', 'a reader still sees where a value came from');
  const support = await t.get(11, { page: SD, form: 'feature', project: 701 }, true);
  assert.equal(support.body.can_fill, false);
  assert.equal(support.body.fields.every((x: any) => !x.trigger), true);
  assert.equal((await t.get(22, { page: SD, form: 'feature', project: 701 })).status, 403);
  assert.deepEqual([(await t.get(11, { page: SD, form: 'nope', project: 701 })).status, (await t.get(11, { page: SD, form: 'nope', project: 701 })).body.error], [404, 'unknown_form']);
  assert.equal((await t.get(11, { page: SD, form: 'feature', project: 'x' })).status, 400);
  assert.equal((await t.get(11, { page: SD, form: 'feature', project: 701, record: 9999 })).body.error, 'record_not_found');
  t.db.exec("INSERT INTO mvp_features(id,project_id,title) VALUES (82,702,'Theirs')");
  assert.equal((await t.get(11, { page: SD, form: 'feature', project: 701, record: 82 })).body.error, 'record_not_found', 'another venture’s row');
  // A failed read of one block: the rest answers.
  t.db.exec('ALTER TABLE pain_groups RENAME TO pain_groups_gone');
  const half = await t.get(11, { page: SD, form: 'feature', project: 701 });
  assert.equal(half.status, 200);
  assert.equal(half.body.sources.find((s: any) => s.key === 'module:validate/problem-discovery').state, 'unreadable');
  assert.equal(half.body.sources.find((s: any) => s.key === 'connector:github').state, 'ok');
  t.db.exec('ALTER TABLE fill_provenance RENAME TO fill_provenance_gone');
  const noMarks = await t.get(11, { page: SD, form: 'feature', project: 701, record: 81 });
  assert.equal(noMarks.body.marks_state, 'unreadable');
  assert.deepEqual(byField(noMarks.body).title.mark, { state: 'unreadable' }, 'never "typed by hand"');
  t.db.exec('DELETE FROM integrations');
  assert.equal((await t.get(11, { page: SD, form: 'feature', project: 701 })).body.sources[0].state, 'not_connected');
});

test('the source: bound SQL only, one literal row read per registered table, mounted, a client, and no model name', () => {
  const route = readFileSync('cloudflare-worker/src/routes/fills.ts', 'utf8');
  const sources = readFileSync('cloudflare-worker/src/services/fills/sources.ts', 'utf8');
  for (const src of [route, sources]) {
    assert.doesNotMatch(src, /\.prepare\(`[^`]*\$\{/, 'no interpolated statement');
    assert.doesNotMatch(src, /\.exec\(`/, 'no exec template');
  }
  assert.deepEqual(Object.keys(ROW_READS).sort(), [...new Set(FILL_FIELDS.map((f) => f.table))].sort(), 'every registered table has its literal read');
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.match(index, /app\.route\('\/api\/fills', fillsRoutes\);/);
  const client = readFileSync('frontend/src/lib/api/fills.js', 'utf8');
  assert.match(client, /\/fills\/sheet\?page=/);
  assert.match(readFileSync('frontend/src/lib/api.js', 'utf8'), /export \* from '\.\/api\/fills\.js';/);
  assert.doesNotMatch(route + sources, /\bmodel\b.*json|llama|@cf\//i);
});
