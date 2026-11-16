/**
 * D4826 part 2 (#4826, Expertise UX) — the Thinking shelf's filter chips,
 * re-cut to EX-11 on the Expertise v2 canvas: `All · Needs you · With editors
 * · Published`, each a set of the shelf's own states, with the Worker's
 * whole-shelf figure on each chip.
 *
 * `profile_zone_filters.test.mjs` holds the chip NAMES to the canvas. This
 * file holds what they collect, that the Worker counts the same sets, and how
 * the row behaves: a labelled group, pressed state, 44px below `md`, dark
 * pairs.
 *
 * All fixtures are synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/expertise_chips_4826.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';
import {
  ARTICLE_STAGE_KEYS, THINKING_VIEWS, articleStage, inThinkingView,
} from '../src/pages/advisor/expertise/expertiseModel.js';
import { ADVISOR_ZONE_FILTERS } from '../src/workspaces/advisorZoneFilters.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** One synthetic piece in each of the shelf's eight states, plus one it has no words for. */
const PIECES = [
  { id: 1, status: 'draft' }, { id: 2, status: 'submitted' }, { id: 3, status: 'in_review' },
  { id: 4, status: 'changes_requested' }, { id: 5, status: 'rejected' }, { id: 6, status: 'approved' },
  { id: 7, status: 'approved', publish_at: '2026-12-01T09:00:00Z' }, { id: 8, status: 'published', slug: 'a-synthetic-piece' },
  { id: 9, status: 'archived_somehow' },
];
const under = (view) => PIECES.filter((a) => inThinkingView(a, view)).map((a) => articleStage(a).key);

test('each chip collects whose move it is, and no state sits under two chips', () => {
  // Mutation checked: `approved` dropped from with_editors → that list fails;
  // `rejected` added to needs_you → that list fails; inThinkingView keeping
  // everything for a named chip → every list fails.
  assert.deepEqual(under('all'), [...ARTICLE_STAGE_KEYS, 'unknown'], 'All keeps every piece, the unknown one included');
  assert.deepEqual(under('needs_you'), ['draft', 'changes_requested']);
  assert.deepEqual(under('with_editors'), ['submitted', 'in_review', 'approved']);
  assert.deepEqual(under('published'), ['published']);
  // Scheduled goes public by itself and Not accepted is closed: All only.
  const chipped = Object.values(THINKING_VIEWS).flat();
  assert.equal(new Set(chipped).size, chipped.length, 'a state is under one chip at most');
  for (const key of chipped) assert.ok(ARTICLE_STAGE_KEYS.includes(key), `${key} is one of the shelf's states`);
  assert.deepEqual(ARTICLE_STAGE_KEYS.filter((k) => !chipped.includes(k)), ['rejected', 'scheduled']);
});

test("the table's live chips are THINKING_VIEWS' keys, in EX-11's order, each with a count slot", () => {
  // Mutation checked: a chip keyed `draft` again → the keys fail; a label
  // without `{n}` → the count assert fails.
  const row = ADVISOR_ZONE_FILTERS['expertise/thinking'];
  assert.deepEqual(row.map((r) => r.canvas), ['All', 'Needs you', 'With editors', 'Published']);
  assert.deepEqual(row.map((r) => r.key), ['all', ...Object.keys(THINKING_VIEWS)]);
  for (const r of row) {
    assert.equal(r.unbuilt, undefined, `${r.canvas} runs`);
    assert.equal(r.label, `${r.canvas} {n}`, `${r.canvas} carries the Worker's figure`);
  }
});

