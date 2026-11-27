/**
 * D1582 F3 (#3829) — the likely questions in the Rehearsal report (pd39's
 * "LIKELY QUESTIONS · REAL OBJECTIONS FIRST"), with "Practise answers", the
 * frontend half.
 *
 *   · the report's slot draws the questions, each with "Practise answers",
 *     and a prospect picker that asks the Worker for that investor's order;
 *   · the drill steps through them one at a time, checks a typed answer
 *     against what the records say and names a figure no binding carries;
 *   · no chat thread: one question on screen, nothing sent, no model;
 *   · "Likely questions are coming later." only when the route is unavailable.
 *
 * Every venture, investor and figure is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rehearse_questions_d1582.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import LikelyQuestions from '../src/pages/raise/pitch/LikelyQuestions.jsx';
import { deckQaApi } from '../src/lib/api/deckQa.js';
import {
  ALL_BOUND, PRACTISE, QUESTIONS_LATER, QUESTIONS_TITLE, answerLine, figureCheckLine, prospectLabel, questionMeta, unboundTyped,
} from '../src/pages/raise/pitch/rehearseModel.js';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/pages/raise/pitch/${rel}`, import.meta.url), 'utf8');

const MRR = { source_key: 'grow.mrr', record_ref: 'ref:mrr', as_of: '2026-10-01', grade: 'Measured', snapshot_hash: 'h', label: 'MRR', value: 120050, of: null, unit: 'cents', source: 'Recorded' };
const IV = { source_key: 'validate.interviews', record_ref: 'ref:iv', as_of: '2026-10-03', grade: 'Measured', snapshot_hash: 'h', label: 'Interviews', value: 3, of: null, unit: 'count', source: 'Recorded' };
const Q = [
  { key: 'objection-aaaaaaaaaaaaaaaa', rank: 1, kind: 'objection', question: 'Who are your competitors?', cards: ['competition'],
    heard: { count: 1, prospects: 1, last_heard: '2026-10-07', from_prospect: 1 }, answer: { state: 'no_topic', text: null, bindings: [], fill: [] }, kept: null },
  { key: 'objection-bbbbbbbbbbbbbbbb', rank: 2, kind: 'objection', question: 'Is this problem real?', cards: ['problem'],
    heard: { count: 2, prospects: 2, last_heard: '2026-10-06', from_prospect: 0 }, said: null, said_held: 'unbound_figure',
    answer: { state: 'bound', text: 'Interviews: 3 (Measured, Recorded, as of 2026-10-03)', bindings: [IV], fill: [] }, kept: null },
  { key: 'finding-cccccccccccccccc', rank: 3, kind: 'finding', question: 'What traction do you have so far?', cards: ['traction'], severity: 'deal_breaker',
    answer: { state: 'not_recorded', text: null, bindings: [], fill: [{ source_key: 'grow.mrr', label: 'MRR', module: 'Grow', href: '/g' }] }, kept: null },
];
const EAST = { id: 13, name: 'Synthetic Partner East', firm: null };
const reply = (prospect = null) => ({
  deck_id: 7, version: 3, stage: 'seed', prospect, questions: Q, more: 0,
  prospects: [{ id: 11, name: 'Synthetic Partner North', firm: 'Synthetic Fund North', objections: 2 }, { ...EAST, objections: 1 }],
  reads: { objections: 'ok', objections_capped: false, sources: 'ok', claims: 'ok', kept: 'ok', prospects: 'ok' },
});

// ─────────────────────────────────────────────────────────── the model

test('the words: who raised a question, what the records say, and the figure check on a typed answer', () => {
  assert.equal(QUESTIONS_TITLE, 'LIKELY QUESTIONS · REAL OBJECTIONS FIRST');
  assert.equal(PRACTISE, 'Practise answers');
  assert.equal(questionMeta(Q[0], EAST), 'Raised by Synthetic Partner East · heard 1 time from 1 investor');
  assert.equal(questionMeta(Q[1], EAST), 'heard 2 times from 2 investors', 'raised by others only: no "Raised by"');
  assert.equal(questionMeta(Q[0], null), 'heard 1 time from 1 investor', 'no prospect picked: no name');
  assert.equal(questionMeta(Q[2], EAST), 'Deal-breaker · from the deck check');
  assert.equal(prospectLabel({ id: 11, name: 'Synthetic Partner North', firm: 'Synthetic Fund North' }), 'Synthetic Partner North · Synthetic Fund North');
  assert.equal(prospectLabel({ id: 12, name: null, firm: null }), 'Investor 12');
  assert.equal(answerLine(Q[1]), 'Interviews: 3 (Measured, Recorded, as of 2026-10-03)', 'the bound answer is the Worker\'s words, unchanged');
  assert.equal(answerLine(Q[2]), 'No record answers this yet. Fill: MRR.');
  assert.equal(answerLine(Q[0]), 'No deck record answers this question.');
  assert.equal(answerLine({ answer: { state: 'unchecked' } }), 'The records this draws on could not be read, so it is not checked.');
  // A figure is its digits, as the Worker reads it: "$1,200.50" is carried by 120050 cents; 40 is carried by nothing.
  const mrr = { answer: { bindings: [MRR] }, kept: null };
  assert.deepEqual(unboundTyped('MRR is $1,200.50 as of 2026-10-01', mrr), []);
  assert.deepEqual(unboundTyped('We ran 3 interviews and 40 more are booked', Q[1]), ['40']);
  assert.deepEqual(unboundTyped('MRR is $1,300', mrr), ['1,300']);
  assert.equal(figureCheckLine('', Q[1]), null, 'nothing typed, nothing said');
  assert.equal(figureCheckLine('Three interviews, 3 of them done', Q[1]), ALL_BOUND);
  assert.equal(figureCheckLine('We ran 3 interviews and 40 more, 40 booked', Q[1]), 'Not carried by any record: 40. Say only what a record holds.');
  assert.match(figureCheckLine('We have 12 customers', Q[0]), /Not carried by any record: 12\./, 'with no binding, every figure is loose');
  // A kept answer's bindings carry their figures too.
  assert.deepEqual(unboundTyped('MRR $1,200.50', { answer: { bindings: [] }, kept: { bindings: [MRR] } }), []);
});

// ─────────────────────────────────────────────────────────── the slot

async function slot(answer) {
  const real = deckQaApi.questions;
  const asked = [];
  deckQaApi.questions = async (...a) => { asked.push(a); return answer(...a); };
  const restore = installDocument('', { focus: true });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(LikelyQuestions, { deckId: 7 })); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const all = (re) => walk(container).filter((n) => re.test(pr(n)['data-testid'] || ''));
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    asked, by, pr, all, settle,
    text: (n = container) => text(n).replace(/\s+/g, ' ').trim(),
    async press(id) { await act(async () => { pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { await act(async () => { pr(by(id)).onChange?.({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); restore(); deckQaApi.questions = real; },
  };
}

test('the report\'s slot draws the likely questions, real objections first, each with "Practise answers"; a prospect asks for its order', async () => {
  // Mutation checked: the slot drawing QUESTIONS_LATER whatever the read → the "coming later" assert fails;
  // the picker not passing `prospect` → the asked list differs.
  const t = await slot(async (_id, opts) => reply(opts?.prospect === '13' ? EAST : null));
  try {
    assert.deepEqual(t.asked, [[7, undefined]], 'first read: the venture\'s order, no prospect');
    assert.match(t.text(), /^LIKELY QUESTIONS · REAL OBJECTIONS FIRST/);
    assert.doesNotMatch(t.text(), /coming later/, 'an available read never says "coming later"');
    const buttons = t.all(/^rehearse-practise-\d+$/);
    assert.equal(buttons.length, 3);
    assert.deepEqual(buttons.map((b) => t.text(b)), [PRACTISE, PRACTISE, PRACTISE]);
    assert.match(t.text(t.by('rehearse-questions-list')), /^1 \. Who are your competitors\? heard 1 time from 1 investor Practise answers 2 \. Is this problem real\?/);
    const select = t.by('rehearse-questions-prospect');
    assert.ok(select, 'the venture\'s prospects are offered');
    assert.equal(t.text(select), 'Every investor Synthetic Partner North · Synthetic Fund North Synthetic Partner East');
    await t.type('rehearse-questions-prospect', '13');
    await t.settle();
    assert.deepEqual(t.asked, [[7, undefined], [7, { prospect: '13' }]], 'the picker reads that investor\'s order from the Worker');
    assert.match(t.text(t.by('rehearse-questions-list')), /^1 \. Who are your competitors\? Raised by Synthetic Partner East · heard 1 time/);
  } finally { await t.close(); }
});

test('the drill steps through the questions one at a time, checks the typed answer against the records, and is no chat thread', async () => {
  // Mutation checked: "Next question" not moving (go(at)) → the step stays "Question 1 of 3"; the figure check
  // dropping the typed text → "40" is never named.
  const t = await slot(async () => reply());
  try {
    await t.press('rehearse-practise-1');
    assert.equal(t.text(t.by('rehearse-drill-step')), 'Question 2 of 3', 'the drill starts at the question picked');
    assert.equal(t.text(t.by('rehearse-drill-question')), 'Is this problem real?');
    assert.equal(Boolean(t.by('rehearse-questions-list')), false, 'one question on screen; the list is gone while practising');
    assert.equal(t.all(/^rehearse-drill-question$/).length, 1);
    assert.equal(Boolean(t.by('rehearse-drill-check')), false, 'the records are shown only when the founder asks');
    await t.type('rehearse-drill-answer', 'We ran 3 interviews and 40 more are booked');
    await t.press('rehearse-drill-reveal');
    assert.equal(t.text(t.by('rehearse-drill-bound')), 'Interviews: 3 (Measured, Recorded, as of 2026-10-03)');
    assert.equal(t.text(t.by('rehearse-drill-figures')), 'Not carried by any record: 40. Say only what a record holds.');
    assert.match(String(t.pr(t.by('rehearse-drill-figures')).className), /amber/);
    await t.type('rehearse-drill-answer', 'We ran 3 interviews');
    assert.equal(Boolean(t.by('rehearse-drill-check')), false, 'editing the answer hides the old check');
    await t.press('rehearse-drill-reveal');
    assert.equal(t.text(t.by('rehearse-drill-figures')), ALL_BOUND);

    await t.press('rehearse-drill-next');
    assert.equal(t.text(t.by('rehearse-drill-step')), 'Question 3 of 3');
    assert.equal(t.text(t.by('rehearse-drill-question')), 'What traction do you have so far?');
    assert.equal(Boolean(t.by('rehearse-drill-check')), false, 'each question starts unchecked');
    assert.equal(t.pr(t.by('rehearse-drill-next')).disabled, true, 'the last question has no next');
    await t.press('rehearse-drill-back');
    assert.equal(t.pr(t.by('rehearse-drill-answer')).value, 'We ran 3 interviews', 'a typed answer stays with its question while the drill runs');
    await t.press('rehearse-drill-back');
    assert.equal(t.text(t.by('rehearse-drill-step')), 'Question 1 of 3');
    assert.equal(t.pr(t.by('rehearse-drill-back')).disabled, true);
    await t.press('rehearse-drill-end');
    assert.ok(t.by('rehearse-questions-list'), 'End practice returns to the list');
    assert.equal(t.asked.length, 1, 'the drill reads once and sends nothing');
  } finally { await t.close(); }
  const src = codeOnly(read('LikelyQuestions.jsx'));
  assert.doesNotMatch(src, /\bchat|thread|bubble|role="log"|messages\b|aiApi|deckAssist|\balert\(|\bconfirm\(/i, 'no chat surface, no model and no browser dialog');
  assert.doesNotMatch(src, /method: '(POST|PUT|DELETE)'|deckQaApi\.(?!questions\b)/, 'the drill writes nothing');
});

test('"Likely questions are coming later." only when the route is unavailable; a refusal says why; none says so', async () => {
  const off = await slot(async () => { throw Object.assign(new Error('nope'), { status: 404 }); });
  try {
    assert.equal(off.text(off.by('rehearse-questions-later')), QUESTIONS_LATER);
    assert.equal(off.all(/^rehearse-practise-/).length, 0, 'no question, so nothing to practise');
  } finally { await off.close(); }
  const refused = await slot(async () => { throw Object.assign(new Error('Only the venture’s founder reads the likely questions.'), { status: 403, code: 'founder_only' }); });
  try {
    assert.equal(refused.text(refused.by('rehearse-questions-unread')), 'Only the venture’s founder reads the likely questions.');
    assert.doesNotMatch(refused.text(), /coming later/, 'a refusal is not "coming later"');
  } finally { await refused.close(); }
  const none = await slot(async () => ({ ...reply(), questions: [], prospects: [] }));
  try {
    assert.match(none.text(), /No likely questions yet/);
    assert.doesNotMatch(none.text(), /coming later/);
    assert.equal(Boolean(none.by('rehearse-questions-prospect')), false, 'no prospect, no picker');
  } finally { await none.close(); }
});

test('the report draws the slot behind the rehearse row, and the client reads /api/decks/:id/qa with the prospect only when one is picked', async () => {
  const panel = codeOnly(read('RehearsePanel.jsx'));
  assert.match(panel, /<LikelyQuestions deckId=\{deckId\} \/>/, 'the slot is inside the Rehearsal report');
  assert.doesNotMatch(panel, /QUESTIONS_LATER/, 'the report no longer prints "coming later" by itself');
  const slotSrc = codeOnly(read('LikelyQuestions.jsx'));
  assert.match(slotSrc, /through\(\(\) => deckQaApi\.questions\(deckId, [^)]*\), SURFACES\.rehearse\.issue\)/, 'read through the rehearse row');
  const before = globalThis.fetch;
  const restore = installDocument();
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return Response.json({ questions: [] }); };
  try {
    await deckQaApi.questions(7);
    await deckQaApi.questions(7, { prospect: '' });
    await deckQaApi.questions(7, { prospect: 13 });
  } finally { globalThis.fetch = before; restore(); }
  assert.deepEqual(seen.map((u) => u.replace(/^.*\/api/, '/api')), ['/api/decks/7/qa', '/api/decks/7/qa', '/api/decks/7/qa?prospect=13']);
});
