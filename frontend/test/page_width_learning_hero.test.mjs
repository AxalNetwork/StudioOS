import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SHARED_FULL_BLEED } from '../src/sidebarConfig.js';
import { LearningHomeView, LearningPhoneView } from '../src/pages/learning/LearningHome.jsx';

const read = p => readFileSync(p, 'utf8');
test('Pricing and Learning use the same edge-to-edge shell as Help', () => {
  for (const path of ['/help', '/pricing', '/pricing/', '/learning', '/learning/']) assert.ok(SHARED_FULL_BLEED.includes(path), path);
});
test('Account and every subsection fill the shell while retaining their own phone gutters', () => {
  const expression = read('frontend/src/App.jsx').match(/const fullWidthSurface =([\s\S]*?);\n/)[1];
  const width = new Function('fullBleedSurface', 'activeRole', 'location', `return (${expression});`);
  for (const role of ['founder', 'partner', 'investor', 'admin', 'exploring']) {
    for (const path of ['/account', '/account/', '/account/billing', '/account/connectors/mercury']) assert.equal(width(false, role, { pathname: path }), true, `${role} ${path}`);
    assert.equal(width(false, role, { pathname: '/accounting' }), false);
  }
  assert.ok(!SHARED_FULL_BLEED.includes('/account'), 'Account keeps shell padding for its phone frame');
});
test('Pricing body sections and FAQ have no narrow desktop width cap', () => {
  const css = read('frontend/src/pages/pricing.css');
  assert.match(css, /\.axp-sec\s*\{[^}]*width:\s*100%/);
  assert.doesNotMatch(css, /\.(?:axp-sec|axp-faq)\s*\{[^}]*max-width:\s*\d/);
});
test('Learning has one image-backed hero in desktop and phone layouts, including gated profiles', () => {
  for (const Component of [LearningHomeView, LearningPhoneView]) {
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Component, { gated: true, tab: 'articles' })));
    const hero = html.match(/<header[^>]*data-testid="learning-hero"[\s\S]*?<\/header>/)?.[0] || '';
    assert.match(hero, /<h1[^>]*>Learning<\/h1>/);
    assert.match(hero, /<img[^>]*src="\/site\/home-hero.webp"[^>]*alt=""/);
    assert.match(hero, /dark:from-gray-950\/90/);
    assert.match(hero, /href="\/articles\/draft"/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
  }
});
