/**
 * The phone's More page crashed with React error #31 (the owner, 2026-10-21):
 * its rows carry the sidebar's lucide icons, which are components, and
 * `PhoneRows` drew `row.icon` as a child. `rowIcon` now draws a component as
 * an element and passes a drawn element through.
 *
 * The More page itself went with #2297 (#2328): the tab bar's More opens the
 * sidebar drawer. `PhoneRows` keeps the fix for every other caller handed the
 * sidebar's icon components.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/more_page_icons.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Mail, Network } from 'lucide-react';
import { PhoneRows, rowIcon } from '../src/ui/phone/PhoneRows.jsx';

const h = React.createElement;
const draw = (groups) => renderToStaticMarkup(h(MemoryRouter, null, h(PhoneRows, { groups })));

test('rows carrying the sidebar\'s icon components draw, icons and all', () => {
  // Mutation checked: PhoneRows back on `{row.icon}` (React error #31).
  assert.equal(typeof Network, 'object', 'a lucide icon is a forwardRef component, as the sidebar hands it');
  const html = draw([{ label: 'Grow', rows: [{ title: 'Network', to: '/network', icon: Network }, { title: 'Messages', to: '/messages', icon: Mail }] }]);
  assert.match(html, /href="\/network"/);
  assert.equal((html.match(/<svg[^>]*aria-hidden="true"/g) || []).length, 2, 'an icon per row');
});

test('rowIcon draws a component, passes an element through, and draws nothing for none', () => {
  // Mutation checked: an element wrapped again (an element is not a component).
  assert.match(renderToStaticMarkup(rowIcon(Mail)), /^<svg[^>]*width="18"/);
  const el = h('span', { id: 'given' }, 'x');
  assert.equal(rowIcon(el), el);
  assert.equal(rowIcon(null), null);
  assert.equal(rowIcon(undefined), null);
});
