/** D7811: shared literal expectations and cross-runtime parity, without changing existing exports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { csvSafe, toSafeCsv, toCsv, csvCell } from '../src/lib/csvExport.js';
import { csvSafe as workerCell, toSafeCsv as workerCsv } from '../../cloudflare-worker/src/services/csv.ts';
import { CSV_SAFE_CASES } from './_csv_safe_7811.mjs';

test('safe cells match the shared literal cases and the Worker, including numeric and already-prefixed values', () => {
  for (const [name, value, expected] of CSV_SAFE_CASES) {
    assert.equal(csvSafe(value), expected, name);
    assert.equal(csvSafe(value), workerCell(value), name);
  }
});
test('safe documents protect headers and values; legacy serialization remains byte-for-byte opt-in', () => {
  const header = ['=header', 'amount']; const rows = [['+phone', -42], ['ordinary', null]];
  assert.equal(toSafeCsv(header, rows), "'=header,amount\r\n'+phone,-42\r\nordinary,");
  assert.equal(toSafeCsv(header, rows), workerCsv(header, rows));
  assert.equal(toCsv(header, rows), '=header,amount\r\n+phone,-42\r\nordinary,');
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
});
