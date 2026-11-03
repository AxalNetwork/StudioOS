// D4270 (#4270, D4254 P2c): Script & rehearsal's Likely questions (ps4b) and Rehearsals (ps4c).
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_script_tile_4270.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { deckQaApi } from '../src/lib/api/deckQa.js';
import { deckRehearsalsApi } from '../src/lib/api/deckRehearsals.js';
import QuestionsTab from '../src/pages/raise/pitch/QuestionsTab.jsx';
import RehearsalsTab from '../src/pages/raise/pitch/RehearsalsTab.jsx';
import {
  NOT_RECORDED, SCRIPT_VIEWS, askPlacements, cardBars, cardPill, questionState, questionsLine, rehearsalRow, saveBody, viewOf,
} from '../src/pages/raise/pitch/scriptTileModel.js';

const h = React.createElement;

const DRAFT = 'Interviews: 3 (Recorded, as of 2026-10-03)';
const READ = {
  deck_id: 7, version: 3, total: 3, answered_count: 1, reads: { written: 'ok' },
  questions: [
    { key: 'objection-aaaaaaaaaaaaaaaa', kind: 'objection', question: 'Is this problem real?', cards: ['problem'], answer: { state: 'bound', text: DRAFT }, kept: null, written: null, answered: false },
    { key: 'finding-bbbbbbbbbbbbbbbb', kind: 'finding', question: 'How big is the market?', cards: ['market'], answer: { state: 'not_recorded', text: null }, kept: null,
      written: { text: 'Mid-size logistics firms in two regions.', source: 'typed' }, answered: true },
    { key: 'typed-0000000000000001', kind: 'typed', question: 'Why now?', cards: [], answer: { state: 'no_topic', text: null }, kept: null, written: null, answered: false },
  ],
};

test('the views: Script, Likely questions and Rehearsals, as the canvas names them; an unknown view is Script', () => {
  assert.deepEqual(SCRIPT_VIEWS.map((v) => v.label), ['Script', 'Likely questions', 'Rehearsals']);
  assert.equal(viewOf('questions'), 'questions');
  assert.equal(viewOf('bogus'), 'script');
  assert.equal(viewOf(null), 'script');
});

test('the header line: "Never shown to investors · n of m answered"; a store it could not read is Not recorded, never 0', () => {
  // Mutation checked: the null count read as 0 → "0 of 8 answered".
  assert.equal(questionsLine({ total: 8, answered_count: 6 }), 'Never shown to investors · 6 of 8 answered');
  assert.equal(questionsLine({ total: 8, answered_count: null }), `Never shown to investors · 8 questions · answered: ${NOT_RECORDED}`);
  assert.equal(questionsLine(null), `Never shown to investors · ${NOT_RECORDED}`);
  assert.equal(cardPill('use_of_funds'), 'Card · Use of funds');
  assert.equal(cardPill(null), null);
});

test('Ask places only bound drafts, only where nothing is answered or placed; Save sends Ask only for the draft unchanged', () => {
  // Mutation checked: a typed question given a draft → it appears; the word-for-word check dropped → the edit is sent as 'ask'.
  const placed = askPlacements(READ.questions);
  assert.deepEqual(Object.keys(placed), ['objection-aaaaaaaaaaaaaaaa'], 'not the answered one, not the one with no record, not a typed one');
  assert.deepEqual(placed['objection-aaaaaaaaaaaaaaaa'], { text: DRAFT, from_ask: true, draft: DRAFT });
  assert.deepEqual(askPlacements(READ.questions, placed), placed, 'a second Ask places nothing more');
  // A draft is never placed over an answer, nor on a typed question, even when the read carries one.
  const bound = { state: 'bound', text: DRAFT };
  assert.deepEqual(askPlacements([{ key: 'k1', kind: 'finding', answer: bound, answered: true }, { key: 'typed-1', kind: 'typed', answer: bound, answered: false }]), {});
  assert.equal(questionState(READ.questions[0], placed), 'placed');
  assert.equal(questionState(READ.questions[0], {}), 'open');
  assert.equal(questionState(READ.questions[1], {}), 'answered');
  assert.deepEqual(saveBody(placed['objection-aaaaaaaaaaaaaaaa']), { answer: DRAFT, source: 'ask' });
  assert.deepEqual(saveBody({ ...placed['objection-aaaaaaaaaaaaaaaa'], text: `${DRAFT} More booked.` }), { answer: `${DRAFT} More booked.`, source: 'typed' });
  assert.deepEqual(saveBody({ text: 'Mine', from_ask: false }), { answer: 'Mine', source: 'typed' });
});

