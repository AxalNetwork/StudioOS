/**
 * D5059 (#5059) — program entitlements derived from held user licences, over real SQLite and every migration.
 *
 * Pinned, from the issue's acceptance criteria:
 *   · Program access explains which licence caused an entitlement (sources, in_force_via);
 *   · a multi-licence account gets the union, each program once, with one grant row;
 *   · ending one licence removes only entitlements with no remaining valid source;
 *   · a suspended licence is no source;
 *   · an agreement-required program stays blocked until its agreement is executed, and a store that cannot be
 *     read is never read as signed;
 *   · `users.role` is not the source of truth;
 *   · territory program grants keep working unchanged;
 *   · rules are versioned: the version in force on a day wins, a later-dated one is scheduled;
 *   · reads are Super Admin; writes take the write bar.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_entitlements_d5059.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount as entitlementsMount } from '../src/routes/admin_program_entitlements.ts';
import { mount as memberEntitlementsMount } from '../src/routes/member_program_entitlements.ts';
import learningPrograms from '../src/routes/learning_programs.ts';
import spinoutLab from '../src/routes/spinout_lab.ts';
import programGrantsRouter from '../src/routes/admin_program_grants.ts';
import { transitionLicence } from '../src/services/userLicences.ts';
import {
  entitlementsOfAccount, evaluateEntitlements, readAgreements, rulesInForce, type Rule,
} from '../src/services/programEntitlements.ts';

const SECRET = ['d5059', 'entitlement', 'fixture', 'secret'].join('-');
const ADMIN = 1, SUPER = 2, SUPER_NO_STEP = 3, FOUNDER = 10, MULTI = 11, ROLE_ONLY = 12, ADMIN_HOLDER = 13;
const DAY = '2026-11-20';
const REASON = 'Agreed at the November HQ review.';

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Admin One', 'admin1@example.test');
  u.run(SUPER, 'admin', 'Super Two', 'super2@example.test');
  u.run(SUPER_NO_STEP, 'admin', 'Super Three', 'super3@example.test');
  u.run(FOUNDER, 'founder', 'Founder Ten', 'founder10@example.test');
  u.run(MULTI, 'founder', 'Multi Eleven', 'multi11@example.test');
  u.run(ROLE_ONLY, 'investor', 'Role Only Twelve', 'role12@example.test');
  u.run(ADMIN_HOLDER, 'admin', 'Admin Holder Thirteen', 'admin13@example.test');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${SUPER_NO_STEP})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, last_step_up_at, created_at) VALUES (?, ?, 'totp', 'totp', ?, datetime('now'))");
  s.run(ADMIN, `s-${ADMIN}`, null);
  s.run(SUPER, `s-${SUPER}`, null);
  // A fresh step-up a minute ago, on the database's clock.
  db.prepare("UPDATE user_sessions SET last_step_up_at = datetime('now', '-1 minute') WHERE user_id = ?").run(SUPER);
  s.run(SUPER_NO_STEP, `s-${SUPER_NO_STEP}`, null);
  // A session signed in two hours ago with no step-up since: the write bar's step-up is stale.
  db.prepare("UPDATE user_sessions SET created_at = datetime('now', '-2 hours') WHERE user_id = ?").run(SUPER_NO_STEP);
  s.run(FOUNDER, `s-${FOUNDER}`, null);
  const lic = db.prepare(`INSERT INTO licences (uid, licence_ref, licence_family, licence_type, holder_type, holder_id, status, created_at)
                          VALUES (?, ?, 'user', ?, 'user', ?, ?, '2026-11-01')`);
  lic.run('ul_f10', 'UL-FND-0010', 'founder', String(FOUNDER), 'active');
  lic.run('ul_f11', 'UL-FND-0011', 'founder', String(MULTI), 'active');
  lic.run('ul_i11', 'UL-INV-0011', 'investor', String(MULTI), 'active');
  lic.run('ul_a11', 'UL-ADV-0011', 'advisor', String(MULTI), 'active');
  lic.run('ul_i13', 'UL-INV-0013', 'investor', String(ADMIN_HOLDER), 'active');
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route(entitlementsMount.path, entitlementsMount.router);
  app.route(memberEntitlementsMount.path, memberEntitlementsMount.router);
  app.route('/api/admin/program-grants', programGrantsRouter);
  app.route('/api/learning', learningPrograms);
  app.route('/api/spinout-lab', spinoutLab);
  async function call(who: number, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: who, jti: `s-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json, cacheControl: res.headers.get('cache-control') };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  const one = (sql: string, ...a: any[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const all = (sql: string, ...a: any[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  return { db, env, app, call, one, all };
}

const prog = (read: { programs: any[] }, key: string) => read.programs.find((p) => p.program_key === key);
const grantRow = (db: DatabaseSync, uid: string, user: number, key: string, state = 'granted') =>
  db.prepare(`INSERT INTO user_program_grants (uid, user_id, program_key, state) VALUES (?, ?, ?, ?)`).run(uid, user, key, state);
const executed = (db: DatabaseSync, uid: string, licence: string, program: string) =>
  db.prepare(`INSERT INTO licence_program_agreements (uid, licence_uid, agreement_kind, slot_key, program_key, template_slug, status, envelope_uuid, created_at, signed_at)
              VALUES (?, ?, 'program_licence', 'program_licence:' || ?, ?, 'program_licence', 'executed', ?, '2026-11-01', '2026-11-02')`).run(uid, licence, program, program, `env-${uid}`);

test('the seed is data: the issue examples are version 1 rules, and the evaluation holds no program or type', async () => {
  const { all } = fixture();
  const seeded = all("SELECT program_key, licence_type, version, eligible, agreement_required, origin FROM program_licence_rules ORDER BY licence_type, program_key");
  assert.equal(seeded.length, 15);
  assert.ok(seeded.every((r) => r.version === 1 && r.origin === 'seed_d5059' && r.eligible === 1));
  const founder = seeded.filter((r) => r.licence_type === 'founder').map((r) => r.program_key).sort();
  assert.deepEqual(founder, ['ai-native-venture', 'learning', 'perks', 'refer-and-earn', 'spinout-lab']);
  assert.deepEqual(seeded.filter((r) => r.licence_type === 'advisor').map((r) => r.program_key).sort(), ['learning', 'mentor-cohorts']);
  // The evaluation with no rules gives nothing, whatever is held: no policy is in code.
  const none = evaluateEntitlements({
    licences: [{ uid: 'x', licence_ref: 'X', licence_type: 'founder', status: 'active', revision: 1, user_id: 1 }],
    rules: [], grants: [], agreements: { state: 'read', rows: [] }, day: DAY, programName: (k) => k,
  });
  assert.deepEqual(none, []);
});

test('a single licence: eligible programs from its type, a grant puts one in force, the source is named', async () => {
  const { db, env } = fixture();
  grantRow(db, 'g1', FOUNDER, 'learning');
  const read = await entitlementsOfAccount(env, FOUNDER, DAY);
  assert.deepEqual(read.programs.map((p: any) => p.program_key), ['spinout-lab', 'ai-native-venture', 'refer-and-earn', 'perks', 'learning']);
  const learning = prog(read, 'learning');
  assert.equal(learning.eligible, true);
  assert.equal(learning.status, 'in_force');
  assert.equal(learning.in_force_via, 'ul_f10');
  assert.deepEqual(learning.sources.map((s: any) => [s.licence_ref, s.licence_type, s.rule.version]), [['UL-FND-0010', 'founder', 1]]);
  const perks = prog(read, 'perks');
  assert.equal(perks.status, 'eligible_not_granted');
  assert.equal(perks.in_force, false);
  assert.deepEqual(perks.blockers.map((b: any) => b.code), ['not_granted']);
  assert.equal(prog(read, 'mentor-cohorts'), undefined, 'a Founder licence makes no account eligible for mentor cohorts');
});

test('multi-licence: the union, each program once with every source, and one grant row', async () => {
  const { db, env, call, all } = fixture();
  const read = await entitlementsOfAccount(env, MULTI, DAY);
  const keys = read.programs.map((p: any) => p.program_key);
  assert.equal(new Set(keys).size, keys.length, 'no program twice');
  assert.deepEqual(keys, ['spinout-lab', 'ai-native-venture', 'mentor-cohorts', 'investor-cohorts', 'referral-partners', 'refer-and-earn', 'perks', 'learning']);
  assert.deepEqual(prog(read, 'learning').sources.map((s: any) => s.licence_type), ['founder', 'investor', 'advisor']);
  // Grant Learning once through the route: one row, whatever the number of sources.
  const g = await call(SUPER, 'POST', `/api/admin/program-entitlements/accounts/${MULTI}/programs/learning`, { action: 'grant', expected_revision: 0, reason: REASON });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.grant.revision, 1);
  const again = await call(SUPER, 'POST', `/api/admin/program-entitlements/accounts/${MULTI}/programs/learning`, { action: 'grant', expected_revision: 0, reason: REASON });
  assert.equal(again.status, 409, 'a second grant is refused, never a duplicate');
  assert.equal(all('SELECT uid FROM user_program_grants WHERE user_id = ?', MULTI).length, 1);
  const ev = all('SELECT action, sources_json FROM user_program_grant_events WHERE user_id = ?', MULTI);
  assert.deepEqual(ev.map((e) => [e.action, JSON.parse(e.sources_json)]), [['grant', ['ul_f11', 'ul_i11', 'ul_a11']]]);
  void db;
});

test('ending one licence removes only what has no other valid source; a suspended licence is no source', async () => {
  const { db, env } = fixture();
  grantRow(db, 'g-learn', MULTI, 'learning');
  grantRow(db, 'g-perks', MULTI, 'perks');
  grantRow(db, 'g-mentor', MULTI, 'mentor-cohorts');
  // Terminate the Advisor licence through D5058's lifecycle.
  await transitionLicence(env, { uid: 'ul_a11', action: 'terminate', expectedRevision: 0, reason: REASON, actorId: SUPER });
  let read = await entitlementsOfAccount(env, MULTI, DAY);
  assert.equal(prog(read, 'learning').status, 'in_force', 'Learning keeps Founder and Investor');
  assert.deepEqual(prog(read, 'learning').sources.map((s: any) => s.licence_type), ['founder', 'investor']);
  const mentor = prog(read, 'mentor-cohorts');
  assert.equal(mentor.eligible, false, 'mentor cohorts had only the Advisor licence');
  assert.equal(mentor.in_force, false);
  assert.equal(mentor.status, 'granted_not_in_force');
  assert.deepEqual(mentor.blockers.map((b: any) => [b.code, b.licence_uid]), [['licence_terminated', 'ul_a11']]);
  assert.equal(mentor.grant.state, 'granted', 'the grant row is not rewritten by a licence change');
  // Suspend the Founder licence: Perks keeps Investor; Refer & Earn (Founder only) loses its source.
  const f = db.prepare('SELECT revision FROM licences WHERE uid = ?').get('ul_f11') as any;
  await transitionLicence(env, { uid: 'ul_f11', action: 'suspend', expectedRevision: f.revision, reason: REASON, actorId: SUPER });
  read = await entitlementsOfAccount(env, MULTI, DAY);
  assert.equal(prog(read, 'perks').in_force, true);
  assert.deepEqual(prog(read, 'perks').sources.map((s: any) => s.licence_uid), ['ul_i11']);
  const refer = prog(read, 'refer-and-earn');
  assert.equal(refer.eligible, false);
  assert.deepEqual(refer.held_not_valid.map((h: any) => [h.licence_uid, h.status]), [['ul_f11', 'suspended']]);
  assert.deepEqual(refer.blockers.map((b: any) => b.code), ['licence_suspended']);
  assert.equal(prog(read, 'learning').in_force, true, 'Learning still has Investor');
});

test('an agreement-required program stays blocked until its agreement is executed on a source licence', async () => {
  const { db, env } = fixture();
  grantRow(db, 'g-spin', FOUNDER, 'spinout-lab');
  let read = await entitlementsOfAccount(env, FOUNDER, DAY);
  let spin = prog(read, 'spinout-lab');
  assert.equal(spin.granted, true);
  assert.equal(spin.in_force, false);
  assert.equal(spin.status, 'granted_not_in_force');
  assert.deepEqual(spin.blockers.map((b: any) => b.code), ['agreement_missing']);
  // Sent, not signed: still blocked.
  db.prepare(`INSERT INTO licence_program_agreements (uid, licence_uid, agreement_kind, slot_key, program_key, template_slug, status, envelope_uuid, created_at)
              VALUES ('a-sent', 'ul_f10', 'program_licence', 'program_licence:spinout-lab', 'spinout-lab', 'program_licence', 'sent', 'env-sent', '2026-11-01')`).run();
  read = await entitlementsOfAccount(env, FOUNDER, DAY);
  spin = prog(read, 'spinout-lab');
  assert.equal(spin.in_force, false);
  assert.deepEqual(spin.blockers.map((b: any) => b.code), ['agreement_awaiting_signature']);
  // An executed agreement on ANOTHER licence does not count.
  executed(db, 'a-other', 'ul_f11', 'spinout-lab');
  assert.equal(prog(await entitlementsOfAccount(env, FOUNDER, DAY), 'spinout-lab').in_force, false);
  executed(db, 'a-exec', 'ul_f10', 'spinout-lab');
  read = await entitlementsOfAccount(env, FOUNDER, DAY);
  spin = prog(read, 'spinout-lab');
  assert.equal(spin.in_force, true);
  assert.equal(spin.sources[0].agreement.agreement_uid, 'a-exec');
  assert.deepEqual(spin.blockers, []);
  // The pure evaluation too: an executed agreement on a licence that is not the source does not count.
  const rule = { uid: 'r', program_key: 'p', licence_type: 'founder', version: 1, eligible: true, agreement_required: true, effective_from: '2026-01-01' } as Rule;
  const pure = evaluateEntitlements({
    licences: [{ uid: 'mine', licence_ref: 'M', licence_type: 'founder', status: 'active', revision: 1, user_id: 1 }], rules: [rule],
    grants: [{ uid: 'g', user_id: 1, program_key: 'p', state: 'granted', revision: 1, created_at: '', updated_at: '' }],
    agreements: { state: 'read', rows: [{ uid: 'a', licence_uid: 'theirs', slot_key: 'program_licence:p', status: 'executed' }] }, day: DAY, programName: (k) => k,
  });
  assert.equal(pure[0].in_force, false);
  assert.deepEqual(pure[0].blockers.map((b) => b.code), ['agreement_missing']);
});

test('agreements that cannot be read are Not recorded or Unreadable, never in force', async () => {
  const { db, env } = fixture();
  grantRow(db, 'g-spin', FOUNDER, 'spinout-lab');
  grantRow(db, 'g-learn', FOUNDER, 'learning');
  executed(db, 'a-exec', 'ul_f10', 'spinout-lab');
  const failing = (message: string) => ({
    ...env,
    DB: { ...env.DB, prepare(sql: string) { if (/FROM licence_program_agreements/.test(sql)) throw new Error(message); return env.DB.prepare(sql); }, batch: env.DB.batch.bind(env.DB) },
  });
  assert.deepEqual(await readAgreements(failing('D1_ERROR: no such table: licence_program_agreements'), ['ul_f10']), { state: 'not_recorded' });
  let read = await entitlementsOfAccount(failing('D1_ERROR: no such table: licence_program_agreements'), FOUNDER, DAY);
  assert.equal(read.agreements, 'not_recorded');
  assert.equal(prog(read, 'spinout-lab').in_force, false);
  assert.deepEqual(prog(read, 'spinout-lab').blockers.map((b: any) => b.code), ['agreement_not_recorded']);
  assert.equal(prog(read, 'learning').in_force, true, 'a program needing no agreement is not held by the agreement store');
  read = await entitlementsOfAccount(failing('D1_ERROR: SQLITE_BUSY'), FOUNDER, DAY);
  assert.deepEqual(prog(read, 'spinout-lab').blockers.map((b: any) => b.code), ['agreement_unreadable']);
});

test('the role string is not the source of truth', async () => {
  const { env } = fixture();
  // role 'investor', no licences row: nothing.
  const roleOnly = await entitlementsOfAccount(env, ROLE_ONLY, DAY);
  assert.deepEqual(roleOnly.licences, []);
  assert.deepEqual(roleOnly.programs, []);
  // role 'admin', an Investor licence row: the Investor programs, from the licence.
  const holder = await entitlementsOfAccount(env, ADMIN_HOLDER, DAY);
  assert.deepEqual(holder.programs.map((p: any) => p.program_key), ['investor-cohorts', 'referral-partners', 'perks', 'learning']);
  assert.ok(holder.programs.every((p: any) => p.sources.every((s: any) => s.licence_uid === 'ul_i13')));
});

test('rule versions: the highest version in effect wins, a later-dated one is scheduled, a withdrawal ends eligibility', async () => {
  const { env, call, all, db } = fixture();
  grantRow(db, 'g-learn', FOUNDER, 'learning');
  const add = (b: Record<string, unknown>, who = SUPER) => call(who, 'POST', '/api/admin/program-entitlements/rules', { reason: REASON, ...b });
  const v2 = await add({ program_key: 'learning', licence_type: 'founder', eligible: true, agreement_required: true, effective_from: '2026-11-15' });
  assert.equal(v2.status, 201, JSON.stringify(v2.body));
  assert.equal(v2.body.rule.version, 2);
  const v3 = await add({ program_key: 'learning', licence_type: 'founder', eligible: false, effective_from: '2099-01-01' });
  assert.equal(v3.body.rule.version, 3);
  const early = await add({ program_key: 'learning', licence_type: 'founder', eligible: true, effective_from: '2026-01-01' });
  assert.equal(early.status, 409, 'a version may not take effect before the one it follows');
  // On 14 Nov version 1 is in force; on 20 Nov version 2 (agreement required); from 2099 version 3 withdraws it.
  let read = await entitlementsOfAccount(env, FOUNDER, '2026-11-14');
  assert.equal(prog(read, 'learning').sources[0].rule.version, 1);
  assert.equal(prog(read, 'learning').in_force, true);
  read = await entitlementsOfAccount(env, FOUNDER, DAY);
  assert.equal(prog(read, 'learning').sources[0].rule.version, 2);
  assert.deepEqual(prog(read, 'learning').blockers.map((b: any) => b.code), ['agreement_missing']);
  read = await entitlementsOfAccount(env, FOUNDER, '2099-01-02');
  assert.equal(prog(read, 'learning').eligible, false);
  assert.deepEqual(prog(read, 'learning').blockers.map((b: any) => b.code), ['no_eligible_licence']);
  const rules = await call(SUPER, 'GET', '/api/admin/program-entitlements/rules');
  const pair = rules.body.items.find((p: any) => p.program_key === 'learning' && p.licence_type === 'founder');
  assert.deepEqual(pair.versions.map((v: any) => v.version), [3, 2, 1]);
  assert.ok(pair.scheduled.map((v: any) => v.version).includes(3), 'the 2099 version is scheduled');
  assert.ok(!pair.scheduled.map((v: any) => v.version).includes(1), 'version 1 is in effect');
  // Append-only.
  assert.throws(() => db.prepare("UPDATE program_licence_rules SET eligible = 0 WHERE version = 1 AND program_key = 'learning' AND licence_type = 'founder'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM program_licence_rules').run(), /append-only/);
  assert.equal(all("SELECT uid FROM program_licence_rules WHERE program_key = 'learning' AND licence_type = 'founder'").length, 3);
  // The pure in-force pick.
  const r = (version: number, effective_from: string) => ({ uid: `r${version}`, program_key: 'p', licence_type: 'founder', version, eligible: true, agreement_required: false, effective_from }) as Rule;
  assert.equal(rulesInForce([r(1, '2026-01-01'), r(2, '2026-06-01')], '2026-05-31').get('p|founder')!.version, 1);
  assert.equal(rulesInForce([r(1, '2026-01-01'), r(2, '2026-06-01')], '2026-06-01').get('p|founder')!.version, 2);
});

test('grant writes: a grant needs a valid source, pause/resume/end move the revision, a stale write is 409', async () => {
  const { db, call, one } = fixture();
  const at = (id: number, p: string) => `/api/admin/program-entitlements/accounts/${id}/programs/${p}`;
  const noSource = await call(SUPER, 'POST', at(FOUNDER, 'mentor-cohorts'), { action: 'grant', expected_revision: 0, reason: REASON });
  assert.equal(noSource.status, 409);
  assert.equal(noSource.body.error, 'not_eligible');
  const g = await call(SUPER, 'POST', at(FOUNDER, 'perks'), { action: 'grant', expected_revision: 0, reason: REASON });
  assert.equal(g.status, 200);
  const p = await call(SUPER, 'POST', at(FOUNDER, 'perks'), { action: 'pause', expected_revision: 1, reason: REASON });
  assert.equal(p.body.grant.state, 'paused');
  assert.equal(p.body.entitlement.status, 'paused');
  const stale = await call(SUPER, 'POST', at(FOUNDER, 'perks'), { action: 'resume', expected_revision: 1, reason: REASON });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'grant_changed');
  const bad = await call(SUPER, 'POST', at(FOUNDER, 'perks'), { action: 'pause', expected_revision: 2, reason: REASON });
  assert.equal(bad.status, 409);
  assert.equal(bad.body.error, 'invalid_transition');
  const e = await call(SUPER, 'POST', at(FOUNDER, 'perks'), { action: 'end', expected_revision: 2, reason: REASON });
  assert.equal(e.body.grant.state, 'ended');
  assert.equal(one('SELECT revision FROM user_program_grants WHERE user_id = ? AND program_key = ?', FOUNDER, 'perks').revision, 3);
  assert.equal(one('SELECT COUNT(*) AS n FROM user_program_grant_events WHERE user_id = ?', FOUNDER).n, 3);
  assert.equal((await call(SUPER, 'POST', at(FOUNDER, 'perks'), { action: 'grant', expected_revision: 3, reason: 'short' })).status, 400);
  assert.throws(() => db.prepare("DELETE FROM user_program_grants").run(), /never deleted/);
});

test('reads are Super Admin; writes take the write bar', async () => {
  const { call } = fixture();
  const reads = ['/api/admin/program-entitlements', '/api/admin/program-entitlements/rules', `/api/admin/program-entitlements/accounts/${FOUNDER}`, '/api/admin/program-entitlements/licences/ul_f10'];
  for (const path of reads) {
    assert.equal((await call(SUPER, 'GET', path)).status, 200, path);
    assert.equal((await call(ADMIN, 'GET', path)).status, 403, `an Admin who is not Super Admin is refused ${path}`);
    assert.equal((await call(FOUNDER, 'GET', path)).status, 403, `a member is refused ${path}`);
  }
  const grant = { action: 'grant', expected_revision: 0, reason: REASON };
  assert.equal((await call(ADMIN, 'POST', `/api/admin/program-entitlements/accounts/${FOUNDER}/programs/perks`, grant)).status, 403);
  const noStep = await call(SUPER_NO_STEP, 'POST', `/api/admin/program-entitlements/accounts/${FOUNDER}/programs/perks`, grant);
  assert.equal(noStep.status, 403, 'a Super Admin without a fresh step-up is refused');
  assert.equal(noStep.body.code, 'step_up_required');
  assert.equal((await call(SUPER_NO_STEP, 'POST', '/api/admin/program-entitlements/rules', { program_key: 'perks', licence_type: 'advisor', eligible: true, effective_from: DAY, reason: REASON })).status, 403);
  assert.equal((await call(SUPER, 'GET', '/api/admin/program-entitlements?licence_type=pilot')).status, 400);
  assert.equal((await call(SUPER, 'GET', '/api/admin/program-entitlements/licences/ul_nope')).status, 404);
});

test('the licence detail and the Program access filter name the source of each entitlement', async () => {
  const { db, call } = fixture();
  grantRow(db, 'g-learn', MULTI, 'learning');
  const detail = await call(SUPER, 'GET', '/api/admin/program-entitlements/licences/ul_a11');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.licence.licence_type, 'advisor');
  assert.deepEqual(detail.body.programs.map((p: any) => p.program_key), ['mentor-cohorts', 'learning']);
  const learning = detail.body.programs.find((p: any) => p.program_key === 'learning');
  assert.equal(learning.source_is_this_licence, true);
  assert.equal(learning.in_force, true);
  assert.deepEqual(detail.body.other_licences.map((l: any) => l.licence_ref), ['UL-FND-0011', 'UL-INV-0011']);
  // Filter by type: the advisor rows only, across holders.
  const adv = await call(SUPER, 'GET', '/api/admin/program-entitlements?licence_type=advisor');
  assert.equal(adv.status, 200);
  assert.deepEqual(adv.body.items.map((i: any) => [i.holder.id, i.program_key]), [[MULTI, 'mentor-cohorts'], [MULTI, 'learning']]);
  // Filter by holder and program.
  const one = await call(SUPER, 'GET', `/api/admin/program-entitlements?holder=user:${FOUNDER}&program=perks`);
  assert.deepEqual(one.body.items.map((i: any) => [i.holder.id, i.program_key, i.sources[0].licence_ref]), [[FOUNDER, 'perks', 'UL-FND-0010']]);
  const inv = await call(SUPER, 'GET', '/api/admin/program-entitlements?licence_type=investor&q=Admin%20Holder');
  assert.deepEqual([...new Set(inv.body.items.map((i: any) => i.holder.id))], [ADMIN_HOLDER]);
});

test('territory program grants are untouched and keep working', async () => {
  const { db, call, all } = fixture();
  db.exec(`INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status) VALUES ('tl_fr', 'AXL-FR-001', 'Axal VC France SAS', 'Axal VC France', 'active')`);
  const tl = db.prepare("SELECT id FROM territory_licences WHERE uid = 'tl_fr'").get() as any;
  db.prepare(`INSERT INTO program_grants (uid, licence_id, program_key, state, requires_signed_schedule, set_at) VALUES ('pg1', ?, 'learning', 'granted', 0, '2026-11-01')`).run(tl.id);
  const before = await call(SUPER, 'GET', '/api/admin/program-grants/licences/tl_fr');
  assert.equal(before.status, 200, JSON.stringify(before.body));
  const rowsBefore = all('SELECT * FROM program_grants');
  // A territory grant of Learning makes no member eligible: ROLE_ONLY holds no licence.
  assert.deepEqual((await call(SUPER, 'GET', `/api/admin/program-entitlements/accounts/${ROLE_ONLY}`)).body.programs, []);
  // User grant writes leave the territory grants and their read exactly as they were.
  assert.equal((await call(SUPER, 'POST', `/api/admin/program-entitlements/accounts/${FOUNDER}/programs/learning`, { action: 'grant', expected_revision: 0, reason: REASON })).status, 200);
  assert.deepEqual(all('SELECT * FROM program_grants'), rowsBefore);
  const after = await call(SUPER, 'GET', '/api/admin/program-grants/licences/tl_fr');
  assert.equal(after.status, 200);
  assert.deepEqual(after.body.grants, before.body.grants);
  // And the territory licence is never read as a user licence source.
  assert.equal((await call(SUPER, 'GET', '/api/admin/program-entitlements/licences/tl_fr')).status, 404);
});

test('members read only their own program access and the public source fields', async () => {
  const { app, db, env, call } = fixture();
  const url = '/api/member/program-entitlements';
  grantRow(db, 'member-learning', FOUNDER, 'learning');
  grantRow(db, 'member-lab', FOUNDER, 'spinout-lab');
  const anonymous = await withThrownResponses(() => app.request(url, {}, env));
  assert.equal(anonymous.status, 401);

  const read = await call(FOUNDER, 'GET', `${url}?user_id=${MULTI}`);
  assert.equal(read.status, 200);
  assert.equal(read.cacheControl, 'private, no-store');
  assert.deepEqual(Object.keys(read.body).sort(), ['licences', 'on', 'programs']);
  assert.deepEqual(read.body.licences, [{
    uid: 'ul_f10', licence_ref: 'UL-FND-0010', licence_type: 'founder',
    licence_type_label: 'Founder', status: 'active', valid_source: true,
  }]);
  const learning = prog(read.body, 'learning');
  assert.equal(learning.in_force, true);
  assert.equal(learning.grant, undefined);
  assert.equal(learning.in_force_via, 'ul_f10');
  assert.deepEqual(learning.sources, [{
    licence_uid: 'ul_f10', licence_ref: 'UL-FND-0010', licence_type: 'founder',
    licence_type_label: 'Founder', status: 'active', agreement: 'not_required', legally_ready: true,
  }]);
  const lab = prog(read.body, 'spinout-lab');
  assert.equal(lab.in_force, false);
  assert.equal(lab.sources[0].agreement, 'missing');
  assert.equal(lab.blockers[0].code, 'agreement_missing');
  assert.equal((await call(FOUNDER, 'GET', `${url}/${MULTI}`)).status, 404);
});

test('opt-in entry checks block a new enrolment and Lab start until the program is in force', async () => {
  const { db, env, call } = fixture();
  const enrol = '/api/learning/programs/course-1/enrol';
  const lab = '/api/spinout-lab/start';
  db.prepare("INSERT INTO learning_programs (uid, name, enrolment, status, created_by) VALUES ('course-1', 'Course', 'open', 'published', ?)").run(SUPER);
  env.PROGRAM_ENTITLEMENT_ENFORCEMENT = 'true';
  assert.equal((await call(FOUNDER, 'POST', enrol)).body.error, 'program_entitlement_required');
  assert.equal((await call(FOUNDER, 'POST', lab)).body.error, 'program_entitlement_required');
  grantRow(db, 'gate-learning', FOUNDER, 'learning');
  grantRow(db, 'gate-lab', FOUNDER, 'spinout-lab');
  assert.equal((await call(FOUNDER, 'POST', lab)).body.error, 'program_entitlement_required', 'Lab still needs the executed agreement');
  assert.equal((await call(FOUNDER, 'POST', enrol)).status, 201);

  executed(db, 'gate-lab-agreement', 'ul_f10', 'spinout-lab');
  const admitted = await call(FOUNDER, 'POST', lab);
  assert.equal(admitted.status, 403, 'the Lab’s own admission check still applies');
  assert.equal(admitted.body.code, 'lab_not_admitted');
});
