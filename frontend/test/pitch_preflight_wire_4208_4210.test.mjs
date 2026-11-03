// D4208 + D4210 (#3661 P1 and P2): "Check before you send" wired to the Worker.
//   P1 (#4208): the version's dismissals are read when the editor opens and written on Dismiss and
//     Undo; a write the Worker refuses is taken back and says so; a reader writes nothing.
//   P2 (#4210): "Ask Eadwyn to suggest a fix" on a text finding only (never sources, contrast or an
//     image, never a figure bound to a record): its hold line from the quote, one run of D899's card
//     tool (`tool: 'preflight_fix'`), the suggestion waiting in Ask (which opens), the charge against
//     the hold, nothing written to the deck; out of tokens reads "Not enough AI tokens · Add tokens".
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_preflight_wire_4208_4210.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADD_TOKENS, FIX_CHECKS, NOT_KEPT, TOKENS_OUT, canAskFix, chargedLine, fixBody, holdLine,
} from '../src/pages/raise/pitch/preflightUiModel.js';
import { cardEdit, cardEditLine } from '../src/pages/raise/pitch/deckV2Model.js';
import { ADMIN, DECK, mountEditor } from './_pitch_editor_mount.mjs';

const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
/** Synthetic only: no real company, person or figure. One placeholder (a text check) and one unsourced figure. */
const SLIDE = { title: 'Synthetic traction', blocks: [
  { id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 2), text: 'Add [Your logo] here' },
  { id: 'b2', kind: 'metric', grid: g(1, 3, 3, 4), label: 'MRR', value: '$9,000' },
] };
const WARNINGS = { ...DECK, slides: [SLIDE] };
const PLACEHOLDER = 'placeholder:0:b1:0';
const SOURCES = 'sources:0:b2:0';
const QUOTE = { action: 'preflight_fix', option: 'deck:shorten', ai: true, hold_microusd: 4000, model: 'synthetic' };
const RUN = { proposal: { uid: 'prop-synthetic-1' }, action: 'preflight_fix', option: 'deck:shorten', before: 'Add [Your logo] here', after: 'Add your logo', cost: { charged_microusd: 1000 } };
const out402 = () => Object.assign(new Error('You are out of AI tokens. Nothing was run.'), { status: 402, data: { error: 'insufficient_tokens' } });

async function openPanel(m) {
  await m.press(m.by('deck-more-open'));
  await m.press(m.by('deck-more-preflight'));
  for (let i = 0; i < 6 && !m.by('pitch-preflight-counts') && !m.by('pitch-preflight-nothing'); i += 1) await m.settle();
}
const named = (m, name) => m.calls.filter(([n]) => n === name);
const rowPart = (m, id, part) => m.by(`pitch-preflight-row-${id}-${part}`);

/* ------------------------------------------------------------------ *
 * P2, pure
 * ------------------------------------------------------------------ */

test('D4210: only a text finding on one text block with words can ask for a fix', () => {
  assert.deepEqual([...FIX_CHECKS], ['overflow', 'density', 'font', 'placeholder']);
  const text = SLIDE.blocks[0];
  for (const check of FIX_CHECKS) assert.equal(canAskFix({ check, block: 'b1' }, text), true, check);
  for (const check of ['sources', 'contrast', 'image', 'layout', 'alt', 'theme']) assert.equal(canAskFix({ check, block: 'b1' }, text), false, check);
  assert.equal(canAskFix({ check: 'density', block: null }, text), false, 'a whole-slide finding names no block');
  assert.equal(canAskFix({ check: 'font', block: 'b2' }, SLIDE.blocks[1]), false, 'a metric is a figure');
  assert.equal(canAskFix({ check: 'font', block: 'b1' }, { ...text, binding: { source_key: 'revenue.mrr' } }), false, 'a bound figure is never rewritten');
  assert.equal(canAskFix({ check: 'font', block: 'b1' }, { ...text, text: '  ' }), false, 'no words, nothing to shorten');
  assert.equal(canAskFix({ check: 'font', block: 'b1' }, null), false);
});

