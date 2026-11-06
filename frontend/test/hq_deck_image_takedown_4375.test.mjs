// #4375 (D4375) — HQ › Decks › Reports: take down an image a report names.
//
//   · the model: a report row carries its images; a takedown arms on a reason of 10 to 1,000 characters;
//   · the sheet: each image the report names has Take down image, sent with the trimmed reason; an image
//     already taken down says so and offers nothing;
//   · the client: POST /api/admin/deck-images/:uid/takedown { reason }.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_deck_image_takedown_4375.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { deckReportsApi } from '../src/lib/api/deckReports.js';
import HqDecksPage from '../src/pages/hq/decks/HqDecksPage.jsx';
import { TAKEDOWN_REASON_MAX, reportRow, takedownArmed } from '../src/pages/hq/decks/hqDecksModel.js';

const h = React.createElement;
const IMG = '3e1b4c85-9f2a-4d6b-8a5c-1d7e0f9b2a31';
const DONE = '4f2c5d96-0a3b-4e7c-9b6d-2e8f1a0c3b42';
const REPORT = {
  uid: 'r1', status: 'open', reason: 'bad_image', created_at: '2026-11-04 07:00:00', model: '@cf/synthetic/model-a',
  founder: { uid: 'u-ada', name: 'Ada Lindqvist' }, deck: { uid: '10', title: 'Synthetic deck', version: 3 }, card: { index: 0, label: 'Card 1 · Team' },
  images: [{ uid: IMG, url: `/api/decks/images/${IMG}/file`, taken_down: false }, { uid: DONE, url: `/api/decks/images/${DONE}/file`, taken_down: true }],
};

test('the model: a report row carries its images; a takedown arms on a reason of 10 to 1,000 characters', () => {
  // Mutation checked: takedownArmed without the minimum → a bare press arms.
  assert.deepEqual(reportRow(REPORT).images, [
    { uid: IMG, url: `/api/decks/images/${IMG}/file`, takenDown: false },
    { uid: DONE, url: `/api/decks/images/${DONE}/file`, takenDown: true },
  ]);
  assert.deepEqual(reportRow({ uid: 'x' }).images, [], 'a report with no images has none');
  assert.equal(takedownArmed(''), false);
  assert.equal(takedownArmed('   too short '), false);
  assert.equal(takedownArmed('Reported as unlawful.'), true);
  assert.equal(takedownArmed('x'.repeat(TAKEDOWN_REASON_MAX + 1)), false);
});

async function mount() {
  const calls = [];
  const orig = { ...deckReportsApi };
  deckReportsApi.queue = async (s) => { calls.push(['queue', s]); return { reports: [REPORT], counts: { open: 1, resolved_this_week: 0 } }; };
  deckReportsApi.takedownImage = async (...a) => { calls.push(['takedown', ...a]); return { image: { uid: a[0], reason: a[1] } }; };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/admin/platform/decks'] }, h(HqDecksPage))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr, text: (n = container) => text(n).replace(/\s+/g, ' '),
    async press(n) { assert.ok(n, 'drawn'); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(n, value) { assert.ok(n, 'drawn'); await act(async () => { pr(n).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); Object.assign(deckReportsApi, orig); },
  };
}

test('the sheet: Take down image is sent with the trimmed reason; an image already taken down offers nothing', async () => {
  // Mutations checked: the button armed before a reason; the reason sent untrimmed; the images list not drawn.
  const m = await mount();
  try {
    await m.press(m.by('deck-report-r1'));
    assert.ok(m.by('deck-report-images'), 'the sheet lists the images the report names');
    const row = m.by(`deck-report-image-${IMG}`);
    assert.ok(row);
    const btn = (scope) => {
      const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
      return walk(scope).find((n) => m.pr(n)['data-testid'] === 'deck-report-takedown-button');
    };
    assert.equal(m.pr(btn(row)).disabled, true, 'no reason, no press');
    const reason = (() => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(row).find((n) => m.pr(n)['data-testid'] === 'deck-report-takedown-reason'); })();
    await m.type(reason, '  Reported as showing a person without consent.  ');
    assert.equal(m.pr(btn(m.by(`deck-report-image-${IMG}`))).disabled, false);
    await m.press(btn(m.by(`deck-report-image-${IMG}`)));
    assert.deepEqual(m.calls.filter((c) => c[0] === 'takedown'), [['takedown', IMG, 'Reported as showing a person without consent.']]);
    assert.match(m.text(m.by(`deck-report-image-${IMG}`)), /Taken down\. Every card that used it shows “Image removed by Axal HQ”/);
    const done = m.by(`deck-report-image-${DONE}`);
    assert.match(m.text(done), /Taken down/);
    assert.equal(btn(done), undefined, 'an image already taken down offers no second takedown');
  } finally { await m.unmount(); }
});
