/**
 * D1522 (#3774, deck v2 A23) — stage arcs, the stage plan and
 * `GET /api/decks/:id/stage-plan`.
 *
 *  · each stage's order is a fixture, and the investor type lifts its lead cards;
 *  · a seed venture with no traction record gets the warning ("Seed deck with
 *    no traction slide"), and a traction card with no record is "no recorded evidence";
 *  · proof is a recorded deck source or a pinned item that backs the card; a
 *    withheld or unreadable source is "unchecked", never missing;
 *  · `cutUnproven` (the one-click run's cut) leaves out exactly the unproven cards;
 *  · the route: the audience decides the stage, `?stage=` overrides it, a bad
 *    stage is 400, another founder 403, an unknown deck 404. Synthetic records only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_stage_plan_d1522.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckStage from '../src/routes/deck_stage.ts';
import { ARCS, LEFT_OUT_LINE, STAGES, cardOfSlide, cutUnproven, planFor, proofOf, stageFrom } from '../src/services/narrative/arcs.ts';
import { backsOf, deckStage as stageOfDeck } from '../src/services/decks/stagePlan.ts';
import { CARD_CATALOGUE } from '../src/services/decks/newDeck.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const item = (source_key: string, state: 'recorded' | 'not_recorded' | 'withheld' | 'unreadable') => ({ source_key, state }) as any;
const recorded = (...keys: string[]) => keys.map((k) => item(k, 'recorded'));
const STANDARD_SEED = ['title', 'problem', 'solution', 'traction', 'team', 'round'];

// 1 ───────────────────────────────────────────────────────────────────────────
test('each stage\'s order is a fixture: four stages, every card in the catalogue, the title first, a why line for every card', () => {
  assert.deepEqual([...STAGES], ['pre_seed', 'seed', 'series_a', 'series_b_plus']);
  const FIXTURE = {
    pre_seed: ['title', 'problem', 'why_now', 'solution', 'team', 'validation', 'market', 'product', 'round', 'use_of_funds'],
    seed: ['title', 'problem', 'solution', 'traction', 'validation', 'product', 'market', 'why_now', 'team', 'unit_economics', 'round', 'use_of_funds'],
    series_a: ['title', 'traction', 'unit_economics', 'market', 'product', 'solution', 'problem', 'team', 'competition', 'roadmap', 'round', 'use_of_funds'],
    series_b_plus: ['title', 'traction', 'unit_economics', 'market', 'competition', 'product', 'roadmap', 'team', 'cap_table', 'round', 'use_of_funds'],
  };
  const REQUIRED = { pre_seed: ['problem', 'team'], seed: ['problem', 'traction', 'team'], series_a: ['traction', 'unit_economics', 'market', 'team'], series_b_plus: ['traction', 'unit_economics', 'market', 'team'] };
  const ids = new Set(CARD_CATALOGUE.map((c) => c.card));
  for (const s of STAGES) {
    assert.deepEqual(ARCS[s].order, FIXTURE[s], s);
    assert.deepEqual(ARCS[s].required, REQUIRED[s], `${s} required`);
    for (const c of ARCS[s].order) {
      assert.ok(ids.has(c), `${s}: ${c} is a catalogue card`);
      assert.ok(ARCS[s].why[c] && !/\d/.test(ARCS[s].why[c]), `${s}: ${c} has a why line, with no figure`);
    }
    const plan = planFor({ stage: s, cards: [], items: [] });
    assert.deepEqual(plan.order.map((r) => r.card), FIXTURE[s], `${s}: with no investor type the plan is the arc`);
  }
  assert.equal(planFor({ stage: 'seed', cards: [], items: [] }).order.find((r) => r.card === 'problem')!.why, 'Seed investors look for evidence of pain first.');
  assert.equal(planFor({ stage: 'series_a', cards: [], items: [] }).order.find((r) => r.card === 'traction')!.why, 'Series A investors read growth first.');
});

test('the investor type lifts its lead cards to just after the title, with its own why line; required cards weigh most', () => {
  const plan = planFor({ stage: 'seed', investorType: 'angel', cards: [], items: [] });
  assert.deepEqual(plan.order.slice(0, 4).map((r) => r.card), ['title', 'problem', 'team', 'solution']);
  assert.equal(plan.order[2].why, 'Angels read team first.');
  assert.deepEqual(plan.order.filter((r) => r.weight === 3).map((r) => r.card).sort(), ['problem', 'team', 'traction']);
  // A lead card the stage does not read is not added.
  const a = planFor({ stage: 'pre_seed', investorType: 'series_a_fund', cards: [], items: [] });
  assert.ok(!a.order.some((r) => r.card === 'unit_economics'), 'pre-seed reads no unit economics, whoever reads');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a seed venture with no traction record gets the warning: no slide, then no evidence', () => {
  const noSlide = planFor({ stage: 'seed', cards: ['title', 'problem', 'solution', 'team', 'round'], items: recorded('validate.top_pain', 'team.founders') });
  assert.deepEqual(noSlide.warnings, [{ card: 'traction', code: 'missing_card', message: 'Seed deck with no traction slide', action: 'Add a traction slide' }]);
  const noRecord = planFor({ stage: 'seed', cards: STANDARD_SEED, items: [...recorded('validate.top_pain', 'team.founders'), item('grow.mrr', 'not_recorded')] });
  assert.deepEqual(noRecord.warnings, [{ card: 'traction', code: 'missing_proof', message: 'Traction has no recorded evidence', action: 'Add a source' }]);
  assert.equal(noRecord.order.find((r) => r.card === 'traction')!.in_deck, 3);
  // A recorded MRR is proof; so is a pinned revenue receipt with nothing in the deck sources.
  assert.deepEqual(planFor({ stage: 'seed', cards: STANDARD_SEED, items: recorded('validate.top_pain', 'team.founders', 'grow.mrr') }).warnings, []);
  assert.deepEqual(planFor({ stage: 'seed', cards: STANDARD_SEED, items: recorded('validate.top_pain', 'team.founders'), pinnedBacks: backsOf(['revenue-receipt']) }).warnings, []);
  // The same deck at pre-seed is not asked for traction.
  assert.ok(!planFor({ stage: 'pre_seed', cards: ['title', 'problem', 'team'], items: recorded('validate.top_pain', 'team.founders') }).warnings.length);
});

test('a withheld or unreadable source is unchecked, never missing; the title and why now need no record', () => {
  assert.equal(proofOf('traction', [item('grow.mrr', 'withheld')], new Set()), 'unchecked');
  assert.equal(proofOf('traction', [item('grow.mrr', 'unreadable'), item('grow.arr', 'not_recorded')], new Set()), 'unchecked');
  assert.equal(proofOf('traction', [item('grow.mrr', 'not_recorded')], new Set()), 'missing');
  assert.equal(proofOf('title', [], new Set()), 'recorded');
  assert.equal(proofOf('why_now', [], new Set()), 'recorded');
  const p = planFor({ stage: 'seed', cards: STANDARD_SEED, items: [...recorded('validate.top_pain', 'team.founders'), item('grow.mrr', 'withheld')] });
  assert.deepEqual(p.warnings.map((w) => w.code), ['unchecked_proof']);
  assert.doesNotMatch(p.warnings[0].message, /no recorded evidence/);
});

test('cutUnproven (the one-click cut): every unproven card is left out with its line; unchecked cards are kept', () => {
  const plan = planFor({ stage: 'seed', cards: STANDARD_SEED, items: [...recorded('validate.top_pain', 'team.founders', 'build.must_haves'), item('grow.runway', 'withheld')] });
  const cut = cutUnproven(plan);
  assert.ok(cut.left_out.some((l) => l.card === 'traction' && l.line === LEFT_OUT_LINE), 'a required card with no proof is cut too');
  assert.ok(cut.keep.includes('unit_economics'), 'withheld runway: kept, as unchecked');
  assert.deepEqual([...cut.keep, ...cut.left_out.map((l) => l.card)].sort(), plan.order.map((r) => r.card).sort(), 'every card is decided');
  for (const c of cut.keep) assert.notEqual(plan.order.find((r) => r.card === c)!.proof, 'missing');
});

test('the deck\'s stage: asked, else its audience, else the venture, else seed; a slide is its card by spec id, else by title', () => {
  assert.deepEqual(stageOfDeck('series_a', 'angel', 'seed'), { stage: 'series_a', source: 'asked' });
  assert.deepEqual(stageOfDeck(null, 'seed_fund', 'series_a'), { stage: 'seed', source: 'audience' });
  assert.deepEqual(stageOfDeck(null, 'strategic', 'Series B'), { stage: 'series_b_plus', source: 'venture' });
  assert.deepEqual(stageOfDeck(null, null, 'idea'), { stage: 'pre_seed', source: 'venture' });
  assert.deepEqual(stageOfDeck(null, null, null), { stage: 'seed', source: 'default' });
  assert.equal(stageFrom('Series A'), 'series_a');
  assert.equal(stageFrom('nonsense'), null);
  assert.equal(cardOfSlide({ spec_id: 'new:traction', title: 'Our numbers' }), 'traction');
  assert.equal(cardOfSlide({ title: 'Unit economics' }), 'unit_economics');
  assert.equal(cardOfSlide({ title: 'A slide of my own' }), null);
});

// 3 ───────────────────────────────────────────────────────────────────────────
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE_SQL = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE_SQL);
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations).filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const FOUNDER = 10, OTHER = 20, P = 1;

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id, stage) VALUES (${P}, 'Kestrel Labs', 1001, 'build')`);
  const slides = ['title', 'problem', 'solution', 'team', 'round'].map((c) => ({ spec_id: `new:${c}`, title: c, blocks: [] }));
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current, audience) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(1, P, 1, 'Seed deck', JSON.stringify(slides), 'seed_fund');
  return db;
}
async function get(db: DatabaseSync, who: number, path: string) {
  const app = new Hono<any>();
  app.route('/api/decks', deckStage);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('GET /api/decks/:id/stage-plan: the seed fund\'s deck reads as seed and is warned of its missing traction slide; ?stage= overrides; refusals', async () => {
  const db = world();
  const r = await get(db, FOUNDER, '/api/decks/1/stage-plan');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.deck_id, r.body.stage, r.body.stage_label, r.body.stage_source, r.body.investor_type], [1, 'seed', 'Seed', 'audience', 'seed_fund']);
  assert.ok(r.body.warnings.some((w: any) => w.message === 'Seed deck with no traction slide'));
  assert.deepEqual(r.body.order.slice(0, 4).map((x: any) => x.card), ['title', 'problem', 'traction', 'solution'], 'the seed fund lifts its lead cards');
  assert.deepEqual(r.body.order.find((x: any) => x.card === 'team').in_deck, 3);
  assert.equal(r.body.objections.state, 'ok');
  for (const w of r.body.warnings) assert.doesNotMatch(w.message, /median|typical|benchmark|\d+%/i, 'a missing-proof warning cites no norm');

  const a = await get(db, FOUNDER, '/api/decks/1/stage-plan?stage=series_a&investor_type=series_a_fund');
  assert.deepEqual([a.body.stage, a.body.stage_source], ['series_a', 'asked']);
  assert.deepEqual(a.body.warnings.filter((w: any) => w.code === 'missing_card').map((w: any) => w.message).sort(),
    ['Series A deck with no market slide', 'Series A deck with no traction slide', 'Series A deck with no unit economics slide']);

  assert.equal((await get(db, FOUNDER, '/api/decks/1/stage-plan?stage=unicorn')).status, 400);
  assert.equal((await get(db, FOUNDER, '/api/decks/1/stage-plan?stage=series_c')).body.stage, 'series_b_plus', 'a later series reads as Series B+');
  assert.equal((await get(db, FOUNDER, '/api/decks/1/stage-plan?investor_type=bank')).status, 400);
  assert.equal((await get(db, OTHER, '/api/decks/1/stage-plan')).status, 403);
  assert.equal((await get(db, FOUNDER, '/api/decks/99/stage-plan')).status, 404);
});

test('the stage plan is a service: the route only calls stagePlan, which runs no model and writes nothing', () => {
  const route = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/deck_stage.ts'), 'utf8');
  const svc = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/decks/stagePlan.ts'), 'utf8')
    + readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/narrative/arcs.ts'), 'utf8');
  assert.match(route, /await stagePlan\(c\.env, \{/);
  assert.doesNotMatch(route + svc, /aiRouter|\brun\(env|AI\.run|INSERT |UPDATE |DELETE /);
  const index = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.match(index, /app\.route\('\/api\/decks', deckStage\);/);
});
