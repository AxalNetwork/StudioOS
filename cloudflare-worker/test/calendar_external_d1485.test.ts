/**
 * D1485 (#3979, parts 3 and 4 of #3723) — the member's own Google and Outlook
 * events on the calendar, read-only and read live; the dedupe against Axal's
 * own copies; and "Copy new Axal sessions to…" (`copy_target`).
 *
 *   1. Paging stops at 4 × 250 and the source says `truncated`; Microsoft
 *      follows `@odata.nextLink` only on graph.microsoft.com.
 *   2. An expired Google token is `reconnect` for that source alone: Outlook
 *      and the Axal sources still answer, through GET /events.
 *   3. Both dedupe rules give one item with `also_on`: Axal's own copy (its
 *      `calendar_sync_records` row) and an equal iCalUID; a near match is
 *      flagged `possible_duplicate`, never merged.
 *   4. External kinds are refused by /push (400) and .ics (400), and the copy
 *      out never reads them, so nothing copied in is copied back out.
 *   5. No `console.warn` carries a title, an address or a provider body.
 *   6. `copy_target='google'` makes zero Microsoft calls for a new session;
 *      'all' still pushes to both; a copy already held keeps being updated.
 *   7. A staff scope never lists them.
 *
 * Stubbed fetch, in-memory SQLite: the baseline and every post-cutoff migration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import calendar from '../src/routes/calendar.ts';
import { FEED_KINDS, PERSONAL_ONLY_KINDS, fetchUserEvents } from '../src/services/calendar.ts';
import { ExternalReadError, MAX_PAGES, PAGE_SIZE, dedupeExternal, googleEvents, microsoftEvents } from '../src/services/calendar/externalReaders.ts';
import { onAxalSessionCreated } from '../src/services/calendar/sync.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const SECRET = 'synthetic-calendar-external-1485-'.repeat(3);
const FROM = '2026-11-01T00:00:00.000Z', TO = '2026-12-01T00:00:00.000Z';
const TITLE = 'Synthetic private board dinner';
const ADDRESS = 'member-one@example.test';
const ICAL = 'ical-shared-uid@example.test';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,1),(2,'admin','Fixture admin','two@example.test',NULL,1);
   INSERT INTO calendar_events(id,uid,user_id,source,kind,external_uri,title,start_at,end_at,status) VALUES
    (7,'${ICAL}',1,'manual','other','axal:manual:seven','Fixture own event','2026-11-05T09:00:00.000Z','2026-11-05T10:00:00.000Z','scheduled'),
    (8,'axal:manual:eight',1,'manual','other','axal:manual:eight','Weekly review','2026-11-06T09:00:00.000Z','2026-11-06T10:00:00.000Z','scheduled');
   INSERT INTO google_oauth_tokens(user_id,refresh_token,scope,google_email) VALUES
    (1,'synthetic-google-refresh','https://www.googleapis.com/auth/calendar.readonly','${ADDRESS}');
   INSERT INTO microsoft_oauth_tokens(user_id,refresh_token,scope,microsoft_email) VALUES
    (1,'synthetic-microsoft-refresh','Calendars.ReadWrite offline_access','${ADDRESS}');`);
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
  const ctx: any = { waitUntil() {}, passThroughOnException() {} };
  const env: any = {
    DB, JWT_SECRET: SECRET, ENVIRONMENT: 'production', APP_URL: 'https://axal.vc',
    GOOGLE_CLIENT_ID: 'synthetic-google-client', GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
    MICROSOFT_CLIENT_ID: 'synthetic-ms-client', MICROSOFT_CLIENT_SECRET: 'synthetic-ms-secret',
  };
  async function call(method: string, path: string, id = 1) {
    const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const init: any = { method, headers: { Cookie: `studioos_auth=${token}; studioos_csrf=fixture-csrf`, 'x-csrf-token': 'fixture-csrf', Origin: 'https://axal.vc', 'content-type': 'application/json' } };
    const res = await calendar.request(path, init, env, ctx);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* .ics */ }
    return { status: res.status, body: json, text };
  }
  return { db, env, call, close: () => db.close() };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A provider world: which hosts answer what, and every URL asked for. */
