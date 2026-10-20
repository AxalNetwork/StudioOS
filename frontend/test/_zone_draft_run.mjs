/**
 * D779 (#2104) — one draft option's band, run from a stub: nothing runs on
 * mount, the press runs once, the check is shown and Accept is withheld while
 * the run is out (D770), the stubbed draft is shown, and Accept is the only
 * further write. Shared by every part of `rail_options_run_d779*.test.mjs`.
 *
 * Runs are stubbed at `api.research`; nothing reaches the Worker.
 */
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { api } from '../src/lib/api.js';
import ZoneDraft from '../src/workspaces/ZoneDraft.jsx';
import { CHECKING } from '../src/workspaces/draftCheck.js';

const h = React.createElement;

/** `{ surface, label, key }` is one inventory row; `role` the profile whose rail it sits on. */
export async function assertDraftBandRun({ surface, label, key, role }) {
  const saved = { ...api.research };
  const calls = [];
  let stored = [];
  let release;
  api.research.zoneDrafts = async (...a) => { calls.push(['zoneDrafts', ...a]); return { items: stored }; };
  api.research.zoneDraftRun = (...a) => {
    calls.push(['zoneDraftRun', ...a]);
    return new Promise((r) => { release = () => { stored = [{ uid: 'd1', body: `Draft for ${key}`, accepted: false }]; r({ item: stored[0] }); }; });
  };
  api.research.zoneDraftAccept = async (...a) => { calls.push(['zoneDraftAccept', ...a]); return { item: { ...stored[0], accepted: true } }; };
  api.research.zoneDraftDiscard = async (...a) => { calls.push(['zoneDraftDiscard', ...a]); return {}; };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const button = (text) => walk(container).find((n) => n.tagName?.toLowerCase() === 'button' && (n.textContent || '').includes(text));
  // The test DOM keeps text on the leaves (a text node's `nodeValue`, or an element React set whole).
  const text = () => walk(container).map((n) => (n.nodeType === 3 ? (n.nodeValue ?? n.textContent ?? '') : (n.childNodes.length ? '' : n.textContent || ''))).join(' ');
  const written = () => calls.filter(([name]) => name !== 'zoneDrafts').map(([name]) => name);
  try {
    await act(async () => {
      root.render(h(MemoryRouter, null, h(RailPageProvider, { role },
        h(ZoneDraft, { surface, label, run: label, railOption: key }))));
    });
    await settle();
    assert.deepEqual(written(), [], 'the band ran or wrote on mount');

    await act(async () => { props(button(label)).onClick(); });
    await settle();
    assert.deepEqual(written(), ['zoneDraftRun'], 'the press runs once');
    assert.ok(text().includes(CHECKING), 'no check is shown while the run is out');
    assert.equal(button('Accept draft'), undefined, 'Accept is offered before the run is checked');

    await act(async () => { release(); });
    await settle();
    assert.ok(text().includes(`Draft for ${key}`), 'the stubbed draft is not shown');
    assert.deepEqual(written(), ['zoneDraftRun'], 'something was written beyond the draft before Accept');

    await act(async () => { props(button('Accept draft')).onClick(); });
    await settle();
    assert.deepEqual(written(), ['zoneDraftRun', 'zoneDraftAccept']);
    assert.deepEqual(calls.find(([name]) => name === 'zoneDraftAccept').slice(1), ['d1', undefined]);
  } finally {
    await act(async () => root.unmount());
    restore();
    Object.assign(api.research, saved);
  }
}
