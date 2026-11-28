/**
 * D7826 (#7826): Research organizations (`routes/research_organizations.ts`, `services/researchOrganizations.ts`,
 * migration 202611241148_7826). Real schema (`loadSchema`), the real router and the D7819, D7178, D597 and D7166 reads
 * it answers through; synthetic records only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_organizations_7826.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import organizations, { mount } from '../src/routes/research_organizations.ts';
import { kindConflict, ORGANIZATION_ROLES } from '../src/services/researchOrganizations.ts';
import { checkReaders, withoutComments } from './research_company_read_guard_7819.test.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d7826-research-organizations-0123456789';
const ADMIN = 1, FOUNDER = 2, INVESTOR = 3;
const SRC = 'https://source.example.test/filing/1';
const SERVICE = resolve(import.meta.dirname, '../src/services/researchOrganizations.ts');
const ROUTE = resolve(import.meta.dirname, '../src/routes/research_organizations.ts');
const MIGRATION = resolve(import.meta.dirname, '../sql/migrations/202611241148_7826_research_organizations.sql');

function fixture({ recordKind = false } = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  // #7744's fund row kind (`record_kind`) is in the schema now (migration 202611270508_7744); a fixture that needs it sets it below.
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example');
  u.run(FOUNDER, 'founder', 'Fay', 'fay@co.example');
  u.run(INVESTOR, 'investor', 'Ivo', 'ivo@angel.example');
  const co = db.prepare(`INSERT INTO research_company_directory(uid,name,website,source_url,source_name,source_license,as_of)
    VALUES (?,?,?,'https://source.example.test/record','Synthetic publisher','Synthetic terms','2026-01-01')`);
  for (const [uid, name] of [['co-7826', 'Synthetic Capital Ltd'], ['co-held-7826', 'Held Co'], ['co-gone-7826', 'Gone Co'], ['co-port-7826', 'Portfolio Co']]) {
    co.run(uid, name, `https://${uid}.example.test`);
  }
  db.prepare(`INSERT INTO research_company_reviews(uid,status,reason_code,reviewer,reviewed_on) VALUES ('co-gone-7826','withdrawn','source_withdrawn',9,'2026-02-01 00:00:00')`).run();
  db.exec(`INSERT INTO research_fund_sources (source_name,title,terms_status,evidence,verdict,verdict_reason,reviewed_on)
    VALUES ('Synthetic open list','Open','not found','x','cite only','x','2026-01-01'),
           ('Synthetic withdrawn list','Gone','not found','x','not allowed','Terms forbid republication','2026-01-01');
    INSERT INTO research_fund_directory (uid,name,website,source_name,source_url,as_of) VALUES
      ('fund-mgr-7826','Synthetic Capital','https://cap.example.test','Synthetic open list','https://list.example.test','2026-01-01'),
      ('fund-veh-7826','Synthetic Capital Fund I','https://cap.example.test/i','Synthetic open list','https://list.example.test','2026-01-01'),
      ('fund-res-7826','Synthetic Resource','https://res.example.test','Synthetic open list','https://list.example.test','2026-01-01'),
      ('fund-gone-7826','Withheld Fund','https://gone.example.test','Synthetic withdrawn list','https://list.example.test','2026-01-01'),
      ('fund-clue-7826','Clue Fund','https://clue.example.test','Synthetic open list','https://list.example.test','2026-01-01');
    INSERT INTO research_fund_directory_uid_moves (old_uid,new_uid,moved_on) VALUES ('fund-veh-old-7826','fund-veh-7826','2026-03-01');
    INSERT INTO research_fund_vehicle_facts (fund_uid,field,value_text,source_name,imported_on) VALUES
      ('fund-veh-7826','manager_name','Synthetic Capital','Synthetic open list','2026-01-01'),
      ('fund-clue-7826','manager_name','Clue Manager Org','Synthetic open list','2026-01-01');`);
  if (recordKind) {
    db.exec(`UPDATE research_fund_directory SET record_kind = 'manager' WHERE uid = 'fund-mgr-7826';
      UPDATE research_fund_directory SET record_kind = 'vehicle' WHERE uid = 'fund-veh-7826';
      UPDATE research_fund_directory SET record_kind = 'resource' WHERE uid = 'fund-res-7826';`);
  }
  return db;
}

const app = new Hono<any>();
app.route(mount.path, organizations);

async function call(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role;
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  const [w, e] = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  try {
    res = await app.fetch(new Request(`http://t${mount.path}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (err) { if (err instanceof Response) res = err; else throw err; } finally { console.warn = w; console.error = e; }
  const text = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}
const admin = (db: DatabaseSync, path: string, body?: unknown) => call(db, ADMIN, 'POST', path, body);
const create = async (db: DatabaseSync, name: string) => {
  const r = await admin(db, '', { name });
  assert.equal(r.status, 201, r.text);
  return r.body.organization_uid as string;
};
const role = (db: DatabaseSync, uid: string, roleName: string) => admin(db, `/${uid}/roles`, { role: roleName, source_name: 'Synthetic register', source_url: SRC, stated_on: '2026-01-15' });
const link = (db: DatabaseSync, uid: string, record_type: string, record_uid: string) => admin(db, `/${uid}/links`, { record_type, record_uid, origin: 'reviewed' });
const rel = (db: DatabaseSync, uid: string, body: Record<string, unknown>) => admin(db, `/${uid}/relationships`, body);
const sourced = { source_url: SRC, source_locator: 'Part 2, item 7', stated_on: '2026-01-15' };
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n as number;
const researchCounts = (db: DatabaseSync) => ['research_organizations', 'research_organization_roles', 'research_organization_record_links', 'research_organization_relationships'].map((t) => count(db, t));

/** A manager organization owning the manager fund row, a vehicle organization owning the vehicle row, and 'manages'. */
async function managerAndVehicle(db: DatabaseSync) {
  const manager = await create(db, 'Synthetic Capital');
  const vehicle = await create(db, 'Synthetic Capital Fund I');
  assert.equal((await role(db, manager, 'fund_manager')).status, 201);
  assert.equal((await role(db, vehicle, 'fund_vehicle')).status, 201);
  assert.equal((await link(db, manager, 'fund', 'fund-mgr-7826')).status, 200);
  assert.equal((await link(db, vehicle, 'fund', 'fund-veh-7826')).status, 200);
  assert.equal((await rel(db, manager, { relation: 'manages', object_uid: vehicle, ...sourced })).status, 201);
  return { manager, vehicle };
}

