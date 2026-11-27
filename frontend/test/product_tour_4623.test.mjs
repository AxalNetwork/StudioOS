// #4623 (Studio audit 5/5, part 1): the product tour points only at what is drawn.
//   · each licence (founder, investor, advisor, partner, and an admin) is offered its own steps, and
//     each step targets an anchor the shell or the Studio draws, or is the one page-level step;
//   · a missing, hidden or off-screen anchor drops its step; the page-level step explains from the centre;
//   · desktop and phone differ (the sidebar steps are desktop's), and the card stays inside a phone;
//   · the mounted tour: focus moves in and comes back, Tab stays inside, the arrows move, Escape closes,
//     the rest of the page is inert, and a scroll or resize places the card again.
// Synthetic anchors only.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { STEPS, anchorShown, placeTip, resolveSteps, stepFrom, tourKey, tourSteps, GUTTER } from '../src/components/productTourModel.js';
import ProductTour from '../src/components/ProductTour.jsx';

const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const el = (rect) => ({ getBoundingClientRect: () => rect, getClientRects: () => (rect.width || rect.height ? [rect] : []) });
const box = (left, top, width, height) => ({ left, top, width, height });
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 700 };
const allAnchors = {
  'studio-modules': el(box(300, 120, 900, 600)),
  'studio-tile': el(box(300, 180, 420, 220)),
  'studio-customise': el(box(1100, 90, 110, 32)),
  'sidebar-nav': el(box(0, 60, 256, 700)),
  settings: el(box(0, 800, 256, 40)),
  'account-menu': el(box(1300, 10, 120, 32)),
};
const finder = (anchors) => (anchor) => anchors[anchor] || null;
const ids = (list) => list.map((s) => s.id);

// ---- the model ---------------------------------------------------------------

test('every Studio licence is offered its Studio, module and Customise steps; an admin is not', () => {
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    assert.deepEqual(ids(tourSteps(role)), ['studio', 'module', 'customise', 'navigate', 'settings', 'account'], role);
    assert.deepEqual(ids(tourSteps(role, { phone: true })), ['studio', 'module', 'customise', 'account'], `${role} on a phone`);
  }
  assert.deepEqual(ids(tourSteps('admin')), ['navigate', 'settings', 'account']);
  assert.deepEqual(ids(tourSteps('admin', { phone: true })), ['account']);
});

test('each licence’s Studio step says that licence’s purpose', () => {
  const body = (role) => resolveSteps(role, { find: finder(allAnchors), viewportWidth: DESKTOP.width })[0].body;
  assert.match(body('investor'), /^Your deals, portfolio and events/);
  assert.match(body('advisor'), /^Your sessions, clients and earnings/);
  assert.match(body('partner'), /^Your firm’s engagements and feed/);
  assert.match(body('founder'), /^Your venture’s modules/);
  for (const role of ['founder', 'investor', 'advisor', 'partner']) assert.match(body(role), /Not recorded where nothing is/);
});

test('every anchor a step names is drawn by the shell or the Studio, and the checklist panel is not one', () => {
  const where = {
    'studio-modules': 'pages/studio/StudioModules.jsx',
    'studio-tile': 'pages/studio/StudioModuleTile.jsx',
    'studio-customise': 'pages/studio/StudioParts.jsx',
    'sidebar-nav': 'ui/SidebarNav.jsx',
    settings: 'ui/SidebarNav.jsx',
    // D4623 part 2: the phone band's initials and the desktop header's Account button (App.jsx).
    'account-menu': ['ui/phone/PhoneHeader.jsx', 'App.jsx'],
  };
  assert.deepEqual(STEPS.map((s) => s.anchor).sort(), Object.keys(where).sort());
  for (const [anchor, files] of Object.entries(where)) {
    for (const file of [files].flat()) assert.match(src(file), new RegExp(`data-tour="${anchor}"`), `${file} draws ${anchor}`);
  }
  assert.equal(STEPS.some((s) => /onboarding|checklist/.test(s.anchor)), false);
});

