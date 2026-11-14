/**
 * D5074 slice 4 (#5074) — Capital relationships draws staff's support view and the founder's tabs from the module
 * read's capability map, never from the account. Each viewer is the map the Worker sends it (`_caprel_capabilities.mjs`,
 * pinned to the Worker's function by `cloudflare-worker/test/caprel_capabilities_5074.test.ts`): the owner or a
 * co-founder, staff, and a refused read with no map. The account's admin flag opens the support door only when the
 * read was refused; when the map and the account disagree, the map wins.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/caprel_capabilities_5074.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { CapRelTabPage } from '../src/pages/raise/caprel/CapRelTool.jsx';
import { capRelStanding, tabHref, tabSearch, TABS } from '../src/pages/raise/caprel/capRelModel.js';
import { CAPREL_STAFF_CAPS, CAPREL_WORKER_CAPS } from './_caprel_capabilities.mjs';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

async function mounted(element) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const prevMatch = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    all, props, flush, text: () => text(document.body), byId: (id) => all(id)[0],
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = prevMatch; restore(); },
  };
}

/** A fetch that answers by path; `calls` records method, path and body. */
function stubFetch(answer) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'http://x').pathname.replace(/^\/api/, '');
    const method = init.method || 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const [status, body] = answer(method, path, init);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}

const MODULE = '/cycles/raise/modules/capital-relationships';
/** The module read answers with `caps` (a 403 when `caps` is null); every other read is an empty, readable answer. */
const answering = (caps) => (m, p) => {
  if (m === 'GET' && p === MODULE) return caps ? [200, { module: { slug: 'capital-relationships' }, records: { rows: [] }, capabilities: caps }] : [403, { detail: 'Forbidden' }];
  if (p.endsWith('/support-reads')) return [200, { reads: [], has_more: false }];
  return [200, { items: [], rows: [] }];
};

test('the standing: each map reads as it says; no map, or a non-true value, allows nothing', () => {
  assert.deepEqual((({ known, support, works, supportReads }) => ({ known, support, works, supportReads }))(capRelStanding(CAPREL_WORKER_CAPS)),
    { known: true, support: false, works: true, supportReads: true });
  assert.deepEqual((({ support, works, supportReads }) => ({ support, works, supportReads }))(capRelStanding(CAPREL_STAFF_CAPS)),
    { support: true, works: false, supportReads: false });
  for (const none of [null, undefined, 'work', { support_read: 'true', admin_reason_required: true }, { work: 1 }]) {
    const s = capRelStanding(none);
    assert.equal(s.support, false, JSON.stringify(none));
    assert.equal(s.works, false);
    assert.equal(s.supportReads, false);
  }
});

test('staff\'s map draws the support gate on every tab, whatever the account says; the worker\'s map never does', async () => {
  // Mutation checked: `const support = standing.support || ...` → `adminAccount` draws the founder's tabs for staff's map here.
  for (const tab of TABS.map((t) => t.id).filter((id) => id !== 'overview')) {
    for (const adminAccount of [false, true]) {
      const fetch = stubFetch(answering(CAPREL_STAFF_CAPS));
      const page = await mounted(h(CapRelTabPage, { tab, projectId: 7, admin: adminAccount, viewer: 'admin' }));
      try {
        assert.ok(page.byId('caprel-support-page'), `${tab}, account admin=${adminAccount}: the gate`);
        assert.deepEqual(fetch.calls.map((c) => [c.method, c.path]), [['GET', MODULE]], `${tab}: only the summary read before a reason`);
      } finally { await page.close(); fetch.restore(); }
    }
    const fetch = stubFetch(answering(CAPREL_WORKER_CAPS));
    const page = await mounted(h(CapRelTabPage, { tab, projectId: 7, admin: true, viewer: 'admin' }));
    try { assert.ok(!page.byId('caprel-support-page'), `${tab}: an admin account with the worker's map works the tab`); }
    finally { await page.close(); fetch.restore(); }
  }
});

test('a refused read carries no map: the account opens only the support door; anyone else meets the tab\'s own refusal', async () => {
  for (const [adminAccount, gate] of [[true, true], [false, false]]) {
    const fetch = stubFetch(answering(null));
    const page = await mounted(h(CapRelTabPage, { tab: 'pipeline', projectId: 7, admin: adminAccount, viewer: 'admin' }));
    try {
      assert.equal(Boolean(page.byId('caprel-support-page')), gate, `account admin=${adminAccount}`);
      assert.ok(fetch.calls.every((c) => c.method === 'GET'), 'nothing is written');
    } finally { await page.close(); fetch.restore(); }
  }
});

test('Activity draws who read with a reason exactly when the map says support_reads', async () => {
  for (const [label, caps, card] of [['worker', CAPREL_WORKER_CAPS, true], ['worker without support_reads', { ...CAPREL_WORKER_CAPS, support_reads: false }, false]]) {
    const fetch = stubFetch(answering(caps));
    const page = await mounted(h(CapRelTabPage, { tab: 'activity', projectId: 7 }));
    try {
      assert.equal(Boolean(page.byId('caprel-support-reads')), card, label);
      assert.equal(fetch.calls.some((c) => c.path.endsWith('/support-reads')), card, `${label}: the list is read only when drawn`);
    } finally { await page.close(); fetch.restore(); }
  }
});

test('a tab link names the venture in the one form, whatever alias came in', () => {
  for (const search of ['?project_id=7', '?project=7', '?project=7&moved=1', '?project_id=7&project=9']) assert.equal(tabSearch(search), '?project_id=7', search);
  assert.equal(tabSearch('?project=abc'), '', 'an id that is not a number names no venture');
  assert.equal(tabSearch(''), '');
  assert.equal(tabHref(TABS[1], '?project=7'), `/raise/capital-relationships${TABS[1].path}?project_id=7`);
});

test('no Capital relationships page parses the venture itself or decides the support view from the account', () => {
  const model = src('pages/raise/caprel/capRelModel.js');
  assert.ok(!/get\('project_id'\)\s*\|\|\s*\w+\.get\('project'\)/.test(model), 'the model parses no alias itself');
  const tool = src('pages/raise/caprel/CapRelTool.jsx');
  const page = tool.slice(tool.indexOf('export function CapRelTabPage'));
  assert.match(page, /const standing = capRelStanding\(caps\.capabilities\);/);
  assert.match(page, /const support = standing\.support \|\| \(caps\.status === 'refused' && adminAccount\);/);
  assert.match(page, /else if \(support\) body = <CapRelSupport/);
  assert.ok(!/else if \(admin\) body/.test(page), 'the account flag no longer picks the view');
});
