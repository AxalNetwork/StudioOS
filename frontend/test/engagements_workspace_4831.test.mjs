/**
 * #4831 (D4831) — Practice v2 Engagements (boards PX-03, PX-03b, PX-03c, PX-03d).
 *
 *   · the chips are the canvas's row, each narrows, each carries its count over the whole record;
 *   · a card says its price, scope and activity, and a half it cannot say is said in words, never as 0;
 *   · Open engagement opens one six-tab sheet, tabs in canvas order;
 *   · the sheet's outcome choice records Renewed, Did not renew or Ended for another reason (D5316);
 *   · work already sent under the engagement warns before the client changes (#4684);
 *   · the Agreement tab says no agreement is linked rather than guessing one.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/engagements_workspace_4831.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';
import {
  LANE_CHIPS, SHEET_TABS, activityLine, chipCounts, chipRows, deliverablesFor, longDay, priceLine,
  priorRecipients, scopeLine, sessionsFor, stateLine,
} from '../src/pages/advisor/practice/engagementBoard.js';
import { api } from '../src/lib/api.js';
import EngagementSheet, { OUTCOMES, latestActivity } from '../src/pages/advisor/practice/EngagementSheet.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const CANVAS = read('design/incoming/Practice v2 Page.dc.html');
const money = (c) => `$${(c / 100).toLocaleString('en-US')}`;

const eng = (over = {}) => ({
  id: 7, client_name: 'Synthetic Co', lane: 'signed', shape: 'retainer', cycles: 3, outcome: 'active',
  end_reason: null, founder_user_id: 41, amount_cents: 300000, scope_label: 'Growth strategy retainer',
  scope_includes: 'Pricing, GTM, hiring plan', scope_excludes: 'Fundraising introductions',
  started_at: '2026-08-01', term_ends_at: '2026-12-01', ended_at: null, proposed_at: null, ...over,
});
const ROWS = [
  eng({ id: 1, lane: 'drafting', outcome: null }),
  eng({ id: 2, lane: 'proposed', outcome: null }),
  eng({ id: 3, lane: 'signed' }),
  eng({ id: 4, lane: 'renewal_due' }),
  eng({ id: 5, lane: 'ended', outcome: 'ended', end_reason: 'did_not_renew' }),
];
const BOOKINGS = [
  { id: 1, client_user_id: 41, status: 'completed', topic: 'Strategy review', slot_starts_at: '2026-11-03T14:00:00Z' },
  { id: 2, client_user_id: 41, status: 'confirmed', topic: 'Pricing', slot_starts_at: '2026-11-20T14:00:00Z' },
  { id: 3, client_user_id: 41, status: 'cancelled', topic: 'Cancelled one', slot_starts_at: null },
  { id: 4, client_user_id: 99, status: 'completed', topic: 'Someone else', slot_starts_at: null },
];
const DELIVERABLES = [
  { id: 10, engagement_id: 7, title: 'Q4 memo', version_count: 3, versions: [
    { version: 3, sent_at: '2026-11-06', recipient_user_id: 41, recipient_name: 'J. Park' },
    { version: 2, sent_at: '2026-10-20', recipient_user_id: 41, recipient_name: 'J. Park' },
    { version: 1, sent_at: null, recipient_user_id: null },
  ] },
  { id: 13, engagement_id: 7, title: 'Draft addressed but unsent', version_count: 1, versions: [
    { version: 1, sent_at: null, recipient_user_id: 88, recipient_name: 'Never sent to' },
  ] },
  { id: 11, engagement_id: 7, title: 'Pricing model', version_count: 1, versions: [
    { version: 1, sent_at: '2026-10-02', recipient_user_id: 52, recipient_name: 'R. Osei' },
  ] },
  { id: 12, engagement_id: 8, title: 'Another engagement', version_count: 1, versions: [
    { version: 1, sent_at: '2026-10-02', recipient_user_id: 77, recipient_name: 'Not this one' },
  ] },
];

// Mutation checked: `active` without renewal_due (the count fails); `all` narrowing to signed (fails);
// an unknown key showing nothing (fails).
test('#4831 the chips are the canvas row, each narrows, and each counts the whole record', () => {
  const canvas = /chips\(\[(\['Active'[^)]*?)\], 'All'\)/.exec(CANVAS);
  assert.ok(canvas, 'the PX-03 chip row is on the canvas');
  assert.deepEqual([...canvas[1].matchAll(/\['([^']+)'/g)].map((m) => m[1]), ['Active', 'Renewal due', 'Proposed', 'Ended', 'All']);
  assert.deepEqual(LANE_CHIPS.map((c) => c.key), ['active', 'renewal_due', 'proposed', 'ended', 'all']);
  assert.deepEqual(chipCounts(ROWS), { active: 2, renewal_due: 1, proposed: 1, ended: 1, all: 5 });
  assert.deepEqual(chipRows(ROWS, 'active').map((e) => e.id), [3, 4], 'Active is signed or renewal due, as the tile counts');
  assert.deepEqual(chipRows(ROWS, 'proposed').map((e) => e.id), [2]);
  assert.deepEqual(chipRows(ROWS, 'all').map((e) => e.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(chipRows(ROWS, 'nonsense').map((e) => e.id), [1, 2, 3, 4, 5], 'an unknown key never shows nothing');
  const filters = read('frontend/src/workspaces/advisorZoneFilters.js');
  assert.match(filters, /\{ canvas: 'Active', key: 'active', label: 'Active \{n\}' \}/);
});

// Mutation checked: a missing amount as "$0" (fails); equity drawn as "Price not recorded" (fails);
// a cancelled booking counted as a session (fails); an unlinked client's sessions counted as 0 (fails).
test('#4831 a card says its price, scope and activity, and never prints a zero it does not have', () => {
  assert.equal(priceLine(eng(), money), '$3,000 per cycle');
  assert.equal(priceLine(eng({ shape: 'per_call', amount_cents: 25000 }), money), '$250 per call');
  assert.equal(priceLine(eng({ shape: 'equity', amount_cents: null }), money), 'Equity');
  assert.equal(priceLine(eng({ amount_cents: null }), money), 'Price not recorded');
  assert.equal(scopeLine(eng()), 'Growth strategy retainer');
  assert.equal(scopeLine(eng({ scope_label: null, scope_includes: null })), 'Scope not recorded');

  assert.deepEqual(sessionsFor(eng(), BOOKINGS).map((b) => b.id), [1, 2], 'live or done, this client only');
  assert.equal(sessionsFor(eng({ founder_user_id: null }), BOOKINGS), null, 'a name with no account joins no booking');
  assert.equal(sessionsFor(eng(), null), null, 'an unread booking list is not an empty one');
  assert.deepEqual(deliverablesFor(eng(), DELIVERABLES).map((d) => d.id), [10, 13, 11]);
  assert.equal(deliverablesFor(eng(), null), null);

  assert.equal(activityLine(eng(), BOOKINGS, DELIVERABLES), '2 sessions · 3 deliverables');
  assert.equal(activityLine(eng({ id: 8 }), BOOKINGS.slice(1, 2), DELIVERABLES), '1 session · 1 deliverable');
  assert.equal(activityLine(eng({ founder_user_id: null }), BOOKINGS, DELIVERABLES), 'Sessions need a linked client · 3 deliverables');
  assert.equal(activityLine(eng(), null, null), 'Sessions could not be read · Deliverables could not be read');

  const zone = read('frontend/src/pages/advisor/practice/EngagementsZone.jsx');
  assert.match(zone, /activity=\{activityLine\(e, bookings, deliverables\)\} onOpen=\{\(\) => setOpenId\(e\.id\)\}/);
  assert.match(zone, /setBookings\(held \? held\.items : null\);/, 'a failed bookings read is null, never []');
  assert.match(zone, /setDeliverables\(work \? work\.items : null\);/);
  assert.match(zone, /Open engagement →/);
});

// Mutation checked: an unsent version's recipient named (fails); another engagement's recipient named (fails);
// a repeat recipient listed twice (fails).
test('#4831 the #4684 warning names who this engagement’s work was already sent to', () => {
  assert.deepEqual(priorRecipients(eng(), DELIVERABLES), ['J. Park', 'R. Osei']);
  assert.deepEqual(priorRecipients(eng({ id: 9 }), DELIVERABLES), []);
  assert.equal(priorRecipients(eng(), null), null);
});

test('#4831 the sheet: six tabs in canvas order, dates as calendar days, and the reason an ending happened', () => {
  const tabs = /engSheet = \(ended\) => sheet\([\s\S]*?\['Overview'[^\]]*\]/.exec(CANVAS);
  assert.ok(tabs, 'the PX-03b sheet is on the canvas');
  assert.deepEqual([...tabs[0].slice(tabs[0].lastIndexOf('[')).matchAll(/'([^']+)'/g)].map((m) => m[1]), SHEET_TABS);
  assert.deepEqual(SHEET_TABS, ['Overview', 'Scope', 'Sessions', 'Delivery', 'Agreement', 'Activity']);
  assert.equal(longDay('2026-12-01'), '1 Dec 2026');
  assert.equal(longDay(null), null);
  assert.equal(stateLine(eng({ lane: 'renewal_due' })), 'Signed · renewal due');
  assert.equal(stateLine(eng({ lane: 'ended', outcome: 'ended', end_reason: 'other', ended_at: '2026-10-30' })), 'Ended 30 Oct 2026 · Ended for another reason');
  assert.equal(stateLine(eng({ lane: 'ended', outcome: 'ended', end_reason: null, ended_at: '2026-10-30' })), 'Ended 30 Oct 2026 · Not recorded');
  assert.equal(stateLine(eng({ lane: 'ended', outcome: null, ended_at: null })), 'Ended, date not recorded', 'an abandoned draft has no outcome to name');
  assert.deepEqual(OUTCOMES.map((o) => [o.label, o.body]), [
    ['Renewed', { decision: 'renewed' }],
    ['Did not renew', { decision: 'ended', end_reason: 'did_not_renew' }],
    ['Ended for another reason', { decision: 'ended', end_reason: 'other' }],
  ]);
  assert.equal(latestActivity({ loading: false, items: null }), null, 'an unread history is said as such by the caller');
  assert.equal(latestActivity({ loading: false, items: [] }), 'No history recorded');
});

const button = (s, label) => s.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);

// Mutation checked (built in): the outcome sending no end_reason (the decide call fails); the warning drawn with
// nothing sent (fails); the Agreement tab naming an agreement (fails).
test('#4831 mounted: Overview warns, the outcome records its reason, the tabs switch, Agreement links nothing', async () => {
  const realEvents = api.listMyAdvisorEngagementEvents;
  api.listMyAdvisorEngagementEvents = async () => ({ items: [
    { uid: 'a', kind: 'signed', created_at: '2026-08-01T10:00:00Z' },
    { uid: 'b', kind: 'renewed', note: 'Second term', created_at: '2026-11-01T10:00:00Z' },
  ] });
  const decided = [];
  const s = await mountForm(h(EngagementSheet, {
    e: eng({ lane: 'renewal_due' }), bookings: BOOKINGS, deliverables: DELIVERABLES,
    onClose() {}, onDecide: (e, body) => decided.push([e.id, body]),
  }), { modal: true });
  try {
    await s.flush();
    const t = s.text();
    assert.match(t, /Engagement · Synthetic Co/);
    assert.match(t, /This engagement has work previously sent to J\. Park, R\. Osei\. Changing the client does not transfer historical deliveries\./);
    assert.match(t, /Founder account linked/);
    assert.match(t, /Latest activity.*Second term/);
    assert.equal(s.nodes().filter((n) => propsOf(n).role === 'tab').length, 6);
    assert.ok(propsOf(button(s, 'Record outcome')).disabled, 'nothing is recorded before an outcome is chosen');

    const radio = s.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).value === 'did_not_renew');
    await s.choose(propsOf(radio).name, 'did_not_renew');
    await s.click('Record outcome');
    assert.deepEqual(decided, [[7, { decision: 'ended', end_reason: 'did_not_renew', note: null, term_ends_at: null }]]);

    await s.click('Agreement');
    assert.match(s.text(), /No agreement is linked to this engagement/);
    assert.ok(s.nodes().some((n) => n.tagName === 'A' && propsOf(n).href === '/advisor/advisory/contracts'));
    await s.click('Sessions');
    assert.match(s.text(), /Strategy review/);
    assert.doesNotMatch(s.text(), /Cancelled one|Someone else/);
    await s.click('Activity');
    assert.match(s.text(), /Second term/);
  } finally {
    await s.unmount();
    api.listMyAdvisorEngagementEvents = realEvents;
  }
});

test('#4831 mounted: unread sources say so, and an unread history offers Try again', async () => {
  const realEvents = api.listMyAdvisorEngagementEvents;
  api.listMyAdvisorEngagementEvents = async () => { throw new Error('boom'); };
  const s = await mountForm(h(EngagementSheet, {
    e: eng({ lane: 'ended', outcome: 'ended', end_reason: null, ended_at: '2026-10-30', founder_user_id: null }),
    bookings: null, deliverables: null, onClose() {}, onDecide() {},
  }), { modal: true });
  try {
    await s.flush();
    const t = s.text();
    assert.doesNotMatch(t, /This engagement has work previously sent/);
    assert.match(t, /Whether work was already sent under this engagement could not be read\./);
    assert.match(t, /Why it ended\s*Not recorded/);
    assert.match(t, /Latest activity\s*Could not be read/);
    assert.ok(!s.by('engagement-outcome'), 'an ended engagement offers no outcome form');
    await s.click('Sessions');
    assert.match(s.text(), /Your sessions could not be read/);
    await s.click('Delivery');
    assert.match(s.text(), /Your deliverables could not be read/);
    await s.click('Activity');
    assert.match(s.text(), /The history could not be read\./);
    assert.ok(button(s, 'Try again'));
  } finally {
    await s.unmount();
    api.listMyAdvisorEngagementEvents = realEvents;
  }
});

test('#4831 mounted: work filed but never sent draws no warning', async () => {
  const realEvents = api.listMyAdvisorEngagementEvents;
  api.listMyAdvisorEngagementEvents = async () => ({ items: [] });
  const s = await mountForm(h(EngagementSheet, {
    e: eng(), bookings: [], deliverables: DELIVERABLES.filter((d) => d.id === 13), onClose() {}, onDecide() {},
  }), { modal: true });
  try {
    await s.flush();
    assert.ok(!s.by('engagement-client-change-warning'));
    assert.ok(!s.by('engagement-recipients-unread'));
    assert.match(s.text(), /Latest activity\s*No history recorded/);
  } finally {
    await s.unmount();
    api.listMyAdvisorEngagementEvents = realEvents;
  }
});
