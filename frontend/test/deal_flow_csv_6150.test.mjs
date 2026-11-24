/**
 * D6150 (#6150) — Deal flow's Export CSV: the table as filtered and sorted, every row and not one page, in the
 * visible columns and the table's own words. Scores are bands with confidence, never a number; a missing, locked or
 * unreadable score, fit or ask is a word, never 0 or blank; a row the investor may not open carries only what the
 * table shows. Not offered while the scores or a visible fit cannot be read, and it says why.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_flow_csv_6150.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import {
  COLUMNS, DEFAULT_COLUMNS, PAGE_SIZE, SCOPE_KEYS, csvAvailability, csvMoney, emptyFilters, fitOf, flowCsv, flowCsvName, flowRows, passes, scoresOf, sortRows,
} from '../src/pages/investor/dealflow/flowModel.js';
import { ExportCsvField } from '../src/pages/investor/dealflow/FlowControls.jsx';
import { toCsv } from '../src/lib/csvExport.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ---------------------------------------------------------------- fixtures, in the Worker's shapes

const entry = (o) => ({
  deal_id: 1, venture: 'Acme Robotics', sector: 'Robotics', round_status: 'active', stage: 'diligence',
  owner: { user_id: 5, name: 'Nadia Ahmed' }, entered_via: 'invited', entered_at: '2026-10-02 10:00:00',
  days_in_stage: 9, ask: 1500000, pass: { reason: 'secret pass reason' }, note: 'secret firm note', can_open: true, ...o,
});
const sc = (scope, band, confidence = 'High', state = 'scored') => ({ scope, state, band, confidence_word: confidence });
const DEALS = [
  { id: 1, currency: 'usd', instrument: 'SAFE' },
  { id: 2, currency: 'EUR' },
  { id: 3 },
  { id: 4, project_name: '=HYPERLINK("x")', project_sector: 'Fintech', status: 'active', currency: 'GBP', funding_target: 900000 },
];
const FLOW = { items: [
  entry({ deal_id: 1 }),
  entry({ deal_id: 2, venture: 'Northwind Labs', stage: 'screening', owner: null, ask: null, days_in_stage: null, entered_via: null }),
  entry({ deal_id: 3, venture: 'Copperline, "Energy"', stage: 'sourcing', ask: 250000 }),
] };
const BATCH = { items: [
  { deal_id: 1, scopes: [sc('team', 'Strong'), sc('market', 'Fair', 'Medium'), sc('risk', 'Strong'), sc('technical', null, null, 'not_enough'), sc('geographic', null, null, 'not_expected')] },
  { deal_id: 3, locked: true },
] };
const FITS = new Map([['1', { score: 72, confidence_label: 'Medium' }], ['2', { state: 'not_set' }], ['3', { state: 'unavailable' }], ['4', { state: 'unavailable' }]]);
const rowsOf = (scope = 'all', batch = BATCH, fits = FITS) => flowRows(scope, { flow: FLOW, deals: DEALS }).map((r) => ({ ...r, scores: scoresOf(batch, r.id), fit: fitOf(fits, r.id) }));
const col = (out, label) => out.header.indexOf(label);
const cellOf = (out, venture, label) => out.rows.find((r) => r[0] === venture)[col(out, label)];

// ---------------------------------------------------------------- the file

test('the header is Venture, Sector, then the visible columns in the table’s order', () => {
  const out = flowCsv(rowsOf(), DEFAULT_COLUMNS);
  assert.deepEqual(out.header, ['Venture', 'Sector', ...COLUMNS.map((c) => c.label)]);
  const some = flowCsv(rowsOf(), ['fit', 'stage', 'team']);
  assert.deepEqual(some.header, ['Venture', 'Sector', 'My stage', 'Team', 'Fit to my thesis']);
  assert.ok(some.rows.every((r) => r.length === some.header.length));
});

test('the rows are every filtered, sorted row, not one page', () => {
  const many = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, i) => entry({ deal_id: i + 10, venture: `Venture ${String(i).padStart(2, '0')}`, sector: i % 2 ? 'Robotics' : 'Health' }));
  const rows = flowRows('mine', { flow: { items: many }, deals: [] }).map((r) => ({ ...r, scores: scoresOf({ items: [] }, r.id), fit: fitOf(new Map(), r.id) }));
  const f = { ...emptyFilters(), sector: ['Robotics'] };
  const shown = sortRows(rows.filter((r) => passes(r, f, null)), { by: 'name', dir: 'desc', mode: 'score' });
  const out = flowCsv(shown, ['stage']);
  assert.equal(out.rows.length, shown.length);
  assert.ok(out.rows.length > PAGE_SIZE);
  assert.deepEqual(out.rows.map((r) => r[0]), shown.map((r) => r.name));
  assert.ok(out.rows.every((r) => r[1] === 'Robotics'));
});

test('scores are bands with confidence in words; every absence is its own word, never 0 or blank', () => {
  const out = flowCsv(rowsOf(), DEFAULT_COLUMNS);
  assert.equal(cellOf(out, 'Acme Robotics', 'Team'), 'Strong, high confidence');
  assert.equal(cellOf(out, 'Acme Robotics', 'Market'), 'Fair, medium confidence');
  assert.equal(cellOf(out, 'Acme Robotics', 'Risk'), 'Low risk, high confidence');
  assert.equal(cellOf(out, 'Acme Robotics', 'Technical'), 'Not enough recorded');
  assert.equal(cellOf(out, 'Acme Robotics', 'Geographic'), 'Not expected yet');
  assert.equal(cellOf(out, 'Acme Robotics', 'Scorecard'), `3 of ${SCOPE_KEYS.length} scopes scored`);
  assert.equal(cellOf(out, 'Copperline, "Energy"', 'Team'), 'Locked');
  assert.equal(cellOf(out, 'Copperline, "Energy"', 'Scorecard'), 'Locked');
  assert.equal(cellOf(out, 'Northwind Labs', 'Team'), 'Not shared');
  assert.equal(cellOf(out, 'Acme Robotics', 'Fit to my thesis'), '72, medium confidence');
  assert.equal(cellOf(out, 'Northwind Labs', 'Fit to my thesis'), 'Thesis not set');
  assert.equal(cellOf(out, 'Copperline, "Energy"', 'Fit to my thesis'), 'Not shared');
  // An unreadable row, and a whole batch that failed, say Unreadable.
  const unreadable = flowCsv(rowsOf('all', { items: [{ deal_id: 1, unreadable: true }] }), ['team', 'scorecard']);
  assert.equal(cellOf(unreadable, 'Acme Robotics', 'Team'), 'Unreadable');
  // A read scorecard with no scope scored says so, never "0 of 11".
  assert.equal(cellOf(flowCsv(rowsOf('all', { items: [{ deal_id: 1, scopes: [] }] }), ['scorecard']), 'Acme Robotics', 'Scorecard'), 'Not scored');
  const failed = flowCsv(rowsOf('all', 'failed', 'failed'), ['team', 'scorecard', 'fit']);
  assert.ok(failed.rows.every((r) => r.slice(2).every((c) => c === 'Unreadable')));
  // No cell anywhere is blank, 0 or a dash.
  for (const out2 of [out, unreadable, failed]) for (const r of out2.rows) for (const c of r) assert.ok(c !== '' && c !== '0' && c !== '—' && c !== 'null' && c !== 'undefined', JSON.stringify(r));
});

test('money carries its currency code, whole; no ask is a word', () => {
  assert.equal(csvMoney(1500000, 'usd'), '1,500,000 USD');
  assert.equal(csvMoney(250000.5, 'EUR'), '250,000.5 EUR');
  assert.equal(csvMoney(250000, null), '250,000 (currency not recorded)');
  assert.equal(csvMoney(null, 'USD'), null);
  const out = flowCsv(rowsOf(), ['ask']);
  assert.equal(cellOf(out, 'Acme Robotics', 'Ask'), '1,500,000 USD · SAFE');
  assert.equal(cellOf(out, 'Northwind Labs', 'Ask'), 'Ask not recorded');
  assert.equal(cellOf(out, 'Copperline, "Energy"', 'Ask'), '250,000 (currency not recorded)');
});

test('stage, days, owner and entered say Not on your deals, Unassigned or Not recorded, as the table does', () => {
  const out = flowCsv(rowsOf(), ['stage', 'round', 'days', 'owner', 'entered']);
  assert.deepEqual(out.rows.find((r) => r[0] === 'Acme Robotics').slice(2), ['Diligence', 'Raising', '9 days', 'Nadia Ahmed', 'Invited by the studio · 2026-10-02']);
  assert.deepEqual(out.rows.find((r) => r[0] === 'Northwind Labs').slice(2, 7)[2], 'Not recorded');
  assert.equal(cellOf(out, 'Northwind Labs', 'Owner'), 'Unassigned');
  assert.equal(cellOf(out, 'Northwind Labs', 'Entered via'), 'Not recorded');
  const outside = out.rows.find((r) => r[0] === "'=HYPERLINK(\"x\")");
  assert.deepEqual([outside[col(out, 'My stage')], outside[col(out, 'Days in stage')], outside[col(out, 'Owner')], outside[col(out, 'Entered via')]],
    ['Not on your deals', 'Not on your deals', 'Not on your deals', 'Not on your deals']);
});

test('a row the investor may not open carries only the table’s fields; no note, pass or link reaches the file', () => {
  const rows = rowsOf();
  rows[0].canOpen = false;
  const text = toCsv(...Object.values(flowCsv(rows, DEFAULT_COLUMNS)));
  assert.doesNotMatch(text, /secret firm note|secret pass reason|\/deals\//);
  assert.equal(flowCsv(rows, DEFAULT_COLUMNS).rows[0].length, DEFAULT_COLUMNS.length + 2);
});

test('a cell a spreadsheet would run is written as text; quotes and commas survive the writer', () => {
  const out = flowCsv(rowsOf(), ['stage']);
  assert.ok(out.rows.some((r) => r[0] === "'=HYPERLINK(\"x\")"));
  for (const lead of ['+', '-', '@']) assert.equal(flowCsv([{ ...rowsOf()[0], name: `${lead}cmd` }], ['stage']).rows[0][0], `'${lead}cmd`);
  assert.match(toCsv(out.header, out.rows), /"Copperline, ""Energy"""/);
});

test('not offered while scores or a visible fit are reading or unreadable, or with no row; it says why', () => {
  const rows = rowsOf();
  assert.deepEqual(csvAvailability({ rows, columns: DEFAULT_COLUMNS, scores: BATCH, fits: FITS }), { ok: true, why: null });
  assert.match(csvAvailability({ rows, columns: DEFAULT_COLUMNS, scores: null, fits: FITS }).why, /still being read/);
  assert.match(csvAvailability({ rows, columns: DEFAULT_COLUMNS, scores: 'failed', fits: FITS }).why, /Scores could not be read/);
  assert.match(csvAvailability({ rows, columns: DEFAULT_COLUMNS, scores: BATCH, fits: null }).why, /Fit to your thesis is still being read/);
  assert.match(csvAvailability({ rows, columns: DEFAULT_COLUMNS, scores: BATCH, fits: 'failed' }).why, /Fit to your thesis could not be read/);
  assert.match(csvAvailability({ rows: [], columns: DEFAULT_COLUMNS, scores: BATCH, fits: FITS }).why, /No deal matches/);
  // A column the file does not write does not hold it back.
  assert.equal(csvAvailability({ rows, columns: ['stage', 'ask'], scores: 'failed', fits: 'failed' }).ok, true);
  assert.equal(csvAvailability({ rows, columns: ['stage', 'scorecard'], scores: 'failed', fits: FITS }).ok, false);
  assert.equal(csvAvailability({ rows, columns: ['stage', 'fit'], scores: 'failed', fits: FITS }).ok, true);
});

test('the file name carries the view name, else the scope, and the day', () => {
  assert.equal(flowCsvName({ viewName: 'Q4 partner meeting!', scope: 'mine', day: '2026-11-22' }), 'deal-flow-q4-partner-meeting-2026-11-22.csv');
  assert.equal(flowCsvName({ viewName: null, scope: 'all', day: '2026-11-22' }), 'deal-flow-all-deals-2026-11-22.csv');
  assert.equal(flowCsvName({ viewName: '***', scope: 'mine', day: '2026-11-22' }), 'deal-flow-my-deals-2026-11-22.csv');
});

// ---------------------------------------------------------------- the control

test('Export CSV under View settings: enabled with the row count, or disabled with the reason on hover and in words', async () => {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n ? (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '') : '');
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  try {
    let exported = 0, closed = 0;
    await act(async () => { root.render(h(ExportCsvField, { csv: { ok: true, why: null, count: 31, onExport: () => { exported += 1; } }, close: () => { closed += 1; } })); });
    assert.equal(props(byId('dealflow-export-csv')).disabled, false);
    assert.match(text(byId('dealflow-export-csv-note')), /All 31 rows/);
    await act(async () => { props(byId('dealflow-export-csv')).onClick(); });
    assert.deepEqual([exported, closed], [1, 1]);
    const why = 'Scores could not be read, so the file would be missing them. Try again first.';
    await act(async () => { root.render(h(ExportCsvField, { csv: { ok: false, why, count: 31, onExport: () => { exported += 1; } } })); });
    const off = props(byId('dealflow-export-csv'));
    assert.equal(off.disabled, true);
    assert.equal(off.title, why);
    assert.equal(text(byId('dealflow-export-csv-note')), why);
  } finally { await act(async () => root.unmount()); restore(); }
});

test('wiring: the page exports `shown` (all filtered rows), on the table view only, through View settings', () => {
  const page = read('../src/pages/investor/dealflow/DealFlow.jsx');
  assert.match(page, /csvAvailability\(\{ rows: shown, columns: settings\.columns, scores, fits \}\)/);
  assert.match(page, /flowCsv\(shown, settings\.columns\)/);
  assert.match(page, /const csv = view === 'table' && scope !== 'new' \?/);
  assert.match(page, /flowCsvName\(\{ viewName: activeView\?\.name \|\| null, scope, day: stamp\(\) \}\)/);
  assert.match(page, /onDelete=\{\(v\) => setDialog\(\{ kind: 'delete', view: v \}\)\} csv=\{csv\} \/>/);
  const controls = read('../src/pages/investor/dealflow/FlowControls.jsx');
  assert.match(controls, /\{view === 'table' && csv && <ExportCsvField csv=\{csv\} close=\{close\} \/>\}/);
});
