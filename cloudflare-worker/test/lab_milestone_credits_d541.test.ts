/**
 * D541 — Spin-Out Lab milestones pay credits through D540's grant service.
 *
 * The real routers (`routes/spinout_lab.ts`, `routes/spinout_certificates.ts`)
 * run over node:sqlite. The Lab and certificate tables come from
 * `schema_baseline.sql`; the ledger is the baseline's plus migration 381, so
 * the rules and amounts are the shipped ones. What is pinned:
 *
 *   - a milestone pays once, however often it is recorded;
 *   - only an accepted cohort member is paid; a milestone with no rule pays
 *     nothing; the advisor / co-founder pair pays the first one only;
 *   - the graduation bonus is paid once, when the certificate is issued, and
 *     only after the graduation milestone itself was paid;
 *   - `/state` serves each milestone's amount and whether it was earned, and
 *     a read that fails is said.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_milestone_credits_d541.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import spinoutLab from '../src/routes/spinout_lab.ts';
import certificates from '../src/routes/spinout_certificates.ts';
import { creditLabMilestone, creditLabGraduation, backfillLabCredits } from '../src/services/labMilestoneCredits.ts';
import creditRules from '../src/routes/admin_credit_rules.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MEMBER = 101, OUTSIDER = 102, GRAD = 103, OLD_GRAD = 104, ADMIN = 900;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG381 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/381_credit_reward_rules.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb({ rules = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'spinout_lab_milestones', 'activity_logs', 'spinout_applications', 'projects',
    'user_spinout_flags', 'spinout_certificates', 'perk_credit_ledger']) db.exec(ddl(t));
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_perk_ledger_idem ON perk_credit_ledger(user_id, kind, source_ref);
           CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT);`);
  if (rules) db.exec(MIG381);
  else db.exec('ALTER TABLE perk_credit_ledger ADD COLUMN rule_key TEXT');
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, spinout_lab_active, spinout_lab_week) VALUES (?, ?, ?, ?, 1, ?, ?)`);
  u.run(MEMBER, 'founder', 'Ada Member', 'ada@example.test', 1, 4);
  u.run(OUTSIDER, 'founder', 'Bo Outsider', 'bo@example.test', 1, 4);
  u.run(GRAD, 'founder', 'Cy Graduate', 'cy@example.test', 0, 4);
  u.run(OLD_GRAD, 'founder', 'Di Before', 'di@example.test', 0, 4);
  u.run(ADMIN, 'admin', 'Admin One', 'admin@example.test', 0, 1);
  const f = db.prepare(`INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, ?, 'Cohort 4')`);
  f.run(MEMBER, 1); f.run(GRAD, 1); f.run(OLD_GRAD, 1); f.run(OUTSIDER, 0);
  const m = db.prepare(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (?, ?, ?, ?)`);
  m.run(GRAD, 4, 'incorporation_completed', '2026-10-04 09:00:00');
  m.run(OLD_GRAD, 4, 'incorporation_completed', '2026-08-01 09:00:00');
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}
const envOf = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) }) as any;

async function call(router: any, db: InstanceType<typeof DatabaseSync>, method: string, path: string, who: number, body?: unknown) {
  const role = who === ADMIN ? 'admin' : 'founder';
  const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await router.request(path, init, envOf(db));
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const record = (db: any, who: number, key: string) => call(spinoutLab, db, 'POST', '/milestone', who, { milestone_key: key });
const grants = (db: any, who: number) =>
  db.prepare(`SELECT delta, source_ref, rule_key FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' ORDER BY id`).all(who).map((x: any) => ({ ...x }));
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, l = console.log; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};

test('an accepted member is paid for a milestone once, however often it is recorded', async () => {
  const db = freshDb();
  const a = await quiet(() => record(db, MEMBER, 'okrs_created'));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.milestone_credit.status, 'granted');
  assert.equal(a.body.milestone_credit.credits, 50);
  const b = await quiet(() => record(db, MEMBER, 'okrs_created'));
  assert.equal(b.status, 200);
  assert.equal(b.body.milestone_credit, null, 'recording it again pays nothing');
  assert.deepEqual(grants(db, MEMBER), [{ delta: 50, source_ref: `lab:${MEMBER}:okrs_created`, rule_key: 'lab:okrs_created' }]);
  // A second grant for the same milestone (two racing records) is a no-op.
  const c = await quiet(() => creditLabMilestone(envOf(db), MEMBER, 'okrs_created'));
  assert.equal(c.status, 'already_granted');
  assert.equal(grants(db, MEMBER).length, 1);
});

test('someone who is not an accepted member records the milestone and is paid nothing', async () => {
  const db = freshDb();
  const r = await quiet(() => record(db, OUTSIDER, 'pitch_deck_drafted'));
  assert.equal(r.status, 200);
  assert.ok(r.body.milestones.some((m: any) => m.key === 'pitch_deck_drafted'), 'the milestone itself is recorded');
  assert.deepEqual(r.body.milestone_credit, { status: 'skipped', reason: 'not_accepted' });
  assert.deepEqual(grants(db, OUTSIDER), []);
  db.prepare('DELETE FROM user_spinout_flags WHERE user_id = ?').run(OUTSIDER);
  assert.equal((await quiet(() => creditLabMilestone(envOf(db), OUTSIDER, 'okrs_created')) as any).reason, 'not_accepted', 'no flag row is not accepted');
});

test('a milestone with no rule pays nothing; an optional one pays its 10', async () => {
  const db = freshDb();
  const w1 = await quiet(() => record(db, MEMBER, 'project_created'));
  assert.deepEqual(w1.body.milestone_credit, { status: 'skipped', reason: 'no_rule' });
  const opt = await quiet(() => record(db, MEMBER, 'mvp_scoped'));
  assert.equal(opt.body.milestone_credit.credits, 10);
  assert.deepEqual(grants(db, MEMBER).map((g: any) => g.source_ref), [`lab:${MEMBER}:mvp_scoped`]);
});

test('the advisor / co-founder pair pays the first one recorded, not both', async () => {
  const db = freshDb();
  const first = await quiet(() => record(db, MEMBER, 'cofounder_request_sent'));
  assert.equal(first.body.milestone_credit.status, 'granted');
  const second = await quiet(() => record(db, MEMBER, 'advisor_meeting_booked'));
  assert.deepEqual(second.body.milestone_credit, { status: 'skipped', reason: 'pair_already_paid' });
  assert.deepEqual(grants(db, MEMBER).map((g: any) => g.delta), [50]);
});

test('both halves of the pair recorded at once: exactly one grant lands (#1104 follow-up)', async () => {
  const db = freshDb();
  const env = envOf(db);
  const [a, b] = await quiet(() => Promise.all([
    creditLabMilestone(env, MEMBER, 'advisor_meeting_booked'),
    creditLabMilestone(env, MEMBER, 'cofounder_request_sent'),
  ]));
  assert.deepEqual([a.status, b.status].sort(), ['granted', 'skipped']);
  assert.equal((a.status === 'skipped' ? a : b as any).reason, 'pair_already_paid');
  const paidKey = (a.status === 'granted' ? 'advisor_meeting_booked' : 'cofounder_request_sent');
  // One grant, under the paying half's own ref: the shape every version writes
  // and reads, so a rolled-back Worker still sees it.
  const g = grants(db, MEMBER);
  assert.deepEqual(g.map((x: any) => [x.source_ref, x.delta]), [[`lab:${MEMBER}:${paidKey}`, 50]]);
  // The half that paid reads as earned, the other as superseded.
  const r = await quiet(() => call(spinoutLab, db, 'GET', '/state', MEMBER));
  assert.equal(r.body.milestone_credits.milestones[paidKey].earned, true);
  assert.equal(r.body.milestone_credits.milestones[paidKey === 'advisor_meeting_booked' ? 'cofounder_request_sent' : 'advisor_meeting_booked'].superseded, true);
});

test('the half that paid, granted again, reads already_granted; a grant written by any version stops the other half', async () => {
  const db = freshDb();
  const env = envOf(db);
  assert.equal((await quiet(() => creditLabMilestone(env, MEMBER, 'advisor_meeting_booked'))).status, 'granted');
  assert.equal((await quiet(() => creditLabMilestone(env, MEMBER, 'advisor_meeting_booked'))).status, 'already_granted');
  assert.deepEqual(await quiet(() => creditLabMilestone(env, MEMBER, 'cofounder_request_sent')), { status: 'skipped', reason: 'pair_already_paid' });
  // GRAD's half was paid by #1112's code, which wrote the same per-milestone ref.
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, rule_key) VALUES (?, 50, 'grant', ?, 'lab:cofounder_request_sent')`)
    .run(GRAD, `lab:${GRAD}:cofounder_request_sent`);
  assert.deepEqual(await quiet(() => creditLabMilestone(env, GRAD, 'advisor_meeting_booked')), { status: 'skipped', reason: 'pair_already_paid' });
  assert.equal(grants(db, GRAD).length, 1);
  assert.equal(grants(db, MEMBER).length, 1);
});

test('graduation: the certificate issued on the last milestone pays the bonus once', async () => {
  const db = freshDb();
  const r = await quiet(() => record(db, MEMBER, 'incorporation_completed'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.milestone_credit.credits, 400);
  assert.equal(r.body.graduation_credit?.status, 'granted', JSON.stringify(r.body.graduation_credit));
  assert.equal(r.body.graduation_credit.credits, 250);
  // The admin issuing again finds it issued, and nothing more is paid.
  const again = await quiet(() => call(certificates, db, 'POST', '/certificates', ADMIN, { user_id: MEMBER }));
  assert.equal(again.body.outcome, 'already_issued');
  assert.equal(again.body.graduation_credit, null);
  assert.equal((await quiet(() => creditLabGraduation(envOf(db), MEMBER))).status, 'already_granted');
  assert.deepEqual(grants(db, MEMBER).map((g: any) => [g.rule_key, g.delta]), [['lab:incorporation_completed', 400], ['lab:graduation', 250]]);
});

test('graduation: an admin-issued certificate pays only a graduate whose graduation milestone was paid', async () => {
  const db = freshDb();
  // GRAD's milestone was paid after launch; OLD_GRAD's predates it, so the
  // certificate pays nothing now. The cohort backfill pays both later (Q4 B).
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, rule_key) VALUES (?, 400, 'grant', ?, 'lab:incorporation_completed')`)
    .run(GRAD, `lab:${GRAD}:incorporation_completed`);
  const ok = await quiet(() => call(certificates, db, 'POST', '/certificates', ADMIN, { user_id: GRAD }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.graduation_credit.status, 'granted');
  const old = await quiet(() => call(certificates, db, 'POST', '/certificates', ADMIN, { user_id: OLD_GRAD }));
  assert.equal(old.status, 201);
  assert.deepEqual(old.body.graduation_credit, { status: 'skipped', reason: 'graduation_not_paid' });
  assert.deepEqual(grants(db, OLD_GRAD), []);
  // The hand-issued path pays on the same terms.
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, rule_key) VALUES (?, 400, 'grant', ?, 'lab:incorporation_completed')`)
    .run(MEMBER, `lab:${MEMBER}:incorporation_completed`);
  const manual = await quiet(() => call(certificates, db, 'POST', '/certificates', ADMIN,
    { user_id: MEMBER, public_name: 'Ada Member', conferred_at: '2026-10-04' }));
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  assert.equal(manual.body.graduation_credit.status, 'granted');
});

test('/state serves each milestone\'s amount and whether it was earned', async () => {
  const db = freshDb();
  await quiet(() => record(db, MEMBER, 'okrs_created'));
  await quiet(() => record(db, MEMBER, 'advisor_meeting_booked'));
  const r = await quiet(() => call(spinoutLab, db, 'GET', '/state', MEMBER));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mc = r.body.milestone_credits;
  assert.equal(r.body.milestone_credits_unreadable, false);
  assert.equal(mc.eligible, true);
  assert.equal(mc.reason, null);
  assert.deepEqual(mc.milestones.okrs_created, { credits: 50, usd_value_cents: 5000, earned: true, superseded: false });
  assert.deepEqual(mc.milestones.pitch_deck_drafted, { credits: 100, usd_value_cents: 10000, earned: false, superseded: false });
  assert.equal(mc.milestones.advisor_meeting_booked.earned, true);
  assert.equal(mc.milestones.cofounder_request_sent.superseded, true, 'the other half of the pair will not pay');
  assert.equal(mc.milestones.graduation.credits, 250);
  assert.equal(mc.milestones.project_created, undefined);
  const out = await quiet(() => call(spinoutLab, db, 'GET', '/state', OUTSIDER));
  assert.equal(out.body.milestone_credits.eligible, false);
  assert.match(out.body.milestone_credits.reason, /once you are accepted into a cohort/);
  const staff = await quiet(() => call(spinoutLab, db, 'GET', '/state', ADMIN));
  assert.match(staff.body.milestone_credits.reason, /Staff and admin accounts do not earn credits/);
});

test('/state: a credit read that fails is said, never drawn as nothing earned', async () => {
  const db = freshDb({ rules: false });
  const r = await quiet(() => call(spinoutLab, db, 'GET', '/state', MEMBER));
  assert.equal(r.status, 200, 'the Lab still loads');
  assert.equal(r.body.milestone_credits, null);
  assert.equal(r.body.milestone_credits_unreadable, true);
});

test('an admission flag that cannot be read pays nothing; graduation needs acceptance too', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, rule_key) VALUES (?, 400, 'grant', ?, 'lab:incorporation_completed')`)
    .run(OUTSIDER, `lab:${OUTSIDER}:incorporation_completed`);
  assert.deepEqual(await quiet(() => creditLabGraduation(envOf(db), OUTSIDER)), { status: 'skipped', reason: 'not_accepted' });
  db.exec('DROP TABLE user_spinout_flags');
  assert.deepEqual(await quiet(() => creditLabMilestone(envOf(db), MEMBER, 'okrs_created')), { status: 'skipped', reason: 'not_accepted' });
  assert.deepEqual(grants(db, MEMBER), []);
});

test('a certificate that was already issued pays no bonus when the milestone lands later', async () => {
  const db = freshDb();
  const pre = await quiet(() => call(certificates, db, 'POST', '/certificates', ADMIN,
    { user_id: MEMBER, public_name: 'Ada Member', conferred_at: '2026-10-04' }));
  assert.equal(pre.status, 201);
  const r = await quiet(() => record(db, MEMBER, 'incorporation_completed'));
  assert.equal(r.body.milestone_credit.credits, 400);
  assert.equal(r.body.graduation_credit, null, 'issueOnGraduation found it already issued');
  assert.deepEqual(grants(db, MEMBER).map((g: any) => g.rule_key), ['lab:incorporation_completed']);
});

test('/state: a revoked milestone grant is not earned, and an accepted admin still cannot earn', async () => {
  const db = freshDb();
  await quiet(() => record(db, MEMBER, 'okrs_created'));
  const g = db.prepare(`SELECT id FROM perk_credit_ledger WHERE user_id = ? AND source_ref = ?`).get(MEMBER, `lab:${MEMBER}:okrs_created`) as any;
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, note) VALUES (?, -50, 'admin_adjust', ?, 'Recorded in error')`)
    .run(MEMBER, `revoke:${g.id}`);
  const r = await quiet(() => call(spinoutLab, db, 'GET', '/state', MEMBER));
  assert.equal(r.body.milestone_credits.milestones.okrs_created.earned, false);
  db.prepare(`INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, 1, 'Cohort 4')`).run(ADMIN);
  const staff = await quiet(() => call(spinoutLab, db, 'GET', '/state', ADMIN));
  assert.equal(staff.body.milestone_credits.eligible, false);
});

// ───────────────────────────── the cohort backfill (#1102 Q4, A and B) ──

const BACKFILL_REASON = 'Crediting the cohort for milestones done before launch';
const SUPER = 950;

/** OLD_GRAD finished the whole path before launch; MEMBER did part of it, one milestone already paid live. */
function cohortDb() {
  const db = freshDb();
  db.exec(ddl('super_admins')); db.exec(ddl('admin_audit_log'));
  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Super One', 'super@example.test', 1)`).run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const m = db.prepare(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (?, ?, ?, ?)`);
  m.run(OLD_GRAD, 2, 'okrs_created', '2026-07-01 09:00:00');
  m.run(OLD_GRAD, 3, 'cofounder_request_sent', '2026-07-10 09:00:00');
  m.run(OLD_GRAD, 3, 'advisor_meeting_booked', '2026-07-12 09:00:00');
  m.run(OLD_GRAD, 1, 'profile_completed', '2026-06-20 09:00:00');
  m.run(MEMBER, 2, 'brand_basics_filled', '2026-07-02 09:00:00');
  m.run(OUTSIDER, 2, 'okrs_created', '2026-07-03 09:00:00');
  db.prepare(`INSERT INTO spinout_certificates (credential_id, user_id, public_name, public_issued_on) VALUES ('AX-OLD', ?, 'Di Before', '2026-08-02')`).run(OLD_GRAD);
  // A revoked certificate is not a graduation.
  db.prepare(`INSERT INTO spinout_certificates (credential_id, user_id, public_name, public_issued_on, status) VALUES ('AX-REV', ?, 'Ada Member', '2026-08-03', 'revoked')`).run(MEMBER);
  return db;
}
const keysOf = (db: any, who: number) => grants(db, who).map((g: any) => g.rule_key);

