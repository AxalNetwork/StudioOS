/**
 * D245 — HQ · Funds (canvas H24): which deployment runs which fund.
 *
 * The Worker half — the branch read, the HQ route in three states, no total
 * across funds, and the elevation — is
 * cloudflare-worker/test/hq_funds_registry_d245.test.ts. This file holds what
 * the page draws:
 *
 *   - H24's six columns, in the canvas's own order, read off the canvas;
 *   - an Unreadable row for a branch that did not answer — never a zero, and
 *     never counted in the band — and a Not deployed row for one with no
 *     binding;
 *   - no currency symbol, because no currency is recorded;
 *   - the sidebar's Funds row pointing at a route App.jsx registers.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_funds_d245.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import {
  FUND_COLUMNS, FundsTable, fundRows, fundsBand, committedText, issuedText,
} from '../src/pages/hq/HqFundsPage.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CANVAS = read('design/canvases/integrated/Admin · Super.dc.html');
const APP = codeOnly(read('frontend/src/App.jsx'));

const fund = (over) => ({
  id: 1, name: 'Spin-Out Fund I', status: 'investing', gp_entity: 'Axal VC GP LLC',
  committed_minor: 1_000_000_000, committed_source: 'fund_size_cents',
  last_issued: { period: '2026-Q2', period_end: '2026-06-30', issued_at: '2026-07-14T10:00:00Z' },
  ...over,
});
const PAYLOAD = {
  read_at: '2026-09-26T10:00:00Z',
  hq: { code: 'hq', status: 'ok', as_of: '2026-09-26T10:00:00Z', data: { funds: [fund()], complete: true, periods_available: true } },
  branches: [
    { code: 'de', binding: 'BRANCH_DE', status: 'unreadable', reason: 'BRANCH_DE.fundsRegistry timed out', label: 'Axal VC DACH' },
    { code: 'es', binding: 'BRANCH_ES', status: 'not_deployed', reason: 'No binding yet.', label: 'Axal VC Iberia' },
    { code: 'fr', binding: 'BRANCH_FR', status: 'ok', label: 'Axal VC France', data: {
      funds: [fund({ id: 1, name: 'Axal France Fund I FPCI', gp_entity: 'Axal France GP SAS', committed_minor: 420_000_000 })],
      complete: true, periods_available: true } },
    { code: 'it', binding: 'BRANCH_IT', status: 'ok', label: 'Axal VC Italia', data: { funds: [], complete: true, periods_available: true } },
  ],
  branches_coverage: { total: 4, answered: 2, complete: false, unreadable: ['de', 'es'] },
  committed_unit: { recorded: false, reason: 'No fund table records a currency, so each committed figure is shown as an amount with its currency not recorded.' },
  total: { shown: false, reason: 'No total across funds: the currency of each figure is not recorded, and branches trade in different ones, so a sum would add euros to dollars.' },
  open_in_branch: { built: false, reason: 'Opening a branch’s Funds console from here is not built.' },
};
const html = renderToStaticMarkup(createElement(FundsTable, { payload: PAYLOAD }));
/** Rendered text with each tag as a space, so table cells do not run together. */
const ENTITY = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const cells = (h) => h.replace(/<[^>]+>/g, ' ')
  .replace(/&(?:#x27|quot|amp|lt|gt);/g, (e) => ENTITY[e]).replace(/\s+/g, ' ').trim();

test('D245: the table draws H24\'s six columns, in the canvas\'s order', () => {
  const at = CANVAS.indexOf('<section class="ab" id="h24">');
  assert.ok(at > 0, 'the H24 artboard is gone from the canvas');
  const board = CANVAS.slice(at, CANVAS.indexOf('</section>', at));
  const canvasCols = [...board.matchAll(/<span class="th">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(FUND_COLUMNS, canvasCols, 'the page\'s columns are not the canvas\'s');
  const drawn = [...html.matchAll(/<th\b[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(drawn, FUND_COLUMNS, 'the columns are drawn in another order');
});

test('D245: an unreadable branch is an Unreadable row — never zero funds, never counted in the band', () => {
  const rows = fundRows(PAYLOAD);
  const de = rows.find((r) => r.code === 'de');
  assert.equal(de.kind, 'unreadable');
  assert.equal(rows.filter((r) => r.code === 'de').length, 1);
  const slice = html.slice(html.indexOf('data-testid="hq-funds-row-unreadable"'));
  const row = cells('<x ' + slice.slice(0, slice.indexOf('</tr>')));
  assert.match(row, /^Unreadable Axal VC DACH It did not answer, which is not a claim that it runs no fund\./);
  assert.doesNotMatch(row, /\b0\b/, 'the unreadable branch drew a zero');

  const band = fundsBand(PAYLOAD);
  assert.equal(band.funds, 2, 'the band counted a branch that did not answer');
  assert.equal(band.holding, 2);
  assert.equal(band.coverage, 'of 4 branches, 2 answered');
  assert.equal(band.complete, false);
  assert.equal(band.line, '2 funds across 2 deployments, HQ included');
});

test('D245: a branch with no binding is Not deployed; one that answered with no fund says so', () => {
  const rows = fundRows(PAYLOAD);
  assert.equal(rows.find((r) => r.code === 'es').kind, 'not_deployed');
  assert.equal(rows.find((r) => r.code === 'it').kind, 'none');
  assert.match(cells(html), /Not deployed Axal VC Iberia No binding yet\./);
  assert.match(cells(html), /No fund on this deployment Axal VC Italia It answered, and holds no fund\./);
  // HQ first, then the branches in the order the Worker sent them.
  assert.deepEqual(rows.map((r) => r.code), ['hq', 'de', 'es', 'fr', 'it']);
});

test('D245: no currency symbol is invented — the unit is stated as not recorded', () => {
  assert.doesNotMatch(cells(html), /[$€£¥₣₹]|\bUSD\b|\bEUR\b|\bGBP\b/, 'a currency was drawn that nothing records');
  assert.equal(committedText(fund()), '10,000,000.00');
  assert.equal(committedText(fund({ committed_minor: null })), null);
  assert.match(html, /currency not recorded/);
  // A fund with no committed figure says so, never 0.
  const none = cells(renderToStaticMarkup(createElement(FundsTable, {
    payload: { ...PAYLOAD, branches: [], hq: { ...PAYLOAD.hq, data: { funds: [fund({ committed_minor: null, committed_source: null })], complete: true, periods_available: true } } },
  })));
  assert.match(none, /Spin-Out Fund I investing HQ Axal VC GP LLC Not recorded/);
});

test('D245: the last issue reads its period, "None issued", or Unreadable when the periods could not be read', () => {
  assert.equal(issuedText(fund(), true), '2026-Q2 · 2026-07-14');
  assert.equal(issuedText(fund({ last_issued: null }), true), 'None issued');
  assert.equal(issuedText(fund({ last_issued: undefined }), false), null);
  const unread = cells(renderToStaticMarkup(createElement(FundsTable, {
    payload: { ...PAYLOAD, branches: [], hq: { ...PAYLOAD.hq, data: { funds: [fund({ last_issued: undefined })], complete: true, periods_available: false, periods_reason: 'x' } } },
  })));
  assert.match(unread, /Unreadable Readable$/, 'an unread period was drawn as none');
});

test('D245: the sidebar\'s Funds row opens the registry, and App.jsx registers it for HQ only', () => {
  const hq = SIDEBAR_GROUPS.super_admin.flatMap((g) => g.items || []);
  const row = hq.find((r) => r.label === 'Funds');
  assert.ok(row, 'the Funds row is gone from the HQ shell');
  assert.equal(row.to, '/admin/funds');
  assert.match(APP, /<Route path="\/admin\/funds" element=\{guard\(\['admin'\], hqOnly\(<HqFundsPage \/>\)\)\} \/>/,
    'the registry route is not registered, or not HQ-only');
  assert.match(APP, /const HqFundsPage = lazy\(\(\) => import\('\.\/pages\/hq\/HqFundsPage'\)\);/);
  // Nothing retires: the shared product keeps its route, and the page links it.
  assert.match(APP, /<Route path="\/funds" element=/);
  assert.match(read('frontend/src/pages/hq/HqFundsPage.jsx'), /to="\/funds"/);
});
