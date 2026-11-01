/**
 * D1554 (#3801, deck v2 C6) — Magic Switch: 16:9 ↔ 4:3 with no overflow.
 *
 *  · `textCapacity` and `fitProblems` take the aspect; at 16:9 they are what
 *    they were, and at 4:3 a range never holds more;
 *  · one fixture per structure (17): every area filled to its 16:9 capacity,
 *    a figure on Big number. Reflowed to 4:3 the deck has zero `fitProblems`,
 *    no word is lost (kept + notes = the original), and back to 16:9 nothing
 *    moves;
 *  · the editor's mirror (`deckReflow.js`) gives the same result on every
 *    fixture, and the same capacities on every range;
 *  · `GET /api/decks/:id/grid?aspect=` serves the reflow and the reflow map;
 *    any other aspect is 400 `invalid_aspect`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_reflow_d1554.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckGrid from '../src/routes/deck_grid.ts';
import { DENSITY_MAX, TYPE_SCALE, boxOf, fitProblems, metricValueChars, textCapacity, type TypeRole } from '../src/services/decks/designSystem.ts';
import { GRID_COLS, GRID_ROWS, NOTES_MAX } from '../src/services/decks/slideModel.ts';
import { STRUCTURES } from '../src/services/decks/structures.ts';
import { MOVED_HEADING, fitWords, fitsAt, reflowMap, reflowSlides } from '../src/services/decks/reflow.ts';
import * as front from '../../frontend/src/pages/raise/pitch/deckReflow.js';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const ROLES = Object.keys(TYPE_SCALE) as TypeRole[];
const ALL_RANGES = (() => {
  const out: Array<{ c1: number; c2: number; r1: number; r2: number }> = [];
  for (let c1 = 1; c1 <= GRID_COLS; c1++) for (let c2 = c1; c2 <= GRID_COLS; c2++) for (let r1 = 1; r1 <= GRID_ROWS; r1++) for (let r2 = r1; r2 <= GRID_ROWS; r2++) out.push({ c1, c2, r1, r2 });
  return out;
})();

/** Synthetic words, exactly `n` characters, ending on a letter. */
function words(n: number, seed = 0): string {
  const pool = ['signal', 'pilot', 'buyer', 'cohort', 'margin', 'ledger', 'runway', 'churn', 'quota', 'funnel'];
  let s = '';
  for (let i = seed; s.length < n; i++) s += (s ? ' ' : '') + pool[i % pool.length];
  s = s.slice(0, n);
  return s.endsWith(' ') ? `${s.slice(0, -1)}x` : s;
}
const wordsOf = (t: string) => t.split(/\s+/).filter(Boolean);

/** One card per structure: each area holds a paragraph at its 16:9 capacity; Big number's first area holds a figure. */
const FIXTURES = STRUCTURES.map((s) => ({
  structure: s.id,
  card: {
    layout: 'two_columns',
    structure: s.id,
    areas: s.areas,
    notes: 'Synthetic opening note',
    blocks: s.areas.map((a, i) => (s.id === 'big_number' && i === 0
      ? { id: `m${i}`, kind: 'metric', grid: { c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 }, label: 'Synthetic ARR', value: '9'.repeat(metricValueChars(a, '16:9')) }
      : { id: `t${i}`, kind: 'text', grid: { c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 }, style: 'paragraph', text: words(textCapacity(a, 'paragraph').chars, i) })),
  },
}));

