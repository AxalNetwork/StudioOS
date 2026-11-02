/**
 * D1573 (#3820, deck builder v2 D12) — per-slide investor analytics on the
 * investor links (PD-8 · pd37, pd35's Analytics cell).
 *
 *   1. Per-card time per investor equals the heartbeat fixtures, by card uid,
 *      one investor's seconds never in another's.
 *   2. A tailored link's slide places name the variant's cards.
 *   3. With "Time per slide" off only counts are stored: the view row, no read
 *      seconds, no seconds per card; the read answers null, never 0.
 *   4. The consent switch on a live link: off stops what is stored from then on.
 *   5. The visit timeline: Opened, Accepted the NDA, Reached the ask, Revisited.
 *   6. Withdrawing a link keeps its analytics so far, and stores nothing more.
 *   7. Missing is null: a link nobody opened has no seconds and no most-read card.
 *   8. The engagement median leaves out a view with time off.
 *   9. The gate, as the engagement route's.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration. Synthetic names only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_slide_analytics_d1573.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import deckSlideAnalytics from '../src/routes/deck_slide_analytics.ts';
import deckInvestorLinks from '../src/routes/deck_investor_links.ts';
import decks from '../src/routes/decks.ts';
import { cardsWithSeconds, secondsByCard, timePerSlideOn, visitTimeline, withTimePerSlide } from '../src/services/decks/slideAnalytics.ts';
import { parseShareInclude } from '../src/services/decks/shareInclude.ts';
import { publishOf, withPublish } from '../src/services/decks/publish.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1573-slide-analytics-0123456789';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const ADMIN = 1, FOUNDER = 3, OTHER = 4, PLAIN_ADMIN = 9;
const P = 5, OTHER_P = 6, DECK = 6, PAT = 7, SAM = 8;

const SLIDES = [
  { uid: 'cover', title: 'Kestrel Labs', fields: [{ key: 'cover_headline', label: 'Headline', kind: 'paragraph', value: 'Seed round', source: 'data' }] },
  { uid: 'traction', title: 'Traction', fields: [{ key: 'traction_body', label: 'Traction', kind: 'paragraph', value: 'Synthetic traction.', source: 'data' }] },
  { uid: 'market', title: 'Market', fields: [{ key: 'market_body', label: 'Market', kind: 'paragraph', value: 'Synthetic market.', source: 'data' }] },
  { uid: 'ask', title: 'The Ask', fields: [{ key: 'ask_amount_usd', label: 'Ask', kind: 'paragraph', value: 'Synthetic ask', source: 'data' }] },
];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
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
const secondsOf = (body: any) => Object.fromEntries(body.cards.map((c: any) => [c.card_uid, c.seconds]));

// The heartbeat fixtures: the reader's running totals per slide place, as `PitchDeckPrintPage.jsx` sends them.
const PAT_BEATS = [
  { seconds: 30, slides: { 0: 10, 1: 20 } },
  { seconds: 60, slides: { 0: 12, 1: 40, 3: 8 } },
];
const PAT_VIEW_2 = { seconds: 45, slides: { 1: 15, 3: 30 } };
const SAM_BEATS = [{ seconds: 90, slides: { 2: 70, 3: 20 } }];

test('D1573 1: per-card time per investor equals the heartbeat fixtures, by card uid', async () => {
  const db = fixture();
  const pat = await make(db);
  const sam = await make(db, { prospect_id: SAM });
  assert.equal(pat.status, 201, JSON.stringify(pat.body));
  assert.equal(pat.body.link.time_per_slide, true, 'on unless the founder turns it off, as pd35\'s row editor draws it');
  const v1 = await open(db, pat);
  for (const b of PAT_BEATS) assert.equal((await beat(db, pat, v1, b.seconds, b.slides)).body.ok, true);
  const v2 = await open(db, pat);
  await beat(db, pat, v2, PAT_VIEW_2.seconds, PAT_VIEW_2.slides);
  const vs = await open(db, sam);
  for (const b of SAM_BEATS) await beat(db, sam, vs, b.seconds, b.slides);

  const a = await analytics(db, pat.body.link.id);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  // A running total only grows: view 1 holds its last beat, view 2 its own, summed per card.
  assert.deepEqual(secondsOf(a.body), { cover: 12, traction: 40 + 15, market: null, ask: 8 + 30 });
  assert.deepEqual(a.body.most_read, { card_uid: 'traction', index: 1, title: 'Traction', seconds: 55 });
  assert.equal(a.body.views, 2);
  assert.equal(a.body.read_seconds, 60 + 45);
  assert.equal(a.body.time_per_slide, true);
  assert.deepEqual(a.body.investor, { label: 'Pat Partner', fund: 'Fund A', prospect_id: PAT });
  const s = await analytics(db, sam.body.link.id);
  assert.deepEqual(secondsOf(s.body), { cover: null, traction: null, market: 70, ask: 20 }, 'Sam\'s seconds are Sam\'s alone');
  // Every stored second names its card by uid.
  const unnamed = db.prepare('SELECT COUNT(*) AS n FROM deck_view_slides WHERE card_uid IS NULL').get() as any;
  assert.equal(Number(unnamed.n), 0);
});

test('D1573 2: a tailored link\'s slide places name the variant\'s cards', async () => {
  const db = fixture();
  const v = await req(db, 'POST', `/api/decks/${DECK}/variants`, ADMIN, { name: 'For Fund A', slide_order: [3, 2, 1, 0] });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const made = await make(db, { variant_uid: v.body.variant.uid });
  const view = await open(db, made);
  await beat(db, made, view, 40, { 0: 25, 3: 5 });
  const a = await analytics(db, made.body.link.id);
  assert.deepEqual(a.body.cards.map((c: any) => c.card_uid), ['ask', 'market', 'traction', 'cover'], 'the cards in the order the reader saw them');
  assert.deepEqual(secondsOf(a.body), { ask: 25, market: null, traction: null, cover: 5 }, 'place 0 on this link is the ask, not the cover');
});

test('D1573 3: with Time per slide off, only counts are stored', async () => {
  const db = fixture();
  const made = await make(db, { time_per_slide: false });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.link.time_per_slide, false);
  const view = await open(db, made);
  const hb = await beat(db, made, view, 60, { 0: 20, 1: 40 });
  assert.deepEqual(hb.body, { ok: true, counts_only: true });
  const stored = db.prepare('SELECT COUNT(*) AS n, SUM(read_seconds) AS secs FROM deck_share_views WHERE share_token_id = ?').get(made.body.link.id) as any;
  assert.equal(Number(stored.n), 1, 'the visit is counted');
  assert.equal(Number(stored.secs), 0, 'no read seconds are written');
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM deck_view_slides').get() as any).n), 0, 'no seconds per card are written');
  const a = await analytics(db, made.body.link.id);
  assert.equal(a.body.time_per_slide, false);
  assert.equal(a.body.views, 1);
  assert.equal(a.body.cards, null, 'no per-card answer, never a row of zeros');
  assert.equal(a.body.most_read, null);
  assert.equal(a.body.read_seconds, null);
  const row = (await req(db, 'GET', `/api/decks/${DECK}/investor-links`, ADMIN)).body.links.find((r: any) => r.id === made.body.link.id);
  assert.deepEqual([row.time_per_slide, row.analytics.views, row.analytics.read_seconds], [false, 1, null]);
  assert.equal((await make(db, { time_per_slide: 'no' })).status, 400, 'the switch is true or false');
  // The consent rides on include_json beside what the link includes and D1564's publish, and changes neither.
  const json = withTimePerSlide(withPublish('{"figures":false}', { on: true, gate: 'email', exemption: '506c', embed_origins: [], at: 'x' } as any), false);
  assert.equal(timePerSlideOn(json), false);
  assert.equal(parseShareInclude(json).figures, false);
  assert.equal(publishOf(json)?.on, true);
  assert.equal(timePerSlideOn(null), true);
  assert.equal(timePerSlideOn('not json'), true);
});

test('D1573 4: the consent switch on a live link stops what is stored from then on, and keeps what was counted', async () => {
  const db = fixture();
  const made = await make(db);
  const view = await open(db, made);
  await beat(db, made, view, 30, { 1: 30 });
  const off = await req(db, 'PUT', `/api/decks/${DECK}/investor-links/${made.body.link.id}/time-per-slide`, FOUNDER, { on: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.link.time_per_slide, false);
  await beat(db, made, view, 90, { 1: 50, 2: 40 });
  const rows = db.prepare('SELECT card_uid, seconds FROM deck_view_slides ORDER BY slide_index').all() as any[];
  assert.deepEqual(rows.map((r) => [r.card_uid, Number(r.seconds)]), [['traction', 30]], 'nothing more after Off');
  assert.equal((await analytics(db, made.body.link.id)).body.cards, null);
  const on = await req(db, 'PUT', `/api/decks/${DECK}/investor-links/${made.body.link.id}/time-per-slide`, FOUNDER, { on: true });
  assert.equal(on.body.link.time_per_slide, true);
  assert.equal(secondsOf((await analytics(db, made.body.link.id)).body).traction, 30, 'what was counted before is kept');
  assert.equal((await req(db, 'PUT', `/api/decks/${DECK}/investor-links/${made.body.link.id}/time-per-slide`, FOUNDER, { on: 'yes' })).status, 422);
});

test('D1573 5: the visit timeline: Opened, Accepted the NDA, Reached the ask, Revisited', async () => {
  const db = fixture();
  const made = await make(db);
  const id = made.body.link.id;
  const v1 = await open(db, made);
  await beat(db, made, v1, 120, { 0: 30, 3: 60 });
  const v2 = await open(db, made);
  await beat(db, made, v2, 20, { 1: 20 });
  db.prepare("UPDATE deck_share_views SET created_at = '2026-10-12 09:14:00' WHERE id = ?").run(v1);
  db.prepare("UPDATE deck_view_slides SET updated_at = '2026-10-12 09:21:00' WHERE view_id = ?").run(v1);
  db.prepare("UPDATE deck_share_views SET created_at = '2026-10-14 18:02:00' WHERE id = ?").run(v2);
  db.prepare('UPDATE pitch_deck_share_tokens SET nda_required = 1 WHERE id = ?').run(id);
  db.prepare("INSERT INTO deck_share_conversions (view_id, share_token_id, deck_id, project_id, type, created_at) VALUES (NULL, ?, ?, ?, 'nda_signed', '2026-10-12 09:15:00')").run(id, DECK, P);
  const a = await analytics(db, id);
  assert.equal(a.body.ask_card_uid, 'ask');
  assert.deepEqual(a.body.timeline, [
    { kind: 'opened', at: '2026-10-12 09:14:00', view_id: v1 },
    { kind: 'nda_accepted', at: '2026-10-12 09:15:00', view_id: null },
    { kind: 'reached_ask', at: '2026-10-12 09:21:00', view_id: v1 },
    { kind: 'revisited', at: '2026-10-14 18:02:00', view_id: v2 },
  ]);
  assert.deepEqual(a.body.nda, { state: 'accepted', accepted_at: '2026-10-12 09:15:00' });
  // A tie reads in the order a reader lives it.
  assert.deepEqual(visitTimeline({ views: [{ id: 2, created_at: '2026-10-01 10:00:00' }, { id: 1, created_at: '2026-10-01 10:00:00' }], nda_accepted_at: '2026-10-01 10:00:00', reached_ask: [] })
    .map((e) => e.kind), ['opened', 'nda_accepted', 'revisited']);
});

test('D1573 6: withdrawing a link keeps its analytics so far, and stores nothing more', async () => {
  const db = fixture();
  const made = await make(db);
  const view = await open(db, made);
  await beat(db, made, view, 40, { 0: 15, 1: 25 });
  const w = await req(db, 'POST', `/api/decks/${DECK}/investor-links/${made.body.link.id}/withdraw`, ADMIN);
  assert.equal(w.status, 200);
  assert.equal((await beat(db, made, view, 99, { 0: 50, 1: 49 })).body.ok, false, 'a withdrawn link takes no more heartbeats');
  const a = await analytics(db, made.body.link.id);
  assert.equal(a.status, 200);
  assert.equal(a.body.status, 'withdrawn');
  assert.deepEqual(secondsOf(a.body), { cover: 15, traction: 25, market: null, ask: null });
  assert.equal(a.body.views, 1);
});

test('D1573 7: missing is null, never 0', async () => {
  const db = fixture();
  const made = await make(db);
  const a = await analytics(db, made.body.link.id);
  assert.equal(a.body.views, 0, 'no view is a counted zero');
  assert.equal(a.body.read_seconds, null);
  assert.equal(a.body.last_viewed_at, null);
  assert.deepEqual(a.body.cards.map((c: any) => c.seconds), [null, null, null, null]);
  assert.equal(a.body.most_read, null);
  assert.deepEqual(a.body.timeline, []);
  const row = (await req(db, 'GET', `/api/decks/${DECK}/investor-links`, ADMIN)).body.links[0];
  assert.equal(row.analytics.read_seconds, null, 'the pd35 row too');
  // The pure parts: a row by place before 714 counts against the link's cards; a zero or an unknown card is dropped.
  const cards = [{ uid: 'a', title: 'A' }, { uid: 'b', title: '  ' }];
  assert.deepEqual([...secondsByCard(cards, [
    { view_id: 1, slide_index: 1, card_uid: null, seconds: 4, updated_at: null },
    { view_id: 1, slide_index: 0, card_uid: 'zz', seconds: 9, updated_at: null },
    { view_id: 1, slide_index: 0, card_uid: 'a', seconds: 0, updated_at: null },
  ])], [['b', 4]]);
  assert.deepEqual(cardsWithSeconds(cards, []).cards[1], { card_uid: 'b', index: 1, title: null, seconds: null });
});

test('D1573 8: the engagement median leaves out a view with Time per slide off', async () => {
  const db = fixture();
  const timed = await make(db);
  const off = await make(db, { prospect_id: SAM, time_per_slide: false });
  const v1 = await open(db, timed);
  await beat(db, timed, v1, 100, { 0: 100 });
  // A second browser opens the consent-off link: its own viewer, with no seconds stored.
  const r = await app.request(`/api/decks/share/${tokenOf(off.body.share_path)}`, { headers: { 'user-agent': 'synthetic-second-browser' } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  assert.equal(r.status, 200);
  const e = await req(db, 'GET', `/api/decks/${DECK}/engagement`, ADMIN);
  assert.equal(e.status, 200);
  assert.equal(e.body.analytics.viewers, 2, 'both are viewers');
  assert.equal(e.body.analytics.median_seconds_per_viewer, 100, 'the median of the timed viewer alone, not of 100 and 0');
});

test('D1573 9: the gate is the engagement route\'s', async () => {
  const db = fixture();
  const made = await make(db);
  const id = made.body.link.id;
  assert.equal((await analytics(db, id, FOUNDER)).status, 200, 'the venture\'s founder reads it');
  assert.equal((await analytics(db, id, OTHER)).status, 403);
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/investor-links/${id}/analytics`)).status, 401);
  assert.equal((await analytics(db, 999)).status, 404, 'a link that is not this deck\'s');
  assert.equal((await req(db, 'GET', `/api/decks/999/investor-links/${id}/analytics`, ADMIN)).status, 404);
  // An admin who is not a Super Admin reads every deck, as on the engagement route, and writes none.
  assert.equal((await analytics(db, id, PLAIN_ADMIN)).status, 200);
  assert.equal((await req(db, 'PUT', `/api/decks/${DECK}/investor-links/${id}/time-per-slide`, PLAIN_ADMIN, { on: false })).status, 403, 'the consent is a write');
  assert.equal((await req(db, 'PUT', `/api/decks/${DECK}/investor-links/${id}/time-per-slide`, OTHER, { on: false })).status, 403);
  assert.equal((await req(db, 'PUT', `/api/decks/${DECK}/investor-links/${id}/time-per-slide`, null, { on: false })).status, 401);
  // A link with no investor (a plain studio link) is not an investor link.
  db.prepare('UPDATE pitch_deck_share_tokens SET prospect_id = NULL, investor_label = NULL WHERE id = ?').run(id);
  assert.equal((await analytics(db, id)).status, 404);
  assert.equal((await req(db, 'PUT', `/api/decks/${DECK}/investor-links/${id}/time-per-slide`, ADMIN, { on: false })).status, 404);
});
