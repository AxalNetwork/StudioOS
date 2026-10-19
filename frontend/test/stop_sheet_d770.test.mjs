/**
 * D770 (#2095, D720 F3 §6), PR 1 — a recording's Stop asks first. The Stop
 * sheet offers "Summarise and place with Eadwyn", off by default, with its
 * quote; `auto` comes only from that choice, never from the page's mode; off,
 * Stop saves the recording and its transcript only. The Worker's side (finish
 * reads only `auto: true`, a retry with no recorded choice is manual) is
 * `cloudflare-worker/test/interview_sessions_d657.test.ts`; the recorder's is
 * `recorder_d685.test.mjs`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/stop_sheet_d770.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { StopConfirm } from '../src/pages/founder/RecordingView.jsx';
import { STOP_CHOICE, STOP_TASKS, stopQuote, stopWords } from '../src/pages/founder/stopSheet.js';

const h = React.createElement;
const read = (f) => readFileSync(f, 'utf8');

async function mountSheet(props) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (t) => {
    const n = create(t);
    n.focus = () => {}; n.querySelectorAll = () => []; n.addEventListener = () => {}; n.removeEventListener = () => {};
    return n;
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(StopConfirm, { onKeep() {}, onDiscard() {}, returnTo: { current: null }, ...props }))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async press(id) { await act(async () => { pr(by(id)).onClick(); }); },
    async turn(on) { await act(async () => { pr(by('switch-stop-process')).onChange({ target: { checked: on } }); }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const SPEND = (rows) => ({ loading: false, spend: { recorded: true, by_task_recorded: true, by_task: rows }, reload() {} });

test('the choice is off by default: Stop saves the recording and its transcript, and sends no auto', async () => {
  const stops = [];
  const m = await mountSheet({ onStop: (o) => stops.push(o) });
  try {
    assert.ok(m.text(m.by('stop-choice')).includes(STOP_CHOICE));
    assert.equal(STOP_CHOICE, 'Summarise and place with Eadwyn');
    assert.equal(m.pr(m.by('switch-stop-process')).checked, false, 'off by default');
    assert.equal(m.pr(m.by('switch-stop-process')).role, 'switch');
    assert.ok(m.text().includes(stopWords(false).body), m.text());
    assert.ok(m.text().includes('the recording and its transcript are saved'));
    assert.equal(m.text(m.by('button-confirm-stop')), 'Stop and save');
    await m.press('button-confirm-stop');
    assert.deepEqual(stops, [{ auto: false }], 'no summary is asked for');
  } finally { await m.unmount(); }
});

test('turned on: Stop and process, and the choice is the only auto', async () => {
  const stops = [];
  const m = await mountSheet({ onStop: (o) => stops.push(o) });
  try {
    await m.turn(true);
    assert.equal(m.text(m.by('button-confirm-stop')), 'Stop and process');
    assert.ok(m.text().includes('writes the summary and proposes placements for you to review'));
    await m.press('button-confirm-stop');
    await m.turn(false);
    await m.press('button-confirm-stop');
    assert.deepEqual(stops, [{ auto: true }, { auto: false }], 'turning it off again saves only');
  } finally { await m.unmount(); }
});

test('the quote: the reader\'s own average for each run the choice starts, measured, never modelled', async () => {
  assert.deepEqual(STOP_TASKS.map((t) => t.task), ['summarise_interview', 'structure_interview']);
  const both = stopQuote(SPEND([{ task: 'summarise_interview', calls: 4, spend_usd: 0.02 }, { task: 'structure_interview', calls: 2, spend_usd: 0.003 }]));
  assert.deepEqual(both, { state: 'read', text: 'Before you choose · your summaries have averaged $0.0050, over 4; your placements have averaged $0.0015, over 2.' });
  const one = stopQuote(SPEND([{ task: 'summarise_interview', calls: 1, spend_usd: 0.01 }]));
  assert.equal(one.text, 'Before you choose · your summaries have averaged $0.0100, over 1; no placement of yours is recorded yet.');
  assert.equal(stopQuote(SPEND([])).text, 'Before you choose · no summary of yours is recorded yet; no placement of yours is recorded yet.', 'never $0');
  assert.deepEqual(stopQuote({ loading: true }), { state: 'loading' });
  for (const ai of [{ loading: false, spendError: new Error('x') }, { loading: false, spend: { recorded: false } }, { loading: false, spend: { recorded: true, by_task_recorded: false } }]) {
    assert.deepEqual(stopQuote(ai), { state: 'unreadable' });
  }
  assert.equal(stopQuote(null), null);

  const m = await mountSheet({ onStop() {}, ai: SPEND([{ task: 'summarise_interview', calls: 4, spend_usd: 0.02 }]) });
  try { assert.ok(m.text(m.by('stop-quote')).startsWith('Before you choose · your summaries have averaged $0.0050, over 4')); } finally { await m.unmount(); }
  const bad = await mountSheet({ onStop() {}, ai: { loading: false, spendError: new Error('x'), reload() {} } });
  try { assert.match(bad.text(bad.by('stop-quote')), /^Your average for these runs could not be read\. That is not a claim that they cost nothing\. Retry$/); } finally { await bad.unmount(); }
  const none = await mountSheet({ onStop() {}, ai: { loading: true } });
  try { assert.equal(none.by('stop-quote'), undefined, 'nothing while loading'); } finally { await none.unmount(); }
});

test('the live page passes only the sheet\'s choice, never the rail\'s mode, and reads the quote only while the sheet is open', () => {
  const live = read('frontend/src/pages/founder/RecordLivePage.jsx');
  assert.doesNotMatch(live, /useAssistMode/);
  assert.match(live, /confirmStop: \(opts\) => recorder\.confirmStop\(\{ auto: opts\?\.auto === true \}\)/);
  assert.match(live, /const ai = useAiSpend\(\{ enabled: !!state\.confirm \}\);/);
  const view = read('frontend/src/pages/founder/RecordingView.jsx');
  assert.match(view, /onStop=\{\(opts\) => actions\.confirmStop\?\.\(opts\)\}/);
  assert.match(view, /onClick=\{\(\) => onStop\?\.\(\{ auto: process \}\)\}/);
});
