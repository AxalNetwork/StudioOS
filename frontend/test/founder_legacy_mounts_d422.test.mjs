/**
 * D422 — what retired from the founder legacy mounts, and what could not.
 *
 * THE RULE (D304): an old page retires only when a canvas-built page does the
 * same job — every job, deep link and query string — and then it becomes a
 * `<Navigate replace>`, never a 404.
 *
 * WHAT RETIRED. Three founder mounts were a SECOND ADDRESS for a desk: bare
 * `/execution`, `/build/discovery` and `/signals` rendered, for a founder, the
 * same element `/build`, `/validate` and `/research` mount. They redirect, and
 * keep the query string, so `?new=1`, `?project_id=` and `?mode=landing` land
 * where they did.
 *
 * WHAT COULD NOT, MEASURED. The editors behind those mounts are still the only
 * place a founder can make certain writes. The gap map's table retired them
 * wholesale; the code says otherwise, so they stay, and this file holds the
 * reason as a property rather than a sentence: while a write in the table
 * below has no caller in a founder zone, its editor must stay mounted. The day
 * a zone gains every write, this file stops requiring the editor — it never
 * requires the editor to be deleted, because that is a decision, not a fact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = process.cwd();
const raw = (p) => readFileSync(resolve(root, p), 'utf8');
const app = codeOnly(raw('frontend/src/App.jsx'));

/** Every founder canvas zone and desk, by directory — the pages that would be the successor. */
const ZONE_DIRS = ['frontend/src/pages/founder', 'frontend/src/workspaces/founder'];
const zoneSource = ZONE_DIRS.flatMap((dir) => readdirSync(resolve(root, dir))
  .filter((f) => /\.(jsx|js)$/.test(f))
  .map((f) => codeOnly(raw(join(dir, f))))).join('\n');

/** The route block for one path, bounded by the next <Route. */
function routeBlock(path) {
  const start = app.indexOf(`<Route path="${path}"`);
  if (start < 0) return '';
  const next = app.indexOf('<Route path=', start + 10);
  return app.slice(start, next < 0 ? undefined : next);
}

test('the three second addresses redirect to their desk, query string kept', () => {
  for (const [path, desk] of [['/execution', '/build'], ['/build/discovery', '/validate'], ['/signals', '/research']]) {
    const block = routeBlock(path);
    assert.ok(block, `${path} is no longer routed — a retired route must redirect, never 404`);
    assert.ok(block.includes(`<Navigate to={\`${desk}\${location.search}\`} replace />`),
      `${path} does not redirect a founder to ${desk} with the query kept`);
    assert.ok(routeBlock(desk), `${path} redirects to ${desk}, which has no route`);
  }
  // THE DESK HAS ONE ADDRESS: none of the three still mounts it.
  for (const [path, element] of [['/execution', '<FounderBuildDesk />'], ['/build/discovery', '<FounderValidatePage />'], ['/signals', '<FounderResearchDesk />']]) {
    assert.ok(!routeBlock(path).includes(element), `${path} mounts ${element} again — a second address for the desk`);
  }
});

/**
 * The writes each editor alone carries for a founder (measured on main, D422).
 * `mount` is the element the route must still render while any write is homeless.
 */
const EDITORS = [
  { route: '/execution', mount: '<ExecutionPage />', writes: ['pipelineCreateTask', 'pipelineUpdateTask', 'pipelineAdvance', 'pipelineDecide', 'castVote', 'pipelineTriggerReview', 'pipelineSnapshot', 'createOkr', 'updateOkr', 'deleteOkr'] },
  { route: '/build/discovery', mount: '<DiscoveryPage initialTab="interviews" workspaceMode />', writes: ['updateInterview', 'deleteInterview', 'assignPain', 'renamePainGroup', 'deletePainGroup'] },
  { route: '/signals', mount: '<SignalsPage user={user} />', writes: ['signals.list', 'signals.refresh'] },
  { route: '/network', mount: '<NetworkPage />', writes: ['contactCreate', 'contactUpdate', 'contactAddTask', 'contactPromote', 'introAccept', 'introDecline', 'introSetTerms', 'partnerBookAdd', 'partnerBookLogInteraction'] },
];

test('an editor stays mounted while a founder zone lacks any of its writes', () => {
  for (const { route, mount, writes } of EDITORS) {
    const homeless = writes.filter((w) => !zoneSource.includes(`api.${w}(`));
    if (!homeless.length) continue; // a successor now carries every write — retirement is open
    assert.ok(routeBlock(route).includes(mount),
      `${route} no longer mounts ${mount}, but no founder zone calls ${homeless.map((w) => `api.${w}`).join(', ')} — `
      + 'those writes would have no home');
  }
});

test('the editors keep their deep links: ?mode=workspace, Discovery ?tab=, Signals queries', () => {
  assert.match(app, /const founderExecutionEditor = effectiveRole === 'founder'\s*&& new URLSearchParams\(location\.search\)\.get\('mode'\) === 'workspace';/);
  assert.match(app, /const founderDiscoveryEditor = effectiveRole === 'founder'\s*&& \(new URLSearchParams\(location\.search\)\.get\('mode'\) === 'workspace'\s*\|\| \['leads', 'interviews', 'insights'\]\.includes\(new URLSearchParams\(location\.search\)\.get\('tab'\)\)\);/);
  // Signals: any query beyond project_id, or ?mode=workspace, keeps the feed.
  assert.match(app, /const founderResearchLanding = effectiveRole === 'founder'\s*&& \(signalsMode === 'landing' \|\| \(!signalsHasNonProjectQuery && signalsMode !== 'workspace'\)\);/);
  // AND THE PATHS THAT STILL LINK TO THEM GO TO THE EDITOR, not the redirect:
  // the Validate interviews zone sends ICP-fit edits to `?tab=interviews`, and
  // the Roadmap zone sends objective edits to `/execution/roadmap`.
  assert.match(zoneSource, /to="\/build\/discovery\?tab=interviews"/);
  assert.match(routeBlock('/execution/roadmap'), /<ExecutionPage \/>/);
});

test('no founder desk embeds a legacy editor', () => {
  for (const file of ['FounderBuildDesk', 'FounderValidatePage', 'FounderResearchDesk', 'FounderNetworkDesk']) {
    const src = codeOnly(raw(`frontend/src/pages/founder/${file}.jsx`));
    for (const editor of ['ExecutionPage', 'DiscoveryPage', 'SignalsPage', 'NetworkPage']) {
      assert.ok(!new RegExp(`\\b${editor}\\b`).test(src), `${file} embeds ${editor}`);
    }
  }
});

test('the Build zones crumb back to /build, not the retired address', () => {
  for (const file of ['FounderBuildBoard', 'FounderBuildCadence', 'FounderBuildKpi', 'FounderBuildRoadmap', 'FounderBuildThisWeek']) {
    const src = codeOnly(raw(`frontend/src/pages/founder/${file}.jsx`));
    assert.ok(!/to=["{`]*\/execution["`?$]/.test(src.replace(/\/execution\/roadmap/g, '')),
      `${file} links the retired /execution address`);
    assert.match(src, /> Build<\/Link>|>Back to Build<\/Link>/, `${file} lost its way back to the Build desk`);
  }
});
