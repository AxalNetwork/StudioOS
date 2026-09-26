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
  // The /network route has since gained an investor branch and an advisor one
  // ahead of the founder ternary this test pins. Both render the zone shell
  // for their own licence; the founder-only ownership this protects
  // (founderNetworkLanding, defined above) did not move, and is what the
  // second assertion reads. Pinning the whole ternary again would make every
  // future licence branch look like a founder regression.
  assert.match(app, /effectiveRole === 'investor' \? <InvestorNetworkWorkspace \/>/);
  assert.match(app, /founderNetworkLanding \? <FounderNetworkDesk \/> : founderWorkspace\('network', <NetworkPage \/>/);
});
test('A6 normalizes both relationship envelopes and reads only approved endpoints', () => {
  assert.match(desk, /normalizeRelationships = \(value\) => listFrom\(value, 'items'\)/);
  assert.match(desk, /value !== null && value !== undefined && value !== ''/);
  assert.match(desk, /Number\.isNaN\(parsed\.getTime\(\)\)/);
  assert.match(desk, /loading && !Object\.keys\(records\)\.length/);
  for (const call of ['api.contactsList()', 'api.partnerRelationships()', 'api.partnerSummary()', 'api.introPropositions()']) assert.ok(desk.includes(call));
  assert.ok(!/introAccept|introDecline|contactGet|createRelationship|updateRelationship|logActivity/.test(desk));
});
test('A6 hands off to its three zones and carries its loaded seed', () => {
  // D421. Every card linked to the legacy `/network?mode=workspace&tab=…`
  // while the three zones it summarises sat one pill away.
  const sections = desk.match(/const SECTIONS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.deepEqual([...sections.matchAll(/\['(\w+)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]), [
    ['Relationships', '/network/relationships'],
    ['Introductions', '/network/introductions'],
    ['Organizations', '/network/organizations'],
  ], 'the chip row is no longer the three Network zones');
  for (const [testid, zone] of [
    ['link-open-network-relationships', 'Relationships'],
    ['link-open-network-introductions', 'Introductions'],
    ['link-open-network-pairings', 'Introductions'],
    ['link-open-network-organizations', 'Organizations'],
  ]) {
    assert.match(desk, new RegExp(`testid="${testid}" to=\\{ZONE\\.${zone}\\}`), `${testid} does not hand off to the ${zone} zone`);
  }
  assert.ok(!desk.includes('mode=workspace'), 'a card still routes through the legacy NetworkPage');
  assert.match(desk, /founderNetworkSeed: \{ records \}/);
});

test('A6 flags going cold with the zone’s own definition', () => {
  // ONE DEFINITION. The desk and /network/relationships used to be able to
  // disagree about one contact; both import it now.
  const lib = read('frontend/src/lib/networkBook.js');
  assert.match(lib, /export const COLD_AFTER_DAYS = 60;/);
  assert.match(lib, /return days !== null && days > COLD_AFTER_DAYS;/, 'unknown activity reads as cold, or the window moved');
  for (const file of ['FounderNetworkDesk', 'FounderNetworkRelationships', 'FounderNetworkOrganizations']) {
    const src = read(`frontend/src/pages/founder/${file}.jsx`);
    assert.match(src, /from '\.\.\/\.\.\/lib\/networkBook';/, `${file} does not read the shared cold flag`);
    assert.ok(!/> 60\b/.test(src), `${file} carries its own copy of the cold window`);
  }
  // THE DESK SHOWS IT on every row and counts it in the card's meta.
  assert.match(desk, /\{touchCell\(row\.last_activity_at \|\| row\.last_touch_at\)\}/, 'partner relationships are not flagged');
  assert.match(desk, /<span>Not scored<\/span>\{touchCell\(row\.last_activity_at\)\}/, 'contacts are not flagged');
  assert.match(desk, /\$\{cold\} going cold/, 'the relationships card does not count who is going cold');
  // ORGANIZATIONS ARE THE RECORDED FIELD, never an email domain.
  assert.match(read('frontend/src/lib/networkBook.js'), /row\?\.organization \|\| row\?\.company \|\| row\?\.firm/);
  assert.ok(!/split\('@'\)|\.email\.split|domain/.test(desk.replace(/email domains are not inferred/g, '')), 'an organization is being inferred from an email');
  assert.doesNotMatch(desk, /recommendation/i, 'the desk calls what it shows a recommendation');
});
test('A6 does not resurrect rejected fixture records or unsupported AI claims', () => {
  for (const forbidden of ['Marisol Vega', 'Dev Raman', 'Aoife Brennan', 'Priyanka Raghunathan', 'Tobias Ncube', 'Thornbury Capital', 'Latitude Seed', 'Kestrel Ventures', 'Verwood', 'Raghunathan Law', 'Accept draft', 'Send to connector', 'bge-m3', 'Gemma', 'Mistral', 'Llama', 'GPT-OSS', 'FLUX', 'DeepSeek', 'QwQ', 'Granite']) assert.ok(!desk.includes(forbidden), `${forbidden} must not be a fixture`);
  assert.doesNotMatch(desk, /184 relationships|12 going cold|71 days|3 asked|2 offered|1 in motion|31 tracked|Re-engage|Follow up|Log a touch|Offer the intro|re-engagement proposal|\$14\.20|\$0\.0009/i);
});