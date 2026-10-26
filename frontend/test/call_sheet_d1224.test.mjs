/**
 * D1224 (#3223, Calls part 3) — the new-call sheet in the canvas's look
 * (CLS4–CLS7), mounted on a stubbed `roundCallsApi`, and a draft opening under
 * Calls in the Raise shell.
 *
 *  1. The plain-words terms restate the figures typed or recorded and add none:
 *     Eadwyn proposes no money term, and accepting changes the words only.
 *  2. Each seeded field says where it came from until the founder changes it.
 *  3. A refusal at every step keeps the entry: the round, the audience and Send.
 *  4. Counsel's approval clears when a term changes, and the preview says so.
 *  5. Send waits for counsel and for each missing item to be acknowledged; its
 *     result says who was told and links who was not.
 *  6. A draft's address is under Calls, where Continue draft (D1225) opens the sheet.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/call_sheet_d1224.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { roundCallsApi } from '../src/lib/api/roundCalls.js';
import RoundCallSheet, { acceptPlainTerms, counselState, plainTerms, seedChips, sendResult, canSend } from '../src/pages/founder/RoundCallSheet.jsx';
import RaiseCallPage from '../src/pages/founder/RaiseCallPage.jsx';
import { callHref, LIST_PATH } from '../src/pages/raise/calls/callsModel.js';

const h = React.createElement;
const CONTEXT = {
  project: { id: 7, name: 'Acme' }, round: { name: 'Seed extension', target_amount: 1500000, close_date: '2099-01-15' }, scenario: null,
  term_seeds: { safe: { valuation_cap_cents: 1000000000, discount_bps: null, pre_money_cents: null } },
  decks: [{ id: 4, version: 7, title: 'Acme deck', is_current: 1 }],
  chosen: [{ prospect_id: 1, name: 'Bluefern Capital', email: 'b@example.test' }],
  data_room: { project_uid: 'acme' },
};
const READY = ['round', 'terms', 'deck', 'data_room', 'traction', 'close'].map((key) => ({ key, label: key, ready: true }));
const MISSING = { key: 'use_of_funds', label: 'Use of funds', ready: false };
const callOf = (o = {}) => ({ uid: 'd1', project_id: 7, name: 'Seed extension', state: 'draft', instrument: 'safe', amount_cents: 150000000,
  minimum_cheque_cents: 2500000, terms: 'Plain words', target_close: '2099-01-15', deck_id: 4, deck_version: 7, data_room_project_uid: 'acme',
  valuation_cap_cents: 1000000000, discount_bps: null, pre_money_cents: null, revision: 3, terms_hash: 'h3', ...o });
const pageOf = (o = {}, call = {}) => ({ viewer: 'founder', call: callOf(call), recipients: [{ origin: 'chosen' }, { origin: 'match' }, { origin: 'match' }],
  readiness: [...READY, MISSING], counsel_approved: false, ...o });

const refusal = (status, code) => Object.assign(new Error('The Worker refused it.'), { status, code });

/** The sheet over a stubbed API: each key a value, a function, or a list answered in turn. */
async function mountSheet(answers, props = {}) {
  const calls = [];
  const saved = { ...roundCallsApi };
  for (const key of Object.keys(saved)) {
    const answer = Object.hasOwn(answers, key) ? answers[key] : {};
    const queue = Array.isArray(answer) ? [...answer] : null;
    roundCallsApi[key] = async (...args) => {
      calls.push([key, ...args]);
      const next = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : answer;
      const value = typeof next === 'function' ? next(...args) : next;
      if (value instanceof Error) throw value;
      return value;
    };
  }
  const view = await mountContracts(h(RoundCallSheet, { projectId: 7, onClose: () => {}, ...props }), '/raise/call');
  for (let i = 0; i < 6; i++) await view.flush();
  const byId = (id) => view.nodes().find((n) => view.props(n)?.id === id);
  const settle = async () => { for (let i = 0; i < 6; i++) await view.flush(); };
  return {
    calls, view,
    names: () => calls.map((c) => c[0]),
    text: () => view.text(),
    value: (id) => view.props(byId(id))?.value,
    async set(id, value) { const n = byId(id); assert.ok(n, `no #${id}`); view.props(n).onChange({ target: { value } }); await settle(); },
    async click(label) { await view.click(label); await settle(); },
    async tick(label) { const n = view.nodes().find((x) => view.props(x)?.['aria-label'] === label || (x.tagName === 'LABEL' && x.textContent === label)); const box = n?.tagName === 'INPUT' ? n : n?.childNodes?.find((c) => c.tagName === 'INPUT'); assert.ok(box, `no ${label}`); view.props(box).onChange(); await settle(); },
    async press(label) { const n = view.nodes().find((x) => x.tagName === 'BUTTON' && view.props(x)?.['aria-label'] === label); assert.ok(n, `no ${label}`); view.props(n).onClick(); await settle(); },
    disabled: (label) => view.props(view.nodes().find((x) => x.tagName === 'BUTTON' && x.textContent.trim() === label))?.disabled === true,
    async done() { await view.unmount(); Object.assign(roundCallsApi, saved); },
  };
}

