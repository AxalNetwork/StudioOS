/**
 * `/api/founder/roadmap` — the dependency graph, its four refusals, and scenarios.
 *
 * Against a real `node:sqlite` database built from `schema_baseline.sql` plus
 * migration 254, for the reason `_d1_sqlite.mjs` gives: a handler that would fail
 * on D1 because of an unknown column fails here too.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *        --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/roadmap_graph_route.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import founderRoadmap from '../src/routes/founder_roadmap.ts';
import { tableFromBaseline, wordInText, splitStatements } from './_baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const MIGRATION = readFileSync(`${SQL}/migrations/254_roadmap_dependencies.sql`, 'utf8');
const BASELINE = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8');
const ROUTE_SRC = readFileSync(resolve(HERE, '../src/routes/founder_roadmap.ts'), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 700;
const OUTSIDER = 701;
const PARTNER = 702;
const PROJECT = 9601;
const OTHER_PROJECT = 9602;

/**
 * A D1 face over an existing `node:sqlite` database.
 *
 * Local rather than `_d1_sqlite.mjs`'s `makeD1`, which takes DDL strings and
 * builds its own database — this fixture needs the one `freshDb` already seeded.
 * The two sibling founder suites carry the same adapter for the same reason.
 */
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  // `undefined` is not a bindable value and booleans are not a SQLite type;
  // node:sqlite throws on both where D1 coerces.
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
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

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  // `is_active` is not optional here: `getCurrentUser` returns null on a falsy
  // one, so a users table without it makes every request 401 — which surfaces as
  // a 500 through a router composed without `index.ts`'s error mapping, and
  // reads like a broken handler rather than a thin fixture.
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
    name TEXT, email TEXT, founder_id INTEGER, spinout_lab_active INTEGER
  );`);
  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER);');
  // The fixture is the schema production has, via the shared reader — never a
  // hand-copy. `roadmap_okrs` is where that rule was learned (#203, and again on
  // the first draft of `okr_move_log.test.ts`).
  db.exec(tableFromBaseline(BASELINE, 'roadmap_okrs'));
  for (const stmt of splitStatements(MIGRATION)) db.exec(stmt);

  const u = db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?,?,?)');
  u.run(OWNER, 'founder', OWNER);
  u.run(OUTSIDER, 'founder', OUTSIDER);
  u.run(PARTNER, 'partner', null);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?,?,?)');
  p.run(PROJECT, 'Bellwether', OWNER);
  p.run(OTHER_PROJECT, 'Somebody else', OUTSIDER);
  return db;
}

function addOkr(db: InstanceType<typeof DatabaseSync>, project: number, objective: string,
  status = 'next', quarter: string | null = null, sort = 0): number {
  db.prepare(
    'INSERT INTO roadmap_okrs (project_id, objective, kanban_status, quarter, sort_order) VALUES (?,?,?,?,?)',
  ).run(project, objective, status, quarter, sort);
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get()!.id);
}

/** The claim shape `auth.ts` actually reads: `user_id` and `role`, never `sub`. */
const ROLE_OF: Record<number, string> = { [OWNER]: 'founder', [OUTSIDER]: 'founder', [PARTNER]: 'partner' };

async function tokenFor(id: number) {
  return new SignJWT({ user_id: id, role: ROLE_OF[id] ?? 'founder' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * The same three lines `index.ts` attaches, and a test found out why they matter.
 *
 * `requireAuth` refuses by `throw new Error('Unauthorized')`; nothing in a
 * sub-router turns that into a status. Driving this router alone answers 500 for
 * a refusal that is 401 in production, so an assertion that accepted either would
 * be testing the harness rather than the gate. This file's own
 * anonymous-request case failed exactly that way before the mapping was attached.
 */
const AUTH_ERROR_STATUSES: Record<string, 401 | 403> = { Unauthorized: 401, Forbidden: 403 };

function appFor(db: InstanceType<typeof DatabaseSync>) {
  const app = new Hono();
  app.route('/api/founder/roadmap', founderRoadmap as never);
  app.onError((err: any, c) => {
    const mapped = AUTH_ERROR_STATUSES[(err?.message ?? '') as string];
    if (mapped) return c.json({ detail: err.message }, mapped);
    throw err;
  });
  const env = { DB: makeD1(db), JWT_SECRET, ENVIRONMENT: 'development' };
  return async (method: string, path: string, as: number | null, body?: unknown) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (as != null) headers.Authorization = `Bearer ${await tokenFor(as)}`;
    const res = await app.fetch(
      new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      env as never,
    );
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  };
}

// ── the migration ─────────────────────────────────────────────────────────────

test('migration 254 carries no transaction statement', () => {
  const code = MIGRATION.replace(/^\s*--.*$/gm, '');
  for (const kw of ['BEGIN', 'COMMIT', 'ROLLBACK', 'END TRANSACTION']) {
    assert.ok(!wordInText(code.toUpperCase(), kw), `migration 254 contains ${kw}`);
  }
});

test('one link per ordered pair, and the reverse pair is a different link', () => {
  const db = freshDb();
  const a = addOkr(db, PROJECT, 'A');
  const b = addOkr(db, PROJECT, 'B');
  const ins = db.prepare('INSERT INTO okr_dependencies (project_id, okr_id, blocks_okr_id) VALUES (?,?,?)');
  ins.run(PROJECT, a, b);
  assert.throws(() => ins.run(PROJECT, a, b), /UNIQUE/, 'the same link was stored twice');
  // The index is on the ORDERED pair, so the opposite direction is storable at
  // the schema level — which is exactly why the route has to refuse the cycle;
  // the table cannot.
  ins.run(PROJECT, b, a);
  const n = db.prepare('SELECT COUNT(*) AS n FROM okr_dependencies').get()!.n;
  assert.equal(Number(n), 2);
});

test('a scenario name is unique per project, and scenario items are unique per objective', () => {
  const db = freshDb();
  const s = db.prepare('INSERT INTO roadmap_scenarios (project_id, name) VALUES (?,?)');
  s.run(PROJECT, 'raise slips 6wk');
  assert.throws(() => s.run(PROJECT, 'raise slips 6wk'), /UNIQUE/);
  s.run(OTHER_PROJECT, 'raise slips 6wk');
  const id = Number(db.prepare('SELECT id FROM roadmap_scenarios WHERE project_id = ?').get(PROJECT)!.id);
  const i = db.prepare('INSERT INTO roadmap_scenario_items (scenario_id, okr_id, quarter) VALUES (?,?,?)');
  i.run(id, 1, 'Q4 2026');
  assert.throws(() => i.run(id, 1, 'Q1 2027'), /UNIQUE/, 'one objective got two quarters in one scenario');
});

// ── the read ──────────────────────────────────────────────────────────────────

test('the read returns every item with a state, and the blocked one says what blocks it', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'Handoff schema', 'now', 'Q3 2026', 0);
  const b = addOkr(db, PROJECT, 'Async digest', 'now', 'Q3 2026', 1);
  await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: a, blocks_okr_id: b });

  const res = await call('GET', `/api/founder/roadmap/${PROJECT}`, OWNER);
  assert.equal(res.status, 200);
  assert.equal(res.json.items.length, 2);
  const items = Object.fromEntries(res.json.items.map((i: any) => [i.objective, i]));
  assert.equal(items['Handoff schema'].state, 'in_flight');
  assert.equal(items['Handoff schema'].state_label, 'In flight');
  assert.deepEqual(items['Handoff schema'].blocks.map((x: any) => x.objective), ['Async digest']);
  assert.equal(items['Async digest'].state, 'blocked');
  assert.equal(items['Async digest'].state_label, 'Blocked');
  // BOTH DIRECTIONS ARE RETURNED, because the artboard draws `Blocks` and the
  // founder needs `blocked_by` to know what to go and clear.
  assert.deepEqual(items['Async digest'].blocked_by.map((x: any) => x.objective), ['Handoff schema']);
  assert.equal(res.json.stats.dependencies, 1);
  assert.equal(res.json.stats.unresolved, 1);
  assert.equal(res.json.stats.blocked, 1);
});

test('marking the blocker done resolves the link and frees the item', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A', 'now');
  const b = addOkr(db, PROJECT, 'B', 'now');
  await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: a, blocks_okr_id: b });
  db.prepare("UPDATE roadmap_okrs SET kanban_status = 'done' WHERE id = ?").run(a);

  const res = await call('GET', `/api/founder/roadmap/${PROJECT}`, OWNER);
  const items = Object.fromEntries(res.json.items.map((i: any) => [i.objective, i]));
  assert.equal(items.B.state, 'in_flight', 'the item stayed blocked by a finished objective');
  assert.equal(res.json.stats.unresolved, 0, 'a resolved link still counted as unresolved');
  assert.equal(res.json.stats.dependencies, 1, 'the link itself disappeared when it resolved');
  assert.equal(res.json.dependencies[0].resolved, true);
});

test('the read is scoped: another venture\'s links are not in this one', async () => {
  const db = freshDb();
  const call = appFor(db);
  const mine = addOkr(db, PROJECT, 'Mine');
  const mine2 = addOkr(db, PROJECT, 'Mine two');
  const theirs = addOkr(db, OTHER_PROJECT, 'Theirs');
  const theirs2 = addOkr(db, OTHER_PROJECT, 'Theirs two');
  await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: mine, blocks_okr_id: mine2 });
  await call('POST', `/api/founder/roadmap/${OTHER_PROJECT}/dependencies`, OUTSIDER, { okr_id: theirs, blocks_okr_id: theirs2 });

  const res = await call('GET', `/api/founder/roadmap/${PROJECT}`, OWNER);
  assert.equal(res.json.items.length, 2);
  assert.equal(res.json.dependencies.length, 1);
  assert.equal(res.json.dependencies[0].from_objective, 'Mine');
});

test('an outsider is refused the read; a partner is allowed it', async () => {
  const db = freshDb();
  const call = appFor(db);
  addOkr(db, PROJECT, 'A');
  assert.equal((await call('GET', `/api/founder/roadmap/${PROJECT}`, OUTSIDER)).status, 403);
  assert.equal((await call('GET', `/api/founder/roadmap/${PROJECT}`, PARTNER)).status, 200);
  assert.equal((await call('GET', `/api/founder/roadmap/${PROJECT}`, null)).status, 401);
});

test('an empty roadmap reads as empty rather than as an error', async () => {
  const db = freshDb();
  const call = appFor(db);
  const res = await call('GET', `/api/founder/roadmap/${PROJECT}`, OWNER);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.items, []);
  assert.deepEqual(res.json.dependencies, []);
  assert.deepEqual(res.json.scenarios, []);
  assert.equal(res.json.stats.items, 0);
  assert.equal(res.json.store_ready, true);
});

// ── the four refusals ─────────────────────────────────────────────────────────

test('an objective cannot block itself', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A');
  const res = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: a, blocks_okr_id: a });
  assert.equal(res.status, 400);
  assert.match(res.json.detail, /cannot block itself/);
});

test('both ends must be on this roadmap — a cross-project link is refused', async () => {
  const db = freshDb();
  const call = appFor(db);
  const mine = addOkr(db, PROJECT, 'Mine');
  const theirs = addOkr(db, OTHER_PROJECT, 'Theirs');
  // THE SCOPING HOLE THIS CLOSES: without it a founder could name another
  // venture's objective id and learn, from the link being accepted, that it
  // exists.
  const res = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: mine, blocks_okr_id: theirs });
  assert.equal(res.status, 400);
  assert.match(res.json.detail, /on this roadmap/);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM okr_dependencies').get()!.n), 0);
});

test('the same link twice is refused, and the first one survives', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A');
  const b = addOkr(db, PROJECT, 'B');
  const first = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: a, blocks_okr_id: b });
  assert.equal(first.status, 201);
  const again = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: a, blocks_okr_id: b });
  assert.equal(again.status, 409);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM okr_dependencies').get()!.n), 1);
});

test('a cycle is refused at one hop and at three, and nothing is written', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A');
  const b = addOkr(db, PROJECT, 'B');
  const c = addOkr(db, PROJECT, 'C');
  await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: a, blocks_okr_id: b });
  const back = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: b, blocks_okr_id: a });
  assert.equal(back.status, 409);
  assert.equal(back.json.cycle, true);

  await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: b, blocks_okr_id: c });
  const loop = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: c, blocks_okr_id: a });
  assert.equal(loop.status, 409, 'a three-item loop was stored');
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM okr_dependencies').get()!.n), 2);
  // AND THE PAGE STILL RENDERS: a cycle in the table would make the state walk
  // meaningless, so the refusal is what keeps the read honest.
  const res = await call('GET', `/api/founder/roadmap/${PROJECT}`, OWNER);
  assert.equal(res.status, 200);
});

test('a diamond is not a cycle — the commonest real shape is storable', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A');
  const b = addOkr(db, PROJECT, 'B');
  const c = addOkr(db, PROJECT, 'C');
  const d = addOkr(db, PROJECT, 'D');
  for (const [from, to] of [[a, b], [a, c], [b, d], [c, d]]) {
    const r = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: from, blocks_okr_id: to });
    assert.equal(r.status, 201, `${from}→${to} was refused`);
  }
  const res = await call('GET', `/api/founder/roadmap/${PROJECT}`, OWNER);
  assert.equal(res.json.stats.dependencies, 4);
});

test('a missing or blank id is a 400, not a link to objective zero', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A');
  // `Number('')` and `Number(null)` are both 0 and both finite. Zero is not an
  // OKR id, so a blank that coerced first would reach "not on this roadmap" for
  // a field the caller simply left empty.
  for (const body of [{}, { okr_id: a }, { okr_id: a, blocks_okr_id: '' }, { okr_id: null, blocks_okr_id: a }]) {
    const res = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} was not refused`);
    assert.match(res.json.detail, /required/);
  }
});

