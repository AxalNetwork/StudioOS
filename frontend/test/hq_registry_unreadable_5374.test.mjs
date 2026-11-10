/**
 * D5374 (#5374) — HQ Home and HQ Funds never turn "the deployment registry could not be read" into
 * "no branch is deployed" or "every branch answered".
 *
 * D5041 put `registry_available` / `registry_reason` on `/overview` and `/funds`; Team, Platform and
 * Topology drew it. These two pages did not: Home printed "No branch is deployed, so every figure above
 * is HQ's own database" and Funds computed `complete` from `answered === total`, which is true at 0 of 0.
 *
 * Both pages are mounted over a stubbed `api` and read as rendered. Every assertion is also run against
 * the page source with the guard removed (mutationCheck): the unreadable direction and the
 * readable-but-empty direction each have mutations that must fail.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_registry_unreadable_5374.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { mountForm, mutationCheck, textOf } from './_form_d695.mjs';
import { api } from '../src/lib/api.js';
import HqHomePage from '../src/pages/hq/HqHomePage.jsx';
import HqFundsPage, { oversightStats } from '../src/pages/hq/HqFundsPage.jsx';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/pages/hq/${rel}`, import.meta.url), 'utf8');

const REASON = 'HQ could not read its deployment registry, so the set of provisioned branches is not established.';
const NO_BRANCH_HOME = /No branch is deployed, so every figure above is HQ's own database/;
const NO_BRANCH_SEATS = /No branch is deployed yet, so seat utilisation/;
const NO_BRANCH_LICENCE = /No branch is deployed for this licence/;

const LICENCE = {
  uid: 'l-1', brand_name: 'Axal Synthetica', licence_ref: 'AX-001', status: 'active', kind: 'subsidiary',
  territories: ['FR'], seats_licensed: 10, renews_on: '2027-01-01',
};
const EMPTY_COVERAGE = { total: 0, answered: 0, complete: true, unreadable: [] };
const overview = (extra) => ({
  accounts: { total: 3 }, seats_licensed: 10, countries_held: ['FR'], licences: [LICENCE], renewals_soon: [],
  suspended: [], events: [], queue: { available: false, reason: 'x' }, escalations_available: true, escalations: [],
  branches: [], branches_coverage: EMPTY_COVERAGE, registry_available: true, usage_coverage: null,
  ...extra,
});
const UNREADABLE_OVERVIEW = overview({
  branches_coverage: { ...EMPTY_COVERAGE, complete: false }, registry_available: false, registry_reason: REASON,
});

/** Mount a page over a stubbed request, counting the requests so a Retry can be seen to re-ask. */
async function mountPage(Page, method, payload) {
  const calls = [];
  const was = api[method];
  api[method] = async () => { calls.push(1); return payload; };
  const page = await mountForm(h(Page, {}));
  await page.flush();
  return { page, calls, restore: () => { api[method] = was; } };
}
const titles = (page) => page.nodes().map((n) => page.props(n).title).filter(Boolean);
const retryButtons = (page) => page.nodes().filter((n) => n.tagName === 'BUTTON' && /Retry/.test(textOf(n)));

/* ---------------------------------------------------------------- Home */

