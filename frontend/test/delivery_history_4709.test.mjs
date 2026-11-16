/** #4709 (D4709): the Delivery zones reach a history longer than one page, say when they show part of it,
 * correct a sent deliverable with a reason, and show a sent report's own blockers and its amendments.
 * Real zones against a stubbed client (`_delivery_zone_harness.mjs`); synthetic fixtures only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Deliverables, { changesSentFields } from '../src/pages/partner/delivery/DeliverablesZone.jsx';
import Reports, { reportBlockerLine } from '../src/pages/partner/delivery/StatusReportsZone.jsx';
import Board from '../src/pages/partner/delivery/BoardZone.jsx';
import { stubApi as stubClient, restoreApi, mountZone } from './_delivery_zone_harness.mjs';
import { fillsApi } from '../src/lib/api/fills.js';
import { partnerDeliveryHistoryApi } from '../src/lib/api/partnerDeliveryHistory.js';

const sheetRead = fillsApi.sheet;
const historyRead = { ...partnerDeliveryHistoryApi };
test.beforeEach(() => { fillsApi.sheet = async () => ({ fields: [] }); });
test.afterEach(() => { fillsApi.sheet = sheetRead; Object.assign(partnerDeliveryHistoryApi, historyRead); });

/** The harness stubs `api`; the page reads and the amendment live on their own module (D527), stubbed the same way. */
function stubApi(answers) {
  const calls = stubClient(answers);
  for (const k of Object.keys(historyRead)) {
    partnerDeliveryHistoryApi[k] = (...a) => { calls.push([k, a]); return (answers[k] || (() => new Promise(() => {})))(...a); };
  }
  return calls;
}

const ENG = [{ engagement_id: 101, engagement_uid: 'eng-101', founder_id: 203, founder_name: 'Synthetic client' }];
const callsOf = (calls, name) => calls.filter(([key]) => key === name).map(([, args]) => args);
const deliverable = (id, over = {}) => ({
  id, engagement_id: 101, founder_name: 'Synthetic client', title: `Deck ${id}`, version: 'v1',
  link_url: 'https://example.test/deck', sent_at: '2026-10-01', days_since_sent: 40, is_unopened: true,
  opened_at: null, signed_off_at: null, revision: 2, corrections: [], ...over,
});
const pager = (view) => view.nodes().find((n) => view.props(n)?.['data-testid'] === 'history-pager');

test('the log says it shows part of the book, loads the rest, and keeps the rows when a later page fails', async () => {
  let fail = true;
  const calls = stubApi({
    listPartnerDeliverables: async () => ({
      items: [deliverable(3)], sent_count: 3, unopened_count: 3, signed_off_count: 0,
      page: { limit: 1, returned: 1, total: 3, next_cursor: 'c1', complete: false },
    }),
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
    partnerDeliverablesPage: async ({ cursor }) => {
      if (fail) { fail = false; throw new Error('Store down.'); }
      return cursor === 'c1'
        ? { items: [deliverable(2)], page: { limit: 1, returned: 1, total: 3, next_cursor: 'c2', complete: false } }
        : { items: [deliverable(1)], page: { limit: 1, returned: 1, total: 3, next_cursor: null, complete: false } };
    },
  });
  const view = await mountZone(Deliverables, '/delivery/deliverables');
  try {
    await view.settle();
    assert.equal(view.props(pager(view))['data-state'], 'paginated');
    assert.match(view.text(), /Showing 1 of 3 deliverables\./);

    // A later page that cannot be read: the shown row stays, and the note says the rest is missing.
    await view.press('Load more'); await view.settle();
    assert.equal(view.props(pager(view))['data-state'], 'partial');
    assert.ok(view.alerts().some((t) => t.includes('The rest of the deliverables could not be read') && t.includes('2 more are not shown')));
    assert.match(view.text(), /Deck 3/);

    await view.press('Retry'); await view.settle();
    assert.match(view.text(), /Showing 2 of 3 deliverables\./);
    await view.press('Load more'); await view.settle();
    assert.deepEqual(callsOf(calls, 'partnerDeliverablesPage').map(([o]) => o.cursor), ['c1', 'c1', 'c2']);
    assert.match(view.text(), /All 3 deliverables shown\./);
    for (const t of ['Deck 1', 'Deck 2', 'Deck 3']) assert.match(view.text(), new RegExp(t));
  } finally { await view.unmount(); restoreApi(); }
});