test('an outsider cannot write a link, and a partner cannot either', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A');
  const b = addOkr(db, PROJECT, 'B');
  for (const who of [OUTSIDER, PARTNER]) {
    const res = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, who, { okr_id: a, blocks_okr_id: b });
    assert.equal(res.status, 403, `user ${who} wrote a link on somebody else's roadmap`);
  }
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM okr_dependencies').get()!.n), 0);
});

test('deleting a link frees the item and refuses a stranger', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A', 'now');
  const b = addOkr(db, PROJECT, 'B', 'now');
  const made = await call('POST', `/api/founder/roadmap/${PROJECT}/dependencies`, OWNER, { okr_id: a, blocks_okr_id: b });
  const id = made.json.id;
  assert.equal((await call('DELETE', `/api/founder/roadmap/dependencies/${id}`, OUTSIDER)).status, 403);
  assert.equal((await call('DELETE', `/api/founder/roadmap/dependencies/${id}`, OWNER)).status, 200);
  const res = await call('GET', `/api/founder/roadmap/${PROJECT}`, OWNER);
  assert.equal(res.json.stats.dependencies, 0);
  assert.equal(res.json.items.find((i: any) => i.objective === 'B').state, 'in_flight');
  assert.equal((await call('DELETE', `/api/founder/roadmap/dependencies/${id}`, OWNER)).status, 404);
});

