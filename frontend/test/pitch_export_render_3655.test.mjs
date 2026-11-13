/**
 * #3655 — a failed PDF or PowerPoint render reads as PD25's sentence plus one
 * reference line built only from the Worker's code-only `diagnostic`; a
 * failure never reads as done, and nothing is recorded or downloaded.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_export_render_3655.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ExportDialog from '../src/pages/raise/pitch/ExportDialog.jsx';
import { exportDiagnostic, exportFailure } from '../src/pages/raise/pitch/presentExportModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob([]) });
const DECK = { id: 10, version: 4, title: 'Seed deck', is_current: 1, created_at: '2026-10-20 10:00:00' };

test('the reference line reads codes and numbers only', () => {
  // Mutation checked: the reason's pattern dropped → the sentence-shaped reason is shown; slide shown 0-based → "slide 2" fails.
  assert.equal(exportDiagnostic({ error: 'pptx_render_failed', diagnostic: { reason: 'browser_refused', attempts: 1, status: 400, slide: 1 } }), 'Reference: browser_refused · status 400 · slide 2 · 1 try');
  assert.equal(exportDiagnostic({ diagnostic: { reason: 'browser_status', attempts: 2, status: 503 } }), 'Reference: browser_status · status 503 · 2 tries');
  assert.equal(exportDiagnostic({ diagnostic: { reason: 'not_pdf', attempts: 1 } }), 'Reference: not_pdf · 1 try');
  for (const bad of [null, {}, { diagnostic: null }, { diagnostic: { reason: '<b>Sign in</b> https://axal.vc/deck/print-export/t' } }, { diagnostic: { reason: 7 } }]) {
    assert.equal(exportDiagnostic(bad), null, JSON.stringify(bad));
  }
  assert.equal(exportDiagnostic({ diagnostic: { reason: 'browser_status', status: '503', slide: 'x', attempts: 0 } }), 'Reference: browser_status', 'non-numbers are left out');
  assert.equal(exportFailure('pdf', 502, { error: 'pdf_render_failed' }), 'The PDF could not be produced. Try again in a moment. Nothing was shared.');
});

async function mounted(handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, createObjectURL: URL.createObjectURL };
  const requests = [];
  let downloads = 0;
  URL.createObjectURL = () => { downloads += 1; return 'blob:x'; };
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: options.method || 'GET' }); return handle(String(u), options); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(ExportDialog, { versions: [DECK], current: DECK, onClose() {} }))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, downloads: () => downloads, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous.fetch; URL.createObjectURL = previous.createObjectURL; restore(); },
  };
}

test('a failed PowerPoint render: the sentence, the reference, no download and no "Exported"', async () => {
  // Mutation checked: the reference never set → the ref check fails. (It is drawn inside the failure, so it leaves with it.)
  const v = await mounted((url, o = {}) => {
    if (url.includes('/decks/10/exports')) return response({ exports: [] });
    if (url.endsWith('/decks/10/export') && o.method === 'POST') {
      return response({ error: 'pptx_render_failed', message: 'The PowerPoint file could not be produced. Try again in a moment.', diagnostic: { reason: 'browser_timeout', attempts: 2, slide: 0 } }, 502);
    }
    return response({});
  });
  try {
    await v.click('pitch-export-format-pptx');
    await v.click('pitch-export-run');
    assert.equal(v.textOf('pitch-export-failed'), 'The PowerPoint file could not be produced. Try again in a moment. Nothing was shared.Reference: browser_timeout · slide 1 · 2 tries');
    assert.equal(v.textOf('pitch-export-failed-ref'), 'Reference: browser_timeout · slide 1 · 2 tries');
    assert.ok(!v.has('pitch-export-done'), 'a failure never reads as done');
    assert.equal(v.downloads(), 0);
    assert.equal(v.requests.filter((q) => q.method === 'POST').length, 1, 'one press, one request: the dialog never retries on its own');
    await v.click('pitch-export-format-pdf');
    assert.ok(!v.has('pitch-export-failed-ref'), 'the reference goes with its failure');
  } finally { await v.close(); }
});