// ── 1. The plain-words terms ────────────────────────────────────────────────

test('1. the plain-words terms restate the typed figures and add none; accepting changes the words only', () => {
  // Mutations checked: a figure added the founder did not type; a missing figure filled; Accept writing a money field.
  const fields = { name: 'Seed', amount: '1500000', instrument: 'safe', cap: '10000000', discount: '', pre_money: '', minimum: '25000', target: '2099-01-15', terms: '' };
  const words = plainTerms(fields);
  assert.equal(words, 'A SAFE for up to $1,500,000 with a valuation cap of $10,000,000. The smallest cheque is $25,000, and the call closes on 15 Jan 2099.');
  const typed = new Set(['$1,500,000', '$10,000,000', '$25,000']);
  for (const figure of words.match(/\$\d[\d,]*\d/g)) assert.ok(typed.has(figure), `${figure} was not typed`);
  for (const gap of ['amount', 'minimum', 'target', 'instrument']) assert.equal(plainTerms({ ...fields, [gap]: '' }), null, `${gap} missing: nothing is drafted`);
  assert.equal(plainTerms({ ...fields, cap: '' }), 'A SAFE for up to $1,500,000. The smallest cheque is $25,000, and the call closes on 15 Jan 2099.', 'no cap is invented');
  assert.equal(plainTerms({ ...fields, instrument: 'convertible_note', discount: '20' }), 'A convertible note for up to $1,500,000 with a valuation cap of $10,000,000 and a discount of 20%. The smallest cheque is $25,000, and the call closes on 15 Jan 2099.');
  const accepted = acceptPlainTerms(fields, words);
  assert.deepEqual({ ...accepted, terms: '' }, fields, 'Accept changes the words and no money field');
  assert.equal(accepted.terms, words);
});

test('2. each seeded field says where it came from until the founder changes it', () => {
  const seeded = { amount: '1500000', target: '2099-01-15', instrument: 'safe', cap: '10000000', discount: '', pre_money: '' };
  assert.deepEqual(seedChips(CONTEXT, seeded), { amount: 'From your round settings', target: 'From your round settings', cap: 'From your recorded terms' });
  assert.deepEqual(seedChips(CONTEXT, { ...seeded, amount: '2000000', cap: '9' }), { target: 'From your round settings' }, 'a changed field loses its chip');
  assert.deepEqual(seedChips(null, seeded), {});
});

// ── 3–5. Mounted ────────────────────────────────────────────────────────────

