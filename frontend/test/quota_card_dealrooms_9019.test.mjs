/**
 * #9019 — QuotaCard shows deal rooms used as Unavailable, never "0 / N", when
 * the Worker could not read the count (`quotas.dealroom_used: null`) or the
 * billing read itself failed. A readable count still draws its bar.
 * Rendered the way LockedPreview and PaywallModal render it: an investor
 * user, no other props.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/quota_card_dealrooms_9019.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import QuotaCard from '../src/components/QuotaCard.jsx';

const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

const status = (dealroomUsed) => ({
  tier: 'professional',
  quotas: { intros_per_quarter: 10, intros_used: 2, dealroom_max: 5, dealroom_used: dealroomUsed, seats: 1, seat_count: 0 },
});
const INTROS = { tier: 'professional', used: 2, cap: 10 };

async function mount({ billing, intros = async () => INTROS }) {
  const restore = installDocument();
  const original = { b: api.investorBillingStatus, i: api.introductionsQuota };
  api.investorBillingStatus = billing;
  api.introductionsQuota = intros;
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, null,
    React.createElement(QuotaCard, { user: { role: 'investor' } }))));
  return {
    container,
    async done() {
      await act(async () => root.unmount());
      api.investorBillingStatus = original.b; api.introductionsQuota = original.i;
      restore();
    },
  };
}

test('#9019: a deal-room count the Worker could not read is Unavailable, not 0 of the cap', async () => {
  const w = await mount({ billing: async () => status(null) });
  try {
    const row = byId(w.container, 'quota-card-dealrooms');
    // Mutation checked: `?? 0` back on dealroom_used → the row reads "Active deal rooms0 / 5".
    assert.ok(row, 'the deal-room row is drawn');
    assert.equal(text(row), 'Active deal roomsUnavailable');
    assert.doesNotMatch(text(w.container), /0 \/ 5/);
    // The intro row is unchanged by a missing deal-room count.
    assert.match(text(w.container), /Warm intros \/ quarter2 \/ 10/);
  } finally { await w.done(); }
});

test('#9019: a failed billing read is Unavailable for deal rooms too', async () => {
  const w = await mount({ billing: async () => { throw new Error('status read failed'); } });
  try {
    // Mutation checked: show Unavailable only for an explicit null → an absent billing read draws "0 / 1".
    assert.equal(text(byId(w.container, 'quota-card-dealrooms')), 'Active deal roomsUnavailable');
  } finally { await w.done(); }
});

test('#9019: a readable count, 0 included, still draws its bar', async () => {
  for (const [used, shown] of [[3, '3 / 5'], [0, '0 / 5']]) {
    const w = await mount({ billing: async () => status(used) });
    try {
      // Mutation checked: treat 0 as unknown (a falsy check) → a measured 0 reads Unavailable.
      assert.equal(text(byId(w.container, 'quota-card-dealrooms')), `Active deal rooms${shown}`, String(used));
    } finally { await w.done(); }
  }
});

test('#9019: before the reads settle, no deal-room figure is drawn', async () => {
  let release;
  const w = await mount({ billing: () => new Promise((r) => { release = r; }), intros: () => new Promise(() => {}) });
  try {
    // Mutation checked: draw the Unavailable row before the reads settle → it is drawn while loading.
    assert.equal(byId(w.container, 'quota-card-dealrooms'), undefined);
  } finally { release?.(status(1)); await w.done(); }
});
