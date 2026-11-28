/**
 * D7748 (#7748) — Research › Funds profile and comparison read: every sourced
 * statement about a fund (D7743's served read), with its wording, qualifier,
 * currency state and one provenance object, on the single-fund read and in
 * each fund column of a project comparison.
 *
 * Real SQLite: the fund directory and its reports (378), 406's sources, the
 * uid moves (7166), the vehicle facts (7167), the statement store (7743), the
 * row currency (7744) and the project comparisons (5157, 7177). Every fund,
 * manager, list and wording here is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_fund_profile_observations_7748.test.ts
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
import comparisons, { ATTRIBUTES } from '../src/routes/research_project_comparisons.ts';
import {
  OLD_AFTER_MONTHS, PAST_ONLY_REASON, PROPOSED_FIELDS, STATEMENT_FIELDS, STATEMENT_REASONS, fundProfile, isOld, oldCutoff,
  presentProposed,
} from '../src/services/researchFundProfile.ts';
import { loadFundSources } from '../src/services/researchFundDirectory.ts';
import { observationStatements, type ObservationInput } from '../src/services/researchFundObservations.ts';

const sql = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const SECRET = 'test'.repeat(16);
const OWNER = 7748;
const CITE = 'Lantern Reed Fund Index';
const OPEN = 'Quillmere Investor Notes';
const DOWN = 'Slatewick Fund Sheet';
const URL_ROW = 'https://list.example/row';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
  for (const t of ['users', 'projects', 'activity_logs']) db.exec(baseline.match(new RegExp(`CREATE TABLE ${t} \\([\\s\\S]*?;`))![0]);
  db.exec(sql('213_research_library.sql'));
  db.exec(sql('221_research_ask_sessions.sql'));
  db.exec(sql('202611151315_6272_ask_history_cleared.sql'));
  db.exec(sql('385_research_disposition_collections.sql'));
  db.exec(sql('202611092035_research_projects.sql'));
  db.exec(sql('216_research_funds.sql'));
  db.exec(sql('202611092035_research_fund_catalogue_uid.sql'));
  db.exec(sql('202611180053_7168_research_fund_identity_allocation.sql'));
  const m378 = sql('378_research_fund_directory_rebuild.sql');
  db.exec(m378.match(/CREATE TABLE IF NOT EXISTS research_fund_directory \(.*?\);/)![0]);
  db.exec(m378.match(/CREATE TABLE IF NOT EXISTS research_fund_directory_reports \(.*?\);/)![0]);
  db.exec(sql('202611270508_7744_research_fund_size_currency_and_kind.sql'));
  db.exec(sql('406_research_fund_sources.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_sources \([\s\S]*?\n\);/)![0]);
  db.exec(sql('202611180052_7166_research_fund_directory_vehicles.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_directory_uid_moves \(.*?\);/)![0]);
  db.exec(sql('202611130634_5157_research_project_comparisons.sql'));
  db.exec(sql('202611180051_7177_research_comparison_request_id.sql'));
  db.exec(sql('202611180053_7167_research_fund_vehicle_facts.sql'));
  db.exec(sql('202611191932_7743_research_fund_observations.sql'));
  db.exec(`INSERT INTO users (id,email,name,role) VALUES (${OWNER},'owner@example.test','Owner','founder')`);
  db.exec(`INSERT INTO research_fund_sources (source_name,title,publisher,published_url,terms_status,terms_quote,evidence_url,evidence,verdict,verdict_reason,reviewed_on) VALUES
    ('${CITE}','Lantern Reed','A publisher','https://list.example/lr','not found',NULL,NULL,'e','cite only','r','2026-11-01'),
    ('${OPEN}','Quillmere','A publisher','https://list.example/qm','found','Reuse is welcome.','https://list.example/qm/terms','e','republish allowed','r','2026-11-02'),
    ('${DOWN}','Slatewick','A publisher','https://list.example/sw','not found',NULL,NULL,'e','not allowed','r','2026-11-03')`);
  const dir = db.prepare(`INSERT INTO research_fund_directory (uid,name,hq,fund_number,fund_size_cents,fund_size_currency,fund_date,quarter,fund_year,source_name,source_url,as_of)
    VALUES (?,?,'Harbourtown','I',?,?,'2025-03-01','2025-Q1',2025,?,'https://repo.example/lr.csv','2026-11-01')`);
  dir.run('pine-i', 'Pinecrest Ventures I', 4000000000, 'EUR', CITE);
  dir.run('bare-i', 'Bare Meadow I', null, null, CITE);
  for (const n of [1, 2, 3, 4]) dir.run(`six-${n}`, `Sixfold ${n}`, null, null, CITE);
  db.prepare(`INSERT INTO research_fund_vehicle_facts (fund_uid,field,value_text,source_name,source_url,reported_on,imported_on)
    VALUES ('pine-i','manager_name','Pinecrest Partners',?,NULL,'2025-03-01','2026-11-01')`).run(CITE);
  // A statement stored under a uid that moved to pine-i (D7166, one hop).
  db.exec(`INSERT INTO research_fund_directory_uid_moves (old_uid,new_uid,moved_on) VALUES ('pine-old','pine-i','2026-11-10')`);
  db.exec('PRAGMA foreign_keys=ON');
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env };
}
type F = ReturnType<typeof fixture>;

let ref = 0;
async function state(f: F, inputs: Partial<ObservationInput>[]) {
  const w = observationStatements(f.env.DB, inputs.map((i) => ({
    fund_uid: 'pine-i', source_name: CITE, source_url: URL_ROW, source_record_ref: `r-${++ref}`,
    imported_on: '2026-11-19', method: 'rule', ...i,
  }) as ObservationInput));
  await f.env.DB.batch(w.statements);
}

/** The pine-i statements most tests read. */
async function pine(f: F) {
  await state(f, [
    { fact: 'investment_stage', wording: 'Seed to Series A', reported_on: '2025-06-01' },
    { fact: 'investment_stage', wording: 'Pre-seed', source_name: OPEN, reported_on: '2024-02-01' },
    { fact: 'investment_stage', wording: 'Growth', source_name: DOWN, reported_on: '2026-01-01' },
    { fact: 'investment_stage', wording: 'Series B', reported_on: '2019-01-01', period_start: '2018-01-01', period_end: '2019-12-31' },
    { fact: 'investment_geography', wording: 'Nordics', fund_uid: 'pine-old' },
    { fact: 'investment_geography', wording: 'Benelux' },
    { fact: 'initial_cheque', wording: 'Average first cheque €750k' },
    { fact: 'stated_fund_capital', wording: 'EUR 120m', reported_on: '2025-06-01' },
    { fact: 'manager_aum', wording: 'EUR 900m under management', reported_on: '2025-06-01' },
    { fact: 'description', wording: 'An invented line a cite-only list wrote.' },
    { fact: 'sector_focus', wording: 'Invented sector words' },
    { fact: 'lead_preference', wording: 'Leads or co-leads', source_name: OPEN, reported_on: '2025-06-01' },
  ]);
}

