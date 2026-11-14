/**
 * D4598 (#4598) — what a share link's viewer does is attributed to the card
 * and the investor link it happened on, and to nothing else.
 *
 *   1. A reaction's place is the card as THIS link sends it: its variant's
 *      order, less the hidden cards and what the link leaves out. Before, the
 *      place indexed the version's stored cards, so on a tailored link a
 *      reaction landed on another card.
 *   2. A heartbeat, a button click and a feedback form name a view. A view id
 *      from another link of the same deck, or another deck, changes nothing of
 *      that view: not its read seconds, not its seconds per card, and no event
 *      or feedback row is filed under it.
 *   3. A link's Time per slide setting still holds.
 *
 * Part 2 (#4598): `POST /api/decks/:id/preflight/link-cards` — the effective
 * content a PROPOSED link (no `pitch_deck_share_tokens` row yet) would send,
 * for Share's own check before it writes the link. It computes the SAME
 * selection `linkSentCards` computes for a persisted one (a variant's order,
 * less what "what is included" leaves out), through the same
 * `effectiveSlidesFor` the two share, so the check the dialog ran and the
 * card a reaction later attributes to are never two different lists.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration. Synthetic names only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_share_attribution_4598.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import deckShareActions from '../src/routes/deck_share_actions.ts';
import deckSlideAnalytics from '../src/routes/deck_slide_analytics.ts';
import deckInvestorLinks from '../src/routes/deck_investor_links.ts';
import deckPreflight from '../src/routes/deck_preflight.ts';
import decks from '../src/routes/decks.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d4598-attribution-0123456789ab';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const ADMIN = 1, FOUNDER = 3, OTHER = 4, PLAIN_ADMIN = 9;
const P = 5, OTHER_P = 6, DECK = 6, PAT = 7, SAM = 8;

const button = { id: 'b1', kind: 'button', url: 'https://example.com/book', label: 'Book a call', grid: { c1: 1, r1: 1, c2: 3, r2: 1 } };
// Five cards as stored: the second is hidden, the last is the Sources appendix.
const SLIDES = [
  { uid: 'cover', title: 'Kestrel Labs', blocks: [button], fields: [{ key: 'cover_headline', label: 'Headline', kind: 'paragraph', value: 'Seed round', source: 'data' }] },
  { uid: 'traction', hidden: true, title: 'Traction', fields: [{ key: 'traction_body', label: 'Traction', kind: 'paragraph', value: 'Synthetic traction.', source: 'data' }] },
  { uid: 'market', title: 'Market', blocks: [{ ...button, id: 'b2' }], fields: [{ key: 'market_body', label: 'Market', kind: 'paragraph', value: 'Synthetic market.', source: 'data' }] },
  { uid: 'ask', title: 'The Ask', fields: [{ key: 'ask_amount_usd', label: 'Ask', kind: 'paragraph', value: 'Synthetic ask', source: 'data' }] },
  { uid: 'sources', appendix: true, title: 'Sources', fields: [{ key: 'sources_body', label: 'Sources', kind: 'paragraph', value: 'Synthetic sources.', source: 'data' }] },
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
app.route('/api/decks', deckPreflight);
app.route('/api/decks', decks);
app.route('/api/decks', deckShareActions);
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


const click = (db: DatabaseSync, made: any, cardUid: string, blockId: string, viewId: number | null) =>
  req(db, 'POST', `/api/decks/share/${tokenOf(made.body.share_path)}/click`, null, { card_uid: cardUid, block_id: blockId, view_id: viewId });
const feedback = (db: DatabaseSync, made: any, viewId: number | null, slide_reactions: Record<string, string>) =>
  req(db, 'POST', `/api/decks/share/${tokenOf(made.body.share_path)}/feedback`, null, { view_id: viewId, slide_reactions, overall_note: 'Synthetic note' });
const reactionsByUid = (db: DatabaseSync) => (db.prepare('SELECT slide_reactions_by_uid AS r FROM deck_share_feedback ORDER BY id').all() as any[]).map((x) => JSON.parse(x.r || 'null'));

test('D4598 1: a reaction is filed on the card the link sent at that place, through a variant, a hidden card and an excluded appendix', async () => {
  const db = fixture();
  // No variant: the hidden Traction card is not sent, so place 1 is Market.
  const plain = await make(db);
  assert.equal((await feedback(db, plain, await open(db, plain), { 0: 'up', 1: 'down', 2: 'up', 3: 'up' })).status, 200);
  // A variant [ask, market, traction, cover]: Traction is hidden, so the link sends ask, market, cover, sources.
  const v = await req(db, 'POST', `/api/decks/${DECK}/variants`, ADMIN, { name: 'For Fund A', slide_order: [3, 2, 1, 0] });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const tailored = await make(db, { prospect_id: SAM, variant_uid: v.body.variant.uid });
  assert.equal((await feedback(db, tailored, await open(db, tailored), { 0: 'up', 2: 'down' })).status, 200);
  // The Sources appendix left out of a link: three cards, and a place past them names nothing.
  const bare = await make(db, { prospect_id: PAT });
  db.prepare('UPDATE pitch_deck_share_tokens SET include_json = ? WHERE id = ?').run(JSON.stringify({ sources: false }), bare.body.link.id);
  assert.equal((await feedback(db, bare, await open(db, bare), { 2: 'down', 3: 'up' })).status, 200);
  assert.deepEqual(reactionsByUid(db), [
    { cover: 'up', market: 'down', ask: 'up', sources: 'up' },
    { ask: 'up', cover: 'down' },
    { ask: 'down' },
  ]);
});

test('D4598 2: a view id from another link changes nothing of that view, whichever event names it', async () => {
  const db = fixture();
  const pat = await make(db);
  const sam = await make(db, { prospect_id: SAM });
  const patView = await open(db, pat);
  const samView = await open(db, sam);
  assert.equal((await beat(db, pat, patView, 30, { 0: 10, 1: 20 })).body.ok, true);
  const before = {
    views: db.prepare('SELECT id, read_seconds, updated_at FROM deck_share_views ORDER BY id').all(),
    cards: db.prepare('SELECT view_id, slide_index, card_uid, seconds FROM deck_view_slides ORDER BY view_id, slide_index').all(),
  };
  // Sam's token names Pat's view: no beat is recorded anywhere.
  const stray = await beat(db, sam, patView, 900, { 0: 800, 2: 100 });
  assert.deepEqual(stray.body, { ok: false });
  assert.deepEqual({
    views: db.prepare('SELECT id, read_seconds, updated_at FROM deck_share_views ORDER BY id').all(),
    cards: db.prepare('SELECT view_id, slide_index, card_uid, seconds FROM deck_view_slides ORDER BY view_id, slide_index').all(),
  }, before, 'Pat\'s visit and its seconds per card are as they were');
  // A view that does not exist, and one that is not a number, record nothing.
  assert.deepEqual((await beat(db, sam, 99999, 30, { 0: 10 })).body, { ok: false });
  assert.deepEqual((await beat(db, sam, 'x' as any, 30, { 0: 10 })).body, { ok: true });
  // Sam's own beat still counts, on Sam's visit.
  assert.equal((await beat(db, sam, samView, 45, { 2: 45 })).body.ok, true);
  assert.equal(Number((db.prepare('SELECT read_seconds AS s FROM deck_share_views WHERE id = ?').get(samView) as any).s), 45);

  // A click and a feedback form keep the event, and file it under no view when the id is another link's.
  assert.equal((await click(db, sam, 'cover', 'b1', patView)).status, 200);
  assert.equal((await click(db, sam, 'cover', 'b1', samView)).status, 200);
  assert.equal((await feedback(db, sam, patView, { 0: 'up' })).status, 200);
  assert.equal((await feedback(db, sam, samView, { 0: 'up' })).status, 200);
  const conv = db.prepare("SELECT view_id, share_token_id FROM deck_share_conversions WHERE type = 'button_click' ORDER BY id").all() as any[];
  assert.deepEqual(conv.map((r) => [r.view_id, r.share_token_id]), [[null, sam.body.link.id], [samView, sam.body.link.id]], 'the stray click is filed on Sam\'s link and on no visit');
  const fb = db.prepare('SELECT view_id FROM deck_share_feedback ORDER BY id').all() as any[];
  assert.deepEqual(fb.map((r) => r.view_id), [null, samView]);
  // Pat's visit has no click and no feedback of Sam's.
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM deck_share_conversions WHERE view_id = ?').get(patView) as any).n), 0);
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM deck_share_feedback WHERE view_id = ?').get(patView) as any).n), 0);
});

test('D4598 3: a view of another deck is no view of this link, and Time per slide off still stores counts only', async () => {
  const db = fixture();
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, 1, ?, ?, 0, ?)')
    .run(DECK + 1, OTHER_P, JSON.stringify(SLIDES), 'Other deck', '2026-10-20 09:00:00');
  db.prepare("INSERT INTO deck_share_views (share_token_id, deck_id, ip_hash, ua_fingerprint, read_seconds) VALUES (999, ?, 'x', 'y', 0)").run(DECK + 1);
  const foreign = Number((db.prepare('SELECT MAX(id) AS id FROM deck_share_views').get() as any).id);
  const pat = await make(db);
  await open(db, pat);
  assert.deepEqual((await beat(db, pat, foreign, 60, { 0: 60 })).body, { ok: false });
  assert.equal(Number((db.prepare('SELECT read_seconds AS s FROM deck_share_views WHERE id = ?').get(foreign) as any).s), 0, 'the other deck\'s visit is untouched');
  assert.equal((await click(db, pat, 'cover', 'b1', foreign)).status, 200);
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM deck_share_conversions WHERE view_id = ?').get(foreign) as any).n), 0);

  const off = await make(db, { prospect_id: SAM, time_per_slide: false });
  const view = await open(db, off);
  assert.deepEqual((await beat(db, off, view, 60, { 0: 20 })).body, { ok: true, counts_only: true });
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM deck_view_slides').get() as any).n), 0);
});

const linkCards = (db: DatabaseSync, body: Record<string, unknown> = {}, as: number | null = ADMIN) =>
  req(db, 'POST', `/api/decks/${DECK}/preflight/link-cards`, as, body);
const uidsOf = (r: any) => (r.body?.slides ?? []).map((s: any) => s.uid);

test('D4598 part 2: a proposed link\'s effective content matches linkSentCards exactly, and two links\' own checks never cross-contaminate', async () => {
  const db = fixture();
  // No variant, Sources left out: Traction stays hidden (always), Sources is excluded by choice.
  const bare = await linkCards(db, { include: { sources: false } });
  assert.equal(bare.status, 200, JSON.stringify(bare.body));
  assert.deepEqual(uidsOf(bare), ['cover', 'market', 'ask']);

  // Fund A's variant [ask, market, traction, cover]: Traction is still hidden; Sources defaults in.
  const vA = await req(db, 'POST', `/api/decks/${DECK}/variants`, ADMIN, { name: 'For Fund A', slide_order: [3, 2, 1, 0] });
  assert.equal(vA.status, 201, JSON.stringify(vA.body));
  const tailoredA = await linkCards(db, { variant_uid: vA.body.variant.uid });
  assert.deepEqual(uidsOf(tailoredA), ['ask', 'market', 'cover', 'sources']);

  // It matches linkSentCards exactly, for the SAME variant and include, once that link is made: the
  // uids the preview read are the uids the reaction is actually filed under.
  const madeA = await make(db, { prospect_id: SAM, variant_uid: vA.body.variant.uid });
  assert.equal((await feedback(db, madeA, await open(db, madeA), { 0: 'up', 1: 'down', 2: 'up', 3: 'down' })).status, 200);
  assert.deepEqual(reactionsByUid(db), [{ ask: 'up', market: 'down', cover: 'up', sources: 'down' }]);

  // Fund B's own variant and its own "what is included", checked in between Fund A's preview and its
  // link: neither link's own combination is nudged by the other's.
  const vB = await req(db, 'POST', `/api/decks/${DECK}/variants`, ADMIN, { name: 'For Fund B', slide_order: [0, 2, 3] });
  assert.equal(vB.status, 201, JSON.stringify(vB.body));
  const again = await linkCards(db, { variant_uid: vA.body.variant.uid });
  assert.deepEqual(uidsOf(again), uidsOf(tailoredA), 'Fund A\'s own combination reads the same after Fund B\'s variant was made');
  const tailoredB = await linkCards(db, { variant_uid: vB.body.variant.uid, include: { notes: true } });
  assert.deepEqual(uidsOf(tailoredB), ['cover', 'market', 'ask', 'sources'], 'Fund B\'s own variant and include, unaffected by Fund A\'s check or its link');
  const madeB = await make(db, { prospect_id: PAT, variant_uid: vB.body.variant.uid });
  assert.equal((await feedback(db, madeB, await open(db, madeB), { 0: 'down', 3: 'up' })).status, 200);
  assert.deepEqual(reactionsByUid(db).slice(-1), [{ cover: 'down', sources: 'up' }], 'Fund B\'s own reaction, on its own uids');
});

test('D4598 part 2: link-cards refuses a malformed include, and is as readable as the deck itself, never more', async () => {
  const db = fixture();
  const bad = await linkCards(db, { include: { sources: 'yes' } });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.equal(Object.keys(bad.body || {}).length > 0, true, 'a refusal, not a silent default');
  // Another founder's project is not this one's to preview.
  const forbidden = await linkCards(db, {}, OTHER);
  assert.equal(forbidden.status, 403);
  // Signed out reads nothing either.
  const anon = await linkCards(db, {}, null);
  assert.ok(anon.status === 401 || anon.status === 403, JSON.stringify(anon));
});
