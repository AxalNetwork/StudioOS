/**
 * D7178 (#7178, canvas #7044, boards RS-16) — Research › Companies: back to the exact page after sign-in, by held
 * licences. Pins the frontend half: the kept destination (return, destination-area and setup-first lists), the 401
 * that keeps the page, the one held-licence rule the research role, the zone list, `canOpenResearch` and
 * `canAddToResearch` read, the Companies boundary in RoleGuard's ROUTE_BOUNDARIES, the admin "View as" answer, the
 * ready screen after setup, the Restored status, the public card link and the profile's Not found and Refused
 * states. The Worker half is `cloudflare-worker/test/research_companies_access_7178.test.ts`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_companies_access_7178.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  RETURN_AFTER_LOGIN_PREFIXES, SETUP_BEFORE_DESTINATION_PREFIXES, destinationArea, destinationNeedsSetup,
  isRestoredArrival, loginRedirectFor, markRestoredArrival, sessionEndedRedirectFor, signInContextFor,
  spendRestoredArrival,
} from '../src/lib/pendingNext.js';
import { RESEARCH_ACCESS, canOpenResearch, researchAreaOf, researchRoleFor } from '../src/lib/researchAccess.js';
import { researchRoleFor as reexported } from '../src/lib/activeRole.js';
import { canAddToResearch } from '../src/pages/research/researchComparisons.js';
import { bucketForPath, zoneForPath } from '../src/workspaces/shellConfig.js';
import {
  COMPANIES_BOUNDARY_ROLES, CompaniesBoundary, DestinationReady, RESTORED_LINES, RestoredStatus, companiesRefusalLine,
} from '../src/pages/research/CompaniesAccess.jsx';
import { RESEARCH_CARDS } from '../src/lib/siteIntelligence.js';
import CompanyProfile from '../src/pages/research/CompanyProfile.jsx';
import { researchCompaniesApi } from '../src/lib/api/researchCompanies.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const APP = read('frontend/src/App.jsx');
const html = (el, url = '/') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, el));

// ------------------------------------------------------------------ the kept destination (RS-16 A)

test('Companies keeps its destination: return, destination-area and setup-first lists', () => {
  assert.ok(RETURN_AFTER_LOGIN_PREFIXES.includes('/research/companies'));
  assert.ok(SETUP_BEFORE_DESTINATION_PREFIXES.includes('/research/companies'));
  for (const p of ['/research/companies', '/research/companies?q=storage&sector=energytech', '/research/companies/company/hg-1']) {
    assert.equal(loginRedirectFor({ pathname: p.split('?')[0], search: p.includes('?') ? `?${p.split('?')[1]}` : '' }),
      `/login?next=${encodeURIComponent(p)}`, p);
    assert.equal(destinationNeedsSetup(p), true, p);
  }
  // Other Research areas keep a bare sign-in, as before.
  assert.equal(loginRedirectFor({ pathname: '/research/markets' }), '/login');
  assert.equal(loginRedirectFor({ pathname: '/research/companiesx' }), '/login', 'a prefix match is a whole segment');
});

test('the screens name only the area: never the search, the company or the filters', () => {
  const area = destinationArea('/research/companies/company/hg-2041?q=storage&country=Norway');
  assert.deepEqual(area, {
    name: 'Companies',
    what: 'Companies is the Research directory of companies, each with the public sources behind it.',
    who: 'You need a Founder or Advisor licence.',
    ready: true,
  });
  assert.doesNotMatch(JSON.stringify(area), /hg-2041|storage|Norway/);
  const ctx = signInContextFor('/research/companies?q=storage');
  assert.equal(ctx.registerHref, `/register?next=${encodeURIComponent('/research/companies?q=storage')}`, 'sign-up keeps the same path');
  assert.equal(ctx.ended, null, 'no session-ended line on a plain arrival');
  assert.equal(destinationArea('/grow').ready, false, 'Grow keeps its silent return');
  assert.equal(destinationArea('//evil.example/research/companies'), null);
});

test('a 401 on a protected page keeps the page and says the session ended', () => {
  const at = { pathname: '/research/companies/company/hg-1', search: '?tab=a', hash: '' };
  assert.equal(sessionEndedRedirectFor(at), `/login?next=${encodeURIComponent('/research/companies/company/hg-1?tab=a')}&ended=1`);
  assert.equal(sessionEndedRedirectFor({ pathname: '/studio' }), '/login', 'an area that keeps nothing goes to a bare sign-in');
  assert.equal(sessionEndedRedirectFor({ pathname: `/research/companies/${'x'.repeat(220)}` }), '/login', 'too long is not kept');
  assert.equal(signInContextFor('/research/companies', '?next=x&ended=1').ended, 'Your session ended. Sign in again to go back to Companies.');
  // The request layer uses it, through the same sanitiser as the route guard.
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /window\.location\.href = sessionEndedRedirectFor\(window\.location\);/);
  assert.doesNotMatch(api, /window\.location\.href = '\/login';/);
  assert.match(read('frontend/src/pages/LoginPage.jsx'), /\{context\?\.ended && \(/);
});

// ------------------------------------------------------------------ one held-licence rule (RS-16 B, RCL12)

const role = (effectiveRole, heldLicences, pathname = '/research/companies', labActive = false) => researchRoleFor({ effectiveRole, heldLicences, pathname, labActive });

test('the research role reads the held licences: the RCL12 table', () => {
  assert.equal(reexported, researchRoleFor, 'App.jsx reads the same function through lib/activeRole');
  assert.equal(role('founder', ['founder']), 'founder');
  assert.equal(role('investor', ['investor', 'founder']), 'founder', 'Investor (primary) + Founder reads Companies as the founder');
  assert.equal(role('partner', ['advisor', 'partner']), 'advisor', 'Partner (primary) + Advisor reads as the advisor');
  assert.equal(role('advisor', ['advisor']), 'advisor');
  assert.equal(role('investor', ['investor']), 'investor', 'Investor only: no licence admits, the route refuses');
  assert.equal(role('investor', ['investor'], '/research/companies', true), 'founder', 'an active Lab reads Companies in the founder shell');
  assert.equal(role('admin', ['admin']), 'founder', 'an admin previews the founder shell, as before');
  assert.equal(role(undefined, []), 'founder');
  // Pages the role browsed as is admitted to are unchanged.
  assert.equal(role('investor', ['investor', 'founder'], '/research/markets'), 'investor');
  assert.equal(role('investor', ['investor', 'founder'], '/research'), 'investor', 'each licence keeps its Research home');
  assert.equal(role('founder', ['founder', 'investor'], '/research/diligence'), 'investor', 'a held Investor reads Diligence');
  assert.equal(role('founder', ['founder'], '/research/diligence', true), 'founder', 'the Lab does not open a plain-guard area');
  assert.equal(researchAreaOf('/research/client-prep'), 'clientPrep');
  assert.equal(researchAreaOf('/research/projects/12'), null);
});

test('zone list, cross-links and actions follow the same role', () => {
  for (const [primary, held] of [['investor', ['investor', 'founder']], ['partner', ['advisor', 'partner']]]) {
    const r = role(primary, held);
    // Before: the investor and partner shells list no Companies zone, so the page drew "Nothing serves this zone yet".
    assert.equal(zoneForPath(bucketForPath(r, '/research/companies'), '/research/companies')?.slug, 'companies', `${primary} + ${held}`);
    assert.equal(canOpenResearch('companies', { role: primary, licences: held }, role(primary, held, '/research/markets')), true,
      `${held}: a Markets page links the company`);
  }
  assert.equal(zoneForPath(bucketForPath('investor', '/research/companies'), '/research/companies'), null, 'the investor shell alone has none');
  assert.equal(canOpenResearch('companies', { role: 'investor', licences: ['investor'] }, 'investor'), false, 'Investor only: text, not a link');
  assert.equal(canOpenResearch('funds', { role: 'partner', licences: ['partner', 'advisor'] }, 'partner'), false, 'Advisor does not open Funds');
  assert.equal(canAddToResearch(role('investor', ['investor', 'founder'])), true, 'Investor + Founder gets the founder actions (answer A)');
  assert.equal(canAddToResearch(role('partner', ['advisor', 'partner'])), false, 'Partner + Advisor reads only');
  assert.equal(canAddToResearch(role('advisor', ['advisor'])), false);
});

// ------------------------------------------------------------------ the boundary (RCL09, RCL09B, RCL15I)

/** The Companies routes' guard lists, read off App.jsx. */
const companyRoutes = ['/research/companies', '/research/companies/company/:uid', '/research/companies/:id', '/research/companies/:analysisId/:candidateId'];

