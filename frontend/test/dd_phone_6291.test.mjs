import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { Table, Td } from '../src/pages/duediligence/DdCaseWork.jsx';

const source = (file) => readFileSync('frontend/src/pages/duediligence/' + file, 'utf8');

test('Cases phone cards use the same rowCells as desktop and keep the row menu', () => {
  const page = source('DdCasesTab.jsx');
  const card = page.slice(page.indexOf('function CaseCard'), page.indexOf('function FiltersPanel'));
  assert.equal((page.match(/const c = rowCells\(row, now\)/g) || []).length, 2);
  for (const field of ['name', 'stageWord', 'lead', 'checklist', 'flags', 'band', 'target']) {
    assert.ok(card.includes('c.' + field), field);
  }
  assert.match(card, /<RowMenu row=\{row\} me=\{me\} base=\{base\} onPick=\{onPick\}/);
  assert.match(page, /list\.items\.map\(\(r\) => <CaseCard/);
  assert.match(page, /data-testid="dd-next"/);
});

test('case records stack in reading order and retain row identifiers on a phone', async () => {
  const restore = installDocument();
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const node = document.createElement('div');
  const root = createRoot(node);
  const h = React.createElement;
  try {
    await act(async () => root.render(h(Table, { head: ['Request', 'State'] },
      h('tr', { 'data-testid': 'request-row' }, h(Td, null, 'Board minutes'), h(Td, null, 'Sent')))));
    const walk = (element) => [element, ...(element.childNodes || []).flatMap(walk)];
    const nodes = walk(node);
    assert.ok(!nodes.some((element) => element.tagName === 'TABLE'));
    const text = nodes.map((element) => element.textContent).join(' ');
    assert.match(text, /Request.*Board minutes.*State.*Sent/);
    assert.ok(nodes.some((element) => Object.entries(element).some(([key, value]) =>
      key.startsWith('__reactProps$') && value?.['data-testid'] === 'request-row')));
  } finally {
    await act(async () => root.unmount());
    globalThis.matchMedia = previous;
    restore();
  }
});
