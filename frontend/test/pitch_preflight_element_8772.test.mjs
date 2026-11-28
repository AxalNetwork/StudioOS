// D8772 (#8772): a preflight finding names its slide element, and its repair is re-checked on the same draft.
//   - pure: stale refresh rows land on their own tile (`field: block:j`); each row names severity,
//     slide, element (label and value) and problem; two elements on one slide read apart; the same
//     problem on several elements is one heading with a row each, every id kept; the headline rules
//     (blockers, warnings only, nothing, couldn't check) and what is announced; the repair a
//     missing source date offers; where focus goes on the way back; the draft-or-version line;
//   - the five fixtures the issue names: two stale metrics on one slide, a missing source date, a
//     structural (layout) failure, an unreadable check, and a genuinely clean result;
//   - mounted: Show on the MRR tile, Add the source date in the draft, Back re-checks the same draft,
//     says "Fixed since the last check", says the saved version still has it, and focuses the next row;
//     Export's gate with warnings only never says "Nothing to fix".
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_preflight_element_8772.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runPreflight, staleTargets } from '../src/pages/raise/pitch/preflightModel.js';
import {
  NOTHING_TO_FIX, SEVERITY_WORDS, chipOf, clustersOf, distinguish, draftLine, elementOf, focusAfter, gateOf, groupsOf, headlineOf,
  repairOf, rowOf, subLine,
} from '../src/pages/raise/pitch/preflightUiModel.js';
import { DECK, mountEditor } from './_pitch_editor_mount.mjs';

/** Synthetic only: no real company, person or figure. */
const NOW = Date.parse('2026-11-27T12:00:00Z');
const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const OPENING = { title: 'Synthetic opening', blocks: [{ id: 't1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Synthetic seed deck' }] };
const TEAM = { title: 'Synthetic team', blocks: [] };
const mrr = (over = {}) => ({ id: 'm1', kind: 'metric', grid: g(1, 3, 2, 3), label: 'MRR', value: '$34.2k', binding: { source_key: 'grow.mrr', snapshot_hash: 'h-mrr', grade: 'Measured', as_of: null }, ...over });
const paying = (over = {}) => ({ id: 'm2', kind: 'metric', grid: g(5, 7, 2, 3), label: 'Paying customers', value: '38', binding: { source_key: 'grow.paying_customers', snapshot_hash: 'h-pay', grade: 'Measured', as_of: null }, ...over });
const TRACTION = { title: 'Synthetic traction', blocks: [mrr(), paying()] };
const deckOf = (slides) => ({ id: 31, version: 7, theme: { kind: 'neutral_light' }, slides });
const ITEMS = [
  { source_key: 'grow.mrr', state: 'recorded', value: 34200, unit: 'usd', as_of: '2026-11-20', snapshot_hash: 'h-mrr', grade: 'Measured', record_ref: 'r1' },
  { source_key: 'grow.paying_customers', state: 'recorded', value: 38, unit: 'count', as_of: '2026-11-20', snapshot_hash: 'h-pay', grade: 'Measured', record_ref: 'r2' },
];

test('stale refresh rows land on their own tile; a row no tile carries stays on its slide', () => {
  const slides = [OPENING, TEAM, { title: 'Synthetic traction', blocks: [mrr({ binding: { ...mrr().binding, as_of: '2026-11-01' } }), paying({ binding: { ...paying().binding, as_of: '2026-11-01' } })] }];
  const refresh = { rows: [
    { slide: 2, field: 'block:0', source_key: 'grow.mrr', state: 'stale' },
    // A field that points at the wrong block (the draft moved it) is trusted only through the source key.
    { slide: 2, field: 'block:0', source_key: 'grow.paying_customers', state: 'stale' },
    { slide: 1, field: 'block:4', source_key: 'grow.runway', state: 'gone' },
    { slide: 2, field: 'block:0', source_key: 'grow.mrr', state: 'fresh' },
  ] };
  const t = staleTargets(refresh, slides);
  assert.deepEqual([...t.blocks.entries()], [['2:m1', 'stale'], ['2:m2', 'stale']]);
  assert.deepEqual([...t.cards.entries()], [[1, 'gone']]);
  const r = runPreflight(deckOf(slides), { refresh, now: NOW });
  const moved = r.findings.filter((f) => /changed in its store/.test(f.title));
  assert.deepEqual(moved.map((f) => [f.card, f.block]), [[2, 'm1'], [2, 'm2']], 'two stale tiles are two findings, not one per slide');
  assert.equal(new Set(moved.map((f) => f.id)).size, 2);
  assert.ok(r.findings.some((f) => f.card === 1 && f.block === null && /no longer in its store/.test(f.title)), 'no carrier: the slide-level row, as before');
});

