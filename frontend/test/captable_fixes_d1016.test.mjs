// D1016 (#2853, part 1 of #2432) — the old simulator's faults that still reach
// founders until part 14: a delete opens an in-page dialog (never `confirm()`),
// a missing amount reads "Not recorded" (never "0"), the CSV goes through the
// shared client and a failure is said in the page (never `alert`), and the
// Capital tabs keep the venture. The holder record's "Model a round" is the
// Worker's (`cloudflare-worker/test/cycle_records_raise_d691.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CapTablePage, { fmtMoney, deleteDialogCopy } from '../src/pages/CapTablePage.jsx';
import { tabHref } from '../src/pages/CapitalWorkspacePage.jsx';
import { setActiveCompanyId } from '../src/lib/api.js';

const h = React.createElement;
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body), blob: async () => ({ size: 3 }),
});

const SCENARIOS = { items: [{ uid: 'm1', name: 'Main', is_variant: 0, project_id: null }] };
const SCENARIO = { uid: 'm1', name: 'Main', project_id: null, inputs: { founders: [], safes: [], rounds: [], option_pool_pct: 10, exit_value: null }, result: null };

function handler(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (url.endsWith('/export.csv')) return response({}, 200);
  if (url.includes('/captable/scenarios/m1') && method === 'DELETE') return response({ ok: true });
  if (url.includes('/captable/scenarios/m1')) return response(SCENARIO);
  if (url.endsWith('/captable/scenarios')) return response(SCENARIOS);
  if (url.includes('/captable/simulate')) return response({ detail: 'down' }, 503);
  if (url.includes('/captable/live')) return response({ holders: [] });
  if (url.includes('/projects')) return response([]);
  return response({});
}

