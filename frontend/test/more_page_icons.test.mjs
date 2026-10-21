/**
 * The phone's More page crashed with React error #31 (the owner, 2026-10-21):
 * its rows carry the sidebar's lucide icons, which are components, and
 * `PhoneRows` drew `row.icon` as a child. `rowIcon` now draws a component as
 * an element and passes a drawn element through.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/more_page_icons.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { moreGroups } from '../src/pages/MorePage.jsx';
import { PhoneRows, rowIcon } from '../src/ui/phone/PhoneRows.jsx';
import { PERSONAS } from '../src/lib/personas.js';

const h = React.createElement;
const draw = (groups) => renderToStaticMarkup(h(MemoryRouter, null, h(PhoneRows, { groups })));

test('More\'s rows draw, icons and all, for every founder persona', () => {
  // Mutation checked: PhoneRows back on `{row.icon}` (React error #31).
  const personas = [undefined, ...PERSONAS.filter((p) => p.role_alignment === 'founder').map((p) => p.id)];
  for (const persona of personas) {
    const groups = moreGroups(undefined, persona);
    assert.ok(groups.some((g) => g.rows.some((r) => typeof r.icon === 'object' || typeof r.icon === 'function')), 'the rows carry icon components, as the sidebar does');
    const html = draw(groups);
    assert.match(html, /href="\/network"/, String(persona));
    assert.match(html, /<svg[^>]*aria-hidden="true"/, `${persona}: no icon drawn`);
  }
});

test('rowIcon draws a component, passes an element through, and draws nothing for none', () => {
  // Mutation checked: an element wrapped again (an element is not a component).
  assert.match(renderToStaticMarkup(rowIcon(Mail)), /^<svg[^>]*width="18"/);
  const el = h('span', { id: 'given' }, 'x');
  assert.equal(rowIcon(el), el);
  assert.equal(rowIcon(null), null);
  assert.equal(rowIcon(undefined), null);
});
