/**
 * D5202 (#5202, part 2 of 7 of the Calendar audit, of #3723) — a connected calendar whose events did not load.
 *
 * Production reported "26 of 28 sources answered" with both Google and Outlook event reads failing while the
 * Connected calendars rail showed both providers Connected. Connection and read health are two things, and the
 * Worker now says which of them failed, how long it took and how much it gave, in fixed words and numbers.
 *
 *   1. A read that answers carries its item count, a latency and a time, and no error.
 *   2. 429 is `rate_limited`; 5xx, a bad body, a timeout and a dead network are `unreadable`, each with its own
 *      reason; 401 and 403 are `reconnect`.
 *   3. A revoked or scope-less grant is `reconnect` before any request is made.
 *   4. A member with no connection has no source row at all: absence is not a failure.
 *   5. One provider failing hides neither the other provider's events nor Axal's own.
 *   6. A read of one kind reads that kind alone, which is what a scoped retry asks for.
 *   7. No source row, and no log line, carries a title, an attendee, an address, a join link or a provider body.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import calendar from '../src/routes/calendar.ts';
import { READ_TIMEOUT_MS } from '../src/services/calendar/externalReaders.ts';

after(removeMigratedDatabases);

const SECRET = 'synthetic-calendar-5202-secret-'.repeat(2);
const FROM = '2026-11-01T00:00:00.000Z';
const TO = '2026-12-01T00:00:00.000Z';
const ADDRESS = 'member-5202@example.test';
/** Everything a source row and a log line must never carry. */
const TITLE = 'Synthetic acquisition talk with the board';
const ATTENDEE = 'private-attendee-5202@example.test';
const JOIN = 'https://meet.example.test/synthetic-5202';
const BODY = 'quotaExceeded: the caller has exhausted synthetic quota for calendar.events.list';

function fixture({ google = true, microsoft = true, googleScope = 'https://www.googleapis.com/auth/calendar.readonly' } = {}) {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES (1,'founder','Fixture founder','${ADDRESS}',101,1);
   INSERT INTO calendar_events(id,uid,user_id,source,kind,external_uri,title,start_at,end_at,status) VALUES
    (7,'axal:manual:seven',1,'manual','other','axal:manual:seven','Axal own event','2026-11-05T09:00:00.000Z','2026-11-05T10:00:00.000Z','scheduled');`);
  if (google) {
    db.prepare('INSERT INTO google_oauth_tokens(user_id,refresh_token,scope,google_email) VALUES (1,?,?,?)')
      .run('synthetic-google-refresh', googleScope, ADDRESS);
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
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), text };
  }
  return { db, env, events, close: () => db.close() };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const gEvent = (id: string) => ({
  id, iCalUID: `${id}@google.test`, summary: TITLE, status: 'confirmed',
  start: { dateTime: '2026-11-10T15:00:00Z' }, end: { dateTime: '2026-11-10T16:00:00Z' },
  htmlLink: `https://calendar.google.com/event?eid=${id}`, hangoutLink: JOIN,
});
const msEvent = (id: string) => ({
  id, iCalUId: `${id}@outlook.test`, subject: TITLE, isCancelled: false,
  start: { dateTime: '2026-11-11T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-11T16:00:00.0000000', timeZone: 'UTC' },
  webLink: `https://outlook.office365.com/owa/?itemid=${id}`,
});

/** A provider world. `answer` may return a Response, or throw to play a network or deadline failure. */
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
const sourceOf = (body: any, kind: string) => (body.sources || []).find((s: any) => s?.kind === kind) ?? null;

/** Collects what the Worker logged while `fn` ran, and restores before anything is asserted. */
async function logged<T>(fn: () => Promise<T>): Promise<{ value: T; said: string }> {
  const was = console.warn;
  const lines: string[] = [];
  let value: T;
  try {
    console.warn = (...args: unknown[]) => { lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
    value = await fn();
  } finally { console.warn = was; }
  return { value: value!, said: lines.join('\n') };
}

test('1: a read that answers carries its count, a latency and a time, and no error', async () => {
  const f = fixture();
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ items: [gEvent('g1'), gEvent('g2')] });
    if (url.host === 'graph.microsoft.com') return json({ value: [msEvent('m1')] });
    return json({}, 404);
  });
  try {
    const r = await f.events();
    assert.equal(r.status, 200);
    const g = sourceOf(r.body, 'external_google');
    assert.equal(g.ok, true);
    assert.equal(g.error, null);
    assert.equal(g.items, 2, 'the item count is not reported');
    assert.ok(Number.isFinite(g.latency_ms) && g.latency_ms >= 0, 'no latency');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(g.at), 'no timestamp');
    assert.equal(g.truncated, undefined);
    assert.equal(sourceOf(r.body, 'external_microsoft').items, 1);
  } finally { world.restore(); f.close(); }
});

