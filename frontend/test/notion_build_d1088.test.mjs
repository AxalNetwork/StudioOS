// D1088 (#2953, Notion part 4 of #2405) — From Notion on Build's three modules:
// each `notion` line in buildParts.jsx mounts the shared part for its own module.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/notion_build_d1088.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILD_PARTS } from '../src/pages/cycles/buildParts.jsx';

const SRC = readFileSync(new URL('../src/pages/cycles/buildParts.jsx', import.meta.url), 'utf8');

test('each Build module that Notion feeds draws From Notion for that module, in the build section', () => {
  for (const [slug, module] of [['solution-design', 'solution_design'], ['prototype-mvp', 'prototype_mvp'], ['product-roadmap', 'product_roadmap']]) {
    const entry = BUILD_PARTS[slug].find(([key]) => key === 'notion');
    assert.ok(entry && typeof entry[1] === 'function', `${slug} draws Notion's part`);
    const el = entry[1]({}, { projectId: 7 });
    assert.deepEqual([el.props.section, el.props.module, el.props.projectId], ['build', module, 7], slug);
  }
  assert.equal((SRC.match(/<FromNotion section="build"/g) || []).length, 3, 'three mounts, no more');
  assert.ok(!BUILD_PARTS['operating-systems'].some(([key]) => key === 'notion'), 'Notion feeds no other Build module');
});

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import NotionLinks, { fedByName } from '../src/pages/cycles/NotionLinks.jsx';

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(el); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return { by, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(), press: async (id) => { await act(async () => { pr(by(id)).onClick?.(); }); },
    async unmount() { await act(async () => root.unmount()); restore(); } };
}

const LINKS = [
  { id: 1, kind: 'fact_link', status: 'pending', mine: true, title: 'checkout v2', url: 'https://www.notion.so/x', link: { existing: 'Checkout v2', fed_by: null } },
  { id: 2, kind: 'fact_link', status: 'pending', mine: true, title: 'Sign-in', url: null, link: { existing: 'Sign-in', fed_by: 'github' } },
  { id: 3, kind: 'fact_link', status: 'dismissed', mine: true, title: 'Old', link: { existing: 'Old', fed_by: null } },
  { id: 4, kind: 'design_note', status: 'pending', mine: true, title: 'Not a link' },
];

test('"Link to [existing]?": Link and Dismiss on a hand-entered match; "Already fed by GitHub" has Dismiss only; dismissed look-alikes are counted', async () => {
  const decided = [];
  const m = await mount(React.createElement(NotionLinks, { proposals: LINKS, label: 'Product roadmap', canAct: true, busy: null, onDecide: (p, how) => decided.push([p.id, how]) }));
  try {
    assert.equal(m.text(m.by('notion-link-1')).startsWith('Link to “Checkout v2”? “checkout v2” in Notion looks like “Checkout v2”, already in Product roadmap. Linking them lets Notion\'s changes update it; nothing new is added.'), true);
    assert.ok(m.by('notion-link-accept-1'));
    assert.equal(m.text(m.by('notion-link-line-2')), '“Sign-in” in Notion looks like “Sign-in”, which GitHub feeds. It is not imported.');
    assert.match(m.text(m.by('notion-link-2')), /^Already fed by GitHub/);
    assert.ok(!m.by('notion-link-accept-2'), 'a row another connection feeds is never linked');
    assert.ok(m.by('notion-link-dismiss-2'));
    assert.ok(!m.by('notion-link-4'), 'only fact_link proposals draw here');
    assert.equal(m.text(m.by('notion-links-dismissed')), '1 look-alike stays out until it changes in Notion.');
    await m.press('notion-link-accept-1');
    await m.press('notion-link-dismiss-2');
    assert.deepEqual(decided, [[1, 'accept'], [2, 'dismiss']]);
  } finally { await m.unmount(); }
  const reader = await mount(React.createElement(NotionLinks, { proposals: LINKS, label: 'Product roadmap', canAct: false, busy: null, onDecide() {} }));
  try { assert.ok(!reader.by('notion-link-accept-1') && !reader.by('notion-link-dismiss-1'), 'a reader sees no decision'); } finally { await reader.unmount(); }
  assert.equal(fedByName(null), null);
  assert.equal(fedByName('google_workspace'), 'Google Workspace');
  assert.equal(fedByName('hubspot'), 'another connection');
  const src = readFileSync(new URL('../src/pages/cycles/FromNotion.jsx', import.meta.url), 'utf8');
  assert.match(src, /\{d\?\.lands === 'fact' && <NotionLinks proposals=\{proposals\} label=\{d\?\.label\} canAct=\{canAct\} busy=\{busy\} onDecide=\{decide\} \/>\}/, 'From Notion draws them on a fact module');
});