test('the strip counts the book the Worker counted, not the rows loaded', async () => {
  stubApi({
    listPartnerDeliverables: async () => ({
      items: [deliverable(9)], sent_count: 412, unopened_count: 37, signed_off_count: 120,
      shipped_31d_count: 18, shipped_31d_clients: 6,
      page: { limit: 1, returned: 1, total: 412, next_cursor: 'c', complete: false },
    }),
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
  });
  const view = await mountZone(Deliverables, '/delivery/deliverables');
  try {
    await view.settle();
    const text = view.text();
    assert.match(text, /Never opened\s*37/);
    assert.match(text, /Signed off\s*120/);
    assert.match(text, /Shipped this month\s*18/);
    assert.match(text, /across 6 clients/);
  } finally { await view.unmount(); restoreApi(); }
});

test('a sent deliverable is corrected with a reason, shows what it replaced, and offers no Delete', async () => {
  const sent = deliverable(5, {
    corrections: [{ id: 1, revision: 1, reason: 'Wrong file', corrected_by_name: 'Sam', corrected_at: '2026-10-03T00:00:00Z',
      was: { title: 'Deck 5', version: 'v0', link_url: 'https://example.test/old', sent_at: '2026-10-01' } }],
  });
  const draft = deliverable(6, { sent_at: null, days_since_sent: null, is_unopened: false, title: 'Draft 6' });
  const calls = stubApi({
    listPartnerDeliverables: async () => ({ items: [sent, draft] }),
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
    updatePartnerDeliverable: async () => ({}),
  });
  const view = await mountZone(Deliverables, '/delivery/deliverables');
  try {
    await view.settle();
    await view.press('All');
    await view.settle();
    assert.match(view.text(), /Corrected once since it was sent/);
    assert.match(view.text(), /Sam/);
    assert.match(view.text(), /“Wrong file”/);

    await view.press('Edit', 0);
    assert.equal(view.buttons('Delete').length, 0, 'a sent deliverable is never offered for deletion');
    assert.match(view.text(), /Sent deliverables are records, not deletable rows\./);
    await view.type('Title', 'Deck 5, renamed');
    const save = view.buttons('Save')[0];
    assert.equal(view.props(save)['aria-disabled'], true, 'no correction without a reason');
    await view.press('Save'); await view.settle();
    assert.equal(callsOf(calls, 'updatePartnerDeliverable').length, 0);

    await view.type('Why is it being corrected', 'Client asked for the new name');
    await view.press('Save'); await view.settle();
    const [[id, body]] = callsOf(calls, 'updatePartnerDeliverable');
    assert.equal(id, 5);
    assert.equal(body.title, 'Deck 5, renamed');
    assert.equal(body.correction_reason, 'Client asked for the new name');
    assert.equal(view.buttons('Save').length, 0, 'the editor closed on the confirmed correction');

    // The unsent one is a draft: no reason asked, and Delete is there.
    await view.press('Edit', 1);
    assert.equal(view.buttons('Delete').length, 1);
  } finally { await view.unmount(); restoreApi(); }
});

test('changesSentFields: only the four things the client was handed count', () => {
  const row = { title: 'A', version: 'v1', link_url: 'https://x.test', sent_at: '2026-10-01', founder_name: 'X' };
  assert.equal(changesSentFields(row, { ...row }), false);
  assert.equal(changesSentFields(row, { ...row, founder_name: 'Y' }), false);
  assert.equal(changesSentFields(row, { ...row, title: ' A ' }), false, 'spacing is not a change');
  for (const k of ['title', 'version', 'link_url', 'sent_at']) assert.equal(changesSentFields(row, { ...row, [k]: 'other' }), true, k);
  assert.equal(changesSentFields(row, { ...row, sent_at: '' }), true, 'unsending is a change');
});

const sentReport = (over = {}) => ({
  id: 301, engagement_id: 101, period: '2026-10', state: 'sent', founder_name: 'Synthetic client',
  shipped: 'Spec', next_up: 'Build', sent_at: '2026-10-31T00:00:00Z', revision: 3,
  blockers: [{ side: 'client', summary: 'Waiting on keys', raised_at: '2026-10-02' }], blockers_source: 'at_send',
  current_blockers: [{ side: 'ours', summary: 'Vendor outage', days_open: 2 }], amendments: [], ...over,
});