test('schema: the four research_* tables, one live link per record, and no person, Network id or fund statement column', () => {
  const db = fixture();
  const cols = (t: string) => (db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map((r) => r.name);
  assert.deepEqual(cols('research_organizations'), ['id', 'uid', 'name', 'created_at', 'created_by_user_id']);
  assert.ok(cols('research_organization_relationships').includes('source_locator'));
  for (const t of ['research_organizations', 'research_organization_roles', 'research_organization_record_links', 'research_organization_relationships']) {
    assert.equal(count(db, t), 0, `${t} starts empty`);
    for (const c of cols(t)) assert.doesNotMatch(c, /person|network|manager_name|statement/, `${t}.${c}`);
  }
  const roleCheck = String((db.prepare("SELECT sql FROM sqlite_master WHERE name='research_organization_roles'").get() as any).sql);
  for (const r of ORGANIZATION_ROLES) assert.ok(roleCheck.includes(`'${r}'`), r);
  // A relationship without a source is refused by the table too, not only by the route.
  db.exec("INSERT INTO research_organizations(uid,name) VALUES ('a','A'),('b','B')");
  assert.throws(() => db.exec(`INSERT INTO research_organization_relationships(subject_organization_id,relation,object_organization_id,source_url,source_locator,stated_on)
    VALUES (1,'manages',2,'','x','2026-01-01')`), /CHECK/);
  assert.throws(() => db.exec(`INSERT INTO research_organization_relationships(subject_organization_id,relation,object_organization_id,source_locator,stated_on)
    VALUES (1,'manages',2,'x','2026-01-01')`), /NOT NULL/);
});

test('a relationship without a source is refused; a sourced manages relationship shows the vehicle', async () => {
  const db = fixture();
  const manager = await create(db, 'Synthetic Capital');
  const vehicle = await create(db, 'Synthetic Capital Fund I');
  await link(db, manager, 'fund', 'fund-mgr-7826');
  await link(db, vehicle, 'fund', 'fund-veh-7826');
  for (const missing of ['source_url', 'source_locator', 'stated_on']) {
    const body: Record<string, unknown> = { relation: 'manages', object_uid: vehicle, ...sourced };
    delete body[missing];
    const r = await rel(db, manager, body);
    assert.equal(r.status, 400, missing);
    assert.equal(r.body.error, 'source_required', missing);
  }
  assert.equal(count(db, 'research_organization_relationships'), 0);
  assert.equal((await rel(db, manager, { relation: 'manages', object_uid: vehicle, ...sourced })).status, 201);
  const read = await call(db, INVESTOR, 'GET', `/${manager}`);
  assert.equal(read.status, 200, read.text);
  assert.deepEqual(read.body.relationships.map((r: any) => [r.relation, r.direction, r.organization.uid, r.source_url, r.source_locator, r.stated_on]),
    [['manages', 'outgoing', vehicle, SRC, 'Part 2, item 7', '2026-01-15']]);
  assert.deepEqual(read.body.relationships[0].organization.records, [{ type: 'fund', uid: 'fund-veh-7826', name: 'Synthetic Capital Fund I', record_kind: null }]);
  const back = await call(db, INVESTOR, 'GET', `/${vehicle}`);
  assert.deepEqual(back.body.relationships.map((r: any) => [r.relation, r.direction, r.organization.uid]), [['manages', 'incoming', manager]]);
});

test('relationships join two organizations; invested_in alone carries a role, its own amount with currency, and a round row', async () => {
  const db = fixture();
  const investor = await create(db, 'Investor Org');
  const portfolio = await create(db, 'Portfolio Org');
  assert.equal((await rel(db, investor, { relation: 'advises', object_uid: investor, ...sourced })).body.error, 'same_organization');
  assert.equal((await rel(db, investor, { relation: 'advises', object_uid: 'person-1', ...sourced })).status, 404);
  assert.equal((await rel(db, investor, { relation: 'advises', object_uid: portfolio, investor_role: 'lead', ...sourced })).body.error, 'fields_invested_in_only');
  assert.equal((await rel(db, investor, { relation: 'invested_in', object_uid: portfolio, amount_minor: 100, ...sourced })).body.error, 'amount_needs_currency');
  assert.equal((await rel(db, investor, { relation: 'invested_in', object_uid: portfolio, funding_round_id: 999, ...sourced })).status, 404);
  const companyId = (db.prepare("SELECT id FROM research_company_directory WHERE uid='co-port-7826'").get() as any).id;
  db.prepare(`INSERT INTO company_funding_rounds(company_id,amount,currency,source_url,source_name) VALUES (?,5000000,'USD','https://round.example.test','Synthetic')`).run(companyId);
  const roundId = (db.prepare('SELECT funding_round_id FROM company_funding_rounds').get() as any).funding_round_id;
  const ok = await rel(db, investor, { relation: 'invested_in', object_uid: portfolio, investor_role: 'lead', amount_minor: 150000000, amount_currency: 'USD', funding_round_id: roundId, ...sourced });
  assert.equal(ok.status, 201, ok.text);
  const stored = db.prepare('SELECT amount_minor, amount_currency, funding_round_id FROM research_organization_relationships').get() as any;
  assert.deepEqual({ ...stored }, { amount_minor: 150000000, amount_currency: 'USD', funding_round_id: roundId }, 'its own amount, never the round total');
  assert.equal((await rel(db, investor, { relation: 'invested_in', object_uid: portfolio, ...sourced })).body.error, 'relationship_already_recorded');
});

test('a record cannot be linked to two organizations', async () => {
  const db = fixture();
  const a = await create(db, 'Org A');
  const b = await create(db, 'Org B');
  assert.equal((await link(db, a, 'company', 'co-7826')).status, 200);
  const again = await link(db, a, 'company', 'co-7826');
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  const other = await link(db, b, 'company', 'co-7826');
  assert.equal(other.status, 409);
  assert.equal(other.body.error, 'record_already_linked');
  assert.equal((await link(db, a, 'fund', 'fund-mgr-7826')).status, 200);
  assert.equal((await link(db, b, 'fund', 'fund-mgr-7826')).body.error, 'record_already_linked');
  // A moved uid is the same record: it is stored under, and refused as, its current uid.
  assert.equal((await link(db, a, 'fund', 'fund-veh-old-7826')).body.record_uid, 'fund-veh-7826');
  assert.equal((await link(db, b, 'fund', 'fund-veh-7826')).body.error, 'record_already_linked');
  // The table refuses a second live owner on its own.
  assert.throws(() => db.exec(`INSERT INTO research_organization_record_links(organization_id,record_type,record_uid,origin,state,confirmed_at)
    VALUES (2,'company','co-7826','reviewed','confirmed',datetime('now'))`), /UNIQUE/);
  // Only served records can be linked.
  assert.equal((await link(db, a, 'company', 'co-gone-7826')).body.error, 'record_not_found');
  assert.equal((await link(db, a, 'fund', 'fund-gone-7826')).body.error, 'record_not_found');
  assert.equal((await link(db, a, 'company', 'co-missing')).body.error, 'record_not_found');
});

test('kind and role: a link whose role contradicts the recorded kind is refused; with no kind recorded it is allowed', async () => {
  assert.equal(kindConflict(['fund_manager'], 'vehicle'), 'role_contradicts_record_kind');
  assert.equal(kindConflict(['fund_manager'], 'manager'), null);
  assert.equal(kindConflict(['venture_capital'], 'vehicle'), null);
  assert.equal(kindConflict(['fund_manager'], null), null);
  assert.equal(kindConflict([], 'resource'), 'record_kind_not_organization');

  const db = fixture({ recordKind: true });
  const manager = await create(db, 'Synthetic Capital');
  await role(db, manager, 'fund_manager');
  const refused = await link(db, manager, 'fund', 'fund-veh-7826');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'role_contradicts_record_kind');
  assert.equal((await link(db, manager, 'fund', 'fund-res-7826')).body.error, 'record_kind_not_organization');
  assert.equal((await link(db, manager, 'fund', 'fund-mgr-7826')).status, 200);
  assert.equal((await link(db, manager, 'fund', 'fund-clue-7826')).status, 200, 'a row with no kind recorded is allowed');
  // A role that contradicts a record the organization already owns is refused the same way.
  const vehicleRole = await role(db, manager, 'fund_vehicle');
  assert.equal(vehicleRole.status, 201, 'manager and vehicle roles together cover the manager row');
  const other = await create(db, 'Vehicle Org');
  await link(db, other, 'fund', 'fund-veh-7826');
  assert.equal((await role(db, other, 'accelerator')).body.error, 'role_contradicts_record_kind');

  // On main the column is absent: every row reads as not recorded, and the same link is allowed.
  const plain = fixture();
  const m2 = await create(plain, 'Synthetic Capital');
  await role(plain, m2, 'fund_manager');
  assert.equal((await link(plain, m2, 'fund', 'fund-veh-7826')).status, 200);
  assert.equal((await link(plain, await create(plain, 'R'), 'fund', 'fund-res-7826')).status, 200);
});

