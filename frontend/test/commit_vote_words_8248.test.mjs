/**
 * D8248 (#8248): every IC screen prints a vote as Invest / Pass / Abstain
 * (option A on #6144), and Recused keeps its own word and glyph. Only the
 * words move: the stored values `yes | no | abstain | recused` still go to
 * `api.icVote` unchanged. Synthetic members and API data throughout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Routes, Route, Navigate, MemoryRouter } from 'react-router-dom';
import { api, dd } from '../src/lib/api';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import CommitZone, { VoteMark, VOTE_WORDS as CARD_WORDS } from '../src/pages/investor/deals/CommitZone.jsx';
import ICDecisionPage from '../src/pages/ICDecisionPage.jsx';
import { ICDecisionsList } from '../src/pages/ICDecisionsPage.jsx';
import { VOTE_WORDS, voteWord, tallyText } from '../src/pages/icDecisionModel.js';
import { VOTE_CHOICES } from '../src/pages/investor/deals/commit/commitVoteModel.js';
import { mountForm, propsOf, textOf } from './_form_d695.mjs';

const h = React.createElement;
const ME = { id: 7, role: 'investor', name: 'Synthetic voter' };
/** Yes or No printed as a word: what no vote on any screen may read as. */
const OLD_WORD = /\b(Yes|No)\b/;

const votes = () => [
  { user_id: 9, user_name: 'Synthetic colleague A', vote: 'yes', rationale: 'Synthetic reason A', created_at: '2026-11-20 10:00:00' },
  { user_id: 10, user_name: 'Synthetic colleague B', vote: 'no', rationale: 'Synthetic reason B', created_at: '2026-11-20 10:05:00' },
  { user_id: 11, user_name: 'Synthetic colleague C', vote: 'abstain', rationale: 'Synthetic reason C', created_at: '2026-11-20 10:10:00' },
  { user_id: 12, user_name: 'Synthetic colleague D', vote: 'recused', rationale: 'Synthetic declared conflict', created_at: '2026-11-20 10:15:00' },
];
const decision = (over = {}) => ({
  id: 11, uid: 'syn-open', title: 'Synthetic open decision', status: 'voting', created_by: 7, decision: null,
  memo: '', terms: {}, conditions: [],
  tally: { yes: 1, no: 1, abstain: 1, recused: 1 },
  votes: votes(),
  roster: { available: false, eligible: null, to_vote: null, members: [], reason: 'none set' },
  ...over,
});
const room = (d) => ({
  decisions: { available: true, total: 1, rows: [d] },
  current: d,
  rationale: { recorded: 3, total: 3, enforced: true },
  room: { available: false },
  conditions: { available: true, rows: [] },
  minutes: { available: false, reason: 'Synthetic: none held.' },
});

async function setup({ d = decision(), start = '/deals/commit' } = {}) {
  const originals = { ...api }, oldCases = dd.listCases, oldStorage = globalThis.localStorage, oldFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: (k) => (k === 'user' ? JSON.stringify(ME) : null), setItem() {}, removeItem() {} };
  globalThis.fetch = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
  const calls = [];
  Object.assign(api, {
    getMe: async () => ME,
    icCommitRoom: async () => structuredClone(room(d)),
    icGet: async () => structuredClone(d),
    icConditions: async () => ({ items: [] }),
    icVote: async (uid, body) => { calls.push(['vote', uid, body]); },
    icUpdate: async () => {},
    listProjects: async () => [],
    listDeals: async () => [],
  });
  dd.listCases = async () => ({ items: [] });
  const el = h(Routes, null,
    h(Route, { path: '/', element: h(Navigate, { to: start }) }),
    h(Route, { path: '/deals/commit', element: h(CommitZone) }),
    h(Route, { path: '/deals/commit/:uid', element: h(ICDecisionPage) }));
  function Session() { localStorage.setItem('user', JSON.stringify(ME)); return h(AuthProvider, null, el); }
  const ui = await mountForm(h(Session), { modal: true });
  await ui.flush(); await ui.flush();
  const byId = (id) => ui.nodes().find((n) => propsOf(n)['data-testid'] === id);
  const allById = (id) => ui.nodes().filter((n) => propsOf(n)['data-testid'] === id);
  return {
    ...ui, calls, byId, allById,
    async type(id, value) { const n = byId(id); assert.ok(n, id); await act(async () => propsOf(n).onChange({ target: { value } })); },
    async press(id) { const n = byId(id); assert.ok(n, id); assert.ok(!propsOf(n).disabled, `${id} is disabled`); await act(async () => propsOf(n).onClick?.({ preventDefault() {} })); await ui.flush(); },
    async submitForm(id) { const n = byId(id); assert.ok(n, id); await act(async () => propsOf(n).onSubmit({ preventDefault() {} })); await ui.flush(); },
    async close() { await ui.unmount(); Object.assign(api, originals); dd.listCases = oldCases; globalThis.localStorage = oldStorage; globalThis.fetch = oldFetch; },
  };
}