test('backfill: the cohort is paid once for what it completed before launch, a second run pays nothing', async () => {
  const db = cohortDb();
  await quiet(() => record(db, MEMBER, 'okrs_created')); // paid live, after launch
  const first = await quiet(() => backfillLabCredits(envOf(db)));
  // OLD_GRAD: okrs 50, co-founder 50 (the earlier half), incorporation 400, graduation 250.
  assert.deepEqual(keysOf(db, OLD_GRAD).sort(),
    ['lab:cofounder_request_sent', 'lab:graduation', 'lab:incorporation_completed', 'lab:okrs_created']);
  assert.deepEqual(keysOf(db, MEMBER).sort(), ['lab:brand_basics_filled', 'lab:okrs_created']);
  assert.deepEqual(keysOf(db, OUTSIDER), [], 'not an accepted member');
  assert.equal(first.granted, 6);
  assert.equal(first.credits, 50 + 50 + 400 + 250 + 50 + 400);
  assert.equal(first.graduations, 1);
  assert.equal(first.already_paid, 1, 'the milestone paid live is not paid again');
  assert.deepEqual(first.skipped, { no_rule: 1, pair_already_paid: 1 });
  assert.equal(first.failed, 0);
  assert.equal(first.members, 3, 'GRAD, MEMBER and OLD_GRAD are accepted');
  assert.equal(first.next_after, null);

  const before = (db.prepare(`SELECT COUNT(*) AS n FROM perk_credit_ledger`).get() as any).n;
  const second = await quiet(() => backfillLabCredits(envOf(db)));
  assert.equal(second.granted, 0);
  assert.equal(second.credits, 0);
  assert.equal(second.graduations, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM perk_credit_ledger`).get() as any).n, before, 'a second run wrote a ledger row');
});

test('backfill: a revoked grant stays revoked, and a member walk is paged', async () => {
  const db = cohortDb();
  await quiet(() => creditLabMilestone(envOf(db), MEMBER, 'brand_basics_filled'));
  const g = db.prepare(`SELECT id FROM perk_credit_ledger WHERE user_id = ? AND source_ref = ?`).get(MEMBER, `lab:${MEMBER}:brand_basics_filled`) as any;
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, note) VALUES (?, -50, 'admin_adjust', ?, 'Recorded in error')`)
    .run(MEMBER, `revoke:${g.id}`);
  const one = await quiet(() => backfillLabCredits(envOf(db), { limit: 1 }));
  assert.equal(one.members, 1);
  assert.equal(one.next_after, MEMBER, 'members are walked in id order');
  assert.equal(one.already_paid, 1, 'the revoked grant is not paid again');
  assert.deepEqual(keysOf(db, MEMBER), ['lab:brand_basics_filled']);
  const two = await quiet(() => backfillLabCredits(envOf(db), { after: one.next_after!, limit: 1 }));
  assert.equal(two.next_after, GRAD);
  const three = await quiet(() => backfillLabCredits(envOf(db), { after: two.next_after!, limit: 1 }));
  assert.equal(three.next_after, null, 'OLD_GRAD is the last accepted member');
  assert.ok(keysOf(db, OLD_GRAD).includes('lab:graduation'));
});

