/**
 * D5201 (#5201, part 1 of 7 of the Calendar audit, of #3723) — the external-copy preference fails closed.
 *
 * A new Axal session is copied to Google or Outlook only where the member asked for it. The preference used to
 * read as 'all' when its store could not be read, so one unreadable row turned an explicit "None" into a write
 * on every connected provider. These hold the direction of that failure:
 *
 *   1. 'none' makes no provider call; 'google' only Google; 'microsoft' only Microsoft; 'all' and no row both.
 *   2. An unreadable preference makes ZERO new provider creates, and is not the same as 'all'.
 *   3. An unreadable preference with a copy already held keeps updating that copy, and still creates no other.
 *   4. The refusal records `copy_preference_unreadable` on a connected provider, and nothing on one that is not.
 *   5. A provider write that fails does not rewrite the member's stored preference.
 *   6. Nothing logged or recorded carries a title, an address, a join link or a provider body.
 *
 * Synthetic rows on the real migrated schema, stubbed `fetch`; no provider is ever reached.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { onAxalSessionCreated, onAxalSessionCancelled, onAxalSessionUpdated, resumeCalendarCopies, retryCalendarCopies } from '../src/services/calendar/sync.ts';
import { SYNC_ERRORS, readSyncError } from '../src/services/calendar/syncState.ts';
import { readCopyTarget } from '../src/services/calendar/prefs.ts';

// D1169's template: the migrated schema is built once and copied per case, not replayed per fixture.
after(removeMigratedDatabases);

const ADDRESS = 'member-5201@example.test';
/** The private words a refusal must never carry anywhere. */
const TITLE = 'Synthetic board dinner with the lead investor';
const JOIN = 'https://meet.example.test/synthetic-room';

const SESSION: any = {
  id: 'founder_checkin:41', kind: 'founder_checkin', source_id: 41, title: TITLE,
  start_at: '2026-11-12T15:00:00.000Z', end_at: '2026-11-12T15:30:00.000Z', status: 'confirmed',
  location_kind: 'video', location_uri: JOIN, organizer_email: ADDRESS, attendees: [], notes: null,
};