test('a rehearsal row: the report\'s figures, the duration marked over its target, Not recorded without a report', () => {
  // Mutation checked: a missing figure drawn as 0 → the failed run's cells read 0.
  const done = rehearsalRow({ uid: 'u1', created_at: '2026-11-02 18:20:00', duration_ms: 192_000, pitch_seconds: 180, wpm: 142, fillers: 4, cards_over: 2, notes_covered: 10, notes_total: 12, status: 'reported' });
  assert.deepEqual([done.date, done.duration, done.over, done.wpm, done.fillers, done.cards_over, done.notes], ['2 Nov · 18:20', '3:12 of 3:00', true, '142', '4', '2', '10 of 12']);
  const failed = rehearsalRow({ uid: 'u2', created_at: 'later', duration_ms: 5_000, pitch_seconds: 180, wpm: null, fillers: null, cards_over: null, notes_covered: null, notes_total: null, status: 'failed' });
  assert.deepEqual([failed.date, failed.wpm, failed.fillers, failed.cards_over, failed.notes, failed.over, failed.failed], [NOT_RECORDED, NOT_RECORDED, NOT_RECORDED, NOT_RECORDED, NOT_RECORDED, false, true]);
  const bars = cardBars({ cards: [{ card: 1, title: 'Title', time_ms: 9_000, budget_ms: 15_000, over: false }, { card: 2, title: 'Problem', time_ms: 30_000, budget_ms: 15_000, over: true }] });
  assert.deepEqual(bars.map((b) => [b.line, b.over, b.bar, b.tick]), [['0:09 of 0:15', false, 30, 50], ['0:30 of 0:15', true, 100, 50]]);
  assert.deepEqual(cardBars(null), []);
});

/** The mounted tab with its client stubbed; every call is kept. */
async function mountQuestions(props = {}, read = READ) {
  const calls = [];
  const saved = { ...deckQaApi };
  deckQaApi.questions = async (...a) => { calls.push(['questions', ...a]); return structuredClone(read); };
  deckQaApi.saveAnswer = async (deckId, key, body) => { calls.push(['saveAnswer', deckId, key, body]); return { question: key, written: { text: body.answer, source: body.source } }; };
  deckQaApi.addQuestion = async (...a) => { calls.push(['addQuestion', ...a]); return { question: {} }; };
  deckQaApi.removeAnswer = async (...a) => { calls.push(['removeAnswer', ...a]); return { written: null }; };
  const m = await mountContracts(h(QuestionsTab, { deckId: 7, deckTitle: 'Seed deck', version: 3, readOnly: false, ...props }), '/raise/pitch/script?view=questions');
  await m.flush();
  const byTest = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  const press = async (id) => { const n = byTest(id); if (!n) throw new Error(`Missing ${id}`); await m.flush(); await new Promise((r) => setTimeout(r, 0)); await (async () => m.props(n).onClick({ stopPropagation() {} }))(); await m.flush(); };
  return { m, calls, byTest, press, restore: async () => { Object.assign(deckQaApi, saved); await m.unmount(); } };
}

test('Likely questions: the header counts, each question shows its card and state, and Ask writes nothing until Save', async () => {
  // Mutation checked: Ask calling saveAnswer itself → a save is recorded before Save; Save sending 'typed' for the placed draft → the source check fails.
  const t = await mountQuestions();
  try {
    const text = t.m.text();
    assert.match(text, /Likely questions about Seed deck v3/);
    assert.match(text, /Never shown to investors · 1 of 3 answered/);
    assert.match(text, /Card · Problem/);
    assert.match(text, /Write your answer\./);
    assert.equal(t.m.props(t.byTest('pitch-question-state-finding-bbbbbbbbbbbbbbbb')).children, 'Answered');
    assert.equal(t.m.props(t.byTest('pitch-question-state-objection-aaaaaaaaaaaaaaaa')).children, 'Not answered yet');

    await t.press('pitch-questions-ask');
    assert.equal(t.m.props(t.byTest('pitch-question-state-objection-aaaaaaaaaaaaaaaa')).children, 'Not saved');
    assert.ok(t.m.text().includes(DRAFT), 'the placed draft is on screen');
    assert.deepEqual(t.calls.filter((c) => c[0] !== 'questions'), [], 'Ask places text and writes nothing');
    assert.equal(Boolean(t.byTest('pitch-question-save-typed-0000000000000001')), false, 'a typed question gets no draft');

    await t.press('pitch-question-save-objection-aaaaaaaaaaaaaaaa');
    const saves = t.calls.filter((c) => c[0] === 'saveAnswer');
    assert.deepEqual(saves, [['saveAnswer', 7, 'objection-aaaaaaaaaaaaaaaa', { answer: DRAFT, source: 'ask' }]]);
    assert.equal(t.m.props(t.byTest('pitch-question-state-objection-aaaaaaaaaaaaaaaa')).children, 'Answered');
    assert.match(t.m.text(), /2 of 3 answered/, 'the count follows the save');
  } finally { await t.restore(); }
});

