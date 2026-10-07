/**
 * D487 (#1025) — HQ's published games reach every branch as one set, and H18
 * reads back on how many branches each is live and the runs they recorded.
 *
 * Real SQLite on both tiers, with the assessment tables built by
 * `ensureAssessmentSchema` itself. HQ's push reaches a stand-in binding that
 * calls exactly `applyGames` over the branch's database.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/game_reach_d487.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { applyGames, branchGameHoldings } from '../src/rpc/branchOps.ts';
import { ensureAssessmentSchema } from '../src/services/assessmentSchema.ts';
import { normaliseGame, readGameHoldings, readPublishedGameSet } from '../src/services/gameLibrary.ts';
import content, { gameReachOf } from '../src/routes/admin_content.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
type Db = InstanceType<typeof DatabaseSync>;

const newDb = (): Db => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL DEFAULT 'founder', is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT)`);
  return db;
};
const branchEnv = (db: Db, code = 'fr') => ({ DB: d1Over(db), BRANCH_CODE: code }) as any;

/**
 * HQ's library: Founder Fit published (two chapters, three active questions
 * and one inactive, two archetypes), a draft and an archived game.
 */
async function hqDb(): Promise<Db> {
  const db = newDb();
  await ensureAssessmentSchema({ DB: d1Over(db) } as any);
  db.exec(`
    INSERT INTO assessment_games (id, slug, track, title, status, version, display_order, theme_json)
      VALUES (1, 'founder_fit', 'founder_origin_v1', 'Founder Fit', 'published', 3, 1, '{"c":"teal"}'),
             (2, 'lp_risk', 'thesis_lab_v1', 'LP Risk Profile', 'draft', 1, 2, '{}'),
             (3, 'old_game', 'mentor_compass_v1', 'Old Game', 'archived', 1, 3, '{}');
    INSERT INTO assessment_chapters (id, game_id, slug, title, display_order)
      VALUES (10, 1, 'origins', 'Origins', 1), (11, 1, 'pressure', 'Pressure', 2), (12, 2, 'lp1', 'LP one', 1);
    INSERT INTO assessment_items (game_id, chapter_id, slug, mechanic, prompt, options_json, display_order, is_active)
      VALUES (1, 10, 'ff_q1', 'dilemma', 'First?', '{"a":1}', 1, 1),
             (1, 10, 'ff_q2', 'sjt', 'Second?', '{}', 2, 1),
             (1, 11, 'ff_q3', 'speed', 'Third?', '{}', 1, 1),
             (1, 11, 'ff_retired', 'speed', 'Retired?', '{}', 2, 0),
             (2, 12, 'lp_q1', 'dilemma', 'Draft question?', '{}', 1, 1);
    INSERT INTO assessment_archetypes (game_id, track, slug, label, centroid_json, display_order)
      VALUES (1, 'founder_origin_v1', 'ff_builder', 'Builder', '{"x":1}', 1),
             (1, 'founder_origin_v1', 'ff_seller', 'Seller', '{}', 2),
             (2, 'thesis_lab_v1', 'lp_cautious', 'Cautious', '{}', 1);
  `);
  return db;
}

const count = (db: Db, sql: string, ...b: any[]) => Number((db.prepare(sql).get(...b) as any).n);

// ──────────────────────────────────────────────────────────── the set ──

test('HQ sends every published game whole, and nothing else', async () => {
  const set = await readPublishedGameSet({ DB: d1Over(await hqDb()) } as any);
  assert.deepEqual(set.map((g) => g.slug), ['founder_fit'], 'a draft or an archived game travelled');
  const ff = set[0];
  assert.equal(ff.version, 3);
  assert.equal(ff.theme_json, '{"c":"teal"}');
  assert.deepEqual(ff.chapters.map((c) => c.slug), ['origins', 'pressure']);
  assert.deepEqual(ff.items.map((i) => i.slug).sort(), ['ff_q1', 'ff_q2', 'ff_q3'], 'an inactive question travelled');
  assert.equal(ff.items.find((i) => i.slug === 'ff_q3')!.chapter_slug, 'pressure');
  assert.deepEqual(ff.archetypes.map((a) => a.slug), ['ff_builder', 'ff_seller']);
  assert.doesNotMatch(JSON.stringify(set), /"id"|game_id|chapter_id/, 'a row id travelled: ids are each database\'s own');
});

