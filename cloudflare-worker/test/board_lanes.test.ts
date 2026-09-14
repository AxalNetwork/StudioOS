/**
 * Swimlanes on the execution board, and the WIP limit that actually refuses.
 *
 * `/build/board` (FB2) drew five chips and TWO were not in the registry at all.
 * `Configure lanes`'s own reason named its fix — "no per-project stage list is
 * stored, so there is nothing for an editor to change" — and migration 253 stores
 * one.
 *
 * THE ASSERTION THAT MATTERS MOST is that a refused bulk move writes NOTHING. The
 * artboard's instrument is headed "WIP limits enforced" and its note says "The limit
 * is a configuration, not a suggestion — the board refuses the fifth card." A limit
 * that colours a number red is a suggestion; a partial move that reported an error
 * would leave the founder to work out which cards landed.
 *
 * `mvp_tasks` COMES FROM `schema_baseline.sql` and the `lane` column from migration
 * 253, because a hand-written fixture was wrong on the first try in the sibling file
 * — `key_results` where production has `key_results_json` — and the same class of
 * drift is what #203 was.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import founderBoard from '../src/routes/founder_board.ts';
import { tableFromBaseline, wordInText } from './_baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const MIGRATION = readFileSync(`${SQL}/migrations/253_project_lanes.sql`, 'utf8');
const BASELINE = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8');
const ROUTE_SRC = readFileSync(resolve(HERE, '../src/routes/founder_board.ts'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OWNER = 100;
const OTHER = 101;
const PARTNER = 102;
const PROJECT = 9401;
const OTHER_PROJECT = 9402;


function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

function applySql(db: InstanceType<typeof DatabaseSync>, sql: string) {
  for (const stmt of sql.replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) db.exec(stmt);
}

function freshDb(withMigration = true) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      name TEXT, email TEXT, founder_id INTEGER, spinout_lab_active INTEGER
    );
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, founder_id INTEGER);
  `);
  db.exec(tableFromBaseline(BASELINE, 'mvp_tasks'));
  const u = db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?,?,?)');
  u.run(OWNER, 'founder', OWNER);
  u.run(OTHER, 'founder', OTHER);
  u.run(PARTNER, 'partner', null);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?,?,?)');
  p.run(PROJECT, 'Bellwether', OWNER);
  p.run(OTHER_PROJECT, 'Somebody else', OTHER);
  if (withMigration) applySql(db, MIGRATION);
  return db;
}

function addCard(
  db: InstanceType<typeof DatabaseSync>, project: number, title: string,
  status = 'in_progress', lane: string | null = null, owner: number | null = null,
): number {
  const cols = ['deal_id', 'title', 'status', 'assigned_to'];
  const vals: any[] = [project, title, status, owner];
  // `lane` only exists once migration 253 has run, which is the point of the
  // without-migration test below.
  const hasLane = (db.prepare('PRAGMA table_info(mvp_tasks)').all() as any[]).some((c) => c.name === 'lane');
  if (hasLane) { cols.push('lane'); vals.push(lane); }
  const r = db.prepare(
    `INSERT INTO mvp_tasks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
  ).run(...vals);
  return Number(r.lastInsertRowid);
}

const app = new Hono();
app.route('/', founderBoard);

const env = (db: InstanceType<typeof DatabaseSync>) => ({
  JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db),
} as any);

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string }, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await app.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const owner = { user: OWNER, role: 'founder' };
const outsider = { user: OTHER, role: 'founder' };
const partner = { user: PARTNER, role: 'partner' };

/**
 * `node:sqlite` returns NULL-PROTOTYPE objects, so `deepEqual` against a plain
 * literal fails on the prototype alone — with a diff that shows identical fields.
 * Every row read here is copied into a plain object first.
 */
const laneRows = (db: InstanceType<typeof DatabaseSync>) =>
  (db.prepare('SELECT name, wip_limit, sort_order FROM project_lanes ORDER BY sort_order, name')
    .all() as any[]).map((r) => ({ name: r.name, wip_limit: r.wip_limit, sort_order: r.sort_order }));
const cardLanes = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT id, lane, status FROM mvp_tasks ORDER BY id').all() as any[];

// ── the migration ─────────────────────────────────────────────────────────────

