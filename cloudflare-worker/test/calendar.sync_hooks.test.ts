/**
 * Task #52 — Unit tests for the per-event two-way calendar sync hooks.
 *
 * These tests do NOT spin up D1; they stub a minimal SQL tag + DB object
 * so we can assert (a) onAxalSessionCreated POSTs to googleapis when the
 * user is connected, (b) onAxalSessionCancelled issues DELETE + clears
 * the sync row, (c) un-connected users are silently skipped.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/calendar.sync_hooks.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// We mock global fetch BEFORE importing the service so the module
// captures our stub.
const fetchCalls: Array<{ url: string; method: string; body: string | null }> = [];
let fetchResponder: (url: string, init: any) => Response = () =>
  new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

(globalThis as any).fetch = async (url: string, init: any = {}) => {
  fetchCalls.push({
    url: String(url),
    method: init.method || 'GET',
    body: typeof init.body === 'string' ? init.body : null,
  });
  return fetchResponder(String(url), init);
};

// Minimal in-memory "DB" + sql tag.
function makeStubEnv() {
  const tables: Record<string, any[]> = {
    users: [{ id: 1, email: 'organizer@axal.vc', name: 'Org' },
            { id: 2, email: 'mentee@axal.vc',   name: 'Men' }],
    google_oauth_tokens: [{ user_id: 1, refresh_token: 'rt-1' }],
    microsoft_oauth_tokens: [],
    calendar_sync_records: [] as any[],
  };
  const sqlImpl = async (strings: TemplateStringsArray | string, ...params: any[]) => {
    const src = typeof strings === 'string'
      ? strings
      : strings.reduce((acc, s, i) => acc + s + (i < params.length ? `:${i}` : ''), '');
    const lower = src.toLowerCase();
    if (/select id from users where lower\(email\) in/.test(lower)) {
      const emails = params.map(String).map(s => s.toLowerCase());
      return tables.users.filter(u => emails.includes(u.email.toLowerCase())).map(u => ({ id: u.id }));
    }
    if (/from google_oauth_tokens/.test(lower) && /select refresh_token/.test(lower)) {
      return tables.google_oauth_tokens.filter(r => r.user_id === params[0]);
    }
    if (/from microsoft_oauth_tokens/.test(lower) && /select refresh_token/.test(lower)) {
      return tables.microsoft_oauth_tokens.filter(r => r.user_id === params[0]);
    }
    if (/select external_event_id from calendar_sync_records/.test(lower)) {
      const [uid, prov, kind, srcId] = params;
      const row = tables.calendar_sync_records.find(r =>
        r.user_id === uid && r.provider === prov && r.source_kind === kind && r.source_id === srcId);
      return row ? [row] : [];
    }
    if (/insert into calendar_sync_records/.test(lower)) {
      tables.calendar_sync_records.push({
        user_id: params[0], provider: params[1], source_kind: params[2],
        source_id: params[3], external_event_id: params[4], last_synced_at: params[5],
      });
      return [];
    }
    if (/update calendar_sync_records/.test(lower)) {
      const [extId, ts, uid, prov, kind, srcId] = params;
      const row = tables.calendar_sync_records.find(r =>
        r.user_id === uid && r.provider === prov && r.source_kind === kind && r.source_id === srcId);
      if (row) { row.external_event_id = extId; row.last_synced_at = ts; }
      return [];
    }
    if (/select user_id, provider, external_event_id from calendar_sync_records/.test(lower)) {
      return tables.calendar_sync_records.filter(r =>
        r.source_kind === params[0] && r.source_id === params[1]);
    }
    if (/delete from calendar_sync_records/.test(lower)) {
      // Two delete shapes are issued by the production code:
      //   (a) DELETE … WHERE source_kind = ? AND source_id = ? (legacy
      //       bulk wipe — kept for the no-OAuth fast path)
      //   (b) DELETE … WHERE user_id = ? AND provider = ? AND
      //       source_kind = ? AND source_id = ? (per-row wipe, only
      //       after the provider DELETE confirmed success)
      if (params.length >= 4) {
        const [uid, prov, kind, srcId] = params;
        tables.calendar_sync_records = tables.calendar_sync_records.filter(r =>
          !(r.user_id === uid && r.provider === prov &&
            r.source_kind === kind && r.source_id === srcId));
      } else {
        const [kind, srcId] = params;
        tables.calendar_sync_records = tables.calendar_sync_records.filter(r =>
          !(r.source_kind === kind && r.source_id === srcId));
      }
      return [];
    }
    if (/update .*_oauth_tokens set refresh_token/.test(lower)) return [];
    return [];
  };
  // Make sql callable as both tag template AND for .unsafe(...)
  const sql: any = (strings: any, ...params: any[]) => sqlImpl(strings, ...params);
  sql.unsafe = (raw: string, params: any[]) => sqlImpl(raw, ...(params || []));

  const env: any = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async first() {
                const rows = await sqlImpl(sql, ...params) as any[];
                return rows[0] || null;
              },
              async all<T = any>() {
                return { results: await sqlImpl(sql, ...params) as T[] };
              },
              async run() { await sqlImpl(sql, ...params); return {}; },
            };
          },
        };
      },
    },
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsec',
    JWT_SECRET: 'jwt-secret-at-least-32-bytes-long-xx',
    APP_URL: 'https://app.axal.vc',
    __tables: tables,
    __sql: sql,
  };
  // services/db::getSQL falls back to a built-in adapter when env.SQL
  // isn't provided. Provide our tagged-template sql directly via the
  // same hook the worker uses.
  env.SQL = sql;
  return env;
}

// Token-exchange response (refresh → access).
function googleTokenResponse() {
  return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }),
    { status: 200, headers: { 'content-type': 'application/json' } });
}

const FAKE_EVENT = {
  id: 'advisor_booking:42',
  kind: 'advisor_booking' as const,
  source_id: 42,
  source_uid: 'uid-42',
  title: 'Advisor session — Alice',
  start_at: '2030-01-01T10:00:00Z',
  end_at: '2030-01-01T11:00:00Z',
  status: 'confirmed',
  location_kind: 'video',
  location_uri: 'https://meet.example.com/x',
  organizer_email: 'organizer@axal.vc',
  attendees: [
    { email: 'organizer@axal.vc', name: 'Org', role: 'advisor' },
    { email: 'mentee@axal.vc', name: 'Men', role: 'mentee' },
  ],
  notes: 'agenda',
};

test('onAxalSessionCreated pushes to Google for connected user only', async () => {
  fetchCalls.length = 0;
  const env = makeStubEnv();
  fetchResponder = (url) => {
    if (url.includes('oauth2.googleapis.com/token')) return googleTokenResponse();
    if (url.includes('/calendars/primary/events')) {
      return new Response(JSON.stringify({ id: 'gcal-evt-9' }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  };
  const { onAxalSessionCreated } = await import('../src/services/calendar/sync.ts');
  await onAxalSessionCreated(env, FAKE_EVENT as any);
  const inserts = fetchCalls.filter(c => c.method === 'POST' && /calendars\/primary\/events$/.test(c.url));
  assert.equal(inserts.length, 1, `expected one Google insert, got ${JSON.stringify(fetchCalls)}`);
  assert.equal(env.__tables.calendar_sync_records.length, 1);
  assert.equal(env.__tables.calendar_sync_records[0].external_event_id, 'gcal-evt-9');
  assert.equal(env.__tables.calendar_sync_records[0].user_id, 1);
});

test('onAxalSessionCancelled deletes external event + clears sync row', async () => {
  fetchCalls.length = 0;
  const env = makeStubEnv();
  env.__tables.calendar_sync_records.push({
    user_id: 1, provider: 'google', source_kind: 'advisor_booking',
    source_id: 42, external_event_id: 'gcal-evt-9',
    last_synced_at: new Date().toISOString(),
  });
  fetchResponder = (url, init) => {
    if (url.includes('oauth2.googleapis.com/token')) return googleTokenResponse();
    if (/calendars\/primary\/events\/gcal-evt-9/.test(url) && init.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response('{}', { status: 200 });
  };
  const { onAxalSessionCancelled } = await import('../src/services/calendar/sync.ts');
  await onAxalSessionCancelled(env, 'advisor_booking', 42);
  const deletes = fetchCalls.filter(c => c.method === 'DELETE');
  assert.equal(deletes.length, 1, 'expected DELETE call to Google');
  assert.equal(env.__tables.calendar_sync_records.length, 0, 'sync row should be cleared');
});

test('onAxalSessionCreated is a no-op for users with no OAuth row', async () => {
  fetchCalls.length = 0;
  const env = makeStubEnv();
  env.__tables.google_oauth_tokens = []; // disconnect both
  const { onAxalSessionCreated } = await import('../src/services/calendar/sync.ts');
  await onAxalSessionCreated(env, FAKE_EVENT as any);
  const inserts = fetchCalls.filter(c => /calendars\/primary\/events$/.test(c.url));
  assert.equal(inserts.length, 0, 'no Google insert when user is not connected');
  assert.equal(env.__tables.calendar_sync_records.length, 0);
});
