import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (path) => codeOnly(readFileSync(resolve(process.cwd(), path), 'utf8'));
const desk = read('frontend/src/pages/founder/FounderNetworkDesk.jsx');
const app = read('frontend/src/App.jsx');

test('A6 has explicit founder-only overview ownership and preserves network deep links', () => {
  assert.match(app, /founderNetworkLanding = effectiveRole === 'founder'[\s\S]*?get\('mode'\) !== 'workspace'[\s\S]*?!networkParams\.has\('tab'\)[\s\S]*?!networkParams\.has\('intro'\)/);
  // The /network route gained a dedicated investor branch (InvestorNetworkWorkspace)
  // ahead of the founder ternary this test pins — the founder-only ownership
  // it is meant to protect (founderNetworkLanding, defined above) did not move.
  assert.match(app, /effectiveRole === 'investor' \? <InvestorNetworkWorkspace \/> : founderNetworkLanding \? <FounderNetworkDesk \/> : founderWorkspace\('network', <NetworkPage \/>/);
});
test('A6 normalizes both relationship envelopes and reads only approved endpoints', () => {
  assert.match(desk, /normalizeRelationships = \(value\) => listFrom\(value, 'items'\)/);
  assert.match(desk, /value !== null && value !== undefined && value !== ''/);
  assert.match(desk, /Number\.isNaN\(parsed\.getTime\(\)\)/);
  assert.match(desk, /loading && !Object\.keys\(records\)\.length/);
  for (const call of ['api.contactsList()', 'api.partnerRelationships()', 'api.partnerSummary()', 'api.introPropositions()']) assert.ok(desk.includes(call));
  assert.ok(!/introAccept|introDecline|contactGet|createRelationship|updateRelationship|logActivity/.test(desk));
});
test('A6 preserves detailed handoffs and carries its loaded seed', () => {
  for (const path of ['/network?mode=workspace&tab=contacts', '/network?mode=workspace&tab=introductions', '/network?mode=workspace&tab=relationships']) assert.ok(desk.includes(path));
  assert.match(desk, /founderNetworkSeed: \{ records \}/);
});
test('A6 does not resurrect rejected fixture records or unsupported AI claims', () => {
  for (const forbidden of ['Marisol Vega', 'Dev Raman', 'Aoife Brennan', 'Priyanka Raghunathan', 'Tobias Ncube', 'Thornbury Capital', 'Latitude Seed', 'Kestrel Ventures', 'Verwood', 'Raghunathan Law', 'Accept draft', 'Send to connector', 'bge-m3', 'Gemma', 'Mistral', 'Llama', 'GPT-OSS', 'FLUX', 'DeepSeek', 'QwQ', 'Granite']) assert.ok(!desk.includes(forbidden), `${forbidden} must not be a fixture`);
  assert.doesNotMatch(desk, /184 relationships|12 going cold|71 days|3 asked|2 offered|1 in motion|31 tracked|Re-engage|Follow up|Log a touch|Offer the intro|re-engagement proposal|\$14\.20|\$0\.0009/i);
});