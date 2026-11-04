// D1614 (#3968): the existing WK1–WK3 controls must change reads and charts.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import WorkPage from '../src/pages/work/WorkPage.jsx';
import { burnup } from '../src/pages/work/workModel.js';

const h = React.createElement;
const point = { day: '2026-11-01', scope: 10, completed: 6, open: 4, completed_by: { person: 2, agent: 3, none: 1 } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function mount(answer) {
  const restore = installDocument(); const previous = globalThis.fetch; const calls = [];
  globalThis.fetch = async (u) => {
    const url = new URL(String(u), 'http://localhost'); calls.push(url);
    if (url.pathname.endsWith('/work/board')) return answer?.(url) ?? json({ items: [], viewer: { can_manage: true } });
    if (url.pathname.endsWith('/work/burnup')) return answer?.(url) ?? json({ available: true, series: [point] });
    if (url.pathname.includes('/engine')) return json({ engine: 'on' });
    return json({ name: 'Synthetic project' });
  };
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const text = (n = container) => n.nodeType === 3 ? n.textContent : (n.childNodes || []).map(text).join('') || n.textContent || '';
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/projects/7/work?view=burnup'] }, h(Routes, null, h(Route, { path: '/projects/:id/work', element: h(WorkPage) })))));
  await settle();
  return { calls, by, props, text, settle,
    async click(id) { assert.ok(by(id), id); await act(async () => { props(by(id)).onClick({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { await act(async () => { props(by(id)).onChange({ target: { value } }); }); await settle(); },
    async submit(node) { await act(async () => { props(node).onSubmit({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('WK1 filter and WK3 ranges reach the real clients; custom dates wait for Apply', async () => {
  const m = await mount();
  try {
    const burns = () => m.calls.filter((u) => u.pathname.endsWith('/work/burnup'));
    assert.equal(burns().at(-1).searchParams.get('range'), '2w');
    await m.change('work-filter', '  label:finance  ');
    assert.equal(burns().length, 1, 'typing alone does not read');
    await m.submit(m.by('work-filter').parentNode);
    assert.equal(burns().at(-1).searchParams.get('filter'), 'label:finance');
    assert.equal(m.calls.filter((u) => u.pathname.endsWith('/work/board')).at(-1).searchParams.get('filter'), 'label:finance');
    for (const range of ['1m', '3m', 'max']) {
      await m.click(`burn-range-${range}`);
      assert.equal(burns().at(-1).searchParams.get('range'), range);
      assert.equal(m.props(m.by(`burn-range-${range}`))['aria-pressed'], true);
    }
    const before = burns().length;
    await m.click('burn-range-custom'); await m.change('burn-from', '2026-10-01');
    await m.submit(m.by('burn-custom'));
    assert.equal(burns().length, before, 'incomplete dates make no request');
    await m.change('burn-to', '2026-09-01'); await m.submit(m.by('burn-custom'));
    assert.equal(burns().length, before, 'reversed dates make no request');
    await m.change('burn-to', '2026-10-31'); await m.submit(m.by('burn-custom'));
    const q = burns().at(-1).searchParams;
    assert.equal(q.get('from'), '2026-10-01'); assert.equal(q.get('to'), '2026-10-31'); assert.equal(q.has('range'), false);
    assert.equal(q.get('filter'), 'label:finance');
    await m.click('work-tab-board'); await m.click('work-tab-burnup');
    assert.equal(m.props(m.by('burn-from')).value, '2026-10-01');
    assert.equal(m.props(m.by('burn-to')).value, '2026-10-31');
    await m.change('work-filter', ''); await m.submit(m.by('work-filter').parentNode);
    assert.equal(burns().at(-1).searchParams.has('filter'), false, 'clearing reads the whole project again');
  } finally { await m.close(); }
});

test('WK3 split redraws completed work, keeps global open, and never invents missing attribution', async () => {
  const m = await mount();
  try {
    assert.match(m.text(), /6 are completed and 4 are open/);
    await m.click('burn-split-People'); assert.match(m.text(), /2 are completed by people and 4 are open/);
    assert.equal(m.props(m.by('burn-split-People'))['aria-pressed'], true);
    await m.click('burn-split-Agents'); assert.match(m.text(), /3 are completed by agents and 4 are open/);
    await m.click('burn-split-Both'); assert.match(m.text(), /6 are completed and 4 are open/);
    assert.equal(m.calls.filter((u) => u.pathname.endsWith('/work/burnup')).length, 1, 'split uses recorded attribution');
  } finally { await m.close(); }
  assert.equal(burnup([{ ...point, completed_by: null }], { split: 'People' }).empty, true);
  assert.equal(burnup([{ ...point, available: false }]).empty, true);
  const people = burnup([point], { split: 'People' });
  assert.equal(people.area, burnup([point]).area, 'the shaded open work stays global');
  assert.equal(people.completed, 'M0.0,208.0'); assert.equal(people.scope, 'M0.0,0.0');
  assert.deepEqual(people.tiles, { scope: 10, completed: 2, open: 4 });
  assert.equal(burnup([{ ...point, completed_by: { person: 0 } }], { split: 'People' }).tiles.completed, 0);
});

test('WK3 failed read is visible and retryable, not a stale chart or an empty project', async () => {
  let fail = false;
  const m = await mount((u) => u.pathname.endsWith('/work/burnup') && fail ? json({ message: 'Synthetic failed read' }, 500) : undefined);
  try {
    fail = true; await m.click('burn-range-1m');
    assert.ok(m.by('burn-unreadable')); assert.doesNotMatch(m.text(), /Scope grew/);
    assert.ok(!m.by('work-burnup-empty'), 'a failed read is not an empty series');
    fail = false;
    const block = m.by('burn-unreadable');
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const retry = walk(block).find((n) => n.tagName === 'BUTTON');
    await act(async () => m.props(retry).onClick()); await m.settle();
    assert.match(m.text(), /Scope grew/); assert.ok(!m.by('burn-unreadable'));
  } finally { await m.close(); }
});

test('WK3 a late range response cannot replace the newest chart', async () => {
  let finish;
  const m = await mount((u) => u.pathname.endsWith('/work/burnup') && u.searchParams.get('range') === '1m' ? new Promise((r) => { finish = r; }) : undefined);
  try {
    await m.click('burn-range-1m'); assert.match(m.text(), /Reading burn-up/); assert.doesNotMatch(m.text(), /Scope grew/);
    await m.click('burn-range-3m'); assert.match(m.text(), /10 items/);
    await act(async () => finish(json({ series: [{ ...point, scope: 99 }] }))); await m.settle();
    assert.doesNotMatch(m.text(), /99/); assert.match(m.text(), /10 items/);
  } finally { await m.close(); }
});


test('WK1 an older filter cannot overwrite the newest board', async () => {
  let finish;
  const m = await mount((u) => u.pathname.endsWith('/work/board') && u.searchParams.get('filter') === 'old'
    ? new Promise((r) => { finish = r; }) : undefined);
  try {
    await m.click('work-tab-board');
    await m.change('work-filter', 'old'); await m.submit(m.by('work-filter').parentNode);
    await m.change('work-filter', 'new'); await m.submit(m.by('work-filter').parentNode);
    await act(async () => finish(json({ items: [{ uid: 'late', title: 'Stale card', column: 'ready' }], viewer: {} }))); await m.settle();
    assert.ok(!m.by('work-card-late'));
    assert.ok(m.by('work-board'));
  } finally { await m.close(); }
});
