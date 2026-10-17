/**
 * D676 (#1550) — the four door pages, built to the DOORS view of the owner's
 * canvas `design/canvases/integrated/Axal VC Website.dc.html`:
 * `pages/site/DoorPage.jsx` renders `lib/siteDoors.js`.
 *
 * This pins:
 *   - the four doors, their paths and their accents, and each page's sections
 *     in the canvas's order;
 *   - every "live" item naming a route `App.jsx` serves that is not a redirect;
 *   - plan prices and features coming from the catalogue `/pricing` reads
 *     (`data/pricing.js`), never typed, and a plan the catalogue lacks not
 *     rendering;
 *   - the primary CTAs being the lane links, and every other CTA a routed page;
 *   - the canvas claims the code does not back staying off the pages.
 *
 * It does not assert that `/for-*` render DoorPage: S1 swaps those routes.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/doors_d676.test.mjs
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
const APP = read('frontend/src/App.jsx');
const PAGE_SRC = read('frontend/src/pages/site/DoorPage.jsx');
const DOORS_SRC = read('frontend/src/lib/siteDoors.js');

const { default: DoorPage, resolvePlans, chapterList, formatPrice } = await import('../src/pages/site/DoorPage.jsx');
const { DOORS, DOOR_ORDER, AI_TOKENS } = await import('../src/lib/siteDoors.js');
const { FOUNDER_TIERS, INVESTOR_TIERS } = await import('../src/data/pricing.js');
const { PRODUCT_PAGES } = await import('../src/data/productPages.js');
const { DOOR_LINKS } = await import('../src/lib/siteLinks.js');
const { bucketsFor } = await import('../src/workspaces/shellConfig.js');

const render = (key) => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: [DOORS[key].path] }, React.createElement(DoorPage, { door: key })),
);
const PAGES = Object.fromEntries(DOOR_ORDER.map((k) => [k, render(k)]));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const attr = (s) => s.replace(/&/g, '&amp;');
/** The text of a `<Route path="…">` in App.jsx, up to the next Route, or null. */
function routeBlock(path) {
  const m = [...APP.matchAll(/<Route\s+path="([^"]*)"/g)].find((r) => r[1] === path);
  if (!m) return null;
  const rest = APP.slice(m.index + m[0].length);
  const end = rest.search(/<Route\s/);
  return end === -1 ? rest : rest.slice(0, end);
}
const tier = (list, id) => list.find((t) => t.id === id);

test('four doors, at their paths, each in its accent', () => {
  const want = [
    ['founders', '/for-founders', '#6d28d9'],
    ['investors', '/for-investors', '#059669'],
    ['partners', '/for-service-partners', '#2563eb'],
    ['advisors', '/for-advisors', '#d97706'],
  ];
  assert.deepEqual(DOOR_ORDER.map((k) => [k, DOORS[k].path, DOORS[k].accent]), want);
  assert.deepEqual(DOOR_LINKS.map((l) => l.to), want.map((w) => w[1]), 'the nav and footer link the four doors, in order');
  for (const [k, , accent] of want) {
    assert.ok(PAGES[k].includes(`data-door="${k}"`), `${k} renders`);
    assert.ok(PAGES[k].includes(`--door-accent:${accent}`), `${k} is drawn in ${accent}`);
    assert.ok(PAGES[k].includes(`--door-soft:${DOORS[k].soft}`), `${k} carries its soft tint`);
  }
});

test('each door\'s hero is its own lane picture from the home page', () => {
  // The owner's call (2026-10-12): the founders door shows the cloaked
  // founders of the home page's founders lane, as the other three doors show
  // their lanes. The canvas's wide landscape (door-founders.webp) stays the
  // home page's closing band and CtaBand's default.
  for (const k of DOOR_ORDER) {
    assert.equal(DOORS[k].img, `/site/lane-${k}.webp`, `${k} heroes its lane picture`);
    assert.ok(existsSync(resolve(ROOT, `frontend/public${DOORS[k].img}`)), `${DOORS[k].img} ships`);
    assert.ok(PAGES[k].includes(DOORS[k].img), `${k} draws it`);
  }
});

