/**
 * #4827 (D4827) — Expertise › Visibility to board EX-12 of the Expertise v2 canvas (D4823): honest, actionable.
 *
 *   · four tiles named for what each counts: Article opens (raw, not people, since published), Booking requests
 *     (in the window), and Talk reach and Profile views as Not recorded, never 0;
 *   · a failed read is "could not be read · Try again", distinct from Not recorded and from 0;
 *   · Articles by opens names the most-opened pieces and adds up the rest;
 *   · a session type no active link sells shows "No booking link yet" with Add booking link;
 *   · at most three next steps, each from a recorded fact, none where the data does not support one;
 *   · the 7 / 30 / 90-day window is what the zone reads.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/expertise_visibility_4827.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm, sourceModule, mutationCheck } from './_form_d695.mjs';
import {
  ADD_BOOKING_LINK_HREF, VISIBILITY_WINDOWS, VisibilityView, WRITE_HREF, visibilityActions,
} from '../src/pages/advisor/expertise/VisibilityZone.jsx';

const routed = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const writing = (o = {}) => ({
  published: 5, opens: 412, opens_note: 'Times your pieces were opened here.', requests: null, requests_note: 'A booking does not record which piece led to it.',
  top: [{ slug: 'icp', title: 'ICP before pitch', opens: 186 }, { slug: 'board', title: 'Three numbers your board wants', opens: 121 }],
  others: { count: 3, opens: 105 },
  ...o,
});
const data = (o = {}) => ({
  window: { days: 30 },
  surfaces: [{ key: 'link:a', kind: 'booking_link', name: '/b/intro', is_active: true, requests: 3, by_status: { confirmed: 3 } }],
  requests: { total: 3, by_status: { confirmed: 3 } },
  writing: writing(),
  unlinked_services: { items: [{ uid: 't-1', name: 'Fundraising strategy' }], more: false },
  views: null, views_note: 'No profile view is recorded anywhere in the product.',
  ...o,
});

// Mutation checked: the opens tile drawn as "People reached" (fails); Talk reach drawn as 0 (fails).
test('#4827 the four tiles say what each counts; Talk reach and Profile views are Not recorded, never 0', () => {
  const html = routed(h(VisibilityView, { data: data(), onRetry() {} }));
  const tiles = text(html.slice(html.indexOf('advisor-visibility-tiles'), html.indexOf('advisor-visibility-actions')));
  assert.match(tiles, /Article opens 412 Raw opens since each piece was published, not unique people\./);
  assert.match(tiles, /Booking requests 3 On your booking links, last 30 days\./);
  assert.match(tiles, /Talk reach Not recorded Nothing in the product records how many people heard a talk\./);
  assert.match(tiles, /Profile views Not recorded No profile view is recorded anywhere in the product\./);
  assert.doesNotMatch(text(html), /People reached|unique visitors|conversion/i, 'no metric implies people, conversion or attribution');
});

// Mutation checked: a failed writing read drawn as 0 opens (fails). The `surfaces !== null` guard on the requests tile
// is an equivalent mutation: the Worker returns `requests: null` whenever the links read fails, so dropping it changes
// nothing this test can see; it stays as a guard for a merged later page.
test('#4827 a failed read says "could not be read · Try again", never 0 and never Not recorded', () => {
  const html = text(routed(h(VisibilityView, { data: data({ writing: null, surfaces: null, requests: null }), onRetry() {} })));
  assert.match(html, /Article opens Your writing could not be read · Try again/);
  assert.match(html, /Booking requests Your booking links could not be read · Try again/);
  assert.doesNotMatch(html, /Article opens 0|Booking requests 0/);
  const types = text(routed(h(VisibilityView, { data: data({ unlinked_services: null }), onRetry() {} })));
  assert.match(types, /Your session types could not be read · Try again/);
  assert.doesNotMatch(types, /No booking link yet/);
});

test('#4827 Articles by opens names the most-opened pieces and adds the rest up', () => {
  const html = text(routed(h(VisibilityView, { data: data(), onRetry() {} })));
  assert.match(html, /Articles by opens Since each was published ICP before pitch 186 opens Three numbers your board wants 121 opens 3 other pieces 105 opens/);
  const none = text(routed(h(VisibilityView, { data: data({ writing: writing({ published: 0, opens: 0, top: [], others: { count: 0, opens: 0 } }) }), onRetry() {} })));
  assert.match(none, /No piece is published yet\. Write a piece/);
});

// Mutation checked: the unlinked row's action dropped (fails); it pointing anywhere but the booking links card (fails).
test('#4827 a session type no link sells says "No booking link yet" and offers Add booking link', () => {
  const html = routed(h(VisibilityView, { data: data(), onRetry() {} }));
  assert.match(text(html), /Fundraising strategy · No booking link yet Add booking link/);
  assert.equal(ADD_BOOKING_LINK_HREF, '/practice/sessions#booking-links');
  const row = html.slice(html.indexOf('advisor-visibility-unlinked-row'), html.indexOf('</li>', html.indexOf('advisor-visibility-unlinked-row')));
  assert.ok(row.includes(`href="${ADD_BOOKING_LINK_HREF}"`), 'the row itself opens the booking links card');
  const more = text(routed(h(VisibilityView, { data: data({ unlinked_services: { items: [{ uid: 't-1', name: 'A' }], more: true } }), onRetry() {} })));
  assert.match(more, /More session types have no booking link\./);
});

// Mutation checked: more than three steps (fails); a follow-up suggested for a piece with 0 opens (fails); a step
// suggested when the reads failed (fails).
test('#4827 next steps come only from recorded facts, at most three', () => {
  assert.deepEqual(visibilityActions(data()).map((a) => [a.label, a.to]), [['Add booking link', ADD_BOOKING_LINK_HREF], ['Write a follow-up', WRITE_HREF]]);
  assert.match(visibilityActions(data())[1].text, /“ICP before pitch” has the most opens of your pieces\./);
  const many = data({ unlinked_services: { items: [1, 2, 3, 4].map((i) => ({ uid: `t-${i}`, name: `T${i}` })), more: false } });
  assert.equal(visibilityActions(many).length, 3);
  assert.deepEqual(visibilityActions(data({ unlinked_services: { items: [], more: false }, writing: writing({ top: [{ slug: 'z', title: 'Zero', opens: 0 }] }) })), []);
  assert.deepEqual(visibilityActions(data({ unlinked_services: null, writing: null })), [], 'nothing is suggested from a failed read');
  assert.deepEqual(visibilityActions(null), []);
});

// ── The window, mounted ─────────────────────────────────────────────────

const ZONE = 'pages/advisor/expertise/VisibilityZone.jsx';
const zone = readFileSync(new URL(`../src/${ZONE}`, import.meta.url), 'utf8');
const source = zone.replace(/^import \{ api \} from '..\/..\/..\/lib\/api';\n/m,
  'export const control = { calls: [], answer: null };\n'
  + 'const api = { async getMyAdvisorVisibility(days, page) { control.calls.push([days, page?.offset ?? 0]); return { ...control.answer, window: { days } }; } };\n');
assert.notEqual(source, zone, 'the api import was swapped');

async function windows(module) {
  module.control.answer = data(); module.control.calls = [];
  const f = await mountForm(h(module.default));
  try {
    await f.flush();
    assert.deepEqual(module.control.calls, [[30, 0]], '30 days by default');
    assert.ok(f.text().includes('On your booking links, last 30 days.'));
    await f.click('7 days');
    await f.flush();
    assert.deepEqual(module.control.calls.at(-1), [7, 0], 'the chosen window is read');
    assert.ok(f.text().includes('On your booking links, last 7 days.'));
    await f.click('90 days');
    await f.flush();
    assert.deepEqual(module.control.calls.at(-1), [90, 0]);
  } finally { await f.unmount(); }
}

test('#4827 the 7 / 30 / 90-day window is what the zone reads, 30 by default', async () => {
  assert.deepEqual(VISIBILITY_WINDOWS, [7, 30, 90]);
  await mutationCheck(source, ZONE, windows, [
    ['const reader = useCallback((page) => readVisibilityPage(days)(page), [days]);', 'const reader = useCallback((page) => readVisibilityPage()(page), []);'],
    ['onClick={() => setDays(d)}', 'onClick={() => {}}'],
  ]);
});

// Re-exported so a stray import is caught here rather than on a page.
test('#4827 the stubbed zone still loads', async () => {
  const module = await sourceModule(source, ZONE);
  assert.equal(typeof module.default, 'function');
});
