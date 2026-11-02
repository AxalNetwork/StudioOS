/**
 * D1484 part 2 (#3978, of #3723) — a member's calendar source settings
 * (migration 708) and their routes.
 *
 *   1. 708 applies twice on the baseline; a read writes no default rows.
 *   2. PUT/GET round trip: hide, colour, a colour cleared, only the fields given change.
 *   3. Each refusal: unknown_source, invalid_colour, empty_body, invalid_copy_target,
 *      provider_not_connected. (The 401 is `requireAuth`'s, as on every calendar route.)
 *   4. User B neither reads nor changes A's settings.
 *   5. /events without `kinds` leaves hidden sources out and names them in
 *      `hidden`; with `kinds` it reads them. Hiding every source reads nothing.
 *   6. .ics and the subscription feed never read the settings, and .ics is unchanged.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import calendar from '../src/routes/calendar.ts';
import { SOURCE_KINDS } from '../src/services/calendar/registry.ts';
import { COLOURS, FAMILY_LABELS } from '../src/services/calendar/prefs.ts';
import { mintFeedToken, CALENDAR_FEED_SCOPE } from '../src/services/calendar/feedTokens.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort().map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const M708 = readFileSync(`${DIR}/708_calendar_source_prefs.sql`, 'utf8');
const SECRET = 'synthetic-calendar-prefs-708-'.repeat(3);
const FROM = '2026-11-01T00:00:00.000Z', TO = '2026-12-01T00:00:00.000Z';
const WINDOW = `from=${FROM}&to=${TO}`;
const A = 1, B = 2;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(M708); // applied twice
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,1),(2,'founder','Other founder','two@example.test',102,1);
   INSERT INTO calendar_events(uid,user_id,source,kind,external_uri,title,start_at,end_at,status) VALUES
    ('axal:manual:one',1,'manual','other','axal:manual:one','Fixture own event','2026-11-05T09:00:00.000Z','2026-11-05T10:00:00.000Z','scheduled'),
    ('axal:manual:two',2,'manual','other','axal:manual:two','Other own event','2026-11-06T09:00:00.000Z','2026-11-06T10:00:00.000Z','scheduled');`);
  const statements: string[] = [];
  const DB = {
    prepare(sql: string) {
      statements.push(sql);
      let args: any[] = [];
      const stmt: any = {
        bind(...values: any[]) { args = values.map((v) => v ?? null); return stmt; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return stmt;
    },
    async exec(sql: string) { db.exec(sql); },
    async batch(list: any[]) { return Promise.all(list.map((s) => s.run())); },
  };
  const ctx: any = { waitUntil() {}, passThroughOnException() {} };
  const env: any = { DB, JWT_SECRET: SECRET, SCORING_HMAC_SECRET: 'synthetic-scoring-708-'.repeat(3), ENVIRONMENT: 'production', APP_URL: 'https://axal.vc' };
  async function call(method: string, path: string, id = A, body?: unknown) {
    const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const init: any = { method, headers: { Cookie: `studioos_auth=${token}; studioos_csrf=fixture-csrf`, 'x-csrf-token': 'fixture-csrf', Origin: 'https://axal.vc', 'content-type': 'application/json' } };
    if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await calendar.request(path, init, env, ctx);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* .ics */ }
    return { status: res.status, body: json, text };
  }
  const rows = (user: number) => db.prepare('SELECT source_key, shown, colour FROM calendar_source_prefs WHERE user_id = ? ORDER BY source_key').all(user).map((r: any) => ({ ...r }));
  return { db, env, call, rows, statements, close: () => db.close() };
}

test('708: applies twice; GET answers every source shown with its family colour, and writes no default row', async () => {
  const f = fixture();
  try {
    const r = await f.call('GET', '/sources');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.families.map((x: any) => x.key), Object.keys(FAMILY_LABELS));
    assert.deepEqual(r.body.families.map((x: any) => x.label), Object.values(FAMILY_LABELS));
    assert.deepEqual(r.body.sources.map((s: any) => s.key), SOURCE_KINDS);
    for (const s of r.body.sources) {
      assert.deepEqual([s.shown, s.colour], [true, null], s.key);
      assert.ok(s.family && s.module && s.label && typeof s.page_only === 'boolean', s.key);
    }
    assert.equal(r.body.copy_target, 'all');
    assert.deepEqual(f.rows(A), [], 'absence is never written as a default row');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM calendar_settings').get().n, 0);
  } finally { f.close(); }
});

