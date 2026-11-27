/**
 * D8681 (#8681): every in-app screen's browser tab title, from one place (`src/lib/pageTitles.js`),
 * reset on every navigation so a previous screen's title never survives.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/page_titles_8681.test.mjs
 *
 * The real-browser half (cold visits, Back/Forward, the Deals → HQ case) is
 * `frontend/tests/e2e/page_titles_8681.spec.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  SAFE_TITLE, TITLE_BRAND, WORKSPACE_SCREENS, isPublicTitlePath, routeTitleFor, screenTitle, titleNow, useRouteTitle,
} from '../src/lib/pageTitles.js';
import { ogTagsFor } from '../src/lib/ogRegistry.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// The screens the issue names, and what each tab says.
const SCREENS = {
  '/hq': 'HQ · Axal VC',
  '/admin/hq-team': 'Team · HQ · Axal VC',
  '/admin/contracts': 'Contracts · Axal VC',
  '/admin/security': 'Security · Axal VC',
  '/admin/approvals': 'Approvals · Axal VC',
  '/research/companies': 'Companies · Research · Axal VC',
  '/research/funds': 'Funds · Research · Axal VC',
  '/help/tickets': 'Support tickets · Help · Axal VC',
  '/studio': 'Studio · Axal VC', // every licence's landing page (ROLE_DEFAULT_PATH)
  '/exploring': 'Studio · Axal VC',
  '/onboarding/chat': 'Onboarding · Axal VC',
  '/deals': 'Deal flow · Axal VC', // Deals' own root title (dealFlowModel.js)
  '/portfolio/positions': 'Positions · Portfolio · Axal VC', // PortfolioFrame's own format
};

test('D8681: each named screen has its own title, "<Screen> · Axal VC"', () => {
  for (const [path, title] of Object.entries(SCREENS)) assert.equal(routeTitleFor(path), title, path);
  // Contracts and Security, Companies and Funds: the pairs the issue could not tell apart.
  assert.notEqual(routeTitleFor('/admin/contracts'), routeTitleFor('/admin/security'));
  assert.notEqual(routeTitleFor('/research/companies'), routeTitleFor('/research/funds'));
  assert.equal(screenTitle('Companies', 'Research'), 'Companies · Research · Axal VC');
  assert.equal(TITLE_BRAND, 'Axal VC');
});

test('D8681: a public route keeps the title its prerendered HTML carries (Terms, Privacy, Help, Team)', () => {
  for (const path of ['/terms', '/privacy', '/help', '/team', '/', '/trust']) {
    assert.equal(routeTitleFor(path), ogTagsFor(path).title, path);
    assert.ok(isPublicTitlePath(path), path);
  }
  assert.equal(routeTitleFor('/terms'), 'Terms of Service — Axal VC StudioOS');
  // A workspace path the registry would otherwise catch by prefix is the workspace's.
  assert.equal(isPublicTitlePath('/help/tickets'), false);
  assert.equal(isPublicTitlePath('/trust/me'), false);
  assert.equal(routeTitleFor('/trust/me'), 'Trust · Axal VC');
});

test('D8681: a record page names the screen, never the record; an unknown address names nothing', () => {
  assert.equal(routeTitleFor('/admin/contracts/Acme Seed SAFE'), 'Contracts · Axal VC');
  assert.equal(routeTitleFor('/research/companies/company/acme-robotics'), 'Companies · Research · Axal VC');
  assert.equal(routeTitleFor('/admin/accounts/ada-lovelace'), 'Accounts · Axal VC');
  // A path is under a screen only by whole segments: /hqx is not HQ, /studios not Studio.
  for (const path of ['/no-such-screen', '/zz/yy', '/hqx', '/studios']) assert.equal(routeTitleFor(path), SAFE_TITLE, path);
  assert.equal(SAFE_TITLE, 'Axal VC');
  // Every hand-named screen is a static label: no parameter, no placeholder.
  for (const [path, label] of WORKSPACE_SCREENS) {
    assert.ok(!/[:*]/.test(path) && !/[:{}$]/.test(label), path);
    assert.ok(routeTitleFor(path).endsWith(' · Axal VC'), path);
  }
});

test('D8681: while the session loads a workspace path says only the brand; a public one keeps its title', () => {
  assert.equal(titleNow('/hq', { loading: true }), SAFE_TITLE);
  assert.equal(titleNow('/hq', { loading: false }), 'HQ · Axal VC');
  assert.equal(titleNow('/terms', { loading: true }), ogTagsFor('/terms').title);
});

// ── the hook, in a router ───────────────────────────────────────────────────
let go;
function Title({ loading = false }) { useRouteTitle(useLocation().pathname, { loading }); return null; }
function Nav() { go = useNavigate(); return null; }
// Deals as it is: it sets its title and never puts it back (InvestorDealsRoutes.jsx).
function Deals() { useEffect(() => { document.title = 'Deal flow · Axal VC'; }, []); return null; }
// A page that names itself more narrowly than the table, as a Deals tab or a Help guide does.
function Narrow() { useEffect(() => { document.title = 'Compare · Axal VC'; }, []); return null; }
function Blank() { return null; }

async function mount(url, props = {}) {
  const restore = installDocument();
  document.title = 'StudioOS, the founder workspace — Axal VC StudioOS'; // the shell's
  const container = document.createElement('div');
  const root = createRoot(container);
  const tree = (p) => React.createElement(MemoryRouter, { initialEntries: [url] },
    React.createElement(Title, p), React.createElement(Nav),
    React.createElement(Routes, null,
      React.createElement(Route, { path: '/deals', element: React.createElement(Deals) }),
      React.createElement(Route, { path: '/deals/compare', element: React.createElement(Narrow) }),
      React.createElement(Route, { path: '*', element: React.createElement(Blank) })));
  await act(async () => { root.render(tree(props)); });
  return {
    async to(where) { await act(async () => { go(where); }); },
    async rerender(p) { await act(async () => { root.render(tree(p)); }); },
    async done() { await act(async () => root.unmount()); restore(); },
  };
}

test('D8681: a cold visit replaces the shell title; Deals → HQ leaves no "Deal flow"; Back and Forward follow', async () => {
  const app = await mount('/admin/contracts');
  try {
    assert.equal(document.title, 'Contracts · Axal VC');
    await app.to('/deals');
    assert.equal(document.title, 'Deal flow · Axal VC');
    await app.to('/hq');
    assert.equal(document.title, 'HQ · Axal VC');
    await app.to(-1);
    assert.equal(document.title, 'Deal flow · Axal VC');
    await app.to(-1);
    assert.equal(document.title, 'Contracts · Axal VC');
    await app.to(1);
    await app.to(1);
    assert.equal(document.title, 'HQ · Axal VC');
    await app.to('/no-such-screen');
    assert.equal(document.title, SAFE_TITLE);
  } finally { await app.done(); }
});

test('D8681: a page that names itself more narrowly still wins over the table', async () => {
  const app = await mount('/deals/compare');
  try { assert.equal(document.title, 'Compare · Axal VC'); } finally { await app.done(); }
});

test('D8681: a cold public visit keeps its prerendered title; a later visit to it sets it', async () => {
  const app = await mount('/help/founders/a-guide');
  try {
    assert.equal(document.title, 'StudioOS, the founder workspace — Axal VC StudioOS');
    await app.to('/hq');
    await app.to('/terms');
    assert.equal(document.title, ogTagsFor('/terms').title);
  } finally { await app.done(); }
});

test('D8681: loading shows the brand, then the screen', async () => {
  const app = await mount('/admin/security', { loading: true });
  try {
    assert.equal(document.title, SAFE_TITLE);
    await app.rerender({ loading: false });
    assert.equal(document.title, 'Security · Axal VC');
  } finally { await app.done(); }
});

test('D8681: App mounts the title before its routes, and a crashed route falls back to the brand', () => {
  const app = read('../src/App.jsx');
  const at = app.indexOf('<RouteTitle />');
  assert.ok(at > 0, 'App.jsx renders <RouteTitle />');
  const suspense = app.indexOf('<Suspense fallback={<div className="flex items-center justify-center h-screen', at);
  assert.ok(suspense > at && app.indexOf('<Routes location={lensLocation || location}>', at) > suspense,
    'RouteTitle sits before the Suspense that holds <Routes>, so its effect runs first');
  // Only a session with no cached user is "not known yet": the cached user's background re-sync flipped every
  // settled title to the brand and back on each navigation, which the browser spec caught.
  assert.match(app, /function RouteTitle\(\) \{[\s\S]{0,200}useRouteTitle\(useLocation\(\)\.pathname, \{ loading: !!loading && !user \}\)/);
  const boundary = read('../src/components/RouteErrorBoundary.jsx');
  assert.match(boundary, /componentDidCatch\([\s\S]{0,600}document\.title = SAFE_TITLE/);
});