// 1 ───────────────────────────────────────────────────────────────────────────
test('capacity at an aspect: 16:9 is what it was, 4:3 never holds more, and fitProblems reads the aspect', () => {
  // Mutation checked: textCapacity ignoring its aspect → the "4:3 holds less somewhere" assert fails.
  let less = 0;
  for (const g of ALL_RANGES) for (const role of ROLES) {
    const { w, h } = boxOf(g);
    const t = TYPE_SCALE[role];
    const old = Math.min(Math.max(1, Math.floor(h / (t.size * t.leading))) * Math.max(1, Math.floor(w / (t.size * 0.52))), DENSITY_MAX[role]);
    assert.equal(textCapacity(g, role).chars, old, `${role} ${JSON.stringify(g)}`);
    assert.ok(textCapacity(g, role, '4:3').chars <= textCapacity(g, role, '16:9').chars);
    if (textCapacity(g, role, '4:3').chars < old) less += 1;
    assert.ok(metricValueChars(g, '4:3') <= metricValueChars(g, '16:9'));
  }
  assert.ok(less > 0, '4:3 holds less somewhere');
  const card = { layout: 'two_columns', blocks: [{ id: 'p', kind: 'text', style: 'paragraph', grid: { c1: 1, c2: 4, r1: 2, r2: 3 }, text: words(textCapacity({ c1: 1, c2: 4, r1: 2, r2: 3 }, 'paragraph').chars) }] };
  assert.deepEqual(fitProblems([card]), []);
  assert.deepEqual(fitProblems([card], '16:9'), []);
  const at43 = fitProblems([card], '4:3');
  assert.equal(at43.length, 1);
  assert.match(at43[0].message, /at 4:3\.$/);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('one fixture per structure: at 4:3 zero fitProblems, every word kept or in the notes, and back to 16:9 nothing moves', () => {
  // Mutations checked: fitWords cutting mid-word → the word-preservation assert fails; the moved text not
  // written to the notes → the notes assert fails. (Big number's tile holds a 14-character figure at both
  // aspects; a narrower tile's figure moving is test 3's, where leaving it on the slide fails.)
  assert.equal(FIXTURES.length, 17);
  let total = 0;
  for (const { structure, card } of FIXTURES) {
    assert.deepEqual(fitProblems([card], '16:9'), [], `${structure} fits at 16:9`);
    const r = reflowSlides([card], '4:3');
    assert.deepEqual(fitProblems(r.slides, '4:3'), [], `${structure}: zero fitProblems at 4:3`);
    assert.ok(fitsAt(r.slides, '4:3'));
    const after = r.slides[0];
    // Nothing is lost: each block's kept words, then its moved words, are its original words.
    for (const b of card.blocks) {
      const kept = after.blocks.find((x: any) => x.id === b.id);
      const moved = r.moved.find((m) => m.block === b.id);
      if (b.kind === 'text') {
        const back = [...wordsOf(kept?.text ?? ''), ...wordsOf(moved?.text ?? '')];
        assert.deepEqual(back, wordsOf(b.text!), `${structure} ${b.id}`);
        if (moved) assert.ok(after.notes.includes(moved.text), `${structure} ${b.id} is in the notes`);
      } else if (moved) {
        assert.equal(kept, undefined, 'a figure that no longer fits leaves the slide');
        assert.ok(after.notes.includes(`Synthetic ARR: ${b.value}`));
      }
      // The block keeps its cells.
      if (kept) assert.deepEqual(kept.grid, b.grid);
    }
    if (r.count) {
      assert.ok(after.notes.startsWith('Synthetic opening note\n\n'), 'the founder\'s notes come first');
      assert.ok(after.notes.includes(MOVED_HEADING('4:3')));
    } else assert.equal(after, card, 'a card with nothing to move is the same card');
    assert.deepEqual(after.areas, card.areas, 'the areas never change');
    total += r.count;
    // Back to 16:9: every range is wider, so nothing moves.
    const back = reflowSlides(r.slides, '16:9', '4:3');
    assert.equal(back.count, 0);
    assert.deepEqual(back.slides, r.slides);
  }
  assert.ok(total > 0, 'some structure moves something');
  assert.ok(reflowSlides(FIXTURES.map((f) => f.card), '4:3').count === total);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the cut: a word boundary, a block with no word that fits leaves the slide, and the notes stay within 4,000', () => {
  assert.equal(fitWords('alpha beta gamma', 11), 'alpha beta');
  assert.equal(fitWords('alpha beta gamma', 10), 'alpha beta');
  assert.equal(fitWords('alpha beta gamma', 16), 'alpha beta gamma');
  assert.equal(fitWords('Supercalifragilistic', 5), '');
  const g = { c1: 1, c2: 1, r1: 1, r2: 1 };
  const cap = textCapacity(g, 'paragraph', '4:3').chars;
  const long = 'x'.repeat(cap + 3);
  const r = reflowSlides([{ blocks: [{ id: 'w', kind: 'text', style: 'paragraph', grid: g, text: long }] }], '4:3');
  assert.deepEqual([r.count, r.moved[0].kind, r.slides[0].blocks.length], [1, 'removed', 0]);
  assert.ok(r.slides[0].notes.endsWith(long));
  const full = reflowSlides([{ notes: 'n'.repeat(NOTES_MAX), blocks: [{ id: 'w', kind: 'text', style: 'paragraph', grid: g, text: long }] }], '4:3');
  assert.equal(full.slides[0].notes.length, NOTES_MAX);
  // A figure that outgrows its tile at 4:3 leaves the slide; its label and figure go to the notes.
  const tile = ALL_RANGES.find((r) => r.r2 - r.r1 >= 1 && metricValueChars(r, '4:3') < metricValueChars(r, '16:9'))!;
  assert.ok(tile, 'some tile holds a shorter figure at 4:3');
  const value = '9'.repeat(metricValueChars(tile, '16:9'));
  const m = reflowSlides([{ blocks: [{ id: 'm', kind: 'metric', grid: tile, label: 'Synthetic ARR', value }] }], '4:3');
  assert.deepEqual(fitProblems([{ blocks: [{ id: 'm', kind: 'metric', grid: tile, label: 'Synthetic ARR', value }] }], '16:9'), []);
  assert.deepEqual([m.count, m.moved[0].kind, m.slides[0].blocks.length], [1, 'removed', 0]);
  assert.equal(m.slides[0].notes, `${MOVED_HEADING('4:3')}\nSynthetic ARR: ${value}`);
  assert.deepEqual(fitProblems(m.slides, '4:3'), []);
  assert.deepEqual(front.reflowCards([{ blocks: [{ id: 'm', kind: 'metric', grid: tile, label: 'Synthetic ARR', value }] }], '4:3').cards, m.slides);
  // A card that is not a card, or has no blocks, passes through.
  assert.deepEqual(reflowSlides([null, { title: 'x' }], '4:3').slides, [null, { title: 'x' }]);
  assert.deepEqual(reflowSlides('nope', '4:3').slides, []);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the editor\'s mirror: the same capacities on every range, and the same reflow on every fixture', () => {
  // Mutation checked: the mirror's paragraph leading drifting (1.4 → 1.5) → the capacity parity fails.
  for (const g of ALL_RANGES) for (const aspect of ['16:9', '4:3'] as const) {
    for (const role of ROLES) assert.equal(front.textCapacity(g, role, aspect), textCapacity(g, role, aspect).chars, `${role} ${aspect} ${JSON.stringify(g)}`);
    assert.equal(front.metricValueChars(g, aspect), metricValueChars(g, aspect));
  }
  assert.deepEqual(front.DENSITY_MAX, DENSITY_MAX);
  assert.equal(front.NOTES_MAX, NOTES_MAX);
  for (const to of ['4:3', '16:9'] as const) {
    const cards = FIXTURES.map((f) => f.card);
    const w = reflowSlides(cards, to);
    const f = front.reflowCards(cards, to);
    assert.deepEqual(f.cards, w.slides, to);
    assert.deepEqual(f.moved, w.moved, to);
    assert.equal(f.count, w.count);
  }
  assert.equal(front.movedNotice(2), '2 blocks no longer fit and moved to the speaker notes.');
  assert.equal(front.movedNotice(1), '1 block no longer fits and moved to the speaker notes.');
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the reflow map: each structure\'s areas at both aspects; rows and heights stay, only widths narrow', () => {
  const map = reflowMap();
  assert.deepEqual(map.map((s) => s.id), STRUCTURES.map((s) => s.id));
  for (const s of map) for (const a of s.areas) {
    assert.equal(a.boxes['4:3'].h, a.boxes['16:9'].h);
    assert.equal(a.boxes['4:3'].y, a.boxes['16:9'].y);
    assert.ok(a.boxes['4:3'].w < a.boxes['16:9'].w && a.width_kept > 0.7 && a.width_kept < 1, `${s.id} ${a.id}`);
  }
});

// 6 ───────────────────────────────────────────────────────────────────────────
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
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current, theme_json) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(1, P, 1, 'Synthetic deck', JSON.stringify(FIXTURES.map((f) => f.card)), null);
  return db;
}
async function get(db: DatabaseSync, who: number, path: string) {
  const app = new Hono<any>();
  app.route('/api/decks', deckGrid);
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('GET /api/decks/:id/grid?aspect=4:3 serves what would move and the reflow map; a bad aspect is 400; it writes nothing', async () => {
  // Mutation checked: the route reflowing to the deck's own aspect instead of the asked one → count 0, the assert fails.
  const db = world();
  const plain = await get(db, FOUNDER, '/api/decks/1/grid');
  assert.equal(plain.status, 200);
  assert.equal('reflow' in plain.body, false, 'no aspect asked, no reflow');
  const r = await get(db, FOUNDER, `/api/decks/1/grid?aspect=${encodeURIComponent('4:3')}`);
  assert.equal(r.status, 200);
  const want = reflowSlides(FIXTURES.map((f) => f.card), '4:3');
  assert.deepEqual(r.body.reflow, { from: '16:9', to: '4:3', count: want.count, moved: want.moved });
  assert.ok(r.body.reflow.count > 0);
  assert.equal(r.body.reflow_map.length, 17);
  assert.equal(r.body.aspect, '16:9', 'the read keeps the saved aspect');
  const same = await get(db, FOUNDER, `/api/decks/1/grid?aspect=${encodeURIComponent('16:9')}`);
  assert.equal(same.body.reflow.count, 0);
  const bad = await get(db, FOUNDER, '/api/decks/1/grid?aspect=1:1');
  assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_aspect']);
  assert.equal((await get(db, OTHER, `/api/decks/1/grid?aspect=${encodeURIComponent('4:3')}`)).status, 403);
  assert.equal((db.prepare('SELECT slides FROM pitch_decks WHERE id = 1').get() as any).slides, JSON.stringify(FIXTURES.map((f) => f.card)), 'the read writes nothing');
});
