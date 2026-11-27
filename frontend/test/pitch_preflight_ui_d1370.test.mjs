// D1370 (#3661, PF1–PF5): "Check before you send" in the deck editor.
//   - the words: a finding's row ("Slide 4 · Title", its defect without the model's prefix, its
//     screen-reader name); the four groups; "Couldn't check" is its own count and never a pass;
//     dismissed warnings leave the count, blocking findings never do; the chip's states; the gate;
//   - the ⋯ menu carries Before you send › Check before you send · Free, between This card and AI;
//   - mounted: the panel runs, lists what is to fix, Show me selects the card and leaves the strip,
//     Dismiss and Undo (kept for the version since D4208, `pitch_preflight_wire_4208_4210`), with no
//     issue number; a reader sees the findings with no Dismiss, Ask or Re-check; Export runs the
//     check first and its gate opens the dialog only with nothing to fix.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_preflight_ui_d1370.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPreflight, currentResult } from '../src/pages/raise/pitch/preflightModel.js';
import {
  ALL_PASSED, BUILD, NOT_SINCE_EDIT, blockName, chipOf, countsLine, fixedLine, fixedSince, gateOf, groupsOf, headline, notYet, rowOf,
  stepOf, subLine, uncheckedBanner, uncheckedRows, workingDeck,
} from '../src/pages/raise/pitch/preflightUiModel.js';
import { MORE_MENU } from '../src/pages/raise/pitch/deckV2Model.js';
import { codeOnly } from './_codeOnly.mjs';
import { ADMIN, DECK, mountEditor } from './_pitch_editor_mount.mjs';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
/** Synthetic only: no real company, person or figure. */
const SLIDES = [
  { title: 'Synthetic opening', blocks: [
    { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Synthetic heading' },
    { id: 'b2', kind: 'image', grid: g(1, 6, 2, 6), image_url: '' },
  ] },
  { title: 'Synthetic traction', blocks: [
    { id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 2), text: 'Add [Your logo] here' },
    { id: 'b2', kind: 'metric', grid: g(1, 3, 3, 4), label: 'MRR', value: '$9,000' },
  ] },
];
const deck = { id: 77, version: 5, theme: { kind: 'neutral_light' }, slides: SLIDES };
const result = runPreflight(deck, { now: NOW });

test('a finding row: where, the defect without the prefix, and its screen-reader name', () => {
  const img = result.findings.find((f) => f.check === 'image');
  const row = rowOf(img, SLIDES);
  assert.equal(row.where, 'Slide 1 · Image');
  assert.equal(row.headline, 'An image block with no image.');
  assert.equal(row.label, 'Slide 1, image, an image block with no image');
  assert.equal(row.severity, 'blocking');
  assert.equal(row.dismissible, false, 'a blocking finding cannot be dismissed');
  const ph = rowOf(result.findings.find((f) => f.check === 'placeholder'), SLIDES);
  assert.equal(ph.where, 'Slide 2 · Body');
  assert.match(ph.headline, /^"\[Your logo\]" looks like a bracketed sample\.$/);
  assert.deepEqual([blockName(null), blockName({ kind: 'text', style: 'heading' }), blockName({ kind: 'metric' })], ['Whole slide', 'Title', 'Metric']);
  assert.equal(headline({ card: 0, block: null, title: 'Something else' }, SLIDES), 'Something else', 'an unknown prefix keeps the whole title');
});

