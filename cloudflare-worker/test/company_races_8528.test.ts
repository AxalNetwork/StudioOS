/**
 * D8528 (#8528) — company invitations and ownership under concurrency.
 *
 * Each case runs two requests twice, in each order:
 *   - SERIAL: one after the other, on a fresh fixture;
 *   - RACED: both at once on another fresh fixture, under `_d1_barrier.ts`,
 *     which holds each request at its first write until both have finished
 *     their reads, then lets the writes through in the same order.
 * The raced run must end exactly as the serial one: the same answers, seats,
 * primary admins, invitation states, venture owners and membership events.
 * So no interleaving yields a state that running them in turn could not. Each
 * case also states the outcome the issue names in plain assertions.
 *
 * The fixture is D1137's (company_lifecycle_d1137.test.ts): the baseline's
 * tables, migration 597's events, migration 236's invitations and the decision
 * guard. Every person and company below is made up.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/company_races_8528.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyRoutes from '../src/routes/company.ts';
import companyLifecycle from '../src/routes/company_lifecycle.ts';
import projectLifecycle from '../src/routes/project_lifecycle.ts';
import projects from '../src/routes/projects.ts';
import { tableFromBaseline, addComplianceStore } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { barrierOver } from './_d1_barrier.ts';
import { addAgentEngineTables } from './_agent_engine_tables.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M236 = readFileSync(new URL('../sql/migrations/236_company_invitations.sql', import.meta.url), 'utf8');
const M597 = readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8');
const M685 = readFileSync(new URL('../sql/migrations/685_company_legal_record_and_slugs.sql', import.meta.url), 'utf8');
const M4963 = readFileSync(new URL('../sql/migrations/202611072255_company_profile_version.sql', import.meta.url), 'utf8');
const GUARD = readFileSync(new URL('../sql/migrations/202611071200_program_grant_revisions.sql', import.meta.url), 'utf8');

// Ada is the primary admin of Northwind and owns the venture; Ben is a member of Northwind and a
// co-founder of the venture with a founder account; Dee has a founder account and no company.
const ADA = 1, BEN = 2, DEE = 4;
const NORTH = 1;
const VENTURE = 10;
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [DEE]: 'founder' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  addComplianceStore(db);
  db.exec(tableFromBaseline(GUARD, 'decision_guard'));
  for (const t of ['users', 'founders', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M597); db.exec(M685); db.exec(M4963); db.exec(M236.replace(/^--.*$/gm, ''));
  addAgentEngineTables(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADA, 'founder', 'Ada Made-up', 'ada@example.test', 101);
  u.run(BEN, 'founder', 'Ben Made-up', 'ben@example.test', 102);
  u.run(DEE, 'founder', 'Dee Made-up', 'dee@example.test', 104);
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (?, 'co-north', 'Northwind', '2026-01-01', '2026-01-01')").run(NORTH);
  const l = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  l.run('l-1', NORTH, ADA, 'Admin', 1, '2026-01-01');
  l.run('l-2', NORTH, BEN, 'Member', 0, '2026-01-02');
  db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, ?, ?, ?)').run(VENTURE, 'Made-up venture', 101, NORTH);
  return db;
}

function appFor() {
  const app = new Hono();
  app.route('/api/projects', projectLifecycle);
  app.route('/api/projects', projects);
  app.route('/api', companyLifecycle);
  app.route('/api', companyRoutes);
  return app;
}

type Res = { status: number; body: any };
async function call(env: any, who: number, method: string, path: string, body?: unknown): Promise<Res> {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await appFor().request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

/** Everything a case may change, without clocks or random ids. */
function snapshot(db: DatabaseSync, originalHash: string | null) {
  return {
    links: db.prepare('SELECT company_id, user_id, role_in_company, is_primary_admin FROM user_company_links ORDER BY company_id, user_id').all(),
    invitations: db.prepare('SELECT email, status, accepted_by_user_id, token_hash = ? AS original_token FROM company_invitations ORDER BY id').all(originalHash ?? ''),
    events: db.prepare('SELECT kind, company_id, project_id, actor_user_id, target_user_id, before_json, after_json FROM company_membership_events ORDER BY id').all(),
    projects: db.prepare('SELECT id, founder_id, company_id FROM projects ORDER BY id').all(),
    members: tableExists(db, 'project_members')
      ? db.prepare('SELECT project_id, user_id, role, status FROM project_members ORDER BY project_id, user_id').all() : [],
  };
}
const tableExists = (db: DatabaseSync, t: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));