test('migration 253 carries no transaction statement', () => {
  const code = MIGRATION.replace(/^\s*--.*$/gm, '');
  for (const kw of ['BEGIN', 'COMMIT', 'ROLLBACK', 'END TRANSACTION']) {
    assert.ok(!wordInText(code.toUpperCase(), kw), `migration 253 contains ${kw}`);
  }
});

test('a lane name is unique per project and the WIP limit is nullable', () => {
  const db = freshDb();
  const cols = db.prepare('PRAGMA table_info(project_lanes)').all() as any[];
  const wip = cols.find((c) => c.name === 'wip_limit');
  // NULLABLE, and that is not the same as 0. No limit can never be over; a limit of
  // zero is a lane closed to new work, which is how a founder pauses a workstream
  // without deleting its cards.
  assert.equal(Number(wip.notnull), 0);
  const idx = db.prepare("SELECT name, \"unique\" FROM pragma_index_list('project_lanes')").all() as any[];
  assert.ok(idx.some((i) => Number(i.unique) === 1), 'two lanes could share a name and split a WIP limit in half');
});

test('the card gets a lane column, and no card is assigned one by the migration', () => {
  const db = freshDb();
  const cols = (db.prepare('PRAGMA table_info(mvp_tasks)').all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('lane'));
  // NOTHING IS SEEDED. Putting "Engineering, GTM, Ops" on the board of a solo
  // founder building a design tool is inventing three workstreams they never asked
  // for.
  assert.deepEqual(laneRows(db), []);
});

test('the route bootstraps its own table and column when the migration has not run', async () => {
  const db = freshDb(false);
  const e = env(db);
  const r = await call(e, 'GET', `/${PROJECT}`, owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.store_ready, true);
  // And the ALTER's "duplicate column name" on the SECOND call is swallowed, so the
  // route does not start failing once the column exists.
  assert.equal((await call(e, 'GET', `/${PROJECT}`, owner)).status, 200);
});

// ── the lane list ─────────────────────────────────────────────────────────────

test('a lane round-trips, and a second write to one name edits it', async () => {
  const db = freshDb();
  const e = env(db);
  const first = await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Engineering', wip_limit: 4 });
  assert.equal(first.status, 201);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Engineering', wip_limit: 6 });
  // ONE ROW. `UNIQUE (project_id, name)` says there is one lane per name, and two
  // would split a WIP limit in half without saying so.
  assert.deepEqual(laneRows(db), [{ name: 'Engineering', wip_limit: 6, sort_order: 0 }]);
});

test('a blank WIP limit is no limit, and zero is a real one', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Unlimited', wip_limit: '' });
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Closed', wip_limit: 0 });
  const rows = laneRows(db);
  // `Number('')` is 0 and finite, so a coercion that ran before the emptiness check
  // would CLOSE a lane the founder meant to leave open.
  assert.equal(rows.find((l) => l.name === 'Unlimited').wip_limit, null);
  assert.equal(rows.find((l) => l.name === 'Closed').wip_limit, 0);
});

test('renaming a lane carries its cards', async () => {
  const db = freshDb();
  const e = env(db);
  const made = await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Eng', wip_limit: null });
  addCard(db, PROJECT, 'A', 'in_progress', 'Eng');
  addCard(db, PROJECT, 'B', 'todo', 'Eng');
  const r = await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { id: made.body.id, name: 'Engineering' });
  assert.equal(r.status, 200);
  assert.equal(r.body.renamed_from, 'Eng');
  // THE CARDS FOLLOW. The lane is stored on the card as a name, so a rename that did
  // not carry them would orphan every one into a lane that no longer exists.
  assert.deepEqual(cardLanes(db).map((c) => c.lane), ['Engineering', 'Engineering']);
});

test('deleting a lane keeps its cards and unassigns them', async () => {
  const db = freshDb();
  const e = env(db);
  const made = await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'GTM' });
  addCard(db, PROJECT, 'Pricing page', 'in_progress', 'GTM');
  const r = await call(e, 'DELETE', `/lanes/${made.body.id}`, owner);
  assert.equal(r.status, 200);
  // Deleting a lane is a statement about how work is ORGANISED, not about the work.
  // A founder collapsing two lanes into one must not lose the cards in either.
  const cards = cardLanes(db);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].lane, null);
  assert.deepEqual(laneRows(db), []);
});

