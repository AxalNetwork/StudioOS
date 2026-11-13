/** Owner request: the investor Lab hero fills the main column; its body keeps a centered width limit. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import SpinoutLabInvestorPage from '../src/pages/SpinoutLabInvestorPage.jsx';
import { SHARED_FULL_BLEED } from '../src/sidebarConfig.js';

test('Investor Lab keeps its hero full width and its body capped', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(SpinoutLabInvestorPage)));
  const pageClass = html.match(/<div class="([^"]*)" data-testid="spinout-investor-page"/)[1];
  assert.doesNotMatch(pageClass, /max-w-|mx-auto/, 'no centered width cap around either section');
  assert.match(pageClass, /\bw-full\b/, 'page fills its column');
  assert.ok(SHARED_FULL_BLEED.includes('/spinout-lab'), 'the app shell supplies no outer gutter');
  assert.match(html, /data-testid="spinout-investor-hero"/);
  const bodyClass = html.match(/<div class="([^"]*)" data-testid="spinout-investor-body"/)[1];
  assert.match(bodyClass, /\bmx-auto\b/, 'body stays centered');
  assert.ok(bodyClass.split(' ').includes('max-w-[1240px]'), 'body retains its width limit');
});
