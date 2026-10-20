/**
 * D792 part 2 (#2270) — Payment details reads the same Stripe customer its
 * "Manage in Stripe" opens. An investor's billing lives on their own customer
 * (`?scope=investor`, `investorPortal`); every other role's on the general one
 * (no scope, `tierPortal`), as `routes/billing.ts` scopes them.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/billing_customer_scope_d792.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PaymentDetailsCard, overviewScopeFor, useBillingReads } from '../src/pages/account/BillingCards.jsx';
import { billingSourceFor } from '../src/pages/account/accountCenterModel.js';

const h = React.createElement;

/** A stub of the two billing calls, recording which customer each one asked for. */
function stubBilling() {
  const calls = [];
  return {
    calls,
    billingOverview: async (scope) => {
      calls.push(['overview', scope]);
      return { has_customer: true, payment_methods: [{ brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028, is_default: true }] };
    },
    tierPortal: async () => { calls.push(['portal', 'tierPortal']); return { url: 'https://billing.stripe.example/general' }; },
    investorPortal: async () => { calls.push(['portal', 'investorPortal']); return { url: 'https://billing.stripe.example/investor' }; },
  };
}
const budget = { mine: async () => ({}), topUp: async () => ({ packs: [] }) };

function Probe({ role, billingApi, navigate }) {
  const reads = useBillingReads({ role, budget, billingApi });
  return h(PaymentDetailsCard, { role, overview: reads.overview, billingApi, navigate });
}

async function mount(element) {
  const restoreDoc = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    async click(id) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ preventDefault() {} }); }); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

test('the overview scope follows the portal the role opens', () => {
  for (const role of ['investor', 'Investor', 'founder', 'partner', 'advisor', '', undefined]) {
    const investor = billingSourceFor(role).portal === 'investorPortal';
    assert.equal(overviewScopeFor(role), investor ? 'investor' : undefined, String(role));
  }
  assert.equal(overviewScopeFor('investor'), 'investor');
  assert.equal(overviewScopeFor('founder'), undefined, 'a founder reads the general customer, with no scope');
});

for (const [role, scope, portal, url] of [
  ['investor', 'investor', 'investorPortal', 'https://billing.stripe.example/investor'],
  ['founder', undefined, 'tierPortal', 'https://billing.stripe.example/general'],
  ['partner', undefined, 'tierPortal', 'https://billing.stripe.example/general'],
]) {
  test(`a ${role}'s Payment details reads and manages one customer`, async () => {
    const billingApi = stubBilling();
    const opened = [];
    const m = await mount(h(Probe, { role, billingApi, navigate: (u) => opened.push(u) }));
    try {
      await m.click('button-manage-card');
      assert.deepEqual(billingApi.calls, [['overview', scope], ['portal', portal]]);
      assert.deepEqual(opened, [url]);
    } finally { await m.unmount(); }
  });
}

test('the Billing page hands its role to the reads, and remounts them when the role changes', () => {
  const src = readFileSync(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /const reads = useBillingReads\(\{ role \}\);/);
  assert.match(src, /<BillingConsole key=\{role\} role=\{role\} billing=\{billing\} \/>/);
});
