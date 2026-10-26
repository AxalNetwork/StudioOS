// D1236 (#2423) — Deal flow at /deals (DLS1–DLS18): the view and the scope
// switch in the address, today's list and invitations, SCORING's eleven scopes
// with no Overall, the round's status words, a row opening its deal only where
// the investor may read it, compare picks in the address, and "Not read here
// yet" on every block no read carries — never a zero.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_flow_d1236.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CompareView, DealFlowToolbar, DealsTableView, InvitesView } from '../src/pages/investor/dealflow/DealFlow.jsx';
import {
  BASE, NOT_YET, SCOPES, WAITS, compareHref, compareIds, dealRow, inviteRow, opensDeal, roundWord, viewHref, viewOf,
} from '../src/pages/investor/dealflow/dealFlowModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the address names the view and the scope; the defaults are board and Mine and stay out of it', () => {
  assert.deepEqual(viewOf(''), { view: 'board', scope: 'mine' });
  assert.deepEqual(viewOf('?view=table&scope=all'), { view: 'table', scope: 'all' });
  assert.deepEqual(viewOf('?view=odd&scope=everyone'), { view: 'board', scope: 'mine' });
  assert.equal(viewHref({}), BASE);
  assert.equal(viewHref({ view: 'table', scope: 'mine' }), '/deals?view=table');
  assert.equal(viewHref({ view: 'board', scope: 'new' }), '/deals?scope=new');
});

test('compare picks: digits only, no repeats, at most four, in order', () => {
  assert.deepEqual(compareIds('?ids=12,15,12,x,0,31,40,41'), ['12', '15', '31', '40']);
  assert.deepEqual(compareIds(''), []);
  assert.equal(compareHref(['3', '9']), '/deals/compare?ids=3,9');
  assert.equal(compareHref(['../1']), '/deals/compare');
});

test('SCORING’s eleven scopes in its order, no Overall; the round’s words; a row opens its deal only under Mine', () => {
  assert.deepEqual(SCOPES, ['Team', 'Market', 'Product-market fit', 'Technical', 'Traction', 'Financial', 'Risk', 'Geographic', 'Political and regulatory', 'Governance', 'Legal and IP']);
  assert.ok(!SCOPES.includes('Overall'));
  assert.deepEqual(['applied', 'scored', 'active', 'funded', 'rejected', 'odd'].map(roundWord), ['In intake', 'Screened', 'Raising', 'Funded', 'Not raising', 'Not recorded']);
  assert.deepEqual(['mine', 'all', 'new'].map(opensDeal), [true, false, false]);
});

test('a value the read did not return stays null, and no wait says zero or none', () => {
  const r = dealRow({ id: 7, project_name: 'Acme', status: 'active', amount: null, days_in_stage: null });
  assert.equal(r.ask, null);
  assert.equal(r.daysInStage, null);
  assert.equal(r.round, 'Raising');
  assert.equal(dealRow({}).name, 'Name not recorded');
  assert.equal(inviteRow({ deal_id: 3, project_name: 'B' }).id, '3');
  for (const [k, w] of Object.entries(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), k);
});

/* ------------------------------------------------------------------ *
 * Rendered
 * ------------------------------------------------------------------ */

test('the toolbar: the scope switch and the view switch are addresses; New for you has no view switch', () => {
  const out = html(h(DealFlowToolbar, { view: 'table', scope: 'all' }));
  assert.match(out, /data-testid="dealflow-scope-mine" href="\/deals\?view=table"/);
  assert.match(out, /aria-current="page"[^>]*data-testid="dealflow-scope-all"/);
  assert.ok(out.includes('href="/deals?scope=all"'), 'Board under All deals');
  const nw = html(h(DealFlowToolbar, { view: 'board', scope: 'new' }));
  assert.ok(!nw.includes('dealflow-view-table'));
});

test('the table (DLS2): every row, the round’s word, Not recorded for a missing ask, scores waiting, and doors only under Mine', () => {
  const rows = [dealRow({ id: 4, project_name: 'Acme', project_sector: 'Robotics', status: 'scored', amount: 1500000, currency: 'USD', days_in_stage: 6 }), dealRow({ id: 5, project_name: 'Bluefern', status: 'active' })];
  const mine = html(h(DealsTableView, { rows, scope: 'mine' }));
  assert.ok(mine.includes('href="/deals/4"'));
  assert.match(mine, /Screened/);
  assert.match(mine, /\$1\.5M/);
  assert.ok(mine.includes('data-testid="dealflow-wait-scores"'));
  assert.ok(!/>0</.test(mine.replace(/<td>6<\/td>/, '')), 'no missing value drawn as 0');
  const all = html(h(DealsTableView, { rows, scope: 'all' }));
  assert.ok(!all.includes('href="/deals/4"'), 'All deals is not a door the investor may walk through');
  const two = html(h(DealsTableView, { rows, scope: 'mine', picked: ['4', '5'] }));
  assert.ok(two.includes('href="/deals/compare?ids=4,5"'));
  const one = html(h(DealsTableView, { rows, scope: 'mine', picked: ['4'] }));
  assert.ok(!one.includes('/deals/compare') && /Pick at least two to compare\./.test(one), 'one pick is no comparison');
  assert.match(html(h(DealsTableView, { rows: [], scope: 'mine' })), /Nothing in your deal flow yet/);
});

test('New for you (DLS6): the studio’s invitations, and the other ways in waiting', () => {
  const out = html(h(InvitesView, { rows: [inviteRow({ deal_id: 9, project_name: 'Harbor AI', message: 'Fits your thesis.' })] }));
  assert.ok(out.includes('href="/deals/9"'));
  assert.match(out, /Fits your thesis\./);
  assert.ok(out.includes('data-testid="dealflow-wait-entered"') && out.includes(NOT_YET));
  assert.match(html(h(InvitesView, { rows: [] })), /No invitation is waiting for you\./);
});

test('Compare (DLS8): the picked ventures, fewer than two asks for more, and the chart waits', () => {
  const picks = [dealRow({ id: 1, project_name: 'A', status: 'active' }), dealRow({ id: 2, project_name: 'B', status: 'funded' })];
  const out = html(h(CompareView, { picks, missing: 1 }));
  assert.match(out, /Compare · 2 ventures/);
  assert.ok(out.includes('data-testid="dealflow-compare-missing"'));
  assert.ok(out.includes('data-testid="dealflow-wait-compare"'));
  assert.match(html(h(CompareView, { picks: picks.slice(0, 1) })), /Pick at least two ventures/);
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the compare route, the root rendering Deal flow over today’s board, the canvas and the docs', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/deals/compare" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />`));
  assert.ok(app.indexOf('path="/deals/compare"') < app.indexOf('path="/deals/:dealId"'), 'declared before the deal page');
  const routes = read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx');
  assert.ok(routes.includes('<DealFlow view={view} scope={scope} board={today} />'));
  assert.ok(routes.includes('<DealCompare ids={compareIds(location.search)} />'));
  assert.ok(routes.includes('<DealRoomsPanel />'), 'the rooms panel stays under the board');
  for (const f of ['Deal Flow List Page.dc.html', 'Deal flow · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Deal flow · Boards.dc.html').includes('name="Deal Flow List Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1236.md'));
  assert.ok(existsSync('documentation/audits/DEAL_FLOW_MAP_2026-10-26.md'));
});