test('backfill: a member list that cannot be read is an error, never "nobody to pay"', async () => {
  const db = cohortDb();
  db.exec('DROP TABLE user_spinout_flags');
  await assert.rejects(() => quiet(() => backfillLabCredits(envOf(db))));
});

test('backfill: a grant that fails is counted as failed, and the walk goes on', async () => {
  const db = cohortDb();
  db.exec('DROP TABLE credit_reward_rules');
  const r = await quiet(() => backfillLabCredits(envOf(db)));
  assert.equal(r.members, 3);
  assert.equal(r.granted, 0);
  assert.equal(r.milestones, 7);
  assert.equal(r.failed, 7, 'every milestone grant failed and each was counted');
  // OLD_GRAD's certificate then pays nothing: its incorporation grant failed.
  assert.deepEqual(r.skipped, { graduation_not_paid: 1 }, 'a failure was reported as a skip');
});

test('POST /lab-backfill: the Super Admin\'s, with a reason, recorded in the audit log', async () => {
  const db = cohortDb();
  const asAdmin = await quiet(() => call(creditRules, db, 'POST', '/lab-backfill', ADMIN, { reason: BACKFILL_REASON }));
  assert.equal(asAdmin.status, 403, 'a plain admin ran the backfill');
  const asFounder = await quiet(() => call(creditRules, db, 'POST', '/lab-backfill', MEMBER, { reason: BACKFILL_REASON }));
  assert.equal(asFounder.status, 403);
  const short = await quiet(() => call(creditRules, db, 'POST', '/lab-backfill', SUPER, { reason: 'now' }));
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'reason_too_short');
  assert.deepEqual(keysOf(db, OLD_GRAD), [], 'a refused call paid something');
  const ok = await quiet(() => call(creditRules, db, 'POST', '/lab-backfill?limit=8', SUPER, { reason: BACKFILL_REASON }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.granted, 6);
  assert.equal(ok.body.next_after, null);
  const audit = db.prepare(`SELECT admin_user_id AS user_id, action, filters_json AS details FROM admin_audit_log WHERE action = 'credit_lab_backfill'`).all() as any[];
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, SUPER);
  assert.match(String(audit[0].details), new RegExp(BACKFILL_REASON));
  assert.match(String(audit[0].details), /"granted":6/);
  const paged = await quiet(() => call(creditRules, db, 'POST', '/lab-backfill?limit=1&after=' + MEMBER, SUPER, { reason: BACKFILL_REASON }));
  assert.equal(paged.body.members, 1);
  assert.equal(paged.body.next_after, GRAD);
});
