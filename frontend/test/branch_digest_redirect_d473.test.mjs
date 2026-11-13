/**
 * D473 — `/branch` opens Studio, and the programme sentence keeps the
 * pending-account count the digest used to print.
 *
 * The redirect is rendered. A scan of the route source is not this test:
 * removing `<Navigate>` leaves the source able to mention Studio and still
 * fails here, because the location does not change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import BranchDigestRedirect from '../src/pages/branch/BranchDigestRedirect.jsx';
import { programmeGlance } from '../src/pages/admin/adminStudioOverview.js';

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

test('/branch opens /studio and keeps the query string and the hash', async () => {
  const restore = installDocument();
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  const { useLocation } = await import('react-router-dom');
  function Here() {
    const loc = useLocation();
    return React.createElement('p', null, `${loc.pathname}${loc.search}${loc.hash}`);
  }
  try {
    await act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: ['/branch?kept=1#sec'] },
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/branch', element: React.createElement(BranchDigestRedirect) }),
          React.createElement(Route, { path: '/branch/accounts', element: React.createElement('p', null, 'accounts') }),
          React.createElement(Route, { path: '/studio', element: React.createElement(Here) }),
        )));
    });
    assert.equal(textOf(container), '/studio?kept=1#sec');
    await act(async () => { root.unmount(); });
  } finally {
    restore();
  }
});

test('a /branch/* page is not sent to Studio', async () => {
  const restore = installDocument();
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: ['/branch/accounts'] },
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/branch', element: React.createElement(BranchDigestRedirect) }),
          React.createElement(Route, { path: '/branch/accounts', element: React.createElement('p', null, 'accounts') }),
          React.createElement(Route, { path: '/studio', element: React.createElement('p', null, 'studio') }),
        )));
    });
    assert.equal(textOf(container), 'accounts');
    await act(async () => { root.unmount(); });
  } finally {
    restore();
  }
});

test('the studio programme sentence includes a recorded pending-account count and does not invent one', () => {
  const open = { open_week: 2, zone: 'America/New_York', week_closes_at: '2026-09-23T04:00:00.000Z' };
  assert.equal(
    programmeGlance({ ...open, pending_accounts: 2 }, '23 Sep, 00:00').text,
    'Week 2 gate closes 23 Sep, 00:00 America/New_York · 2 accounts have not finished this week',
  );
  assert.equal(
    programmeGlance({ ...open, pending_accounts: 1 }, '23 Sep, 00:00').text,
    'Week 2 gate closes 23 Sep, 00:00 America/New_York · 1 account has not finished this week',
  );
  assert.equal(
    programmeGlance({ ...open, pending_accounts: 0 }, '23 Sep, 00:00').text,
    'Week 2 gate closes 23 Sep, 00:00 America/New_York · 0 accounts have not finished this week',
  );
  assert.equal(
    programmeGlance({ ...open, pending_accounts: null }, '23 Sep, 00:00').text,
    'Week 2 gate closes 23 Sep, 00:00 America/New_York',
  );
});
