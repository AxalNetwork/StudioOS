/**
 * D486 (#1025) — H15's activation funnel, by creation week, across HQ and
 * every branch.
 *
 * Real SQLite, with the real migrations for every table a step reads. A
 * branch's answer is `activationFunnel` run over its own database, so what HQ
 * adds is what each branch counted.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/hq_activation_d486.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { branchActivation } from '../src/rpc/branchOps.ts';
import {
  ACTIVATION_WEEKS, activationFunnel, cohortWeekOf, weekTwoClosed,
} from '../src/services/activationFunnel.ts';
import hq, { activationAcrossBranches } from '../src/routes/admin_hq.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const exec = (db: InstanceType<typeof DatabaseSync>, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };

// A Wednesday. Creation weeks run 2026-08-17 … 2026-10-05; a week's second
// week has closed for every account once 21 days have passed since its Monday,
// so 08-17 to 09-14 are closed and 09-21, 09-28 and 10-05 are open.
const NOW = Date.parse('2026-10-07T12:00:00Z');

type Db = InstanceType<typeof DatabaseSync>;

/** The tables every step reads, from their migrations. */
function baseDb(): Db {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL DEFAULT 'founder', is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'activity_logs')));
  exec(db, migration('245_legal_acceptances.sql'));
  exec(db, migration('236_company_invitations.sql'));
  exec(db, migration('119_project_membership.sql'));
  exec(db, migration('028_partner_deals.sql'));
  exec(db, migration('263_branch_invitations.sql'));
  return db;
}

const user = (db: Db, id: number, createdAt: string, email = `person${id}@private.example`) =>
  db.prepare(`INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)`).run(id, `Private Person ${id}`, email, createdAt);
const log = (db: Db, id: number, action: string, at: string) =>
  db.prepare(`INSERT INTO activity_logs (user_id, action, created_at) VALUES (?, ?, ?)`).run(id, action, at);
const tos = (db: Db, id: number, key = 'tos_v1') =>
  db.prepare(`INSERT INTO legal_acceptances (user_id, obligation_key, surface) VALUES (?, ?, 'signup')`).run(id, key);

/**
 * HQ's own accounts. Week of 09-07 (closed):
 *   10  signs in, accepts the terms, active on day 9, came from a company invitation
 *   11  signs in with Google, active only on days 3 and 15 (both outside 8–14),
 *       a revoked project invitation (does not count), accepted only privacy
 *   12  never signs in, active exactly at day 8's first instant, came from a
 *       branch invitation whose email differs only in case
 *   13  a "userXlogin" action, which a LIKE without its escape would count
 * Week of 09-28 (open): 14, active on day 8, from a partner invitation.
 * 15 was created before the axis and is not counted.
 */
function hqAccounts(db: Db) {
  user(db, 10, '2026-09-08 10:00:00');
  log(db, 10, 'user_login', '2026-09-08 10:05:00');
  log(db, 10, 'deal_viewed', '2026-09-17 09:00:00');
  tos(db, 10);
  db.prepare(`INSERT INTO company_invitations (uid, company_id, email, token_hash, status, invited_by_user_id, expires_at, accepted_by_user_id)
              VALUES ('ci1', 1, 'x@private.example', 'h1', 'accepted', 99, '2026-12-01', 10)`).run();

  user(db, 11, '2026-09-09 10:00:00');
  log(db, 11, 'user_login_google', '2026-09-09 10:01:00');
  log(db, 11, 'deal_viewed', '2026-09-12 10:00:00');
  log(db, 11, 'deal_viewed', '2026-09-24 10:00:01');
  tos(db, 11, 'privacy_v1');
  db.prepare(`INSERT INTO project_member_invitations (project_id, status, accepted_by_user_id) VALUES (1, 'revoked', 11)`).run();

  user(db, 12, '2026-09-10 10:00:00', 'Twelve@Private.example');
  log(db, 12, 'investor_profile_updated', '2026-09-17 10:00:00');
  db.prepare(`INSERT INTO branch_invitations (uid, email, token_hash, status, invited_by_name, expires_at)
              VALUES ('bi1', 'twelve@private.example', 'h2', 'accepted', 'HQ', '2026-12-01')`).run();

  user(db, 13, '2026-09-11 10:00:00');
  log(db, 13, 'userXlogin_fake', '2026-09-12 10:00:00');

  user(db, 14, '2026-09-29 10:00:00');
  log(db, 14, 'deal_viewed', '2026-10-07 10:00:00');
  db.prepare(`INSERT INTO partner_invitations (token, recipient_email, invited_by_user_id, expires_at, resulting_user_id)
              VALUES ('t1', 'p@private.example', 99, '2026-12-01', 14)`).run();

  user(db, 15, '2026-08-01 10:00:00');
  log(db, 15, 'user_login', '2026-08-01 10:00:00');
  return db;
}

