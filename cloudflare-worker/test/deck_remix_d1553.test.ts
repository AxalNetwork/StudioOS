/**
 * D1553 (#3800, deck v2 C5) — Remix and the remove-a-block reflow.
 *
 *  · every option meets the card's evidence: the same blocks, saying the same
 *    things, none dropped or invented, every block inside an area, no empty
 *    area, sound areas — for every layout preset filled with content;
 *  · four options at most, never the card's own structure, the same answer twice;
 *  · the canvas's lines ("Fits your 3 recorded figures", "Puts the chart first",
 *    "Leads with MRR", "Gives each proof its own cell");
 *  · removing Runway from Hero + 3 widens MRR and Customers (pd5);
 *  · the route places no hold, needs no AI switch (a paused member, no AI
 *    binding) and writes nothing; 400, 403, 404. Synthetic records only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_remix_d1553.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckRemix from '../src/routes/deck_remix.ts';
import { REMIX_OPTIONS, evidenceOf, fitTo, lineFor, remixOptions, removeBlock, sameEvidence } from '../src/services/decks/remix.ts';
import { STRUCTURES, areasProblem, structureOf } from '../src/services/decks/structures.ts';
import { LAYOUTS, modelProblems } from '../src/services/decks/slideModel.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const bd = (k: string) => ({ source_key: k, record_ref: null, as_of: '2026-10-01', grade: 'Measured', snapshot_hash: null });
const G = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });
const TRACTION = {
  title: 'Traction', layout: 'metric_tiles',
  blocks: [
    { id: 'h', kind: 'text', style: 'heading', text: 'Revenue is growing', grid: G(1, 12, 1, 1) },
    { id: 'm1', kind: 'metric', label: 'MRR', value: '$42k', binding: bd('grow.mrr'), grid: G(1, 3, 2, 4) },
    { id: 'm2', kind: 'metric', label: 'Customers', value: '18', binding: bd('grow.paying_customers'), grid: G(4, 6, 2, 4) },
    { id: 'm3', kind: 'metric', label: 'Runway', value: '14 months', binding: bd('grow.runway'), grid: G(7, 9, 2, 4) },
    { id: 'p', kind: 'text', style: 'paragraph', text: 'Since the pilot.', grid: G(1, 12, 5, 6) },
  ],
};
const CHART = {
  title: 'Growth', blocks: [
    { id: 'h', kind: 'text', style: 'heading', text: 'Growth since launch', grid: G(1, 12, 1, 1) },
    { id: 'c', kind: 'chart', chart_type: 'line', range: 'all', previous: false, labels: true, series: [{ label: 'MRR', binding: bd('grow.mrr') }], grid: G(1, 8, 2, 6) },
    { id: 'l', kind: 'text', style: 'list', text: 'Up every month', grid: G(9, 12, 2, 6) },
  ],
};
const ONE_FIGURE = {
  title: 'MRR', blocks: [
    { id: 'm1', kind: 'metric', label: 'MRR', value: '$42k', binding: bd('grow.mrr'), grid: G(1, 6, 1, 4) },
    { id: 'p', kind: 'text', style: 'paragraph', text: 'Recorded by the bank.', grid: G(7, 12, 1, 4) },
  ],
};

/** Each layout preset with content in every block, the way the editor fills them. */
const filled = (layout: (typeof LAYOUTS)[number]) => ({
  title: layout.label, layout: layout.id,
  blocks: layout.blocks.map((b: any, i: number) => ({
    ...b, id: `b${i + 1}`,
    ...(b.kind === 'text' ? { text: `Words ${i + 1}` } : {}),
    ...(b.kind === 'metric' ? { label: `Figure ${i + 1}`, value: String(i * 7), binding: bd(`grow.k${i}`) } : {}),
    ...(b.kind === 'image' ? { image_url: null, alt: `Picture ${i + 1}` } : {}),
    ...(b.kind === 'chart' ? { series: [{ label: 'S', binding: bd('grow.mrr') }] } : {}),
  })),
});
const inside = (a: any, g: any) => a.c1 <= g.c1 && g.c2 <= a.c2 && a.r1 <= g.r1 && g.r2 <= a.r2;

