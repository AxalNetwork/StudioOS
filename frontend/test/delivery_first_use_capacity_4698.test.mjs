// #4698 (Delivery audit 4/6) — Capacity, exercised by interaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import Zone from '../src/pages/partner/delivery/CapacityZone.jsx';
import { stubApi, restoreApi, deferred, mountZone } from './_delivery_zone_harness.mjs';

const ENG = [{ engagement_id: 1, founder_name: 'Acme', engagement_uid: 'e1' }];
const PEOPLE = { items: [{ user_id: 5, name: 'Dana', email: 'd@example.com' }] };
const EMPTY = { people: [], seats: [], period: '2026-11', cap_hours: null };
const base = (over = {}) => ({
  getPartnerCapacity: async () => EMPTY,
  listPartnerPeople: async () => PEOPLE,
  getPartnerDeliveryHealth: async () => ({ items: ENG }),
  listPartnerHourEntries: async () => ({ periods: ['2026-11'], entries: [] }),
  ...over,
});
const count = (calls, name) => calls.filter(([k]) => k === name).length;

test('a firm can open and save its first seat from the empty state', async () => {
  const calls = stubApi(base({ grantPartnerSeat: async () => ({ id: 1 }) }));
  const view = await mountZone(Zone, '/delivery/capacity');
  try {
    await view.settle();
    assert.match(view.text(), /No seat granted and no hours logged/);
    await view.press('Grant a seat');
    await view.type('Engagement', '1');
    await view.type('Who holds it', '5');
    await view.type('Scope', 'Board');
    await view.press('Record the seat');
    await view.settle();
    const g = calls.filter(([k]) => k === 'grantPartnerSeat');
    assert.equal(g.length, 1);
    assert.deepEqual(g[0][1], ['1', { holder_user_id: 5, scope: 'Board' }]);
    assert.equal(view.buttons('Record the seat').length, 0, 'closed after the confirmed save');
    assert.ok(view.statuses().some((t) => t.includes('Seat recorded.')));
  } finally { await view.unmount(); restoreApi(); }
});

test('a refused seat keeps the chosen engagement, holder and scope; the retry succeeds', async () => {
  let n = 0;
  const calls = stubApi(base({ grantPartnerSeat: async () => { n += 1; if (n === 1) throw new Error('That person is not on this firm.'); return { id: 1 }; } }));
  const view = await mountZone(Zone, '/delivery/capacity');
  try {
    await view.settle();
    await view.press('Grant a seat');
    await view.type('Engagement', '1');
    await view.type('Who holds it', '5');
    await view.type('Scope', 'prod read-only');
    await view.press('Record the seat');
    await view.settle();
    assert.ok(view.alerts().some((t) => t.includes('That person is not on this firm.')));
    assert.equal(view.valueOf('Scope'), 'prod read-only');
    assert.equal(view.valueOf('Who holds it'), '5');
    assert.equal(view.valueOf('Engagement'), '1');
    await view.press('Record the seat');
    await view.settle();
    assert.equal(count(calls, 'grantPartnerSeat'), 2);
    assert.equal(view.buttons('Record the seat').length, 0);
  } finally { await view.unmount(); restoreApi(); }
});

test('the first capacity record, the firm cap, can be saved from the empty state, and a refusal keeps it', async () => {
  let n = 0;
  const calls = stubApi(base({ setPartnerCapacityCap: async () => { n += 1; if (n === 1) throw new Error('Cap refused.'); return {}; } }));
  const view = await mountZone(Zone, '/delivery/capacity');
  try {
    await view.settle();
    await view.type('Hours a week', '37.5');
    await view.press('Save cap');
    await view.settle();
    assert.equal(view.valueOf('Hours a week'), '37.5');
    assert.ok(view.alerts().some((t) => t.includes('Cap refused.')));
    await view.press('Save cap');
    await view.settle();
    assert.equal(count(calls, 'setPartnerCapacityCap'), 2);
    assert.equal(calls.filter(([k]) => k === 'setPartnerCapacityCap')[1][1][0].weekly_hours, 37.5);
    assert.equal(view.valueOf('Hours a week'), '', 'reset only after the confirmed save');
  } finally { await view.unmount(); restoreApi(); }
});

test('client hours can be logged from the empty state', async () => {
  const calls = stubApi(base({ savePartnerHours: async () => ({}) }));
  const view = await mountZone(Zone, '/delivery/capacity');
  try {
    await view.settle();
    await view.type('Engagement', '1', 0);
    await view.type('Person', '5', 1);
    await view.type('Hours', '32', 0);
    await view.press('Log');
    await view.settle();
    assert.equal(count(calls, 'savePartnerHours'), 1);
  } finally { await view.unmount(); restoreApi(); }
});

