// D4086 (#4086, #4087) — Round settings records the round's securities
// exemption, the founder's own statement.
//
//   · the body carries it only when the form holds it; an empty choice is
//     null ("Not recorded"), never a default; one off the list is refused;
//   · the dialog reads the round's exemption, lists the five, says only a
//     506(c) round's deck becomes a page, and warns before a change that takes
//     published links down; nothing is written until Save round.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/round_exemption_d4086.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api';
import { RoundSettingsDialog } from '../src/pages/raise/caprel/CapRelCommitments.jsx';
import {
  EXEMPTION_TAKES_DOWN, ROUND_EXEMPTIONS, exemptionLabel, exemptionNote, roundBody,
} from '../src/pages/raise/caprel/capRelTabsModel.js';

const h = React.createElement;

test('the body: the exemption only when the form holds it, empty is null, one off the list is refused', () => {
  const base = { name: 'Seed', target: '', currency: 'USD', close_date: '', notes: '' };
  assert.equal('exemption' in roundBody(3, base).body, false, 'a form without the field sends nothing for it');
  assert.equal(roundBody(3, { ...base, exemption: '' }).body.exemption, null, 'Not recorded is null, never a default');
  assert.equal(roundBody(3, { ...base, exemption: '506c' }).body.exemption, '506c');
  assert.ok(roundBody(3, { ...base, exemption: '506' }).error);
  assert.deepEqual(ROUND_EXEMPTIONS.map((e) => e.value), ['506b', '506c', 'reg_cf', 'reg_s', 'other'], 'the migration\'s CHECK list');
  assert.equal(exemptionLabel(null), 'Not recorded');
  assert.equal(exemptionLabel('reg_cf'), 'Regulation Crowdfunding');
  assert.equal(exemptionNote('506c', '506b'), EXEMPTION_TAKES_DOWN);
  assert.equal(exemptionNote(null, 'reg_s'), EXEMPTION_TAKES_DOWN);
  assert.equal(exemptionNote('506b', '506b'), null, 'no change, no warning');
  assert.equal(exemptionNote('506b', '506c'), null, '506(c) takes nothing down');
  assert.equal(exemptionNote('506c', ''), null, 'clearing it takes nothing down');
});

async function mountDialog(round) {
  const saved = { read: api.raiseRound, save: api.raiseRoundSave };
  const calls = [];
  api.raiseRound = async (...a) => { calls.push(['read', ...a]); return { round }; };
  api.raiseRoundSave = async (...a) => { calls.push(['save', ...a]); return { ...round, ...a[0] }; };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  let closed = 0;
  await act(async () => { rootEl.render(h(RoundSettingsDialog, { projectId: 12, onClose: () => { closed += 1; }, onDone: () => {} })); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr, closed: () => closed,
    text: () => text(container).replace(/\s+/g, ' '),
    async change(id, value) { await act(async () => { pr(by(id)).onChange?.({ target: { value } }); }); await settle(); },
    async press(id) { await act(async () => { await pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => rootEl.unmount()); restore(); api.raiseRound = saved.read; api.raiseRoundSave = saved.save; },
  };
}

test('the dialog: reads the round\'s exemption, lists the five, warns before taking links down, writes only on Save round', async () => {
  const m = await mountDialog({ name: 'Seed', target_amount: null, currency: 'USD', close_date: null, notes: null, exemption: '506c' });
  try {
    const select = m.by('caprel-round-exemption');
    assert.ok(select);
    assert.equal(m.pr(select).value, '506c', 'the recorded exemption is shown');
    assert.match(m.text(), /Not recorded Rule 506\(b\) Rule 506\(c\) Regulation Crowdfunding Regulation S Another exemption/);
    assert.match(m.text(), /Only a Rule 506\(c\) round's deck can be published as a web page\./);
    assert.equal(m.by('caprel-round-exemption-note'), undefined);
    await m.change('caprel-round-exemption', '506b');
    assert.ok(m.by('caprel-round-exemption-note'), 'a change to 506(b) warns first');
    assert.match(m.text(), /Saving takes down every deck link published as a page for this round\./);
    assert.equal(m.calls.filter((c) => c[0] === 'save').length, 0, 'nothing is written before Save round');
    await m.press('caprel-round-go');
    const save = m.calls.find((c) => c[0] === 'save');
    assert.ok(save, JSON.stringify(m.calls));
    assert.equal(save[1].exemption, '506b');
    assert.equal(save[1].project_id, 12);
  } finally { await m.unmount(); }
  const none = await mountDialog({ name: 'Seed', currency: 'USD', exemption: null });
  try {
    assert.equal(none.pr(none.by('caprel-round-exemption')).value, '', 'a round with none recorded reads Not recorded');
    await none.press('caprel-round-go');
    assert.equal(none.calls.find((c) => c[0] === 'save')[1].exemption, null, 'saving leaves it not recorded, never a default');
  } finally { await none.unmount(); }
});
