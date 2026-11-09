/**
 * D5203 (#5203) — the calendar reads its sources in bounded parallel, and the
 * member's own read has a bounded window.
 *
 *   1. One slow source does not hold the others: every independent reader has
 *      started before the slow one answers.
 *   2. A slow connected calendar never holds an Axal (D1) source's slot.
 *   3. One rejection, even a synchronous throw, keeps every source that answered.
 *   4. The order is a serial read's, whatever order the reads finished in.
 *   5. Concurrency is bounded per lane, and over the production table too.
 *   6. Asking for some kinds runs only their readers.
 *   7. NoSource is omitted, `truncated` and a provider's error code survive.
 *   8. The timing names kind, ms, ok and a count, never a payload.
 *   9. `GET /calendar/events` refuses an empty, reversed or over-wide window.
 *
 * Readers here are synthetic; the route test runs on in-memory SQLite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import {
  gatherSources, personalWindowRefusal, PERSONAL_WINDOW_MAX_DAYS, KNOWN_KINDS, NETWORK_KINDS,
  CALENDAR_LOCAL_CONCURRENCY, CALENDAR_NETWORK_CONCURRENCY,
  type CalendarEvent, type CalendarGatherTiming,
} from '../src/services/calendar.ts';
import { runBounded } from '../src/services/calendar/gatherPool.ts';
import { NoSource, ExternalReadError } from '../src/services/calendar/externalReaders.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const FROM = '2026-11-01T00:00:00.000Z', TO = '2026-12-01T00:00:00.000Z';
const env: any = {};
const quiet = { onTiming: () => {} };
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async (n = 50) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const ev = (kind: string, n: number, start: string): CalendarEvent => ({
  id: `${kind}:${n}`, kind: kind as CalendarEvent['kind'], source_id: n, title: `Private title ${kind} ${n}`,
  start_at: start, end_at: start, status: 'scheduled', location_kind: null, location_uri: null,
  organizer_email: 'private@example.test', attendees: [], notes: 'private note', project_id: null,
} as any);

test('1. one slow source does not serialize the others', async () => {
  const started: string[] = [];
  const slow = deferred<CalendarEvent[]>();
  const readers: any = {
    ic_meeting: async () => { started.push('ic_meeting'); return slow.promise; },
    founder_checkin: async () => { started.push('founder_checkin'); return [ev('founder_checkin', 1, '2026-11-02T10:00:00Z')]; },
    manual: async () => { started.push('manual'); return [ev('manual', 2, '2026-11-03T10:00:00Z')]; },
  };
  let done = false;
  const run = gatherSources(readers, env, 1, FROM, TO, undefined, {}, quiet).then((r) => { done = true; return r; });
  for (let i = 0; i < 2000 && started.length < 3; i++) await flush(1);
  assert.deepEqual(started.sort(), ['founder_checkin', 'ic_meeting', 'manual'], 'every reader started while the slow one is still pending');
  assert.equal(done, false, 'the read waits for the slow source');
  slow.resolve([ev('ic_meeting', 3, '2026-11-01T10:00:00Z')]);
  const { events, sources } = await run;
  assert.deepEqual(events.map((e) => e.id), ['ic_meeting:3', 'founder_checkin:1', 'manual:2']);
  assert.ok(sources.every((s) => s.ok));
});

test('2. a slow connected calendar never holds an Axal source', async () => {
  const google = deferred<CalendarEvent[]>();
  const finished: string[] = [];
  // Google first in the table: in one shared lane it would take the only slot before any D1 reader.
  const readers: any = {
    external_google: async () => google.promise,
    ic_meeting: async () => { await flush(1); finished.push('ic_meeting'); return []; },
    founder_checkin: async () => { await flush(1); finished.push('founder_checkin'); return []; },
    manual: async () => { await flush(1); finished.push('manual'); return []; },
  };
  // One local slot: if Google shared it, the three D1 readers would wait behind it.
  const run = gatherSources(readers, env, 1, FROM, TO, undefined, {}, { ...quiet, limits: { local: 1, network: 1 } });
  // Google never answers until released below, so in a shared lane this waits out its bound and fails.
  for (let i = 0; i < 2000 && finished.length < 3; i++) await flush(1);
  assert.deepEqual(finished, ['ic_meeting', 'founder_checkin', 'manual'], 'every D1 source finished while Google is still reading');
  google.resolve([]);
  await run;
  assert.deepEqual([...NETWORK_KINDS].sort(), ['external_google', 'external_microsoft']);
});

test('3. one rejection keeps the sources that answered, and is that source\'s alone', async () => {
  const warn = console.warn; const warned: unknown[][] = []; console.warn = (...a: unknown[]) => { warned.push(a); };
  try {
    const readers: any = {
      ic_meeting: async () => { throw new Error('synthetic private row must not escape'); },
      founder_checkin: async () => [ev('founder_checkin', 1, '2026-11-02T10:00:00Z')],
      manual: () => { throw new Error('synchronous'); },
      advisor_booking: async () => { throw new Error('no such table: advisor_bookings'); },
    };
    const { events, sources } = await gatherSources(readers, env, 1, FROM, TO, undefined, {}, quiet);
    assert.deepEqual(events.map((e) => e.id), ['founder_checkin:1']);
    assert.deepEqual(sources, [
      { kind: 'ic_meeting', ok: false, error: 'unreadable' },
      { kind: 'founder_checkin', ok: true, error: null },
      { kind: 'manual', ok: false, error: 'unreadable' },
      { kind: 'advisor_booking', ok: false, error: 'not_configured' },
    ]);
    assert.ok(!JSON.stringify(warned).includes('synthetic private row'), 'the log names the kind and outcome, never the error text');
  } finally { console.warn = warn; }
});

test('4. the order is the serial order, whatever order the reads finished in', async () => {
  const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
  const same = '2026-11-05T10:00:00Z';
  const readers: any = {
    ic_meeting: async () => { await gates[0].promise; return [ev('ic_meeting', 1, same), ev('ic_meeting', 2, '2026-11-01T09:00:00Z')]; },
    founder_checkin: async () => { await gates[1].promise; return [ev('founder_checkin', 3, same)]; },
    manual: async () => { await gates[2].promise; return [ev('manual', 4, same)]; },
  };
  const run = gatherSources(readers, env, 1, FROM, TO, undefined, {}, quiet);
  await flush();
  gates[2].resolve(); await flush(); gates[1].resolve(); await flush(); gates[0].resolve();
  const { events, sources } = await run;
  assert.deepEqual(events.map((e) => e.id), ['ic_meeting:2', 'ic_meeting:1', 'founder_checkin:3', 'manual:4'], 'ties keep the reader order');
  assert.deepEqual(sources.map((s) => s.kind), ['ic_meeting', 'founder_checkin', 'manual'], 'sources keep the reader order');
});

test('5. concurrency is bounded per lane, and over the production table', async () => {
  let inFlight = 0, peak = 0;
  const kinds = Array.from({ length: 20 }, (_, i) => `k${i}`);
  const out = await runBounded(kinds, 3, async (k) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1 + (Number(k.slice(1)) % 4)));
    inFlight--; return k;
  });
  assert.equal(peak, 3, 'never more than the limit, and the limit is used');
  assert.deepEqual(out.map((o) => o.ok && o.value), kinds, 'outcomes in the given order');

  // Every production kind, each reader held open: at most LOCAL + NETWORK in flight at once.
  let live = 0, most = 0; const gate = deferred<void>();
  const readers: any = Object.fromEntries(KNOWN_KINDS.map((k) => [k, async () => { live++; most = Math.max(most, live); await gate.promise; live--; return []; }]));
  const run = gatherSources(readers, env, 1, FROM, TO, undefined, {}, quiet);
  for (let i = 0; i < 200 && most === 0; i++) await flush(1);
  await flush(20);
  assert.equal(most, CALENDAR_LOCAL_CONCURRENCY + CALENDAR_NETWORK_CONCURRENCY);
  assert.ok(KNOWN_KINDS.length > most, 'the table is wider than the pool, so the bound is real');
  gate.resolve();
  const { sources } = await run;
  assert.equal(sources.length, KNOWN_KINDS.length);
});

test('6. selected kinds run only their readers', async () => {
  const called: string[] = [];
  const readers: any = Object.fromEntries(KNOWN_KINDS.map((k) => [k, async () => { called.push(k); return []; }]));
  const { sources } = await gatherSources(readers, env, 1, FROM, TO, ['advisor_booking', 'partner_office_hour', 'not_a_kind'], {}, quiet);
  assert.deepEqual(called.sort(), ['advisor_booking', 'partner_office_hour']);
  assert.deepEqual(sources.map((s) => s.kind), ['advisor_booking', 'partner_office_hour']);
});

test('7. NoSource is omitted; truncated and a provider code survive', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const truncated = Object.assign([ev('external_google', 1, '2026-11-02T10:00:00Z')], { truncated: true });
    const readers: any = {
      external_google: async () => truncated,
      external_microsoft: async () => { throw new ExternalReadError('reconnect'); },
      manual: async () => { throw new NoSource(); },
    };
    const { sources } = await gatherSources(readers, env, 1, FROM, TO, undefined, {}, quiet);
    assert.deepEqual(sources, [
      { kind: 'external_google', ok: true, error: null, truncated: true },
      { kind: 'external_microsoft', ok: false, error: 'reconnect' },
    ]);
  } finally { console.warn = warn; }
});

test('8. the timing names kind, ms, ok and a count, never a payload', async () => {
  const warn = console.warn; console.warn = () => {};
  let clock = 1000; const timings: CalendarGatherTiming[] = [];
  try {
    const readers: any = {
      ic_meeting: async () => { clock += 40; return [ev('ic_meeting', 1, '2026-11-02T10:00:00Z'), ev('ic_meeting', 2, '2026-11-03T10:00:00Z')]; },
      manual: async () => { clock += 5; throw new Error('Private title in an error'); },
    };
    await gatherSources(readers, env, 1, FROM, TO, undefined, {}, { onTiming: (t) => timings.push(t), now: () => clock });
  } finally { console.warn = warn; }
  assert.equal(timings.length, 1);
  const [t] = timings;
  assert.ok(t.ms >= 45, 'the aggregate covers the reads');
  assert.deepEqual(t.sources.map((s) => Object.keys(s).sort()), [['count', 'kind', 'ms', 'ok'], ['count', 'kind', 'ms', 'ok']]);
  assert.deepEqual(t.sources.map(({ kind, ok, count }) => ({ kind, ok, count })), [{ kind: 'ic_meeting', ok: true, count: 2 }, { kind: 'manual', ok: false, count: 0 }]);
  assert.ok(t.sources.every((s) => s.ms >= 0));
  assert.doesNotMatch(JSON.stringify(t), /Private|private|example\.test/);
});

test('9a. the personal window: ordered, non-empty, at most PERSONAL_WINDOW_MAX_DAYS', () => {
  const day = 86_400_000, at = (ms: number) => new Date(Date.parse(FROM) + ms).toISOString();
  assert.equal(PERSONAL_WINDOW_MAX_DAYS, 180);
  assert.equal(personalWindowRefusal(FROM, FROM), 'invalid_window', 'an empty window');
  assert.equal(personalWindowRefusal(TO, FROM), 'invalid_window', 'a reversed window');
  assert.equal(personalWindowRefusal('not a date', TO), 'invalid_window');
  assert.equal(personalWindowRefusal(FROM, at(180 * day)), null, 'exactly the maximum is read');
  assert.equal(personalWindowRefusal(FROM, at(180 * day + 1)), 'window_too_wide');
  assert.equal(personalWindowRefusal(FROM, at(2 * 365 * day)), 'window_too_wide', 'the old two-year Grow read');
  // Month, Week and Agenda (calendarViews.windowFor) all fit, with an hour of DST to spare.
  for (const span of [31, 7, 90]) assert.equal(personalWindowRefusal(FROM, at(span * day + 3_600_000)), null);
});

const SECRET = 'synthetic-calendar-d5203-'.repeat(3);
function routeFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  loadSchema(db);
  db.exec(`INSERT INTO users(id,role,name,email,is_active) VALUES (1,'founder','Fixture founder','one@example.test',1)`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production', APP_URL: 'https://axal.vc' };
  return async (query: string) => {
    const token = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const ctx: any = { waitUntil() {}, passThroughOnException() {} };
    return calendar.request(`/events${query}`, { headers: { Cookie: `studioos_auth=${token}`, Origin: 'https://axal.vc' } }, env, ctx);
  };
}

test('9b. GET /calendar/events refuses an empty, reversed or over-wide personal window', async () => {
  const info = console.info; console.info = () => {};
  try {
    const get = routeFixture();
    const day = 86_400_000, at = (ms: number) => new Date(Date.parse(FROM) + ms).toISOString();
    for (const [q, code] of [
      [`?from=${FROM}&to=${FROM}`, 'invalid_window'],
      [`?from=${TO}&to=${FROM}`, 'invalid_window'],
      [`?from=${FROM}&to=${at(181 * day)}`, 'window_too_wide'],
      [`?from=${FROM}&to=${at(2 * 365 * day)}&kinds=manual`, 'window_too_wide'],
    ] as const) {
      const res = await get(q);
      assert.equal(res.status, 400, q);
      const body: any = await res.json();
      assert.equal(body.error, code, q);
      assert.ok(typeof body.message === 'string' && body.message.length > 0);
    }
    const ok = await get(`?from=${FROM}&to=${at(180 * day)}&kinds=manual`);
    assert.equal(ok.status, 200, 'the maximum window is read');
    const okBody: any = await ok.json();
    assert.deepEqual(okBody.sources.map((s: any) => s.kind), ['manual'], 'only the kind asked for was read');
    assert.equal((await get('')).status, 200, 'the default window (a day back, 90 ahead) is read');
  } finally { console.info = info; }
});
