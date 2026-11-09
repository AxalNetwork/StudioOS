/**
 * D4815 (#4815), Deals v2 slice 2 — the deal rooms at their own route,
 * `/deals/rooms` (the owner's pick B, 2026-11-09).
 *
 *   · the route is registered (a route module) and answered inside the Deals
 *     shell with no zone pill lit, as Compare is;
 *   · `/deals` draws the flow and the "Other deal activity" line only: no
 *     collapsed rooms or tasks under it, and the line's Deal rooms is a link;
 *   · each room's access is one of three states: open (Open deal), refused
 *     (Request an invitation), unreadable (Try again, never a request);
 *   · the views' counts come from a list that was read; an unread list counts
 *     nothing, never 0;
 *   · Leave is Scope → Review → Result: the dialog first, then a result line;
 *   · the investor's My tasks moved to Studio; the unrendered investor Deals
 *     board is retired.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  ROOM_FILTERS, ROOM_FILTER_EMPTY, ROOM_LEFT, roomAccess, roomFilterCounts, roomResult,
} from '../src/components/deals/dealRoomCopy.js';
import { DealRoomsList } from '../src/components/deals/DealRoomsPanel.jsx';
import { JoinLeaveButton } from '../src/components/deals/DealRoomJoin.jsx';
import { OTHER_ACTIVITY } from '../src/pages/investor/dealflow/otherActivityModel.js';
import { ROOMS } from '../src/pages/investor/dealflow/dealFlowModel.js';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';
import { readRoutesSource } from './_routesSource.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(rel, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const QUOTA = { loading: false, error: false, quota: { used: 1, cap: 5, unlimited: false, full: false, tier: 'professional' } };

const DEALS = [
  { id: 1, project_name: 'Acme Robotics', status: 'active', is_member: 1, can_read: true },
  { id: 2, project_name: 'Northwind Labs', status: 'scored', is_member: 0, can_read: true },
  { id: 3, project_name: 'Bluefern Health', status: 'active', is_member: 1, can_read: false },
  { id: 4, project_name: 'Harbor AI', status: 'active', is_member: 0, can_read: false },
  { id: 5, project_name: 'Quayside Pay', status: 'active', is_member: 0 },
  { id: 6, project_name: 'Passed Co', status: 'rejected', is_member: 1, can_read: true },
];
const rowsOf = (out) => out.split('data-testid="dr-pipeline-row"').slice(1);
const list = (props = {}) => html(h(DealRoomsList, {
  dealsState: { loading: false, error: false, deals: DEALS }, quotaState: QUOTA, onRetryDeals: () => {}, ...props,
}));

test('a room\'s access is open, refused or unreadable, and only an explicit boolean decides', () => {
  assert.equal(roomAccess({ can_read: true }), 'open');
  assert.equal(roomAccess({ can_read: false }), 'refused');
  // Mutation checked: `d?.can_read ? 'open' : 'refused'` → 'true' reads open and undefined refused; both fail.
  for (const unknown of [{}, { can_read: 'true' }, { can_read: null }, null]) assert.equal(roomAccess(unknown), 'unreadable');
});

test('the views count the live list that was read, and an unread list counts nothing', () => {
  const live = DEALS.filter((d) => d.status !== 'rejected');
  assert.deepEqual(roomFilterCounts(live), { all: 5, open: 2, requested: 2 });
  // Mutation checked: `?? []` in place of the null → an unread list counts 0 and this fails.
  assert.equal(roomFilterCounts(null), null);
  assert.deepEqual(ROOM_FILTERS.map((f) => f.key), ['all', 'open', 'requested']);

  const out = list();
  assert.match(out, /data-testid="dr-filter-all-count"[^>]*>5</, 'the passed deal is not counted');
  assert.match(out, /data-testid="dr-filter-open-count"[^>]*>2</);
  assert.match(out, /data-testid="dr-filter-requested-count"[^>]*>2</);
  const unread = list({ dealsState: { loading: false, error: true, deals: null } });
  assert.doesNotMatch(unread, /dr-filter-[a-z]+-count/);
  assert.match(unread, /data-testid="dr-unreadable"/);
  assert.doesNotMatch(unread, /No deal is open to join yet/);
});

test('each row offers what its access allows: Open deal, Request an invitation, or Try again', () => {
  const rows = rowsOf(list());
  assert.equal(rows.length, 5);
  const [acme, northwind, bluefern, harbor, quayside] = rows;
  // Readable and a member: open it, or leave the room.
  assert.match(acme, /data-testid="dr-open" href="\/deals\/1"[^>]*>Open deal</);
  assert.match(acme, /data-testid="dr-leave"/);
  // Readable and not a member: open it; no request for access already held.
  // Mutation checked: rendering JoinLeaveButton for every open row → dr-join appears here and this fails.
  assert.match(northwind, /data-testid="dr-open"/);
  assert.doesNotMatch(northwind, /dr-join|dr-leave/);
  // Refused: no door, the request (or its withdrawal).
  assert.doesNotMatch(bluefern + harbor, /dr-open|href=/);
  assert.match(bluefern, /data-testid="dr-leave"/);
  assert.match(harbor, /data-testid="dr-join"/);
  assert.match(harbor, /An invitation or commitment is needed to open this deal\./);
  // Unreadable: Try again, never a request, never a door.
  assert.match(quayside, /data-testid="dr-access-retry"[^>]*>Try again</);
  assert.doesNotMatch(quayside, /dr-join|dr-open|href=/);
  assert.match(quayside, /Deal access could not be confirmed\./);
});

test('a view narrows the list, and an empty view says why in its own words', () => {
  const open = rowsOf(list({ initialFilter: 'open' }));
  assert.deepEqual(open.map((r) => r.match(/>(Acme Robotics|Northwind Labs|Bluefern Health|Harbor AI|Quayside Pay)</)[1]), ['Acme Robotics', 'Northwind Labs']);
  const requested = rowsOf(list({ initialFilter: 'requested' }));
  assert.equal(requested.length, 2);
  // Mutation checked: `filter === 'all'` dropped from the empty choice → the generic sentence prints here and this fails.
  const none = list({ initialFilter: 'requested', dealsState: { loading: false, error: false, deals: [DEALS[1]] } });
  assert.ok(none.includes(ROOM_FILTER_EMPTY.requested));
  assert.ok(list({ dealsState: { loading: false, error: false, deals: [] } }).includes('No deal is open to join yet.'));
});

test('on a phone every control is a 44px target, and the views scroll rather than wrap', () => {
  const out = list();
  for (const id of ['dr-filter-all', 'dr-filter-open', 'dr-filter-requested', 'dr-open', 'dr-access-retry', 'dr-join', 'dr-leave']) {
    const tag = out.match(new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`));
    assert.ok(tag, id);
    assert.match(tag[0], /min-h-\[44px\]/, `${id} is under 44px on a phone`);
  }
  assert.match(out, /data-testid="dr-filters"/);
  assert.match(out, /<nav class="[^"]*overflow-x-auto[^"]*" aria-label="Show"/);
});

const by = (v, id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);
const press = async (v, id) => { const n = by(v, id); assert.ok(n, `missing ${id}`); await act(async () => { await v.props(n).onClick({ stopPropagation() {} }); }); };

test('Leave is Scope → Review → Result: nothing is written before the dialog is confirmed, then the result is said', async () => {
  const original = api.dealroomLeave; const calls = []; const done = [];
  api.dealroomLeave = async (id) => { calls.push(id); return { ok: true }; };
  const v = await mountContracts(h(JoinLeaveButton, { dealId: 3, member: true, quotaState: QUOTA, onChanged: () => {}, onDone: (k) => done.push(k) }));
  try {
    await press(v, 'dr-leave');
    assert.deepEqual(calls, []);
    assert.ok(by(v, 'dr-request-dialog'), 'the review dialog opens first');
    await press(v, 'dr-request-confirm');
    assert.deepEqual(calls, [3]);
    // Mutation checked: dropping `setNotice(ROOM_LEFT)` → the result line is missing and this fails.
    assert.ok(v.text().includes(ROOM_LEFT));
    assert.deepEqual(done, ['left']);
  } finally { await v.unmount(); api.dealroomLeave = original; }
  assert.equal(roomResult('left', 'Acme Robotics'), 'You left the Acme Robotics room. Your invitation request is removed; nothing else changed.');
  assert.match(roomResult('requested', 'Acme Robotics'), /^Your invitation request for Acme Robotics is recorded\./);
});

test('the route: registered, answered in the Deals shell with no pill lit, and linked from Other deal activity', () => {
  assert.equal(ROOMS, '/deals/rooms');
  const routes = readRoutesSource();
  // Mutation checked: deleting routes/dealRooms.jsx → the route is missing and this fails.
  assert.ok(routes.includes(`<Route path="/deals/rooms" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />`));
  assert.equal(OTHER_ACTIVITY.find((z) => z.key === 'rooms').href, ROOMS);

  const shell = codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx'));
  assert.match(shell, /const isRooms = location\.pathname === ROOMS;/);
  assert.match(shell, /activeSlug=\{isRoot \|\| isCompare \|\| isRooms \? null : undefined\}/);
  assert.match(shell, /isRooms\s*\?\s*<DealRoomsPanel \/>/);
  // The root is the flow alone: no rooms and no tasks under it.
  assert.doesNotMatch(shell, /<MyTasks|more=/);
  const flow = codeOnly(read('frontend/src/pages/investor/dealflow/DealFlow.jsx'));
  assert.doesNotMatch(flow, /dealflow-more|id="deal-rooms"|onRooms/);
  assert.doesNotMatch(codeOnly(read('frontend/src/pages/investor/dealflow/OtherDealActivity.jsx')), /onRooms|<button key=\{item\.key\}/);
});

test('the investor\'s My tasks is on Studio, and the unrendered Deals board is retired', () => {
  assert.match(codeOnly(read('frontend/src/pages/Dashboard.jsx')), /<MyTasks licence="investor" testId="studio-investor-my-tasks" \/>/);
  assert.ok(!existsSync('frontend/src/workspaces/boards/investorDeals.js'));
  assert.doesNotMatch(codeOnly(read('frontend/src/workspaces/boards/index.js')), /investorDeals|'investor:\/deals'/);
});