test('2: each failure shape is its own code and reason, and the connection is not blamed for a read', async () => {
  // [what the provider does, the code the page shows, the reason support reads]
  const cases: Array<[Response | 'timeout' | 'network', string, string]> = [
    [json({ error: BODY }, 429), 'rate_limited', 'rate_limited'],
    [json({ error: BODY }, 503), 'unreadable', 'http_5xx'],
    [json({ error: BODY }, 400), 'unreadable', 'http_4xx'],
    [json('not an object' as any), 'unreadable', 'bad_body'],
    ['timeout', 'unreadable', 'timeout'],
    ['network', 'unreadable', 'network'],
    [json({ error: BODY }, 401), 'reconnect', 'http_4xx'],
    [json({ error: BODY }, 403), 'reconnect', 'http_4xx'],
  ];
  for (const [answer, code, reason] of cases) {
    const f = fixture();
    const world = stubFetch((url) => {
      if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
      if (url.host === 'www.googleapis.com') {
        if (answer === 'timeout') { const e: any = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
        if (answer === 'network') throw new TypeError('fetch failed');
        return answer.clone();
      }
      if (url.host === 'graph.microsoft.com') return json({ value: [msEvent('m1')] });
      return json({}, 404);
    });
    try {
      const { value: r, said } = await logged(() => f.events());
      const g = sourceOf(r.body, 'external_google');
      assert.deepEqual([g.ok, g.error, g.reason], [false, code, reason], `${code}/${reason}`);
      assert.ok(Number.isFinite(g.latency_ms), `${reason}: no latency on a failure`);
      assert.ok(!said.includes(BODY) && !r.text.includes(BODY), `${reason}: the provider's body escaped`);
      // Outlook answered, so its events are still there whatever Google did.
      assert.equal(sourceOf(r.body, 'external_microsoft').ok, true, `${reason}: Outlook was dragged down with Google`);
    } finally { world.restore(); f.close(); }
  }
});

test('3: a grant with no calendar scope is reconnect, before any request is made', async () => {
  const f = fixture({ googleScope: 'https://www.googleapis.com/auth/userinfo.email' });
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'graph.microsoft.com') return json({ value: [] });
    return json({}, 404);
  });
  try {
    const r = await f.events();
    const g = sourceOf(r.body, 'external_google');
    assert.deepEqual([g.ok, g.error, g.reason], [false, 'reconnect', 'scope_missing']);
    assert.ok(!world.seen.some((u) => new URL(u).host === 'www.googleapis.com'), 'it asked Google anyway');
  } finally { world.restore(); f.close(); }
  // A refresh the provider refuses is also the connection's, not the read's.
  const g2 = fixture();
  const w2 = stubFetch((url) => {
    if (url.host === 'oauth2.googleapis.com') return json({ error: 'invalid_grant' }, 400);
    if (url.host === 'login.microsoftonline.com') return json({ access_token: 'synthetic-access' });
    if (url.host === 'graph.microsoft.com') return json({ value: [] });
    return json({}, 404);
  });
  try {
    const r = await g2.events();
    const g = sourceOf(r.body, 'external_google');
    assert.deepEqual([g.ok, g.error, g.reason], [false, 'reconnect', 'refresh_refused']);
  } finally { w2.restore(); g2.close(); }
});

test('4: a member with no connection has no source row for it at all', async () => {
  const f = fixture({ microsoft: false });
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ items: [gEvent('g1')] });
    return json({}, 404);
  });
  try {
    const r = await f.events();
    assert.equal(sourceOf(r.body, 'external_microsoft'), null, 'a disconnected provider was listed as a source');
    assert.ok(!(r.body.sources || []).some((s: any) => s.kind === 'external_microsoft' && s.ok === false), 'it was counted as failed');
    assert.equal(sourceOf(r.body, 'external_google').ok, true);
  } finally { world.restore(); f.close(); }
});

test('5: one provider failing hides neither the other provider nor Axal\'s own events', async () => {
  const f = fixture();
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ error: BODY }, 500);
    if (url.host === 'graph.microsoft.com') return json({ value: [msEvent('m1')] });
    return json({}, 404);
  });
  try {
    const { value: r } = await logged(() => f.events());
    const kinds = (r.body.items || []).map((i: any) => i.kind);
    assert.ok(kinds.includes('external_microsoft'), 'Outlook\'s events went with Google\'s failure');
    assert.ok(kinds.includes('manual'), 'Axal\'s own event went with Google\'s failure');
    assert.equal(sourceOf(r.body, 'external_google').ok, false);
  } finally { world.restore(); f.close(); }
});

test('6: a scoped read asks one provider only, which is what a retry of one source does', async () => {
  const f = fixture();
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ items: [gEvent('g1')] });
    if (url.host === 'graph.microsoft.com') return json({ value: [msEvent('m1')] });
    return json({}, 404);
  });
  try {
    const r = await f.events('&kinds=external_google');
    assert.deepEqual((r.body.sources || []).map((s: any) => s.kind), ['external_google'], 'a scoped read read more than its kind');
    assert.ok(!world.seen.some((u) => new URL(u).host === 'graph.microsoft.com'), 'it asked Outlook during a Google retry');
    assert.ok((r.body.items || []).every((i: any) => i.kind === 'external_google'));
  } finally { world.restore(); f.close(); }
});

test('7: no source row and no log line carries a title, an attendee, an address, a join link or a provider body', async () => {
  const f = fixture();
  const world = stubFetch((url) => {
    if (tokenHosts(url)) return json({ access_token: 'synthetic-access' });
    if (url.host === 'www.googleapis.com') return json({ error: BODY, attendee: ATTENDEE }, 429);
    if (url.host === 'graph.microsoft.com') throw new TypeError('fetch failed');
    return json({}, 404);
  });
  let said = '';
  let sources = '';
  try {
    const got = await logged(() => f.events());
    said = got.said;
    sources = JSON.stringify(got.value.body.sources);
  } finally { world.restore(); f.close(); }
  for (const secret of [BODY, ATTENDEE, JOIN, TITLE]) {
    assert.ok(!said.includes(secret), `a log line carried ${secret.slice(0, 24)}`);
    assert.ok(!sources.includes(secret), `a source row carried ${secret.slice(0, 24)}`);
  }
  assert.ok(/rate_limited/.test(said) && /network/.test(said), 'the failures were not logged by outcome and reason');
  assert.ok(READ_TIMEOUT_MS > 0, 'the read has no deadline of its own');
});
