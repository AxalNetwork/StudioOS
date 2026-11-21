/**
 * D6042 (#6042) — Eadwyn's draft bands on Build's Founding team and Company
 * creation modules: each band's run, accept, empty and nothing-to-draft copy,
 * drawn through `ZoneDraft`; the band is drawn only with Eadwyn on; and the
 * founder's rail inventory lists both, so neither page is "quiet" any more.
 * #5077 owns the modules' asks and rail sentences (`buildEadwyn.js`), which
 * this issue leaves as they are.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_record_drafts_d6042.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import ZoneDraft from '../src/workspaces/ZoneDraft.jsx';
import build from '../src/pages/cycles/defs/build.jsx';
import { FOUNDER_OPTIONS, FOUNDER_QUIET_PAGES } from '../src/lib/railOptions/founder.js';
import { BUILD_ASKS, BUILD_RAIL_NOTES } from '../src/pages/cycles/buildEadwyn.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const BANDS = [
  ['founding-team', 'build/founding', 'Founder · Build · Founding team', 'plan'],
  ['company-creation', 'build/company', 'Founder · Build · Company creation', 'legal'],
];

async function mount(props) {
  const restore = installDocument();
  const orig = { ...api.research };
  const calls = [];
  const pending = [];
  api.research.zoneDrafts = async () => ({ items: [] });
  api.research.zoneDraftRun = (...args) => { calls.push(['run', ...args]); return new Promise((ok, no) => pending.push({ ok, no })); };
  api.research.zoneDraftAccept = async (...args) => { calls.push(['accept', ...args]); return { item: { uid: args[0], body: 'kept', accepted: true, cost_usd: 0 } }; };
  api.research.zoneDraftDiscard = async () => ({ ok: true });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => { root.render(h(ZoneDraft, props)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(txt).join(''));
  const button = (label) => walk(container).find((n) => n.tagName === 'BUTTON' && txt(n).trim() === label);
  return {
    calls, pending, settle, button,
    text: () => txt(container),
    press: (label) => act(async () => { pr(button(label)).onClick(); }),
    async unmount() { await act(async () => root.unmount()); Object.assign(api.research, orig); restore(); },
  };
}

test('each module carries one band on its own surface, with every piece of copy a band needs', () => {
  for (const [slug, surface] of BANDS) {
    const bands = build.drafts.get(slug);
    assert.equal(bands?.length, 1, `${slug} has no band`);
    const [band] = bands;
    assert.equal(band.surface, surface);
    for (const field of ['label', 'run', 'accept', 'empty', 'nothingToDraft', 'foot']) {
      assert.ok(typeof band[field] === 'string' && band[field].trim(), `${surface}: no ${field} copy`);
    }
    // Record-only, said in the band's own words, and never advice.
    assert.match(band.foot, /Kept as wording only/);
    assert.doesNotMatch(Object.values(band).join(' '), /\b(advice|recommend\w*)\b/i);
  }
  assert.match(build.drafts.get('founding-team')[0].empty, /list what is not recorded/);
  assert.match(build.drafts.get('company-creation')[0].empty, /name what is due next/);
});

test('a band runs on its venture, shows the draft unaccepted, and keeps it only on Accept', async () => {
  // Mutation checked: `accept: 'Keep this check'` renamed in build.jsx → the Accept press below finds no button.
  for (const [slug, surface] of BANDS) {
    const band = build.drafts.get(slug)[0];
    const m = await mount({ ...band, scopeKey: '7', railOption: `draft:${surface}` });
    try {
      assert.ok(m.text().includes(band.empty), `${surface}: the empty copy is not drawn`);
      await m.press(band.run);
      assert.deepEqual(m.calls[0].slice(0, 3), ['run', surface, '7']);
      await act(async () => { m.pending[0].ok({ item: { uid: `d-${slug}`, body: 'A record-only draft.', accepted: false, cost_usd: 0 } }); });
      await m.settle();
      assert.ok(m.text().includes('A record-only draft.'));
      assert.deepEqual(m.calls.map((c) => c[0]), ['run'], 'shown, not kept');
      await m.press(band.accept);
      await m.settle();
      assert.deepEqual(m.calls.map((c) => c[0]), ['run', 'accept']);
      assert.equal(m.calls[1][1], `d-${slug}`);
    } finally { await m.unmount(); }
  }
});

test('an empty record draws the band\'s nothing-to-draft sentence', async () => {
  for (const [slug] of BANDS) {
    const band = build.drafts.get(slug)[0];
    const m = await mount({ ...band, scopeKey: '7' });
    try {
      await m.press(band.run);
      await act(async () => { m.pending[0].no(Object.assign(new Error('x'), { code: 'nothing_to_draft' })); });
      await m.settle();
      assert.ok(m.text().includes(band.nothingToDraft), `${slug}: the nothing-to-draft copy is not drawn`);
    } finally { await m.unmount(); }
  }
});

test('with Eadwyn off the bands are not drawn and spend nothing', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /\{fillsOn && projectId \? drafts\.map\(\(draft\) => \(/, 'a band is drawn with the switch off');
  assert.match(route, /useAiSpend\(\{ enabled: Boolean\(fillsOn && projectId && \(drafts\.length \|\| fillKind\)\) \}\)/);
});

test('the rail inventory lists both bands on their pages, and neither page is quiet', () => {
  for (const [, surface, page, kind] of BANDS) {
    const row = FOUNDER_OPTIONS.find((o) => o.key === `draft:${surface}`);
    assert.ok(row, `draft:${surface} is not in the founder inventory`);
    assert.deepEqual([row.page, row.kind, row.handler], [page, kind, 'draft']);
    assert.ok(!Object.hasOwn(FOUNDER_QUIET_PAGES, page), `${page} still says it runs no model`);
  }
  const { options: rows } = JSON.parse(read('cloudflare-worker/src/services/ai/railMatrix.json'));
  for (const [, surface, page] of BANDS) {
    assert.ok(rows.some((r) => r.optionKey === `draft:${surface}` && r.pageKey === page), `the rail matrix has no row for draft:${surface}`);
  }
});

test('#5077\'s asks and rail sentences on the two modules are left as they were', () => {
  assert.deepEqual([...BUILD_ASKS['founding-team']], ['Which founders lack vesting terms?', 'Summarise the equity split']);
  assert.deepEqual([...BUILD_ASKS['company-creation']], [
    'What is still outstanding to form the company?', 'Explain the nearest filing deadline', 'Prepare the checklist wording for the next filing',
  ]);
  assert.equal(BUILD_RAIL_NOTES['founding-team'], null);
  assert.equal(BUILD_RAIL_NOTES['company-creation'], null);
});