test('D4210: the body, the hold line and the charge', () => {
  assert.deepEqual(fixBody({ check: 'placeholder', block: 'b1', headline: '"[Your logo]" looks like a bracketed sample.' }, SLIDE.blocks[0]), {
    tool: 'preflight_fix',
    finding: { check: 'placeholder', block: 'b1', title: '"[Your logo]" looks like a bracketed sample.' },
    block: { id: 'b1', kind: 'text' },
    text: 'Add [Your logo] here',
  });
  assert.equal(fixBody({ check: 'font', block: 'b1', headline: 'x'.repeat(300) }, SLIDE.blocks[0]).finding.title.length, 200);
  assert.equal(holdLine(QUOTE), 'Holds up to $0.0040 · you pay what it uses');
  assert.equal(holdLine(null), 'Reading the cost…');
  assert.equal(holdLine({ ai: false, message: 'AI assistance is off on this page.' }), 'AI assistance is off on this page.');
  assert.equal(chargedLine(1000, 4000), 'Charged $0.0010 of $0.0040 held');
  assert.equal(chargedLine(null, 4000), null, 'an unknown charge is not drawn');
  // Ask names a fix by what it is, and places it like any text edit.
  const edit = cardEdit({ uid: 'p1', rail_option: 'deck:shorten', status: 'proposed', payload: { deck_id: 31, card: 0, action: 'preflight_fix', before: 'a b', after: 'a' } }, 31);
  assert.deepEqual([edit.kind, cardEditLine(edit)], ['text', 'Card 1 · Suggested fix']);
});

/* ------------------------------------------------------------------ *
 * P1, mounted
 * ------------------------------------------------------------------ */

test('D4208: the version\'s dismissals are read on open, and a dismissed warning stays out of the count', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => WARNINGS, 'preflight.dismissals': async () => ({ dismissed: [SOURCES] }) } });
  try {
    assert.deepEqual(named(m, 'preflight.dismissals').map((c) => c.slice(1)), [[DECK.id, DECK.version]], 'read once, for this version');
    await openPanel(m);
    assert.equal(m.text(m.by('pitch-preflight-dismissed-count')), '1 dismissed');
    assert.equal(m.by(`pitch-preflight-row-${SOURCES}`), undefined, 'the dismissed finding is not listed');
    assert.ok(m.by(`pitch-preflight-row-${PLACEHOLDER}`), 'the other warning is');
  } finally { await m.close(); }
});

test('D4208: Dismiss and Undo are kept for the version; a refused write is taken back and says so', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => WARNINGS } });
  try {
    await openPanel(m);
    await m.press(rowPart(m, SOURCES, 'dismiss'));
    assert.deepEqual(named(m, 'preflight.setDismissed').map((c) => c.slice(1)), [[DECK.id, { version: DECK.version, finding_id: SOURCES, dismissed: true, severity: 'warning' }]]);
    assert.equal(m.text(m.by('pitch-preflight-dismissed-count')), '1 dismissed');
    await m.press(m.by('pitch-preflight-undo'));
    assert.deepEqual(named(m, 'preflight.setDismissed')[1].slice(1), [DECK.id, { version: DECK.version, finding_id: SOURCES, dismissed: false }]);
    assert.equal(m.by('pitch-preflight-dismissed-count'), undefined);
    assert.equal(m.by('pitch-preflight-not-kept'), undefined);
  } finally { await m.close(); }
  const r = await mountEditor({ answers: { deckGet: async () => WARNINGS, 'preflight.setDismissed': async () => { throw Object.assign(new Error('no'), { status: 503 }); } } });
  try {
    await openPanel(r);
    await r.press(rowPart(r, SOURCES, 'dismiss'));
    assert.equal(r.text(r.by('pitch-preflight-not-kept')), NOT_KEPT);
    assert.equal(r.by('pitch-preflight-dismissed-count'), undefined, 'the dismissal is taken back');
    assert.ok(r.by(`pitch-preflight-row-${SOURCES}`), 'and the finding is listed again');
  } finally { await r.close(); }
});