test('the shared words: Invest, Pass, Abstain, and Recused apart; the stored values are unchanged', () => {
  assert.deepEqual(VOTE_WORDS, { yes: 'Invest', no: 'Pass', abstain: 'Abstain', recused: 'Recused' });
  assert.deepEqual(VOTE_CHOICES, ['yes', 'no', 'abstain'], 'the values the vote dialog sends');
  assert.equal(voteWord('yes'), 'Invest');
  assert.equal(voteWord('no'), 'Pass');
  assert.equal(voteWord('abstain'), 'Abstain');
  assert.equal(voteWord('recused'), 'Recused');
  assert.equal(voteWord('maybe'), 'maybe', 'an unknown stored value is shown as stored, never as a vote word');
  assert.equal(voteWord('toString'), 'toString', 'only the table’s own keys are vote words');
  assert.equal(tallyText({ yes: 2, no: 1, abstain: 0, recused: 1 }), 'Invest 2 · Pass 1 · Abstain 0 · Recused 1');
  assert.doesNotMatch(tallyText({ yes: 2, no: 1, abstain: 0, recused: 1 }), OLD_WORD);
  assert.equal(tallyText({ yes: 2 }), 'Invest 2 · Pass Not recorded · Abstain Not recorded · Recused Not recorded');
  // The Commit card's table reads its labels from the shared one.
  assert.deepEqual(Object.fromEntries(Object.entries(CARD_WORDS).map(([k, v]) => [k, v.label])), VOTE_WORDS);
});

test('the Commit card marks each vote Invest / Pass / Abstain, and Recused with its own glyph', () => {
  const mark = (vote) => renderToStaticMarkup(h(VoteMark, { vote }));
  assert.match(mark('yes'), />Invest</);
  assert.match(mark('no'), />Pass</);
  assert.match(mark('abstain'), />Abstain</);
  for (const v of ['yes', 'no', 'abstain']) {
    assert.doesNotMatch(mark(v), OLD_WORD, `${v} prints Yes or No`);
    assert.doesNotMatch(mark(v), /⊘|border-dashed/, `${v} drawn as a recusal`);
  }
  assert.match(mark('recused'), /⊘/);
  assert.match(mark('recused'), /Recused/);
  assert.doesNotMatch(mark('recused'), /Abstain/);
});

