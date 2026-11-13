/**
 * D1596 (#3869) — `sessions:block` on `POST /api/ai/rail/run`: Block proposals
 * for Advisor › Practice › Sessions from the advisor's own Axal records. No
 * model, no hold, no charge; proposals only, never the slot table.
 *
 * On the migrated schema, synthetic rows only. The runner and the quoter are
 * stubs that fail the test if either is ever called.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/advisor_sessions_block_d1596.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { railOptionsOn } from '../src/services/ai/railMatrix.ts';
import { CLASH_WORDS, FREE_AFTERNOON_WORDS } from '../src/services/sessionsBlock.ts';

const SECRET = 'synthetic-sessions-block-d1596-'.repeat(3);
test.after(() => removeMigratedDatabases());

const PAGE = 'Advisor · Practice · Sessions';
const OPTION = 'sessions:block';
const DAY = 86_400_000;
// Two days out, so the window's start (now) never crosses the fixture's first day.
const D0 = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + 2 * DAY);
const at = (day: number, hour: number) => new Date(D0.getTime() + day * DAY + hour * 3_600_000).toISOString();

// 11 founder, 21 advisor (201, UTC), 22 another advisor (202), 23 an advisor with nothing open (203), 61 explorer (with advisor row 204), 51 admin.
function fixture(opts: { timezone?: string | null } = {}) {
  const db = migratedDatabase();
  const tz = opts.timezone === undefined ? 'UTC' : opts.timezone;
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,1),(21,'Advisor','a@example.test','advisor',NULL,1),
      (22,'Advisor Two','a2@example.test','advisor',NULL,1),(23,'Advisor Three','a3@example.test','advisor',NULL,1),
      (51,'Admin','h@example.test','admin',NULL,1),(61,'Explorer','e@example.test','exploring',NULL,1);
  `);
  db.prepare("INSERT INTO advisors(id,uid,user_id,display_name,email,timezone) VALUES (201,'a-1',21,'Advisor','a@example.test',?),(202,'a-2',22,'Advisor Two','a2@example.test','UTC'),(203,'a-3',23,'Advisor Three','a3@example.test',NULL),(204,'a-4',61,'Explorer','e@example.test','UTC')").run(tz);
  // The Explorer holds an advisor row with an open slot, so only the Explorer rule refuses them.
  db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at) VALUES (391,?,204,?,?)').run('s-391', at(1, 13), at(1, 14));
  const slot = (id: number, advisor: number, from: string, until: string, extra: { cancelled?: boolean; blocked?: string } = {}) =>
    db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at,is_cancelled,blocked_reason) VALUES (?,?,?,?,?,?,?)')
      .run(id, `s-${id}`, advisor, from, until, extra.cancelled ? 1 : 0, extra.blocked ?? null);
  const book = (slotId: number, advisor: number, status = 'confirmed') =>
    db.prepare("INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,status) VALUES (?,?,?,11,?)").run(`b-${slotId}`, slotId, advisor, status);
  const host = (id: number, user: number, from: string, until: string | null) =>
    db.prepare("INSERT INTO events(id,slug,host_user_id,type,title,starts_at,ends_at,status,visibility) VALUES (?,?,?,'meetup','Breakfast',?,?,'published','public')").run(id, `ev-${id}`, user, from, until);

  // Day 0: 08–09 blocked, 09–10 and 10–11 open (one run), 11–12 booked; an event 21 hosts at 09:30–10:30.
  slot(301, 201, at(0, 8), at(0, 9), { blocked: 'Dentist' });
  slot(302, 201, at(0, 9), at(0, 10));
  slot(303, 201, at(0, 10), at(0, 11));
  slot(304, 201, at(0, 11), at(0, 12)); book(304, 201);
  slot(305, 201, at(0, 16), at(0, 17), { cancelled: true });
  host(401, 21, at(0, 9.5), at(0, 10.5));
  // Day 1: an open afternoon (13–14, 14–15) and a cohort deadline that day, which is all-day and never clashes.
  slot(311, 201, at(1, 13), at(1, 14));
  slot(312, 201, at(1, 14), at(1, 15));
  db.prepare("INSERT INTO cohort_cycles(id,year,month,start_at,end_at,status) VALUES (71,2026,11,?,?,'active')").run(at(-30, 0), at(1, 15));
  db.prepare("INSERT INTO advisor_cohort_assignments(uid,advisor_user_id,cohort_cycle_id,is_active) VALUES ('ca-1',21,71,1)").run();
  // Day 2: an afternoon with a booking (15–16) is not free.
  slot(321, 201, at(2, 13), at(2, 14));
  slot(322, 201, at(2, 15), at(2, 16)); book(322, 201, 'pending');
  // Another advisor: a slot and their own event over it, and an event over 21's day-1 afternoon.
  slot(331, 202, at(0, 9), at(0, 10));
  host(402, 22, at(0, 9), at(0, 10));
  host(403, 22, at(1, 13), at(1, 14));

  const calls = { run: 0, quote: 0 };
  const run = async () => { calls.run++; throw new Error('the model runner must never be called'); };
  const quote = async () => { calls.quote++; throw new Error('the quoter must never be called'); };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run: run as any, quote: quote as any }));
  const post = async (who: number, body: Record<string, unknown>, support = false) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(support ? { impersonated_by: 51 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request('/api/ai/rail/run', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    const text = await r.text();
    const events = (r.headers.get('content-type') || '').startsWith('text/event-stream')
      ? text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })(), events, done: events.find((e) => e.event === 'done')?.data, meta: events.find((e) => e.event === 'meta')?.data };
  };
  const slots = () => JSON.stringify(db.prepare('SELECT * FROM advisor_office_hour_slots ORDER BY id').all());
  const rows = () => db.prepare('SELECT user_id, rail_page, rail_option, record_ref, kind, payload_json, model, usage_log_id FROM ai_rail_proposals ORDER BY id').all() as any[];
  return { db, post, calls, slots, rows };
}
const ask = (input?: Record<string, unknown>) => ({ page: PAGE, option: OPTION, ...(input ? { input } : {}) });

test('refused before any read: another page, an Explorer, a founder, a support session; no model, no quote', async () => {
  const f = fixture();
  const other = await f.post(21, { page: 'Advisor · Practice · Earnings', option: OPTION });
  assert.deepEqual([other.status, other.body.error], [404, 'unknown_page']);
  for (const who of [61, 11, 51]) {
    const r = await f.post(who, ask());
    assert.deepEqual([r.status, r.body.error], [403, 'no_profile'], `user ${who}`);
  }
  const support = await f.post(21, ask(), true);
  assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
  assert.deepEqual(f.calls, { run: 0, quote: 0 });
  assert.equal(f.rows().length, 0);
});

test('a clash and a free afternoon, from open slots only; at no charge; filed as proposals, never written to the slots', async () => {
  const f = fixture();
  const before = f.slots();
  const r = await f.post(21, ask());
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.meta, { model: null, hold_microusd: 0 });
  assert.deepEqual([r.done.usage_log_id, r.done.charged_microusd], [null, null]);
  assert.deepEqual(r.done.proposals.map(({ uid, ...p }: any) => p), [
    // The blocked 08–09 and the booked 11–12 bound the run: it is 09–11, two slots.
    { kind: 'clash', from: at(0, 9), until: at(0, 11), open_slots: 2, source: CLASH_WORDS.hosted_events },
    // Day 1's cohort deadline is all-day and does not stop it; day 2 holds a booking.
    { kind: 'free_afternoon', from: at(1, 12), until: at(1, 18), open_slots: 2, source: FREE_AFTERNOON_WORDS },
  ]);
  assert.deepEqual(r.done.dropped, []);
  assert.deepEqual(f.calls, { run: 0, quote: 0 });
  assert.equal(f.slots(), before, 'the run writes no slot');
  const rows = f.rows();
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.deepEqual([row.user_id, row.rail_option, row.record_ref, row.kind, row.model, row.usage_log_id], [21, OPTION, 'advisor:201', 'proposal', null, null]);
    assert.ok(!('reason' in JSON.parse(row.payload_json)), 'a block\'s reason is the advisor\'s own words');
  }
  assert.ok(!r.text.includes('Dentist'), 'a blocked slot\'s reason is never read out');
});

test('a booked slot and a blocked slot are in no proposal, and another advisor\'s slots and items are never read', async () => {
  const f = fixture();
  const r = await f.post(21, ask());
  const spans = r.done.proposals.map((p: any) => [Date.parse(p.from), Date.parse(p.until)]);
  for (const t of [at(0, 8), at(0, 11), at(2, 15)]) assert.ok(!spans.some(([a, b]: number[]) => Date.parse(t) >= a && Date.parse(t) < b), `${t} is in no proposal`);
  assert.ok(!r.done.proposals.some((p: any) => p.from === at(1, 13)), 'another advisor\'s event makes no clash on this advisor\'s afternoon');
  const theirs = await f.post(22, ask());
  assert.deepEqual(theirs.done.proposals.map((p: any) => [p.kind, p.from, p.until, p.open_slots]), [['clash', at(0, 9), at(0, 10), 1]]);
});

test('a failing reader is named, never read as an empty calendar; no time zone skips free afternoons and says so', async () => {
  let f = fixture();
  f.db.exec('DROP TABLE interview_channel_refs');
  let r = await f.post(21, ask());
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.done.dropped, [{ why: 'source_unreadable', source: 'interview_calls' }]);
  f = fixture({ timezone: null });
  r = await f.post(21, ask());
  assert.deepEqual(r.done.proposals.map((p: any) => p.kind), ['clash']);
  assert.deepEqual(r.done.dropped, [{ why: 'no_time_zone' }]);
});

test('an all-day cohort deadline proposes nothing on its own; nothing to propose writes no row', async () => {
  const f = fixture();
  // Only the day-1 afternoon's slots stay; with no time zone there is no free afternoon, and the deadline is all-day.
  f.db.exec("DELETE FROM advisor_office_hour_slots WHERE id NOT IN (311, 312); UPDATE advisors SET timezone = NULL WHERE id = 201");
  const r = await f.post(21, ask());
  assert.deepEqual([r.done.proposals, r.done.reason], [[], 'nothing_to_propose']);
  assert.equal(f.rows().length, 0);
  const empty = await f.post(23, ask({ days: 30 }));
  assert.deepEqual([empty.status, empty.done.proposals, empty.done.reason], [200, [], 'nothing_to_propose']);
  assert.deepEqual(f.calls, { run: 0, quote: 0 });
});

test('the window: days narrows the read, and a bad value falls back to 14', async () => {
  const f = fixture();
  const one = await f.post(21, ask({ days: 1 }));
  assert.equal(one.done.reason, 'nothing_to_propose', 'one day from now ends before the fixture\'s first day');
  for (const days of [0, 61, 'x', 2.5]) assert.equal((await f.post(21, ask({ days }))).done.proposals.length, 2, `days=${days}`);
});

test('the option is registered on Sessions with no model', () => {
  const o = railOptionsOn(PAGE).find((x) => x.optionKey === OPTION);
  assert.ok(o, 'GET /api/ai/rail lists it on its page');
  assert.equal(o!.optionLabel, 'Find a free afternoon');
  assert.deepEqual([o!.models, o!.more ?? []], [[], []]);
});
