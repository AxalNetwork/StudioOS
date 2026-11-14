/**
 * Deal lifecycle — one door into each state, and every move whole (task #127,
 * D4632 / #4632).
 *
 * The REAL `deals` router over real SQLite, with a batch that runs as one
 * transaction as D1's does. These replaced source-pattern checks: a check that
 * the route "mentions pass_reason" cannot see a pass that lands without its
 * history, or two passes overwriting each other's reason.
 *
 * People: ADMIN, PARTNER (leads ALPHA), FOUNDER (owns projects 1 and 2),
 * INVESTOR. Deals: ALPHA (applied, entered 2026-10-01), BETA (scored).
 *
 * `db.race` is one competing statement run just before the route's next
 * batch: a move that lands between the route's read and its atomic write.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deals_pass_gate.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals from '../src/routes/deals.ts';

const JWT_SECRET = 'unit-test-jwt-secret-4632-0123456789abcdef';
const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  if (msg === 'Forbidden' || msg === 'Admin required') return c.json({ detail: msg }, 403);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/deals', deals);

const ADMIN = 1, PARTNER = 2, FOUNDER = 3, INVESTOR = 4;
const ALPHA = 71, BETA = 72;
const admin = { user: ADMIN, role: 'admin' }, partner = { user: PARTNER, role: 'partner' };
const founder = { user: FOUNDER, role: 'founder' }, investor = { user: INVESTOR, role: 'investor' };

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
type Db = InstanceType<typeof DatabaseSync> & { race?: string | null };
function makeD1(db: Db) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const meta = (r: any) => ({ meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } });
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { return meta(db.prepare(sql).run(...b)); },
        runSync() { return meta(db.prepare(sql).run(...b)); },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      // The competing write commits first, on its own.
      if (db.race) { db.exec(db.race); db.race = null; }
      db.exec('SAVEPOINT b');
      try { const out = x.map((s) => s.runSync()); db.exec('RELEASE b'); return out; }
      catch (e) { db.exec('ROLLBACK TO b'); db.exec('RELEASE b'); throw e; }
    },
  };
}

function freshDb(): Db {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false }) as Db;
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, investor_tier TEXT, partner_id INTEGER, founder_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, sector TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, partner_id INTEGER, lead_partner_id INTEGER,
      status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','scored','active','funded','rejected')),
      notes TEXT, description TEXT, website TEXT, amount REAL, target_raise REAL, currency TEXT NOT NULL DEFAULT 'USD',
      minimum_check REAL, valuation_cap REAL, carry_pct REAL, management_fee_pct REAL, instrument TEXT, spv_jurisdiction TEXT,
      closing_deadline TEXT, capital_committed REAL DEFAULT 0, source TEXT,
      pass_reason TEXT, pass_note TEXT, passed_at TEXT, passed_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), stage_changed_at TEXT);
    CREATE TABLE commitments (id INTEGER PRIMARY KEY, uid TEXT, deal_id INTEGER, investor_user_id INTEGER, amount REAL, status TEXT);
    CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE deal_stage_events (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL, from_stage TEXT, to_stage TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'set' CHECK (kind IN ('advance','pass','set')), days_in_from INTEGER, actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT,
      actor TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users (id, role, name, founder_id) VALUES (${ADMIN}, 'admin', 'Ada', NULL), (${PARTNER}, 'partner', 'Pat', NULL),
      (${FOUNDER}, 'founder', 'Fay', 300), (${INVESTOR}, 'investor', 'Ivo', NULL);
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Alpha', 300), (2, 'Beta', 300);
    INSERT INTO partners (id, name) VALUES (9, 'Northwind');
    INSERT INTO deals (id, project_id, status, lead_partner_id, notes, stage_changed_at) VALUES
      (${ALPHA}, 1, 'applied', ${PARTNER}, 'first call', '2026-10-01 00:00:00'), (${BETA}, 2, 'scored', ${PARTNER}, NULL, '2026-10-02 00:00:00');
  `);
  return db;
}

const token = (userId: number, role: string) => new SignJWT({ user_id: userId, role })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(db: Db, who: { user: number; role: string }, path: string, method = 'GET', body?: unknown) {
  const warn = console.warn; const error = console.error; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request('/api/deals' + path, {
      method, headers: { Authorization: 'Bearer ' + await token(who.user, who.role), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = warn; console.error = error; }
}
const deal = (db: Db, id = ALPHA) => db.prepare('SELECT status, notes, partner_id, pass_reason, stage_changed_at FROM deals WHERE id = ?').get(id) as any;
const events = (db: Db, id = ALPHA) => (db.prepare('SELECT from_stage, to_stage, kind FROM deal_stage_events WHERE deal_id = ? ORDER BY id').all(id) as any[])
  .map((e) => [e.from_stage, e.to_stage, e.kind]);
const count = (db: Db, table: string) => Number((db.prepare('SELECT COUNT(*) AS n FROM ' + table).get() as any).n);

// ---------------------------------------------------------------- birth

test('a founder\'s deal is born applied, with its first history row; another stage, a pass or a partner is refused', async () => {
  const db = freshDb();
  for (const [body, status, error] of [
    [{ project_id: 1, status: 'scored' }, 403, 'initial_status_not_allowed'],
    [{ project_id: 1, status: 'rejected' }, 400, 'pass_needs_reason'],
    [{ project_id: 1, status: 'closed' }, 400, 'unknown_status'],
    [{ project_id: 1, partner_id: 9 }, 403, 'partner_staff_only'],
  ] as const) {
    const r = await call(db, founder, '', 'POST', body);
    assert.deepEqual([r.status, r.body?.error], [status, error], JSON.stringify(body));
  }
  assert.equal(count(db, 'deals'), 2, 'nothing was created');
  assert.equal(count(db, 'deal_stage_events'), 0);
  const ok = await call(db, founder, '', 'POST', { project_id: 1, notes: 'Seed round' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'applied');
  assert.deepEqual(events(db, ok.body.id), [[null, 'applied', 'set']], 'born with its first stage entry');
  assert.ok(deal(db, ok.body.id).stage_changed_at);
});

test('an admin drafts into a pipeline stage, never straight into a pass or an unknown stage', async () => {
  const db = freshDb();
  for (const [path, body, status] of [
    ['/draft', { project_id: 2, status: 'rejected' }, 400],
    ['/draft', { project_id: 2, status: 'closing' }, 400],
    ['', { project_id: 2, status: 'rejected' }, 400],
  ] as const) assert.equal((await call(db, admin, path, 'POST', body)).status, status, path + ' ' + body.status);
  assert.equal(count(db, 'deals'), 2);
  const draft = await call(db, admin, '/draft', 'POST', { project_id: 2, status: 'active', target_raise: 2000000, partner_id: 9 });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.deepEqual([draft.body.status, draft.body.target_raise, draft.body.partner_id], ['active', 2000000, 9]);
  assert.deepEqual(events(db, draft.body.id), [[null, 'active', 'set']]);
  const plain = await call(db, admin, '', 'POST', { project_id: 2, status: 'scored', partner_id: 9 });
  assert.deepEqual([plain.status, plain.body.status, plain.body.partner_id], [201, 'scored', 9]);
  assert.deepEqual(events(db, plain.body.id), [[null, 'scored', 'set']]);
});

// ---------------------------------------------------------------- moves

test('every move writes its stage and one history row together; a retry writes no second row', async () => {
  const db = freshDb();
  const put = await call(db, partner, `/${ALPHA}`, 'PUT', { status: 'scored', notes: 'IC booked' });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal((await call(db, partner, `/${ALPHA}`, 'PUT', { status: 'scored', notes: 'IC booked' })).status, 200, 'a retried PUT');
  const adv = await call(db, partner, `/${ALPHA}/advance`, 'POST', { from: 'scored' });
  assert.equal(adv.status, 200, JSON.stringify(adv.body));
  const again = await call(db, partner, `/${ALPHA}/advance`, 'POST', { from: 'scored' });
  assert.deepEqual([again.status, again.body.error], [409, 'deal_moved'], 'a retried advance finds the round moved');
  const pass = await call(db, partner, `/${ALPHA}/pass`, 'POST', { reason: 'team' });
  assert.equal(pass.status, 200, JSON.stringify(pass.body));
  assert.equal((await call(db, partner, `/${ALPHA}/pass`, 'POST', { reason: 'valuation' })).status, 409, 'a second pass');
  assert.equal(deal(db).status, 'rejected');
  assert.equal(deal(db).pass_reason, 'team', 'the first reason stands');
  assert.deepEqual(events(db), [['applied', 'scored', 'set'], ['scored', 'active', 'advance'], ['active', 'rejected', 'pass']]);
});

test('a pass needs its reason, and PUT never writes the terminal stage', async () => {
  const db = freshDb();
  assert.equal((await call(db, partner, `/${ALPHA}/pass`, 'POST', {})).status, 400);
  assert.equal((await call(db, partner, `/${ALPHA}/pass`, 'POST', { reason: '  ' })).status, 400);
  const put = await call(db, admin, `/${ALPHA}`, 'PUT', { status: 'rejected', notes: 'no' });
  assert.equal(put.status, 400);
  assert.match(String(put.body.detail), /deals\/:id\/pass/);
  assert.deepEqual([deal(db).status, deal(db).notes, deal(db).pass_reason], ['applied', 'first call', null]);
  assert.equal(count(db, 'deal_stage_events'), 0);
});

test('a move that lands between the read and the write leaves this request with nothing written', async () => {
  const moved = `UPDATE deals SET status = 'scored', stage_changed_at = '2026-11-01 00:00:00' WHERE id = ${ALPHA}`;
  // PUT with a note and a partner: the competing move wins, and none of the three is written.
  let db = freshDb(); db.race = moved;
  let r = await call(db, partner, `/${ALPHA}`, 'PUT', { status: 'active', notes: 'skip ahead', partner_id: 9 });
  assert.deepEqual([r.status, r.body.error], [409, 'deal_moved']);
  assert.deepEqual([deal(db).status, deal(db).notes, deal(db).partner_id], ['scored', 'first call', null]);
  assert.equal(count(db, 'deal_stage_events'), 0, 'no history for a move that did not happen');
  // Advance: the round moves once, by the other move.
  db = freshDb(); db.race = moved;
  r = await call(db, partner, `/${ALPHA}/advance`, 'POST', {});
  assert.equal(r.status, 409);
  assert.equal(deal(db).status, 'scored');
  assert.equal(count(db, 'deal_stage_events'), 0);
  // Pass: a competing pass wins, and its reason stands.
  db = freshDb();
  db.race = `UPDATE deals SET status = 'rejected', pass_reason = 'valuation', stage_changed_at = '2026-11-01 00:00:00' WHERE id = ${ALPHA}`;
  r = await call(db, partner, `/${ALPHA}/pass`, 'POST', { reason: 'team' });
  assert.equal(r.status, 409);
  assert.equal(deal(db).pass_reason, 'valuation');
  assert.equal(count(db, 'deal_stage_events'), 0);
  // The same stage re-entered meanwhile: the version is the time as well as the stage.
  db = freshDb(); db.race = `UPDATE deals SET stage_changed_at = '2026-11-01 00:00:00' WHERE id = ${ALPHA}`;
  assert.equal((await call(db, partner, `/${ALPHA}/advance`, 'POST', {})).status, 409);
});

test('a write that fails leaves no stage, no field and no history', async () => {
  const db = freshDb();
  db.exec(`CREATE TRIGGER no_notes BEFORE UPDATE OF notes ON deals BEGIN SELECT RAISE(ABORT, 'refused'); END`);
  const r = await call(db, partner, `/${ALPHA}`, 'PUT', { status: 'scored', notes: 'x' });
  assert.equal(r.status, 500);
  assert.deepEqual([deal(db).status, deal(db).notes], ['applied', 'first call']);
  assert.equal(count(db, 'deal_stage_events'), 0, 'the history row is rolled back with the move');
});

// ---------------------------------------------------------------- withdrawal

test('the old withdraw door is retired: 410, and nothing changes', async () => {
  const db = freshDb();
  db.exec(`INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES (1, 'c1', ${ALPHA}, ${INVESTOR}, 10000, 'confirmed')`);
  const r = await call(db, investor, `/${ALPHA}/commitments/c1/withdraw`, 'POST', {});
  assert.deepEqual([r.status, r.body.error], [410, 'route_retired']);
  assert.match(String(r.body.detail), /withdrawal/);
  assert.equal((db.prepare('SELECT status FROM commitments WHERE id = 1').get() as any).status, 'confirmed');
  assert.equal(count(db, 'activity_logs'), 0);
});

// ---------------------------------------------------------------- source checks kept

/** Comments stripped: three assertions in this repo have tripped on prose. */
function stripComments(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const c = input[i], d = input[i + 1];
    if (c === '/' && d === '/') { while (i < input.length && input[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c;
      for (i++; i < input.length; ) {
        if (input[i] === '\\') { out += input.slice(i, i + 2); i += 2; continue; }
        out += input[i];
        const end = input[i] === q; i++;
        if (end) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}
const src = stripComments(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/deals.ts'), 'utf8'));
function handler(sig: string): string {
  const start = src.indexOf(sig);
  assert.notEqual(start, -1, `route ${sig} must exist`);
  const rest = src.slice(start + sig.length);
  const next = rest.search(/\ndeals\.(get|post|put|patch|delete)\(/);
  return rest.slice(0, next === -1 ? rest.length : next);
}

test('the reason is validated before anything is read or written', () => {
  const pass = handler("deals.post('/:id/pass'");
  const check = pass.indexOf('isPassReason');
  assert.notEqual(check, -1, 'the pass route must validate the reason');
  assert.ok(check < pass.indexOf('getSQL'), 'validation must precede the DB');
});

test('the analytics routes are registered above the id route', () => {
  // Hono matches in order: registered after `/:id`, `/pass-analytics` would be read as a deal id.
  const idAt = src.indexOf("deals.get('/:id'");
  for (const literal of ["deals.get('/pass-analytics'", "deals.get('/stage-analytics'"]) {
    const at = src.indexOf(literal);
    assert.notEqual(at, -1, `${literal} must exist`);
    assert.ok(at < idAt, `${literal} must be registered before the id route`);
  }
});

test('an unfiltered pass query does not dump every passed deal', () => {
  const body = handler("deals.get('/pass-analytics'");
  assert.match(body, /let matches: any\[\] = \[\];/, 'the deal list must start empty and be filled only on an explicit reason');
  assert.match(body, /LIMIT 100/, 'and stay bounded');
});

test('stage analytics never answer without saying when recording began', () => {
  const body = handler("deals.get('/stage-analytics'");
  assert.match(body, /recording_started_at/);
  assert.match(body, /unavailable/, 'and refuse outright when there is no history at all');
});