test('groups: to fix, worth a look (dismissed ones leave it), couldn’t check, passed', () => {
  const all = groupsOf(result, { slides: SLIDES });
  assert.deepEqual(all.fix.map((r) => r.check), ['image']);
  assert.ok(all.look.some((r) => r.check === 'placeholder') && all.look.some((r) => r.check === 'sources'));
  const one = all.look[0].id;
  const less = groupsOf(result, { slides: SLIDES, dismissed: new Set([one, all.fix[0].id]) });
  assert.equal(less.look.length, all.look.length - 1);
  assert.equal(less.dismissed, 1);
  assert.equal(less.fix.length, 1, 'a blocking finding is never dismissed, even when its id is in the set');
  assert.ok(all.unchecked.some((r) => r.id === 'check:overflow'), 'clipping not measured is listed');
  assert.ok(!all.passed.includes('Clipped content'), '"Not measured" is never in Passed');
  const failed = groupsOf(result, { slides: SLIDES, failed: [1, 0, 1] });
  assert.deepEqual(failed.unchecked.map((r) => r.where), ['Slide 1', 'Slide 2']);
  assert.equal(uncheckedBanner(failed), 'Couldn’t check 2 slides: the page did not draw them at export size.');
  assert.deepEqual(uncheckedRows(null), []);
});

test('the counts and the chip: never "All checks passed" while something was not checked', () => {
  assert.equal(countsLine({ fix: 3, look: 5, unchecked: 1 }), '3 to fix · 5 to look at · 1 couldn’t check');
  assert.equal(countsLine({ unchecked: 2 }), '2 couldn’t check');
  assert.equal(countsLine({}), ALL_PASSED);
  assert.equal(chipOf({}), null, 'nothing before the first check');
  assert.equal(chipOf({ running: { done: 7, total: 12 } }).text, 'Checking · 7 of 12');
  const gs = groupsOf(result, { slides: SLIDES });
  assert.equal(chipOf({ groups: gs, current: false }).text, NOT_SINCE_EDIT);
  const c = chipOf({ groups: gs });
  assert.equal(c.tone, 'warn');
  assert.match(c.text, /^1 to fix · \d+ to look at · 1 couldn’t check$/);
  const clean = { fix: [], look: [], unchecked: [], passed: ['Contrast'], dismissed: 0 };
  assert.deepEqual([chipOf({ groups: clean }).text, chipOf({ groups: clean }).tone], [`✓ ${ALL_PASSED}`, 'ok']);
  assert.equal(chipOf({ groups: { ...clean, unchecked: [{ id: 'check:overflow' }] } }).text, '1 couldn’t check');
});

test('a result belongs to the deck it ran on; the sub line says when; what was fixed', () => {
  const working = workingDeck(deck, SLIDES, deck.theme);
  assert.ok(currentResult(result, working));
  const edited = workingDeck(deck, [SLIDES[0], { ...SLIDES[1], blocks: SLIDES[1].blocks.slice(1) }], deck.theme);
  assert.equal(currentResult(result, edited), null, 'an edit makes it out of date');
  assert.equal(subLine({ version: 3, at: NOW - 5000, now: NOW, slides: 12 }), 'v3 · checked just now · 12 slides');
  assert.match(subLine({ version: 3, at: NOW - 3600000, now: NOW, slides: 12, current: false }), /^v3 · checked at \d\d:\d\d · before your edit$/);
  const before = groupsOf(result, { slides: SLIDES });
  const after = groupsOf(runPreflight({ ...deck, slides: [{ ...SLIDES[0], blocks: [SLIDES[0].blocks[0]] }, SLIDES[1]] }, { now: NOW }), { slides: SLIDES });
  assert.deepEqual(fixedSince(before, after), ['Slide 1 · Image']);
  assert.equal(fixedLine(['Slide 1 · Image']), 'Fixed since the last check: Slide 1 · Image');
  const rows = [...before.fix, ...before.look];
  assert.deepEqual([stepOf(rows, rows[0].id).line, stepOf(rows, rows[0].id).prev], [`Findings · 1 of ${rows.length}`, null]);
});

test('the gate: to fix first holds Send anyway back; warnings only offer it; nothing opens the dialog at once', () => {
  const gs = groupsOf(result, { slides: SLIDES });
  const share = gateOf(gs, 'share');
  assert.deepEqual([share.open, share.title, share.anyway, share.waitLine], [true, 'Before you share', null, 'Send anyway opens once the 1 item to fix is fixed.']);
  const warn = gateOf({ ...gs, fix: [] }, 'export');
  assert.deepEqual([warn.open, warn.title, warn.anyway, warn.waitLine], [true, 'Before you export', 'Export anyway', null]);
  assert.equal(gateOf({ fix: [], look: [], unchecked: [{ id: 'x' }], passed: [] }, 'export').open, false, 'couldn’t check alone does not stop it (the chip and panel say so)');
  assert.equal(gateOf(null, 'share').open, false);
});

