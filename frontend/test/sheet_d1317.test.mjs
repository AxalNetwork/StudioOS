/**
 * D1317 — the shared detail Sheet (`ui/Sheet.jsx`), docked beside the Eadwyn
 * rail's spine: its frame, its dock, Escape, the scrim and ×, focus in and
 * back, the one scrolling body, the rail kept live, and a deep link that
 * closes to its list.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/sheet_d1317.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import Sheet, { SHEET_WIDTHS, sheetWidth } from '../src/ui/Sheet.jsx';
import { closeSheets, openSheets, pushSheet } from '../src/ui/sheetStore.js';
import { inertOutside, scrollLocks } from '../src/ui/lightboxFocus.js';
import BuilderSection from '../src/pages/account/builder/BuilderSection.jsx';
import { builderViewFor } from '../src/pages/account/builder/builderModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');

// ── The frame ───────────────────────────────────────────────────────────────

test('the frame: a named modal dialog, its own width capped at 100vw − 108px, the canvas’s look', () => {
  const out = renderToStaticMarkup(h(Sheet, { title: 'Ben Sample', eyebrow: 'Accounts › All accounts', sub: 'Founder', width: 640, onClose() {}, footer: h('button', null, 'Save') }, h('p', null, 'BODY')));
  const id = out.match(/<h2 id="([^"]+)"/)?.[1];
  assert.ok(id, 'the title has an id');
  assert.ok(out.includes(`role="dialog" aria-modal="true" aria-labelledby="${id}"`), 'named by its title');
  assert.match(out, /style="width:640px;max-width:calc\(100vw - 108px\)"/);
  assert.match(out, /rounded-l-2xl/, '16px radius on the left corners only');
  assert.match(out, /border-l border-\[#ececf1\]/, 'a hairline on the left only');
  assert.match(out, /dark:border-\[#374151\]/);
  assert.doesNotMatch(out, /border-r\b|rounded-r|rounded-2xl /, 'no right border, no right radius');
  assert.match(out, /shadow-\[-24px_0_56px_rgba\(9,9,11,\.2\)\]/);
  assert.match(out, /bg-white[^"]*dark:bg-gray-950/, 'card ground, and its dark pair');
  assert.match(out, /z-\[80\]/, 'with the lightboxes, above the rail’s phone sheet');
  assert.match(out, /aria-label="Close"/);
  assert.match(out, /Accounts › All accounts/);
  const unnamed = renderToStaticMarkup(h(Sheet, { label: 'Filters', onClose() {} }));
  assert.match(unnamed, /role="dialog" aria-modal="true" aria-label="Filters"/, 'no title: named by `label`');
  assert.doesNotMatch(unnamed, /sheet-header|aria-label="Close"/, 'no title or eyebrow: the panel draws its own head, as with Lightbox');
  assert.deepEqual([...SHEET_WIDTHS], [480, 520, 560, 640, 720, 760]);
  // A width off the list takes the nearest on it, a tie going wider.
  assert.deepEqual([480, 600, 620, 680, 860, 940, 960, 400, undefined].map(sheetWidth), [480, 640, 640, 720, 760, 760, 760, 480, 560]);
  assert.match(renderToStaticMarkup(h(Sheet, { title: 'T', width: 600, onClose() {} })), /style="width:640px;/);
  const tall = renderToStaticMarkup(h(Sheet, { title: 'T', size: 'tall', onClose() {} }));
  assert.match(tall, /data-size="tall"/);
  assert.match(tall, /class="min-h-0 flex-1 overflow-hidden" data-testid="sheet-body"/, 'tall: the child owns the scroll');
});

test('scroll: the header and the footer stay put, and only the body scrolls', () => {
  const out = renderToStaticMarkup(h(Sheet, { title: 'T', onClose() {}, footer: h('button', null, 'Save') }, h('p', null, 'BODY')));
  const tags = [...out.matchAll(/<[a-z]+ class="([^"]+)" data-testid="([^"]+)"/g)];
  const tag = (testId) => tags.find((m) => m[2] === testId)?.[1] || '';
  assert.match(tag('sheet-header'), /\bshrink-0\b/);
  assert.match(tag('sheet-footer'), /\bshrink-0\b/);
  assert.match(tag('sheet-body'), /\bflex-1\b.*\boverflow-y-auto\b/);
  assert.match(out, /class="axs-sheet[^"]*\bflex flex-col\b[^"]*\boverflow-hidden\b/, 'the frame itself never scrolls');
  assert.doesNotMatch(tag('sheet-header'), /overflow/);
});

test('the dock: beside the rail’s 44px spine at 1024px and up, the window’s edge without a rail; 200ms in; no motion when reduced; phone forms', () => {
  const css = read('frontend/src/ui/sheet.css');
  assert.match(css, /\.axs-layer \{ right: var\(--axs-dock, 0px\); \}/, 'with no rail the sheet meets the window’s edge');
  assert.match(css, /@media \(min-width: 1024px\) \{\s*:root\[data-eadwyn-rail="docked"\] \{ --axs-dock: 44px; \}/);
  assert.match(read('frontend/src/ui/workerRail.css'), /:root\[data-worker-rail="collapsed"\] \{ --fwr-track: 44px; \}/, 'the spine the sheet docks to is 44px');
  assert.match(css, /\.axs-sheet \{ animation: axs-sheet-in 200ms/);
  assert.match(css, /from \{ transform: translateX\(100%\); \}/, 'it slides in from the rail’s edge');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.axs-sheet \{ animation: none; \}/);
  assert.doesNotMatch(css, /animation-fill-mode|forwards/, 'no transform is left on the sheet, so a dialog inside it is not clipped');
  assert.match(css, /@media \(max-width: 639\.98px\)[\s\S]*width: 100% !important; max-width: none !important; border-radius: 0/, 'a full-screen page on a phone');
  assert.match(css, /\[data-phone="sheet"\] \.axs-sheet \{ top: auto; max-height: 92dvh; border-radius: 16px 16px 0 0; \}/, 'or a bottom sheet');
  // The scrim is inside the docked layer, so it dims only what lies left of the sheet and the rail.
  const out = renderToStaticMarkup(h(Sheet, { title: 'T', onClose() {} }));
  assert.match(out, /class="axs-layer fixed inset-y-0 left-0 z-\[80\]"[^>]*><div aria-hidden="true" data-testid="sheet-scrim" class="axs-scrim absolute inset-0/);
  assert.doesNotMatch(out, /fixed inset-0/, 'the layer never covers the rail');
});

test('the rail: a spine while a sheet is open, its choice untouched, docked and kept live, and its spine closes the sheet first', () => {
  const rail = read('frontend/src/ui/WorkerRail.jsx');
  assert.match(rail, /const sheetOpen = useSheetOpen\(\);\s*const collapsed = stored \|\| sheetOpen;/);
  assert.match(rail, /if \(sheetOpen\) \{\s*closeSheets\(\);\s*setCollapsed\(false\);/, 'opening the rail closes the sheet first');
  assert.match(rail, /data-sheet-keep=""/);
  assert.match(rail, /document\.documentElement\.setAttribute\(RAIL_DOCK_ATTR, 'docked'\)/);
  assert.match(rail, /const RAIL_DOCK_ATTR = 'data-eadwyn-rail';/);
  assert.match(read('frontend/src/ui/Sheet.jsx'), /inertOutside\(el\.parentNode \|\| el, document\.body, keep\)/);
});

function el(tag, children = [], attrs = {}) {
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), children, parentNode: null, attrs: { ...attrs },
    hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
  };
  children.forEach((c) => { c.parentNode = node; });
  return node;
}

test('everything behind the sheet is inert except the rail, which stays clickable', () => {
  const sheet = el('div');
  const list = el('section');
  const main = el('div', [list, sheet]);
  const spine = el('button');
  const aside = el('aside', [spine], { 'data-sheet-keep': '' });
  const railCol = el('div', [aside]);
  const railSib = el('div');
  const rail = el('div', [railCol, railSib]);
  const frame = el('div', [main, rail]);
  const nav = el('nav');
  const body = el('body', [nav, frame]);
  const restore = inertOutside(sheet, body, [aside]);
  assert.equal(list.getAttribute('inert'), '', 'the list under the sheet is inert');
  assert.equal(nav.getAttribute('inert'), '', 'so is the sidebar');
  assert.equal(railSib.getAttribute('inert'), '', 'what sits beside the rail is not kept');
  for (const n of [aside, spine, railCol, rail, frame, main, sheet]) assert.equal(n.hasAttribute('inert'), false, n.tagName);
  restore();
  assert.equal(list.hasAttribute('inert'), false);
  assert.equal(nav.hasAttribute('aria-hidden'), false);
  // With nothing kept, the rail is inert like everything else (Lightbox's rule).
  const r2 = inertOutside(sheet, body);
  assert.equal(rail.getAttribute('inert'), '');
  r2();
});

test('the store: open while mounted, and the spine’s close reaches every sheet, the top one first', () => {
  const order = [];
  const a = pushSheet('a', () => order.push('a'));
  const b = pushSheet('b', () => order.push('b'));
  assert.equal(openSheets(), 2);
  closeSheets();
  assert.deepEqual(order, ['b', 'a']);
  b(); a(); a();
  assert.equal(openSheets(), 0, 'a repeated release is a no-op');
});

// ── The effects, against the stub DOM ───────────────────────────────────────

async function mount(element, { activeElement } = {}) {
  const restoreDoc = installDocument();
  const handlers = [];
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = function focus() { document.activeElement = this; };
    n.children = []; n.isConnected = true; n.offsetParent = {};
    return n;
  };
  document.querySelectorAll = () => [];
  document.addEventListener = (type, fn) => { if (type === 'keydown') handlers.push(fn); };
  document.removeEventListener = (type, fn) => { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  if (activeElement) document.activeElement = activeElement;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    handlers, byTestId, props, text, body: document.body, root,
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

test('open: focus moves in, the page stops scrolling, and Escape closes; close: focus returns to the opener', async () => {
  const opener = { focused: 0, isConnected: true, focus() { this.focused += 1; } };
  const closed = [];
  const m = await mount(h(Sheet, { title: 'Ben Sample', onClose: () => closed.push('close') }, h('button', null, 'ok')), { activeElement: opener });
  try {
    assert.equal(document.activeElement, m.byTestId('sheet'), 'focus moved into the sheet');
    assert.equal(m.body.style.overflow, 'hidden', 'the page behind does not scroll');
    assert.equal(openSheets(), 1, 'the rail sees a sheet open');
    m.handlers[0]({ key: 'a', preventDefault() {} });
    assert.equal(closed.length, 0);
    let prevented = false;
    m.handlers[0]({ key: 'Escape', preventDefault() { prevented = true; } });
    assert.deepEqual(closed, ['close'], 'Escape closes');
    assert.equal(prevented, true);
    m.handlers[0]({ key: 'Escape', defaultPrevented: true, preventDefault() {} });
    assert.equal(closed.length, 1, 'an Escape a dialog above already handled is ignored');
  } finally { await m.unmount(); }
  assert.equal(opener.focused, 1, 'focus went back to what opened it');
  assert.equal(scrollLocks(), 0);
  assert.equal(openSheets(), 0, 'the rail sees it closed');
});

test('the scrim and the × close; a press that began inside the sheet does not', async () => {
  const closed = [];
  const m = await mount(h(Sheet, { title: 'T', onClose: () => closed.push(1) }, h('p', null, 'x')));
  try {
    const scrim = m.byTestId('sheet-scrim');
    m.props(scrim).onMouseDown({ target: m.byTestId('sheet'), currentTarget: scrim });
    assert.equal(closed.length, 0);
    m.props(scrim).onMouseDown({ target: scrim, currentTarget: scrim });
    assert.equal(closed.length, 1);
    m.props(m.byTestId('sheet-close')).onClick();
    assert.equal(closed.length, 2);
  } finally { await m.unmount(); }
});

test('a deep link opens the sheet over its list, and closing it returns to the list’s address', async () => {
  let at = null;
  function Probe() {
    const loc = useLocation();
    at = loc.pathname;
    return h(BuilderSection, { view: builderViewFor(loc.pathname), storage: null });
  }
  const m = await mount(h(MemoryRouter, { initialEntries: ['/account/builder/keys/k7f3'] }, h(Routes, null, h(Route, { path: '*', element: h(Probe) }))));
  try {
    assert.ok(m.byTestId('builder-drawer-key'), 'the address opened the sheet');
    assert.ok(m.byTestId('builder-wait-keys'), 'over its list page');
    assert.equal(m.props(m.byTestId('builder-drawer-key'))['data-width'], 560);
    await act(async () => { m.props(m.byTestId('builder-drawer-key-close')).onClick(); });
    assert.equal(at, '/account/builder/keys', 'closing went back to the list');
    assert.equal(m.byTestId('builder-drawer-key'), undefined, 'and the sheet is gone');
    assert.ok(m.byTestId('builder-wait-keys'));
  } finally { await m.unmount(); }
});

test('the sheet is wired the way the contract says: Tab handler, the shared Escape stack, no portal, no server call', () => {
  const src = read('frontend/src/ui/Sheet.jsx');
  assert.match(src, /onKeyDown=\{onTab\}/);
  assert.match(src, /tabTarget\(list, document\.activeElement, e\.shiftKey\)/);
  assert.match(src, /if \(e\.key !== 'Escape' \|\| e\.defaultPrevented \|\| !topmost\(id\)\) return;/);
  assert.match(src, /pushDialog\(id\)/, 'one Escape stack with Lightbox, so a confirmation over a sheet closes first');
  assert.doesNotMatch(src, /createPortal/);
  assert.doesNotMatch(src, /fetch\(|api\.|navigate\(/, 'closing is the caller’s');
  assert.match(src, /if \(props\.pageBelow === 'lg' && phoneWidth\) return <Lightbox \{\.\.\.props\} \/>;/, 'below 1024px a page stays the page it was');
  assert.match(src, /const phone = phoneProp \|\| inherited \|\| 'full';/, 'a page’s LightboxPhoneProvider applies');
});
