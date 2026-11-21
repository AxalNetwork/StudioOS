// D6164 part 3 (#6164) — the owner's answer A (2026-11-19) on D6163's canvas:
// Team, Market and Traction are views under the Scorecard tab at their old
// addresses; an investor's firm notes are Activity's "Firm notes" filter
// (`?show=notes`) and `/notes` lands there; the deal header's Share menu holds
// Copy link only, with the company profile its own link.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_answer_a_6164_p3.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import {
  DEAL_TABS, SHOW_NOTES, TAB_DEFS, dealTabsFor, dealViewsIn, forwardOf, groupOf, notesHref, tabOf,
} from '../src/pages/dealPageModel.js';
import { ACTIVITY_FILTERS, FIRM_NOTES_LINE, INVESTOR_ACTIVITY_CHIPS, activityChoice } from '../src/pages/deal/dealFrameModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const DEAL = { id: 4, uid: 'd4', project_id: 7, project_name: 'Harbor Ledger', project_sector: 'Fintech', status: 'active', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, company_profile_url: '/startups/harbor-ledger' };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const ADMIN = { id: 1, role: 'admin', name: 'Root', email: 'root@example.com' };
const ROWS = [{ type: 'commitment', label: 'An investor committed', at: '2026-10-18', mine: false }, { type: 'invitation', label: 'You were invited', at: '2026-09-22', mine: true }];
const NOTES = { items: [{ uid: 'n1', author_user_id: 21, tag: 'Risk', body: 'Runway is only in the model.', created_at: '2026-11-12T09:00:00Z' }], total: 1 };

function handler(url) {
  if (/\/api\/deals\/4\/activity/.test(url)) return response(ROWS);
  if (/\/api\/deals\/4\/notes/.test(url)) return response(NOTES);
  if (/\/api\/deals\/4\/commitments/.test(url)) return response([]);
  if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
  return response({});
}

// No real clock (D5614): the reads are mocked promises, so microtask turns settle them.
const settle = async () => { await act(async () => { for (let i = 0; i < 60; i += 1) await Promise.resolve(); }); };

async function mounted(url, user) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u)); return handler(String(u)); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url, search: '' };
  function Probe() { const l = useLocation(); at.path = l.pathname; at.search = l.search; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null,
    h(Routes, null,
      h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }),
      h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) })),
    h(Probe)))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    requests, at,
    has: (id) => byId(id).length > 0,
    textOf: (id) => text(byId(id)[0]),
    propsOf: (id) => props(byId(id)[0]),
    current: () => nodes().filter((n) => props(n)['aria-current'] === 'page').map((n) => props(n)['data-testid']),
    async click(id) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ the model */

test('Team, Market and Traction are views under Scorecard; Evidence is one view; the investor holds Activity, not a Notes view', () => {
  assert.deepEqual(DEAL_TABS.find((g) => g.id === 'scorecard').views, ['scorecard', 'team', 'market', 'traction']);
  assert.deepEqual(DEAL_TABS.find((g) => g.id === 'evidence').views, ['evidence']);
  assert.deepEqual(DEAL_TABS.find((g) => g.id === 'activity').views, ['activity']);
  for (const v of ['team', 'market', 'traction']) {
    assert.equal(groupOf(v), 'scorecard', v);
    assert.equal(tabOf(v, 'investor'), v, `/${v} still opens its view`);
  }
  assert.deepEqual(dealViewsIn('scorecard', 'investor').map((v) => v.label), ['Eleven scopes', 'Team', 'Market', 'Traction']);
  assert.deepEqual(dealViewsIn('evidence', 'investor'), [], 'no second row on Evidence');
  assert.ok(dealTabsFor('investor').includes('activity') && !dealTabsFor('investor').includes('notes'));
  assert.equal('notes' in TAB_DEFS, false, 'Notes is a filter, not a view');
});

test('/notes forwards an investor to Activity with Firm notes on; nobody else, and no other word, is forwarded', () => {
  assert.equal(SHOW_NOTES, 'notes');
  assert.equal(notesHref(4), '/deals/4/activity?show=notes');
  assert.equal(notesHref('4x'), '/deals//activity?show=notes', 'a bad id never reaches the address');
  assert.equal(forwardOf('notes', 'investor', 4), '/deals/4/activity?show=notes');
  for (const role of ['admin', 'partner', 'founder']) assert.equal(forwardOf('notes', role, 4), null, role);
  for (const word of ['team', 'activity', '', undefined]) assert.equal(forwardOf(word, 'investor', 4), null, String(word));
  assert.equal(tabOf('notes', 'admin'), 'overview', 'an investor\'s notes are never the studio\'s');
});

