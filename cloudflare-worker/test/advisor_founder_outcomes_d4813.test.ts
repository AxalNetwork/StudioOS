/**
 * D4813 (#4813, package 4) — one founder's detail and the cohort's outcomes.
 *
 *   1. `GET /me/cohort/:cycleId/founders/:userId` is gated by the Advisor
 *      licence and an active assignment, and a founder who is not in the
 *      cohort or opted out of this advisor answers the SAME 404, so the
 *      answer never says a hidden founder is enrolled. It returns only the
 *      fields Founders already shows about the person, this advisor's
 *      published guidance and sessions (never another advisor's, never a
 *      draft), and keeps the live week status apart from the Lab's decision.
 *   2. `GET /me/cohort/:cycleId/outcomes` computes each figure from the store
 *      that records it: a read that failed is null (not zero), a read that
 *      stopped at its cap says `truncated`, every figure past the enrolled
 *      count is over visible founders only, and no programme figure is mixed
 *      in.
 *
 * Fixtures come from `schema_baseline.sql`, with 202611091920 (guidance v2)
 * and the D4659 graduates view applied on top.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/advisor_founder_outcomes_d4813.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import advisors from '../src/routes/advisors.ts';
import {
  OUTCOME_ROW_CAP, countMetric, founderActivity, milestoneTimeline, weekCompletion,
} from '../src/services/cohortFounderView.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const NOTICES = read('cloudflare-worker/sql/migrations/367_cohort_advisor_founder_notice.sql');
const V2 = read('cloudflare-worker/sql/migrations/202611091920_cohort_guidance_v2.sql');
const GRAD_VIEW = (read('cloudflare-worker/sql/migrations/202611071800_lab_graduation_venture.sql')
  .match(/CREATE VIEW IF NOT EXISTS spinout_lab_graduates AS[\s\S]*?GROUP BY user_id;/) || [''])[0];
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const AVA = 10; const BEA = 11; const CAL = 12; // advisors: Ava and Bea on CYCLE, Cal on none
const FAY = 20; const FIN = 21; const FLO = 22; const OUT = 23; // founders; OUT is in no cohort
const CYCLE = 1;
const AVA_ROW = 5; const BEA_ROW = 6;

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
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
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * 3_600_000).toISOString();
const strip = (sql: string) => sql.replace(/^\s*--[^\n]*$/gm, '');

function freshDb({ graduates = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cohort_cycles', 'company_week_status', 'advisor_cohort_assignments', 'notifications_inbox',
    'user_settings', 'week_windows', 'cohort_guidance', 'cohort_guidance_acks', 'advisors',
    'advisor_office_hour_slots', 'advisor_bookings', 'spinout_lab_milestones', 'spinout_certificates']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(strip(NOTICES));
  db.exec(strip(V2));
  if (graduates) db.exec(GRAD_VIEW);
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(AVA, 'ava@example.test', 'Ava Advisor', 'advisor');
  u.run(BEA, 'bea@example.test', 'Bea Advisor', 'advisor');
  u.run(CAL, 'cal@example.test', 'Cal Advisor', 'advisor');
  u.run(FAY, 'fay@example.test', 'Fay Founder', 'founder');
  u.run(FIN, 'fin@example.test', 'Fin Founder', 'founder');
  u.run(FLO, 'flo@example.test', 'Flo Founder', 'founder');
  u.run(OUT, 'out@example.test', 'Out Founder', 'founder');
  db.prepare('INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(CYCLE, 2026, 11, iso(-24 * 9), iso(24 * 19), 'active');
  const ww = db.prepare('INSERT INTO week_windows (cohort_cycle_id, week_number, unlock_at, deadline_at) VALUES (?, ?, ?, ?)');
  ww.run(CYCLE, 1, iso(-24 * 9), iso(-24 * 2));
  ww.run(CYCLE, 2, iso(-24 * 2), iso(24 * 5));
  ww.run(CYCLE, 3, iso(24 * 5), iso(24 * 12));
  ww.run(CYCLE, 4, iso(24 * 12), iso(24 * 19));
  const w = db.prepare(`INSERT INTO company_week_status
    (user_id, cohort_cycle_id, week_number, status, deliverables_done, deliverables_required,
     grace_until, grace_reason, decided_at, decided_by, decision_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  w.run(FAY, CYCLE, 1, 'grace', 1, 3, iso(24), 'Illness', null, null, null);
  w.run(FIN, CYCLE, 1, 'failed', 1, 3, null, null, iso(-40), 'admin:7', 'One of three deliverables at the deadline');
  w.run(FLO, CYCLE, 1, 'passed', 3, 3, null, null, iso(-40), 'system', null);
  w.run(FLO, CYCLE, 2, 'pending', 1, 3, null, null, null, null, null);
  const asg = db.prepare(`INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, assigned_at, is_active)
              VALUES (?, ?, ?, ?, 1)`);
  asg.run('asg-ava', AVA, CYCLE, iso(-240));
  asg.run('asg-bea', BEA, CYCLE, iso(-240));
  const adv = db.prepare("INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?, ?, ?, ?, ?)");
  adv.run(AVA_ROW, 'adv-ava', AVA, 'Ava Advisor', 'ava@example.test');
  adv.run(BEA_ROW, 'adv-bea', BEA, 'Bea Advisor', 'bea@example.test');

  // Guidance: Ava's published broadcast, Ava's draft, Fay's question to Ava,
  // Fin's question to Ava, and Bea's broadcast.
  const g = db.prepare(`INSERT INTO cohort_guidance (uid, cohort_cycle_id, advisor_user_id, asked_by_user_id, title, body, week_number, posted_at, is_draft)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  g.run('g-pub', CYCLE, AVA, null, 'Week 1 interviews', 'Talk to five customers.', 1, iso(-100), 0);
  g.run('g-draft', CYCLE, AVA, null, 'Unsent idea', 'Private draft text.', 2, iso(-50), 1);
  g.run('g-fay-q', CYCLE, AVA, FAY, null, 'Should the pricing test include annual plans?', 1, iso(-30), 0);
  g.run('g-fin-q', CYCLE, AVA, FIN, null, 'Fin asks something private.', 1, iso(-20), 0);
  g.run('g-bea', CYCLE, BEA, null, 'Bea note', 'Bea’s own guidance.', 1, iso(-10), 0);
  const gid = (uid: string) => (db.prepare('SELECT id FROM cohort_guidance WHERE uid = ?').get(uid) as any).id;
  db.prepare('INSERT INTO cohort_guidance_acks (guidance_id, founder_user_id, acted_at) VALUES (?, ?, ?)').run(gid('g-pub'), FAY, iso(-90));

  // Sessions: Ava with Fay (completed, in the cycle), Ava with Fay (confirmed,
  // upcoming), Bea with Fay (completed), Ava with Fin (completed).
  const slot = db.prepare('INSERT INTO advisor_office_hour_slots (uid, advisor_id, starts_at, ends_at, is_cancelled) VALUES (?, ?, ?, ?, 0)');
  const book = db.prepare(`INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, topic, notes, status, created_at, amount_cents)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const s1 = slot.run('s1', AVA_ROW, iso(-48), iso(-47));
  book.run('b-ava-fay-1', Number(s1.lastInsertRowid), AVA_ROW, FAY, 'Interview review', 'PRIVATE NOTE', 'completed', iso(-72), 15000);
  const s2 = slot.run('s2', AVA_ROW, iso(48), iso(49));
  book.run('b-ava-fay-2', Number(s2.lastInsertRowid), AVA_ROW, FAY, 'Pricing', null, 'confirmed', iso(-5), null);
  const s3 = slot.run('s3', BEA_ROW, iso(-24), iso(-23));
  book.run('b-bea-fay', Number(s3.lastInsertRowid), BEA_ROW, FAY, 'Bea session', null, 'completed', iso(-26), null);
  const s4 = slot.run('s4', AVA_ROW, iso(-36), iso(-35));
  book.run('b-ava-fin', Number(s4.lastInsertRowid), AVA_ROW, FIN, 'Fin session', null, 'completed', iso(-40), null);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);

async function call(db: InstanceType<typeof DatabaseSync>, path: string, as = AVA) {
  const role = as >= 20 ? 'founder' : 'advisor';
  const tok = await new SignJWT({ user_id: as, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await advisors.request(path, { headers: { Authorization: `Bearer ${tok}` } }, env(db),
    { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const detail = (db: any, founder: number | string, as = AVA) => call(db, `/me/cohort/${CYCLE}/founders/${founder}`, as);
const outcomes = (db: any, as = AVA) => call(db, `/me/cohort/${CYCLE}/outcomes`, as);
const optOut = (db: any, founder: number, advisor = AVA) =>
  db.prepare('INSERT INTO cohort_advisor_optouts (founder_user_id, advisor_user_id) VALUES (?, ?)').run(founder, advisor);

// ── 1. Founder detail: the gate ─────────────────────────────────────────────

test('D4813: founder detail needs the Advisor licence and an active assignment', async () => {
  const db = freshDb();
  assert.equal((await detail(db, FAY)).status, 200);
  assert.equal((await detail(db, FAY, CAL)).status, 403, 'an advisor not assigned to the cohort is refused');
  assert.equal((await detail(db, FAY, FIN)).status, 403, 'a founder cannot open another founder');
  db.prepare("UPDATE advisor_cohort_assignments SET is_active = 0 WHERE uid = 'asg-ava'").run();
  assert.equal((await detail(db, FAY)).status, 403, 'access that ended is refused at read time');
});

test('D4813: a founder hidden from the advisor, or not in the cohort, is the same 404', async () => {
  const db = freshDb();
  optOut(db, FIN);
  const hidden = await detail(db, FIN);
  const absent = await detail(db, OUT);
  const nobody = await detail(db, 99999);
  assert.equal(hidden.status, 404, 'Fin opted out of Ava');
  assert.equal(absent.status, 404, 'Out is in no cohort');
  assert.deepEqual(hidden.body, absent.body, 'the refusal never says that a hidden founder is enrolled');
  assert.deepEqual(hidden.body, nobody.body);
  assert.equal(hidden.body.error, 'cohort_founder_not_visible');
  assert.ok(!JSON.stringify(hidden.body).includes('Fin'), 'nothing about Fin leaks');
  assert.equal((await detail(db, FIN, BEA)).status, 200, 'Fin opted out of Ava only; Bea still sees them');
  assert.equal((await detail(db, 'abc')).status, 400);
  assert.equal((await detail(db, 0)).status, 400);
});

test('D4813: founder detail returns only advisor-visible fields', async () => {
  const db = freshDb();
  const r = await detail(db, FAY);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.founder).sort(), ['email', 'name', 'user_id'], 'what Founders already shows, nothing more');
  assert.deepEqual(r.body.evidence, { items_recorded: false }, 'the Lab stores counts, not items');
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes('Private draft text'), 'a draft never reached the founder and is not shown');
  assert.ok(!text.includes('Fin asks something private'), 'another founder’s question is not shown');
  assert.ok(!text.includes('Bea'), 'another advisor’s guidance and sessions are not shown');
  assert.ok(!text.includes('PRIVATE NOTE') && !text.includes('15000'), 'booking notes and price are not read');
  assert.ok(!text.includes('decided_by') && !text.includes('admin:7'), 'who at the Lab decided is not the advisor’s');
  assert.deepEqual(r.body.guidance.items.map((g: any) => g.uid).sort(), ['g-fay-q', 'g-pub']);
  assert.equal(r.body.guidance.items.find((g: any) => g.uid === 'g-pub').acted_at != null, true);
  assert.deepEqual(r.body.sessions.items.map((s: any) => s.uid).sort(), ['b-ava-fay-1', 'b-ava-fay-2']);
  for (const s of r.body.sessions.items) assert.deepEqual(Object.keys(s).sort(), ['ends_at', 'starts_at', 'status', 'topic', 'uid']);
});

test('D4813: the live status and the Lab’s recorded decision stay distinct', async () => {
  const db = freshDb();
  const fin = (await detail(db, FIN)).body.milestones;
  assert.equal(fin.available, true);
  assert.equal(fin.snapshots_recorded, false, 'a deadline snapshot is not stored, and is not invented');
  assert.deepEqual(fin.weeks.map((w: any) => w.week_number), [1, 2, 3, 4]);
  const w1 = fin.weeks[0];
  assert.deepEqual(w1.live, { status: 'failed', deliverables_done: 1, deliverables_required: 3 });
  assert.equal(w1.recorded.decision_reason, 'One of three deliverables at the deadline');
  assert.ok(w1.recorded.decided_at);
  assert.equal(fin.weeks[1].live, null, 'no row for week 2 is no status, not pending');
  const flo = (await detail(db, FLO)).body.milestones;
  assert.equal(flo.weeks[1].live.status, 'pending');
  assert.equal(flo.weeks[1].recorded, null, 'an undecided week has no recorded decision');
  const fay = (await detail(db, FAY)).body.milestones;
  assert.equal(fay.weeks[0].recorded.grace_reason, 'Illness');
  assert.equal(fay.weeks[0].recorded.decided_at, null, 'grace is recorded; a decision is not');
});

test('D4813: activity is recorded actions only, newest first', async () => {
  const db = freshDb();
  const a = (await detail(db, FAY)).body.activity;
  assert.deepEqual(a.recorded_kinds, ['question_asked', 'guidance_acted_on', 'session_booked']);
  assert.deepEqual(a.items.map((i: any) => i.kind), ['session_booked', 'question_asked', 'session_booked', 'guidance_acted_on']);
  assert.equal(a.complete, true);
  assert.ok(!a.items.some((i: any) => i.ref === 'booking:b-bea-fay'), 'a session with another advisor is not this advisor’s record');
});

test('D4813: the timeline and activity rules, without a database', () => {
  const weeks = milestoneTimeline([{ week_number: 2, unlock_at: 'u', deadline_at: 'd' }], [
    { week_number: 1, status: 'weird', deliverables_done: -1, deliverables_required: 3, grace_until: null, grace_reason: null, decided_at: null, decision_reason: null },
  ]);
  assert.deepEqual(weeks.map((w) => w.week_number), [1, 2]);
  assert.deepEqual(weeks[0].live, { status: null, deliverables_done: null, deliverables_required: 3 }, 'an unreadable count is null, never 0');
  const act = founderActivity({ questions: [{ uid: 'q', posted_at: null, answered_at: null }], actions: [], bookings: [] });
  assert.deepEqual(act.items, [], 'an undated action is not placed on the timeline');
});

// ── 2. Outcomes ─────────────────────────────────────────────────────────────

test('D4813: outcomes are computed from the stores that record them', async () => {
  const db = freshDb();
  // Flo graduates by D4659's rule: every required deliverable and one of week 3's pair.
  const m = db.prepare('INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (?, ?, ?, ?)');
  for (const k of ['project_created', 'customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3',
    'okrs_created', 'brand_basics_filled', 'pitch_deck_drafted', 'scoring_run_completed', 'incorporation_completed', 'advisor_meeting_booked']) {
    m.run(FLO, 1, k, iso(-5));
  }
  const r = await outcomes(db);
  assert.equal(r.status, 200);
  assert.equal(r.body.scope, 'cohort');
  assert.ok(r.body.reported_at);
  const { participants, week_completion: wc, graduates, sessions } = r.body.metrics;
  assert.equal(participants.value, 3);
  assert.equal(participants.visible.value, 3);
  assert.equal(participants.truncated, false);
  assert.deepEqual(wc.weeks[0], { week_number: 1, passed: 1, grace: 1, failed: 1, pending: 0, not_assessed: 0, founders: 3 });
  assert.deepEqual(wc.weeks[1], { week_number: 2, passed: 0, grace: 0, failed: 0, pending: 1, not_assessed: 2, founders: 3 });
  assert.equal(wc.weeks[3].not_assessed, 3, 'a week nobody has a row for is not assessed, not failed');
  assert.equal(graduates.value, 1);
  assert.equal(sessions.value, 2, 'Ava held two sessions with cohort founders; Bea’s is not hers');
  assert.equal(sessions.booked.value, 1);
  for (const k of ['participants', 'week_completion', 'graduates', 'sessions']) {
    assert.ok(r.body.metrics[k].definition, `${k} has a definition`);
    assert.ok(r.body.metrics[k].source, `${k} names its source`);
  }
});

test('D4813: outcomes count only founders visible to the advisor, past the enrolled count', async () => {
  const db = freshDb();
  optOut(db, FIN);
  const { participants, week_completion: wc, sessions } = (await outcomes(db)).body.metrics;
  assert.equal(participants.value, 3, 'enrolled is the whole cohort');
  assert.equal(participants.visible.value, 2);
  assert.equal(wc.weeks[0].failed, 0, 'Fin’s failed week cannot be recovered by subtracting the board');
  assert.equal(wc.weeks[0].founders, 2);
  assert.equal(sessions.value, 1, 'the session with Fin is not counted for Ava');
});

test('D4813: unknown is not zero — a store that cannot be read is null', async () => {
  const db = freshDb({ graduates: false });
  const { graduates, sessions } = (await outcomes(db)).body.metrics;
  assert.equal(graduates.value, null, 'no graduates view: not recorded, not 0');
  assert.equal(graduates.available, false);
  assert.equal(sessions.available, true);
  const none = freshDb();
  db.close();
  assert.equal((await outcomes(none)).body.metrics.graduates.value, 0, 'a read that worked and found none is 0');
  none.exec('DROP TABLE advisor_bookings');
  const s = (await outcomes(none)).body.metrics.sessions;
  assert.equal(s.value, null);
  assert.equal(s.booked.value, null);
  assert.deepEqual(countMetric(null), { value: null, available: false, truncated: false });
});

test('D4813: a read that stopped at its cap says so', async () => {
  const db = freshDb();
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  const w = db.prepare(`INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status) VALUES (?, ?, 1, 'pending')`);
  for (let i = 0; i < OUTCOME_ROW_CAP + 5; i += 1) { u.run(1000 + i, `f${i}@example.test`, `F${i}`, 'founder'); w.run(1000 + i, CYCLE); }
  const { participants, week_completion: wc, graduates } = (await outcomes(db)).body.metrics;
  assert.equal(participants.value, OUTCOME_ROW_CAP);
  assert.equal(participants.truncated, true, 'the cap is where the read stopped, not how many founders there are');
  assert.equal(participants.visible.truncated, true);
  assert.equal(wc.truncated, true, 'a breakdown over a capped roster is capped too');
  assert.equal(graduates.truncated, true);
});

test('D4813: cohort outcomes carry no programme figure, and are gated like every cohort read', async () => {
  const db = freshDb();
  const r = await outcomes(db);
  const text = JSON.stringify(r.body);
  for (const k of ['companies', 'total_raised', 'programme']) assert.ok(!text.includes(`"${k}"`), `${k} belongs to the programme block`);
  assert.equal((await outcomes(db, CAL)).status, 403);
  assert.equal((await outcomes(db, FAY)).status, 403);
  assert.equal((await call(db, '/me/cohort/abc/outcomes')).status, 400);
});

test('D4813: week completion, without a database', () => {
  const weeks = weekCompletion([{ week_number: 1, unlock_at: null, deadline_at: null }],
    [{ user_id: 1, week_number: 1, status: 'passed' }, { user_id: 2, week_number: 1, status: 'archived' }, { user_id: 3, week_number: 1, status: 'failed' }],
    [1, 2]);
  assert.deepEqual(weeks, [{ week_number: 1, passed: 1, grace: 0, failed: 0, pending: 0, not_assessed: 1, founders: 2 }],
    'a status the Lab does not use is not assessed, and a hidden founder is not counted');
});