test('⋯: Before you send › Check before you send · Free, between This card and the AI items', () => {
  assert.deepEqual(MORE_MENU.map((s) => s.id), ['deck', 'card', 'before', 'ai']);
  assert.deepEqual(MORE_MENU.find((s) => s.id === 'before').items, [{ id: 'preflight', label: 'Check before you send', note: 'Free' }]);
  // D4208 and D4210 switched both on.
  assert.deepEqual([BUILD.P1.issue, BUILD.P2.issue, BUILD.P1.live, BUILD.P2.live], [4208, 4210, true, true]);
  assert.equal(notYet(), 'Not switched on yet.');
});

test('the source: the model calls nothing; the hook keeps dismissals and the panel asks for a fix, and nothing else', () => {
  const read = (f) => codeOnly(readFileSync(new URL(`../src/pages/raise/pitch/${f}`, import.meta.url), 'utf8'));
  const calls = (src) => [...new Set(src.match(/\b\w*[aA]pi\.\w+\(/g) || [])].sort();
  assert.deepEqual(calls(read('preflightUiModel.js')), [], 'the model: no network');
  assert.deepEqual(calls(read('usePreflight.js')), ['api.dismissals(', 'api.setDismissed('], 'the hook: the version\'s dismissals only (D4208)');
  assert.deepEqual(calls(read('PreflightPanel.jsx')), ['deckAssistApi.quote(', 'deckAssistApi.run('], 'the panel: D899\'s quote and run only (D4210)');
  for (const f of ['PreflightPanel.jsx', 'usePreflight.js', 'preflightUiModel.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /fetch\(|request\(/, `${f}: no request of its own`);
    assert.doesNotMatch(src, /\bscore\b|investor[- ]ready/i, `${f}: no score, no verdict`);
    assert.doesNotMatch(src, /\bFill\b/, `${f}: Ask, never Fill`);
  }
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const DEFECTS = { ...DECK, slides: SLIDES };
const WARNINGS = { ...DECK, slides: [SLIDES[1]] };

async function openPanel(m) {
  await m.press(m.by('deck-more-open'));
  await m.press(m.by('deck-more-preflight'));
  for (let i = 0; i < 6 && !m.by('pitch-preflight-counts') && !m.by('pitch-preflight-nothing'); i += 1) await m.settle();
}

test('the panel: runs on open, lists what is to fix, Show me selects the card and leaves the strip', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => DEFECTS } });
  try {
    assert.equal(m.by('pitch-preflight-chip'), undefined, 'no chip before the first check');
    await openPanel(m);
    assert.ok(m.by('pitch-preflight'), 'the panel');
    assert.match(m.text(m.by('pitch-preflight-counts')), /1 to fix/);
    assert.match(m.text(m.by('pitch-preflight-counts')), /couldn’t check/, 'the fake page has no layout: never a pass');
    assert.doesNotMatch(m.text(m.by('pitch-preflight')), new RegExp(ALL_PASSED));
    assert.match(m.text(m.by('pitch-preflight-unchecked')), /Not a pass/);
    assert.match(m.text(m.by('pitch-preflight-chip')), /^1 to fix · \d+ to look at · \d+ couldn’t check$/);
    const fixRow = m.walk(m.by('pitch-preflight-fix')).find((n) => String(m.pr(n)['data-testid'] || '').endsWith('-show'));
    await m.press(fixRow);
    assert.equal(m.by('pitch-preflight'), undefined, 'the panel closes');
    assert.match(m.text(m.by('pitch-preflight-strip')), /Findings · 1 of \d+ · Slide 1 · Image/);
    await m.press(m.by('pitch-preflight-strip-next'));
    assert.match(m.text(m.by('pitch-preflight-strip')), /Findings · 2 of/);
    await m.press(m.by('pitch-preflight-strip-back'));
    assert.ok(m.by('pitch-preflight'), 'back to the panel, the result kept');
    assert.ok(!m.calls.some(([n]) => /update|save|assist\.run|setDismissed/i.test(n)), 'nothing written, nothing run');
  } finally { await m.close(); }
});

