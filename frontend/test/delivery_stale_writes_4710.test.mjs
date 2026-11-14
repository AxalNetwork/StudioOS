/** #4710: mount each real Delivery zone against a stale-write API refusal; preserve input and announce the conflict.
 * Complements D5314's Worker tests. These synthetic UI fixtures do not establish cross-firm authorization or delivery.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import Deliverables from '../src/pages/partner/delivery/DeliverablesZone.jsx';
import Capacity from '../src/pages/partner/delivery/CapacityZone.jsx';
import Health from '../src/pages/partner/delivery/HealthZone.jsx';
import Reports from '../src/pages/partner/delivery/StatusReportsZone.jsx';
import { stubApi, restoreApi, mountZone } from './_delivery_zone_harness.mjs';
import { fillsApi } from '../src/lib/api/fills.js';

const sheetRead = fillsApi.sheet;
test.beforeEach(() => { fillsApi.sheet = async () => ({ fields: [] }); });
test.afterEach(() => { fillsApi.sheet = sheetRead; });

const READ = 4, CURRENT = 5;
const ENG = [{ engagement_id: 101, engagement_uid: 'eng-101', founder_id: 203, founder_name: 'Synthetic client' }];
const conflict = () => Object.assign(new Error('The record changed.'), { status: 409, code: 'delivery_changed', data: { current_version: CURRENT } });
const callsOf = (calls, name) => calls.filter(([key]) => key === name).map(([, args]) => args);
const announced = view => {
  assert.ok(view.alerts().some(text => text.includes('Someone changed this') && text.includes('nothing was saved')), 'conflict is an alert, not a success');
  assert.ok(view.buttons('Reload').length > 0);
  assert.ok(view.buttons('Keep my edits').length > 0);
};
const healthRow = { ...ENG[0], status: 'active', shape: 'project', health: 'at_risk', health_note: '', health_reasons: [], milestone_count: 0, overdue_count: 0, open_blockers: [], deliverables_sent: 0, deliverables_unopened: 0, utilisation_pct: null, scope_state: null, scope_note: '', satisfaction: null, satisfaction_source: null, owner_user_id: null, health_revision: READ };
const report = { id: 301, engagement_id: 101, period: '2026-11', state: 'draft', founder_name: 'Synthetic client', shipped: 'Earlier shipped words', next_up: 'Earlier next words', sent_at: null, blockers: [], revision: READ };
const reportBase = extra => ({
  listPartnerStatusReports: async () => ({ items: [report], period: '2026-11', draft_count: 1, sent_this_cycle: 0, blocked_count: 0 }),
  getPartnerDeliveryHealth: async () => ({ items: ENG }),
  getPartnerReportDraft: async () => ({ engagement_id: 101, period: '2026-11', existing: report, shipped_from_log: [], next_from_milestones: [], blocked: [], blocked_note: null }),
  ...extra,
});

test('Deliverables: stale title edit stays open; explicit retry sends the retained draft at the returned revision', async () => {
  const row = { id: 401, engagement_id: 101, founder_name: 'Synthetic client', title: 'Earlier deck', version: 'v1', link_url: 'https://example.test/deck', sent_at: '2026-11-01', days_since_sent: 10, is_unopened: true, opened_at: null, signed_off_at: null, revision: READ };
  const calls = stubApi({
    listPartnerDeliverables: async () => ({ items: [row] }), getPartnerDeliveryHealth: async () => ({ items: ENG }),
    updatePartnerDeliverable: async (_id, data) => { if (data.expected_revision !== CURRENT) throw conflict(); return {}; },
  });
  const view = await mountZone(Deliverables, '/delivery/deliverables');
  try {
    await view.settle(); await view.press('Edit');
    await view.type('Title', 'My unsaved deck'); await view.type('Version', 'v2');
    await view.press('Save'); await view.settle();
    announced(view);
    assert.equal(view.valueOf('Title'), 'My unsaved deck'); assert.equal(view.valueOf('Version'), 'v2');
    assert.equal(callsOf(calls, 'updatePartnerDeliverable').length, 1, 'no automatic overwrite');
    const first = callsOf(calls, 'updatePartnerDeliverable')[0];
    assert.equal(first[0], 401); assert.equal(first[1].expected_revision, READ);
    await view.press('Keep my edits'); await view.settle();
    assert.deepEqual(callsOf(calls, 'updatePartnerDeliverable')[1], [401, { ...first[1], expected_revision: CURRENT }]);
  } finally { await view.unmount(); restoreApi(); }
});

test('Capacity: a stale seat scope keeps the editor and retries the same words at the new revision', async () => {
  const calls = stubApi({
    getPartnerCapacity: async () => ({ people: [{ user_id: 502, name: 'Synthetic holder', live_seats: 1 }], seats: [{ id: 501, engagement_id: 101, founder_name: 'Synthetic client', holder_name: 'Synthetic holder', scope: 'Board', revoked_at: null, granted_at: '2026-11-01', revision: READ }], period: '2026-11', cap_hours: null }),
    listPartnerPeople: async () => ({ items: [] }), getPartnerDeliveryHealth: async () => ({ items: ENG }),
    listPartnerHourEntries: async () => ({ periods: ['2026-11'], entries: [] }),
    updatePartnerSeat: async (_id, data) => { if (data.expected_revision !== CURRENT) throw conflict(); return {}; },
  });
  const view = await mountZone(Capacity, '/delivery/capacity');
  const box = () => view.nodes().find(n => view.props(n)?.id === 'seat-scope-501');
  try {
    await view.settle(); await view.press('Edit scope');
    await act(async () => view.props(box()).onChange({ target: { value: 'Board, KPIs' } }));
    await view.press('Save'); await view.settle(); announced(view);
    assert.equal(view.props(box()).value, 'Board, KPIs');
    assert.deepEqual(callsOf(calls, 'updatePartnerSeat'), [[501, { scope: 'Board, KPIs', expected_revision: READ }]]);
    await view.press('Keep my edits'); await view.settle();
    assert.deepEqual(callsOf(calls, 'updatePartnerSeat')[1], [501, { scope: 'Board, KPIs', expected_revision: CURRENT }]);
  } finally { await view.unmount(); restoreApi(); }
});

test('Health: a stale facts save retains the note and score; explicit retry preserves the payload', async () => {
  const calls = stubApi({
    getPartnerDeliveryHealth: async () => ({ items: [healthRow] }), listPartnerPeople: async () => ({ items: [] }),
    listPartnerMilestones: async () => ({ items: [] }), listPartnerBlockers: async () => ({ items: [] }), listPartnerFounderReviews: async () => ({ items: [] }),
    savePartnerEngagementHealth: async (_id, data) => { if (data.expected_revision !== CURRENT) throw conflict(); return {}; },
  });
  const view = await mountZone(Health, '/delivery/health');
  try {
    await view.settle(); await view.press('Record'); await view.type('What drifted', 'My unsaved scope note');
    await view.type('Satisfaction', '4.5'); await view.type('Where they said it', 'Synthetic review');
    await view.press('Save'); await view.settle(); announced(view);
    assert.equal(view.valueOf('What drifted'), 'My unsaved scope note'); assert.equal(view.valueOf('Satisfaction'), '4.5');
    assert.equal(view.valueOf('Where they said it'), 'Synthetic review');
    const first = callsOf(calls, 'savePartnerEngagementHealth')[0];
    assert.equal(callsOf(calls, 'savePartnerEngagementHealth').length, 1);
    assert.equal(first[0], 101); assert.equal(first[1].expected_revision, READ);
    await view.press('Keep my edits'); await view.settle();
    assert.deepEqual(callsOf(calls, 'savePartnerEngagementHealth')[1], [101, { ...first[1], expected_revision: CURRENT }]);
  } finally { await view.unmount(); restoreApi(); }
});

test('Reports: a stale draft save retains both edited sections and the selected client/period', async () => {
  let current = CURRENT;
  const calls = stubApi(reportBase({ savePartnerStatusReport: async (_id, _period, data) => { if (data.expected_revision !== current) throw conflict(); current += 1; return { ...report, revision: current, shipped: data.shipped, next_up: data.next_up }; } }));
  const view = await mountZone(Reports, '/delivery/status-reports');
  try {
    await view.settle(); await view.press('Edit'); await view.settle();
    await view.type('Shipped', 'My unsaved shipped'); await view.type('Next', 'My unsaved next');
    await view.press('Save draft'); await view.settle(); announced(view);
    assert.equal(view.valueOf('Shipped'), 'My unsaved shipped'); assert.equal(view.valueOf('Next'), 'My unsaved next');
    assert.equal(view.valueOf('Engagement'), '101'); assert.equal(view.valueOf('Period'), '2026-11');
    assert.equal(callsOf(calls, 'savePartnerStatusReport').length, 1);
    const first = callsOf(calls, 'savePartnerStatusReport')[0];
    assert.equal(first[2].expected_revision, READ);
    await view.press('Keep my edits'); await view.settle();
    assert.deepEqual(callsOf(calls, 'savePartnerStatusReport')[1], [101, '2026-11', { ...first[2], expected_revision: CURRENT }]);
    await view.type('Shipped', 'A second edit'); await view.press('Save draft'); await view.settle();
    assert.equal(callsOf(calls, 'savePartnerStatusReport')[2][2].expected_revision, 6, 'a successful save adopts its returned revision');
  } finally { await view.unmount(); restoreApi(); }
});

test('Reports: stale Mark sent states its drawn revision, announces refusal and never claims it was sent', async () => {
  const calls = stubApi(reportBase({ sendPartnerStatusReport: async () => { throw conflict(); } }));
  const view = await mountZone(Reports, '/delivery/status-reports');
  try {
    await view.settle(); await view.press('Mark sent'); await view.settle(); announced(view);
    assert.deepEqual(callsOf(calls, 'sendPartnerStatusReport'), [[301, READ]]);
    assert.ok(view.buttons('Mark sent').length > 0, 'the report remains a draft');
    assert.ok(!view.statuses().some(text => text.includes('Marked sent.')));
    await view.press('Reload'); await view.settle();
    assert.equal(callsOf(calls, 'sendPartnerStatusReport').length, 1, 'Reload reads; it never retries a send');
    assert.ok(callsOf(calls, 'listPartnerStatusReports').length > 1);
  } finally { await view.unmount(); restoreApi(); }
});