// ── scenarios ─────────────────────────────────────────────────────────────────

test('a scenario saves, and reports only the items it actually moves', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'Handoff schema', 'now', 'Q3 2026');
  const b = addOkr(db, PROJECT, 'Slack integration', 'next', 'Q4 2026');
  const res = await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, {
    name: 'raise slips 6wk',
    note: 'if the round closes late',
    items: [{ okr_id: a, quarter: 'Q4 2026' }, { okr_id: b, quarter: 'Q4 2026' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.items, 2);
  // `b` was already Q4, so the scenario moves ONE item even though it names two.
  assert.equal(res.json.moves, 1);

  const read = await call('GET', `/api/founder/roadmap/${PROJECT}`, OWNER);
  assert.equal(read.json.scenarios.length, 1);
  assert.equal(read.json.scenarios[0].name, 'raise slips 6wk');
  assert.equal(read.json.scenarios[0].moves_count, 1);
  assert.deepEqual(read.json.scenarios[0].moves, [
    { okr_id: a, from: 'Q3 2026', to: 'Q4 2026', objective: 'Handoff schema' },
  ]);
  assert.equal(read.json.stats.scenarios, 1);
});

test('saving a scenario again replaces its items rather than merging them', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A', 'now', 'Q3 2026');
  const b = addOkr(db, PROJECT, 'B', 'now', 'Q3 2026');
  const made = await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, {
    name: 'slip', items: [{ okr_id: a, quarter: 'Q4 2026' }, { okr_id: b, quarter: 'Q4 2026' }],
  });
  const again = await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, {
    id: made.json.id, name: 'slip', items: [{ okr_id: a, quarter: 'Q1 2027' }],
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.items, 1, 'the removed objective is still in the scenario');
  const read = await call('GET', `/api/founder/roadmap/${PROJECT}`, OWNER);
  assert.deepEqual(read.json.scenarios[0].moves.map((m: any) => m.to), ['Q1 2027']);
});