test('each door renders the canvas sections in order', () => {
  for (const k of DOOR_ORDER) {
    const door = DOORS[k];
    const html = PAGES[k];
    const hasPlans = resolvePlans(door).length > 0;
    const ids = ['ax-door-h', 'ax-door-problem-h', 'ax-door-how-h', 'ax-door-eadwyn', 'ax-door-status-h',
      ...(hasPlans ? ['ax-door-plans-h'] : []), ...(door.aside ? ['ax-door-aside-h'] : []),
      'ax-door-faq-h', 'ax-door-close-h'];
    let at = -1;
    for (const id of ids) {
      const i = html.indexOf(`id="${id}"`);
      assert.ok(i > at, `${k}: section ${id} is missing or out of order`);
      at = i;
    }
    assert.equal(html.includes('id="ax-door-plans-h"'), hasPlans, `${k}: a plans section only when a plan resolves`);
    assert.equal(html.includes('id="ax-door-aside-h"'), !!door.aside, `${k}: the aside only when the door has one`);
    assert.ok(html.includes(`src="${door.img}"`) && html.includes(`alt="${door.imgAlt}"`), `${k}: the hero image keeps the canvas alt text`);
    assert.ok(html.includes(`>${attr(door.label)}</div>`), `${k}: the hero label`);
    assert.ok(html.includes(attr(door.h1)), `${k}: the hero h1`);
    assert.equal((html.match(/class="ax-door-chap"/g) || []).length, door.chapters.length, `${k}: every chapter`);
    assert.equal((html.match(/class="ax-door-faq-row"/g) || []).length, door.faq.length, `${k}: every question`);
    assert.ok(existsSync(resolve(ROOT, 'frontend/public', door.img.slice(1))), `${door.img} ships`);
  }
  // Which doors have which optional sections, as shipped.
  assert.deepEqual(DOOR_ORDER.filter((k) => PAGES[k].includes('id="door-pricing"')), ['founders', 'investors']);
  assert.deepEqual(DOOR_ORDER.filter((k) => PAGES[k].includes('id="ax-door-aside-h"')), ['partners', 'advisors']);
});