test('Dismiss and Undo on a warning, with no issue number', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => WARNINGS } });
  try {
    await openPanel(m);
    const look = m.by('pitch-preflight-look');
    const before = (m.text(look).match(/Slide/g) || []).length;
    assert.doesNotMatch(m.text(m.by('pitch-preflight')), /#\d{4}/, 'no issue number in the UI');
    const dismiss = m.walk(look).find((n) => String(m.pr(n)['data-testid'] || '').endsWith('-dismiss'));
    await m.press(dismiss);
    assert.match(m.text(m.by('pitch-preflight-dismissed')), /^Dismissed · Slide 1 ·/);
    assert.equal(m.text(m.by('pitch-preflight-dismissed-count')), '1 dismissed', 'kept for the version (D4208): no "here only"');
    assert.equal((m.text(m.by('pitch-preflight-look') || { childNodes: [] }).match(/Slide/g) || []).length, before - 1);
    await m.press(m.by('pitch-preflight-undo'));
    assert.equal(m.by('pitch-preflight-dismissed-count'), undefined);
  } finally { await m.close(); }
});

test('a reader sees the findings, with no Dismiss, Ask or Re-check', async () => {
  const m = await mountEditor({ user: ADMIN, answers: { deckGet: async () => WARNINGS } });
  try {
    await openPanel(m);
    assert.match(m.text(m.by('pitch-preflight-reader')), /Editors of this deck dismiss findings and ask for fixes\./);
    const ids = m.walk(m.by('pitch-preflight')).map((n) => String(m.pr(n)['data-testid'] || ''));
    assert.ok(ids.some((id) => id.endsWith('-show')), 'Show me stays');
    assert.ok(!ids.some((id) => id.endsWith('-dismiss') || id.endsWith('-ask')), 'no Dismiss, no Ask');
    assert.equal(m.by('pitch-preflight-recheck'), undefined);
  } finally { await m.close(); }
});

test('Export runs the check first: to fix holds it back; warnings only offer Export anyway', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => DEFECTS } });
  try {
    await m.press(m.by('deck-toolbar-share'));
    await m.press(m.by('deck-toolbar-item-export'));
    for (let i = 0; i < 6 && !m.by('pitch-preflight-gate-fix-list'); i += 1) await m.settle();
    assert.equal(m.by('pitch-export-dialog'), undefined, 'not straight to the dialog');
    assert.match(m.text(m.by('pitch-preflight-gate')), /Before you export/);
    assert.equal(m.by('pitch-preflight-gate-anyway'), undefined, 'no Export anyway with something to fix');
    assert.match(m.text(m.by('pitch-preflight-gate-wait')), /Export anyway opens once the 1 item to fix is fixed\./);
    await m.press(m.by('pitch-preflight-gate-fix'));
    assert.ok(m.by('pitch-preflight'), 'Fix first opens the panel');
  } finally { await m.close(); }
  const w = await mountEditor({ answers: { deckGet: async () => WARNINGS } });
  try {
    await w.press(w.by('deck-toolbar-share'));
    await w.press(w.by('deck-toolbar-item-export'));
    for (let i = 0; i < 6 && !w.by('pitch-preflight-gate-anyway'); i += 1) await w.settle();
    assert.match(w.text(w.by('pitch-preflight-gate-nothing')), /Nothing to fix/);
    await w.press(w.by('pitch-preflight-gate-anyway'));
    assert.ok(w.by('pitch-export-dialog'), 'Export anyway opens the dialog');
  } finally { await w.close(); }
});
