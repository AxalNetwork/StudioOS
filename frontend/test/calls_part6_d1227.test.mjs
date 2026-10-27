/**
 * D1227 (#3226) — Calls for Capital part 6: the old address of one call is a
 * counted redirect, the Calls history left Capital relationships' Overview, a
 * call's amounts read Indicated wherever a founder sees them, and every link
 * names the new address.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calls_part6_d1227.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { ParamRedirect } from '../src/pages/cycles/ParamRedirect.jsx';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const h = React.createElement;

test('/raise/calls/:uid forwards to the call under Capital relationships, and is counted', () => {
  const app = read('frontend/src/App.jsx');
  // Mutation checked: keep RaiseCallPage on the old address → this fails.
  assert.match(app, /<Route path="\/raise\/calls\/:uid" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <ParamRedirect to="\/raise\/capital-relationships\/calls\/:uid" \/>\)\} \/>/);
  assert.match(app, /<Route path="\/raise\/capital-relationships\/calls\/:uid" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <RaiseCallPage \/>\)\} \/>/);
  // Mutation checked: drop the entry → the beacon cannot count the old address.
  assert.ok(REDIRECT_ROUTES.some((r) => r.path === '/raise/calls/:uid' && !r.keep), 'counted until #2319');
});

test('the redirect keeps the call, its query and its hash', async () => {
  const restore = installDocument();
  let at = '';
  function Where() { const l = useLocation(); at = `${l.pathname}${l.search}${l.hash}`; return null; }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/raise/calls/k1?project_id=7#responses'] }, h(Routes, null,
      h(Route, { path: '/raise/calls/:uid', element: h(ParamRedirect, { to: '/raise/capital-relationships/calls/:uid' }) }),
      h(Route, { path: '/raise/capital-relationships/calls/:uid', element: h(Where) })))));
    assert.equal(at, '/raise/capital-relationships/calls/k1?project_id=7#responses');
  } finally { await act(async () => root.unmount()); restore(); }
});

test('the Calls history left Overview; Calls for Capital is the Calls tab', () => {
  // Mutation checked: restore the mount → this fails.
  assert.equal(existsSync(new URL('../src/pages/cycles/CallsHistory.jsx', import.meta.url)), false);
  assert.doesNotMatch(codeOnly(read('frontend/src/pages/cycles/CycleRoute.jsx')), /CallsHistory/);
});

test('no founder view of a call says committed: its amounts are Indicated (D653)', () => {
  // Words a person reads: string and template literals, outside comments. A
  // field name such as `committed_at` is not a word on screen.
  const SAID = /(['"`])(?:(?!\1)[^\n])*\bcommitted\b(?!_)(?:(?!\1)[^\n])*\1/i;
  for (const f of [
    'frontend/src/pages/raise/calls/callsModel.js', 'frontend/src/pages/raise/calls/CallsTab.jsx',
    'frontend/src/pages/founder/RaiseCallPage.jsx', 'frontend/src/pages/founder/RoundCallPage.jsx',
    'frontend/src/pages/founder/RoundCallSheet.jsx', 'frontend/src/pages/founder/SentUpdatePage.jsx',
  ]) {
    assert.doesNotMatch(codeOnly(read(f)), SAID, f);
  }
  // The retired history's own line, "committed $100,000 of $1,500,000", is the shape this refuses.
  assert.match("`committed ${moneyCents(1)} of ${moneyCents(2)}`", SAID);
});

test('every link to a sent call names the new address', () => {
  // Mutation checked: leave the notice on /raise/calls/ → this fails.
  assert.match(read('cloudflare-worker/src/services/roundCalls.ts'), /link:'\/raise\/capital-relationships\/calls\/'\+call\.uid/);
  for (const f of ['cloudflare-worker/src/services/roundCalls.ts', 'frontend/src/pages/founder/SentUpdatePage.jsx', 'frontend/src/pages/founder/RoundCallPage.jsx']) {
    assert.doesNotMatch(read(f), /'\/raise\/calls\/'/, f);
  }
  const rail = read('frontend/src/lib/railPages.js');
  assert.match(rail, /alias\('\/raise\/call', [^\n]*sent Calls for Capital are on Capital relationships’ Calls tab/);
  assert.doesNotMatch(rail, /its history is \/raise\/calls/);
});