test('Activity\'s chips: the activity\'s own, then Firm notes; an address word that is not one is All', () => {
  assert.deepEqual(INVESTOR_ACTIVITY_CHIPS.map(([, t]) => t), [...ACTIVITY_FILTERS.map(([, t]) => t), 'Firm notes']);
  assert.equal(activityChoice('notes'), 'notes');
  assert.equal(activityChoice('mine'), 'mine');
  for (const bad of ['', null, undefined, 'NOTES', 'x&y=1']) assert.equal(activityChoice(bad), 'all', String(bad));
  assert.match(FIRM_NOTES_LINE, /No other firm and not the founder\./);
});

/* ------------------------------------------------------------------ mounted */

test('mounted, /team, /market and /traction open under Scorecard at their old address and read their own section', async () => {
  for (const view of ['team', 'market', 'traction']) {
    const v = await mounted(`/deals/4/${view}`, INVESTOR);
    try {
      assert.deepEqual(v.current(), ['deal-tab-scorecard', `deal-subtab-${view}`], view);
      assert.equal(v.at.path, `/deals/4/${view}`, `${view} keeps its address`);
      assert.ok(v.requests.some((u) => new RegExp(`/api/deals/4/${view}$`).test(u)), `${view} reads its section`);
    } finally { await v.close(); }
  }
});

test('mounted, /notes lands on Activity with Firm notes on: the notes are read and drawn, the feed is not', async () => {
  const v = await mounted('/deals/4/notes', INVESTOR);
  try {
    assert.equal(v.at.path, '/deals/4/activity');
    assert.equal(v.at.search, '?show=notes');
    assert.deepEqual(v.current(), ['deal-tab-activity']);
    assert.equal(v.propsOf('deal-activity-tab')['data-show'], 'notes');
    assert.equal(v.propsOf('deal-activity-notes')['aria-checked'], true);
    assert.match(v.textOf('deal-firm-notes-line'), /Only your firm sees these notes/);
    assert.match(v.textOf('deal-note-n1'), /Runway is only in the model\./);
    assert.ok(!v.has('deal-activity'), 'the feed is another chip');
    assert.ok(!v.requests.some((u) => /\/api\/deals\/4\/activity/.test(u)), 'the feed is not read under Firm notes');
  } finally { await v.close(); }
});

test('mounted, a chip replaces ?show= in the address: All draws the feed, Firm notes the notes again', async () => {
  const v = await mounted('/deals/4/activity?show=notes', INVESTOR);
  try {
    await v.click('deal-activity-all');
    assert.equal(v.at.search, '', 'All is the address with no word');
    assert.match(v.textOf('deal-activity'), /An investor committed[\s\S]*You were invited/);
    assert.ok(!v.has('deal-firm-notes'));
    await v.click('deal-activity-mine');
    assert.equal(v.at.search, '?show=mine');
    assert.doesNotMatch(v.textOf('deal-activity'), /An investor committed/);
    await v.click('deal-activity-notes');
    assert.equal(v.at.search, '?show=notes');
    assert.ok(v.has('deal-firm-notes') && !v.has('deal-activity'));
  } finally { await v.close(); }
});

test('mounted, staff keep their Activity: no Firm notes chip, and /notes is not theirs', async () => {
  let v = await mounted('/deals/4/activity', ADMIN);
  try {
    assert.ok(v.has('deal-activity'));
    assert.ok(!v.has('deal-activity-notes') && !v.has('deal-activity-tab'), 'notes are an investor\'s, with no staff bypass');
    assert.ok(!v.requests.some((u) => /\/api\/deals\/4\/notes/.test(u)));
  } finally { await v.close(); }
  v = await mounted('/deals/4/notes', ADMIN);
  try {
    assert.equal(v.at.path, '/deals/4/notes', 'nothing forwards staff');
    assert.deepEqual(v.current(), ['deal-tab-overview']);
  } finally { await v.close(); }
});

test('mounted, the header: Share holds Copy link only; the company profile is its own link', async () => {
  const v = await mounted('/deals/4', INVESTOR);
  try {
    assert.equal(v.propsOf('deal-open-company-profile').to ?? v.propsOf('deal-open-company-profile').href, '/startups/harbor-ledger');
    assert.equal(v.propsOf('deal-share')['aria-label'], 'Share');
    assert.ok(!v.has('deal-more'), 'no More menu on the deal header');
    await v.click('deal-share');
    assert.match(v.textOf('deal-share-menu'), /^\s*Copy link\s*$/);
    assert.equal(v.propsOf('deal-share-menu')['aria-label'], 'Share');
  } finally { await v.close(); }
});