test('repeated presses on Record the seat send one request', async () => {
  const gate = deferred();
  const calls = stubApi(base({ grantPartnerSeat: () => gate.promise }));
  const view = await mountZone(Zone, '/delivery/capacity');
  try {
    await view.settle();
    await view.press('Grant a seat');
    await view.type('Engagement', '1');
    await view.type('Who holds it', '5');
    const node = view.buttons('Record the seat')[0];
    await act(async () => { view.props(node).onClick({}); view.props(node).onClick({}); });
    await view.pressNode(view.buttons('Recording…')[0]);
    assert.equal(count(calls, 'grantPartnerSeat'), 1);
    gate.resolve({ id: 1 });
    await view.settle();
    assert.equal(count(calls, 'grantPartnerSeat'), 1);
  } finally { await view.unmount(); restoreApi(); }
});

test('a refused scope edit keeps the typed scope open until a save is confirmed', async () => {
  let n = 0;
  const seat = (id, who) => ({ id, holder_name: who, founder_name: 'Acme', scope: 'Board', revoked_at: null, granted_at: '2026-10-01' });
  const calls = stubApi(base({
    getPartnerCapacity: async () => ({ ...EMPTY, seats: [seat(1, 'Dana'), seat(2, 'Eli')], people: [{ user_id: 5, name: 'Dana', live_seats: 1 }] }),
    updatePartnerSeat: async () => { n += 1; if (n === 1) throw new Error('Scope refused.'); return {}; },
  }));
  const view = await mountZone(Zone, '/delivery/capacity');
  try {
    await view.settle();
    await view.press('Edit scope', 0);
    const box = () => view.nodes().find((n) => n.tagName === 'INPUT' && n.id === 'seat-scope-1' || view.props(n)?.id === 'seat-scope-1');
    await act(async () => { view.props(box()).onChange({ target: { value: 'Board, KPIs' } }); });
    await view.press('Save');
    await view.settle();
    assert.equal(view.props(box()).value, 'Board, KPIs', 'the scope editor stays open with the typed value');
    await view.press('Save');
    await view.settle();
    assert.equal(count(calls, 'updatePartnerSeat'), 2);
    assert.equal(view.buttons('Save').length, 0);
  } finally { await view.unmount(); restoreApi(); }
});

test('a save refetches in the background: the half-typed hours form survives the read', async () => {
  const refetch = deferred();
  let reads = 0;
  stubApi(base({
    getPartnerCapacity: () => { reads += 1; return reads === 1 ? Promise.resolve(EMPTY) : refetch.promise; },
    setPartnerCapacityCap: async () => ({}),
  }));
  const view = await mountZone(Zone, '/delivery/capacity');
  try {
    await view.settle();
    await view.type('Why this number', 'four days');
    await view.type('Hours a week', '32');
    await view.press('Save cap');
    await view.type('Hours', '12', 1); // internal hours: a different, unrelated field typed while the read is out
    assert.equal(reads, 2);
    assert.equal(view.valueOf('Hours', 1), '12', 'still mounted and editable while the refetch is pending');
    refetch.resolve(EMPTY);
    await view.settle();
    assert.equal(view.valueOf('Hours', 1), '12');
  } finally { await view.unmount(); restoreApi(); }
});

test('a save keeps the client-hours table on screen while it re-reads', async () => {
  const again = deferred();
  let reads = 0;
  const entry = { engagement_id: 1, person_user_id: 5, client: 'Acme', person_name: 'Dana', hours: { '2026-11': 12 } };
  stubApi(base({
    listPartnerHourEntries: () => { reads += 1; return reads === 1 ? Promise.resolve({ periods: ['2026-11'], entries: [entry] }) : again.promise; },
    setPartnerCapacityCap: async () => ({}),
  }));
  const view = await mountZone(Zone, '/delivery/capacity');
  try {
    await view.settle();
    assert.match(view.text(), /Acme/);
    await view.type('Hours a week', '30');
    await view.press('Save cap');
    assert.equal(reads, 2);
    assert.match(view.text(), /Acme/, 'the table is not replaced by Loading hours while the read is out');
    assert.doesNotMatch(view.text(), /Loading hours/);
    again.resolve({ periods: ['2026-11'], entries: [entry] });
    await view.settle();
  } finally { await view.unmount(); restoreApi(); }
});

test('the Next week chip re-reads the next period and keeps the forms mounted', async () => {
  const calls = stubApi(base());
  const view = await mountZone(Zone, '/delivery/capacity');
  try {
    await view.settle();
    await view.type('Why this number', 'typed before switching');
    await view.press('Next week');
    await view.settle();
    const periods = calls.filter(([k]) => k === 'getPartnerCapacity').map(([, a]) => a[0]);
    assert.equal(periods.length, 2);
    assert.match(periods[1], /^\d{4}-\d{2}$/);
    assert.equal(view.valueOf('Why this number'), 'typed before switching');
  } finally { await view.unmount(); restoreApi(); }
});