test('the boundary coerces: a question with no chapter that travelled is dropped, bad JSON is an empty object', () => {
  const g = normaliseGame({
    slug: 'g', track: 't', title: 'G', theme_json: '{oops',
    chapters: [{ slug: 'c1', title: 'C1' }],
    items: [
      { slug: 'i1', chapter_slug: 'c1', mechanic: 'sjt', prompt: 'P', options_json: 'not json' },
      { slug: 'i2', chapter_slug: 'missing', mechanic: 'sjt', prompt: 'P' },
    ],
    archetypes: [{ slug: 'a1', label: 'A1' }, { slug: '', label: 'nameless' }],
  })!;
  assert.equal(g.theme_json, '{}');
  assert.deepEqual(g.items.map((i) => i.slug), ['i1']);
  assert.equal(g.items[0].options_json, '{}');
  assert.deepEqual(g.archetypes.map((a) => a.slug), ['a1']);
  assert.equal(g.archetypes[0].track, 't', 'an archetype with no track takes its game\'s');
  assert.equal(normaliseGame({ slug: 'g', title: 'G' }), null, 'a game with no track is not a game');
});

// ──────────────────────────────────────────────────────────── a branch ──

test('a branch that never received a push holds none, and says so rather than failing', async () => {
  const fr = newDb();
  const h = await readGameHoldings(branchEnv(fr));
  assert.deepEqual(h, { received: false, games: [] });
  assert.equal(count(fr, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'assessment_games'`), 0,
    'the read created the table, which would turn "never received" into "holds none"');
});

test('a push stores the set; a later push updates it, retires a question, removes an archetype and archives a withdrawn game', async () => {
  const set = await readPublishedGameSet({ DB: d1Over(await hqDb()) } as any);
  const fr = newDb();
  const first = await applyGames(branchEnv(fr), { games: set, pushed_at: '2026-10-07T06:00:00Z' });
  assert.deepEqual(first, { ok: true, stored: 1, archived: 0, deactivated: 0, removed_archetypes: 0 });
  assert.equal(count(fr, `SELECT COUNT(*) AS n FROM assessment_items WHERE is_active = 1`), 3);
  assert.equal(count(fr, `SELECT COUNT(*) AS n FROM assessment_items it JOIN assessment_chapters ch ON ch.id = it.chapter_id
                           WHERE it.slug = 'ff_q3' AND ch.slug = 'pressure'`), 1, 'a question sat in the wrong chapter');

  // A member plays it on the branch.
  const gameId = Number((fr.prepare(`SELECT id FROM assessment_games WHERE slug = 'founder_fit'`).get() as any).id);
  fr.prepare(`INSERT INTO assessment_sessions (public_id, user_id, game_id, game_slug, status) VALUES ('s1', 5, ?, 'founder_fit', 'completed')`).run(gameId);
  fr.prepare(`INSERT INTO assessment_sessions (public_id, user_id, game_id, game_slug, status) VALUES ('s2', 6, ?, 'founder_fit', 'in_progress')`).run(gameId);

  // HQ edits: a new title, one question and one archetype gone, a new game.
  const ff = set[0];
  const second = await applyGames(branchEnv(fr), {
    pushed_at: '2026-10-07T07:00:00Z',
    games: [
      { ...ff, title: 'Founder Fit v4', version: 4, items: ff.items.filter((i) => i.slug !== 'ff_q2'), archetypes: ff.archetypes.filter((a) => a.slug !== 'ff_seller') },
      { ...ff, slug: 'advisor_arch', title: 'Advisor Archetype', chapters: [{ slug: 'a1', title: 'A1', description: null, display_order: 1 }],
        items: [{ ...ff.items[0], slug: 'aa_q1', chapter_slug: 'a1' }], archetypes: [] },
    ],
  });
  assert.deepEqual(second, { ok: true, stored: 2, archived: 0, deactivated: 1, removed_archetypes: 1 });
  assert.equal((fr.prepare(`SELECT title FROM assessment_games WHERE slug = 'founder_fit'`).get() as any).title, 'Founder Fit v4');
  assert.equal(Number((fr.prepare(`SELECT id FROM assessment_games WHERE slug = 'founder_fit'`).get() as any).id), gameId,
    'the game was re-created: a member\'s run would point at nothing');
  assert.equal(count(fr, `SELECT COUNT(*) AS n FROM assessment_items WHERE slug = 'ff_q2' AND is_active = 0`), 1, 'a retired question is kept, inactive');
  assert.equal(count(fr, `SELECT COUNT(*) AS n FROM assessment_archetypes WHERE slug = 'ff_seller'`), 0);

  const third = await applyGames(branchEnv(fr), { pushed_at: '2026-10-07T08:00:00Z', games: [] });
  assert.deepEqual(third, { ok: true, stored: 0, archived: 2, deactivated: 0, removed_archetypes: 0 },
    'an empty push is a real push: HQ publishes nothing');
  assert.equal(count(fr, `SELECT COUNT(*) AS n FROM assessment_games WHERE status = 'archived'`), 2);
  assert.equal(count(fr, `SELECT COUNT(*) AS n FROM assessment_games`), 2, 'a withdrawn game was deleted');

  const h = await readGameHoldings(branchEnv(fr));
  assert.equal(h.received, true);
  assert.deepEqual(h.games.find((g) => g.slug === 'founder_fit'), { slug: 'founder_fit', status: 'archived', version: 4, completions: 1 },
    'a withdrawn game keeps its runs; an unfinished run is not a completion');
});

test('a push that fails part-way leaves the previous games standing', async () => {
  const set = await readPublishedGameSet({ DB: d1Over(await hqDb()) } as any);
  const fr = newDb();
  await applyGames(branchEnv(fr), { games: set, pushed_at: 'a' });
  // The game's own upsert runs first in the batch; an archetype write after
  // it fails, so the title change must roll back with it.
  fr.exec(`CREATE TRIGGER boom BEFORE INSERT ON assessment_archetypes BEGIN SELECT RAISE(ABORT, 'boom'); END`);
  await assert.rejects(() => applyGames(branchEnv(fr), { games: [{ ...set[0], title: 'Changed' }], pushed_at: 'b' }));
  assert.equal((fr.prepare(`SELECT title FROM assessment_games WHERE slug = 'founder_fit'`).get() as any).title, 'Founder Fit',
    'half a push was written');
});

test('HQ\'s tier refuses both branch methods', async () => {
  const db = await hqDb();
  await assert.rejects(() => applyGames({ DB: d1Over(db) } as any, { games: [], pushed_at: 'x' }), /only live on a branch/);
  await assert.rejects(() => branchGameHoldings({ DB: d1Over(db) } as any), /only live on a branch/);
});

// ──────────────────────────────────────────────────────────────── HQ ──

test('reach: live where held as published; completions withheld when a branch could not read its runs', () => {
  const ok = (code: string, holdings: any) => ({ code, binding: '', status: 'ok' as const, data: { holdings } });
  const results: any[] = [
    ok('fr', { received: true, games: [{ slug: 'g', status: 'published', version: 1, completions: 4 }] }),
    ok('it', { received: true, games: [{ slug: 'g', status: 'archived', version: 1, completions: 2 }] }),
    ok('es', { received: false, games: [] }),
    { code: 'de', binding: '', status: 'unreadable', reason: 'down' },
  ];
  assert.deepEqual(gameReachOf('g', results), { live_on: 1, branch_completions: 6 },
    'an archived copy is not live, but its runs were played');
  assert.deepEqual(gameReachOf('other', results), { live_on: 0, branch_completions: 0 });
  results.push(ok('pt', { received: true, games: [], completions_reason: 'sessions unread' }));
  assert.equal(gameReachOf('g', results).branch_completions, null);
});

async function hqWithRoute(): Promise<Db> {
  const db = await hqDb();
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT);
           INSERT INTO users (id, role, name, email) VALUES (1, 'admin', 'Sue', 'sue@axal.example');
           INSERT INTO super_admins (user_id) VALUES (1);`);
  for (const st of splitStatements(migration('258_licence_deployments.sql'))) db.exec(st);
  const dep = db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status) VALUES (?, ?, ?, ?, ?, 'live')`);
  dep.run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  dep.run('lic_de', 'de', 'de.axal.vc', 'studioos-de', 'studioos-de');
  dep.run('lic_pt', 'pt', 'pt.axal.vc', 'studioos-pt', 'studioos-pt');
  return db;
}

async function call(db: Db, method: 'GET' | 'POST', path: string, bindings: Record<string, unknown>) {
  const jwt = await new SignJWT({ user_id: 1, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await content.fetch(new Request(`http://x${path}`, { method, headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...bindings } as any);
  return { status: res.status, body: await res.json() as any };
}

test('the push reaches each bound branch and reports each one; H18 then reads where each game is live', async () => {
  const hq = await hqWithRoute();
  const fr = newDb();
  const bindings = {
    BRANCH_FR: {
      publishGames: (p: any) => applyGames(branchEnv(fr), p),
      gameHoldings: () => branchGameHoldings(branchEnv(fr)),
    },
    BRANCH_DE: {
      publishGames: async () => { throw new Error('connection reset'); },
      gameHoldings: async () => { throw new Error('connection reset'); },
    },
  };
  const before = await call(hq, 'GET', '/summary', bindings);
  assert.equal(before.status, 200);
  const ffBefore = before.body.assessment.games.find((g: any) => g.slug === 'founder_fit');
  assert.equal(ffBefore.live_on, 0, 'live before any push');

  const push = await call(hq, 'POST', '/games/publish', bindings);
  assert.equal(push.status, 200);
  assert.equal(push.body.game_count, 1);
  assert.deepEqual(push.body.branches.map((b: any) => [b.code, b.status]), [['de', 'unreadable'], ['fr', 'ok']]);
  assert.equal(push.body.branches.find((b: any) => b.code === 'fr').stored, 1);
  assert.match(push.body.branches.find((b: any) => b.code === 'de').reason, /connection reset/);
  assert.equal(push.body.answered, 1);

  const gameId = Number((fr.prepare(`SELECT id FROM assessment_games WHERE slug = 'founder_fit'`).get() as any).id);
  fr.prepare(`INSERT INTO assessment_sessions (public_id, user_id, game_id, game_slug, status) VALUES ('s1', 5, ?, 'founder_fit', 'completed')`).run(gameId);

  const after = await call(hq, 'GET', '/summary', bindings);
  const a = after.body.assessment;
  const ff = a.games.find((g: any) => g.slug === 'founder_fit');
  assert.equal(ff.live_on, 1);
  assert.equal(ff.branch_completions, 1);
  assert.equal(a.games.find((g: any) => g.slug === 'lp_risk').live_on, 0, 'a draft is on no branch');
  assert.equal(a.branches.recorded, true);
  assert.deepEqual({ total: a.branches.total, answered: a.branches.answered, complete: a.branches.complete },
    { total: 3, answered: 1, complete: false });
  assert.deepEqual(a.branches.lines.map((l: any) => [l.code, l.status]), [['de', 'unreadable'], ['fr', 'ok'], ['pt', 'not_deployed']]);
  assert.equal(a.branches.lines.find((l: any) => l.code === 'fr').received, true);
  assert.match(a.branches.basis, /Only published games travel/);
});

test('the push refuses a non-super-admin, and with no branch bound reports that it reached none', async () => {
  const hq = await hqWithRoute();
  hq.exec(`DELETE FROM licence_deployments`);
  const none = await call(hq, 'POST', '/games/publish', {});
  assert.equal(none.status, 200);
  assert.equal(none.body.total, 0);
  assert.match(none.body.branches_reason, /No branch Worker is bound/);
  hq.exec(`DELETE FROM super_admins`);
  const refused = await content.fetch(new Request('http://x/games/publish', { method: 'POST' }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(hq) } as any);
  assert.notEqual(refused.status, 200);
});