test('D4208 + D4210: a reader reads the dismissals and neither writes nor asks', async () => {
  const m = await mountEditor({ user: ADMIN, answers: { deckGet: async () => WARNINGS, 'preflight.dismissals': async () => ({ dismissed: [SOURCES] }), 'assist.quote': async () => QUOTE } });
  try {
    await openPanel(m);
    assert.equal(m.text(m.by('pitch-preflight-dismissed-count')), '1 dismissed', 'a reader sees what editors dismissed');
    const ids = m.walk(m.by('pitch-preflight')).map((n) => String(m.pr(n)['data-testid'] || ''));
    assert.ok(!ids.some((id) => /-(dismiss|ask|hold)$/.test(id)), 'no Dismiss, no Ask');
    assert.deepEqual([named(m, 'preflight.setDismissed').length, named(m, 'assist.quote').length], [0, 0]);
  } finally { await m.close(); }
});

/* ------------------------------------------------------------------ *
 * P2, mounted
 * ------------------------------------------------------------------ */

test('D4210: a text finding shows its hold; Run leaves one suggestion waiting in Ask, charged within the hold, and writes nothing to the deck', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => WARNINGS, 'assist.quote': async () => QUOTE, 'assist.run': async () => RUN } });
  try {
    await openPanel(m);
    assert.equal(m.text(rowPart(m, PLACEHOLDER, 'hold')), 'Holds up to $0.0040 · you pay what it uses');
    assert.equal(rowPart(m, SOURCES, 'ask'), undefined, 'never a fix for a sources finding');
    const [, deckId, card, body] = named(m, 'assist.quote')[0];
    assert.deepEqual([deckId, card, body.tool, body.finding.check, body.finding.block, body.block, body.text], [DECK.id, 0, 'preflight_fix', 'placeholder', 'b1', { id: 'b1', kind: 'text' }, 'Add [Your logo] here']);
    assert.equal(named(m, 'assist.quote').length, 1, 'quoted once, for the one finding that can ask');
    const listsBefore = named(m, 'proposals.list').length;
    await m.press(rowPart(m, PLACEHOLDER, 'ask'));
    const runs = named(m, 'assist.run');
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0][3], body, 'the run sends what was quoted');
    assert.equal(decodeURIComponent(runs[0][4]?.['X-Rail-Option'] || ''), 'deck:shorten', 'charged as Shorten');
    assert.match(m.text(rowPart(m, PLACEHOLDER, 'waiting')), /A suggestion is waiting in Ask\./);
    assert.equal(m.text(rowPart(m, PLACEHOLDER, 'charged')), 'Charged $0.0010 of $0.0040 held');
    assert.ok(m.by('pitch-ask-sheet'), 'Ask opens, where the suggestion waits');
    assert.ok(named(m, 'proposals.list').length > listsBefore, 'and reads what waits again');
    assert.ok(!m.calls.some(([n]) => /update|save|setDismissed/i.test(n)), 'nothing written to the deck: Accept places it, Save keeps it');
  } finally { await m.close(); }
});

test('D4210: out of tokens reads "Not enough AI tokens · Add tokens", on the quote or the run, and the checks still run', async () => {
  const q = await mountEditor({ answers: { deckGet: async () => WARNINGS, 'assist.quote': async () => { throw out402(); } } });
  try {
    await openPanel(q);
    assert.equal(q.text(rowPart(q, PLACEHOLDER, 'tokens')), `${TOKENS_OUT} · ${ADD_TOKENS}`);
    assert.equal(rowPart(q, PLACEHOLDER, 'ask'), undefined);
    assert.ok(q.by('pitch-preflight-counts'), 'the checks still ran');
    assert.equal(named(q, 'assist.run').length, 0);
  } finally { await q.close(); }
  const r = await mountEditor({ answers: { deckGet: async () => WARNINGS, 'assist.quote': async () => QUOTE, 'assist.run': async () => { throw out402(); } } });
  try {
    await openPanel(r);
    await r.press(rowPart(r, PLACEHOLDER, 'ask'));
    assert.equal(r.text(rowPart(r, PLACEHOLDER, 'tokens')), `${TOKENS_OUT} · ${ADD_TOKENS}`);
    assert.equal(r.by('pitch-ask-sheet'), undefined, 'nothing waits, so Ask stays shut');
  } finally { await r.close(); }
});
