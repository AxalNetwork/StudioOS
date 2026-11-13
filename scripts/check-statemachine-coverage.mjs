/**
 * Task #6 (CB) — Branch-coverage gate for the Personal Advisor state
 * machine. Spec requires ≥80% branch coverage on
 * `cloudflare-worker/src/services/advisor/stateMachine.ts`.
 *
 * Implementation: drives `node --test --experimental-test-coverage`
 * scoped to the state-machine test file and parses the summary
 * table for the row we care about. Node 22's coverage reporter
 * prints `# branch %    NN.NN` lines per file; we extract the
 * stateMachine.ts row and assert ≥ THRESHOLD.
 *
 * Invocation:
 *   node scripts/check-statemachine-coverage.mjs
 *
 * Wired into `npm run test:drift` as the final gate so a new bank id
 * or a state-machine refactor that drops branch coverage below 80%
 * breaks CI before merge.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const THRESHOLD = 80;
const TARGET = 'src/services/advisor/stateMachine.ts';

const result = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--no-warnings',
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-include=cloudflare-worker/src/services/advisor/stateMachine.ts',
    '--test-reporter=spec',
    'cloudflare-worker/test/advisor.stateMachine.test.ts',
  ],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);

const out = (result.stdout || '') + (result.stderr || '');
process.stdout.write(out);

if (result.status !== 0) {
  console.error(`\n[coverage] node --test exited with code ${result.status}`);
  process.exit(result.status || 1);
}

// The coverage table prints lines like:
//   # services/advisor/stateMachine.ts  | 92.31 | 88.46 | 90.00 | …
// The exact column ordering in Node 22's reporter is:
//   file | line % | branch % | function % | …
// We grep for the target file and pull the third numeric column.
const re = new RegExp(`stateMachine\\.ts[^\\n]*`, 'g');
const matches = out.match(re) || [];
const coverageLines = matches.filter((l) => /\d+\.\d+/.test(l));
if (coverageLines.length === 0) {
  console.error(`\n[coverage] could not find a coverage row for ${TARGET}`);
  process.exit(2);
}
// Take the row with the highest column count — that's the per-file row,
// not a header echo.
const row = coverageLines.sort((a, b) => b.length - a.length)[0];
const nums = row.match(/\d+(?:\.\d+)?/g) || [];
// Layout: line%, branch%, func%
if (nums.length < 3) {
  console.error(`\n[coverage] unexpected row format: ${row}`);
  process.exit(2);
}
const branchPct = parseFloat(nums[1]);
console.log(`\n[coverage] stateMachine.ts branch coverage: ${branchPct.toFixed(2)}%`);
if (branchPct + 1e-9 < THRESHOLD) {
  console.error(`[coverage] FAIL — branch coverage ${branchPct.toFixed(2)}% < ${THRESHOLD}% threshold`);
  process.exit(3);
}
console.log(`[coverage] OK — branch coverage ${branchPct.toFixed(2)}% ≥ ${THRESHOLD}% threshold`);