function stubFetch(answer: (url: URL, init: any) => Response | Promise<Response>) {
  const seen: string[] = [];
  const was = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    seen.push(url.toString());
    return answer(url, init);
  }) as any;
  return { seen, restore: () => { globalThis.fetch = was; } };
}

const gEvent = (id: string, over: Record<string, unknown> = {}) => ({
  id, iCalUID: `${id}@google.test`, summary: `Google ${id}`, status: 'confirmed',
  start: { dateTime: '2026-11-10T15:00:00Z' }, end: { dateTime: '2026-11-10T16:00:00Z' },
  htmlLink: `https://calendar.google.com/event?eid=${id}`, ...over,
});
const msEvent = (id: string, over: Record<string, unknown> = {}) => ({
  id, iCalUId: `${id}@outlook.test`, subject: `Outlook ${id}`, isCancelled: false,
  start: { dateTime: '2026-11-11T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-11T16:00:00.0000000', timeZone: 'UTC' },
  webLink: `https://outlook.office365.com/owa/?itemid=${id}`, ...over,
});
const pick = (s: any) => s && ({ kind: s.kind, ok: s.ok, error: s.error, ...(s.truncated ? { truncated: s.truncated } : {}) });
const TOKEN = async () => ({ access: 'synthetic-access', address: ADDRESS });

