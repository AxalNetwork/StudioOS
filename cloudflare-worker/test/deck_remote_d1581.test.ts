/**
 * D1581 (#3828, deck v2 F2) — the phone remote for Present, paired by code.
 *
 *   1. The rules: a six-digit code with its zeros, the steps Present takes, and
 *      nothing else.
 *   2. The room: a code is good once and for ten minutes; a join gets a
 *      remote; a step from it reaches every Present socket; a new code or
 *      Unpair ends the remote.
 *   3. Through the routes: the presenter pairs, a reader on the phone joins,
 *      a step moves Present within 300 ms of the request (measured end to end
 *      here; the staging run is in D1581 §5); a member who cannot read the deck
 *      gets the wrong-code answer; no binding is 503 `remote_off`.
 *   4. `deck_remote_pair` and `deck_remote_join`: 10 a minute, failing closed.
 *   5. All three wrangler tables bind DeckRemote under `v7-deck-remote`, the
 *      topology lists it, and index.ts exports it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { CODE_TTL_MS, REMOTE_TTL_MS, isCode, makeCode, stepOf } from '../src/services/decks/remote.ts';
import { DeckRemote } from '../src/durable-objects/deck-remote.ts';
import deckRemote from '../src/routes/deck_remote.ts';
import { DECK_REMOTE_JOIN, DECK_REMOTE_PAIR, rateLimitMiddleware } from '../src/middleware/rateLimit.ts';
import { BINDINGS } from '../src/services/topology.ts';
import { compareMigrations, migrationNumber, BASELINE_CUTOFF } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

// ── fakes: a Durable Object state, its sockets, and a namespace of real DeckRemote instances ──
type Sock = { frames: any[]; send(t: string): void };
function sock(): Sock { const s: Sock = { frames: [], send(t) { s.frames.push(JSON.parse(t)); } }; return s; }
function stateOf() {
  const store = new Map<string, unknown>();
  const sockets: Sock[] = [];
  return {
    sockets,
    storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); }, delete: async (k: string) => store.delete(k) },
    getWebSockets: () => sockets,
    acceptWebSocket: (ws: Sock) => { sockets.push(ws); },
  } as any;
}
function namespace(clock: { t: number }, codes: string[] = []) {
  const rooms = new Map<string, { obj: DeckRemote; state: any }>();
  const at = (name: string) => {
    if (!rooms.has(name)) {
      const state = stateOf();
      const obj = new DeckRemote(state, {} as any);
      obj.now = () => clock.t;
      obj.random = () => { const c = codes.shift(); return c === undefined ? Math.floor(Math.random() * 2 ** 32) : Number(c); };
      rooms.set(name, { obj, state });
    }
    return rooms.get(name)!;
  };
  return {
    rooms, at,
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: (input: string | Request, init?: RequestInit) => at(id.name).obj.fetch(typeof input === 'string' ? new Request(input, init) : input),
    }),
  };
}
const post = (obj: DeckRemote, path: string, body: unknown = {}) =>
  obj.fetch(new Request(`https://deck-remote${path}`, { method: 'POST', body: JSON.stringify(body) }));

// 1 ───────────────────────────────────────────────────────────────────────────
test('1. the rules: six digits with their zeros, Present\'s steps or a card by number, nothing else', () => {
  assert.equal(makeCode(() => 42), '000042');
  assert.equal(makeCode(() => 999_999), '999999');
  assert.equal(makeCode(() => 4_000_123_456), '123456', 'below the limit: the remainder');
  // Mutation checked: no rejection (always x % 1e6) → the draw past the limit is used and this reads 967295.
  const draws = [2 ** 32 - 1, 7];
  assert.equal(makeCode(() => draws.shift()!), '000007', 'a draw at or above the limit is drawn again');
  assert.ok(isCode(makeCode()));
  assert.deepEqual(['123456', '12345', '1234567', 'abcdef', 123456].map(isCode), [true, false, false, false, false]);
  assert.deepEqual(['next', 'prev', 'first', 'last'].map(stepOf), ['next', 'prev', 'first', 'last']);
  assert.deepEqual([3, { card: 4 }].map(stepOf), [{ card: 3 }, { card: 4 }]);
  assert.deepEqual(['exit', 'back', 0, -1, 1.5, 201, { card: 'x' }, null].map(stepOf), [null, null, null, null, null, null, null, null], 'Esc is the presenter\'s alone');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('2. the room: a code is good once and for ten minutes, a step reaches every Present, a new code ends the remote', async () => {
  // Mutation checked: /join not clearing the code → the second join succeeds; /pair not ending the remote → the old remote still steps.
  const clock = { t: 1_000_000 };
  const ns = namespace(clock, ['000777', '123456']);
  const room = ns.at('deck:9');
  const [a, b] = [sock(), sock()];
  room.state.sockets.push(a, b);
  const paired = await (await post(room.obj, '/pair', { user_id: 1 })).json() as any;
  assert.equal(paired.code, '000777');
  assert.equal(Date.parse(paired.expires_at), clock.t + CODE_TTL_MS);
  assert.equal((await post(room.obj, '/join', { code: '000778' })).status, 404, 'a wrong code');
  const joined = await (await post(room.obj, '/join', { code: '000777' })).json() as any;
  assert.ok(/^[0-9a-f-]{36}$/.test(joined.remote_id));
  assert.equal(Date.parse(joined.expires_at), clock.t + REMOTE_TTL_MS);
  assert.equal((await post(room.obj, '/join', { code: '000777' })).status, 404, 'the code is good once');
  const stepped = await (await post(room.obj, '/step', { remote_id: joined.remote_id, step: 'next' })).json() as any;
  assert.deepEqual(stepped, { ok: true, delivered: 2 });
  assert.deepEqual(a.frames.at(-1), { type: 'step', step: 'next', at: clock.t });
  assert.deepEqual(b.frames.at(-1), a.frames.at(-1), 'every Present socket');
  assert.equal((await post(room.obj, '/step', { remote_id: joined.remote_id, step: 'exit' })).status, 400);
  assert.equal((await post(room.obj, '/step', { remote_id: crypto.randomUUID(), step: 'next' })).status, 409, 'not this remote');
  // A new code ends the remote; so does Unpair.
  await post(room.obj, '/pair', { user_id: 1 });
  assert.equal((await post(room.obj, '/step', { remote_id: joined.remote_id, step: 'next' })).status, 409);
  assert.equal(a.frames.at(-1).type, 'unpaired');
  // A code past ten minutes is refused.
  clock.t += CODE_TTL_MS + 1;
  assert.equal((await post(room.obj, '/join', { code: '123456' })).status, 404);
  // The pointer: claimed once while live, taken once.
  const ptr = ns.at('code:555555');
  assert.equal((await post(ptr.obj, '/claim', { deck_id: 9 })).status, 200);
  assert.equal((await post(ptr.obj, '/claim', { deck_id: 10 })).status, 409, 'a live code is not reissued');
  assert.deepEqual(await (await post(ptr.obj, '/take')).json(), { deck_id: 9 });
  assert.equal((await post(ptr.obj, '/take')).status, 404, 'taken once');
});

// 3 ───────────────────────────────────────────────────────────────────────────
const BASELINE_SQL = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE_SQL);
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations).filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const FOUNDER = 10, OTHER = 20, COFOUNDER = 30, P = 1, DECK = 1;
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  add.run(COFOUNDER, 'founder', 'Cy Cofounder', 'cy@example.test', 1003);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${COFOUNDER}, 'cofounder', 'accepted')`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(DECK, P, 'Synthetic deck', '[]');
  return db;
}
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
async function call(db: DatabaseSync, ns: any, who: number, method: string, path: string, body?: unknown) {
  const app = new Hono<any>();
  app.route('/api/decks', deckRemote);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...(ns ? { DECK_REMOTE: ns } : {}) };
  const res = await withThrownResponses(() => app.request(path, init, env));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('3. through the routes: pair, join from a phone, and a step moves Present within 300 ms; a stranger and no binding are refused', async () => {
  // Mutation checked: join skipping the deck check → the stranger gets a remote_id; step skipping the room's remote check → 200 after Unpair.
  const db = world();
  try {
    const clock = { t: Date.now() };
    const ns = namespace(clock);
    const present = sock();
    ns.at(`deck:${DECK}`).state.sockets.push(present);
    const paired = await call(db, ns, FOUNDER, 'POST', `/api/decks/${DECK}/remote/pair`);
    assert.equal(paired.status, 200, JSON.stringify(paired.body));
    assert.ok(isCode(paired.body.code));
    assert.deepEqual((await call(db, ns, FOUNDER, 'GET', `/api/decks/${DECK}/remote`)).body, { deck_id: DECK, code_live: true, paired: false, presenting: 1 });
    // A member who cannot read the deck: the wrong-code answer, and the code is spent.
    const stranger = await call(db, ns, OTHER, 'POST', '/api/decks/remote/join', { code: paired.body.code });
    assert.deepEqual([stranger.status, stranger.body.error], [404, 'code_not_found']);
    const again = await call(db, ns, FOUNDER, 'POST', `/api/decks/${DECK}/remote/pair`);
    // The co-founder's phone joins.
    const joined = await call(db, ns, COFOUNDER, 'POST', '/api/decks/remote/join', { code: again.body.code });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.deck_id, DECK);
    assert.equal(present.frames.at(-1).type, 'paired');
    // A step, timed from the request to the frame on Present's socket.
    const t0 = performance.now();
    const stepped = await call(db, ns, COFOUNDER, 'POST', `/api/decks/${DECK}/remote/step`, { remote_id: joined.body.remote_id, step: { card: 3 } });
    const ms = performance.now() - t0;
    assert.deepEqual(stepped.body, { ok: true, delivered: 1 });
    assert.deepEqual(present.frames.at(-1).step, { card: 3 });
    assert.ok(ms < 300, `the step took ${ms.toFixed(1)} ms`);
    assert.equal((await call(db, ns, COFOUNDER, 'POST', `/api/decks/${DECK}/remote/step`, { remote_id: joined.body.remote_id, step: 'exit' })).body.error, 'invalid_step');
    assert.equal((await call(db, ns, OTHER, 'POST', `/api/decks/${DECK}/remote/step`, { remote_id: joined.body.remote_id, step: 'next' })).status, 404, 'a stranger cannot step');
    // Unpair ends it.
    assert.equal((await call(db, ns, FOUNDER, 'DELETE', `/api/decks/${DECK}/remote`)).status, 200);
    const late = await call(db, ns, COFOUNDER, 'POST', `/api/decks/${DECK}/remote/step`, { remote_id: joined.body.remote_id, step: 'next' });
    assert.deepEqual([late.status, late.body.error], [409, 'remote_not_paired']);
    assert.deepEqual((await call(db, ns, COFOUNDER, 'POST', '/api/decks/remote/join', { code: '12' })).body.error, 'invalid_code');
    // No binding.
    const off = await call(db, null, FOUNDER, 'POST', `/api/decks/${DECK}/remote/pair`);
    assert.deepEqual([off.status, off.body.error], [503, 'remote_off']);
  } finally { db.close(); }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('4. deck_remote_pair and deck_remote_join: 10 a minute per member, failing closed', async () => {
  // Mutation checked: failClosed false on both → the outage request is let through.
  assert.ok(DECK_REMOTE_PAIR.test('/api/decks/7/remote/pair') && !DECK_REMOTE_PAIR.test('/api/decks/7/remote/step'));
  assert.ok(DECK_REMOTE_JOIN.test('/api/decks/remote/join') && !DECK_REMOTE_JOIN.test('/api/decks/7/remote'));
  const previousNow = Date.now; const instant = Date.UTC(2026, 10, 3, 10, 0, 5); Date.now = () => instant;
  try {
    for (const path of ['/api/decks/7/remote/pair', '/api/decks/remote/join']) {
      const app = new Hono<any>();
      app.use('*', async (c, next) => { c.set('currentUser', { id: FOUNDER, role: 'founder' }); await next(); });
      app.use('/api/*', rateLimitMiddleware());
      app.post('/api/*', (c) => c.json({ ok: true }));
      const counts = new Map<string, string>();
      const e: any = { RATE_LIMITS: { get: async (k: string) => counts.get(k), put: async (k: string, v: string) => { counts.set(k, v); } }, DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
      const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) statuses.push((await app.request(path, { method: 'POST' }, e, ctx)).status);
      assert.deepEqual([statuses.slice(0, 10).every((s) => s === 200), statuses[10]], [true, 429], path);
      e.RATE_LIMITS.get = async () => { throw new Error('Synthetic KV outage'); };
      assert.equal((await app.request(path, { method: 'POST' }, e, ctx)).status, 503, path);
    }
  } finally { Date.now = previousNow; }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('5. all three wrangler tables bind DeckRemote under v7-deck-remote; the topology lists it and index.ts exports it', () => {
  // Mutation checked: dropping the preview binding → the count is 2.
  const toml = readFileSync('wrangler.toml', 'utf8');
  const re = /\[\[(?:env\.(?:production|preview)\.)?durable_objects\.bindings\]\]\s*\nname\s*=\s*"DECK_REMOTE"\s*\nclass_name\s*=\s*"DeckRemote"/g;
  assert.equal(toml.match(re)?.length, 3);
  const tags = [...toml.matchAll(/\[\[(env\.(?:production|preview)\.)?migrations\]\]\s*\ntag\s*=\s*"v7-deck-remote"\s*\nnew_sqlite_classes\s*=\s*\["DeckRemote"\]/g)].map((m) => m[1] ?? 'top');
  assert.deepEqual(tags, ['top', 'env.production.', 'env.preview.']);
  assert.ok((BINDINGS as any[]).some((b) => b.name === 'DECK_REMOTE' && b.hq === 'DeckRemote'));
  assert.match(readFileSync('cloudflare-worker/src/index.ts', 'utf8'), /export \{ DeckRemote \} from '\.\/durable-objects\/deck-remote';/);
});
