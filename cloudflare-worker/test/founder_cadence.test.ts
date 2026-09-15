/**
 * `/build/cadence` gets a store, and the four figures above the archive are
 * counts rather than claims.
 *
 * WHAT THIS ZONE WAS BEFORE MIGRATION 250. `FounderBuildCadence` loaded the
 * project list and no second source. It printed "Cadence store unavailable",
 * four "Unavailable" stat cards and a three-row "Capability coverage" list; its
 * four filter chips and three ops were all registered `unbuilt`, which renders
 * nothing, so the artboard's toolbar shipped EMPTY. Task #176 is the third report
 * of it, and the user's words were "doesn't look at all like the one from the
 * artifact".
 *
 * THE ASSERTIONS THAT MATTER MOST ARE THE REFUSALS, and each of them is a figure
 * that would be easy to compute wrongly in the flattering direction:
 *
 *   · adherence over an empty archive is NULL, not 0% and not 100%;
 *   · an untimed retro is excluded from the average rather than counted as zero
 *     minutes — the `Number(null) === 0` trap #203 shipped once already;
 *   · `reviews archived` comes from its own aggregate, not from the page of rows
 *     the response carries, so a project past the LIMIT reports the true total;
 *   · filing the same date twice updates one row instead of adding a second,
 *     which is what keeps all three counts above honest.
 *
 * THE TABLES ARE BUILT BY APPLYING MIGRATION 250, never hand-written. A
 * hand-copied DDL is how a suite passes while production has a different schema,
 * which is exactly the failure #203 was.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import founderCadence, { CADENCE_VIEWS, RITUAL_KINDS } from '../src/routes/founder_cadence.ts';
import { CADENCE_DDL } from '../src/services/cadenceSchema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const MIGRATION = readFileSync(`${SQL}/migrations/250_project_cadence.sql`, 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OWNER = 70;
const OTHER_FOUNDER = 71;
const PARTNER = 72;
const ADMIN = 73;
const INVESTOR = 74;
const PROJECT = 9101;
const OTHER_PROJECT = 9102;

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

/** The migration, statement by statement, exactly as `migrate-d1` would. */
function applyMigration(db: InstanceType<typeof DatabaseSync>) {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, '');
  for (const stmt of sql.split(';')) if (stmt.trim()) db.exec(stmt);
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
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, founder_id INTEGER, sector TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?,?,?)');
  u.run(OWNER, 'founder', OWNER);
  u.run(OTHER_FOUNDER, 'founder', OTHER_FOUNDER);
  u.run(PARTNER, 'partner', null);
  u.run(ADMIN, 'admin', null);
  u.run(INVESTOR, 'investor', null);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id, sector) VALUES (?,?,?,?)');
  p.run(PROJECT, 'Bellwether', OWNER, 'B2B SaaS');
  p.run(OTHER_PROJECT, 'Somebody else', OTHER_FOUNDER, 'Fintech');
  if (withMigration) applyMigration(db);
  return db;
}

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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await founderCadence.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const owner = { user: OWNER, role: 'founder' };
const outsider = { user: OTHER_FOUNDER, role: 'founder' };
const partner = { user: PARTNER, role: 'partner' };
const admin = { user: ADMIN, role: 'admin' };
const investor = { user: INVESTOR, role: 'investor' };

