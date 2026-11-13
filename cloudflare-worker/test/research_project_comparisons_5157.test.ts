/**
 * D5157 part 3 (#5157) — a Research Project's companies and funds (Add to
 * research) and its comparisons, against the canonical migrations: one kind
 * per comparison held by the schema, values read from the directories with
 * their source and date, Not recorded and Unreadable kept apart, owner scoping,
 * the archived guard and bound SQL.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_project_comparisons_5157.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import projects from '../src/routes/research_projects.ts';
import comparisons, {
  MEMBER_LIMIT, companyCells, defaultComparisonTitle, fundCells, mount, readUids,
} from '../src/routes/research_project_comparisons.ts';

// Mounted as the registry mounts them: comparisons first (file-name order), then the project router.
const app = new Hono().route('/api/research/projects', comparisons).route('/api/research/projects', projects);
app.onError((error, c) => c.json({ detail: error.message }, error.message === 'Unauthorized' ? 401 : 500));
const SECRET = 'unit-research-comparisons-0123456789012345678';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
const MIGRATION = 'migrations/202611130634_5157_research_project_comparisons.sql';
const EUR = 'EuroTech VC Funds (public spreadsheet)';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  db.exec(baseline.match(/CREATE TABLE users \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE projects \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE activity_logs \([\s\S]*?;/)![0]);
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(sql('migrations/202611092035_research_projects.sql'));
  // The directories as their migrations declare them (the seed rows are not needed).
  db.exec(sql('migrations/228_research_company_directory.sql').match(/CREATE TABLE IF NOT EXISTS research_company_directory \([\s\S]*?\n\);/)![0]);
  db.exec(sql('migrations/375_research_company_directory_columns.sql'));
  db.exec(sql('migrations/378_research_fund_directory_rebuild.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_directory \(.*?\);/)![0]);
  db.exec(sql('migrations/406_research_fund_sources.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_sources \([\s\S]*?\n\);/)![0]);
  db.exec(sql(MIGRATION));
  db.exec("INSERT INTO users (id,email,name,role) VALUES (701,'owner@example.test','Owner','founder'),(702,'other@example.test','Other','founder')");
  db.exec(`INSERT INTO research_company_directory (uid,name,website,country,founded_year,sector,source_name,source_url,as_of,
      employee_count,employee_as_of,last_funding_amount,last_funding_currency,last_funding_date,last_funding_type,metrics_source_name,metrics_source_url,metrics_updated_at) VALUES
    ('q-nebula','Nebula Compute','https://nebula.example','Norway',2021,'GPU cloud','Wikidata','https://www.wikidata.org/wiki/Q1','2026-09-30',
      40,'2026-06-01',2500000,'EUR','2025-06-01','Seed','Company filing','https://filing.example/1','2026-07-01'),
    ('q-aster','Aster Cloud','https://aster.example','France',NULL,'',  'Wikidata','https://www.wikidata.org/wiki/Q2','2026-09-30',
      NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
    ('q-fjord','Fjord Data','https://fjord.example','Estonia',2019,'Data infrastructure','Wikidata','https://www.wikidata.org/wiki/Q3','2026-09-30',
      NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`);
  db.exec(`INSERT INTO research_fund_sources (source_name,title,terms_status,evidence,verdict,verdict_reason,reviewed_on) VALUES
    ('${EUR}','Euro Tech VC Funds','not found','e','cite only','r','2026-10-07'),
    ('Taken down list','Taken down','not found','e','not allowed','r','2026-10-07')`);
  db.exec(`INSERT INTO research_fund_directory (uid,name,hq,fund_number,fund_size_cents,fund_date,fund_year,sector_focus,notable_lps,eif_flag,eifo_flag,source_name,source_url,as_of) VALUES
    ('northwind','Northwind Seed','Copenhagen','Fund I',5000000000,'2024-03-01',2024,'Climate','EIF, family offices',1,0,'${EUR}','https://sheet.example/1','2026-10-01'),
    ('granite','Granite Ventures','London',NULL,7000000000,NULL,NULL,NULL,NULL,0,0,'Another list','https://sheet.example/2','2026-10-01'),
    ('gone-fund','Withdrawn Fund','Paris',NULL,NULL,NULL,NULL,NULL,NULL,0,0,'Taken down list','https://sheet.example/3','2026-10-01')`);
  db.exec('PRAGMA foreign_keys=ON');
  const statements: string[] = [];
  const underlying = d1Over(db);
  const DB = { ...underlying, prepare(query: string) { statements.push(query); return underlying.prepare(query); } };
  return { db, statements, env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path: string, body?: unknown, who: number | null = 701) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who != null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  }
  const response = await app.request(`/api/research/projects${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}
const rows = (f: F, q: string) => f.db.prepare(q).all().map((r) => ({ ...r }));
const receipts = (f: F) => rows(f, "SELECT action, details FROM activity_logs WHERE action LIKE 'research_project_%' ORDER BY id").map((r: any) => r.action);
const project = async (f: F, who = 701) => (await call(f, 'POST', '', { question: 'Which EU GPU providers can a seed company compete with?' }, who)).body.item.uid as string;

test('the router mounts itself at /api/research/projects beside the project router (#4105)', () => {
  assert.equal(mount.path, '/api/research/projects');
  assert.equal(mount.router, comparisons);
  const registry = readFileSync(new URL('../src/routes/_registry.ts', import.meta.url), 'utf8');
  assert.match(registry, /research_project_comparisons/);
});

test('the migration holds one kind per comparison: a fund cannot be a column of a company comparison', () => {
  const f = fixture();
  f.db.exec("INSERT INTO research_projects (id,uid,owner_user_id,title,question,created_by) VALUES (1,'p',701,'T','Q',701)");
  f.db.exec(`INSERT INTO research_project_subjects (id,project_id,owner_user_id,kind,directory_uid,name,created_by) VALUES
    (1,1,701,'company','q-nebula','Nebula Compute',701),(2,1,701,'fund','northwind','Northwind Seed',701)`);
  f.db.exec("INSERT INTO research_project_comparisons (id,uid,project_id,owner_user_id,kind,title,created_by) VALUES (1,'k',1,701,'company','GPU',701)");
  const member = (subject: number, kind: string) => f.db.prepare(
    'INSERT INTO research_project_comparison_members (comparison_id,subject_id,kind,position,created_by) VALUES (1,?,?,1,701)',
  ).run(subject, kind);
  // Mutation checked: drop the (subject_id, kind) foreign key → the fund inserts as a company column.
  assert.throws(() => member(2, 'company'), /FOREIGN KEY/);
  // Mutation checked: drop the (comparison_id, kind) foreign key → the fund inserts under its own kind.
  assert.throws(() => member(2, 'fund'), /FOREIGN KEY/);
  member(1, 'company');
  // Mutation checked: drop UNIQUE (project_id, kind, directory_uid) → a second row for the company inserts.
  assert.throws(() => f.db.exec("INSERT INTO research_project_subjects (project_id,owner_user_id,kind,directory_uid,name,created_by) VALUES (1,701,'company','q-nebula','Again',701)"), /UNIQUE/);
  assert.throws(() => f.db.exec("INSERT INTO research_project_subjects (project_id,owner_user_id,kind,directory_uid,name,created_by) VALUES (1,701,'market','m','M',701)"), /CHECK/);
  // Removing the subject takes it out of its comparisons; deleting a comparison keeps its subjects.
  f.db.exec('DELETE FROM research_project_subjects WHERE id = 1');
  assert.equal(rows(f, 'SELECT * FROM research_project_comparison_members').length, 0);
  f.db.exec('DELETE FROM research_project_comparisons WHERE id = 1');
  assert.equal(rows(f, 'SELECT * FROM research_project_subjects').length, 1);
});

test('Add to research: directory rows only, owner-scoped, kept once, and a taken-down list adds nothing', async () => {
  const f = fixture();
  const uid = await project(f);
  const added = await call(f, 'POST', `/${uid}/subjects`, { kind: 'company', uids: ['q-nebula', 'q-aster'] });
  assert.deepEqual([added.status, added.body.added, added.body.already], [200, 2, 0]);
  const again = await call(f, 'POST', `/${uid}/subjects`, { kind: 'company', uids: ['q-nebula'] });
  assert.deepEqual([again.body.added, again.body.already], [0, 1]);
  // Mutation checked: read funds from the raw table instead of the served ones → the taken-down fund is added.
  const withdrawn = await call(f, 'POST', `/${uid}/subjects`, { kind: 'fund', uids: ['gone-fund'] });
  assert.deepEqual([withdrawn.status, withdrawn.body.detail, withdrawn.body.missing], [404, 'not_in_directory', ['gone-fund']]);
  assert.equal((await call(f, 'POST', `/${uid}/subjects`, { kind: 'company', uids: ['q-nebula', 'nope'] })).status, 404, 'one unknown uid adds none');
  assert.equal((await call(f, 'POST', `/${uid}/subjects`, { kind: 'market', uids: ['q-nebula'] })).body.detail, 'invalid_kind');
  assert.equal((await call(f, 'POST', `/${uid}/subjects`, { kind: 'company', uids: ["x'; DROP TABLE users;--"] })).body.detail, 'invalid_uid');
  assert.deepEqual(rows(f, 'SELECT kind, directory_uid, name FROM research_project_subjects ORDER BY id'), [
    { kind: 'company', directory_uid: 'q-nebula', name: 'Nebula Compute' },
    { kind: 'company', directory_uid: 'q-aster', name: 'Aster Cloud' },
  ]);
  // Another member's project is a 404, read or write, and nothing is written.
  // Mutation checked: drop the owner check from writableProject → 702 adds a subject here.
  assert.equal((await call(f, 'POST', `/${uid}/subjects`, { kind: 'fund', uids: ['northwind'] }, 702)).status, 404);
  assert.equal((await call(f, 'GET', `/${uid}/comparisons`, undefined, 702)).status, 404);
  assert.equal((await call(f, 'DELETE', `/${uid}/subjects/company/q-aster`, undefined, 702)).status, 404);
  assert.equal(rows(f, 'SELECT * FROM research_project_subjects').length, 2);
  assert.equal((await call(f, 'GET', `/${uid}/comparisons`, undefined, null)).status, 401);
  assert.equal((await call(f, 'DELETE', `/${uid}/subjects/company/q-aster`)).status, 200);
  assert.deepEqual(receipts(f).filter((a) => a.includes('subject')), ['research_project_subject_added', 'research_project_subject_removed']);
});

test('a comparison: one kind, its columns in order, values with source and date, Not recorded never zero', async () => {
  const f = fixture();
  const uid = await project(f);
  const made = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['q-nebula', 'q-aster', 'q-fjord'] });
  assert.equal(made.status, 201);
  assert.equal(made.body.item.title, 'Nebula Compute · Aster Cloud · Fjord Data');
  // The members became the project's subjects too.
  assert.equal(rows(f, "SELECT * FROM research_project_subjects WHERE kind = 'company'").length, 3);
  const read = await call(f, 'GET', `/${uid}/comparisons`);
  assert.equal(read.status, 200);
  const k = read.body.comparisons[0];
  assert.deepEqual(k.members.map((m: any) => [m.uid, m.state]), [['q-nebula', 'listed'], ['q-aster', 'listed'], ['q-fjord', 'listed']]);
  const [nebula, aster] = k.members.map((m: any) => m.values);
  assert.deepEqual(nebula.country, { status: 'recorded', value: 'Norway', source: { name: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q1' }, as_of: '2026-09-30' });
  assert.deepEqual([nebula.employees.value, nebula.employees.source.name, nebula.employees.as_of], [40, 'Company filing', '2026-06-01']);
  assert.deepEqual([nebula.last_round.value, nebula.last_round.currency, nebula.last_round.type, nebula.last_round.date], [2500000, 'EUR', 'Seed', '2025-06-01']);
  // Mutation checked: read a blank or missing value as recorded → these read 'recorded'.
  assert.deepEqual([aster.founded.status, aster.sector.status, aster.employees.status, aster.revenue.status], ['not_recorded', 'not_recorded', 'not_recorded', 'not_recorded']);
  assert.equal(JSON.stringify(read.body.comparisons).includes('"value":0'), false, 'no missing value reads as zero');
  assert.deepEqual(read.body.attributes.company.map((a: any) => a.key), ['country', 'sector', 'founded', 'employees', 'last_round', 'funding_total', 'revenue']);
  assert.deepEqual(read.body.subjects.map((s: any) => [s.uid, s.comparisons]), [['q-nebula', 1], ['q-aster', 1], ['q-fjord', 1]]);
  // A fund cannot join a company comparison through the route either.
  const kuid = k.uid;
  assert.equal((await call(f, 'POST', `/${uid}/comparisons/${kuid}/members`, { uid: 'northwind' })).body.detail, 'not_in_directory');
  assert.equal((await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['q-nebula', 'q-aster', 'q-fjord', 'a1', 'a2', 'a3', 'a4'] })).body.detail, 'comparison_full');
  assert.match(receipts(f).join(','), /research_project_comparison_created/);
});

test('members: added once, removed, refused past the limit; rename and delete keep the subjects', async () => {
  const f = fixture();
  const uid = await project(f);
  const kuid = (await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['q-nebula'], title: '  EU   GPU providers ' })).body.item.uid;
  assert.equal(rows(f, 'SELECT title FROM research_project_comparisons')[0].title, 'EU GPU providers');
  assert.deepEqual((await call(f, 'POST', `/${uid}/comparisons/${kuid}/members`, { uid: 'q-aster' })).body, { ok: true, added: true });
  assert.deepEqual((await call(f, 'POST', `/${uid}/comparisons/${kuid}/members`, { uid: 'q-aster' })).body, { ok: true, added: false });
  assert.deepEqual(rows(f, 'SELECT subject_id, position FROM research_project_comparison_members ORDER BY position').map((r: any) => r.position), [1, 2]);
  assert.equal((await call(f, 'DELETE', `/${uid}/comparisons/${kuid}/members/q-aster`)).status, 200);
  assert.equal((await call(f, 'DELETE', `/${uid}/comparisons/${kuid}/members/q-aster`)).status, 404);
  // Full: the limit is enforced before anything is written.
  for (let i = 0; i < MEMBER_LIMIT - 1; i += 1) {
    f.db.exec(`INSERT INTO research_company_directory (uid,name,website,source_name,source_url,as_of) VALUES ('fill-${i}','Fill ${i}','https://f.example','Wikidata','https://w.example','2026-09-30')`);
    assert.equal((await call(f, 'POST', `/${uid}/comparisons/${kuid}/members`, { uid: `fill-${i}` })).body.added, true);
  }
  // Mutation checked: drop the limit check → the seventh column is added.
  const full = await call(f, 'POST', `/${uid}/comparisons/${kuid}/members`, { uid: 'q-fjord' });
  assert.deepEqual([full.status, full.body.detail], [409, 'comparison_full']);
  assert.equal(rows(f, "SELECT * FROM research_project_subjects WHERE directory_uid = 'q-fjord'").length, 0, 'a refused add writes no subject');
  assert.equal((await call(f, 'PATCH', `/${uid}/comparisons/${kuid}`, { title: 'Renamed' })).body.item.title, 'Renamed');
  assert.equal((await call(f, 'PATCH', `/${uid}/comparisons/${kuid}`, { title: ' ' })).body.detail, 'title_required');
  assert.equal((await call(f, 'PATCH', `/${uid}/comparisons/${kuid}`, { title: 'x'.repeat(161) })).body.detail, 'title_too_long');
  assert.equal((await call(f, 'DELETE', `/${uid}/comparisons/${kuid}`)).status, 200);
  assert.equal(rows(f, 'SELECT * FROM research_project_comparisons').length, 0);
  assert.equal(rows(f, 'SELECT * FROM research_project_subjects').length, MEMBER_LIMIT + 1, 'the subjects stay in the project');
  // Another member cannot reach the comparison by its uid through their own project.
  const other = await project(f, 702);
  const kept = (await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['q-nebula'] })).body.item.uid;
  assert.equal((await call(f, 'DELETE', `/${other}/comparisons/${kept}`, undefined, 702)).status, 404);
  assert.equal(rows(f, 'SELECT * FROM research_project_comparisons').length, 1);
});

test('funds compare with the list as their source; a list taken down and a removed row say so by name', async () => {
  const f = fixture();
  const uid = await project(f);
  await call(f, 'POST', `/${uid}/comparisons`, { kind: 'fund', uids: ['northwind', 'granite'], title: 'Seed funds' });
  // The fund's list is taken down after it was added, and a company leaves the directory.
  await call(f, 'POST', `/${uid}/subjects`, { kind: 'company', uids: ['q-fjord'] });
  f.db.exec("UPDATE research_fund_directory SET source_name = 'Taken down list' WHERE uid = 'granite'");
  f.db.exec("DELETE FROM research_company_directory WHERE uid = 'q-fjord'");
  const read = await call(f, 'GET', `/${uid}/comparisons`);
  const [northwind, granite] = read.body.comparisons[0].members;
  assert.equal(northwind.values.size.value, 5000000000);
  assert.equal(northwind.values.size.currency, 'EUR');
  assert.deepEqual(northwind.values.backing.value, { eif: true, eifo: false });
  assert.deepEqual(northwind.values.vintage.source, { name: EUR, url: 'https://sheet.example/1' });
  // Mutation checked: skip the taken-down check → granite reads 'removed'.
  assert.deepEqual([granite.state, granite.name, granite.values], ['withdrawn', 'Granite Ventures', null]);
  assert.deepEqual(read.body.subjects.find((s: any) => s.uid === 'q-fjord'), { kind: 'company', uid: 'q-fjord', name: 'Fjord Data', state: 'removed', added_at: read.body.subjects.find((s: any) => s.uid === 'q-fjord').added_at, comparisons: 0 });
});

test('a failed directory read is Unreadable, never Not recorded or removed', async () => {
  const f = fixture();
  const uid = await project(f);
  await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['q-nebula'] });
  f.db.exec('ALTER TABLE research_company_directory RENAME TO research_company_directory_gone');
  const read = await call(f, 'GET', `/${uid}/comparisons`);
  assert.equal(read.status, 200);
  assert.equal(read.body.directory.company, 'unreadable');
  // Mutation checked: let the failed read fall through as an empty map → the state is 'removed'.
  assert.deepEqual(read.body.comparisons[0].members.map((m: any) => [m.state, m.values]), [['unreadable', null]]);
  assert.equal((await call(f, 'POST', `/${uid}/subjects`, { kind: 'company', uids: ['q-aster'] })).status, 503);
});

test('an archived project is read-only: every write is 409 and nothing changes', async () => {
  const f = fixture();
  const uid = await project(f);
  const kuid = (await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['q-nebula'] })).body.item.uid;
  await call(f, 'POST', `/${uid}/archive`);
  const before = JSON.stringify([rows(f, 'SELECT * FROM research_project_subjects'), rows(f, 'SELECT * FROM research_project_comparisons'), rows(f, 'SELECT * FROM research_project_comparison_members')]);
  const writes: Array<[string, string, unknown?]> = [
    ['POST', `/${uid}/subjects`, { kind: 'company', uids: ['q-aster'] }],
    ['DELETE', `/${uid}/subjects/company/q-nebula`],
    ['POST', `/${uid}/comparisons`, { kind: 'company', uids: ['q-aster'] }],
    ['PATCH', `/${uid}/comparisons/${kuid}`, { title: 'New' }],
    ['DELETE', `/${uid}/comparisons/${kuid}`],
    ['POST', `/${uid}/comparisons/${kuid}/members`, { uid: 'q-aster' }],
    ['DELETE', `/${uid}/comparisons/${kuid}/members/q-nebula`],
  ];
  // Mutation checked: drop the archived guard from writableProject → these are 200/201.
  for (const [method, path, body] of writes) {
    const r = await call(f, method, path, body);
    assert.deepEqual([method, path, r.status, r.body.detail], [method, path, 409, 'project_archived']);
  }
  assert.equal(JSON.stringify([rows(f, 'SELECT * FROM research_project_subjects'), rows(f, 'SELECT * FROM research_project_comparisons'), rows(f, 'SELECT * FROM research_project_comparison_members')]), before);
  assert.equal((await call(f, 'GET', `/${uid}/comparisons`)).status, 200, 'an archived project is still read');
});

test('request text is bound, never written into a statement', async () => {
  const f = fixture();
  const uid = await project(f);
  const evil = "Robert'); DROP TABLE research_project_subjects;--";
  await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['q-nebula'], title: evil });
  await call(f, 'DELETE', `/${uid}/subjects/company/${encodeURIComponent(evil)}`);
  await call(f, 'DELETE', `/${uid}/comparisons/${encodeURIComponent(evil)}`);
  // Mutation checked: inline the title or the subject uid into the SQL → a statement carries DROP TABLE.
  assert.equal(f.statements.some((q) => q.includes('DROP TABLE')), false);
  assert.equal(rows(f, 'SELECT title FROM research_project_comparisons')[0].title, evil);
  assert.ok(rows(f, 'SELECT * FROM research_project_subjects').length, 'the table is still there');
});

test('the helpers: uids are checked, titles are cut at a name, cells never invent a value', () => {
  assert.deepEqual(readUids(['a', 'a', 'b'], 6), { uids: ['a', 'b'] });
  assert.equal(readUids([], 6).error, 'uids_required');
  assert.equal(readUids(['../x'], 6).error, 'invalid_uid');
  assert.equal(readUids(['a', 'b', 'c'], 2).error, 'too_many');
  const long = Array.from({ length: 12 }, (_, i) => `Company number ${i} with a long name`);
  const title = defaultComparisonTitle(long);
  assert.ok(title.length <= 160 && title.endsWith('…'));
  assert.equal(defaultComparisonTitle(['A', 'B']), 'A · B');
  const cells = companyCells({ uid: 'x', name: 'X', country: '  ', founded_year: '0', source_name: 'Wikidata', source_url: 'u', as_of: '2026-09-30' });
  assert.deepEqual([cells.country.status, cells.founded.status, cells.employees.status], ['not_recorded', 'not_recorded', 'not_recorded']);
  const fund = fundCells({ uid: 'g', name: 'G', website: null, linkedin: null, hq: null, fund_number: null, fund_size_cents: 9, fund_date: null, quarter: null, fund_year: null, sector_focus: null, notable_lps: null, eif_flag: 0, eifo_flag: 0, source_name: 'Another list', source_url: 'u', as_of: '2026-10-01' });
  // A size in an unknown currency is not shown; EIF/EIFO with no LPs named is unknown, not "no".
  assert.deepEqual([fund.size.status, fund.backing.status], ['not_recorded', 'not_recorded']);
  assert.match((fund.size as any).reason, /known currency/);
});
