/**
 * The two RPC entrypoints, checked against who actually calls them (D207).
 *
 * WHY THIS IS STRUCTURAL AND NOT A PINNED STRING. A branch's `HQ` binding
 * named `HqEntrypoint` — the class a BRANCH exports for HQ to call, which has
 * no `escalate` — and `branchConfig.test.mjs` pinned that wrong value, because
 * it pinned what the generator wrote rather than what the far side exports.
 * A pinned literal is how the defect survived, so this file pins nothing it
 * can derive: it reads `cloudflare-worker/src/rpc/index.ts` as text, takes
 * each entrypoint class's one-line doc (which says who calls it) and its
 * declared methods, harvests every call that crosses the tier boundary from
 * the worker source, and asserts:
 *
 *   1. the branch config's `HQ` binding names the class documented as "called
 *      by a branch over its `HQ` binding", and that class declares every
 *      method a branch calls through `HQ`;
 *   2. the link PR's `BRANCH_<CODE>` binding names the class documented as
 *      "called by HQ over `BRANCH_<CODE>`", and that class declares every
 *      method HQ calls on a branch;
 *   3. the harvest cannot pass empty: each call shape must still find the
 *      sites that exist today, named below, so a regex that stops matching
 *      fails here instead of reporting "every call is declared" over nothing;
 *   4. after a link PR adds HQ's line to a branch, every branch config still
 *      binds HQ and only HQ, and the guard in `check-branch-config.mjs` still
 *      passes — the half that keeps CI green on the first real provisioning.
 *
 * It asserts that each class DECLARES everything called through it, never that
 * everything declared is CALLED: a declared method with no caller is a separate
 * finding, not a wiring defect, and services/topology.ts is where that is
 * stated. The floor is named rather than counted because it moves: `licence`
 * joined it in D244, when a branch with no licence copy started pulling one,
 * and `reportUsage` in D266, when a branch started reporting its quarter.
 *
 * Run with:
 *   node --test scripts/lib/rpcEntrypoints.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  BRANCH_CALLS_HQ, HQ_CALLS_BRANCH, renderBranchConfig, checkRendered, parseToml, validateBranch, hqIds,
} from './branchConfig.mjs';
import { addServiceBinding } from '../open-branch-link-pr.mjs';
import {
  ENTRYPOINT_ROLE, entrypointClasses, classesForRole, workerSources,
  hqToBranchCalls as harvestHqToBranch, branchToHqCalls as harvestBranchToHq,
} from './rpcSurface.mjs';

const ROOT = process.cwd();
const SRC = resolve(ROOT, 'cloudflare-worker/src');
const RPC = readFileSync(join(SRC, 'rpc/index.ts'), 'utf8');
const TOML = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
const EXAMPLE = JSON.parse(readFileSync(resolve(ROOT, 'infra/branches/_example.json'), 'utf8'));

const entryFor = (code, name) => ({
  ...structuredClone(EXAMPLE), code, hostname: `${code}.axal.vc`, name, status: 'provisioning',
});

// ── the classes and the calls, read off the source by rpcSurface.mjs ───────
//
// The harvest lives in `rpcSurface.mjs` since D209, which reads the same facts
// for HQ's topology page. The assertions below are unchanged; only where the
// harvest is defined moved, so the two readers cannot come to disagree about
// what was harvested.

/** Who calls each class, in the words its own doc line uses. */
const ROLE = ENTRYPOINT_ROLE;

function classFor(role) {
  const found = classesForRole(RPC, role);
  assert.equal(found.length, 1, `exactly one entrypoint class must be documented as "${ROLE[role]}"`);
  return found[0];
}

const FILES = workerSources(SRC);
const hqToBranchCalls = () => harvestHqToBranch(FILES);
const branchToHqCalls = () => harvestBranchToHq(FILES);

// ── the sites that exist today — the floor under every harvest ────────────
//
// Each is one call this file must still find. A harvest that stops matching a
// shape (a generic it no longer skips, a method written on the next line, a
// `c.env` where it expected `env`, a binding read through an alias) loses a
// site here and fails, rather than passing over fewer calls than exist.

const HQ_TO_BRANCH_FLOOR = [
  ['fanOut', 'services/branchBenchmarks.ts', 'overview'],
  ['fanOut', 'services/branchBenchmarks.ts', 'applyBenchmarks'],
  ['fanOut', 'routes/admin_hq.ts', 'overview'],
  ['fanOut', 'routes/admin_hq.ts', 'searchAccounts'],
  // The method on the line after the generic.
  ['fanOut', 'routes/admin_deployments.ts', 'health'],
  // The method on the next line, and `c.env` rather than `env`.
  ['fanOut', 'routes/admin_contracts.ts', 'publishTemplate'],
  ['branchRead', 'routes/admin_hq.ts', 'overview'],
  // The method on the line after `branchRead<BranchAccountSearch>(`.
  ['branchRead', 'routes/admin_hq.ts', 'searchAccounts'],
  ['stub', 'services/licencePush.ts', 'applyLicence'],
  ['stub', 'routes/admin_support_sessions.ts', 'openSupportSession'],
  ['stub', 'routes/admin_support_sessions.ts', 'moveAccountOut'],
  ['stub', 'routes/admin_support_sessions.ts', 'inviteAccount'],
  ['stub', 'routes/admin_statements.ts', 'applyPromoCeiling'],
  ['stub', 'routes/admin_escalations.ts', 'applyEscalationAnswer'],
];

const BRANCH_TO_HQ_FLOOR = [
  ['alias', 'routes/branch_escalations.ts', 'escalate'],
  ['alias', 'routes/licence.ts', 'licence'],
  ['alias', 'services/usageReport.ts', 'reportUsage'],
];