/** A ritual, and its id. */
async function newRitual(e: any, over: Record<string, unknown> = {}): Promise<number> {
  const r = await call(e, 'POST', `/${PROJECT}/rituals`, owner, {
    name: 'Friday retro', kind: 'retro', frequency: 'weekly', weekday: 5, target_minutes: 30, ...over,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return Number(r.body.id);
}

// ── the migration ─────────────────────────────────────────────────────────────

test('the migration carries no transaction statement, which D1 rejects', () => {
  const code = MIGRATION.replace(/^\s*--.*$/gm, '');
  for (const kw of ['BEGIN', 'COMMIT', 'ROLLBACK', 'END TRANSACTION']) {
    assert.ok(!new RegExp(`\\b${kw}\\b`, 'i').test(code),
      `migration 250 contains ${kw} — D1 rejects it, as migration 200 found`);
  }
});

test('all three tables land, with the columns the four stat cards are computed from', () => {
  const db = freshDb();
  const cols = (t: string) => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((r) => r.name));
  for (const c of ['project_id', 'name', 'kind', 'frequency', 'weekday', 'target_minutes', 'active']) {
    assert.ok(cols('project_rituals').has(c), `project_rituals is missing ${c}`);
  }
  // `duration_minutes` is the average retro length and `state` is adherence;
  // without either, two of the four cards cannot be computed at all.
  for (const c of ['ritual_id', 'run_date', 'state', 'outcome', 'duration_minutes']) {
    assert.ok(cols('ritual_runs').has(c), `ritual_runs is missing ${c}`);
  }
  // `edited_at` is "1 customised" — the count that would otherwise have to be a
  // stored boolean.
  for (const c of ['body', 'based_on', 'edited_at']) {
    assert.ok(cols('ritual_templates').has(c), `ritual_templates is missing ${c}`);
  }
});

test('the runtime bootstrap and the migration declare the same columns', () => {
  // WHY THIS TEST IS THE PRICE OF THE SECOND COPY. `cadenceSchema.ts` carries
  // the DDL again because a Worker cannot read the .sql file, and a second copy
  // of a schema is only safe while something compares them.
  const fromMigration = freshDb();
  const fromBootstrap = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  for (const stmt of CADENCE_DDL) fromBootstrap.exec(stmt);
  for (const t of ['project_rituals', 'ritual_runs', 'ritual_templates']) {
    const a = (fromMigration.prepare(`PRAGMA table_info(${t})`).all() as any[])
      .map((r) => `${r.name}:${String(r.type).toUpperCase()}`).sort();
    const b = (fromBootstrap.prepare(`PRAGMA table_info(${t})`).all() as any[])
      .map((r) => `${r.name}:${String(r.type).toUpperCase()}`).sort();
    assert.deepEqual(b, a, `${t} differs between migration 250 and cadenceSchema.ts`);
  }
});

test('the route bootstraps its own tables when the migration has not run', async () => {
  // A preview Worker, a dev SQLite file, or a D1 whose ledger has drifted.
  const e = env(freshDb(false));
  const r = await call(e, 'GET', `/${PROJECT}`, owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.store_ready, true);
  assert.deepEqual(r.body.runs, []);
});

// ── the four figures ──────────────────────────────────────────────────────────

test('an empty archive reports NULL adherence, not 0% and not 100%', async () => {
  const e = env(freshDb());
  await newRitual(e);
  const r = (await call(e, 'GET', `/${PROJECT}`, owner)).body;
  assert.equal(r.stats.runs_recorded, 0);
  // THE ASSERTION THIS WHOLE FIGURE EXISTS FOR. `done / (done + missed)` over
  // zero rows is 0/0; returning 0 would tell a founder who has filed nothing
  // that they adhere to nothing, and returning 100 would congratulate them for
  // it. Neither is a reading of the archive.
  assert.equal(r.stats.adherence_pct, null);
  assert.equal(r.stats.done, 0);
  assert.equal(r.stats.missed, 0);
  assert.equal(r.stats.avg_retro_minutes, null);
  // AND NO TEST CAN PROVE THE GUARD IS THERE, which is worth saying rather than
  // leaving for the next person to discover. Removing `decided > 0` computes
  // `Math.round((0 / 0) * 100)` = NaN, and `JSON.stringify({ a: NaN })` is
  // `{"a":null}` — verified against node, not assumed. So the mutation produces a
  // byte-identical response and this assertion cannot distinguish it: an
  // equivalent mutant, not an escape. The guard stays because the next reader of
  // `stats` may not be JSON, and because NaN arriving in a percentage is the kind
  // of thing that surfaces three layers away from its cause.
});

test('adherence is done over done-plus-missed, and the denominator is returned with it', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  for (const [d, state] of [['2026-08-07', 'done'], ['2026-08-14', 'missed'],
    ['2026-08-21', 'done'], ['2026-08-28', 'done']] as const) {
    const r = await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: d, state });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const s = (await call(e, 'GET', `/${PROJECT}`, owner)).body.stats;
  assert.equal(s.done, 3);
  assert.equal(s.missed, 1);
  assert.equal(s.adherence_pct, 75);
  assert.equal(s.runs_recorded, 4);
});

test('an untimed retro is excluded from the average, not counted as zero minutes', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  // 20 and 30 recorded; two runs with no duration at all. The average of the
  // recorded pair is 25. If a blank arrives as `Number('') === 0` — the trap
  // #203 shipped in `metricPointsFrom` — the average becomes 12 or 13 and looks
  // entirely plausible.
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: '2026-08-07', duration_minutes: 20 });
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: '2026-08-14', duration_minutes: 30 });
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: '2026-08-21', duration_minutes: '' });
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: '2026-08-28' });
  const s = (await call(e, 'GET', `/${PROJECT}`, owner)).body.stats;
  assert.equal(s.avg_retro_minutes, 25);
  assert.equal(s.retro_target_minutes, 30);
  // All four are still in the archive — excluded from the AVERAGE, not dropped.
  assert.equal(s.runs_recorded, 4);
});