test('fixture: two stale metrics on one slide read apart, under one heading, each with its own buttons', () => {
  const slides = [OPENING, TEAM, { title: 'Synthetic traction', blocks: [mrr({ binding: { ...mrr().binding, as_of: '2026-11-01' } }), paying({ binding: { ...paying().binding, as_of: '2026-11-01' } })] }];
  const refresh = { rows: [{ slide: 2, field: 'block:0', source_key: 'grow.mrr', state: 'stale' }, { slide: 2, field: 'block:1', source_key: 'grow.paying_customers', state: 'stale' }] };
  const r = runPreflight(deckOf(slides), { refresh, now: NOW });
  const grp = groupsOf(r, { slides });
  const rows = grp.look.filter((x) => x.check === 'sources');
  assert.deepEqual(rows.map((x) => x.where), ['Slide 3 · Metric · MRR $34.2k', 'Slide 3 · Metric · Paying customers 38']);
  assert.deepEqual(rows.map((x) => x.severityWord), [SEVERITY_WORDS.warning, SEVERITY_WORDS.warning]);
  assert.equal(rows[0].label, 'Slide 3, metric MRR $34.2k, its figure has changed in its store');
  assert.equal(new Set(rows.map((x) => x.label)).size, 2, 'distinct accessible names');
  assert.deepEqual(rows.map((x) => x.showLabel), ['Show metric MRR $34.2k on slide 3', 'Show metric Paying customers 38 on slide 3']);
  assert.equal(rows[1].dismissLabel, 'Dismiss the warning on metric Paying customers 38, slide 3');
  const cl = clustersOf(rows);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].heading, 'Slide 3 · Its figure has changed in its store · 2 elements');
  assert.deepEqual(cl[0].rows.map((x) => x.id), rows.map((x) => x.id), 'grouped, every finding and id kept');
});

test('fixture: a missing source date, on two tiles, grouped; the repair keeps the value and adds the date', () => {
  const slides = [OPENING, TEAM, TRACTION];
  const r = runPreflight(deckOf(slides), { now: NOW });
  const rows = groupsOf(r, { slides }).look;
  assert.deepEqual(rows.map((x) => [x.where, x.headline]), [
    ['Slide 3 · Metric · MRR $34.2k', 'The source\'s date is not recorded.'],
    ['Slide 3 · Metric · Paying customers 38', 'The source\'s date is not recorded.'],
  ]);
  assert.equal(clustersOf(rows)[0].heading, 'Slide 3 · The source\'s date is not recorded · 2 elements');
  const fix = repairOf(rows[0], TRACTION.blocks[0], ITEMS);
  assert.equal(fix.state, 'ready');
  assert.equal(fix.action, 'Add the source date · 20 Nov 2026');
  assert.equal(fix.block.value, '$34.2k', 'the value stays as the tile says it');
  assert.equal(fix.block.binding.as_of, '2026-11-20');
  assert.equal(fix.block.binding.snapshot_hash, 'h-mrr');
  // Re-checked with the repair in place, that tile's finding is gone and the other stays.
  const repaired = [OPENING, TEAM, { ...TRACTION, blocks: [fix.block, TRACTION.blocks[1]] }];
  const again = groupsOf(runPreflight(deckOf(repaired), { now: NOW }), { slides: repaired });
  assert.deepEqual(again.look.map((x) => x.id), [rows[1].id]);
  // Nothing to press, with the reason: not read, no date in the store either, a store that moved.
  assert.equal(repairOf(rows[0], TRACTION.blocks[0], []).state, 'unread');
  assert.equal(repairOf(rows[0], TRACTION.blocks[0], [{ ...ITEMS[0], as_of: null }]).state, 'no_date');
  const movedFix = repairOf(rows[0], TRACTION.blocks[0], [{ ...ITEMS[0], snapshot_hash: 'h-new', value: 36000 }]);
  assert.match(movedFix.action, /^Refresh to \$36(,000|\.0k|k)/);
  assert.equal(repairOf({ ...rows[0], check: 'alt' }, TRACTION.blocks[0], ITEMS), null, 'only a source finding');
});

