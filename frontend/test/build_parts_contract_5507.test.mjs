/**
 * #5507 — THE contract for Build's connector parts (D5507). This file is the
 * only place that states every Build module's complete, ordered list of
 * connector parts. Provider suites assert only their own key (placement
 * relative to the neighbours their canvas names, and what the part mounts),
 * through `_buildParts.mjs`.
 *
 * What is contractual, and why (D1311, D1314, D1606, the owner's canvases):
 *   - membership: which connectors feed which Build module;
 *   - order: the order the canvases draw them (VC3 "the Deploys strip sits
 *     above GitHub's Releases strip"; D1606 "after its other connectors");
 *   - visibility: every listed part is built (draws), and `buildPartsMap`
 *     renders exactly these parts, in this order, each in its own boundary.
 *   - access is NOT part of this catalogue: no part is role-gated here; who
 *     reaches a Build module is CycleRoute's, not buildParts.jsx's.
 *
 * The expected lists below are written by hand. They are never derived from
 * `BUILD_PARTS`, so a registry and renderer that agree on the same mistake
 * still fail here.
 *
 * WHO UPDATES IT: the task that adds, removes or moves a connector part edits
 * CONTRACT below in the same PR, deliberately, once. No other suite changes.
 *
 * Replay (2026-11-15, mutation run on buildParts.jsx, every Build-provider
 * suite run after each; also kept as the `replay:` tests below):
 *   - add an unrelated provider ('acme' on founding-team): only this file
 *     failed; adding 'acme' to CONTRACT, the one deliberate edit, made every
 *     suite green again (the first run caught these replay tests naming
 *     real keys, so they are now generic over CONTRACT).
 *   - remove a required provider (google from solution-design): this file and
 *     google_workspace_build_gw3_d1093 failed; no other suite.
 *   - change contractual order (github before vercel on product-roadmap):
 *     this file and vercel_hosting_d1097 (VC3's placement) failed.
 *   - break one provider's behaviour (posthog's roadmap line mounts
 *     PrototypePosthog): only build_posthog_d1606 failed; the contract,
 *     which owns membership and order, rightly did not.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_parts_contract_5507.test.mjs
 *
 * From frontend/test/README.md (moved by #6472): D5507: THE contract for Build's connector parts:
 * every module's complete, ordered list, written by hand; provider suites assert only their own
 * key. Update it, once, when a part is added, removed or moved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_PARTS, buildPartsMap } from '../src/pages/cycles/buildParts.jsx';

/** Every Build module's connector parts, in the order the canvases draw them. */
const CONTRACT = Object.freeze({
  // VC4a Runs on under From GitHub; GW3 From Google, then NT3 From Notion (D1314).
  'solution-design': ['github', 'vercel', 'google', 'notion'],
  // VC2 Live strip between From GitHub and LV7 From Lovable; NT3; PH5 last (D1606).
  'prototype-mvp': ['github', 'vercel', 'lovable', 'notion', 'posthog'],
  // VC3 Deploys above GitHub's Releases; GW3/GW4; NT3; PostHog last (D1606).
  'product-roadmap': ['vercel', 'github', 'google', 'notion', 'posthog'],
  // D686 Tools history; VC1 Hosting; PostHog as one Tools line (D1606 decision D (a)).
  'operating-systems': ['tools', 'vercel', 'posthog'],
  // D782: who builds and where the code sits.
  'founding-team': ['github'],
  // D782; VC4b/VC4d Where production runs (D1099).
  'company-creation': ['github', 'vercel'],
});

/**
 * Every way `registry` (BUILD_PARTS's shape) and `renderMap` (buildPartsMap's)
 * differ from `contract`. Empty means they keep it.
 */
function contractBreaks(contract, registry, renderMap) {
  const out = [];
  const want = Object.keys(contract).sort();
  const have = Object.keys(registry).sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) out.push(`modules: ${have.join(',')} is not ${want.join(',')}`);
  for (const slug of want) {
    const listed = (registry[slug] || []).map(([key]) => key);
    if (JSON.stringify(listed) !== JSON.stringify(contract[slug])) out.push(`${slug}: lists ${listed.join(',')}, contract ${contract[slug].join(',')}`);
    const unbuilt = (registry[slug] || []).filter(([, render]) => typeof render !== 'function').map(([key]) => key);
    if (unbuilt.length) out.push(`${slug}: ${unbuilt.join(',')} not built`);
    const fragment = renderMap[slug]?.({}, { projectId: 7, reload() {} });
    const kids = [fragment?.props?.children].flat(2).filter(Boolean);
    const drawn = kids.map((k) => k.props?.name);
    const expected = contract[slug].map((key) => `${slug}-${key}`);
    if (JSON.stringify(drawn) !== JSON.stringify(expected)) out.push(`${slug}: draws ${drawn.join(',')}, contract ${expected.join(',')}`);
  }
  return out;
}

test('Build\'s registry and renderer keep the hand-written contract: modules, order, every part drawn', () => {
  assert.deepEqual(contractBreaks(CONTRACT, BUILD_PARTS, buildPartsMap()), []);
});

// ---------------------------------------------------------------- replay, kept
// The same mutations as the header's run, on copies of the registry, so the
// checker cannot quietly stop seeing them.

const copy = () => Object.fromEntries(Object.entries(BUILD_PARTS).map(([slug, parts]) => [slug, parts.map((p) => [...p])]));
const mapOf = (registry) => Object.fromEntries(Object.keys(registry).map((slug) => [slug, () => ({ props: { children: registry[slug]
  .filter(([, r]) => typeof r === 'function').map(([key]) => ({ props: { name: `${slug}-${key}` } })) } })]));

// Generic over CONTRACT, so a legitimate catalogue change never edits these.
const anyModule = Object.keys(CONTRACT).find((slug) => CONTRACT[slug].length > 1);

test('replay: an unrelated provider fails until the contract names it, and one contract edit settles it', () => {
  const reg = copy(); reg[anyModule].push(['replay_unrelated', () => null]);
  assert.equal(contractBreaks(CONTRACT, reg, mapOf(reg)).length, 2, 'listed and drawn, both outside the contract');
  const updated = { ...CONTRACT, [anyModule]: [...CONTRACT[anyModule], 'replay_unrelated'] };
  assert.deepEqual(contractBreaks(updated, reg, mapOf(reg)), []);
});

test('replay: removing a required provider, reordering, or leaving a part unbuilt each fail', () => {
  const removed = copy(); removed[anyModule].pop();
  assert.ok(contractBreaks(CONTRACT, removed, mapOf(removed)).some((m) => m.startsWith(`${anyModule}: lists`)));
  const reordered = copy(); reordered[anyModule].reverse();
  assert.ok(contractBreaks(CONTRACT, reordered, mapOf(reordered)).some((m) => m.startsWith(`${anyModule}: lists`)));
  const unbuilt = copy(); const [key] = unbuilt[anyModule][0]; unbuilt[anyModule][0][1] = null;
  assert.ok(contractBreaks(CONTRACT, unbuilt, mapOf(unbuilt)).some((m) => m === `${anyModule}: ${key} not built`));
  // The registry right but the renderer wrong: still a break.
  const reg = copy(); const map = mapOf(reg); const real = map[anyModule];
  map[anyModule] = () => { const f = real(); f.props.children.reverse(); return f; };
  assert.ok(contractBreaks(CONTRACT, reg, map).some((m) => m.startsWith(`${anyModule}: draws`)));
});