test('a missed retro is excluded from the average length even when it carries one', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: '2026-08-07', duration_minutes: 30 });
  await call(e, 'POST', `/${PROJECT}/runs`, owner, {
    ritual_id: id, run_date: '2026-08-14', state: 'missed', duration_minutes: 2,
  });
  const s = (await call(e, 'GET', `/${PROJECT}`, owner)).body.stats;
  // A two-minute meeting that did not happen is not a two-minute retro.
  assert.equal(s.avg_retro_minutes, 30);
});

test('a target that is set is reported even when no retro has been timed', async () => {
  const e = env(freshDb());
  await newRitual(e, { name: 'Friday retro', kind: 'retro', target_minutes: 30 });
  const s = (await call(e, 'GET', `/${PROJECT}`, owner)).body.stats;
  // FOUND BY A MUTATION SWEEP. Reading the target from the AVERAGE's row set
  // meant a retro with no timed run contributed no target either — so a founder
  // who had set "target 30" read "No target set" on the card, which is the
  // platform denying something they did. The target is a property of the ritual;
  // the average is a property of its timed runs.
  assert.equal(s.avg_retro_minutes, null);
  assert.equal(s.retro_target_minutes, 30);
});

test('only a retro ritual’s target counts as the retro target', async () => {
  const e = env(freshDb());
  await newRitual(e, { name: 'Standup', kind: 'standup', target_minutes: 90 });
  const s = (await call(e, 'GET', `/${PROJECT}`, owner)).body.stats;
  // 90 here would put a standup's target under "Avg retro length".
  assert.equal(s.retro_target_minutes, null);
});

test('only retro rituals feed the average retro length', async () => {
  const e = env(freshDb());
  const retro = await newRitual(e, { name: 'Friday retro', kind: 'retro', target_minutes: 30 });
  const standup = await newRitual(e, { name: 'Standup', kind: 'standup', target_minutes: 10 });
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: retro, run_date: '2026-08-07', duration_minutes: 40 });
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: standup, run_date: '2026-08-07', duration_minutes: 5 });
  const s = (await call(e, 'GET', `/${PROJECT}`, owner)).body.stats;
  // 40, not 22.5 — a five-minute standup averaged into "avg retro length" is the
  // card lying about which rows it read.
  assert.equal(s.avg_retro_minutes, 40);
});

test('reviews archived is the true total, not the page of rows the response carries', async () => {
  const db = freshDb();
  const e = env(db);
  const id = await newRitual(e);
  // 501 runs, inserted straight into the fixture because the point is VOLUME and
  // 501 HTTP calls would make this test the slowest in the suite. Dates count
  // down from 2026-08-21 so they are distinct and the newest is first.
  const ins = db.prepare(
    'INSERT INTO ritual_runs (project_id, ritual_id, run_date, state) VALUES (?,?,?,?)',
  );
  const day = (n: number) => new Date(Date.UTC(2026, 7, 21) - n * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < 501; i += 1) ins.run(PROJECT, id, day(i), 'done');

  const view = (await call(e, 'GET', `/${PROJECT}`, owner)).body;
  // The archive is capped so a Worker's memory envelope stays predictable…
  assert.equal(view.runs.length, 500);
  // …and the COUNT is its own aggregate, so the card above it reports 501. A
  // count taken from `runs.length` would be correct on every account with fewer
  // than 500 reviews and quietly stuck at 500 for the ones that have most.
  assert.equal(view.stats.runs_recorded, 501);
  assert.equal(view.stats.done, 501);
  assert.equal(view.stats.adherence_pct, 100);
});

test('the template count and its customised half come from edited_at', async () => {
  const e = env(freshDb());
  const a = await call(e, 'POST', `/${PROJECT}/templates`, owner, {
    name: 'Friday retro', kind: 'retro', body: 'What landed?', based_on: 'retro',
  });
  await call(e, 'POST', `/${PROJECT}/templates`, owner, { name: 'Standup', kind: 'standup', body: 'What moved?' });
  let s = (await call(e, 'GET', `/${PROJECT}`, owner)).body.stats;
  assert.equal(s.templates, 2);
  assert.equal(s.templates_customised, 0);

  await call(e, 'PUT', `/templates/${a.body.id}`, owner, { body: 'What landed, and what carried?' });
  s = (await call(e, 'GET', `/${PROJECT}`, owner)).body.stats;
  assert.equal(s.templates, 2);
  assert.equal(s.templates_customised, 1);
});

