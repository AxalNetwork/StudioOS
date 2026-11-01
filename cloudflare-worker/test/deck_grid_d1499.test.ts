/**
 * D1499 (#3749, deck v2 A2) — The Grid: the 17 structures, their areas,
 * `deriveAreas`, the 16:9 and 4:3 geometry, the save rules and
 * `GET /api/decks/:id/grid`.
 *
 *  · every structure's areas cover whole cells, never overlap, at most 12;
 *  · `boxOfAt` at 16:9 is `designSystem.boxOf`, and the frontend's
 *    `gridModel.js` is the same catalogue and the same boxes at both aspects;
 *  · a deck saved before v2 opens unchanged: its areas are derived from its
 *    blocks, and `deriveAreas` round-trips;
 *  · a half cell, an overlap or a thirteenth area is refused at save.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_grid_d1499.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckGrid from '../src/routes/deck_grid.ts';
import { boxOf, FRAME as DS_FRAME, SLIDE as DS_SLIDE } from '../src/services/decks/designSystem.ts';
import { GRID_COLS, GRID_ROWS, LAYOUTS, modelProblems, sanitizeModel, sanitizeTheme } from '../src/services/decks/slideModel.ts';
import {
  BASELINE, FRAME, MAX_AREAS, SLIDE_SIZES, STRUCTURES, STRUCTURE_IDS, areasOf, areasProblem, boxOfAt, cellAt, deriveAreas, sanitizeAreas,
} from '../src/services/decks/structures.ts';
import * as front from '../../frontend/src/pages/raise/pitch/gridModel.js';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const url = (u: string | null | undefined) => (typeof u === 'string' && u.startsWith('https://') ? u : null);
const ALL_RANGES = (() => {
  const out: Array<{ c1: number; c2: number; r1: number; r2: number }> = [];
  for (let c1 = 1; c1 <= GRID_COLS; c1++) for (let c2 = c1; c2 <= GRID_COLS; c2++) for (let r1 = 1; r1 <= GRID_ROWS; r1++) for (let r2 = r1; r2 <= GRID_ROWS; r2++) out.push({ c1, c2, r1, r2 });
  return out;
})();

// 1 ───────────────────────────────────────────────────────────────────────────
test('the catalogue: 17 structures, whole cells, no overlap, at most 12 areas; Seed recommends Hero + 3 and Big number', () => {
  assert.equal(STRUCTURES.length, 17);
  assert.deepEqual(STRUCTURES.map((s) => s.label), ['Full', 'Title band + body', 'Halves', 'Split 7/5', 'Split 5/7', 'Sidebar 4/8', 'Sidebar 8/4', 'Thirds', 'Hero + 3', 'Quarters', '2×2', 'Big number', 'Team', 'Timeline band', 'Z-pattern', 'Overlay', 'Appendix table']);
  assert.equal(new Set(STRUCTURE_IDS).size, 17);
  for (const s of STRUCTURES) {
    assert.equal(areasProblem(s.areas), null, s.id);
    assert.ok(s.areas.length >= 1 && s.areas.length <= MAX_AREAS, s.id);
    assert.deepEqual(s.areas.map((a) => a.order), s.areas.map((_, i) => i + 1), `${s.id} reading order`);
  }
  assert.deepEqual(STRUCTURES.filter((s) => s.recommended?.includes('seed')).map((s) => s.id), ['hero_3', 'big_number']);
  const split = STRUCTURES.find((s) => s.id === 'split_7_5')!;
  assert.deepEqual(split.areas.map((a) => a.c2 - a.c1 + 1), [7, 5]);
  assert.equal(STRUCTURES.find((s) => s.id === 'team')!.areas.length, 8);
  assert.equal(STRUCTURES.find((s) => s.id === 'overlay')!.background, 'image');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('one geometry: boxOfAt at 16:9 is boxOf for every range; the frontend mirrors catalogue and boxes at both aspects', () => {
  // Mutations checked: gridModel.boxOf with a CSS-like 3% padding and 8px gap → the frontend box assert fails;
  // structures.ts's FRAME drifting from designSystem's → the frame assert fails.
  assert.deepEqual(FRAME, DS_FRAME);
  assert.deepEqual(SLIDE_SIZES['16:9'], { width: DS_SLIDE.width, height: DS_SLIDE.height });
  assert.deepEqual(SLIDE_SIZES['4:3'], { width: 1440, height: 1080 });
  assert.equal(BASELINE, 8);
  for (const g of ALL_RANGES) {
    assert.deepEqual(boxOfAt(g, '16:9'), boxOf(g), JSON.stringify(g));
    for (const aspect of ['16:9', '4:3'] as const) assert.deepEqual(front.boxOf(g, aspect), boxOfAt(g, aspect), `${aspect} ${JSON.stringify(g)}`);
  }
  // 4:3 keeps the grid and margins; only the cells narrow.
  assert.equal(cellAt('4:3').height, cellAt('16:9').height);
  assert.ok(cellAt('4:3').width < cellAt('16:9').width);
  assert.deepEqual(boxOfAt({ c1: 1, c2: 12, r1: 1, r2: 6 }, '4:3'), { x: 112, y: 96, w: 1440 - 224, h: 1080 - 96 - 88 });
  // The catalogue's parity: ids, names, uses, areas and flags.
  const strip = (s: any) => ({ id: s.id, label: s.label, use: s.use, background: s.background ?? null, recommended: s.recommended ?? null,
    areas: s.areas.map((a: any) => ({ id: a.id, c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2, order: a.order, role: a.role ?? null })) });
  assert.deepEqual(front.STRUCTURES.map(strip), STRUCTURES.map(strip));
  assert.deepEqual(front.FRAME, FRAME);
  assert.deepEqual(front.GRID, { cols: GRID_COLS, rows: GRID_ROWS });
  // A clicked point maps back to the cell `boxOf` drew, at both aspects; a gutter is no cell.
  for (const aspect of ['16:9', '4:3'] as const) {
    for (const g of ALL_RANGES.filter((r) => r.c1 === r.c2 && r.r1 === r.r2)) {
      const b = front.boxOf(g, aspect);
      assert.deepEqual(front.cellAtPoint(b.x + b.w / 2, b.y + b.h / 2, aspect), { c: g.c1, r: g.r1 }, `${aspect} ${g.c1},${g.r1}`);
    }
    const first = front.boxOf({ c1: 1, c2: 1, r1: 1, r2: 1 }, aspect);
    assert.equal(front.cellAtPoint(first.x + first.w + FRAME.gutter / 2, first.y + 5, aspect), null, 'the gutter');
    assert.equal(front.cellAtPoint(10, 10, aspect), null, 'the margin');
  }
  assert.equal(front.stageScale(960, 540, '16:9'), 0.5);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the save rules: a half cell, an overlap, a thirteenth area, a repeated id or an unknown structure is refused', () => {
  // Mutations checked: whole() accepting a fraction → the half-cell assert fails; the overlap test dropped → its assert fails.
  const ok = [{ id: 'a', c1: 1, c2: 6, r1: 1, r2: 6 }, { id: 'b', c1: 7, c2: 12, r1: 1, r2: 6 }];
  assert.equal(areasProblem(ok), null);
  assert.match(areasProblem([{ id: 'a', c1: 1, c2: 6.5, r1: 1, r2: 6 }])!, /whole cells/);
  assert.match(areasProblem([{ id: 'a', c1: 0, c2: 6, r1: 1, r2: 6 }])!, /whole cells/);
  assert.match(areasProblem([{ id: 'a', c1: 1, c2: 7, r1: 1, r2: 6 }, { id: 'b', c1: 7, c2: 12, r1: 1, r2: 6 }])!, /overlaps/);
  assert.match(areasProblem(Array.from({ length: 13 }, (_, i) => ({ id: `a${i}`, c1: 1, c2: 1, r1: 1, r2: 1 })))!, /at most 12/);
  assert.match(areasProblem([{ id: 'a', c1: 1, c2: 1, r1: 1, r2: 1 }, { id: 'a', c1: 2, c2: 2, r1: 1, r2: 1 }])!, /repeats/);
  assert.match(areasProblem([{ id: 'a', c1: 1, c2: 1, r1: 1, r2: 1, inset: 5 }])!, /inset/);
  const card = { layout: 'two_columns', structure: 'halves', areas: ok, blocks: [] };
  assert.deepEqual(modelProblems([card], url), []);
  assert.deepEqual(modelProblems([{ ...card, structure: 'nope' }], url), ['Card 1: the structure is not one of the seventeen.']);
  assert.deepEqual(modelProblems([{ ...card, areas: [{ id: 'a', c1: 1.5, c2: 6, r1: 1, r2: 6 }] }], url).length, 1);
  // A sound save keeps both; an unsound one keeps neither part it got wrong.
  const kept = sanitizeModel(card, url) as any;
  assert.equal(kept.structure, 'halves');
  assert.deepEqual(kept.areas.map((a: any) => [a.id, a.inset, a.align, a.order]), [['a', 0, 'start', 1], ['b', 0, 'start', 2]]);
  assert.equal((sanitizeModel({ ...card, areas: [{ id: 'a', c1: 1, c2: 6.5, r1: 1, r2: 6 }] }, url) as any).areas, undefined);
  assert.equal(sanitizeAreas([{ id: 'a', c1: 1, c2: 13, r1: 1, r2: 1 }]), null);
  // The theme keeps 4:3 and leaves 16:9 out, so an old deck's theme is unchanged.
  assert.deepEqual(sanitizeTheme({ kind: 'brand', aspect: '4:3' }, url), { kind: 'brand', background: null, aspect: '4:3' });
  assert.deepEqual(sanitizeTheme({ kind: 'brand', aspect: '16:9' }, url), { kind: 'brand', background: null });
  assert.deepEqual(sanitizeTheme({ kind: 'brand' }, url), { kind: 'brand', background: null });
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('deriveAreas: one area per block in reading order, round-trips, and an empty card is one Full area', () => {
  // Mutation checked: deriveAreas keeping an overlapping block → the overlap assert fails.
  for (const l of LAYOUTS) {
    const areas = deriveAreas(l.blocks);
    assert.equal(areasProblem(areas), null, l.id);
    // Round trip: every block's range is exactly one area's, and back.
    const key = (g: any) => `${g.c1}-${g.c2}-${g.r1}-${g.r2}`;
    assert.deepEqual(new Set(areas.map(key)), new Set(l.blocks.map((b) => key(b.grid))), l.id);
    assert.deepEqual(deriveAreas(areas.map((a) => ({ grid: a }))).map(key), areas.map(key), `${l.id} again`);
  }
  assert.deepEqual(deriveAreas([]).map((a) => [a.c1, a.c2, a.r1, a.r2]), [[1, 12, 1, 6]]);
  const over = deriveAreas([{ grid: { c1: 1, c2: 6, r1: 1, r2: 6 } }, { grid: { c1: 4, c2: 8, r1: 1, r2: 2 } }, { grid: { c1: 7, c2: 12, r1: 1, r2: 6 } }]);
  assert.deepEqual(over.map((a) => [a.c1, a.c2]), [[1, 6], [7, 12]], 'an overlapping block gets no area');
  assert.deepEqual(deriveAreas([{ grid: { c1: 7, c2: 12, r1: 1, r2: 1 } }, { grid: { c1: 1, c2: 6, r1: 2, r2: 6 } }, { grid: { c1: 1, c2: 6, r1: 1, r2: 1 } }]).map((a) => [a.id, a.c1, a.r1]),
    [['a1', 1, 1], ['a2', 7, 1], ['a3', 1, 2]], 'top to bottom, then left to right');
  // A card with sound areas keeps them; a card without reads derived ones.
  assert.deepEqual(areasOf({ structure: 'halves', areas: STRUCTURES[2].areas }).derived, false);
  assert.deepEqual(areasOf({ structure: 'mystery', areas: STRUCTURES[2].areas }).structure, 'custom');
  assert.deepEqual(areasOf({ blocks: LAYOUTS[0].blocks }).derived, true);
});

// 5 ───────────────────────────────────────────────────────────────────────────
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
  const old = [{ layout: 'chart_text', blocks: LAYOUTS.find((l) => l.id === 'chart_text')!.blocks }];
  const v2 = [{ structure: 'hero_3', areas: STRUCTURES.find((s) => s.id === 'hero_3')!.areas, blocks: [] }];
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current, theme_json) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(1, P, 1, 'Pre-v2 deck', JSON.stringify(old), null);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current, theme_json) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(2, P, 2, 'v2 deck', JSON.stringify(v2), JSON.stringify({ kind: 'brand', aspect: '4:3' }));
  return db;
}
async function get(db: DatabaseSync, who: number, path: string) {
  const app = new Hono<any>();
  app.route('/api/decks', deckGrid);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('GET /api/decks/:id/grid: an old deck opens unchanged with derived areas; a v2 deck at 4:3 keeps its own, each with its box', async () => {
  const db = world();
  const old = await get(db, FOUNDER, '/api/decks/1/grid');
  assert.equal(old.status, 200);
  assert.deepEqual([old.body.aspect, old.body.slide, old.body.baseline, old.body.grid], ['16:9', { width: 1920, height: 1080 }, 8, { cols: 12, rows: 6 }]);
  assert.equal(old.body.structures.length, 17);
  const card = old.body.cards[0];
  assert.deepEqual([card.structure, card.derived, card.areas.length], ['custom', true, 3]);
  for (const a of card.areas) assert.deepEqual(a.box, boxOf(a), a.id);
  const v2 = await get(db, FOUNDER, '/api/decks/2/grid');
  assert.deepEqual([v2.body.aspect, v2.body.slide.width, v2.body.cards[0].structure, v2.body.cards[0].derived], ['4:3', 1440, 'hero_3', false]);
  for (const a of v2.body.cards[0].areas) assert.deepEqual(a.box, boxOfAt(a, '4:3'), a.id);
  assert.equal((await get(db, OTHER, '/api/decks/1/grid')).status, 403);
  assert.equal((await get(db, FOUNDER, '/api/decks/99/grid')).status, 404);
});
