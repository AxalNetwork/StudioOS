/**
 * D5074 slice 3 (#5074) — the Investor narrative draws its controls from the versions read's capability map, never
 * from the account. Each viewer is the map the Worker sends it (`_narrative_capabilities.mjs`, pinned to the Worker's
 * function by `cloudflare-worker/test/narrative_capabilities_5074.test.ts`): the founder, a writer who is not the
 * founder (edit without check), an admin with a reason, and a reply with no map. A page mounted with the account's
 * `admin` flag but the founder's map draws the founder's controls: the map wins.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_capabilities_5074.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { NarrativeTabPage } from '../src/pages/raise/narrative/NarrativeTool.jsx';
import { narrativeStanding, tabSearch, versionHref } from '../src/pages/raise/narrative/narrativeModel.js';
import { acceptFixHref } from '../src/pages/raise/narrative/claimsModel.js';
import { ADMIN_CAPS, COFOUNDER_CAPS, FOUNDER_CAPS } from './_narrative_capabilities.mjs';

const h = React.createElement;
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const REASON = { id: 1, reason: 'Quarterly portfolio review', by: { name: 'Ada Admin', kind: 'admin' }, created_at: '2026-10-24 17:00:00', expires_at: '2026-10-25 01:00:00' };
const NOTE = { id: 3, version: 4, body: 'Lead Traction with retention before revenue.', author: { name: 'Ada Admin', kind: 'admin' }, created_at: '2026-10-24 17:05:00' };
const VERSION = { title: 'v4 · seed fund', main: [{ key: 'narrative', title: 'The narrative', rows: [{ a: 'One-liner', b: 'Close the month in a day.' }] }], side: [], actions: [], activity: [] };
const OPTIONS = { versions: [{ value: '4', label: 'v4 · seed fund' }, { value: '3', label: 'v3 · angel' }] };

async function mounted(element, handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push([options.method || 'GET', String(u), options.body || null]); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/raise/investor-narrative/story?project_id=1'] }, element)));
  // Settle the reads by draining the event loop's check phase, never a wall-clock wait (D5614).
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, flush, text: () => text(container), props, byId,
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const narrativeHandler = (url) => {
  if (/\/narrative\/4\?/.test(url)) return response({ version: 4, meta: { state: 'ok', investor_type: 'seed_fund' }, sections: { state: 'ok', items: [{ key: 'problem', body: 'Close the month in a day.' }] }, bindings: { state: 'ok', items: [] } });
  if (url.includes('/decks/sources')) return response({ items: [] });
  if (url.includes('/form-options')) return response(OPTIONS);
  if (/\/records\/4\?/.test(url)) return response(VERSION);
  if (url.includes('/narrative/notes')) return response({ notes: [NOTE], viewer: 'founder' });
  if (url.includes('/narrative/reads')) return response({ reads: [REASON], mine: null, viewer: 'founder' });
  return response({});
};

/** The narrative's replies, with the versions read carrying `caps` (or no map when `caps` is undefined). */
const as = (caps) => (url, options) => {
  if (url.includes('/form-options')) return response(caps === undefined ? OPTIONS : { ...OPTIONS, capabilities: caps });
  if (url.includes('/modules/investor-narrative')) return response({ parts: { narrative: { state: 'ok', versions: [4, 3].map((v) => ({ version: v, audience: `v${v}`, based_on: 'Blank', saved: '2026-10-24', by: 'Fay Founder', read_by: null })) } } });
  if (url.includes('/narrative/compare')) return response({ pairs: [] });
  return narrativeHandler(url, options);
};

test('the standing: each map reads as it says; no map, or a non-true value, allows nothing', () => {
  assert.deepEqual(
    (({ known, admin, readOnly, checks, notes }) => ({ known, admin, readOnly, checks, notes }))(narrativeStanding(FOUNDER_CAPS)),
    { known: true, admin: false, readOnly: false, checks: true, notes: true });
  assert.deepEqual(
    (({ admin, readOnly, checks }) => ({ admin, readOnly, checks }))(narrativeStanding(COFOUNDER_CAPS)),
    { admin: false, readOnly: false, checks: false });
  assert.deepEqual(
    (({ admin, readOnly, checks, notes }) => ({ admin, readOnly, checks, notes }))(narrativeStanding(ADMIN_CAPS)),
    { admin: true, readOnly: true, checks: false, notes: true });
  for (const none of [null, undefined, 'edit', { edit: 'true' }, { edit: 1 }]) {
    const s = narrativeStanding(none);
    assert.equal(s.readOnly, true, JSON.stringify(none));
    assert.equal(s.admin, false);
    assert.equal(s.checks, false);
  }
});

