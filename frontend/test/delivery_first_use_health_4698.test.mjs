// #4698 (Delivery audit 4/6) — Health, exercised by interaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import Zone from '../src/pages/partner/delivery/HealthZone.jsx';
import { stubApi, restoreApi, deferred, mountZone } from './_delivery_zone_harness.mjs';

const eng = (id, name, health, over = {}) => ({
  engagement_id: id, engagement_uid: `e${id}`, founder_name: name, need_title: null, status: 'active', shape: 'project',
  health, health_note: '', health_reasons: [], milestone_count: 0, overdue_count: 0, open_blockers: [],
  deliverables_sent: 0, deliverables_unopened: 0, utilisation_pct: null, scope_state: null, scope_note: null,
  satisfaction: null, satisfaction_source: null, owner_user_id: null, ...over,
});
const BOOK = (over = {}) => ({ items: [eng(1, 'Acme', 'at_risk'), eng(2, 'Birch', 'at_risk')], ...over });
const base = (over = {}) => ({
  getPartnerDeliveryHealth: async () => BOOK(),
  listPartnerPeople: async () => ({ items: [] }),
  listPartnerMilestones: async () => ({ items: [] }),
  listPartnerBlockers: async () => ({ items: [] }),
  listPartnerFounderReviews: async () => ({ items: [] }),
  ...over,
});
const count = (calls, name) => calls.filter(([k]) => k === name).length;

test('saving one engagement does not unmount or reset an unrelated open editor, even while the refetch is out', async () => {
  const refetch = deferred();
  let reads = 0;
  const calls = stubApi(base({
    getPartnerDeliveryHealth: () => { reads += 1; return reads === 1 ? Promise.resolve(BOOK()) : refetch.promise; },
    savePartnerEngagementHealth: async () => ({}),
  }));
  const view = await mountZone(Zone, '/delivery/health');
  try {
    await view.settle();
    await view.press('Record', 0);
    await view.press('Record', 0); // the second Record is now first: both are open
    await view.type('What drifted', 'Typed in Acme, not saved', 0);
    await view.type('What drifted', 'Birch note', 1);
    await view.press('Save', 1);
    await view.settle();
    assert.equal(count(calls, 'savePartnerEngagementHealth'), 1);
    assert.equal(reads, 2);
    assert.equal(view.valueOf('What drifted', 0), 'Typed in Acme, not saved', 'row A kept its text while the read is out');
    assert.equal(view.buttons('Hide').length, 2, 'both editors are still open');
    refetch.resolve(BOOK({ items: [eng(1, 'Acme', 'at_risk'), eng(2, 'Birch', 'at_risk', { scope_note: 'Birch note' })] }));
    await view.settle();
    assert.equal(view.valueOf('What drifted', 0), 'Typed in Acme, not saved', 'row A kept its text when the read landed');
    assert.equal(view.valueOf('What drifted', 1), 'Birch note');
  } finally { await view.unmount(); restoreApi(); }
});

test('a refused facts save keeps the typed values in the open editor and announces it; the retry saves', async () => {
  let n = 0;
  const calls = stubApi(base({
    savePartnerEngagementHealth: async () => { n += 1; if (n === 1) throw new Error('A score needs its source.'); return {}; },
  }));
  const view = await mountZone(Zone, '/delivery/health');
  try {
    await view.settle();
    await view.press('Record', 0);
    await view.type('Satisfaction', '4.5');
    await view.press('Save');
    await view.settle();
    assert.ok(view.alerts().some((t) => t.includes('A score needs its source.')));
    assert.equal(view.valueOf('Satisfaction'), '4.5');
    await view.type('Where they said it', 'review call');
    await view.press('Save');
    await view.settle();
    assert.equal(count(calls, 'savePartnerEngagementHealth'), 2);
    assert.equal(calls.filter(([k]) => k === 'savePartnerEngagementHealth')[1][1][1].satisfaction_source, 'review call');
  } finally { await view.unmount(); restoreApi(); }
});

