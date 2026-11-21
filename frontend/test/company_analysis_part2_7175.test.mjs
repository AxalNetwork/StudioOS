/**
 * D7175 part 2 (#7175, canvas D7041, boards RS-13 A2, A4, A5, B1, B3, B4, B5,
 * C4) — the departures part 1 left, built.
 *
 *   - A2: Known competitors are removable tokens; the subject is refused in
 *     place and the run waits while it is in the field;
 *   - A4: "Run for: A directory company / A custom market"; a custom market
 *     drops the subject and focuses Market;
 *   - A5: the running bar says when the run started;
 *   - B1: the competitor table's columns and the inputs row's Region;
 *   - B3: "What the run did" prints each step's time when the run recorded it;
 *   - B4: loading keeps the tile labels and draws skeleton values;
 *   - B5: the export preview has Markdown and JSON tabs, both read and checked
 *     before anything is downloaded, on the page and in the in-place panel;
 *   - C4: focus lands on the results heading after a run, and goes back to
 *     the control that opened the preview when it closes.
 *
 * The readings run in Node; the setup form, the panel and the page are
 * mounted with the API stubbed. Sample data is made up (.example sites).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_analysis_part2_7175.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import CompanyAnalysis, { focusPageHeading } from '../src/pages/research/CompanyAnalysis.jsx';
import CompetitorAnalysis, { loadExport } from '../src/components/CompetitorAnalysis.jsx';
import { api } from '../src/lib/api.js';
import { researchCompaniesApi } from '../src/lib/api/researchCompanies.js';
import { addKnown, inputsRow, runStartedAt, runSteps } from '../src/pages/research/companyAnalysisRead.js';
import { mountContracts } from './_contracts_dom.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CANVAS = read('../../design/incoming/Research Companies Analysis Setup and Results Page.dc.html');
const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const hhmm = (iso) => new Date(iso).toTimeString().slice(0, 5);

const RECORD = { item: { uid: 'q90410231', name: 'Halden Grid', website: 'https://halden-grid.example', website_status: 'not_verified', source_name: 'Wikidata', as_of: '2026-09-30', sector: 'Energy storage' } };
const SUBJECT = { name: 'Halden Grid', uid: 'q90410231', website: 'https://halden-grid.example' };

// ------------------------------------------------------------------ readings

test('the canvas still draws what part 2 builds', () => {
  for (const s of ['Type a name and press Enter', 'aria-label="Remove Ferrous Power"', 'A directory company', 'A custom market',
    'Started from Saved analyses · no company is the subject', 'Running · started 10:42', "['Region', r.region]",
    '<th scope="col">Why · support</th>', 'Read from', 'Tile labels stay; values are skeletons, never 0.',
    '<button type="button" role="radio" aria-checked="true">Markdown</button>', '<button type="button" role="radio" aria-checked="false">JSON</button>',
    'After a run, focus moves to the results h1.', '<li><span>09:12</span>Searched']) {
    assert.ok(CANVAS.includes(s), `the canvas no longer draws: ${s}`);
  }
});

test('Known competitors: a name is added once, and the subject by name, uid or site is refused', () => {
  assert.deepEqual(addKnown([], 'Ferrous Power, Cobalt Bay;Gridlift\nferrous power', SUBJECT), { tokens: ['Ferrous Power', 'Cobalt Bay', 'Gridlift'], refused: [] });
  assert.deepEqual(addKnown(['Ferrous Power'], 'halden grid, q90410231, www.halden-grid.example, Cobalt Bay', SUBJECT),
    { tokens: ['Ferrous Power', 'Cobalt Bay'], refused: ['halden grid', 'q90410231', 'www.halden-grid.example'] });
  assert.deepEqual(addKnown(['A'], 'Halden Grid', null), { tokens: ['A', 'Halden Grid'], refused: [] }, 'with no subject nothing is refused');
});

test('a running analysis started at its created_at; any other status has no start', () => {
  assert.equal(runStartedAt({ status: 'running', created_at: '2026-11-16T10:42:00Z' }), '2026-11-16T10:42:00Z');
  assert.equal(runStartedAt({ status: 'complete', created_at: '2026-11-16T10:42:00Z' }), null);
  assert.equal(runStartedAt({ status: 'running' }), null);
  assert.equal(runStartedAt(null), null);
});

test('"What the run did" takes each step\'s time and counts from the run, and says when it has none', () => {
  const steps = [
    { step: 'search', at: '2026-11-14T09:12:01Z' }, { step: 'discovery', at: '2026-11-14T09:12:20Z', companies: 0 },
    { step: 'read', at: '2026-11-14T09:12:21Z', tried: 0, fetched: 0 }, { step: 'synthesis', at: '2026-11-14T09:12:40Z' },
    { step: 'saved', at: '2026-11-14T09:13:05Z' },
  ];
  const a = { inputs: { market: 'Enzyme assays', region_focus: 'Global', depth: 'quick' }, candidates: [{ id: 'by-hand' }], output: { run_steps: steps }, evidence: { status: 'insufficient', sources_tried: 0 } };
  const did = runSteps(a);
  assert.equal(did.timed, true);
  assert.deepEqual(did.lines.map((l) => [l.at, l.text]), [
    ['2026-11-14T09:12:01Z', 'Searched “Enzyme assays”, Global, Quick scan'],
    ['2026-11-14T09:12:21Z', 'Discovery returned 0 companies · nothing to read'],
    ['2026-11-14T09:13:05Z', 'Saved as complete · Insufficient evidence'],
  ], 'discovery counts what it returned, not the company added by hand since');
  const read2 = runSteps({ ...a, output: { run_steps: [{ step: 'discovery', at: 'x', companies: 3 }, { step: 'read', at: 'y', tried: 4, fetched: 1 }] }, evidence: { status: 'unavailable' } });
  assert.equal(read2.lines[1].text, 'Discovery returned 3 companies · 4 reads tried, 1 fetched');
  const old = runSteps({ inputs: { market: 'Freight', depth: 'deep' }, candidates: [{}, {}], output: {}, evidence: { status: 'partial', sources_tried: 5 } });
  assert.equal(old.timed, false);
  assert.ok(old.lines.every((l) => l.at === null));
  assert.equal(old.lines[1].text, 'Discovery returned 2 companies · 5 reads tried');
  assert.equal(old.lines[0].text, 'Searched “Freight”, Deep dive');
});

test('the inputs row names the region the run was given', () => {
  assert.deepEqual(inputsRow({ market: 'M', region_focus: 'Europe' }).map((i) => (i.nr ? `${i.k}:nr` : `${i.k}:${i.v}`)),
    ['Market:M', 'Customer:nr', 'Geography:nr', 'Region:Europe', 'Depth:nr', 'Known competitors:nr']);
  assert.equal(inputsRow(null).length, 6, 'a run with no stored inputs still draws the row');
});

test('loadExport hands back the file only for a 2xx in the format\'s own type', async () => {
  const real = globalThis.fetch;
  const store = new Map();
  const realLs = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null };
  try {
    globalThis.fetch = async () => new Response('down', { status: 503, headers: { 'content-type': 'text/html' } });
    await assert.rejects(loadExport('/x?format=json', 'json'), /The JSON export failed\. Nothing was downloaded\. The server answered 503\./);
    globalThis.fetch = async () => new Response('# md', { status: 200, headers: { 'content-type': 'text/markdown' } });
    await assert.rejects(loadExport('/x?format=json', 'json'), /The export did not return JSON\./);
    globalThis.fetch = async () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json', 'X-Analysis-Version': '4' } });
    const got = await loadExport('/x?format=json', 'json');
    assert.deepEqual([got.text, got.version], ['{"a":1}', 4]);
  } finally { globalThis.fetch = real; globalThis.localStorage = realLs; }
});

test('focusPageHeading focuses the one h1 and makes it focusable', () => {
  const calls = [];
  const h1 = { setAttribute: (k, v) => calls.push([k, v]), focus: () => calls.push(['focus']) };
  assert.equal(focusPageHeading({ querySelector: (s) => (s === 'h1' ? h1 : null) }), true);
  assert.deepEqual(calls, [['tabindex', '-1'], ['focus']]);
  assert.equal(focusPageHeading({ querySelector: () => null }), false);
  assert.equal(focusPageHeading(null), false);
});

// ------------------------------------------------------------------ mounted

async function mount(element, url) {
  const m = await mountContracts(element, url);
  const settle = async () => { for (let i = 0; i < 5; i += 1) await m.flush(); };
  await settle();
  const button = (label) => m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label)
    || m.nodes().find((n) => n.tagName === 'BUTTON' && m.props(n)?.role === 'menuitem' && textOf(n).trim().startsWith(label));
  const byId = (id) => m.nodes().find((n) => m.props(n)?.id === id);
  const byTest = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  const press = async (label) => { const b = button(label); assert.ok(b, `button ${label}`); assert.ok(!m.props(b).disabled, `${label} is disabled`); await act(async () => { m.props(b).onClick({ currentTarget: b, preventDefault() {}, stopPropagation() {} }); }); await settle(); };
  // The preview's format tabs, told from any other button with the same word.
  const radio = (label) => m.nodes().find((n) => n.tagName === 'BUTTON' && m.props(n)?.role === 'radio' && textOf(n).trim() === label);
  const pressRadio = async (label) => { const b = radio(label); assert.ok(b, `radio ${label}`); await act(async () => { m.props(b).onClick(); }); await settle(); await settle(); };
  return { ...m, settle, button, byId, byTest, press, radio, pressRadio };
}

/** Every node made from here on records a focus() on itself. */
function spyFocus() {
  const focused = [];
  const make = document.createElement;
  document.createElement = function create(tag) { const n = make.call(document, tag); n.focus = function focus() { focused.push(this); }; return n; };
  return { focused, restore: () => { document.createElement = make; } };
}

