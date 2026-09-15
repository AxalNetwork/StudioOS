/**
 * `/build/roadmap` reads fields its route actually returns.
 *
 * THE BUG THIS EXISTS TO STOP, which shipped and survived every guard in this
 * directory. `FounderBuildRoadmap.jsx` filtered its `Dependencies` view on
 *
 *     item.dependency || item.dependencies || item.blocks
 *
 * and `roadmap_okrs` has none of those columns, while `progress.ts`'s
 * `OKR_SELECT` returns none of them either. The chip was LIVE: it drew, it
 * selected, and it emptied the table under the caption "items naming a
 * dependency" — which a founder reads as "this venture has none", not as
 * "nothing here can have one".
 *
 * No guard could see it. The zone-filter and zone-action suites count REFUSALS —
 * an `unbuilt` entry has to justify itself — and this was not a refusal. It was a
 * working control over a store that did not exist, which is the failure mode
 * `zoneFilterBuilder.js` opens its docblock with and the one thing those counts
 * cannot catch. Same class as #93 ("ships a filter over a field the API never
 * returns").
 *
 * So this ties the page to the route by NAME: every field the page reads off a
 * roadmap item must be one the handler puts there. It is narrow — one zone, one
 * shape — and narrow is what makes it checkable.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/roadmap_zone_contract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/founder/FounderBuildRoadmap.jsx'));
const DIALOGS = codeOnly(read('frontend/src/pages/founder/RoadmapDialogs.jsx'));
const ROUTE = read('cloudflare-worker/src/routes/founder_roadmap.ts');
const FILTERS = read('frontend/src/workspaces/founderZoneFilters.js');
const API = read('frontend/src/lib/api.js');

/** The keys the route's item mapper actually writes. */
function itemKeys() {
  const at = ROUTE.indexOf('const items = okrs.map(');
  assert.ok(at > 0, 'the route no longer maps items — this guard is measuring nothing');
  const body = ROUTE.slice(at, ROUTE.indexOf('\n  });', at));
  // BOTH SPELLINGS: `state_label: …` and the shorthand `state,`. The first
  // version of this reader wanted a colon and reported that the route had
  // "stopped returning `state`" when the route returns it by shorthand — a guard
  // failing on a language feature rather than on the contract.
  return new Set([...body.matchAll(/^\s{6}([a-z_]+)(?::|,$)/gm)].map((m) => m[1]));
}

test('the item shape the page reads is the item shape the route returns', () => {
  const keys = itemKeys();
  // Sanity: the reader must find a real shape, or every assertion below passes
  // over an empty set.
  for (const expected of ['id', 'objective', 'quarter', 'state', 'state_label', 'blocks', 'blocked_by']) {
    assert.ok(keys.has(expected), `the route stopped returning \`${expected}\``);
  }
  // Every `item.<name>` / `i.<name>` the page reads must be one of them.
  const source = `${PAGE}\n${DIALOGS}`;
  const read_ = new Set([...source.matchAll(/\b(?:item|i)\.([a-z_]+)\b/g)].map((m) => m[1]));
  const extra = [...read_].filter((k) => !keys.has(k));
  assert.deepEqual(extra, [],
    `the roadmap page reads ${extra.map((k) => `item.${k}`).join(', ')}, which the route never returns — `
    + 'that is exactly how the Dependencies chip came to draw over nothing');
});

test('the three fields the old filter read are gone, and not merely renamed', () => {
  // A ban on the identifiers themselves, because the failure was not a typo: it
  // was three plausible names for a column nobody had written. `codeOnly` keeps
  // the paragraphs that explain their absence from failing this.
  for (const dead of ['item.dependency', 'item.dependencies', 'i.dependency']) {
    assert.ok(!PAGE.includes(dead), `${dead} is back in FounderBuildRoadmap.jsx`);
  }
});

test('every live chip on this zone has a view the page implements', () => {
  // The other half of the same bug: a `key` in the registry that the page never
  // branches on renders a chip that changes nothing when clicked.
  const at = FILTERS.indexOf("'build/roadmap'");
  const block = FILTERS.slice(at, FILTERS.indexOf('\n  ],', at));
  const keys = [...block.matchAll(/[{,]\s*key: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ['board', 'dependencies', 'scenarios', 'timeline'],
    'the roadmap chip set changed — check the page branches on each of them');
  for (const key of keys) {
    if (key === 'timeline') continue; // the default branch, named by exclusion
    assert.ok(new RegExp(`view === '${key}'`).test(PAGE),
      `the \`${key}\` chip is live but the page never branches on it, so selecting it changes nothing`);
  }
});

test('the page calls the route it was built against', () => {
  // `check-api-drift` proves the method reaches a mounted worker route; this
  // proves THIS page is the caller, so the contract above is about the shape it
  // actually receives.
  assert.match(PAGE, /api\.roadmapGraph\(/);
  assert.match(API, /roadmapGraph: \(projectId\) => request\(`\/founder\/roadmap\/\$\{projectId\}`\)/);
  for (const method of ['addOkrDependency', 'deleteOkrDependency', 'saveRoadmapScenario', 'deleteRoadmapScenario']) {
    assert.match(API, new RegExp(`\\n  ${method}:`), `api.js no longer declares ${method}`);
    assert.ok(PAGE.includes(`api.${method}(`), `the roadmap page no longer calls ${method}`);
  }
});

test('the page states what risk cannot be, rather than showing a number for it', () => {
  // The artboard asks for an `At risk` stat. `okrGraph.ts` carries the proof that
  // the obvious derivation is always empty, so the card explains itself instead —
  // and this stops a later pass quietly filling it with the blocked count under
  // the artboard's label.
  assert.ok(DIALOGS.includes('RiskUnavailable'), 'the risk card is gone');
  assert.ok(!/label="At risk"/.test(PAGE),
    'an `At risk` stat is back on the roadmap page — it would have to be invented');
  assert.match(PAGE, /label="Blocked"/, 'the honest version of that number is gone too');
});
