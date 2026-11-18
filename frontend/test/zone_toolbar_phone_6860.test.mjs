/**
 * #6860 — the shared ZoneToolbar's filter chips and toolbar actions are 44px targets below 640px, and desktop keeps
 * the canvas's `.fil` size. Every workspace mounts this row, so the rule lives in `ZoneToolbar.jsx` itself.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/zone_toolbar_phone_6860.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const { default: ZoneToolbar, PHONE_TARGET, PHONE_ACTION_TARGETS } = await import('../src/workspaces/ZoneToolbar.jsx');

const h = React.createElement;
// Class attributes carry `&` as `&amp;`; decode it so `max-sm:[&_a]:…` compares as written.
const render = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(ZoneToolbar, props))).replace(/&amp;/g, '&');
const classesOf = (html, tag) => [...html.matchAll(new RegExp(`<${tag}[^>]*class="([^"]*)"`, 'g'))].map((m) => m[1].split(/\s+/));

const FILTERS = [
  { label: 'All', active: true, onSelect: () => {} },
  { label: 'Open', onSelect: () => {} },
  { label: 'Not recorded', disabled: true, title: 'Nothing stores this yet.' },
];
const ACTIONS = [{ label: 'Export', to: '/x' }, { label: 'Refresh', onClick: () => {} }];

test('#6860 below 640px every chip is at least 44px tall and 44px wide, in every licence', () => {
  assert.equal(PHONE_TARGET, 'max-sm:min-h-[44px] max-sm:min-w-[44px] max-sm:justify-center');
  for (const role of ['investor', 'partner', 'founder', 'advisor']) {
    const chips = classesOf(render({ filters: FILTERS, role }), 'button');
    assert.equal(chips.length, FILTERS.length, `${role}: one button a chip`);
    for (const c of chips) {
      for (const want of ['max-sm:min-h-[44px]', 'max-sm:min-w-[44px]']) assert.ok(c.includes(want), `${role}: a chip lacks ${want}`);
    }
  }
});

test('#6860 the toolbar\'s actions are 44px targets below 640px, set on its own ZoneActions wrapper only', () => {
  const html = render({ filters: FILTERS, actions: ACTIONS, role: 'investor' });
  const wrapper = html.match(/<div class="(flex flex-wrap items-center gap-2 [^"]*)"/);
  assert.ok(wrapper, 'the ZoneActions wrapper renders');
  for (const want of PHONE_ACTION_TARGETS.split(' ')) assert.ok(wrapper[1].split(/\s+/).includes(want), `the actions wrapper lacks ${want}`);
  for (const sel of ['a', 'button']) {
    assert.match(PHONE_ACTION_TARGETS, new RegExp(`max-sm:\\[&_${sel}\\]:min-h-\\[44px\\]`), `${sel} height`);
    assert.match(PHONE_ACTION_TARGETS, new RegExp(`max-sm:\\[&_${sel}\\]:min-w-\\[44px\\]`), `${sel} width`);
  }
  // The row still wraps, so a taller chip moves to the next line instead of clipping.
  assert.match(html, /data-testid="zone-toolbar" class="[^"]*\bflex-wrap\b/);
  assert.match(html, /<div class="flex flex-wrap gap-1\.5">/);
});

test('#6860 desktop is untouched: no size class applies at 640px and up', () => {
  const html = render({ filters: FILTERS, actions: ACTIONS, role: 'founder' });
  const sizing = /^(min-h-|min-w-|h-|w-|sm:min-h|sm:min-w|md:min-h|md:min-w|lg:min-h)/;
  for (const c of classesOf(html, 'button').flat()) assert.doesNotMatch(c, sizing, `a chip sizes itself at desktop: ${c}`);
  for (const c of PHONE_ACTION_TARGETS.split(' ')) assert.match(c, /^max-sm:/, `${c} is not phone-only`);
  for (const c of PHONE_TARGET.split(' ')) assert.match(c, /^max-sm:/, `${c} is not phone-only`);
  // The canvas's `.fil` size stays: 11px semibold, 5px by 10px padding.
  const chip = classesOf(html, 'button')[0];
  for (const want of ['text-[11px]', 'font-semibold', 'px-2.5', 'py-[5px]', 'rounded-[7px]']) assert.ok(chip.includes(want), `chip lost ${want}`);
});

test('#6860 the opt-in `tap` still widens the 44px height up to md, as #6855 drew it for Thinking', () => {
  const chips = classesOf(render({ filters: FILTERS, tap: true }), 'button');
  for (const c of chips) assert.ok(c.includes('min-h-[44px]') && c.includes('md:min-h-0'), 'tap keeps its range');
});