const assertFloor = (calls, floor) => {
  for (const [shape, file, method] of floor) {
    assert.ok(
      calls.some((c) => c.shape === shape && c.file === file && c.method === method),
      `the ${shape} harvest no longer finds ${file} calling ${method}() — teach the harvest the shape it missed; `
      + 'a harvest that finds nothing proves nothing',
    );
  }
};

// ── the assertions ─────────────────────────────────────────────────────────

test('each entrypoint class says who calls it, and the two roles are two classes', () => {
  const classes = entrypointClasses(RPC);
  assert.equal(classes.length, 2, 'rpc/index.ts declares two entrypoint classes, each with a one-line doc above it');
  const branchSide = classFor('branchCallsHq');
  const hqSide = classFor('hqCallsBranch');
  assert.notEqual(branchSide.name, hqSide.name);
  // The generator's constants are the same two names, by role — so a swapped
  // doc line and a swapped constant both fail here.
  assert.equal(BRANCH_CALLS_HQ, branchSide.name, 'BRANCH_CALLS_HQ must be the class a branch calls over HQ');
  assert.equal(HQ_CALLS_BRANCH, hqSide.name, 'HQ_CALLS_BRANCH must be the class HQ calls over BRANCH_<CODE>');
});

test('the harvest still finds every call site measured today', () => {
  const { calls, computed } = hqToBranchCalls();
  assert.deepEqual(computed, [], 'a cross-tier call whose method is computed cannot be checked — name the method');
  assertFloor(calls, HQ_TO_BRANCH_FLOOR);
  assertFloor(branchToHqCalls(), BRANCH_TO_HQ_FLOOR);
});

test('a branch\'s HQ binding names the class that declares every method a branch calls on HQ', () => {
  const cls = classFor('branchCallsHq');
  const services = parseToml(renderBranchConfig(TOML, EXAMPLE)).sections.filter((s) => s.name === 'services');
  assert.equal(services.length, 1);
  assert.equal(services[0].kv.get('binding'), '"HQ"');
  assert.equal(
    services[0].kv.get('entrypoint'), JSON.stringify(cls.name),
    `a branch calls HQ over its HQ binding, which must name ${cls.name} — the class HQ exports for branches`,
  );
  const calls = branchToHqCalls();
  assert.ok(calls.length >= BRANCH_TO_HQ_FLOOR.length);
  for (const c of calls) {
    assert.ok(
      cls.methods.has(c.method),
      `${c.file}:${c.line} calls HQ.${c.method}(), which ${cls.name} does not declare — `
      + 'an RPC stub answers any name, so this throws on HQ and the branch records the item as undelivered',
    );
  }
});

test('HQ\'s line to a branch names the class that declares every method HQ calls on a branch', () => {
  const cls = classFor('hqCallsBranch');
  const linked = addServiceBinding(TOML, 'fr');
  const lines = parseToml(linked).sections.filter((s) => s.name === 'env.production.services' || s.name === 'services');
  assert.equal(lines.length, 2, 'the link PR writes one block into each table of wrangler.toml');
  for (const s of lines) {
    assert.equal(s.kv.get('binding'), '"BRANCH_FR"');
    assert.equal(s.kv.get('entrypoint'), JSON.stringify(cls.name), `HQ calls a branch over BRANCH_<CODE>, which must name ${cls.name}`);
  }
  const { calls } = hqToBranchCalls();
  assert.ok(calls.length >= HQ_TO_BRANCH_FLOOR.length);
  for (const c of calls) {
    assert.ok(
      cls.methods.has(c.method),
      `${c.file}:${c.line} calls ${c.method}() on a branch (${c.shape}), which ${cls.name} does not declare`,
    );
  }
});

test('after the link PRs, every branch still binds HQ and only HQ, and the guard still passes', () => {
  // The first branch's link PR puts `[[env.production.services]] BRANCH_FR`
  // into wrangler.toml, and the second puts BRANCH_DACH beside it. A renderer
  // that copied HQ's services table would hand every branch those lines —
  // `fr` a line to itself, `dach` a line to `fr` — and the guard, counting
  // services blocks, would go red on the very PR that linked the branch.
  const linked = addServiceBinding(addServiceBinding(TOML, 'fr'), 'dach');
  const hqLines = parseToml(linked).sections
    .filter((s) => s.name === 'env.production.services')
    .map((s) => s.kv.get('binding'));
  assert.deepEqual(hqLines, ['"BRANCH_FR"', '"BRANCH_DACH"'], 'the fixture must carry the lines a real link PR writes, or this test proves nothing');

  const ids = hqIds(linked);
  for (const e of [EXAMPLE, entryFor('fr', 'Axal VC France'), entryFor('dach', 'Axal VC DACH')]) {
    assert.deepEqual(validateBranch(e, ids), []);
    const rendered = renderBranchConfig(linked, e);
    const sections = parseToml(rendered).sections;
    const services = sections.filter((s) => s.name === 'services');
    assert.equal(services.length, 1, `${e.code}: a branch has one service binding, to HQ`);
    assert.equal(services[0].kv.get('binding'), '"HQ"');
    assert.equal(services[0].kv.get('service'), '"studioos"');
    assert.equal(services[0].kv.get('entrypoint'), JSON.stringify(BRANCH_CALLS_HQ));
    const toBranches = sections.filter((s) => /^"BRANCH_/.test(s.kv.get('binding') || ''));
    assert.deepEqual(toBranches.map((s) => s.kv.get('binding')), [], `${e.code}: no binding to any branch, itself included`);
    assert.deepEqual(checkRendered(linked, e, rendered), [], `${e.code}: the guard must pass on the config a linked HQ renders`);
  }
});