async function verifyHome(mod) {
  const Home = mod.default;

  // A. Registry unreadable: Unreadable with the reason and a Retry; no "no branch" sentence anywhere.
  {
    const { page, calls, restore } = await mountPage(Home, 'hqOverview', UNREADABLE_OVERVIEW);
    try {
      const block = page.by('hq-home-registry-unreadable');
      assert.ok(block, 'an unreadable registry draws no Unreadable block');
      assert.match(textOf(block), /deployment registry could not be read/);
      assert.ok(textOf(block).includes(REASON), 'the Worker\'s reason is not shown');
      assert.equal(retryButtons(page).length >= 1, true, 'no Retry');
      const text = page.text();
      assert.doesNotMatch(text, NO_BRANCH_HOME, 'an unreadable registry was drawn as "no branch is deployed"');
      assert.doesNotMatch(text, NO_BRANCH_SEATS, 'the seat-utilisation reason claims no branch exists');
      // The licence card has no branch read; it must not say there is no branch for it.
      assert.ok(!titles(page).some((t) => NO_BRANCH_LICENCE.test(t)), 'a licence card says it has no branch');
      assert.ok(titles(page).some((t) => /whether this licence has a branch is not established/.test(t)), 'the card does not say the registry is unreadable');
      // Seat utilisation names the registry, not an empty fleet.
      assert.ok(titles(page).some((t) => /deployment registry could not be read, so which branches exist is not established/.test(t)), 'seat reason');
      // Retry asks again.
      const before = calls.length;
      await page.click('Retry');
      await page.flush();
      assert.equal(calls.length, before + 1, 'Retry did not re-read the overview');
    } finally { restore(); await page.unmount(); }
  }

  // B. A registry that was read and is empty: today's wording stays, and no Unreadable block.
  for (const [name, payload] of [
    ['readable and empty', overview({})],
    ['an older payload with no registry field', (() => { const p = overview({}); delete p.registry_available; return p; })()],
  ]) {
    const { page, restore } = await mountPage(Home, 'hqOverview', payload);
    try {
      assert.ok(!page.by('hq-home-registry-unreadable'), `${name}: drew an Unreadable block`);
      assert.ok(titles(page).some((t) => NO_BRANCH_SEATS.test(t)), `${name}: lost the seat-utilisation reason`);
      assert.ok(titles(page).some((t) => NO_BRANCH_LICENCE.test(t)), `${name}: lost the per-licence reason`);
    } finally { restore(); await page.unmount(); }
  }

  // C. Registry unreadable but one bound branch answered: its seats are a floor, not a total.
  {
    const answered = { code: 'fr', status: 'ok', licence_uid: 'l-1', as_of: '2026-11-10T10:00:00Z', data: { accounts: { total: 2 }, seats_used: 4, backlog: { count: 0 } } };
    const { page, restore } = await mountPage(Home, 'hqOverview', {
      ...UNREADABLE_OVERVIEW, branches: [answered], branches_coverage: { total: 1, answered: 1, complete: false, unreadable: [] },
    });
    try {
      assert.ok(page.by('hq-home-registry-unreadable'));
      assert.ok(page.text().includes('the deployment registry could not be read, so other branches may exist and this is not a complete total'), 'a floor was drawn as a total');
      assert.doesNotMatch(page.text(), /so branch figures here are complete/);
    } finally { restore(); await page.unmount(); }
  }
}

test('HQ Home draws an unreadable registry as Unreadable, and keeps the empty-registry wording for a readable one', async () => {
  const source = read('HqHomePage.jsx');
  await mutationCheck(source, 'pages/hq/HqHomePage.jsx', verifyHome, [
    // The gate itself.
    ['const registryDown = ready && registryUnreadable(data);', 'const registryDown = false;'],
    // Each use, so a surviving one is a test gap.
    ['if (!branches.length && registryDown) {', 'if (false) {'],
    ['    if (registryDown) {\n      return {\n        value: sum,', '    if (false) {\n      return {\n        value: sum,'],
    ['{registryDown && (\n          <div className="mt-4" data-testid="hq-home-registry-unreadable">', '{false && (\n          <div className="mt-4" data-testid="hq-home-registry-unreadable">'],
    ['if (!b && registryDown) return', 'if (false) return'],
    // The other direction: the readable-but-empty page must keep its sentences.
    ['const registryDown = ready && registryUnreadable(data);', 'const registryDown = ready;'],
  ]);
});

/* --------------------------------------------------------------- Funds */

const HQ_FUNDS = { status: 'ok', code: 'hq', as_of: '2026-11-10T10:00:00Z', data: { funds: [], complete: true, periods_available: true, calls_available: true, distributions_available: true, entities_available: true } };
const fundsPayload = (extra) => ({
  read_at: '2026-11-10T10:00:00Z', hq: HQ_FUNDS, branches: [], branches_coverage: EMPTY_COVERAGE, registry_available: true,
  committed_unit: { recorded: false, reason: 'No currency recorded.' }, total: { shown: false, reason: 'No total.' },
  open_in_branch: { built: false, reason: 'Not built.' }, not_recorded: {},
  ...extra,
});
const UNREADABLE_FUNDS = fundsPayload({
  branches_coverage: { ...EMPTY_COVERAGE, complete: false }, registry_available: false, registry_reason: REASON,
});