test('708: the PUT/GET round trip changes only the fields given', async () => {
  const f = fixture();
  try {
    let r = await f.call('PUT', '/sources/manual', A, { shown: false });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.source.key, r.body.source.shown, r.body.source.colour], ['manual', false, null]);
    r = await f.call('PUT', '/sources/manual', A, { colour: 'teal' });
    assert.deepEqual([r.body.source.shown, r.body.source.colour], [false, 'teal'], 'a colour keeps it hidden');
    r = await f.call('PUT', '/sources/interview_call', A, { colour: 'amber' });
    assert.deepEqual([r.body.source.shown, r.body.source.colour], [true, 'amber']);
    const read = await f.call('GET', '/sources');
    const by = Object.fromEntries(read.body.sources.map((s: any) => [s.key, s]));
    assert.deepEqual([by.manual.shown, by.manual.colour, by.interview_call.shown, by.interview_call.colour], [false, 'teal', true, 'amber']);
    r = await f.call('PUT', '/sources/manual', A, { shown: true, colour: null });
    assert.deepEqual([r.body.source.shown, r.body.source.colour], [true, null], 'null clears the colour');
    assert.deepEqual(f.rows(A), [{ source_key: 'interview_call', shown: 1, colour: 'amber' }, { source_key: 'manual', shown: 1, colour: null }]);
    for (const c of COLOURS) assert.equal((await f.call('PUT', '/sources/manual', A, { colour: c })).status, 200, c);
    // copy_target: all and none always; a provider once it is connected.
    assert.deepEqual((await f.call('PUT', '/settings', A, { copy_target: 'none' })).body, { copy_target: 'none' });
    assert.equal((await f.call('GET', '/sources')).body.copy_target, 'none');
    f.db.exec(`INSERT INTO google_oauth_tokens (user_id, refresh_token) VALUES (1, 'synthetic')`);
    assert.deepEqual((await f.call('PUT', '/settings', A, { copy_target: 'google' })).body, { copy_target: 'google' });
  } finally { f.close(); }
});

test('708: each refusal code', async () => {
  const f = fixture();
  try {
    const code = async (m: string, p: string, body?: unknown) => { const r = await f.call(m, p, A, body); return [r.status, r.body?.error]; };
    assert.deepEqual(await code('PUT', '/sources/ic_meetings', { shown: false }), [400, 'unknown_source'], 'a table name is no source');
    assert.deepEqual(await code('PUT', '/sources/__proto__', { shown: false }), [400, 'unknown_source']);
    assert.deepEqual(await code('PUT', '/sources/manual', { colour: '#ff0000' }), [400, 'invalid_colour'], 'hex is never stored');
    assert.deepEqual(await code('PUT', '/sources/manual', { colour: 'purple' }), [400, 'invalid_colour']);
    assert.deepEqual(await code('PUT', '/sources/manual', {}), [400, 'empty_body']);
    assert.deepEqual(await code('PUT', '/sources/manual', 'not json'), [400, 'empty_body']);
    assert.deepEqual(await code('PUT', '/sources/manual', { shown: 'no' }), [400, 'empty_body']);
    assert.deepEqual(await code('PUT', '/settings', { copy_target: 'icloud' }), [400, 'invalid_copy_target']);
    assert.deepEqual(await code('PUT', '/settings', {}), [400, 'invalid_copy_target']);
    assert.deepEqual(await code('PUT', '/settings', { copy_target: 'microsoft' }), [409, 'provider_not_connected']);
    assert.deepEqual(await code('PUT', '/settings', { copy_target: 'google' }), [409, 'provider_not_connected']);
    assert.deepEqual(f.rows(A), [], 'a refusal writes nothing');
  } finally { f.close(); }
});

