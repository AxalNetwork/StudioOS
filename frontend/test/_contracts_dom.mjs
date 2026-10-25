import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
function makeNode(tag) {
  return {
    tagName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    nodeType: tag === '#text' ? 3 : 1,
    nodeName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    childNodes: [], options: [], style: { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } }, parentNode: null, ownerDocument: null, textContent: '',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    // As in the DOM, a node already in the tree moves: it leaves its old place
    // first. React reorders keyed children by moving them (D980's roster).
    appendChild(child) { child.parentNode?.removeChild?.(child); child.parentNode = this; this.childNodes.push(child); return child; },
    insertBefore(child, ref) {
      child.parentNode?.removeChild?.(child);
      child.parentNode = this;
      const at = this.childNodes.indexOf(ref);
      if (at < 0) this.childNodes.push(child); else this.childNodes.splice(at, 0, child);
      return child;
    },
    removeChild(child) {
      const at = this.childNodes.indexOf(child);
      if (at >= 0) this.childNodes.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener() {}, removeEventListener() {}, contains() { return false; },
    get firstChild() { return this.childNodes[0] || null; },
  };
}
/**
 * `{ focus: true }` (opt-in, so no other suite changes) gives each node what a
 * focus-return test reads: `focus()` and `blur()` that move
 * `document.activeElement`, `isConnected` (still under <body>), and a real
 * `contains`. A removed node keeps focus here, where a browser would move it
 * to <body>; `isConnected === false` is how a page tells the two apart.
 */
function withFocus(n, document) {
  // Defined, not assigned: a suite may put a non-writable `focus` on Object.prototype.
  const own = (key, value) => Object.defineProperty(n, key, { value, configurable: true, writable: true });
  own('focus', function focus() { document.activeElement = this; });
  own('blur', function blur() { if (document.activeElement === this) document.activeElement = document.body; });
  own('contains', function contains(other) { for (let p = other; p; p = p.parentNode) if (p === this) return true; return false; });
  Object.defineProperty(n, 'isConnected', {
    configurable: true,
    get() { let p = this; while (p.parentNode) p = p.parentNode; return p === document.body || p === document.documentElement; },
  });
  return n;
}
export function installDocument(search = '', options = {}) {
  // Exactly `true`: a destructured default would read an inherited `Object.prototype.focus`.
  const focus = options?.focus === true;
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'HTMLIFrameElement', 'location', 'localStorage', 'addEventListener', 'removeEventListener'];
  const previous = Object.fromEntries(keys.map((k) => [k, globalThis[k]]));
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  const document = {
    nodeType: 9, nodeName: '#document', activeElement: null, defaultView: globalThis,
    createElement(tag) { const n = makeNode(tag); n.ownerDocument = document; return focus ? withFocus(n, document) : n; },
    createElementNS(_ns, tag) { return document.createElement(tag); },
    // React updates a text node through `nodeValue`, so it reads and writes the same text.
    createTextNode(text) {
      const n = makeNode('#text'); n.textContent = String(text); n.ownerDocument = document;
      Object.defineProperty(n, 'nodeValue', { configurable: true, get() { return this.textContent; }, set(v) { this.textContent = String(v); } });
      return n;
    },
    addEventListener() {}, removeEventListener() {},
  };
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body');
  globalThis.document = document;
  globalThis.HTMLElement = function HTMLElement() {};
  globalThis.Element = function Element() {};
  globalThis.Node = function Node() {};
  globalThis.HTMLIFrameElement = function HTMLIFrameElement() {};
  globalThis.location = { search, pathname: '/admin', hash: '' };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.getSelection = () => null;
  return () => { for (const [k, v] of Object.entries(previous)) globalThis[k] = v; };
}
const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');

export async function mountContracts(element, url = '/admin/contracts', user = null) {
  const restore = installDocument();
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(MemoryRouter, { initialEntries: [url] }, element)); });
  const nodes = () => { const walk = node => [node, ...(node.childNodes || []).flatMap(walk)]; return walk(container); };
  const props = node => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1];
  return {
    text: () => textOf(container),
    nodes, props,
    async flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); },
    async click(label) {
      const node = nodes().find(node => node.tagName === 'BUTTON' && textOf(node).trim() === label);
      if (!node) throw new Error('Missing button: ' + label);
      if (props(node).disabled) throw new Error('Disabled button: ' + label);
      await act(async () => { props(node).onClick({ stopPropagation() {} }); });
    },
    async fill(label, value) {
      const parent = nodes().find(node => node.tagName === 'LABEL' && textOf(node).trim().startsWith(label));
      const node = parent?.childNodes.find(node => ['INPUT','TEXTAREA','SELECT'].includes(node.tagName));
      if (!node) throw new Error('Missing input: ' + label);
      await act(async () => { props(node).onChange({ target: { value } }); });
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
