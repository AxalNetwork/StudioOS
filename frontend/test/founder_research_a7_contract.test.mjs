import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (path) => codeOnly(readFileSync(resolve(process.cwd(), path), 'utf8'));
const desk = read('frontend/src/pages/founder/FounderResearchDesk.jsx');
const raw = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const app = read('frontend/src/App.jsx');

test('A7 owns only bare founder signals and preserves detailed routes', () => {
  assert.match(app, /founderResearchLanding = effectiveRole === 'founder'/);
  assert.match(app, /founderResearchLanding\s*\?\s*<FounderResearchDesk \/>[\s\S]*?founderWorkspace\('research'/);
  assert.match(app, /signalsMode.*workspace/);
  assert.match(app, /signalsHasNonProjectQuery/);
});

test('A7 uses only approved read sources and allSettled retention', () => {
  for (const call of ['api.marketPulse()', 'api.privateRounds()', 'api.miSources()', "api.signals.list({ mode: 'founder' })", 'api.signals.sources()', 'api.listCompanies({ limit: 12 })', 'api.listProjects()', 'api.research.funds()', 'api.research.documents()']) assert.ok(desk.includes(call), call);
  assert.match(desk, /Promise\.allSettled/);
  assert.match(desk, /setRecords\(\(previous\) => \(\{ \.\.\.previous, \.\.\.next \}\)\)/);
  assert.match(desk, /Startup #\$\{requestedId\}/);
  assert.doesNotMatch(desk, /fundsList|askAdvisory|runDiligence|generateMemo/);
});

test('A7 has honest handoffs and excludes fixture claims', () => {
  // D421. The desk hands off to the Research zones it summarises. `/market-intel`
  // sent a founder outside the Lab back to their default page, and Fund
  // research and the library went to Raise. `/build/competitors` stays: that
  // line is Session 2's, whose redirect decides where it lands.
  for (const path of ['/research/funds', '/research/markets', '/research/library', '/research/ask', '/build/competitors']) assert.ok(desk.includes(path), path);
  for (const gone of ['/market-intel', '/signals?mode=workspace', '/raise/capital/pipeline', '/raise/data-room']) assert.ok(!desk.includes(gone), `${gone} is a handoff out of Research again`);
  for (const forbidden of ['async workflow tooling', 'Latitude Seed', 'Kestrel Ventures', 'Thornbury Capital', 'Gartner', 'CB Insights', 'Eurostat', '31×', '$14.20', 'DeepSeek', 'Llama', 'GPT-OSS', 'Moondream', 'Qwen', 'Mistral', 'Gemma', 'bge-m3', 'FLUX', 'QwQ', 'Granite', 'Ask a follow-up', 'Research it', 'Save to Markets', 'Save to fund profile', 'Proposal · Brief']) assert.ok(!desk.includes(forbidden), forbidden);
  assert.doesNotMatch(desk, /Ran 6s ago|3 sources agree|4 saved|11 tracked|9 documents|340 pages|62,400|1,240|\$0\.440|\$0\.014|\$0\.0291|\$0\.0025|\$0\.031|\$4\.08|50 questions/i);
  assert.match(desk, /id="a7-companies"[\s\S]*?title="Company profiles"/);
  assert.match(desk, /data\.headlines\[0\] \|\| data\.signals\[0\] \|\| data\.markets\[0\]/);
  // WAS `pulseLoaded ? … : 'Headlines unavailable'`. The count half is what this
  // test is about — a real number from the store, never a fixture — and it is
  // unchanged. The fallback half moved into `sourceMeta`, because
  // `pulseLoaded` is only `Object.hasOwn(records, 'pulse')`, which is false
  // BOTH while the request is in flight and after it fails: the card claimed
  // the source was unavailable every time the page was merely still loading
  // (task #107's batch, D66).
  assert.match(desk, /sourceMeta\('pulse', `\$\{data\.headlines\.length\} stored headlines`\)/);
  assert.match(desk, /if \(failedKeys\.has\(key\)\) return 'Source unavailable';/,
    'only a source that actually failed may say so');
  assert.match(desk, /founderResearchSeed: \{ records, projects, projectId \}/);
});

test('A7 asks through the Research store, on the press, and says why when it cannot answer', () => {
  // D421. The question box stayed local; `/research/ask` answered from the
  // founder's library all along.
  assert.match(desk, /<form className="a7-question" onSubmit=\{ask\}>/, 'the question box does not submit');
  assert.match(desk, /setAsked\(await api\.research\.ask\(q\)\);/, 'the desk does not ask the Research store');
  assert.match(raw('cloudflare-worker/src/routes/research.ts'), /research\.post\('\/ask'/, 'the ask route is gone');
  // NOTHING RUNS ON A VISIT: the call sits inside the submit handler only.
  const handler = desk.slice(desk.indexOf('const ask = async (event) =>'), desk.indexOf('const data = useMemo'));
  assert.equal((desk.match(/api\.research\.ask\(/g) || []).length, 1, 'Ask is called from somewhere other than the press');
  assert.ok(handler.includes('api.research.ask('), 'the one call is not inside the submit handler');
  assert.match(handler, /event\.preventDefault\(\);/);
  // THE ROUTE'S REASONS, kept apart: an empty library is not a library with
  // nothing on this, and a model that failed still shows what it found.
  const result = desk.slice(desk.indexOf('function AskResult'));
  assert.match(result, /asked\.reason === 'no_source' \? \(Number\(asked\.indexed_documents\) === 0/);
  assert.match(result, /asked\.reason === 'answered' \? asked\.answer/);
  assert.match(result, /citations\.length \? <ol>/, 'the citations are not listed');
  // FUNDS: the route's counts, and null overlap is not zero.
  const funds = desk.slice(desk.indexOf('function FundResearch'));
  assert.match(funds, /if \(failed\) return <Unreadable /, 'a failed funds read renders as "none researched"');
  assert.match(funds, /funds\.cheque_overlap_count == null \? 'Not recorded'/, 'an unknowable overlap is printed as a number');
  assert.doesNotMatch(desk, /Questions remain local|recommendation|advice/i);
});