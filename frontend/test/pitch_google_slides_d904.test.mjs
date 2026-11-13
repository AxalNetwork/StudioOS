/**
 * D904 (#2683) — PD17's Google Slides: the dialog's words and its three
 * states over the real component.
 *
 *  · not connected: "Connect Google to create this presentation in your
 *    Drive. Axal VC creates only the file you export." with the one link that
 *    connects it, and no Export;
 *  · connected: Export sends the two options to the Google route and, after,
 *    "Created in Google Slides · Open ›", opening only a Google address;
 *  · a refusal is a sentence, never a code; a file Google kept as PowerPoint
 *    is never called a Slides deck; a chart that went in as words says so.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_google_slides_d904.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ExportDialog from '../src/pages/raise/pitch/ExportDialog.jsx';
import {
  GOOGLE_CONNECT, GOOGLE_CONNECT_HREF, NOT_RECORDED_CREATED, OPTIONS_WHERE, chartsAsTextLine, exportFailure,
  googleCreatedLine, googleOpenHref, googleState, needsConnect, whatExportDoes,
} from '../src/pages/raise/pitch/presentExportModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob([]) });
const DECK = { id: 10, version: 4, title: 'Seed deck', is_current: 1, created_at: '2026-10-20 10:00:00' };

test('the words: connect first, what the export does, where it lands, and every refusal as a sentence', () => {
  // Mutation checked: a PowerPoint file called "Created in Google Slides" → the converted check fails; a non-Google href kept → the href check fails.
  assert.equal(GOOGLE_CONNECT, 'Connect Google to create this presentation in your Drive. Axal VC creates only the file you export.');
  assert.equal(GOOGLE_CONNECT_HREF, '/account/connectors/google_workspace');
  assert.match(whatExportDoes(DECK, 'google_slides'), /^This creates a new presentation of v4 in your Google Drive .* Axal VC creates only this file and changes nothing else in your Drive\. Nothing is shared\.$/);
  assert.match(whatExportDoes(DECK, 'pdf'), /^This makes a file of v4/);
  assert.match(OPTIONS_WHERE.google_slides, /speaker notes.*last slide/);
  assert.equal(googleCreatedLine(true), 'Created in Google Slides');
  assert.equal(googleCreatedLine(undefined), 'Created in Google Slides');
  assert.match(googleCreatedLine(false), /as a PowerPoint file: Google did not turn it into Slides/);
  assert.equal(googleOpenHref('https://docs.google.com/presentation/d/abc/edit'), 'https://docs.google.com/presentation/d/abc/edit');
  assert.equal(googleOpenHref('https://drive.google.com/file/d/abc/view'), 'https://drive.google.com/file/d/abc/view');
  for (const bad of ['http://docs.google.com/x', 'https://docs.google.com.evil.test/x', 'javascript:alert(1)', null]) assert.equal(googleOpenHref(bad), null, String(bad));
  assert.deepEqual([googleState({ state: 'ready' }), googleState({ state: 'google_not_connected' }), googleState({ state: 'workspace_not_allowed' }), googleState(null)], ['ready', 'connect', 'connect', 'unreadable']);
  assert.equal(chartsAsTextLine({ as_text: 0 }), null);
  assert.match(chartsAsTextLine({ as_text: 1 }), /^One chart went in as text/);
  assert.match(chartsAsTextLine({ as_text: 3 }), /^3 charts went in as text/);
  assert.equal(exportFailure('google_slides', 409, { error: 'google_not_connected' }), GOOGLE_CONNECT);
  assert.match(exportFailure('google_slides', 413, { error: 'presentation_too_large' }), /over 5 MB.*Download the PowerPoint instead\. Nothing was created\.$/);
  assert.equal(exportFailure('google_slides', 503, { error: 'export_not_recorded_created', url: 'x' }), NOT_RECORDED_CREATED);
  assert.equal(exportFailure('google_slides', 500, { error: 'something_new' }), 'The presentation could not be created. Try again in a moment. Nothing was shared.');
  assert.equal(exportFailure('pdf', 409, { error: 'google_not_connected' }), 'The PDF could not be produced. Try again in a moment. Nothing was shared.', 'Google words stay on the Google format');
  assert.deepEqual(['google_not_connected', 'workspace_not_allowed', 'company_not_enabled', 'google_not_created'].map((e) => needsConnect({ error: e })), [true, true, true, false]);
});

async function mounted(handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }); return handle(String(u), options); };
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
    requests, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const handler = (over = {}) => (url, options = {}) => {
  const method = options.method || 'GET';
  for (const [k, f] of Object.entries(over)) if (url.includes(k)) return f(url, method);
  if (url.includes('/decks/10/exports')) return response({ exports: [] });
  return response({});
};
const writes = (v) => v.requests.filter((q) => q.method !== 'GET');

test('not connected: the connect line and its link, and no Export', async () => {
  // Mutation checked: Export left enabled while not connected → the disabled check fails.
  const v = await mounted(handler({ '/connectors/google-workspace/mine': () => response({ state: 'google_not_connected', items: [] }) }));
  try {
    assert.ok(!v.has('pitch-export-google-connect'), 'nothing about Google before it is chosen');
    await v.click('pitch-export-format-google_slides');
    assert.equal(v.textOf('pitch-export-google-connect').startsWith(GOOGLE_CONNECT), true);
    assert.equal(v.props('pitch-export-google-connect-link').href, GOOGLE_CONNECT_HREF);
    assert.equal(v.props('pitch-export-run').disabled, true, 'Export offered before Google is connected');
    assert.equal(writes(v).length, 0);
  } finally { await v.close(); }
});

test('connected: Export sends the two options to the Google route, then "Created in Google Slides · Open ›"', async () => {
  // Mutation checked: the options dropped from the body → the body check fails; Open linked to the Worker's url unchecked → the href check fails.
  const v = await mounted(handler({
    '/connectors/google-workspace/mine': () => response({ state: 'ready', items: [] }),
    '/export/google-slides': () => response({ created: true, file_id: 'f1', url: 'https://docs.google.com/presentation/d/f1/edit', converted: true, charts: { pictured: 0, as_text: 2 } }),
  }));
  try {
    await v.click('pitch-export-format-google_slides');
    assert.ok(!v.has('pitch-export-google-connect'));
    assert.match(v.textOf('pitch-export-what'), /creates a new presentation of v4 in your Google Drive/);
    assert.equal(v.props('pitch-export-run').disabled, false);
    await v.click('pitch-export-run');
    const w = writes(v);
    assert.equal(w.length, 1);
    assert.match(w[0].url, /\/decks\/10\/export\/google-slides$/);
    assert.deepEqual(w[0].body, { notes: true, sources: true });
    assert.equal(v.textOf('pitch-export-google-created').startsWith('Created in Google Slides · Open ›'), true);
    assert.equal(v.props('pitch-export-google-open').href, 'https://docs.google.com/presentation/d/f1/edit');
    assert.equal(v.props('pitch-export-google-open').rel, 'noopener noreferrer');
    assert.match(v.textOf('pitch-export-google-charts'), /^2 charts went in as text/);
  } finally { await v.close(); }
});

test('a refusal is a sentence, and "connect first" brings back the connect link', async () => {
  const v = await mounted(handler({
    '/connectors/google-workspace/mine': () => response({ state: 'ready', items: [] }),
    '/export/google-slides': () => response({ error: 'company_not_enabled' }, 409),
  }));
  try {
    await v.click('pitch-export-format-google_slides');
    await v.click('pitch-export-run');
    assert.match(v.textOf('pitch-export-failed'), /not switched on for this venture's company/);
    assert.ok(v.has('pitch-export-google-connect'));
    assert.ok(!v.has('pitch-export-google-created'));
  } finally { await v.close(); }
});

test('Google kept it as PowerPoint, or the ledger failed after it was made: said as it is, with a link', async () => {
  const kept = await mounted(handler({
    '/connectors/google-workspace/mine': () => response({ state: 'ready' }),
    '/export/google-slides': () => response({ created: true, url: 'https://drive.google.com/file/d/f2/view', converted: false, charts: { pictured: 0, as_text: 0 } }),
  }));
  try {
    await kept.click('pitch-export-format-google_slides');
    await kept.click('pitch-export-run');
    assert.match(kept.textOf('pitch-export-google-created'), /as a PowerPoint file/);
    assert.equal(kept.props('pitch-export-google-open').href, 'https://drive.google.com/file/d/f2/view');
  } finally { await kept.close(); }
  const unrecorded = await mounted(handler({
    '/connectors/google-workspace/mine': () => { throw new Error('offline'); },
    '/export/google-slides': () => response({ error: 'export_not_recorded_created', url: 'https://docs.google.com/presentation/d/f3/edit', converted: true }, 503),
  }));
  try {
    await unrecorded.click('pitch-export-format-google_slides');
    assert.ok(unrecorded.has('pitch-export-google-unreadable'), 'an unreadable connection is said, not taken as "not connected"');
    assert.equal(unrecorded.props('pitch-export-run').disabled, false);
    await unrecorded.click('pitch-export-run');
    assert.equal(unrecorded.textOf('pitch-export-failed'), NOT_RECORDED_CREATED);
    assert.equal(unrecorded.props('pitch-export-google-open').href, 'https://docs.google.com/presentation/d/f3/edit');
  } finally { await unrecorded.close(); }
});
