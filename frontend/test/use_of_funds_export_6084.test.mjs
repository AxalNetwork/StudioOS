/**
 * D6084 (#6084): Use of funds' Export ▾ (UF1). Drawn only when the plan read
 * grants `capabilities.export` (off while the plan is Unreadable); CSV and PDF
 * download through the Worker; "Add to the data room" needs its own capability
 * and says where the file went; a refusal shows the Worker's sentence.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/use_of_funds_export_6084.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm } from './_form_d695.mjs';
import { ExportMenu } from '../src/pages/raise/useoffunds/UseOfFundsTool.jsx';
import { api } from '../src/lib/api.js';
import { useOfFundsApi } from '../src/lib/api/useOfFunds.js';

const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const ALL = { export: true, add_to_data_room: true };

test('D6084: Export is drawn only with the export capability; filing needs its own', () => {
  assert.match(ssr(h(ExportMenu, { projectId: 1, capabilities: ALL, api: {} })), /aria-label="Export as CSV or PDF"[^>]*>Export ▾</);
  for (const capabilities of [undefined, null, {}, { export: false, add_to_data_room: true }]) {
    assert.equal(ssr(h(ExportMenu, { projectId: 1, capabilities, api: {} })), '', JSON.stringify(capabilities));
  }
  const readOnly = ssr(h(ExportMenu, { projectId: 1, capabilities: { export: true, add_to_data_room: false }, api: {} }));
  assert.match(readOnly, /uof-export-csv/);
  assert.doesNotMatch(readOnly, /uof-export-room/);
});

test('D6084: CSV, PDF and the data room each call their own route and say what happened', async () => {
  const calls = [];
  const fake = {
    exportCsv: async (p) => { calls.push(['csv', p]); },
    exportPdf: async (p) => { calls.push(['pdf', p]); },
    snapshot: async (p) => { calls.push(['room', p]); return { file: { name: 'Use of funds as of 2026-11-14.pdf' } }; },
  };
  const ui = await mountForm(h(ExportMenu, { projectId: 7, capabilities: ALL, api: fake }));
  await ui.click('CSV · the base scenario');
  assert.equal(ui.text().endsWith('Downloaded the plan as CSV.'), true);
  await ui.click('PDF · the base scenario');
  assert.equal(ui.text().endsWith('Downloaded the plan as PDF.'), true);
  await ui.click('Add to the data room');
  assert.equal(ui.text().endsWith('Added to the data room as “Use of funds as of 2026-11-14.pdf”, under NDA and seen by nobody until you share it.'), true);
  assert.deepEqual(calls, [['csv', 7], ['pdf', 7], ['room', 7]]);
  await ui.unmount();
});

test('D6084: a refused export shows the Worker’s sentence, not a download', async () => {
  const sentence = 'Use of funds is Unreadable, so nothing was exported. Read the plan, then try again.';
  const ui = await mountForm(h(ExportMenu, { projectId: 7, capabilities: ALL, api: { exportCsv: async () => { throw Object.assign(new Error(sentence), { status: 503 }); } } }));
  await ui.click('CSV · the base scenario');
  assert.match(ui.text(), /Unreadable|could not be exported/);
  assert.doesNotMatch(ui.text(), /Downloaded/);
  await ui.unmount();
});

test('D6084: the client methods read the Worker routes for this venture', async () => {
  const seen = [];
  const original = api._downloadCsv;
  api._downloadCsv = async (path, name) => { seen.push([path, name]); return {}; };
  try { await useOfFundsApi.exportCsv(3); await useOfFundsApi.exportPdf(3); } finally { api._downloadCsv = original; }
  assert.deepEqual(seen, [['/cycles/raise/use-of-funds/export.csv?project=3', 'use-of-funds.csv'], ['/cycles/raise/use-of-funds/export.pdf?project=3', 'use-of-funds.pdf']]);
  const src = readFileSync(new URL('../src/lib/api/useOfFunds.js', import.meta.url), 'utf8');
  assert.match(src, /snapshot: project => request\(`\/cycles\/raise\/use-of-funds\/snapshot\?\$\{q\(project\)\}`, \{ method: 'POST', body: '\{\}' \}\)/);
});

test('D6084: Home draws Export beside Edit split on the desktop only', () => {
  const tool = readFileSync(new URL('../src/pages/raise/useoffunds/UseOfFundsTool.jsx', import.meta.url), 'utf8');
  assert.match(tool, /\{!phone \? <ExportMenu projectId=\{projectId\} capabilities=\{plan\.viewer\?\.capabilities\} api=\{api\} \/> : null\}/);
});