function stubSetup({ analyze } = {}) {
  const saved = { competitors: api.competitors, listProjects: api.listProjects, get: researchCompaniesApi.get };
  const calls = [];
  api.competitors = { ...saved.competitors, list: async () => ({ analyses: [] }), analyze: analyze || (async (body) => { calls.push(body); return { id: 'new-run' }; }) };
  api.listProjects = async () => [];
  researchCompaniesApi.get = async () => RECORD;
  return { calls, restore: () => { Object.assign(api, { competitors: saved.competitors, listProjects: saved.listProjects }); researchCompaniesApi.get = saved.get; } };
}
const key = (m, k) => act(async () => { m.props(m.byId('ca-known')).onKeyDown({ key: k, preventDefault() {} }); });
const type = (m, id, value) => act(async () => { m.props(m.byId(id)).onChange({ target: { value } }); });

test('setup: Known competitors are tokens; the subject is refused in place and the run waits until it is removed', async () => {
  const net = stubSetup();
  const m = await mount(React.createElement(CompetitorAnalysis, { chromeless: true }), '/research/companies?tab=analyses&company=q90410231&name=Halden+Grid');
  try {
    assert.match(m.text(), /Comma or Enter separates names\. Halden Grid and halden-grid\.example are refused here/);
    await type(m, 'ca-known', 'Ferrous Power, Cobalt Bay,'); await m.settle();
    assert.ok(m.button('✕') && m.nodes().find((n) => m.props(n)?.['aria-label'] === 'Remove Ferrous Power'), 'each token has its Remove');
    assert.deepEqual(m.nodes().filter((n) => m.props(n)?.['data-known-token']).map((n) => m.props(n)['data-known-token']), ['Ferrous Power', 'Cobalt Bay']);
    assert.equal(m.props(m.byId('ca-known')).value, '', 'the comma ended the name');
    // The subject typed and entered is not added: it stays in the field, refused, and Run waits.
    await type(m, 'ca-known', 'q90410231'); await key(m, 'Enter'); await m.settle();
    assert.equal(m.nodes().filter((n) => m.props(n)?.['data-known-token']).length, 2, 'the subject never becomes a token');
    assert.match(m.text(), /q90410231: the subject cannot be its own competitor\. Remove it to run\./);
    assert.equal(m.props(m.button('Run competitor analysis')).disabled, true);
    // Through a comma it is dropped, and the field says why.
    await type(m, 'ca-known', 'Halden Grid, Gridlift'); await m.settle();
    assert.match(m.text(), /Halden Grid not added: the subject cannot be its own competitor\./);
    assert.equal(m.props(m.byId('ca-known')).value, 'Gridlift');
    // Remove takes a token out; Backspace on an empty field takes the last.
    await act(async () => { m.props(m.nodes().find((n) => m.props(n)?.['aria-label'] === 'Remove Cobalt Bay')).onClick(); }); await m.settle();
    await type(m, 'ca-known', 'Gridlift'); await key(m, 'Enter'); await m.settle();
    assert.deepEqual(m.nodes().filter((n) => m.props(n)?.['data-known-token']).map((n) => m.props(n)['data-known-token']), ['Ferrous Power', 'Gridlift']);
    await key(m, 'Backspace'); await m.settle();
    assert.deepEqual(m.nodes().filter((n) => m.props(n)?.['data-known-token']).map((n) => m.props(n)['data-known-token']), ['Ferrous Power']);
    // A name still being typed runs with the tokens.
    await type(m, 'ca-known', 'Voltaic'); await m.settle();
    await m.press('Run competitor analysis');
    assert.equal(net.calls[0].known_competitors, 'Ferrous Power, Voltaic');
    assert.equal(net.calls[0].subject_uid, 'q90410231');
  } finally { await m.unmount(); net.restore(); }
});

