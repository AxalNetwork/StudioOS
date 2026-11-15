/**
 * D5050 (#5050) part 3 — territory names on Contracts agreement rows, filter buttons and chips: the English name
 * from `Intl.DisplayNames`, the stored ISO-2 code as the filter value and the fallback. Synthetic data.
 *
 *   node --test frontend/test/contracts_territory_names_5050_p3.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { territoryName, agreementContextLine, filterButtonValue, activeAgreementChips, checkFilterText } from '../src/lib/contractAgreements.js';

test('a known ISO-2 code prints its English country name, in any case', () => {
  assert.equal(territoryName('FR'), 'France');
  assert.equal(territoryName('de'), 'Germany');
  assert.equal(territoryName(' gb '), 'United Kingdom');
});

test('an unknown, malformed or empty code is never guessed: the code prints, or nothing', () => {
  assert.equal(territoryName('QZ'), 'QZ');
  assert.equal(territoryName('FRA'), 'FRA');
  assert.equal(territoryName('f1'), 'F1');
  assert.equal(territoryName(''), null);
  assert.equal(territoryName(null), null);
  assert.equal(territoryName(undefined), null);
});

test('the row context line names each territory, keeping a code it cannot name', () => {
  const row = { territory: ['FR', 'QZ'], licence_ref: 'AXL-001', program_name: 'Spin-Out Lab' };
  assert.equal(agreementContextLine(row), 'France, QZ · AXL-001 · Spin-Out Lab');
  assert.equal(agreementContextLine({ territory: [], holder: { name: 'Holder A' }, licence_ref: 'AXL-002' }), 'Holder A · AXL-002');
});

test('the Licence button and the Territory chip read the name; the filter value stays the code', () => {
  const f = { territory: 'fr', licence: 'AXL-001' };
  assert.equal(filterButtonValue('licence', f), 'France · AXL-001');
  assert.deepEqual(activeAgreementChips(f).find((c) => c.key === 'territory'), { key: 'territory', label: 'Territory: France' });
  assert.deepEqual(checkFilterText('territory', 'fr'), { ok: true, value: 'FR' });
});
