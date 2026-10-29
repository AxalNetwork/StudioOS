/**
 * D903 §10 (#3660) — the visuals a generated deck may carry: diagrams placed
 * by records, the chart a bound series reads best as, the composer drawing
 * them, and the artwork plan with its capability check. On SQLite with the
 * baseline and every migration. Every name and figure is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_visuals_d903.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import {
  ART_CARDS, artDirection, chartTypeFor, competitorMatrix, imageCapability, imagePlan, recordDiagrams, roadmapDiagram, useOfFundsDiagram,
} from '../src/services/decks/visuals.ts';
import { buildCards, standardOutline } from '../src/services/decks/newDeck.ts';
import { fitProblems } from '../src/services/decks/designSystem.ts';
import { modelProblems } from '../src/services/decks/slideModel.ts';
import { fullRecords, wordsFor } from './fixtures/pitchStoryFixtures.ts';

const root = new URL('../sql/', import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), 'deck-visuals-d903-'));
const seed = join(scratch, 'schema.sqlite');
{
  const db = new DatabaseSync(seed, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(new URL('schema_baseline.sql', root), 'utf8'));
  for (const n of readdirSync(new URL('migrations/', root)).filter((f) => /^\d+_.*\.sql$/.test(f) && migrationNumber(f) > BASELINE_CUTOFF).sort()) db.exec(readFileSync(new URL('migrations/' + n, root), 'utf8'));
  db.close();
}
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
function world() {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(2,'Other synthetic venture',200)");
  return { db, env: { DB: d1Over(db) } as any };
}

test('the roadmap as a timeline: objectives in working order, each bound to its record, none done; fewer than two is none', async () => {
  const w = world();
  w.db.exec(`INSERT INTO roadmap_okrs(id,project_id,objective,kanban_status,quarter,sort_order,updated_at) VALUES
    (1,1,'Self-serve onboarding','later','2027-Q2',0,'2026-10-01'),(2,1,'Multi-entity close','now','2026-Q4',1,'2026-10-02'),
    (3,1,'Auditor workspace','next',NULL,0,'2026-10-03'),(4,1,'Old launch','done','2026-Q1',0,'2026-10-04'),(5,2,'Not ours','now',NULL,0,'2026-10-05')`);
  const d = (await roadmapDiagram(w.env, 1))!;
  assert.deepEqual(d.items.map((i) => i.label), ['Multi-entity close', 'Auditor workspace', 'Self-serve onboarding']);
  assert.deepEqual(d.items.map((i) => i.detail ?? null), ['Now · 2026-Q4', 'Next', 'Later · 2027-Q2']);
  assert.deepEqual((d.items[0].binding as any).record_ref, 'roadmap_okrs:2');
  assert.equal((d.items[0].binding as any).snapshot_hash.length, 24);
  w.db.exec('DELETE FROM roadmap_okrs WHERE id IN (1,3)');
  assert.equal(await roadmapDiagram(w.env, 1), null);
  w.db.close();
});

test('use of funds as a flow: the recorded sections by share, names only, no percentage written into the diagram', async () => {
  const w = world();
  w.db.prepare('UPDATE projects SET use_of_funds = ? WHERE id = 1').run(JSON.stringify([{ label: 'Product & engineering', pct: 30 }, { label: 'GTM: sales and marketing', pct: 15 }, { label: 'Operations, legal & compliance', pct: 55 }]));
  const d = (await useOfFundsDiagram(w.env, 1))!;
  assert.equal(d.type, 'flow');
  assert.deepEqual(d.items.map((i) => i.label), ['Operations, legal & compliance', 'Product & engineering', 'GTM: sales and marketing'], 'largest share first');
  assert.doesNotMatch(JSON.stringify(d.items.map((i) => [i.label, i.detail])), /\d/, 'no share in the diagram');
  w.db.prepare('UPDATE projects SET use_of_funds = NULL WHERE id = 1').run();
  assert.equal(await useOfFundsDiagram(w.env, 1), null);
  w.db.close();
});

test('the competitor matrix: placed only from recorded price and depth; "about the same" or unrecorded is left off, never guessed', async () => {
  const w = world();
  w.db.exec(`INSERT INTO competitor_analyses(id,user_id,project_id) VALUES ('a1',1,1);
    INSERT INTO competitor_candidates(id,analysis_id,name) VALUES ('c1','a1','Ledgerly'),('c2','a1','CloseKit'),('c3','a1','SameCo'),('c4','a1','Unknown Inc');
    INSERT INTO competitor_tracking(id,uid,project_id,name_norm,price_position,depth_position,updated_at) VALUES
      (1,'t1',1,'ledgerly','higher','broader','2026-10-01'),(2,'t2',1,'closekit','lower','narrower','2026-10-02'),
      (3,'t3',1,'sameco','similar','broader','2026-10-03'),(4,'t4',1,'unknown inc',NULL,NULL,'2026-10-04')`);
  const m = (await competitorMatrix(w.env, 1))!;
  assert.equal(m.placed, 2);
  assert.deepEqual(m.diagram.axes, { x: 'Price against ours', y: 'Depth against ours' });
  assert.deepEqual(m.diagram.items.map((i) => `${i.label}: ${i.detail}`), [
    'Cheaper and broader: None recorded here', 'Pricier and broader: Ledgerly', 'Cheaper and narrower: CloseKit', 'Pricier and narrower: None recorded here',
  ]);
  assert.doesNotMatch(JSON.stringify(m.diagram), /SameCo|Unknown Inc/);
  w.db.exec('UPDATE competitor_tracking SET stopped_at = datetime(\'now\') WHERE id = 2');
  assert.equal(await competitorMatrix(w.env, 1), null, 'one placed is not a matrix');
  w.db.close();
});

test('a failed read places no diagram; the deck falls back, never draws a made-up one', async () => {
  const broken = { DB: { prepare: () => { throw new Error('synthetic read failure'); } } } as any;
  assert.equal(await roadmapDiagram(broken, 1), null);
  assert.equal(await useOfFundsDiagram(broken, 1), null);
  assert.equal(await competitorMatrix(broken, 1), null);
  assert.deepEqual(await recordDiagrams(broken, 1), { diagrams: {}, rows: {} });
});

test('the chart each series reads best as: a trend of four or more is a line, fewer is columns, a weekly count is columns; one point is none', () => {
  const s = (n: number, extra: any = {}) => ({ state: 'recorded', points: Array.from({ length: n }, (_, i) => ({ x: `2026-0${i + 1}`, y: i })), cadence: 'monthly', unit: 'usd', ...extra });
  assert.equal(chartTypeFor(s(7) as any), 'line');
  assert.equal(chartTypeFor(s(3) as any), 'columns');
  assert.equal(chartTypeFor(s(9, { cadence: 'weekly', unit: 'count' }) as any), 'columns');
  assert.equal(chartTypeFor(s(1) as any), null);
  assert.equal(chartTypeFor(s(5, { state: 'not_recorded' }) as any), null);
  assert.equal(chartTypeFor(null), null);
});

test('the composer draws the visuals: the roadmap as a timeline, use of funds as a flow, the market as a matrix, the traction chart its type; every card fits', () => {
  const rec = fullRecords();
  const rows = standardOutline('full', 'seed_fund');
  const diagrams = {
    roadmap: { v: 1, type: 'timeline', items: [{ label: 'Multi-entity close' }, { label: 'Auditor workspace' }, { label: 'Payroll feeds' }] },
    use_of_funds: { v: 1, type: 'flow', items: [{ label: 'Product & engineering' }, { label: 'GTM: sales and marketing' }, { label: 'Operations, legal & compliance' }] },
    market: { v: 1, type: 'matrix', axes: { x: 'Price', y: 'Depth' }, items: [{ label: 'A' }, { label: 'B', detail: 'Ledgerly' }, { label: 'C', detail: 'CloseKit' }, { label: 'D' }] },
  } as any;
  const { slides, problems } = buildCards(rows, rec.items as any, wordsFor(rows), 'Synthetic venture', new Set(), { series: rec.series as any, diagrams, rows: { market: 2 } });
  assert.deepEqual(problems, []);
  assert.deepEqual(modelProblems(slides, () => null), []);
  assert.deepEqual(fitProblems(slides.filter((s) => !s.appendix)), []);
  const card = (id: string) => slides.find((s) => s.spec_id === `new:${id}`);
  assert.equal(card('roadmap').layout, 'timeline');
  assert.equal(card('roadmap').blocks.find((b: any) => b.kind === 'graphic').diagram.type, 'timeline');
  assert.equal(card('use_of_funds').layout, 'timeline');
  assert.equal(card('use_of_funds').blocks.find((b: any) => b.kind === 'graphic').diagram.type, 'flow');
  assert.equal(card('market').layout, 'comparison_table');
  assert.equal(card('market').blocks.find((b: any) => b.kind === 'graphic').diagram.type, 'matrix');
  assert.equal(card('traction').blocks.find((b: any) => b.kind === 'chart').chart_type, 'line');
  assert.ok(new Set(slides.map((s) => s.layout)).size >= 7, 'seven or more layouts once the records place visuals');
  const short = { ...rec.series[0], points: rec.series[0].points.slice(-3) };
  const few = buildCards(rows, rec.items as any, wordsFor(rows), null, new Set(), { series: [short] as any }).slides;
  assert.equal(few.find((s) => s.spec_id === 'new:traction').blocks.find((b: any) => b.kind === 'chart').chart_type, 'columns', 'three months read as columns');
});

test('artwork: capability is checked (binding and catalogue), one art direction per deck, and a plan proposes only words-only cards, never generating', () => {
  assert.deepEqual(imageCapability({} as any), { available: false, reason: 'Image generation is not available on this deployment. The deck uses layouts without illustrations.' });
  const cap = imageCapability({ AI: { run: async () => ({}) } } as any);
  assert.deepEqual(cap, { available: true, model: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 Schnell' });
  const beta = imageCapability({ AI: { run: async () => ({}) } } as any, [{ id: '@cf/black-forest-labs/flux-1-schnell', status: 'beta' }]);
  assert.equal(beta.available, false, 'a model the catalogue does not list as generally available is not promised');
  assert.equal(imageCapability({ AI: { run: async () => ({}) } } as any, []).available, false);
  const a = artDirection('brand', { palette_accent: '#0e7490' });
  const b = artDirection('brand', { palette_accent: '#0e7490' });
  assert.deepEqual(a, b, 'the same deck gets the same direction every time');
  assert.equal(a.colours[0], '#0e7490');
  assert.match(a.suffix, /No text, no numbers, no charts, no logos, no people\./);
  assert.equal(artDirection('neutral_dark').style, 'isometric');
  const slides = [
    { spec_id: 'new:title', blocks: [{ kind: 'text', style: 'heading', text: 'Close in 1 day' }] },
    { spec_id: 'new:traction', blocks: [] },
    { spec_id: 'new:solution', blocks: [{ kind: 'image', image_url: 'https://example.invalid/x.png' }] },
    { spec_id: 'new:product', blocks: [] , title: 'Product' },
  ];
  const plan = imagePlan(slides, 'brand', null, cap);
  assert.deepEqual(plan.cards.map((c) => c.card), ['title', 'product'], 'not traction (it has figures), not a card that already has an image');
  assert.doesNotMatch(plan.cards[0].description, /\d/, 'no figure in a description');
  assert.deepEqual(imagePlan(slides, 'brand', null, imageCapability(null)).cards, [], 'no capability, no proposals');
  assert.ok(ART_CARDS.every((c) => !['traction', 'unit_economics', 'round'].includes(c)));
});