test('two elements of one kind that read alike on one slide are told apart', () => {
  const slides = [{ title: 'Synthetic', blocks: [
    { id: 'a', kind: 'text', style: 'paragraph', grid: g(1, 6, 1, 1), text: 'Add [Your logo] here' },
    { id: 'b', kind: 'text', style: 'paragraph', grid: g(7, 12, 1, 1), text: 'Replace [Market size] soon' },
    { id: 'c', kind: 'metric', grid: g(1, 3, 3, 4), label: 'ARR', value: '1' },
    { id: 'd', kind: 'metric', grid: g(5, 7, 3, 4), label: 'ARR', value: '1' },
  ] }];
  const rows = distinguish(runPreflight(deckOf(slides), { now: NOW }).findings.map((f) => rowOf(f, slides)), slides);
  const where = (id, check) => rows.find((x) => x.block === id && x.check === check).where;
  assert.equal(where('a', 'placeholder'), 'Slide 1 · Body · “Add [Your logo] here”');
  assert.equal(where('b', 'placeholder'), 'Slide 1 · Body · “Replace [Market size] soon”');
  assert.equal(where('c', 'sources'), 'Slide 1 · Metric · ARR 1 · block 3 of 4');
  assert.equal(where('d', 'sources'), 'Slide 1 · Metric · ARR 1 · block 4 of 4');
  assert.equal(new Set(rows.map((x) => x.showLabel)).size, new Set(rows.map((x) => x.block)).size, 'one Show name per element');
  assert.equal(elementOf({ kind: 'image', alt: 'A synthetic chart' }), 'A synthetic chart');
  assert.equal(elementOf({ kind: 'text', text: 'x' }), null);
});

test('fixture: a structural failure blocks export, and says so', () => {
  const slides = [{ title: 'Synthetic', blocks: [
    { id: 'a', kind: 'text', style: 'heading', grid: g(1, 6, 1, 2), text: 'Synthetic title' },
    { id: 'b', kind: 'text', style: 'paragraph', grid: g(3, 8, 2, 3), text: 'Synthetic body' },
  ] }];
  const grp = groupsOf(runPreflight(deckOf(slides), { now: NOW }), { slides });
  assert.equal(grp.fix.length, 1);
  assert.equal(grp.fix[0].severityWord, SEVERITY_WORDS.blocking);
  const head = headlineOf(grp);
  assert.deepEqual([head.tone, head.allowed, head.text], ['fix', 'none', '1 to fix before you export or share']);
  assert.match(head.announce, /^1 blocker: export waits until it is fixed\./);
  const gate = gateOf(grp, 'export');
  assert.equal(gate.anyway, null);
  assert.equal(headlineOf(gate).tone, 'fix');
});

test('fixture: an unreadable check is never a pass, and warnings alone are never "Nothing to fix"', () => {
  const slides = [OPENING];
  const r = runPreflight(deckOf(slides), { now: NOW });
  const failed = groupsOf(r, { slides, failed: [0] });
  const head = headlineOf(failed);
  assert.equal(head.tone, 'unchecked');
  assert.match(head.announce, /1 item couldn’t be checked, which is not a pass\.$/);
  assert.notEqual(chipOf({ groups: failed }).tone, 'ok');
  assert.equal(gateOf(failed, 'export').unchecked, 1, 'the gate carries it');
  assert.match(headlineOf(gateOf(failed, 'export')).announce, /not a pass/);
  // No text, so nothing is left unmeasured: warnings and only warnings.
  const warn = groupsOf(runPreflight(deckOf([TEAM, TRACTION]), { now: NOW }), { slides: [TEAM, TRACTION] });
  const w = headlineOf(gateOf(warn, 'export'));
  assert.deepEqual([w.text, w.tone, w.allowed], ['No blockers · 2 warnings to confirm', 'look', 'confirm']);
  assert.notEqual(w.text, NOTHING_TO_FIX);
  assert.equal(w.announce, 'No blockers. 2 warnings: export after you confirm them.');
});

test('fixture: a genuinely clean result is "Nothing to fix", and only then', () => {
  const slides = [{ title: 'Synthetic', blocks: [{ id: 'a', kind: 'metric', grid: g(1, 3, 1, 2), label: 'MRR', value: '$34.2k', binding: { source_key: 'grow.mrr', as_of: '2026-11-20', grade: 'Measured' } }] }];
  const grp = groupsOf(runPreflight(deckOf(slides), { now: NOW }), { slides });
  assert.deepEqual([grp.fix.length, grp.look.length, grp.unchecked.length], [0, 0, 0]);
  assert.deepEqual(headlineOf(grp), { text: NOTHING_TO_FIX, tone: 'ok', allowed: 'all', announce: `${NOTHING_TO_FIX}.` });
  assert.equal(gateOf(grp, 'export').open, false);
});

