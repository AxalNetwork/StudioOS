/**
 * #6235 — the general partner of record creates their fund from the Fund
 * overview's no-fund state (FV1b) and edits its terms on the fund page:
 *
 *   · the create form sends name, vintage, size, status, fee and carry, both
 *     rates required (a blank is never stored as 2% or 20%), and the overview
 *     then opens on the new fund;
 *   · Edit terms reads the stored row and sends only what changed; a changed
 *     fee or carry carries the reason the Worker keeps on the audit row;
 *   · a Worker refusal is shown as its own sentence and "Nothing was saved.";
 *     a request with no answer says the outcome is not known.
 *
 * Every fund here is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_create_edit_6235.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorFundLanding from '../src/pages/investor/InvestorFundLanding.jsx';
import { CreateFundCard, EditTermsCard } from '../src/pages/investor/FundTermsForm.jsx';
import {
  ECONOMICS_REASON, NOTHING_CHANGED, NOTHING_SAVED, NO_ANSWER_CREATE, NO_ANSWER_SAVE,
  createFund, createFundBody, refusalLine, saveTerms, termsForm, termsPatch,
} from '../src/pages/investor/fundTermsModel.js';

const h = React.createElement;
const STORED = { id: 21, name: 'Example Fund II', vintage_year: 2026, fund_size_cents: 4000000000, status: 'fundraising', carried_interest: 0.2, management_fee: 0.02 };
const filled = { name: 'Example Fund II', vintage: '2026', size: '40,000,000.00', fee: '2', carry: '20', status: 'fundraising' };
const refused = (status, message) => Object.assign(new Error(message), { status });

// Mutation checked: checkNewFund's rate check dropped (blank carry sent) fails; status forced to the default fails.
test('the create body carries the six fields, and a blank rate is refused, never defaulted', () => {
  assert.deepEqual(createFundBody(filled).body, { name: 'Example Fund II', status: 'fundraising', vintage_year: 2026, fund_size_cents: 4000000000, carried_interest: 0.2, management_fee: 0.02 });
  assert.equal(createFundBody({ ...filled, status: 'active' }).body.status, 'active');
  assert.match(createFundBody({ ...filled, carry: '' }).error, /carry/);
  assert.match(createFundBody({ ...filled, fee: '' }).error, /management fee/);
  assert.match(createFundBody({ ...filled, name: '  ' }).error, /Name the fund/);
});

// Mutation checked: the reason requirement removed fails; a rate compared as changed when equal fails; a blank rate where one is recorded accepted fails.
test('Edit terms sends only what changed, and a fee or carry change needs a reason', () => {
  const form = termsForm(STORED);
  assert.deepEqual({ ...form }, { name: 'Example Fund II', vintage: '2026', size: '40000000.00', status: 'fundraising', fee: '2.00', carry: '20.00', reason: '' });
  assert.deepEqual(termsPatch(form, STORED), { error: NOTHING_CHANGED });
  assert.deepEqual(termsPatch({ ...form, name: 'Example Fund II-A' }, STORED), { body: { name: 'Example Fund II-A' } });
  assert.deepEqual(termsPatch({ ...form, status: 'active' }, STORED), { body: { status: 'active' } });
  assert.deepEqual(termsPatch({ ...form, carry: '25' }, STORED), { error: ECONOMICS_REASON });
  assert.deepEqual(termsPatch({ ...form, carry: '25', reason: 'LPA side letter amended' }, STORED),
    { body: { carried_interest: 0.25, reason: 'LPA side letter amended' } });
  assert.deepEqual(termsPatch({ ...form, fee: '1.5', reason: 'Fee step-down after the investment period' }, STORED),
    { body: { management_fee: 0.015, reason: 'Fee step-down after the investment period' } });
  assert.match(termsPatch({ ...form, fee: '' }, STORED).error, /management fee/, 'a recorded fee cannot be blanked');
  assert.deepEqual(termsPatch({ ...form, fee: '', carry: '' }, { ...STORED, management_fee: null, carried_interest: null }), { error: NOTHING_CHANGED }, 'nothing recorded and nothing typed is no change');
  assert.match(termsPatch({ ...form, name: 'Renamed fund', reason: 'short' }, STORED).error, /10 to 500/);
});

// Mutation checked: "Nothing was saved." dropped from refusalLine fails; a no-answer error read as a refusal fails.
test('a refusal is its own sentence and nothing is assumed saved', async () => {
  assert.equal(refusalLine(refused(402, 'The Institutional tier is required'), 'x'), `The Institutional tier is required. ${NOTHING_SAVED}`);
  assert.equal(refusalLine(refused(400, 'A reason is 10 to 500 characters. Nothing was changed.'), 'x'), 'A reason is 10 to 500 characters. Nothing was changed.');
  const create = await createFund({ create: async () => { throw refused(403, 'A support session cannot move fund money or write a fund’s books.'); } }, filled);
  assert.equal(create.error, `A support session cannot move fund money or write a fund’s books. ${NOTHING_SAVED}`);
  assert.equal((await createFund({ create: async () => { throw new TypeError('Failed to fetch'); } }, filled)).error, NO_ANSWER_CREATE);
  assert.equal((await createFund({ create: async () => ({ ok: true }) }, filled)).error, NO_ANSWER_CREATE, 'no fund in the answer is not a created fund');
  let sent = null;
  const ok = await createFund({ create: async (body) => { sent = body; return { ok: true, fund: { ...STORED }, lpa_status: 'enqueued' }; } }, filled);
  assert.equal(ok.fund.id, 21);
  assert.equal(sent.carried_interest, 0.2);
  const save = await saveTerms({ update: async () => { throw refused(423, 'Your account is in its recovery cool-off'); } }, 21, { ...termsForm(STORED), name: 'Renamed fund' }, STORED);
  assert.equal(save.error, `Your account is in its recovery cool-off. ${NOTHING_SAVED}`);
  assert.equal((await saveTerms({ update: async () => { throw new TypeError('Failed to fetch'); } }, 21, { ...termsForm(STORED), name: 'Renamed fund' }, STORED)).error, NO_ANSWER_SAVE);
});

async function mountNode(node) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => root.render(node));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    has: (id) => Boolean(byId(id)),
    textOf: (id) => text(byId(id)),
    text: () => text(container),
    props: (id) => props(byId(id)),
    type: async (id, value) => { await act(async () => props(byId(id)).onChange({ target: { value } })); },
    submit: async (id) => { await act(async () => props(byId(id)).onSubmit({ preventDefault() {} })); await settle(); },
    close: async () => { await act(async () => root.unmount()); globalThis.fetch = prev.fetch; globalThis.matchMedia = prev.matchMedia; restore(); },
    setFetch: (f) => { globalThis.fetch = f; },
  };
}

// Mutation checked: onCreated not wired to choose the fund and reload (overview stays empty) fails; the create card removed from the no-fund state fails.
test('the no-fund state creates the fund, and the overview then shows it', async () => {
  const restore = installDocument();
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  let funds = [];
  const posts = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u);
    if (/\/api\/funds$/.test(url) && init.method === 'POST') {
      const body = JSON.parse(init.body);
      posts.push(body);
      funds = [{ id: 21, name: body.name, status: body.status, committed_cents: 0, called_cents: 0, collected_cents: null, capital_reason: 'No dated capital-call receipts are recorded.', deployed_cents: 0, distributed_cents: 0, lp_count: 0 }];
      return json({ ok: true, fund: { id: 21, ...body }, lpa_status: 'enqueued' }, 201);
    }
    if (/\/api\/funds\/analytics/.test(url)) return json({ items: funds, totals: null, unavailable: {} });
    if (/\/lps/.test(url)) return json({ items: [] });
    if (/\/api\/capital\/calls/.test(url)) return json([]);
    if (/\/report-periods/.test(url)) return json({ items: [] });
    return json({});
  };
  restore();
  const v = await mountNode(h(MemoryRouter, { initialEntries: ['/funds'] }, h(InvestorFundLanding, { fundUnlocked: true })));
  try {
    assert.ok(v.has('fund-create-card'), 'the no-fund state offers the create form');
    assert.match(v.text(), /No fund to operate yet\./);
    await v.type('input-fund-create-name', 'Example Fund II');
    await v.type('input-fund-create-vintage', '2026');
    await v.type('input-fund-create-size', '40,000,000.00');
    await v.type('input-fund-create-fee', '2');
    await v.submit('form-fund-create');
    assert.match(v.textOf('text-fund-create-error'), /carry/, 'no carry typed: refused before any request');
    assert.equal(posts.length, 0);
    await v.type('input-fund-create-carry', '20');
    await v.submit('form-fund-create');
    assert.deepEqual(posts, [{ name: 'Example Fund II', status: 'fundraising', vintage_year: 2026, fund_size_cents: 4000000000, carried_interest: 0.2, management_fee: 0.02 }]);
    assert.ok(!v.has('fund-create-card'), 'the create form is gone once a fund is recorded');
    assert.equal(String(v.props('select-active-fund').value), '21', 'the overview opens on the new fund');
  } finally { await v.close(); globalThis.fetch = prevFetch; }
});

// Mutation checked: the refusal rendered as a generic line (not its own sentence) fails; onSaved called on a refusal fails.
test('Edit terms reads the stored row, shows a refused edit as its sentence, and saves a changed carry with its reason', async () => {
  const calls = [];
  let refuse = true;
  const client = {
    read: async (id) => ({ ok: true, fund: { ...STORED, id } }),
    update: async (id, body) => {
      calls.push([id, body]);
      if (refuse) throw refused(403, 'A support session cannot move fund money or write a fund’s books.');
      return { ok: true, fund: { ...STORED, ...body } };
    },
    create: async () => { throw new Error('not used'); },
  };
  const saved = [];
  const v = await mountNode(h(MemoryRouter, null, h(EditTermsCard, { fundId: 21, client, onSaved: (f) => saved.push(f), onClose() {} })));
  try {
    assert.equal(v.props('input-fund-terms-carry').value, '20.00', 'the form starts from what is recorded');
    await v.type('input-fund-terms-carry', '25');
    await v.submit('form-fund-edit-terms');
    assert.equal(v.textOf('text-fund-terms-error'), ECONOMICS_REASON);
    assert.equal(calls.length, 0, 'a missing reason is caught before any request');
    await v.type('input-fund-terms-reason', 'LPA side letter amended');
    await v.submit('form-fund-edit-terms');
    assert.equal(v.textOf('text-fund-terms-error'), `A support session cannot move fund money or write a fund’s books. ${NOTHING_SAVED}`);
    assert.deepEqual(saved, [], 'a refused edit is not reported as saved');
    refuse = false;
    await v.submit('form-fund-edit-terms');
    assert.deepEqual(calls.at(-1), [21, { carried_interest: 0.25, reason: 'LPA side letter amended' }]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].carried_interest, 0.25);
  } finally { await v.close(); }
});

// Mutation checked: a failed read rendered as an empty form fails.
test('Edit terms with an unreadable fund offers no form', async () => {
  const client = { read: async () => { throw refused(503, 'down'); }, update: async () => { throw new Error('not used'); } };
  const v = await mountNode(h(MemoryRouter, null, h(EditTermsCard, { fundId: 21, client, onClose() {} })));
  try {
    assert.ok(v.has('text-fund-terms-unreadable'));
    assert.ok(!v.has('form-fund-edit-terms'));
  } finally { await v.close(); }
});

test('the create card stands alone with its My commitment line', async () => {
  const v = await mountNode(h(MemoryRouter, null, h(CreateFundCard, { client: { create: async () => ({}) } })));
  try {
    assert.equal(v.props('link-fund-create-my-commitment').href, '/spinout-lab/investor-workspace#my-commitment');
    assert.match(v.text(), /nothing is sent to anyone and no LP is invited/);
  } finally { await v.close(); }
});
