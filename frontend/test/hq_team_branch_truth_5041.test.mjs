/**
 * D5041 (#5041) — HQ Team says what happened to each branch, and no more.
 *
 * Five facts that must stay apart: ready to search (not asked), answered, could not be
 * read, not deployed, and "HQ cannot read its registry". "This is the whole team" is made
 * only when HQ has established there is no branch.
 *
 * The table is mounted over a stubbed `api.hqAdmins`; no network. Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_team_branch_truth_5041.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountForm, textOf } from './_form_d695.mjs';
import { api } from '../src/lib/api.js';
import HqTeamTable from '../src/pages/hq/HqTeamTable.jsx';
import {
  branchCoverageLine, branchStateText, registryUnreadable, wholeTeamEstablished,
} from '../src/pages/hq/hqTeamBranchModel.js';

const h = React.createElement;

const ADMIN = { user_id: 1, name: 'Sue', email: 'sue@axal.example', is_active: 1, is_super_admin: 1 };
const payload = (extra) => ({
  items: [ADMIN], total: 1, active: 1, ladder_readable: true, licences_available: true,
  searched: false, branches: [], registry_available: true, no_branches: false,
  branches_coverage: { total: 0, asked: 0, answered: 0, complete: true, unreadable: [], not_deployed: [], not_asked: [] },
  ...extra,
});
const NOT_ASKED = { code: 'fr', binding: 'BRANCH_FR', status: 'not_asked' };
const NOT_DEPLOYED = { code: 'de', binding: 'BRANCH_DE', status: 'not_deployed', reason: 'HQ holds a deployment row for this branch but this Worker has no service binding to it yet.' };
const UNREADABLE = { code: 'it', binding: 'BRANCH_IT', status: 'unreadable', reason: 'binding refused' };
const OK = { code: 'es', binding: 'BRANCH_ES', status: 'ok', data: { results: [], truncated: false }, as_of: '2026-11-08T10:00:00Z' };

async function mountWith(response) {
  const calls = [];
  api.hqAdmins = async (...a) => { calls.push(a); return typeof response === 'function' ? response(calls.length) : response; };
  const page = await mountForm(h(HqTeamTable, {}));
  await page.flush();
  return { page, calls };
}

test('a bound branch with no search is "Ready to search": no outage wording, no retry, and no "not deployed"', async () => {
  const { page } = await mountWith(payload({
    branches: [NOT_ASKED],
    branches_coverage: { total: 1, asked: 0, answered: 0, complete: false, unreadable: [], not_deployed: [], not_asked: ['fr'] },
  }));
  assert.equal(page.text().includes('Ready to search'), true);
  assert.doesNotMatch(page.text(), /Not deployed/);
  assert.doesNotMatch(page.text(), /could not be read/i);
  assert.ok(page.by('hq-team-branch-idle'), 'the idle explanation is missing');
  assert.equal(page.nodes().filter((n) => n.tagName === 'BUTTON' && /Retry/.test(textOf(n))).length, 0, 'a retry is offered for a read that was never attempted');
  assert.match(page.text(), /1 branch ready to search; none asked yet/);
  await page.unmount();
});

test('a registry row with no binding reads "Not deployed", and its reason is shown', async () => {
  const { page } = await mountWith(payload({
    branches: [NOT_DEPLOYED],
    branches_coverage: { total: 1, asked: 0, answered: 0, complete: false, unreadable: [], not_deployed: ['de'], not_asked: [] },
  }));
  assert.match(page.text(), /Not deployed/);
  assert.match(page.text(), /no service binding/);
  assert.doesNotMatch(page.text(), /Ready to search/);
  await page.unmount();
});

test('an unreadable branch is "Could not be read" with a retry, and an answering one keeps its result', async () => {
  const { page } = await mountWith(payload({
    searched: true, branches: [OK, UNREADABLE],
    branches_coverage: { total: 2, asked: 2, answered: 1, complete: false, unreadable: ['it'], not_deployed: [], not_asked: [] },
  }));
  assert.match(page.text(), /Could not be read/);
  assert.match(page.text(), /Nothing on this branch matched/);
  assert.match(page.text(), /Of 2 branches asked, 1 answered; 1 could not be read/);
  assert.ok(page.nodes().some((n) => n.tagName === 'BUTTON' && /Retry/.test(textOf(n))), 'no retry for a branch that was asked and failed');
  await page.unmount();
});

test('an unreadable registry is Unreadable with a retry, never "no branch is provisioned" or "the whole team"', async () => {
  const { page, calls } = await mountWith(payload({
    registry_available: false, registry_reason: 'HQ could not read its deployment registry', no_branches: false,
    branches_coverage: { total: 0, asked: 0, answered: 0, complete: false, unreadable: [], not_deployed: [], not_asked: [] },
  }));
  assert.ok(page.by('hq-team-registry-unreadable'), 'the registry failure is not drawn');
  assert.match(page.text(), /deployment registry could not be read/);
  assert.doesNotMatch(page.text(), /No branch is provisioned/);
  assert.doesNotMatch(page.text(), /this is the whole team/);
  assert.match(page.text(), /Deployment registry: unreadable/);
  const retry = page.nodes().find((n) => n.tagName === 'BUTTON' && /Retry/.test(textOf(n)));
  assert.ok(retry, 'no retry');
  const before = calls.length;
  await page.click('Retry');
  await page.flush();
  assert.ok(calls.length > before, 'Retry did not ask again');
  await page.unmount();
});

test('"this is the whole team" appears only when HQ established there is no branch', async () => {
  const yes = await mountWith(payload({ no_branches: true, registry_available: true }));
  assert.match(yes.page.text(), /this is the whole team/);
  await yes.page.unmount();
  // An older payload that says nothing about the registry makes no such claim.
  const old = await mountWith({ items: [ADMIN], total: 1, active: 1, searched: false, branches: [], branches_coverage: { total: 0, answered: 0, complete: true, unreadable: [] } });
  assert.doesNotMatch(old.page.text(), /this is the whole team/);
  await old.page.unmount();
});

// ── the pure model ──────────────────────────────────────────────────────────

test('branchStateText keeps the five states apart', () => {
  assert.equal(branchStateText(NOT_ASKED), 'Ready to search');
  assert.equal(branchStateText(NOT_DEPLOYED), 'Not deployed');
  assert.equal(branchStateText(UNREADABLE), 'Could not be read');
  assert.match(branchStateText(OK), /^0 matched · as of 2026-11-08 10:00:00$/);
  assert.equal(branchStateText({ status: 'mystery' }), 'State not recorded');
});

test('wholeTeamEstablished and registryUnreadable read the Worker\'s two facts, and nothing is inferred from a missing field', () => {
  assert.equal(wholeTeamEstablished({ registry_available: true, no_branches: true }), true);
  assert.equal(wholeTeamEstablished({ registry_available: false, no_branches: true }), false);
  assert.equal(wholeTeamEstablished({ registry_available: true, no_branches: false }), false);
  assert.equal(wholeTeamEstablished({ branches: [] }), false);
  assert.equal(wholeTeamEstablished(null), false);
  assert.equal(registryUnreadable({ registry_available: false }), true);
  assert.equal(registryUnreadable({}), false);
});

test('branchCoverageLine: idle, searched, with failures and not-deployed rows, and registry unreadable', () => {
  const c = (o) => ({ total: 3, asked: 0, answered: 0, complete: false, unreadable: [], not_deployed: [], not_asked: [], ...o });
  assert.equal(branchCoverageLine(null), null);
  assert.equal(branchCoverageLine({ registry_available: false }), 'Deployment registry: unreadable, so the set of branches is not established');
  assert.equal(branchCoverageLine({ registry_available: true, no_branches: true }), 'No branch is provisioned, so every administrator is HQ-held');
  assert.equal(branchCoverageLine({ searched: false, branches_coverage: c({ not_asked: ['fr', 'it'], not_deployed: ['de'] }) }), '2 branches ready to search; none asked yet; 1 not deployed');
  assert.equal(branchCoverageLine({ searched: true, branches_coverage: c({ asked: 2, answered: 1, unreadable: ['it'], not_deployed: ['de'] }) }), 'Of 2 branches asked, 1 answered; 1 could not be read; 1 not deployed');
  assert.equal(branchCoverageLine({ searched: true, branches_coverage: c({ asked: 1, answered: 1 }) }), 'Of 1 branch asked, 1 answered');
});