function sound(card: any, option: any, why: string) {
  assert.ok(sameEvidence(card, option), `${why}: the same blocks, saying the same things`);
  assert.deepEqual(evidenceOf(option), evidenceOf(card), why);
  assert.equal(option.blocks.length, card.blocks.length, `${why}: nothing dropped or invented`);
  assert.equal(areasProblem(option.areas), null, `${why}: sound areas`);
  for (const b of option.blocks) assert.ok(option.areas.some((a: any) => inside(a, b.grid)), `${why}: block ${b.id} sits in an area`);
  for (const a of option.areas) assert.ok(option.blocks.some((b: any) => inside(a, b.grid)), `${why}: area ${a.id} is not empty`);
  assert.deepEqual(modelProblems([option], () => null), [], `${why}: the save would accept it`);
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('every remix option meets the card\'s evidence, for every layout preset filled with content', () => {
  let seen = 0;
  for (const card of [TRACTION, CHART, ONE_FIGURE, ...LAYOUTS.map(filled)]) {
    const options = remixOptions(card as any);
    assert.ok(options.length <= REMIX_OPTIONS, card.title);
    for (const o of options) { sound(card, o.card, `${card.title} → ${o.label}`); seen++; }
    assert.deepEqual(remixOptions(card as any), options, `${card.title}: deterministic`);
  }
  assert.ok(seen >= 30, `options checked: ${seen}`);
});

test('four layouts for the Traction card, with the canvas\'s lines, never its own structure', () => {
  const options = remixOptions(TRACTION as any);
  assert.equal(options.length, 4);
  assert.deepEqual(options.map((o) => o.structure), ['hero_3', 'two_by_two', 'quarters', 'z_pattern']);
  assert.equal(options[0].line, 'Fits your 3 recorded figures');
  assert.equal(options[1].line, 'Gives each proof its own cell');
  const onHero = { ...TRACTION, ...options[0].card };
  assert.ok(!remixOptions(onHero as any).some((o) => o.structure === 'hero_3'), 'the card\'s own structure is not offered');
  // Chart first, and the figure first.
  const chart = remixOptions(CHART as any).find((o) => o.structure === 'split_7_5')!;
  assert.equal(chart.line, 'Puts the chart first');
  assert.equal(chart.card.blocks!.find((b: any) => b.kind === 'chart')!.grid.c1, 1, 'the chart takes the 7-column main area');
  const big = remixOptions(ONE_FIGURE as any).find((o) => o.structure === 'big_number')!;
  assert.equal(big.line, 'Leads with MRR');
  const area = big.card.areas!.find((a: any) => a.role === 'metric')!;
  assert.ok(inside(area, big.card.blocks!.find((b: any) => b.kind === 'metric')!.grid), 'MRR sits in the number area');
  // A structure that cannot hold every block is not offered: Big number needs a figure, and never drops one.
  assert.equal(fitTo(CHART as any, structureOf('big_number')!), null);
  assert.equal(fitTo(TRACTION as any, structureOf('split_7_5')!), null, 'two areas cannot hold four units');
  assert.equal(lineFor(structureOf('hero_3')!, ONE_FIGURE as any), 'Gives the headline the top band');
});

test('sameEvidence: a dropped, invented or changed block is not the same evidence; a moved one is', () => {
  const moved = { blocks: TRACTION.blocks.map((b) => ({ ...b, grid: G(1, 1, 1, 1) })) };
  assert.ok(sameEvidence(TRACTION as any, moved as any));
  assert.ok(!sameEvidence(TRACTION as any, { blocks: TRACTION.blocks.slice(1) } as any), 'dropped');
  assert.ok(!sameEvidence(TRACTION as any, { blocks: [...TRACTION.blocks, { id: 'x', kind: 'metric', label: 'ARR', value: '$1m', grid: G(1, 1, 1, 1) }] } as any), 'invented');
  assert.ok(!sameEvidence(TRACTION as any, { blocks: TRACTION.blocks.map((b) => (b.id === 'm1' ? { ...b, value: '$43k' } : b)) } as any), 'changed');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('remove a block, the rest reflows inside the grid: Runway removed, MRR and Customers widened (pd5)', () => {
  const hero = remixOptions(TRACTION as any)[0].card;
  const next = removeBlock(hero, 'm3')!;
  assert.equal(next.structure, 'custom');
  assert.ok(!next.blocks!.some((b: any) => b.id === 'm3'));
  assert.deepEqual(next.blocks!.filter((b: any) => b.kind === 'metric').map((b: any) => [b.id, b.grid.c1, b.grid.c2]), [['m1', 1, 6], ['m2', 7, 12]]);
  assert.equal(areasProblem(next.areas), null);
  for (const a of next.areas!) assert.ok(next.blocks!.some((b: any) => inside(a, b.grid)), `area ${a.id} kept a block`);
  // What stays says what it said.
  assert.deepEqual(evidenceOf(next), evidenceOf({ blocks: TRACTION.blocks.filter((b) => b.id !== 'm3') } as any));
  // A block that shared its area with words: the area stays, the words take its rows.
  const shared = removeBlock(hero, 'p')!;
  const h = shared.blocks!.find((b: any) => b.id === 'h')!;
  assert.deepEqual([h.grid.r1, h.grid.r2], [1, 3], 'the heading takes the hero area');
  // A column stack reflows its rows when no area shares the band.
  const quarters = remixOptions(TRACTION as any).find((o) => o.structure === 'two_by_two')!.card;
  const lessQ = removeBlock(quarters, 'm2')!;
  assert.equal(areasProblem(lessQ.areas), null);
  assert.equal(removeBlock(TRACTION as any, 'nope'), null);
});

test('removing blocks one by one never leaves an empty area, on every option of every preset', () => {
  for (const card of [TRACTION, CHART, ...LAYOUTS.map(filled)]) {
    for (const o of remixOptions(card as any)) {
      let c: any = o.card;
      for (const b of o.card.blocks!.slice(1)) {
        c = removeBlock(c, b.id);
        assert.equal(areasProblem(c.areas), null, `${card.title} → ${o.label} without ${b.id}`);
        for (const a of c.areas) assert.ok(c.blocks.some((x: any) => inside(a, x.grid)), `${card.title} → ${o.label} without ${b.id}: area ${a.id}`);
      }
    }
  }
  assert.equal(STRUCTURES.length, 17);
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
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, ?, ?, ?, 1)').run(1, P, 1, 'Seed deck', JSON.stringify([TRACTION]));
  return db;
}
async function post(db: DatabaseSync, who: number, path: string, body: unknown) {
  const app = new Hono<any>();
  app.route('/api/decks', deckRemix);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  // No AI binding at all: a route that reached a model would throw.
  const res = await withThrownResponses(() => app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('POST /api/decks/:id/remix: four options for the posted card, no hold, no AI switch, nothing written; remove reflows first', async () => {
  const db = world();
  // AI paused for this member (pd9e): Remix still answers.
  db.prepare('INSERT INTO member_ai_pauses (user_id, reason, paused_by) VALUES (?, ?, ?)').run(FOUNDER, 'Synthetic pause for the remix test.', OTHER);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM member_ai_pauses WHERE user_id = ?').get(FOUNDER) as any).n, 1, 'AI is paused for this member');
  const counts = () => ['ai_budget_reservations', 'ai_usage_logs', 'pitch_decks'].map((t) => { try { return (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n; } catch { return null; } });
  const before = counts();
  const decksBefore = (db.prepare('SELECT slides FROM pitch_decks WHERE id = 1').get() as any).slides;
  const r = await post(db, FOUNDER, '/api/decks/1/remix', { card: TRACTION });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.deck_id, r.body.current, r.body.options.length], [1, 'custom', 4]);
  for (const o of r.body.options) sound(TRACTION, o.card, o.label);
  const removed = await post(db, FOUNDER, '/api/decks/1/remix', { card: r.body.options[0].card, remove: 'm3' });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.card.blocks.filter((b: any) => b.kind === 'metric').map((b: any) => [b.grid.c1, b.grid.c2]), [[1, 6], [7, 12]]);
  assert.deepEqual(counts(), before, 'no hold, no usage row, no new version');
  assert.equal((db.prepare('SELECT slides FROM pitch_decks WHERE id = 1').get() as any).slides, decksBefore, 'the saved deck is untouched');

  assert.equal((await post(db, FOUNDER, '/api/decks/1/remix', {})).status, 400);
  assert.equal((await post(db, FOUNDER, '/api/decks/1/remix', { card: { blocks: [] } })).status, 400);
  assert.equal((await post(db, FOUNDER, '/api/decks/1/remix', { card: TRACTION, remove: 'nope' })).status, 400);
  assert.equal((await post(db, OTHER, '/api/decks/1/remix', { card: TRACTION })).status, 403);
  assert.equal((await post(db, FOUNDER, '/api/decks/99/remix', { card: TRACTION })).status, 404);
});

test('Remix is free by construction: neither the route nor the service reaches the router, the budget or a model', () => {
  const src = ['cloudflare-worker/src/routes/deck_remix.ts', 'cloudflare-worker/src/services/decks/remix.ts']
    .map((f) => readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  assert.doesNotMatch(src, /aiRouter|aiBudget|reserveAiBudget|aiPaused|\.AI\b|INSERT |UPDATE |DELETE /);
  assert.match(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8'), /app\.route\('\/api\/decks', deckRemix\);/);
});