test("EX-11's own sample agrees: its Needs you and With editors figures are the rows those sets collect", () => {
  // The canvas draws seven sample rows with its state words and chip figures
  // for the whole (13-piece) sample. The two "whose move" chips cover only
  // pieces on screen, so their figures must equal the visible rows in the set.
  // Mutation checked: `submitted` or `changes_requested` moved out of its set → fails.
  const canvas = read('design/incoming/Expertise v2 Page.dc.html');
  const art = canvas.slice(canvas.indexOf('const ART = ['), canvas.indexOf('const thinking = () =>'));
  const states = [...art.matchAll(/\['[^']+', '([^']+)', '[^']+', '[^']+'\]/g)].map((m) => m[1]);
  assert.equal(states.length, 7, 'the canvas draws seven sample rows');
  const byLabel = Object.fromEntries(ARTICLE_STAGE_KEYS.map((k) => [articleStage({ id: 1, status: k === 'scheduled' ? 'approved' : k, publish_at: k === 'scheduled' ? '2026-12-01' : null, slug: 's' }).label, k]));
  const keys = states.map((s) => byLabel[s]);
  assert.ok(keys.every(Boolean), `every canvas state is one of the shelf's: ${states.join(', ')}`);
  const drawn = (chip) => Number(canvas.match(new RegExp(`aria-checked="false">${chip}<span>(\\d+)</span>`))[1]);
  assert.equal(keys.filter((k) => THINKING_VIEWS.needs_you.includes(k)).length, drawn('Needs you'));
  assert.equal(keys.filter((k) => THINKING_VIEWS.with_editors.includes(k)).length, drawn('With editors'));
});

test('the Worker counts the same sets over the whole shelf', () => {
  // Mutation checked: `changes_requested` dropped from the SQL, or the
  // approved clause losing `publish_at IS NULL` → the sets differ.
  const src = read('cloudflare-worker/src/routes/advisors_cohorts.ts');
  const route = src.slice(src.indexOf("advisors.get('/me/thinking'"));
  const clause = (name) => {
    const m = route.match(new RegExp(`SUM\\(CASE WHEN ((?:(?!CASE WHEN)[^])*?) THEN 1 ELSE 0 END\\), 0\\) AS ${name}\\b`));
    assert.ok(m, `the Worker counts ${name}`);
    return m[1].replace(/\s+/g, ' ');
  };
  const statuses = (sql) => [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(statuses(clause('needs_you')), [...THINKING_VIEWS.needs_you]);
  const editors = clause('with_editors');
  assert.deepEqual(statuses(editors), [...THINKING_VIEWS.with_editors]);
  assert.match(editors, /status = 'approved' AND publish_at IS NULL/, 'a Scheduled piece is not with the editors');
  assert.match(route, /total,\s*\n\s*needs_you: Number\(whole\?\.needs_you\) \|\| 0,\s*\n\s*with_editors: Number\(whole\?\.with_editors\) \|\| 0,/);
});

// ─────────────────────────────────────────────────────────── mounted

const API_IMPORT = "import { api, articles as articlesApi } from '../../../lib/api';";
async function thinkingZone() {
  const page = read('frontend/src/pages/advisor/expertise/ThinkingZone.jsx');
  assert.ok(page.includes(API_IMPORT));
  return sourceModule(page.replace(API_IMPORT, 'const { api, articles: articlesApi } = globalThis.__api4826;'), 'pages/advisor/expertise/ThinkingZone.jsx');
}
// `zoneFilterBuilder` derives a test id from the label, `{n}` included.
const chipIds = ['filter-thinking-all-n', 'filter-thinking-needs-you-n', 'filter-thinking-with-editors-n', 'filter-thinking-published-n'];

test('the chip row: a labelled group of pressable chips, 44px below md, dark pairs, and a press narrows the shelf', async () => {
  // Mutation checked: `tap` dropped from ThinkingZone → the 44px assert fails;
  // `filterLabel` dropped → the group assert fails; the counts not passed →
  // the figures fail; the filter ignoring `view` → the narrowed list fails.
  globalThis.__api4826 = {
    api: { async listMyAdvisorThinking() {
      return { items: PIECES.slice(0, 8).map((a) => ({ ...a, title: `Synthetic ${a.id}` })),
        counts: { total: 14, needs_you: 3, with_editors: 0, published: 5, drafts: 9, best_reach: 1, talk_reach: null } };
    } },
    articles: { async revisions() { return { revisions: [] }; } },
  };
  const f = await mountForm(h((await thinkingZone()).default));
  try {
    await f.flush();
    const chips = chipIds.map((id) => f.by(id));
    assert.ok(chips.every(Boolean), 'all four chips are drawn');
    // A zero drops the figure rather than printing "With editors 0" (zoneFilterBuilder).
    assert.deepEqual(chips.map((c) => textOf(c)), ['All 14', 'Needs you 3', 'With editors', 'Published 5']);
    const group = chips[0].parentNode;
    assert.equal(f.props(group).role, 'group');
    assert.equal(f.props(group)['aria-label'], 'Article state');
    for (const c of chips) {
      const p = f.props(c);
      assert.equal(c.tagName, 'BUTTON', 'a native button, so Tab, Enter and Space reach it');
      assert.equal(p.type, 'button');
      assert.match(p.className, /(^| )min-h-\[44px\]( |$)/, 'a 44px target below md');
      assert.match(p.className, /(^| )md:min-h-0( |$)/, 'the canvas size from md up');
      assert.match(p.className, /focus-visible:outline/, 'a visible focus ring');
      assert.match(p.className, /dark:border-/, 'a dark border pair');
      assert.match(p.className, /dark:text-/, 'a dark text pair');
    }
    assert.deepEqual(chips.map((c) => f.props(c)['aria-pressed']), [true, false, false, false]);

    await press(f, chips[1]);
    assert.deepEqual(chipIds.map((id) => f.props(f.by(id))['aria-pressed']), [false, true, false, false]);
    // Not by colour alone: the pressed chip is bold as well as tinted.
    assert.match(f.props(f.by(chipIds[1])).className, /font-bold/);
    const shown = () => f.nodes().filter((n) => /^advisor-thinking-\d+$/.test(f.props(n)['data-testid'] || '')).map((n) => f.props(n)['data-stage']);
    assert.deepEqual(shown(), ['draft', 'changes_requested']);

    await press(f, f.by(chipIds[2]));
    assert.deepEqual(shown(), ['submitted', 'in_review', 'approved']);
    await press(f, f.by(chipIds[3]));
    assert.deepEqual(shown(), ['published']);
    await press(f, f.by(chipIds[0]));
    assert.equal(shown().length, 8);
  } finally { await f.unmount(); delete globalThis.__api4826; }
});

test('a figure the Worker did not send drops from its chip; it is never a typed zero', async () => {
  // Mutation checked: ThinkingZone filling an absent figure from the loaded
  // page (`items.length`) → "All 1" fails.
  globalThis.__api4826 = {
    api: { async listMyAdvisorThinking() { return { items: [{ id: 1, status: 'draft', title: 'Synthetic' }] }; } },
    articles: { async revisions() { return { revisions: [] }; } },
  };
  const f = await mountForm(h((await thinkingZone()).default));
  try {
    await f.flush();
    assert.deepEqual(chipIds.map((id) => textOf(f.by(id))), ['All', 'Needs you', 'With editors', 'Published']);
  } finally { await f.unmount(); delete globalThis.__api4826; }
});

async function press(f, node) {
  assert.ok(node, 'chip exists');
  const { act } = await import('react');
  await act(async () => f.props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }));
}
