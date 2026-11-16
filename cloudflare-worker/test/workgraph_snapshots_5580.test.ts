/**
 * D5580 part 4 (#5580): the WorkGraph snapshot ingest and read.
 *
 * The real router over the full migrated schema. Pinned:
 *   - the ingest refuses with no secret configured (503), a missing or wrong
 *     token (401), an oversized body (413) and a body that is not a v2
 *     snapshot (400), and stores nothing in each case;
 *   - a good post is stored once (a re-post of the same bytes is not a second
 *     row), and only the latest KEEP rows are kept;
 *   - the read is Super Admin only, says "none" with no scan, and returns the
 *     newest scan with its age and stale flag.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/workgraph_snapshots_5580.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import workgraph from '../src/routes/admin_workgraph.ts';
import { KEEP, MAX_BYTES, STALE_AFTER_MINUTES, ingestSnapshot, latestSnapshot } from '../src/services/workgraphSnapshots.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const TOKEN = 'wg-ingest-test-token-0123456789abcdef';
const SUPER = 1, ADMIN = 2, MEMBER = 3;

function fresh() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Super', 'super@axal.example');
  u.run(ADMIN, 'admin', 'Admin', 'admin@axal.example');
  u.run(MEMBER, 'founder', 'Member', 'member@example.test');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  return db;
}

const snap = (generatedAt: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  schema: 'studioos-pr-overlap-snapshot/v2', decision: 'D5580', generatedAt, repo: 'example/repo', partial: false, notes: [],
  workInFlight: { status: 'read', partial: false, intents: [], refused: [], notes: [] }, prs: [], pairs: [], ...extra,
});

const app = new Hono<any>();
app.route('/api/admin/workgraph', workgraph);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function call(db: any, opts: { method: string; path: string; body?: string; token?: string | null; who?: number; secret?: string | null }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.who) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: opts.who, role: opts.who === MEMBER ? 'founder' : 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  if (opts.secret !== null) env.WORKGRAPH_INGEST_TOKEN = opts.secret ?? TOKEN;
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(opts.path, { method: opts.method, headers, body: opts.body }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; console.error = e; }
}
const rows = (db: any) => Number((db.prepare('SELECT COUNT(*) AS n FROM workgraph_snapshots').get() as any).n);
const post = (db: any, body: string, o: Partial<{ token: string | null; secret: string | null }> = {}) =>
  call(db, { method: 'POST', path: '/api/admin/workgraph/snapshots', body, token: o.token === undefined ? TOKEN : o.token, secret: o.secret });

test('the ingest refuses until configured, and refuses a missing or wrong token', async () => {
  const db = fresh();
  const s = snap('2026-11-15T22:03:00.000Z');
  assert.deepEqual([(await post(db, s, { secret: null })).status, (await post(db, s, { secret: null })).body.error], [503, 'workgraph_ingest_not_configured']);
  assert.deepEqual([(await post(db, s, { token: null })).status, (await post(db, s, { token: null })).body.error], [401, 'workgraph_ingest_unauthorized']);
  assert.equal((await post(db, s, { token: `${TOKEN}x` })).status, 401, 'a longer token');
  assert.equal((await post(db, s, { token: TOKEN.replace(/.$/, 'X') })).status, 401, 'a same-length wrong token');
  assert.equal((await post(db, s, { secret: '' })).status, 503, 'an empty secret is not configured');
  assert.equal(rows(db), 0, 'nothing stored');
});

test('the ingest refuses what is not a v2 snapshot, and an oversized body', async () => {
  const db = fresh();
  const cases: Array<[string, string]> = [
    ['not json', 'snapshot_not_json'],
    ['[]', 'snapshot_not_object'],
    [snap('2026-11-15T22:03:00.000Z', { schema: 'studioos-pr-overlap-snapshot/v1' }), 'snapshot_schema'],
    [snap('yesterday'), 'snapshot_generated_at'],
    [snap('2026-11-15 22:03:00'), 'snapshot_generated_at'], // Date.parse reads it; the scan time is ISO UTC or nothing
    [snap('2026-11-15T22:03:00.000Z', { partial: 'no' }), 'snapshot_partial'],
    [snap('2026-11-15T22:03:00.000Z', { prs: {} }), 'snapshot_lists'],
    [snap('2026-11-15T22:03:00.000Z', { workInFlight: null }), 'snapshot_work_in_flight'],
  ];
  for (const [body, code] of cases) {
    const out = await post(db, body);
    assert.deepEqual([out.status, out.body.error], [400, code], code);
  }
  const big = snap('2026-11-15T22:03:00.000Z', { notes: ['x'.repeat(MAX_BYTES)] });
  const out = await post(db, big);
  assert.deepEqual([out.status, out.body.error], [413, 'snapshot_too_large']);
  assert.equal(rows(db), 0);
});

test('a good post is stored once, and only the latest KEEP rows are kept', async () => {
  const db = fresh();
  const s = snap('2026-11-15T22:03:00.000Z', { partial: true });
  const first = await post(db, s);
  assert.deepEqual([first.status, first.body], [200, { ok: true, stored: true, generated_at: '2026-11-15T22:03:00.000Z', partial: true }]);
  assert.equal((await post(db, s)).body.stored, false, 'the same bytes again');
  assert.equal(rows(db), 1);
  const row = db.prepare('SELECT schema, partial, bytes, body_json FROM workgraph_snapshots').get() as any;
  assert.deepEqual({ ...row }, { schema: 'studioos-pr-overlap-snapshot/v2', partial: 1, bytes: Buffer.byteLength(s), body_json: s });

  const env: any = { DB: d1Over(db) };
  for (let i = 0; i < KEEP + 3; i++) {
    const t = new Date(Date.UTC(2026, 10, 1, 0, 0) + i * 3_600_000).toISOString();
    await ingestSnapshot(env, snap(t));
  }
  assert.equal(rows(db), KEEP, 'older rows deleted');
  const oldest = (db.prepare('SELECT MIN(generated_at) AS t FROM workgraph_snapshots').get() as any).t;
  assert.equal(oldest, new Date(Date.UTC(2026, 10, 1, 0, 0) + 4 * 3_600_000).toISOString(), 'the newest KEEP survive');
});

test('the read is Super Admin only, says none, then the newest scan with its age', async () => {
  const db = fresh();
  const read = (who: number) => call(db, { method: 'GET', path: '/api/admin/workgraph/in-flight', who });
  assert.equal((await read(MEMBER)).status, 403);
  assert.equal((await read(ADMIN)).status, 403, 'a plain admin');
  const none = await read(SUPER);
  assert.equal(none.status, 200);
  assert.equal(none.body.status, 'none');

  const env: any = { DB: d1Over(db) };
  await ingestSnapshot(env, snap('2026-11-15T20:00:00.000Z'));
  await ingestSnapshot(env, snap('2026-11-15T21:00:00.000Z', { partial: true }));
  const now = Date.parse('2026-11-15T21:30:00.000Z');
  const latest: any = await latestSnapshot(env, now);
  assert.equal(latest.status, 'read');
  assert.equal(latest.generated_at, '2026-11-15T21:00:00.000Z', 'the newest scan');
  assert.equal(latest.partial, true);
  assert.equal(latest.age_minutes, 30);
  assert.equal(latest.stale, false);
  assert.equal(latest.snapshot.workInFlight.status, 'read');
  const later: any = await latestSnapshot(env, now + (STALE_AFTER_MINUTES + 1) * 60_000);
  assert.equal(later.stale, true, 'past the stale line');
  const viaRoute = await read(SUPER);
  assert.equal(viaRoute.body.generated_at, '2026-11-15T21:00:00.000Z');

  db.exec("UPDATE workgraph_snapshots SET body_json = '{bad' WHERE generated_at = '2026-11-15T21:00:00.000Z'");
  const broken: any = await latestSnapshot(env, now);
  assert.equal(broken.status, 'unreadable', 'a stored scan that cannot be read is said, never drawn empty');
});
