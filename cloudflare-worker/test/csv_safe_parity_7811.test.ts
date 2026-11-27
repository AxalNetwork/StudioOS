/** D7811: the Worker runs the same literal case table as the opt-in frontend helper.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D7811: shared formula-safe CSV cases
 * without changing legacy exports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { csvSafe, toSafeCsv, toCsv } from '../src/services/csv.ts';
import { CSV_SAFE_CASES } from '../../frontend/test/_csv_safe_7811.mjs';

test('Worker safe-cell contract matches every shared literal case', () => {
  for (const [name, value, expected] of CSV_SAFE_CASES) assert.equal(csvSafe(value), expected, name);
  assert.equal(toSafeCsv(['field'], [['=1'], [-42]]), "field\r\n'=1\r\n-42");
  assert.equal(toCsv(['field'], [['=1'], [-42]]), 'field\r\n=1\r\n-42');
});
