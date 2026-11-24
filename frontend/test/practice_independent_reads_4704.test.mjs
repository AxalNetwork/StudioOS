import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import OpportunitiesZone from '../src/pages/advisor/practice/OpportunitiesZone.jsx';
import EngagementsZone from '../src/pages/advisor/practice/EngagementsZone.jsx';
import DeliveryZone from '../src/pages/advisor/practice/DeliveryZone.jsx';

const never = () => new Promise(() => {});
const page = items => ({ items, page: { offset: 0, limit: 400, total: items.length, next_offset: null } });
const booking = { id: 1, client_user_id: 10, client_name: 'Synthetic request client', topic: 'Synthetic request', status: 'confirmed', slot_starts_at: '2027-01-01T10:00:00Z', created_at: '2026-11-01T10:00:00Z' };
const engagement = { id: 1, client_name: 'Synthetic engagement client', shape: 'retainer', lane: 'drafting', cycles: 0, outcome: null, founder_user_id: null, updated_at: '2026-11-01T10:00:00Z' };
async function fixture(Component, methods) {
  const original = { ...api };
  for (const key of Object.keys(api)) if (typeof api[key] === 'function') api[key] = async () => ({ items: [] });
  Object.assign(api, methods);
  const m = await mountContracts(React.createElement(Component), '/practice', { id: 4704, role: 'advisor' });
  const settle = async () => { for (let n = 0; n < 8; n++) await m.flush(); };
  await settle();
  return { ...m, settle, close: async () => { await m.unmount(); Object.assign(api, original); } };
}

test('request log renders while both service definitions and optional profile are pending', async () => {
  const m = await fixture(OpportunitiesZone, { listMyAdvisorBookings: async () => page([booking]), listMyAdvisorServices: never, getMyAdvisor: never });
  try { assert.match(m.text(), /Synthetic request client/); assert.match(m.text(), /Reading service definitions/); assert.doesNotMatch(m.text(), /No service is defined yet|service definitions could not be read/); }
  finally { await m.close(); }
});

test('failed services do not remove the readable request log or become an empty catalogue', async () => {
  const m = await fixture(OpportunitiesZone, { listMyAdvisorBookings: async () => page([booking]), listMyAdvisorServices: async () => { throw Error('Synthetic service failure'); }, getMyAdvisor: never });
  try { assert.match(m.text(), /Synthetic request client/); assert.match(m.text(), /service definitions could not be read/); assert.doesNotMatch(m.text(), /No service is defined yet/); }
  finally { await m.close(); }
});

test('engagement board renders while bookings and work products remain pending', async () => {
  const m = await fixture(EngagementsZone, { listMyAdvisorEngagements: async () => page([engagement]), listMyAdvisorBookings: never, listMyAdvisorDeliverables: never });
  try { assert.match(m.text(), /Synthetic engagement client/); assert.match(m.text(), /Reading activity/); assert.doesNotMatch(m.text(), /Nobody has booked you yet/); }
  finally { await m.close(); }
});

test('late template reads from an earlier reload cannot replace the latest catalogue', async () => {
  let first, count = 0;
  const m = await fixture(OpportunitiesZone, {
    listMyAdvisorBookings: async () => { if (count++ === 0) throw Error('Synthetic primary failure'); return page([booking]); },
    listMyAdvisorServices: () => count === 1 ? new Promise(resolve => { first = resolve; }) : Promise.resolve({ items: [{ id: 2, title: 'Latest synthetic terms', kind: 'call', price_cents: 0 }] }),
    getMyAdvisor: never,
  });
  try {
    await m.click('Try again'); await m.settle(); assert.match(m.text(), /Latest synthetic terms/);
    first({ items: [{ id: 1, title: 'Obsolete synthetic terms', kind: 'call', price_cents: 0 }] }); await m.settle();
    assert.match(m.text(), /Latest synthetic terms/); assert.doesNotMatch(m.text(), /Obsolete synthetic terms/);
  } finally { await m.close(); }
});

test('the delivery form starts its engagement read even when the work-product list fails', async () => {
  let engagementReads = 0;
  const m = await fixture(DeliveryZone, {
    listMyAdvisorDeliverables: async () => { throw Error('Synthetic delivery failure'); },
    listMyAdvisorEngagements: async () => { engagementReads++; return page([engagement]); },
    listMyAdvisorBookings: never,
  });
  try { assert.equal(engagementReads, 1); assert.match(m.text(), /Synthetic delivery failure/); }
  finally { await m.close(); }
});

test('a pending engagement picker says Reading rather than empty or unavailable', async () => {
  const m = await fixture(DeliveryZone, { listMyAdvisorDeliverables: async () => page([]), listMyAdvisorEngagements: never, listMyAdvisorBookings: never });
  try {
    await m.click('Record a work product'); await m.settle();
    assert.match(m.text(), /Reading engagements/);
    assert.doesNotMatch(m.text(), /Your engagements could not be read|No engagement — type a client below/);
    const picker = m.nodes().find(n => n.tagName === 'SELECT' && m.props(n)?.['aria-busy']); assert.ok(picker && m.props(picker).disabled);
  } finally { await m.close(); }
});
