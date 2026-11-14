// React DOM/effect harness and isolated source mutation imports for D695.
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';
import { installDocument } from './_contracts_dom.mjs';

export const h = React.createElement;
export const textOf = (node) => !node ? '' : node.nodeType === 3 ? node.textContent || '' : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '';
export const propsOf = (node) => node && Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];

export async function mountForm(element, { phone = false, modal = false } = {}) {
  const restore = installDocument();
  // React updates an existing text node through nodeValue, as a browser does.
  const makeText = document.createTextNode.bind(document);
  document.createTextNode = (value) => {
    const node = makeText(value);
    Object.defineProperty(node, 'nodeValue', { get: () => node.textContent, set: (text) => { node.textContent = String(text); } });
    return node;
  };
  const previousMedia = globalThis.matchMedia;
  const mediaListeners = new Set();
  const media = { matches: phone, media: '(max-width: 1023px)', addEventListener: (_type, fn) => mediaListeners.add(fn), removeEventListener: (_type, fn) => mediaListeners.delete(fn) };
  globalThis.matchMedia = (query) => { assert.equal(query, '(max-width: 1023px)'); return media; };
  const keys = [];
  let opener;
  if (modal) {
    const make = document.createElement.bind(document);
    const enhance = (node) => {
      const attrs = {};
      node.setAttribute = (key, value) => { attrs[key] = String(value); };
      node.getAttribute = (key) => attrs[key] ?? null;
      node.hasAttribute = (key) => Object.hasOwn(attrs, key);
      node.removeAttribute = (key) => { delete attrs[key]; };
      Object.defineProperty(node, 'children', { get: () => node.childNodes.filter((child) => child.nodeType === 1) });
      Object.defineProperty(node, 'isConnected', { get: () => { for (let n = node; n; n = n.parentNode) if (n === document.body) return true; return false; } });
      node.contains = (child) => walk(node).includes(child);
      node.focus = () => { document.activeElement = node; };
      node.getClientRects = () => [{}];
      node.querySelectorAll = (selector) => walk(node).slice(1).filter((child) => {
        if (selector === '[aria-modal="true"]') return propsOf(child)['aria-modal'] === 'true';
        if (selector === '[data-app-scroll]') return false;
        return ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(child.tagName) && !propsOf(child).disabled && propsOf(child).tabIndex !== -1
          || child.tagName === 'A' && propsOf(child).href;
      });
      node.querySelector = (selector) => node.querySelectorAll(selector)[0] ?? null;
      return node;
    };
    document.createElement = (tag) => enhance(make(tag));
    enhance(document.body);
    document.body.style.overflow = 'auto';
    document.querySelectorAll = (selector) => document.body.querySelectorAll(selector);
    document.addEventListener = (type, fn) => { if (type === 'keydown') keys.push(fn); };
    document.removeEventListener = (type, fn) => { if (type === 'keydown') { const at = keys.indexOf(fn); if (at >= 0) keys.splice(at, 1); } };
    opener = document.createElement('button'); document.body.appendChild(opener); document.activeElement = opener;
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const render = async (next) => { await act(async () => { root.render(h(MemoryRouter, null, next)); }); };
  await render(element);
  const nodes = () => walk(container);
  const by = (id) => nodes().find((node) => propsOf(node)['data-testid'] === id);
  const change = async (node, value) => { assert.ok(node, 'input exists'); await act(async () => propsOf(node).onChange({ target: { value, files: value == null ? [] : [value] } })); };
  return {
    nodes, by, props: propsOf, text: () => textOf(container), render, media, keys, opener, body: document.body, doc: document,
    async setPhone(value) { await act(async () => { media.matches = value; for (const fn of [...mediaListeners]) fn({ matches: value }); }); },
    async input(name, value) { await change(by('cycle-form-' + name), value); },
    async choose(name, value) { const node = nodes().find((node) => node.tagName === 'INPUT' && propsOf(node).name === name && propsOf(node).value === value); assert.ok(node, name + ': ' + value); assert.ok(!propsOf(node).disabled, 'choice enabled'); await change(node, value); },
    async submit() { const form = nodes().find((node) => node.tagName === 'FORM'); assert.ok(form, 'form exists'); await act(async () => propsOf(form).onSubmit({ preventDefault() {} })); },
    async click(label) { const node = nodes().find((node) => node.tagName === 'BUTTON' && textOf(node).trim() === label); assert.ok(node, 'button: ' + label); assert.ok(!propsOf(node).disabled); await act(async () => propsOf(node).onClick?.({ preventDefault() {}, stopPropagation() {} })); },
    async flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); },
    async escape() { const event = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; await act(async () => { for (const fn of [...keys]) fn(event); }); return event; },
    async unmount() { await act(async () => root.unmount()); globalThis.matchMedia = previousMedia; restore(); },
  };
}

let serial = 0;
// A data: module's imports skip the loader hook's lookup, so a relative one
// is resolved here as the hook does: the file, else it plus an extension, else
// its directory's index.
const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];
function fileTarget(specifier, url) {
  const file = fileURLToPath(new URL(specifier, url));
  const isFile = (p) => existsSync(p) && statSync(p).isFile();
  const found = [file, ...EXTS.map((ext) => file + ext), ...EXTS.map((ext) => file + '/index' + ext)].find(isFile);
  return pathToFileURL(found || file).href;
}
export async function sourceModule(source, path) {
  const url = new URL('../src/' + path, import.meta.url);
  const require = createRequire(url);
  const js = (await transformWithOxc(source, url.pathname, { jsx: { runtime: 'automatic' } })).code;
  // A specifier holds no space or comma, so copy such as "Start from" is not one.
  const resolved = js.replace(/((?:from\s*|import\s*\()\s*)['"]([^'"\s,]+)['"]/g, (_match, prefix, specifier) => {
    const target = specifier.startsWith('.') ? fileTarget(specifier, url) : pathToFileURL(require.resolve(specifier)).href;
    return prefix + JSON.stringify(target);
  });
  return import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64') + '#d695-' + serial++);
}
export async function mutationCheck(source, path, verify, mutations) {
  await verify(await sourceModule(source, path));
  for (const [before, after] of mutations) {
    assert.ok(source.includes(before), 'mutation target: ' + before);
    const module = await sourceModule(source.replace(before, after), path);
    await assert.rejects(async () => verify(module), { name: 'AssertionError' }, 'mutation must fail: ' + before);
  }
  await verify(await sourceModule(source, path));
}