test('setup: a subject that arrives in Known competitors is drawn refused, and Run waits for its Remove', async () => {
  const net = stubSetup();
  const m = await mount(React.createElement(CompetitorAnalysis, { chromeless: true }),
    '/research/companies?tab=analyses&company=q90410231&name=Halden+Grid&market=Storage&known=Ferrous+Power%2C+Halden+Grid');
  try {
    const refused = m.nodes().find((n) => m.props(n)?.['data-known-token'] === 'Halden Grid');
    assert.equal(m.props(refused)['data-refused'], 'true');
    assert.match(textOf(refused), /Halden Grid · the subject/);
    assert.equal(m.props(m.button('Run competitor analysis')).disabled, true);
    await act(async () => { m.props(m.nodes().find((n) => m.props(n)?.['aria-label'] === 'Remove Halden Grid')).onClick(); }); await m.settle();
    assert.equal(m.props(m.button('Run competitor analysis')).disabled, false);
  } finally { await m.unmount(); net.restore(); }
});

test('setup: "A custom market" drops the subject, keeps the typed fields and moves focus to Market', async () => {
  const net = stubSetup();
  const m = await mount(React.createElement(CompetitorAnalysis, { chromeless: true }), '/research/companies?tab=analyses&company=q90410231&name=Halden+Grid');
  try {
    const group = m.nodes().find((n) => m.props(n)?.role === 'radiogroup' && m.props(n)?.['aria-labelledby'] === 'ca-runs-for');
    assert.ok(group, 'the Run for switch is drawn');
    assert.equal(m.props(m.button('A directory company'))['aria-checked'], 'true');
    assert.match(m.text(), /Subject · from the directory/);
    await type(m, 'ca-customer', 'Utilities'); await m.settle();
    const market = m.byId('ca-market');
    const focused = [];
    market.focus = () => focused.push('market');
    await m.press('A custom market'); await m.settle();
    assert.equal(m.props(m.button('A custom market'))['aria-checked'], 'true');
    assert.doesNotMatch(m.text(), /Subject · from the directory/, 'the subject card is gone');
    assert.match(m.text(), /None · custom market\. Only the market you type is searched\./);
    assert.match(m.text(), /Started from Saved analyses · no company is the subject/);
    assert.equal(m.props(m.byId('ca-customer')).value, 'Utilities', 'what was typed is kept');
    assert.deepEqual(focused, ['market']);
    await m.press('Run competitor analysis');
    assert.equal(net.calls[0].subject_uid, undefined, 'a custom market runs with no subject');
  } finally { await m.unmount(); net.restore(); }
});

