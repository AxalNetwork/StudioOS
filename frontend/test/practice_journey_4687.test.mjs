/**
 * D4687 (#4687): the Practice journey's mounted controls. Each zone is mounted
 * with the Worker client stubbed at the method, so what is asserted is what an
 * advisor can reach on screen:
 *   - Engagements / Delivery first-use buttons reveal their create forms;
 *   - Delivery keeps the held-session review loop with no work product on file;
 *   - Sessions can publish a slot and close a confirmed session (held,
 *     no-show, cancel), with the reason asked in the page.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_journey_4687.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { api } from '../src/lib/api.js';
import EngagementsZone from '../src/pages/advisor/practice/EngagementsZone.jsx';
import DeliveryZone from '../src/pages/advisor/practice/DeliveryZone.jsx';
import SessionsZone from '../src/pages/advisor/practice/SessionsZone.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const none = async () => ({ items: [] });
function stubEverything() {
  globalThis.fetch = async () => { throw new Error('offline'); };
  Object.assign(api, {
    listMyAdvisorEngagements: none, listMyAdvisorDeliverables: none, listMyAdvisorBookings: none,
    listBookingReviews: none, listMyAdvisorSlots: none, getMyAdvisorAvailability: async () => null,
    listMyAdvisorSessionTypes: none, listMyAdvisorBookingLinks: none, listMyAdvisorAccessLog: none,
  });
}
const CONFIRMED = { id: 41, status: 'confirmed', topic: 'First call', founder_name: 'Fran', slot_starts_at: '2037-01-01T10:00:00Z', slot_ends_at: '2037-01-01T11:00:00Z' };

test('Engagements: the empty-state button reveals the create form, and it creates', async () => {
  stubEverything();
  const calls = [];
  api.createMyAdvisorEngagement = async (b) => { calls.push(b); return {}; };
  const m = await mountContracts(React.createElement(EngagementsZone), '/practice/engagements');
  await m.flush();
  assert.ok(!m.text().includes('Add to Drafting'));
  await m.click('Record an engagement');
  assert.ok(m.text().includes('Add to Drafting'), 'the form is on screen');
  await m.fill('Client', 'Meridian Labs');
  await m.click('Add to Drafting');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].client_name, 'Meridian Labs');
  await m.unmount();
});

test('Delivery: the empty-state button reveals the form and the review loop is reachable with no work product', async () => {
  stubEverything();
  api.listMyAdvisorBookings = async (status) => ({ items: status === 'completed' ? [{ id: 7, status: 'completed', topic: 'Held call', founder_name: 'Fran', founder_user_id: 72 }] : [] });
  // #4702: "No review" is only said when the coverage read answered and listed the session.
  api.getMyAdvisorReviewCoverage = async () => ({ held: 1, reviewed: 0, awaiting: 1, ratings: { count: 0, sum: 0 }, items: [{ booking_id: 7, reviews: 0, advisor_filed: false, rating: null }], items_complete: true });
  const calls = [];
  api.createMyAdvisorDeliverable = async (b) => { calls.push(b); return {}; };
  const m = await mountContracts(React.createElement(DeliveryZone), '/practice/delivery');
  await m.flush();
  assert.ok(m.text().includes('Sessions you have held'), 'review loop present');
  assert.ok(m.text().includes('Held call'));
  assert.ok(m.text().includes('No review'));
  assert.ok(!m.text().includes('Add as v1'));
  await m.click('Record a work product');
  assert.ok(m.text().includes('Add as v1'), 'the form is on screen');
  await m.fill('Title', 'Q2 review');
  await m.fill('Client', 'Halverton');
  await m.click('Add as v1');
  assert.equal(calls[0].title, 'Q2 review');
  await m.unmount();
});

test('Sessions: publish availability from the empty state', async () => {
  stubEverything();
  const calls = [];
  api.createAdvisorSlot = async (b) => { calls.push(b); return {}; };
  const m = await mountContracts(React.createElement(SessionsZone), '/practice/sessions');
  await m.flush();
  assert.ok(!m.text().includes('Publish slot'));
  await m.click('Publish availability');
  await m.fill('Starts', '2037-01-01T10:00');
  await m.fill('Ends', '2037-01-01T11:00');
  await m.click('Publish slot');
  assert.equal(calls.length, 1);
  assert.equal(new Date(calls[0].ends_at) > new Date(calls[0].starts_at), true);
  await m.unmount();
});

test('Sessions: a confirmed session can be marked held, and history offers the review', async () => {
  stubEverything();
  let status = 'confirmed';
  api.listMyAdvisorBookings = async () => ({ items: [{ ...CONFIRMED, status }] });
  const done = [];
  api.completeAdvisorBooking = async (id) => { done.push(id); status = 'completed'; return {}; };
  const m = await mountContracts(React.createElement(SessionsZone), '/practice/sessions');
  await m.flush();
  await m.click('Session held');
  await m.flush();
  assert.deepEqual(done, [41]);
  assert.ok(m.text().includes('History'));
  assert.ok(m.text().includes('Review it'));
  await m.unmount();
});

test('Sessions: no-show and cancel ask for a reason in the page, then record', async () => {
  stubEverything();
  api.listMyAdvisorBookings = async () => ({ items: [CONFIRMED] });
  const seen = [];
  api.noShowAdvisorBooking = async (id, r) => { seen.push(['no-show', id, r]); return {}; };
  api.cancelAdvisorBooking = async (id, r) => { seen.push(['cancel', id, r]); return {}; };
  const m = await mountContracts(React.createElement(SessionsZone), '/practice/sessions');
  await m.flush();
  await m.click('No-show');
  await m.fill('Note on the no-show', 'Did not join');
  await m.click('Record no-show');
  await m.click('Cancel session');
  await m.fill('Why you are cancelling', 'Conflict');
  await m.click('Confirm cancellation');
  assert.deepEqual(seen, [['no-show', 41, 'Did not join'], ['cancel', 41, 'Conflict']]);
  await m.unmount();
});

test('Sessions: a failed write says so without the Worker message', async () => {
  stubEverything();
  api.listMyAdvisorBookings = async () => ({ items: [CONFIRMED] });
  api.completeAdvisorBooking = async () => { throw new Error('SQLITE_BOOM internal'); };
  const m = await mountContracts(React.createElement(SessionsZone), '/practice/sessions');
  await m.flush();
  await m.click('Session held');
  assert.ok(m.text().includes('The session is unchanged'));
  assert.ok(!m.text().includes('SQLITE_BOOM'));
  await m.unmount();
});