test('3. every step\'s refusal keeps the entry: the round, the audience and Send', async () => {
  // Mutations checked: a refused create advancing; a refused audience save clearing the choice; a refused send losing the acknowledgements.
  const s = await mountSheet({
    availability: { enabled: true }, context: CONTEXT, list: { items: [] },
    create: [refusal(422, 'invalid_terms'), { uid: 'd1' }],
    previewAudience: { matched: 18, stage: 'Seed', sector: 'Robotics', cheque_min_usd: 25000, cheque_max_usd: 500000, not_on_axal: [{ prospect_id: 9, name: 'Lumen Ventures', chosen: false }] },
    audience: [refusal(409, 'call_changed'), { ok: true }],
    page: pageOf({ counsel_approved: true }, { counsel_approved_at: '2026-09-29' }),
    send: [refusal(503, 'unavailable'), { recipients: 3, notified: 2, not_delivered: 1 }],
  });
  try {
    assert.match(s.text(), /New call · step 1 of 5/);
    assert.equal(s.value('call-amount'), '1500000');
    await s.click('SAFE');
    assert.equal(s.value('call-cap'), '10000000', 'the recorded cap fills in');
    await s.set('call-minimum', '25000');
    assert.match(s.text(), /Drafted from the fields above/);
    assert.doesNotMatch(s.text(), /Proposed by Eadwyn/, 'no AI proposal is claimed');
    await s.click('Accept');
    assert.equal(s.value('call-terms'), plainTerms({ amount: '1500000', instrument: 'safe', cap: '10000000', minimum: '25000', target: '2099-01-15' }));

    await s.click('Next');
    assert.match(s.text(), /New call · step 1 of 5/, 'a refused save stays on the round');
    assert.match(s.text(), /The Worker refused it\./);
    assert.deepEqual([s.value('call-minimum'), s.value('call-cap'), s.value('call-amount')], ['25000', '10000000', '1500000'], 'the entry is kept');
    await s.click('Next');
    assert.match(s.text(), /New call · step 2 of 5/);
    assert.match(s.text(), /Acme deck · v7 · frozen when sent/);
    await s.click('Next');

    assert.match(s.text(), /From your pipeline/);
    assert.match(s.text(), /Bluefern CapitalVerified on Axal/);
    assert.match(s.text(), /Lumen VenturesNot on Axal/);
    const greyed = s.view.nodes().find((n) => s.view.props(n)?.['aria-label'] === 'Lumen Ventures is not on Axal');
    assert.equal(s.view.props(greyed).disabled, true, 'an investor not on Axal cannot be chosen');
    assert.ok(s.disabled('Invite to Axal'), 'inviting waits on a route');
    assert.match(s.text(), /18 matching investors · stage Seed · sector Robotics · cheque range \$25k–\$500k/);
    await s.tick('Choose Bluefern Capital');
    await s.press('Also invite investors whose published focus fits');
    await s.click('Next');
    assert.match(s.text(), /New call · step 3 of 5/, 'a refused audience stays on the audience');
    const box = s.view.nodes().find((n) => s.view.props(n)?.['aria-label'] === 'Choose Bluefern Capital');
    assert.equal(s.view.props(box).checked, true, 'the choice is kept');
    await s.click('Next');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'audience').map((c) => c[2]), [{ chosen_prospect_ids: [1], include_matches: true }, { chosen_prospect_ids: [1], include_matches: true }]);

    assert.match(s.text(), /What investors see/);
    assert.match(s.text(), /A private round call from Acme/);
    assert.match(s.text(), /6 of 7 ready/);
    await s.click('Next');

    assert.match(s.text(), /Send Seed extension to 3 investors\?/);
    assert.match(s.text(), /1 chosen from your pipeline and 2 matching investors\./);
    assert.ok(s.disabled('Send the call'), 'a missing item is acknowledged first');
    await s.tick('Send anyway without Use of funds');
    assert.equal(s.disabled('Send the call'), false);
    await s.click('Send the call');
    assert.match(s.text(), /could not be confirmed/);
    assert.equal(s.disabled('Send the call'), false, 'the acknowledgement is kept');
    await s.click('Send the call');
    assert.match(s.text(), /Sent\. 2 investors were told on Axal\. 1 could not be told\. See who/);
    assert.match(s.text(), /Investors are told inside Axal\. No email is sent\./);
    const who = s.view.nodes().find((n) => n.tagName === 'A' && n.textContent === 'See who');
    assert.equal(s.view.props(who).href, '/raise/capital-relationships/calls/d1', 'See who opens the call under Calls');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'send').map((c) => c[2]), [{ acknowledge_missing: true }, { acknowledge_missing: true }]);
  } finally { await s.done(); }
});

