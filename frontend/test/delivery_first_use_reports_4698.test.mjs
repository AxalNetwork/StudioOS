// #4698 (Delivery audit 4/6) — Status reports, exercised by interaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import Zone from '../src/pages/partner/delivery/StatusReportsZone.jsx';
import { stubApi, restoreApi, deferred, mountZone } from './_delivery_zone_harness.mjs';

const ENG = [{ engagement_id: 1, founder_name: 'Acme', engagement_uid: 'e1' }, { engagement_id: 2, founder_name: 'Birch', engagement_uid: 'e2' }];
const rep = (id, engagement_id, period, over = {}) => ({
  id, engagement_id, period, state: 'draft', founder_name: engagement_id === 1 ? 'Acme' : 'Birch', shipped: `ship ${id}`, next_up: `next ${id}`, sent_at: null, blockers: [], ...over,
});
const LIST = (items) => ({ items, period: '2026-11', draft_count: 0, sent_this_cycle: 0, blocked_count: 0 });
const draftFor = (engagement_id, period, existing = null) => ({ engagement_id, period, existing, shipped_from_log: [], next_from_milestones: [], blocked: [], blocked_note: null });
const base = (items, over = {}) => ({
  listPartnerStatusReports: async () => LIST(items),
  getPartnerDeliveryHealth: async () => ({ items: ENG }),
  getPartnerReportDraft: async (e, p) => draftFor(Number(e), p, items.find((r) => r.engagement_id === Number(e) && r.period === p) || null),
  ...over,
});
const count = (calls, name) => calls.filter(([k]) => k === name).length;
const edits = (view) => view.nodes().filter((n) => n.tagName === 'BUTTON' && view.props(n)['aria-label']?.startsWith('Edit the '));

test('Edit opens the exact selected report, not whatever the composer held', async () => {
  const calls = stubApi(base([rep(1, 1, '2026-11'), rep(2, 2, '2026-11')]));
  const view = await mountZone(Zone, '/delivery/status-reports');
  try {
    await view.settle();
    const second = edits(view)[1];
    assert.match(view.props(second)['aria-label'], /Birch/);
    await view.pressNode(second);
    await view.settle();
    const asked = calls.filter(([k]) => k === 'getPartnerReportDraft');
    assert.deepEqual(asked.at(-1)[1], [2, '2026-11']);
    assert.equal(view.valueOf('Engagement'), '2');
    assert.equal(view.valueOf('Shipped'), 'ship 2', 'the Shipped box holds that report\'s own words');
    // And a different report next: the pair follows the card pressed.
    await view.pressNode(edits(view)[0]);
    await view.settle();
    assert.deepEqual(calls.filter(([k]) => k === 'getPartnerReportDraft').at(-1)[1], [1, '2026-11']);
    assert.equal(view.valueOf('Shipped'), 'ship 1');
  } finally { await view.unmount(); restoreApi(); }
});

test('Edit on an older period composes that period once its chip is chosen', async () => {
  const old = [rep(1, 1, '2026-09')];
  const calls = stubApi(base(old));
  const view = await mountZone(Zone, '/delivery/status-reports');
  try {
    await view.settle();
    assert.equal(edits(view).length, 0, 'the current-cycle chip hides it, and so hides its actions');
    await view.press('Archive');
    await view.settle();
    assert.equal(edits(view).length, 1);
    await view.pressNode(edits(view)[0]);
    await view.settle();
    assert.deepEqual(calls.filter(([k]) => k === 'getPartnerReportDraft').at(-1)[1], [1, '2026-09']);
    assert.equal(view.valueOf('Period'), '2026-09');
  } finally { await view.unmount(); restoreApi(); }
});

