import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fe = (path) => readFileSync(resolve(here, '..', path), 'utf8');

test('founder execution uses the A3 operating desk rather than the generic founder shell', () => {
  const app = fe('src/App.jsx');
  const desk = fe('src/pages/founder/FounderBuildDesk.jsx');
  const route = app.match(/<Route path="\/execution"[\s\S]*?\/>/)?.[0] || '';

  // D422. `/execution` was a second address for A3 — a founder there got
  // FounderBuildDesk, the element `/build` mounts. It redirects to `/build`
  // with the query kept (`?new=1` and `?project_id=` survive), so A3 has one
  // address; the editor keeps `?mode=workspace`.
  assert.match(route, /effectiveRole === 'founder' && !founderExecutionEditor\s*\? <Navigate to=\{`\/build\$\{location\.search\}`\} replace \/>/,
    'founder /execution no longer lands on A3 at /build');
  assert.ok(!route.includes('<FounderBuildDesk />'), '/execution is a second address for A3 again');
  assert.match(app, /const founderExecutionEditor = effectiveRole === 'founder'\s*&& new URLSearchParams\(location\.search\)\.get\('mode'\) === 'workspace';/);
  assert.match(app, /<Route path="\/build" element=\{founderBuildLanding\s*\? guard\(\[[^\]]*\], <FounderBuildDesk \/>\)/);
  assert.match(desk, /Operate the company this week/);
  assert.match(desk, /api\.listProjects\(\)/);
  assert.match(desk, /api\.pipelineActive\(\)/);
  assert.match(desk, /api\.listOkrs\(projectId\)/);
  assert.match(desk, /api\.listMetricsSnapshots\(projectId\)/);
  assert.match(desk, /Number\(deal\.id\) === Number\(projectId\)/,
    'execution task counts must be scoped to the selected startup');
  assert.match(desk, /selectedDeal\?\.task_counts/,
    'the execution board must use stored per-startup task counts');

  // WAS `assert.match(desk, /\['now', 'next', 'later'\]/)`. The three horizons
  // are still all rendered and none may be dropped — that part of the rule was
  // right — but they are now a table (`HORIZONS`) because A3 also draws a pill
  // per horizon and the literal had nowhere to carry one. Assert the horizons,
  // not the shape of the literal that lists them.
  const horizons = codeOnly(desk).match(/const HORIZONS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.deepEqual(
    [...horizons.matchAll(/\['(\w+)', '([^']+)'\]/g)].map((m) => m[1]),
    ['now', 'next', 'later'],
    'the roadmap must preserve every backed planning horizon',
  );

  // WAS `assert.match(desk, /mode=workspace/, 'the detailed execution editor
  // must remain explicitly reachable')`, AND IT HAD STOPPED TESTING THAT.
  // `?mode=workspace` is read by `App.jsx` and swaps the element for the shared
  // `FounderWorkspaceTabs`, so a desk link that spelled it never reached the
  // page in the string — it was removed from all four desks in #488, and this
  // line went on passing only because a `//` comment in the desk mentions the
  // parameter (this file reads raw source, not `codeOnly`). The reachability it
  // meant to protect is the desk's own handoff, which is what is asserted now:
  // `/execution?mode=workspace` still renders the detailed editor, and no link
  // ON the desk spells the parameter.
  assert.doesNotMatch(codeOnly(desk), /mode=workspace["'`]/,
    'a Build card is routing through the shared workspace instead of to its own page');
  // THE EDITOR LEFT THE DESK (D422): `/execution?mode=workspace` mounts
  // ExecutionPage at the route, so the desk renders one thing.
  assert.ok(!/ExecutionPage/.test(codeOnly(desk)), 'A3 embeds the execution editor again');
  const fullRoute = app.slice(app.indexOf('<Route path="/execution"'), app.indexOf('<Route path="/build/this-week"'));
  assert.match(fullRoute, /: founderWorkspace\('build', <FounderWorkspaceTabs set="build" user=\{user\}><ExecutionPage \/><\/FounderWorkspaceTabs>\)/,
    'the execution editor is no longer reachable at /execution?mode=workspace');

  assert.doesNotMatch(desk, /Async digest|pending trials|pricing page|Amara|Guillaume|Slack integration|permissions model|\$4,200|14 paid trials|\$21,412|18 mo|Llama|QwQ|Granite/i);
});
