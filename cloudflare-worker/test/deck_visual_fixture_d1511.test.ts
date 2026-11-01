/**
 * D1511 (#3762, deck v2 A18) — what the visual suite mounts
 * (`frontend/tests/visual/fixture.json`), held to the Worker's own modules so
 * the screenshots follow `main` without a hand-made copy:
 *
 *   · GET /api/decks/model, as `routes/decks.ts` answers it, with every theme
 *     `slideModel.ts` serves (THEME_KINDS, which BASE_THEMES gives tokens);
 *   · one card per structure (all 17, `structures.ts`), and GET
 *     /api/decks/:id/grid for that deck at each aspect, as `routes/deck_grid.ts`
 *     builds it;
 *   · the accepted one-click deck: the full sample venture's standard deck for
 *     a seed fund, built by `buildCards` with its recorded words, in the theme
 *     one-click picks with no brand kit (Neutral light), with no placeholder
 *     drawn and no fit problem.
 *
 * When any of those change on purpose, regenerate the fixture:
 *   UPDATE_VISUAL_FIXTURE=1 node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/deck_visual_fixture_d1511.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCards, standardOutline } from '../src/services/decks/newDeck.ts';
import { fitProblems } from '../src/services/decks/designSystem.ts';
import {
  AUDIENCES, BLOCK_KINDS, CHART_RANGES, CHART_TYPES, GRID_COLS, GRID_ROWS, IMAGE_FITS, IMAGE_TAGS, LAYOUTS, MAX_BLOCKS,
  NOTES_MAX, OVERLAYS, TEXT_STYLES, THEME_KINDS, VIDEO_RATIOS,
} from '../src/services/decks/slideModel.ts';
import { ASPECTS, BASELINE, FRAME, SLIDE_SIZES, STRUCTURES, areasOf, boxOfAt, cellAt, type Aspect } from '../src/services/decks/structures.ts';
import { sanitizeSlides } from '../src/routes/decks.ts';
import { fullRecords, wordsFor } from './fixtures/pitchStoryFixtures.ts';

const FILE = 'frontend/tests/visual/fixture.json';
const WORDS = ['Close the books in a day', 'Finance teams asked for it', 'Every ledger reconciled', 'One place for the close'];

/** GET /api/decks/:id/grid for `slides` at `aspect`, as `routes/deck_grid.ts` builds it. */
function gridOf(slides: any[], aspect: Aspect) {
  const boxes = (list: any[]) => list.map((a) => ({ ...a, box: boxOfAt(a, aspect) }));
  return {
    deck_id: 31, version: 3, aspect, slide: SLIDE_SIZES[aspect], frame: FRAME, cell: cellAt(aspect), baseline: BASELINE,
    grid: { cols: GRID_COLS, rows: GRID_ROWS },
    structures: STRUCTURES.map((s) => ({ ...s, areas: boxes(s.areas) })),
    cards: slides.map((card, index) => { const r = areasOf(card); return { index, structure: r.structure, derived: r.derived, areas: boxes(r.areas) }; }),
  };
}

function fixture() {
  const cards = sanitizeSlides(STRUCTURES.map((s) => ({
    title: s.label, structure: s.id, areas: s.areas,
    blocks: s.areas.map((a, i) => ({
      id: `b${i + 1}`, kind: 'text', grid: { c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 },
      style: i === 0 ? 'heading' : 'paragraph', text: i === 0 ? s.label : WORDS[i % WORDS.length],
    })),
  })));
  const rec = fullRecords();
  const rows = standardOutline('standard', 'seed_fund');
  const built = buildCards(rows, rec.items as any, wordsFor(rows), 'Synthetic venture', new Set(), { series: rec.series as any, diagrams: rec.diagrams as any, rows: rec.rows });
  const oneClick = sanitizeSlides(built.slides);
  return {
    problems: built.problems,
    fixture: {
      model: {
        grid: { cols: GRID_COLS, rows: GRID_ROWS }, max_blocks: MAX_BLOCKS, notes_max: NOTES_MAX, layouts: LAYOUTS,
        block_kinds: BLOCK_KINDS, chart_types: CHART_TYPES, chart_ranges: CHART_RANGES, text_styles: TEXT_STYLES,
        image_tags: IMAGE_TAGS, image_fits: IMAGE_FITS, overlays: OVERLAYS, video_ratios: VIDEO_RATIOS, audiences: AUDIENCES, themes: THEME_KINDS,
      },
      themes: THEME_KINDS,
      aspects: ASPECTS,
      structures: STRUCTURES.map((s) => ({ id: s.id, label: s.label })),
      cards,
      grids: Object.fromEntries(ASPECTS.map((a) => [a, gridOf(cards, a)])),
      oneclick: { theme: 'neutral_light', slides: oneClick, grid: gridOf(oneClick, '16:9') },
    },
  };
}

test('the visual suite\'s fixture is the Worker\'s own model, structures, grid and one-click build', () => {
  const { problems, fixture: f } = fixture();
  assert.deepEqual(problems, []);
  if (process.env.UPDATE_VISUAL_FIXTURE) writeFileSync(FILE, `${JSON.stringify(f)}\n`);
  assert.deepEqual(JSON.parse(readFileSync(FILE, 'utf8')), JSON.parse(JSON.stringify(f)), 'the Worker changed: regenerate frontend/tests/visual/fixture.json');
  assert.equal(f.structures.length, 17);
  assert.equal(f.cards.length, 17);
  assert.deepEqual([...f.aspects], ['16:9', '4:3']);
});

test('the accepted one-click deck draws no placeholder and has no fit problem', () => {
  const { fixture: f } = fixture();
  assert.deepEqual(fitProblems(f.oneclick.slides.filter((s: any) => !s.appendix)), []);
  const drawn = f.oneclick.slides.flatMap((s: any) => s.blocks ?? []);
  assert.equal(drawn.filter((b: any) => (b.kind === 'text' && /Not recorded/.test(String(b.text ?? ''))) || (b.kind === 'metric' && (b.value == null || b.value === ''))).length, 0);
});
