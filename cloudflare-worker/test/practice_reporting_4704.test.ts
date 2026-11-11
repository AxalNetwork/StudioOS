/**
 * D4704 (#4704, Practice audit 6/6) — one definition of an advisor's money,
 * shared by the earnings overview, the ledger (and its export) and the annual
 * summary.
 *
 * Real SQLite over every migration and the real advisor router. Pinned:
 *   · overview and detail agree on every state, including a priced line whose
 *     stored state still says 'unpriced' (the overview used to call it
 *     unpriced, the ledger billed) and the cancelled/missed rules;
 *   · the annual summary for a year equals the ledger over that year;
 *   · a collection just over the client cap changes no total: the listed
 *     clients plus `clients_other` reconcile, and the overview counts every one;
 *   · the overview says what it covers (`population`).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/practice_reporting_4704.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import advisors from '../src/routes/advisors.ts';
import { LEDGER_CLIENT_CAP } from '../src/services/practiceReporting.ts';

const SECRET = ['d4704', 'practice', 'fixture', 'secret'].join('-');
const ADVISOR_USER = 70;

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  db.prepare("INSERT INTO users (id, uid, role, name, email) VALUES (?, 'u-adv', 'advisor', 'Avery Advisor', 'avery@example.test')").run(ADVISOR_USER);
  db.prepare("INSERT INTO advisors (id, uid, user_id, display_name) VALUES (1, 'adv-1', ?, 'Avery Advisor')").run(ADVISOR_USER);
  let seq = 0;
  const booking = (o: { client: number; amount: number | null; state: string; status?: string; created?: string }) => {
    seq += 1;
    db.prepare(`INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, status, amount_cents, billing_state, take_rate_bps, platform_cut_cents, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(`bk-${seq}`, seq, o.client, o.status ?? 'completed', o.amount, o.state,
      o.amount == null ? null : 1000, o.amount == null ? null : Math.floor(o.amount / 10), o.created ?? '2026-06-15 10:00:00');
  };
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  async function get(path: string) {
    const token = await new SignJWT({ user_id: ADVISOR_USER }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env));
      return { status: res.status, body: await res.json().catch(() => null) as any };
    } finally { [console.warn, console.error] = saved; }
  }
  for (const id of [101, 102, 103]) db.prepare("INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, 'founder', ?, ?)").run(id, `u-${id}`, `Client ${id}`, `c${id}@example.test`);
  return { db, booking, get };
}

test('the overview and the ledger classify every booking the same way, the edge rows included', async () => {
  // Mutation checked: the overview grouped by the stored billing_state again → billed 10000, unpriced 2.
  const f = fixture();
  f.booking({ client: 101, amount: 10000, state: 'billed' });
  f.booking({ client: 101, amount: 5000, state: 'collected' });
  f.booking({ client: 102, amount: 2000, state: 'written_off' });
  f.booking({ client: 102, amount: null, state: 'unpriced' });
  f.booking({ client: 103, amount: 3000, state: 'unpriced' }); // priced, stored state not moved on: owed, so billed
  f.booking({ client: 103, amount: 4000, state: 'billed', status: 'cancelled' }); // cancelled, never collected: void
  f.booking({ client: 103, amount: 1500, state: 'collected', status: 'no_show' }); // missed but collected: counts
  const e = await f.get('/api/advisors/me/earnings');
  const l = await f.get('/api/advisors/me/ledger');
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.deepEqual([e.body.billed_cents, e.body.collected_cents, e.body.written_off_cents, e.body.outstanding_cents, e.body.unpriced_count],
    [13000, 6500, 2000, 13000, 1]);
  // The same figures, read from the ledger.
  assert.equal(e.body.billed_cents, l.body.states.billed.gross_cents);
  assert.equal(e.body.collected_cents, l.body.states.collected.gross_cents);
  assert.equal(e.body.written_off_cents, l.body.states.written_off.gross_cents);
  assert.equal(e.body.unpriced_count, l.body.states.unpriced.sessions);
  const byState = Object.fromEntries(e.body.by_state.map((s: any) => [s.state, s]));
  assert.equal(byState.billed.bookings, l.body.states.billed.sessions);
  assert.equal(byState.collected.bookings, l.body.states.collected.sessions);
  assert.equal(byState.unpriced.total_cents, 0, 'an unpriced line carries no cents');
  assert.equal(e.body.billed_cents + e.body.collected_cents + e.body.written_off_cents, l.body.totals.gross_cents, 'the states add up to the ledger total');
  assert.deepEqual(e.body.population, { definition: 'practice_money_v1', period: { from: null, until: null }, sessions: 6, included_sessions: 0, excluded_void_sessions: 1, complete: true });
  assert.equal(l.body.totals.sessions, e.body.population.sessions);
});

test('the annual summary for a year is the ledger over that year', async () => {
  const f = fixture();
  f.booking({ client: 101, amount: 10000, state: 'collected', created: '2025-12-31 23:59:59' });
  f.booking({ client: 101, amount: 7000, state: 'collected', created: '2026-01-01 00:00:00' });
  f.booking({ client: 102, amount: 3000, state: 'billed', created: '2026-12-31 23:00:00' });
  f.booking({ client: 102, amount: 900, state: 'billed', created: '2027-01-01 00:00:00' });
  const tax = await f.get('/api/advisors/me/tax-summary?year=2026');
  const led = await f.get('/api/advisors/me/ledger?from=2026-01-01T00:00:00.000Z&until=2027-01-01T00:00:00.000Z');
  assert.equal(tax.status, 200, JSON.stringify(tax.body));
  assert.equal(tax.body.completeness.sessions, led.body.totals.sessions);
  assert.equal(led.body.totals.sessions, 2, 'the half-open year holds the two 2026 bookings only');
  assert.equal(led.body.totals.gross_cents, 10000);
});

test('one client past the cap changes no total: the listed rows and clients_other reconcile, and the overview counts everyone', async () => {
  // Mutation checked: the overview summing the listed clients only → 50,000, not 50,100.
  const f = fixture();
  const n = LEDGER_CLIENT_CAP + 1;
  const user = f.db.prepare("INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, 'founder', ?, ?)");
  for (let i = 0; i < n; i += 1) { user.run(1000 + i, `u-c${i}`, `Client ${i}`, `c${1000 + i}@example.test`); f.booking({ client: 1000 + i, amount: 100, state: 'billed' }); }
  const l = await f.get('/api/advisors/me/ledger');
  const e = await f.get('/api/advisors/me/earnings');
  assert.equal(l.body.clients.length, LEDGER_CLIENT_CAP);
  assert.ok(l.body.clients_other, 'the clients past the cap are summed, not dropped');
  const listed = l.body.clients.reduce((s: number, c: any) => s + c.gross_cents, 0);
  assert.equal(listed + l.body.clients_other.gross_cents, l.body.totals.gross_cents);
  assert.equal(l.body.totals.gross_cents, n * 100);
  assert.equal(e.body.billed_cents, n * 100, 'the overview is not capped');
  assert.equal(l.body.completeness.clients.complete, false, 'the ledger says its client list is capped');
});