test('a lane cannot be renamed into another venture by id', async () => {
  const db = freshDb();
  const e = env(db);
  const theirs = await call(e, 'PUT', `/${OTHER_PROJECT}/lanes`, outsider, { name: 'Theirs' });
  const r = await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { id: theirs.body.id, name: 'Mine now' });
  // 404, and the lane keeps its name. The row's own project is checked rather than
  // the id being trusted against the URL.
  assert.equal(r.status, 404);
  assert.ok(laneRows(db).some((l) => l.name === 'Theirs'));
});

test('a lane needs a name, and an over-long one is refused', async () => {
  const e = env(freshDb());
  assert.equal((await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: '   ' })).status, 400);
  assert.equal((await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'x'.repeat(61) })).status, 400);
});

// ── the read ──────────────────────────────────────────────────────────────────

test('each lane reports its load, and backlog does not count against the limit', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Eng', wip_limit: 2 });
  addCard(db, PROJECT, 'A', 'in_progress', 'Eng');
  addCard(db, PROJECT, 'B', 'review', 'Eng');
  addCard(db, PROJECT, 'C', 'todo', 'Eng');        // backlog
  addCard(db, PROJECT, 'D', 'done', 'Eng');        // finished
  const lane = (await call(e, 'GET', `/${PROJECT}`, owner)).body.lanes[0];
  assert.equal(lane.cards, 4);
  // THE CANVAS'S OWN NOTE DEPENDS ON THIS: "the permissions card sits in backlog
  // rather than starting". Counting backlog would make the limit self-fulfilling.
  assert.equal(lane.in_flight, 2);
  assert.equal(lane.over_limit, false);
});

test('a status nobody recognises counts as in flight', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Eng', wip_limit: 1 });
  addCard(db, PROJECT, 'A', 'in_progress', 'Eng');
  addCard(db, PROJECT, 'B', 'marinating', 'Eng');
  const lane = (await call(e, 'GET', `/${PROJECT}`, owner)).body.lanes[0];
  // `status` is free text, so the exclusion list cannot be exhaustive — and a WIP
  // limit that can be walked past by inventing a status is not a limit.
  assert.equal(lane.in_flight, 2);
  assert.equal(lane.over_limit, true);
});

test('a lane with no limit is never over it', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Open', wip_limit: null });
  for (let i = 0; i < 9; i += 1) addCard(db, PROJECT, `card ${i}`, 'in_progress', 'Open');
  const lane = (await call(e, 'GET', `/${PROJECT}`, owner)).body.lanes[0];
  assert.equal(lane.in_flight, 9);
  assert.equal(lane.over_limit, false);
});

test('cards with no lane and cards naming a deleted lane are both reported', async () => {
  const db = freshDb();
  const e = env(db);
  addCard(db, PROJECT, 'Homeless', 'in_progress', null);
  addCard(db, PROJECT, 'Orphan', 'in_progress', 'Deleted lane');
  const view = (await call(e, 'GET', `/${PROJECT}`, owner)).body;
  assert.equal(view.unassigned_cards, 1);
  // NOT HIDDEN. A card nobody can see is worse than a lane nobody configured.
  assert.deepEqual(view.orphan_lanes, ['Deleted lane']);
  assert.equal(view.cards.length, 2);
});

test('the read returns the card fields the artboard has columns for, including the lane', async () => {
  const db = freshDb();
  const e = env(db);
  addCard(db, PROJECT, 'Handoff schema', 'in_progress', null, OWNER);
  const card = (await call(e, 'GET', `/${PROJECT}`, owner)).body.cards[0];
  for (const field of ['id', 'title', 'status', 'lane', 'assigned_to', 'updated_at']) {
    assert.ok(field in card, `the read drops ${field}, which the board's table has a column for`);
  }
  // `assigned_to` IS AN INTEGER USER ID, which is the whole reason `Mine` needed no
  // store: the registry's old reason said a card "records an owner name".
  assert.equal(card.assigned_to, OWNER);
  assert.equal(typeof card.assigned_to, 'number');
});

// ── the bulk move ─────────────────────────────────────────────────────────────

