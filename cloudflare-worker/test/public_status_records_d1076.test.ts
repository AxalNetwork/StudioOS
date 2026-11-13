/**
 * D1076 (#2968) — `GET /api/public/status` says what is recorded: a day before
 * the service's records began is `not_recorded`, never operational; a recorded
 * day with no incident is `no_incident`; and no row carries a percentage of
 * uptime, because nothing measures one (owner question 7, A).
 *
 * The clock is pinned, so the window's days before records began stay in it
 * whatever day the suite runs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/public_status_records_d1076.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import publicRoutes, { STATUS_RECORDS_SINCE } from '../src/routes/public.ts';

const BOUND = {
  TOKENS: {}, RATE_LIMITS: {}, PIPELINE_ROOM: {}, ONBOARDING_CHAT: {}, AI: {}, FILES: {},
  VECTORIZE: {}, JOB_QUEUE: {}, PUBLICATIONS: {}, BACKUPS: {}, BROWSER: {},
};
// Ten days after records began: the 90-day window holds 80 days before it and 11 from it on.
const NOW = Date.parse(`${STATUS_RECORDS_SINCE}T12:00:00Z`) + 10 * 86400000;
const day = (offset: number) => new Date(Date.parse(`${STATUS_RECORDS_SINCE}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);

async function status(t: any, seed = '') {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in tests'); }) as typeof fetch;
  try {
    const env: any = { ...makeD1('SELECT 1;', ''), ...BOUND };
    await publicRoutes.request('/status', {}, env);
    if (seed) env.db.exec(seed);
    const res = await publicRoutes.request('/status', {}, env);
    assert.equal(res.status, 200);
    return { body: (await res.json()) as any, text: '' };
  } finally {
    globalThis.fetch = realFetch;
    t.mock.timers.reset();
  }
}

test('a day before records began is not_recorded, never operational; a recorded day with no incident is no_incident', async (t) => {
  const { body } = await status(t);
  const monitored = body.services.filter((s: any) => !s.monitoring);
  assert.ok(monitored.length >= 10);
  for (const s of monitored) {
    assert.equal(s.history.length, 90, s.name);
    assert.equal(s.records_since, STATUS_RECORDS_SINCE, s.name);
    for (const c of s.history) {
      assert.equal(c.status, c.day < STATUS_RECORDS_SINCE ? 'not_recorded' : 'no_incident', `${s.name} ${c.day}`);
    }
    assert.equal(s.history.find((c: any) => c.day === day(-1)).status, 'not_recorded', 'the day before records began');
    assert.equal(s.history.find((c: any) => c.day === day(0)).status, 'no_incident', 'the day records began');
    assert.equal(s.days_recorded, 11, s.name);
    assert.equal(s.days_without_incident, 11, s.name);
    // The live state is the probe's, as before: it is not the history.
    assert.equal(s.status, 'operational', s.name);
  }
});

test('no row carries a percentage of uptime, and no cell says operational', async (t) => {
  const { body } = await status(t);
  const json = JSON.stringify(body.services.map((s: any) => ({ ...s, status: undefined })));
  assert.doesNotMatch(json, /uptime/i);
  assert.doesNotMatch(json, /"operational"/, 'a history cell is never "operational"');
  for (const s of body.services) assert.equal('uptime_pct' in s, false, s.name);
});

test('an incident paints its days, counted out of the days with no incident; before records began it still shows, as a record', async (t) => {
  const seed = `INSERT INTO status_incidents (title, status, severity, affected_services, created_at, resolved_at)
      VALUES ('Uploads slow', 'resolved', 'minor', '["R2"]', '${day(3)} 09:00:00', '${day(4)} 10:00:00'),
             ('Old outage', 'resolved', 'critical', '["R2"]', '${day(-5)} 09:00:00', '${day(-5)} 11:00:00');`;
  const { body } = await status(t, seed);
  const files = body.services.find((s: any) => s.name === 'File storage');
  const at = (d: string) => files.history.find((c: any) => c.day === d).status;
  assert.equal(at(day(3)), 'degraded');
  assert.equal(at(day(4)), 'degraded');
  assert.equal(at(day(5)), 'no_incident');
  assert.equal(at(day(-5)), 'down', 'an incident entered for a day is a record of that day');
  assert.equal(at(day(-6)), 'not_recorded');
  assert.equal(files.days_recorded, 11);
  assert.equal(files.days_without_incident, 9, 'two of the eleven recorded days had an incident');
  const search = body.services.find((s: any) => s.name === 'Search');
  assert.equal(search.days_without_incident, 11, 'an incident on File storage leaves Search alone');
});

test('an unmonitored row keeps no history and no count', async (t) => {
  const { body } = await status(t);
  const rows = body.services.filter((s: any) => s.monitoring === 'not_monitored');
  assert.ok(rows.length > 0);
  for (const s of rows) {
    assert.deepEqual([s.records_since, s.days_recorded, s.days_without_incident], [null, null, null], s.name);
    assert.ok(s.history.every((c: any) => c.status === 'unknown'), s.name);
  }
});
