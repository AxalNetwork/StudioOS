import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (path) => codeOnly(readFileSync(resolve(process.cwd(), path), 'utf8'));
const page = read('frontend/src/pages/founder/FounderGrowDesk.jsx');
const app = read('frontend/src/App.jsx');

test('A5 Grow is founder-owned and workspace mode preserves Talent', () => {
  assert.match(app, /const founderGrowLanding = effectiveRole === 'founder'[\s\S]*?get\('mode'\) !== 'workspace'/);
  const route = app.split('\n').find((line) => line.includes('path="/build/team"'));
  assert.match(route, /founderGrowLanding \? <FounderGrowDesk \/>/);
  assert.match(route, /FounderWorkspaceTabs set="grow"/);
});

test('A5 reads only documented sources and does not post investor matches', () => {
  for (const call of ['listMetricsSnapshots', 'metricsSummary', 'listWaitlistCustomers', 'brandGetLanding', 'brandListPages', 'brandListWaitlist', 'raiseProspects', 'listMyCoMarketingPitches']) assert.ok(page.includes(`api.${call}`));
  assert.ok(!page.includes('matchInvestors'));
  assert.match(page, /import \{ api, jobs as jobsApi \} from '\.\.\/\.\.\/lib\/api'/);
  assert.match(page, /jobsApi\.mine\(\)/);
  assert.doesNotMatch(page, /api\.jobs\./);
  assert.match(page, /list\(records\.customers, 'signups'\)/);
  assert.match(page, /list\(records\.jobs, 'jobs'\)/);
  assert.match(page, /list\(records\.brandWaitlist, 'signups'\)/);
  assert.match(page, /project_id.*projectId.*project_uid.*projectUid/s);
});

test('A5 has all detailed handoffs and a read-only rail', () => {
  for (const path of ['/build/metrics', '/build/discovery', '/build/team?mode=workspace', '/spinout-lab/brand', '/raise/capital/pipeline', '/comarketing']) assert.ok(page.includes(path));
  assert.match(page, /Read-only source coverage/);
  assert.match(page, /no automated actions/);
});

test('A5 never turns canvas fixtures into product data or claims', () => {
  assert.doesNotMatch(page, /14 of 25|38 in play|61 leads|37%|Nadia Okonkwo|Latitude Seed|Thornbury Capital|Verwood Ventures|Mistral|FLUX|GPT-OSS|BGE-M3|DeepSeek|Llama|QwQ|Granite|\$14\.20|Accept sequence|Move to screen|Generate 4 more/i);
});