test('back from a finding: the same row, else the next one, else the one before', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(focusAfter(order, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b'), 'b');
  assert.equal(focusAfter(order, [{ id: 'a' }, { id: 'c' }], 'b'), 'c');
  assert.equal(focusAfter(order, [{ id: 'a' }], 'c'), 'a');
  assert.equal(focusAfter(order, [], 'b'), null);
  assert.equal(focusAfter(order, [{ id: 'a' }], null), null);
});

test('the draft or the saved version: the check says which, and a repair in the draft is not yet in the version', () => {
  assert.equal(subLine({ version: 7, at: NOW - 1000, now: NOW, slides: 3, draft: true }), 'Your draft, edited from v7 · checked just now · 3 slides');
  assert.equal(subLine({ version: 7, at: NOW - 1000, now: NOW, slides: 3 }), 'v7 · checked just now · 3 slides');
  assert.equal(draftLine({ version: 7 }), 'This checked your draft, with your unsaved edits. Export and Share send v7 and check it again when they open.');
  assert.equal(draftLine({ version: 7, fixed: 1 }), 'Fixed in your draft. The saved v7 still has it: save a new version, and Export and Share check that version again.');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const LIVE = { ...DECK, slides: [OPENING, TEAM, TRACTION] };
const SOURCES = { project_id: 7, items: ITEMS, coverage: { slots: 2, filled: 2, by_grade: {}, not_recorded: 0, unreadable: 0 } };

async function openPanel(m) {
  await m.press(m.by('deck-more-open'));
  await m.press(m.by('deck-more-preflight'));
  for (let i = 0; i < 8 && !m.by('pitch-preflight-counts') && !m.by('pitch-preflight-nothing'); i += 1) await m.settle();
}

test('mounted: Show the MRR tile, add its source date in the draft, Back re-checks it and focuses the next tile', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => LIVE, 'sources.list': async () => SOURCES } });
  try {
    await openPanel(m);
    const look = m.by('pitch-preflight-look');
    assert.match(m.text(m.by('pitch-preflight-look-cluster-heading')), /^Slide 3 · The source's date is not recorded · 2 elements$/);
    const mrrRow = m.by('pitch-preflight-row-sources:2:m1:0');
    const payRow = m.by('pitch-preflight-row-sources:2:m2:0');
    assert.ok(look && mrrRow && payRow);
    assert.equal(m.pr(mrrRow)['aria-label'], 'Slide 3, metric MRR $34.2k, the source\'s date is not recorded');
    assert.match(m.text(mrrRow), /Slide 3 · Metric · MRR \$34\.2k Warning/);
    assert.equal(m.pr(m.by('pitch-preflight-row-sources:2:m1:0-show'))['aria-label'], 'Show metric MRR $34.2k on slide 3');
    assert.equal(m.pr(m.by('pitch-preflight-row-sources:2:m2:0-dismiss'))['aria-label'], 'Dismiss the warning on metric Paying customers 38, slide 3');
    assert.equal(m.by('pitch-preflight-draft'), undefined, 'no edits: the check is of v3 itself');

    await m.press(m.by('pitch-preflight-row-sources:2:m1:0-show'));
    assert.match(m.text(m.by('pitch-preflight-strip')), /Slide 3 · Metric · MRR \$34\.2k/);
    assert.equal(m.text(m.by('pitch-preflight-strip-repair-run')), 'Add the source date · 20 Nov 2026');
    await m.press(m.by('pitch-preflight-strip-repair-run'));

    await m.press(m.by('pitch-preflight-strip-back'));
    for (let i = 0; i < 10 && !m.by('pitch-preflight-fixed'); i += 1) await m.settle();
    assert.match(m.text(m.by('pitch-preflight-fixed')), /Fixed since the last check: Slide 3 · Metric · MRR \$34\.2k/);
    assert.match(m.text(m.by('pitch-preflight')), /Your draft, edited from v3/);
    assert.equal(m.text(m.by('pitch-preflight-draft')), 'Fixed in your draft. The saved v3 still has it: save a new version, and Export and Share check that version again.');
    assert.equal(m.by('pitch-preflight-row-sources:2:m1:0'), undefined, 'the repaired tile is no longer found');
    assert.equal(m.pr(document.activeElement)['data-testid'], 'pitch-preflight-row-sources:2:m2:0', 'focus on the next finding');
    assert.ok(!m.calls.some(([n]) => /update|save|setDismissed/i.test(n)), 'nothing saved: the repair is in the draft');
  } finally { await m.close(); }
});

test('mounted: Export with warnings only says "No blockers", never "Nothing to fix", with the tiles grouped', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => ({ ...DECK, slides: [TEAM, TRACTION] }) } });
  try {
    await m.press(m.by('deck-toolbar-share'));
    await m.press(m.by('deck-toolbar-item-export'));
    for (let i = 0; i < 8 && !m.by('pitch-preflight-gate-warnings'); i += 1) await m.settle();
    assert.equal(m.by('pitch-preflight-gate-nothing'), undefined);
    const head = m.by('pitch-preflight-gate-warnings');
    assert.equal(m.text(head), 'No blockers · 2 warnings to confirm');
    assert.equal(m.pr(head).role, 'status');
    assert.equal(m.pr(head)['aria-label'], 'No blockers. 2 warnings: export after you confirm them.');
    assert.match(m.text(m.by('pitch-preflight-gate-look-cluster-heading')), /^Slide 2 · The source's date is not recorded · 2 elements$/);
  } finally { await m.close(); }
});
