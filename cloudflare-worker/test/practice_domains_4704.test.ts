/** D4704 part 3 (#4704): mounted first use, bounded detail, complete totals and batched private reads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const SECRET = ['d4704', 'domains', 'synthetic', 'fixture'].join('-');
const ADVISOR = 80, CLIENT = 81, OTHER_ADVISOR = 82, OTHER_CLIENT = 83;

function fixture(t: any) {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 13, 12) });
  for (const [id, role] of [[ADVISOR, 'advisor'], [CLIENT, 'founder'], [OTHER_ADVISOR, 'advisor'], [OTHER_CLIENT, 'founder']] as const) {
    db.prepare('INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)')
      .run(id, `domain-user-${id}`, role, `Synthetic ${id}`, `synthetic-${id}@example.test`);
  }
  for (const [id, uid, owner] of [[1, 'practice-one', ADVISOR], [2, 'practice-two', OTHER_ADVISOR]] as const) {
    db.prepare('INSERT INTO advisors (id, uid, user_id, display_name) VALUES (?, ?, ?, ?)').run(id, uid, owner, uid);
  }
  const reads: { sql: string; rows: number }[] = [];
  const raw: any = d1Over(db);
  const hooks: { beforePrepare: ((sql: string) => void) | null } = { beforePrepare: null };
  const tracked = (stmt: any, sql: string): any => new Proxy(stmt, {
    get(target, key) {
      if (key === 'bind') return (...values: any[]) => tracked(target.bind(...values), sql);
      if (key === 'all' || key === 'first') return async (...values: any[]) => {
        const answer = await target[key](...values);
        reads.push({ sql, rows: key === 'all' ? answer.results.length : answer == null ? 0 : 1 });
        return answer;
      };
      return Reflect.get(target, key);
    },
  });
  const env = { DB: { ...raw, prepare: (sql: string) => {
    hooks.beforePrepare?.(sql);
    return tracked(raw.prepare(sql), sql);
  } }, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.onError((_error, c) => c.json({ detail: 'Fixture global error handler' }, 500));
  app.route('/api/advisors', advisors);
  const deferred: Promise<unknown>[] = [];
  const effects = { scheduled: 0 };
  async function call(path: string, who = ADVISOR, method = 'GET', data?: unknown, expectedStatus = 200) {
    const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
      .setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    reads.length = 0;
    const res = await withThrownResponses(() => app.request(`/api/advisors${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }, env, { waitUntil(task: Promise<unknown>) { effects.scheduled += 1; deferred.push(task); }, passThroughOnException() {} } as any));
    const body = await res.json() as any;
    await Promise.allSettled(deferred.splice(0));
    assert.equal(res.status, expectedStatus, JSON.stringify(body));
    return body;
  }
  const engagement = (id: number, advisorId = 1, lane = 'signed', outcome: string | null = 'active') => {
    db.prepare(`INSERT INTO advisor_engagements (id, uid, advisor_id, founder_user_id, client_name, lane, shape, cycles, outcome)
      VALUES (?, ?, ?, ?, ?, ?, 'retainer', 1, ?)`)
      .run(id, `eng-${id}`, advisorId, CLIENT, `Client ${id}`, lane, outcome);
  };
  const deliverable = (id: number, advisorId = 1) => {
    db.prepare(`INSERT INTO advisor_deliverables (id, uid, advisor_id, engagement_id, client_name, title)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, `del-${id}`, advisorId, id, `Client ${id}`, `Work ${id}`);
  };
  const version = (id: number, deliverableId: number, number = 1, recipient: number | null = CLIENT, opened: string | null = null) => {
    db.prepare(`INSERT INTO advisor_deliverable_versions
      (id, uid, deliverable_id, version, link_url, sent_at, recipient_user_id, opened_at)
      VALUES (?, ?, ?, ?, 'https://example.test/synthetic', ?, ?, ?)`)
      .run(id, `ver-${id}`, deliverableId, number, recipient == null ? null : '2026-01-01T00:00:00Z', recipient, opened);
  };
  return { db, reads, call, engagement, deliverable, version, hooks, effects };
}

test('mounted /me routes win over /:uid, and an empty Practice reports empty detail and unknown renewal/open times', async (t) => {
  const f = fixture(t);
  try {
    assert.equal((await f.call('/me')).id, 1);
    const e = await f.call('/me/engagements');
    assert.deepEqual(e.items, []);
    assert.equal(e.page.total, 0);
    assert.equal(e.page.next_offset, null);
    assert.equal(e.totals.active, 0);
    assert.equal(e.totals.renewal_rate, null);
    const d = await f.call('/me/deliverables');
    assert.deepEqual(d.items, []);
    assert.equal(d.totals.work_products, 0);
    assert.equal(d.totals.median_to_open_hours, null);
    assert.equal(d.totals.oldest_never_opened, null);
    const r = await f.call('/received/deliverables', CLIENT);
    assert.deepEqual(r.items, []);
    assert.equal(r.page.total, 0);
    assert.deepEqual(r.totals, { work_products: 0, unread: 0, advisors: 0 });
    assert.deepEqual((await f.call('/me/slots')).items, []);
  } finally { f.db.close(); }
});

test('the booking participant gate refuses the wrong party before any transition or actor record', async (t) => {
  const f = fixture(t);
  try {
    const start = Date.now() + 3 * 86_400_000;
    f.db.prepare(`INSERT INTO advisor_office_hour_slots
      (id, uid, advisor_id, starts_at, ends_at) VALUES (1, 'party-slot', 1, ?, ?)`)
      .run(new Date(start).toISOString(), new Date(start + 3_600_000).toISOString());
    f.db.prepare(`INSERT INTO advisor_bookings
      (id, uid, slot_id, advisor_id, founder_user_id, status) VALUES (1, 'party-booking', 1, 1, ?, 'pending')`).run(CLIENT);
    for (const command of ['confirm', 'complete', 'no-show', 'cancel']) {
      const forbidden = command === 'cancel' ? [OTHER_ADVISOR, OTHER_CLIENT] : [CLIENT, OTHER_ADVISOR, OTHER_CLIENT];
      for (const who of forbidden) {
        await f.call(`/bookings/1/${command}`, who, 'POST', {}, 403);
        assert.equal((f.db.prepare('SELECT status FROM advisor_bookings WHERE id = 1').get() as any).status, 'pending');
        assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE 'advisor_booking_%'").get() as any).n, 0);
        assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action LIKE 'advisor_booking_%'").get() as any).n, 0);
      }
    }
    await f.call('/bookings/999/confirm', ADVISOR, 'POST', {}, 404);
    await f.call('/bookings/1/cancel', CLIENT, 'POST', {});
    assert.equal((f.db.prepare('SELECT status, cancelled_by FROM advisor_bookings WHERE id = 1').get() as any).cancelled_by, 'client');
  } finally { f.db.close(); }
});

test('booking failures retain global error handling and schedule calendars only after a successful write', async (t) => {
  const f = fixture(t);
  try {
    const start = Date.now() + 3 * 86_400_000;
    f.db.prepare(`INSERT INTO advisor_office_hour_slots
      (id, uid, advisor_id, starts_at, ends_at) VALUES (1, 'error-slot', 1, ?, ?)`)
      .run(new Date(start).toISOString(), new Date(start + 3_600_000).toISOString());
    f.db.prepare(`INSERT INTO advisor_bookings
      (id, uid, slot_id, advisor_id, founder_user_id, status) VALUES (1, 'error-booking', 1, 1, ?, 'pending')`).run(CLIENT);
    f.hooks.beforePrepare = (sql) => { if (/UPDATE advisor_bookings SET status/.test(sql)) throw new Error('Synthetic booking write failure'); };
    assert.deepEqual(await f.call('/bookings/1/cancel', CLIENT, 'POST', {}, 500), { detail: 'Fixture global error handler' });
    assert.equal((f.db.prepare('SELECT status FROM advisor_bookings WHERE id = 1').get() as any).status, 'pending');
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE 'advisor_booking_%'").get() as any).n, 0);
    assert.equal(f.effects.scheduled, 0);

    let bookingReads = 0;
    f.hooks.beforePrepare = (sql) => {
      if (/SELECT \* FROM advisor_bookings WHERE id = \?/.test(sql) && ++bookingReads === 2) throw new Error('Synthetic booking response-read failure');
    };
    assert.deepEqual(await f.call('/bookings/1/cancel', CLIENT, 'POST', {}, 500), { detail: 'Fixture global error handler' });
    assert.equal((f.db.prepare('SELECT status FROM advisor_bookings WHERE id = 1').get() as any).status, 'cancelled');
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE 'advisor_booking_%'").get() as any).n, 1);
    assert.equal(f.effects.scheduled, 1, 'calendar cleanup stays scheduled when only the final response read fails');
  } finally { f.db.close(); }
});

test('501 slots consume one grouped occupancy read; mixed prices and public slot privacy survive batching', async (t) => {
  const f = fixture(t);
  try {
    const start = Date.now() + 3 * 86_400_000;
    const insert = f.db.prepare(`INSERT INTO advisor_office_hour_slots
      (id, uid, advisor_id, starts_at, ends_at, capacity, meeting_url, notes) VALUES (?, ?, 1, ?, ?, 9, 'https://example.test/private', 'Private slot note')`);
    for (let id = 1; id <= 501; id++) insert.run(id, `slot-${id}`, new Date(start + id * 60_000).toISOString(), new Date(start + (id + 30) * 60_000).toISOString());
    const book = f.db.prepare(`INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, status, amount_cents)
      VALUES (?, 1, 1, ?, ?, ?)`);
    let bookingClient = 1000;
    for (const [uid, status, amount] of [['paid', 'pending', 5000], ['free', 'confirmed', 0], ['unknown', 'completed', null], ['cancelled', 'cancelled', 9000], ['missed', 'no_show', 9000]] as const) {
      bookingClient += 1;
      f.db.prepare("INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, 'founder', 'Synthetic booking client', ?)")
        .run(bookingClient, `booking-client-${bookingClient}`, `synthetic-${bookingClient}@example.test`);
      book.run(uid, bookingClient, status, amount);
    }
    const own = await f.call('/me/slots');
    assert.equal(own.items.length, 500);
    assert.equal(own.truncated, true);
    assert.equal(own.items[0].taken, 3);
    assert.equal(own.items[0].available, 6);
    assert.equal(own.items[0].booked_pricing, 'mixed');
    const ownReads = f.reads.filter((q) => /FROM advisor_bookings\b/.test(q.sql));
    assert.equal(ownReads.length, 1, 'slot count cannot become serial N+1');
    const publicView = await f.call('/practice-one/slots', CLIENT);
    assert.equal(publicView.items[0].taken, 3);
    assert.equal(publicView.items[0].has_meeting_link, true);
    assert.ok(!('meeting_url' in publicView.items[0]));
    assert.ok(!('notes' in publicView.items[0]));
    assert.ok(!('booked_pricing' in publicView.items[0]));
    assert.equal(f.reads.filter((q) => /GROUP BY slot_id/.test(q.sql)).length, 1);
  } finally { f.db.close(); }
});

test('513 booked public slots keep every count across bounded occupancy batches', async (t) => {
  const f = fixture(t);
  try {
    const start = Date.now() + 3 * 86_400_000;
    const slot = f.db.prepare(`INSERT INTO advisor_office_hour_slots
      (id, uid, advisor_id, starts_at, ends_at, capacity) VALUES (?, ?, 1, ?, ?, 2)`);
    const booking = f.db.prepare(`INSERT INTO advisor_bookings
      (uid, slot_id, advisor_id, founder_user_id, status, amount_cents) VALUES (?, ?, 1, ?, 'confirmed', 0)`);
    for (let id = 1; id <= 513; id++) {
      slot.run(id, `bounded-slot-${id}`, new Date(start + id * 60_000).toISOString(), new Date(start + (id + 30) * 60_000).toISOString());
      booking.run(`bounded-booking-${id}`, id, CLIENT);
    }
    const result = await f.call('/practice-one/slots', CLIENT);
    assert.equal(result.items.length, 513, 'batching never truncates the public list');
    assert.equal(result.items.reduce((sum: number, row: any) => sum + row.taken, 0), 513);
    assert.equal(result.items.at(-1).available, 1, 'the final batch retains occupancy');
    const grouped = f.reads.filter((q) => /GROUP BY slot_id/.test(q.sql));
    assert.equal(grouped.length, 2, 'one query per bounded batch, not per slot');
    assert.deepEqual(grouped.map((q) => q.rows), [512, 1], 'no occupancy response exceeds the batch ceiling');
  } finally { f.db.close(); }
});

test('401 engagements keep whole-practice totals while SQL returns only the requested page', async (t) => {
  const f = fixture(t);
  try {
    for (let id = 1; id <= 401; id++) f.engagement(id, 1, id === 401 ? 'ended' : 'signed', id === 401 ? 'ended' : 'renewed');
    f.engagement(402, 2, 'signed', 'renewed');
    const first = await f.call('/me/engagements?limit=400');
    assert.equal(first.items.length, 400);
    assert.equal(first.page.total, 401);
    assert.equal(first.page.next_offset, 400);
    assert.equal(first.totals.active, 400);
    assert.equal(first.totals.decided, 401);
    assert.equal(first.totals.ended_by_reason.not_recorded, 1);
    assert.equal(first.population.complete, true);
    assert.ok(first.items.every((i: any) => i.advisor_id === 1));
    assert.ok(f.reads.filter((q) => /SELECT \* FROM advisor_engagements/.test(q.sql)).every((q) => q.rows <= 400));
    const last = await f.call('/me/engagements?limit=400&offset=400');
    assert.equal(last.items.length, 1);
    assert.equal(last.page.next_offset, null);
    assert.deepEqual(last.totals, first.totals);
    assert.equal(new Set([...first.items, ...last.items].map((i: any) => i.id)).size, 401);
  } finally { f.db.close(); }
});

test('a history beyond both old caps is one ordered, non-overlapping timeline', async (t) => {
  const f = fixture(t);
  try {
    f.engagement(1);
    for (let id = 1; id <= 201; id++) {
      f.db.prepare(`INSERT INTO advisor_engagement_events
        (uid, engagement_id, kind, from_lane, to_lane, cycles_before, cycles_after, created_at)
        VALUES (?, 1, 'renewed', 'signed', 'signed', ?, ?, ?)`)
        .run(`history-${id}`, id, id + 1, new Date(Date.UTC(2026, 0, 1) + id * 60_000).toISOString());
      f.db.prepare(`INSERT INTO advisor_engagement_corrections
        (uid, engagement_id, lane, reason, changes_json, corrected_by_user_id, created_at)
        VALUES (?, 1, 'signed', 'Synthetic correction', '[{"field":"scope_label","from":null,"to":"Recorded"}]', ?, ?)`)
        .run(`correction-${id}`, ADVISOR, new Date(Date.UTC(2026, 0, 1) + id * 60_000 + 30_000).toISOString());
    }
    const defaultPage = await f.call('/me/engagements/1/events');
    assert.equal(defaultPage.items.length, 400, 'the combined default preserves the previous maximum response size');
    assert.equal(defaultPage.page.next_offset, 400);
    const items: any[] = [];
    let offset: number | null = 0;
    while (offset != null) {
      const page = await f.call(`/me/engagements/1/events?limit=200&offset=${offset}`);
      assert.equal(page.page.total, 402);
      assert.ok(page.items.length <= 200);
      items.push(...page.items); offset = page.page.next_offset;
    }
    assert.equal(items.length, 402);
    assert.equal(new Set(items.map((i) => i.uid)).size, 402);
    assert.equal(items[0].uid, 'history-1');
    assert.equal(items[401].uid, 'correction-201');
    assert.ok(items.every((item, i) => i === 0 || item.created_at >= items[i - 1].created_at));
    assert.deepEqual(items[1].changes, [{ field: 'scope_label', from: null, to: 'Recorded' }]);
    assert.ok(!('changes' in items[0]));
    assert.ok(!('cycles_after' in items[1]));
  } finally { f.db.close(); }
});

test('median opening time preserves millisecond arithmetic and rounding at half a tenth of an hour', async (t) => {
  const f = fixture(t);
  try {
    for (const [id, opened] of [[1, '2026-01-01T00:03:00Z'], [2, '2026-01-01T00:03:00Z']] as const) {
      f.engagement(id); f.deliverable(id); f.version(id, id, 1, CLIENT, opened);
    }
    const first = await f.call('/me/deliverables?limit=1');
    assert.equal(first.totals.median_to_open_hours, 0.1);
    assert.equal(first.totals.opened, 2);
    f.db.prepare('UPDATE advisor_deliverable_versions SET opened_at = ? WHERE id = 2').run('2026-01-01T00:09:00Z');
    assert.equal((await f.call('/me/deliverables')).totals.median_to_open_hours, 0.1, 'even populations average the two middle intervals');
    f.engagement(3); f.deliverable(3); f.version(3, 3, 1, CLIENT, '2026-01-01T10:00:00Z');
    assert.equal((await f.call('/me/deliverables')).totals.median_to_open_hours, 0.2, 'an outlier cannot turn the median into the average');
  } finally { f.db.close(); }
});

test('401 work products keep complete metrics and recipient totals; versions are read once per bounded page', async (t) => {
  const f = fixture(t);
  try {
    for (let id = 1; id <= 401; id++) {
      f.engagement(id); f.deliverable(id); f.version(id, id, 1, CLIENT, id === 1 ? '2026-01-01T02:00:00Z' : null);
    }
    // A relink cannot move an already sent version. Nor may a later draft or
    // another client's sent version enter this client's list or state.
    f.db.prepare('UPDATE advisor_engagements SET founder_user_id = ? WHERE id = 1').run(OTHER_CLIENT);
    f.version(402, 1, 2, null);
    f.db.prepare('UPDATE advisor_deliverable_versions SET ready_at = ?, ready_by_user_id = ? WHERE id = 402')
      .run('2026-01-02T00:00:00Z', ADVISOR);
    f.version(403, 1, 3, OTHER_CLIENT, '2026-01-01T04:00:00Z');
    f.engagement(402, 2); f.deliverable(402, 2); f.version(404, 402, 1, OTHER_CLIENT);
    const own = await f.call('/me/deliverables?limit=400');
    assert.equal(own.items.length, 400);
    assert.ok(own.items.every((i: any) => i.advisor_id === 1));
    assert.equal(own.page.total, 401);
    assert.equal(own.totals.work_products, 401);
    assert.equal(own.totals.clients, 401);
    assert.equal(own.totals.opened, 1);
    assert.equal(own.totals.unopened, 400);
    assert.equal(own.totals.addressable, 400);
    assert.equal(own.totals.ready, 1, 'ready draft and opened work are independent facts');
    assert.equal(own.totals.median_to_open_hours, 2, 'first opened version defines the interval');
    assert.ok(f.reads.filter((q) => /SELECT d\.\*/.test(q.sql)).every((q) => q.rows <= 400));
    const last = await f.call('/me/deliverables?limit=400&offset=400');
    assert.equal(last.items.length, 1);
    assert.deepEqual(last.totals, own.totals);
    const received = await f.call('/received/deliverables?limit=400', CLIENT);
    assert.equal(received.page.total, 401);
    assert.equal(received.items.length, 400);
    assert.deepEqual(received.totals, { work_products: 401, unread: 400, advisors: 1 });
    assert.equal(f.reads.filter((q) => /SELECT \* FROM advisor_deliverable_versions/.test(q.sql)).length, 1);
    const receivedLast = await f.call('/received/deliverables?limit=400&offset=400', CLIENT);
    assert.deepEqual(receivedLast.totals, received.totals);
    const all = [...received.items, ...receivedLast.items];
    assert.equal(new Set(all.map((i: any) => i.uid)).size, 401);
    const first = all.find((i: any) => i.uid === 'del-1');
    assert.equal(first.version_count, 1);
    assert.equal(first.versions[0].version, 1);
    assert.equal(first.state, 'opened');
    assert.ok(!('recipient_user_id' in first.versions[0]), 'client DTO never reveals other recipient identities');
    const beyond = await f.call('/received/deliverables?offset=999', CLIENT);
    assert.deepEqual(beyond.items, []);
    assert.equal(beyond.page.next_offset, null);
    assert.deepEqual(beyond.totals, received.totals);
  } finally { f.db.close(); }
});