test('4. counsel\'s approval clears when a term changes, and the preview says so', async () => {
  // Mutations checked: the cleared state never drawn; drawn without a change; the request button kept for a request in flight.
  let approved = true;
  const s = await mountSheet({
    availability: { enabled: true }, context: CONTEXT, list: { items: [] },
    page: () => pageOf({ counsel_approved: approved }, approved ? { counsel_approved_at: '2026-09-29' } : {}),
    save: () => { approved = false; return { uid: 'd1' }; },
    previewAudience: { matched: 0 },
  }, { initialCall: { uid: 'd1' } });
  try {
    assert.match(s.text(), /New call · step 5 of 5/, 'an approved draft resumes at Send');
    for (let i = 0; i < 4; i++) await s.click('Back');
    await s.set('call-cap', '12000000');
    await s.click('Next');
    assert.deepEqual(s.calls.find((c) => c[0] === 'save')?.[2]?.valuation_cap_cents, 1200000000);
    await s.click('Next');
    await s.click('Next');
    assert.match(s.text(), /New call · step 4 of 5/);
    assert.match(s.text(), /Your changes cleared the approval\./);
    assert.equal(s.disabled('Request again'), false);
    await s.click('Next');
    assert.ok(s.disabled('Send the call'), 'no send without a new approval');
  } finally { await s.done(); }

  // The four states, as the read reports them.
  const call = { terms_hash: 'h3' };
  assert.equal(counselState({ call, counsel_approved: true }).key, 'approved');
  assert.deepEqual(counselState({ call: { ...call, counsel_requested_at: '2026-09-26', counsel_requested_hash: 'h3' } }).action, null, 'waiting: no button');
  assert.deepEqual(counselState({ call: { ...call, counsel_requested_at: '2026-09-26', counsel_requested_hash: 'h2' } }), { key: 'cleared', line: 'Your changes cleared the approval.', action: 'Request again' });
  assert.deepEqual(counselState({ call }), { key: 'not_requested', line: 'Not requested.', action: 'Request counsel review' });
});

test('5. Send waits for counsel and every acknowledgement; the result counts who was told', () => {
  const missing = pageOf({ counsel_approved: true });
  assert.deepEqual([canSend(missing, []), canSend(missing, ['use_of_funds']), canSend({ ...missing, counsel_approved: false }, ['use_of_funds'])], [false, true, false]);
  assert.equal(sendResult({ notified: 29, not_delivered: 1 }), 'Sent. 29 investors were told on Axal. 1 could not be told.');
  assert.equal(sendResult({ notified: 1, not_delivered: 0 }), 'Sent. 1 investor was told on Axal.');
  assert.equal(sendResult({}), 'Sent. Axal could not read how many investors were told.', 'never a zero for a missing count');
});

// ── 6. A draft in the shell ─────────────────────────────────────────────────

test('6. a draft opens under Calls, and its Continue draft opens the sheet on it in the shell', async () => {
  // Mutations checked: a draft sent to /round-calls/:uid; a founder's draft kept at /round-calls/:uid.
  assert.equal(callHref({ uid: 'd1', state: 'draft' }), `${LIST_PATH}/d1`);
  const saved = { ...roundCallsApi };
  for (const key of Object.keys(saved)) roundCallsApi[key] = async () => ({});
  roundCallsApi.page = async () => ({ ...pageOf(), relation: 'owner', can: { draft: true, answer: true, audience: true, send: true, extend: true, close: true } });
  roundCallsApi.availability = async () => ({ enabled: true });
  roundCallsApi.context = async () => CONTEXT;
  try {
    const view = await mountContracts(h(Routes, null, h(Route, { path: '/raise/capital-relationships/calls/:uid', element: h(RaiseCallPage) })), '/raise/capital-relationships/calls/d1');
    try {
      for (let i = 0; i < 8; i++) await view.flush();
      await view.click('Continue draft');
      for (let i = 0; i < 8; i++) await view.flush();
      assert.match(view.text(), /New call · step 4 of 5/, 'the draft resumes in the sheet, at its preview');
    } finally { await view.unmount(); }
  } finally { Object.assign(roundCallsApi, saved); }
  assert.match(readFileSync('frontend/src/pages/founder/RoundCallPage.jsx', 'utf8'), /if\(read\.data\?\.viewer==='founder'\)return <Navigate to=\{'\/raise\/capital-relationships\/calls\/'\+encodeURIComponent\(uid\)\} replace\/>;/);
});
