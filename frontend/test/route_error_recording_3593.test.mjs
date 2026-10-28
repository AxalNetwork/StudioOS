import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { RouteErrorBoundary } from '../src/components/RouteErrorBoundary.jsx';
import { setCaptureProbe } from '../src/lib/captureGuard.js';

const chunk = new Error('Failed to fetch dynamically imported module');
const boundary = (error = chunk) => {
  const b = new RouteErrorBoundary({});
  b.state = { error, reloading: false, caughtAt: 0 };
  return b;
};
const html = (b) => renderToStaticMarkup(React.createElement(MemoryRouter, null, b.render()));

test('recording chunk card keeps recording and Studio reachable through SPA links, even with an automatic reload queued', () => {
  setCaptureProbe(() => true);
  try {
    const b = boundary(); b.state.reloading = true;
    const out = html(b);
    assert.match(out, /A new version is ready\. This page reloads when your recording ends\./);
    assert.match(out, /href="\/validate\/record\/live"[^>]*>Return to recording/);
    assert.match(out, /href="\/studio"/);
    assert.match(out, />Reload</);
  } finally { setCaptureProbe(null); }
});

test('Reload defers both guard cleanup and reload until capture ends; repeated clicks queue once', () => {
  let capturing = true, reloads = 0, cleared = 0;
  const timers = [];
  const original = { window: globalThis.window, sessionStorage: globalThis.sessionStorage, setTimeout: globalThis.setTimeout };
  globalThis.window = { location: { href: 'https://example.test/studio?__boundary=1', reload: () => reloads++ }, history: { replaceState() {} } };
  globalThis.sessionStorage = { removeItem: () => cleared++ };
  globalThis.setTimeout = (cb) => { timers.push(cb); return 1; };
  setCaptureProbe(() => capturing);
  try {
    const b = boundary(); b.handleChunkReload(); b.handleChunkReload();
    assert.equal(reloads, 0); assert.equal(cleared, 0); assert.equal(timers.length, 1);
    capturing = false; timers.shift()();
    assert.equal(reloads, 1); assert.equal(cleared, 1);
  } finally { Object.assign(globalThis, original); setCaptureProbe(null); }
});

test('idle chunk card and immediate Reload remain unchanged; ordinary errors keep Try again', () => {
  setCaptureProbe(() => false);
  const original = { window: globalThis.window, sessionStorage: globalThis.sessionStorage };
  let reloads = 0;
  globalThis.window = { location: { href: 'https://example.test/studio', reload: () => reloads++ }, history: { replaceState() {} } };
  globalThis.sessionStorage = { removeItem() {} };
  try {
    const b = boundary();
    assert.match(html(b), /A new version of the app was just deployed\. Reload to pick it up\./);
    assert.doesNotMatch(html(b), /Return to recording/);
    b.handleChunkReload(); assert.equal(reloads, 1);
    assert.match(html(boundary(new Error('ordinary render failure'))), /Try again/);
  } finally { Object.assign(globalThis, original); setCaptureProbe(null); }
});