test('RoleGuard draws the Companies boundary, and its roles match the component\'s', () => {
  assert.match(APP, /\{ under: \/\^\\\/research\\\/companies\(\\\/\|\$\)\/, roles: COMPANIES_BOUNDARY_ROLES, Panel: CompaniesBoundary \}/);
  const inApp = APP.match(/const COMPANIES_BOUNDARY_ROLES = new Set\(\[([^\]]*)\]\);/)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(inApp.sort(), [...COMPANIES_BOUNDARY_ROLES].sort());
  assert.match(APP, /<boundary\.Panel home=\{defaultPath\} impersonating=\{!!isImpersonating\} held=\{held\} \/>/, 'the panel is told the held licences');
  // Every role the route admits is outside the boundary's set, and every one it refuses is inside.
  for (const r of ['investor', 'partner', 'exploring']) assert.ok(!RESEARCH_ACCESS.companies.includes(r) && COMPANIES_BOUNDARY_ROLES.has(r), r);
});

test('an admin using "View as Investor" sees the boundary: the Companies routes do not admit the previewed role', () => {
  for (const path of companyRoutes) {
    assert.ok(APP.includes(`<Route path="${path}" element={guard(labRoles(['admin', 'founder', 'advisor'], { preview: false }),`), path);
  }
  assert.match(APP, /const labRoles = \(roles, \{ preview = true \} = \{\}\) => \{/);
  assert.match(APP, /if \(preview && user\?\.role === 'admin' && !isImpersonating && viewMode && !result\.includes\(viewMode\)\) \{/);
});

test('the boundary names the held licence, offers Open Markets, See licences and Home in that order, and no licence to a supporter', () => {
  const investor = html(h(CompaniesBoundary, { home: '/studio', held: ['investor'] }));
  assert.match(investor, /Refused/);
  assert.match(investor, /<h1[^>]*>Companies is open to Founder and Advisor licences<\/h1>/);
  assert.match(investor, /This account holds the Investor licence, which does not include Companies, so nothing from that page is shown\. Markets and Library are open to you\./);
  const order = [...investor.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]).slice(1);
  assert.deepEqual(order, [['/research/markets', 'Open Markets'], ['/account/licences#add-licence', 'See licences'], ['/studio', 'Go to your home']]);
  assert.match(investor, /role="status"/);
  const support = html(h(CompaniesBoundary, { home: '/studio', held: ['partner'], impersonating: true }));
  assert.doesNotMatch(support, /See licences/);
  assert.match(support, /The account you are supporting holds neither licence/);
  assert.match(companiesRefusalLine({ held: ['investor', 'partner'] }), /holds the Investor and Partner licences, which do not include Companies/);
  const none = html(h(CompaniesBoundary, { home: '/studio', held: [] }));
  assert.doesNotMatch(none, /Open Markets/, 'an account with no licence is not sent to Markets, which would refuse it');
  assert.match(none, /holds no licence that includes Companies/);
});

// ------------------------------------------------------------------ setup and the Restored status (RCL04B, RCL05)

test('after required setup, Companies waits on "Continue to Companies"; Grow returns as before', () => {
  const ready = html(h(DestinationReady, { area: destinationArea('/research/companies?q=a'), home: '/studio' }));
  assert.match(ready, /<h1[^>]*>Your account is ready<\/h1>/);
  assert.match(ready, />Continue to Companies<\/button>/);
  assert.match(ready, /href="\/studio"[^>]*>go to your home<\/a>/);
  assert.doesNotMatch(ready, /q=a/);
  assert.match(APP, /if \(afterSetupDue && readyArea\?\.ready\) setReadyFor\(afterSetup\);/);
  assert.match(APP, /onContinue=\{\(\) => \{ markRestoredArrival\(readyPath\); setReadyFor\(null\); navigate\(readyPath, \{ replace: true \}\); \}\}/);
  // The silent return stays for every other area.
  assert.match(APP, /if \(afterSetupDue\) \{\n\s*return <Navigate to=\{afterSetup\} replace \/>;/);
});

test('the Restored status shows once on the page sign-in returned to, with the directory\'s own line', () => {
  const path = '/research/companies?q=storage';
  assert.equal(isRestoredArrival(path), false, 'nothing was restored on a plain visit');
  assert.equal(html(h(RestoredStatus, { path, filters: true })), '');
  markRestoredArrival(path);
  assert.equal(isRestoredArrival('/research/companies'), false, 'another query is another page');
  const shown = html(h(RestoredStatus, { path, filters: true }));
  assert.match(shown, /role="status"/);
  assert.match(shown, /Restored/);
  assert.ok(shown.includes(RESTORED_LINES.filters));
  assert.ok(html(h(RestoredStatus, { path })).includes(RESTORED_LINES.page));
  spendRestoredArrival();
  assert.equal(isRestoredArrival(path), false, 'said once per page load');
  assert.match(read('frontend/src/workspaces/ResearchWorkspace.jsx'), /slug === 'companies' && <RestoredStatus path=\{`\$\{location\.pathname\}\$\{location\.search\}`\} filters=\{!!location\.search\} \/>/);
  assert.match(read('frontend/src/pages/research/CompanyProfile.jsx'), /<RestoredStatus path=\{`\$\{pathname\}\$\{search\}`\} \/>/);
});

// ------------------------------------------------------------------ the public card (RCL01) and RCL10's states

test('the public Companies card opens /research/companies; Markets and Funds are unchanged', () => {
  assert.deepEqual(RESEARCH_CARDS.map((c) => c.to || null), [null, '/research/companies', null]);
  assert.match(read('frontend/src/pages/site/IntelligencePage.jsx'), /\{r\.to && \(\n\s*<Link to=\{r\.to\} className="ax-i-card-go">/);
  assert.match(read('frontend/src/pages/site/method.css'), /\.ax-i-card-go \{[^}]*min-height: 44px;[^}]*color: #c4b5fd;/);
});

async function profileWith(fail) {
  const real = researchCompaniesApi.get;
  researchCompaniesApi.get = async () => { const e = new Error('x'); e.status = fail; throw e; };
  const ui = await mountContracts(h(Routes, null, h(Route, { path: '/research/companies/company/:uid', element: h(CompanyProfile, { role: 'founder' }) })),
    '/research/companies/company/gone', { id: 1, role: 'founder' });
  try { await ui.flush(); return ui.text(); } finally { await ui.unmount(); researchCompaniesApi.get = real; }
}

test('a profile that is gone offers Back to Companies; a refused read says Refused, never Unavailable', async () => {
  const gone = await profileWith(404);
  assert.match(gone, /Company not found/);
  assert.match(gone, /Back to Companies/);
  const refused = await profileWith(403);
  assert.match(refused, /Refused/);
  assert.match(refused, /Companies is open to Founder and Advisor licences\./);
  assert.doesNotMatch(refused, /Unavailable|could not be read/);
});
