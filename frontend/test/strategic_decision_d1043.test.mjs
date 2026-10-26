import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { StrategicDialog } from '../src/pages/admin/programs/ReferAndEarn.jsx';

const row = { id: 41, name: 'Member', role: 'Founder', asked: 'today' };

test('strategic decline discloses sharing, refuses blank/short reasons, and submits a trimmed reason', async () => {
  const original = api.adminStrategicAccessDecision;
  const calls = [];
  api.adminStrategicAccessDecision = async (...args) => { calls.push(args); return { status: 'declined' }; };
  const view = await mountContracts(React.createElement(StrategicDialog, { row, decision: 'declined', onClose() {} }));
  try {
    assert.match(view.text(), /Reason sent to the member · required/);
    await view.click('Decline');
    assert.equal(calls.length, 0);
    assert.match(view.text(), /10 to 4,000 characters/);
    await view.fill('Reason sent to the member', '   too short   ');
    await view.click('Decline');
    assert.equal(calls.length, 0, 'trim before checking the minimum');
    await view.fill('Reason sent to the member', '   Please gain relevant experience first.   ');
    await view.click('Decline');
    assert.deepEqual(calls, [[41, { decision: 'declined', note: 'Please gain relevant experience first.' }]]);
    assert.match(view.text(), /Declined\./);
  } finally { await view.unmount(); api.adminStrategicAccessDecision = original; }
});

test('strategic grant keeps its audit note optional and can submit without a reason', async () => {
  const original = api.adminStrategicAccessDecision;
  const calls = [];
  api.adminStrategicAccessDecision = async (...args) => { calls.push(args); return { status: 'granted' }; };
  const view = await mountContracts(React.createElement(StrategicDialog, { row, decision: 'granted', onClose() {} }));
  try {
    assert.match(view.text(), /Note for the audit · optional/);
    assert.doesNotMatch(view.text(), /Reason sent to the member/);
    await view.click('Grant');
    assert.deepEqual(calls, [[41, { decision: 'granted' }]]);
    assert.match(view.text(), /Granted\./);
  } finally { await view.unmount(); api.adminStrategicAccessDecision = original; }
});