test('Likely questions: Discard drops a placed draft unsaved; a reader sees the answers and no way to write', async () => {
  // Mutation checked: readOnly ignored → the Ask button is drawn for the reader.
  let t = await mountQuestions();
  try {
    await t.press('pitch-questions-ask');
    await t.press('pitch-question-discard-objection-aaaaaaaaaaaaaaaa');
    assert.equal(t.m.props(t.byTest('pitch-question-state-objection-aaaaaaaaaaaaaaaa')).children, 'Not answered yet');
    assert.deepEqual(t.calls.filter((c) => c[0] !== 'questions'), []);
  } finally { await t.restore(); }
  t = await mountQuestions({ readOnly: true });
  try {
    assert.match(t.m.text(), /Mid-size logistics firms in two regions\./);
    assert.match(t.m.text(), /Read only: the founder writes the answers\./);
    // A boolean, so a failure never tries to print a DOM node and its React tree.
    for (const id of ['pitch-questions-ask', 'pitch-questions-add', 'pitch-question-write-objection-aaaaaaaaaaaaaaaa']) assert.equal(Boolean(t.byTest(id)), false, id);
  } finally { await t.restore(); }
});

test('Likely questions: a written store that could not be read says so, and the count is Not recorded', async () => {
  const t = await mountQuestions({}, { ...READ, answered_count: null, reads: { written: 'unreadable' } });
  try {
    assert.match(t.m.text(), /Your saved answers could not be read/);
    assert.match(t.m.text(), /answered: Not recorded/);
  } finally { await t.restore(); }
});

test('Rehearsals: each run\'s figures, Not recorded where a run has none, and Open draws the per-card bars with the budget tick', async () => {
  // Mutation checked: Open reading the list row instead of the run → no bars are drawn.
  const saved = { ...deckRehearsalsApi };
  const calls = [];
  deckRehearsalsApi.list = async (id) => { calls.push(['list', id]); return { deck_id: id, rehearsals: [
    { uid: 'r1', created_at: '2026-11-02 18:20:00', duration_ms: 192_000, pitch_seconds: 180, wpm: 142, fillers: 4, cards_over: 2, notes_covered: 10, notes_total: 12, status: 'reported' },
    { uid: 'r2', created_at: '2026-10-31 09:05:00', duration_ms: 4_000, pitch_seconds: 180, wpm: null, fillers: null, cards_over: null, notes_covered: null, notes_total: null, status: 'failed' },
  ] }; };
  deckRehearsalsApi.read = async (id, uid) => { calls.push(['read', id, uid]); return { rehearsal: { uid, report: { cards: [
    { card: 1, title: 'Title', time_ms: 9_000, budget_ms: 15_000, over: false }, { card: 2, title: 'Problem', time_ms: 27_000, budget_ms: 15_000, over: true },
  ] } } }; };
  const m = await mountContracts(h(RehearsalsTab, { deckId: 7, deckTitle: 'Seed deck' }), '/raise/pitch/script?view=rehearsals');
  try {
    await m.flush();
    const text = m.text();
    assert.match(text, /2 runs of Seed deck/);
    assert.match(text, /2 Nov · 18:20/);
    assert.match(text, /3:12 of 3:00/);
    assert.match(text, /10 of 12/);
    assert.match(text, /Not recorded/);
    assert.match(text, /Failed/);
    const open = m.nodes().find((n) => m.props(n)?.['data-testid'] === 'pitch-rehearsal-open-r1');
    await m.flush();
    m.props(open).onClick();
    await m.flush();
    assert.deepEqual(calls.at(-1), ['read', 7, 'r1']);
    assert.match(m.text(), /0:27 of 0:15/);
    assert.match(m.text(), /The black tick is the card’s budget\./);
    assert.ok(m.nodes().some((n) => m.props(n)?.['data-testid'] === 'pitch-rehearsal-card-2'));
  } finally { Object.assign(deckRehearsalsApi, saved); await m.unmount(); }
});

test('the tile: Script & rehearsal draws ScriptTile, and P2a\'s Script view is its Script view', () => {
  const src = readFileSync(new URL('../src/pages/raise/pitch/PitchStudio.jsx', import.meta.url), 'utf8');
  assert.match(src, /tab === 'script' \? \([\s\S]{0,280}<ScriptTile deck=\{currentDeck\} readOnly=\{readOnly\} script=\{<ScriptTab reads=\{reads\} readOnly=\{readOnly\} \/>/);
  const tile = readFileSync(new URL('../src/pages/raise/pitch/ScriptTile.jsx', import.meta.url), 'utf8');
  assert.match(tile, /role="tablist" aria-label="Script and rehearsal"/);
});