test('setup: "A directory company" with none chosen sends to the Directory and holds Run; arrows move the switch', async () => {
  const net = stubSetup();
  const m = await mount(React.createElement(CompetitorAnalysis, { chromeless: true }), '/research/companies?tab=analyses');
  try {
    await type(m, 'ca-market', 'Grid storage'); await m.settle();
    assert.equal(m.props(m.button('A custom market'))['aria-checked'], 'true');
    const group = m.nodes().find((n) => m.props(n)?.role === 'radiogroup' && m.props(n)?.['aria-labelledby'] === 'ca-runs-for');
    await act(async () => { m.props(group).onKeyDown({ key: 'ArrowRight', preventDefault() {} }); }); await m.settle();
    assert.equal(m.props(m.button('A directory company'))['aria-checked'], 'true');
    assert.match(m.text(), /No company chosen yet\./);
    const pick = m.nodes().find((n) => n.tagName === 'A' && textOf(n).trim() === 'Pick a company from the Directory');
    assert.equal(m.props(pick).href, '/research/companies');
    assert.equal(m.props(m.button('Run competitor analysis')).disabled, true);
    await m.press('A custom market');
    assert.equal(m.props(m.button('Run competitor analysis')).disabled, false);
  } finally { await m.unmount(); net.restore(); }
});