test('based_on only takes a starter that exists', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', `/${PROJECT}/templates`, owner, {
    name: 'Mine', body: 'Whatever', based_on: 'not-a-starter',
  });
  assert.equal(r.status, 201);
  // NULL rather than the string. "Derived from `not-a-starter`" is a claim about
  // a template that does not exist, and it would make the customised count
  // unreadable the moment anyone tried to explain it.
  assert.equal(r.body.based_on, null);
});

// ── one run per ritual per date ───────────────────────────────────────────────

test('filing the same date twice updates the row instead of adding a second', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  await call(e, 'POST', `/${PROJECT}/runs`, owner, {
    ritual_id: id, run_date: '2026-08-21', outcome: 'Split the digest card.', duration_minutes: 22,
  });
  const again = await call(e, 'POST', `/${PROJECT}/runs`, owner, {
    ritual_id: id, run_date: '2026-08-21', outcome: 'Split the digest card. Owner: Rin.', duration_minutes: 24,
  });
  assert.equal(again.status, 201);
  const view = (await call(e, 'GET', `/${PROJECT}`, owner)).body;
  // ONE row, and the later text won. Two rows here would inflate every figure
  // above the archive — reviews archived, adherence, average length — in the
  // direction that flatters, from a double-submit.
  assert.equal(view.runs.length, 1);
  assert.equal(view.stats.runs_recorded, 1);
  assert.equal(view.runs[0].outcome, 'Split the digest card. Owner: Rin.');
  assert.equal(view.runs[0].duration_minutes, 24);
});

test('two rituals may both run on the same date', async () => {
  const e = env(freshDb());
  const plan = await newRitual(e, { name: 'Monday plan', kind: 'plan', weekday: 1 });
  const standup = await newRitual(e, { name: 'Standup', kind: 'standup', weekday: 1 });
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: plan, run_date: '2026-08-17' });
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: standup, run_date: '2026-08-17' });
  const view = (await call(e, 'GET', `/${PROJECT}`, owner)).body;
  // The unique index is `(ritual_id, run_date)` and not `(project_id, run_date)`.
  // Keyed on the project it would make a Monday plan and a Monday standup
  // mutually exclusive, which is most founders' actual Monday.
  assert.equal(view.runs.length, 2);
});

// ── the archive and its filters ───────────────────────────────────────────────

test('the archive is newest first and carries the ritual name and kind', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  // Inserted in ASCENDING date order so a last-row-wins ordering bug — the exact
  // escape #175's `last_mention_at` had — cannot pass by coincidence.
  for (const d of ['2026-08-07', '2026-08-14', '2026-08-21']) {
    await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: d });
  }
  const runs = (await call(e, 'GET', `/${PROJECT}`, owner)).body.runs;
  assert.deepEqual(runs.map((r: any) => r.run_date), ['2026-08-21', '2026-08-14', '2026-08-07']);
  assert.equal(runs[0].ritual_name, 'Friday retro');
  assert.equal(runs[0].ritual_kind, 'retro');
});

test("the four filter views agree with the page's own predicates", async () => {
  // The server exports `CADENCE_VIEWS` and `lib/cadence.js` holds the predicate
  // functions under the same four keys. The keys are what the chips send.
  assert.deepEqual(Object.keys(CADENCE_VIEWS).sort(), ['all', 'plans', 'retros', 'skipped']);
  assert.equal(CADENCE_VIEWS.plans.kinds?.[0], 'plan');
  assert.equal(CADENCE_VIEWS.retros.kinds?.[0], 'retro');
  // `skipped` narrows on STATE and not kind — the canvas's filter row mixes two
  // axes, so a missed retro is in both `retros` and `skipped`.
  assert.equal(CADENCE_VIEWS.skipped.kinds, null);
  assert.equal(CADENCE_VIEWS.skipped.state, 'missed');
  assert.equal(CADENCE_VIEWS.all.kinds, null);
  assert.equal(CADENCE_VIEWS.all.state, null);
});