test('a missing anchor drops its step; a missing page-level anchor explains from the centre', () => {
  const list = resolveSteps('investor', { find: finder({ 'studio-modules': allAnchors['studio-modules'], 'sidebar-nav': allAnchors['sidebar-nav'] }), viewportWidth: DESKTOP.width });
  assert.deepEqual(ids(list), ['studio', 'navigate', 'account']);
  const account = list.at(-1);
  assert.equal(account.el, null, 'no desktop account anchor: page-level');
  assert.match(account.body, /Account menu, under your name at the top right/);
  const band = el(box(320, 4, 44, 44));
  const anchored = resolveSteps('founder', { phone: true, find: finder({ ...allAnchors, 'account-menu': band }), viewportWidth: PHONE.width }).at(-1);
  assert.ok(anchored.el === band, 'the band anchor');
  assert.match(anchored.body, /^This button opens the Account menu: your licences, billing and account settings/);
  assert.deepEqual(ids(resolveSteps('partner', { find: finder({}), viewportWidth: DESKTOP.width })), ['account'], 'nothing drawn: only the page-level step');
});

test('D4623 part 2: on desktop the Account step points at the header\'s Account button, in words true of it', () => {
  // The desktop header's Account button (UserDropdown in App.jsx) carries the anchor, on the button that opens the menu.
  const app = src('App.jsx');
  const dropdown = app.slice(app.indexOf('function UserDropdown('), app.indexOf('role="menu"', app.indexOf('function UserDropdown(')));
  assert.match(dropdown, /<button\s[\s\S]*aria-haspopup="menu"\s+data-tour="account-menu"\s*>/, 'the Account button carries the anchor');
  for (const role of ['founder', 'investor', 'advisor', 'partner', 'admin']) {
    const account = resolveSteps(role, { find: finder(allAnchors), viewportWidth: DESKTOP.width }).at(-1);
    assert.equal(account.id, 'account');
    assert.ok(account.el === allAnchors['account-menu'], `${role}: anchored, not page-level`);
    // The desktop button shows the member's name, not initials: the anchored copy names neither.
    assert.match(account.body, /^This button opens the Account menu/, role);
    assert.doesNotMatch(account.body, /initials/i, role);
  }
});

test('the account copy follows the Account menu model: no licence switcher, no active-licence toggle', () => {
  const words = STEPS.flatMap((s) => [s.title, s.body('investor'), s.body('admin'), s.pageBody?.('investor'), s.pageBody?.('admin')]).filter(Boolean).join(' ');
  assert.doesNotMatch(words, /switch(er)? licen|licen[cs]e switcher|active licen|toggle/i);
  assert.doesNotMatch(words, /checklist|\bFill\b/);
  assert.match(words, /licences, billing and account settings live in the Account menu/);
});

test('a hidden, empty or off-screen anchor is not shown', () => {
  assert.equal(anchorShown(null, 1000), false);
  assert.equal(anchorShown(el(box(0, 0, 0, 0)), 1000), false, 'display: none has no box');
  assert.equal(anchorShown(el(box(-256, 0, 256, 700)), 375), false, 'the sidebar drawer, closed off the left edge');
  assert.equal(anchorShown(el(box(400, 0, 10, 10)), 375), false, 'off the right edge');
  assert.equal(anchorShown(el(box(0, 2000, 300, 40)), 375), true, 'below the fold is scrolled to');
  const drawerClosed = { ...allAnchors, 'sidebar-nav': el(box(-256, 60, 256, 700)), settings: el(box(-256, 800, 256, 40)) };
  assert.deepEqual(ids(resolveSteps('advisor', { find: finder(drawerClosed), viewportWidth: DESKTOP.width })), ['studio', 'module', 'customise', 'account']);
});

test('moving on skips to the next drawn step, even when the current one has gone', () => {
  const list = resolveSteps('investor', { find: finder({ 'studio-modules': allAnchors['studio-modules'], settings: allAnchors.settings }), viewportWidth: DESKTOP.width });
  assert.equal(stepFrom(list, 'studio', 1).id, 'settings');
  assert.equal(stepFrom(list, 'settings', -1).id, 'studio');
  assert.equal(stepFrom(list, 'module', 1).id, 'settings', 'a vanished step moves to the next in order');
  assert.equal(stepFrom(list, 'module', -1).id, 'studio');
  assert.equal(stepFrom(list, 'account', 1), null);
  assert.equal(tourKey('ArrowRight'), 'next');
  assert.equal(tourKey('ArrowLeft'), 'back');
  assert.equal(tourKey('Enter'), null);
});

