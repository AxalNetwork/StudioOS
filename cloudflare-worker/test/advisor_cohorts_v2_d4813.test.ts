/**
 * D4813 (#4813, package 1) — the three reads the Cohorts command centre leans on.
 *
 *   1. `/weeks` carries the Lab's decision record per week (grace_until,
 *      grace_reason, decided_at, decision_reason), so the Founders board can say
 *      why a founder is in grace or failed, and until when.
 *   2. `/founders` and `/guidance` say when their read stopped at its cap
 *      (`truncated`), so a capped list is never shown as a total.
 *   3. `/calendar` reads bookings from now on in SQL. It used to take the first
 *      200 bookings ever, oldest first, and only then keep the next 14 days, so
 *      an advisor with 200 past sessions saw no upcoming one at all.
 *
 * Fixtures come from `schema_baseline.sql`, the shape production runs.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/advisor_cohorts_v2_d4813.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import advisors from '../src/routes/advisors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const NOTICES = read('cloudflare-worker/sql/migrations/367_cohort_advisor_founder_notice.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const AVA = 10; // advisor, assigned to CYCLE
const FAY = 20; const FIN = 21; const FLO = 22; // founders in CYCLE
const CYCLE = 1;
const ADVISOR_ROW = 5;

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
// D1 treats `?1` as one parameter however often it appears; node:sqlite does
// not, so each occurrence becomes its own `?` carrying the same value.
function q(sql: string, binds: any[]) {
  const values: any[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_m, n) => { values.push(binds[Number(n) - 1]); return '?'; });
  return values.length ? { sql: rewritten, values } : { sql, values: binds };
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const x = q(sql, b); return db.prepare(x.sql).get(...x.values) ?? null; },
        async all() { const x = q(sql, b); return { results: db.prepare(x.sql).all(...x.values) }; },
        async run() {
          const x = q(sql, b);
          const r = db.prepare(x.sql).run(...x.values);
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

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cohort_cycles', 'company_week_status', 'advisor_cohort_assignments', 'notifications_inbox',
    'user_settings', 'week_windows', 'cohort_guidance', 'cohort_guidance_acks', 'advisors',
    'advisor_office_hour_slots', 'advisor_bookings']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(NOTICES.replace(/^\s*--[^\n]*$/gm, ''));
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(AVA, 'ava@example.test', 'Ava Advisor', 'advisor');
  u.run(FAY, 'fay@example.test', 'Fay Founder', 'founder');
  u.run(FIN, 'fin@example.test', 'Fin Founder', 'founder');
  u.run(FLO, 'flo@example.test', 'Flo Founder', 'founder');
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
  w.run(FIN, CYCLE, 1, 'failed', 1, 3, null, null, iso(-40), 'system', 'One of three deliverables at the deadline');
  w.run(FLO, CYCLE, 1, 'passed', 3, 3, null, null, iso(-40), 'system', null);
  w.run(FLO, CYCLE, 2, 'pending', 1, 3, null, null, null, null, null);
  db.prepare(`INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, assigned_at, is_active)
              VALUES ('asg-ava', ?, ?, ?, 1)`).run(AVA, CYCLE, iso(-24 * 10));
  db.prepare("INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?, 'adv-ava', ?, 'Ava Advisor', 'ava@example.test')")
    .run(ADVISOR_ROW, AVA);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);

async function call(db: InstanceType<typeof DatabaseSync>, path: string) {
  const tok = await new SignJWT({ user_id: AVA, role: 'advisor' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await advisors.request(path, { headers: { Authorization: `Bearer ${tok}` } }, env(db), {
    waitUntil() {}, passThroughOnException() {},
  } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('D4813: the weeks read carries the Lab’s decision record for each week', async () => {
  const db = freshDb();
  const r = await call(db, `/me/cohort/${CYCLE}/weeks`);
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.current_week, 2);
  const by = Object.fromEntries(r.body.founders.map((f: any) => [f.user_id, f]));
  assert.equal(by[FAY].weeks['1'].status, 'grace');
  assert.ok(by[FAY].weeks['1'].grace_until, 'until when');
  assert.equal(by[FAY].weeks['1'].grace_reason, 'Illness');
  assert.equal(by[FIN].weeks['1'].decision_reason, 'One of three deliverables at the deadline');
  assert.ok(by[FIN].weeks['1'].decided_at);
  assert.equal(by[FLO].weeks['2'].decided_at, null, 'an undecided week has no decision, not a made-up one');
  assert.ok(!('decided_by' in by[FIN].weeks['1']), 'who decided (an admin id) is the Lab’s, not the advisor’s');
});

test('D4813: the weeks read still hides a founder who opted out, decision record and all', async () => {
  const db = freshDb();
  db.prepare('INSERT INTO cohort_advisor_optouts (founder_user_id, advisor_user_id) VALUES (?, ?)').run(FIN, AVA);
  const r = await call(db, `/me/cohort/${CYCLE}/weeks`);
  assert.ok(!r.body.founders.some((f: any) => f.user_id === FIN), 'Fin opted out of Ava');
  assert.ok(!JSON.stringify(r.body).includes('One of three deliverables'), 'and Fin’s decision reason goes with them');
  const founders = await call(db, `/me/cohort/${CYCLE}/founders`);
  assert.deepEqual(
    r.body.founders.map((f: any) => f.user_id).sort(),
    founders.body.items.map((f: any) => f.user_id).sort(),
  );
});

test('D4813: founders and guidance say whether their read stopped at the cap', async () => {
  const db = freshDb();
  const f = await call(db, `/me/cohort/${CYCLE}/founders`);
  assert.equal(f.status, 200);
  assert.equal(f.body.truncated, false);
  const g = await call(db, `/me/cohort/${CYCLE}/guidance`);
  assert.equal(g.status, 200);
  assert.equal(g.body.truncated, false);

  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  const w = db.prepare(`INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status) VALUES (?, ?, 1, 'pending')`);
  for (let i = 0; i < 205; i += 1) { u.run(1000 + i, `f${i}@example.test`, `Founder ${String(i).padStart(3, '0')}`, 'founder'); w.run(1000 + i, CYCLE); }
  const capped = await call(db, `/me/cohort/${CYCLE}/founders`);
  assert.equal(capped.body.items.length, 200);
  assert.equal(capped.body.truncated, true, '200 is where the read stopped, not how many founders there are');

  const gq = db.prepare(`INSERT INTO cohort_guidance (uid, cohort_cycle_id, advisor_user_id, body) VALUES (?, ?, ?, ?)`);
  for (let i = 0; i < 200; i += 1) gq.run(`g-${i}`, CYCLE, AVA, `Note ${i}`);
  assert.equal((await call(db, `/me/cohort/${CYCLE}/guidance`)).body.truncated, true);
});

test('D4813: past bookings no longer spend the calendar’s cap', async () => {
  const db = freshDb();
  const slot = db.prepare(`INSERT INTO advisor_office_hour_slots (uid, advisor_id, starts_at, ends_at, is_cancelled) VALUES (?, ?, ?, ?, 0)`);
  const book = db.prepare(`INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, topic, status) VALUES (?, ?, ?, ?, ?, 'confirmed')`);
  for (let i = 0; i < 210; i += 1) {
    const r = slot.run(`old-${i}`, ADVISOR_ROW, iso(-24 * 30 - i), iso(-24 * 30 - i + 1));
    book.run(`ob-${i}`, Number(r.lastInsertRowid), ADVISOR_ROW, FAY, `Old session ${i}`);
  }
  const s = slot.run('soon', ADVISOR_ROW, iso(30), iso(31));
  book.run('soon-b', Number(s.lastInsertRowid), ADVISOR_ROW, FLO, 'Pricing review');

  const r = await call(db, `/me/cohort/${CYCLE}/calendar`);
  assert.equal(r.status, 200);
  const sessions = r.body.items.filter((i: any) => i.kind === 'client');
  assert.deepEqual(sessions.map((i: any) => i.title), ['Pricing review'],
    'the upcoming session is read even though 210 older ones sort first');
  assert.equal(r.body.sessions_truncated, false);
});