test('a refused milestone add keeps the title; the retry adds it once and clears the box', async () => {
  let n = 0;
  const calls = stubApi(base({
    createPartnerMilestone: async () => { n += 1; if (n === 1) throw new Error('Milestone refused.'); return {}; },
  }));
  const view = await mountZone(Zone, '/delivery/health');
  try {
    await view.settle();
    await view.press('Record', 0);
    await view.settle();
    await view.type('New milestone', 'Kickoff');
    await view.press('Add', 0);
    await view.settle();
    assert.equal(view.valueOf('New milestone'), 'Kickoff');
    assert.ok(view.alerts().some((t) => t.includes('Milestone refused.')));
    assert.equal(count(calls, 'listPartnerMilestones'), 1, 'a refused write re-reads nothing');
    await view.press('Add', 0);
    await view.settle();
    assert.equal(count(calls, 'createPartnerMilestone'), 2);
    assert.equal(view.valueOf('New milestone'), '');
  } finally { await view.unmount(); restoreApi(); }
});

test('repeated presses on Add blocker send one request, and another engagement is not held up by it', async () => {
  const gate = deferred();
  const calls = stubApi(base({ createPartnerBlocker: () => gate.promise, savePartnerEngagementHealth: async () => ({}) }));
  const view = await mountZone(Zone, '/delivery/health');
  try {
    await view.settle();
    await view.press('Record', 0);
    await view.press('Record', 0);
    await view.settle();
    await view.type('New blocker', 'Waiting on access', 0);
    const add = view.buttons('Add')[1]; // blockers' Add on the first engagement (milestone Add is [0])
    await act(async () => { view.props(add).onClick({}); view.props(add).onClick({}); });
    await view.pressNode(view.buttons('Add')[1]);
    assert.equal(count(calls, 'createPartnerBlocker'), 1);
    assert.equal(view.props(view.buttons('Add')[1])['aria-disabled'], true, 'the pending engagement\'s Add says so');
    assert.equal(view.props(view.buttons('Add')[3])['aria-disabled'], undefined, 'the other engagement\'s Add does not');
    // The second engagement adds its own blocker while the first is still out.
    await view.type('New blocker', 'Waiting on legal', 1);
    await view.pressNode(view.buttons('Add')[3]);
    assert.equal(count(calls, 'createPartnerBlocker'), 2, 'a different engagement is not held up by the pending one');
    await view.press('Save', 1);
    assert.equal(count(calls, 'savePartnerEngagementHealth'), 1);
    gate.resolve({});
    await view.settle();
    assert.equal(count(calls, 'createPartnerBlocker'), 2);
  } finally { await view.unmount(); restoreApi(); }
});

test('a refused blocker add keeps the typed summary', async () => {
  const calls = stubApi(base({ createPartnerBlocker: async () => { throw new Error('Blocker refused.'); } }));
  const view = await mountZone(Zone, '/delivery/health');
  try {
    await view.settle();
    await view.press('Record', 0);
    await view.settle();
    await view.type('New blocker', 'Waiting on access');
    await view.pressNode(view.buttons('Add')[1]);
    await view.settle();
    assert.equal(view.valueOf('New blocker'), 'Waiting on access');
    assert.ok(view.alerts().some((t) => t.includes('Blocker refused.')));
    assert.equal(count(calls, 'createPartnerBlocker'), 1);
  } finally { await view.unmount(); restoreApi(); }
});

test('the selected chip governs the engagement cards and the actions on them', async () => {
  stubApi(base({
    getPartnerDeliveryHealth: async () => BOOK({ items: [eng(1, 'Acme', 'at_risk'), eng(2, 'Birch', 'on_track')] }),
  }));
  const view = await mountZone(Zone, '/delivery/health');
  try {
    await view.settle();
    assert.equal(view.buttons('Record').length, 1, 'At risk shows only the at-risk engagement\'s record action');
    assert.match(view.text(), /Acme/);
  } finally { await view.unmount(); restoreApi(); }
});
