/**
 * D1315 (#2418) — Account › Developer is Account › Builder: the section for
 * every profile, its pages and drawers at /account/builder, the old addresses
 * forwarded with their sub-path and query (a 308 from the Worker, a replace in
 * the app), the words that moved, and the MCP tool renamed with its alias.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/builder_d1315.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  BUILDER_PAGES, BUILDER_WORDS, builderViewFor, builderPathFor, builderTrailFor, legacyBuilderPath,
} from '../src/pages/account/builder/builderModel.js';
import BuilderSection, { BuilderHandoff, MOVED_KEY, NOT_YET } from '../src/pages/account/builder/BuilderSection.jsx';
import { BuilderRedirect } from '../src/pages/account/builder/BuilderRedirect.jsx';
import { builderRedirectTarget, LEGACY_BUILDER_PATHS } from '../../cloudflare-worker/src/services/builderRedirect.ts';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { accountIndexGroups, accountPathFor } from '../src/pages/account/accountPhone.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const h = React.createElement;
const html = (el, at = '/account/builder') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [at] }, el));
// The fake document keeps no attributes; React keeps each element's props on the node.
const all = (n, out = []) => { out.push(n); for (const c of n.childNodes || []) all(c, out); return out; };
const props = (n) => n[Object.keys(n).find((k) => k.startsWith('__reactProps$'))] || {};
const byTestId = (root, id) => all(root).find((n) => props(n)['data-testid'] === id) || null;
// A lone text child is set as the element's textContent, not as a text node.
const textOf = (n) => all(n).map((x) => (x.nodeType === 3 ? x.nodeValue ?? x.textContent ?? '' : x.childNodes?.length ? '' : x.textContent || '')).join(' ');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('the four pages and four drawers, each at its own address under /account/builder', () => {
  assert.deepEqual(BUILDER_PAGES.map((p) => [p.label, p.path]), [
    ['MCP and services', '/account/builder'], ['API keys', '/account/builder/keys'],
    ['API usage', '/account/builder/usage'], ['Activity', '/account/builder/activity'],
  ]);
  const cases = [
    ['/account/builder', { page: 'services', drawer: null }, 'Builder › MCP and services'],
    ['/account/builder/keys', { page: 'keys', drawer: null }, 'Builder › API keys'],
    ['/account/builder/usage', { page: 'usage', drawer: null }, 'Builder › API usage'],
    ['/account/builder/activity', { page: 'activity', drawer: null }, 'Builder › Activity'],
    ['/account/builder/assistants/g1', { page: 'services', drawer: { kind: 'assistant', id: 'g1' } }, 'Builder › AI assistants'],
    ['/account/builder/services/hubspot', { page: 'services', drawer: { kind: 'service', id: 'hubspot' } }, 'Builder › MCP and services › Services'],
    ['/account/builder/keys/k7f3', { page: 'keys', drawer: { kind: 'key', id: 'k7f3' } }, 'Builder › API keys'],
    ['/account/builder/activity/ex1', { page: 'activity', drawer: { kind: 'request', id: 'ex1' } }, 'Builder › Activity'],
  ];
  for (const [path, view, trail] of cases) {
    assert.deepEqual(builderViewFor(path), view, path);
    assert.equal(builderPathFor(view), path, path);
    assert.equal(builderTrailFor(view), trail, path);
  }
  // Anything the section does not know opens its default page, never a drawer.
  for (const path of ['/account/builder/nope', '/account/builder/assistants', '/account/builder/keys/a%20b', '/account/builder/services/x/y']) {
    assert.deepEqual(builderViewFor(path), { page: 'services', drawer: null }, path);
  }
  assert.equal(accountPathFor({ section: 'builder', builderView: { page: 'keys', drawer: null } }), '/account/builder/keys');
});

test('/account/developer… moves to /account/builder…, the sub-path and query kept, in the Worker and in the app alike', () => {
  const cases = [
    ['/account/developer', '', '/account/builder'],
    ['/account/developer/', '', '/account/builder'],
    ['/account/developer/activity', '', '/account/builder/activity'],
    ['/account/developer/keys/k7f3', '?from=email', '/account/builder/keys/k7f3?from=email'],
    ['/account/developer/assistants/g1', '?tab=calls&x=1', '/account/builder/assistants/g1?tab=calls&x=1'],
    ['/account/developer/services/hubspot', '', '/account/builder/services/hubspot'],
    ['/account/developer/usage', '?key=k1', '/account/builder/usage?key=k1'],
  ];
  for (const [path, search, want] of cases) {
    // Mutation checked: drop `rest` from either rule → the sub-path is lost and this fails.
    assert.equal(builderRedirectTarget(path, search), want, `worker ${path}`);
    assert.equal(legacyBuilderPath(path, search), want, `app ${path}`);
  }
  for (const path of ['/account/developers', '/account/builder', '/developer', '/account/usage']) {
    assert.equal(builderRedirectTarget(path), null, path);
    assert.equal(legacyBuilderPath(path), null, path);
  }
});

test('the Worker answers a page load of an old address with a 308, and runs first only for those two paths', () => {
  const index = read('cloudflare-worker/src/index.ts');
  // Mutation checked: 301 or 302 → this fails.
  assert.match(index, /for \(const path of LEGACY_BUILDER_PATHS\) \{\n  app\.on\(\['GET', 'HEAD'\], path, \(c\) => \{[\s\S]*?c\.redirect\(builderRedirectTarget\(url\.pathname, url\.search\) \?\? '\/account\/builder', 308\);/);
  assert.deepEqual([...LEGACY_BUILDER_PATHS], ['/account/developer', '/account/developer/*']);
  const toml = read('wrangler.toml');
  const lists = [...toml.matchAll(/^run_worker_first = (\[.*\])$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(lists.length, 2, 'the top-level and production [assets] blocks');
  for (const list of lists) for (const p of LEGACY_BUILDER_PATHS) assert.ok(list.includes(p), p);
  for (const list of lists) assert.ok(!list.some((p) => p.startsWith('/account/builder')), 'Builder itself is the SPA, served by the assets binding');
});

test('in the app, a followed old link lands on the new address with its query and hash, and is counted', async () => {
  const restore = installDocument();
  let at = '';
  function Where() { const l = useLocation(); at = `${l.pathname}${l.search}${l.hash}`; return null; }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/account/developer/assistants/g1?tab=calls#recent'] }, h(Routes, null,
      h(Route, { path: '/account/developer/*', element: h(BuilderRedirect) }),
      h(Route, { path: '/account/builder/*', element: h(Where) })))));
    assert.equal(at, '/account/builder/assistants/g1?tab=calls#recent');
  } finally { await act(async () => root.unmount()); restore(); }
  for (const path of LEGACY_BUILDER_PATHS) assert.ok(REDIRECT_ROUTES.some((r) => r.path === path && !r.keep), `${path} counted until #2319`);
});

test('Builder is a section for every profile, in the section column with its four pages', () => {
  const page = read('frontend/src/pages/SettingsPage.jsx');
  // Mutation checked: put `roles: ['admin']` back → this fails.
  assert.match(page, /\n  \{ id: 'builder', label: 'Builder' \},\n/);
  assert.doesNotMatch(page, /id: 'developer'/);
  assert.match(page, /subpages=\{\{ usage: USAGE_PAGES, builder: BUILDER_PAGES \}\}/);
  const app = read('frontend/src/App.jsx');
  for (const p of ['/account/builder', '/account/builder/*']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SettingsPage />)} />`), p);
  }
  for (const role of ['founder', 'investor', 'exploring', 'admin']) {
    const builder = accountIndexGroups({ role }).find((g) => g.label === 'Builder');
    assert.deepEqual(builder?.rows.map((r) => r.to), BUILDER_PAGES.map((p) => p.path), role);
  }
});

test('the pane: the eyebrow trail, one h2 "Builder", the page line, and honest waits', () => {
  const storage = { getItem: () => null, setItem: () => {} };
  const services = html(h(BuilderSection, { view: builderViewFor('/account/builder'), storage }));
  const t = text(services);
  assert.match(t, /^Builder › MCP and services Builder Where assistants and your API keys connect to StudioOS/);
  assert.equal((services.match(/<h2/g) || []).length, 1);
  assert.match(services, /<nav aria-label="Builder"/);
  assert.match(t, /StudioOS MCP server https:\/\/axal\.vc\/mcp/);
  assert.match(t, new RegExp(BUILDER_WORDS.movedNotice.replace('.', '\\.')));
  for (const id of ['tools', 'limits', 'services']) assert.match(services, new RegExp(`data-testid="builder-wait-${id}"`), id);
  assert.match(t, new RegExp(NOT_YET));
  const keysHtml = html(h(BuilderSection, { view: builderViewFor('/account/builder/keys'), storage }), '/account/builder/keys');
  const keys = text(keysHtml);
  assert.match(keys, /^Builder › API keys Builder Keys your own scripts use to call StudioOS\./);
  // #2480: API keys is live, so its page draws instead of a wait.
  assert.match(keysHtml, /data-testid="apik-page"/);
  assert.doesNotMatch(keysHtml, /builder-wait-keys/);
  const drawer = html(h(BuilderSection, { view: builderViewFor('/account/builder/assistants/g1'), storage }), '/account/builder/assistants/g1');
  assert.match(text(drawer), /^Builder › AI assistants Builder/);
  assert.match(drawer, /data-testid="builder-drawer-assistant"/);
  assert.match(drawer, /role="dialog" aria-modal="true" aria-labelledby="[^"]+"[^>]*data-testid="builder-drawer-assistant"[^>]*data-width="560"/, 'D1317: the drawer is the shared Sheet, 560px');
  assert.match(drawer, /data-testid="builder-wait-services"/, 'the page stays drawn under the sheet');
  assert.doesNotMatch(drawer, /builder-moved-notice/, 'the notice is the page’s, not a drawer’s');
  // Never sample data: no bracketed canvas placeholder reaches the page.
  for (const m of [services, keys, drawer]) assert.doesNotMatch(m, /\[(Assistant|Vendor|Northwind|Deploy bot|CRM)/);
});

test('the moved notice shows once per member: Dismiss remembers it', async () => {
  const restore = installDocument();
  const kept = new Map();
  const storage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(MemoryRouter, null, h(BuilderSection, { storage }))));
    const notice = byTestId(container, 'builder-moved-notice');
    assert.ok(notice);
    const dismiss = all(notice).find((n) => n.tagName === 'BUTTON');
    await act(async () => props(dismiss).onClick());
    assert.equal(byTestId(container, 'builder-moved-notice'), null);
    assert.equal(kept.get(MOVED_KEY), '1');
  } finally { await act(async () => root.unmount()); restore(); }
  const again = html(h(BuilderSection, { storage }));
  assert.doesNotMatch(again, /builder-moved-notice/);
});

test('Connectors keeps one card for the assistants, with their count and "Open Builder →"', async () => {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    const api = { grants: async () => ({ grants: [{ id: 'g1' }, { id: 'g2' }] }) };
    await act(async () => root.render(h(MemoryRouter, null, h(BuilderHandoff, { api }))));
    const card = byTestId(container, 'builder-handoff');
    assert.equal(props(card).id, 'ai-assistants', '/account/connectors#ai-assistants still lands on it');
    assert.match(textOf(card), /AI assistants/);
    assert.match(textOf(card), /2\s+connected/);
    const link = all(card).find((n) => n.tagName === 'A');
    assert.equal(textOf(link).trim(), 'Open Builder →');
    assert.equal(props(link).href, '/account/builder');
  } finally { await act(async () => root.unmount()); restore(); }
  // A failed read draws no number, never a zero.
  const failed = html(h(BuilderHandoff, { api: { grants: async () => { throw new Error('x'); } } }));
  assert.doesNotMatch(failed, /connected<\/p>/);
  assert.match(read('frontend/src/pages/account/AccountConnectors.jsx'), /<BuilderHandoff \/>/);
  assert.doesNotMatch(read('frontend/src/pages/account/AccountConnectors.jsx'), /<AssistantsSection \/>/);
});

test('every internal link names /account/builder; only the redirects still name /account/developer', () => {
  for (const f of ['frontend/src/pages/account/aiTokensModel.js', 'frontend/src/pages/trust/MemberData.jsx', 'frontend/src/pages/founder/assistantSession.js', 'frontend/src/pages/account/accountPhone.js']) {
    const src = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.doesNotMatch(src, /['"`]\/account\/developer/, f);
  }
  assert.match(read('frontend/src/pages/account/aiTokensModel.js'), /keys: '\/account\/builder\/keys'/);
  assert.match(read('frontend/src/pages/founder/assistantSession.js'), /ASSISTANTS_HREF = '\/account\/builder'/);
});
