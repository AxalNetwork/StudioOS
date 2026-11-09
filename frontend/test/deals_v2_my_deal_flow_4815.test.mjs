/**
 * D4815 (#4815), Deals v2 slice 1 — `/deals` is My Deal Flow (canvas DX1).
 *
 *   · the zones are one "Other deal activity" line, each count from the
 *     zone's own reply, and a missing reply is Unreadable, never 0;
 *   · when the personal flow is unreadable, that line says the rest is still
 *     available, so it is not mistaken for the investor's own flow (DX13);
 *   · a deal room whose access could not be read offers Try again, never
 *     Request an invitation (DX1b);
 *   · each Deals route names itself in the browser tab;
 *   · the zone intros carry no method or storage commentary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  OTHER_ACTIVITY, OTHER_ACTIVITY_SURVIVING, otherActivityItems, otherActivityLabel,
} from '../src/pages/investor/dealflow/otherActivityModel.js';
import { OtherDealActivityLine } from '../src/pages/investor/dealflow/OtherDealActivity.jsx';
import { DEALS_PAGE_TITLES, dealsPageTitle } from '../src/pages/investor/dealflow/dealFlowModel.js';
import { DealRoomsList } from '../src/components/deals/DealRoomsPanel.jsx';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(rel, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const ok = (data) => ({ kind: 'ok', data });
const UNREADABLE = { kind: 'unreadable', data: null };

const READS = {
  screening: ok({ desk: { available: true, rows: [{ deal_id: 1 }, { deal_id: 2 }] } }),
  commit: ok({ decisions: { available: true, rows: [{ status: 'voting' }, { status: 'decided' }, { status: 'draft' }] } }),
  closing: ok([{ id: 1, status: 'funded' }, { id: 2, status: 'active' }]),
  rooms: ok([{ id: 1, status: 'active' }, { id: 2, status: 'scored' }, { id: 3, status: 'rejected' }]),
};

test('each zone counts its own reply, and a missing or unavailable reply is Unreadable, never 0', () => {
  const byKey = Object.fromEntries(otherActivityItems(READS).map((i) => [i.key, i]));
  // Mutation checked: counting every decision (decided too) → commit reads 3 and this fails.
  assert.deepEqual(Object.fromEntries(Object.entries(byKey).map(([k, i]) => [k, i.count])),
    { screening: 2, commit: 2, closing: 1, rooms: 2 });
  assert.deepEqual(OTHER_ACTIVITY.map((z) => z.href), ['/deals/screening', '/deals/commit', '/deals/closing', '/deals/rooms']);

  const gone = otherActivityItems({
    screening: ok({ desk: { available: false, reason: 'x' } }),
    commit: UNREADABLE,
    closing: ok(null),
    rooms: { kind: 'loading', data: null },
  });
  // Mutation checked: `?? 0` in place of the null → screening reads count 0 and this fails.
  assert.deepEqual(gone.map((i) => [i.key, i.state, i.count]), [
    ['screening', 'unreadable', null], ['commit', 'unreadable', null], ['closing', 'unreadable', null], ['rooms', 'loading', null],
  ]);
  assert.equal(otherActivityLabel(gone[1]), 'IC decisions: could not be read');
  assert.equal(otherActivityLabel({ ...gone[0], state: 'count', count: 0 }), 'Screening: 0');
});

test('the line links each zone to its route; the surviving heading appears only when the flow is unreadable', () => {
  const out = html(h(OtherDealActivityLine, { reads: READS }));
  for (const href of ['/deals/screening', '/deals/commit', '/deals/closing', '/deals/rooms']) assert.ok(out.includes(`href="${href}"`), href);
  assert.match(out, /Other deal activity/);
  assert.doesNotMatch(out, new RegExp(OTHER_ACTIVITY_SURVIVING));
  assert.doesNotMatch(out, /other-activity-retry/);

  // Mutation checked: dropping the `surviving &&` heading → this fails.
  const surviving = html(h(OtherDealActivityLine, { reads: { ...READS, commit: UNREADABLE }, surviving: true, onRetry: () => {} }));
  assert.match(surviving, /data-testid="other-activity-surviving"[^>]*>Other deal information is still available</);
  assert.match(surviving, /data-testid="other-activity-commit-unreadable"/);
  assert.doesNotMatch(surviving, /data-testid="other-activity-commit-count"/);
  assert.match(surviving, /data-testid="other-activity-retry"/);
});

test('a deal room whose access could not be read offers Try again, never Request an invitation', () => {
  const deals = [
    { id: 1, project_name: 'Refused', status: 'active', is_member: 0, can_read: false },
    { id: 2, project_name: 'Unknown', status: 'active', is_member: 0 },
  ];
  const out = html(h(DealRoomsList, {
    dealsState: { loading: false, error: false, deals },
    quotaState: { loading: false, error: false, quota: { used: 0, cap: 5, full: false, tier: 'professional' } },
    onRetryDeals: () => {},
  }));
  const rows = out.split('data-testid="dr-pipeline-row"').slice(1);
  assert.equal(rows.length, 2);
  // Mutation checked: rendering JoinLeaveButton for every row → the Unknown row carries dr-join and this fails.
  assert.match(rows[0], /data-testid="dr-join"/);
  assert.doesNotMatch(rows[0], /dr-access-retry/);
  assert.match(rows[1], /data-testid="dr-access-retry"[^>]*>Try again</);
  assert.doesNotMatch(rows[1], /dr-join/);
  assert.match(rows[1], /Deal access could not be confirmed\./);
});

test('each Deals route names itself in the browser tab', () => {
  assert.equal(dealsPageTitle({ isRoot: true }), 'Deal flow · Axal VC');
  assert.equal(dealsPageTitle({ isCompare: true }), 'Compare · Axal VC');
  assert.equal(dealsPageTitle({ isRooms: true }), 'Deal rooms · Axal VC');
  assert.equal(dealsPageTitle({ slug: 'commit' }), 'Investment committee · Axal VC');
  assert.equal(dealsPageTitle({ slug: 'closing' }), 'Closing · Axal VC');
  assert.equal(dealsPageTitle({ slug: 'screening' }), 'Screening · Axal VC');
  assert.ok(Object.values(DEALS_PAGE_TITLES).every((t) => !/StudioOS|From idea to funded/.test(t)));
  const routes = codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx'));
  assert.match(routes, /useEffect\(\(\) => \{ document\.title = pageTitle; \}, \[pageTitle\]\);/);
  assert.match(read('frontend/src/pages/DealRoomPage.jsx'), /document\.title = `\$\{d\.project_name \|\| 'Deal'\} · Deal · Axal VC`;/);
});

test('the zone intros say what each zone is for, with no method or storage commentary', () => {
  const routes = read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx');
  const lines = routes.slice(routes.indexOf('const ZONE_LINES = {'), routes.indexOf('};', routes.indexOf('const ZONE_LINES = {')));
  for (const want of ['Decide which ventures deserve deeper work.', 'Decisions, votes, reasons and conditions.',
    'Paper, conditions and recorded transfers required to complete each investment.']) assert.ok(lines.includes(want), want);
  assert.doesNotMatch(codeOnly(lines), /\b(store|Worker|migration|rubric|tally)\b/i);
});
