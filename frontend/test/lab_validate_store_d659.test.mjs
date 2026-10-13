/**
 * D659 (#1472) — the Spin-Out Lab's two Validate pages, on the stores the
 * Validate cycle read uses.
 *
 *   * Discovery: the funnel, readiness and claim counts are
 *     `labDiscoveryCounts`, the function the Worker test holds equal to the
 *     cycle read. The page does not keep a second copy.
 *   * Market: three of the nine readiness checks lived in page state, so a
 *     reload undid them. They are read from and written to the Worker now,
 *     and "not saved yet" is said only of a source whose save failed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { labDiscoveryCounts, MIN_INTERVIEWS } from '../src/lib/labDiscovery.js';
import { cycleValidateApi } from '../src/lib/api/cycleValidate.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const DISCOVERY = codeOnly(raw('frontend/src/pages/SpinoutLabDiscoveryPage.jsx'));
const MARKET = codeOnly(raw('frontend/src/pages/SpinoutLabMarketPage.jsx'));

test('D659: the Lab discovery page derives its funnel through the shared function, and keeps no copy', () => {
  assert.match(DISCOVERY, /const base = labDiscoveryCounts\(\{ interviews, signups, painData, minInterviews: MIN_INTERVIEWS \}\);/);
  assert.doesNotMatch(DISCOVERY, /label: 'Pain confirmed'/, 'the funnel lives in lib/labDiscovery.js only');
  assert.doesNotMatch(DISCOVERY, /function parseArr\(/);
  assert.equal(MIN_INTERVIEWS, 3);
});

test('D659: labDiscoveryCounts — leads plus interviews reach the funnel; an uncontacted lead is not engaged', () => {
  const out = labDiscoveryCounts({
    interviews: [
      { pains_json: '["Slow dispatch"]', hypotheses_json: '[{"status":"validated"}]', notes: 'x' },
      { pains: [], hypotheses: [{ status: 'invalidated' }, { status: 'open' }], notes: '' },
    ],
    signups: [{ crm_status: 'new' }, { crm_status: 'invited' }],
    painData: { groups: [], ungrouped: [{ display_phrase: 'Slow dispatch', count: 1 }] },
  });
  assert.deepEqual(out.funnel.map((f) => f.n), [4, 3, 1, 1]);
  assert.deepEqual(out.funnel.map((f) => f.pct), [100, 75, 25, 25]);
  assert.deepEqual([out.hypTotal, out.hypValidated, out.hypInvalidated, out.hypInconclusive], [3, 1, 1, 1]);
  assert.deepEqual(out.readiness.map((r) => r.ok), [false, false, false, true]);
});

test('D659: the Lab market page reads its three stored checks and does not tick one it could not read', () => {
  assert.match(MARKET, /const readiness = p \? await cycleValidateApi\.marketReadiness\(p\.id\)\.catch\(\(e\) => \{/);
  assert.match(MARKET, /setPosDone\(Boolean\(readiness\.positioning_map\)\);/);
  assert.match(MARKET, /setAssumptionsReviewed\(Boolean\(readiness\.assumptions_reviewed\)\);/);
  assert.match(MARKET, /return null;\s+\}\) : null;\s+if \(!alive\) return;\s+if \(readiness\) \{/);
});

test('D659: the Lab market page writes each check where the founder makes it', () => {
  assert.match(MARKET, /cycleValidateApi\.setMarketMark\(project\.id, 'assumptions_reviewed', true\)/);
  assert.match(MARKET, /cycleValidateApi\.setMarketMark\(project\.id, 'positioning_map', true\)/);
  assert.match(MARKET, /await cycleValidateApi\.addMarketSource\(project\.id, \{ title, kind: srcForm\.type \}\)/);
  assert.match(MARKET, /await cycleValidateApi\.removeMarketSource\(project\.id, row\.id\);/);
  assert.match(MARKET, /onClick=\{\(\) => removeSource\(i\)\}/);
});

test('D659: "not saved yet" is said only of a source whose save failed', () => {
  assert.match(MARKET, /\{s\.id == null && <> · <span className="text-amber-700 dark:text-amber-400 font-semibold">not saved yet<\/span><\/>\}/);
  assert.match(MARKET, /setFounderSources\(\(prev\) => \[\.\.\.prev, \{ \.\.\.row, id: saved\?\.id \?\? null \}\]\);/);
});

test('D659: the client names the project on every call and the routes the Worker mounts', () => {
  assert.deepEqual(Object.keys(cycleValidateApi).sort(), [
    'addCompetitorMention', 'addDemandSignal', 'addMarketSource', 'addSegment', 'marketReadiness', 'module',
    'overview', 'removeMarketSource', 'setDemandSignalStatus', 'setEvidenceStrength', 'setHypothesisPlan',
    'setInterviewSegment', 'setInterviewStage', 'setInterviewsTarget', 'setMarketMark', 'setWaitlistTarget',
  ]);
  const src = raw('frontend/src/lib/api/cycleValidate.js');
  for (const line of src.split('\n').filter((l) => l.includes('request(`'))) {
    assert.match(line, /\?\$\{q\(projectId\)\}|\?\$\{params\}/, `every call names the project: ${line.trim()}`);
  }
  assert.match(src, /new URLSearchParams\(\{ project: String\(projectId\), /);
});
