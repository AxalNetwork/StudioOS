/** D8839: mounted public mobile menu Escape, focus return, reopening, toggle, route and listener cleanup. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PublicNav from '../src/components/PublicNav.jsx';

async function mount() {
  const restore = installDocument('', { focus: true });
  const listeners = new Set();
  document.addEventListener = (type, fn) => { if (type === 'keydown') listeners.add(fn); };
  document.removeEventListener = (type, fn) => { if (type === 'keydown') listeners.delete(fn); };
  const box = document.createElement('div'); document.body.appendChild(box);
  const root = createRoot(box);
  let navigate;
  function App() { navigate = useNavigate(); return React.createElement(PublicNav); }
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/'] }, React.createElement(App))));
  const nodes = (n = box) => [n, ...n.childNodes.flatMap(child => nodes(child))];
  const props = n => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const trigger = () => nodes().find(n => props(n).className === 'ax-burger');
  const menu = () => nodes().find(n => props(n).className === 'ax-mobilemenu');
  return { trigger, menu, nodes, props, listeners,
    async toggle() { await act(async () => props(trigger()).onClick()); },
    async key(key) { await act(async () => { for (const fn of [...listeners]) fn({ key, target: document.activeElement }); }); },
    async route(to) { await act(async () => navigate(to)); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}
for (const fromLink of [false, true]) test(`Escape closes from ${fromLink ? 'every mobile link' : 'the trigger'}, returns focus and permits reopening`, async () => {
  const w = await mount();
  try {
    await w.toggle();
    const links = w.nodes(w.menu()).filter(n => n.tagName === 'A').length;
    assert.ok(links > 0);
    for (let i = 0; i < (fromLink ? links : 1); i++) {
      if (!w.menu()) await w.toggle();
      const target = fromLink ? w.nodes(w.menu()).filter(n => n.tagName === 'A')[i] : w.trigger();
      target.focus();
      assert.equal(w.props(w.trigger())['aria-expanded'], true);
      await w.key('Escape');
      assert.equal(Boolean(w.menu()), false);
      assert.equal(w.props(w.trigger())['aria-expanded'], false);
      assert.equal(document.activeElement === w.trigger(), true);
      await w.toggle();
      assert.ok(w.menu());
    }
  } finally { await w.close(); }
});

test('other keys preserve the menu; toggle and navigation still close it; Escape listener is removed', async () => {
  const w = await mount();
  try {
    assert.equal(w.listeners.size, 0);
    await w.toggle();
    assert.equal(w.listeners.size, 1);
    await w.key('ArrowDown'); assert.ok(w.menu());
    await w.toggle(); assert.equal(Boolean(w.menu()), false);
    assert.equal(w.listeners.size, 0);
    await w.toggle(); await w.route('/founders');
    assert.equal(Boolean(w.menu()), false);
    assert.equal(w.listeners.size, 0);
    await w.toggle();
  } finally { await w.close(); }
  assert.equal(w.listeners.size, 0);
});
