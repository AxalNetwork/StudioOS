/**
 * #9165 — the Stripe webhook fulfilment test cannot go dark again.
 *
 * billing_webhook_fulfilment.test.mjs is skipped unless RUN_BILLING_WEBHOOK_TEST
 * is set. Nothing set it, so its seed broke (it re-applied migrations the
 * baseline already holds) and nobody saw. This guard fails unless some
 * workflow step sets the variable and runs that file, on the pull requests
 * that change the webhook route, and unless the test still gates on that same
 * variable name.
 *
 * The workflows are read as text (the repository has no YAML parser installed),
 * with the two-space layout every file under .github/workflows uses.
 *
 *   node --test cloudflare-worker/test/billing_webhook_ci_9165.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const VAR = 'RUN_BILLING_WEBHOOK_TEST';
const TEST_FILE = 'cloudflare-worker/test/billing_webhook_fulfilment.test.mjs';
const DIR = new URL('../../.github/workflows/', import.meta.url);
const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const SRC = Object.fromEntries(FILES.map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')]));

/** The workflow without comments, so a comment naming the variable does not count. */
const code = (src) => src.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');

/** Each step of every job: the text from one `- ` step item at six spaces to the next. */
function steps(src) {
  return code(src).split(/^ {6}- /m).slice(1);
}

/** A step that sets the variable to a non-empty, non-false value and runs the test file. */
function runsTheTest(step) {
  const set = new RegExp(`^ {10}${VAR}:\\s*['"]?([^'"\\s]+)['"]?\\s*$`, 'm').exec(step);
  return Boolean(set && !['0', 'false', ''].includes(set[1].toLowerCase()) && step.includes(`--test ${TEST_FILE}`));
}

const RUNNERS = FILES.filter((f) => steps(SRC[f]).some(runsTheTest));

test(`#9165: a workflow step sets ${VAR} and runs the fulfilment test`, () => {
  assert.ok(RUNNERS.length > 0, `no workflow under .github/workflows sets ${VAR} on a step that runs ${TEST_FILE}`);
});

test('#9165: that workflow runs on the pull requests that change the webhook route', () => {
  const covering = RUNNERS.filter((f) => {
    const src = code(SRC[f]);
    if (!/^ {2}pull_request:/m.test(src)) return false;
    const paths = /^ {4}paths:\n((?: {6}- .*\n?)*)/m.exec(src);
    // No paths filter means every pull request, which covers the route too.
    if (!paths) return true;
    return /- 'cloudflare-worker\/src\/routes\/billing\*\.ts'/.test(paths[1]) && paths[1].includes(TEST_FILE.replace('fulfilment.test.mjs', ''));
  });
  assert.ok(covering.length > 0, `${RUNNERS.join(', ') || 'no workflow'} must run on pull requests touching routes/billing*.ts and the test`);
});

test(`#9165: the fulfilment test still gates on ${VAR}`, () => {
  const src = readFileSync(new URL('./billing_webhook_fulfilment.test.mjs', import.meta.url), 'utf8');
  const gates = src.match(new RegExp(`skip: !process\\.env\\.${VAR}\\b`, 'g')) ?? [];
  assert.equal(gates.length, 2, `both fulfilment tests must gate on ${VAR}, the variable the workflow sets`);
});