test('every live item names a route App.jsx serves, and none is a redirect', () => {
  for (const k of DOOR_ORDER) {
    const html = PAGES[k];
    assert.ok(DOORS[k].live.length > 0, `${k} lists what is live`);
    for (const item of DOORS[k].live) {
      assert.equal(typeof item.route, 'string', `${k}: "${item.t}" names its route`);
      const block = routeBlock(item.route);
      assert.ok(block, `${k}: "${item.t}" claims ${item.route}, which App.jsx does not route`);
      assert.doesNotMatch(block, /^\s*element=\{\s*<Navigate\b/, `${k}: "${item.t}" points at ${item.route}, which only redirects`);
      const row = new RegExp(`data-route="${esc(item.route)}"><span>${esc(attr(item.t))}</span><span class="ax-door-pill">Live</span>`);
      assert.match(html, row, `${k}: "${item.t}" is drawn as live`);
    }
    for (const t of DOORS[k].soon) {
      assert.match(html, new RegExp(`<span>${esc(attr(t))}</span><span class="ax-door-pill is-soon">Coming soon</span>`), `${k}: "${t}" is drawn as soon`);
    }
    const lives = (html.match(/class="ax-door-pill">Live</g) || []).length;
    assert.equal(lives, DOORS[k].live.length, `${k}: nothing is drawn live without a route`);
  }
});

test('plan prices and features come from the catalogue, never typed', () => {
  // No price in the copy or the template: no "$5", no "$149", no "Custom".
  for (const [name, src] of [['siteDoors.js', DOORS_SRC], ['DoorPage.jsx', PAGE_SRC]]) {
    assert.doesNotMatch(code(src), /\$\d/, `${name} types a price`);
    assert.doesNotMatch(code(src), /\bprice:\s*['"`]/, `${name} carries a price field`);
    assert.doesNotMatch(code(src), /'Custom'/, `${name} carries the canvas's "Custom" price`);
  }
  assert.match(PAGE_SRC, /from '\.\.\/\.\.\/data\/pricing'/, 'the page reads the catalogue /pricing reads');

  // Each door that sells plans shows the catalogue's tiers, at its prices,
  // with its features, under the catalogue's own names.
  const SOLD = { founders: [FOUNDER_TIERS, ['free', 'growth', 'studio']], investors: [INVESTOR_TIERS, ['free', 'professional', 'institutional']] };
  for (const [k, [list, ids]] of Object.entries(SOLD)) {
    const html = PAGES[k];
    assert.deepEqual(resolvePlans(DOORS[k]).map((p) => p.tier), ids, `${k}: the catalogue's tiers, in order`);
    for (const id of ids) {
      const t = tier(list, id);
      assert.ok(html.includes(`>${formatPrice(t)}</div>`), `${k}: the ${id} price is the catalogue's (${formatPrice(t)})`);
      assert.ok(html.includes(`<h3 class="ax-door-plan-name">${attr(t.name)}</h3>`), `${k}: the ${id} plan is called ${t.name}, as /pricing calls it`);
      for (const f of t.features) assert.ok(html.includes(attr(f)), `${k}: the ${id} plan lists "${f}" from the catalogue`);
    }
    assert.equal((html.match(/class="ax-door-plan[ "]/g) || []).length, ids.length, `${k}: ${ids.length} plans render`);
    for (const p of DOORS[k].plans) assert.ok(p.desc, `${k}: ${p.name} says in plain words what it is for`);
  }

  // A catalogue that moves its prices moves the page.
  const fake = { investor: [{ id: 'free', priceMonthly: 7, features: ['a'] }, { id: 'professional', priceMonthly: 1234, features: ['b', 'c'] }] };
  assert.deepEqual(resolvePlans(DOORS.investors, fake).map((p) => [p.name, p.price, p.features]),
    [['Free', '$7', ['a']], ['Professional', '$1,234', ['b', 'c']]]);
  // A plan the catalogue does not have does not render.
  assert.deepEqual(resolvePlans(DOORS.investors, { investor: [fake.investor[1]] }).map((p) => p.name), ['Professional']);
  assert.deepEqual(resolvePlans(DOORS.investors, {}), [], 'no catalogue, no plans');
  for (const k of ['partners', 'advisors']) {
    assert.deepEqual(resolvePlans(DOORS[k]), [], `${k}: no canvas plan is in the catalogue`);
  }

  // A chapter line that quotes a price reads it from the catalogue, or is left out.
  const priced = [{ t: 'Free · {price}, forever', tier: 'free' }, 'Unpriced line'];
  assert.deepEqual(chapterList(DOORS.founders, priced), [`Free · ${formatPrice(tier(FOUNDER_TIERS, 'free'))}, forever`, 'Unpriced line']);
  assert.deepEqual(chapterList(DOORS.founders, priced, { founder: [{ id: 'free', priceMonthly: 3 }] })[0], 'Free · $3, forever');
  assert.deepEqual(chapterList(DOORS.founders, priced, {}), ['Unpriced line'], 'no tier, no priced line');
});

test('the primary CTA is the lane link; every other CTA is a routed page', () => {
  const LANE = {
    founders: '/register?lane=founder',
    investors: '/register?lane=lp',
    partners: '/register?lane=partner',
    advisors: '/register?lane=advisor',
  };
  for (const k of DOOR_ORDER) {
    const door = DOORS[k];
    assert.equal(door.primary.to, LANE[k], `${k}: the primary CTA keeps the lane link`);
    const html = PAGES[k];
    const primary = new RegExp(`^<a class="ax-btn ax-btn-lg ax-btn-primary" href="${esc(attr(LANE[k]))}"[^>]*>${esc(attr(door.primary.t))}<`);
    const hero = html.slice(html.indexOf('class="ax-door-hero"'), html.indexOf('</section>'));
    const close = html.slice(html.indexOf('class="ax-door-close"'));
    for (const [where, part] of [['hero', hero], ['closing band', close]]) {
      const btns = part.slice(part.indexOf('<div class="ax-row-btns">') + '<div class="ax-row-btns">'.length);
      assert.match(btns, primary, `${k}: the ${where} leads with the lane link`);
    }
    const others = [door.secondary.to, ...(door.aside ? [door.aside.to] : [])];
    for (const to of others) {
      assert.ok(routeBlock(to.split('?')[0]), `${k}: ${to} is not a route`);
      assert.ok(html.includes(`href="${attr(to)}"`), `${k}: links ${to}`);
    }
    for (const m of html.matchAll(/class="ax-door-plan[ "][\s\S]*?href="([^"]+)"/g)) {
      assert.equal(m[1], attr(LANE[k]), `${k}: a plan's CTA is the lane link`);
    }
  }
});

