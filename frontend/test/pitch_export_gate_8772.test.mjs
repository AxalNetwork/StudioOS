// D8772 (#8772) part 3: the preflight gate inside Export (PTF05 to PTF07).
//   - pure (`exportGateModel.js`): what Export's check read; the confirmation's words by version and
//     count; a finding named by its card's uid, so hidden cards do not make the saved version's
//     finding and the draft's two different things; how the draft differs from the version being
//     exported (fixed there, a blocker only the draft has, not checked, another version); "Show in
//     your draft" only for a card the draft still has; the ids an export confirms; the history line;
//   - mounted: the repair made in the draft, then Export: the gate says it checked v3, its rows offer
//     "Show in your draft", the confirmation is a checkbox that can be taken back and says what the
//     history keeps, Export says it waits for it, the note says the draft fixed the MRR tile v3 still
//     has, and the export sends the confirmed warnings' ids; "Show in your draft" closes Export and
//     opens the draft's own finding on the slide; the ledger's "Exported with 2 warnings confirmed".
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_export_gate_8772.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SEVERITY, runPreflight } from '../src/pages/raise/pitch/preflightModel.js';
import { gateOf, groupsOf } from '../src/pages/raise/pitch/preflightUiModel.js';
import {
  SHOW_IN_DRAFT, confirmWords, confirmedIds, confirmedLine, draftDiffers, draftSummary, findingKey, inDraft, scopeLine, showInDraftLabel,
} from '../src/pages/raise/pitch/exportGateModel.js';
import { DECK, mountEditor } from './_pitch_editor_mount.mjs';

/** Synthetic only: no real company, person or figure. */
const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const OPENING = { uid: 'c1', title: 'Synthetic opening', blocks: [{ id: 't1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Synthetic seed deck' }] };
const TEAM = { uid: 'c2', title: 'Synthetic team', blocks: [] };
const mrr = { id: 'm1', kind: 'metric', grid: g(1, 3, 2, 3), label: 'MRR', value: '$34.2k', binding: { source_key: 'grow.mrr', snapshot_hash: 'h-mrr', grade: 'Measured', as_of: null } };
const paying = { id: 'm2', kind: 'metric', grid: g(5, 7, 2, 3), label: 'Paying customers', value: '38', binding: { source_key: 'grow.paying_customers', snapshot_hash: 'h-pay', grade: 'Measured', as_of: null } };
const TRACTION = { uid: 'c3', title: 'Synthetic traction', blocks: [mrr, paying] };

const row = (over) => ({ id: 'sources:2:m1:0', check: 'sources', severity: SEVERITY.warning, card: 2, block: 'm1', slide: 3, where: 'Slide 3 · Metric · MRR $34.2k', headline: 'The source\'s date is not recorded.', showLabel: 'Show metric MRR $34.2k on slide 3', ...over });
const MRR_ROW = row();
const PAY_ROW = row({ id: 'sources:2:m2:0', block: 'm2', where: 'Slide 3 · Metric · Paying customers 38', showLabel: 'Show metric Paying customers 38 on slide 3' });
const TITLE_ROW = row({ id: 'clipped:1:t9:0', check: 'clipped', severity: SEVERITY.blocking, card: 1, block: 't9', slide: 2, where: 'Slide 2 · Title', headline: 'The text is cut off at export size.' });

test('what Export checked, and the confirmation in words', () => {
  assert.equal(scopeLine(7), 'Checked: v7 · the saved version Export sends');
  assert.equal(scopeLine(null), 'Checked: this version · the saved version Export sends');
  assert.deepEqual(confirmWords(7, 3, 'Export PDF'), {
    label: 'Export v7 with these 3 warnings',
    record: 'The export history records the version, the format, the file’s fingerprint and the 3 warnings you confirmed.',
    waits: 'Export PDF waits for the confirmation above.',
    done: 'Exporting v7 with the 3 warnings above confirmed.',
  });
  const one = confirmWords(8, 1, 'Export HTML');
  assert.equal(one.label, 'Export v8 with this warning');
  assert.equal(one.record, 'The export history records the version, the format, the file’s fingerprint and the warning you confirmed.');
  assert.equal(one.done, 'Exporting v8 with the warning above confirmed.');
  assert.equal(SHOW_IN_DRAFT, 'Show in your draft');
  assert.equal(showInDraftLabel(MRR_ROW), 'Show metric MRR $34.2k in your draft', 'the row\'s own name, without the export\'s slide number');
});

