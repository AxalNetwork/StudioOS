/**
 * D685 (#1587) — the lightbox shell (`ui/Lightbox.jsx`, `ui/lightboxFocus.js`):
 * what keeps a dialog modal. The pure rules are tested directly; the effects
 * (scroll lock, inert background, Escape, focus return) run against the stub
 * DOM, patched with just enough of an element for the shell to manage.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lightbox_d685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import Lightbox from '../src/ui/Lightbox.jsx';
import { Lightbox as Barrel } from '../src/ui/index.js';
import { FOCUSABLE, inertOutside, lockScroll, pushDialog, scrollLocks, tabTarget, topmost } from '../src/ui/lightboxFocus.js';

const h = React.createElement;

test('Tab stays inside: it wraps at both ends, and pulls in focus that is outside', () => {
  const a = { n: 'a' }; const b = { n: 'b' }; const c = { n: 'c' };
  const list = [a, b, c];
  assert.equal(tabTarget(list, c, false), 0, 'Tab on the last goes to the first');
  assert.equal(tabTarget(list, a, true), 2, 'Shift+Tab on the first goes to the last');
  assert.equal(tabTarget(list, b, false), null, 'inside the list the browser moves focus');
  assert.equal(tabTarget(list, b, true), null);
  assert.equal(tabTarget(list, { n: 'outside' }, false), 0, 'focus outside is pulled in at the start');
  assert.equal(tabTarget(list, null, true), 2, '…or at the end with Shift');
  assert.equal(tabTarget([], null, false), -1, 'nothing to land on: the dialog itself holds focus');
  assert.equal(tabTarget([a], a, false), 0, 'one control: Tab stays on it');
  assert.equal(tabTarget([a], a, true), 0);
  assert.match(FOCUSABLE, /button:not\(\[disabled\]\)/);
  assert.match(FOCUSABLE, /\[tabindex\]:not\(\[tabindex="-1"\]\)/);
});

test('the page behind does not scroll, and two dialogs release it only when the last one closes', () => {
  const body = { style: { overflow: 'auto', paddingRight: '3px' } };
  const r1 = lockScroll(body);
  assert.equal(body.style.overflow, 'hidden');
  const r2 = lockScroll(body);
  assert.equal(scrollLocks(), 2);
  r1();
  assert.equal(body.style.overflow, 'hidden', 'one dialog still open');
  r1(); // a repeated release is a no-op, not a second decrement
  assert.equal(scrollLocks(), 1);
  r2();
  assert.equal(scrollLocks(), 0);
  assert.equal(body.style.overflow, 'auto', 'what was there is put back');
  assert.equal(body.style.paddingRight, '3px');
  assert.doesNotThrow(() => lockScroll(null)());
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

test('everything outside the dialog becomes inert and hidden, and is put back; what was already hidden is left alone', () => {
  const dialog = el('div');
  const inner = el('div', [dialog]);
  const rail = el('aside'); const alreadyInert = el('nav', [], { inert: '', 'aria-hidden': 'true' }); const script = el('script');
  const app = el('div', [inner, rail, alreadyInert, script]);
  const sib = el('footer');
  const body = el('body', [app, sib]);
  const restore = inertOutside(dialog, body);
  assert.equal(rail.getAttribute('inert'), '', 'the rail beside the page is inert');
  assert.equal(rail.getAttribute('aria-hidden'), 'true');
  assert.equal(sib.getAttribute('inert'), '', 'so is a sibling higher up');
  assert.equal(inner.hasAttribute('inert'), false, 'the path to the dialog is not');
  assert.equal(app.hasAttribute('inert'), false);
  assert.equal(dialog.hasAttribute('inert'), false);
  assert.equal(script.hasAttribute('inert'), false, 'a script is not a thing to hide');
  restore();
  assert.equal(rail.hasAttribute('inert'), false);
  assert.equal(rail.hasAttribute('aria-hidden'), false);
  assert.equal(sib.hasAttribute('inert'), false);
  assert.equal(alreadyInert.hasAttribute('inert'), true, 'inert before, inert after');
  assert.equal(alreadyInert.getAttribute('aria-hidden'), 'true');
});

test('only the top dialog answers Escape', () => {
  const pop1 = pushDialog('a'); const pop2 = pushDialog('b');
  assert.equal(topmost('b'), true);
  assert.equal(topmost('a'), false);
  pop2();
  assert.equal(topmost('a'), true, 'closing the top one hands Escape back');
  pop1();
  assert.equal(topmost('a'), false);
});

test('the shell: dialog, aria-modal, a name, 560px wide, a phone sheet, dark pair, z above the rail sheet', () => {
  const out = renderToStaticMarkup(h(Lightbox, { label: 'Record a session', title: 'Record a session', eyebrow: 'Validate · Customer research', sub: 'It lands in Interviews when you stop.', onClose() {} }, h('p', null, 'BODY')));
  assert.match(out, /role="dialog"[^>]*aria-modal="true"[^>]*aria-label="Record a session"/);
  assert.match(out, /max-width:560px/);
  assert.match(out, /z-\[80\]/, 'above the Worker AI rail sheet at z 50');
  assert.match(out, /max-sm:h-full[^"]*max-sm:rounded-none/, 'a full-screen sheet on a phone');
  assert.match(out, /dark:bg-gray-950/);
  assert.match(out, /dark:border-gray-800/);
  assert.match(out, /motion-safe:backdrop-blur/, 'no blur under prefers-reduced-motion');
  assert.match(out, /aria-label="Close"/);
  assert.match(out, /Validate · Customer research/);
  assert.match(out, /It lands in Interviews when you stop\./);
  assert.match(out, /BODY/);
  assert.equal(Barrel, Lightbox, 'the barrel exports the shell, so Build, Raise and Grow import it from ui');
  const wide = renderToStaticMarkup(h(Lightbox, { label: 'x', width: 720, onClose() {} }));
  assert.match(wide, /max-width:720px/);
});

// ── The effects, against a stub DOM with just enough of an element ──────────

async function mountShell({ activeElement } = {}) {
  const restoreDoc = installDocument();
  const handlers = [];
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = function focus() { document.activeElement = this; };
    n.children = []; n.isConnected = true; n.offsetParent = {};
    return n;
  };
  document.addEventListener = (type, fn) => { if (type === 'keydown') handlers.push(fn); };
  document.removeEventListener = (type, fn) => { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  if (activeElement) document.activeElement = activeElement;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const closed = [];
  const render = (extra = {}) => act(async () => { root.render(h(Lightbox, { label: 'Dialog', onClose: () => closed.push(1), ...extra }, h('button', null, 'ok'))); });
  await render();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    closed, handlers, byTestId, props, render, body: document.body,
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

test('open: the page stops scrolling and Escape closes; close: it scrolls again and the key is let go', async () => {
  const m = await mountShell();
  const body = m.body;
  try {
    assert.equal(body.style.overflow, 'hidden');
    assert.equal(m.handlers.length, 1, 'one keydown listener');
    m.handlers[0]({ key: 'a', preventDefault() {} });
    assert.equal(m.closed.length, 0, 'another key closes nothing');
    let prevented = false;
    m.handlers[0]({ key: 'Escape', preventDefault() { prevented = true; } });
    assert.equal(m.closed.length, 1, 'Escape asks the caller to close');
    assert.equal(prevented, true);
  } finally { await m.unmount(); }
  assert.equal(body.style.overflow, 'auto');
  assert.equal(scrollLocks(), 0);
});

test('a click on the backdrop closes; a click inside the dialog does not; the × closes', async () => {
  const m = await mountShell();
  try {
    const backdrop = m.byTestId('lightbox-backdrop');
    const dialog = m.byTestId('lightbox');
    m.props(backdrop).onMouseDown({ target: dialog, currentTarget: backdrop });
    assert.equal(m.closed.length, 0, 'a press that began inside the dialog is not a backdrop click');
    m.props(backdrop).onMouseDown({ target: backdrop, currentTarget: backdrop });
    assert.equal(m.closed.length, 1);
    assert.equal(m.props(backdrop)['aria-hidden'], 'true');
  } finally { await m.unmount(); }
});

test('focus goes back to what opened it, and to `returnFocusTo` when the caller names a control', async () => {
  const opener = { focused: 0, isConnected: true, focus() { this.focused += 1; } };
  const m = await mountShell({ activeElement: opener });
  await m.unmount();
  assert.equal(opener.focused, 1, 'closing returns focus to the opener');
  const gone = { focused: 0, isConnected: false, focus() { this.focused += 1; } };
  const m2 = await mountShell({ activeElement: gone });
  await m2.unmount();
  assert.equal(gone.focused, 0, 'an opener that left the page is not focused');
  const named = { focused: 0, isConnected: true, focus() { this.focused += 1; } };
  const other = { focused: 0, isConnected: true, focus() { this.focused += 1; } };
  const m3 = await mountShell({ activeElement: other });
  await m3.render({ returnFocusTo: { current: named } });
  await m3.unmount();
  assert.equal(other.focused + named.focused >= 1, true);
});

test('the shell is wired the way the contract says: Tab handler on the dialog, no portal, nothing server-side', () => {
  const src = readFileSync('frontend/src/ui/Lightbox.jsx', 'utf8');
  assert.match(src, /onKeyDown=\{onTab\}/);
  assert.match(src, /tabTarget\(list, document\.activeElement, e\.shiftKey\)/);
  assert.match(src, /if \(e\.key !== 'Escape' \|\| e\.defaultPrevented \|\| !topmost\(id\)\) return;/, 'only the top dialog acts, and never on an Escape already handled');
  assert.doesNotMatch(src, /createPortal/, 'a portal cannot be server-rendered, and a dialog that cannot be rendered cannot be tested');
  assert.doesNotMatch(src, /fetch\(|api\./, 'closing makes no server call');
  assert.match(src, /opener\.focus\?\.\(\)/);
  assert.match(src, /restore\(\); release\(\)/, 'both the inert and the scroll lock are released on close');
});
