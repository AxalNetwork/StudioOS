/**
 * #4574 (H4) — four eager imports no longer drag pages into the shell, and nothing they served changed.
 *
 *   · DataRoomMoved takes `useMovedNotice` from AdminPageHeader, not the `ui` barrel;
 *   · the use-of-funds redirect takes `movedTo` from useOfFundsPaths.js, not the forecast model;
 *   · the recording pill takes `clock` and `useDarkTheme` from recordingClock.js, not RecordingView;
 *   · CheckoutHost and AddTokensHost load their sheet the first time it opens (lazySheet), with an "Opening…" dialog
 *     while it loads and an explicit "couldn't load; no payment was started" dialog if the chunk cannot be fetched.
 * The old import paths still export the same functions, so every other importer resolves unchanged.
 * The shell's measured size is held by check-bundle-budget (budget lowered in this change).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/shell_split_4574_h4.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { lazySheet, SheetOpening, SheetUnavailable } from '../src/components/checkout/lazySheet.jsx';
import * as paths from '../src/pages/raise/useoffunds/useOfFundsPaths.js';
import * as forecast from '../src/pages/raise/useoffunds/scenariosForecastModel.js';
import * as uof from '../src/pages/raise/useoffunds/useOfFundsModel.js';
import * as clockMod from '../src/pages/founder/recordingClock.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the four eager importers no longer reach the heavy modules', () => {
  // Mutation checked: putting back `from '../../../ui'` in DataRoomMoved fails here (and the shell budget fails in drift).
  assert.doesNotMatch(src('pages/raise/dataroom/DataRoomMoved.jsx'), /from '\.\.\/\.\.\/\.\.\/ui'/);
  assert.match(src('pages/raise/dataroom/DataRoomMoved.jsx'), /from '\.\.\/\.\.\/\.\.\/ui\/AdminPageHeader'/);
  assert.match(src('pages/raise/useoffunds/UseOfFundsMovedRedirect.jsx'), /import \{ movedTo \} from '\.\/useOfFundsPaths'/);
  assert.doesNotMatch(src('pages/raise/useoffunds/UseOfFundsMovedRedirect.jsx'), /scenariosForecastModel/);
  assert.match(src('pages/founder/RecordingPill.jsx'), /from '\.\/recordingClock'/);
  assert.doesNotMatch(src('pages/founder/RecordingPill.jsx'), /from '\.\/RecordingView'/);
  for (const [f, sheet] of [['components/checkout/CheckoutHost.jsx', 'CheckoutSheet'], ['components/checkout/AddTokensHost.jsx', 'PackSheet']]) {
    assert.doesNotMatch(src(f), new RegExp(`^import ${sheet} from`, 'm'), `${f} does not import ${sheet} statically`);
    assert.match(src(f), new RegExp(`const ${sheet} = lazySheet\\(\\(\\) => import\\('\\./${sheet}'\\)`));
  }
});

test('the moved helpers are the same functions at their old addresses', () => {
  assert.equal(forecast.movedTo, paths.movedTo);
  assert.equal(forecast.FORECAST_PATH, paths.FORECAST_PATH);
  assert.equal(uof.HOME_PATH, paths.HOME_PATH);
  assert.equal(uof.SLUG, 'use-of-funds');
  assert.deepEqual(paths.movedTo('?project=7&x=1'), { pathname: '/raise/use-of-funds/runway/forecast', search: '?x=1&project_id=7&moved=capital-model' });
  assert.equal(clockMod.clock(3_723_000), '01:02:03');
  assert.equal(clockMod.clock(-5), '00:00:00');
  const view = src('pages/founder/RecordingView.jsx');
  assert.match(view, /export \{ clock, short, useDarkTheme \};/, 'RecordingView still exports the timer, the short form and the theme hook');
});

test('a lazy sheet says it is opening, then draws the sheet with its props', async () => {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  let release;
  const Sheet = lazySheet(() => new Promise((r) => { release = r; }), 'Checkout');
  try {
    await act(async () => { root.render(h(Sheet, { plan: 'growth', onClose() {} })); });
    const walk0 = (n) => [n, ...(n.childNodes || []).flatMap(walk0)];
    const pr0 = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    assert.ok(walk0(container).find((n) => pr0(n)['data-testid'] === 'lazy-sheet-opening'), 'the opening dialog is what is drawn while the module loads');
    const opening = renderToStaticMarkup(h(SheetOpening, { label: 'Checkout' }));
    assert.match(opening, /aria-busy="true"/);
    assert.match(text(opening), /Opening checkout…/);
    await act(async () => { release({ default: ({ plan }) => h('div', { 'data-testid': 'real-sheet' }, `plan ${plan}`) }); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const real = walk(container).find((n) => pr(n)['data-testid'] === 'real-sheet');
    assert.ok(real, 'the sheet itself draws once its module loads');
  } finally { await act(async () => root.unmount()); restore(); }
});

test('a sheet whose chunk cannot load says so and that no payment started, never a blank or a crash', async () => {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  let closed = 0;
  // Mutation checked: without the loader's .catch the lazy component throws into the tree and this test errors.
  const Sheet = lazySheet(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')), 'Add tokens');
  try {
    await act(async () => { root.render(h(Sheet, { onClose: () => { closed += 1; } })); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
    assert.ok(by('lazy-sheet-unavailable'));
    await act(async () => { pr(by('lazy-sheet-close')).onClick(); });
    assert.equal(closed, 1);
  } finally { await act(async () => root.unmount()); restore(); }
  const html = text(renderToStaticMarkup(h(SheetUnavailable, { label: 'Checkout', onClose() {}, reload() {} })));
  assert.match(html, /Checkout couldn’t load just now\./);
  assert.match(html, /No payment was started\./);
  assert.match(html, /Reload/);
});