const app = new Hono<any>()
  .route('/api/research/projects', comparisons).route('/api/research/projects', projects).route('/api/research', research);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, err?.message === 'Unauthorized' ? 401 : 500));

async function call(f: F, method: string, path: string, body?: unknown, env = f.env) {
  const token = await new SignJWT({ user_id: OWNER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/research${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  return { status: res.status, body: await res.json() as any };
}
const fund = async (f: F, uid: string) => (await call(f, 'GET', `/fund-directory/${uid}`)).body;

test('two lists\' stage statements both answer with their provenance, newer first; a past one is under past_statements only', async () => {
  const f = fixture();
  await pine(f);
  const stage = (await fund(f, 'pine-i')).item.proposed.investment_stage;
  // Mutation checked: drop the not-allowed filter's effect (serve DOWN) → 'Growth' leads; reverse the order → 'Pre-seed' first.
  assert.deepEqual(stage.statements.map((s: any) => [s.wording, s.provenance.list_name, s.provenance.reported_on]),
    [['Seed to Series A', CITE, '2025-06-01'], ['Pre-seed', OPEN, '2024-02-01']]);
  assert.deepEqual(stage.statements[0].terms.map((t: any) => t.term), ['seed', 'series_a']);
  assert.deepEqual(stage.statements[1].provenance, {
    list_name: OPEN, list_title: 'Quillmere', publisher: 'A publisher', published_url: 'https://list.example/qm',
    reported_on: '2024-02-01', imported_on: '2026-11-19', reviewed_on: '2026-11-02', verdict: 'republish allowed',
  });
  assert.deepEqual([stage.status, stage.value, stage.tied, stage.provenance.list_name], ['recorded', 'Seed to Series A', false, CITE]);
  // Mutation checked: put past statements among the current → 'Series B' is in statements.
  assert.deepEqual(stage.past_statements.map((s: any) => [s.wording, s.period_start, s.period_end]), [['Series B', '2018-01-01', '2019-12-31']]);
  assert.equal(JSON.stringify(stage.statements).includes('Series B'), false, 'a past statement is never current');
  assert.equal(JSON.stringify(stage).includes('Growth'), false, 'a statement from a not-allowed list is absent');
});

test('a past statement alone is never the current stage', async () => {
  const f = fixture();
  await state(f, [{ fact: 'investment_stage', wording: 'Series B', period_end: '2019-12-31' }]);
  const stage = (await fund(f, 'pine-i')).item.proposed.investment_stage;
  // Mutation checked: count past statements as current → status 'recorded'.
  assert.deepEqual([stage.status, stage.reason, stage.statements, stage.past_statements.length], ['not_recorded', PAST_ONLY_REASON, [], 1]);
});

test('two undated statements that differ are tied and none is picked; two that agree are not', async () => {
  const f = fixture();
  await pine(f);
  const geo = (await fund(f, 'pine-i')).item.proposed.investment_geography;
  // The Nordics line was stored under the uid that moved to pine-i.
  assert.deepEqual(geo.statements.map((s: any) => s.wording).sort(), ['Benelux', 'Nordics']);
  // Mutation checked: compare reported dates only (not the wording) → tied stays true on agreement; pick the first → value 'Benelux'.
  assert.deepEqual([geo.status, geo.tied, geo.value, geo.provenance], ['recorded', true, null, null]);
  const g = fixture();
  await state(g, [{ fact: 'investment_geography', wording: 'Nordics' }, { fact: 'investment_geography', wording: ' nordics', source_name: OPEN }]);
  const same = (await fund(g, 'pine-i')).item.proposed.investment_geography;
  assert.deepEqual([same.tied, same.value], [false, 'Nordics']);
});

test('the cheque: an average answers one amount as worded, a symbol-only amount says its currency is not verified, a range in EUR fills value', async () => {
  const f = fixture();
  await pine(f);
  const avg = (await fund(f, 'pine-i')).item.proposed.initial_cheque;
  const s = avg.statements[0];
  // Mutation checked: serve a typical point as a range → min_cents/max_cents appear; fill value from any lead → value set.
  assert.deepEqual([s.wording, s.qualifier, s.point_cents, 'min_cents' in s, 'max_cents' in s], ['Average first cheque €750k', 'average_first', 75000000, false, false]);
  assert.deepEqual([s.currency, s.currency_basis, s.currency_verified], [null, 'symbol_only', false]);
  assert.deepEqual([avg.status, avg.value], ['recorded', null]);
  const g = fixture();
  await state(g, [{ fact: 'initial_cheque', wording: 'EUR 500k - 2m' }]);
  const range = (await fund(g, 'pine-i')).item.proposed.initial_cheque;
  assert.deepEqual(range.value, { min_cents: 50000000, max_cents: 200000000, currency: 'EUR' });
  assert.equal(range.statements[0].currency_verified, true);
  const h = fixture();
  await state(h, [{ fact: 'initial_cheque', wording: 'Up to $2m' }]);
  // Mutation checked: accept a cheque with no stated currency as main's form → a value with currency null.
  assert.deepEqual((await fund(h, 'pine-i')).item.proposed.initial_cheque.value, null, 'a range with no stated currency is never main\'s form');
  const t = fixture();
  await state(t, [{ fact: 'initial_cheque', wording: 'Typically EUR 1m' }]);
  const typical = (await fund(t, 'pine-i')).item.proposed.initial_cheque;
  // Mutation checked: drop the qualifier and bounds checks → { min_cents: null, max_cents: null, currency: 'EUR' }.
  assert.deepEqual([typical.statements[0].qualifier, typical.statements[0].point_cents, typical.statements[0].currency, typical.value],
    ['typical', 100000000, 'EUR', null], 'a typical amount in a stated currency is served as worded, never as a range');
});

test('stated fund capital and manager AUM are their own fields; the reported size, its cell and the chart are unchanged', async () => {
  const f = fixture();
  const before = await fund(f, 'pine-i');
  await pine(f);
  const after = await fund(f, 'pine-i');
  const p = after.item.proposed;
  assert.deepEqual([p.stated_fund_capital.status, p.stated_fund_capital.statements[0].wording, p.stated_fund_capital.statements[0].point_cents],
    ['recorded', 'EUR 120m', 12000000000]);
  assert.deepEqual([p.manager_aum.status, p.manager_aum.statements[0].wording], ['recorded', 'EUR 900m under management']);
  assert.deepEqual([after.item.fund_size_cents, after.item.size_currency], [before.item.fund_size_cents, before.item.size_currency]);
  assert.deepEqual(after.history.observations, before.history.observations);
  assert.deepEqual(p.lead_preference.statements.map((x: any) => [x.wording, x.provenance.list_name]), [['Leads or co-leads', OPEN]]);
  assert.deepEqual([p.traction_requirement.status, p.traction_requirement.reason], ['not_recorded', STATEMENT_REASONS.traction_requirement]);
});

test('a description from a cite-only list is not reproduced, one from a republish list is; a fact outside the allow-list is in neither read', async () => {
  const f = fixture();
  await pine(f);
  const body = await fund(f, 'pine-i');
  // Mutation checked: serve a description under any verdict → the cite-only line appears.
  assert.deepEqual([body.item.proposed.description.status, body.item.proposed.description.reason], ['not_recorded', STATEMENT_REASONS.description]);
  assert.equal(JSON.stringify(body).includes('cite-only list wrote'), false);
  assert.deepEqual(Object.keys(body.item.proposed), [...PROPOSED_FIELDS, ...STATEMENT_FIELDS]);
  const uid = (await call(f, 'POST', '/projects', { question: 'Which seed funds could lead our round?' })).body.item.uid;
  await call(f, 'POST', `/projects/${uid}/comparisons`, { kind: 'fund', uids: ['pine-i'] });
  const cmp = (await call(f, 'GET', `/projects/${uid}/comparisons`)).body;
  // Mutation checked: add sector_focus to STATEMENT_FIELDS → its wording appears in the fund read.
  for (const read of [body, cmp]) assert.equal(JSON.stringify(read).includes('Invented sector words'), false, 'sector_focus is outside the allow-list');
  const g = fixture();
  await state(g, [{ fact: 'description', wording: 'An invented line a republish list wrote.', source_name: OPEN }]);
  assert.equal((await fund(g, 'pine-i')).item.proposed.description.statements[0].wording, 'An invented line a republish list wrote.');
});

test('the statement read failing makes every field Unavailable, never Not recorded, and the row is still served', async () => {
  const f = fixture();
  await pine(f);
  f.db.exec('ALTER TABLE research_fund_observations RENAME TO research_fund_observations_gone');
  const r = await call(f, 'GET', '/fund-directory/pine-i');
  assert.equal(r.status, 200);
  // Mutation checked: read a failed read as no statements → 'not_recorded'.
  for (const k of [...PROPOSED_FIELDS, ...STATEMENT_FIELDS]) assert.equal(r.body.item.proposed[k].status, 'unavailable', k);
  assert.deepEqual([r.body.item.name, r.body.item.fund_size_cents, r.body.history.vehicles_status], ['Pinecrest Ventures I', 4000000000, 'unavailable']);
});

test('manager_name is one string from the vehicle facts whenever recorded, with the store\'s statements beside it', async () => {
  const f = fixture();
  await state(f, [{ fact: 'manager_name', wording: 'Pinecrest Partners LLP', source_name: OPEN, reported_on: '2026-01-01' }]);
  const m = (await fund(f, 'pine-i')).item.proposed.manager_name;
  // Mutation checked: take the manager from the leading statement → 'Pinecrest Partners LLP'.
  assert.deepEqual([m.status, m.value, m.provenance.list_name], ['recorded', 'Pinecrest Partners', CITE]);
  assert.deepEqual(m.statements.map((s: any) => s.wording), ['Pinecrest Partners LLP', 'Pinecrest Partners']);
  // Another fund whose only manager line is in the new store: Not recorded, never a non-string value.
  await state(f, [{ fact: 'manager_name', wording: 'Bare Meadow Capital', fund_uid: 'bare-i' }, { fact: 'manager_name', wording: 'Bare Meadow Partners', fund_uid: 'bare-i', source_name: OPEN }]);
  const b = (await fund(f, 'bare-i')).item.proposed.manager_name;
  assert.deepEqual([b.status, typeof b.value, b.statements.length], ['not_recorded', 'undefined', 2]);
});

test('a fund with no statements answers main\'s fields exactly', async () => {
  const f = fixture();
  const body = await fund(f, 'bare-i');
  const reviews = await loadFundSources(f.env);
  const main = presentProposed(new Map(), reviews);
  // Mutation checked: always add statements/past_statements/tied → main's keys gain three keys.
  for (const k of PROPOSED_FIELDS) assert.deepEqual(body.item.proposed[k], main[k], k);
  for (const k of STATEMENT_FIELDS) {
    assert.deepEqual(body.item.proposed[k], { status: 'not_recorded', reason: STATEMENT_REASONS[k], statements: [], past_statements: [], tied: false, old: null }, k);
  }
  assert.deepEqual(body.history.vehicles_status, 'not_recorded');
});

test('Old is measured from the Worker\'s date and the canvas threshold, per statement and per field', async () => {
  const f = fixture();
  await state(f, [
    { fact: 'investment_stage', wording: 'Seed', reported_on: '2024-11-27' },
    { fact: 'investment_stage', wording: 'Series A', source_name: OPEN, reported_on: '2024-11-29' },
    { fact: 'traction_requirement', wording: 'Some invented revenue', reported_on: '2023-06-01' },
    { fact: 'interests', wording: 'Invented interests' },
  ]);
  const row = f.db.prepare("SELECT * FROM research_fund_directory WHERE uid = 'pine-i'").get() as any;
  const reviews = await loadFundSources(f.env);
  const p = (await fundProfile(f.env, row, reviews, new Date('2026-11-28T12:00:00Z'))).proposed as any;
  assert.equal(OLD_AFTER_MONTHS, 24);
  assert.equal(oldCutoff(new Date('2026-11-28T12:00:00Z')), '2024-11-28');
  // Mutation checked: `<=` for `<` in isOld → 2024-11-28 reads Old; read a month as its first day → '2022-11' reads Old against 2022-11-15.
  assert.deepEqual(p.investment_stage.statements.map((s: any) => [s.wording, s.old]), [['Series A', false], ['Seed', true]]);
  assert.deepEqual([p.investment_stage.old, p.traction_requirement.old, p.interests.old, p.interests.statements[0].old], [false, true, null, null]);
  assert.deepEqual([isOld('2024-11-28', '2024-11-28'), isOld('2022-11', '2022-11-15'), isOld('not a date', '2024-01-01')], [false, false, null]);
});

test('the comparison: each fund member carries geography and cheque with a source per cell, from one statement read for six funds', async () => {
  const f = fixture();
  await pine(f);
  await state(f, [{ fact: 'initial_cheque', wording: 'EUR 250k - 1m', fund_uid: 'bare-i', reported_on: '2025-01-01' }]);
  const uid = (await call(f, 'POST', '/projects', { question: 'Which seed funds could lead our round?' })).body.item.uid;
  const six = ['pine-i', 'bare-i', 'six-1', 'six-2', 'six-3', 'six-4'];
  await call(f, 'POST', `/projects/${uid}/comparisons`, { kind: 'fund', uids: six });
  let reads = 0;
  const counted = { ...f.env, DB: new Proxy(f.env.DB, { get: (t, k) => (k === 'prepare' ? (q: string) => { if (/FROM research_fund_observations o\b/.test(q)) reads += 1; return t.prepare(q); } : Reflect.get(t, k)) }) };
  const read = await call(f, 'GET', `/projects/${uid}/comparisons`, undefined, counted);
  // Mutation checked: read statements once per fund → 6.
  assert.equal(reads, 1, 'one statement read for the comparison');
  assert.deepEqual(read.body.attributes.fund.map((a: any) => a.key), ATTRIBUTES.fund.map((a) => a.key));
  assert.equal(read.body.attributes.fund.length, 10);
  const members = read.body.comparisons[0].members;
  assert.equal(members.length, 6);
  const [p, b, s1] = members.map((m: any) => m.values);
  assert.deepEqual([p.stage.value, p.stage.source.name, p.stage.provenance.reported_on, p.stage.statements.length], ['Seed to Series A', CITE, '2025-06-01', 2]);
  assert.deepEqual([p.geography.status, p.geography.tied, p.geography.value], ['recorded', true, null]);
  assert.deepEqual(p.geography.statements.map((x: any) => x.provenance.list_name), [CITE, CITE]);
  assert.deepEqual([p.cheque.value, p.cheque.qualifier, p.cheque.source.name], ['Average first cheque €750k', 'average_first', CITE]);
  // Mutation checked: drop the cheque's qualifier → undefined; drop the source → name null.
  assert.deepEqual([b.cheque.value, b.cheque.qualifier, b.cheque.source, b.cheque.as_of], ['EUR 250k - 1m', 'range', { name: CITE, url: 'https://list.example/lr' }, '2025-01-01']);
  assert.equal(JSON.stringify(b.cheque).includes('"rank"'), false, 'no rank');
  assert.deepEqual([s1.geography.status, s1.cheque.status, s1.manager.status], ['not_recorded', 'not_recorded', 'not_recorded']);
  assert.deepEqual(p.manager.value, 'Pinecrest Partners');
  // The statement read failing leaves the four statement cells out (Unavailable), not the column.
  f.db.exec('ALTER TABLE research_fund_observations RENAME TO research_fund_observations_gone');
  const down = (await call(f, 'GET', `/projects/${uid}/comparisons`)).body.comparisons[0].members[0];
  assert.deepEqual([down.state, down.values.manager, down.values.stage, down.values.geography, down.values.cheque, down.values.size.status],
    ['listed', undefined, undefined, undefined, undefined, 'recorded']);
});