test('setup: the running bar says when the run started', async () => {
  let finish;
  const net = stubSetup({ analyze: () => new Promise((ok) => { finish = ok; }) });
  const m = await mount(React.createElement(CompetitorAnalysis, { chromeless: true }), '/research/companies?tab=analyses&company=q90410231&name=Halden+Grid');
  // A fixed clock: the start is the moment Run is pressed.
  const realNow = Date.now;
  const PRESSED = '2026-11-16T10:42:00Z';
  Date.now = () => Date.parse(PRESSED);
  try {
    await m.press('Run competitor analysis');
    assert.equal(textOf(m.byTest('analysis-running-since')), `Running · started ${hhmm(PRESSED)} · nothing is listed until the run returns`);
    await act(async () => { finish({ id: 'x' }); }); await m.settle();
  } finally { Date.now = realNow; await m.unmount(); net.restore(); }
});

const FULL = {
  id: 'run-p', title: 'Panel run', status: 'complete', mode: 'custom', version: 2, inputs: { market: 'Storage' },
  candidates: [], sources: [], signals: [], output: { market_summary: 'S.' }, evidence: { status: 'insufficient' },
};

test('panel: after a run focus lands on Results; JSON and Markdown open the preview, which downloads only a checked file', async () => {
  const net = stubSetup({ analyze: async () => FULL });
  const realFetch = globalThis.fetch;
  const asked = [];
  let answer = () => new Response('{"id":"run-p"}', { status: 200, headers: { 'content-type': 'application/json', 'X-Analysis-Version': '2' } });
  globalThis.fetch = async (u) => { asked.push(String(u)); return answer(String(u)); };
  const m = await mount(React.createElement(CompetitorAnalysis, { chromeless: true }), '/research/companies?tab=analyses');
  const spy = spyFocus();
  const files = [];
  const make = document.createElement;
  document.createElement = function create(tag) { const n = make.call(document, tag); if (tag === 'a') { n.click = () => files.push(n.download); n.remove = () => {}; } return n; };
  try {
    await type(m, 'ca-market', 'Storage'); await m.settle();
    await m.press('Run competitor analysis');
    const heading = m.byTest('analysis-results-heading');
    assert.equal(m.props(heading).tabIndex, -1);
    assert.ok(spy.focused.includes(heading), 'focus moved to the results heading');
    // JSON opens the preview on its tab; the Worker's export is read, not the panel's copy.
    const jsonButton = m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'JSON');
    jsonButton.focus = function focus() { spy.focused.push('json-button'); };
    await act(async () => { m.props(jsonButton).onClick({ currentTarget: jsonButton }); }); await m.settle();
    assert.ok(m.byTest('export-preview'), 'the preview is open');
    assert.match(asked[0], /\/api\/competitors\/run-p\/export\?format=json$/);
    await m.settle();
    assert.equal(textOf(m.byTest('export-preview-json')), '{"id":"run-p"}');
    assert.deepEqual(files, [], 'nothing is downloaded by opening the preview');
    // Markdown answers 503: the tab says so, Download stays off.
    answer = () => new Response('down', { status: 503, headers: { 'content-type': 'text/html' } });
    await m.pressRadio('Markdown');
    assert.match(textOf(m.byTest('export-preview-failed')), /The Markdown export failed\. Nothing was downloaded\. The server answered 503\./);
    assert.equal(m.props(m.button('Download .md')).disabled, true);
    await m.pressRadio('JSON');
    await m.press('Download .json');
    assert.deepEqual(files, ['competitor-analysis-run-p-v2.json']);
    assert.equal(m.byTest('export-preview'), undefined, 'the preview closes after the download');
    await m.settle();
    // A boolean: a failed comparison would otherwise print a whole DOM node.
    assert.ok(spy.focused[spy.focused.length - 1] === 'json-button', 'focus goes back to JSON');
  } finally { document.createElement = make; spy.restore(); globalThis.fetch = realFetch; await m.unmount(); net.restore(); }
});