test('708: user B neither reads nor changes A\'s settings', async () => {
  // Mutation checked: `WHERE user_id = ?1` dropped from readSourcePrefs → B reads A's hidden manual, this fails.
  const f = fixture();
  try {
    await f.call('PUT', '/sources/manual', A, { shown: false, colour: 'red' });
    const b = await f.call('GET', '/sources', B);
    const manual = b.body.sources.find((s: any) => s.key === 'manual');
    assert.deepEqual([manual.shown, manual.colour], [true, null], 'B sees its own defaults');
    await f.call('PUT', '/sources/manual', B, { colour: 'blue' });
    assert.deepEqual(f.rows(A), [{ source_key: 'manual', shown: 0, colour: 'red' }], 'B\'s write is B\'s row');
    assert.deepEqual(f.rows(B), [{ source_key: 'manual', shown: 1, colour: 'blue' }]);
    const bEvents = await f.call('GET', `/events?${WINDOW}`, B);
    assert.deepEqual(bEvents.body.hidden, []);
    assert.ok(bEvents.body.items.some((i: any) => i.kind === 'manual'), 'A hiding a source hides nothing for B');
  } finally { f.close(); }
});

test('708: /events leaves a hidden source out without kinds, names it in hidden, and reads it with kinds', async () => {
  // Mutation checked: the route ignoring `hidden` → the first manual assert fails.
  const f = fixture();
  try {
    const before = await f.call('GET', `/events?${WINDOW}`);
    assert.ok(before.body.items.some((i: any) => i.kind === 'manual'));
    assert.deepEqual(before.body.hidden, []);
    await f.call('PUT', '/sources/manual', A, { shown: false });
    const after = await f.call('GET', `/events?${WINDOW}`);
    assert.equal(after.status, 200);
    assert.ok(!after.body.items.some((i: any) => i.kind === 'manual'), 'hidden: not read');
    assert.ok(!after.body.sources.some((s: any) => s.kind === 'manual'), 'hidden: no source status either');
    assert.deepEqual(after.body.hidden, ['manual']);
    const asked = await f.call('GET', `/events?${WINDOW}&kinds=manual`);
    assert.ok(asked.body.items.some((i: any) => i.kind === 'manual'), 'an explicit kinds reads it');
    assert.deepEqual(asked.body.hidden, []);
    // Every source hidden: nothing is read, and the read still answers.
    for (const k of SOURCE_KINDS) await f.call('PUT', `/sources/${k}`, A, { shown: false });
    const none = await f.call('GET', `/events?${WINDOW}`);
    assert.equal(none.status, 200);
    assert.deepEqual([none.body.items, none.body.sources, none.body.hidden], [[], [], SOURCE_KINDS]);
  } finally { f.close(); }
});

test('708: .ics and the subscription feed never read the settings, and .ics is unchanged', async () => {
  // Mutation checked: /events.ics filtering by hiddenKinds → it reads calendar_source_prefs, this fails.
  const f = fixture();
  try {
    const before = await f.call('GET', `/events.ics?${WINDOW}`);
    assert.equal(before.status, 200);
    for (const k of SOURCE_KINDS) await f.call('PUT', `/sources/${k}`, A, { shown: false, colour: 'slate' });
    f.statements.length = 0;
    const after = await f.call('GET', `/events.ics?${WINDOW}`);
    const strip = (t: string) => t.replace(/^DTSTAMP:.*$/gm, '');
    assert.equal(strip(after.text), strip(before.text));
    const feed = await mintFeedToken(f.env, A, new Date(), CALENDAR_FEED_SCOPE);
    const sub = await calendar.request(`/feed/calendar.ics?token=${feed.token}`, { method: 'GET' }, f.env, { waitUntil() {}, passThroughOnException() {} } as any);
    assert.equal(sub.status, 200);
    assert.ok(!f.statements.some((s) => /calendar_source_prefs|calendar_settings/.test(s)), 'no export reads the settings');
  } finally { f.close(); }
});
