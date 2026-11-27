/**
 * D8249 (#8249, Pitch analytics PS-08 B) — seconds per card per visit on one
 * investor link, from the heartbeat rows D663 already keeps (no migration).
 *
 *   1. A link with several visits: each visit's own cards and its longest,
 *      newest first, never another visit's seconds or another link's.
 *   2. A visit with no heartbeat: every figure of it is null, never 0.
 *   3. Tracking off: `visit_reads` is null, as `cards` is.
 *   4. The read is bounded to the newest visits, and reads them on their own.
 *   5. The pure read: rows by place before 714, uids the link does not send,
 *      zero seconds, ties.
 *
 * In-memory SQLite: a copy of the schema built once per run (baseline and every post-cutoff
 * migration, `_schema_once.mjs`). Synthetic names only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_visit_reads_d8249.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import deckSlideAnalytics from '../src/routes/deck_slide_analytics.ts';
import deckInvestorLinks from '../src/routes/deck_investor_links.ts';
import decks from '../src/routes/decks.ts';
import { VISIT_READS_LIMIT, visitReads } from '../src/services/decks/visitReads.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d8249-visit-reads-0123456789';
const ADMIN = 1, FOUNDER = 3, OTHER = 4, PLAIN_ADMIN = 9;
const P = 5, OTHER_P = 6, DECK = 6, PAT = 7, SAM = 8;

const SLIDES = [
  { uid: 'cover', title: 'Kestrel Labs', fields: [{ key: 'cover_headline', label: 'Headline', kind: 'paragraph', value: 'Seed round', source: 'data' }] },
  { uid: 'traction', title: 'Traction', fields: [{ key: 'traction_body', label: 'Traction', kind: 'paragraph', value: 'Synthetic traction.', source: 'data' }] },
  { uid: 'market', title: 'Market', fields: [{ key: 'market_body', label: 'Market', kind: 'paragraph', value: 'Synthetic market.', source: 'data' }] },
  { uid: 'ask', title: 'The Ask', fields: [{ key: 'ask_amount_usd', label: 'Ask', kind: 'paragraph', value: 'Synthetic ask', source: 'data' }] },
];

/**
 * #8592: the schema (baseline plus every post-cutoff migration) is built once per run by
 * `_schema_once.mjs` (D4133); each test loads its own in-memory copy of it, rows included,
 * and seeds its own rows on top.
 */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  u.run(PLAIN_ADMIN, 'admin', 'Al Admin', 'al@example.test', null);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, FOUNDER, OTHER, PLAIN_ADMIN]) ss.run(id, `j-${id}`);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  db.exec(`INSERT INTO projects (id, name, founder_id, sector, stage) VALUES (${P}, 'Kestrel Labs', 1001, 'Fintech', 'seed'), (${OTHER_P}, 'Other', 1002, 'Health', 'seed')`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, 2, ?, ?, 1, ?)')
    .run(DECK, P, JSON.stringify(SLIDES), 'Seed deck', '2026-10-21 09:00:00');
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm) VALUES (?, 'p-7', ?, 'Pat Partner', 'Fund A'), (?, 'p-8', ?, 'Sam Second', 'Fund B')").run(PAT, P, SAM, P);
  return db;
}

