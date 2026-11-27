/**
 * #1412 — /hq/credits, #1399's address for the credit rules page, lands on
 * D638's page at /admin/credit-rules and keeps the query string and the hash.
 *
 * The redirect is rendered, as D473's is: a scan of the route source would
 * still pass with the Navigate gone, and this fails because the location
 * does not change.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_credits_redirect_1412.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import HqCreditsRedirect from '../src/pages/hq/HqCreditsRedirect.jsx';

function makeNode(tag) {
  return {
    tagName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    nodeType: tag === '#text' ? 3 : 1,
    nodeName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    childNodes: [],
    style: {},
    parentNode: null,
    ownerDocument: null,
    textContent: '',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    hasAttribute() { return false; },
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; },
    insertBefore(child, ref) {
      child.parentNode = this;
      const at = this.childNodes.indexOf(ref);
      if (at < 0) this.childNodes.push(child);
      else this.childNodes.splice(at, 0, child);
      return child;
    },
    removeChild(child) {
      const at = this.childNodes.indexOf(child);
      if (at >= 0) this.childNodes.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    contains() { return false; },
    get firstChild() { return this.childNodes[0] || null; },
  };
}

function installDocument() {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    HTMLIFrameElement: globalThis.HTMLIFrameElement,
  };
  globalThis.window = globalThis;
  const document = {
    nodeType: 9,
    nodeName: '#document',
    activeElement: null,
    defaultView: globalThis,
    createElement(tag) {
      const node = makeNode(tag);
      node.ownerDocument = document;
      return node;
    },
    createElementNS(_ns, tag) { return document.createElement(tag); },
    createTextNode(text) {
      const node = makeNode('#text');
      node.textContent = String(text);
      node.ownerDocument = document;
      return node;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body');
  globalThis.document = document;
  globalThis.HTMLElement = function HTMLElement() {};
  globalThis.Element = function Element() {};
  globalThis.Node = function Node() {};
  globalThis.HTMLIFrameElement = function HTMLIFrameElement() {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.getSelection = () => null;
  return () => {
    for (const [key, value] of Object.entries(previous)) globalThis[key] = value;
  };
}

function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent || '';
  if (node.childNodes?.length) return node.childNodes.map(textOf).join('');
  return node.textContent || '';
}

async function landing(url) {
  const restore = installDocument();
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  function Here() {
    const loc = useLocation();
    return React.createElement('p', null, `${loc.pathname}${loc.search}${loc.hash}`);
  }
  try {
    await act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: [url] },
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/hq/credits', element: React.createElement(HqCreditsRedirect) }),
          React.createElement(Route, { path: '*', element: React.createElement(Here) }),
        )));
    });
    const out = textOf(container);
    await act(async () => { root.unmount(); });
    return out;
  } finally {
    restore();
  }
}

test('/hq/credits opens /admin/credit-rules and keeps the query string and the hash', async () => {
  assert.equal(await landing('/hq/credits?state=revoked#grants'), '/admin/credit-rules?state=revoked#grants');
  assert.equal(await landing('/hq/credits'), '/admin/credit-rules');
});
