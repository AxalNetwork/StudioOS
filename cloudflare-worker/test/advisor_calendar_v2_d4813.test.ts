/**
 * D4813 (#4813, package 3) — the cohort calendar read, made trustworthy.
 *
 *   1. A GROUP SESSION IS ONE EVENT. The read joins bookings to slots, so a
 *      slot three founders booked came back three times — three entries, three
 *      "collisions" with itself. Each slot is now one event with its
 *      participants.
 *   2. AN ONGOING SESSION STILL COUNTS. The read kept sessions that START from
 *      now on, so a session already under way vanished, and so did every clash
 *      it was part of. It now keeps what has not ENDED, and a conflict says
 *      which side is in progress.
 *   3. FUTURE FIRST under historical volume still holds (package 1's fix).
 *   4. EXPORT IDENTITY. Each Lab date carries a UID with its cycle id, so week 2
 *      of one cohort is never the same calendar entry as week 2 of another; a
 *      session keeps one UID whichever cohort's calendar exports it.
 *   5. PARTIAL, NOT FAILED. Each half is read on its own; `sources` says which
 *      answered, and the other half is still returned.
 *   6. Assignment gating and founder opt-out are unchanged.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/advisor_calendar_v2_d4813.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

// (Counts of a failed half are null — the #3871 rule, re-aimed in advisor_thinking_3871.test.ts.)
import advisors from '../src/routes/advisors.ts';
import {
  activeOrUpcoming, collapseSessions, collisionDetails, type CalendarItem,
} from '../src/routes/_advisor_cohort_helpers.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const NOTICES = read('cloudflare-worker/sql/migrations/367_cohort_advisor_founder_notice.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const AVA = 10;
const FAY = 20; const FIN = 21; const FLO = 22;
const CYCLE = 1; const CYCLE_B = 2;
const ADVISOR_ROW = 5;

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
function q(sql: string, binds: any[]) {
  const values: any[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_m, n) => { values.push(binds[Number(n) - 1]); return '?'; });
  return values.length ? { sql: rewritten, values } : { sql, values: binds };
}
/** `failOn` makes one read throw, the way a D1 outage on one table would. */
function makeD1(db: InstanceType<typeof DatabaseSync>, failOn?: RegExp) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const boom = () => { if (failOn && failOn.test(sql)) throw new Error('D1_ERROR: simulated outage'); };
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { boom(); const x = q(sql, b); return db.prepare(x.sql).get(...x.values) ?? null; },
        async all() { boom(); const x = q(sql, b); return { results: db.prepare(x.sql).all(...x.values) }; },
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

function freshDb({ windows = true } = {}) {
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
  const cyc = db.prepare('INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status) VALUES (?, ?, ?, ?, ?, ?)');
  cyc.run(CYCLE, 2026, 11, iso(-24 * 9), iso(24 * 19), 'active');
  cyc.run(CYCLE_B, 2026, 12, iso(24 * 21), iso(24 * 49), 'scheduled');
  if (windows) {
    const ww = db.prepare('INSERT INTO week_windows (cohort_cycle_id, week_number, unlock_at, deadline_at) VALUES (?, ?, ?, ?)');
    ww.run(CYCLE, 1, iso(-24 * 9), iso(-24 * 2));
    ww.run(CYCLE, 2, iso(-24 * 2), iso(24 * 5));
    ww.run(CYCLE, 3, iso(24 * 5), iso(24 * 12));
    ww.run(CYCLE, 4, iso(24 * 12), iso(24 * 19));
    ww.run(CYCLE_B, 1, iso(24 * 21), iso(24 * 28));
    ww.run(CYCLE_B, 2, iso(24 * 28), iso(24 * 35));
  }
  db.prepare(`INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status, deliverables_done, deliverables_required)
              VALUES (?, ?, 1, 'passed', 3, 3)`).run(FIN, CYCLE);
  const asg = db.prepare(`INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, assigned_at, is_active)
              VALUES (?, ?, ?, ?, 1)`);
  asg.run('asg-ava', AVA, CYCLE, iso(-24 * 10));
  asg.run('asg-ava-b', AVA, CYCLE_B, iso(-24 * 10));
  db.prepare("INSERT INTO advisors (id, uid, user_id, display_name, email) VALUES (?, 'adv-ava', ?, 'Ava Advisor', 'ava@example.test')")
    .run(ADVISOR_ROW, AVA);
  return db;
}