const week = (read: any, w: string) => read.cohorts.find((c: any) => c.week === w);

// ─────────────────────────────────────────────────────────────── the funnel ──

test('weeks and the week-two rule', () => {
  const weeks = ['2026-09-07', '2026-09-14'];
  assert.equal(cohortWeekOf('2026-09-07 00:00:00', weeks), '2026-09-07');
  assert.equal(cohortWeekOf('2026-09-13 23:59:59', weeks), '2026-09-07');
  assert.equal(cohortWeekOf('2026-09-14 00:00:00', weeks), '2026-09-14');
  assert.equal(cohortWeekOf('2026-09-21 00:00:00', weeks), null, 'past the axis');
  assert.equal(cohortWeekOf('2026-09-06 23:59:59', weeks), null, 'before the axis');
  assert.equal(weekTwoClosed('2026-09-14', Date.parse('2026-10-05T00:00:00Z')), true);
  assert.equal(weekTwoClosed('2026-09-14', Date.parse('2026-10-04T23:59:59Z')), false);
});

test('each step counts the event it names, by the week each account was created', async () => {
  const read = await activationFunnel({ DB: d1Over(hqAccounts(baseDb())) } as any, NOW);
  assert.equal(read.available, true);
  if (!read.available) return;
  assert.equal(read.weeks.length, ACTIVATION_WEEKS);
  assert.equal(read.weeks[0], '2026-08-17');
  assert.equal(read.weeks.at(-1), '2026-10-05');
  assert.deepEqual(week(read, '2026-09-07'), {
    week: '2026-09-07', created: 4, signed_in: 2, terms_accepted: 1, active_week_two: 2, week_two_open: false, invited: 2,
  });
  assert.deepEqual(week(read, '2026-09-28'), {
    week: '2026-09-28', created: 1, signed_in: 0, terms_accepted: 0, active_week_two: null, week_two_open: true, invited: 1,
  }, 'an open week has no week-two figure, even for an account already active on day 8');
  assert.deepEqual(week(read, '2026-08-17'), {
    week: '2026-08-17', created: 0, signed_in: 0, terms_accepted: 0, active_week_two: 0, week_two_open: false, invited: 0,
  });
  assert.equal(read.cohorts.reduce((n, c) => n + c.created, 0), 5, 'the account created before the axis is not counted');
  assert.deepEqual(read.steps, { terms_accepted: { available: true }, invited: { available: true } });
});

test('only counts leave the read: no id, email or name', async () => {
  const read = await activationFunnel({ DB: d1Over(hqAccounts(baseDb())) } as any, NOW);
  assert.doesNotMatch(JSON.stringify(read), /private\.example|Private Person|"id"|user_id/i);
});

test('an unreadable step costs only that step; unreadable accounts cost the funnel', async () => {
  const noTerms = hqAccounts(baseDb());
  noTerms.exec('DROP TABLE legal_acceptances');
  const a = await activationFunnel({ DB: d1Over(noTerms) } as any, NOW);
  assert.equal(a.available, true);
  if (!a.available) return;
  assert.equal(week(a, '2026-09-07').terms_accepted, null);
  assert.equal(week(a, '2026-09-07').signed_in, 2, 'the other steps still stand');
  assert.equal(week(a, '2026-09-07').invited, 2);
  assert.equal(a.steps.terms_accepted.available, false);
  assert.match((a.steps.terms_accepted as any).reason, /migration 245/);

  const noInvites = hqAccounts(baseDb());
  noInvites.exec('DROP TABLE partner_invitations');
  const b = await activationFunnel({ DB: d1Over(noInvites) } as any, NOW);
  assert.equal(b.available && week(b, '2026-09-07').invited, null);
  assert.equal(b.available && week(b, '2026-09-07').terms_accepted, 1);

  const noLog = hqAccounts(baseDb());
  noLog.exec('DROP TABLE activity_logs');
  const c = await activationFunnel({ DB: d1Over(noLog) } as any, NOW);
  assert.equal(c.available, false);
  assert.match((c as any).reason, /could not be read/);
});

test('a branch answers with its own funnel, and HQ\'s tier refuses to answer as one', async () => {
  const db = hqAccounts(baseDb());
  const ans = await branchActivation({ DB: d1Over(db), BRANCH_CODE: 'fr' } as any);
  assert.equal(ans.branch, 'fr');
  assert.equal(ans.activation.available, true);
  await assert.rejects(() => branchActivation({ DB: d1Over(db) } as any), /only live on a branch/);
});

