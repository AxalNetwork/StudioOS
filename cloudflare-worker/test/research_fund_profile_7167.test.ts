/**
 * D7167 (#7167) — Research › Funds profile: the dated provenance contract
 * shared by the fund read and each comparison cell, the four proposed fields,
 * the vehicle-labelled history, and the distinct `source_withdrawn` refusal.
 *
 * Real SQLite: the fund directory and its reports as migration 378 declares
 * them, 406's sources table, research_funds (216, its catalogue uid and
 * D7168's identity and allocation columns), the
 * project comparisons (5157) and this issue's migration, run whole.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_fund_profile_7167.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import research from '../src/routes/research.ts';
import projects from '../src/routes/research_projects.ts';
import comparisons, { ATTRIBUTES, fundCells } from '../src/routes/research_project_comparisons.ts';
import { PROPOSED_FIELDS, PROPOSED_REASONS, STATEMENT_FIELDS, provenanceOf } from '../src/services/researchFundProfile.ts';

const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
const M7167 = 'migrations/202611180053_7167_research_fund_vehicle_facts.sql';
const SECRET = 'unit-research-fund-profile-0123456789abcdef0';
const EUR = 'EuroTech VC Funds (public spreadsheet)';
const DOWN = 'Taken down list';
const OWNER = 701;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  db.exec(baseline.match(/CREATE TABLE users \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE projects \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE activity_logs \([\s\S]*?;/)![0]);
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/202611151315_6272_ask_history_cleared.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(sql('migrations/202611092035_research_projects.sql'));
  db.exec(sql('migrations/216_research_funds.sql'));
  db.exec(sql('migrations/202611092035_research_fund_catalogue_uid.sql'));
  db.exec(sql('migrations/202611180053_7168_research_fund_identity_allocation.sql'));
  const m378 = sql('migrations/378_research_fund_directory_rebuild.sql');
  db.exec(m378.match(/CREATE TABLE IF NOT EXISTS research_fund_directory \(.*?\);/)![0]);
  db.exec(m378.match(/CREATE TABLE IF NOT EXISTS research_fund_directory_reports \(.*?\);/)![0]);
  // D7744: each row's own size currency and record kind (migration 202611270508_7744), stamped for the listed lists.
  db.exec(readFileSync(new URL('../sql/migrations/202611270508_7744_research_fund_size_currency_and_kind.sql', import.meta.url), 'utf8'));
  db.exec(sql('migrations/406_research_fund_sources.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_sources \([\s\S]*?\n\);/)![0]);
  db.exec(sql('migrations/202611130634_5157_research_project_comparisons.sql'));
  // D7177: a comparison save records its request id.
  db.exec(sql('migrations/202611180051_7177_research_comparison_request_id.sql'));
  db.exec(sql(M7167));
  // D7748: the fields come from the statement store (D7743) and its uid moves (D7166).
  db.exec(sql('migrations/202611180052_7166_research_fund_directory_vehicles.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_directory_uid_moves \(.*?\);/)![0]);
  db.exec(sql('migrations/202611191932_7743_research_fund_observations.sql'));
  db.exec(`INSERT INTO users (id,email,name,role) VALUES (${OWNER},'owner@example.test','Owner','founder')`);
  db.exec(`INSERT INTO research_fund_sources (source_name,title,publisher,published_url,terms_status,evidence,verdict,verdict_reason,reviewed_on) VALUES
    ('${EUR}','Euro Tech VC Funds','@Example_VC','https://list.example/eu','not found','e','cite only','r','2026-10-07'),
    ('${DOWN}','Taken down','A publisher','https://list.example/down','not found','e','not allowed','Its terms forbid republishing.','2026-10-07')`);
  db.exec(`INSERT INTO research_fund_directory (uid,name,hq,fund_number,fund_size_cents,fund_date,quarter,fund_year,sector_focus,eif_flag,eifo_flag,source_name,source_url,as_of) VALUES
    ('north-opp','North Capital Opp','UK','Opp',7500000000,'2023-09-25','2023-Q3',2023,'B2B-Software',0,0,'${EUR}','https://repo.example/eu.csv','2026-10-04'),
    ('north-v','North Capital Fund V','UK','V',58200000000,'2023-09-25','2023-Q3',2023,'B2B-Software',0,0,'${EUR}','https://repo.example/eu.csv','2026-10-04'),
    ('north-old','North Capital Old','UK','III',19000000000,'2018-04-17','2018-Q2',2018,NULL,0,0,'${DOWN}','https://repo.example/down.csv','2026-10-04'),
    ('lone','Lone Fund','Dublin',NULL,NULL,NULL,NULL,NULL,NULL,0,0,'Unreviewed list','https://repo.example/u.csv','2026-10-04')`);
  // Report rows of north-opp: one labelled as this vehicle, one labelled as another, two unlabelled.
  db.exec(`INSERT INTO research_fund_directory_reports (fund_uid,period,report_date,fund_size_cents,source_url,vehicle_label) VALUES
    ('north-opp','2021-Q3','2021-07-22',10000000000,'https://repo.example/eu.csv','Opp'),
    ('north-opp','2020-Q3','2020-09-09',34000000000,'https://repo.example/eu.csv','IV'),
    ('north-opp','2019-Q2','2019-06-20',11000000000,'https://repo.example/eu.csv',NULL),
    ('north-opp','2018-Q2','2018-04-17',19000000000,'https://repo.example/eu.csv','  ')`);
  const fact = db.prepare(`INSERT INTO research_fund_vehicle_facts (fund_uid,field,value_text,min_cents,max_cents,currency,source_name,source_url,reported_on,imported_on)
                           VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const uid of ['north-opp', 'north-v']) fact.run(uid, 'manager_name', 'North Capital', null, null, null, EUR, 'https://repo.example/eu.csv', '2023-09-25', '2026-10-04');
  // A withdrawn list's vehicle of the same manager (its manager named by a served list), and a fact read from a withdrawn list.
  fact.run('north-old', 'manager_name', 'north capital ', null, null, null, EUR, null, '2018-04-17', '2026-10-04');
  fact.run('north-v', 'investment_stage', 'Growth', null, null, null, DOWN, null, '2023-09-25', '2026-10-04');
  fact.run('north-opp', 'initial_cheque', null, 100000000, 500000000, 'EUR', EUR, null, '2023-09-25', '2026-10-04');
  db.exec('PRAGMA foreign_keys=ON');
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;

const app = new Hono<any>()
  .route('/api/research/projects', comparisons).route('/api/research/projects', projects).route('/api/research', research);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, err?.message === 'Unauthorized' ? 401 : 500));

async function call(f: F, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: OWNER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/research${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: res.status, body: await res.json() as any };
}
const rows = (f: F, q: string) => f.db.prepare(q).all().map((r) => ({ ...r }));

test('migration: four fields only, a text field carries text and the cheque a range in a currency', () => {
  const { db } = fixture();
  const ins = (field: string, text: string | null, min: number | null, max: number | null, cur: string | null) => db.prepare(
    `INSERT INTO research_fund_vehicle_facts (fund_uid,field,value_text,min_cents,max_cents,currency,source_name,imported_on)
     VALUES ('lone',?,?,?,?,?,'L','2026-11-18')`).run(field, text, min, max, cur);
  // Mutation checked: drop a CHECK clause → that insert succeeds.
  assert.throws(() => ins('fund_size', 'x', null, null, null), /CHECK/, 'an unknown field');
  assert.throws(() => ins('manager_name', '  ', null, null, null), /CHECK/, 'a blank manager');
  assert.throws(() => ins('investment_stage', 'Seed', 1, null, 'EUR'), /CHECK/, 'a text field with an amount');
  assert.throws(() => ins('initial_cheque', null, 100, 200, null), /CHECK/, 'a cheque with no currency');
  assert.throws(() => ins('initial_cheque', null, null, null, 'EUR'), /CHECK/, 'a cheque with no amount');
  assert.throws(() => ins('initial_cheque', null, 500, 100, 'EUR'), /CHECK/, 'a cheque whose minimum is above its maximum');
  assert.throws(() => ins('initial_cheque', null, 100, 200, 'JPY'), /CHECK/, 'a currency the profile cannot print');
  ins('initial_cheque', null, null, 200, 'USD');
  ins('investment_geography', 'Nordics', null, null, null);
  assert.throws(() => ins('investment_geography', 'Baltics', null, null, null), /UNIQUE|PRIMARY/, 'one row per vehicle and field');
  const cols = rows({ db } as F, 'PRAGMA table_info(research_fund_directory_reports)').map((c: any) => c.name);
  assert.ok(cols.includes('vehicle_label'), 'report rows can name their vehicle');
});

test('the fund read: one provenance object with three dates kept apart', async () => {
  const f = fixture();
  const r = await call(f, 'GET', '/fund-directory/north-opp');
  assert.equal(r.status, 200);
  // Mutation checked: take reported_on from as_of → '2026-10-04'; reviewed_on from as_of → '2026-10-04'.
  assert.deepEqual(r.body.item.provenance, {
    list_name: EUR, list_title: 'Euro Tech VC Funds', publisher: '@Example_VC', published_url: 'https://list.example/eu',
    reported_on: '2023-09-25', imported_on: '2026-10-04', reviewed_on: '2026-10-07', verdict: 'cite only',
  });
  // A list with no review keeps the row's own link and no review date.
  const lone = await call(f, 'GET', '/fund-directory/lone');
  assert.deepEqual([lone.body.item.provenance.publisher, lone.body.item.provenance.published_url, lone.body.item.provenance.reviewed_on, lone.body.item.provenance.reported_on],
    [null, 'https://repo.example/u.csv', null, null]);
  assert.deepEqual(provenanceOf('L', ' ', '', null, undefined).published_url, null, 'a blank link is no link');
});

test('the proposed fields: recorded with their own source and date, else Not recorded with the reason', async () => {
  const f = fixture();
  const opp = (await call(f, 'GET', '/fund-directory/north-opp')).body.item.proposed;
  // D7748: the eight statement fields follow main's four.
  assert.deepEqual(Object.keys(opp), [...PROPOSED_FIELDS, ...STATEMENT_FIELDS]);
  assert.deepEqual([opp.manager_name.status, opp.manager_name.value, opp.manager_name.provenance.reported_on], ['recorded', 'North Capital', '2023-09-25']);
  assert.deepEqual(opp.initial_cheque.value, { min_cents: 100000000, max_cents: 500000000, currency: 'EUR' });
  assert.deepEqual(opp.investment_geography, { status: 'not_recorded', reason: PROPOSED_REASONS.investment_geography });
  assert.match(opp.investment_geography.reason, /Headquarters is where the manager is based/);
  // Mutation checked: drop the not-allowed filter from loadVehicleFacts → 'Growth' is served.
  const v = (await call(f, 'GET', '/fund-directory/north-v')).body.item.proposed;
  assert.deepEqual(v.investment_stage, { status: 'not_recorded', reason: PROPOSED_REASONS.investment_stage }, 'a fact from a withdrawn list is not served');
  // The facts table failing makes the fields Unavailable; the fund is still served.
  f.db.exec('ALTER TABLE research_fund_vehicle_facts RENAME TO research_fund_vehicle_facts_gone');
  const down = await call(f, 'GET', '/fund-directory/north-opp');
  assert.equal(down.status, 200);
  // Mutation checked: read a failed facts read as no facts → 'not_recorded'.
  assert.deepEqual(PROPOSED_FIELDS.map((k) => down.body.item.proposed[k].status), ['unavailable', 'unavailable', 'unavailable', 'unavailable']);
  assert.equal(down.body.history.vehicles_status, 'unavailable');
});

test('the history lists the manager\'s vehicles by label, and charts this vehicle\'s observations only', async () => {
  const f = fixture();
  const h = (await call(f, 'GET', '/fund-directory/north-opp')).body.history;
  assert.equal(h.manager, 'North Capital');
  // Mutation checked: drop the row's not-allowed check on the vehicles read → north-old (withdrawn list) is listed.
  assert.deepEqual(h.vehicles.map((v: any) => [v.uid, v.label, v.current]), [['north-opp', 'Opp', true], ['north-v', 'V', false]]);
  assert.deepEqual([h.vehicles[1].fund_size_cents, h.vehicles[1].size_currency, h.vehicles[1].provenance.reported_on], [58200000000, 'EUR', '2023-09-25']);
  // Its own row, and the report labelled Opp; never IV's or an unlabelled row.
  // Mutation checked: chart unlabelled rows → 2019-06-20 and 2018-04-17 appear; ignore the label → 2020-09-09 appears.
  assert.deepEqual(h.observations.map((o: any) => [o.reported_on, o.fund_size_cents, o.size_currency]),
    [['2021-07-22', 10000000000, 'EUR'], ['2023-09-25', 7500000000, 'EUR']]);
  assert.equal(h.unlabelled_reports, 2);
  // No manager recorded: the vehicles are Not recorded, and the own observation stays.
  const lone = (await call(f, 'GET', '/fund-directory/lone')).body.history;
  assert.deepEqual([lone.manager, lone.vehicles_status, lone.vehicles, lone.observations], [null, 'not_recorded', [], []]);
  assert.match(lone.vehicles_reason, /names the manager/);
});

test('a withdrawn source is refused by name: the read, Save to shortlist, Add and Compare', async () => {
  const f = fixture();
  const read = await call(f, 'GET', '/fund-directory/north-old');
  // Mutation checked: drop `error` from the 410 → undefined.
  assert.deepEqual([read.status, read.body.error, read.body.removed.name], [410, 'source_withdrawn', DOWN]);
  assert.doesNotMatch(JSON.stringify(read.body), /North Capital Old/, 'none of the fund');
  // Save to shortlist: refused, nothing written. Mutation checked: drop the check → 201 and a row.
  const save = await call(f, 'POST', '/funds', { name: 'North Capital Old', catalogue_uid: 'north-old' });
  assert.deepEqual([save.status, save.body.error, save.body.removed.verdict], [410, 'source_withdrawn', 'not allowed']);
  assert.equal(rows(f, 'SELECT * FROM research_funds').length, 0);
  assert.equal((await call(f, 'POST', '/funds', { name: 'North Capital Opp', catalogue_uid: 'north-opp' })).status, 201, 'a served fund saves');
  assert.equal((await call(f, 'POST', '/funds', { name: 'By hand' })).status, 201, 'a hand-written fund is not checked');
  const uid = (await call(f, 'POST', '/projects', { question: 'Which seed funds could lead our round?' })).body.item.uid;
  const add = await call(f, 'POST', `/projects/${uid}/subjects`, { kind: 'fund', uids: ['north-opp', 'north-old'] });
  assert.deepEqual([add.status, add.body.detail, add.body.withdrawn], [410, 'source_withdrawn', ['north-old']]);
  assert.equal(rows(f, 'SELECT * FROM research_project_subjects').length, 0, 'one withdrawn fund adds none');
  const missing = await call(f, 'POST', `/projects/${uid}/subjects`, { kind: 'fund', uids: ['nope'] });
  assert.deepEqual([missing.status, missing.body.detail], [404, 'not_in_directory'], 'a uid the directory never held is still not_in_directory');
  const cmp = await call(f, 'POST', `/projects/${uid}/comparisons`, { kind: 'fund', uids: ['north-old'] });
  assert.deepEqual([cmp.status, cmp.body.detail], [410, 'source_withdrawn']);
  const k = (await call(f, 'POST', `/projects/${uid}/comparisons`, { kind: 'fund', uids: ['north-opp'] })).body.item.uid;
  const member = await call(f, 'POST', `/projects/${uid}/comparisons/${k}/members`, { uid: 'north-old' });
  assert.deepEqual([member.status, member.body.detail, member.body.withdrawn], [410, 'source_withdrawn', ['north-old']]);
});

test('each comparison cell carries the same provenance as the fund read', async () => {
  const f = fixture();
  const uid = (await call(f, 'POST', '/projects', { question: 'Which seed funds could lead our round?' })).body.item.uid;
  await call(f, 'POST', `/projects/${uid}/comparisons`, { kind: 'fund', uids: ['north-opp', 'north-v', 'lone'] });
  const read = await call(f, 'GET', `/projects/${uid}/comparisons`);
  assert.deepEqual(read.body.attributes.fund.map((a: any) => a.key),
    ['manager', 'size', 'vintage', 'hq', 'focus', 'fund_number', 'stage', 'source_use', 'notable_lps', 'backing']);
  assert.deepEqual(ATTRIBUTES.fund.slice(0, 8).map((a) => a.label),
    ['Manager', 'Reported size', 'Vintage', 'Manager HQ', 'Stated focus', 'Label in the list', 'Investment stage', 'Source use']);
  const [opp, v, lone] = read.body.comparisons[0].members.map((m: any) => m.values);
  const profile = (await call(f, 'GET', '/fund-directory/north-opp')).body.item.provenance;
  // Mutation checked: drop the provenance from the size cell → undefined.
  for (const key of ['size', 'vintage', 'hq', 'focus', 'fund_number']) assert.deepEqual(opp[key].provenance, profile, `${key} cites the same object`);
  assert.deepEqual([opp.manager.value, opp.manager.provenance.reported_on], ['North Capital', '2023-09-25']);
  assert.deepEqual([opp.source_use.value, opp.source_use.reviewed_on, opp.source_use.imported_on], ['cite only', '2026-10-07', '2026-10-04']);
  assert.equal(v.stage.status, 'not_recorded', 'a stage from a withdrawn list is not shown');
  assert.deepEqual([lone.source_use.status, lone.manager.status, lone.size.status], ['not_recorded', 'not_recorded', 'not_recorded']);
  assert.equal(JSON.stringify(read.body.comparisons).includes('"value":0'), false, 'no missing value reads as zero');
  // The facts table failing leaves Manager and Stage out (Unavailable), not the column.
  f.db.exec('ALTER TABLE research_fund_vehicle_facts RENAME TO research_fund_vehicle_facts_gone');
  const down = (await call(f, 'GET', `/projects/${uid}/comparisons`)).body.comparisons[0].members[0];
  // Mutation checked: read a failed facts read as no facts → manager is 'not_recorded'.
  assert.deepEqual([down.state, down.values.manager, down.values.size.status], ['listed', undefined, 'recorded']);
  // The helper alone, with no review and no facts, invents nothing.
  const bare = fundCells({ uid: 'g', name: 'G', website: null, linkedin: null, hq: 'X', fund_number: null, fund_size_cents: null, fund_date: null, quarter: null, fund_year: null, sector_focus: null, notable_lps: null, eif_flag: 0, eifo_flag: 0, source_name: 'L', source_url: 'u', as_of: '2026-10-01' });
  assert.deepEqual([bare.manager.status, bare.stage.status, bare.source_use.status, (bare.hq as any).provenance.publisher], ['not_recorded', 'not_recorded', 'not_recorded', null]);
});
