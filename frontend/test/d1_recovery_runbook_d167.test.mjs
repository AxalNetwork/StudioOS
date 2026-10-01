/**
 * D167 — the D1 recovery runbook, and the three claims it corrects.
 *
 * WHY A GUARD FOR PROSE. Most of this PR is a document, and a document cannot
 * fail. What can fail is the code and config the document describes drifting
 * away from it — which is how `INCIDENT_RESPONSE.md` came to commit to an RPO
 * of 24 hours (the *export cadence*) for a database that Cloudflare will
 * restore to any instant in the last 30 days, and how the monthly DR drill
 * came to rehearse a restore into a database that is not EU-resident.
 *
 * So this asserts the three things a future edit could quietly undo, and the
 * one-line change that is the only executable fix in the PR.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const at = (p) => resolve(process.cwd(), p);
const raw = (p) => readFileSync(at(p), 'utf8');

const RUNBOOK_PATH = 'documentation/operations/D1_RECOVERY.md';
const DRILL = raw('scripts/dr-drill.sh');
const RESTORE = raw('scripts/restore-d1.sh');
const IR = raw('documentation/operations/INCIDENT_RESPONSE.md');

test('the drill creates an EU-resident database — the one executable fix', () => {
  // THE FINDING. A jurisdiction is fixed at creation and cannot be changed
  // after, and production is EU-resident account-side. A drill that restores
  // into a database created without the flag proves the backup is importable
  // while rehearsing a shape that would land production data outside the EU.
  const at_ = DRILL.indexOf('wrangler d1 create');
  assert.ok(at_ > 0, 'the drill no longer creates its throwaway database');
  const line = DRILL.slice(at_, DRILL.indexOf('\n', at_));
  assert.match(line, /--jurisdiction eu/,
    'the DR drill creates its throwaway D1 without --jurisdiction eu again');

  // And it must still tear the database down, or the drill leaks one a month.
  assert.match(DRILL, /wrangler d1 delete/, 'the drill stopped deleting its throwaway database');
});

test('the RPO commitment no longer reports the export cadence as the recovery point', () => {
  // The old row read "**24 hours** (daily backups)" in the Target column. The
  // cadence is still true and still stated — what changed is that it is no
  // longer presented as the recovery point for D1.
  const at_ = IR.indexOf('Recovery Point Objective');
  assert.ok(at_ > 0, 'the RPO row is gone');
  const row = IR.slice(at_, IR.indexOf('\n', at_));
  assert.doesNotMatch(row, /\*\*24 hours\*\* \(daily backups\)/,
    'the RPO target is the daily export cadence again');
  assert.match(row, /point-in-time, within 30 days/,
    'the RPO row no longer states the point-in-time window');
  // The 24h figure must SURVIVE as the fallback — deleting it would replace
  // one wrong commitment with another, since it is exactly right for damage
  // older than the Time Travel window.
  assert.match(row, /24 hours is the fallback/i,
    'the 24-hour fallback was deleted rather than repositioned');
});

test('the runbook exists and is reachable from the documentation index', () => {
  assert.ok(existsSync(at(RUNBOOK_PATH)), `${RUNBOOK_PATH} is missing`);
  const INDEX = raw('documentation/README.md');
  assert.ok(INDEX.includes('operations/D1_RECOVERY.md'),
    'documentation/README.md does not link the recovery runbook');
  // check-folder-docs TRUTH-checks this README, so a link to a file that does
  // not exist fails the build — asserting it here names the reason.
  assert.ok(existsSync(at(RUNBOOK_PATH)), 'the index links a runbook that does not exist');

  const BOOK = raw(RUNBOOK_PATH);

  // The two commands the runbook is FOR. Read off `wrangler --help` at 4.131.0
  // rather than recalled, so a rename upstream shows up as a failing test
  // rather than as an operator running a command that does not exist.
  //
  // BOUNDED TO THE SYNOPSIS BLOCK, and the mutation run is why. A whole-file
  // `BOOK.includes(cmd)` PASSED while the synopsis was renamed to a command
  // wrangler does not have, because the worked example forty lines below still
  // spelt it correctly. That is the D147/D161 failure again: an assertion a
  // NEIGHBOURING occurrence can satisfy is not an assertion about this one.
  // The synopsis is the authoritative statement of the command surface, so it
  // is the thing pinned.
  const synStart = BOOK.indexOf('```\nwrangler d1 time-travel');
  assert.ok(synStart > 0, 'the runbook lost its command synopsis block');
  const syn = BOOK.slice(synStart, BOOK.indexOf('```', synStart + 3));
  for (const cmd of ['wrangler d1 time-travel info <database>',
                     'wrangler d1 time-travel restore <database>']) {
    assert.ok(syn.includes(cmd), `the synopsis no longer names \`${cmd}\``);
  }
  // …and the worked examples must agree with it, which is the other half.
  for (const cmd of ['wrangler d1 time-travel info studioos-db',
                     'wrangler d1 time-travel restore studioos-db']) {
    assert.ok(BOOK.includes(cmd), `the runbook's worked example no longer runs \`${cmd}\``);
  }
  assert.match(BOOK, /--jurisdiction eu/, 'the runbook stopped naming the jurisdiction flag');
  assert.match(BOOK, /schema_migrations/,
    'the runbook stopped telling the operator to check the ledger after a rewind');
});

test('restore-d1.sh points at the runbook and does not promise a database that exists', () => {
  assert.match(RESTORE, /D1_RECOVERY\.md/, 'the script no longer points at the runbook');
  // The old header called the default "the `--preview` DB so you can verify
  // the restore before flipping prod" — which reads as a standing resource.
  // It is not one: `studioos-db-preview` is not in the account.
  assert.doesNotMatch(RESTORE, /The default target is the `--preview` DB/,
    'the header describes the default target as a standing preview DB again');
  assert.match(RESTORE, /DOES NOT EXIST in the account/,
    'the header no longer says the default target is absent');
  // The no-truncate warning is load-bearing and must survive the rewrite.
  assert.match(RESTORE, /does NOT truncate|not truncate/i,
    'the no-truncate warning was lost in the header rewrite');
});

test('the callerless SPA method is gone, and the route it called is explained rather than changed', () => {
  const API = codeOnly(raw('frontend/src/lib/api.js'));
  assert.doesNotMatch(API, /monitoringThroughput/,
    'api.monitoringThroughput is back, and nothing calls it');

  // The ROUTE stays. D156 ruled its wider gate correct and this PR does not
  // re-open that; it writes the reason down so a fourth pass does not.
  const MON = raw('cloudflare-worker/src/routes/monitoring.ts');
  assert.match(MON, /monitoring\.get\('\/throughput'/, 'the /throughput route was deleted');
  assert.match(MON, /D156/, 'the /throughput gate no longer cites the decision that settled it');
  assert.match(MON, /D133/, 'the comment no longer names the rule the route is measured against');
});