test('each admin write is refused to a non-admin, is in the admin audit trail, and never writes the fund catalogue', async () => {
  const db = fixture();
  const funds = count(db, 'research_fund_directory');
  const fundRows = JSON.stringify(db.prepare('SELECT * FROM research_fund_directory ORDER BY uid').all());
  const uid = await create(db, 'Audited Org');
  const other = await create(db, 'Other Org');
  for (const who of [FOUNDER, INVESTOR]) {
    for (const [path, body] of [['', { name: 'X' }], [`/${uid}/roles`, { role: 'other', source_name: 's', stated_on: '2026-01-01' }],
      [`/${uid}/links`, { record_type: 'fund', record_uid: 'fund-mgr-7826' }], [`/${uid}/relationships`, { relation: 'advises', object_uid: other, ...sourced }]] as const) {
      const r = await call(db, who, 'POST', path, body);
      assert.equal(r.status, 403, `${who} ${path}`);
    }
  }
  assert.deepEqual(researchCounts(db), [2, 0, 0, 0]);
  await role(db, uid, 'venture_capital');
  await link(db, uid, 'fund', 'fund-mgr-7826');
  await rel(db, uid, { relation: 'advises', object_uid: other, ...sourced });
  const log = (db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'research_organization_%' ORDER BY id").all() as any[]).map((r) => r.action);
  assert.deepEqual(log, ['research_organization_create', 'research_organization_create', 'research_organization_role_add',
    'research_organization_link_confirm', 'research_organization_relationship_add']);
  const audit = (db.prepare("SELECT action FROM admin_audit_log WHERE action LIKE 'research_organization_%'").all() as any[]).length;
  assert.equal(audit, 5);
  assert.equal(count(db, 'research_fund_directory'), funds);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM research_fund_directory ORDER BY uid').all()), fundRows);
  for (const file of [SERVICE, ROUTE]) {
    const src = withoutComments(readFileSync(file, 'utf8'), file);
    assert.doesNotMatch(src, /INSERT\s+INTO\s+research_fund_directory|UPDATE\s+research_fund_directory|network_directory_/i, file);
    assert.doesNotMatch(src, /research_fund_vehicle_facts|fund_statements|manager_name/i, `${file} names no statement or vehicle fact store`);
  }
});

test('organization of a record answers by record uid, following a moved fund uid', async () => {
  const db = fixture();
  const { manager, vehicle } = await managerAndVehicle(db);
  const byFund = await call(db, INVESTOR, 'GET', '/record/fund/fund-mgr-7826');
  assert.equal(byFund.status, 200, byFund.text);
  assert.equal(byFund.body.organization.uid, manager);
  assert.deepEqual(byFund.body.organization.roles.map((r: any) => r.role), ['fund_manager']);
  assert.equal((await call(db, INVESTOR, 'GET', '/record/fund/fund-veh-old-7826')).body.organization.uid, vehicle);
  assert.deepEqual((await call(db, INVESTOR, 'GET', '/record/fund/fund-clue-7826')).body, { organization: null });
  assert.equal((await call(db, INVESTOR, 'GET', '/record/person/x')).status, 404);
  const companyOrg = await create(db, 'Synthetic Capital Ltd');
  await link(db, companyOrg, 'company', 'co-7826');
  assert.equal((await call(db, FOUNDER, 'GET', '/record/company/co-7826')).body.organization.uid, companyOrg);
});

test('access: a withheld fund and an unserved company appear in no read; a non-admitted account gets nothing derived from a company', async () => {
  const db = fixture();
  const { manager } = await managerAndVehicle(db);
  // A company link on the manager: the organization is now derived from a company record.
  const firm = await create(db, 'Synthetic Capital Ltd');
  await role(db, firm, 'operating_company');
  await link(db, firm, 'company', 'co-7826');
  await link(db, firm, 'fund', 'fund-clue-7826');
  await rel(db, firm, { relation: 'member_of_group', object_uid: manager, ...sourced });

  // Admitted (founder): the firm, its company link and the relationship.
  const f = await call(db, FOUNDER, 'GET', `/${firm}`);
  assert.equal(f.status, 200, f.text);
  assert.deepEqual(f.body.records.map((r: any) => [r.type, r.uid]), [['company', 'co-7826'], ['fund', 'fund-clue-7826']]);
  assert.deepEqual((await call(db, FOUNDER, 'GET', `/${manager}`)).body.relationships.map((r: any) => r.organization.uid).sort(), [firm, (await call(db, FOUNDER, 'GET', `/${manager}`)).body.relationships.find((r: any) => r.relation === 'manages').organization.uid].sort());

  // Not admitted (investor): the firm reads as not found, even through its fund record, and vanishes from the
  // manager's relationships; the company record itself gets the Companies refusal before anything is read.
  const i = await call(db, INVESTOR, 'GET', `/${firm}`);
  assert.equal(i.status, 404);
  assert.deepEqual(i.body, { detail: 'Not found' });
  assert.deepEqual(i.body, (await call(db, INVESTOR, 'GET', '/org-does-not-exist')).body, 'hidden and missing answer alike');
  assert.deepEqual((await call(db, INVESTOR, 'GET', '/record/fund/fund-clue-7826')).body, { organization: null });
  assert.deepEqual((await call(db, INVESTOR, 'GET', `/${manager}`)).body.relationships.map((r: any) => r.relation), ['manages']);
  assert.doesNotMatch(JSON.stringify((await call(db, INVESTOR, 'GET', `/${manager}`)).body), /Synthetic Capital Ltd|co-7826|operating_company/);
  const refused = await call(db, INVESTOR, 'GET', '/record/company/co-7826');
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'companies_licence_required');
  assert.deepEqual(refused.body, (await call(db, INVESTOR, 'GET', '/record/company/co-none')).body);

  // An unserved company record: the organization it is derived from disappears for every account.
  db.prepare(`INSERT INTO research_company_reviews(uid,status,reason_code,reviewer,reviewed_on) VALUES ('co-7826','withdrawn','source_withdrawn',9,'2026-04-01 00:00:00')`).run();
  assert.equal((await call(db, FOUNDER, 'GET', `/${firm}`)).status, 404);
  assert.deepEqual((await call(db, FOUNDER, 'GET', '/record/company/co-7826')).body, { organization: null });
  assert.deepEqual((await call(db, ADMIN, 'GET', `/${manager}`)).body.relationships.map((r: any) => r.relation), ['manages']);

  // A withheld fund: its list's verdict turns to 'not allowed' and nothing from it is served.
  const solo = await create(db, 'Withheld Owner');
  await link(db, solo, 'fund', 'fund-veh-7826');
  db.prepare(`UPDATE research_fund_directory SET source_name='Synthetic withdrawn list' WHERE uid='fund-mgr-7826'`).run();
  const m = await call(db, FOUNDER, 'GET', `/${manager}`);
  assert.equal(m.status, 404, 'the manager owns only the withheld row now');
  assert.deepEqual((await call(db, FOUNDER, 'GET', '/record/fund/fund-mgr-7826')).body, { organization: null });
  for (const who of [ADMIN, FOUNDER, INVESTOR]) {
    for (const uid of [firm, manager, solo]) {
      assert.doesNotMatch((await call(db, who, 'GET', `/${uid}`)).text, /fund-mgr-7826|Withheld Fund/);
    }
  }
});