test('the card stays inside the viewport, a phone included', () => {
  const inside = (tip, vp, h) => {
    assert.ok(tip.left >= GUTTER && tip.left + tip.width <= vp.width - GUTTER, `x inside: ${JSON.stringify(tip)}`);
    assert.ok(tip.top >= GUTTER && tip.top + Math.min(h, tip.maxHeight) <= vp.height - GUTTER, `y inside: ${JSON.stringify(tip)}`);
  };
  const right = placeTip(box(0, 60, 256, 700), DESKTOP, 180);
  assert.equal(right.placement, 'right'); assert.equal(right.left, 268); inside(right, DESKTOP, 180);
  const phoneTile = placeTip(box(16, 100, 343, 220), PHONE, 200);
  assert.equal(phoneTile.placement, 'below'); assert.equal(phoneTile.width, 320); inside(phoneTile, PHONE, 200);
  const low = placeTip(box(16, 560, 343, 100), PHONE, 200);
  assert.equal(low.placement, 'above'); inside(low, PHONE, 200);
  const huge = placeTip(box(0, 0, 375, 700), PHONE, 200);
  assert.equal(huge.placement, 'over'); inside(huge, PHONE, 200);
  const centre = placeTip(null, PHONE, 200);
  assert.equal(centre.placement, 'centre'); inside(centre, PHONE, 200);
  const tiny = placeTip(null, { width: 300, height: 180 }, 260);
  assert.equal(tiny.width, 268); assert.equal(tiny.maxHeight, 148); inside(tiny, { width: 300, height: 180 }, 260);
});