test('a finding is named by its card\'s uid: a hidden card does not make the same finding two', () => {
  const draftCards = [OPENING, { ...TEAM, hidden: true }, TRACTION];
  const exportCards = [OPENING, TRACTION];
  const inExport = row({ card: 1 });
  assert.equal(findingKey(inExport, exportCards), findingKey(MRR_ROW, draftCards), 'slide 2 of the export is slide 3 of the draft: the same tile');
  assert.equal(findingKey(inExport, exportCards), 'c3|m1|sources|The source\'s date is not recorded.');
  assert.notEqual(findingKey(PAY_ROW, draftCards), findingKey(MRR_ROW, draftCards), 'two tiles are two findings');
  assert.equal(findingKey(row({ card: 0 }), [{ title: 'No uid' }]), '#0|m1|sources|The source\'s date is not recorded.', 'no uid: the place stands in');
  assert.equal(findingKey(null, exportCards), null);
});

test('how the draft differs from the version being exported', () => {
  const version = { id: 31, version: 7 };
  const slides = [OPENING, TEAM, TRACTION];
  const summary = (groups, over = {}) => ({ ...draftSummary({ deck: { id: 31, version: 7 }, cards: slides, dirty: true, groups }), ...over });
  // PTF05: the draft fixed the MRR tile, and has a title v7 does not have cut off.
  const draft = summary({ fix: [TITLE_ROW], look: [PAY_ROW] });
  assert.deepEqual(draft.uids, ['c1', 'c2', 'c3']);
  assert.equal(draftDiffers({ draft, version, rows: [MRR_ROW, PAY_ROW], slides }),
    'Your draft differs from v7. It has fixed 1 finding v7 still has (Slide 3 · Metric · MRR $34.2k) and has 1 blocker v7 doesn’t have (Slide 2 · Title). Save version to export your draft.');
  assert.equal(draftDiffers({ draft: summary({ fix: [], look: [PAY_ROW] }), version, rows: [MRR_ROW, PAY_ROW], slides }),
    'Your draft differs from v7. It has fixed 1 finding v7 still has (Slide 3 · Metric · MRR $34.2k). Save version to export your draft.');
  assert.equal(draftDiffers({ draft: summary({ fix: [], look: [MRR_ROW, PAY_ROW] }), version, rows: [MRR_ROW, PAY_ROW], slides }),
    'Your draft differs from v7, with the same findings. Save version to export your draft.', 'a warning both have is not called fixed');
  assert.equal(draftDiffers({ draft: summary({ fix: [TITLE_ROW], look: [] }), version, rows: [TITLE_ROW], slides }),
    'Your draft differs from v7, with the same findings. Save version to export your draft.', 'a blocker v7 has too is not "one v7 doesn’t have"');
  assert.equal(draftDiffers({ draft: summary(null), version, rows: [MRR_ROW], slides }),
    'Your draft differs from v7: its unsaved edits are not in this export and were not checked here. Save version to export your draft.', 'no current draft check: nothing is claimed about it');
  assert.equal(draftDiffers({ draft: summary({ fix: [], look: [] }, { dirty: false }), version, rows: [MRR_ROW], slides }), null, 'no unsaved edits: nothing differs');
  assert.equal(draftDiffers({ draft, version: { id: 30, version: 6 }, rows: [MRR_ROW], slides }), null, 'another version than the draft\'s: the draft says nothing of it');
  assert.equal(draftDiffers({ draft: null, version, rows: [MRR_ROW], slides }), null, 'no editor, no draft');
});

test('"Show in your draft" only where the draft still has the card', () => {
  const draft = draftSummary({ deck: { id: 31, version: 7 }, cards: [OPENING, TRACTION], dirty: true, groups: null });
  assert.equal(inDraft(draft, row({ card: 1 }), [OPENING, TRACTION]), true);
  assert.equal(inDraft(draft, row({ card: 1 }), [OPENING, TEAM]), false, 'TEAM was removed in the draft');
  assert.equal(inDraft(draft, row({ card: 0 }), [{ title: 'No uid' }]), false, 'no uid: nothing to find it by');
  assert.equal(inDraft(null, MRR_ROW, [OPENING, TEAM, TRACTION]), false);
});