test('no read returns a fund statement or a vehicle fact, and a manager-name clue makes no link', async () => {
  const db = fixture();
  const { manager, vehicle } = await managerAndVehicle(db);
  // fund-veh-7826 has a manager_name row; it answers with uid, name and kind only.
  const v = await call(db, INVESTOR, 'GET', `/${vehicle}`);
  assert.deepEqual(v.body.records, [{ type: 'fund', uid: 'fund-veh-7826', name: 'Synthetic Capital Fund I', record_kind: null }]);
  assert.doesNotMatch(v.text, /manager_name|value_text|investment_stage|initial_cheque|provenance|history/);
  // fund-clue-7826's manager_name equals an organization's name; nothing links it.
  await create(db, 'Clue Manager Org');
  assert.deepEqual((await call(db, INVESTOR, 'GET', '/record/fund/fund-clue-7826')).body, { organization: null });
  assert.equal((db.prepare("SELECT COUNT(*) n FROM research_organization_record_links WHERE record_uid='fund-clue-7826'").get() as any).n, 0);
  assert.equal((await call(db, INVESTOR, 'GET', `/${manager}`)).body.records.length, 1);
});

test('Network bridge: two Research rows of one organization bridged from one Network organisation resolve to it, and the bridge changes nothing here', async () => {
  const db = fixture();
  const org = await create(db, 'Synthetic Capital');
  await link(db, org, 'company', 'co-7826');
  await link(db, org, 'fund', 'fund-mgr-7826');
  db.exec(`INSERT INTO network_directory_sources (uid,name,url) VALUES ('src-7826','Synthetic Network source','https://network.example.test');
    INSERT INTO network_directory_entries (uid,kind,source_uid,source_external_id,display_name,observed_at)
      VALUES ('net-org-7826','organization','src-7826','ext-1','Synthetic Capital','2026-01-01T00:00:00Z');
    INSERT INTO network_directory_source_records (uid,source_uid,external_record_id,content_hash,decision_hash,entry_uid,entry_kind,disposition,observed_at)
      VALUES ('rec-7826','src-7826','ext-1','h','d','net-org-7826','organization','accept','2026-01-01T00:00:00Z');`);
  const before = researchCounts(db);
  const snapshot = () => JSON.stringify(['research_organizations', 'research_organization_roles', 'research_organization_record_links', 'research_organization_relationships']
    .map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));
  const rows = snapshot();
  const bridge = db.prepare(`INSERT INTO network_directory_research_links (uid,organization_uid,company_directory_uid,fund_directory_uid,target_kind,source_record_uid,reviewed_by_user_id,reviewed_at,evidence_url)
    VALUES (?,'net-org-7826',?,?,?,'rec-7826',1,'2026-01-02T00:00:00Z','https://network.example.test/evidence')`);
  bridge.run('bridge-co', 'co-7826', null, 'company');
  bridge.run('bridge-fund', null, 'fund-mgr-7826', 'fund_manager');
  const targets = db.prepare(`SELECT company_directory_uid, fund_directory_uid FROM network_directory_research_links WHERE organization_uid='net-org-7826' ORDER BY uid`).all() as any[];
  const resolved = new Set<string>();
  for (const t of targets) {
    const path = t.company_directory_uid ? `/record/company/${t.company_directory_uid}` : `/record/fund/${t.fund_directory_uid}`;
    resolved.add((await call(db, FOUNDER, 'GET', path)).body.organization.uid);
  }
  assert.deepEqual([...resolved], [org]);
  assert.deepEqual(researchCounts(db), before);
  assert.equal(snapshot(), rows);
  db.prepare(`UPDATE network_directory_research_links SET status='withdrawn' WHERE uid='bridge-co'`).run();
  db.prepare(`DELETE FROM network_directory_research_links WHERE uid='bridge-fund'`).run();
  assert.equal(snapshot(), rows, 'a bridge insert or withdrawal changes nothing in research_*');
  assert.equal((await call(db, FOUNDER, 'GET', '/record/company/co-7826')).body.organization.uid, org);
});