test('the selected chip governs the reports and the actions on them', async () => {
  const items = [rep(1, 1, '2026-11'), rep(2, 2, '2026-10'), rep(3, 1, '2026-10', { state: 'sent', sent_at: '2026-10-30' })];
  stubApi(base(items));
  const view = await mountZone(Zone, '/delivery/status-reports');
  try {
    await view.settle();
    assert.equal(view.buttons('Mark sent').length, 1, 'only the current cycle\'s draft carries Mark sent');
    assert.equal(view.buttons('Discard draft').length, 1);
    assert.equal(edits(view).length, 1);
  } finally { await view.unmount(); restoreApi(); }
});

test('a refused Save draft keeps the words, announces it, and the retry saves; repeated presses send one request', async () => {
  const gate = deferred();
  let n = 0;
  const calls = stubApi(base([], {
    savePartnerStatusReport: () => { n += 1; if (n === 1) return Promise.reject(new Error('Not saved.')); return gate.promise; },
  }));
  const view = await mountZone(Zone, '/delivery/status-reports');
  try {
    await view.settle();
    await view.press('Compose one');
    await view.type('Engagement', '1');
    await view.press('Compose from the record');
    await view.settle();
    await view.type('Shipped', 'The words I wrote');
    await view.press('Save draft');
    await view.settle();
    assert.equal(view.valueOf('Shipped'), 'The words I wrote');
    assert.ok(view.alerts().some((t) => t.includes('Not saved.')));
    const node = view.buttons('Save draft')[0];
    await act(async () => { view.props(node).onClick({}); view.props(node).onClick({}); });
    await view.pressNode(view.buttons('Saving…')[0]);
    assert.equal(count(calls, 'savePartnerStatusReport'), 2, 'one refused, one in flight');
    gate.resolve({ id: 4 });
    await view.settle();
    assert.equal(count(calls, 'savePartnerStatusReport'), 2);
    assert.ok(view.statuses().some((t) => t.includes('Draft saved.')));
  } finally { await view.unmount(); restoreApi(); }
});

test('marking one report sent does not unmount or reset the open composer, and repeated presses send once', async () => {
  const refetch = deferred();
  const gate = deferred();
  let reads = 0;
  const calls = stubApi(base([rep(1, 1, '2026-11')], {
    listPartnerStatusReports: () => { reads += 1; return reads === 1 ? Promise.resolve(LIST([rep(1, 1, '2026-11')])) : refetch.promise; },
    sendPartnerStatusReport: () => gate.promise,
  }));
  const view = await mountZone(Zone, '/delivery/status-reports');
  try {
    await view.settle();
    await view.press('Compose a report');
    await view.type('Engagement', '2');
    await view.press('Compose from the record');
    await view.settle();
    await view.type('Shipped', 'half-written');
    const send = view.buttons('Mark sent')[0];
    await act(async () => { view.props(send).onClick({}); view.props(send).onClick({}); });
    await view.pressNode(view.buttons('Marking…')[0]);
    assert.equal(count(calls, 'sendPartnerStatusReport'), 1);
    gate.resolve({});
    await view.settle();
    assert.equal(reads, 2);
    assert.equal(view.valueOf('Shipped'), 'half-written', 'the composer survived the send and the pending refetch');
    refetch.resolve(LIST([rep(1, 1, '2026-11', { state: 'sent', sent_at: '2026-11-02' })]));
    await view.settle();
    assert.equal(view.valueOf('Shipped'), 'half-written');
  } finally { await view.unmount(); restoreApi(); }
});

test('a refused Mark sent is announced and the report stays a draft', async () => {
  const calls = stubApi(base([rep(1, 1, '2026-11')], { sendPartnerStatusReport: async () => { throw new Error('Could not mark it.'); } }));
  const view = await mountZone(Zone, '/delivery/status-reports');
  try {
    await view.settle();
    await view.press('Mark sent');
    await view.settle();
    assert.ok(view.alerts().some((t) => t.includes('Could not mark it.')));
    assert.equal(view.buttons('Mark sent').length, 1);
    assert.equal(count(calls, 'sendPartnerStatusReport'), 1);
  } finally { await view.unmount(); restoreApi(); }
});