const app = new Hono<any>();
app.route('/api/decks', deckSlideAnalytics);
app.route('/api/decks', deckInvestorLinks);
app.route('/api/decks', decks);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function req(db: DatabaseSync, method: string, path: string, as: number | null = null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) {
    const role = as === ADMIN || as === PLAIN_ADMIN ? 'admin' : 'founder';
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role, jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const tokenOf = (sharePath: string) => sharePath.replace('/share/deck/', '');
const make = (db: DatabaseSync, body: Record<string, unknown> = {}) => req(db, 'POST', `/api/decks/${DECK}/investor-links`, ADMIN, { prospect_id: PAT, expires_days: 14, ...body });
/** Open a link as its reader, and answer the view id the heartbeat names. */
async function open(db: DatabaseSync, made: any) {
  const r = await req(db, 'GET', `/api/decks/share/${tokenOf(made.body.share_path)}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return Number(r.body.view_id);
}
const beat = (db: DatabaseSync, made: any, viewId: number, seconds: number, slides: Record<string, number>) =>
  req(db, 'POST', `/api/decks/share/${tokenOf(made.body.share_path)}/heartbeat`, null, { view_id: viewId, seconds, slides });
const analytics = (db: DatabaseSync, linkId: number, as = ADMIN) => req(db, 'GET', `/api/decks/${DECK}/investor-links/${linkId}/analytics`, as);

const visitOf = (v: any) => (v.cards ? Object.fromEntries(v.cards.map((c: any) => [c.card_uid, c.seconds])) : null);

test('D8249 1: a link with several visits answers each visit\'s cards and its longest, newest first', async () => {
  const db = fixture();
  const pat = await make(db);
  const sam = await make(db, { prospect_id: SAM });
  const v1 = await open(db, pat);
  await beat(db, pat, v1, 30, { 0: 10, 1: 20 });
  await beat(db, pat, v1, 60, { 0: 12, 1: 40, 3: 8 });
  const v2 = await open(db, pat);
  await beat(db, pat, v2, 45, { 1: 15, 3: 30 });
  const vs = await open(db, sam);
  await beat(db, sam, vs, 90, { 2: 70 });

  const a = await analytics(db, pat.body.link.id);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.visit_reads_limit, VISIT_READS_LIMIT);
  assert.deepEqual(a.body.visit_reads.map((v: any) => v.view_id), [v2, v1], 'newest first');
  const [second, first] = a.body.visit_reads;
  assert.deepEqual(visitOf(first), { cover: 12, traction: 40, ask: 8 }, 'a running total holds its last beat');
  assert.deepEqual(visitOf(second), { traction: 15, ask: 30 }, 'only this visit\'s seconds');
  assert.deepEqual([first.cards_read, first.seconds, first.longest.card_uid, first.longest.title], [3, 60, 'traction', 'Traction']);
  assert.deepEqual([second.cards_read, second.seconds, second.longest.card_uid, second.longest.title], [2, 45, 'ask', 'The Ask']);
  assert.ok(first.at && second.at, 'each visit carries when it was counted');
  // The visits add up to the link's own seconds per card.
  const sum: Record<string, number> = {};
  for (const v of a.body.visit_reads) for (const c of v.cards ?? []) sum[c.card_uid] = (sum[c.card_uid] ?? 0) + c.seconds;
  assert.deepEqual(sum, Object.fromEntries(a.body.cards.filter((c: any) => c.seconds != null).map((c: any) => [c.card_uid, c.seconds])));
  const s = await analytics(db, sam.body.link.id);
  assert.deepEqual(s.body.visit_reads.map(visitOf), [{ market: 70 }], 'Sam\'s visit is Sam\'s alone');
});

test('D8249 2: a visit with no heartbeat reads null, never 0', async () => {
  const db = fixture();
  const pat = await make(db);
  const v1 = await open(db, pat);
  await beat(db, pat, v1, 20, { 1: 20 });
  const v2 = await open(db, pat);
  const a = await analytics(db, pat.body.link.id);
  const quiet = a.body.visit_reads.find((v: any) => v.view_id === v2);
  assert.deepEqual([quiet.cards_read, quiet.seconds, quiet.longest, quiet.cards], [null, null, null, null]);
  assert.equal(a.body.visit_reads.find((v: any) => v.view_id === v1).cards_read, 1);
  // A heartbeat that counted 0 s on every card is not a read either.
  const v3 = await open(db, pat);
  await beat(db, pat, v3, 0, { 0: 0 });
  const b = await analytics(db, pat.body.link.id);
  assert.equal(b.body.visit_reads.find((v: any) => v.view_id === v3).cards_read, null);
  // A link nobody opened has no visits: an empty list, not a row of zeros.
  const sam = await make(db, { prospect_id: SAM });
  assert.deepEqual((await analytics(db, sam.body.link.id)).body.visit_reads, []);
});

test('D8249 3: with Time per slide off, visit_reads is null, as cards is; the visits still count', async () => {
  const db = fixture();
  const made = await make(db, { time_per_slide: false });
  const view = await open(db, made);
  await beat(db, made, view, 60, { 0: 20, 1: 40 });
  const a = await analytics(db, made.body.link.id);
  assert.deepEqual([a.body.time_per_slide, a.body.views, a.body.cards, a.body.visit_reads], [false, 1, null, null]);
  // Turned off after a timed visit: what was counted is kept, and shown again once it is back on.
  const live = await make(db, { prospect_id: SAM });
  const lv = await open(db, live);
  await beat(db, live, lv, 30, { 1: 30 });
  await req(db, 'PUT', `/api/decks/${DECK}/investor-links/${live.body.link.id}/time-per-slide`, FOUNDER, { on: false });
  assert.equal((await analytics(db, live.body.link.id)).body.visit_reads, null);
  await req(db, 'PUT', `/api/decks/${DECK}/investor-links/${live.body.link.id}/time-per-slide`, FOUNDER, { on: true });
  assert.deepEqual((await analytics(db, live.body.link.id)).body.visit_reads.map(visitOf), [{ traction: 30 }]);
});

test('D8249 4: bounded to the newest visits, read on their own', async () => {
  const db = fixture();
  const pat = await make(db);
  const link = pat.body.link.id;
  const add = db.prepare('INSERT INTO deck_share_views (share_token_id, deck_id, read_seconds, created_at) VALUES (?, ?, 0, ?)');
  const slide = db.prepare('INSERT INTO deck_view_slides (view_id, slide_index, card_uid, seconds, updated_at) VALUES (?, 1, ?, ?, ?)');
  const total = VISIT_READS_LIMIT + 5;
  for (let i = 0; i < total; i += 1) {
    const at = `2026-11-${String(1 + Math.floor(i / 24)).padStart(2, '0')} ${String(i % 24).padStart(2, '0')}:00:00`;
    const id = Number(add.run(link, DECK, at).lastInsertRowid);
    slide.run(id, 'traction', i + 1, at);
  }
  const a = await analytics(db, link);
  assert.equal(a.body.visit_reads.length, VISIT_READS_LIMIT);
  assert.deepEqual(a.body.visit_reads.slice(0, 2).map((v: any) => v.seconds), [total, total - 1], 'the newest visit first');
  assert.equal(a.body.visit_reads.at(-1).seconds, total - VISIT_READS_LIMIT + 1, 'the oldest five are left out');
});

test('D8249 5: the pure read: rows by place, uids the link does not send, zero seconds, ties', () => {
  const cards = [{ uid: 'cover', title: 'Cover' }, { uid: 'traction', title: '  ' }, { uid: 'ask', title: 'Ask' }];
  const row = (view_id: number, slide_index: number, card_uid: string | null, seconds: number) => ({ view_id, slide_index, card_uid, seconds, updated_at: null });
  const out = visitReads(cards, [{ id: 1, created_at: '2026-11-01 10:00:00' }, { id: 2, created_at: '2026-11-02 10:00:00' }, { id: 3, created_at: '2026-11-02 10:00:00' }], [
    row(1, 0, null, 9), row(1, 2, 'ask', 9), row(1, 1, 'gone', 50),
    row(2, 1, 'traction', 0),
    row(3, 1, 'traction', 7),
  ]);
  assert.deepEqual(out.map((v) => v.view_id), [3, 2, 1], 'newest first; a tie on the time keeps the later id first');
  assert.deepEqual(out[2].cards!.map((c) => [c.card_uid, c.seconds]), [['cover', 9], ['ask', 9]], 'a row by place reads its card; a uid the link does not send is dropped');
  assert.equal(out[2].longest!.card_uid, 'cover', 'a tie keeps the first card in the link\'s order');
  assert.equal(out[1].cards_read, null, '0 s is not a read');
  assert.equal(out[0].longest!.title, null, 'a blank title is null, not a made-up name');
  assert.deepEqual(visitReads(cards, [{ id: 1, created_at: 'x' }], [], 0), []);
});