test('the tour reuses the shared modal helpers rather than its own', () => {
  const tour = codeOnly(src('components/ProductTour.jsx'));
  assert.match(tour, /from '\.\.\/ui\/lightboxFocus\.js'/);
  assert.match(tour, /useEscapeClose\(/);
  assert.match(tour, /inertOutside\(/);
  assert.doesNotMatch(tour, /addEventListener\('keydown'/, 'Escape goes through the shared stack');
});

test('Dashboard tells the tour which licence it is on, for every home', () => {
  const dash = codeOnly(src('pages/Dashboard.jsx'));
  const tours = [...dash.matchAll(/<ProductTour role="(\w+)"[^\n]*\n\s*<(\w+)StudioHome/g)].map((m) => [m[1], m[2].toLowerCase()]);
  assert.equal(tours.length, (dash.match(/<ProductTour /g) || []).length, 'every tour names its role');
  for (const [role, home] of tours) assert.equal(role, home);
});

// ---- the mounted tour -------------------------------------------------------

const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const propsOf = (n) => (n && Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1]) || {};
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
// Node identity, without asking assert to print a React fibre tree when it fails.
const same = (a, b, msg = 'the same element') => assert.ok(a === b, msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mountTour({ role, anchors, phone = false, viewport = DESKTOP }) {
  const restore = installDocument('', { focus: true });
  const listeners = [];
  globalThis.addEventListener = (type, fn, opt) => listeners.push({ type, fn, opt });
  globalThis.removeEventListener = (type, fn) => { const at = listeners.findIndex((l) => l.type === type && l.fn === fn); if (at >= 0) listeners.splice(at, 1); };
  const prevMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  globalThis.innerWidth = viewport.width; globalThis.innerHeight = viewport.height;
  const make = document.createElement.bind(document);
  const enhance = (node) => {
    const attrs = {};
    node.setAttribute = (k, v) => { attrs[k] = String(v); };
    node.getAttribute = (k) => attrs[k] ?? null;
    node.hasAttribute = (k) => Object.hasOwn(attrs, k);
    node.removeAttribute = (k) => { delete attrs[k]; };
    Object.defineProperty(node, 'children', { get: () => node.childNodes.filter((c) => c.nodeType === 1) });
    node.getClientRects = () => [{}];
    node.querySelectorAll = (selector) => walk(node).slice(1).filter((c) => (selector === '[aria-modal="true"]'
      ? propsOf(c)['aria-modal'] === 'true'
      : c.tagName === 'BUTTON' && !propsOf(c).disabled));
    return node;
  };
  document.createElement = (tag) => enhance(make(tag));
  enhance(document.body);
  document.querySelector = (sel) => { const m = /^\[data-tour="([^"]+)"\]$/.exec(sel); return m ? anchors[m[1]] || null : null; };
  const page = document.createElement('main'); document.body.appendChild(page);
  const opener = document.createElement('button'); page.appendChild(opener); opener.focus();
  const posted = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { posted.push([String(url), init?.body]); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' }; };
  const container = document.createElement('div'); page.appendChild(container);
  const root = createRoot(container);
  const done = [];
  await act(async () => { root.render(React.createElement(ProductTour, { enabled: true, role, onDone: (skipped) => done.push(skipped) })); });
  const nodes = () => walk(document.body);
  const by = (id) => nodes().find((n) => propsOf(n)['data-testid'] === id);
  const button = (label) => nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  const t = {
    by, button, closeButton: () => nodes().find((n) => propsOf(n)['aria-label'] === 'Close the tour'), opener, page, posted, done, listeners,
    dialog: () => by('product-tour-dialog'),
    step: () => propsOf(t.dialog())['data-step'],
    async waitOpen(ms = 700) { await act(async () => { await sleep(ms); }); },
    async key(key, shiftKey = false) { const e = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; await act(async () => { propsOf(t.dialog()).onKeyDown(e); }); return e; },
    async escape() { const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; await act(async () => { for (const l of listeners.filter((x) => x.type === 'keydown')) l.fn(e); await sleep(0); }); return e; },
    async fire(type) { await act(async () => { for (const l of listeners.filter((x) => x.type === type)) l.fn({}); }); },
    async click(label) { await act(async () => { propsOf(button(label)).onClick(); await sleep(0); }); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prevFetch; globalThis.matchMedia = prevMedia; restore(); },
  };
  return t;
}
const withScroll = (rect) => ({ ...el(rect), scrollIntoView() { this.scrolled = (this.scrolled || 0) + 1; } });

test('keyboard: focus enters on the main action, the arrows move, Tab stays inside, Escape closes and focus returns', async () => {
  const anchors = { 'studio-modules': withScroll(box(300, 120, 900, 600)), 'studio-tile': withScroll(box(300, 180, 420, 220)), 'sidebar-nav': withScroll(box(0, 60, 256, 700)) };
  const t = await mountTour({ role: 'investor', anchors });
  try {
    assert.ok(t.dialog() === undefined, 'nothing until the open delay');
    await t.waitOpen();
    const d = t.dialog();
    assert.ok(d, 'the tour opened');
    assert.equal(propsOf(d).role, 'dialog'); assert.equal(propsOf(d)['aria-modal'], 'true');
    assert.ok(propsOf(d)['aria-labelledby'] && propsOf(d)['aria-describedby']);
    assert.equal(t.step(), 'studio');
    assert.match(textOf(t.by('product-tour-count')), /Step 1 of 4/, 'studio, module, sidebar, account: Customise and Settings are not drawn');
    same(document.activeElement, t.button('Next'), 'focus moved to Next');
    assert.equal(anchors['studio-modules'].scrolled, 1, 'the anchor is scrolled into view');
    assert.equal(t.page.hasAttribute('inert'), true, 'the page behind is inert');

    await t.key('ArrowRight');
    assert.equal(t.step(), 'module');
    same(document.activeElement, t.button('Next'));
    await t.key('ArrowLeft');
    assert.equal(t.step(), 'studio');

    // Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
    t.button('Next').focus();
    const tab = await t.key('Tab');
    assert.equal(tab.defaultPrevented, true);
    same(document.activeElement, t.closeButton(), 'wrapped to the close button');
    await t.key('Tab', true);
    same(document.activeElement, t.button('Next'));

    const esc = await t.escape();
    assert.equal(esc.defaultPrevented, true);
    assert.ok(t.dialog() === undefined, 'Escape closed it');
    assert.deepEqual(t.done, [true], 'closing is a skip');
    same(document.activeElement, t.opener, 'focus went back');
    assert.equal(t.page.hasAttribute('inert'), false, 'the page is live again');
    assert.ok(t.posted.some(([url, body]) => url.endsWith('/onboarding/meta') && /tour_seen/.test(body)), 'seen is recorded');
  } finally { await t.close(); }
});

test('Next through every drawn step ends with Done', async () => {
  const t = await mountTour({ role: 'partner', anchors: { 'studio-modules': withScroll(box(300, 120, 900, 600)) } });
  try {
    await t.waitOpen();
    assert.equal(t.step(), 'studio');
    assert.match(textOf(t.by('product-tour-count')), /Step 1 of 2/);
    await t.click('Next');
    assert.equal(t.step(), 'account');
    assert.ok(t.by('product-tour-ring') === undefined, 'a page-level step rings nothing');
    assert.equal(propsOf(t.dialog())['data-placement'], 'centre');
    await t.click('Done');
    assert.ok(t.dialog() === undefined, 'not drawn');
    assert.deepEqual(t.done, [false]);
  } finally { await t.close(); }
});

test('a scroll or a resize places the card again', async () => {
  const tile = withScroll(box(300, 180, 420, 220));
  const t = await mountTour({ role: 'advisor', anchors: { 'studio-modules': tile } });
  try {
    await t.waitOpen();
    assert.equal(propsOf(t.dialog()).style.left, 732);
    assert.ok(t.listeners.some((l) => l.type === 'scroll' && l.opt === true), 'scroll is heard in the capture phase, so the shell’s own scroller counts');
    assert.ok(t.listeners.some((l) => l.type === 'resize'));
    tile.getBoundingClientRect = () => box(100, 40, 420, 220);
    await t.fire('scroll');
    assert.equal(propsOf(t.dialog()).style.left, 532);
    assert.equal(propsOf(t.by('product-tour-ring')).style.top, 34);
    globalThis.innerWidth = 600;
    await t.fire('resize');
    assert.equal(propsOf(t.dialog()).style.left, 100, 'no room on the right: below, clamped');
    assert.equal(propsOf(t.dialog()).style.top, 272);
  } finally { await t.close(); }
});

test('on a phone the card fits inside the gutters, and the sidebar steps are not offered', async () => {
  const t = await mountTour({ role: 'founder', phone: true, viewport: PHONE, anchors: { 'studio-modules': withScroll(box(0, 120, 375, 600)), 'sidebar-nav': withScroll(box(0, 0, 256, 700)), 'account-menu': withScroll(box(320, 4, 44, 44)) } });
  try {
    await t.waitOpen();
    assert.match(textOf(t.by('product-tour-count')), /Step 1 of 2/, 'studio and account; the sidebar is desktop’s');
    const s = propsOf(t.dialog()).style;
    assert.equal(s.width, 320);
    assert.ok(s.left >= 16 && s.left + s.width <= 359);
    await t.click('Next');
    assert.equal(t.step(), 'account');
    assert.ok(t.by('product-tour-ring'), 'the founder’s phone band draws the account anchor');
    assert.match(textOf(t.dialog()), /This button opens the Account menu/);
  } finally { await t.close(); }
});

test('a Studio licence waits for its lazy home before opening, then opens without it', async () => {
  const anchors = {};
  const t = await mountTour({ role: 'investor', anchors });
  try {
    await t.waitOpen();
    assert.ok(t.dialog() === undefined, 'still waiting for the Studio to draw');
    anchors['studio-modules'] = withScroll(box(300, 120, 900, 600));
    await t.waitOpen(300);
    assert.equal(t.step(), 'studio', 'opened on the Studio once it drew');
  } finally { await t.close(); }
  const late = await mountTour({ role: 'investor', anchors: {} });
  try {
    await late.waitOpen(3800);
    assert.equal(late.step(), 'account', 'never drawn: the page-level step alone');
  } finally { await late.close(); }
});
