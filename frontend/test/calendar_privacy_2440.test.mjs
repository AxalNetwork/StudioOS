import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, mutationCheck } from './_form_d695.mjs';

const page = readFileSync(new URL('../src/pages/CalendarPage.jsx', import.meta.url), 'utf8');
// Mount the actual modal and its two presentational helpers, with only API I/O
// substituted. No page-level network/effects are needed to schedule a meeting.
const source = `import React, { useState } from 'react';
const X = () => null;
export const calls = [];
const api = { async createIcMeeting(body) { calls.push(body); } };
` + page.slice(page.indexOf('function ModalShell('), page.indexOf('function CheckinModal('))
  + page.slice(page.indexOf('function Field(')) + '\nexport { IcMeetingModal };';
async function verify(module) {
  let saved = 0;
  const f = await mountForm(h(module.IcMeetingModal, { me: { id: 4 }, onClose() {}, onSaved() { saved++; } }));
  try {
    const inputs = () => f.nodes().filter(n => n.tagName === 'INPUT');
    const change = async (index, value) => { await act(async () => f.props(inputs()[index]).onChange({ target: { value } })); };
    const schedule = () => f.nodes().find(n => n.tagName === 'BUTTON' && f.props(n).children === 'Schedule');
    assert.ok(f.text().includes('Deal id (required)'));
    assert.equal(f.props(inputs()[3]).required, true);
    await change(0, 'Fixture IC');
    await change(1, '2099-01-01T12:00');
    for (const value of ['', '-1', '1.5']) {
      await change(3, value);
      assert.equal(f.props(schedule()).disabled, true, value || 'empty deal');
    }
    // The handler also refuses invalid state if invoked programmatically.
    await act(async () => f.props(schedule()).onClick());
    assert.equal(module.calls.length, 0);
    await change(3, '200');
    assert.equal(f.props(schedule()).disabled, false);
    await f.click('Schedule');
    assert.equal(module.calls[0].deal_id, 200);
    assert.equal(saved, 1);
  } finally { await f.unmount(); }
}
test('#2440: IC modal requires a positive integer deal and sends it; each validation/payload mutation is rejected', async () => {
  await mutationCheck(source, 'pages/CalendarPage.jsx', verify, [
    ['Deal id (required)', 'Deal id (optional)'],
    ['step={1} required', 'step={1}'],
    [' || !validDeal}', '}'],
    ["if (!validDeal) { setErr('Enter a valid deal id.'); return; }", ''],
    ['deal_id: dealId,', 'deal_id: null,'],
  ]);
});