test('a bulk move sets the lane on every selected card', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'GTM' });
  const a = addCard(db, PROJECT, 'A', 'todo');
  const b = addCard(db, PROJECT, 'B', 'todo');
  const r = await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [a, b], lane: 'GTM' });
  assert.equal(r.status, 200);
  assert.equal(r.body.moved, 2);
  assert.deepEqual(cardLanes(db).map((c) => c.lane), ['GTM', 'GTM']);
});

test('lane: null clears the lane rather than leaving it alone', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'GTM' });
  const a = addCard(db, PROJECT, 'A', 'todo', 'GTM');
  const r = await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [a], lane: null });
  assert.equal(r.status, 200);
  // `if (lane)` WOULD MAKE THIS IMPOSSIBLE TO EXPRESS, which is why the field is
  // checked for presence rather than truthiness.
  assert.equal(cardLanes(db)[0].lane, null);
});

test('a bulk move that would break a WIP limit writes NOTHING and says by how much', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Eng', wip_limit: 2 });
  addCard(db, PROJECT, 'Already A', 'in_progress', 'Eng');
  addCard(db, PROJECT, 'Already B', 'in_progress', 'Eng');
  const c = addCard(db, PROJECT, 'Fifth card', 'in_progress');
  const r = await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [c], lane: 'Eng' });
  // THE ASSERTION THIS WHOLE ENDPOINT EXISTS FOR. "The limit is a configuration, not
  // a suggestion — the board refuses the fifth card."
  assert.equal(r.status, 409);
  assert.equal(r.body.moved, 0);
  assert.equal(r.body.lane, 'Eng');
  assert.equal(r.body.wip_limit, 2);
  assert.equal(r.body.would_be, 3);
  // And nothing moved — not even the cards that would have fitted.
  assert.equal(cardLanes(db).find((x) => x.id === c).lane, null);
});

test('a bulk move into a lane with NO limit is never refused', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Open', wip_limit: null });
  const ids = [];
  for (let i = 0; i < 12; i += 1) ids.push(addCard(db, PROJECT, `card ${i}`, 'in_progress'));
  const r = await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids, lane: 'Open' });
  // FOUND BY A MUTATION SWEEP. The read's `over_limit` was tested for a null limit
  // and the MOVE was not — and `total > null` is `total > 0` in JavaScript, so
  // dropping the `!= null` guard turns every unlimited lane into a lane that refuses
  // its first in-flight card. Twelve cards, because one would pass either way.
  assert.equal(r.status, 200);
  assert.equal(r.body.moved, 12);
  assert.equal(cardLanes(db).filter((c) => c.lane === 'Open').length, 12);
});

test('a move into a full lane is allowed when it lands in backlog', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Eng', wip_limit: 1 });
  addCard(db, PROJECT, 'Already', 'in_progress', 'Eng');
  const c = addCard(db, PROJECT, 'Next up', 'in_progress');
  const r = await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [c], lane: 'Eng', status: 'todo' });
  // THE CANVAS'S OWN SENTENCE, made possible: "the permissions card sits in backlog
  // rather than starting". A card can join a full lane as long as it is not started.
  assert.equal(r.status, 200);
  const moved = cardLanes(db).find((x) => x.id === c);
  assert.equal(moved.lane, 'Eng');
  assert.equal(moved.status, 'todo');
});

test('a card already in the lane is not counted twice', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Eng', wip_limit: 2 });
  const a = addCard(db, PROJECT, 'A', 'in_progress', 'Eng');
  const b = addCard(db, PROJECT, 'B', 'in_progress', 'Eng');
  // Re-filing two cards that are ALREADY in the lane. Counting them as incoming on
  // top of the existing two would report four and refuse a move that changes nothing.
  const r = await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [a, b], lane: 'Eng' });
  assert.equal(r.status, 200);
});

test('a bulk move into a lane that does not exist is refused', async () => {
  const db = freshDb();
  const e = env(db);
  const a = addCard(db, PROJECT, 'A', 'todo');
  const r = await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [a], lane: 'Imaginary' });
  assert.equal(r.status, 404);
  // Otherwise a bulk move creates the orphan state the read endpoint reports as a
  // problem.
  assert.equal(cardLanes(db)[0].lane, null);
});

