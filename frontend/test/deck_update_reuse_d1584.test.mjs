// D1584 (#3831, deck v2 F5, pd6, pd35) — Refresh from the latest update, and
// "Changes since vN" on the per-investor rows.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_update_reuse_d1584.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  REFRESH_FROM_UPDATE, UPDATE_SAME, UPDATE_SLOTS, acceptUpdate, cardHasUpdateSlot, updateForCard, updateLine,
} from '../src/pages/raise/pitch/figuresModel.js';
import { UpdateRefresh } from '../src/pages/raise/pitch/FigureCard.jsx';
import { CHANGES_SHOWN, changesWords } from '../src/pages/raise/pitch/InvestorLinksTable.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const bound = (key, hash = 'h1') => ({ source_key: key, record_ref: 'project_metrics:1', as_of: '2026-09-30', grade: 'Stated', snapshot_hash: hash });
const CARD = { blocks: [
  { id: 'mrr', kind: 'metric', label: 'MRR', value: '$10,000', binding: bound('grow.mrr') },
  { id: 'gro', kind: 'metric', label: 'Growth', value: '', binding: bound('grow.mercury_growth') },
  { id: 'typ', kind: 'metric', label: 'Pilots', value: '3' },
] };
const P = (block_id, source_key, now, grade = 'Measured') => ({
  card: 0, block_id, label: block_id, source_key, was: null, now, source: 'Connector',
  binding: { source_key, record_ref: 'portfolio_updates:u1', as_of: '2026-10-28', grade, snapshot_hash: `update:u1:${block_id}` },
});
const ANSWER = {
  deck_id: 1, update: { uid: 'u1', title: 'October update' },
  proposals: [{ ...P('mrr', 'grow.mrr', '$12,400'), was: '$10,000', label: 'MRR' }, { ...P('gro', 'grow.mercury_growth', '24%', 'Stated'), card: 1 }],
  unchanged: 0, not_in_update: [{ card: 0, block_id: 'cus', label: 'Customers', reason: 'Not recorded: no snapshot in this period records it' }],
};

test('the five update slots are the Worker\'s, and a card shows the action only when it holds one', () => {
  const worker = readFileSync(new URL('../../cloudflare-worker/src/services/decks/updateReuse.ts', import.meta.url), 'utf8');
  for (const k of UPDATE_SLOTS) assert.ok(worker.includes(`'${k}'`), `${k} is the Worker's too`);
  assert.equal(UPDATE_SLOTS.length, 5);
  assert.equal(cardHasUpdateSlot(CARD), true);
  assert.equal(cardHasUpdateSlot({ blocks: [{ id: 'typ', kind: 'metric', value: '3' }, { id: 'c', kind: 'metric', binding: bound('grow.churn') }] }), false);
  const one = updateForCard(ANSWER, 0);
  assert.deepEqual(one.proposals.map((p) => p.block_id), ['mrr'], 'only this card\'s proposals');
  assert.deepEqual(one.missing.map((m) => m.block_id), ['cus']);
  assert.equal(updateLine(ANSWER.update, ANSWER.proposals[0]), 'From the investor update “October update” · Measured');
});

test('acceptUpdate: the update\'s words, its binding, or the store\'s own when the store already says the same', () => {
  // Mutations checked: the store-match branch removed → MRR keeps the update hash and reads as changed;
  // the slot check removed → a tile rebound since the read takes the proposal.
  const items = [{ source_key: 'grow.mrr', state: 'recorded', value: 12400, unit: 'usd', record_ref: 'project_metrics:9', as_of: '2026-10-28', grade: 'Measured', snapshot_hash: 'h9' }];
  const r = acceptUpdate(CARD, [P('mrr', 'grow.mrr', '$12,400'), P('gro', 'grow.mercury_growth', '24%', 'Stated')], items);
  assert.equal(r.moved, 2);
  const by = (id) => r.card.blocks.find((b) => b.id === id);
  assert.equal(by('mrr').value, '$12,400');
  assert.equal(by('mrr').binding.snapshot_hash, 'h9', 'the store holds the same words: its snapshot, so no "changed" line');
  assert.equal(by('gro').value, '24%');
  assert.deepEqual(by('gro').binding, P('gro', 'grow.mercury_growth', '24%', 'Stated').binding, 'else the update is the record, with its grade');
  assert.deepEqual(by('typ'), CARD.blocks[2], 'a typed tile is never touched');
  const rebound = { blocks: [{ ...CARD.blocks[0], binding: bound('grow.arr') }] };
  assert.equal(acceptUpdate(rebound, [P('mrr', 'grow.mrr', '$12,400')]).moved, 0, 'a tile rebound since the read is left as it is');
  assert.equal(acceptUpdate(CARD, [P('mrr', 'grow.mrr', '')]).moved, 0, 'no words, no change: never blank, never 0');
});