test('claims the code does not back stay off the pages', () => {
  const unbacked = [
    /Plaid/, // no Plaid integration
    /Stripe Connect/, // not configured for partners
    /KYB|conflicts/i, // no KYB satisfier, no conflict check
    /Verification badges/i, // kyb_verified is never set
    /Profile views|from views to signed work/i, // nothing counts profile views
    /by sector/i, // advisor matching reads no sector or availability
    /labelled (?:that way|as such) in the product/, // no such label exists
    /drafts replies|handles scheduling|keeps your (?:notes|profile) current/, // no such AI task
    /priced per fund|shaped around them/, // the Enterprise plan does not render
    /\bStarter\b|\bPro\b|Enterprise/, // the catalogue's plans are Free, Growth, Studio, Professional, Institutional
  ];
  for (const k of DOOR_ORDER) {
    for (const re of unbacked) assert.doesNotMatch(PAGES[k], re, `${k} claims ${re}`);
  }
});

test('the tab title and description are the door\'s productPages meta', () => {
  assert.match(PAGE_SRC, /PRODUCT_PAGES\[door\.meta\]\?\.meta/);
  for (const k of DOOR_ORDER) {
    const page = PRODUCT_PAGES[DOORS[k].meta];
    assert.ok(page, `${k} has a productPages entry`);
    assert.equal(page.path, DOORS[k].path, `${k}: one path in both modules`);
    assert.equal(page.meta.title, DOORS[k].label, `${k}: the tab title is the hero label`);
  }
});

test('the founders door walks the whole founder workspace (owner, 2026-10-13)', () => {
  // Every bucket the founder shell registers is a chapter, so a founder reads
  // about all of it, and a bucket added to the shell cannot be left off.
  const keys = DOORS.founders.chapters.map((c) => c.k);
  for (const b of bucketsFor('founder')) assert.ok(keys.includes(b.label), `the founders door has a ${b.label} chapter`);
  assert.ok(keys.includes('Idea to company') && keys.includes('Already a company'), 'both ways in: the Lab, and an existing company');
  // A chapter that lists a bucket's screens lists every one, by the name the
  // founder's menu gives it (Network draws its introduction flow instead).
  for (const b of bucketsFor('founder')) {
    const c = DOORS.founders.chapters.find((ch) => ch.k === b.label);
    if (!c.list) continue;
    assert.deepEqual(c.list, b.zones.map((z) => z.label), `${b.label} lists its screens as the menu names them`);
    for (const z of b.zones) assert.ok(PAGES.founders.includes(`<span class="ax-door-dot" aria-hidden="true"></span>${attr(z.label)}</li>`), `${b.label} › ${z.label} is drawn`);
  }
  const listed = DOORS.founders.chapters.filter((c) => bucketsFor('founder').some((b) => b.label === c.k) && c.list).map((c) => c.k);
  assert.deepEqual(listed, ['Validate', 'Build', 'Raise', 'Grow', 'Research'], 'the four cycles and Research list their screens');
});

test('a door that sells plans says how AI use is paid: tokens, under the plans', () => {
  for (const k of DOOR_ORDER) {
    const html = PAGES[k];
    const sells = resolvePlans(DOORS[k]).length > 0;
    assert.equal(DOORS[k].tokens === AI_TOKENS, sells, `${k}: the tokens note exactly when the door sells plans`);
    assert.equal(html.includes('id="ax-door-tokens-h"'), sells, `${k}: drawn exactly when the door sells plans`);
    if (!sells) continue;
    const plans = html.slice(html.indexOf('id="door-pricing"'), html.indexOf('id="ax-door-faq-h"'));
    assert.ok(plans.includes(attr(AI_TOKENS.t)), `${k}: the tokens note sits inside the plans section`);
    for (const p of AI_TOKENS.points) assert.ok(plans.includes(attr(p)), `${k}: "${p}"`);
  }
  // D629, and only D629: an allowance first, a one-for-one paid balance after
  // it that never expires; no allowance amount is typed (the Super Admin sets
  // each licence's).
  const all = [AI_TOKENS.t, AI_TOKENS.d, ...AI_TOKENS.points].join(' ');
  assert.match(all, /allowance/);
  assert.match(all, /each dollar you add is a dollar of AI use/);
  assert.match(all, /never expire/);
  assert.doesNotMatch(all, /\$\d|\d+ tokens/, 'no amount is typed');
});