test('Story: the editor is drawn exactly when the map says edit, and an admin map gets notes, no editor, no reads list', async () => {
  // Mutation checked: `readOnly = !standing.can('edit')` → `readOnly = admin` draws the editor for the no-map reply.
  for (const [label, caps, editor, admin] of [
    ['founder', FOUNDER_CAPS, true, false],
    ['writer (not the founder)', COFOUNDER_CAPS, true, false],
    ['admin with a reason', ADMIN_CAPS, false, true],
    ['no map', undefined, false, false],
  ]) {
    const page = await mounted(h(NarrativeTabPage, { tab: 'story', projectId: 1, search: '?project_id=1', admin, cards: [] }), as(caps));
    try {
      assert.equal(page.testIds().includes('story-words'), editor, `${label}: the editor`);
      assert.equal(page.testIds().includes('story-read-only'), !editor, `${label}: read only`);
      assert.equal(page.testIds().includes('narrative-reads'), caps !== ADMIN_CAPS, `${label}: who read it, never for an admin`);
      if (caps === ADMIN_CAPS) assert.match(page.text(), /Add note/);
      assert.ok(page.requests.every(([m]) => m === 'GET'), `${label}: mounting writes nothing`);
    } finally { await page.close(); }
  }
});

test('the map wins over the account: an admin account with the founder\'s map draws the founder\'s controls', async () => {
  const page = await mounted(h(NarrativeTabPage, { tab: 'story', projectId: 1, search: '?project_id=1', admin: true, cards: [] }), as(FOUNDER_CAPS));
  try {
    assert.ok(page.testIds().includes('story-words'));
    assert.ok(!/Add note/.test(page.text()));
  } finally { await page.close(); }
  const founder = await mounted(h(NarrativeTabPage, { tab: 'story', projectId: 1, search: '?project_id=1', admin: false, cards: [] }), as(ADMIN_CAPS));
  try { assert.ok(!founder.testIds().includes('story-words'), 'a founder account with the admin map edits nothing'); }
  finally { await founder.close(); }
});

test('Versions: Duplicate and "start from" are drawn exactly when the map says edit', async () => {
  for (const [label, caps, writes] of [['founder', FOUNDER_CAPS, true], ['writer', COFOUNDER_CAPS, true], ['admin', ADMIN_CAPS, false], ['no map', undefined, false]]) {
    const page = await mounted(h(NarrativeTabPage, { tab: 'versions', projectId: 1, search: '?project_id=1', cards: [] }), as(caps));
    try {
      assert.equal(page.testIds().includes('narrative-duplicate'), writes, `${label}: Duplicate`);
      assert.equal(page.testIds().includes('narrative-start-from'), writes, `${label}: start from`);
    } finally { await page.close(); }
  }
});

test('a tab link names the venture in the one form, whatever alias came in', () => {
  for (const search of ['?project_id=7', '?project=7', '?project=7&version=3&moved=1', '?project_id=7&project=9']) {
    assert.match(tabSearch(search), /^\?project_id=7(&version=\d+)?$/, search);
    assert.ok(!/[?&]project=/.test(tabSearch(search)), search);
  }
  assert.equal(tabSearch('?project=7&version=3'), '?project_id=7&version=3');
  assert.equal(versionHref(4, '?project=7&version=3'), '/raise/investor-narrative/4?project_id=7');
  assert.equal(acceptFixHref('?project=7', 4, 'problem', 'u1'), '/raise/investor-narrative/story?project_id=7&version=4&section=problem&fix=u1');
  assert.equal(tabSearch('?version=3'), '?version=3', 'no venture, none invented');
});

test('no narrative file parses the venture from the query or decides a tab\'s controls from the account', () => {
  const dir = 'frontend/src/pages/raise/narrative';
  for (const f of readdirSync(new URL(`../../${dir}`, import.meta.url))) {
    if (!/\.(js|jsx)$/.test(f)) continue;
    const src = read(`${dir}/${f}`);
    assert.ok(!/get\('project_id'\)\s*\|\|\s*\w+\.get\('project'\)/.test(src), `${f} parses project_id || project`);
  }
  const tool = read(`${dir}/NarrativeTool.jsx`);
  const page = tool.slice(tool.indexOf('export function NarrativeTabPage'));
  assert.match(page, /const standing = narrativeStanding\(list\.capabilities\);/);
  assert.match(page, /const admin = standing\.admin;/);
  assert.match(page, /const readOnly = standing\.readOnly;/);
  // The account's flag only words a refused read (which carries no map).
  assert.equal((page.match(/adminAccount/g) || []).length, 3, 'declared, explained, and used once for the refusal');
  assert.match(page, /list\.status === 'refused'\) body = adminAccount/);
});
