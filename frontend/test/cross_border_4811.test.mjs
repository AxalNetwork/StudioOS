// D4811 (#4811) part 17 — cross-border fields (board CT-15) and the entities'
// formation jurisdiction (question A: Delaware). The panel says "N of 7
// resolved", fills nothing in for you (governing law is never defaulted),
// sends what was entered, and names the open checks that hold a send; the
// quick panel's Resend is held with the reason; an entity page names its
// jurisdiction. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import CrossBorderPanel, { formOf, resolvedLine } from '../src/pages/admin/contracts/CrossBorderPanel.jsx';
import AgreementDetail from '../src/pages/admin/contracts/AgreementDetail.jsx';
import { EntityAttention } from '../src/pages/admin/contracts/GovernanceAttention.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...contractsApi }, apiOriginals = { ...api };
const never = () => new Promise(() => {});
const restore = () => { Object.assign(contractsApi, originals); Object.assign(api, apiOriginals); };
const checks = [
  { key: 'counterparty_jurisdiction', label: 'Counterparty jurisdiction', value: 'Netherlands', state: 'resolved' },
  { key: 'governing_law', label: 'Governing law', value: 'Netherlands — clause 18', state: 'resolved' },
  { key: 'performance_countries', label: 'Countries of performance', value: 'Netherlands, United States', state: 'resolved' },
  { key: 'tax', label: 'Tax review', value: null, state: 'open' },
  { key: 'data_transfer', label: 'Data-transfer mechanism', value: null, state: 'open' },
  { key: 'local_counsel', label: 'Local-counsel review', value: 'Example Advocaten', state: 'resolved' },
  { key: 'sanctions', label: 'Sanctions / trade review', value: 'Cleared', state: 'not_applicable' },
];

test('the rules: N of 7 resolved (not applicable counts as settled); the form fills nothing in', () => {
  assert.equal(resolvedLine(checks), '5 of 7 resolved');
  assert.equal(resolvedLine(null), null);
  const empty = formOf(null);
  assert.equal(empty.governing_law, '', 'governing law is never defaulted to Delaware');
  assert.equal(empty.counterparty_jurisdiction, '');
  assert.equal(empty.tax_status, 'open');
  assert.equal(formOf({ governing_law: 'Netherlands', tax_status: 'resolved', tax_note: 'VAT reverse charge' }).tax_note, 'VAT reverse charge');
});

test('mounted: an unmarked agreement says so; marking it sends exactly what was entered; open checks are named as holding the send', async () => {
  const calls = [];
  let record = null;
  contractsApi.crossBorder = async () => (record ? { uid: 'env-nl', record, checks, open: ['Tax review', 'Data-transfer mechanism'] } : { uid: 'env-nl', record: null, checks: null, open: [] });
  contractsApi.saveCrossBorder = async (uid, body) => { calls.push([uid, body]); record = body; return {}; };
  const view = await mountContracts(React.createElement(CrossBorderPanel, { uid: 'env-nl' }));
  try {
    await view.flush();
    assert.match(view.text(), /Not marked cross-border\./);
    await view.click('Mark as cross-border');
    assert.match(view.text(), /Nothing is filled in for you\./);
    const field = (label) => view.nodes().find((n) => n.tagName === 'INPUT' && (n.parentNode && view.nodes().includes(n)) && String(n.parentNode.childNodes?.[0]?.textContent || '').startsWith(label));
    const byLabelText = (label) => view.nodes().filter((n) => n.tagName === 'LABEL').find((l) => (l.childNodes?.[0]?.textContent || '') === label)?.childNodes.find((c) => c.tagName === 'INPUT');
    for (const [label, value] of [['Counterparty jurisdiction', 'Netherlands'], ['Governing law', 'Netherlands — clause 18'], ['Countries of performance', 'Netherlands, United States']]) {
      const input = byLabelText(label) || field(label);
      await act(async () => { view.props(input).onChange({ target: { value } }); });
    }
    await view.click('Save checks');
    await view.flush();
    assert.deepEqual(calls[0][0], 'env-nl');
    assert.equal(calls[0][1].governing_law, 'Netherlands — clause 18');
    assert.equal(calls[0][1].tax_status, 'open');
    assert.match(view.text(), /Cross-border 5 of 7 resolved/);
    assert.match(view.text(), /Tax reviewNot entered◷ Open/);
    assert.match(view.text(), /Send for signature is held: Tax review, Data-transfer mechanism are open\./);
  } finally { await view.unmount(); restore(); }
});

test('the quick panel holds Resend while checks are open, and says why; an entity names its formation jurisdiction', async () => {
  for (const key of Object.keys(apiOriginals)) if (typeof apiOriginals[key] === 'function') api[key] = () => never();
  api.adminGetContract = async () => ({ uid: 'env-nl', source: 'esign', title: 'Service Agreement', status: 'sent', can_resend: true, project_name: 'Studio Vireo' });
  contractsApi.history = never; contractsApi.signedPdf = never; contractsApi.files = never;
  contractsApi.crossBorder = async () => ({ uid: 'env-nl', record: {}, checks, open: ['Tax review'] });
  let view = await mountContracts(React.createElement(AgreementDetail, { uid: 'env-nl', onClose() {}, onChanged() {} }));
  try {
    await view.flush(); await view.flush();
    const resend = view.nodes().find((n) => n.tagName === 'BUTTON' && view.props(n)?.children === 'Resend');
    assert.equal(view.props(resend).disabled, true);
    assert.match(view.text(), /Resend is held: 1 cross-border check is open \(Tax review\)\./);
  } finally { await view.unmount(); restore(); }
  const entity = { key: 'gp', name: 'Axal VC GP LLC', jurisdiction: 'Delaware, United States', withheld: 0, attention: { facts: {}, records: [] } };
  view = await mountContracts(React.createElement(EntityAttention, { entity, onAdd() {}, onOpen() {} }));
  try {
    assert.match(view.text(), /Formation jurisdictionDelaware, United States/);
  } finally { await view.unmount(); }
  view = await mountContracts(React.createElement(EntityAttention, { entity: { ...entity, jurisdiction: null }, onAdd() {}, onOpen() {} }));
  try {
    assert.match(view.text(), /Formation jurisdictionNot recorded/, 'an entity not answered for is never guessed');
  } finally { await view.unmount(); }
});
