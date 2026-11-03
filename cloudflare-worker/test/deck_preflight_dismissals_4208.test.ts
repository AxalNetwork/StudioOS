/**
 * D4208 (#4208, part of #3661 P1) — preflight dismissals kept per deck
 * version, through the real mounted routes on SQLite (the baseline and every
 * post-cutoff migration, this one included).
 *
 *   1. A reader reads and is refused on PUT; nothing is written.
 *   2. A blocking finding is refused 422: layout, overflow, an image block
 *      with no image (read from the version's own card), one the client calls
 *      blocking, and an image whose block is not on the card. A soft image is
 *      a warning and is kept.
 *   3. Dismissals are scoped by version: a new version starts clean.
 *   4. Another deck's rows are never returned, and another venture reads nothing.
 *   5. The id: its shape, its length, an unknown check; undo, and a repeat.
 *
 * Every principal and card is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_preflight_dismissals_4208.test.ts
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
import deckPreflight, { isBlocking, parseFindingId } from '../src/routes/deck_preflight.ts';
import decks from '../src/routes/decks.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d4208-preflight-0123456789';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));

// [id, role, founder_id, name]
const ADMIN = 1, FOUNDER = 3, COFOUNDER = 4, OTHER = 9;
const PEOPLE: [number, string, number | null, string][] = [
  [ADMIN, 'admin', null, 'Ada Admin'], [FOUNDER, 'founder', 1001, 'Fay Founder'], [COFOUNDER, 'founder', 1003, 'Cy Cofounder'], [OTHER, 'founder', 1002, 'Oz Other'],
];
const P = 5, OTHER_P = 6, V2 = 60, V3 = 61, ELSE = 70;
const CARDS = [
  { uid: 'c0', title: 'Synthetic cover', blocks: [
    { id: 'empty', kind: 'image', image_url: '  ', grid: { col: 1, row: 1, w: 6, h: 3 } },
    { id: 'soft', kind: 'image', image_url: '/api/decks/images/synthetic.png', alt: 'x', grid: { col: 7, row: 1, w: 6, h: 3 } },
    { id: 'words', kind: 'text', text: 'Synthetic words', grid: { col: 1, row: 4, w: 12, h: 3 } },
  ] },
  { uid: 'c1', title: 'Synthetic team', blocks: [] },
];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id, subscription_tier) VALUES (?, ?, ?, ?, 1, ?, 'studio')");
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const [id, role, founder, name] of PEOPLE) { u.run(id, role, name, `synthetic${id}@example.test`, founder); ss.run(id, `j-${id}`); }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id, sector, stage) VALUES (${P}, 'proj-p', 'Synthetic venture', 1001, 'Fintech', 'seed'), (${OTHER_P}, 'proj-o', 'Other', 1002, 'Health', 'seed')`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${FOUNDER}, 'owner', 'accepted'), (${P}, ${COFOUNDER}, 'cofounder', 'accepted')`);
  const d = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  d.run(V2, P, 2, JSON.stringify(CARDS), 'Synthetic deck', 0, '2026-11-01 09:00:00');
  d.run(V3, P, 3, JSON.stringify(CARDS), 'Synthetic deck', 1, '2026-11-02 09:00:00');
  d.run(ELSE, OTHER_P, 2, JSON.stringify(CARDS), 'Synthetic other deck', 1, '2026-11-01 09:00:00');
  return db;
}

const app = new Hono<any>();
app.route('/api/decks', deckPreflight);
app.route('/api/decks', decks);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function req(db: DatabaseSync, method: string, path: string, as: number | null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) {
    const role = PEOPLE.find((p) => p[0] === as)![1];
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role, jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const get = (db: DatabaseSync, deck: number, version: unknown, as = FOUNDER) => req(db, 'GET', `/api/decks/${deck}/preflight/dismissals?version=${version}`, as);
const put = (db: DatabaseSync, deck: number, body: Record<string, unknown>, as = FOUNDER) => req(db, 'PUT', `/api/decks/${deck}/preflight/dismissals`, as, body);
const rows = (db: DatabaseSync) => db.prepare('SELECT deck_id, version, finding_id, dismissed_by FROM deck_preflight_dismissals ORDER BY deck_id, version, finding_id').all() as any[];

test('D4208 1: a reader reads, and is refused on PUT with nothing written', async () => {
  const db = fixture();
  assert.equal((await put(db, V3, { version: 3, finding_id: 'density:0:-:0', dismissed: true })).status, 200);
  const read = await get(db, V3, 3, ADMIN);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.deepEqual(read.body, { deck_id: V3, version: 3, dismissed: ['density:0:-:0'] });
  for (const dismissed of [true, false]) {
    const w = await put(db, V3, { version: 3, finding_id: 'font:0:words:0', dismissed }, ADMIN);
    assert.equal(w.status, 403, `a reader is refused (dismissed: ${dismissed})`);
  }
  const undo = await put(db, V3, { version: 3, finding_id: 'density:0:-:0', dismissed: false }, ADMIN);
  assert.equal(undo.status, 403);
  assert.deepEqual(rows(db).map((r) => r.finding_id), ['density:0:-:0'], 'a reader neither adds nor removes');
  // A cofounder edits the deck, and writes.
  const co = await put(db, V3, { version: 3, finding_id: 'font:0:words:0', dismissed: true }, COFOUNDER);
  assert.equal(co.status, 200, JSON.stringify(co.body));
  assert.equal(rows(db).find((r) => r.finding_id === 'font:0:words:0').dismissed_by, COFOUNDER);
  // Nobody signed in reads nothing.
  assert.equal((await req(db, 'GET', `/api/decks/${V3}/preflight/dismissals?version=3`, null)).status, 401);
});

test('D4208 2: a blocking finding is refused 422, and nothing is stored', async () => {
  const db = fixture();
  const blocking = [
    { finding_id: 'layout:0:empty:0' },
    { finding_id: 'layout:1:-:0' },
    { finding_id: 'overflow:0:words:0' },
    { finding_id: 'image:0:empty:0' },
    { finding_id: 'image:0:gone:0' },
    { finding_id: 'image:0:-:0' },
    { finding_id: 'density:0:words:0', severity: 'blocking' },
  ];
  for (const b of blocking) {
    const r = await put(db, V3, { version: 3, dismissed: true, ...b });
    assert.equal(r.status, 422, JSON.stringify(b));
    assert.equal(r.body.error, 'finding_blocking');
    assert.match(r.body.message, /blocks export/);
  }
  assert.deepEqual(rows(db), [], 'no blocking finding is ever stored');
  const soft = await put(db, V3, { version: 3, finding_id: 'image:0:soft:0', dismissed: true, severity: 'warning' });
  assert.equal(soft.status, 200, 'an image that is there but soft is a warning');
  assert.deepEqual(soft.body.dismissed, ['image:0:soft:0']);
  // The rule itself, against the version's cards.
  assert.equal(isBlocking(parseFindingId('image:0:empty:0')!, CARDS), true);
  assert.equal(isBlocking(parseFindingId('image:0:soft:0')!, CARDS), false);
  assert.equal(isBlocking(parseFindingId('alt:0:soft:0')!, CARDS), false);
  assert.equal(isBlocking(parseFindingId('overflow:0:soft:0')!, CARDS), true);
});

test('D4208 3: dismissals are scoped by version, so a new version starts clean', async () => {
  const db = fixture();
  assert.equal((await put(db, V2, { version: 2, finding_id: 'placeholder:0:words:0', dismissed: true })).status, 200);
  assert.deepEqual((await get(db, V2, 2)).body.dismissed, ['placeholder:0:words:0']);
  assert.deepEqual((await get(db, V3, 3)).body.dismissed, [], 'the next version starts clean');
  assert.deepEqual((await get(db, V2, 3)).body.dismissed, [], 'the same deck at another version reads none');
  const missing = await put(db, V3, { version: 9, finding_id: 'density:0:-:0', dismissed: true });
  assert.equal(missing.status, 404, 'a version the deck never had');
  assert.equal(missing.body.error, 'version_not_found');
  assert.equal(rows(db).length, 1);
  for (const bad of ['', '0', '-1', 'two', '1.5']) {
    assert.equal((await get(db, V3, bad)).status, 400, `version ${JSON.stringify(bad)}`);
  }
});

test('D4208 4: another deck\'s rows are never returned, and another venture reads nothing', async () => {
  const db = fixture();
  db.prepare('INSERT INTO deck_preflight_dismissals (deck_id, version, finding_id, dismissed_by) VALUES (?, ?, ?, ?)').run(ELSE, 3, 'density:0:-:0', OTHER);
  db.prepare('INSERT INTO deck_preflight_dismissals (deck_id, version, finding_id, dismissed_by) VALUES (?, ?, ?, ?)').run(ELSE, 2, 'font:0:words:0', OTHER);
  assert.equal((await put(db, V3, { version: 3, finding_id: 'alt:0:soft:0', dismissed: true })).status, 200);
  assert.deepEqual((await get(db, V3, 3)).body.dismissed, ['alt:0:soft:0'], 'only this deck\'s rows');
  assert.deepEqual((await get(db, ELSE, 2, OTHER)).body.dismissed, ['font:0:words:0']);
  assert.equal((await get(db, V3, 3, OTHER)).status, 403, 'another venture reads nothing');
  assert.equal((await get(db, ELSE, 2, FOUNDER)).status, 403);
  assert.equal((await put(db, ELSE, { version: 2, finding_id: 'alt:0:soft:0', dismissed: true })).status, 403);
  assert.equal((await get(db, 999, 1)).status, 404);
});

test('D4208 5: the id, undo and a repeat', async () => {
  const db = fixture();
  const long = `density:0:${'b'.repeat(80)}:0`;
  assert.equal(long.length <= 120, true);
  for (const finding_id of [`density:0:${'b'.repeat(81)}:0`, 'x'.repeat(121), 'score:0:-:0', 'density:a:-:0', 'density:0:-', 'density:0:a:b:0', 'density:0: :0', 42, null]) {
    const r = await put(db, V3, { version: 3, finding_id, dismissed: true });
    assert.equal(r.status, 400, JSON.stringify(finding_id));
    assert.equal(r.body.error, 'invalid_finding');
  }
  assert.equal((await put(db, V3, { version: 3, finding_id: 'density:0:-:0', dismissed: 'yes' })).status, 400);
  assert.equal((await put(db, V3, { version: 3, finding_id: 'density:0:-:0', dismissed: true })).status, 200);
  const again = await put(db, V3, { version: 3, finding_id: 'density:0:-:0', dismissed: true }, COFOUNDER);
  assert.equal(again.status, 200);
  assert.deepEqual(rows(db).map((r) => [r.finding_id, r.dismissed_by]), [['density:0:-:0', FOUNDER]], 'a repeat keeps the first dismissal');
  const undo = await put(db, V3, { version: 3, finding_id: 'density:0:-:0', dismissed: false });
  assert.deepEqual(undo.body.dismissed, []);
  assert.deepEqual(rows(db), []);
  // Only the id is stored: the table has no column for a finding's words.
  const cols = (db.prepare('PRAGMA table_info(deck_preflight_dismissals)').all() as any[]).map((c) => c.name);
  assert.deepEqual(cols, ['deck_id', 'version', 'finding_id', 'dismissed_by', 'dismissed_at']);
  assert.deepEqual(parseFindingId('sources:12:blk-3:2'), { check: 'sources', card: 12, block: 'blk-3', n: 2 });
});