test('changesWords: nothing on the current version; the changed figures, then the cards', () => {
  // Mutation checked: the `latest` guard removed → the current version draws a line.
  assert.equal(changesWords({ latest: true, since: { version: 3 }, current: { version: 3 } }), null);
  assert.equal(changesWords(null), null);
  const base = { latest: false, since: { version: 3 }, current: { version: 5 } };
  assert.equal(changesWords({ ...base, changes: { figures: [], cards: { before: 8, after: 8 } } }), 'Changes since v3 (now v5): no figure changed');
  assert.equal(
    changesWords({ ...base, changes: { figures: [{ label: 'MRR', was: '$10,000', now: '$12,400' }, { label: 'ARR', was: null, now: '$148,800' }, { label: 'Pilots', was: '3', now: null }], cards: { before: 8, after: 9 } } }),
    'Changes since v3 (now v5): MRR $10,000 → $12,400 · ARR added · Pilots removed · 1 card added',
  );
  const many = Array.from({ length: CHANGES_SHOWN + 2 }, (_, i) => ({ label: `F${i}`, was: '1', now: '2' }));
  assert.match(changesWords({ ...base, changes: { figures: many, cards: { before: 8, after: 6 } } }), /· and 2 more · 2 cards removed$/);
});

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const all = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  return {
    by, all, text, props, settle,
    async click(id) { await act(async () => { props(by(id)).onClick?.(); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('UpdateRefresh: reads on press, shows was → now with the source and grade, and places on Accept', async () => {
  // Mutations checked: Accept not calling onAccept → nothing placed; the read made on mount → derive called before the press.
  let calls = 0;
  const placed = [];
  const m = await mount(h(UpdateRefresh, { card: CARD, cardIndex: 0, derive: () => { calls += 1; return Promise.resolve(ANSWER); }, onAccept: (p) => placed.push(...p) }));
  try {
    assert.equal(calls, 0, 'nothing is read until the press');
    assert.match(m.text(m.by('pitch-update-refresh')), new RegExp(REFRESH_FROM_UPDATE));
    await m.click('pitch-update-refresh');
    assert.equal(calls, 1);
    const rows = m.all('pitch-update-row');
    assert.equal(rows.length, 1, 'this card\'s proposals only');
    assert.match(m.text(rows[0]), /MRR: \$10,000 → \$12,400/);
    assert.match(m.text(rows[0]), /From the investor update “October update” · Measured/);
    assert.match(m.text(m.by('pitch-update-missing')), /Customers: Not recorded/);
    await m.click('pitch-update-accept');
    assert.deepEqual(placed.map((p) => p.block_id), ['mrr']);
    assert.ok(m.by('pitch-update-refresh'), 'closed after Accept');
  } finally { await m.unmount(); }
});

test('UpdateRefresh: no update sent, a failed read with Try again, the same figures, read-only and no update slot', async () => {
  let m = await mount(h(UpdateRefresh, { card: CARD, cardIndex: 0, derive: () => Promise.resolve({ update: null, proposals: [], not_in_update: [], reason: 'No investor update has been sent yet.' }) }));
  try {
    await m.click('pitch-update-refresh');
    assert.equal(m.text(m.by('pitch-update-empty')), 'No investor update has been sent yet.');
    assert.equal(m.by('pitch-update-accept'), undefined, 'no Accept without a proposal');
  } finally { await m.unmount(); }
  let fail = true;
  m = await mount(h(UpdateRefresh, { card: CARD, cardIndex: 0, derive: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve({ ...ANSWER, proposals: [], not_in_update: [] })) }));
  try {
    await m.click('pitch-update-refresh');
    assert.ok(m.by('pitch-update-error'));
    fail = false;
    await m.click('pitch-update-retry');
    assert.equal(m.text(m.by('pitch-update-empty')), UPDATE_SAME);
  } finally { await m.unmount(); }
  m = await mount(h(UpdateRefresh, { card: CARD, cardIndex: 0, readOnly: true, derive: () => Promise.resolve(ANSWER) }));
  try { assert.equal(m.by('pitch-update-refresh'), undefined, 'read-only: no action'); } finally { await m.unmount(); }
  m = await mount(h(UpdateRefresh, { card: { blocks: [CARD.blocks[2]] }, cardIndex: 0, derive: () => Promise.resolve(ANSWER) }));
  try { assert.equal(m.by('pitch-update-refresh'), undefined, 'no tile an update reports: no action'); } finally { await m.unmount(); }
});

test('the wiring: beside Refresh from records, through its own client, and Changes since on the pd35 rows', () => {
  const stage = codeOnly(read('pages/raise/pitch/GridStage.jsx'));
  assert.match(stage, /<ChangedNotice changed=\{changed\} readOnly=\{readOnly\} onRefresh=\{onRefresh\} \/>[\s\S]{0,120}?<UpdateRefresh card=\{card\} cardIndex=\{index\} readOnly=\{readOnly\} derive=\{onUpdateDerive\} onAccept=\{onUpdateAccept\} \/>/);
  const editor = codeOnly(read('pages/raise/pitch/PitchEditor.jsx'));
  assert.match(editor, /onUpdateDerive=\{base\.deck\?\.id != null \? \(\) => deckUpdateReuseApi\.deriveUpdate\(base\.deck\.id\) : null\}/);
  assert.match(editor, /const r = acceptUpdate\(card, proposals, items\); if \(r\.moved\) setCard\(sel, r\.card\);/);
  assert.match(codeOnly(read('pages/raise/pitch/InvestorLinksTable.jsx')), /deckUpdateReuseApi\.changesSince\(deck\.id\)/);
  // #4105: the module's line is in the generated index, not in api.js.
  assert.match(read('lib/apiModules.generated.js'), /export \* from '\.\/api\/deckUpdateReuse\.js';/);
});
