/**
 * D7813 (#7813) — Research › Companies: the page's scoped export, the Evidence
 * badge, the Funds rule and the Directory / Saved analyses tabs' keyboard.
 *
 * Pins: the ten columns from the list response with Not recorded for unknowns;
 * formula-safe cells byte-equal to the shared `toSafeCsv`; the control's label,
 * hover and file name in every list state; the same export for Founder and
 * Advisor through `view.scoped`; the badge is never a bare number and never 0
 * when a collection failed; the Funds rule's words; arrows, Home and End with
 * one tab stop and labelled tab panels.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { toCsv, toSafeCsv } from '../src/lib/csvExport.js';
import { EMPTY_FILTERS } from '../src/lib/companyDirectoryView.js';
import { researchCompaniesApi } from '../src/lib/api/researchCompanies.js';
import { researchCompanyPublishersApi } from '../src/lib/api/researchCompanyPublishers.js';
import { zoneActionsFor } from '../src/workspaces/zoneActionsByRole.js';
import {
  COMPANY_CSV_HEADER, companyCsvCells, companyExport, exportScope, formulaSafe,
} from '../src/pages/research/companyDirectoryExport.js';
import CompanyDirectoryZone, { panelId, tabId, tabKeyTarget } from '../src/pages/research/CompanyDirectoryZone.jsx';
import { FUNDS_RULE, Funds, evidenceBadge } from '../src/pages/research/CompanyProfile.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const row = (over = {}) => ({
  uid: 'rcd_1', name: 'Acme Robotics', country: 'Germany', founded_year: 2019, website: 'https://acme.example',
  sector: 'robotics', source_name: 'Open Registry', source_url: 'https://registry.example/acme',
  source_license: 'CC-BY-4.0', as_of: '2026-10-01', ...over,
});
const page = (items, over = {}) => ({ items, total: 186, limit: 25, offset: 25, coverage: { of: 2480, fields: {} }, facets: {}, ...over });

test('ten columns in order, every value from the list response, unknowns written Not recorded', () => {
  assert.deepEqual(COMPANY_CSV_HEADER, ['Record uid', 'Company', 'Country', 'Founded', 'Website', 'Sector label', 'Publisher', 'Source link', 'Licence', 'As of']);
  assert.deepEqual(companyCsvCells(row()), ['rcd_1', 'Acme Robotics', 'Germany', 2019, 'https://acme.example', 'robotics',
    'Open Registry', 'https://registry.example/acme', 'CC-BY-4.0', '2026-10-01']);
  const bare = companyCsvCells({ uid: 'rcd_2', name: 'Bare', country: '', founded_year: null, website: '  ', source_url: 'http://insecure.example' });
  assert.deepEqual(bare, ['rcd_2', 'Bare', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded',
    'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded'], 'a non-https link is not admitted; nothing is blank');
  assert.equal(companyCsvCells(row()).length, COMPANY_CSV_HEADER.length);
});

test('cells are formula-safe by the shared rule: the file equals toSafeCsv over the raw cells', () => {
  const nasty = row({ name: '=HYPERLINK("https://x.example","go")', country: '+44', website: '@acme', sector: '-sum(A1)',
    source_name: '\tTabbed', source_license: "'=already", founded_year: -5 });
  const raw = [nasty.uid, nasty.name, nasty.country, nasty.founded_year, nasty.website, nasty.sector, nasty.source_name,
    nasty.source_url, nasty.source_license, nasty.as_of];
  const file = toCsv(COMPANY_CSV_HEADER, [companyCsvCells(nasty)]);
  assert.equal(file, toSafeCsv(COMPANY_CSV_HEADER, [raw]));
  assert.equal(file.split('\r\n')[0], COMPANY_CSV_HEADER.join(','), 'the header row is the first line');
  const cells = companyCsvCells(nasty);
  assert.equal(cells[1], `'=HYPERLINK("https://x.example","go")`);
  assert.equal(cells[2], "'+44");
  assert.equal(cells[4], "'@acme");
  assert.equal(cells[5], "'-sum(A1)");
  assert.equal(cells[6], "'\tTabbed");
  assert.equal(cells[8], "'=already", 'an already-prefixed value is left alone');
  assert.equal(cells[3], -5, 'a plain number stays a number');
  assert.equal(formulaSafe(2019), 2019);
  assert.equal(formulaSafe('Acme'), 'Acme');
});

test('the control states its row count, scope and file before the click, and only a settled page offers a file', () => {
  const filters = { ...EMPTY_FILTERS, q: ' grid ', country: 'Germany', founded_from: '2016', founded_to: '2024', has: ['funding'], sort: '-funding', page: 2 };
  const data = page([row(), row({ uid: 'rcd_3' })]);
  const ctl = companyExport({ state: 'ready', data, filters });
  assert.equal(ctl.label, 'Export this page · 2 rows');
  assert.equal(ctl.disabled, false);
  assert.equal(ctl.zone, 'companies-page-2');
  assert.equal(ctl.scope, 'Page 2 of 8, rows 26–50 of 186 · search “grid” · filters: Founded 2016 – 2024, Country: Germany, Funding total recorded · sorted by funding total, highest first');
  assert.equal(exportScope({ ...EMPTY_FILTERS }, page([row()], { total: 1, offset: 0 })), 'Page 1 of 1, rows 1–1 of 1 · no search · no filters · sorted by name, A to Z');
  assert.equal(companyExport({ state: 'ready', data: page([row()]), filters }).label, 'Export this page · 1 row');
  for (const [state, label] of [['loading', 'Export this page · loading'], ['updating', 'Export this page · loading'],
    ['empty', 'Export this page · 0 rows'], ['unreadable', 'Export · not available'], ['refused', 'Export · not available']]) {
    const c = companyExport({ state, data: state === 'updating' ? data : state === 'empty' ? page([]) : null, filters });
    assert.equal(c.label, label, state);
    assert.equal(c.disabled, true, state);
  }
});

test('Founder and Advisor draw the same scoped control; the workspace only passes it through', () => {
  const onClick = () => {};
  const scoped = { label: 'Export this page · 2 rows', scope: 'Page 1 of 1', disabled: false, onClick };
  for (const role of ['founder', 'advisor']) {
    const ex = zoneActionsFor(role, 'research/companies', { view: { scoped } }).find((a) => a.label.startsWith('Export'));
    assert.equal(ex.label, 'Export this page · 2 rows', role);
    assert.equal(ex.title, 'Page 1 of 1', role);
    assert.equal(ex.onClick, onClick, role);
  }
  const ws = read('frontend/src/workspaces/ResearchWorkspace.jsx');
  assert.match(ws, /zoneActions=\{\(scoped\) => zoneActionsFor\(role, 'research\/companies', \{ view: \{ scoped \} \}\)\}/);
  assert.doesNotMatch(ws, /'Founded', 'Website', 'Source'/);
});

test('the Evidence badge is never a bare number and never 0 when a collection failed', () => {
  const ok = (n) => ({ status: 'ok', rows: Array.from({ length: n }, (_, i) => ({ id: i })) });
  const bad = { status: 'unreadable', rows: [] };
  assert.deepEqual(evidenceBadge({ funding_rounds: ok(2), employment: ok(1), financials: ok(0), sources: ok(3) }).text, '6 records');
  assert.equal(evidenceBadge({ funding_rounds: ok(1), employment: ok(0), financials: ok(0), sources: ok(0) }).text, '1 record');
  const partial = evidenceBadge({ funding_rounds: ok(2), employment: bad, financials: ok(0), sources: ok(3) });
  assert.equal(partial.text, '5 read · partial');
  assert.equal(partial.state, 'partial');
  assert.match(partial.label, /1 of 4 collections could not be read/);
  const zeroPartial = evidenceBadge({ funding_rounds: bad, employment: ok(0), financials: ok(0), sources: ok(0) });
  assert.equal(zeroPartial.text, '0 read · partial', 'zero read beside a failure says partial, not a bare 0');
  const none = evidenceBadge({ funding_rounds: bad, employment: bad, financials: bad, sources: bad });
  assert.equal(none.text, 'Unavailable');
  assert.doesNotMatch(none.text, /\d/);
  assert.equal(evidenceBadge({}).text, 'Unavailable', 'a missing collection is a failed one');
  const src = read('frontend/src/pages/research/CompanyProfile.jsx');
  assert.match(src, /evidence: evidence\.text/);
});

test('the Funds section states the headquarters rule and that the three shown are first by name', () => {
  assert.match(FUNDS_RULE, /Headquarters is where the fund’s manager is based, not where it invests/);
  assert.match(FUNDS_RULE, /first three funds by name, not a ranking/);
  const none = { loading: false, error: null, data: null };
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(Funds, { tracked: null, focusRead: none, hqRead: none })));
  assert.ok(html.includes('data-testid="company-funds-rule"'));
  assert.ok(html.includes('Headquarters is where the fund’s manager is based'));
});

test('tab keys: arrows wrap, Home and End go to the ends, other keys do nothing', () => {
  assert.equal(tabKeyTarget('ArrowRight', 0), 1);
  assert.equal(tabKeyTarget('ArrowRight', 1), 0);
  assert.equal(tabKeyTarget('ArrowLeft', 0), 1);
  assert.equal(tabKeyTarget('ArrowLeft', 1), 0);
  assert.equal(tabKeyTarget('Home', 1), 0);
  assert.equal(tabKeyTarget('End', 0), 1);
  assert.equal(tabKeyTarget('Enter', 0), null);
  assert.equal(tabKeyTarget('ArrowDown', 0), null);
});

const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');

async function mount(url, zoneActions) {
  const restore = installDocument('', { focus: true });
  const hadSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const m = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { value: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }, configurable: true, writable: true });
  const list = researchCompaniesApi.list;
  const pubs = researchCompanyPublishersApi.list;
  researchCompaniesApi.list = async () => page([row(), row({ uid: 'rcd_3', name: '=cmd' })]);
  researchCompanyPublishersApi.list = async () => ({ label: 'Mixed', publishers: [] });
  const seen = {};
  function Probe() { const l = useLocation(); seen.at = l.pathname + l.search; return null; }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const r = createRoot(container);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
  await act(async () => { r.render(h(MemoryRouter, { initialEntries: [url] }, h(CompanyDirectoryZone, { role: 'founder', zoneActions }), h(Probe))); });
  await settle();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  return {
    seen, nodes, props, settle, text: () => textOf(container),
    tabs: () => nodes().filter((n) => props(n)?.role === 'tab'),
    panels: () => nodes().filter((n) => props(n)?.role === 'tabpanel'),
    async run(fn) { await act(async () => { fn(); }); await settle(); },
    async unmount() {
      await act(async () => r.unmount());
      researchCompaniesApi.list = list;
      researchCompanyPublishersApi.list = pubs;
      if (hadSession) Object.defineProperty(globalThis, 'sessionStorage', hadSession); else delete globalThis.sessionStorage;
      restore();
    },
  };
}

test('mounted: the header row gets the page scoped export, and its click writes the safe ten-column file', async () => {
  const got = [];
  const ui = await mount('/research/companies?q=acme&page=2', (scoped) => { got.push(scoped); return []; });
  const hadURL = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  try {
    const s = got.at(-1);
    assert.equal(s.label, 'Export this page · 2 rows');
    assert.match(s.scope, /^Page 2 of 8, rows 26–50 of 186 · search “acme” · no filters · sorted by name, A to Z$/);
    let blob = null;
    let name = null;
    URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
    URL.revokeObjectURL = () => {};
    const make = document.createElement;
    document.createElement = (tag) => { const n = make(tag); if (tag === 'a') { n.click = function click() { name = this.download; }; n.remove = () => {}; } return n; };
    try { await ui.run(() => s.onClick()); } finally { document.createElement = make; }
    assert.match(name, /^companies-page-2-2-rows-\d{4}-\d{2}-\d{2}\.csv$/);
    const body = (await blob.text()).replace(/^﻿/, '');
    const lines = body.split('\r\n');
    assert.equal(lines[0], COMPANY_CSV_HEADER.join(','));
    assert.equal(lines.length, 3);
    assert.equal(lines[2], "rcd_3,'=cmd,Germany,2019,https://acme.example,robotics,Open Registry,https://registry.example/acme,CC-BY-4.0,2026-10-01");
    assert.match(ui.text(), new RegExp(`Downloaded ${name.replace(/\./g, '\\.')}`));
  } finally {
    URL.createObjectURL = hadURL.create;
    URL.revokeObjectURL = hadURL.revoke;
    await ui.unmount();
  }
});

test('mounted: one tab stop, arrows and Home move and select, and each tab names its labelled panel', async () => {
  const ui = await mount('/research/companies', null);
  try {
    const [dir, saved] = ui.tabs();
    assert.equal(ui.props(dir).tabIndex, 0);
    assert.equal(ui.props(saved).tabIndex, -1);
    assert.equal(ui.props(dir).id, tabId('directory'));
    assert.equal(ui.props(dir)['aria-controls'], panelId('directory'));
    assert.equal(ui.props(saved)['aria-controls'], panelId('analyses'));
    const panels = ui.panels();
    assert.deepEqual(panels.map((p) => [ui.props(p).id, ui.props(p)['aria-labelledby'], ui.props(p).hidden]),
      [[panelId('directory'), tabId('directory'), false], [panelId('analyses'), tabId('analyses'), true]]);
    let prevented = 0;
    await ui.run(() => ui.props(dir).onKeyDown({ key: 'ArrowRight', preventDefault: () => { prevented += 1; } }));
    assert.equal(prevented, 1);
    assert.match(ui.seen.at, /tab=analyses/);
    const [dir2, saved2] = ui.tabs();
    assert.ok(document.activeElement === saved2, 'focus follows the selected tab');
    assert.equal(ui.props(saved2).tabIndex, 0);
    assert.equal(ui.props(dir2).tabIndex, -1);
    await ui.run(() => ui.props(saved2).onKeyDown({ key: 'Home', preventDefault: () => {} }));
    assert.doesNotMatch(ui.seen.at, /tab=analyses/);
    assert.ok(document.activeElement === ui.tabs()[0], 'Home focuses the first tab');
    await ui.run(() => ui.props(ui.tabs()[0]).onKeyDown({ key: 'Tab', preventDefault: () => { prevented += 1; } }));
    assert.equal(prevented, 1, 'Tab is left to the browser');
  } finally {
    await ui.unmount();
  }
});
