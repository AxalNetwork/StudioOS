/**
 * D1525 (#3783, pd15) — the ranking line on S1's results view.
 *
 *   · the client is one module, re-exported by api.js, on the Worker's routes;
 *   · the adapter's `judge` key goes through it (#3783), quote then run;
 *   · an area with two or three variants reads a greyed "Ranked — of m" until
 *     ranked; "Rank the variants" shows the judge's quote, Rank runs it, and
 *     each variant reads "Ranked n of m" with the panel's agreement;
 *   · ranking accepts nothing, and the results view has no model control;
 *   · the judge model is the rail's Vision and checks group's.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_judge_d1525.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDocument } from './_contracts_dom.mjs';
import { deckJudgeApi } from '../src/lib/api/deckJudge.js';
import * as apiIndex from '../src/lib/api.js';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import AreaResults from '../src/pages/raise/pitch/AreaResults.jsx';
import { rankGroups, rankedOf } from '../src/pages/raise/pitch/areaRankModel.js';
import { DECK_RAIL_GROUPS } from '../src/pages/raise/pitch/deckRailGroups.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(resolve(root, f), 'utf8');
const UID = '00000000-0000-4000-8000-00000000a001';

test('the judge client: one module, re-exported by api.js, on the Worker\'s routes; the adapter key goes through it', async () => {
  assert.equal(apiIndex.deckJudgeApi, deckJudgeApi);
  assert.deepEqual(adapter.SURFACES.judge, { issue: 3783, what: 'Rank the variants' });
  assert.ok(adapter.SWAPPED.includes('judge'), 'the route is on main, so the key is swapped');
  const sent = [];
  const before = globalThis.fetch;
  const restore = installDocument();
  globalThis.fetch = async (url, init) => { sent.push([String(url).replace(/^.*\/api/, '/api'), init?.method || 'GET']); return Response.json({ ai: true, hold_microusd: 120 }); };
  try {
    const q = await adapter.judge(UID);
    assert.deepEqual(q, { available: true, value: { ai: true, hold_microusd: 120 } });
    await adapter.judge(UID, { run: true });
  } finally { globalThis.fetch = before; restore(); }
  assert.deepEqual(sent, [[`/api/decks/areas/${UID}/judge/quote`, 'POST'], [`/api/decks/areas/${UID}/judge`, 'POST']]);
});

test('the line: greyed until ranked, then "Ranked n of m"; never a guessed rank; one area of 2 or 3 variants', () => {
  // Mutations checked: a failed variant counted in m; a variant the judge did not rank shown as ranked.
  const v = (n, status = 'proposed') => ({ key: `b2~${n}`, proposalUid: UID, variant: n, status });
  assert.deepEqual(rankGroups([v(1), v(2), v(3, 'refused')]), { [UID]: { of: 2, lastKey: 'b2~2' } });
  assert.deepEqual(rankGroups([v(1)]), {}, 'one variant: nothing to rank');
  assert.deepEqual(rankGroups([{ key: 'x', uid: 'rp-1', status: 'proposed' }]), {}, 'a rail proposal is not an area variant');
  assert.deepEqual(rankedOf(undefined, 1, 3), { ranked: false, text: 'Ranked — of 3' });
  const ranked = { step: 'ranked', value: { of: 3, ranking: [{ n: 1, rank: 2, line: 'Ranked 2 of 3' }, { n: 2, rank: null, line: 'Not ranked of 3' }] } };
  assert.deepEqual(rankedOf(ranked, 1, 3), { ranked: true, text: 'Ranked 2 of 3' });
  assert.deepEqual(rankedOf(ranked, 2, 3), { ranked: false, text: 'Not ranked of 3' });
  assert.deepEqual(rankedOf(ranked, 3, 3), { ranked: false, text: 'Not ranked of 3' });
});

async function mountResults(results, api) {
  const original = { ...deckJudgeApi };
  const calls = [];
  deckJudgeApi.quote = async (uid) => { calls.push(['quote', uid]); return api.quote(uid); };
  deckJudgeApi.rank = async (uid) => { calls.push(['rank', uid]); return api.rank(uid); };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const r = createRoot(container);
  const placed = [];
  await act(async () => { r.render(h(AreaResults, { results, card: { title: 'Synthetic', blocks: [] }, model: null, onPlace: (c) => placed.push(c) })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const all = () => walk(container);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((x) => setTimeout(x, 0)); });
  return {
    calls, placed, by, pr, all,
    text: (n) => text(n).replace(/\s+/g, ' ').trim(),
    press: async (n) => { await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    close: async () => { await act(async () => r.unmount()); restore(); Object.assign(deckJudgeApi, original); },
  };
}

const variant = (n, after) => ({ key: `b2~${n}`, areaKey: 'b2', proposalUid: UID, variant: n, status: 'proposed', kind: 'text', label: 'Body', before: 'Before', after, charges: true, charged: 300, modelName: `llama · variant ${n}`, decide: async () => ({}) });
const RESULTS = [variant(1, 'One'), variant(2, 'Two'), variant(3, 'Three')];

test('Rank the variants: the quote, then Rank; each variant reads its rank with the panel\'s line, and nothing is accepted', async () => {
  // Mutations checked: Rank run straight from the first press (no quote shown); ranking calling Accept.
  const m = await mountResults(RESULTS, {
    quote: async () => ({ ai: true, hold_microusd: 90, model_label: 'clef-flash', family: 'cloudflare', writer_families: ['meta'], of: 3 }),
    rank: async () => ({
      proposal_uid: UID, ranked: true, model_label: 'clef-flash', family: 'cloudflare', writer_families: ['meta'], best: 2, of: 3, score: 0.6, clears: true,
      ranking: [{ n: 1, rank: 2, probability: 0.3, line: 'Ranked 2 of 3' }, { n: 2, rank: 1, probability: 0.6, line: 'Ranked 1 of 3' }, { n: 3, rank: 3, probability: 0.1, line: 'Ranked 3 of 3' }],
      panel: { best: 2, agrees: true, line: 'The checks agree with this ranking.' }, charged_microusd: null,
    }),
  });
  try {
    for (const n of [1, 2, 3]) {
      const line = m.by(`pitch-area-result-b2~${n}-ranked`);
      assert.equal(m.text(line), 'Ranked — of 3');
      assert.equal(m.pr(line)['data-ranked'], 'false', 'greyed until ranked');
    }
    const openBtn = m.by('pitch-area-rank-b2-open');
    assert.equal(m.text(openBtn), 'Rank the variants');
    await m.press(openBtn);
    assert.deepEqual(m.calls, [['quote', UID]], 'the first press only reads the quote');
    assert.match(m.text(m.by('pitch-area-rank-b2-quote')), /Rank 3 variants with clef-flash, of another family than the writer's\. Holds/);
    await m.press(m.by('pitch-area-rank-b2-run'));
    assert.deepEqual(m.calls, [['quote', UID], ['rank', UID]]);
    assert.deepEqual([1, 2, 3].map((n) => m.text(m.by(`pitch-area-result-b2~${n}-ranked`))), ['Ranked 2 of 3', 'Ranked 1 of 3', 'Ranked 3 of 3']);
    const done = m.text(m.by('pitch-area-rank-b2-done'));
    assert.match(done, /The checks agree with this ranking\./);
    assert.match(done, /Charged: Not recorded\./, 'a charge not recorded says so, never 0');
    assert.match(done, /Accept stays yours\./);
    assert.deepEqual(m.placed, [], 'ranking places nothing');
    assert.ok(m.by('pitch-area-result-b2~2-accept'), 'Accept is still the founder\'s');
    // No model control in the results view (the only picker on it is a Report's reason, closed here).
    assert.ok(!m.all().some((n) => n.tagName === 'SELECT'), 'no model picker here');
  } finally { await m.close(); }
});

test('a refusal is its sentence; a judge not on this Worker is "Coming later"', async () => {
  const m = await mountResults(RESULTS, {
    quote: async () => ({ ai: false, reason: 'same_family', message: 'No judge model of another family than the writer\'s is offered, so the variants were not ranked. Nothing was run.' }),
    rank: async () => { throw new Error('never'); },
  });
  try {
    await m.press(m.by('pitch-area-rank-b2-open'));
    assert.match(m.text(m.by('pitch-area-rank-b2-refused')), /another family than the writer's/);
    assert.deepEqual(m.calls.map((c) => c[0]), ['quote'], 'nothing ran');
  } finally { await m.close(); }
  const off = await mountResults(RESULTS, { quote: async () => { const e = new Error('Not found'); e.status = 404; throw e; }, rank: async () => ({}) });
  try {
    await off.press(off.by('pitch-area-rank-b2-open'));
    assert.equal(off.text(off.by('pitch-area-rank-b2-later')), 'Ranking · Coming later');
  } finally { await off.close(); }
});

test('the judge model is the rail\'s Vision and checks group; the results view names no model choice', () => {
  const vision = DECK_RAIL_GROUPS.find((g) => g.id === 'vision');
  assert.match(vision.usedBy, /Rank the variants/);
  const src = read('frontend/src/pages/raise/pitch/AreaResults.jsx');
  assert.ok(!/model_id|modelPick|setModel|judgeModel|pickModel/i.test(src), 'no model control in the results view');
});
