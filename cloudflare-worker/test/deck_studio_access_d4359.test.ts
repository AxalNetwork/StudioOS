/**
 * D4359 (#4359, #2434 Q8 = A) — the Pitch deck studio's plan gate, one rule
 * for the Worker and the UI, through the real mounted routes on SQLite (the
 * baseline and every post-cutoff migration; D4359 adds none).
 *
 *   1. Parity: for every kind of member, `GET /api/decks/access` says open
 *      exactly when the Worker's own deck gates let them through — New deck's
 *      `POST /outline` and Share's `POST /:id/share` both answer 402 when, and
 *      only when, the read says locked. A Validate + Build (Growth) member is
 *      locked; a Raise + Grow member is open.
 *   2. The locked answer carries the plan to upgrade to and the 402's own
 *      words; nobody signed in reads nothing.
 *   3. Every studio gate names `DECK_STUDIO_TIER`, so the gate the read
 *      reports cannot be changed apart from the gates it describes.
 *
 * Every principal is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_studio_access_d4359.test.ts
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
import deckAccess from '../src/routes/deck_access.ts';
import deckNew from '../src/routes/deck_new.ts';
import decks from '../src/routes/decks.ts';
import { DECK_STUDIO_TIER, deckStudioAccess } from '../src/services/decks/studioAccess.ts';
import { PLAN_KEY, PLAN_NAME, TIER_COPY } from '../src/middleware/requireTier.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d4359-studio-access-0123456789';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));

const PAST = '2020-01-01 00:00:00';
const FUTURE = '2099-01-01 00:00:00';
// [id, role, tier, status, renews_at, spinout_lab_active, open?]
type Member = [number, string, string, string, string | null, number, boolean, string];
const MEMBERS: Member[] = [
  [11, 'founder', 'free', 'active', null, 0, false, 'Free'],
  [12, 'founder', 'growth', 'active', null, 0, false, 'Validate + Build (Growth)'],
  [13, 'founder', 'studio', 'active', null, 0, true, 'Raise + Grow'],
  [14, 'founder', 'studio', 'cancelled', null, 0, false, 'Raise + Grow, cancelled'],
  [15, 'founder', 'studio', 'past_due', PAST, 0, false, 'Raise + Grow, past due beyond its grace'],
  [16, 'founder', 'studio', 'incomplete', null, 0, false, 'Raise + Grow, first payment never completed'],
  [17, 'founder', 'studio', 'partner_grant', PAST, 0, false, 'Raise + Grow, an expired partner grant'],
  [18, 'founder', 'studio', 'partner_grant', FUTURE, 0, true, 'Raise + Grow, a live partner grant'],
  [19, 'founder', 'growth', 'active', null, 1, false, 'Growth on the Spin-Out Lab'],
  [20, 'admin', 'free', 'active', null, 0, true, 'Admin'],
  [21, 'partner', 'free', 'active', null, 0, true, 'Operating partner'],
];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, subscription_tier, subscription_status, subscription_renews_at, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)');
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const [id, role, tier, status, renews, lab] of MEMBERS) {
    u.run(id, role, `Synthetic ${id}`, `synthetic${id}@example.test`, tier, status, renews, lab);
    ss.run(id, `j-${id}`);
  }
  return db;
}

const app = new Hono<any>();
app.route('/api/decks', deckAccess);
app.route('/api/decks', deckNew);
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
    const role = MEMBERS.find((p) => p[0] === as)![1];
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role, jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  // Hono hands only an Error to onError; `ensureTier`'s thrown 402 Response is
  // returned as-is by the Worker's own error handler, so it is the answer here too.
  let res: Response;
  try { res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any); }
  catch (e) { if (e instanceof Response) res = e; else throw e; }
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('D4359 1: the access read is open exactly when New deck and Share let the member through', async () => {
  const db = fixture();
  for (const [id, , , , , , open, who] of MEMBERS) {
    const access = await req(db, 'GET', '/api/decks/access', id);
    assert.equal(access.status, 200, `${who}: ${JSON.stringify(access.body)}`);
    assert.equal(access.body.open, open, `${who}: the read says ${open ? 'open' : 'locked'}`);
    // Both gates check the plan before anything else, so an empty body or a
    // missing deck answers 402 below the plan and something else at or above it.
    const outline = await req(db, 'POST', '/api/decks/outline', id, {});
    const share = await req(db, 'POST', '/api/decks/999999/share', id, {});
    assert.equal(outline.status === 402, !access.body.open, `${who}: New deck refuses exactly when the read is locked (got ${outline.status})`);
    assert.equal(share.status === 402, !access.body.open, `${who}: Share refuses exactly when the read is locked (got ${share.status})`);
  }
  const growth = await req(db, 'GET', '/api/decks/access', 12);
  const studio = await req(db, 'GET', '/api/decks/access', 13);
  assert.equal(growth.body.open, false, 'a Growth member sees the studio locked');
  assert.equal(studio.body.open, true, 'a Raise + Grow member sees it open');
});

test('D4359 2: a locked answer names the plan and says the 402\'s words; nobody signed in reads nothing', async () => {
  const db = fixture();
  const locked = await req(db, 'GET', '/api/decks/access', 12);
  assert.deepEqual(locked.body, {
    open: false,
    required: 'studio',
    plan: { tier: 'studio', name: PLAN_NAME.studio, plan_key: PLAN_KEY.studio },
    message: TIER_COPY.studio,
  });
  assert.equal(PLAN_NAME.studio, 'Raise + Grow');
  const refused = await req(db, 'POST', '/api/decks/outline', 12, {});
  assert.equal(refused.body.message, locked.body.message, 'the read and the refusal say the same words');
  assert.equal(refused.body.required, locked.body.required);
  const open = await req(db, 'GET', '/api/decks/access', 13);
  assert.equal(open.body.message, null);
  const anon = await req(db, 'GET', '/api/decks/access', null);
  assert.ok(anon.status === 401 || anon.status === 403, `nobody signed in is refused (got ${anon.status})`);
  assert.equal(deckStudioAccess(null).open, false);
});

test('D4359 3: every studio gate names DECK_STUDIO_TIER, and the access read is mounted ahead of GET /:id', () => {
  assert.equal(DECK_STUDIO_TIER, 'studio', '#2434 Q8 = A: the studio is on Raise + Grow');
  const gates: [string, RegExp][] = [
    ['cloudflare-worker/src/routes/deck_new.ts', /function planRefusal\(user: User\): Response \| null \{\n\s+try \{ ensureTier\(user, DECK_STUDIO_TIER\);/],
    ['cloudflare-worker/src/routes/decks.ts', /decks\.post\('\/:id\/share', async \(c\) => \{\n\s+ensureTier\(await requireAuth\(c\), DECK_STUDIO_TIER\);/],
    ['cloudflare-worker/src/services/raiseWriters.ts', /export async function createDeckLink\([^\n]*\n\s+ensureTier\(a\.user, DECK_STUDIO_TIER\);/],
    ['cloudflare-worker/src/services/raiseWriters.ts', /export async function updateDeckLink\([^\n]*\n\s+ensureTier\(a\.user, DECK_STUDIO_TIER\);/],
  ];
  for (const [file, gate] of gates) assert.match(readFileSync(file, 'utf8'), gate, `${file}: the gate reads the one constant`);
  for (const file of ['cloudflare-worker/src/routes/deck_new.ts', 'cloudflare-worker/src/services/raiseWriters.ts'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), /ensureTier\([^)]*'studio'\)/, `${file}: no studio gate typed as a literal`);
  assert.match(readFileSync('cloudflare-worker/src/routes/deck_access.ts', 'utf8'),
    /export const mount: RouteMount = \{ path: '\/api\/decks', router: deckAccess, before: \[decks\] \};/);
  assert.match(readFileSync('cloudflare-worker/src/routes/deck_access.ts', 'utf8'), /c\.json\(deckStudioAccess\(await requireAuth\(c\)\)\)/);
});
