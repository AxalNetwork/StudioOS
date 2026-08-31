import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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
  assert.match(desk, /\['now', 'next', 'later'\]/,
    'the roadmap must preserve every backed planning horizon');
  assert.match(desk, /mode=workspace/, 'the detailed execution editor must remain explicitly reachable');
  assert.doesNotMatch(desk, /Async digest|pending trials|pricing page|Amara|Guillaume|Slack integration|permissions model|\$4,200|14 paid trials|\$21,412|18 mo|Llama|QwQ|Granite/i);
});