type Ctx = { token: string; inviteUid: string; hash: string | null };
type Step = (env: any, ctx: Ctx) => Promise<Res>;
type Case = { setup: (db: DatabaseSync, env: any) => Promise<Ctx>; steps: Record<string, Step> };

/** Runs the case's two steps in `order`, one after the other and then raced; returns both outcomes. */
async function serialAndRaced(c: Case, order: [string, string]) {
  const sdb = fixture(); const senv: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(sdb) };
  const sctx = await c.setup(sdb, senv);
  const serial: Record<string, Res> = {};
  for (const tag of order) serial[tag] = await c.steps[tag](senv, sctx);

  const rdb = fixture();
  const { DB, race } = barrierOver(d1Over(rdb));
  const renv: any = { JWT_SECRET, ENVIRONMENT: 'development', DB };
  const rctx = await c.setup(rdb, renv);
  const tags = Object.keys(c.steps);
  const out = await race<Res[]>(order, tags.map((t) => () => c.steps[t](renv, rctx)) as any, tags);
  const raced = Object.fromEntries(tags.map((t, i) => [t, out[i]]));
  const status = (r: Record<string, Res>) => Object.fromEntries(tags.map((t) => [t, r[t].status]));
  return {
    serial: { status: status(serial), state: snapshot(sdb, sctx.hash), res: serial },
    raced: { status: status(raced), state: snapshot(rdb, rctx.hash), res: raced, db: rdb },
  };
}

