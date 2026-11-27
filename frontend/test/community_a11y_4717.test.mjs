/**
 * #4717 package 6 — the Community page by keyboard and by touch, held so a
 * change cannot quietly undo it:
 *   - every button and link on the page has a name and a target at least 24px
 *     tall (WCAG 2.5.8), the period control and the kind chips 32px;
 *   - the period control is a radio group with one stop in the tab order, and
 *     its keys move focus WITH the choice (arrows wrap, Home and End go to the
 *     ends), so the next key starts from where it is;
 *   - no Community file takes the keyboard focus ring away (`outline-none`):
 *     the ring is index.css's, for every focusable element.
 * Mounted on a stubbed `fetch` with a whole Community read; every record is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_a11y_4717.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { at, full } from './_community_overview_fixture.mjs';
import { COMMUNITY_PATH } from '../src/pages/admin/community/communityModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';

const h = React.createElement;

async function mount(url) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const x = new URL(String(u), 'http://x');
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (x.pathname === '/api/admin/community/overview') return json(full());
    if (x.pathname === '/api/admin/community/activity') {
      return json({ rows: [{ kind: 'events', actor: 'admin', icon: 'event-published', sentence: 'An admin published “Demo Day”.', title: 'Demo Day', href: '/admin/events', at: at(-1) }], total: 1, limit: 10, offset: 0, sources: ['events'], unreadable: [] });
    }
    return json({});
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let loc = null;
  function Spy() { const l = useLocation(); loc = `${l.pathname}${l.search}`; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminCommunity), h(Spy))); });
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    loc: () => loc,
    nodes: () => walk(container).filter((n) => n.nodeType === 1),
    textOf, props, byTestId, settle,
    async key(id, key) {
      await act(async () => { props(byTestId(id)).onKeyDown({ key, preventDefault() {} }); });
      await settle();
    },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

/** The smallest height a className guarantees, in px: `min-h-[Npx]`, `h-N` (N × 4px), or 0. */
function minHeight(cls) {
  const s = String(cls || '');
  const px = [...s.matchAll(/(?:^|\s)min-h-\[(\d+)px\]/g)].map((m) => Number(m[1]));
  const steps = [...s.matchAll(/(?:^|\s)h-(\d+)(?:\s|$)/g)].map((m) => Number(m[1]) * 4);
  return Math.max(0, ...px, ...steps);
}

test('every button and link on the page has a name and a target at least 24px tall', async () => {
  // Mutation checked: LINK without its min-h-[24px] → every text link fails here; a chip back to py-1 alone → fails at 32.
  // The fixture is a 4-week read, so the page draws every card on it.
  const m = await mount(`${COMMUNITY_PATH}?weeks=4`);
  try {
    // The page's own controls: the shared rail and its assistant (ui/) are not this page's to size.
    const page = m.byTestId('admin-community-page');
    const inPage = (n) => { for (let p = n; p; p = p.parentNode) if (p === page) return true; return false; };
    const targets = m.nodes().filter((n) => (n.tagName === 'BUTTON' || n.tagName === 'A') && inPage(n));
    assert.ok(targets.length > 25, `only ${targets.length} controls: the page did not draw`);
    const problems = [];
    for (const n of targets) {
      const p = m.props(n) || {};
      const name = (p['aria-label'] || m.textOf(n)).trim();
      const label = name || p['data-testid'] || n.tagName;
      if (!name) problems.push(`${label}: no accessible name`);
      if (minHeight(p.className) < 24) problems.push(`${label}: target under 24px (${p.className})`);
    }
    assert.deepEqual(problems, []);
    for (const id of ['community-period-4', 'community-period-12', 'community-period-52', 'community-recent-chip-all', 'community-recent-chip-events']) {
      assert.ok(minHeight(m.props(m.byTestId(id)).className) >= 32, `${id} is under 32px`);
    }
  } finally { await m.unmount(); }
});

test('the period control: one tab stop, and its keys move focus with the choice', async () => {
  // Mutation checked: the focus() after setWeeks removed → focus stays on 12 after ArrowRight; Home/End removed → they do nothing.
  const m = await mount(`${COMMUNITY_PATH}?weeks=12`);
  try {
    const radio = (w) => m.byTestId(`community-period-${w}`);
    const stops = () => [4, 12, 52].filter((w) => m.props(radio(w)).tabIndex === 0);
    assert.deepEqual(stops(), [12], 'the checked period is the one tab stop');
    const steps = [['ArrowRight', 52], ['ArrowRight', 4], ['ArrowLeft', 52], ['Home', 4], ['End', 52], ['ArrowUp', 12], ['ArrowDown', 52]];
    for (const [key, want] of steps) {
      await m.key('community-period', key);
      assert.equal(m.loc(), `${COMMUNITY_PATH}?weeks=${want}`, `${key}: the period`);
      assert.equal(m.props(radio(want))['aria-checked'], true, `${key}: aria-checked`);
      assert.deepEqual(stops(), [want], `${key}: the tab stop`);
      // A boolean, not the nodes: printing two DOM nodes with their React fibers runs out of memory.
      assert.ok(document.activeElement === radio(want), `${key}: focus did not move with the choice`);
    }
    // A key the group does not use changes nothing.
    await m.key('community-period', 'a');
    assert.equal(m.loc(), `${COMMUNITY_PATH}?weeks=52`);
  } finally { await m.unmount(); }
});

test('no Community file takes the keyboard focus ring away', () => {
  const dir = resolve(process.cwd(), 'frontend/src/pages/admin/community');
  const files = [];
  const walkDir = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walkDir(p); else if (/\.(jsx?|css)$/.test(e.name)) files.push(p); } };
  walkDir(dir);
  assert.ok(files.length >= 20, 'the folder was not read');
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /\boutline-none\b|outline:\s*(none|0)\b/, f);
  // The ring every focusable element gets, which a Community file must not override.
  assert.match(readFileSync(resolve(process.cwd(), 'frontend/src/index.css'), 'utf8'), /:where\(a, button, \[role="button"\], input, select, textarea, summary, \[tabindex\]\):focus-visible \{\s*outline: 2px solid/);
});
