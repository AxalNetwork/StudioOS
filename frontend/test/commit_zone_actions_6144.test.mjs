/**
 * D6144 (#6144): /deals/commit runs an IC decision without leaving the page.
 * Mounted from the zone itself with synthetic members and API data: open a
 * decision, cast and change a vote, recuse with a required declaration, close
 * the vote and add a condition, each in its own dialog. A refused write stays
 * in its dialog in the Worker's own words; an unreadable record never offers
 * a vote; the old /ic addresses forward.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api, dd } from '../src/lib/api';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import CommitZone from '../src/pages/investor/deals/CommitZone.jsx';
import ICDecisionsPage from '../src/pages/ICDecisionsPage.jsx';
import ICDecisionPage from '../src/pages/ICDecisionPage.jsx';
import { voteOffer, voteBody, refusalWords, rosterLine } from '../src/pages/investor/deals/commit/commitVoteModel.js';
import { mountForm, propsOf, textOf } from './_form_d695.mjs';

const h = React.createElement;
const ME = { id: 7, role: 'investor', name: 'Synthetic voter' };

const decision = (over = {}) => ({
  uid: 'syn-open', title: 'Synthetic open decision', status: 'voting', created_by: 7, decision: null,
  tally: { yes: 1, no: 0, abstain: 0, recused: 0 },
  votes: [{ user_id: 9, user_name: 'Synthetic colleague', vote: 'yes', rationale: 'Synthetic reason', created_at: '2026-11-20 10:00:00' }],
  roster: { available: false, eligible: null, to_vote: null, members: [], reason: 'none set' },
  ...over,
});
const room = (d) => ({
  decisions: { available: true, total: 1, rows: [d] },
  current: d,
  rationale: { recorded: 1, total: 1, enforced: true },
  room: { available: false },
  conditions: { available: true, rows: [] },
  minutes: { available: false, reason: 'No meeting.' },
});

function Location() { const l = useLocation(); return h('p', { 'data-testid': 'location' }, l.pathname + l.search); }

async function setup({ d = decision(), roomRead, start = '/deals/commit', user = ME } = {}) {
  const originals = { ...api }, oldCases = dd.listCases, oldStorage = globalThis.localStorage, oldFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: (k) => (k === 'user' ? JSON.stringify(user) : null), setItem() {}, removeItem() {} };
  globalThis.fetch = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
  const calls = [];
  const state = { d };
  Object.assign(api, {
    getMe: async () => user,
    icCommitRoom: roomRead || (async () => structuredClone(room(state.d))),
    icConditions: async () => ({ items: [] }),
    icVote: async (uid, body) => { calls.push(['vote', uid, body]); },
    icUpdate: async (uid, body) => { calls.push(['update', uid, body]); },
    icAddCondition: async (uid, body) => { calls.push(['condition', uid, body]); },
    icCreate: async (body) => { calls.push(['create', body]); return { uid: 'syn-new' }; },
    listProjects: async () => [{ id: 21, name: 'Synthetic venture' }],
    listDeals: async () => [],
  });
  dd.listCases = async () => ({ items: [] });
  const el = h(Routes, null,
    h(Route, { path: '/', element: h(Navigate, { to: start }) }),
    h(Route, { path: '/deals/commit', element: h(CommitZone) }),
    h(Route, { path: '/deals/commit/:uid', element: h('p', null, 'record page') }),
    h(Route, { path: '/ic', element: h(ICDecisionsPage) }),
    h(Route, { path: '/ic/:uid', element: h(ICDecisionPage) }));
  // The harness installs its own storage: the member is written there before the provider reads it.
  function Session() { localStorage.setItem('user', JSON.stringify(user)); return h(AuthProvider, null, el, h(Location)); }
  const ui = await mountForm(h(Session), { modal: true });
  await ui.flush(); await ui.flush();
  const button = (label) => ui.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  const byId = (id) => ui.nodes().find((n) => propsOf(n)['data-testid'] === id);
  const dialogs = () => ui.nodes().filter((n) => propsOf(n).role === 'dialog');
  return {
    ...ui, calls, state, button, byId, dialogs,
    async type(id, value) { const n = byId(id); assert.ok(n, id); await act(async () => propsOf(n).onChange({ target: { value, checked: value } })); },
    async press(id) { const n = byId(id); assert.ok(n, id); assert.ok(!propsOf(n).disabled, `${id} is disabled`); await act(async () => propsOf(n).onClick?.({ preventDefault() {} })); await ui.flush(); },
    async submitForm(id) { const n = byId(id); assert.ok(n, id); await act(async () => propsOf(n).onSubmit({ preventDefault() {} })); await ui.flush(); },
    async close() { await ui.unmount(); Object.assign(api, originals); dd.listCases = oldCases; globalThis.localStorage = oldStorage; globalThis.fetch = oldFetch; },
  };
}

test('an investor casts, then changes, a vote from /deals/commit in a dialog', async () => {
  const ui = await setup();
  try {
    assert.equal(ui.byId('location') && textOf(ui.byId('location')), '/deals/commit');
    assert.match(ui.text(), /You have not voted on this decision/);
    await ui.press('button-open-vote');
    assert.equal(ui.dialogs().length, 1, 'the vote opens one dialog');
    assert.equal(propsOf(ui.dialogs()[0])['aria-modal'], 'true');
    assert.equal(propsOf(ui.byId('button-record-vote')).disabled, true, 'a vote without a choice and a reason is offered');
    await ui.press('vote-choice-no');
    assert.equal(propsOf(ui.byId('button-record-vote')).disabled, true, 'a vote without a reason is offered');
    await ui.type('input-vote-reason', 'Synthetic pass reason');
    await ui.submitForm('form-vote');
    assert.deepEqual(ui.calls, [['vote', 'syn-open', { vote: 'no', rationale: 'Synthetic pass reason' }]]);
    assert.equal(ui.dialogs().length, 0, 'a saved vote closes its dialog');
    assert.equal(textOf(ui.byId('location')), '/deals/commit', 'voting left the Commit zone');
  } finally { await ui.close(); }
  // With a vote recorded, the action is Change my vote and the dialog starts from it.
  const mine = decision({ votes: [{ user_id: 7, vote: 'abstain', rationale: 'Earlier reason', created_at: '2026-11-20 11:00:00' }] });
  const ch = await setup({ d: mine });
  try {
    assert.ok(ch.button('Change my vote'));
    assert.match(textOf(ch.byId('commit-vote-reason')), /Changing your vote replaces the earlier one/);
    await ch.press('button-open-vote');
    assert.equal(propsOf(ch.byId('input-vote-reason')).value, 'Earlier reason');
    assert.equal(propsOf(ch.byId('vote-choice-abstain'))['aria-pressed'], true);
    await ch.press('vote-choice-yes');
    await ch.submitForm('form-vote');
    assert.deepEqual(ch.calls, [['vote', 'syn-open', { vote: 'yes', rationale: 'Earlier reason' }]]);
  } finally { await ch.close(); }
});

test('recusal needs a declaration and the finality acknowledgement, and sends recused through icVote', async () => {
  assert.equal(voteBody('recused', 'x'), null, 'the vote dialog must never send a recusal');
  const ui = await setup({ d: decision({ votes: [{ user_id: 7, vote: 'yes', rationale: 'Earlier', created_at: '2026-11-20 11:00:00' }] }) });
  try {
    await ui.press('button-open-recuse');
    assert.equal(ui.dialogs().length, 1);
    assert.match(textOf(ui.byId('recuse-replaces')), /You voted Yes\. Recusing replaces that vote\./);
    assert.equal(propsOf(ui.byId('button-recuse')).disabled, true, 'a recusal without a declaration is offered');
    await ui.type('input-recusal-final', true);
    assert.equal(propsOf(ui.byId('button-recuse')).disabled, true, 'a recusal without a declaration is offered');
    await ui.type('input-recusal-declaration', '   ');
    assert.equal(propsOf(ui.byId('button-recuse')).disabled, true, 'a blank declaration counts as one');
    await ui.submitForm('form-recuse');
    assert.deepEqual(ui.calls, [], 'a blank declaration was sent');
    await ui.type('input-recusal-declaration', 'Synthetic declared conflict');
    await ui.type('input-recusal-final', false);
    assert.equal(propsOf(ui.byId('button-recuse')).disabled, true, 'a recusal without the finality acknowledgement is offered');
    await ui.type('input-recusal-final', true);
    await ui.submitForm('form-recuse');
    assert.deepEqual(ui.calls, [['vote', 'syn-open', { vote: 'recused', rationale: 'Synthetic declared conflict' }]]);
  } finally { await ui.close(); }
  // After recusing: drawn as a recusal (dashed ⊘), no vote control, final.
  const after = await setup({ d: decision({ tally: { yes: 1, no: 0, abstain: 0, recused: 1 }, votes: [{ user_id: 7, vote: 'recused', rationale: 'Synthetic declared conflict', created_at: '2026-11-20 12:00:00' }] }) });
  try {
    assert.equal(after.byId('button-open-vote'), undefined);
    assert.equal(after.byId('button-open-recuse'), undefined);
    assert.match(textOf(after.byId('commit-your-vote')), /A recusal is final/);
    assert.ok(after.nodes().some((n) => propsOf(n)['data-testid'] === 'vote-recused'), 'the recusal is not drawn as itself');
    assert.match(textOf(after.byId('commit-ballot')), /Recused⊘ 1 · beside the tally/);
  } finally { await after.close(); }
});

test('a refused write stays in its dialog, in the Worker’s own words, with the edits kept', async () => {
  const WORDS = 'You recused yourself from this decision. A recusal is final: it and its declaration stand, and no later vote is recorded.';
  const ui = await setup();
  try {
    api.icVote = async () => { throw Object.assign(new Error(WORDS), { status: 409, code: 'recusal_is_final' }); };
    await ui.press('button-open-vote');
    await ui.press('vote-choice-yes');
    await ui.type('input-vote-reason', 'Synthetic kept reason');
    await ui.submitForm('form-vote');
    assert.equal(ui.dialogs().length, 1, 'the refusal closed the dialog');
    assert.ok(textOf(ui.byId('status-vote-error')).includes(WORDS), 'the Worker’s words are not shown');
    assert.equal(propsOf(ui.byId('input-vote-reason')).value, 'Synthetic kept reason');
    assert.equal(propsOf(ui.byId('vote-choice-yes'))['aria-pressed'], true);
  } finally { await ui.close(); }

  const rec = await setup();
  try {
    const said = 'A recusal records the conflict it declares. Write the declaration as the rationale.';
    api.icVote = async () => { throw Object.assign(new Error(said), { status: 400 }); };
    await rec.press('button-open-recuse');
    await rec.type('input-recusal-declaration', 'Synthetic kept declaration');
    await rec.type('input-recusal-final', true);
    await rec.submitForm('form-recuse');
    assert.equal(rec.dialogs().length, 1);
    assert.ok(textOf(rec.byId('status-recuse-error')).includes(said));
    assert.equal(propsOf(rec.byId('input-recusal-declaration')).value, 'Synthetic kept declaration');
  } finally { await rec.close(); }

  const close = await setup();
  try {
    const said = 'Return to HQ to make this change.';
    api.icUpdate = async () => { throw Object.assign(new Error(said), { status: 403, code: 'investor_preview_read_only' }); };
    const closeVote = close.button('Close vote');
    assert.ok(closeVote, 'Close vote is not offered to the author');
    await act(async () => propsOf(closeVote).onClick());
    assert.equal(close.dialogs().length, 1, 'Close vote is not a dialog');
    assert.equal(propsOf(close.byId('button-close-vote-confirm')).disabled, true, 'closing without a choice is offered');
    await close.press('button-close-vote-pass');
    await close.press('button-close-vote-confirm');
    assert.equal(close.dialogs().length, 1);
    assert.ok(textOf(close.byId('status-close-vote-error')).includes(said));
    assert.equal(propsOf(close.byId('button-close-vote-pass'))['aria-pressed'], true);
  } finally { await close.close(); }

  const cond = await setup();
  try {
    const said = 'A condition is the sentence a later stage checks — write it.';
    api.icAddCondition = async () => { throw Object.assign(new Error(said), { status: 400 }); };
    await act(async () => propsOf(cond.button('Add condition')).onClick());
    assert.equal(cond.dialogs().length, 1, 'Add condition is not a dialog');
    await cond.type('input-condition', 'Synthetic kept condition');
    await cond.press('button-submit-condition');
    assert.equal(cond.dialogs().length, 1);
    assert.ok(textOf(cond.byId('status-condition-form-error')).includes(said));
    assert.equal(propsOf(cond.byId('input-condition')).value, 'Synthetic kept condition');
  } finally { await cond.close(); }

  assert.equal(refusalWords(new Error('  '), 'fallback'), 'fallback');
  assert.equal(refusalWords({ message: 'Worker said' }, 'fallback'), 'Worker said');
});

test('closing the vote and adding a condition write only after the dialog confirms', async () => {
  const ui = await setup();
  try {
    await act(async () => propsOf(ui.button('Close vote')).onClick());
    assert.match(textOf(ui.byId('close-vote-tally')), /Yes 1 · No 0 · Abstain 0 · Recused 0/);
    await ui.press('button-close-vote-defer');
    assert.deepEqual(ui.calls, [], 'choosing an outcome recorded it');
    await ui.press('button-close-vote-confirm');
    assert.deepEqual(ui.calls, [['update', 'syn-open', { decision: 'defer' }]]);
    assert.equal(ui.dialogs().length, 0);
    await act(async () => propsOf(ui.button('Add condition')).onClick());
    await ui.type('input-condition', 'Synthetic condition');
    await ui.press('button-submit-condition');
    assert.deepEqual(ui.calls[1], ['condition', 'syn-open', { body: 'Synthetic condition' }]);
    assert.equal(ui.dialogs().length, 0);
  } finally { await ui.close(); }
});

test('an investor opens a decision from the current view and stays on /deals/commit', async () => {
  const ui = await setup();
  try {
    await ui.press('button-open-decision');
    assert.equal(ui.dialogs().length, 1);
    const title = ui.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).required);
    await act(async () => propsOf(title).onChange({ target: { value: 'Synthetic new decision' } }));
    const form = ui.nodes().find((n) => n.tagName === 'FORM');
    await act(async () => propsOf(form).onSubmit({ preventDefault() {} }));
    await ui.flush();
    assert.equal(ui.calls[0][0], 'create');
    assert.equal(ui.calls[0][1].title, 'Synthetic new decision');
    assert.equal(ui.dialogs().length, 0);
    assert.equal(textOf(ui.byId('location')), '/deals/commit');
  } finally { await ui.close(); }
});

test('unreadable never offers a vote', async () => {
  // The model: votes or roster missing from the read, or a roster without members.
  for (const d of [decision({ votes: undefined }), decision({ roster: undefined }), decision({ roster: { available: true, eligible: 3 } }), decision({ roster: {} })]) {
    const offer = voteOffer(d, ME);
    assert.equal(offer.state, 'unreadable');
    assert.deepEqual(offer.may, { vote: false, recuse: false });
  }
  assert.equal(voteOffer(decision(), null).state, 'unreadable');
  assert.deepEqual(rosterLine(decision({ roster: undefined })), { unreadable: true });
  // Readable but closed, or off the roster: no control either, each with its reason.
  assert.equal(voteOffer(decision({ status: 'decided' }), ME).may.vote, false);
  const off = voteOffer(decision({ roster: { available: true, eligible: 1, to_vote: 1, members: [{ user_id: 9 }] } }), ME);
  assert.equal(off.state, 'off_roster');
  assert.equal(off.may.recuse, false);
  assert.equal(voteOffer(decision({ roster: { available: true, eligible: 1, to_vote: 1, members: [{ user_id: 7 }] } }), ME).state, 'not_voted');

  // Mounted: the committee read failed — no vote control anywhere.
  const failed = await setup({ roomRead: async () => { throw Object.assign(new Error('Synthetic read failure'), { status: 500 }); } });
  try {
    assert.match(failed.text(), /could not be read/);
    for (const label of ['Cast my vote', 'Change my vote', 'Recuse myself']) assert.equal(failed.button(label), undefined, label);
  } finally { await failed.close(); }
  // Mounted: the decision's votes, or its roster, are missing from the read.
  for (const d of [decision({ votes: undefined }), decision({ roster: undefined })]) {
    const partial = await setup({ d });
    try {
      assert.equal(propsOf(partial.byId('commit-your-vote'))['data-state'], 'unreadable');
      assert.match(textOf(partial.byId('commit-vote-reason')), /Unavailable/);
      for (const label of ['Cast my vote', 'Change my vote', 'Recuse myself']) assert.equal(partial.button(label), undefined, label);
    } finally { await partial.close(); }
  }
});

test('the /ic addresses forward into Deals, and the frozen /ic routes still admit partner and admin', async () => {
  for (const [start, landed] of [
    ['/ic', '/deals/commit?view=decisions'],
    ['/ic/syn-old', '/deals/commit/syn-old'],
    ['/deals/commit?decision=syn-old', '/deals/commit/syn-old'],
  ]) {
    const ui = await setup({ start });
    try { assert.equal(textOf(ui.byId('location')), landed, start); } finally { await ui.close(); }
  }
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /<Route path="\/ic" element=\{guard\(\['admin', 'partner', 'investor'\], <ICDecisionsPage \/>\)\} \/>/);
  assert.match(app, /<Route path="\/ic\/:uid" element=\{guard\(\['admin', 'partner', 'investor'\], <ICDecisionPage \/>\)\} \/>/);
  // Record position (admin, Task #83) stays on the decision record the forward lands on.
  assert.match(readFileSync('frontend/src/pages/ICDecisionPage.jsx', 'utf8'), /Record position/);
});