/** `unreadable` makes exactly the reads this fixture names throw, as a dropped table or a timeout would. */
function fixture({ unreadable = [] as string[] } = {}) {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Fixture founder','${ADDRESS}',101,1);
   INSERT INTO google_oauth_tokens(user_id,refresh_token,scope,google_email) VALUES
    (1,'synthetic-google-refresh','https://www.googleapis.com/auth/calendar','${ADDRESS}');
   INSERT INTO microsoft_oauth_tokens(user_id,refresh_token,scope,microsoft_email) VALUES
    (1,'synthetic-microsoft-refresh','Calendars.ReadWrite offline_access','${ADDRESS}');`);
  const DB = {
    prepare(sql: string) {
      let args: any[] = [];
      const refuse = () => { if (unreadable.some((frag) => sql.includes(frag))) throw new Error('no such table: synthetic'); };
      const stmt: any = {
        bind(...values: any[]) { args = values.map((v) => v ?? null); return stmt; },
        async first() { refuse(); return db.prepare(sql).get(...args) || null; },
        async all() { refuse(); return { results: db.prepare(sql).all(...args) }; },
        async run() { refuse(); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
        async raw() { refuse(); return db.prepare(sql).all(...args).map((r: any) => Object.values(r)); },
      };
      return stmt;
    },
    async exec(sql: string) { db.exec(sql); },
    async batch(list: any[]) { return Promise.all(list.map((s) => s.run())); },
  };
  const env: any = {
    DB, JWT_SECRET: 'synthetic-5201-secret-not-a-real-credential', ENVIRONMENT: 'production', APP_URL: 'https://axal.vc',
    GOOGLE_CLIENT_ID: 'synthetic-google-client', GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
    MICROSOFT_CLIENT_ID: 'synthetic-ms-client', MICROSOFT_CLIENT_SECRET: 'synthetic-ms-secret',
  };
  return { db, env, close: () => db.close() };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('5207: concurrent delivery, lost create replies, mapped updates, reconnect and cancellation', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  const copies = new Map<string, string>();
  const posts: string[] = [];
  const patches: string[] = [];
  let refreshStatus = 200;
  let failCreate = true;
  const future = () => Date.now() + 86_400_000;
  try {
    f.db.prepare(`INSERT INTO founder_checkins
      (id, uid, title, start_at, duration_min, status, founder_user_id)
      VALUES (41, 'checkin-41', ?, ?, 30, 'confirmed', 1)`).run(TITLE, SESSION.start_at);
    globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const google = url.hostname === 'www.googleapis.com';
      if (url.hostname === 'oauth2.googleapis.com' || url.hostname === 'login.microsoftonline.com') {
        return json({ access_token: 'synthetic-access' }, refreshStatus);
      }
      assert.ok(google || url.hostname === 'graph.microsoft.com');
      if (init.method === 'POST') {
        const payload = JSON.parse(String(init.body));
        const key = google ? payload.id : payload.transactionId;
        assert.match(key, /^[a-f0-9]{64}$/);
        posts.push(key);
        const existing = copies.get(key);
        if (existing) return google ? json({}, 409) : json({ id: existing }, 201);
        const id = google ? key : 'microsoft-mapped';
        copies.set(key, id);
        if (failCreate) throw new Error('synthetic reply lost after commit');
        return json({ id }, 201);
      }
      const id = url.pathname.split('/').at(-1)!;
      if (init.method === 'PATCH') {
        patches.push(id);
        return json({ id });
      }
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error('unexpected provider request');
    }) as typeof fetch;

    await Promise.all([onAxalSessionCreated(f.env, SESSION), onAxalSessionCreated(f.env, SESSION)]);
    assert.equal(posts.length, 2);
    assert.equal(copies.size, 2);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM calendar_copy_jobs WHERE state='pending'").get() as any).n, 2);
    failCreate = false;
    await retryCalendarCopies(f.env, future);
    assert.deepEqual(posts.slice(2).sort(), posts.slice(0, 2).sort());
    assert.equal(copies.size, 2);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM calendar_sync_records').get() as any).n, 2);

    refreshStatus = 401;
    await onAxalSessionUpdated(f.env, SESSION);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM calendar_copy_jobs WHERE state='parked'").get() as any).n, 2);
    assert.equal(await retryCalendarCopies(f.env, future), 0);
    refreshStatus = 200;
    await resumeCalendarCopies(f.env, 1, 'microsoft');
    const patchesBefore = patches.length;
    await retryCalendarCopies(f.env, future);
    assert.deepEqual(patches.slice(patchesBefore), ['microsoft-mapped']);
    assert.equal(posts.length, 4);

    await resumeCalendarCopies(f.env, 1, 'google');
    await onAxalSessionCancelled(f.env, SESSION.kind, SESSION.source_id);
    assert.equal(await retryCalendarCopies(f.env, future), 0);
    await onAxalSessionCreated(f.env, SESSION);
    assert.equal(posts.length, 4);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM calendar_sync_records').get() as any).n, 0);

    const second = { ...SESSION, source_id: 42 };
    f.db.prepare(`INSERT INTO founder_checkins
      (id, uid, title, start_at, duration_min, status, founder_user_id)
      VALUES (42, 'checkin-42', ?, ?, 30, 'confirmed', 1)`).run(TITLE, SESSION.start_at);
    setTarget(f, 'none');
    await onAxalSessionCreated(f.env, second);
    assert.equal(f.db.prepare('SELECT 1 FROM calendar_copy_jobs WHERE source_id=42').get(), undefined);
    assert.equal(posts.length, 4);
    f.db.exec("UPDATE calendar_settings SET copy_target='google' WHERE user_id=1");
    refreshStatus = 503;
    await onAxalSessionCreated(f.env, second);
    assert.equal((f.db.prepare('SELECT state FROM calendar_copy_jobs WHERE source_id=42').get() as any).state, 'pending');
    f.db.exec("UPDATE founder_checkins SET status='cancelled' WHERE id=42");
    refreshStatus = 200;
    await retryCalendarCopies(f.env, future);
    assert.equal((f.db.prepare('SELECT state FROM calendar_copy_jobs WHERE source_id=42').get() as any).state, 'cancelled');
    assert.equal(posts.length, 4);
  } finally {
    globalThis.fetch = original;
    f.close();
  }
});

/** Counts what each provider was asked to do; `writeFails` makes the create itself refuse. */
function stubProviders({ writeFails = false } = {}) {
  const seen: string[] = [];
  const was = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    seen.push(url.toString());
    if (url.host === 'oauth2.googleapis.com') return json({ access_token: 'synthetic-google-access' });
    if (url.host === 'login.microsoftonline.com') return json({ access_token: 'synthetic-ms-access' });
    if (url.host === 'www.googleapis.com') return writeFails ? json({ error: 'refused' }, 503) : json({ id: 'g-new' });
    if (url.host === 'graph.microsoft.com') return writeFails ? json({ error: 'refused' }, 503) : json({ id: 'ms-new' });
    return json({}, 404);
  }) as any;
  // Counted by EXACT host. An unanchored regex on a host matches anywhere in it, so `/googleapis\.com/` would
  // have counted `evil-googleapis.com.example.test` as a Google write (CodeQL, 2 high alerts on #5276). The
  // write endpoints are their own hosts, so equality is both safer and more precise: it no longer has to
  // exclude the token hosts by name.
  const writes = (host: string) => seen.filter((u) => new URL(u).host === host).length;
  return { seen, restore: () => { globalThis.fetch = was; }, google: () => writes('www.googleapis.com'), ms: () => writes('graph.microsoft.com') };
}

/** One create hook, with the provider world counted. */
async function run(f: ReturnType<typeof fixture>, opts: { writeFails?: boolean } = {}) {
  const world = stubProviders(opts);
  try {
    const report = await onAxalSessionCreated(f.env, SESSION);
    return { report, google: world.google(), ms: world.ms(), seen: world.seen.slice() };
  } finally { world.restore(); }
}

const setTarget = (f: ReturnType<typeof fixture>, target: string) =>
  f.db.prepare('INSERT INTO calendar_settings(user_id, copy_target) VALUES (1, ?)').run(target);
const holdCopy = (f: ReturnType<typeof fixture>, provider: string) =>
  f.db.prepare(`INSERT INTO calendar_sync_records(user_id,provider,source_kind,source_id,external_event_id,last_synced_at)
    VALUES (1,?,'founder_checkin',41,'held-id','2026-11-01T00:00:00Z')`).run(provider);
const outcomeFor = (report: any[], provider: string) => report.find((r) => r.provider === provider)?.outcome ?? null;

test('1: a readable preference decides the providers, as it always did', async () => {
  for (const [target, want] of [['none', [0, 0]], ['google', [1, 0]], ['microsoft', [0, 1]], ['all', [1, 1]]] as const) {
    const f = fixture();
    try {
      setTarget(f, target);
      const r = await run(f);
      assert.deepEqual([r.google, r.ms], want, `copy_target='${target}'`);
    } finally { f.close(); }
  }
  // No row at all is the documented default: both providers, unchanged by this issue.
  const f = fixture();
  try {
    const r = await run(f);
    assert.deepEqual([r.google, r.ms], [1, 1], 'no setting row is no longer the default');
  } finally { f.close(); }
});

test('2: an unreadable preference creates nothing on any provider, and is not read as "all"', async () => {
  const f = fixture({ unreadable: ['calendar_settings'] });
  try {
    await assert.rejects(readCopyTarget(f.env, 1), 'the fixture did not make the preference unreadable');
    const r = await run(f);
    assert.deepEqual([r.google, r.ms], [0, 0], 'an unreadable preference wrote to a provider');
    assert.deepEqual([outcomeFor(r.report, 'google'), outcomeFor(r.report, 'microsoft')],
      ['preference_unreadable', 'preference_unreadable'], 'the refusal does not say why');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM calendar_sync_records').get()!.n, 0, 'a copy was recorded');
  } finally { f.close(); }
});

test('3: an unreadable preference keeps updating a copy already held, and still creates no other', async () => {
  const f = fixture({ unreadable: ['calendar_settings'] });
  try {
    holdCopy(f, 'microsoft');
    const r = await run(f);
    assert.equal(r.ms, 1, 'the copy Outlook already holds stopped being updated');
    assert.equal(r.google, 0, 'an unreadable preference created a copy on a provider that held none');
    assert.deepEqual([outcomeFor(r.report, 'microsoft'), outcomeFor(r.report, 'google')], ['existing_copy', 'preference_unreadable']);
    const rows = f.db.prepare('SELECT provider FROM calendar_sync_records').all() as any[];
    assert.deepEqual(rows.map((x) => x.provider), ['microsoft'], 'a new mapping was written');
  } finally { f.close(); }
});

test('4: the refusal is recorded against a connected provider only, in a code and nothing else', async () => {
  const f = fixture({ unreadable: ['calendar_settings'] });
  try {
    await run(f);
    for (const provider of ['google', 'microsoft'] as const) {
      const read = await readSyncError(f.env, 1, provider);
      assert.equal(read.error?.code, 'copy_preference_unreadable', `${provider} records no outcome`);
      assert.equal(read.error?.message, SYNC_ERRORS.copy_preference_unreadable);
    }
  } finally { f.close(); }
  // A provider the member never connected has no row to record against, so a refusal there says nothing.
  const bare = fixture({ unreadable: ['calendar_settings'] });
  try {
    bare.db.exec('DELETE FROM microsoft_oauth_tokens');
    await run(bare);
    assert.equal((await readSyncError(bare.env, 1, 'microsoft')).error, null, 'a disconnected provider recorded a failure');
  } finally { bare.close(); }
});

test('5: a provider write that fails does not rewrite the stored preference', async () => {
  const f = fixture();
  try {
    setTarget(f, 'google');
    const r = await run(f, { writeFails: true });
    assert.equal(outcomeFor(r.report, 'google'), 'write_refused');
    assert.equal(await readCopyTarget(f.env, 1), 'google', 'the member\'s preference was rewritten by a failed write');
    const rows = f.db.prepare('SELECT COUNT(*) AS n FROM calendar_settings').get() as any;
    assert.equal(rows.n, 1, 'the settings row was duplicated or removed');
  } finally { f.close(); }
  // The same for an unreadable preference: nothing is stored in its place.
  const u = fixture({ unreadable: ['calendar_settings'] });
  try {
    await run(u);
    assert.equal(u.db.prepare('SELECT COUNT(*) AS n FROM calendar_settings').get()!.n, 0, 'an unreadable read wrote a preference row');
  } finally { u.close(); }
});

test('6: no refusal carries the session\'s title, address, join link or a provider body', async () => {
  const f = fixture({ unreadable: ['calendar_settings'] });
  let said = '';
  let stored: any = null;
  // Everything is read back BEFORE a single assertion: an assertion that failed while `console.warn` was still
  // the collector took the runner's own reporting with it, and the suite hung instead of failing.
  const was = console.warn;
  const warned: string[] = [];
  try {
    console.warn = (...args: unknown[]) => { warned.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
    await run(f);
  } finally {
    console.warn = was;
    said = warned.join('\n');
    stored = f.db.prepare('SELECT last_sync_error FROM google_oauth_tokens WHERE user_id = 1').get();
    f.close();
  }
  for (const secret of [TITLE, JOIN, ADDRESS, 'refused']) {
    assert.ok(!said.includes(secret), `a log line carried ${secret}`);
  }
  assert.ok(/preference_unreadable/.test(said), 'the refusal was not logged by its outcome');
  assert.equal(stored.last_sync_error, 'copy_preference_unreadable');
});
