// #4190 (K3 of #4155) — HQ › Decks › Beta cohort, live: the cohort by name, Add
// people found by name with features and a reason, Remove… with a reason.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_decks_beta_4190.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { adminDeckBetaApi } from '../src/lib/api/adminDeckBeta.js';
import HqDecksPage from '../src/pages/hq/decks/HqDecksPage.jsx';
import { ALL_ELEMENTS, BUILD, NOT_RECORDED, addArmed, betaChoices, cohortRow } from '../src/pages/hq/decks/hqDecksModel.js';

const h = React.createElement;
const KEYS = [{ key: 'deck:rehearsal', label: 'Rehearsal' }, { key: 'grid_generate', label: 'One-click generate' }, { key: 'element:title', label: 'Element · title' }, { key: 'element:body', label: 'Element · body' }];
const COHORT = { people: [{ user: { uid: 'u-ada', name: 'Ada Lindqvist' }, company: 'Kestrel Labs', features: ['deck:rehearsal', 'element:body', 'element:title'], added_by: { uid: 'u-hq', name: 'Hana HQ' }, added_at: '2026-11-03 09:00:00' }], page: 1, per_page: 25, total: 1, keys: KEYS };

test('the model: a cohort row names people and features, never an id or an email; Add arms on people, features and a reason', () => {
  // Mutation checked: addArmed without the reason → a bare add arms.
  assert.equal(BUILD.K3.live, true);
  const r = cohortRow(COHORT.people[0], KEYS);
  assert.deepEqual([r.name, r.company, r.features, r.by], ['Ada Lindqvist', 'Kestrel Labs', ['Rehearsal', '2 grid elements'], 'Hana HQ']);
  assert.equal(cohortRow({ user: { uid: 'x' }, features: [], added_by: null }).by, NOT_RECORDED);
  assert.deepEqual(betaChoices(KEYS).map((k) => k.key), ['deck:rehearsal', 'grid_generate', ALL_ELEMENTS]);
  assert.equal(addArmed({ people: [{ uid: 'u' }], features: ['grid_generate'], reason: 'short' }), false);
  assert.equal(addArmed({ people: [], features: ['grid_generate'], reason: 'A good long reason.' }), false);
  assert.equal(addArmed({ people: [{ uid: 'u' }], features: ['grid_generate'], reason: 'A good long reason.' }), true);
});

async function mount() {
  const calls = [];
  const orig = { ...adminDeckBetaApi };
  adminDeckBetaApi.list = async (f) => { calls.push(['list', f]); return COHORT; };
  adminDeckBetaApi.people = async (q) => { calls.push(['people', q]); return { people: [{ uid: 'u-ben', name: 'Ben Adair', company: null, role: 'founder' }] }; };
  adminDeckBetaApi.add = async (...a) => { calls.push(['add', ...a]); return { added: a[0] }; };
  adminDeckBetaApi.remove = async (...a) => { calls.push(['remove', ...a]); return { removed: a[0] }; };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/admin/platform/decks/beta'] }, h(HqDecksPage))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr, text: (n = container) => text(n).replace(/\s+/g, ' '),
    async press(n) { assert.ok(n, 'drawn'); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(n, value) { assert.ok(n, 'drawn'); await act(async () => { pr(n).onChange?.({ target: { value, checked: value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); Object.assign(adminDeckBetaApi, orig); },
  };
}

test('the board: the cohort by name; Add people searches by name and sends people, features and the reason', async () => {
  // Mutation checked: the search below 2 characters → people is called for "B"; Add sending no reason → the call's reason check fails.
  const m = await mount();
  try {
    assert.match(m.text(m.by('deck-beta-row-u-ada')), /Ada Lindqvist Kestrel Labs Rehearsal, 2 grid elements Hana HQ/);
    await m.press(m.by('deck-beta-add-open'));
    assert.ok(m.by('deck-beta-add'));
    await m.type(m.by('deck-beta-search'), 'B');
    assert.equal(m.calls.filter(([n]) => n === 'people').length, 0, 'not below 2 characters');
    await m.type(m.by('deck-beta-search'), 'Be');
    assert.deepEqual(m.calls.find(([n]) => n === 'people'), ['people', 'Be']);
    await m.type(m.by('deck-beta-pick-u-ben'), true);
    await m.type(m.by(`deck-beta-feature-${ALL_ELEMENTS}`), true);
    assert.equal(m.pr(m.by('deck-beta-add-confirm')).disabled, true, 'no reason yet');
    await m.type(m.by('deck-beta-reason'), 'Early access for the November cohort.');
    await m.press(m.by('deck-beta-add-confirm'));
    assert.deepEqual(m.calls.find(([n]) => n === 'add'), ['add', ['u-ben'], [ALL_ELEMENTS], 'Early access for the November cohort.']);
    assert.equal(m.calls.filter(([n]) => n === 'list').length, 2, 'the cohort is read again');
  } finally { await m.unmount(); }
});

test('the board: Remove… asks for a reason and says what stays', async () => {
  // Mutation checked: Remove enabled without a reason → the first press removes.
  const m = await mount();
  try {
    await m.press(m.by('deck-beta-remove-u-ada'));
    assert.match(m.text(m.by('deck-beta-remove')), /What they already made stays: decks, logo walls on slides, recordings\./);
    assert.equal(m.pr(m.by('deck-beta-remove-confirm')).disabled, true);
    await m.type(m.by('deck-beta-remove-reason'), 'The November cohort has ended.');
    await m.press(m.by('deck-beta-remove-confirm'));
    assert.deepEqual(m.calls.find(([n]) => n === 'remove'), ['remove', 'u-ada', 'The November cohort has ended.']);
  } finally { await m.unmount(); }
});