// ------------------------------------------------------------------ the results page

const RESULT = {
  id: 'run-b', title: 'Northwind Labs · competitors', status: 'complete', mode: 'custom', version: 3, subject_uid: 'q90410231',
  created_at: '2026-11-15T16:05:00Z', updated_at: '2026-11-15T16:07:00Z',
  inputs: { market: 'Dispatch software', target_customer: 'Carriers', region_focus: 'North America', depth: 'quick' },
  candidates: [
    { id: 'c1', name: 'Lanehaul', domain: 'lanehaul.example', category: 'direct', origin: 'discovered', relevance_score: 76, summary: 'Same customer and same product' },
    { id: 'c2', name: 'Routebook', domain: null, category: 'adjacent', origin: 'known', relevance_score: null, summary: '' },
  ],
  sources: [
    { id: 's1', candidate_id: 'c1', url: 'https://lanehaul.example/', kind: 'homepage', status: 200, origin: 'fetched' },
    { id: 's2', candidate_id: 'c1', url: 'https://lanehaul.example/pricing', kind: 'pricing', status: 503, origin: 'fetched' },
  ],
  signals: [], output: { market_summary: 'Dispatch.', findings: [], gaps: [], wedge: '', next_actions: [], notes: '' },
  evidence: { status: 'partial', candidates: 2, sources_tried: 2, sources_fetched: 1, sources_failed: 1, findings: 0, findings_with_source: 0 },
};

