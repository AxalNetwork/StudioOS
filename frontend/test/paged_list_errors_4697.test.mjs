// #4697 — the shared Expertise paged-list helper prints a fixed sentence when a
// read fails, never the thrown error's text, and still reports the error.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { usePagedList } from '../src/pages/advisor/expertise/pages.js';
import { installDocument } from './_contracts_dom.mjs';

const textOf = (n) => (!n ? '' : n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(textOf).join(''));
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
const LEAK = 'D1_ERROR: no such column secret_internal';

function Probe({ fetchPage, options }) {
  const list = usePagedList(fetchPage, options);
  React.useEffect(() => { list.load(); }, [list.load]);
  return React.createElement('div', null,
    React.createElement('p', null, `error=${list.error};more=${list.moreError};rows=${list.rows.length};`),
    React.createElement('button', { type: 'button', onClick: list.more }, 'more'));
}
async function mount(fetchPage, options) {
  const restore = installDocument();
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(React.createElement(Probe, { fetchPage, options })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return {
    text: () => textOf(el),
    more: async () => { await act(async () => { props(walk(el).find((n) => n.tagName === 'BUTTON')).onClick(); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); },
    unmount: async () => { await act(async () => root.unmount()); restore(); },
  };
}

test('a failed first page reads as the zone\'s fixed sentence, not the thrown text', async () => {
  // Mutation checked: `error: e?.message || errorText` restored -> the leak is printed.
  const v = await mount(async () => { throw new Error(LEAK); }, { errorText: 'Your proof record could not be read.' });
  try {
    assert.match(v.text(), /error=Your proof record could not be read\.;/);
    assert.doesNotMatch(v.text(), /D1_ERROR|secret_internal/);
  } finally { await v.unmount(); }
});

test('a failed "Show more" keeps the rows read and reads as the zone\'s fixed sentence', async () => {
  let n = 0;
  const v = await mount(async () => {
    if (n++ === 0) return { items: [{ id: 1 }], page: { offset: 0, limit: 1, total: 2, next_offset: 1 } };
    throw new Error(LEAK);
  }, { moreErrorText: 'The next links could not be read. Try again.' });
  try {
    await v.more();
    assert.match(v.text(), /more=The next links could not be read\. Try again\.;/);
    assert.match(v.text(), /rows=1;/, 'the rows already read stay');
    assert.doesNotMatch(v.text(), /D1_ERROR|secret_internal/);
  } finally { await v.unmount(); }
});

test('the defaults are fixed sentences too', async () => {
  const v = await mount(async () => { throw new Error(LEAK); }, {});
  try {
    assert.match(v.text(), /error=This list could not be read\.;/);
    assert.doesNotMatch(v.text(), /secret_internal/);
  } finally { await v.unmount(); }
});
