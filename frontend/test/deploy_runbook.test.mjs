/**
 * The deploy runbook stays true to the scripts it quotes.
 *
 * `documentation/operations/DEPLOY.md` exists because the previous version of
 * that procedure — pasted into a Replit session as an attached asset — named
 * the pending migrations as a fixed range and told the operator to STOP if
 * anything else appeared. Two migrations landed days later. Followed to the
 * letter it aborts a correct deploy; followed loosely it teaches the operator
 * to ignore the stop condition, which is worse.
 *
 * The runbook's answer is that every number is a command's output rather than
 * a written-down fact. But it still quotes `package.json` verbatim in its
 * command table, and that table is itself a staleness surface: rename a script
 * or change a hook and the runbook silently starts lying about how production
 * ships. These tests hold the quoted half to the real half.
 *
 * Test 5 enforces the runbook's own rule on itself. Section 7 is the
 * postmortem and is allowed to name the stale numbers as the cautionary tale;
 * everything ABOVE it is the operative procedure and may not name a migration
 * file, a migration range, or a route-pattern count.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const at = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const DOC_PATH = 'documentation/operations/DEPLOY.md';
const doc = at(DOC_PATH);
const rootPkg = JSON.parse(at('package.json'));
const workerPkg = JSON.parse(at('cloudflare-worker/package.json'));

/** The operative procedure: everything before the section that explains itself. */
const POSTMORTEM = '## 7. Why nothing here is hardcoded';
const operative = doc.slice(0, doc.indexOf(POSTMORTEM));

test('every `npm run <script>` the runbook names exists in package.json', () => {
  const named = [...doc.matchAll(/\bnpm run ([a-z][a-z0-9:]*)/g)].map((m) => m[1]);
  assert.ok(named.length >= 5, `expected the runbook to name several scripts, found ${named.length}`);

  const missing = [...new Set(named)].filter((s) => !(s in rootPkg.scripts));
  assert.deepEqual(missing, [], `runbook names scripts that do not exist: ${missing.join(', ')}`);
});

test('the deploy chain table quotes the real predeploy/deploy/postdeploy commands', () => {
  const rows = Object.fromEntries(
    [...operative.matchAll(/^\|\s*`(\w+)`\s*\|\s*`([^`]+)`\s*\|/gm)].map((m) => [m[1], m[2]]),
  );

  for (const hook of ['predeploy', 'deploy', 'postdeploy']) {
    assert.ok(hook in rows, `the chain table is missing its \`${hook}\` row`);
    assert.equal(
      rows[hook],
      rootPkg.scripts[hook],
      `DEPLOY.md quotes \`${hook}\` as "${rows[hook]}" but package.json says "${rootPkg.scripts[hook]}"`,
    );
  }
});

test('§1.1 is still right that the worker package’s own deploy omits --env production', () => {
  const s = workerPkg.scripts.deploy;
  assert.ok(s, 'cloudflare-worker/package.json has no deploy script');
  assert.ok(
    !s.includes('--env production'),
    'the worker package deploy script now sets --env production; ' +
      'DEPLOY.md §1.1 calls it out as a footgun and must be rewritten',
  );
  assert.ok(
    !s.includes('migrate-d1'),
    'the worker package deploy script now migrates; §1.1 says it does not',
  );
});

test('§1.1 is still right that the un-suffixed deploy hits the live worker', () => {
  // Both `name` fields resolving to the same worker is WHY the footgun is
  // dangerous rather than merely wrong. Comment lines are stripped so a
  // commented-out name cannot satisfy this.
  const toml = at('wrangler.toml')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  const topLevel = toml.match(/^name\s*=\s*"([^"]+)"/m);
  assert.ok(topLevel, 'wrangler.toml has no top-level name');

  const prodBlock = toml.slice(toml.indexOf('[env.production]'));
  const prodName = prodBlock.match(/^name\s*=\s*"([^"]+)"/m);
  assert.ok(prodName, '[env.production] has no name');

  assert.equal(
    topLevel[1],
    prodName[1],
    'the top-level and [env.production] worker names have diverged; ' +
      'DEPLOY.md §1.1 claims a deploy without --env production still hits the live worker',
  );
});