test('the ids an export confirms, and the history line', () => {
  const gate = { open: true, fix: [], look: [MRR_ROW, PAY_ROW], anyway: 'Export anyway' };
  assert.deepEqual(confirmedIds(gate, true), ['sources:2:m1:0', 'sources:2:m2:0']);
  assert.deepEqual(confirmedIds(gate, false), [], 'not confirmed: none');
  assert.deepEqual(confirmedIds({ open: false, fix: [], look: [] }, false), [], 'a clean check: nothing to confirm');
  assert.deepEqual(confirmedIds(null, true), []);
  assert.equal(confirmedLine({ warnings_confirmed: 3 }), 'Exported with 3 warnings confirmed');
  assert.equal(confirmedLine({ warnings_confirmed: 1 }), 'Exported with 1 warning confirmed');
  assert.equal(confirmedLine({ warnings_confirmed: 0 }), null, 'nothing confirmed: nothing said');
  assert.equal(confirmedLine({ warnings_confirmed: null }), null, 'a row from before: not "no warnings"');
  assert.equal(confirmedLine(undefined), null);
  assert.doesNotMatch(readFileSync(new URL('../src/pages/raise/pitch/exportGateModel.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /#\d{3,}/, 'no issue number in the UI');
});

test('the ids a real check gives the dialog are ids the Worker keeps (`deck_exports.ts` FINDING_ID)', () => {
  const src = readFileSync(new URL('../../cloudflare-worker/src/routes/deck_exports.ts', import.meta.url), 'utf8');
  const FINDING_ID = new RegExp(src.match(/export const FINDING_ID = \/(.+)\/;/)[1]);
  const deck = { id: 10, version: 2, theme: null, slides: [{ uid: 'c1', title: 'Synthetic traction', blocks: [
    { ...mrr, grid: g(1, 3, 2, 3) },
    { id: 'b2', kind: 'text', style: 'paragraph', grid: g(5, 12, 2, 3), text: 'Add [Your logo] here' },
  ] }] };
  const gate = gateOf(groupsOf(runPreflight(deck, {}), { slides: deck.slides }), 'export');
  const ids = confirmedIds(gate, true);
  assert.ok(ids.length >= 2, 'the undated tile and the sample, at least');
  for (const id of ids) assert.match(id, FINDING_ID, `${id} is kept by the Worker`);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const LIVE = { ...DECK, slides: [OPENING, TEAM, TRACTION] };
const ITEMS = [
  { source_key: 'grow.mrr', state: 'recorded', value: 34200, unit: 'usd', as_of: '2026-11-20', snapshot_hash: 'h-mrr', grade: 'Measured', record_ref: 'r1' },
  { source_key: 'grow.paying_customers', state: 'recorded', value: 38, unit: 'count', as_of: '2026-11-20', snapshot_hash: 'h-pay', grade: 'Measured', record_ref: 'r2' },
];
const SOURCES = { project_id: 7, items: ITEMS, coverage: { slots: 2, filled: 2, by_grade: {}, not_recorded: 0, unreadable: 0 } };
const fakeExport = async () => ({ ok: true, blob: async () => new Blob(['pdf']), headers: { get: () => null } });

async function until(m, ready, what) {
  const deadline = performance.now() + 5000;
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`never reached: ${what}`);
    await m.settle();
  }
}
function allowDownloadClick() {
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; if (tag === 'a') { n.click = () => {}; n.remove = () => { n.parentNode?.removeChild?.(n); }; } return n; };
}
/** The part-2 path: Show the MRR tile, add its date in the draft, Back re-checks the draft. */
async function repairMrr(m) {
  await m.press(m.by('deck-more-open'));
  await m.press(m.by('deck-more-preflight'));
  await until(m, () => m.by('pitch-preflight-row-sources:2:m1:0-show'), 'the draft check');
  await m.press(m.by('pitch-preflight-row-sources:2:m1:0-show'));
  await m.press(m.by('pitch-preflight-strip-repair-run'));
  await m.press(m.by('pitch-preflight-strip-back'));
  await until(m, () => m.by('pitch-preflight-fixed'), 'the re-check of the draft');
}
async function openExport(m) {
  await m.press(m.by('deck-toolbar-share'));
  await m.press(m.by('deck-toolbar-item-export'));
  await until(m, () => m.by('pitch-preflight-gate-anyway') || m.by('pitch-export-dialog'), 'the editor\'s gate');
  if (m.by('pitch-preflight-gate-anyway')) await m.press(m.by('pitch-preflight-gate-anyway'));
  await until(m, () => m.by('pitch-export-run') && !m.by('pitch-export-checking'), 'Export\'s own check');
}

test('mounted: Export v3 after a repair in the draft — scope, Show in your draft, the checkbox, the note, the ids sent', async () => {
  // Mutation checked: the checkbox not taking the confirmation back → the second "disabled" fails; the export not
  // sending `confirmed` → the call's options fail; draftDiffers keyed by slide index → the note names no fix.
  const m = await mountEditor({ answers: { deckGet: async () => LIVE, 'sources.list': async () => SOURCES, deckExport: fakeExport } });
  allowDownloadClick();
  try {
    await repairMrr(m);
    await openExport(m);
    const gate = m.by('pitch-export-gate');
    assert.ok(gate, 'v3 still has both undated tiles');
    assert.equal(m.text(m.by('pitch-export-scope')), 'Checked: v3 · the saved version Export sends');
    const show = m.by('pitch-export-gate-row-sources:2:m1:0-show');
    assert.equal(m.text(show), 'Show in your draft');
    assert.equal(m.pr(show)['aria-label'], 'Show metric MRR $34.2k in your draft');

    const n = m.walk(gate).filter((x) => m.pr(x)['data-finding-id'] != null).length;
    assert.ok(n >= 2, 'the two tiles, at least');
    assert.match(m.text(m.by('pitch-export-gate-confirm')), new RegExp(`^Export v3 with these ${n} warnings The export history records the version, the format, the file’s fingerprint and the ${n} warnings you confirmed\\.$`));
    const run = m.by('pitch-export-run');
    assert.equal(m.pr(run).disabled, true);
    assert.equal(m.text(m.by('pitch-export-why')), 'Export PDF waits for the confirmation above.');
    assert.equal(m.pr(run)['aria-describedby'], 'pitch-export-why');
    assert.match(m.text(m.by('pitch-export-draft-differs')), /^Your draft differs from v3\. It has fixed 1 finding v3 still has \(Slide 3 · Metric · MRR \$34\.2k\)\. Save version to export your draft\.$/);

    await m.type(m.by('pitch-export-gate-anyway'), true);
    assert.equal(m.pr(m.by('pitch-export-run')).disabled, false, 'confirmed');
    assert.equal(m.by('pitch-export-why'), undefined);
    assert.equal(m.text(m.by('pitch-export-confirmed')), `Exporting v3 with the ${n} warnings above confirmed.`);
    await m.type(m.by('pitch-export-gate-anyway'), false);
    assert.equal(m.pr(m.by('pitch-export-run')).disabled, true, 'unticked: the confirmation is taken back');
    assert.equal(m.by('pitch-export-confirmed'), undefined);
    await m.type(m.by('pitch-export-gate-anyway'), true);
    await m.press(m.by('pitch-export-run'));
    const call = m.calls.find(([name]) => name === 'deckExport');
    assert.ok(call, 'exported');
    assert.equal(call[1], 31, 'v3');
    assert.ok(call[3].confirmed.includes('sources:2:m1:0') && call[3].confirmed.includes('sources:2:m2:0'), 'both tiles\' warnings, by id');
    assert.equal(call[3].confirmed.length, n, 'every warning confirmed, and only those');
  } finally { await m.close(); }
});

test('mounted: Show in your draft closes Export and opens the draft\'s own finding on its slide', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => LIVE, 'sources.list': async () => SOURCES } });
  try {
    await repairMrr(m);
    await openExport(m);
    await m.press(m.by('pitch-export-gate-row-sources:2:m2:0-show'));
    assert.equal(m.by('pitch-export-dialog'), undefined, 'Export is closed');
    assert.match(m.text(m.by('pitch-preflight-strip')), /Slide 3 · Metric · Paying customers 38/, 'the draft\'s finding about the same tile');
    assert.equal(m.text(m.by('pitch-preflight-strip-repair-run')), 'Add the source date · 20 Nov 2026', 'its repair, in the draft');
  } finally { await m.close(); }
});

test('mounted: the ledger says how many warnings the last export confirmed', async () => {
  const last = { id: 4, deck_id: 31, version: 3, format: 'pdf', content_hash: 'b'.repeat(64), by: 'Synthetic Founder', created_at: '2026-11-27 10:00:00', notes: false, sources: true, copy: 'investor', warnings_confirmed: 2, confirmed_findings: ['sources:2:m1:0', 'sources:2:m2:0'] };
  const m = await mountEditor({ answers: { deckGet: async () => LIVE, 'sources.list': async () => SOURCES, deckExportList: async () => ({ exports: [last] }) } });
  try {
    await openExport(m);
    assert.equal(m.text(m.by('pitch-export-last-confirmed')), 'Exported with 2 warnings confirmed');
    assert.equal(m.by('pitch-export-draft-differs'), undefined, 'no unsaved edits: no note');
  } finally { await m.close(); }
});