async function verifyFunds(mod) {
  const Funds = mod.default;
  const stats = mod.oversightStats;

  // Pure: the stats the page draws from.
  {
    const down = stats(UNREADABLE_FUNDS);
    assert.equal(down.complete, false, '0 of 0 over an unreadable registry counted as complete');
    assert.equal(down.registryUnreadable, true);
    assert.doesNotMatch(down.coverage, /of 0 branches, 0 answered/, 'an unreadable registry was drawn as 0 of 0 answered');
    assert.match(down.coverage, /branch list could not be read/);
    // Even a payload whose coverage says complete (it never should) is not complete over an unread registry.
    assert.equal(stats(fundsPayload({ registry_available: false })).complete, false);

    const empty = stats(fundsPayload({}));
    assert.equal(empty.complete, true, 'a readable, empty registry is complete');
    assert.equal(empty.coverage, 'of 0 branches, 0 answered', 'today\'s wording changed');
    assert.equal(empty.registryUnreadable, false);

    // The payload's own `complete` decides: every counted branch answered, yet the Worker says not complete.
    assert.equal(stats(fundsPayload({ branches_coverage: { total: 2, answered: 2, complete: false, unreadable: [] } })).complete, false,
      'the payload\'s branches_coverage.complete was ignored');
    assert.equal(stats(fundsPayload({ branches_coverage: { total: 2, answered: 1, complete: true, unreadable: [] } })).complete, true);
    // A payload from before the field existed falls back to counting, and makes no registry claim.
    assert.equal(stats({ ...fundsPayload({}), branches_coverage: { total: 2, answered: 2 } }).complete, true);
    const old = fundsPayload({ branches_coverage: { total: 1, answered: 1 } });
    delete old.registry_available;
    assert.equal(stats(old).registryUnreadable, false);
  }

  // Rendered: unreadable.
  {
    const { page, calls, restore } = await mountPage(Funds, 'hqFunds', UNREADABLE_FUNDS);
    try {
      const block = page.by('hq-funds-registry-unreadable');
      assert.ok(block, 'an unreadable registry draws no Unreadable block');
      assert.ok(textOf(block).includes(REASON));
      assert.match(textOf(block), /branch list could not be read/);
      assert.doesNotMatch(page.text(), /of 0 branches, 0 answered/, 'a complete coverage was drawn');
      assert.match(page.by('hq-funds-band').textContent || textOf(page.by('hq-funds-band')), /branch list could not be read/);
      const before = calls.length;
      await page.click('Retry');
      await page.flush();
      assert.equal(calls.length, before + 1, 'Retry did not re-read the funds');
    } finally { restore(); await page.unmount(); }
  }

  // Rendered: readable and empty keeps today's wording.
  {
    const { page, restore } = await mountPage(Funds, 'hqFunds', fundsPayload({}));
    try {
      assert.ok(!page.by('hq-funds-registry-unreadable'), 'drew an Unreadable block over a readable registry');
      assert.match(textOf(page.by('hq-funds-band')), /of 0 branches, 0 answered/);
    } finally { restore(); await page.unmount(); }
  }
}

test('HQ Funds never counts an unreadable registry as 0 of 0 answered, and keeps the readable wording', async () => {
  assert.equal(typeof oversightStats, 'function');
  const source = read('HqFundsPage.jsx');
  await mutationCheck(source, 'pages/hq/HqFundsPage.jsx', verifyFunds, [
    ['const registryDown = registryUnreadable(payload);', 'const registryDown = false;'],
    ['complete: payload.hq?.status === \'ok\' && !registryDown && coverageComplete', 'complete: payload.hq?.status === \'ok\' && coverageComplete'],
    ['typeof cov.complete === \'boolean\' ? cov.complete : cov.answered === cov.total', 'cov.answered === cov.total'],
    ['coverage: registryDown\n      ? \'the branch list could not be read\'', 'coverage: false\n      ? \'the branch list could not be read\''],
    ['{ready && stats.registryUnreadable && (', '{false && ('],
    // The other direction.
    ['const registryDown = registryUnreadable(payload);', 'const registryDown = true;'],
    ['{ready && stats.registryUnreadable && (', '{ready && ('],
  ]);
});

test('the rail sentence HQ Home hands WorkerRail leads with the unreadable registry, before any count', () => {
  // `coverage` is a retired WorkerRail prop (RETIRED_RAIL_PROPS) and draws nowhere, so the sentence is
  // read from the source: the registry check must come before the "no branch" and the "complete" branches.
  const body = /const branchLine = \(\(\) => \{([\s\S]*?)\n  \}\)\(\);/.exec(read('HqHomePage.jsx'))?.[1] || '';
  assert.ok(body, 'branchLine not found');
  const at = (re) => body.search(re);
  assert.ok(at(/registryDown/) >= 0 && at(/registryDown/) < at(/No branch is deployed/), 'the registry check does not come first');
  assert.ok(at(/registryDown/) < at(/branch figures here are complete/));
  assert.match(body, /Deployment registry: unreadable/);
  // The readable-and-empty sentence stays, for a registry that was read.
  assert.match(body, /No branch is deployed, so every figure above is HQ\\'s own database/);
});