/** Ada invites Dee to Northwind; the token comes from the route's own `accept_path`. */
async function invited(db: DatabaseSync, env: any): Promise<Ctx> {
  const r = await call(env, ADA, 'POST', '/api/company/co-north/invitations', { email: 'dee@example.test', role_in_company: 'Engineer' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const token = decodeURIComponent(String(r.body.accept_path).split('token=')[1]);
  const row = db.prepare('SELECT uid, token_hash FROM company_invitations').get() as any;
  return { token, inviteUid: row.uid, hash: row.token_hash };
}
const accept: Step = (env, ctx) => call(env, DEE, 'POST', '/api/company/invitations/accept', { token: ctx.token });
const seated = (db: DatabaseSync, user: number) => Boolean(db.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').get(NORTH, user));
const kinds = (db: DatabaseSync) => (db.prepare('SELECT kind FROM company_membership_events ORDER BY id').all() as any[]).map((e) => e.kind);
const status = (db: DatabaseSync) => (db.prepare('SELECT status FROM company_invitations').get() as any).status;

for (const order of [['revoke', 'accept'], ['accept', 'revoke']] as [string, string][]) {
  test(`accept against revoke (${order.join(' then ')}): never a seat from a revoked invitation`, async () => {
    const { serial, raced } = await serialAndRaced({
      setup: invited,
      steps: { accept, revoke: (env, ctx) => call(env, ADA, 'DELETE', `/api/company/co-north/invitations/${ctx.inviteUid}`) },
    }, order);
    assert.deepEqual(raced.status, serial.status);
    assert.deepEqual(raced.state, serial.state);
    const db = raced.db;
    if (order[0] === 'revoke') {
      assert.deepEqual([raced.res.revoke.status, raced.res.accept.status, raced.res.accept.body.code], [200, 410, 'revoked']);
      assert.equal(seated(db, DEE), false, 'a seat from a revoked invitation');
      assert.equal(status(db), 'revoked');
      assert.deepEqual(kinds(db), []);
    } else {
      assert.deepEqual([raced.res.accept.status, raced.res.revoke.status], [200, 404], 'the revoke finds nothing pending');
      assert.equal(seated(db, DEE), true);
      assert.equal(status(db), 'accepted');
      assert.deepEqual(kinds(db), ['join']);
    }
  });
}

for (const order of [['resend', 'accept'], ['accept', 'resend']] as [string, string][]) {
  test(`accept against resend (${order.join(' then ')}): the old token stops working, one seat at most, one acceptance event`, async () => {
    const { serial, raced } = await serialAndRaced({
      setup: invited,
      steps: { accept, resend: (env, ctx) => call(env, ADA, 'POST', `/api/company/co-north/invitations/${ctx.inviteUid}/resend`) },
    }, order);
    assert.deepEqual(raced.status, serial.status);
    assert.deepEqual(raced.state, serial.state);
    const db = raced.db;
    if (order[0] === 'resend') {
      assert.equal(raced.res.resend.status, 200);
      assert.equal(raced.res.accept.status, 404, 'the old token no longer opens the invitation');
      assert.equal(seated(db, DEE), false);
      assert.deepEqual(raced.state.invitations.map((r: any) => ({ ...r })),
        [{ email: 'dee@example.test', status: 'pending', accepted_by_user_id: null, original_token: 0 }], 'still pending, under a new token');
      // The new token still works, once.
      const fresh = decodeURIComponent(String(raced.res.resend.body.accept_path).split('token=')[1]);
      const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
      assert.equal((await accept(env, { token: fresh } as Ctx)).status, 200);
    } else {
      assert.equal(raced.res.accept.status, 200);
      assert.deepEqual([raced.res.resend.status, raced.res.resend.body.code], [409, 'accepted'], 'an accepted invitation is not re-sent');
      assert.equal(status(db), 'accepted');
    }
    assert.equal(seated(db, DEE), true);
    assert.deepEqual(kinds(db), ['join'], 'one acceptance event');
  });
}

test('two accepts of the same invitation (two tabs): one seat, one acceptance event', async () => {
  const { serial, raced } = await serialAndRaced({
    setup: invited,
    steps: { first: accept, second: accept },
  }, ['first', 'second']);
  assert.deepEqual(raced.status, serial.status);
  assert.deepEqual(raced.state, serial.state);
  assert.deepEqual([raced.res.first.status, raced.res.second.status, raced.res.second.body.code], [200, 410, 'accepted']);
  assert.equal((raced.db.prepare('SELECT COUNT(*) AS n FROM user_company_links WHERE user_id = ?').get(DEE) as any).n, 1);
  assert.deepEqual(kinds(raced.db), ['join']);
});

const none: Case['setup'] = async () => ({ token: '', inviteUid: '', hash: null });
const primaries = (db: DatabaseSync) => (db.prepare('SELECT user_id FROM user_company_links WHERE company_id = ? AND is_primary_admin = 1 ORDER BY user_id').all(NORTH) as any[]).map((r) => r.user_id);

for (const order of [['remove', 'transfer'], ['transfer', 'remove']] as [string, string][]) {
  test(`primary-admin transfer against removing the new owner (${order.join(' then ')}): never without a primary admin`, async () => {
    const { serial, raced } = await serialAndRaced({
      setup: none,
      steps: {
        transfer: (env) => call(env, ADA, 'POST', '/api/company/co-north/transfer', { user_id: BEN, demote: true }),
        remove: (env) => call(env, ADA, 'DELETE', `/api/company/co-north/members/${BEN}`),
      },
    }, order);
    assert.deepEqual(raced.status, serial.status);
    assert.deepEqual(raced.state, serial.state);
    const db = raced.db;
    assert.ok(primaries(db).length >= 1, 'the company has no primary admin');
    if (order[0] === 'remove') {
      assert.deepEqual([raced.res.remove.status, raced.res.transfer.status], [200, 404], 'the transfer finds no such member');
      assert.deepEqual(primaries(db), [ADA]);
      assert.deepEqual(kinds(db), ['remove']);
    } else {
      assert.deepEqual([raced.res.transfer.status, raced.res.remove.status], [200, 400], 'the only primary admin is not removed');
      assert.deepEqual(primaries(db), [BEN]);
      assert.deepEqual(kinds(db), ['transfer']);
    }
  });
}

/** Ada owns the venture; Ben holds a co-founder seat with a founder account. */
async function ventureSeats(db: DatabaseSync, env: any): Promise<Ctx> {
  const { ensureProjectMembershipSchema } = await import('../src/services/projectAccess.ts');
  await ensureProjectMembershipSchema(env);
  const s = db.prepare("INSERT INTO project_members (project_id, user_id, role, status, accepted_at) VALUES (?, ?, ?, 'accepted', datetime('now'))");
  s.run(VENTURE, ADA, 'owner'); s.run(VENTURE, BEN, 'cofounder');
  return { token: '', inviteUid: '', hash: null };
}

for (const order of [['remove', 'transfer'], ['transfer', 'remove']] as [string, string][]) {
  test(`venture owner transfer against the recipient leaving the company (${order.join(' then ')}): the outcome of one order or the other`, async () => {
    const { serial, raced } = await serialAndRaced({
      setup: ventureSeats,
      steps: {
        transfer: (env) => call(env, ADA, 'POST', `/api/projects/${VENTURE}/transfer`, { user_id: BEN }),
        remove: (env) => call(env, ADA, 'DELETE', `/api/company/co-north/members/${BEN}`),
      },
    }, order);
    assert.deepEqual(raced.status, serial.status);
    assert.deepEqual(raced.state, serial.state);
    const db = raced.db;
    const owner = (db.prepare('SELECT founder_id FROM projects WHERE id = ?').get(VENTURE) as any).founder_id;
    if (order[0] === 'remove') {
      assert.deepEqual([raced.res.remove.status, raced.res.transfer.status, raced.res.transfer.body.code], [200, 409, 'owner_not_in_company']);
      assert.equal(owner, 101, 'the venture stays with Ada: Ben no longer belongs to its company');
      assert.deepEqual(kinds(db), ['remove']);
    } else {
      assert.equal(raced.res.transfer.status, 200);
      assert.equal(owner, 102);
      assert.deepEqual(kinds(db).slice(0, 1), ['project_transfer']);
    }
  });
}

test('the barrier holds both requests until each has read, and releases in the order given', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER)');
  db.exec("INSERT INTO t VALUES ('x', 0)");
  const { DB, race } = barrierOver(d1Over(db));
  const log: string[] = [];
  // Each reads v, then writes v + 1: unguarded, so both read 0 and both write 1.
  const bump = (tag: string) => async () => {
    const r = await DB.prepare("SELECT v FROM t WHERE k = 'x'").first() as any;
    log.push(`${tag} read ${r.v}`);
    await DB.prepare("UPDATE t SET v = ? WHERE k = 'x'").bind(r.v + 1).run();
    log.push(`${tag} wrote ${r.v + 1}`);
  };
  await race(['b', 'a'], [bump('a'), bump('b')], ['a', 'b']);
  assert.deepEqual(log.slice(0, 2).sort(), ['a read 0', 'b read 0'], 'both read before either wrote');
  assert.deepEqual(log.slice(2), ['b wrote 1', 'a wrote 1'], 'the writes go in the order given');
  // A request that ends without writing does not hold the other.
  await race(['a', 'b'], [async () => {}, bump('b')], ['a', 'b']);
  assert.equal((db.prepare("SELECT v FROM t WHERE k = 'x'").get() as any).v, 2);
});