test('an unrecognised kind is stored as other rather than refused or invented', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', `/${PROJECT}/rituals`, owner, { name: 'Investor sync', kind: 'sync' });
  assert.equal(r.status, 201);
  // `other`, and NOT `retro`. A ritual coerced into `retro` would land in the
  // Retros filter and in the average retro length — a store that forces a wrong
  // answer gets wrong answers, which is why `other` exists.
  assert.equal(r.body.kind, 'other');
  assert.ok(RITUAL_KINDS.includes('other' as any));
});

// ── refusals ──────────────────────────────────────────────────────────────────

test('a weekday outside 0-6 is dropped rather than stored', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', `/${PROJECT}/rituals`, owner, { name: 'Whenever', weekday: 9 });
  assert.equal(r.body.weekday, null);
});

test('a blank weekday is not Sunday', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', `/${PROJECT}/rituals`, owner, { name: 'Monthly review', weekday: '' });
  // `Number('') === 0` and `Number.isFinite(0)`, so a coercion that ran before
  // the emptiness check would pin every undated ritual to Sunday. Index 0 IS
  // Sunday, which is what makes this silent.
  assert.equal(r.body.weekday, null);
});

test('a run needs a real YYYY-MM-DD', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  for (const bad of ['21 Aug 2026', '2026-8-7', '', 'today']) {
    const r = await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: bad });
    assert.equal(r.status, 400, `accepted ${JSON.stringify(bad)} as a date`);
  }
});

test('a run cannot be filed against another venture’s ritual', async () => {
  const e = env(freshDb());
  const mine = await newRitual(e);
  // The other founder's own ritual, created by them.
  const theirs = await call(e, 'POST', `/${OTHER_PROJECT}/rituals`, outsider, { name: 'Theirs' });
  assert.equal(theirs.status, 201);
  const r = await call(e, 'POST', `/${PROJECT}/runs`, owner, {
    ritual_id: Number(theirs.body.id), run_date: '2026-08-21',
  });
  // 404 and not 201. The row's `project_id` comes from the URL, so without this
  // check a founder could file a run that appears in ANOTHER venture's archive —
  // or here, claim their own project owns a ritual it does not.
  assert.equal(r.status, 404);
  assert.ok(mine > 0);
});

test('an outsider cannot read or write another venture’s cadence', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  assert.equal((await call(e, 'GET', `/${PROJECT}`, outsider)).status, 403);
  assert.equal((await call(e, 'POST', `/${PROJECT}/rituals`, outsider, { name: 'Theirs' })).status, 403);
  assert.equal((await call(e, 'PUT', `/rituals/${id}`, outsider, { name: 'Renamed' })).status, 403);
  assert.equal((await call(e, 'DELETE', `/rituals/${id}`, outsider)).status, 403);
});

test('an investor cannot read it at all', async () => {
  const e = env(freshDb());
  await newRitual(e);
  // The IDOR contract excludes investors from founder-side records, and
  // `canReadBoard` is the predicate — imported rather than re-derived, so this
  // holds for the same reason Validate's does.
  assert.equal((await call(e, 'GET', `/${PROJECT}`, investor)).status, 403);
});

test('a partner may read the archive and may not write to it', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: '2026-08-21' });
  // Studio-wide staff read what the founder's interviews already let them read.
  assert.equal((await call(e, 'GET', `/${PROJECT}`, partner)).status, 200);
  // `canWrite` narrows to the venture's own and admins. A partner filing a
  // review into a founder's cadence would put a sentence in the archive that the
  // founder did not write and cannot tell apart from one they did.
  assert.equal((await call(e, 'PUT', `/rituals/${id}`, partner, { name: 'Renamed' })).status, 403);
  assert.equal((await call(e, 'POST', `/${PROJECT}/runs`, partner, { ritual_id: id, run_date: '2026-08-28' })).status, 403);
});

test('an admin may write', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  assert.equal((await call(e, 'PUT', `/rituals/${id}`, admin, { name: 'Retro' })).status, 200);
});

test('a ritual needs a name and a template needs a body', async () => {
  const e = env(freshDb());
  assert.equal((await call(e, 'POST', `/${PROJECT}/rituals`, owner, { name: '   ' })).status, 400);
  assert.equal((await call(e, 'POST', `/${PROJECT}/templates`, owner, { name: 'Named', body: '  ' })).status, 400);
  assert.equal((await call(e, 'POST', `/${PROJECT}/templates`, owner, { body: 'Bodied' })).status, 400);
});

test('a run needs a ritual id', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', `/${PROJECT}/runs`, owner, { run_date: '2026-08-21' });
  assert.equal(r.status, 400);
});

