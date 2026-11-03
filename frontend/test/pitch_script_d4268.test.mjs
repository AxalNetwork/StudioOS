/**
 * D4268 (#4268, D4254 P2a): Script & rehearsal › Script, mounted on stubbed
 * reads, its words, and its client. Every venture, card and figure is synthetic.
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_script_d4268.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { deckScriptApi } from '../src/lib/api/deckScript.js';
import ScriptTab from '../src/pages/raise/pitch/ScriptTab.jsx';
import {
  EMPTY, FAILED, RULE, STALE, budgetsS, failReason, fileName, fingerprint, headerLine, holdLine, isStale, overLine, paceLine,
  rehearsalLength, scriptText, sectionLine, spokenS, unsavedLine, wordsOf,
} from '../src/pages/raise/pitch/scriptModel.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const SLIDES = [
  { uid: 'c-problem', title: 'Problem', notes: 'Teams lose two days a month.', blocks: [{ id: 'p1', kind: 'text', text: 'Finance teams match bank lines by hand.' }] },
  { uid: 'c-traction', title: 'Traction', blocks: [{ id: 'm1', kind: 'metric', label: 'Paying teams', value: '42' }] },
  { uid: 'c-team', title: 'Team', blocks: [{ id: 'p3', kind: 'text', text: 'Two founders.' }] },
];
const DECK = { id: 31, project_id: 7, version: 3, title: 'Seed deck', slides: SLIDES };
const QUOTE = { ai: true, hold_microusd: 12000, model: 'Synthetic model', count: 3, length_s: 180, pace: { wpm: 120, source: 'rehearsal', rehearsal_at: '2026-11-02 18:20:00', pitch_seconds: 300 }, targets: [] };

// ─────────────────────────────────────────────────────────── the words

test('the words: budgets, spoken time, the header, the section line, over budget, the hold and the pace', () => {
  assert.deepEqual(budgetsS(180, 7), [26, 26, 26, 26, 26, 25, 25], 'Rehearse\'s split');
  assert.equal(wordsOf('  MRR is up.  '), 3);
  assert.equal(spokenS(60, 120), 30);
  assert.equal(spokenS(0, 120), 0);
  assert.equal(spokenS(75, 0), 30, 'no pace reads as 150 words a minute');
  assert.equal(headerLine({ spentS: 200, lengthS: 180, scripted: 9, cards: 12 }), 'Estimated 3:20 · target 3:00 · 9 of 12 cards');
  assert.equal(sectionLine(38, 15, 15), '38 words · 0:15 of 0:15');
  assert.equal(sectionLine(1, 1, 15), '1 word · 0:01 of 0:15');
  assert.equal(overLine(34, 25), '9 s over this card’s budget');
  assert.equal(overLine(25, 25), null, 'on the budget is not over it');
  assert.equal(unsavedLine(1), '1 card not saved');
  assert.equal(unsavedLine(3), '3 cards not saved');
  assert.equal(unsavedLine(0), null);
  assert.equal(holdLine({ ai: true, hold_microusd: 10000 }), 'Holds up to $0.0100 · you pay what it uses');
  assert.equal(holdLine({ ai: true, hold_microusd: null }), null, 'never a guessed price');
  assert.equal(holdLine({ ai: false }), null);
  assert.equal(paceLine(QUOTE.pace), 'Paced at 120 words a minute, from your rehearsal on 2 Nov.');
  assert.equal(paceLine({ wpm: 150, source: 'default' }), 'Paced at 150 words a minute. Rehearse once and the script is paced to you.');
  assert.equal(rehearsalLength(QUOTE.pace), 300);
  assert.equal(rehearsalLength({ wpm: 150, source: 'default', pitch_seconds: null }), null, 'nothing to match without a rehearsal');
  assert.match(failReason('figure_added'), /figure that is not on the card/);
  assert.equal(RULE, 'The script uses only the figures on each card.');
});

test('out of date: a card whose words changed after its script was generated; Copy and Download carry every card', () => {
  const fp = fingerprint(SLIDES[0]);
  assert.equal(isStale(SLIDES[0], fp), false);
  assert.equal(isStale({ ...SLIDES[0], blocks: [{ id: 'p1', kind: 'text', text: 'Finance teams match bank lines by hand, weekly.' }] }, fp), true);
  assert.equal(isStale({ ...SLIDES[1], blocks: [{ id: 'm1', kind: 'metric', label: 'Paying teams', value: '43' }], notes: 'x' }, fingerprint(SLIDES[1])), true, 'a figure changed is a change');
  assert.equal(isStale(SLIDES[0], null), false, 'a script never generated is never out of date');
  assert.equal(isStale({ ...SLIDES[2], notes: '' }, 'old'), false, 'no script, nothing out of date');
  assert.equal(scriptText('Seed deck', [{ title: 'Problem', text: 'Two days.' }, { title: 'Team', text: '' }]),
    'Seed deck · Script\n\n1. Problem\n\nTwo days.\n\n2. Team\n\n(No script yet.)\n');
  assert.equal(fileName('Seed deck · v7'), 'seed-deck-v7-script.txt');
  assert.equal(fileName(''), 'pitch-deck-script.txt');
});

test('the client: the quote, the press with its own key, and the notes-only save with If-Match', async () => {
  const previous = globalThis.fetch;
  const previousStore = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers || {});
    calls.push([new URL(String(url), 'http://x').pathname.replace(/^\/api/, ''), init.method, init.body, headers.get('Idempotency-Key'), headers.get('If-Match')]);
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await deckScriptApi.scriptQuote(7, { length_s: 180 });
    await deckScriptApi.script(7, { length_s: 120, cards: ['c-team'] }, { 'Idempotency-Key': 'press-0001' });
    await deckScriptApi.saveScript(7, [{ card_uid: 'c-team', notes: 'Two founders.' }], 3);
  } finally { globalThis.fetch = previous; globalThis.localStorage = previousStore; }
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['/decks/7/script/quote', 'POST'], ['/decks/7/script', 'POST'], ['/decks/7/notes-script', 'PUT']]);
  assert.equal(calls[1][2], JSON.stringify({ length_s: 120, cards: ['c-team'] }));
  assert.equal(calls[1][3], 'press-0001');
  assert.equal(calls[2][2], JSON.stringify({ notes: [{ card_uid: 'c-team', notes: 'Two founders.' }] }));
  assert.equal(calls[2][4], '3');
  assert.match(src('lib/apiModules.generated.js'), /export \* from '\.\/api\/deckScript\.js';/);
  assert.match(src('pages/raise/pitch/PitchStudio.jsx'), /<ScriptTab reads=\{reads\} readOnly=\{readOnly\} \/>/);
  assert.doesNotMatch(src('pages/raise/pitch/PitchStudio.jsx'), /The script, card by card, is coming/);
});

// ─────────────────────────────────────────────────────────── mounted

async function mount({ readOnly = false, answers = {}, from = null, deck = DECK } = {}) {
  const before = { ...deckScriptApi };
  const calls = [];
  const stubs = {
    scriptQuote: async () => QUOTE,
    script: async () => ({ cards: [], failed: [] }),
    saveScript: async () => ({ deck: { ...deck, version: 4 }, saved: 1 }),
    ...answers,
  };
  for (const [k, fn] of Object.entries(stubs)) deckScriptApi[k] = (...a) => { calls.push([k, ...a]); return fn(...a); };
  const restore = installDocument();
  if (from) localStorage.setItem('axal.script.from.7', JSON.stringify(from));
  let reloads = 0;
  const reads = { project: { id: 7 }, versions: { status: 'ok', data: { versions: [{ id: deck.id, is_current: true }] } }, deck: { status: 'ok', data: deck }, reload: () => { reloads += 1; } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, h(ScriptTab, { reads, readOnly }))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr, reloads: () => reloads,
    text: (n = container) => text(n).replace(/\s+/g, ' ').trim(),
    async press(node) { if (!node) throw new Error('no such node'); await act(async () => { await pr(node).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(node, value) { await act(async () => { pr(node).onChange?.({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); Object.assign(deckScriptApi, before); },
  };
}

const RUN = {
  cards: [
    { card_uid: 'c-problem', index: 0, budget_s: 60, target_words: 120, notes: 'Every month, finance teams lose two days matching bank lines.', words: 10, model: 'Synthetic model' },
    { card_uid: 'c-team', index: 2, budget_s: 60, target_words: 120, notes: Array(150).fill('word').join(' '), words: 150, model: 'Synthetic model' },
  ],
  failed: [{ card_uid: 'c-traction', index: 1, reason: 'figure_added' }],
  hold_microusd: 12000, charged_microusd: 6000,
};

test('the document before a run: the hold, the rule and the pace, each card\'s time against its budget, and the empty state', async () => {
  const m = await mount();
  try {
    assert.deepEqual(m.calls.find((c) => c[0] === 'scriptQuote').slice(1), [31, { length_s: 180, audience: 'investor_meeting', tone: 'clear' }]);
    assert.equal(m.text(m.by('pitch-script-hold')), 'Holds up to $0.0120 · you pay what it uses');
    assert.equal(m.text(m.by('pitch-script-rule')), `${RULE} Paced at 120 words a minute, from your rehearsal on 2 Nov.`);
    assert.equal(m.text(m.by('pitch-script-estimate')), 'Estimated 0:03 · target 3:00 · 1 of 3 cards');
    assert.equal(m.text(m.by('pitch-script-line-0')), '6 words · 0:03 of 1:00');
    assert.equal(m.text(m.by('pitch-script-empty-1')), EMPTY);
    assert.equal(m.by('pitch-script-empty-0'), undefined, 'a card with a script is not empty');
    assert.equal(m.pr(m.by('pitch-script-save')).disabled, true, 'nothing to save yet');
    assert.equal(m.by('pitch-script-unsaved'), undefined);
    assert.equal(m.text(m.by('pitch-script-download')), 'Download .txt');
  } finally { await m.close(); }
});

test('Generate places drafts as Not saved, marks the failed card with Try again and the over-budget one, and saves only the drafts', async () => {
  const m = await mount({ answers: { script: async () => RUN } });
  try {
    await m.press(m.by('pitch-script-generate'));
    const run = m.calls.find((c) => c[0] === 'script');
    assert.deepEqual(run.slice(1, 3), [31, { length_s: 180, audience: 'investor_meeting', tone: 'clear' }]);
    assert.match(run[3]['Idempotency-Key'], /\S{8,}/, 'each press carries its own key');
    assert.equal(m.text(m.by('pitch-script-unsaved')), '2 cards not saved');
    assert.equal(m.text(m.by('pitch-script-not-saved-0')), 'Not saved');
    assert.equal(m.text(m.by('pitch-script-generated-0')), 'Generated · Synthetic model');
    assert.equal(m.pr(m.by('pitch-script-text-0')).value, RUN.cards[0].notes);
    assert.match(m.text(m.by('pitch-script-failed-1')), new RegExp(`^${FAILED}`));
    assert.match(m.text(m.by('pitch-script-failed-1')), /figure that is not on the card/);
    assert.ok(m.by('pitch-script-retry-1'), 'a failed card has Try again');
    assert.equal(m.by('pitch-script-regenerate-1'), undefined, 'and Try again is its only button');
    assert.ok(m.by('pitch-script-regenerate-0'), 'a placed card keeps Regenerate this card');
    assert.equal(m.text(m.by('pitch-script-over-2')), '15 s over this card’s budget', '150 words at 120 a minute is 75 s of a 60 s budget');
    assert.match(m.text(m.by('pitch-script-card-time-2')), /^1:15 of 1:00/);
    await m.press(m.by('pitch-script-save'));
    const save = m.calls.find((c) => c[0] === 'saveScript');
    assert.deepEqual(save.slice(1), [31, [{ card_uid: 'c-problem', notes: RUN.cards[0].notes }, { card_uid: 'c-team', notes: RUN.cards[1].notes }], 3]);
    assert.equal(m.reloads(), 1, 'the studio reads the new version');
    assert.equal(m.text(m.by('pitch-script-note')), 'Script saved on 2 cards, as one new version.');
    const kept = JSON.parse(localStorage.getItem('axal.script.from.7'));
    assert.deepEqual(Object.keys(kept).sort(), ['c-problem', 'c-team'], 'a generated script remembers the words it was written from');
  } finally { await m.close(); }
});

test('Try again and Regenerate this card run one card; an edit by hand is Not saved and saved as typed', async () => {
  const m = await mount({ answers: { script: async (_id, body) => (body.cards ? { cards: [{ card_uid: body.cards[0], index: 1, notes: '42 teams pay us.', words: 4, model: 'Synthetic model' }], failed: [] } : RUN) } });
  try {
    await m.press(m.by('pitch-script-generate'));
    await m.press(m.by('pitch-script-retry-1'));
    const last = m.calls.filter((c) => c[0] === 'script').at(-1);
    assert.deepEqual(last[2].cards, ['c-traction']);
    assert.equal(m.by('pitch-script-failed-1'), undefined, 'the retried card is placed');
    assert.equal(m.pr(m.by('pitch-script-text-1')).value, '42 teams pay us.');
    await m.type(m.by('pitch-script-text-0'), 'Typed by hand.');
    assert.equal(m.by('pitch-script-generated-0') ? m.text(m.by('pitch-script-generated-0')) : null, 'Generated · Synthetic model', 'an edit keeps where the draft came from');
    await m.type(m.by('pitch-script-text-0'), SLIDES[0].notes);
    assert.equal(m.by('pitch-script-not-saved-0'), undefined, 'typed back to what is saved is no change');
  } finally { await m.close(); }
});

test('a card whose words changed after its script was generated is Out of date, with Regenerate this card', async () => {
  const m = await mount({ from: { 'c-problem': 'not-the-current-words', 'c-team': fingerprint(SLIDES[2]) } });
  try {
    assert.equal(m.text(m.by('pitch-script-stale-pill-0')), 'Out of date');
    assert.match(m.text(m.by('pitch-script-stale-0')), new RegExp(`^${STALE}`));
    assert.equal(m.by('pitch-script-stale-pill-2'), undefined, 'a card with no script is never out of date');
    assert.equal(m.by('pitch-script-regenerate-0'), undefined, 'an out-of-date card offers Regenerate beside its line, once');
  } finally { await m.close(); }
});

test('Match my last rehearsal sets its length; a reader sees the script with no run, no hold and no save', async () => {
  const m = await mount();
  try {
    await m.press(m.by('pitch-script-match'));
    assert.deepEqual(m.calls.filter((c) => c[0] === 'scriptQuote').at(-1)[2], { length_s: 300, audience: 'investor_meeting', tone: 'clear' });
    assert.equal(m.pr(m.by('pitch-script-length-300'))['aria-checked'], true);
  } finally { await m.close(); }
  const r = await mount({ readOnly: true });
  try {
    assert.equal(r.calls.length, 0, 'a reader never prices or runs a script');
    for (const id of ['pitch-script-generate', 'pitch-script-save', 'pitch-script-hold', 'pitch-script-match', 'pitch-script-regenerate-0']) assert.equal(r.by(id), undefined, id);
    assert.equal(r.pr(r.by('pitch-script-text-0')).readOnly, true);
    assert.ok(r.by('pitch-script-copy') && r.by('pitch-script-download'));
  } finally { await r.close(); }
});

test('a save over a newer version says so and keeps the edits; AI off says so and runs nothing', async () => {
  const m = await mount({ answers: { script: async () => RUN, saveScript: async () => { const e = new Error('conflict'); e.status = 409; e.data = { error: 'deck_version_conflict' }; throw e; } } });
  try {
    await m.press(m.by('pitch-script-generate'));
    await m.press(m.by('pitch-script-save'));
    assert.match(m.text(m.by('pitch-script-note')), /saved somewhere else/);
    assert.equal(m.text(m.by('pitch-script-unsaved')), '2 cards not saved', 'the drafts are kept');
    assert.equal(m.reloads(), 0);
  } finally { await m.close(); }
  const off = await mount({ answers: { scriptQuote: async () => ({ ai: false, reason: 'assist_off', message: 'AI assistance is off on this page.' }) } });
  try {
    assert.equal(off.text(off.by('pitch-script-off')), 'AI assistance is off on this page.');
    assert.equal(off.pr(off.by('pitch-script-generate')).disabled, true);
  } finally { await off.close(); }
});