test('the operative sections name no migration file, range, or pattern count', () => {
  assert.ok(
    doc.includes(POSTMORTEM),
    `${DOC_PATH} lost its "${POSTMORTEM}" section, which anchors this rule`,
  );
  assert.ok(operative.length > 1000, 'the operative half of the runbook is implausibly short');

  const banned = [
    [/\b\d{3}_[a-z0-9_]+\.sql\b/, 'a specific migration filename'],
    [/\b1\d{2}\s*[–—-]\s*1\d{2}\b/, 'a migration number range'],
    [/\b\d+\s+(?:route\s+)?patterns\b/, 'a route-pattern count'],
  ];

  for (const [re, what] of banned) {
    const hit = operative.match(re);
    assert.equal(
      hit,
      null,
      `${DOC_PATH} names ${what} ("${hit?.[0]}") in its operative sections. ` +
        'That is the exact failure the runbook exists to prevent — derive it ' +
        'from `migrate-d1.mjs --remote --dry-run` instead.',
    );
  }
});

test('the runbook points at the dry-run as the authority on what is pending', () => {
  assert.ok(
    /migrate-d1\.mjs --remote --dry-run/.test(operative),
    'the runbook no longer tells the operator to derive the pending set from --dry-run',
  );
});

/**
 * The cutover doc is operator-facing too, and drifted the same way.
 *
 * `CLOUDFLARE-CUTOVER.md` is what someone follows to move the apex off GitHub
 * Pages. It described the Worker's route table as "84-entry" in its status
 * line, told an aborting operator to "restore the saved version/67-route
 * table", and made the rollback "Restoring Pages plus the 84-route table" —
 * while the real table carries 166 patterns. Someone rolling back a failed
 * cutover would have been hunting for a table that does not exist, at the
 * worst possible moment.
 *
 * A count of routes is never load-bearing: what matters is the table the
 * operator CAPTURED before flipping. So the doc names no count, and this
 * holds it to that.
 */
test('the cutover doc claims no route-table entry count', () => {
  const doc = at('documentation/architecture/CLOUDFLARE-CUTOVER.md');

  const hit = doc.match(/\b\d+[- ](?:entry|route)\s+(?:route\s+)?table\b/i);
  assert.equal(
    hit,
    null,
    `CLOUDFLARE-CUTOVER.md states a route-table size ("${hit?.[0]}"). ` +
      'That number goes stale every time a route is added, and the rollback ' +
      'instruction that cites it then points at a table that does not exist. ' +
      'Name the table the operator captured, not a count.',
  );
});

test('wrangler.toml keeps its two route tables the same size', () => {
  // The cutover restores "both route tables"; a binding or route added to only
  // one of them is missing in whichever environment was not edited.
  const toml = at('wrangler.toml').split('\n').filter((l) => !/^\s*#/.test(l));

  let table = null;
  const counts = { top: 0, prod: 0 };
  for (const line of toml) {
    if (/^\[\[routes\]\]/.test(line)) table = 'top';
    else if (/^\[\[env\.production\.routes\]\]/.test(line)) table = 'prod';
    else if (/^\[\[/.test(line) || /^\[[^[]/.test(line)) table = null;
    if (table && /^\s*pattern\s*=/.test(line)) counts[table] += 1;
  }

  assert.ok(counts.top > 0 && counts.prod > 0, `expected both route tables to be populated, got ${JSON.stringify(counts)}`);
  assert.equal(
    counts.top,
    counts.prod,
    `the two route tables have diverged (top-level ${counts.top}, [env.production] ${counts.prod}); ` +
      'a route in only one table is missing in the other environment',
  );
});
