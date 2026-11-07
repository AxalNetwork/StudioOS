// #4698 — a harness for rendering a real Delivery zone against a stubbed client.
// Every `api` method is replaced; one that a test does not answer never settles,
// so a zone that reads something unexpected hangs visibly instead of passing.
import React, { act } from 'react';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api };
const originalResearch = { ...api.research };
const never = () => new Promise(() => {});

/** Replaces the client; returns the call log. `answers[name]` may be a function or a value-returning function. */
export function stubApi(answers) {
  const calls = [];
  for (const k of Object.keys(originals)) {
    if (typeof originals[k] === 'function') {
      api[k] = (...a) => { calls.push([k, a]); return (answers[k] || never)(...a); };
    }
  }
  api.research = { ...originalResearch, zoneDrafts: async () => ({ items: [] }), zoneDraftRun: never };
  return calls;
}
export function restoreApi() { Object.assign(api, originals); api.research = originalResearch; }

/** A promise the test settles by hand. */
export function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));
const within = (node, ancestor) => { for (let p = node; p; p = p.parentNode) if (p === ancestor) return true; return false; };

export async function mountZone(Zone, url) {
  const view = await mountContracts(React.createElement(Zone), url);
  const buttons = (label) => view.nodes().filter((n) => n.tagName === 'BUTTON' && walk(n).trim() === label);
  const byAria = (label) => view.nodes().filter((n) => n.tagName === 'BUTTON' && view.props(n)['aria-label'] === label);
  const press = async (label, nth = 0) => {
    const node = buttons(label)[nth];
    if (!node) throw new Error(`Missing button: ${label}`);
    await act(async () => { view.props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
  };
  const pressNode = async (node) => { await act(async () => { view.props(node).onClick({ preventDefault() {}, stopPropagation() {} }); }); };
  const field = (labelStart, nth = 0) => {
    const labels = view.nodes().filter((n) => n.tagName === 'LABEL' && walk(n).trim().startsWith(labelStart));
    const label = labels[nth];
    const el = label && view.nodes().filter((n) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName)).find((n) => within(n, label));
    if (!el) throw new Error(`Missing field: ${labelStart}`);
    return el;
  };
  const type = async (labelStart, value, nth = 0) => {
    const el = field(labelStart, nth);
    await act(async () => { view.props(el).onChange({ target: { value } }); });
  };
  const valueOf = (labelStart, nth = 0) => view.props(field(labelStart, nth)).value;
  const settle = async () => { for (let i = 0; i < 4; i += 1) await view.flush(); };
  const alerts = () => view.nodes().filter((n) => view.props(n)?.role === 'alert').map(walk);
  const statuses = () => view.nodes().filter((n) => view.props(n)?.role === 'status').map(walk);
  return { ...view, buttons, byAria, press, pressNode, field, type, valueOf, settle, alerts, statuses };
}
