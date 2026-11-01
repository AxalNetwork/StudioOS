/**
 * D1517 (#3769, deck v2 A6) — the quality floor: type scale, step-down fit,
 * six themes, the chart rules table, art on any image area, words written to
 * their areas, fix-or-drop, and the code rubric on the three sample ventures.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_quality_floor_d1517.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASELINE, BASE_THEMES, DARK_THEMES, MIN_TYPE_SIZE, TYPE_SCALE, TYPE_STEPS, fitProblems, fitText, isDarkTheme, lineHeight,
  singleWordLine, textCapacity, themeProblems, themeTokens, wrapBalanced, wrapGreedy,
} from '../src/services/decks/designSystem.ts';
import { BASELINE as GRID_BASELINE } from '../src/services/decks/structures.ts';
import { CHART_TYPES, THEME_KINDS, sanitizeTheme } from '../src/services/decks/slideModel.ts';
import { CHART_RULES, artDirection, chartRuleFor, chartTypeFor, imagePlan } from '../src/services/decks/visuals.ts';
import { buildCards, buildMessage, fixOrDrop, shortenToFit, standardOutline, wordBudget } from '../src/services/decks/newDeck.ts';
import { RUBRIC_GATE, deckRubric, placeholders } from '../src/services/decks/rubric.ts';
import { conflictingRecords, fullRecords, sparseRecords, wordsFor } from './fixtures/pitchStoryFixtures.ts';

const G = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });

// ── 1. The type scale ────────────────────────────────────────────────────

test('1. every line sits on the 8 px baseline, the scale has a kicker, and each role steps down within the scale', () => {
  assert.equal(BASELINE, GRID_BASELINE, 'the Grid\'s baseline');
  assert.ok(TYPE_SCALE.kicker && TYPE_SCALE.caption);
  for (const [role, t] of Object.entries(TYPE_SCALE)) {
    assert.equal(lineHeight(t.size, t.leading) % BASELINE, 0, role);
    assert.ok(lineHeight(t.size, t.leading) >= t.size * t.leading, `${role}: never tighter than its leading`);
    const steps = TYPE_STEPS[role as keyof typeof TYPE_STEPS];
    assert.equal(steps[0], t.size, `${role} starts at its own size`);
    for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i] < steps[i - 1], `${role} steps down`);
    assert.ok(steps.every((s) => s >= MIN_TYPE_SIZE), `${role} never under ${MIN_TYPE_SIZE}px`);
  }
  // A capacity counts baseline lines: a 1-row paragraph range holds floor(h / 48) lines at 32px.
  assert.equal(textCapacity(G(1, 12, 1, 1), 'paragraph').lines, Math.floor(116 / 48));
});

// ── 2. Wrap and step-down fit ────────────────────────────────────────────

test('2. the wrap is balanced, and a title never ends on one word its line above could share', () => {
  const text = 'Close the books in one day with every ledger reconciled';
  const greedy = wrapGreedy(text, 40);
  const balanced = wrapBalanced(text, 40);
  assert.equal(balanced.length, greedy.length);
  const spread = (ls: string[]) => Math.max(...ls.map((l) => l.length)) - Math.min(...ls.map((l) => l.length));
  assert.ok(spread(balanced) < spread(greedy), 'the lines are more even');
  assert.equal(singleWordLine(['Close the books in one', 'day']), true);
  const title = wrapBalanced('Finance teams close their books in one day', 38, true);
  assert.equal(singleWordLine(title), false, title.join(' / '));
  // The balance alone leaves "every" alone; a title takes a word down from the line above.
  assert.deepEqual(wrapBalanced('finance finance day ledger day every', 16), ['finance finance', 'day ledger day', 'every']);
  assert.deepEqual(wrapBalanced('finance finance day ledger day every', 16, true), ['finance finance', 'day ledger', 'day every']);
});

test('2. a title line of one word the balance cannot mend is reported, and the rubric counts it', () => {
  const card = { layout: 'two_columns', blocks: [{ id: 'h', kind: 'text', style: 'heading', grid: G(1, 4, 1, 6), text: 'day ready audit currency reconcile review entity review day review' }] };
  const [p] = fitProblems([card]);
  assert.equal(p?.kind, 'single_word_line');
  assert.deepEqual(deckRubric([card]).checks.map((c) => c.id), ['titles']);
});

test('2. a text that overflows its own size steps down before it overflows; only the smallest step can overflow', () => {
  const g = G(1, 12, 1, 1);
  assert.equal(fitText(g, 'heading', 'Close in a day').size, TYPE_SCALE.heading.size, 'a text that fits keeps its own size');
  const stepped = fitText(g, 'heading', 'Finance teams lose a week every month closing books');
  assert.equal(stepped.fits, true);
  assert.ok(stepped.size < TYPE_SCALE.heading.size, `stepped to ${stepped.size}`);
  assert.deepEqual(fitProblems([{ layout: 'two_columns', blocks: [{ id: 'h', kind: 'text', style: 'heading', grid: g, text: 'Finance teams lose a week every month closing books' }] }]), []);
  const never = 'word '.repeat(60);
  const over = fitProblems([{ layout: 'statement', blocks: [{ id: 'p', kind: 'text', style: 'paragraph', grid: G(1, 3, 1, 1), text: never }] }]);
  assert.equal(over[0].kind, 'overflow');
  assert.match(over[0].message, new RegExp(`${TYPE_STEPS.paragraph.at(-1)}px`));
});

// ── 3. Six themes ────────────────────────────────────────────────────────

test('3. six themes, each legible, served as the model\'s theme kinds; Ocean draws dark', () => {
  assert.deepEqual([...THEME_KINDS], ['brand', 'neutral_light', 'neutral_dark', 'sand', 'ocean', 'forest']);
  assert.deepEqual(Object.keys(BASE_THEMES).sort(), [...THEME_KINDS].sort());
  for (const k of THEME_KINDS) {
    assert.deepEqual(themeProblems(themeTokens(k).tokens), [], k);
    assert.equal(BASE_THEMES[k].kind, k);
  }
  assert.deepEqual([...DARK_THEMES], ['neutral_dark', 'ocean']);
  assert.equal(isDarkTheme('ocean'), true);
  assert.equal(isDarkTheme('sand'), false);
  assert.equal(artDirection('ocean').style, 'isometric');
  assert.equal(artDirection('forest').style, 'flat');
  assert.deepEqual(sanitizeTheme({ kind: 'ocean' }, () => null), { kind: 'ocean', background: null });
  assert.equal(sanitizeTheme({ kind: 'teal' }, () => null), null);
});

test('3. the editor draws each new theme in the Worker\'s colours, and names all six', () => {
  const src = readFileSync('frontend/src/pages/raise/pitch/editorModel.js', 'utf8');
  for (const k of ['sand', 'ocean', 'forest'] as const) {
    const m = src.match(new RegExp(`${k}: Object\\.freeze\\(\\{ bg: '(#[0-9a-f]{6})', ink: '(#[0-9a-f]{6})', accent: '(#[0-9a-f]{6})', muted: '(#[0-9a-f]{6})' \\}\\)`));
    assert.ok(m, k);
    const c = BASE_THEMES[k].colours;
    assert.deepEqual(m!.slice(1), [c.ground, c.ink, c.accent, c.muted], k);
  }
  const labels = src.match(/export const THEME_LABELS = \{([^}]*)\}/)![1];
  for (const k of THEME_KINDS) assert.match(labels, new RegExp(`\\b${k}:`), k);
  assert.match(src, /export const isDarkTheme = \(kind\) => kind === 'neutral_dark' \|\| kind === 'ocean';/);
  // "No brand kit" is said only where the theme draws from one: Brand, or no theme yet.
  assert.match(readFileSync('frontend/src/pages/raise/pitch/GridStage.jsx', 'utf8'), /!kit\.data\?\.kit && \(!theme\?\.kind \|\| theme\.kind === 'brand'\) \? <div className=\{MUTED\}>\{NO_KIT\}/);
  const adapter = readFileSync('frontend/src/pages/raise/pitch/deckV2Adapter.js', 'utf8');
  assert.equal(/themesV2/.test(adapter), false, 'the themes need no adapter method');
});

// ── 4. The chart rules table ─────────────────────────────────────────────

test('4. the chart a figure\'s shape earns: one fixture per rule, each a type the deck draws', () => {
  const cases: Array<[Parameters<typeof chartRuleFor>[0], string]> = [
    [{ kind: 'time', points: 6 }, 'line'],
    [{ kind: 'time', points: 3 }, 'columns'],
    [{ kind: 'parts', points: 4 }, 'percent_bar'],
    [{ kind: 'categories', points: 5 }, 'ranked_bars'],
    [{ kind: 'market', points: 3 }, 'nested_bars'],
    [{ kind: 'single', points: 1 }, 'metric_tiles'],
    [{ kind: 'funnel', points: 4 }, 'funnel'],
  ];
  for (const [shape, type] of cases) assert.equal(chartRuleFor(shape)?.type, type, JSON.stringify(shape));
  assert.equal(CHART_RULES.length, cases.length);
  for (const r of CHART_RULES) assert.ok((CHART_TYPES as readonly string[]).includes(r.type), r.type);
  assert.deepEqual(chartRuleFor({ kind: 'time', points: 8, projected: true }), { type: 'line', rule: 'time series of four points or more', dashed: true, label: 'Projected' });
  assert.equal(chartRuleFor({ kind: 'time', points: 8 })?.dashed, false);
  assert.equal(chartRuleFor({ kind: 'market', points: 2 }), null, 'a market is three nested sizes or nothing');
  assert.equal(chartRuleFor({ kind: 'time', points: 0 }), null);
  const s = (n: number) => ({ state: 'recorded', points: Array.from({ length: n }, (_, i) => ({ x: `2026-0${i + 1}`, y: i })), cadence: 'monthly', unit: 'usd' }) as any;
  assert.equal(chartTypeFor(s(4)), 'line');
  assert.equal(chartTypeFor(s(3)), 'columns');
});

// ── 5. Art on any image area ─────────────────────────────────────────────

test('5. any empty image area may take art, whatever the card; a filled one is left alone', () => {
  const cap = { available: true, model: 'm', label: 'M' } as const;
  const slides = [
    { spec_id: 'new:team', blocks: [{ id: 'h', kind: 'text', style: 'heading', text: 'Team' }, { id: 'i1', kind: 'image' }, { id: 'i2', kind: 'image', image_url: 'https://x/y.png' }] },
    { spec_id: 'new:market', blocks: [{ id: 'h', kind: 'text', style: 'heading', text: 'Market' }] },
    { spec_id: 'new:solution', blocks: [{ id: 'h', kind: 'text', style: 'heading', text: 'Solution' }] },
  ];
  const plan = imagePlan(slides, 'sand', null, cap);
  assert.deepEqual(plan.cards.map((c) => [c.card, c.areas]), [['team', ['i1']], ['solution', []]]);
});

// ── 6. Words written to their areas, and fix-or-drop ─────────────────────

test('6. each card\'s word budget is its areas\' room at the smallest step, and the run is asked to keep to it', () => {
  const rec = fullRecords();
  const rows = standardOutline('standard', 'seed_fund');
  const visuals = { series: rec.series as any, diagrams: rec.diagrams as any, rows: rec.rows };
  const budget = wordBudget(rows[0], rec.items as any, new Set(), visuals);
  assert.ok(budget.headline > 0 && budget.headline <= 120);
  const msg = buildMessage({ audience: 'seed_fund', prompt: '', rows, items: rec.items as any, ventureName: null, visuals });
  assert.match(msg, /"headline_max_chars":\d+/);
  assert.match(msg, /keep each within its card's headline_max_chars and body_max_chars/i);
});

test('6. overflowing words are shortened at a sentence or a clause, a heading falls back to its title, and nothing goes to the notes', () => {
  const fits = (t: string) => t.length <= 40;
  assert.equal(shortenToFit('We close books fast. Every ledger reconciles daily without effort.', fits), 'We close books fast.');
  assert.equal(shortenToFit('Every ledger reconciles, with every entity and every currency', fits), 'Every ledger reconciles.');
  assert.equal(shortenToFit('Unbreakablewordthatcannotbeshortenedanywhereatallforsure', fits), null);
  const g = G(1, 3, 2, 2);
  const blocks = fixOrDrop('two_columns', [
    { id: 'h', kind: 'text', style: 'heading', grid: G(1, 12, 1, 1), text: 'An extraordinarily long heading that runs on and on well past what the line holds for any reader' },
    { id: 'p', kind: 'text', style: 'paragraph', grid: g, text: 'word '.repeat(80) },
    { id: 'c', kind: 'chart', grid: G(4, 12, 2, 6), chart_type: 'line', series: Array.from({ length: 8 }, () => ({ points: [] })) },
  ], 'Problem');
  assert.equal(blocks.find((b) => b.id === 'h')?.text, 'Problem');
  assert.equal(blocks.some((b) => b.id === 'p'), false, 'an unshortenable sentence is dropped');
  assert.equal(blocks.some((b) => b.id === 'c'), false, 'an unreadable chart is dropped');
  assert.deepEqual(fitProblems([{ layout: 'two_columns', blocks }]), []);
});

// ── 7. The rubric on the three sample ventures ───────────────────────────

const ventures = { full: fullRecords(), sparse: sparseRecords(), conflicting: conflictingRecords() } as Record<string, any>;

test('7. every sample venture\'s deck scores at least 70, with no fit problem left, and reads in all six themes', () => {
  for (const [name, rec] of Object.entries(ventures)) {
    const rows = standardOutline('standard', 'seed_fund');
    const { slides, problems } = buildCards(rows, rec.items, wordsFor(rows), 'Synthetic venture', new Set(),
      { series: rec.series, diagrams: rec.diagrams, rows: rec.rows });
    assert.deepEqual(problems, [], name);
    const r = deckRubric(slides);
    assert.ok(r.score >= RUBRIC_GATE, `${name}: ${r.score} (${JSON.stringify(r.checks)})`);
    // Any of the six themes reads: each passes the legibility checks (test 3).
    for (const kind of THEME_KINDS) assert.deepEqual(themeProblems(themeTokens(kind).tokens), [], kind);
  }
  assert.equal(placeholders(buildCards(standardOutline('standard', 'seed_fund'), ventures.full.items, wordsFor(standardOutline('standard', 'seed_fund')), 'V', new Set(),
    { series: ventures.full.series, diagrams: ventures.full.diagrams, rows: ventures.full.rows }).slides), 0, 'a full venture\'s deck has no placeholder');
});

test('7. the rubric deducts what code can see', () => {
  const ok = [{ layout: 'statement', blocks: [{ id: 'h', kind: 'text', style: 'heading', grid: G(2, 11, 2, 4), text: 'Close the books in a day' }] }];
  assert.equal(deckRubric(ok).score, 100);
  const bad = [
    { layout: 'statement', blocks: [{ id: 'p', kind: 'text', style: 'paragraph', grid: G(1, 2, 1, 1), text: 'word '.repeat(60) }] },
    { layout: 'statement', blocks: [{ id: 'c', kind: 'chart', grid: G(1, 12, 1, 6), chart_type: 'pie' }] },
    { layout: 'statement', blocks: [{ id: 'h', kind: 'text', style: 'heading', grid: G(1, 12, 1, 1), text: 'Not recorded on StudioOS yet' }] },
    // Four cards on one layout: fewer distinct layouts than a third of the cards.
    { layout: 'statement', blocks: [{ id: 'h', kind: 'text', style: 'heading', grid: G(2, 11, 2, 4), text: 'Close the books in a day' }] },
  ];
  const r = deckRubric(bad);
  assert.deepEqual(r.checks.map((c) => c.id).sort(), ['charts', 'fit', 'gaps', 'headings', 'variety']);
  assert.equal(r.score, 100 - 15 - 16 - 10 - 10 - 2);
});
