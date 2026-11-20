/**
 * D6685 (#6685) — `formation_state` on the companies, projects and switcher
 * reads, on node:sqlite. Every person, company and venture is made up.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/formation_state_6685.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import accountCompanies from '../src/routes/account_companies.ts';
import accountPortfolio from '../src/routes/account_portfolio.ts';
import { formationState, COMPANY_IDENTITY_SQL, COMPANY_ORDERS_SQL, PROJECT_ORDERS_SQL } from '../src/services/formationState.ts';
import { CYCLE_STORES } from '../src/services/companySheet.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'test'.repeat(16);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migrationTable = (file: string, name: string) => tableFromBaseline(readFileSync(new URL('../sql/migrations/' + file, import.meta.url), 'utf8'), name);
const migration = (file: string) => readFileSync(new URL('../sql/migrations/' + file, import.meta.url), 'utf8');
const ADA = 1;
// Companies: Plain (a name only), Registered (a registration number only), Dated (an incorporation date only),
// Forming (a venture with a paid order), Filed (a filed order and a newer paid one).
const PLAIN = 10, REGISTERED = 11, DATED = 12, FORMING = 13, FILED = 14;
// Ventures: one per company, plus Solo (standalone, two in-flight orders) and Bare (standalone, a pending order).
const P_PLAIN = 1, P_REGISTERED = 2, P_DATED = 3, P_FORMING = 4, P_FILED = 5, P_FILED_SIBLING = 6, SOLO = 7, BARE = 8;
// Hidden Co: Ada's venture sits beside someone else's venture, whose order was filed. Ada holds no link to the company.
const HIDDEN = 15, P_HIDDEN_FILER = 9, P_HIDDEN_MINE = 10;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'user_sessions', 'super_admins', 'company_profiles', 'user_company_links', 'projects', 'project_members', 'project_member_invitations', 'vc_funds', 'engagements', 'quotes', 'service_offerings', 'incorporations']) db.exec(tableFromBaseline(baseline, t));
  db.exec('CREATE UNIQUE INDEX uq_project_members_pair ON project_members (project_id, user_id)');
  db.exec(migrationTable('236_company_invitations.sql', 'company_invitations'));
  db.exec(migrationTable('466_company_visits.sql', 'user_company_visits'));
  db.exec(migration('597_company_archive_and_events.sql'));
  db.exec(migration('685_company_legal_record_and_slugs.sql'));
  // D6687: the order's subject company, which the formation reads also name.
  db.exec('ALTER TABLE incorporations ADD COLUMN subject_company_id INTEGER');
  for (const s of Object.values(CYCLE_STORES).flat()) db.exec(`CREATE TABLE ${s} (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER)`);
  const insert = (table: string, given: Record<string, any>) => {
    const v = { ...given };
    for (const col of db.prepare(`PRAGMA table_info(${table})`).all() as any[]) {
      if (col.notnull && col.dflt_value == null && !col.pk && !(col.name in v)) v[col.name] = /int|real|num/i.test(col.type) ? 0 : `${table}-${col.name}-${Math.random().toString(36).slice(2)}`;
    }
    return db.prepare(`INSERT INTO ${table} (${Object.keys(v).join(',')}) VALUES (${Object.keys(v).map(() => '?').join(',')})`).run(...Object.values(v));
  };
  insert('users', { id: ADA, role: 'founder', name: 'Ada', email: 'ada@made-up.example', founder_id: 100 });
  insert('user_sessions', { user_id: ADA, jti: `j-${ADA}`, factor: 'totp' });
  const companies: [number, string, Record<string, any>][] = [
    [PLAIN, 'Plain Co', {}],
    [REGISTERED, 'Registered Co', { registration_number: 'SECRET-REG-77' }],
    [DATED, 'Dated Co', { incorporation_date: '2026-03-04' }],
    [FORMING, 'Forming Co', {}],
    [FILED, 'Filed Co', {}],
  ];
  for (const [id, name, legal] of companies) {
    insert('company_profiles', { id, uid: `co${id}`, company_name: name, stage: 'seed', ...legal });
    insert('user_company_links', { uid: `l${id}`, company_id: id, user_id: ADA, role_in_company: 'Owner', is_primary_admin: 1, created_at: `2026-01-${id} 00:00:00` });
  }
  const venture = (id: number, company_id: number | null) => insert('projects', { id, uid: `p${id}`, name: `Venture ${id}`, founder_id: 100, company_id, created_at: `2026-02-0${id} 00:00:00` });
  venture(P_PLAIN, PLAIN); venture(P_REGISTERED, REGISTERED); venture(P_DATED, DATED); venture(P_FORMING, FORMING);
  venture(P_FILED, FILED); venture(P_FILED_SIBLING, FILED); venture(SOLO, null); venture(BARE, null);
  insert('company_profiles', { id: HIDDEN, uid: `co${HIDDEN}`, company_name: 'Hidden Co', stage: 'seed' });
  insert('projects', { id: P_HIDDEN_FILER, uid: 'p9', name: 'Not Ada\'s', founder_id: 999, company_id: HIDDEN, created_at: '2026-01-01 00:00:00' });
  insert('projects', { id: P_HIDDEN_MINE, uid: 'p10', name: 'Ada in Hidden', founder_id: 100, company_id: HIDDEN, created_at: '2026-01-02 00:00:00' });
  const order = (id: number, project_id: number, status: string, paid_at: string | null, company_id: number | null = null) =>
    insert('incorporations', { id, user_id: ADA, project_id, jurisdiction_id: 'us_de_ccorp', company_name: 'X', amount_cents: 1, status, paid_at, company_id });
  order(501, P_FORMING, 'paid', '2026-04-01 00:00:00');
  order(502, P_FILED, 'filed', '2026-03-01 00:00:00');
  order(503, P_FILED, 'paid', '2026-04-02 00:00:00'); // newer, but a filed order already stands
  order(504, SOLO, 'packet_processing', '2026-04-01 00:00:00');
  order(505, SOLO, 'packet_ready', '2026-04-03 00:00:00'); // the latest in-flight order is the one named
  order(506, BARE, 'pending_payment', null);
  order(507, BARE, 'failed', '2026-04-04 00:00:00');
  order(508, P_HIDDEN_FILER, 'filed', '2026-03-05 00:00:00');
  return db;
}

async function get(db: DatabaseSync, path: string, failOn: RegExp[] = []) {
  const token = await new SignJWT({ user_id: ADA, role: 'member', jti: `j-${ADA}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const app = new Hono<any>();
  app.route('/api', accountCompanies);
  app.route('/api', accountPortfolio);
  app.onError((err: any, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES as any)[err.message] || 500));
  const queries: string[] = []; const d1 = d1Over(db);
  const DB = {
    ...d1,
    prepare(sql: string) {
      queries.push(sql);
      if (failOn.some((re) => re.test(sql))) return { bind() { return this; }, all: async () => { throw new Error('D1_ERROR: no such table'); }, first: async () => { throw new Error('D1_ERROR'); }, run: async () => { throw new Error('D1_ERROR'); } };
      return d1.prepare(sql);
    },
  };
  const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } }, { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' });
  return { status: res.status, body: await res.json() as any, queries };
}

const states = (list: any[], key: string) => Object.fromEntries(list.map((x) => [x[key], [x.formation_state, x.formation_order_id]]));
const IDENTITY = /FROM company_profiles cp\s+WHERE cp\.id IN/;
const ORDERS = /FROM incorporations o /;

// ── The rule ────────────────────────────────────────────────────────────────

test('the rule: positive evidence wins, anything weaker needs both reads', () => {
  // Mutation checked: the read-failure line moved first (a recorded identity with failed orders reads unreadable);
  // `find` replaced by the last element (the older in-flight order named).
  const yes = { ok: true as const, value: true }, no = { ok: true as const, value: false }, down = { ok: false as const };
  const none = { ok: true as const, value: [] };
  assert.deepEqual(formationState(no, none), { formation_state: 'not_incorporated', formation_order_id: null });
  assert.deepEqual(formationState(yes, none), { formation_state: 'incorporated', formation_order_id: null });
  assert.deepEqual(formationState(yes, down), { formation_state: 'incorporated', formation_order_id: null });
  assert.deepEqual(formationState(down, { ok: true, value: [{ order_id: 9, status: 'filed' }] }), { formation_state: 'incorporated', formation_order_id: null });
  assert.deepEqual(formationState(down, none), { formation_state: 'unreadable', formation_order_id: null });
  assert.deepEqual(formationState(down, { ok: true, value: [{ order_id: 9, status: 'paid' }] }), { formation_state: 'unreadable', formation_order_id: null });
  assert.deepEqual(formationState(no, down), { formation_state: 'unreadable', formation_order_id: null });
  assert.deepEqual(formationState(no, { ok: true, value: [{ order_id: 8, status: 'packet_ready' }, { order_id: 7, status: 'paid' }] }), { formation_state: 'in_formation', formation_order_id: 8 });
  assert.deepEqual(formationState(no, { ok: true, value: [{ order_id: 8, status: 'paid' }, { order_id: 7, status: 'filed' }] }), { formation_state: 'incorporated', formation_order_id: null });
  for (const status of ['pending_payment', 'failed', 'refunded']) {
    assert.deepEqual(formationState(no, { ok: true, value: [{ order_id: 1, status }] }), { formation_state: 'not_incorporated', formation_order_id: null }, status);
  }
});

// ── GET /api/account/companies ─────────────────────────────────────────────

test('companies: a name only is not incorporated; a registration number or a date with no order is incorporated; a paid order is in formation', async () => {
  // Mutations checked: the registration-number test dropped from COMPANY_IDENTITY_SQL (Registered reads not_incorporated);
  // 'filed' dropped from COMPANY_ORDERS_SQL (Filed reads in_formation, 503).
  const r = await get(fixture(), '/api/account/companies');
  assert.equal(r.status, 200);
  assert.deepEqual(states(r.body.companies, 'uid'), {
    co10: ['not_incorporated', null],
    co11: ['incorporated', null],
    co12: ['incorporated', null],
    co13: ['in_formation', 501],
    co14: ['incorporated', null],
  });
  assert.doesNotMatch(JSON.stringify(r.body), /SECRET-REG|registration_number/, 'the number is tested for presence, never returned');
  // The existing status block is untouched: a filed company with a newer paid order still reads in_formation there.
  const filed = r.body.companies.find((x: any) => x.uid === 'co14');
  assert.deepEqual(filed.status, { available: true, value: 'in_formation' });
});

test('companies: one identity statement and one orders statement for every company, never one per row', async () => {
  // Mutation checked: companyFormations called inside the map — five statements each.
  const r = await get(fixture(), '/api/account/companies');
  for (const re of [IDENTITY, ORDERS]) assert.equal(r.queries.filter((q) => re.test(q)).length, 1, String(re));
});

test('companies: a failed legal read is unreadable, never not_incorporated; a filed order still answers', async () => {
  // Mutation checked: a failed identity read taken as "no identity" (Plain reads not_incorporated).
  const r = await get(fixture(), '/api/account/companies', [IDENTITY]);
  assert.equal(r.status, 200, 'the endpoint still answers');
  assert.deepEqual(states(r.body.companies, 'uid'), {
    co10: ['unreadable', null],
    co11: ['unreadable', null],
    co12: ['unreadable', null],
    co13: ['unreadable', null],
    co14: ['incorporated', null],
  });
  const orders = await get(fixture(), '/api/account/companies', [ORDERS]);
  assert.equal(orders.status, 200);
  assert.deepEqual(states(orders.body.companies, 'uid'), {
    co10: ['unreadable', null],
    co11: ['incorporated', null],
    co12: ['incorporated', null],
    co13: ['unreadable', null],
    co14: ['unreadable', null],
  });
});

// ── GET /api/account/projects ──────────────────────────────────────────────

test('projects: a paid order is in formation with its id; the latest in-flight order is named; a company\'s identity or filed order carries to its ventures', async () => {
  // Mutations checked: the company's filed orders left out of PROJECT_ORDERS_SQL (Ada in Hidden reads not_incorporated);
  // ORDER BY reversed (Solo names 504).
  const r = await get(fixture(), '/api/account/projects');
  assert.equal(r.status, 200);
  assert.deepEqual(states(r.body.projects, 'id'), {
    [P_PLAIN]: ['not_incorporated', null],
    [P_REGISTERED]: ['incorporated', null],
    [P_DATED]: ['incorporated', null],
    [P_FORMING]: ['in_formation', 501],
    [P_FILED]: ['incorporated', null],
    [P_FILED_SIBLING]: ['incorporated', null],
    [SOLO]: ['in_formation', 505],
    [BARE]: ['not_incorporated', null],
    [P_HIDDEN_MINE]: ['incorporated', null],
  });
  assert.equal(r.body.projects.some((p: any) => p.id === P_HIDDEN_FILER), false, 'the filer\'s venture is not Ada\'s');
  for (const re of [IDENTITY, ORDERS]) assert.equal(r.queries.filter((q) => re.test(q)).length, 1, String(re));
});

test('projects: a failed legal read leaves a venture in a company unreadable, and a standalone venture readable', async () => {
  const r = await get(fixture(), '/api/account/projects', [IDENTITY]);
  assert.equal(r.status, 200);
  const s = states(r.body.projects, 'id');
  assert.deepEqual(s[P_PLAIN], ['unreadable', null]);
  assert.deepEqual(s[P_FORMING], ['unreadable', null], 'a paid order is not enough without the legal record');
  assert.deepEqual(s[P_FILED], ['incorporated', null], 'a filed order is enough on its own');
  assert.deepEqual(s[SOLO], ['in_formation', 505], 'no company, no legal record to fail');
  const orders = await get(fixture(), '/api/account/projects', [ORDERS]);
  assert.equal(orders.status, 200);
  assert.deepEqual(Object.values(states(orders.body.projects, 'id')).map(([st]) => st).sort(),
    ['incorporated', 'incorporated', 'unreadable', 'unreadable', 'unreadable', 'unreadable', 'unreadable', 'unreadable', 'unreadable']);
});

// ── GET /api/account/switcher ──────────────────────────────────────────────

test('switcher: each company carries its formation state; a failed read costs only the state', async () => {
  const r = await get(fixture(), '/api/account/switcher');
  assert.equal(r.status, 200);
  assert.deepEqual(states(r.body.companies, 'uid'), {
    co10: ['not_incorporated', null],
    co11: ['incorporated', null],
    co12: ['incorporated', null],
    co13: ['in_formation', 501],
    co14: ['incorporated', null],
  });
  for (const re of [IDENTITY, ORDERS]) assert.equal(r.queries.filter((q) => re.test(q)).length, 1, String(re));
  const down = await get(fixture(), '/api/account/switcher', [IDENTITY]);
  assert.equal(down.status, 200);
  assert.equal(down.body.companies.find((x: any) => x.uid === 'co10').formation_state, 'unreadable');
  assert.equal(down.body.companies[0].projects.available, true);
});

// ── Snapshot: the existing fields of the three reads are unchanged ─────────

test('snapshot: each read keeps its existing fields and gains only formation_state and formation_order_id', async () => {
  // Mutation checked: a field renamed or dropped on any of the three reads fails here.
  const added = ['formation_order_id', 'formation_state'];
  const keys = (o: any) => Object.keys(o).sort();
  const db = fixture();
  const companies = (await get(db, '/api/account/companies')).body.companies;
  assert.deepEqual(keys(companies[0]), [
    'archived_at', 'authority', 'company_name', 'counts', 'cycles_active', 'formation', 'is_primary_admin', 'last_opened',
    'legal', 'location_count', 'logo_url', 'member_count', 'my_role', 'pending_invitations', 'primary_location', 'stage', 'status',
    'title', 'uid', ...added,
  ].sort());
  const projects = (await get(db, '/api/account/projects')).body.projects;
  assert.deepEqual(keys(projects[0]), [
    'company_id', 'company_name', 'company_uid', 'cycles_active', 'id', 'member_count', 'my_seat', 'name', 'playbook_week', 'stage', 'uid', ...added,
  ].sort());
  const switcher = (await get(db, '/api/account/switcher')).body;
  assert.deepEqual(keys(switcher), ['companies', 'create', 'elsewhere', 'standalone']);
  assert.deepEqual(keys(switcher.companies[0]), ['is_primary_admin', 'legal_form', 'my_role', 'name', 'path', 'projects', 'slug', 'uid', ...added].sort());
  assert.deepEqual(keys(switcher.companies[0].projects.value[0]), ['id', 'my_seat', 'name', 'path', 'slug', 'uid'], 'switcher projects gain nothing');
  assert.deepEqual(keys(switcher.standalone.value[0]), ['id', 'my_seat', 'name', 'path', 'slug', 'uid']);
});

test('the statements are literal and read no value of the registration number', () => {
  for (const sql of [COMPANY_IDENTITY_SQL, COMPANY_ORDERS_SQL, PROJECT_ORDERS_SQL]) assert.doesNotMatch(sql, /\$\{/);
  assert.match(COMPANY_IDENTITY_SQL, /^SELECT cp\.id AS company_id FROM/, 'only the id comes back');
});
