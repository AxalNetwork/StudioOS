/**
 * D4254 P4 (#4272) — Share & analytics (ps7): `GET /api/decks/:id/analytics/daily`.
 *
 *   1. Views per day split NDA against open, first views marked, every date present.
 *   2. The two funnels: sent → opened → NDA shown → accepted → reached the ask.
 *   3. Drop-off on a version and the one before it; uncounted seconds are null, never 0.
 *   4. The NDA and version filters.
 *   5. The date bound: at most 90 days; a bad or reversed range is 422.
 *   6. Tenancy: the venture's writers only; another venture's links never count.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration. Synthetic names only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_share_daily_4272.test.ts
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
import deckSlideAnalytics from '../src/routes/deck_slide_analytics.ts';
import { dropOff, funnelOf, readDailyQuery } from '../src/services/decks/shareDaily.ts';

const JWT_SECRET = 'unit-test-jwt-secret-4272-share-daily-0123456789abcd';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const FOUNDER = 3, OTHER = 4;
const P = 5, OTHER_P = 6, V1 = 10, V2 = 11, ELSEWHERE = 12, PAT = 7;
const SLIDES = [
  { uid: 'cover', title: 'Kestrel Labs' },
  { uid: 'traction', title: 'Traction' },
  { uid: 'market', title: 'Market' },
  { uid: 'ask', title: 'The Ask', fields: [{ key: 'ask_amount_usd', value: 'Synthetic ask' }] },
];
const RANGE = 'from=2026-10-01&to=2026-10-10';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [FOUNDER, OTHER]) ss.run(id, `j-${id}`);
  db.exec(`INSERT INTO projects (id, name, founder_id, sector, stage) VALUES (${P}, 'Kestrel Labs', 1001, 'Fintech', 'seed'), (${OTHER_P}, 'Other', 1002, 'Health', 'seed')`);
  const deck = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, ?, ?, ?, ?)');
  deck.run(V1, P, 1, JSON.stringify(SLIDES), 'Seed deck', 0);
  deck.run(V2, P, 2, JSON.stringify(SLIDES), 'Seed deck', 1);
  deck.run(ELSEWHERE, OTHER_P, 1, JSON.stringify(SLIDES), 'Other deck', 1);
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm) VALUES (?, 'p-7', ?, 'Pat Partner', 'Fund A')").run(PAT, P);

  const tok = db.prepare(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, created_at, prospect_id, investor_label, nda_required, include_json)
    VALUES (?, ?, ?, '2027-01-01 00:00:00', ?, ?, ?, ?, ?)`);
  tok.run(1, V2, 'h1', '2026-10-02 09:00:00', PAT, null, 1, null); // NDA link, accepted, reached the ask
  tok.run(2, V2, 'h2', '2026-10-02 10:00:00', null, 'Fund C', 0, null); // open link, stopped after card 2
  tok.run(3, V2, 'h3', '2026-10-04 10:00:00', null, 'Fund D', 0, JSON.stringify({ time_per_slide: false })); // never opened
  tok.run(4, V2, 'h4', '2026-10-02 11:00:00', null, null, 0, null); // not an investor link
  tok.run(5, ELSEWHERE, 'h5', '2026-10-02 11:00:00', null, 'Fund X', 1, null); // another venture
  tok.run(6, V1, 'h6', '2026-10-01 08:00:00', null, 'Fund E', 0, null); // the previous version
  const view = db.prepare('INSERT INTO deck_share_views (id, share_token_id, deck_id, read_seconds, created_at) VALUES (?, ?, ?, ?, ?)');
  view.run(101, 1, V2, 35, '2026-10-03 12:00:00');
  view.run(102, 1, V2, 0, '2026-10-05 12:00:00');
  view.run(103, 2, V2, 40, '2026-10-03 13:00:00');
  view.run(104, 4, V2, 10, '2026-10-03 14:00:00');
  view.run(105, 5, ELSEWHERE, 10, '2026-10-03 15:00:00');
  view.run(106, 6, V1, 5, '2026-10-02 16:00:00');
  const sec = db.prepare('INSERT INTO deck_view_slides (view_id, slide_index, card_uid, seconds) VALUES (?, ?, ?, ?)');
  sec.run(101, 0, 'cover', 10); sec.run(101, 1, 'traction', 20); sec.run(101, 3, 'ask', 5);
  sec.run(103, 0, null, 30); sec.run(103, 1, null, 10); // written before migration 714: by place
  sec.run(104, 2, 'market', 99);
  sec.run(105, 3, 'ask', 99);
  sec.run(106, 0, 'cover', 5);
  db.prepare("INSERT INTO deck_share_conversions (view_id, share_token_id, deck_id, project_id, type) VALUES (101, 1, ?, ?, 'nda_signed')").run(V2, P);
  db.prepare("INSERT INTO deck_share_conversions (view_id, share_token_id, deck_id, project_id, type) VALUES (105, 5, ?, ?, 'nda_signed')").run(ELSEWHERE, OTHER_P);
  return db;
}

const app = new Hono<any>();
app.route('/api/decks', deckSlideAnalytics);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function get(db: DatabaseSync, path: string, as: number | null = FOUNDER) {
  const headers: Record<string, string> = {};
  if (as) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role: 'founder', jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(path, { headers }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const daily = (db: DatabaseSync, qs = RANGE, as: number | null = FOUNDER) => get(db, `/api/decks/${V2}/analytics/daily?${qs}`, as);
const day = (body: any, date: string) => body.days.find((d: any) => d.date === date);

test('#4272: views per day, NDA against open, first views marked, every date present', async () => {
  const r = await daily(fixture());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.days.length, 10, 'every date in the range');
  assert.deepEqual(day(r.body, '2026-10-02'), { date: '2026-10-02', nda: 0, open: 1, first_nda: 0, first_open: 1 });
  // Mutation checked: dropping the investor-link filter → link 4's view counts here and open is 2.
  assert.deepEqual(day(r.body, '2026-10-03'), { date: '2026-10-03', nda: 1, open: 1, first_nda: 1, first_open: 1 });
  assert.deepEqual(day(r.body, '2026-10-05'), { date: '2026-10-05', nda: 1, open: 0, first_nda: 0, first_open: 0 }, 'a revisit is a view, not a first view');
  assert.deepEqual(day(r.body, '2026-10-09'), { date: '2026-10-09', nda: 0, open: 0, first_nda: 0, first_open: 0 }, 'no view is a counted 0');
  assert.deepEqual(r.body.versions, [{ version: 2, deck_id: V2 }, { version: 1, deck_id: V1 }]);
});

test('#4272: the two funnels, with the NDA steps null on open links', async () => {
  const r = await daily(fixture());
  assert.deepEqual(r.body.funnels.nda, { sent: 1, opened: 1, nda_shown: 1, accepted: 1, reached_ask: 1 });
  assert.deepEqual(r.body.funnels.open, { sent: 3, opened: 2, nda_shown: null, accepted: null, reached_ask: 0 },
    'link 3 counts no time, so it is left out of reached the ask; links 2 and 6 never reached it');
});

test('#4272: drop-off on a version and the one before it; uncounted seconds are null', async () => {
  const r = await daily(fixture());
  const cur = r.body.dropoff.current;
  assert.equal(cur.version, 2);
  assert.deepEqual(cur.cards.map((c: any) => [c.card_uid, c.seconds, c.drop_pct]),
    [['cover', 40, 0], ['traction', 30, 50], ['market', null, 0], ['ask', 5, null]],
    'card 2 nobody read: null seconds, never 0; the last card has no drop');
  const prev = r.body.dropoff.previous;
  assert.equal(prev.version, 1);
  assert.deepEqual(prev.cards.map((c: any) => [c.seconds, c.drop_pct]), [[5, 100], [null, null], [null, null], [null, null]]);
});

test('#4272: the NDA and version filters', async () => {
  const db = fixture();
  const yes = await daily(db, `${RANGE}&nda=yes`);
  assert.equal(yes.body.days.reduce((s: number, d: any) => s + d.open, 0), 0, 'nda=yes draws no open view');
  assert.equal(yes.body.days.reduce((s: number, d: any) => s + d.nda, 0), 2);
  const v1 = await daily(db, `${RANGE}&version=1`);
  assert.equal(v1.body.days.reduce((s: number, d: any) => s + d.nda + d.open, 0), 1, 'only version 1\'s link');
  assert.equal(v1.body.dropoff.current.version, 1);
  assert.equal(v1.body.dropoff.previous, null, 'there is no version before 1');
  assert.equal((await daily(db, `${RANGE}&nda=maybe`)).status, 422);
  assert.equal((await daily(db, `${RANGE}&version=x`)).status, 422);
});

test('#4272: the date bound', async () => {
  const db = fixture();
  assert.equal((await daily(db, 'from=2026-07-04&to=2026-10-01')).status, 200, '90 days');
  const long = await daily(db, 'from=2026-07-03&to=2026-10-01');
  // Mutation checked: MAX_DAYS raised → 91 days answer 200 and this fails.
  assert.deepEqual([long.status, long.body.error], [422, 'range_too_long']);
  assert.equal((await daily(db, 'from=2026-10-05&to=2026-10-01')).body.error, 'from_after_to');
  assert.equal((await daily(db, 'from=2026-02-30&to=2026-03-01')).body.error, 'bad_date');
  const def = readDailyQuery({}, '2026-10-30');
  assert.ok(!('error' in def));
  if (!('error' in def)) assert.deepEqual([def.from, def.to, def.nda, def.version], ['2026-10-01', '2026-10-30', 'all', null], 'the 30 days ending today');
});

test('#4272: the venture\'s writers only; another venture never counts', async () => {
  const db = fixture();
  assert.equal((await daily(db, RANGE, OTHER)).status, 403, 'another founder is refused, as every deck read refuses them');
  assert.equal((await daily(db, RANGE, null)).status, 401);
  const r = await daily(db);
  // Another venture's NDA link (5) and its signature never enter this venture's funnel.
  assert.equal(r.body.funnels.nda.sent, 1);
});

test('#4272: the pure parts: no knowable link is null, not 0; no timed view is all null', () => {
  assert.equal(funnelOf([{ nda_required: false, opened: true, accepted: false, timed: false, ask_index: 3, furthest: null }], false).reached_ask, null);
  assert.equal(funnelOf([{ nda_required: false, opened: true, accepted: false, timed: true, ask_index: null, furthest: 3 }], false).reached_ask, null, 'no ask card');
  assert.deepEqual(dropOff(SLIDES, []).map((c) => [c.seconds, c.drop_pct]), [[null, null], [null, null], [null, null], [null, null]]);
});
