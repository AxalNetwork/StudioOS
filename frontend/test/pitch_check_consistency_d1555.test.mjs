/**
 * D1555 (#3802, deck v2 C7) — "Consistency · free" in the Check claims sheet
 * (PD-6 pd25): findings with their cards and "Go to card ›", the failed state
 * with Try again, and the empty line. The rules are the Worker's; the panel
 * draws the check reply's `consistency`. No new panel and no toolbar button.
 *
 * Every figure is synthetic. The APIs are stubbed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_check_consistency_d1555.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import CheckPanel from '../src/pages/raise/pitch/CheckPanel.jsx';
import { deckCheckApi } from '../src/lib/api/deckCheck.js';
import { CONSISTENCY_EMPTY, CONSISTENCY_FAILED, CONSISTENCY_TITLE, cardsLabel, consistencyView } from '../src/pages/raise/pitch/checkModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const FOUND = { state: 'ok', findings: [
  { key: 'use_of_funds:raise', rule: 'use_of_funds', message: 'Use of funds $1.8M does not match the raise $2M.', cards: [3, 5] },
  { key: 'runway:cash_burn', rule: 'runway', message: 'Runway does not equal cash ÷ burn: $1.2M ÷ $100k a month is 12 months; the deck says 18 months.', cards: [6] },
] };
const REPLY = (consistency, over = {}) => ({ deck_id: 21, version: 'v2', checked: true, checked_at: '2026-11-01 10:00:00', can_check: true, counts: { backed: 0, founders_figure: 0, mismatch: 0, not_backed: 0, stale: 0 }, figures: 0, claims: [], consistency, ...over });

async function mount(read, run, props = {}) {
  Object.assign(deckCheckApi, { read, run });
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, h(CheckPanel, { deck: { id: 21 }, projectId: 7, readOnly: false, dirty: false, ...props }))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const need = (id) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); return n; };
  return {
    by, text: (id) => txt(need(id)).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({}); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('the model: findings, empty, unreadable, and none for a reader; a malformed answer is unreadable, never consistent', () => {
  assert.deepEqual(consistencyView(FOUND).rows.map((r) => [r.key, r.cards]), [['use_of_funds:raise', [3, 5]], ['runway:cash_burn', [6]]]);
  assert.equal(consistencyView(FOUND).kind, 'findings');
  assert.deepEqual(consistencyView({ state: 'ok', findings: [] }), { kind: 'empty', rows: [] });
  assert.equal(consistencyView({ state: 'unreadable', findings: [] }).kind, 'unreadable');
  assert.equal(consistencyView({ state: 'ok' }).kind, 'unreadable');
  assert.equal(consistencyView(null).kind, 'none');
  assert.equal(consistencyView(undefined).kind, 'none');
  assert.equal(cardsLabel([3]), 'card 3');
  assert.equal(cardsLabel([1, 3, 5]), 'cards 1, 3 and 5');
  assert.equal(CONSISTENCY_TITLE, 'Consistency · free');
  assert.equal(CONSISTENCY_EMPTY, 'Every figure is linked and consistent.');
  assert.equal(CONSISTENCY_FAILED, 'Could not be read.');
});

test('the founder\'s sheet draws each finding with its cards; Go to card selects that card (0-based) once per card', async () => {
  const went = [];
  const v = await mount(async () => REPLY(FOUND), async () => REPLY(FOUND), { onGoToCard: (i) => went.push(i) });
  try {
    assert.match(v.text('pitch-check-consistency'), /^Consistency · free/);
    assert.match(v.text('pitch-check-consistency-use_of_funds:raise'), /Use of funds \$1\.8M does not match the raise \$2M\. cards 3 and 5 Go to card 3 › Go to card 5 ›/);
    assert.match(v.text('pitch-check-consistency-runway:cash_burn'), /cash ÷ burn.*card 6 Go to card ›$/);
    await v.click('pitch-check-consistency-go-use_of_funds:raise-5');
    await v.click('pitch-check-consistency-go-runway:cash_burn-6');
    assert.deepEqual(went, [4, 5]);
    assert.equal(v.by('pitch-check-consistency-empty'), undefined);
  } finally { await v.close(); }
});

test('no finding: "Every figure is linked and consistent."; a failed section: "Could not be read." with Try again that runs the check again', async () => {
  let v = await mount(async () => REPLY({ state: 'ok', findings: [] }), async () => REPLY({ state: 'ok', findings: [] }));
  try { assert.equal(v.text('pitch-check-consistency-empty'), CONSISTENCY_EMPTY); } finally { await v.close(); }
  let runs = 0;
  v = await mount(async () => REPLY({ state: 'unreadable', findings: [] }), async () => { runs += 1; return REPLY(runs > 1 ? FOUND : { state: 'unreadable', findings: [] }); });
  try {
    assert.match(v.text('pitch-check-consistency-failed'), /^Could not be read\. Try again$/);
    assert.equal(v.by('pitch-check-consistency-empty'), undefined, 'a failure is never shown as consistent');
    await v.click('pitch-check-consistency-retry');
    assert.ok(v.by('pitch-check-consistency-rows'));
  } finally { await v.close(); }
});

test('a reader who is not the founder (consistency null) sees no section at all', async () => {
  const v = await mount(async () => REPLY(null, { can_check: false }), async () => { throw new Error('no run for a reader'); });
  try { assert.equal(v.by('pitch-check-consistency'), undefined); } finally { await v.close(); }
});

test('the source: the section lives in CheckPanel (reached from ⋯ › Check claims); the editor wires Go to card; no new panel', () => {
  const panel = read('../src/pages/raise/pitch/CheckPanel.jsx');
  assert.match(panel, /consistencyView\(data\.consistency\)/);
  assert.match(read('../src/pages/raise/pitch/DeckSheets.jsx'), /<CheckPanel [^>]*onGoToCard=\{onGoToCard\}/);
  assert.match(read('../src/pages/raise/pitch/PitchEditor.jsx'), /<CheckSheet [^>]*\n?\s*onGoToCard=\{\(i\) => \{ if \(i >= 0 && i < cards\.length\) \{ choose\(i\); setSheet\(null\); \} \}\}/);
});
