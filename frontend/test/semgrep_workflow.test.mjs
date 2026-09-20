/**
 * `.github/workflows/semgrep.yml` must keep the property that makes its
 * red/green mean something, and the one that stops it destroying the alert
 * history. Both were absent until D170, and neither is visible in a diff
 * unless you know what the three deleted settings did together.
 *
 * THE FAILURE THIS GUARDS, stated once so a future edit cannot re-introduce
 * it by accident:
 *
 *   A SARIF upload REPLACES a tool's alert set for the ref — every alert
 *   absent from the payload is closed as "fixed". A fatally-failed semgrep
 *   STILL WRITES a SARIF: measured on 1.176.1, a bad config exits 7 having
 *   written a structurally valid file whose `runs[0].tool.driver.name` is
 *   "Semgrep OSS" and whose `results` are empty. That payload cannot be told
 *   apart from a legitimate clean scan by inspecting it — only the exit code
 *   distinguishes them. So `continue-on-error: true` plus `if: always()`
 *   meant a crashed, cancelled or timed-out scan uploaded a resultless SARIF
 *   and silently resolved every open Semgrep alert.
 *
 * `--error` is what forced that knot: it made semgrep exit 1 on any finding,
 * so the step always "failed" and the later steps needed `always()` to run at
 * all. The three come out together or not at all.
 *
 * Counterpart guards: pr_preview.test.mjs (the preview Worker's config) and
 * branch_provision_workflow.test.mjs (the provisioning workflow).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOW = '.github/workflows/semgrep.yml';
const src = readFileSync(resolve(process.cwd(), WORKFLOW), 'utf8');

/**
 * The `scan` job's steps, split into blocks.
 *
 * Each block keeps its comment lines and its code lines APART. That
 * separation is the point rather than tidiness: this workflow's comments
 * quote the very flags the assertions forbid — the block explaining why
 * `--error` is gone contains the string `--error`. A whole-file scan would
 * be satisfied by the explanation and blind to the violation, which is the
 * shape this repo has already been bitten by (a banned-word scan that
 * forbade the sentence refusing the thing). Assertions read `.code`.
 */
function steps() {
  const lines = src.split('\n');
  const out = [];
  let cur = null;
  let inSteps = false;
  for (const line of lines) {
    if (/^ {4}steps:\s*$/.test(line)) { inSteps = true; continue; }
    if (!inSteps) continue;
    // A key at 4 spaces or less ends the steps list. Comment blocks BETWEEN
    // steps sit at 6 spaces, so the boundary cannot be "any 6-space line" —
    // that was this helper's first bug, and it silently returned one step.
    if (/^ {0,4}\S/.test(line)) break;
    if (/^ {6}- /.test(line)) {
      if (cur) out.push(cur);
      cur = { raw: [], comments: [], code: [] };
    }
    if (!cur) continue; // a leading comment block before the first step
    cur.raw.push(line);
    (/^\s*#/.test(line) ? cur.comments : cur.code).push(line);
  }
  if (cur) out.push(cur);
  return out.map((b) => ({
    raw: b.raw.join('\n'),
    comments: b.comments.join('\n'),
    code: b.code.join('\n'),
    name: (b.code.join('\n').match(/-\s+(?:name|uses):\s*(.+)/) || [, ''])[1].trim(),
  }));
}

const scanStep = () => steps().find((s) => s.name.startsWith('Run semgrep'));
const stripStep = () => steps().find((s) => s.name.startsWith('Drop nosemgrep'));
const uploadStep = () => steps().find((s) => s.name.startsWith('Upload SARIF'));

test('the scan step passes no --error, so its exit code means something', () => {
  const step = scanStep();
  assert.ok(step, `no "Run semgrep" step found in ${WORKFLOW}`);
  assert.ok(
    !/--error\b/.test(step.code),
    '`--error` makes semgrep exit 1 on ANY finding, so the step fails on every '
      + 'run and a real scanner crash becomes indistinguishable from the ~40 '
      + 'standing findings. Report findings through the SARIF upload, not the '
      + 'exit code.',
  );
  // The explanation of why it is absent is allowed to name it — and must,
  // or the next reader deletes the absence as an oversight.
  assert.ok(
    /--error/.test(step.comments),
    'the scan step must still CARRY the comment explaining why --error is absent',
  );
});

test('nothing in the job continues past a failed scan', () => {
  assert.ok(
    !/continue-on-error/.test(src),
    '`continue-on-error: true` on the scan step lets a scanner that could not '
      + 'run reach the SARIF upload, which would close every open Semgrep '
      + 'alert as fixed. A scan that failed must fail the job.',
  );
});

for (const [label, get] of [['strip', stripStep], ['upload', uploadStep]]) {
  test(`the ${label} step is unreachable from a failed scan`, () => {
    const step = get();
    assert.ok(step, `no ${label} step found in ${WORKFLOW}`);
    const cond = step.code.match(/^\s*if:\s*(.+)$/m);
    assert.equal(
      cond, null,
      `the ${label} step must take the DEFAULT if: success(). It carried `
        + `\`if: ${cond && cond[1]}\` — and always() runs after a failure AND `
        + 'after a cancellation (a timeout), which is exactly when the SARIF on '
        + 'disk is the resultless one a fatal semgrep leaves behind.',
    );
  });
}

test('the suppressed-results strip still runs, between the scan and the upload', () => {
  // GOTCHAS.md warns against removing this step to "see everything": it would
  // re-open ~49 alerts that each already carry a written justification in the
  // source. Nothing pinned its presence before this test.
  const names = steps().map((s) => s.name);
  const scan = names.findIndex((n) => n.startsWith('Run semgrep'));
  const strip = names.findIndex((n) => n.startsWith('Drop nosemgrep'));
  const upload = names.findIndex((n) => n.startsWith('Upload SARIF'));
  assert.ok(strip > -1, 'the nosemgrep-strip step must exist');
  assert.ok(
    scan < strip && strip < upload,
    `order must be scan -> strip -> upload; got ${JSON.stringify(names)}`,
  );
});

test('the scanner image is pinned by digest, like every action in this tree', () => {
  const image = (src.match(/^\s*image:\s*(\S+)/m) || [, ''])[1];
  assert.match(
    image, /@sha256:[0-9a-f]{64}$/,
    `the container must be digest-pinned; found ${image || '(none)'}. A moving `
      + 'tag changes the finding count with no repo change — GOTCHAS.md records '
      + 'two occurrences diagnosed as ruleset drift.',
  );
  // The pin is half the story and the file must keep saying so: the rule packs
  // are still fetched live, so this narrows drift rather than closing it.
  assert.ok(
    /semgrep\.dev/.test(src),
    'the image-pin comment must still record that the p/... packs are fetched '
      + 'from semgrep.dev at run time, or the pin reads as a stronger claim '
      + 'than it is',
  );
});