async function mounted({ handle = handler } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, confirm: globalThis.confirm, alert: globalThis.alert, URL: globalThis.URL };
  const requests = [];
  const popups = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), options }); return handle(String(u), options); };
  // A browser pop-up is the fault being fixed: either one, if called, is recorded and fails the test.
  globalThis.confirm = (m) => { popups.push(['confirm', m]); return true; };
  globalThis.alert = (m) => { popups.push(['alert', m]); };
  globalThis.URL = Object.assign(Object.create(previous.URL), { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.click = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/raise/capital/cap-table'] }, h(CapTablePage, { embedded: true }))));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, popups, flush, text: () => text(container), has: (id) => Boolean(byId(id)),
    async click(id) { const n = byId(id); assert.ok(n, `${id} is drawn`); await act(async () => { props(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async clickText(label) {
      const n = nodes().find((x) => String(x.tagName).toUpperCase() === 'BUTTON' && text(x).trim() === label);
      assert.ok(n, `a "${label}" button`); await act(async () => { props(n).onClick?.({ preventDefault() {} }); }); await flush();
    },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('a missing amount reads "Not recorded", never "0" or "$0"; a zero is still a figure', () => {
  for (const missing of [null, undefined, '', 'abc', NaN]) assert.equal(fmtMoney(missing), 'Not recorded', String(missing));
  assert.equal(fmtMoney(0), '$0');
  assert.equal(fmtMoney(950), '$950');
  assert.equal(fmtMoney(2500), '$2.5K');
  assert.equal(fmtMoney(12_000_000), '$12.00M');
  assert.equal(fmtMoney(-1_500_000), '$-1.50M');
  // Every call site lets fmtMoney carry the `$`, so a missing figure is never "$Not recorded".
  const src = read('../src/pages/CapTablePage.jsx');
  assert.ok(!/\$\$\{fmtMoney\(/.test(src) && !/>\$\{fmtMoney\(/.test(src), 'no `$` written before fmtMoney');
});

test('the delete dialog says what goes, and a variant says the main cap table does not change', () => {
  const v = deleteDialogCopy({ kind: 'variant', uid: 'v1', name: 'Seed · base case' });
  assert.equal(v.title, 'Delete this variant?');
  assert.ok(v.lines.some((l) => l.includes('"Seed · base case"')));
  assert.ok(v.lines.includes('The main cap table does not change.'));
  // A scenario that is not a variant IS the saved model: the dialog must not promise it stays.
  const s = deleteDialogCopy({ kind: 'scenario', uid: 'm1', name: 'Main' });
  assert.equal(s.title, 'Delete this cap table?');
  assert.ok(s.lines.some((l) => l.includes('"Main"')));
  assert.ok(!s.lines.includes('The main cap table does not change.'));
  assert.ok(s.lines.some((l) => l.includes('everyone who can open it loses it')));
  assert.ok(deleteDialogCopy({ kind: 'variant' }).lines[0].startsWith('This variant is deleted'), 'no name, no empty quotes');
});

test('deleting a cap table opens the dialog; nothing is deleted until it is confirmed; no browser pop-up', async () => {
  const page = await mounted();
  try {
    await page.click('scenario-delete-m1');
    assert.ok(page.has('captable-delete-dialog'));
    assert.ok(page.text().includes('Delete this cap table?'));
    assert.ok(!page.requests.some((r) => String(r.options.method).toUpperCase() === 'DELETE'), 'opening the dialog deletes nothing');
    await page.clickText('Cancel');
    assert.ok(!page.has('captable-delete-dialog'));
    assert.ok(!page.requests.some((r) => String(r.options.method).toUpperCase() === 'DELETE'), 'Cancel deletes nothing');
    await page.click('scenario-delete-m1');
    await page.click('captable-delete-confirm');
    const del = page.requests.filter((r) => String(r.options.method).toUpperCase() === 'DELETE');
    assert.deepEqual(del.map((r) => r.url), ['/api/captable/scenarios/m1']);
    assert.ok(!page.has('captable-delete-dialog'), 'the dialog closes once deleted');
    assert.deepEqual(page.popups, []);
  } finally { await page.close(); }
});

test('a failed delete is said in the dialog, which stays open; nothing claims it was deleted', async () => {
  const page = await mounted({ handle: (url, o = {}) => (String(o.method).toUpperCase() === 'DELETE' ? response({ detail: 'no' }, 500) : handler(url, o)) });
  try {
    await page.click('scenario-delete-m1');
    await page.click('captable-delete-confirm');
    assert.ok(page.has('captable-delete-dialog'));
    assert.ok(page.has('captable-delete-error'));
    assert.ok(page.text().includes('The scenario could not be deleted. Nothing changed. Try again.'));
    assert.deepEqual(page.popups, []);
  } finally { await page.close(); }
});

test('the CSV goes through the shared client: the cookie, the company header, and no alert', async () => {
  setActiveCompanyId(7);
  const page = await mounted();
  try {
    await page.clickText('Main'); // opens the saved scenario, so the CSV button draws
    await page.click('captable-csv');
    const csv = page.requests.find((r) => r.url.endsWith('/export.csv'));
    assert.ok(csv, 'the CSV is requested');
    assert.equal(csv.url, '/api/captable/scenarios/m1/export.csv');
    assert.equal(csv.options.credentials, 'include', 'the cookie rides with it');
    assert.equal(csv.options.headers['X-Company-Id'], '7', 'the company header rides with it');
    assert.ok(!page.has('captable-csv-error'));
    assert.deepEqual(page.popups, []);
  } finally { await page.close(); setActiveCompanyId(null); }
});

test('a refused CSV is said in the page, never in an alert', async () => {
  const page = await mounted({ handle: (url, o) => (url.endsWith('/export.csv') ? response({ detail: 'no' }, 403) : handler(url, o)) });
  try {
    await page.clickText('Main');
    await page.click('captable-csv');
    assert.ok(page.has('captable-csv-error'));
    assert.ok(page.text().includes('The CSV could not be downloaded. Try again.'));
    assert.deepEqual(page.popups, []);
  } finally { await page.close(); }
});

test('the Capital tabs keep the venture and nothing else', () => {
  assert.equal(tabHref('/raise/capital/model', '?project=7'), '/raise/capital/model?project=7');
  assert.equal(tabHref('/raise/capital/pipeline', '?project_id=7&tab=x#y'), '/raise/capital/pipeline?project_id=7');
  assert.equal(tabHref('/raise/capital/cap-table', '?project=7&project_id=7'), '/raise/capital/cap-table?project=7&project_id=7');
  assert.equal(tabHref('/raise/capital/model', ''), '/raise/capital/model');
  assert.equal(tabHref('/raise/capital/model', '?other=1'), '/raise/capital/model');
  assert.match(read('../src/pages/CapitalWorkspacePage.jsx'), /navigate\(tabHref\(t\.to, location\.search\)\)/);
});

test('the old simulator has no browser pop-up and no hand-built CSV fetch left', () => {
  const src = read('../src/pages/CapTablePage.jsx');
  assert.ok(!/\b(window\.)?confirm\(/.test(src.replace(/`confirm\(\)`/g, '')), 'no confirm()');
  assert.ok(!/\balert\(/.test(src), 'no alert()');
  assert.ok(!src.includes("localStorage.getItem('token')"), 'no bearer read by hand');
  assert.ok(src.includes('api.downloadCapTableCsv('));
});
