/**
 * D6147 (#6147) — New for you's thesis matches: the chip, the line
 * ("Matches your thesis: <top reasons>"), the cap, the unreadable source and
 * Set your thesis when none is set. Every read is a stub: no test reaches the
 * Worker.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_flow_thesis_6147.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import NewForYou from '../src/pages/investor/dealflow/NewForYou.jsx';
import { THESIS_PATH } from '../src/pages/investor/dealflow/flowModel.js';
import { inboxActions, inboxChip, inboxLine, thesisLine, thesisNeedsSetting, thesisReasonsLine, unreadSources } from '../src/pages/investor/dealflow/movesModel.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';
import { ventureScoresApi } from '../src/lib/api/ventureScores.js';

const h = React.createElement;
const MATCH = { key: 'thesis:201', source: 'thesis', entered_via: 'thesis', deal_id: 201, venture: 'Arc Robotics', sector: 'Robotics', round_status: 'active',
  at: '2026-11-06 10:00:00', message: null, can_open: false, reasons: ['sector', 'ticket'] };
const POLICY = { threshold: 'high', min_score: 70, cap: 20, scan: 200 };
const RECORDED = (o = {}) => ({ recorded: true, available: true, thesis_set: true, ...POLICY, listed: 1, more: false, ...o });
const NOT_SET = { recorded: false, available: true, thesis_set: false, reason: 'No thesis is set. Set your thesis so matches reach you here.', ...POLICY };
const UNREADABLE = { recorded: false, available: false, unreadable: true, reason: 'Matches to your thesis could not be read. That is not the same as none.' };

test('a match’s chip and line: Matches your thesis, then its matching criteria in words, at most three', () => {
  assert.equal(inboxChip(MATCH), 'Matches your thesis');
  assert.equal(inboxLine(MATCH), 'Matches your thesis: sector and minimum check within your ticket.');
  assert.equal(thesisReasonsLine(['sector', 'stage', 'region', 'ticket']), 'Matches your thesis: sector, stage and market region.');
  assert.equal(thesisReasonsLine(['region']), 'Matches your thesis: market region.');
  assert.equal(thesisReasonsLine([]), 'Matches your thesis.');
  assert.equal(thesisReasonsLine(['nonsense']), 'Matches your thesis.', 'an unknown criterion is never printed');
  assert.deepEqual(inboxActions(MATCH), { add: true, pass: true, dismiss: true, open: false }, 'Add, Pass and Not for me; Open only where DEAL’s rule holds');
});

test('the source’s one shape: no thesis says so and offers Set your thesis; the cap is said; unreadable is named, never “none”', () => {
  assert.equal(thesisLine({ thesis: NOT_SET }), NOT_SET.reason);
  assert.equal(thesisNeedsSetting({ thesis: NOT_SET }), true);
  assert.equal(thesisLine({ thesis: RECORDED() }), null, 'matches listed in full need no line');
  assert.equal(thesisLine({ thesis: RECORDED({ more: true, listed: 20 }) }), 'Only the newest 20 matches to your thesis are listed. Each is a High fit.');
  assert.equal(thesisNeedsSetting({ thesis: RECORDED() }), false);
  assert.equal(thesisLine({ thesis: UNREADABLE }), null);
  assert.equal(thesisNeedsSetting({ thesis: UNREADABLE }), false);
  assert.deepEqual(unreadSources({ thesis: UNREADABLE, room: { available: true } }), ['matches to your thesis']);
  // The pre-#6147 shape still reads as its reason.
  assert.match(thesisLine({ thesis: { recorded: false, reason: 'Matches to your thesis are not recorded yet.' } }), /not recorded yet/);
});

function harness() {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n ? (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '') : '');
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  const close = async () => { await act(async () => root.unmount()); restore(); };
  return { root, byId, text, props, settle, close };
}
async function mounted(inbox) {
  const was = { inbox: dealFlowApi.inbox, batch: ventureScoresApi.batch };
  dealFlowApi.inbox = async () => inbox;
  ventureScoresApi.batch = async () => ({ items: [] });
  const t = harness();
  await act(async () => t.root.render(h(MemoryRouter, null, h(NewForYou, { onToast() {} }))));
  await t.settle();
  return { t, done: async () => { await t.close(); Object.assign(dealFlowApi, { inbox: was.inbox }); ventureScoresApi.batch = was.batch; } };
}

test('mounted: a match lists with its chip, its reasons and its actions; no Open on a deal the investor may not read', async () => {
  const { t, done } = await mounted({ items: [MATCH], sources: { thesis: RECORDED() } });
  try {
    assert.match(t.text(t.byId('dealflow-new-thesis:201')), /^Matches your thesis6 NovArc Robotics · Robotics · .*Matches your thesis: sector and minimum check within your ticket\./);
    assert.ok(t.byId('dealflow-new-add-thesis:201') && t.byId('dealflow-new-pass-thesis:201') && t.byId('dealflow-new-dismiss-thesis:201'));
    assert.equal(t.byId('dealflow-new-open-thesis:201'), undefined);
    assert.equal(t.byId('dealflow-new-thesis'), undefined, 'no source line when every match is listed');
  } finally { await done(); }
});

test('mounted: with no thesis set, the line links to where the thesis is set; unreadable names the source and lists the rest', async () => {
  let m = await mounted({ items: [], sources: { thesis: NOT_SET } });
  try {
    assert.match(m.t.text(m.t.byId('dealflow-new-thesis')), /^No thesis is set\. Set your thesis so matches reach you here\. Set your thesis$/);
    assert.equal(m.t.props(m.t.byId('dealflow-new-set-thesis')).href, THESIS_PATH);
  } finally { await m.done(); }
  m = await mounted({ items: [{ ...MATCH, key: 'syndicate:2', source: 'syndicate', entered_via: 'syndicate', reasons: undefined }], sources: { syndicate: { available: true }, thesis: UNREADABLE } });
  try {
    assert.match(m.t.text(m.t.byId('dealflow-new-unread')), /matches to your thesis could not be read\. The rest are listed\./);
    assert.ok(m.t.byId('dealflow-new-syndicate:2'));
    assert.equal(m.t.byId('dealflow-new-set-thesis'), undefined);
  } finally { await m.done(); }
});
