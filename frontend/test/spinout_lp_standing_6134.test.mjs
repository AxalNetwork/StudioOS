import assert from 'node:assert/strict';
import test from 'node:test';
import { lpWorkspaceCallToAction, scheduledLabel } from '../src/lib/spinoutFundModel.js';

const approved = { application: { status: 'approved' } };
const read = (value) => ({ status: 'fulfilled', value });
const cta = (portal, application) => lpWorkspaceCallToAction(read(portal), read(application));

test('LP standing chooses a common destination and action for all workspace links', () => {
  assert.deepEqual(cta({}, { application: null }), { label: null, hash: '' });
  assert.equal(cta({}, { application: { status: 'pending' } }).label, 'See your application');
  assert.equal(cta({}, approved).label, 'Continue your subscription');
  assert.equal(cta({ performance: [{ lpa_signed: true }] }, {}).label, 'Continue your subscription');
  for (const commitment of [50000, 250000]) {
    assert.deepEqual(cta({ performance: [{ commitment }] }, approved), {
      label: 'Open my commitment', hash: '#my-commitment',
    });
  }
});

test('both reads must settle successfully before showing a standing, and past dates say so', () => {
  const failed = { status: 'rejected' };
  for (const args of [[], [failed, read(approved)], [read({ performance: [{ commitment: 50000 }] }), failed]]) {
    assert.deepEqual(lpWorkspaceCallToAction(...args), { label: 'Open the fund workspace', hash: '' });
  }
  assert.match(scheduledLabel('2026-08-21', '2026-11-14'), /date passed/);
});