test('only confirmed links count: a proposed link is not read until the admin confirms it', async () => {
  const db = fixture();
  const org = await create(db, 'Proposed Org');
  const id = (db.prepare('SELECT id FROM research_organizations WHERE uid = ?').get(org) as any).id;
  db.prepare(`INSERT INTO research_organization_record_links(organization_id,record_type,record_uid,origin,state) VALUES (?,'fund','fund-mgr-7826','source_record','proposed')`).run(id);
  assert.equal((await call(db, INVESTOR, 'GET', `/${org}`)).status, 404);
  assert.deepEqual((await call(db, INVESTOR, 'GET', '/record/fund/fund-mgr-7826')).body, { organization: null });
  assert.equal((await link(db, await create(db, 'Rival'), 'fund', 'fund-mgr-7826')).body.error, 'record_already_linked', 'a proposed link still holds the record');
  const ok = await link(db, org, 'fund', 'fund-mgr-7826');
  assert.equal(ok.body.changed, true);
  const row = db.prepare("SELECT origin, state, confirmed_at IS NOT NULL AS confirmed FROM research_organization_record_links WHERE record_uid='fund-mgr-7826'").get() as any;
  assert.deepEqual({ ...row }, { origin: 'source_record', state: 'confirmed', confirmed: 1 });
  assert.equal((await call(db, INVESTOR, 'GET', '/record/fund/fund-mgr-7826')).body.organization.uid, org);
});

test('both reads refuse a request with no sign-in', async () => {
  const db = fixture();
  for (const path of ['/org-x', '/record/fund/fund-mgr-7826', '/record/company/co-7826']) {
    let res: Response;
    try {
      res = await app.fetch(new Request(`http://t${mount.path}${path}`), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    } catch (err) { if (err instanceof Response) res = err; else throw err; }
    assert.equal(res.status, 401, path);
  }
});

test('the D7819 guard accepts both files: neither names the company directory table', () => {
  const files = Object.fromEntries([SERVICE, ROUTE].map((f) => [`cloudflare-worker/src/${f.split('/src/')[1]}`, readFileSync(f, 'utf8')]));
  assert.deepEqual(checkReaders(files, [], []), []);
});

test('the migration is additive and idempotent', () => {
  const db = fixture();
  db.exec(readFileSync(MIGRATION, 'utf8'));
  assert.deepEqual(researchCounts(db), [0, 0, 0, 0]);
});