test('reportBlockerLine: a draft is live, a sent report is as sent or Not recorded, and now is apart', () => {
  assert.equal(reportBlockerLine({ state: 'draft', blockers: [], blockers_source: 'live' }).label, 'Open now');
  const sent = reportBlockerLine(sentReport());
  assert.equal(sent.label, 'Open when it was sent');
  assert.deepEqual(sent.list.map((b) => b.summary), ['Waiting on keys']);
  assert.deepEqual(sent.now.map((b) => b.summary), ['Vendor outage']);
  const legacy = reportBlockerLine(sentReport({ blockers: [], blockers_source: 'not_recorded' }));
  assert.equal(legacy.notRecorded, true);
  // A response from before #4709 (no source): a sent report is Not recorded, never "nothing blocked".
  assert.equal(reportBlockerLine({ state: 'sent', blockers: [] }).notRecorded, true);
  assert.deepEqual(reportBlockerLine({ state: 'draft', current_blockers: [{ summary: 'x' }] }).now, [], 'a draft has no separate now');
});

test('a sent report shows the blockers it was sent with, today’s as now, and takes an amendment', async () => {
  const legacy = sentReport({ id: 302, period: '2026-09', blockers: [], blockers_source: 'not_recorded' });
  const calls = stubApi({
    listPartnerStatusReports: async () => ({ items: [sentReport(), legacy], period: '2026-11', draft_count: 0, sent_this_cycle: 0, blocked_count: 1 }),
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
    amendPartnerStatusReport: async (id, note) => ({ ...sentReport(), amendments: [{ id: 1, note, amended_by_name: 'Sam', amended_at: '2026-11-15T00:00:00Z' }] }),
  });
  const view = await mountZone(Reports, '/delivery/status-reports');
  try {
    await view.settle();
    // Both reports are from earlier cycles.
    await view.press('Archive');
    await view.settle();
    const text = view.text();
    assert.match(text, /Open when it was sent/);
    assert.match(text, /Waiting on keys/);
    assert.match(text, /Open now, after this report/);
    assert.match(text, /Vendor outage/);
    assert.match(text, /Not recorded: this report was sent before the open blockers were kept with it\./);
    assert.match(text, /Sent reports are records, not editable rows/);
    assert.equal(view.buttons('Edit').length, 0, 'a sent report is never offered for editing');

    await view.press('Add an amendment', 0);
    const add = view.buttons('Add amendment')[0];
    assert.equal(view.props(add)['aria-disabled'], true, 'an empty amendment is not offered');
    await view.type('Amendment', '   ');
    await view.press('Add amendment'); await view.settle();
    assert.equal(callsOf(calls, 'amendPartnerStatusReport').length, 0, 'blank words are not an amendment');
    await view.type('Amendment', 'Shipped was v2.');
    await view.press('Add amendment'); await view.settle();
    assert.deepEqual(callsOf(calls, 'amendPartnerStatusReport'), [[301, 'Shipped was v2.']]);
  } finally { await view.unmount(); restoreApi(); }
});

test('the board pages too, and All counts the book', async () => {
  const row = (id) => ({ engagement_id: id, engagement_uid: `e-${id}`, client: `Client ${id}`, mode: 'project', health: null, created_at: '2026-10-01' });
  const calls = stubApi({
    getPartnerDeliveryBoard: async () => ({ items: [row(2)], page: { limit: 1, returned: 1, total: 2, next_cursor: 'b1', complete: false } }),
    // The next page repeats a row already shown (it moved between reads): it is shown once.
    partnerDeliveryBoardPage: async () => ({ items: [row(2), row(1)], page: { limit: 2, returned: 2, total: 2, next_cursor: null, complete: false } }),
  });
  const view = await mountZone(Board, '/delivery/board');
  try {
    await view.settle();
    assert.match(view.text(), /Showing 1 of 2 engagements\./);
    assert.match(view.text(), /All · 2/, 'All counts the book, not the loaded page');
    await view.press('Load more'); await view.settle();
    assert.equal(view.text().split('Client 2').length - 1, view.text().split('Client 1').length - 1, 'no engagement drawn twice');
    assert.deepEqual(callsOf(calls, 'partnerDeliveryBoardPage'), [[{ cursor: 'b1' }]]);
    assert.match(view.text(), /Client 1/);
    assert.equal(view.buttons('Load more').length, 0, 'nothing left to load');
    assert.doesNotMatch(view.text(), /Showing \d+ of/);
  } finally { await view.unmount(); restoreApi(); }
});