// ── retiring, deleting, and what survives each ───────────────────────────────

test('retiring a ritual keeps its archive', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: '2026-08-21', outcome: 'Kept.' });
  assert.equal((await call(e, 'PUT', `/rituals/${id}`, owner, { active: false })).status, 200);
  const view = (await call(e, 'GET', `/${PROJECT}`, owner)).body;
  // THE ARCHIVE IS THE ZONE'S REASON TO EXIST, so deactivating must never
  // cascade. The ritual is still listed, marked inactive, and its review is
  // still readable.
  assert.equal(view.runs.length, 1);
  assert.equal(view.runs[0].outcome, 'Kept.');
  assert.equal(view.rituals.length, 1);
  assert.equal(view.rituals[0].active, 0);
  assert.equal(view.stats.runs_recorded, 1);
});

test('a partial edit does not null the fields it did not send', async () => {
  const e = env(freshDb());
  const id = await newRitual(e, { name: 'Friday retro', target_minutes: 30, weekday: 5 });
  await call(e, 'PUT', `/rituals/${id}`, owner, { name: 'Friday review' });
  const ritual = (await call(e, 'GET', `/${PROJECT}`, owner)).body.rituals[0];
  assert.equal(ritual.name, 'Friday review');
  // COALESCE, not a built-up SET list. A concatenated UPDATE over a partial body
  // is how a rename quietly erases a target and a weekday.
  assert.equal(ritual.target_minutes, 30);
  assert.equal(ritual.weekday, 5);
  assert.equal(ritual.kind, 'retro');
  // `active` IS THE ONE THAT FAILS SILENTLY. It is a tri-state on the wire —
  // true, false, or absent — and a handler that read it as a plain boolean would
  // retire the ritual on every rename, which looks like the rename working.
  assert.equal(ritual.active, 1);
});

test('a rename cannot un-retire a ritual either', async () => {
  const e = env(freshDb());
  const id = await newRitual(e);
  await call(e, 'PUT', `/rituals/${id}`, owner, { active: false });
  await call(e, 'PUT', `/rituals/${id}`, owner, { name: 'Still retired' });
  const ritual = (await call(e, 'GET', `/${PROJECT}`, owner)).body.rituals[0];
  // The other direction of the same tri-state: absent must mean "leave it", not
  // "set it to the default". A ritual that comes back to life on an unrelated
  // edit starts taking runs its founder did not intend to file.
  assert.equal(ritual.name, 'Still retired');
  assert.equal(ritual.active, 0);
});

test('deleting a ritual takes its runs, and deleting a template does not', async () => {
  const e = env(freshDb());
  const tpl = await call(e, 'POST', `/${PROJECT}/templates`, owner, { name: 'Retro', body: 'What landed?' });
  const id = await newRitual(e, { template_id: Number(tpl.body.id) });
  await call(e, 'POST', `/${PROJECT}/runs`, owner, { ritual_id: id, run_date: '2026-08-21' });

  await call(e, 'DELETE', `/templates/${tpl.body.id}`, owner);
  let view = (await call(e, 'GET', `/${PROJECT}`, owner)).body;
  // The ritual survives its template and stops claiming one, rather than
  // pointing at a row that is gone.
  assert.equal(view.rituals.length, 1);
  assert.equal(view.rituals[0].template_id, null);
  assert.equal(view.runs.length, 1);

  await call(e, 'DELETE', `/rituals/${id}`, owner);
  view = (await call(e, 'GET', `/${PROJECT}`, owner)).body;
  // A run with no ritual has no name and no kind: it would draw as a blank row
  // and match no filter. Deleting takes both; retiring is the path that keeps
  // the history, which is why both exist.
  assert.deepEqual(view.rituals, []);
  assert.deepEqual(view.runs, []);
  assert.equal(view.stats.runs_recorded, 0);
});

test('the starters are a constant list and not stored rows', async () => {
  const e = env(freshDb());
  const r = await call(e, 'GET', '/starters', owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.starters.length, 3);
  assert.deepEqual(r.body.starters.map((s: any) => s.slug), ['weekly-plan', 'standup', 'retro']);
  // NOTHING WAS SEEDED. A GET that writes cannot be retried safely, and a seeded
  // row is indistinguishable from one the founder wrote — which would make "1
  // customised" a statement about the platform rather than the venture.
  const view = (await call(e, 'GET', `/${PROJECT}`, owner)).body;
  assert.deepEqual(view.templates, []);
  assert.equal(view.stats.templates, 0);
});