test('the Commit zone: vote table, close-vote tally and my vote read the new words', async () => {
  const mine = decision({ votes: [...votes(), { user_id: 7, vote: 'no', rationale: 'Synthetic own reason', created_at: '2026-11-20 11:00:00' }] });
  const ui = await setup({ d: mine });
  try {
    const table = textOf(ui.byId('commit-votes'));
    for (const w of ['Invest', 'Pass', 'Abstain', 'Recused']) assert.match(table, new RegExp(w), `the vote table lacks ${w}`);
    assert.doesNotMatch(table, OLD_WORD, 'the vote table prints Yes or No');
    assert.match(textOf(ui.byId('commit-my-vote')), /Pass/);
    assert.doesNotMatch(textOf(ui.byId('commit-my-vote')), OLD_WORD);
    await act(async () => propsOf(ui.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Close vote')).onClick());
    assert.match(textOf(ui.byId('close-vote-tally')), /^Invest 1 · Pass 1 · Abstain 1 · Recused 1$/);
  } finally { await ui.close(); }
});

test('the vote dialog offers Invest / Pass / Abstain and still sends yes / no / abstain', async () => {
  for (const [choice, word] of [['yes', 'Invest'], ['no', 'Pass'], ['abstain', 'Abstain']]) {
    const ui = await setup({ d: decision({ votes: [] }) });
    try {
      await ui.press('button-open-vote');
      const labels = VOTE_CHOICES.map((v) => textOf(ui.byId(`vote-choice-${v}`)).replace(/[▲▼○]/g, '').trim());
      assert.deepEqual(labels, ['Invest', 'Pass', 'Abstain']);
      assert.doesNotMatch(textOf(ui.byId('form-vote')), OLD_WORD, 'the vote dialog prints Yes or No');
      await ui.press(`vote-choice-${choice}`);
      assert.match(textOf(ui.byId(`vote-choice-${choice}`)), new RegExp(word));
      await ui.type('input-vote-reason', 'Synthetic reason');
      await ui.submitForm('form-vote');
      assert.deepEqual(ui.calls, [['vote', 'syn-open', { vote: choice, rationale: 'Synthetic reason' }]], `${word} must send ${choice}`);
    } finally { await ui.close(); }
  }
  // The recusal dialog names the earlier vote in the new words, and still sends `recused`.
  const ui = await setup({ d: decision({ votes: [{ user_id: 7, vote: 'yes', rationale: 'Earlier', created_at: '2026-11-20 11:00:00' }] }) });
  try {
    await ui.press('button-open-recuse');
    assert.match(textOf(ui.byId('recuse-replaces')), /You voted Invest\./);
    await ui.type('input-recusal-declaration', 'Synthetic declared conflict');
    await act(async () => propsOf(ui.byId('input-recusal-final')).onChange({ target: { checked: true } }));
    await ui.submitForm('form-recuse');
    assert.deepEqual(ui.calls, [['vote', 'syn-open', { vote: 'recused', rationale: 'Synthetic declared conflict' }]]);
  } finally { await ui.close(); }
});

test('the decision record: buttons, tally and each vote read the new words; the stored value is sent', async () => {
  const ui = await setup({ start: '/deals/commit/syn-open', d: decision({ votes: votes().slice(0, 3) }) });
  try {
    assert.deepEqual(['yes', 'no', 'abstain'].map((v) => textOf(ui.byId(`ic-vote-${v}`)).trim()), ['Vote invest', 'Vote pass', 'Vote abstain']);
    const text = ui.text();
    assert.match(text, /Committee vote · Invest 1 · Pass 1 · Abstain 1 · Recused 1/);
    assert.match(text, /Invest — Synthetic reason A/);
    assert.match(text, /Pass — Synthetic reason B/);
    assert.match(text, /Abstain — Synthetic reason C/);
    assert.doesNotMatch(text, /Vote (yes|no)\b|\b(Yes|No) — |\b(Yes|No) \d/, 'the record prints Yes or No as a vote');
    const input = ui.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).placeholder === 'Rationale (required)');
    await act(async () => propsOf(input).onChange({ target: { value: 'Synthetic pass reason' } }));
    await ui.press('ic-vote-no');
    assert.deepEqual(ui.calls, [['vote', 'syn-open', { vote: 'no', rationale: 'Synthetic pass reason' }]]);
  } finally { await ui.close(); }
});

test('the decision list prints the tally and my vote in the new words', async () => {
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k === 'user' ? JSON.stringify(ME) : null), setItem() {}, removeItem() {} };
  try {
    const d = decision({ votes: [...votes(), { user_id: 7, vote: 'yes', rationale: 'Mine', created_at: '2026-11-20 11:00:00' }], project_name: 'Synthetic venture' });
    const out = renderToStaticMarkup(h(MemoryRouter, null, h(AuthProvider, null, h(ICDecisionsList, { items: [d] }))));
    assert.match(out, /Invest 1 · Pass 1 · Abstain 1 · Recused 1/);
    assert.match(out, /My vote: Invest/);
    assert.doesNotMatch(out, /My vote: (yes|no|Yes|No)\b/);
  } finally { globalThis.localStorage = oldStorage; }
});

test('no IC screen keeps a Yes / No vote word of its own', () => {
  const files = [
    'frontend/src/pages/icDecisionModel.js',
    'frontend/src/pages/ICDecisionPage.jsx',
    'frontend/src/pages/ICDecisionsPage.jsx',
    'frontend/src/pages/investor/deals/CommitZone.jsx',
    'frontend/src/pages/investor/deals/commit/VoteDialogs.jsx',
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /label: '(Yes|No)'|\b(yes|no): '(Yes|No)'|`(Yes|No) \$\{/, `${f} spells a vote as Yes or No`);
    assert.doesNotMatch(src, /A vote is yes, no/, `${f} explains the vote in the old words`);
  }
});
