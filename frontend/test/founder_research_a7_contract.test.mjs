import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (path) => codeOnly(readFileSync(resolve(process.cwd(), path), 'utf8'));
const desk = read('frontend/src/pages/founder/FounderResearchDesk.jsx');
const app = read('frontend/src/App.jsx');

test('A7 owns only bare founder signals and preserves detailed routes', () => {
  assert.match(app, /founderResearchLanding = effectiveRole === 'founder'/);
  assert.match(app, /founderResearchLanding\s*\?\s*<FounderResearchDesk \/>[\s\S]*?founderWorkspace\('research'/);
  assert.match(app, /signalsMode.*workspace/);
  assert.match(app, /signalsHasNonProjectQuery/);
});

test('A7 uses only approved read sources and allSettled retention', () => {
  for (const call of ['api.marketPulse()', 'api.privateRounds()', 'api.miSources()', "api.signals.list({ mode: 'founder' })", 'api.signals.sources()', 'api.listCompanies({ limit: 12 })', 'api.listProjects()', 'api.listDocuments(projectId)']) assert.ok(desk.includes(call), call);
  assert.match(desk, /Promise\.allSettled/);
  assert.match(desk, /setRecords\(\(previous\) => \(\{ \.\.\.previous, \.\.\.next \}\)\)/);
  assert.match(desk, /Startup #\$\{requestedId\}/);
  assert.doesNotMatch(desk, /fundsList|askAdvisory|runDiligence|generateMemo/);
});

test('A7 has honest handoffs and excludes fixture claims', () => {
  for (const path of ['/signals?mode=workspace', '/market-intel', '/build/competitors', '/raise/capital/pipeline', '/raise/data-room']) assert.ok(desk.includes(path), path);
  for (const forbidden of ['async workflow tooling', 'Latitude Seed', 'Kestrel Ventures', 'Thornbury Capital', 'Gartner', 'CB Insights', 'Eurostat', '31×', '$14.20', 'DeepSeek', 'Llama', 'GPT-OSS', 'Moondream', 'Qwen', 'Mistral', 'Gemma', 'bge-m3', 'FLUX', 'QwQ', 'Granite', 'Ask a follow-up', 'Research it', 'Save to Markets', 'Save to fund profile', 'Proposal · Brief']) assert.ok(!desk.includes(forbidden), forbidden);
  assert.doesNotMatch(desk, /Ran 6s ago|3 sources agree|4 saved|11 tracked|9 documents|340 pages|62,400|1,240|\$0\.440|\$0\.014|\$0\.0291|\$0\.0025|\$0\.031|\$4\.08|50 questions/i);
  assert.match(desk, /id="a7-companies"[\s\S]*?title="Company profiles"/);
  assert.match(desk, /data\.headlines\[0\] \|\| data\.signals\[0\] \|\| data\.markets\[0\]/);
  assert.match(desk, /pulseLoaded \? `\$\{data\.headlines\.length\} stored headlines` : 'Headlines unavailable'/);
  assert.match(desk, /founderResearchSeed: \{ records, projects, projectId \}/);
  assert.match(desk, /Not recorded \/ unavailable/);
});