// ──────────────────────────────────────────────────────────────────── HQ ──

function hqDb(): Db {
  const db = hqAccounts(baseDb());
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT)`);
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'territory_licences')));
  exec(db, migration('258_licence_deployments.sql'));
  const lic = db.prepare(`INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?, ?, ?, ?, 'active')`);
  lic.run('lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  lic.run('lic_de', 'AXL-002', 'Axal VC DACH GmbH', 'Axal VC DACH');
  const dep = db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status) VALUES (?, ?, ?, ?, ?, 'live')`);
  dep.run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  dep.run('lic_de', 'de', 'de.axal.vc', 'studioos-de', 'studioos-de');
  return db;
}

/** FR: two accounts in the week of 09-07, one signed in and active on day 10. */
function frDb(): Db {
  const db = baseDb();
  user(db, 50, '2026-09-07 08:00:00');
  log(db, 50, 'user_login_passkey', '2026-09-07 08:01:00');
  log(db, 50, 'deal_viewed', '2026-09-17 08:00:00');
  tos(db, 50);
  user(db, 51, '2026-09-12 08:00:00');
  return db;
}

const REGISTRY = [{ code: 'de', brand_name: 'Axal VC DACH' }, { code: 'fr', brand_name: 'Axal VC France' }];
const answering = (db: Db, code: string) => ({
  activation: async () => ({ branch: code, as_of: '', activation: await activationFunnel({ DB: d1Over(db) } as any, NOW) }),
});

test('the total adds each line that answered; a line that did not is named with its reason', async () => {
  const env = {
    DB: d1Over(hqDb()),
    BRANCH_FR: answering(frDb(), 'fr'),
    BRANCH_DE: { activation: async () => { throw new Error('connection reset'); } },
  } as any;
  const act = await activationAcrossBranches(env, REGISTRY, NOW);
  assert.deepEqual(act.lines.map((l: any) => l.code), ['hq', 'de', 'fr']);
  const de = act.lines.find((l: any) => l.code === 'de') as any;
  assert.equal(de.available, false);
  assert.equal(de.unreadable, true);
  assert.match(de.reason, /connection reset/);
  assert.equal((act.lines.find((l: any) => l.code === 'fr') as any).label, 'Axal VC France');
  assert.deepEqual(week(act.all, '2026-09-07'), {
    week: '2026-09-07', created: 6, signed_in: 3, terms_accepted: 2, active_week_two: 3, week_two_open: false, invited: 2,
  });
  assert.equal(act.all.lines_counted, 2);
  assert.equal(act.all.lines_total, 3);
  assert.deepEqual(act.coverage, { total: 2, answered: 1, complete: false, unreadable: ['de'] });
  assert.doesNotMatch(JSON.stringify(act), /private\.example|Private Person/);
});

test('a step one line could not read has no total, and says why', async () => {
  const fr = frDb();
  fr.exec('DROP TABLE legal_acceptances');
  const act = await activationAcrossBranches({ DB: d1Over(hqDb()), BRANCH_FR: answering(fr, 'fr') } as any, [REGISTRY[1]], NOW);
  assert.equal(week(act.all, '2026-09-07').terms_accepted, null);
  assert.equal(week(act.all, '2026-09-07').created, 6, 'the steps every line read are still added');
  assert.match(act.all.terms_reason!, /could not read its terms/);
  assert.equal(act.all.invited_reason, undefined);
});

const hqApp = new Hono<any>();
hqApp.route('/', hq);
hqApp.onError((err: any, c) => {
  const s = ({ Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403 } as any)[err?.message];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

test('H15 sends the funnel, and activation is no longer a named absence', async () => {
  const db = hqDb();
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (1, 'admin', 'Sue', 'sue@axal.example')`).run();
  db.prepare(`INSERT INTO super_admins (user_id) VALUES (1)`).run();
  const tok = await new SignJWT({ user_id: 1, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await hqApp.request('/analytics', { headers: { Authorization: `Bearer ${tok}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db), BRANCH_FR: answering(frDb(), 'fr') });
  const body = await res.json() as any;
  assert.equal(res.status, 200, JSON.stringify(body).slice(0, 400));
  assert.ok(body.activation, 'the payload carries the funnel');
  assert.equal(body.activation.lines[0].code, 'hq');
  assert.equal(body.activation.week_count, ACTIVATION_WEEKS);
  assert.match(body.activation.definition.terms_accepted, /tos_v1/);
  assert.ok(!body.not_recorded.some((n: any) => n.key === 'activation'), 'activation is still listed as not recorded');
});
