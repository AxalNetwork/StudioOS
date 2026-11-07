// #4688: the harness for the Offers first-use and failed-save journeys.
//
// react-dom/server cannot click, and no jsdom is installed, so this reuses the
// repo's own synthetic document (`_contracts_dom.mjs`) and its `mountContracts`
// (click a button by label, fill a labelled field), adding only what these
// journeys need: reading a field back, finding text inside one element, and a
// way to load a zone from source with a mutation applied to the zone or to the
// shared `useGuardedWrite` hook, so a test can prove it fails when the
// behaviour it guards is broken.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { transformWithOxc } from 'vite';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';

export const h = React.createElement;
const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];
const isFile = (p) => existsSync(p) && statSync(p).isFile();
const SRC = new URL('../src/', import.meta.url);
let serial = 0;

function target(specifier, from) {
  if (!specifier.startsWith('.')) {
    try { return import.meta.resolve(specifier); } catch { return pathToFileURL(createRequire(from).resolve(specifier)).href; }
  }
  const file = fileURLToPath(new URL(specifier, from));
  const found = [file, ...EXTS.map((e) => file + e), ...EXTS.map((e) => file + '/index' + e)].find(isFile);
  return pathToFileURL(found || file).href;
}

/** Compile `source` as if it lived at `path` under src/; `swap` maps a specifier to another URL. */
async function compile(source, path, swap = {}) {
  const url = new URL(path, SRC);
  const js = (await transformWithOxc(source, url.pathname, { jsx: { runtime: 'automatic' } })).code;
  const out = js.replace(/((?:from\s*|import\s*\()\s*)['"]([^'"\s,]+)['"]/g, (_m, prefix, spec) => prefix + JSON.stringify(swap[spec] || target(spec, url)));
  return 'data:text/javascript;base64,' + Buffer.from(out).toString('base64') + '#o4688-' + serial++;
}

const HOOK = 'pages/partner/offers/useGuardedWrite.jsx';
const read = (path) => readFileSync(new URL(path, SRC), 'utf8');

function mutate(source, mutations, label) {
  let next = source;
  for (const [before, after] of mutations) {
    if (!next.includes(before)) throw new Error(`mutation target missing in ${label}: ${before}`);
    next = next.replace(before, after);
  }
  return next;
}

/** The zone default export, optionally with mutations to the zone and/or the hook. */
export async function loadZone(file, { zone = [], hook = [] } = {}) {
  const path = 'pages/partner/offers/' + file;
  if (!zone.length && !hook.length) return (await import(new URL(path, SRC).href)).default;
  const swap = hook.length
    ? { './useGuardedWrite': await compile(mutate(read(HOOK), hook, 'hook'), HOOK) }
    : {};
  return (await import(await compile(mutate(read(path), zone, file), path, swap))).default;
}

/** Replace api methods for one test; `restore()` puts every original back. */
export function stubApi(methods) {
  const saved = {};
  for (const [k, v] of Object.entries(methods)) { saved[k] = api[k]; api[k] = v; }
  return () => { for (const [k, v] of Object.entries(saved)) api[k] = v; };
}

export const httpError = (status, message) => Object.assign(new Error(message), { status });

export async function mountZone(Zone) {
  const m = await mountContracts(h(Zone));
  const text = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || '' : node.childNodes?.length ? node.childNodes.map(text).join('') : node.textContent || '');
  const labelled = (label) => {
    const l = m.nodes().find((n) => n.tagName === 'LABEL' && text(n).trim().startsWith(label));
    return l?.childNodes.find((n) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName));
  };
  const byTestId = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  return {
    ...m,
    has: (label) => m.nodes().some((n) => n.tagName === 'BUTTON' && text(n).trim() === label),
    value: (label) => { const n = labelled(label); if (!n) throw new Error('Missing field: ' + label); return m.props(n).value; },
    hasField: (label) => !!labelled(label),
    editor: (id) => byTestId(id),
    textIn: (id) => text(byTestId(id)),
    flush: async () => { await m.flush(); await m.flush(); },
  };
}
