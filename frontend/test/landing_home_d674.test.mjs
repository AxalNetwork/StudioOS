/**
 * D674 (#1548) — the public front page, nav and footer, built to the owner's
 * canvas `design/canvases/integrated/Axal VC Website.dc.html` (HOME, NAV,
 * FOOTER).
 *
 * This pins:
 *   - the page's sections, in the canvas's order;
 *   - every figure is read, never typed: the hero draws only what
 *     `/api/public/stats` returns, and the canvas's sample numbers and cohort
 *     never appear in source;
 *   - one list of site links feeds the nav and the footer, and every path in it
 *     is a route `App.jsx` serves, so the shell never links to a 404;
 *   - every image the page asks for ships in `frontend/public/site/`.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/landing_home_d674.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const LANDING_SRC = read('frontend/src/pages/LandingPage.jsx');
const APP = read('frontend/src/App.jsx');

const { default: LandingPage, heroFigures, figure } = await import('../src/pages/LandingPage.jsx');
const { default: PublicNav } = await import('../src/components/PublicNav.jsx');
const { default: PublicFooter } = await import('../src/components/PublicFooter.jsx');
const links = await import('../src/lib/siteLinks.js');

const render = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/'] }, el));

test('the page renders the canvas sections in order', () => {
  const html = render(React.createElement(LandingPage));
  const ids = ['ax-hero-h', 'ax-pillars-h', 'ax-lanes-h', 'ax-how-h', 'ax-lab-h', 'ax-platform-h', 'ax-net-h', 'ax-close-h'];
  let at = -1;
  for (const id of ids) {
    const i = html.indexOf(`id="${id}"`);
    assert.ok(i > at, `section ${id} is missing or out of order`);
    at = i;
  }
  assert.match(html, /Where we <em>build<\/em> the rails for the next generation of ventures/);
  // Before the stats read lands there is no figure row at all, not a row of zeros.
  assert.doesNotMatch(html, /class="ax-stats"/, 'no figures are drawn before the stats read answers');
});

test('the hero draws only the figures the endpoint returns, in the canvas order', () => {
  assert.deepEqual(heroFigures(null), []);
  assert.deepEqual(heroFigures({ partners: 200, deals_scored: 900 }), [], 'old fields are not hero figures');
  const got = heroFigures({ funds: 4, users: '640', companies: 0, tools: 'n/a' });
  assert.deepEqual(got.map((f) => [f.key, f.value]), [['users', 640], ['funds', 4]],
    'a zero, a missing or a non-numeric count is not drawn');
  assert.deepEqual(heroFigures({ tools: 152, users: 640, companies: 410, funds: 4 }).map((f) => f.label),
    ['Tools in the platform', 'Users', 'Companies', 'Active funds']);
  assert.equal(figure({ tools: 151.6 }, 'tools'), 152);
});

test('no figure or cohort from the canvas is typed into the page', () => {
  const src = code(LANDING_SRC);
  for (const literal of [/488/, /\b656\b/, /\b412\b/, /Cohort 5/, /September 12/, /Twelve places/i, /FALLBACK_STATS/]) {
    assert.doesNotMatch(src, literal, `the canvas sample ${literal} must not ship as copy`);
  }
  assert.match(src, /fetch\('\/api\/public\/stats'/, 'the figures come from the stats endpoint');
  assert.match(src, /openCohortCopy\(\)/, 'the cohort number and deadline come from the Lab cohort rule');
  assert.match(src, /useCohortPlaces\(\)/, 'the places come from the cohort record');
  assert.match(src, /articles\.list\(/, 'the articles are the live list');
  assert.match(src, /eventsPublic\.list\(/, 'the events are the live list');
});

test('every link the shell draws is a route App.jsx serves', () => {
  const paths = links.siteLinkPaths();
  assert.ok(paths.length >= 14, 'the shell lists its doors, network, build and legal links');
  for (const p of paths) {
    const routed = new RegExp(`<Route\\s+path="${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
    assert.match(APP, routed, `${p} is linked from the shell but not routed — it would 404`);
  }
});

test('the nav and the footer draw the same lists', () => {
  const nav = render(React.createElement(PublicNav));
  const foot = render(React.createElement(PublicFooter));
  for (const l of links.DOOR_LINKS) {
    assert.ok(nav.includes(`href="${l.to}"`), `the nav links ${l.to}`);
    assert.ok(foot.includes(`href="${l.to}"`), `the footer links ${l.to}`);
  }
  for (const l of [...links.NETWORK_LINKS, ...links.BUILD_LINKS]) {
    assert.ok(foot.includes(`href="${l.to}"`), `the footer links ${l.to}`);
  }
  assert.ok(nav.includes(`href="${links.SITE_ACTIONS.lpLogin}"`), 'LP login goes to the LP workspace door');
  assert.ok(nav.includes(`href="${links.SITE_ACTIONS.apply}"`), 'Apply goes to registration');
  assert.match(foot, /Cookie preferences<\/button>/, 'cookie preferences opens the consent dialog, it is not a page');
});

test('every image the page asks for ships in frontend/public/site', () => {
  const names = [...LANDING_SRC.matchAll(/img(?:\(|: )'([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 14, `the page names its images (${names.length})`);
  for (const n of names) {
    assert.ok(existsSync(resolve(ROOT, `frontend/public/site/${n}.webp`)), `frontend/public/site/${n}.webp is missing`);
  }
});
