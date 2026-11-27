/**
 * D446 — the pages say what the two new reads actually returned.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/support_audit_cycle_d446.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const ACCOUNTS = raw('frontend/src/pages/branch/BranchAccounts.jsx');
const PROGRAMS = raw('frontend/src/pages/branch/BranchPrograms.jsx');
const API = raw('frontend/src/lib/api.js');
const INSIGHTS = raw('cloudflare-worker/src/routes/branch_insights.ts');

test('the audit line distinguishes an unreadable table from an empty one', () => {
  assert.match(ACCOUNTS, /data-testid="branch-support-audit-unreadable"/);
  assert.match(ACCOUNTS, /data-testid="branch-support-audit-empty"/);
  assert.match(ACCOUNTS, /The record exists and is empty/);
  assert.match(ACCOUNTS, /branchSupportSessions\(/);
  assert.doesNotMatch(ACCOUNTS, /No support session has been opened on this territory\. The record exists and is empty[\s\S]{0,80}available === false/);
  const emptyAt = ACCOUNTS.indexOf('branch-support-audit-empty');
  const unreadAt = ACCOUNTS.indexOf('branch-support-audit-unreadable');
  assert.ok(unreadAt > 0 && emptyAt > unreadAt, 'the empty sentence is not behind the unreadable branch');
  assert.match(ACCOUNTS, /reads_unrecorded_reason/);
  assert.match(ACCOUNTS, /mirror_unrecorded_reason/);
});

test('Programs lists runs for the cycle it already loaded', () => {
  assert.match(codeOnly(PROGRAMS), /listSessions\(/);
  assert.match(PROGRAMS, /data-testid="branch-programs-cycle-filter"/);
  assert.match(PROGRAMS, /data-testid="branch-programs-runs-unreadable"/);
  assert.match(PROGRAMS, /data-testid="branch-programs-runs-empty"/);
  assert.match(PROGRAMS, /No assessment run started inside this cycle/);
  assert.match(PROGRAMS, /no separate\s+list of results/);
  assert.doesNotMatch(PROGRAMS, /no GET \/sessions/);
  const list = API.slice(API.indexOf('listSessions: (cycleId)'));
  assert.match(list.slice(0, 400), /q\.set\('cycle'/);
  assert.match(API, /branchSupportSessions: \(\) => request\('\/branch\/support-sessions'\)/);
});

test('throughput no longer claims there is no list route', () => {
  const start = INSIGHTS.indexOf('const THROUGHPUT_REASON');
  const end = INSIGHTS.indexOf(';', start);
  const reason = INSIGHTS.slice(start, end);
  assert.match(reason, /not added here/);
  assert.match(reason, /one cycle/);
  assert.doesNotMatch(reason, /no route that lists/);
  assert.doesNotMatch(reason, /no GET \/sessions/);
});
