/**
 * D6145 (#6145) — a deal's owner in the firm's own flow: who it can be given
 * to (`GET /api/deals/flow/owners`), and Unassigned as an explicit
 * `owner_user_id: null` on a change, in a firm's flow only.
 *
 * Real routes and services over the canonical schema. Every firm, person and
 * deal is made up: 1 Ivy and 2 Ian, investors at firm 10; 3 Oona, an investor
 * at firm 20; 4 Fay, a founder; 7 a deactivated seat at firm 10; 8 Abe, an
 * admin linked to firm 10.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_flow_owners_6145.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/deal_flow.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d6145-01234567890123456789';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['entities', 'users', 'founders', 'user_sessions', 'user_company_links', 'company_profiles', 'projects', 'deals', 'deal_invitations', 'commitments',
    'investor_dealroom_members', 'intro_propositions', 'syndicates', 'watchlist_items']) db.exec(tableFromBaseline(baseline, t));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/618_deal_flow.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/597_company_archive_and_events.sql', 'utf8'));
  db.exec(`
    INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES
      (1,'Ivy','ivy@example.test','investor',NULL,'approved',1),(2,'Ian','ian@example.test','investor',NULL,'approved',1),
      (3,'Oona','oona@example.test','investor',NULL,'approved',1),(4,'Fay','fay@example.test','founder',NULL,'approved',1),
      (7,'Gone seat','gone@example.test','investor',NULL,'approved',0),(8,'Abe','abe@example.test','admin',NULL,'approved',1);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('l1',10,1),('l2',10,2),('l3',20,3),('l7',10,7),('l8',10,8);
    INSERT INTO projects(id,uid,name,founder_id,sector,stage,deleted_at) VALUES (11,'acme','Acme',NULL,'Robotics','seed',NULL);
    INSERT INTO deals(id,project_id,status,amount,target_raise,stage_changed_at) VALUES (101,11,'active',500000,1500000,'2026-10-01 00:00:00');`);
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production' } as any };
}

async function call(f: any, path: string, who: number | null = 1, method = 'GET', body?: unknown, company: number | null = 10) {
  const app = new Hono<any>(); app.route('/api/deals/flow', routes);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const headers: any = {};
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if (company != null) headers['X-Company-Id'] = String(company);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = console.error; console.error = () => {};
  try {
    const res = await app.request('/api/deals/flow' + path, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } }, f.env);
    return { status: res.status, body: await res.json() as any };
  } finally { console.error = saved; }
}
const row = (f: any) => ({ ...f.db.prepare('SELECT owner_user_id FROM deal_flow_entries WHERE deal_id=101').get() });
const ownerEvents = (f: any) => (f.db.prepare("SELECT COUNT(*) AS n FROM deal_flow_events WHERE kind='owner'").get() as any).n;

test('the owners a firm can choose: the caller first, then its active investor seats; never another firm, a deactivated seat, an admin or an email', async () => {
  // Mutation checked: the role or is_active filter dropped → Abe or the gone seat listed; the caller not first → Ian leads.
  const f = fixture();
  const r = await call(f, '/owners', 2);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { scope: 'firm', can_unassign: true, owners: [{ user_id: 2, name: 'Ian', you: true }, { user_id: 1, name: 'Ivy', you: false }] });
  assert.ok(!JSON.stringify(r.body).includes('@'), 'no email is read out');
});

test('with no firm the only owner is the caller, and Unassigned is not offered', async () => {
  const f = fixture();
  const r = await call(f, '/owners', 1, 'GET', undefined, null);
  assert.deepEqual(r.body, { scope: 'you', can_unassign: false, owners: [{ user_id: 1, name: 'Ivy', you: true }] });
  assert.equal((await call(f, '/owners', 4)).status, 403, 'a founder has no deal flow');
  assert.equal((await call(f, '/owners', null)).status, 401);
});

test('a firm clears an owner with null: the row is Unassigned and the change is in the events; an add with null is still the caller\'s', async () => {
  // Mutation checked: `clearable` not passed on a change → null becomes the caller (owner 1); the owner event dropped → count stays 0.
  const f = fixture();
  const add = await call(f, '', 1, 'POST', { deal_id: 101, owner_user_id: null });
  assert.equal(add.body.owner.user_id, 1, 'POST keeps the caller as the default owner');
  const cleared = await call(f, '/101', 2, 'PATCH', { owner_user_id: null });
  assert.deepEqual([cleared.status, cleared.body.owner], [200, null]);
  assert.deepEqual(row(f), { owner_user_id: null });
  assert.equal(ownerEvents(f), 1);
  const ev = await call(f, '/101/events', 1);
  assert.deepEqual(ev.body.items.at(-1).kind, 'owner');
  assert.equal(ev.body.items.at(-1).by.user_id, 2, 'the event names who changed it');
  const back = await call(f, '/101', 2, 'PATCH', { owner_user_id: 1 });
  assert.deepEqual([back.status, back.body.owner.user_id], [200, 1], 'a colleague can be given the deal');
});

test('a refused assignment leaves the row and the events as they were, and says why', async () => {
  // Mutation checked: the solo clear allowed → Noor\'s row unassigned; the seat check skipped → Oona accepted.
  const f = fixture();
  await call(f, '', 1, 'POST', { deal_id: 101 });
  const oona = await call(f, '/101', 1, 'PATCH', { owner_user_id: 3 });
  assert.deepEqual([oona.status, oona.body.code, oona.body.message], [400, 'invalid_owner', 'Choose someone from your firm.']);
  const abe = await call(f, '/101', 1, 'PATCH', { owner_user_id: 8 });
  assert.equal(abe.body.code, 'invalid_owner', 'an admin linked to the firm is not an investor seat');
  assert.deepEqual(row(f), { owner_user_id: 1 });
  assert.equal(ownerEvents(f), 0);

  const g = fixture();
  await call(g, '', 1, 'POST', { deal_id: 101 }, null);
  const solo = await call(g, '/101', 1, 'PATCH', { owner_user_id: null }, null);
  assert.deepEqual([solo.status, solo.body.code, solo.body.message], [400, 'invalid_owner', 'Only you can own a deal in your own flow.']);
  assert.deepEqual(row(g), { owner_user_id: 1 });
  assert.equal(ownerEvents(g), 0);
});
