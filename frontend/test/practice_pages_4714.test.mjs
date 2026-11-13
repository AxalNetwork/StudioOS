/**
 * #4714 (D4714) part 2 — Practice reads every page of a list, bounded, and
 * says so when it stops short.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_pages_4714.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { partialLine, readEveryPage } from '../src/pages/advisor/practice/everyPage.js';
import advisorPracticeBoard from '../src/workspaces/boards/advisorPractice.js';

const h = React.createElement;
const pager = (total, size) => {
  const asked = [];
  const fetchPage = async ({ offset }) => {
    asked.push(offset);
    const items = Array.from({ length: Math.max(0, Math.min(size, total - offset)) }, (_, i) => ({ id: offset + i + 1 }));
    return { items, totals: { all: total }, page: { offset, limit: size, total, next_offset: offset + items.length < total ? offset + items.length : null } };
  };
  return { asked, fetchPage };
};

test('readEveryPage follows next_offset to the end, every row once, first page totals kept', async () => {
  const p = pager(450, 200);
  const read = await readEveryPage(p.fetchPage);
  assert.deepEqual(p.asked, [0, 200, 400]);
  assert.equal(read.items.length, 450);
  assert.equal(new Set(read.items.map((x) => x.id)).size, 450);
  assert.deepEqual([read.total, read.complete, read.first.totals.all], [450, true, 450]);
  assert.equal(partialLine(read), null, 'a whole list says nothing');
});

test('readEveryPage is bounded, and says the list is partial', async () => {
  const p = pager(1000, 100);
  const read = await readEveryPage(p.fetchPage, { maxPages: 3 });
  assert.deepEqual(p.asked, [0, 100, 200]);
  assert.deepEqual([read.items.length, read.complete], [300, false]);
  assert.equal(partialLine(read), 'Showing the 300 most recent of 1,000. The figures above are over all 1,000.');
});

test('readEveryPage stops on a page that does not move forward', async () => {
  let calls = 0;
  const read = await readEveryPage(async ({ offset }) => {
    calls += 1;
    return { items: [{ id: calls }], page: { offset, limit: 1, total: 9, next_offset: 0 } };
  });
  assert.ok(calls <= 2, 'a repeated offset ends the walk');
  assert.equal(read.complete, true);
});

test('readEveryPage reads an older unpaged answer as one whole page', async () => {
  const read = await readEveryPage(async () => ({ items: [{ id: 1 }, { id: 2 }] }));
  assert.deepEqual([read.items.length, read.complete, read.total], [2, true, null]);
});

test('the board counts from page.total, not the rows of its preview page', () => {
  const board = advisorPracticeBoard('advisor', {});
  const sec = (slug) => board.sections.find((s) => s.slug === slug);
  const page = (n, total) => ({ items: Array.from({ length: n }, (_, i) => ({ id: i, lane: 'signed' })), totals: { active: total }, page: { total, next_offset: n < total ? n : null } });
  assert.equal(sec('sessions').total(page(200, 340)), 340, 'sessions: the whole set');
  assert.match(String(sec('sessions').summary(page(200, 340))), /340 sessions/);
  const eng = board.sections.find((s) => s.source === 'engagements');
  assert.equal(eng.total(page(400, 401)), 401);
  assert.equal(sec('sessions').total({ items: Array.from({ length: 200 }, () => ({})) }), null, 'an unpaged answer at the cap is not a total');
});

test('mounted Engagements: the 401st engagement is on the page, and the totals are the whole set\'s', async () => {
  const { default: EngagementsZone } = await import('../src/pages/advisor/practice/EngagementsZone.jsx');
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const json = (b) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => b, text: async () => JSON.stringify(b) });
  const rows = Array.from({ length: 401 }, (_, i) => ({ id: 401 - i, uid: `e-${401 - i}`, client_name: `Client ${401 - i}`, lane: 'signed', shape: 'retainer', status: 'active' }));
  globalThis.fetch = async (u) => {
    const url = new URL(String(u), 'http://x');
    if (url.pathname === '/api/advisors/me/engagements') {
      const offset = Number(url.searchParams.get('offset') || 0);
      const items = rows.slice(offset, offset + 400);
      return json({ items, totals: { active: 401, renewal_due: 0, renewal_rate: null, by_shape: { retainer: 401 } }, page: { offset, limit: 400, total: 401, next_offset: offset + items.length < 401 ? offset + items.length : null } });
    }
    if (url.pathname === '/api/advisors/me/bookings') return json({ items: [], page: { offset: 0, limit: 200, total: 0, next_offset: null } });
    return json({});
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(MemoryRouter, null, h(EngagementsZone))));
    for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
    const text = textOf(document.body);
    assert.match(text, /Client 1(?!\d)/, 'the oldest engagement, past the old cap of 400, is on the page');
    assert.match(text, /401/, 'the Active figure is the whole set\'s');
    assert.doesNotMatch(text, /Showing the/, 'a list read to the end is not called partial');
  } finally {
    await act(async () => root.unmount()); Object.assign(globalThis, previous); restore();
  }
});