function stubResults(get) {
  const saved = { competitors: api.competitors, get: researchCompaniesApi.get };
  api.competitors = { ...saved.competitors, get };
  researchCompaniesApi.get = async () => RECORD;
  return { restore: () => { api.competitors = saved.competitors; researchCompaniesApi.get = saved.get; } };
}
const page = (url) => mount(React.createElement(Routes, null,
  React.createElement(Route, { path: '/research/companies/:id', element: React.createElement(CompanyAnalysis) })), url);

test('results: the table has the canvas\'s columns and each row says what it was read from; the inputs row has Region', async () => {
  const net = stubResults(async () => RESULT);
  const m = await page('/research/companies/run-b');
  try {
    const heads = m.nodes().filter((n) => n.tagName === 'TH').map((n) => textOf(n).trim());
    assert.deepEqual(heads.slice(0, 6), ['Company', 'Classification', 'Why · support', 'Sources', 'Relevance', 'Remove']);
    const lane = textOf(m.byTest('competitor-row-c1'));
    assert.match(lane, /lanehaul\.example · Discovered/);
    assert.match(lane, /Same customer and same product\s*Read from 1 of 2 sources/);
    assert.match(lane, /76 \/ 100/);
    const route = textOf(m.byTest('competitor-row-c2'));
    assert.match(route, /Website: Not recorded · Named in inputs/);
    assert.match(route, /Not attempted · no website/);
    assert.match(route, /none attempted/);
    assert.ok(m.nodes().find((n) => m.props(n)?.['aria-label'] === 'Classification for Lanehaul'));
    assert.match(textOf(m.byTest('analysis-inputs')), /RegionNorth America/);
  } finally { await m.unmount(); net.restore(); }
});

test('results: loading keeps the tile labels and draws no figure', async () => {
  let answer;
  const net = stubResults(() => new Promise((ok) => { answer = ok; }));
  const m = await page('/research/companies/run-b');
  try {
    const tiles = textOf(m.byTest('analysis-loading-tiles'));
    assert.equal(tiles, 'CompetitorsDirectAdjacentSources fetched', 'labels only: no 0 and no other figure');
    assert.equal(m.props(m.byTest('analysis-loading'))['aria-busy'], 'true');
    assert.match(m.text(), /Loading this analysis\./);
    await act(async () => { answer(RESULT); }); await m.settle();
    assert.equal(m.byTest('analysis-loading'), undefined);
  } finally { await m.unmount(); net.restore(); }
});

test('results: a running analysis says when it started', async () => {
  const net = stubResults(async () => ({ ...RESULT, status: 'running', evidence: null }));
  const m = await page('/research/companies/run-b');
  try {
    assert.equal(textOf(m.byTest('analysis-running-since')), `Running · started ${hhmm(RESULT.created_at)} · nothing is listed until the run returns`);
    assert.match(textOf(m.byTest('analysis-running')), /Started \d{1,2} Nov 2026 \d\d:\d\d/);
  } finally { await m.unmount(); net.restore(); }
});

test('results: "What the run did" prints each step\'s time, or says the run recorded none', async () => {
  const empty = {
    ...RESULT, candidates: [], sources: [],
    output: { ...RESULT.output, run_steps: [
      { step: 'search', at: '2026-11-14T09:12:01Z' }, { step: 'discovery', at: '2026-11-14T09:12:20Z', companies: 0 },
      { step: 'read', at: '2026-11-14T09:12:21Z', tried: 0, fetched: 0 }, { step: 'saved', at: '2026-11-14T09:13:05Z' },
    ] },
    evidence: { status: 'insufficient', sources_tried: 0 },
  };
  let net = stubResults(async () => empty);
  let m = await page('/research/companies/run-b');
  try {
    const did = textOf(m.byTest('analysis-run-steps'));
    assert.equal(did, `What the run did${hhmm('2026-11-14T09:12:01Z')}Searched “Dispatch software”, North America, Quick scan`
      + `${hhmm('2026-11-14T09:12:21Z')}Discovery returned 0 companies · nothing to read${hhmm('2026-11-14T09:13:05Z')}Saved as complete · Insufficient evidence`);
  } finally { await m.unmount(); net.restore(); }
  net = stubResults(async () => ({ ...empty, output: { ...RESULT.output } }));
  m = await page('/research/companies/run-b');
  try {
    assert.match(textOf(m.byTest('analysis-run-steps')), /Not recorded\s*step times: this run is older than the record of them/);
  } finally { await m.unmount(); net.restore(); }
});

