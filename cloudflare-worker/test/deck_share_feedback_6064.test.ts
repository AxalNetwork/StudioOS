/**
 * D6064 (#6064) — the founder's read of viewer feedback: `GET /api/decks/:id/share-feedback`.
 *
 *   1. Per-card reactions and the written note, by link, newest first; reactions by uid
 *      and, for a row written before migration 714, by the place on the link's cards.
 *   2. Anonymity: `viewer` is signed_in or anonymous; no user id, name, email or contact leaves the read.
 *   3. The link is found from the view or from the feedback's conversion row; a link of
 *      another version never names it; another venture's feedback never appears.
 *   4. Who: the owner and co-founders (`deckFor(…, true)`, as the daily read); advisor and
 *      another founder 403, no session 401, unknown deck 404.
 *   5. The cap: at most 200 rows, `truncated` says so.
 *   6. A missing table or by-uid column reads as no feedback; any other failure is Unreadable (500).
 *
 * In-memory SQLite: the baseline and every post-cutoff migration. Synthetic names only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_share_feedback_6064.test.ts
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
import deckShareFeedback, { FEEDBACK_CAP, shareFeedback } from '../src/routes/deck_share_feedback.ts';

const JWT_SECRET = 'unit-test-jwt-secret-6064-share-feedback-0123456789ab';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const FOUNDER = 3, OTHER = 4, COFOUNDER = 5, ADVISOR = 6, VIEWER = 7, ADMIN = 8;
const P = 5, OTHER_P = 6, V1 = 10, V2 = 11, ELSEWHERE = 12, PAT = 7;
const SLIDES = [
  { uid: 'cover', title: 'Kestrel Labs' },
  { uid: 'traction', title: 'Traction' },
  { uid: 'market', title: 'Market' },
  { uid: 'ask', title: 'The Ask' },
];
const VIEWER_EMAIL = 'vera.viewer@example.test';
const CONTACT = 'call-me@example.test';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  u.run(COFOUNDER, 'founder', 'Cy Cofounder', 'cy@example.test', 1003);
  u.run(ADVISOR, 'founder', 'Ada Advisor', 'ada@example.test', 1004);
  u.run(VIEWER, 'investor', 'Vera Viewer', VIEWER_EMAIL, null);
  u.run(ADMIN, 'admin', 'Hal Admin', 'hal@example.test', null);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [FOUNDER, OTHER, COFOUNDER, ADVISOR, ADMIN]) ss.run(id, `j-${id}`);
  db.exec(`INSERT INTO projects (id, name, founder_id, sector, stage) VALUES (${P}, 'Kestrel Labs', 1001, 'Fintech', 'seed'), (${OTHER_P}, 'Other', 1002, 'Health', 'seed')`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${COFOUNDER}, 'cofounder', 'accepted'), (${P}, ${ADVISOR}, 'advisor', 'accepted')`);
  const deck = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, ?, ?, ?, ?)');
  deck.run(V1, P, 1, JSON.stringify(SLIDES), 'Seed deck', 0);
  deck.run(V2, P, 2, JSON.stringify(SLIDES), 'Seed deck', 1);
  deck.run(ELSEWHERE, OTHER_P, 1, JSON.stringify(SLIDES), 'Other deck', 1);
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm) VALUES (?, 'p-7', ?, 'Pat Partner', 'Fund A')").run(PAT, P);

  const tok = db.prepare(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, created_at, prospect_id, investor_label, nda_required, include_json)
    VALUES (?, ?, ?, '2027-01-01 00:00:00', '2026-10-02 09:00:00', ?, ?, 0, NULL)`);
  tok.run(1, V2, 'h1', PAT, null);
  tok.run(2, V2, 'h2', null, 'Fund C');
  tok.run(3, V1, 'h3', null, 'Fund E');
  tok.run(5, ELSEWHERE, 'h5', null, 'Fund X');
  const view = db.prepare('INSERT INTO deck_share_views (id, share_token_id, deck_id, read_seconds, created_at) VALUES (?, ?, ?, 10, ?)');
  view.run(101, 1, V2, '2026-10-03 12:00:00');
  view.run(105, 5, ELSEWHERE, '2026-10-03 15:00:00');

  const fb = db.prepare(`INSERT INTO deck_share_feedback (id, view_id, deck_id, project_id, user_id, slide_reactions, slide_reactions_by_uid, overall_note, problem_fit, willingness_to_pay, contact, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // Signed in, through link 1's view, reactions by uid.
  fb.run(201, 101, V2, P, VIEWER, JSON.stringify({ 0: 'like', 3: 'want_more' }), JSON.stringify({ cover: 'like', ask: 'want_more' }), 'Strong team.', 'strong', '$200/seat', null, '2026-10-03 12:05:00');
  // Anonymous, no view: the link is its feedback conversion's (link 2). Written before 714: by place only. Left a contact.
  fb.run(202, null, V2, P, null, JSON.stringify({ 1: 'confused' }), null, 'Unclear traction.', null, null, CONTACT, '2026-10-04 08:00:00');
  // Anonymous, its conversion names a link of ANOTHER version: no link.
  fb.run(203, null, V2, P, null, null, null, 'Nice.', null, null, null, '2026-10-01 08:00:00');
  // Version 1.
  fb.run(204, null, V1, P, null, null, JSON.stringify({ market: 'like' }), null, null, null, null, '2026-09-20 08:00:00');
  // Another venture's.
  fb.run(205, 105, ELSEWHERE, OTHER_P, null, null, null, 'Elsewhere note', null, null, null, '2026-10-05 08:00:00');
  const conv = db.prepare("INSERT INTO deck_share_conversions (view_id, share_token_id, deck_id, project_id, type, ref_id) VALUES (?, ?, ?, ?, 'feedback', ?)");
  conv.run(null, 2, V2, P, '202');
  conv.run(null, 3, V2, P, '203');
  return db;
}

// The read-only tests share one database: building the schema is the slow part.
let SHARED: DatabaseSync | null = null;
const shared = () => (SHARED ??= fixture());

const app = new Hono<any>();
app.route('/api/decks', deckShareFeedback);
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
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}
const read = (db: DatabaseSync, qs = '', as: number | null = FOUNDER, deck = V2) => get(db, `/api/decks/${deck}/share-feedback${qs}`, as);
const item = (body: any, id: number) => body.items.find((i: any) => i.id === id);

test('#6064: per-card reactions and the note, by link, newest first', async () => {
  const r = await read(shared());
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.items.map((i: any) => i.id), [202, 201, 203, 204], 'the venture\'s feedback across versions, newest first');
  assert.equal(r.body.discovery_mirror, true);
  assert.deepEqual([r.body.cap, r.body.truncated], [FEEDBACK_CAP, false]);
  const a = item(r.body, 201);
  assert.deepEqual(a.link, { id: 1, investor: { label: 'Pat Partner', fund: 'Fund A' } });
  assert.deepEqual(a.reactions, [
    { card_uid: 'cover', place: 0, title: 'Kestrel Labs', reaction: 'like' },
    { card_uid: 'ask', place: 3, title: 'The Ask', reaction: 'want_more' },
  ], 'by uid, titled, in card order');
  assert.deepEqual([a.note, a.problem_fit, a.willingness_to_pay, a.version], ['Strong team.', 'strong', '$200/seat', 2]);
  const b = item(r.body, 202);
  // Mutation checked: dropping the conversion fallback in the link SQL → link is null here.
  assert.deepEqual(b.link, { id: 2, investor: { label: 'Fund C', fund: null } }, 'no view: the feedback conversion names the link');
  assert.deepEqual(b.reactions, [{ card_uid: 'traction', place: 1, title: 'Traction', reaction: 'confused' }], 'before 714: by place on the link\'s cards');
  assert.deepEqual(item(r.body, 204).reactions, [{ card_uid: 'market', place: 2, title: 'Market', reaction: 'like' }]);
});

test('#6064: anonymous stays anonymous; no identity leaves the read', async () => {
  const r = await read(shared());
  assert.equal(item(r.body, 201).viewer, 'signed_in');
  assert.equal(item(r.body, 202).viewer, 'anonymous');
  // Mutation checked: returning `contact` (or joining users for the name/email) → these fail.
  assert.ok(!r.text.includes(CONTACT), 'the contact the POST accepted is never returned');
  assert.ok(!r.text.includes(VIEWER_EMAIL) && !r.text.includes('Vera Viewer'), 'no viewer account name or email');
  for (const i of r.body.items) {
    assert.deepEqual(Object.keys(i).sort(), ['created_at', 'deck_id', 'id', 'link', 'note', 'problem_fit', 'reactions', 'version', 'viewer', 'willingness_to_pay']);
  }
});

test('#6064: a link of another version never names the feedback; another venture never appears', async () => {
  const r = await read(shared());
  // Mutation checked: dropping the same-deck check → link 3 (version 1) is named here.
  assert.equal(item(r.body, 203).link, null);
  assert.equal(item(r.body, 205), undefined);
  assert.ok(!r.text.includes('Elsewhere note'));
});

test('#6064: the version filter', async () => {
  const db = shared();
  assert.deepEqual((await read(db, '?version=1')).body.items.map((i: any) => i.id), [204]);
  assert.deepEqual((await read(db, '?version=2')).body.items.map((i: any) => i.id), [202, 201, 203]);
  const bad = await read(db, '?version=x');
  assert.deepEqual([bad.status, bad.body.error], [422, 'bad_version']);
});

test('#6064: the owner and co-founders only', async () => {
  const db = shared();
  assert.equal((await read(db, '', COFOUNDER)).status, 200, 'a co-founder reads it');
  assert.equal((await read(db, '', ADVISOR)).status, 403, 'an advisor is a reader of the venture, not its founder');
  // Mutation checked: deckFor(…, false) → an HQ admin who is not a Super Admin reads it and this is 200.
  assert.equal((await read(db, '', ADMIN)).status, 403, 'an admin who is not a Super Admin is not the founder either');
  assert.equal((await read(db, '', OTHER)).status, 403);
  assert.equal((await read(db, '', null)).status, 401);
  assert.equal((await read(db, '', FOUNDER, 999)).status, 404);
  assert.equal((await read(db, '', OTHER, ELSEWHERE)).status, 200, 'the other founder reads their own');
});

test('#6064: the cap', async () => {
  const db = fixture();
  const fb = db.prepare("INSERT INTO deck_share_feedback (deck_id, project_id, overall_note, created_at) VALUES (?, ?, 'n', '2026-08-01 00:00:00')");
  for (let i = 0; i < FEEDBACK_CAP - 4; i++) fb.run(V2, P);
  const exact = await read(db);
  assert.deepEqual([exact.body.items.length, exact.body.truncated], [FEEDBACK_CAP, false], 'exactly the cap is not truncated');
  fb.run(V2, P);
  const over = await read(db);
  // Mutation checked: FEEDBACK_CAP + 1 → 0 in the LIMIT → truncated is never true.
  assert.deepEqual([over.body.items.length, over.body.truncated], [FEEDBACK_CAP, true]);
});

test('#6064: a missing store is no feedback; any other failure is Unreadable', async () => {
  const db = fixture();
  db.exec('ALTER TABLE deck_share_feedback DROP COLUMN slide_reactions_by_uid');
  const noCol = await shareFeedback({ DB: d1Over(db) } as any, P, null);
  assert.deepEqual(noCol.items.map((i: any) => i.id), [202, 201, 203, 204], 'without 714\'s column the rows still read, by place');
  assert.deepEqual(item(noCol, 201).reactions.map((x: any) => x.card_uid), ['cover', 'ask']);

  const failing = (msg: string) => ({
    DB: { prepare: () => ({ bind() { return this; }, run: async () => { throw new Error(msg); }, all: async () => { throw new Error(msg); }, first: async () => { throw new Error(msg); } }) },
  }) as any;
  assert.deepEqual((await shareFeedback(failing('D1_ERROR: no such table: deck_share_feedback'), P, null)).items, []);
  await assert.rejects(shareFeedback(failing('D1_ERROR: disk I/O error'), P, null), 'a failure that is not a missing store is not "no feedback"');
});

test('#6064: the route answers Unreadable when the read fails', async () => {
  const db = shared();
  const base = d1Over(db);
  const DB = { ...base, prepare: (sql: string) => (/FROM deck_share_feedback f/.test(sql) ? { bind() { return this; }, all: async () => { throw new Error('D1_ERROR: disk I/O error'); } } : base.prepare(sql)) };
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder', jti: `j-${FOUNDER}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/decks/${V2}/share-feedback`, { headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB } as any);
  assert.equal(res.status, 500);
  const body = await res.json() as any;
  assert.deepEqual(body, { state: 'unreadable', detail: "Feedback couldn't be read." }, 'no SQLite text in the body');
});
