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
import { readFileSync, readdirSync } from 'node:fs';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  SAFE_TITLE, TITLE_BRAND, WORKSPACE_SCREENS, isPublicTitlePath, routeTitleFor, screenTitle, titleNow, useRouteTitle,
} from '../src/lib/pageTitles.js';
import { ogTagsFor } from '../src/lib/ogRegistry.js';
import { companyDocTitle } from '../src/pages/portfolio/companyModel.js';
import { pageTitle as connectorPageTitle } from '../src/pages/account/connectorPageModel.js';
import { channelPageTitle } from '../src/pages/account/channelPageModel.js';

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

// ── no record value in any title (the issue's "Avoid member names and sensitive records in titles") ──
//
// Every place in frontend/src that sets the tab title: `document.title = …`, `usePageMeta({ title })`,
// `<SitePage title>`, `useProgramsTitle(…)` and Portfolio's `docTitle` prop. A string literal with no
// `${…}`, or a same-file `const NAME = '<literal>'`, is static and passes. Anything else must be listed
// in ALLOWED with why it cannot carry a member's name or a workspace record: a new title built from a
// read fails here until someone decides it may.
const TITLE_SETTERS = [
  [/document\.title\s*=(?!=)\s*([^;\n]+)/g, 'document.title'],
  [/usePageMeta\(\{[^)]*?\btitle:\s*([^,\n}]+)/g, 'usePageMeta'],
  [/<SitePage\b[^>]*?\btitle=(\{[^\n]*?\}|"[^"]*")/g, 'SitePage'],
  [/useProgramsTitle\(([^;\n]+)\);/g, 'useProgramsTitle'],
  [/\bdocTitle=(\{[^\n]*?\}|"[^"]*")/g, 'docTitle'],
];

// `file | expression` → why it names no member and no workspace record.
const RESTORES = 'puts back the title it found on mount';
const ALLOWED = {
  // Plumbing: the value comes from a caller this inventory already covers, or is put back on leaving.
  'lib/pageTitles.js | titleNow(pathname, { loading })': 'the D8681 table: static labels only (tests above)',
  'components/RouteErrorBoundary.jsx | SAFE_TITLE': 'the brand',
  'lib/seo.js | fullTitle': 'usePageMeta’s own title plus the site name; each caller is listed here',
  'lib/seo.js | prevTitle': RESTORES,
  'pages/account/ChannelPage.jsx | previous': RESTORES,
  'pages/account/ConnectorPage.jsx | previous': RESTORES,
  'pages/founder/RoundCallPage.jsx | previous': RESTORES,
  'pages/admin/programs/useProgramsTitle.js | prev': RESTORES,
  'pages/portfolio/PortfolioFrame.jsx | before': RESTORES,
  'pages/portfolio/PortfolioFrame.jsx | docTitle': 'its `docTitle` prop or portfolioTitle(tab); every docTitle= caller is listed here',
  'pages/founder/RoundCallPage.jsx | title': "the literal 'Round calls · Axal VC'",
  'pages/admin/programs/useProgramsTitle.js | programsTitle(page, scope)': 'its callers, listed here',
  // Workspace screens: computed, but only from static labels (each pinned by the next test).
  'pages/account/ChannelPage.jsx | title': 'channelPageTitle: the channel’s fixed card title (WhatsApp, Telegram), never a record',
  'pages/account/ConnectorPage.jsx | title': 'pageTitle: "Connector · Connectors · Axal VC", never the connector’s name (D8681)',
  'pages/investor/PortfolioCompanyPage.jsx | {companyDocTitle(tab)}': 'the tab’s label, never the company (D8681)',
  'pages/portfolio/CompanyPreview.jsx | {previewDocTitle(companyDocTitle(current))}': 'the same, plus "Investor preview"',
  'pages/portfolio/PortfolioPreview.jsx | {docTitle}': 'previewDocTitle(portfolioTitle(tab)): a tab label',
  'pages/investor/dealflow/StudioLens.jsx | DEALS_PAGE_TITLES.root': 'Deals’ static titles (dealFlowModel.js)',
  'workspaces/investor/InvestorDealsRoutes.jsx | pageTitle': 'dealsPageTitle(): Deals’ static titles by zone',
  'pages/admin/programs/ProgramFrame.jsx | `${page.title} · Programs`': 'a programme’s name from the frontend PAGES table or the programme registry: the firm’s own catalogue, the names the public /programs pages publish; never a member or an application',
  "pages/admin/programs/ProgramsCatalogue.jsx | 'Programs', scope?.kind === 'branch' ? scope.label : superAdmin ? 'HQ' : null": 'the viewer’s own branch (an office of the firm), never a member or a record',
  // Public pages: their titles are public content the page exists to publish, the text the prerender
  // bakes or a search engine indexes. None is a workspace screen.
  'pages/ArticleReaderPage.jsx | title': 'a published article’s own title (public /articles/:slug)',
  'pages/insights/PublicInsight.jsx | publication.title': 'a published Insight’s title (public)',
  'pages/docs/DocsLayout.jsx | guideMeta?.title': 'a Help guide’s title (static help content)',
  "pages/AuthorProfilePage.jsx | {author?.name || 'Author'}": 'a public author profile: the byline the author published under',
  'pages/influencer/HandlePage.jsx | {isLive ? `${d.name}': 'a public invite page whose owner chose to publish their name on it',
  "pages/jobs/PublicJobDetailPage.jsx | {job?.title || 'Jobs'}": 'a published job posting’s title (public)',
  'pages/site/DoorPage.jsx | {meta.title}': 'PRODUCT_PAGES’ static marketing copy',
  'pages/site/LegalDocument.jsx | {title}': 'each legal page passes its own static document name',
  'pages/programs/ProgramKeyPage.jsx | {program.og.title}': 'the programme registry’s public Open Graph title',
  'pages/programs/kit.jsx | {program.og.title}': 'the programme registry’s public Open Graph title',
  'pages/CirclesPage.jsx | {CIRCLES_COPY.title}': 'static marketing copy',
  'pages/events/PublicEventsPage.jsx | {EVENTS_COPY.title}': 'static marketing copy',
  'pages/jobs/PublicJobsPage.jsx | {JOBS_COPY.title}': 'static marketing copy',
};

/** True for a string literal with no interpolation, or a `const NAME = '<literal>'` the same file defines. */
function isStatic(expr, source) {
  const e = expr.replace(/^\{([\s\S]*)\}$/, '$1').trim();
  if (/^(['"])[^'"]*\1$/.test(e)) return true;
  if (/^`[^`$]*`$/.test(e)) return true;
  if (/^[A-Z][A-Z0-9_]*$/.test(e)) return new RegExp(`const ${e} = (['"])[^'"\`$]*\\1;`).test(source);
  return false;
}

function titleSetters() {
  const root = new URL('../src/', import.meta.url);
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(at);
      else if (/\.(m?js|jsx|tsx?)$/.test(entry.name)) {
        const source = readFileSync(at, 'utf8');
        const file = decodeURIComponent(at.pathname.slice(root.pathname.length));
        for (const [re, kind] of TITLE_SETTERS) for (const m of source.matchAll(re)) found.push({ file, kind, expr: m[1].trim(), source });
      }
    }
  };
  walk(root);
  return found;
}

test('D8681: no tab title in frontend/src is built from a member’s name or a workspace record', () => {
  const found = titleSetters();
  assert.ok(found.length > 40, `the inventory reads every title setter (found ${found.length})`);
  const unexplained = found.filter((s) => !isStatic(s.expr, s.source) && !Object.hasOwn(ALLOWED, `${s.file} | ${s.expr}`));
  assert.deepEqual(unexplained.map((s) => `${s.file} | ${s.kind} | ${s.expr}`), [],
    'a title built from a value: make it a screen-only label ("<Screen> · Axal VC"), or list it in ALLOWED with why it names no member or record');
  // Every allowance still matches something, so the list cannot keep a stale entry.
  const seen = new Set(found.map((s) => `${s.file} | ${s.expr}`));
  assert.deepEqual(Object.keys(ALLOWED).filter((k) => !seen.has(k)), [], 'an ALLOWED entry no longer matches a title setter');
  // The deal room's title is a fixed screen label.
  assert.match(read('../src/pages/DealRoomPage.jsx'), /export const DEAL_ROOM_TITLE = 'Deal room · Axal VC';/);
});

test('D8681: the deal room, a Portfolio company and a connector page name the screen, never the record', () => {
  const NAME = 'Ada Lovelace Robotics';
  // Portfolio: the tab label and the screen, whatever the company is called.
  assert.equal(companyDocTitle(), 'Company · Portfolio · Axal VC');
  assert.equal(companyDocTitle('financials'), 'Financials · Company · Portfolio · Axal VC');
  for (const tab of ['overview', 'financials', 'reports', 'support', 'activity', NAME]) {
    assert.match(companyDocTitle(tab), /^((Financials|Reports|Support|Activity) · )?Company · Portfolio · Axal VC$/, tab);
  }
  // A connector: the record's display name never reaches the tab.
  const ready = { state: 'ready', p: { key: 'stripe', display_name: NAME } };
  assert.equal(connectorPageTitle(ready), 'Connector · Connectors · Axal VC');
  assert.equal(connectorPageTitle({ state: 'unknown' }), 'Connectors · Axal VC');
  // A channel page: its fixed card title only.
  assert.equal(channelPageTitle({ state: 'ready', key: 'whatsapp', name: NAME }), 'WhatsApp Business · Connectors · Axal VC');
});
