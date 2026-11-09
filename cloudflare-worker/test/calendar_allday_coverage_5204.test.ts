/**
 * D5204 (#5204, part 4 of 7 of the Calendar audit, of #3723) — the all-day contract, and coverage the server
 * derives from the sources it actually attempted.
 *
 *   1. A Google date-only event says `all_day`, carries its own dates, and keeps the EXCLUSIVE end Google gives.
 *   2. A Graph `isAllDay` event does the same; a timed event from either provider says nothing of the sort.
 *   3. Coverage counts what was attempted: answered, failed, hidden, complete, and the kinds that were capped.
 *   4. A source the member hid is not attempted, so it cannot inflate the denominator.
 *   5. A provider with no connection (`NoSource`) is neither attempted nor failed.
 *   6. A capped read is `truncated` and makes coverage incomplete, even though every source answered.
 *   7. A kind added to the registry changes coverage with no constant to update anywhere.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import calendar from '../src/routes/calendar.ts';
import { MAX_PAGES, PAGE_SIZE } from '../src/services/calendar/externalReaders.ts';
import { SOURCE_KINDS } from '../src/services/calendar/registry.ts';

after(removeMigratedDatabases);

const SECRET = 'synthetic-calendar-5204-secret-'.repeat(2);
const FROM = '2026-11-01T00:00:00.000Z';
const TO = '2026-12-01T00:00:00.000Z';
const ADDRESS = 'member-5204@example.test';

function fixture({ google = true, microsoft = true } = {}) {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES (1,'founder','Fixture founder','${ADDRESS}',101,1);
   INSERT INTO calendar_events(id,uid,user_id,source,kind,external_uri,title,start_at,end_at,status) VALUES
    (7,'axal:manual:seven',1,'manual','other','axal:manual:seven','Axal own event','2026-11-05T09:00:00.000Z','2026-11-05T10:00:00.000Z','scheduled');`);
  if (google) {
    db.prepare('INSERT INTO google_oauth_tokens(user_id,refresh_token,scope,google_email) VALUES (1,?,?,?)')
      .run('synthetic-google-refresh', 'https://www.googleapis.com/auth/calendar.readonly', ADDRESS);
  }
  if (microsoft) {
    db.prepare('INSERT INTO microsoft_oauth_tokens(user_id,refresh_token,scope,microsoft_email) VALUES (1,?,?,?)')
      .run('synthetic-microsoft-refresh', 'Calendars.Read offline_access', ADDRESS);
  }
  const DB = {
    prepare(sql: string) {
      let args: any[] = [];
      const stmt: any = {
        bind(...values: any[]) { args = values.map((v) => v ?? null); return stmt; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
        async raw() { return db.prepare(sql).all(...args).map((r: any) => Object.values(r)); },
      };
      return stmt;
    },
    async exec(sql: string) { db.exec(sql); },
    async batch(list: any[]) { return Promise.all(list.map((s) => s.run())); },
  };
  const env: any = {
    DB, JWT_SECRET: SECRET, ENVIRONMENT: 'production', APP_URL: 'https://axal.vc',
    GOOGLE_CLIENT_ID: 'synthetic-google-client', GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
    MICROSOFT_CLIENT_ID: 'synthetic-ms-client', MICROSOFT_CLIENT_SECRET: 'synthetic-ms-secret',
  };
  const app = new Hono<any>();
  app.route('/api/calendar', calendar);
  app.onError((e: any, c) => (e.message === 'Unauthorized' ? c.json({ detail: 'Not authenticated' }, 401) : c.json({ error: e.message }, 500)));
  const ctx: any = { waitUntil() {}, passThroughOnException() {} };
  async function events(query = '') {
    const token = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/calendar/events?from=${FROM}&to=${TO}${query}`, {
      headers: { Cookie: `studioos_auth=${token}`, Origin: 'https://axal.vc' },
    }, env, ctx);
    return { status: res.status, body: JSON.parse(await res.text()) };
  }
  return { db, env, events, close: () => db.close() };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function stubFetch(answer: (url: URL) => Response | Promise<Response>) {
  const was = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    seen.push(url.toString());
    return answer(url);
  }) as any;
  return { seen, restore: () => { globalThis.fetch = was; } };
}
const tokenHosts = (url: URL) => url.host === 'oauth2.googleapis.com' || url.host === 'login.microsoftonline.com';
const itemOf = (body: any, id: string) => (body.items || []).find((i: any) => i.source_uid === id) ?? null;
const sourceOf = (body: any, kind: string) => (body.sources || []).find((s: any) => s?.kind === kind) ?? null;

test('1: a Google date-only event is all-day, with its own dates and Google\'s exclusive end', async () => {
  const f = fixture({ microsoft: false });
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') {
      return json({ items: [
        // One day: Google states the 9th to the 10th, the end exclusive.
        { id: 'g-allday', iCalUID: 'a@g.test', summary: 'Offsite', status: 'confirmed', start: { date: '2026-11-09' }, end: { date: '2026-11-10' } },
        // Three days: the 12th to the 14th, stated as ending on the 15th.
        { id: 'g-span', iCalUID: 'b@g.test', summary: 'Retreat', status: 'confirmed', start: { date: '2026-11-12' }, end: { date: '2026-11-15' } },
        // Timed, for contrast.
        { id: 'g-timed', iCalUID: 'c@g.test', summary: 'Call', status: 'confirmed', start: { dateTime: '2026-11-10T15:00:00Z' }, end: { dateTime: '2026-11-10T16:00:00Z' } },
      ] });
    }
    return json({}, 404);
  });
  try {
    const r = await f.events();
    const one = itemOf(r.body, 'g-allday');
    assert.equal(one.all_day, true, 'a date-only event does not say it is all-day');
    assert.equal(one.start_date, '2026-11-09');
    assert.equal(one.end_date, '2026-11-10', 'Google\'s exclusive end was not preserved');
    const span = itemOf(r.body, 'g-span');
    assert.deepEqual([span.all_day, span.start_date, span.end_date], [true, '2026-11-12', '2026-11-15']);
    const timed = itemOf(r.body, 'g-timed');
    assert.ok(!timed.all_day, 'a timed event was called all-day');
    assert.equal(timed.start_date, undefined);
    // The date never passes through an instant: no 'T' and no zone is added to it.
    assert.ok(!/T/.test(String(one.start_date)) && !/T/.test(String(one.end_date)));
  } finally { world.restore(); f.close(); }
});

test('2: a Graph isAllDay event is all-day too, and a timed one is not', async () => {
  const f = fixture({ google: false });
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'graph.microsoft.com') {
      return json({ value: [
        { id: 'm-allday', iCalUId: 'd@o.test', subject: 'Leave', isCancelled: false, isAllDay: true,
          start: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-10T00:00:00.0000000', timeZone: 'UTC' } },
        { id: 'm-timed', iCalUId: 'e@o.test', subject: 'Sync', isCancelled: false, isAllDay: false,
          start: { dateTime: '2026-11-11T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-11T16:00:00.0000000', timeZone: 'UTC' } },
      ] });
    }
    return json({}, 404);
  });
  try {
    const r = await f.events();
    const all = itemOf(r.body, 'm-allday');
    assert.deepEqual([all.all_day, all.start_date, all.end_date], [true, '2026-11-09', '2026-11-10']);
    assert.ok(!itemOf(r.body, 'm-timed').all_day);
  } finally { world.restore(); f.close(); }
});

test('3: coverage counts what was attempted, and says when it is not complete', async () => {
  const f = fixture();
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ items: [] });
    if (url.host === 'graph.microsoft.com') return json({ value: [] });
    return json({}, 404);
  });
  try {
    const r = await f.events();
    const c = r.body.coverage;
    assert.ok(c, 'the read reports no coverage');
    assert.equal(c.attempted, r.body.sources.length, 'attempted is not the set it read');
    assert.equal(c.answered + c.failed, c.attempted, 'the parts do not add up to the whole');
    assert.equal(c.hidden, 0);
    assert.equal(c.complete, c.failed === 0, 'complete does not follow the failures');
    assert.equal(c.truncated_kinds, undefined, 'nothing was capped, yet some kind is listed');
    // Every attempted source is one the registry knows: the denominator is not a number from nowhere.
    for (const s of r.body.sources) assert.ok((SOURCE_KINDS as readonly string[]).includes(s.kind), `${s.kind} is not a registry source`);
  } finally { world.restore(); f.close(); }
});

test('4: a source the member hid is not attempted, so it cannot inflate the denominator', async () => {
  const f = fixture();
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ items: [] });
    if (url.host === 'graph.microsoft.com') return json({ value: [] });
    return json({}, 404);
  });
  try {
    const before = (await f.events()).body.coverage;
    f.db.prepare("INSERT INTO calendar_source_prefs(user_id, source_key, shown) VALUES (1, 'ic_meeting', 0)").run();
    f.db.prepare("INSERT INTO calendar_source_prefs(user_id, source_key, shown) VALUES (1, 'manual', 0)").run();
    const after = (await f.events()).body.coverage;
    assert.equal(after.hidden, 2, 'the hidden sources are not counted as hidden');
    assert.equal(after.attempted, before.attempted - 2, 'a hidden source was still attempted');
    assert.ok(!(await f.events()).body.sources.some((s: any) => s.kind === 'ic_meeting'), 'a hidden source answered anyway');
  } finally { world.restore(); f.close(); }
});

test('5: a provider with no connection is neither attempted nor failed', async () => {
  const both = fixture();
  const w1 = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ items: [] });
    if (url.host === 'graph.microsoft.com') return json({ value: [] });
    return json({}, 404);
  });
  let withBoth: any;
  try { withBoth = (await both.events()).body.coverage; } finally { w1.restore(); both.close(); }

  const one = fixture({ microsoft: false });
  const w2 = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ items: [] });
    return json({}, 404);
  });
  try {
    const r = await one.events();
    assert.equal(r.body.coverage.attempted, withBoth.attempted - 1, 'a disconnected provider was still attempted');
    assert.equal(r.body.coverage.failed, 0, 'a disconnected provider was counted as failed');
    assert.equal(sourceOf(r.body, 'external_microsoft'), null);
  } finally { w2.restore(); one.close(); }
});

test('6: a read capped at its page limit is truncated, and coverage is not complete', async () => {
  const f = fixture({ microsoft: false });
  const page = (n: number) => ({
    items: Array.from({ length: PAGE_SIZE }, (_, i) => ({
      id: `g${n}-${i}`, iCalUID: `g${n}-${i}@g.test`, summary: 'Busy', status: 'confirmed',
      start: { dateTime: '2026-11-10T15:00:00Z' }, end: { dateTime: '2026-11-10T16:00:00Z' },
    })),
    nextPageToken: 'more',
  });
  let asked = 0;
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    // Every page says there is another, so the reader stops at its own cap with more to give.
    if (url.host === 'www.googleapis.com') { asked += 1; return json(page(asked)); }
    return json({}, 404);
  });
  try {
    const r = await f.events();
    assert.equal(asked, MAX_PAGES, `it read ${asked} pages, not its cap of ${MAX_PAGES}`);
    const g = sourceOf(r.body, 'external_google');
    assert.equal(g.ok, true, 'a capped read was reported as a failure');
    assert.equal(g.truncated, true, 'a capped read is not marked truncated');
    assert.equal(r.body.items.filter((i: any) => i.kind === 'external_google').length, MAX_PAGES * PAGE_SIZE);
    const c = r.body.coverage;
    assert.deepEqual(c.truncated_kinds, ['external_google']);
    assert.equal(c.failed, 0, 'a capped source was counted as failed');
    assert.equal(c.complete, false, 'every source answered, yet the read calls itself complete');
  } finally { world.restore(); f.close(); }
});

test('7: coverage follows the registry, so a new source needs no constant anywhere', async () => {
  const f = fixture();
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ items: [] });
    if (url.host === 'graph.microsoft.com') return json({ value: [] });
    return json({}, 404);
  });
  try {
    const r = await f.events();
    // The denominator equals the sources this read answered for, which the registry decides. A kind added there
    // is attempted and counted with no edit to this test, to the route or to the page.
    assert.equal(r.body.coverage.attempted, r.body.sources.length);
    assert.ok(r.body.coverage.attempted > 1, 'only one source was attempted: the fixture reads almost nothing');
    // A narrowed read counts only what it asked for, which is what a scoped retry does (D5202).
    const scoped = await f.events('&kinds=external_google');
    assert.equal(scoped.body.coverage.attempted, 1, 'a scoped read reports the whole page\'s coverage');
    assert.equal(scoped.body.coverage.complete, true);
  } finally { world.restore(); f.close(); }
});
