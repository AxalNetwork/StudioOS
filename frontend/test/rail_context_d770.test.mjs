/**
 * D770 (#2095, D720 F3), PR 3 — every fill, draft, upload and recording run
 * carries `rail: { page, option, record }`. The request headers take the
 * option and the record from D768's page map (`currentRail()`); the page stays
 * the rail's workspace, the key the switch is checked under. A zone draft
 * names its option while it runs or is shown, as the fill band does.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_context_d770.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { clearRailPage, railPageHeaders, recordKey, setRailPage } from '../src/lib/railPage.js';
import { currentRail, setCurrentRail } from '../src/lib/railPages.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { api } from '../src/lib/api.js';
import ZoneDraft from '../src/workspaces/ZoneDraft.jsx';

const h = React.createElement;

test('the headers carry the page map\'s option and record; the page stays the switch\'s key', () => {
  setCurrentRail({ page: 'Founder · Build · Operating systems', option: 'draft:build/retro', record: { type: 'project', id: 3 } });
  try {
    assert.deepEqual(railPageHeaders(), { 'X-Rail-Option': 'draft%3Abuild%2Fretro', 'X-Rail-Record': 'project%3A3' },
      'no rail mounted: no page, so the route\'s page and its switch stand; D768\'s page key is never sent as the page');
    const t = setRailPage('Build');
    assert.deepEqual(railPageHeaders(), { 'X-Rail-Page': 'build', 'X-Rail-Option': 'draft%3Abuild%2Fretro', 'X-Rail-Record': 'project%3A3' });
    clearRailPage(t);
    const own = setRailPage('Validate', 'fill:pain_tag');
    assert.equal(railPageHeaders()['X-Rail-Option'], 'fill%3Apain_tag', 'the rail\'s own open option wins');
    clearRailPage(own);
    setCurrentRail({ page: 'Founder · Validate', option: 'has space', record: { type: 'interview session', id: 9 } });
    assert.deepEqual(railPageHeaders(), {}, 'an option or record that breaks D762\'s rule is not sent');
  } finally { setCurrentRail(null); }
  assert.deepEqual(railPageHeaders(), {}, 'nothing known, nothing sent');
  assert.equal(recordKey({ type: 'interview', id: 12 }), 'interview:12');
  assert.equal(recordKey({ type: 'project' }), null);
  assert.equal(recordKey(null), null);
});

test('request() sends the record beside the page and option', async () => {
  const restore = installDocument();
  const before = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => { seen.push(opts.headers); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const { request } = await import('../src/lib/api.js');
    setCurrentRail({ page: 'Founder · Validate', option: 'transcribe:interview', record: { type: 'interview', id: 41 } });
    await request('/founder/validate/interviews/41/transcribe', { method: 'POST', body: '{}' });
    assert.equal(seen[0]['X-Rail-Record'], 'interview%3A41');
    assert.equal(seen[0]['X-Rail-Option'], 'transcribe%3Ainterview');
  } finally { setCurrentRail(null); globalThis.fetch = before; restore(); }
});

test('a zone draft names its option on the page map while it runs, and lets it go after', async () => {
  const restore = installDocument();
  const orig = { ...api.research };
  let open;
  api.research.zoneDrafts = async () => ({ items: [] });
  api.research.zoneDraftRun = () => new Promise((r) => { open = r; });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  try {
    await act(async () => {
      root.render(h(MemoryRouter, { initialEntries: ['/build/this-week'] },
        h(RailPageProvider, { role: 'founder' }, h(ZoneDraft, { surface: 'build/retro', label: 'Retro', empty: 'Nothing yet.', run: 'Draft it' }))));
    });
    await settle();
    assert.equal(currentRail().option, null, 'nothing open before a run');
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const txt = (n) => (n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(txt).join(''));
    const run = walk(container).find((n) => n.tagName === 'BUTTON' && txt(n).trim() === 'Draft it');
    act(() => { pr(run).onClick(); });
    await settle();
    assert.ok(currentRail().page, 'the page map knows the page');
    assert.equal(currentRail().option, 'draft:build/retro', 'the registry\'s key, while the run is in flight');
    assert.equal(railPageHeaders()['X-Rail-Option'], 'draft%3Abuild%2Fretro', 'so the run\'s request names it');
    await act(async () => { open({ item: { uid: 'd1', body: 'A retro.', accepted: false, cost_usd: 0 } }); });
    await settle();
    assert.equal(currentRail().option, 'draft:build/retro', 'and while its draft is shown');
  } finally {
    await act(async () => root.unmount());
    assert.equal(currentRail().option ?? null, null, 'gone with the band');
    Object.assign(api.research, orig); restore();
  }
});

test('the Worker reads the record header, and CORS lets it through', () => {
  const ctx = readFileSync(new URL('../../cloudflare-worker/src/util/railContext.ts', import.meta.url), 'utf8');
  assert.match(ctx, /export const RAIL_RECORD_HEADER = 'X-Rail-Record';/);
  const index = readFileSync(new URL('../../cloudflare-worker/src/index.ts', import.meta.url), 'utf8');
  assert.match(index, /allowHeaders: \[[^\]]*'X-Rail-Record'[^\]]*\]/);
});
