/**
 * D6865 (#6865) — Grow v2 › Customers › Feedback, the Worker half: the
 * customer link and origin on a feedback item, the told state and the three
 * counts in the list read, one theme's weight, and Mark told for several. On
 * real SQLite (the production baseline plus every migration after the cutoff).
 * Every venture, person, company and amount below is made up.
 *
 * Mutation checks (each made by hand, the suite run, and reverted; each failed
 * at least one test here):
 *   - growWriters.ts contactOf: drop `AND project_id = ?`                 → "another venture's contact is refused"
 *   - growWriters.ts addFeedback: default origin `typed` → null             → "a typed item says Typed"
 *   - feedbackLoop.ts personKey: drop the email step                        → "distinct people"
 *   - feedbackLoop.ts themeWeight: `received_on >= ?` → no window           → "revenue is the last 60 days only"
 *   - feedbackLoop.ts themeWeight: drop `revenue_type = 'recurring'`        → "only recurring revenue counts"
 *   - feedbackLoop.ts themeWeight: push no-revenue askers as 0 instead      → "Not recorded, never $0"
 *   - feedbackLoop.ts why: drop the `told_at` check                         → "already told is named"
 *   - feedbackLoop.ts markFeedbackToldMany: drop `AND project_id = ?` in the SELECT → "another venture's item"
 *   - cycle_grow.ts: send told state / contact to every reader              → "an advisor reads no names or told state"
 *   - cycle_grow.ts /feedback/weight: `project(…, true)` → `false`          → "the weight is a writer's read"
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_feedback_loop_6865.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { personKey } from '../src/services/feedbackLoop.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1; const ADVISOR = 3; const OTHER = 6;
const PA = 7; const PB = 8;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [ADVISOR]: 'founder', [OTHER]: 'founder' };
// The weight's 60-day window runs back from the Worker's own now, so the fixture's dates are relative to it.
const NOW = Date.now(); // clock-ok: relative
const DAY = (ago: number) => new Date(NOW - ago * 86_400_000).toISOString().slice(0, 10);

const newer = readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(BASELINE);
  for (const name of newer) db.exec(readFileSync(resolve(M, name), 'utf8'));
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');`);
  const u = db.prepare('INSERT INTO users (id, email, name, role, founder_id) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder@example.test', 'Fay Founder', 'founder', 10);
  u.run(ADVISOR, 'advisor@example.test', 'Ada Advisor', 'founder', null);
  u.run(OTHER, 'other@example.test', 'Oli Other', 'founder', 20);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10), (${PB}, 'Heron Works', 20);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PA}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO contacts (uid, project_id, audience, name, email, status) VALUES
      ('ca1', ${PA}, 'customer', 'Kai Mori', 'kai@kite.test', 'active'),
      ('ca2', ${PA}, 'customer', 'Lin Park', 'lin@ostra.test', 'contacted'),
      ('cb1', ${PB}, 'customer', 'Heron Person', 'hp@heron.test', 'new');
    INSERT INTO product_feedback (uid, project_id, body, source, theme, status, from_name, from_email, from_company, contact_uid, notify_on_ship, shipped_on, told_at) VALUES
      ('f1', ${PA}, 'CSV of routes every Monday', 'customer', 'Fleet CSV', 'shipped', 'Kai Mori', 'kai@kite.test', 'Kite Systems', 'ca1', 1, '${DAY(14)}', NULL),
      ('f2', ${PA}, 'Export per depot', 'customer', 'Fleet CSV', 'shipped', 'Kai M.', 'KAI@kite.test', 'Kite Systems', NULL, 1, '${DAY(14)}', NULL),
      ('f3', ${PA}, 'A file per depot', 'customer', 'Fleet CSV', 'shipped', 'Hanne Vik', NULL, 'Ostra Depot', NULL, 1, '${DAY(14)}', '${DAY(2)}'),
      ('f4', ${PA}, 'Excel export please', 'customer', 'Fleet CSV', 'planned', 'Tom Ash', 'tom@ash.test', NULL, NULL, 1, NULL, NULL),
      ('f5', ${PA}, 'CSV would help', 'investor', 'Fleet CSV', 'shipped', NULL, NULL, NULL, NULL, 0, '${DAY(14)}', NULL),
      ('f6', ${PA}, 'Onboarding is long', 'customer', 'Onboarding', 'open', 'Rae Bell', 'rae@bell.test', 'Bell Co', NULL, 0, NULL, NULL),
      ('fb1', ${PB}, 'Heron row', 'customer', 'Fleet CSV', 'shipped', 'Heron Person', 'hp@heron.test', 'Kite Systems', NULL, 1, '${DAY(14)}', NULL);
    INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, currency, revenue_type, received_on, source, verification) VALUES
      ('r1', ${PA}, 'Kite Systems', 120000, 'usd', 'recurring', '${DAY(10)}', 'manual', 'manual'),
      ('r2', ${PA}, 'Kite Systems', 120000, 'usd', 'recurring', '${DAY(40)}', 'manual', 'manual'),
      ('r3', ${PA}, 'Kite Systems', 999900, 'usd', 'recurring', '${DAY(90)}', 'manual', 'manual'),
      ('r4', ${PA}, 'Kite Systems', 500000, 'usd', 'one_time', '${DAY(5)}', 'manual', 'manual'),
      ('r5', ${PA}, 'Ostra Depot', 80000, 'eur', 'recurring', '${DAY(3)}', 'manual', 'manual'),
      ('r6', ${PB}, 'Kite Systems', 777700, 'usd', 'recurring', '${DAY(3)}', 'manual', 'manual');
    INSERT INTO roadmap_okrs (id, project_id, objective, feedback_theme) VALUES (1, ${PA}, 'Route replay export', 'Fleet CSV'), (2, ${PB}, 'Heron export', 'Fleet CSV');`);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);

async function call(f: { env: any }, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}
const row = (f: any, uid: string) => ({ ...(f.db.prepare('SELECT * FROM product_feedback WHERE uid = ?').get(uid) as any) });
const weight = (f: any, who: number, theme: string, project = PA) =>
  call(f, who, 'GET', `/api/cycles/grow/feedback/weight?project=${project}&theme=${encodeURIComponent(theme)}`);

test('POST /feedback links a contact of this venture and records the origin; a typed item says Typed', async () => {
  const f = fixture();
  const a = await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback', { project: PA, body: 'Weekly CSV', source: 'customer', contact_uid: 'ca2', origin: 'inbox_reply' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(row(f, a.body.uid).contact_uid, 'ca2');
  assert.equal(row(f, a.body.uid).origin, 'inbox_reply');
  const b = await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback', { project: PA, body: 'Typed by hand', source: 'team' });
  assert.equal(row(f, b.body.uid).origin, 'typed');
  assert.equal(row(f, b.body.uid).contact_uid, null);
  const bad = await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback', { project: PA, body: 'x', source: 'team', origin: 'carrier_pigeon' });
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'origin');
});

test("another venture's contact is refused, and PATCH links, keeps and unlinks without touching the typed name", async () => {
  const f = fixture();
  const other = await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback', { project: PA, body: 'x', source: 'customer', contact_uid: 'cb1' });
  assert.equal(other.status, 404); assert.equal(other.body.field, 'contact_uid');
  assert.equal((await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/feedback/f2', { project: PA, contact_uid: 'ca1' })).status, 200);
  assert.equal(row(f, 'f2').contact_uid, 'ca1');
  assert.equal(row(f, 'f2').from_name, 'Kai M.', 'the typed name is kept as the fallback');
  assert.equal((await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/feedback/f2', { project: PA, theme: 'Fleet CSV' })).status, 200);
  assert.equal(row(f, 'f2').contact_uid, 'ca1', 'an edit that does not send contact_uid keeps the link');
  assert.equal((await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/feedback/f2', { project: PA, contact_uid: '' })).status, 200);
  assert.equal(row(f, 'f2').contact_uid, null);
  assert.equal((await call(f, FOUNDER, 'PATCH', '/api/cycles/grow/feedback/f2', { project: PA, contact_uid: 'cb1' })).status, 404);
});

test('the list read carries told state, origin and the linked record for writers, and the three counts for everyone', async () => {
  const f = fixture();
  const r = await call(f, FOUNDER, 'GET', `/api/cycles/grow/modules/product-improvement?project=${PA}&page_size=50`);
  assert.equal(r.status, 200);
  const f1 = r.body.records.rows.find((x: any) => x.id === 'f1');
  assert.equal(f1.notify_on_ship, true); assert.equal(f1.told_at, null); assert.equal(f1.from_email, 'kai@kite.test');
  assert.equal(f1.shipped_on, DAY(14)); assert.equal(f1.origin, null, 'a row older than the column has no origin');
  assert.deepEqual(f1.contact, { uid: 'ca1', name: 'Kai Mori', audience: 'customer', status: 'active' });
  assert.equal(r.body.records.rows.find((x: any) => x.id === 'f2').contact, null);
  assert.deepEqual(r.body.parts.counts, { items: 6, open_items: 1, themes: 2, shipped_not_told: 2, period: 'all feedback recorded on this venture' });
});

test('an advisor reads no names or told state, and still gets the counts', async () => {
  const f = fixture();
  const r = await call(f, ADVISOR, 'GET', `/api/cycles/grow/modules/product-improvement?project=${PA}&page_size=50`);
  assert.equal(r.status, 200);
  for (const x of r.body.records.rows) {
    for (const k of ['from_name', 'from_email', 'from_company', 'told_at', 'told_via', 'notify_on_ship', 'contact']) assert.equal(k in x, false, k);
    assert.equal('origin' in x, true);
  }
  assert.equal(r.body.parts.counts.shipped_not_told, 2);
});

test('distinct people: the record, then the email (any case), then the name; an unnamed item is counted apart', async () => {
  assert.equal(personKey({ contact_uid: 'ca1', from_email: 'a@b.test' }), 'contact:ca1');
  assert.equal(personKey({ from_email: ' KAI@kite.test ', from_name: 'Kai' }), 'email:kai@kite.test');
  assert.equal(personKey({ from_name: ' Hanne Vik ' }), 'name:hanne vik');
  assert.equal(personKey({}), null);
  const f = fixture();
  const w = await weight(f, FOUNDER, 'Fleet CSV');
  assert.equal(w.status, 200, JSON.stringify(w.body));
  // f1 (record ca1, kai@kite.test) and f2 (KAI@kite.test, no record) are keyed differently: the record wins for f1.
  // People: contact:ca1, email:kai@kite.test, name:hanne vik, email:tom@ash.test; f5 names nobody.
  assert.equal(w.body.items, 5);
  assert.equal(w.body.distinct_people, 4);
  assert.equal(w.body.not_named, 1);
  assert.deepEqual(w.body.by_status, { open: 0, planned: 1, shipped: 4 });
  const kai = w.body.people.find((p: any) => p.record?.uid === 'ca1');
  assert.deepEqual(kai.record, { uid: 'ca1', audience: 'customer', status: 'active' });
  assert.equal(kai.name, 'Kai Mori');
  assert.deepEqual(w.body.roadmap_items, [{ id: 1, label: 'Route replay export' }]);
  // GR-26: everyone on the theme, with whether they can be told now and, if not, why.
  assert.deepEqual(w.body.loop.map((r: any) => [r.uid, r.state, r.reason, r.has_email]), [
    ['f1', 'due', null, true], ['f2', 'due', null, true], ['f3', 'told', null, false],
    ['f4', 'cannot', 'Not shipped yet', true], ['f5', 'cannot', 'Did not ask to be told', false],
  ]);
});

test('revenue is recurring, from the last 60 days, per currency, under the askers\' companies in this venture only', async () => {
  const f = fixture();
  // The Worker reads its own now during the call; a slow call can cross midnight UTC, so `since` is
  // the day 60 days before a moment between these two reads (#8316, #8318).
  const sinceAt = (t: number) => new Date(t - 60 * 86_400_000).toISOString().slice(0, 10);
  const before = Date.now(); // clock-ok: relative
  const w = (await weight(f, FOUNDER, 'Fleet CSV')).body.revenue;
  const after = Date.now(); // clock-ok: relative
  assert.equal(w.window_days, 60); assert.ok([sinceAt(before), sinceAt(after)].includes(w.since), `${w.since} is 60 days before the call`);
  // Kite: r1 + r2 (r3 is 90 days old, r4 is one-time, r6 is another venture's); Ostra: r5 in EUR.
  assert.deepEqual(w.by_currency, [{ currency: 'EUR', cents: 80000 }, { currency: 'USD', cents: 240000 }]);
  assert.equal(w.companies_with_revenue, 2); assert.equal(w.companies_named, 2);
});

test('an asker with no company or no revenue is Not recorded with the reason, never $0', async () => {
  const f = fixture();
  f.db.exec("DELETE FROM revenue_entries WHERE customer = 'Ostra Depot'");
  const w = (await weight(f, FOUNDER, 'Fleet CSV')).body;
  const reasons = w.revenue.not_recorded.map((n: any) => `${n.name}: ${n.reason}`);
  assert.ok(reasons.includes('Tom Ash: No company named on their feedback'), reasons.join(' | '));
  assert.ok(reasons.some((x: string) => /^Hanne Vik: No recurring revenue on the ledger names Ostra Depot in the last 60 days$/.test(x)), reasons.join(' | '));
  const hanne = w.people.find((p: any) => p.name === 'Hanne Vik');
  assert.equal(hanne.revenue, null, 'no revenue is null, not an amount of 0');
  assert.deepEqual(w.revenue.by_currency, [{ currency: 'USD', cents: 240000 }]);
  assert.ok(!JSON.stringify(w).match(/score|rank|impact/i), 'no score is computed');
});

test('the weight is a writer\'s read; an unknown or empty theme is refused', async () => {
  const f = fixture();
  assert.equal((await weight(f, ADVISOR, 'Fleet CSV')).status, 403);
  assert.equal((await weight(f, OTHER, 'Fleet CSV')).status, 403);
  assert.equal((await weight(f, FOUNDER, 'Nope')).status, 404);
  assert.equal((await weight(f, FOUNDER, '')).status, 400);
});

test('Mark told for several: only shipped rows that asked and are not told; every other row is named with its reason', async () => {
  const f = fixture();
  const r = await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback/told', { project: PA, via: 'call', uids: ['f1', 'f2', 'f3', 'f4', 'f5', 'fb1', 'nope', 'f1'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.told.map((t: any) => t.uid), ['f1', 'f2']);
  assert.match(r.body.told[0].mailto, /^mailto:kai%40kite\.test\?subject=It%20shipped/);
  assert.deepEqual(r.body.refused, [
    { uid: 'f3', name: 'Hanne Vik', reason: 'Already told' },
    { uid: 'f4', name: 'Tom Ash', reason: 'Not shipped yet' },
    { uid: 'f5', name: null, reason: 'Did not ask to be told' },
    { uid: 'fb1', name: null, reason: 'Not found' },
    { uid: 'nope', name: null, reason: 'Not found' },
  ]);
  assert.equal(row(f, 'f1').told_via, 'call'); assert.ok(row(f, 'f1').told_at);
  assert.equal(row(f, 'fb1').told_at, null, "another venture's item is untouched");
  const logs = f.db.prepare("SELECT details FROM activity_logs WHERE action = 'grow_feedback_told_many'").all() as any[];
  assert.equal(logs.length, 1); assert.equal(logs[0].details, '2 customers told it shipped (call)');
});

test('Mark told for several: refused without a choice or a way, and an advisor cannot', async () => {
  const f = fixture();
  assert.equal((await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback/told', { project: PA, via: 'call', uids: [] })).status, 400);
  assert.equal((await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback/told', { project: PA, uids: ['f1'] })).status, 400);
  assert.equal((await call(f, ADVISOR, 'POST', '/api/cycles/grow/feedback/told', { project: PA, via: 'call', uids: ['f1'] })).status, 403);
  assert.equal(row(f, 'f1').told_at, null);
});
