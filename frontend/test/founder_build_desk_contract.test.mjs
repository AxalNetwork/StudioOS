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

  assert.match(route, /effectiveRole === 'founder' \? <FounderBuildDesk \/>/, 'founder /execution no longer selects A3');
  assert.doesNotMatch(route, /FounderWorkspaceTabs/, 'A3 must not render duplicate Founder workspace tabs');
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
  assert.match(desk, /const workspace = searchParams\.get\('mode'\) === 'workspace';/,
    'A3 no longer reads ?mode=workspace at all');
  assert.match(desk, /if \(workspace\) return <ExecutionPage \/>;/,
    'A3 no longer hands ?mode=workspace to the detailed execution editor');

  assert.doesNotMatch(desk, /Async digest|pending trials|pricing page|Amara|Guillaume|Slack integration|permissions model|\$4,200|14 paid trials|\$21,412|18 mo|Llama|QwQ|Granite/i);
});