test('a scenario needs a name, and two by one name on one venture is a 409', async () => {
  const db = freshDb();
  const call = appFor(db);
  assert.equal((await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, { items: [] })).status, 400);
  assert.equal((await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, { name: '   ' })).status, 400);
  assert.equal((await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, { name: 'one' })).status, 201);
  assert.equal((await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, { name: 'one' })).status, 409);
  // The same name on a DIFFERENT venture is a different scenario.
  assert.equal((await call('PUT', `/api/founder/roadmap/${OTHER_PROJECT}/scenarios`, OUTSIDER, { name: 'one' })).status, 201);
});

test('a scenario may only move objectives on its own roadmap', async () => {
  const db = freshDb();
  const call = appFor(db);
  addOkr(db, PROJECT, 'Mine');
  const theirs = addOkr(db, OTHER_PROJECT, 'Theirs');
  const res = await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, {
    name: 'reach', items: [{ okr_id: theirs, quarter: 'Q4 2026' }],
  });
  assert.equal(res.status, 400);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM roadmap_scenarios').get()!.n), 0,
    'the scenario row survived a refused item list');
});

test('one venture cannot edit or delete another venture\'s scenario', async () => {
  const db = freshDb();
  const call = appFor(db);
  const made = await call('PUT', `/api/founder/roadmap/${OTHER_PROJECT}/scenarios`, OUTSIDER, { name: 'theirs' });
  const id = made.json.id;
  // Named through MY project's path, so the ownership check is the only thing
  // standing between the caller and somebody else's row.
  const res = await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, { id, name: 'stolen' });
  assert.equal(res.status, 403);
  assert.equal((await call('DELETE', `/api/founder/roadmap/scenarios/${id}`, OWNER)).status, 403);
  const still = db.prepare('SELECT name FROM roadmap_scenarios WHERE id = ?').get(id) as { name: string };
  assert.equal(still.name, 'theirs');
});

