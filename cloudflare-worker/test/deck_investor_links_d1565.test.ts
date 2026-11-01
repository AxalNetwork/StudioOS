/**
 * D1565 (#3812, deck builder v2 D4) — one link per investor, and tailored
 * variants, on the existing per-prospect links.
 *
 *   1. A withdrawn link refuses to open, and its analytics stay readable.
 *   2. The watermark names the link's recipient, in the row and on the opened deck.
 *   3. A variant never holds a figure the master lacks; it opens the master's own cards in its order.
 *   4. An anti-thesis sector shows a conflict chip.
 *   5. Each row's NDA state (Accepted with its date, Not accepted yet), cap ("No cap") and expiry.
 *   6. The deck gate: another venture's founder is refused; an unknown deck is 404.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration. Synthetic names only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import deckInvestorLinks from '../src/routes/deck_investor_links.ts';
import decks from '../src/routes/decks.ts';
import { checkVariantFigures, cleanOrder, tailorMatch, variantSlides, watermarkFor } from '../src/services/decks/variants.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1565-investor-links-0123456789';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort().map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const ADMIN = 1, FOUNDER = 3, OTHER = 4;
const P = 5, OTHER_P = 6, DECK = 6, PROSPECT = 7;

const SLIDES = [
  { title: 'Kestrel Labs', fields: [{ key: 'cover_headline', label: 'Headline', kind: 'paragraph', value: 'Seed round', source: 'data' }] },
  { title: 'Traction', fields: [{ key: 'traction_grid', label: 'Traction', kind: 'metric_grid', value: [{ label: 'Customers', value: '38' }], source: 'data' }] },
  { title: 'Market', fields: [{ key: 'market_body', label: 'Market', kind: 'paragraph', value: 'Fintech teams reconcile by hand.', source: 'data' }] },
  { title: 'The Ask', fields: [{ key: 'ask_amount_usd', label: 'Ask', kind: 'paragraph', value: '$1.5M', source: 'data' }] },
];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, FOUNDER, OTHER]) ss.run(id, `j-${id}`);
  // A deck write by an admin needs a Super Admin (decks.ts `projectOwned`).
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  db.exec(`INSERT INTO projects (id, name, founder_id, sector, stage) VALUES (${P}, 'Kestrel Labs', 1001, 'Fintech', 'seed'), (${OTHER_P}, 'Other', 1002, 'Health', 'seed')`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, 2, ?, ?, 1, ?)')
    .run(DECK, P, JSON.stringify(SLIDES), 'Seed deck', '2026-10-21 09:00:00');
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm) VALUES (?, 'p-7', ?, 'Pat Partner', 'Fund A')").run(PROSPECT, P);
  return db;
}

const app = new Hono<any>();
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
    const role = as === ADMIN ? 'admin' : 'founder';
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role, jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const tokenOf = (sharePath: string) => sharePath.replace('/share/deck/', '');
const make = (db: DatabaseSync, body: Record<string, unknown> = {}) => req(db, 'POST', `/api/decks/${DECK}/investor-links`, ADMIN, { prospect_id: PROSPECT, expires_days: 14, ...body });

test('D1565: a withdrawn link refuses to open, and its analytics stay readable', async () => {
  const db = fixture();
  const made = await make(db);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const token = tokenOf(made.body.share_path);
  const open = await req(db, 'GET', `/api/decks/share/${token}`);
  assert.equal(open.status, 200);
  const w = await req(db, 'POST', `/api/decks/${DECK}/investor-links/${made.body.link.id}/withdraw`, ADMIN);
  assert.equal(w.status, 200);
  assert.equal(w.body.link.status, 'withdrawn');
  const again = await req(db, 'GET', `/api/decks/share/${token}`);
  assert.notEqual(again.status, 200, 'a withdrawn link does not open');
  assert.equal(again.body?.slides, undefined, 'and shows nothing from the deck');
  const rows = await req(db, 'GET', `/api/decks/${DECK}/investor-links`, ADMIN);
  const row = rows.body.links.find((r: any) => r.id === made.body.link.id);
  assert.equal(row.status, 'withdrawn');
  assert.ok(row.withdrawn_at);
  assert.equal(row.analytics.views, 1, 'the view before the withdraw is kept');
});

test('D1565: the watermark names the link\'s recipient, in the row and on the opened deck', async () => {
  const db = fixture();
  const made = await make(db);
  assert.equal(made.body.link.watermark, 'Prepared for Pat Partner · Fund A');
  assert.deepEqual(made.body.link.investor, { label: 'Pat Partner', fund: 'Fund A', prospect_id: PROSPECT });
  const opened = await req(db, 'GET', `/api/decks/share/${tokenOf(made.body.share_path)}`);
  assert.equal(opened.body.watermark, 'Prepared for Pat Partner · Fund A');
  const typed = await req(db, 'POST', `/api/decks/${DECK}/investor-links`, ADMIN, { investor_label: 'Jo Angel', expires_days: 7 });
  assert.equal(typed.body.link.watermark, 'Prepared for Jo Angel');
  assert.equal(watermarkFor(null, null), null);
  assert.equal(watermarkFor('Fund A', 'Fund A'), 'Prepared for Fund A');
});

test('D1565: a variant never holds a figure the master lacks, and opens the master\'s own cards in its order', async () => {
  const db = fixture();
  assert.deepEqual(checkVariantFigures(SLIDES, variantSlides(SLIDES, [3, 0, 1, 2])), [], 'a reorder states nothing new');
  const tampered = [...SLIDES, { title: 'Invented', fields: [{ key: 'x', kind: 'paragraph', value: 'We raised $9M' }] }];
  assert.deepEqual(checkVariantFigures(SLIDES, tampered), ['$9m']);
  assert.equal(cleanOrder(SLIDES, [0, 0]), null, 'a card twice is refused');
  assert.equal(cleanOrder(SLIDES, [9]), null, 'a card the master lacks is refused');
  assert.deepEqual(cleanOrder(SLIDES, [2]), [2, 0, 1, 3], 'a card left out is kept, at the end');

  assert.equal((await req(db, 'POST', `/api/decks/${DECK}/variants`, ADMIN, { name: 'x', slide_order: [9] })).body.error, 'order_invalid');
  const v = await req(db, 'POST', `/api/decks/${DECK}/variants`, ADMIN, { name: 'For Fund A', prospect_id: PROSPECT, thesis: { sectors: ['Fintech'], anti_sectors: [], stages: ['seed'] } });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.deepEqual(v.body.variant.slide_order, [0, 2, 1, 3], 'the plan leads with the card that speaks to their thesis');
  assert.deepEqual(v.body.variant.emphasis, { 2: 'lead' });
  const made = await make(db, { variant_uid: v.body.variant.uid });
  assert.deepEqual(made.body.link.version.variant, { uid: v.body.variant.uid, name: 'For Fund A' });
  const opened = await req(db, 'GET', `/api/decks/share/${tokenOf(made.body.share_path)}`);
  assert.deepEqual(opened.body.slides.map((s: any) => s.title), ['Kestrel Labs', 'Market', 'Traction', 'The Ask']);
  assert.equal((await make(db, { variant_uid: 'nope' })).body.error, 'variant_not_found');
});

test('D1565: an anti-thesis sector shows a conflict chip', async () => {
  const db = fixture();
  const v = await req(db, 'POST', `/api/decks/${DECK}/variants`, ADMIN, { name: 'For a health fund', thesis: { sectors: ['Health'], anti_sectors: ['fintech'], stages: [] } });
  const sector = v.body.variant.tailor_match.find((c: any) => c.kind === 'sector');
  assert.deepEqual(sector, { kind: 'sector', state: 'conflict', value: 'Fintech', words: 'Their thesis excludes Fintech' });
  assert.equal(tailorMatch({ sector: 'Fintech', stage: null }, { sectors: ['Fintech'], anti_sectors: [], stages: [] })[0].state, 'match');
  assert.equal(tailorMatch({ sector: null, stage: null }, { sectors: [], anti_sectors: [], stages: [] })[0].words, 'Sector: Not recorded');
  const listed = await req(db, 'GET', `/api/decks/${DECK}/variants`, ADMIN);
  assert.equal(listed.body.variants[0].tailor_match[0].state, 'conflict');
});

test('D1565: each row\'s NDA state, cap and expiry', async () => {
  const db = fixture();
  const nda = await make(db, { nda_required: true, view_limit: 5 });
  const open = await make(db, { expires_days: null, view_limit: null });
  let rows = (await req(db, 'GET', `/api/decks/${DECK}/investor-links`, ADMIN)).body.links;
  const n = rows.find((r: any) => r.id === nda.body.link.id);
  assert.deepEqual(n.nda, { state: 'not_accepted', accepted_at: null });
  assert.deepEqual(n.view_cap, { limit: 5, used: 0 });
  const o = rows.find((r: any) => r.id === open.body.link.id);
  assert.deepEqual(o.nda, { state: 'not_required', accepted_at: null });
  assert.deepEqual(o.view_cap, { limit: null, used: 0 }, 'No cap is null, never 0');
  assert.equal(o.expires_at, null, 'Never is null');
  db.prepare("INSERT INTO deck_share_conversions (view_id, share_token_id, deck_id, project_id, type, created_at) VALUES (NULL, ?, ?, ?, 'nda_signed', '2026-10-30 10:00:00')").run(nda.body.link.id, DECK, P);
  rows = (await req(db, 'GET', `/api/decks/${DECK}/investor-links`, ADMIN)).body.links;
  assert.deepEqual(rows.find((r: any) => r.id === nda.body.link.id).nda, { state: 'accepted', accepted_at: '2026-10-30 10:00:00' });
});

test('D1565: the deck gate', async () => {
  const db = fixture();
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/investor-links`, OTHER)).status, 403);
  assert.equal((await req(db, 'POST', `/api/decks/${DECK}/variants`, OTHER, { name: 'x' })).status, 403);
  assert.equal((await req(db, 'GET', `/api/decks/999/investor-links`, ADMIN)).status, 404);
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/investor-links`)).status, 401);
});