test('results: Preview the file has Markdown and JSON tabs of the saved version, and Close returns focus to Export', async () => {
  const net = stubResults(async () => RESULT);
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u) => {
    if (/\/export\?/.test(String(u))) asked.push(String(u));
    return /format=md/.test(String(u))
      ? new Response('# Competitor analysis', { status: 200, headers: { 'content-type': 'text/markdown', 'X-Analysis-Version': '3' } })
      : new Response('{"version":3}', { status: 200, headers: { 'content-type': 'application/json', 'X-Analysis-Version': '3' } });
  };
  const m = await page('/research/companies/run-b');
  const exportButton = m.button('Export ▾');
  const focused = [];
  exportButton.focus = () => focused.push('export');
  try {
    await m.press('Export ▾');
    await m.press('Preview the file');
    const dialog = m.byTest('export-preview');
    assert.equal(m.props(dialog).role, 'dialog');
    assert.equal(m.props(dialog)['aria-modal'], 'true');
    assert.equal(m.props(m.radio('Markdown'))['aria-checked'], 'true');
    assert.equal(textOf(m.byTest('export-preview-md')), '# Competitor analysis');
    assert.match(asked[0], /\/api\/competitors\/run-b\/export\?format=md&version=3$/);
    await m.pressRadio('JSON');
    assert.equal(m.props(m.radio('JSON'))['aria-checked'], 'true');
    assert.equal(textOf(m.byTest('export-preview-json')), '{"version":3}');
    assert.match(asked[1], /format=json&version=3$/);
    assert.ok(m.button('Download .json'));
    await act(async () => { m.props(m.nodes().find((n) => m.props(n)?.['aria-label'] === 'Close export preview')).onClick(); }); await m.settle();
    assert.equal(m.byTest('export-preview'), undefined);
    assert.deepEqual(focused, ['export'], 'focus is back on Export');
  } finally { globalThis.fetch = realFetch; await m.unmount(); net.restore(); }
});

test('results: a run opened from setup lands focus on the page h1, once', async () => {
  let answer;
  const net = stubResults(() => new Promise((ok) => { answer = ok; }));
  const m = await page({ pathname: '/research/companies/run-b', state: { focusResults: true } });
  const focused = [];
  try {
    const h1 = m.nodes().find((n) => n.tagName === 'H1');
    assert.ok(h1, 'the shell draws the h1');
    h1.focus = () => focused.push('h1');
    document.querySelector = (s) => (s === 'h1' ? h1 : null);
    assert.deepEqual(focused, [], 'nothing moves before the analysis is read');
    await act(async () => { answer(RESULT); }); await m.settle();
    assert.deepEqual(focused, ['h1']);
  } finally { delete document.querySelector; await m.unmount(); net.restore(); }
});

test('results: an analysis opened from the list keeps focus where it was', async () => {
  let answer;
  const net = stubResults(() => new Promise((ok) => { answer = ok; }));
  const m = await page('/research/companies/run-b');
  try {
    const h1 = m.nodes().find((n) => n.tagName === 'H1');
    const focused = [];
    h1.focus = () => focused.push('h1');
    document.querySelector = (s) => (s === 'h1' ? h1 : null);
    await act(async () => { answer(RESULT); }); await m.settle();
    assert.ok(m.byTest('analysis-header'), 'the analysis is read');
    assert.deepEqual(focused, []);
  } finally { delete document.querySelector; await m.unmount(); net.restore(); }
});