test('deleting a scenario takes its item rows with it', async () => {
  const db = freshDb();
  const call = appFor(db);
  const a = addOkr(db, PROJECT, 'A', 'now', 'Q3 2026');
  const made = await call('PUT', `/api/founder/roadmap/${PROJECT}/scenarios`, OWNER, {
    name: 'slip', items: [{ okr_id: a, quarter: 'Q4 2026' }],
  });
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM roadmap_scenario_items').get()!.n), 1);
  assert.equal((await call('DELETE', `/api/founder/roadmap/scenarios/${made.json.id}`, OWNER)).status, 200);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM roadmap_scenarios').get()!.n), 0);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM roadmap_scenario_items').get()!.n), 0,
    'the scenario went but its item rows stayed, so the next id to reuse that number inherits them');
});

// ── the shape of the route itself ─────────────────────────────────────────────

test('the readiness cache is keyed on the database, never a module-level boolean', () => {
  // The #203 bug, which this branch fixed and then nearly re-introduced twenty
  // lines from its own fix: one isolate serves requests that may carry different
  // bindings, so a boolean marks the schema ready for a database that has never
  // seen it.
  assert.match(ROUTE_SRC, /const GRAPH_READY = new WeakMap<object, boolean>\(\)/);
  // CASE-INSENSITIVE, because a mutation walked past the first version of this:
  // it looked for `[Rr]eady` and a flag named `GRAPH_READY_FLAG` sailed through.
  // And the bootstrap is read as well as the declaration — a WeakMap that is
  // declared and then not consulted is the same bug wearing the right shape.
  assert.ok(!/^\s*let\s+\w*ready\w*\s*=/mi.test(ROUTE_SRC),
    'a module-level readiness flag is back in founder_roadmap.ts');
  const boot = ROUTE_SRC.slice(ROUTE_SRC.indexOf('async function ensureGraphSchema'));
  const body = boot.slice(0, boot.indexOf('\n}\n'));
  assert.match(body, /GRAPH_READY\.get\(key\)/, 'the bootstrap stopped reading its per-database cache');
  assert.match(body, /GRAPH_READY\.set\(key, true\)/, 'the bootstrap stopped writing its per-database cache');
});

test('the route builds no SQL string out of a value', () => {
  // SCOPED TO SQL, and the first version was not — it scanned every template
  // literal in the file and failed on `${what} not found`, a 404 MESSAGE. A guard
  // that fires on prose is the one that gets deleted rather than fixed, so this
  // reads the argument of each `prepare(` instead. `check-sql-prepare` has the
  // repo-wide baseline; this pins the shape in the file most likely to grow a
  // bulk write.
  const prepares = [...ROUTE_SRC.matchAll(/\.prepare\(([\s\S]*?)\)\s*\n?\s*(?:\.bind|\)|,)/g)].map((m) => m[1]);
  assert.ok(prepares.length >= 8, `expected every prepared statement, found ${prepares.length}`);
  for (const sql of prepares) {
    assert.ok(!sql.includes('${'), `a prepared statement interpolates a value: ${sql.slice(0, 80)}`);
  }
});