function addSlot(db: InstanceType<typeof DatabaseSync>, uid: string, from: number, to: number, capacity = 1) {
  const r = db.prepare(`INSERT INTO advisor_office_hour_slots (uid, advisor_id, starts_at, ends_at, capacity, is_cancelled)
                        VALUES (?, ?, ?, ?, ?, 0)`).run(uid, ADVISOR_ROW, iso(from), iso(to), capacity);
  return Number(r.lastInsertRowid);
}
function book(db: InstanceType<typeof DatabaseSync>, slotId: number, founder: number, topic: string | null, status = 'confirmed') {
  db.prepare(`INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, topic, status) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(`b-${slotId}-${founder}`, slotId, ADVISOR_ROW, founder, topic, status);
}

async function call(db: InstanceType<typeof DatabaseSync>, path: string, failOn?: RegExp) {
  const tok = await new SignJWT({ user_id: AVA, role: 'advisor' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, failOn) } as any;
  const res = await advisors.request(path, { headers: { Authorization: `Bearer ${tok}` } }, env, {
    waitUntil() {}, passThroughOnException() {},
  } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const sessionsOf = (list: any[]) => list.filter((i: any) => i.kind === 'client');

// ── 1. Group sessions ─────────────────────────────────────────────────────

test('D4813 p3: a group session three founders booked is ONE event, with its participants', async () => {
  const db = freshDb();
  const g = addSlot(db, 'group', 30, 31, 6);
  book(db, g, FAY, 'Week 2 check-in');
  book(db, g, FIN, null);
  book(db, g, FLO, null, 'pending');
  const r = await call(db, `/me/cohort/${CYCLE}/calendar`);
  assert.equal(r.status, 200);
  for (const list of [r.body.items, r.body.events]) {
    const s = sessionsOf(list);
    assert.equal(s.length, 1, 'one slot, one event');
    assert.equal(s[0].type, 'group_session');
    assert.equal(s[0].title, 'Week 2 check-in');
    assert.deepEqual(s[0].participants.map((p: any) => p.name).sort(), ['Fay Founder', 'Fin Founder', 'Flo Founder']);
    assert.equal(s[0].status, 'pending', 'one booking still pending: the session is not confirmed');
    assert.equal(s[0].capacity, 6);
  }
  assert.equal(r.body.collisions.length, 0, 'a session never collides with itself');
  assert.ok(!JSON.stringify(r.body.events).includes('@example.test'), 'participants are names, never emails');
});

test('D4813 p3: a one-seat slot with one founder is an advisor session; a many-seat slot with one is a group', () => {
  const row = (slot_id: number, capacity: number, founder_name: string) => ({
    slot_id, starts_at: iso(1), ends_at: iso(2), capacity, topic: null, founder_name, status: 'confirmed',
  });
  const [one, open] = collapseSessions([row(1, 1, 'Fay'), row(2, 4, 'Fin')]);
  assert.equal(one.type, 'session');
  assert.equal(one.title, 'Session with Fay');
  assert.equal(open.type, 'group_session');
  assert.equal(open.title, 'Group session · 1 founder');
});

// ── 2. Ongoing conflicts ──────────────────────────────────────────────────

test('D4813 p3: a session already under way stays on the calendar, and still collides', async () => {
  const db = freshDb();
  const live = addSlot(db, 'live', -0.5, 1);
  book(db, live, FAY, 'Pricing review');
  const next = addSlot(db, 'next', 0.5, 1.5);
  book(db, next, FLO, 'Interview debrief');
  const r = await call(db, `/me/cohort/${CYCLE}/calendar`);
  const titles = sessionsOf(r.body.items).map((i: any) => i.title);
  assert.deepEqual(titles, ['Pricing review', 'Interview debrief'], 'the ongoing session is still listed');
  assert.equal(sessionsOf(r.body.items)[0].ongoing, true);
  assert.equal(r.body.collisions.length, 1);
  const c = r.body.collisions[0];
  assert.equal(c.kind, 'sessions_overlap');
  assert.deepEqual(c.ongoing, [`slot:${live}`], 'the explanation knows which side is in progress');
  assert.equal(c.overlap_minutes, 30);
  assert.equal(r.body.counts.collisions, 1);
});

test('D4813 p3: a deadline falling inside an ongoing session is a conflict', () => {
  const now = new Date().toISOString();
  const items: CalendarItem[] = [
    { kind: 'client', title: 'Live', starts_at: iso(-1), ends_at: iso(1), ref: 'slot:1' },
    { kind: 'cohort', title: 'Week 2 deliverables due', starts_at: iso(0.25), ends_at: null, ref: 'week:2:deadline' },
    { kind: 'cohort', title: 'Week 2 opens', starts_at: iso(-0.5), ends_at: null, ref: 'week:2:unlock' },
  ];
  const kept = activeOrUpcoming(items, now, 14);
  assert.deepEqual(kept.map((i) => i.ref), ['slot:1', 'week:2:deadline'], 'a past instant goes; a running session stays');
  const d = collisionDetails(kept, now);
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'instant_in_session');
  assert.deepEqual(d[0].ongoing, ['slot:1']);
  assert.equal(d[0].overlap_minutes, 0);
});

test('D4813 p3: a session that has ended is not ongoing and is not read', async () => {
  const db = freshDb();
  const done = addSlot(db, 'done', -2, -1);
  book(db, done, FAY, 'Already over');
  const r = await call(db, `/me/cohort/${CYCLE}/calendar`);
  assert.equal(sessionsOf(r.body.events).length, 0);
});

// ── 3. Future first ───────────────────────────────────────────────────────

test('D4813 p3: 210 past sessions still do not crowd out an ongoing or upcoming one', async () => {
  const db = freshDb();
  for (let i = 0; i < 210; i += 1) book(db, addSlot(db, `old-${i}`, -24 * 30 - i, -24 * 30 - i + 1), FAY, `Old ${i}`);
  book(db, addSlot(db, 'live', -0.25, 0.75), FIN, 'Running now');
  book(db, addSlot(db, 'soon', 30, 31), FLO, 'Pricing review');
  const r = await call(db, `/me/cohort/${CYCLE}/calendar`);
  assert.deepEqual(sessionsOf(r.body.items).map((i: any) => i.title), ['Running now', 'Pricing review']);
  assert.equal(r.body.sessions_truncated, false);
});

// ── 4. Export identity ────────────────────────────────────────────────────

test('D4813 p3: Lab dates carry a UID with the cycle id; a session keeps one UID across cohorts', async () => {
  const db = freshDb();
  const s = addSlot(db, 'shared', 30, 31);
  book(db, s, FAY, 'Pricing review');
  const a = await call(db, `/me/cohort/${CYCLE}/calendar`);
  const b = await call(db, `/me/cohort/${CYCLE_B}/calendar`);
  const uids = (r: any) => r.body.events.map((e: any) => e.uid);
  for (const r of [a, b]) {
    assert.ok(r.body.events.every((e: any) => typeof e.uid === 'string' && e.uid), 'every event has an identity');
    assert.equal(new Set(uids(r)).size, uids(r).length, 'identities are distinct within a calendar');
  }
  const week2 = (r: any) => r.body.events.find((e: any) => e.ref === 'week:2:unlock');
  assert.equal(week2(a).ref, week2(b).ref, 'the ref is the same string in both cohorts');
  assert.notEqual(week2(a).uid, week2(b).uid, 'but the exported identity is not');
  assert.equal(week2(a).uid, `cohort-${CYCLE}-week-2-opens`);
  const labA = a.body.events.filter((e: any) => e.kind !== 'client').map((e: any) => e.uid);
  const labB = b.body.events.filter((e: any) => e.kind !== 'client').map((e: any) => e.uid);
  assert.equal(labA.filter((u: string) => labB.includes(u)).length, 0, 'no Lab date shares an identity across cohorts');
  assert.equal(sessionsOf(a.body.events)[0].uid, sessionsOf(b.body.events)[0].uid, 'the same session is one calendar entry');
  assert.equal(sessionsOf(a.body.events)[0].uid, `advisor-slot-${s}`);
});

test('D4813 p3: the subscribed calendar feed carries no cohort date, and the page reader keys them by cycle', () => {
  // The one server-side export (`/calendar/feed/*.ics`) excludes page-only
  // kinds; `cohort_date` is one, and its own uid already names the cycle.
  const registry = read('cloudflare-worker/src/services/calendar/registry.ts');
  assert.match(registry, /cohort_date: \{[^}]*page_only: true/);
  assert.match(read('cloudflare-worker/src/services/calendar.ts'), /export const FEED_KINDS = KNOWN_KINDS\.filter\(\(k\) => !PAGE_ONLY_KINDS\.includes\(k\)\)/);
  assert.match(read('cloudflare-worker/src/services/calendar/sourceReaders.ts'), /const uid = `cycle-\$\{r\.id\}-\$\{suffix\}`/);
});

// ── 5. Partial sources ────────────────────────────────────────────────────

test('D4813 p3: no week windows recorded is partial — the sessions are still returned', async () => {
  const db = freshDb({ windows: false });
  book(db, addSlot(db, 'soon', 30, 31), FLO, 'Pricing review');
  const r = await call(db, `/me/cohort/${CYCLE}/calendar`);
  assert.equal(r.status, 200);
  assert.equal(r.body.windows_recorded, false);
  assert.deepEqual(r.body.sources, { lab_dates: 'not_recorded', sessions: 'ok' });
  assert.equal(r.body.partial, true);
  assert.deepEqual(sessionsOf(r.body.items).map((i: any) => i.title), ['Pricing review']);
  assert.equal(r.body.timezone, 'America/New_York', 'the zone is named');
});

test('D4813 p3: a failed windows read is partial, not a 500', async () => {
  const db = freshDb();
  book(db, addSlot(db, 'soon', 30, 31), FLO, 'Pricing review');
  const r = await call(db, `/me/cohort/${CYCLE}/calendar`, /FROM week_windows/);
  assert.equal(r.status, 200);
  assert.equal(r.body.sources.lab_dates, 'error');
  assert.equal(r.body.counts.cohort_obligations, null, 'an unread half is unknown, never an undercount');
  assert.equal(r.body.partial, true);
  assert.equal(sessionsOf(r.body.items).length, 1);
  assert.ok(!r.body.events.some((e: any) => e.kind === 'cohort'), 'no week date is invented');
});

test('D4813 p3: a failed sessions read is partial — the Lab dates are still returned', async () => {
  const db = freshDb();
  const r = await call(db, `/me/cohort/${CYCLE}/calendar`, /FROM advisor_bookings/);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sources, { lab_dates: 'ok', sessions: 'error' });
  assert.equal(r.body.counts.collisions, null, 'conflicts are unknown when sessions were not read');
  assert.equal(r.body.partial, true);
  assert.ok(r.body.items.some((e: any) => e.type === 'deadline'));
  assert.equal(sessionsOf(r.body.events).length, 0);
});

test('D4813 p3: everything read is not partial', async () => {
  const r = await call(freshDb(), `/me/cohort/${CYCLE}/calendar`);
  assert.deepEqual(r.body.sources, { lab_dates: 'ok', sessions: 'ok' });
  assert.equal(r.body.partial, false);
  const types = new Set(r.body.events.map((e: any) => e.type));
  for (const t of ['week_opens', 'deadline', 'demo_day']) assert.ok(types.has(t), `${t} is typed`);
  assert.ok(r.body.events.length > r.body.items.length, 'events page through the cycle; items are the next 14 days');
});

// ── 6. Gating ─────────────────────────────────────────────────────────────

test('D4813 p3: an advisor not assigned to the cycle is still refused', async () => {
  const db = freshDb();
  db.prepare('UPDATE advisor_cohort_assignments SET is_active = 0 WHERE cohort_cycle_id = ?').run(CYCLE_B);
  assert.equal((await call(db, `/me/cohort/${CYCLE_B}/calendar`)).status, 403);
  assert.equal((await call(db, `/me/cohort/999/calendar`)).status, 403);
  assert.equal((await call(db, `/me/cohort/${CYCLE}/calendar`)).status, 200);
});

test('D4813 p3: a founder who opted out is still hidden from the week record', async () => {
  const db = freshDb();
  db.prepare('INSERT INTO cohort_advisor_optouts (founder_user_id, advisor_user_id) VALUES (?, ?)').run(FIN, AVA);
  const r = await call(db, `/me/cohort/${CYCLE}/weeks`);
  assert.ok(!r.body.founders.some((f: any) => f.user_id === FIN));
});
