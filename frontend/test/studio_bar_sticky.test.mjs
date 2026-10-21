/**
 * The owner's phone pass (2026-10-21): the Eadwyn AI bar on `/studio` scrolled
 * away with Tasks. The bar is sticky at the top of the shell's scroll now, on
 * its own background, above the chat's sticky composer. `StudioPhone` is drawn
 * below 1024px only (`FounderStudioHome`), so the desktop Studio is untouched.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/studio_bar_sticky.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import StudioPhone from '../src/pages/founder/StudioPhone.jsx';

const h = React.createElement;
const bar = () => {
  const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/studio?tab=tasks'] },
    h(StudioPhone, { tab: 'tasks' }, h('div', null, 'STUB CHAT'))));
  const m = html.match(/<div class="([^"]*)" data-testid="studio-phone-bar">/);
  assert.ok(m, 'the bar is not drawn');
  return { cls: m[1].split(' '), html };
};

test('the bar is sticky at the top of the scroll, opaque in both themes, above the composer', () => {
  // Mutations checked: sticky dropped; the background dropped (the list shows through); z-index at or under the composer's z-10.
  const { cls, html } = bar();
  for (const c of ['sticky', 'top-0', 'z-20', 'bg-white', 'dark:bg-gray-950']) assert.ok(cls.includes(c), c);
  assert.ok(html.indexOf('studio-phone-bar') < html.indexOf('STUB CHAT'), 'the bar is above the chat');
  assert.match(html, /Eadwyn AI<\/h1>/);
  assert.match(html, />Tasks</);
});

test('the bar is the page\'s child, so it stays stuck for the whole page, and only the phone draws it', () => {
  // The bar's containing block is the page's root, which runs the full length of the scroll.
  const src = codeOnly(readFileSync('frontend/src/pages/founder/StudioPhone.jsx', 'utf8'));
  const root = src.slice(src.indexOf('data-testid="studio-phone"'));
  assert.match(root, /^data-testid="studio-phone">[\s{}]*<div className="sticky top-0 /);
  const home = codeOnly(readFileSync('frontend/src/pages/founder/FounderStudioHome.jsx', 'utf8'));
  assert.match(home, /if \(phone\) \{\s*return <StudioPhone /);
});
