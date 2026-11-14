/** D1136 (#3016) — the caller's own companies, ventures and invitations, and answering an invitation signed in, on node:sqlite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import account, { PROJECT_CYCLES_SQL } from '../src/routes/account_companies.ts';
import { CYCLE_STORES } from '../src/services/companySheet.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'test'.repeat(16);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (file: string, name: string) => tableFromBaseline(readFileSync(new URL('../sql/migrations/' + file, import.meta.url), 'utf8'), name);
const STORES = Object.values(CYCLE_STORES).flat();
const ADA = 1, IVY = 2, PAT = 3, SAM = 4;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'user_sessions', 'super_admins', 'company_profiles', 'user_company_links', 'projects', 'project_members', 'project_member_invitations', 'vc_funds', 'engagements', 'quotes', 'service_offerings']) db.exec(tableFromBaseline(baseline, t));
  db.exec('CREATE UNIQUE INDEX uq_project_members_pair ON project_members (project_id, user_id)');
  db.exec(migration('236_company_invitations.sql', 'company_invitations'));
  db.exec(migration('466_company_visits.sql', 'user_company_visits'));
  // D1412 (#3857): the cards' legal line, location and status read 597's archived_at and 685's legal columns,
  // locations and incorporations.company_id.
  db.exec(tableFromBaseline(baseline, 'incorporations'));
  db.exec(readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../sql/migrations/685_company_legal_record_and_slugs.sql', import.meta.url), 'utf8'));
  // Both cycle reads need only a store's project_id.
  for (const s of STORES) db.exec(`CREATE TABLE ${s} (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER)`);
  // A required column the row does not name gets a neutral value, so each row says only what the test is about.
  const insert = (table: string, given: Record<string, any>) => {
    const v = { ...given };
    for (const col of db.prepare(`PRAGMA table_info(${table})`).all() as any[]) {
      if (col.notnull && col.dflt_value == null && !col.pk && !(col.name in v)) v[col.name] = /int|real|num/i.test(col.type) ? 0 : `${table}-${col.name}-${Math.random().toString(36).slice(2)}`;
    }
    return db.prepare(`INSERT INTO ${table} (${Object.keys(v).join(',')}) VALUES (${Object.keys(v).map(() => '?').join(',')})`).run(...Object.values(v));
  };
  for (const [id, role, name, founder_id] of [[ADA, 'founder', 'Ada', 100], [IVY, 'investor', 'Ivy', null], [PAT, 'partner', 'Pat', null], [SAM, 'founder', 'Sam', 200]] as const) {
    insert('users', { id, role, name, email: `${name.toLowerCase()}@private.example`, founder_id });
    insert('user_sessions', { user_id: id, jti: `j-${id}`, factor: 'totp' });
  }
  for (const [id, name] of [[10, 'Alpha Co'], [11, 'Beta Co'], [12, 'Gamma Co']] as const) insert('company_profiles', { id, uid: `co${id}`, company_name: name, stage: 'seed', logo_url: null, revenue_range: 'PRIVATE REVENUE' });
  const link = (id: number, company_id: number, user_id: number, role_in_company: string, is_primary_admin = 0, created_at = '2026-01-01 00:00:00') =>
    insert('user_company_links', { id, uid: `l${id}`, company_id, user_id, role_in_company, is_primary_admin, created_at, title: id === 1 ? 'Partner' : null });
  link(1, 10, ADA, 'Owner', 1);
  link(2, 11, ADA, 'Member', 0, '2025-06-01 00:00:00');
  link(3, 10, PAT, 'Member');
  link(4, 11, SAM, 'Owner', 1);
  link(5, 12, SAM, 'Owner', 1);
  insert('projects', { id: 1, uid: 'p1', name: 'Ada Venture', founder_id: 100, company_id: 10, playbook_week: 'week_3', stage: 'mvp', created_at: '2026-03-01 00:00:00' });
  insert('projects', { id: 2, uid: 'p2', name: 'Ada Trashed', founder_id: 100, company_id: 10, deleted_at: '2026-04-01 00:00:00', created_at: '2026-04-01 00:00:00' });
  insert('projects', { id: 3, uid: 'p3', name: 'Sam Venture', founder_id: 200, company_id: 11, created_at: '2026-02-01 00:00:00' });
  insert('projects', { id: 4, uid: 'p4', name: 'Stranger Venture', founder_id: 300, company_id: null, created_at: '2026-05-01 00:00:00' });
  insert('project_members', { project_id: 1, user_id: PAT, role: 'cofounder', status: 'accepted' });
  insert('project_members', { project_id: 3, user_id: ADA, role: 'advisor', status: 'accepted' });
  insert('project_members', { project_id: 4, user_id: PAT, role: 'cofounder', status: 'removed', removed_at: '2026-05-02 00:00:00' });
  insert('discovery_interviews', { project_id: 1 });
  insert('pitch_decks', { project_id: 3 });
  insert('compliance_events', { project_id: 4 });
  for (const n of [1, 2]) insert('vc_funds', { company_id: 10, name: `Fund ${n}` });
  insert('quotes', { company_id: 10 });
  for (const n of [1, 2, 3]) insert('service_offerings', { company_id: 10, title: `Offer ${n}` });
  insert('engagements', { company_id: 11 });
  const ci = (uid: string, company_id: number, email: string, status = 'pending', expires_at = '2099-01-01 00:00:00') =>
    insert('company_invitations', { uid, company_id, email, role_in_company: 'Advisor', title: 'Partner', token_hash: `PRIVATE-HASH-${uid}`, status, invited_by_user_id: SAM, expires_at });
  ci('ci-open', 12, 'Ada@Private.example');
  ci('ci-old', 12, 'ada@private.example', 'pending', '2020-01-01 00:00:00');
  ci('ci-other', 12, 'someone@private.example');
  ci('ci-alpha', 10, 'newbie@private.example');
  ci('ci-alpha-old', 10, 'late@private.example', 'pending', '2020-01-01 00:00:00'); // lapsed, never counted
  ci('ci-done', 11, 'ada@private.example', 'accepted');
  const pi = (id: number, project_id: number, v: Record<string, any>) =>
    insert('project_member_invitations', { id, project_id, role: 'advisor', status: 'pending', source: 'email', token_hash: `PRIVATE-PHASH-${id}`, invited_by_user_id: SAM, expires_at: '2099-01-01 00:00:00', ...v });
  pi(1, 3, { invitee_user_id: PAT });
  pi(2, 1, { invitee_email: 'IVY@private.example' });
  pi(3, 3, { source: 'link' }); // a bare link names no one
  pi(4, 1, { invitee_email: 'pat@private.example', invitee_user_id: SAM }); // the account named wins over the address
  pi(5, 3, { invitee_user_id: PAT, expires_at: '2020-01-01 00:00:00' });
  pi(6, 2, { invitee_user_id: PAT }); // a trashed venture
  return { db, insert };
}

async function call(db: DatabaseSync, method: string, path: string, { as = ADA, failOn = [] as RegExp[], beforeBatch = null as null | (() => void) } = {}) {
  const token = await new SignJWT({ user_id: as, role: 'member', jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const app = new Hono<any>();
  app.route('/api', account);
  app.onError((err: any, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES as any)[err.message] || 500));
  const queries: string[] = []; const d1 = d1Over(db);
  const DB = {
    ...d1,
    prepare(sql: string) {
      queries.push(sql);
      if (failOn.some((re) => re.test(sql))) return { bind() { return this; }, all: async () => { throw new Error('D1_ERROR: no such table'); }, first: async () => { throw new Error('D1_ERROR'); }, run: async () => { throw new Error('D1_ERROR'); } };
      return d1.prepare(sql);
    },
    async batch(stmts: any[]) { if (beforeBatch) beforeBatch(); return d1.batch(stmts); },
  };
  const res = await app.request(path, { method, headers: as ? { Authorization: `Bearer ${token}` } : {} }, { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' });
  return { status: res.status, body: await res.json() as any, queries };
}
const get = (db: DatabaseSync, path: string, o?: any) => call(db, 'GET', path, o);
const post = (db: DatabaseSync, path: string, o?: any) => call(db, 'POST', path, o);
const v = (b: any) => { assert.equal(b?.available, true, JSON.stringify(b)); return b.value; };
const down = (b: any) => { assert.equal(b?.available, false); assert.ok(b.reason); assert.equal('value' in b, false); };
const privateFree = (body: any) => assert.doesNotMatch(JSON.stringify(body), /private\.example|PRIVATE|token|hash/i);

test('every read and answer needs a session', async () => {
  const { db } = fixture();
  for (const [m, p] of [['GET', '/api/account/companies'], ['GET', '/api/account/projects'], ['GET', '/api/account/invitations'], ['POST', '/api/company/invitations/ci-open/accept'], ['POST', '/api/projects/invitations/1/accept'], ['POST', '/api/projects/invitations/1/decline']]) {
    assert.equal((await call(db, m, p, { as: 0 })).status, 401, p);
  }
});

test('companies: only mine, once each in the switcher\'s order, with counts, and invitations only where I edit', async () => {
  // Mutation checked: the order by is_primary_admin removed → Beta (older link) first;
  // the editor gate removed → Beta carries pending_invitations; deleted ventures counted → Alpha has 2 projects; expired invitations counted.
  const { db } = fixture();
  const { status, body } = await get(db, '/api/account/companies');
  assert.equal(status, 200);
  assert.deepEqual(body.companies.map((x: any) => x.uid), ['co10', 'co11'], 'primary admin first, then the oldest link; never Gamma');
  const [alpha, beta] = body.companies;
  assert.deepEqual([alpha.company_name, alpha.my_role, alpha.title, alpha.is_primary_admin, alpha.stage], ['Alpha Co', 'Owner', 'Partner', true, 'seed']);
  assert.equal(beta.title, null, 'an unrecorded title is null, not a word');
  assert.equal(v(alpha.member_count), 2, 'Ada and Pat');
  assert.equal(v(alpha.pending_invitations), 1);
  assert.equal('pending_invitations' in beta, false, 'a Member is not shown even a count of who is invited');
  assert.deepEqual(Object.fromEntries(Object.entries(alpha.counts).map(([k, b]) => [k, v(b)])), { projects: 1, funds: 2, engagements: 0, quotes: 1, offers: 3 });
  assert.deepEqual(Object.fromEntries(Object.entries(beta.counts).map(([k, b]) => [k, v(b)])), { projects: 1, funds: 0, engagements: 1, quotes: 0, offers: 0 });
  assert.deepEqual(v(alpha.cycles_active), ['validate']);
  assert.equal(v(alpha.last_opened), null);
  privateFree(body);
  assert.doesNotMatch(JSON.stringify(body), /revenue/i);
  const pat = (await get(db, '/api/account/companies', { as: PAT })).body;
  assert.deepEqual(pat.companies.map((x: any) => x.uid), ['co10']);
  assert.deepEqual((await get(db, '/api/account/companies', { as: IVY })).body, { companies: [] });
});

test('companies: a failed store costs only its block; the links failing is a 503', async () => {
  // Mutation checked: a count catch returning [] → offers reads 0 instead of unreadable.
  const { db } = fixture();
  const one = (await get(db, '/api/account/companies', { failOn: [/FROM service_offerings/] })).body.companies[0];
  down(one.counts.offers);
  assert.equal(v(one.counts.funds), 2);
  const visits = (await get(db, '/api/account/companies', { failOn: [/FROM user_company_visits/] })).body.companies[0];
  down(visits.last_opened);
  const cycles = (await get(db, '/api/account/companies', { failOn: [/discovery_interviews/] })).body.companies[0];
  down(cycles.cycles_active);
  const r = await get(db, '/api/account/companies', { failOn: [/FROM user_company_links l JOIN company_profiles/] });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'companies_unreadable');
});

test('projects: my own ventures and accepted seats only, for every profile, never a stranger\'s', async () => {
  // Mutation checked: the seat join without removed_at → Pat sees p4; the deleted filter dropped → Ada sees p2;
  // the owner not counted → p1 has 1 member; CYCLE_STORES out of step with the statement → the parity check fails.
  const { db } = fixture();
  const ada = (await get(db, '/api/account/projects')).body.projects;
  assert.deepEqual(ada.map((p: any) => [p.uid, p.my_seat]), [['p1', 'owner'], ['p3', 'advisor']]);
  const [p1, p3] = ada;
  assert.deepEqual([p1.company_id, p1.company_uid, p1.company_name, p1.stage, p1.playbook_week], [10, 'co10', 'Alpha Co', 'mvp', 'week_3']);
  assert.equal(v(p1.member_count), 2, 'the owner and Pat');
  assert.equal(v(p3.member_count), 2, 'Sam, its owner, and Ada');
  assert.deepEqual(v(p1.cycles_active), ['validate']);
  assert.deepEqual(v(p3.cycles_active), ['raise']);
  assert.deepEqual((await get(db, '/api/account/projects', { as: PAT })).body.projects.map((p: any) => [p.uid, p.my_seat]), [['p1', 'cofounder']]);
  assert.deepEqual((await get(db, '/api/account/projects', { as: IVY })).body, { projects: [] }, 'an investor is not shown every venture');
  privateFree(ada);
  const down1 = (await get(db, '/api/account/projects', { failOn: [/UNION ALL/] })).body.projects[0];
  down(down1.cycles_active);
  v(down1.member_count);
  assert.equal((await get(db, '/api/account/projects', { failOn: [/FROM projects p\s+LEFT JOIN project_members/] })).status, 503);
  // The statement names every store CYCLE_STORES holds, under its own cycle, and nothing else.
  const named = [...PROJECT_CYCLES_SQL.matchAll(/SELECT '(\w+)'(?: AS cycle)?, project_id FROM (\w+)/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(named, Object.entries(CYCLE_STORES).flatMap(([cyc, stores]) => stores.map((s) => `${cyc}:${s}`)).sort());
});

test('invitations: addressed to me by address or by account, open, on a live company or venture; nothing else', async () => {
  // Mutation checked: the email match made case-sensitive → Ada's invitation is missing; the expiry filter dropped → ci-old is listed;
  // the bare-link guard dropped → pi3 is listed for anyone; the account-wins rule dropped → pi4 is listed for Pat.
  const { db } = fixture();
  const ada = (await get(db, '/api/account/invitations')).body;
  assert.deepEqual(v(ada.company).map((x: any) => [x.uid, x.company_name, x.role_in_company, x.title, x.invited_by_name]), [['ci-open', 'Gamma Co', 'Advisor', 'Partner', 'Sam']]);
  assert.deepEqual(v(ada.project), []);
  const pat = (await get(db, '/api/account/invitations', { as: PAT })).body;
  assert.deepEqual(v(pat.project).map((x: any) => [x.id, x.project_name, x.role, x.can_accept]), [[1, 'Sam Venture', 'advisor', true]]);
  assert.deepEqual(v(pat.company), []);
  const ivy = (await get(db, '/api/account/invitations', { as: IVY })).body;
  assert.deepEqual(v(ivy.project).map((x: any) => [x.id, x.can_accept]), [[2, false]], 'an investor sees it and is told it cannot be accepted');
  privateFree(ada); privateFree(pat);
  const half = (await get(db, '/api/account/invitations', { failOn: [/FROM project_member_invitations i/] })).body;
  down(half.project);
  assert.equal(v(half.company).length, 1);
});

test('answering a company invitation: only the address it names, once, and it joins the company with the invitation\'s role', async () => {
  // Mutation checked: the email binding dropped → Pat joins Gamma; the pending gate dropped from the seat insert → a raced accept still seats Ada.
  const { db } = fixture();
  assert.equal((await post(db, '/api/company/invitations/ci-open/accept', { as: PAT })).status, 404, 'another address\'s invitation reads as missing');
  assert.equal((await post(db, '/api/company/invitations/nope/accept')).status, 404);
  const old = await post(db, '/api/company/invitations/ci-old/accept');
  assert.deepEqual([old.status, old.body.error], [410, 'expired']);
  assert.equal(db.prepare("SELECT status FROM company_invitations WHERE uid = 'ci-old'").get()!.status, 'expired');
  assert.deepEqual([(await post(db, '/api/company/invitations/ci-done/accept')).status], [410]);
  const raced = await post(db, '/api/company/invitations/ci-open/accept', { beforeBatch: () => db.exec("UPDATE company_invitations SET status = 'revoked' WHERE uid = 'ci-open'") });
  assert.deepEqual([raced.status, raced.body.error], [409, 'already_answered']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_company_links WHERE company_id = 12 AND user_id = ?').get(ADA)!.n, 0, 'a lost race seats no one');
  db.exec("UPDATE company_invitations SET status = 'pending' WHERE uid = 'ci-open'");
  const ok1 = await post(db, '/api/company/invitations/ci-open/accept');
  assert.equal(ok1.status, 200);
  assert.deepEqual(ok1.body, { ok: true, company_uid: 'co12', company_name: 'Gamma Co', role_in_company: 'Advisor', already_member: false });
  const seat = db.prepare('SELECT role_in_company, title, is_primary_admin FROM user_company_links WHERE company_id = 12 AND user_id = ?').get(ADA) as any;
  assert.deepEqual({ ...seat }, { role_in_company: 'Advisor', title: 'Partner', is_primary_admin: 0 });
  assert.equal(db.prepare("SELECT status, accepted_by_user_id FROM company_invitations WHERE uid = 'ci-open'").get()!.accepted_by_user_id, ADA);
  assert.equal((await post(db, '/api/company/invitations/ci-open/accept')).status, 410, 'answered once');
  privateFree(ok1.body);
});

test('answering a venture invitation: the account or address it names, never a bare link, never an investor, once', async () => {
  // Mutation checked: the investor gate dropped → Ivy is seated; the bare-link rule dropped → Ada accepts pi3; decline leaving status pending.
  const { db } = fixture();
  assert.equal((await post(db, '/api/projects/invitations/3/accept')).status, 404, 'a bare link is answered only with its token');
  assert.equal((await post(db, '/api/projects/invitations/4/accept', { as: PAT })).status, 404, 'named to another account');
  assert.equal((await post(db, '/api/projects/invitations/1/accept')).status, 404, 'named to Pat, not Ada');
  assert.equal((await post(db, '/api/projects/invitations/6/accept', { as: PAT })).status, 404, 'a trashed venture');
  const ivy = await post(db, '/api/projects/invitations/2/accept', { as: IVY });
  assert.deepEqual([ivy.status, ivy.body.error], [403, 'investor']);
  assert.equal((await post(db, '/api/projects/invitations/5/accept', { as: PAT })).body.error, 'expired');
  const raced = await post(db, '/api/projects/invitations/1/accept', { as: PAT, beforeBatch: () => db.exec("UPDATE project_member_invitations SET status = 'revoked' WHERE id = 1") });
  assert.deepEqual([raced.status, raced.body.error], [409, 'already_answered']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = 3').get()!.n, 1, 'a lost race seats no one, not even the owner row');
  db.exec("UPDATE project_member_invitations SET status = 'pending' WHERE id = 1");
  const ok1 = await post(db, '/api/projects/invitations/1/accept', { as: PAT });
  assert.deepEqual(ok1.body, { ok: true, project_id: 3, role: 'advisor' });
  const roster = db.prepare('SELECT user_id, role, status, invitation_id FROM project_members WHERE project_id = 3 ORDER BY user_id').all().map((r: any) => ({ ...r }));
  assert.deepEqual(roster, [
    { user_id: ADA, role: 'advisor', status: 'accepted', invitation_id: null },
    { user_id: PAT, role: 'advisor', status: 'accepted', invitation_id: 1 },
    { user_id: SAM, role: 'owner', status: 'accepted', invitation_id: null },
  ]);
  assert.equal((await post(db, '/api/projects/invitations/1/accept', { as: PAT })).status, 410);
  const dec = await post(db, '/api/projects/invitations/2/decline', { as: IVY });
  assert.deepEqual(dec.body, { ok: true, declined: true });
  assert.equal(db.prepare('SELECT status FROM project_member_invitations WHERE id = 2').get()!.status, 'declined');
  assert.equal((await post(db, '/api/projects/invitations/2/decline', { as: IVY })).status, 410);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE user_id = ?').get(IVY)!.n, 0);
});

// ── D1412 (#3857): the Portfolio card's legal line, location and status ─────
// Sam belongs to Beta (11) and Gamma (12); Sam's venture p3 sits in Beta.

const card = (body: any, uid: string) => body.companies.find((x: any) => x.uid === uid);

test('the legal block: the four fields, nulls inside an available block, and a failed read costs only its block', async () => {
  // Mutation checked: each company's legal record read inside the map (N+1) — the statement count below.
  const { db } = fixture();
  db.prepare("UPDATE company_profiles SET legal_name = 'Beta Holdings Inc.', legal_form = 'c_corp', jurisdiction = 'US-DE', incorporation_date = '2026-02-03', registration_number = 'PRIVATE-REG-1' WHERE id = 11").run();
  const r = await get(db, '/api/account/companies', { as: SAM });
  assert.equal(r.status, 200);
  assert.deepEqual(v(card(r.body, 'co11').legal), { legal_name: 'Beta Holdings Inc.', legal_form: 'c_corp', jurisdiction: 'US-DE', incorporation_date: '2026-02-03' });
  assert.deepEqual(v(card(r.body, 'co12').legal), { legal_name: null, legal_form: null, jurisdiction: null, incorporation_date: null }, 'not recorded is null, never ""');
  assert.equal(card(r.body, 'co11').archived_at, null);
  for (const re of [/FROM company_profiles\s+WHERE id IN/, /FROM company_locations/, /FROM incorporations i/]) {
    assert.equal(r.queries.filter((q) => re.test(q)).length, 1, `one statement for every company: ${re}`);
  }
  assert.doesNotMatch(JSON.stringify(r.body), /tax_id|registration_number|PRIVATE-REG|amount_cents|stripe_/, 'no tax ID, registration number, amount or Stripe field');

  const failed = await get(db, '/api/account/companies', { as: SAM, failOn: [/FROM company_profiles\s+WHERE id IN/] });
  assert.equal(failed.status, 200);
  down(card(failed.body, 'co11').legal);
  assert.equal(v(card(failed.body, 'co11').member_count) >= 1, true, 'the counts still answer');
});

test('the primary location: headquarters before registered, a closed one skipped, none is null with 0, a failed read is unavailable', async () => {
  // Mutations checked: registered ranked above headquarters; location_count 0 when the read failed.
  const { db } = fixture();
  const loc = db.prepare("INSERT INTO company_locations (uid, company_id, kind, label, city, country, closed_on, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1)");
  loc.run('l-reg', 11, 'registered', 'Registered', 'Dover', 'US', null);
  loc.run('l-hq', 11, 'headquarters', 'Berlin HQ', 'Berlin', 'DE', null);
  loc.run('l-old', 11, 'headquarters', 'Old HQ', 'Paris', 'FR', '2026-01-01');
  loc.run('l-office', 11, 'office', 'London office', 'London', 'GB', null);
  const r = await get(db, '/api/account/companies', { as: SAM });
  assert.deepEqual(v(card(r.body, 'co11').primary_location), { label: 'Berlin HQ', kind: 'headquarters', city: 'Berlin', country: 'DE' });
  assert.equal(v(card(r.body, 'co11').location_count), 3, 'the open ones');
  assert.equal(v(card(r.body, 'co12').primary_location), null);
  assert.equal(v(card(r.body, 'co12').location_count), 0);
  db.prepare("UPDATE company_locations SET closed_on = '2026-06-01' WHERE uid = 'l-hq'").run();
  assert.equal(v(card((await get(db, '/api/account/companies', { as: SAM })).body, 'co11').primary_location).kind, 'registered', 'a closed headquarters is skipped');
  const failed = await get(db, '/api/account/companies', { as: SAM, failOn: [/FROM company_locations/] });
  down(card(failed.body, 'co11').primary_location);
  down(card(failed.body, 'co11').location_count);
});

test('the status: in formation from a paid order, active once filed, archived wins, and unavailable when the orders cannot be read', async () => {
  // Mutations checked: pending_payment counted; the company taken from p.company_id only.
  const { db } = fixture();
  const order = db.prepare("INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at, company_id) VALUES (?, ?, ?, 'us_de_ccorp', 'Beta, Inc.', 50000, ?, ?, ?)");
  order.run(71, SAM, 3, 'pending_payment', null, null);
  let r = await get(db, '/api/account/companies', { as: SAM });
  assert.equal(v(card(r.body, 'co11').status), 'active', 'an unpaid order is not formation');
  assert.equal(v(card(r.body, 'co11').formation), null);
  order.run(72, SAM, 3, 'paid', '2026-09-01 10:00:00', null);
  r = await get(db, '/api/account/companies', { as: SAM });
  assert.equal(v(card(r.body, 'co11').status), 'in_formation');
  assert.deepEqual(v(card(r.body, 'co11').formation), { order_id: 72, order_status: 'paid', jurisdiction_id: 'us_de_ccorp' });
  assert.equal(v(card(r.body, 'co12').status), 'active');
  db.prepare("UPDATE incorporations SET status = 'filed' WHERE id = 72").run();
  assert.equal(v(card((await get(db, '/api/account/companies', { as: SAM })).body, 'co11').status), 'active', 'a filed order is active');

  // An order linked to its company counts there even after its venture moves to another one.
  order.run(73, SAM, 3, 'packet_ready', '2026-09-02 10:00:00', 11);
  db.prepare('UPDATE projects SET company_id = 12 WHERE id = 3').run();
  r = await get(db, '/api/account/companies', { as: SAM });
  assert.deepEqual(v(card(r.body, 'co11').formation).order_id, 73);
  assert.equal(v(card(r.body, 'co12').status), 'active', 'the order is not the new company\'s');

  db.prepare("UPDATE company_profiles SET archived_at = '2026-10-01' WHERE id = 11").run();
  r = await get(db, '/api/account/companies', { as: SAM });
  assert.equal(v(card(r.body, 'co11').status), 'archived', 'archived wins over in formation');
  assert.equal(card(r.body, 'co11').archived_at, '2026-10-01');
  const failed = await get(db, '/api/account/companies', { as: SAM, failOn: [/FROM incorporations i/] });
  assert.equal(v(card(failed.body, 'co11').status), 'archived', 'archived needs no orders');
  down(card(failed.body, 'co12').status);
  down(card(failed.body, 'co12').formation);
});
