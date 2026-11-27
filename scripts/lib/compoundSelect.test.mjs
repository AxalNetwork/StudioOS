/**
 * #9170: the compound-SELECT term counter, and the Worker source held to D1's
 * five-term limit. This file runs in `npm run test:retention` (part of
 * `test:drift`), so the limit is required on every PR; `node
 * scripts/check-compound-select.mjs` names the offending file and line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compoundTermCounts, overLimit, stringLiterals } from './compoundSelect.mjs';

const union = (n) => Array.from({ length: n }, (_, i) => `SELECT ${i}`).join(' UNION ALL ');

test('each compound is counted at its own depth', () => {
  assert.deepEqual(compoundTermCounts(union(6)), [6]);
  assert.deepEqual(compoundTermCounts('SELECT 1'), []);
  // Two nested groups of three joined by one UNION: three compounds, none over five.
  const split = `WITH a AS (${union(3)}), b AS (${union(3)}) SELECT * FROM a UNION ALL SELECT * FROM b`;
  assert.deepEqual(compoundTermCounts(split).sort(), [2, 3, 3]);
  assert.deepEqual(compoundTermCounts(`SELECT * FROM (${union(5)}) UNION SELECT 9`).sort(), [2, 5]);
  // INTERSECT and EXCEPT are compound operators too; a keyword inside a quoted string is not.
  assert.deepEqual(compoundTermCounts('SELECT 1 INTERSECT SELECT 2 EXCEPT SELECT 3'), [3]);
  assert.deepEqual(compoundTermCounts("SELECT 'a UNION b UNION c UNION d UNION e UNION f'"), []);
  assert.deepEqual(compoundTermCounts(`-- UNION UNION UNION UNION UNION\nSELECT 1`), []);
  // Separate statements are separate compounds.
  assert.deepEqual(compoundTermCounts(`${union(3)}; ${union(3)}`), [3, 3]);
});

test('literals are read from TypeScript, interpolations included, comments skipped', () => {
  const src = [
    '// const X = `' + union(6) + '`;',
    'const A = `SELECT a FROM t ${cond ? `AND x = 1` : \'\'} UNION ALL SELECT b FROM u`;',
    "const B = 'SELECT 1 UNION ALL SELECT 2';",
  ].join('\n');
  const texts = stringLiterals(src).map((l) => l.text);
  assert.ok(texts.includes('SELECT a FROM t ? UNION ALL SELECT b FROM u'));
  assert.ok(texts.includes('SELECT 1 UNION ALL SELECT 2'));
  assert.ok(!texts.some((t) => t.includes('SELECT 5')), 'a commented-out literal was read');
  assert.deepEqual(overLimit(`const Q = \`${union(6)}\`;`), [{ line: 1, terms: 6 }]);
  assert.deepEqual(overLimit(`const Q = \`${union(5)}\`;`), []);
  assert.deepEqual(overLimit(`\n\nconst Q = '${union(7)}';`), [{ line: 3, terms: 7 }]);
});

test('no compound SELECT in cloudflare-worker/src has more than five terms', () => {
  const script = fileURLToPath(new URL('../check-compound-select.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
