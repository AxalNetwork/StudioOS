// #4698 (Delivery audit 4/6) — Deliverables, exercised by interaction: the zone
// is rendered for real against a stubbed client and driven the way a person does.
import test from 'node:test';
import assert from 'node:assert/strict';
import Zone from '../src/pages/partner/delivery/DeliverablesZone.jsx';
import { stubApi, restoreApi, deferred, mountZone, walk } from './_delivery_zone_harness.mjs';

const ENG = [{ engagement_id: 1, founder_name: 'Acme', engagement_uid: 'e1' }, { engagement_id: 2, founder_name: 'Birch', engagement_uid: 'e2' }];
const row = (id, over = {}) => ({ id, engagement_id: 1, title: `Deck ${id}`, version: '', link_url: '', sent_at: '2026-10-01', opened_at: null, signed_off_at: null, days_since_sent: 30, founder_name: 'Acme', is_unopened: true, ...over });

test('a firm with engagements and an empty log can log its first deliverable from the empty state', async () => {
  const calls = stubApi({
    listPartnerDeliverables: async () => ({ items: [] }),
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
    createPartnerDeliverable: async () => ({ id: 9 }),
  });
  const view = await mountZone(Zone, '/delivery/deliverables');
  try {
    await view.settle();
    assert.match(view.text(), /Nothing logged yet/);
    await view.press('Log a deliverable');
    await view.type('Engagement', '1');
    await view.type('Title', 'First deck');
    await view.press('Log it');
    await view.settle();
    const create = calls.filter(([k]) => k === 'createPartnerDeliverable');
    assert.equal(create.length, 1);
    assert.equal(create[0][1][0], '1');
    assert.equal(create[0][1][1].title, 'First deck');
  } finally { await view.unmount(); restoreApi(); }
});

test('a refused create keeps what was typed, announces the refusal, and the retry succeeds', async () => {
  let n = 0;
  const calls = stubApi({
    listPartnerDeliverables: async () => ({ items: [] }),
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
    createPartnerDeliverable: async () => { n += 1; if (n === 1) throw new Error('The store refused that.'); return { id: 9 }; },
  });
  const view = await mountZone(Zone, '/delivery/deliverables');
  try {
    await view.settle();
    await view.press('Log a deliverable');
    await view.type('Engagement', '2');
    await view.type('Title', 'Keep me');
    await view.type('Version', 'v2');
    await view.press('Log it');
    await view.settle();
    assert.ok(view.alerts().some((t) => t.includes('The store refused that.')), 'the refusal is announced as an alert');
    assert.equal(view.valueOf('Title'), 'Keep me');
    assert.equal(view.valueOf('Version'), 'v2');
    assert.equal(view.valueOf('Engagement'), '2');
    await view.press('Log it');
    await view.settle();
    assert.equal(calls.filter(([k]) => k === 'createPartnerDeliverable').length, 2);
    assert.equal(view.buttons('Log it').length, 0, 'the form closes once the save is confirmed');
    assert.ok(view.statuses().some((t) => t.includes('Logged.')), 'the success is announced as a status');
  } finally { await view.unmount(); restoreApi(); }
});

test('repeated presses while a create is out send one request', async () => {
  const gate = deferred();
  const calls = stubApi({
    listPartnerDeliverables: async () => ({ items: [] }),
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
    createPartnerDeliverable: () => gate.promise,
  });
  const view = await mountZone(Zone, '/delivery/deliverables');
  try {
    await view.settle();
    await view.press('Log a deliverable');
    await view.type('Engagement', '1');
    await view.type('Title', 'Once');
    // Two presses in the SAME tick, then a third after the render.
    const node = view.buttons('Log it')[0];
    const { act } = await import('react');
    await act(async () => { view.props(node).onClick({}); view.props(node).onClick({}); });
    await view.pressNode(view.buttons('Logging…')[0]);
    assert.equal(calls.filter(([k]) => k === 'createPartnerDeliverable').length, 1);
    gate.resolve({ id: 1 });
    await view.settle();
    assert.equal(calls.filter(([k]) => k === 'createPartnerDeliverable').length, 1);
  } finally { await view.unmount(); restoreApi(); }
});

test('a refused edit keeps the open editor and its values; a confirmed one closes it', async () => {
  let n = 0;
  const calls = stubApi({
    listPartnerDeliverables: async () => ({ items: [row(1)] }),
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
    updatePartnerDeliverable: async () => { n += 1; if (n === 1) throw new Error('No.'); return {}; },
  });
  const view = await mountZone(Zone, '/delivery/deliverables');
  try {
    await view.settle();
    await view.press('Edit');
    await view.type('Title', 'Renamed');
    await view.press('Save');
    await view.settle();
    assert.equal(view.valueOf('Title'), 'Renamed', 'the typed title is still in the open editor');
    assert.ok(view.alerts().some((t) => t.includes('No.')));
    await view.press('Save');
    await view.settle();
    assert.equal(calls.filter(([k]) => k === 'updatePartnerDeliverable').length, 2);
    assert.equal(view.buttons('Save').length, 0, 'closed after the confirmed save');
  } finally { await view.unmount(); restoreApi(); }
});

test('saving one row does not unmount or reset an unrelated open editor while the refetch is out', async () => {
  const refetch = deferred();
  let reads = 0;
  stubApi({
    listPartnerDeliverables: () => { reads += 1; return reads === 1 ? Promise.resolve({ items: [row(1), row(2, { title: 'Other' })] }) : refetch.promise; },
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
    updatePartnerDeliverable: async () => ({}),
  });
  const view = await mountZone(Zone, '/delivery/deliverables');
  try {
    await view.settle();
    await view.press('Edit', 0);
    await view.press('Edit', 0);
    // Rows are ordered oldest-first with ties kept; both editors are open.
    await view.type('Title', 'Draft in row A', 0);
    await view.type('Title', 'Draft in row B', 1);
    await view.press('Save', 1);
    await view.settle();
    assert.equal(reads, 2, 'the save triggered a refetch');
    // Refetch still pending: the page is not a skeleton and row A keeps its text.
    assert.equal(view.valueOf('Title', 0), 'Draft in row A');
    refetch.resolve({ items: [row(1), row(2, { title: 'Draft in row B' })] });
    await view.settle();
    assert.equal(view.valueOf('Title', 0), 'Draft in row A', 'row A survived the refetch landing');
  } finally { await view.unmount(); restoreApi(); }
});

test('a failed refetch after a save keeps the rows and says the figures may be stale', async () => {
  let reads = 0;
  stubApi({
    listPartnerDeliverables: () => { reads += 1; return reads === 1 ? Promise.resolve({ items: [row(1)] }) : Promise.reject(new Error('Offline.')); },
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
    updatePartnerDeliverable: async () => ({}),
  });
  const view = await mountZone(Zone, '/delivery/deliverables');
  try {
    await view.settle();
    await view.press('Edit');
    await view.press('Save');
    await view.settle();
    assert.match(view.text(), /Deck 1/, 'the populated log stays on screen');
    assert.ok(view.alerts().some((t) => /could not be refreshed/.test(t)));
  } finally { await view.unmount(); restoreApi(); }
});

test('an unreadable store never offers the log form', async () => {
  stubApi({
    listPartnerDeliverables: async () => { throw new Error('Store down.'); },
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
  });
  const view = await mountZone(Zone, '/delivery/deliverables');
  try {
    await view.settle();
    assert.match(view.text(), /This did not load/);
    assert.equal(view.buttons('Log a deliverable').length, 0);
    assert.doesNotMatch(view.text(), /Nothing logged yet/);
  } finally { await view.unmount(); restoreApi(); }
});
