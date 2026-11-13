/**
 * D1516 (#3768, deck v2 A5) — New deck from the narrative: the stage's arc cut
 * to the cards with recorded proof, the `grid_plan` job, the theme picked by
 * stage, and one `deck_build` run over every area under one hold.
 *
 * Pure parts first (the narrative's words without figures, the cut and its
 * "Problem not evidenced", the grid plan against its schema, the theme), then
 * the 12-card draft from records and narrative, then the routes end to end on
 * D1: outline → build → a version bound to `narrative_version_meta:vN`, not
 * current, one hold, one charge for a repeated key, and no figure in any
 * model input.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import {
  GRID_PLAN_SCHEMA, buildAreas, cardsFor, figureFree, gridPlan, notEvidenced, pickTheme, plannedCards, wordsOf,
} from '../src/services/decks/narrativeBuild.ts';
import { AREA_LIMIT, planAreas, type PlanCtx } from '../src/services/decks/areas.ts';
import { numberIn } from '../src/services/decks/newDeck.ts';
import { D1GenRuntime } from '../src/services/decks/genRuntime.ts';
import { admitStatus } from '../src/services/decks/genRooms.ts';
import { DECK_GENERATE, DECK_NARRATIVE_BUILD } from '../src/middleware/rateLimit.ts';
import deckNarrative from '../src/routes/deck_narrative.ts';
import deckAreas from '../src/routes/deck_areas.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { CONTRACTS } from '../src/contracts/index.ts';

const schemaOf = (name: keyof typeof CONTRACTS) => JSON.parse(readFileSync(`cloudflare-worker/src/contracts/${CONTRACTS[name].schema}`, 'utf8'));
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';
import { fullRecords, sparseRecords } from './fixtures/pitchStoryFixtures.ts';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// ---- the narrative's words ----------------------------------------------------------

test('the narrative\'s words: every sentence that names a figure is dropped, by slot', () => {
  assert.deepEqual(figureFree('We reached $2.4M ARR. Pilots convert in weeks.'), { kept: 'Pilots convert in weeks.', dropped: 1 });
  assert.deepEqual(figureFree('Twelve customers signed. Audits are slow.'), { kept: 'Audits are slow.', dropped: 1 }, 'number words too');
  const w = wordsOf(4, [{ key: 'traction', body: 'We reached $2.4M ARR. Pilots convert in weeks.' }, { key: 'problem', body: 'Audits take weeks of manual work.' }, { key: 'team', body: null }], [{ kind: 'one_liner', text: 'Kestrel reads the ledger for you.' }]);
  assert.equal(w.ref, 'narrative_version_meta:v4');
  assert.deepEqual(w.words, {
    'raise.narrative.traction': 'Pilots convert in weeks.', 'raise.narrative.problem': 'Audits take weeks of manual work.', 'raise.positioning.one_liner': 'Kestrel reads the ledger for you.',
  });
  assert.deepEqual(w.dropped, { 'raise.narrative.traction': 1 });
  // Mutation checked: keep every sentence → the figure survives and this fails.
  for (const v of Object.values(w.words)) assert.equal(numberIn(v), null, v);
  const none = wordsOf(null, [], []);
  assert.deepEqual([none.version, none.ref], [null, null]);
  assert.match(String(none.reason), /No narrative version is saved yet/, 'missing is null with its reason, never v0');
});

// ---- the cut, the grid plan and the theme --------------------------------------------

test('a pre-seed venture with no interviews gets "Problem not evidenced", and the card is left out', () => {
  const cut = cardsFor('pre_seed', null, sparseRecords().items as any);
  assert.equal(notEvidenced('Problem'), 'Problem not evidenced');
  assert.deepEqual(cut.left_out.find((l) => l.card === 'problem'), { card: 'problem', title: 'Problem', line: 'Problem not evidenced' });
  assert.ok(cut.warnings.some((w) => w.card === 'problem' && w.message === 'Problem not evidenced'), 'the warning names it too');
  // Mutation checked: keep unproven cards → problem is planned and this fails.
  assert.ok(!cut.cards.some((c) => c.card === 'problem'));
  assert.equal(cut.cards[0].card, 'title');
  assert.equal(cut.stage_label.length > 0, true);
});

test('grid_plan: a structure per card, its areas and an element each, matching its schema; records fill only what they can', () => {
  const sparse = sparseRecords().items as any[];
  const cut = cardsFor('seed', 'seed_fund', sparse);
  const plan = gridPlan(cut.cards, sparse);
  assert.deepEqual(contractErrors(GRID_PLAN_SCHEMA as any, plan), []);
  assert.notDeepEqual(contractErrors(GRID_PLAN_SCHEMA as any, { cards: [{ ...plan.cards[0], areas: [] }] }), [], 'a card with no area is refused');
  const team = plan.cards.find((c) => c.card === 'team')!;
  assert.deepEqual(team.areas, [{ id: 'title', element: 'title' }, { id: 'body', element: 'team_grid' }], 'founders are recorded');
  const traction = plan.cards.find((c) => c.card === 'traction')!;
  // Mutation checked: plan a chart with nothing chartable → the area stays a chart and this fails.
  assert.equal(traction.areas.find((a) => a.id === 'main')!.element, 'chart', 'a recorded count can be charted');
  const bare = gridPlan(cut.cards, sparse.map((i) => ({ ...i, state: 'not_recorded', value: null })));
  assert.equal(bare.cards.find((c) => c.card === 'traction')!.areas.find((a) => a.id === 'main')!.element, 'body', 'nothing to chart: words instead');
  assert.equal(bare.cards.find((c) => c.card === 'team')!.areas.find((a) => a.id === 'body')!.element, 'body');
  assert.ok(plan.cards.every((c) => c.uid === `nb-${c.card}`), 'uids are the card ids, so the outline\'s quote holds for the build');
});

test('the theme: Brand Kit first, else the stage (and a climate sector), with "Picked … because …"', () => {
  assert.deepEqual(pickTheme({ brandKit: true, stage: 'seed', audience: null, sector: 'climate' }).kind, 'brand');
  assert.match(pickTheme({ brandKit: true, stage: 'seed', audience: null, sector: null }).reason, /^Picked Brand because your brand kit is set/);
  const seed = pickTheme({ brandKit: false, stage: 'series_a', audience: 'series_a_fund', sector: null });
  assert.equal(seed.kind, 'ocean');
  assert.match(seed.reason, /^Picked Ocean because it suits a .* deck for Series A funds\.$/);
  assert.equal(pickTheme({ brandKit: false, stage: 'pre_seed', audience: null, sector: 'Climate software' }).kind, 'forest');
  assert.equal(pickTheme({ brandKit: false, stage: 'pre_seed', audience: null, sector: null }).kind, 'sand');
});

// ---- the 12-card draft -----------------------------------------------------------------

function ctx(cards: any[]): PlanCtx {
  return {
    userId: 7, projectId: 3, deckId: -3, cards, aspect: '16:9', voice: null,
    quote: async (o) => ({ ok: true, hold_microusd: 1200, model: o.model ?? MODEL }),
    modelFor: async (element) => ({ element, model: MODEL, source: 'default', locked: false, set_by: null, stale: [], plan_blocked: [], notice: null, switched_off: [] }),
    venture: async (element) => ({ element, available: true, blocks: [{ kind: 'metric', label: element, value: null }], bindings: [], model: null, label: element }) as any,
    sources: async () => fullRecords().items as any,
    art: async () => ({ seed_base: 'a'.repeat(32), art: {} as any }),
  };
}

test('Venture records and narrative to a 12-card draft, p50 ≤ 60 s: every area runs, under one deck_build quote', async () => {
  const items = fullRecords().items as any[];
  const words = wordsOf(2, [{ key: 'traction', body: 'We reached $2.4M ARR. Pilots convert in weeks.' }, { key: 'problem', body: 'Audits take weeks of manual work.' }], []);
  const times: number[] = [];
  let last: any = null;
  for (let i = 0; i < 5; i += 1) {
    const t0 = performance.now();
    const cut = cardsFor('seed', 'seed_fund', items);
    const grid = gridPlan(cut.cards, items);
    const cards = plannedCards(grid, words);
    last = { cut, grid, cards, plan: await planAreas(ctx(cards), { card: null, areas: buildAreas(grid), variants: 1, cls: 'deck_build' }) };
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[2] <= 60_000, `p50 ${times[2]} ms`);
  assert.equal(last.cards.length, 12, 'the seed arc\'s twelve cards, every one proven by the records');
  assert.equal(last.cut.left_out.length, 0);
  assert.ok(last.plan.areas.length <= AREA_LIMIT.deck_build);
  assert.equal(last.plan.cls, 'deck_build');
  assert.deepEqual(last.plan.areas.filter((a: any) => a.refusal).map((a: any) => `${a.card_uid}/${a.area_id}: ${a.refusal.code}`), [], 'no area is left empty');
  // No figure reaches a model input: the narrative's words are in the cards' notes without the figure.
  // Mutation checked: put the narrative's raw words in the notes → "$2.4M" reaches a prompt and this fails.
  const prompts = last.plan.lines.map((l: any) => JSON.stringify(l.input?.messages ?? []));
  assert.ok(prompts.some((p: string) => p.includes('Pilots convert in weeks')), 'the narrative reaches the words');
  assert.ok(!prompts.some((p: string) => p.includes('2.4M')), 'never its figure');
});

// ---- the routes ------------------------------------------------------------------------

const FOUNDER = 10, OTHER = 20, P = 1;
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
function world(opts: { narrative?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (1, ?, 1, ?, ?, 1)').run(P, 'The current deck', JSON.stringify([{ title: 'Kestrel' }]));
  db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?)').run(FOUNDER, 50_000_000);
  if (opts.narrative !== false) {
    const w = db.prepare('INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (?, ?, ?, 2)');
    w.run(P, '_version', '');
    w.run(P, 'problem.framing', 'Audits take weeks of manual work.');
    w.run(P, 'ask.title', 'We raise $1.5M on a SAFE. Join the founders who read ledgers.');
    db.prepare("INSERT INTO narrative_version_meta (project_id, version, start_from, why_now) VALUES (?, 2, 'live', ?)").run(P, 'Auditors retire faster than they are hired.');
  }
  return db;
}
function roomFor(db: DatabaseSync) {
  const env: any = { DB: d1Over(db) };
  return { idFromName: (n: string) => n, get: () => ({ fetch: async (_url: string, init: any) => {
    const a = await new D1GenRuntime(env, async () => ({ ok: false, charged_microusd: 0 })).admit(JSON.parse(init.body));
    return Response.json(a, { status: a.ok ? 200 : admitStatus(a.refusal) });
  } }) };
}
async function call(db: DatabaseSync, who: number, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const app = new Hono<any>().route('/api/decks', deckAreas).route('/api/decks', deckNarrative);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), DECK_GEN_ROOM: roomFor(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const count = (db: DatabaseSync, sql: string, ...a: any[]) => (db.prepare(sql).get(...a) as any).n;

test('routes: the outline holds nothing; the build binds narrative_version_meta:vN, is not current, runs once under one hold, and no figure reaches a model', async () => {
  const db = world();
  const body = { project_id: P, stage: 'pre_seed' };
  const o = await call(db, FOUNDER, '/api/decks/narrative/outline', body);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.deepEqual([o.body.narrative.version, o.body.narrative.ref], [2, 'narrative_version_meta:v2']);
  assert.deepEqual(o.body.narrative.dropped, { 'raise.narrative.ask': 1 }, 'the ask\'s figure sentence is dropped');
  assert.ok(o.body.left_out.some((l: any) => l.line === 'Problem not evidenced'), 'no interviews on record');
  assert.equal(o.body.cards[0].card, 'title');
  assert.match(o.body.theme.reason, /^Picked /);
  assert.equal(typeof o.body.template.reason, 'string');
  assert.equal(o.body.quote.class, 'deck_build');
  assert.deepEqual(contractErrors(schemaOf('narrativeOutline'), o.body), [], 'D1511: the outline is the adapter\'s contract');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deck_area_batches'), 0, 'an outline holds nothing');
  assert.equal((await call(db, OTHER, '/api/decks/narrative/outline', body)).status, 403, 'only the venture\'s writers');
  assert.equal((await call(db, FOUNDER, '/api/decks/narrative/build', body)).status, 400, 'a build needs its key');

  const b = await call(db, FOUNDER, '/api/decks/narrative/build', { ...body, quote_uid: o.body.quote.quote_uid }, { 'Idempotency-Key': 'narrative-test-0001' });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.hold_microusd, o.body.quote.hold_microusd, 'the build holds what the outline quoted');
  assert.deepEqual(contractErrors(schemaOf('narrativeOutline'), b.body), [], 'D1511: the build is the adapter\'s contract');
  const row = db.prepare('SELECT * FROM pitch_decks WHERE id = ?').get(b.body.deck_id) as any;
  assert.deepEqual([row.narrative_version, row.is_current, row.version], [2, 0, 2], 'bound to narrative v2, a new version, not current');
  assert.equal((db.prepare('SELECT id FROM pitch_decks WHERE project_id = ? AND is_current = 1').get(P) as any).id, 1, 'the founder\'s deck stays current');
  assert.equal(JSON.parse(row.theme_json).kind, o.body.theme.kind);
  const cards = JSON.parse(row.slides);
  assert.deepEqual(cards.map((c: any) => c.uid), o.body.cards.map((c: any) => c.uid));
  assert.ok(cards.every((c: any) => c.structure && Array.isArray(c.areas) && c.areas.length));
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM deck_area_batches WHERE class = 'deck_build'"), 1, 'one run, one hold');
  assert.equal(b.body.proposals.length, o.body.quote.runs, 'one proposal per area that runs');
  const inputs = (db.prepare('SELECT input FROM deck_area_batch_steps WHERE batch_uid = ?').all(b.body.batch_uid) as any[]).map((r) => String(r.input));
  assert.ok(inputs.length > 0);
  assert.ok(!inputs.some((i) => /1\.5M|\$/.test(i)), 'no figure from the narrative reaches a model input');

  const again = await call(db, FOUNDER, '/api/decks/narrative/build', { ...body, quote_uid: o.body.quote.quote_uid }, { 'Idempotency-Key': 'narrative-test-0001' });
  assert.deepEqual([again.status, again.body.replayed, again.body.deck_id, again.body.batch_uid], [200, true, b.body.deck_id, b.body.batch_uid]);
  assert.deepEqual(contractErrors(schemaOf('narrativeOutline'), again.body), []);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM pitch_decks WHERE project_id = ?', P), 2, 'no second version');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deck_area_batches'), 1, 'no second hold: one charge');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deck_area_proposals'), b.body.proposals.length);
});

test('routes: a changed plan is a stale quote; with no narrative saved the build binds none', async () => {
  const db = world({ narrative: false });
  const o = await call(db, FOUNDER, '/api/decks/narrative/outline', { project_id: P, stage: 'pre_seed' });
  assert.equal(o.status, 200);
  assert.equal(o.body.narrative.version, null);
  const stale = await call(db, FOUNDER, '/api/decks/narrative/build', { project_id: P, stage: 'series_b_plus', quote_uid: o.body.quote.quote_uid }, { 'Idempotency-Key': 'narrative-test-0002' });
  assert.deepEqual([stale.status, stale.body.error], [409, 'quote_stale']);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM pitch_decks'), 1, 'nothing written');
  const b = await call(db, FOUNDER, '/api/decks/narrative/build', { project_id: P, stage: 'pre_seed' }, { 'Idempotency-Key': 'narrative-test-0003' });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.narrative_version, null);
});

test('the rate limit covers the build, not the outline', () => {
  assert.ok(DECK_NARRATIVE_BUILD.test('/api/decks/narrative/build'));
  assert.ok(!DECK_NARRATIVE_BUILD.test('/api/decks/narrative/outline'));
  assert.ok(!DECK_GENERATE.test('/api/decks/narrative/outline'));
});

test('migration: narrative_version on pitch_decks, bound to narrative_version_meta by trigger, no data', () => {
  const sql = readFileSync('cloudflare-worker/sql/migrations/202611031522_pitch_decks_narrative_version.sql', 'utf8');
  assert.match(sql, /ALTER TABLE pitch_decks ADD COLUMN narrative_version INTEGER/);
  assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE)\b/im, 'no data');
  const db = world();
  // Mutation checked: drop the insert trigger → the unbound row is written and this fails.
  assert.throws(() => db.prepare('INSERT INTO pitch_decks (project_id, version, title, slides, is_current, narrative_version) VALUES (?, 9, ?, ?, 0, 7)').run(P, 't', '[]'), /narrative_version names no saved narrative version/);
  db.prepare('INSERT INTO pitch_decks (project_id, version, title, slides, is_current, narrative_version) VALUES (?, 9, ?, ?, 0, 2)').run(P, 't', '[]');
  assert.throws(() => db.prepare('UPDATE pitch_decks SET narrative_version = 5 WHERE version = 9').run(), /narrative_version names no saved narrative version/);
});