test('1: paging stops at 4 × 250 with `truncated`; Graph follows nextLink only on graph.microsoft.com', async () => {
  assert.equal(PAGE_SIZE * MAX_PAGES, 1000);
  let calls = 0;
  const google = await googleEvents({} as any, 1, FROM, TO, {
    token: TOKEN,
    fetcher: (async (u: string) => {
      calls += 1;
      const url = new URL(u);
      assert.equal(url.searchParams.get('maxResults'), '250');
      assert.equal(url.searchParams.get('fields'), 'items(id,iCalUID,summary,start,end,status,htmlLink,hangoutLink),nextPageToken');
      return json({ items: Array.from({ length: 250 }, (_, i) => gEvent(`p${calls}-${i}`)), nextPageToken: `page-${calls + 1}` });
    }) as any,
  });
  assert.equal(calls, 4, 'a fifth page was asked for');
  assert.equal(google.length, 1000);
  assert.equal(google.truncated, true, 'the cap was reached and the source does not say so');

  calls = 0;
  const short = await googleEvents({} as any, 1, FROM, TO, {
    token: TOKEN, fetcher: (async () => { calls += 1; return json({ items: [gEvent('only'), gEvent('gone', { status: 'cancelled' })] }); }) as any,
  });
  assert.equal(calls, 1);
  assert.equal(short.truncated, undefined, 'a window that fit says truncated');
  assert.deepEqual(short.map((e) => e.id), ['external_google:only'], 'a cancelled Google event is shown');
  assert.equal(short[0].read_only, true);
  assert.deepEqual(short[0].external, { provider: 'google', ical_uid: 'only@google.test', account: { provider: 'google', address: ADDRESS } });

  const asked: string[] = [];
  const ms = await microsoftEvents({} as any, 1, FROM, TO, {
    token: TOKEN,
    fetcher: (async (u: string) => {
      asked.push(u);
      return asked.length === 1
        ? json({ value: [msEvent('m1'), msEvent('m2', { isCancelled: true })], '@odata.nextLink': 'https://elsewhere.example.test/next' })
        : json({ value: [msEvent('never')] });
    }) as any,
  });
  assert.equal(asked.length, 1, 'a nextLink off graph.microsoft.com was followed');
  assert.match(asked[0], /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/calendarView\?/);
  assert.match(decodeURIComponent(asked[0]), /\$top=250/);
  assert.deepEqual(ms.map((e) => e.id), ['external_microsoft:m1']);

  // A provider status is its code: 401 and 403 reconnect, 429 rate limited, anything else unreadable.
  const codeOf = async (status: number, read: typeof googleEvents) => {
    try { await read({} as any, 1, FROM, TO, { token: TOKEN, fetcher: (async () => json({ error: TITLE }, status)) as any }); return 'answered'; }
    catch (e) { assert.ok(e instanceof ExternalReadError); return (e as ExternalReadError).code; }
  };
  for (const read of [googleEvents, microsoftEvents]) {
    assert.equal(await codeOf(401, read), 'reconnect');
    assert.equal(await codeOf(403, read), 'reconnect');
    assert.equal(await codeOf(429, read), 'rate_limited');
    assert.equal(await codeOf(500, read), 'unreadable');
  }

  calls = 0;
  const capped = await microsoftEvents({} as any, 1, FROM, TO, {
    token: TOKEN,
    fetcher: (async () => { calls += 1; return json({ value: [msEvent(`c${calls}`)], '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/calendarView?page=${calls + 1}` }); }) as any,
  });
  assert.equal(calls, 4);
  assert.equal(capped.truncated, true);
});

test('2 and 5: an expired Google token is reconnect for that source alone; the others answer; no warn carries a title or an address', async () => {
  const f = fixture();
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { warned.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  const world = stubFetch((url) => {
    if (url.host === 'oauth2.googleapis.com') return json({ error: 'invalid_grant', error_description: `${TITLE} ${ADDRESS}` }, 400);
    if (url.host === 'login.microsoftonline.com') return json({ access_token: 'synthetic-ms-access' });
    if (url.host === 'graph.microsoft.com') return json({ value: [msEvent('m1', { subject: TITLE })] });
    return json({}, 404);
  });
  try {
    const r = await f.call('GET', `/events?from=${FROM}&to=${TO}`);
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.sources.map((s: any) => [s.kind, pick(s)]));
    assert.deepEqual(by.external_google, { kind: 'external_google', ok: false, error: 'reconnect' });
    assert.deepEqual(by.external_microsoft, { kind: 'external_microsoft', ok: true, error: null });
    assert.equal(by.manual.ok, true, 'an Axal source failed with Google');
    const outlook = r.body.items.find((i: any) => i.kind === 'external_microsoft');
    assert.equal(outlook.title, TITLE);
    assert.equal(outlook.read_only, true);
    assert.deepEqual(outlook.source.account, { provider: 'microsoft', address: ADDRESS }, 'the owner\'s own read names the account');
    assert.deepEqual(outlook.pushed_to ?? [], [], 'an external event is shown as copied');
    assert.ok(r.body.items.some((i: any) => i.kind === 'manual'));
    assert.ok(warned.some((w) => /external_google/.test(w)), 'the failure was not logged at all');
    for (const w of warned) {
      assert.ok(!w.includes(TITLE), `a warn carries a title: ${w}`);
      assert.ok(!w.includes(ADDRESS), `a warn carries an address: ${w}`);
      assert.ok(!w.includes('invalid_grant'), `a warn carries a provider body: ${w}`);
    }
  } finally { console.warn = warn; world.restore(); f.close(); }
});

test('2b: no connection is no external source; a Graph 429 is rate_limited', async () => {
  const f = fixture();
  f.db.exec('DELETE FROM google_oauth_tokens');
  const world = stubFetch((url) => {
    if (url.host === 'login.microsoftonline.com') return json({ access_token: 'synthetic-ms-access' });
    if (url.host === 'graph.microsoft.com') return json({ error: { message: TITLE } }, 429);
    return json({}, 404);
  });
  try {
    const r = await f.call('GET', `/events?from=${FROM}&to=${TO}`);
    const kinds = r.body.sources.map((s: any) => s.kind);
    assert.ok(!kinds.includes('external_google'), 'a member with no Google connection has a Google source');
    assert.deepEqual(pick(r.body.sources.find((s: any) => s.kind === 'external_microsoft')), { kind: 'external_microsoft', ok: false, error: 'rate_limited' });
    assert.ok(!world.seen.some((u) => /googleapis/.test(u)), 'Google was called for a member without it');
  } finally { world.restore(); f.close(); }
});

test('3: Axal\'s own copy and an equal iCalUID each give one item with also_on; a near match is flagged, never merged', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO calendar_sync_records(user_id,provider,source_kind,source_id,external_event_id,last_synced_at)
    VALUES (1,'microsoft','manual',8,'ms-copy-of-eight','2026-11-01T00:00:00Z')`);
  const world = stubFetch((url) => {
    if (url.host === 'oauth2.googleapis.com') return json({ access_token: 'synthetic-google-access' });
    if (url.host === 'www.googleapis.com') return json({ items: [
      gEvent('g-same', { iCalUID: ICAL, summary: 'Fixture own event', start: { dateTime: '2026-11-05T09:00:00Z' }, end: { dateTime: '2026-11-05T10:00:00Z' } }),
      gEvent('g-near', { summary: 'Review weekly', start: { dateTime: '2026-11-06T09:00:30Z' }, end: { dateTime: '2026-11-06T09:30:00Z' } }),
      gEvent('g-apart', { summary: 'Weekly review', start: { dateTime: '2026-11-06T09:05:00Z' }, end: { dateTime: '2026-11-06T09:30:00Z' } }),
    ] });
    if (url.host === 'login.microsoftonline.com') return json({ access_token: 'synthetic-ms-access' });
    if (url.host === 'graph.microsoft.com') return json({ value: [msEvent('ms-copy-of-eight', { subject: 'Weekly review' })] });
    return json({}, 404);
  });
  try {
    const r = await f.call('GET', `/events?from=${FROM}&to=${TO}`);
    assert.equal(r.status, 200);
    const ids = r.body.items.map((i: any) => i.id);
    assert.ok(!ids.includes('external_microsoft:ms-copy-of-eight'), 'Axal\'s own Outlook copy is shown twice');
    assert.ok(!ids.includes('external_google:g-same'), 'an equal iCalUID is shown twice');
    const seven = r.body.items.find((i: any) => i.kind === 'manual' && i.source_id === 7);
    const eight = r.body.items.find((i: any) => i.kind === 'manual' && i.source_id === 8);
    assert.deepEqual(seven.also_on, ['google']);
    assert.deepEqual(eight.also_on, ['microsoft']);
    const near = r.body.items.find((i: any) => i.id === 'external_google:g-near');
    assert.equal(near.possible_duplicate, true, 'a start within a minute and a shared word is not flagged');
    const apart = r.body.items.find((i: any) => i.id === 'external_google:g-apart');
    assert.equal(apart.possible_duplicate, undefined, 'five minutes apart is flagged');
    assert.equal(eight.possible_duplicate, undefined, 'the Axal item itself is flagged');
  } finally { world.restore(); f.close(); }

  // The pure rule, both providers onto one item.
  const axal: any = { id: 'manual:7', kind: 'manual', source_id: 7, source_uid: ICAL, title: 'Board', start_at: '2026-11-05T09:00:00.000Z', end_at: '2026-11-05T10:00:00.000Z' };
  const ext = (kind: string, provider: string, id: string, ical: string | null): any => ({
    id: `${kind}:${id}`, kind, source_id: 0, source_uid: id, title: 'Board', start_at: axal.start_at, end_at: axal.end_at,
    external: { provider, ical_uid: ical, account: { provider, address: null } },
  });
  const out = dedupeExternal([axal, ext('external_google', 'google', 'g1', null), ext('external_microsoft', 'microsoft', 'm1', ICAL)],
    new Map([['google:g1', 'manual:7']]));
  assert.deepEqual(out.map((e) => e.id), ['manual:7']);
  assert.deepEqual(out[0].also_on, ['google', 'microsoft']);
});

test('4: external kinds are refused by /push and .ics, never in a feed, never copied back out, never in a staff scope', async () => {
  for (const k of ['external_google', 'external_microsoft']) {
    assert.ok(!(FEED_KINDS as readonly string[]).includes(k), `${k} is in a feed`);
    assert.ok((PERSONAL_ONLY_KINDS as readonly string[]).includes(k), `${k} can enter a staff scope`);
  }
  const f = fixture();
  const world = stubFetch(() => json({}, 500));
  try {
    for (const k of ['external_google', 'external_microsoft']) {
      const push = await f.call('POST', `/push/${k}/1`);
      assert.equal(push.status, 400, `/push took ${k}`);
      const ics = await f.call('GET', `/events.ics?kinds=${k}&from=${FROM}&to=${TO}`);
      assert.equal(ics.status, 400, `.ics took ${k}`);
    }
    // The copy out (`syncUserToProvider`) reads through fetchUserEvents, which drops page-only kinds.
    assert.deepEqual(await fetchUserEvents(f.env, 1, 'founder', FROM, TO, ['external_google', 'external_microsoft']), []);
    assert.equal(world.seen.length, 0, 'a refused or page-only read called a provider');
    const staff = await f.call('GET', `/events?scope=studio&from=${FROM}&to=${TO}`, 2);
    assert.equal(staff.status, 200);
    assert.ok(!staff.body.sources.some((s: any) => String(s.kind).startsWith('external_')), 'a staff scope reads a member\'s own calendar');
  } finally { world.restore(); f.close(); }
});

test('6: copy_target decides which provider a new session is copied to', async () => {
  const session: any = {
    id: 'founder_checkin:41', kind: 'founder_checkin', source_id: 41, title: 'Check-in', start_at: '2026-11-12T15:00:00.000Z', end_at: '2026-11-12T15:30:00.000Z',
    status: 'confirmed', location_kind: null, location_uri: null, organizer_email: 'one@example.test', attendees: [], notes: null,
  };
  const run = async (target: string | null, held = false) => {
    const f = fixture();
    if (target) f.db.prepare('INSERT INTO calendar_settings(user_id, copy_target) VALUES (1, ?)').run(target);
    if (held) f.db.exec(`INSERT INTO calendar_sync_records(user_id,provider,source_kind,source_id,external_event_id,last_synced_at)
      VALUES (1,'microsoft','founder_checkin',41,'ms-held','2026-11-01T00:00:00Z')`);
    const world = stubFetch((url) => {
      if (url.host === 'oauth2.googleapis.com') return json({ access_token: 'synthetic-google-access' });
      if (url.host === 'www.googleapis.com') return json({ id: 'g-new' });
      if (url.host === 'login.microsoftonline.com') return json({ access_token: 'synthetic-ms-access' });
      if (url.host === 'graph.microsoft.com') return json({ id: 'ms-new' });
      return json({}, 404);
    });
    try {
      await onAxalSessionCreated(f.env, session);
      const ms = world.seen.filter((u) => /microsoft/.test(new URL(u).host)).length;
      const google = world.seen.filter((u) => /google/.test(new URL(u).host)).length;
      return { ms, google };
    } finally { world.restore(); f.close(); }
  };
  const google = await run('google');
  assert.equal(google.ms, 0, "copy_target='google' called Microsoft");
  assert.ok(google.google > 0, "copy_target='google' did not copy to Google");
  const none = await run('none');
  assert.deepEqual(none, { ms: 0, google: 0 }, "copy_target='none' copied a session");
  const all = await run('all');
  assert.ok(all.ms > 0 && all.google > 0, "'all' no longer copies to both");
  const unset = await run(null);
  assert.ok(unset.ms > 0 && unset.google > 0, 'no setting is not today\'s behaviour');
  const held = await run('google', true);
  assert.ok(held.ms > 0, 'a copy Outlook already holds stopped being updated');
});