test('a bulk move cannot touch another venture’s cards, even alongside your own', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Eng' });
  const mine = addCard(db, PROJECT, 'Mine', 'todo');
  const theirs = addCard(db, OTHER_PROJECT, 'Theirs', 'todo');
  const r = await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [mine, theirs], lane: 'Eng' });
  // 404 AND NOTHING MOVED, including the legitimate card. A bulk endpoint is the
  // easiest place to move another venture's cards by passing their ids alongside
  // your own, so the check counts the rows it found rather than trusting the list.
  assert.equal(r.status, 404);
  assert.deepEqual(cardLanes(db).map((c) => c.lane), [null, null]);
});

test('an unknown status is refused rather than stored', async () => {
  const db = freshDb();
  const e = env(db);
  const a = addCard(db, PROJECT, 'A', 'todo');
  const r = await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [a], status: 'marinating' });
  // The column allows free text, but a typo'd status makes a column of cards no
  // filter can find. The 400 carries the list that would work.
  assert.equal(r.status, 400);
  assert.ok(r.body.statuses.includes('in_progress'));
  assert.equal(cardLanes(db)[0].status, 'todo');
});

test('an empty selection, a huge one, and a no-op are each refused', async () => {
  const db = freshDb();
  const e = env(db);
  const a = addCard(db, PROJECT, 'A', 'todo');
  assert.equal((await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [], lane: null })).status, 400);
  assert.equal((await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: [a] })).status, 400);
  const many = Array.from({ length: 201 }, (_, i) => i + 1);
  assert.equal((await call(e, 'POST', `/${PROJECT}/cards/bulk`, owner, { ids: many, lane: null })).status, 400);
});

// ── access ────────────────────────────────────────────────────────────────────

test('a partner may read the board and may not configure it', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Eng' });
  assert.equal((await call(e, 'GET', `/${PROJECT}`, partner)).status, 200);
  assert.equal((await call(e, 'PUT', `/${PROJECT}/lanes`, partner, { name: 'Theirs' })).status, 403);
  assert.equal((await call(e, 'POST', `/${PROJECT}/cards/bulk`, partner, { ids: [1], lane: null })).status, 403);
});

test('an outsider cannot read or write another venture’s lanes', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'PUT', `/${PROJECT}/lanes`, owner, { name: 'Eng' });
  assert.equal((await call(e, 'GET', `/${PROJECT}`, outsider)).status, 403);
  assert.equal((await call(e, 'PUT', `/${PROJECT}/lanes`, outsider, { name: 'Theirs' })).status, 403);
});

// ── the placeholder claim ─────────────────────────────────────────────────────

test('the one SQL interpolation in this route is a bare placeholder string', () => {
  // `check-sql-prepare` has `placeholders` on record as safe. The argument is in the
  // route's own docblock; this is the part that HOLDS it, so the exception is not
  // resting on a paragraph.
  const m = /const placeholders = ([^;]+);/.exec(ROUTE_SRC);
  assert.ok(m, 'the placeholder builder changed shape');
  assert.equal(m[1].trim(), "ids.map(() => '?').join(',')");
  // And `ids` is numbers only by the time it is built.
  assert.match(ROUTE_SRC, /Number\.isFinite\(n\)\)\)\]/);
  // No interpolation anywhere in this file takes anything but `placeholders`.
  const interpolated = [...ROUTE_SRC.matchAll(/prepare\(\s*`[^`]*\$\{(\w+)\}/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(interpolated)], ['placeholders']);
});

test('the WIP status list in SQL matches the one in code', () => {
  // The exclusion list is written twice — once as `NOT_IN_FLIGHT` and once inside the
  // bulk endpoint's SQL, because `check-sql-prepare` exists to stop a set being built
  // into a statement. This is what keeps the copy from drifting.
  const set = /const NOT_IN_FLIGHT = new Set\(\[([^\]]+)\]\)/.exec(ROUTE_SRC);
  assert.ok(set, 'NOT_IN_FLIGHT changed shape');
  const fromCode = [...set[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  const sql = /lower\(status\) NOT IN \(([^)]+)\)/.exec(ROUTE_SRC);
  assert.ok(sql, 'the SQL exclusion list is gone');
  const fromSql = [...sql[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(fromSql, fromCode);
});
