/**
 * D452 — deployments' version, the kind filter, the clash actions and the
 * white-label overlay. Rewritten under D515 (issue #1024) to pin BEHAVIOUR:
 * every test here used to match page source text, which passes for code that
 * renders the wrong thing. The rules now run for real (deployVersionDisplay,
 * filterByKind, utcDay/utcMinute) and the two components are rendered
 * (TerritoryEditor's clash actions, the white-label panel).
 *
 * The Worker half — the live deploy_version written to last_version and
 * winning over a stale one — is driven for real in
 * cloudflare-worker/test/deployments_last_version_d452.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deployVersionDisplay } from '../src/lib/deployVersion.js';
import { filterByKind, LICENCE_KINDS } from '../src/lib/licenceKind.js';
import { utcDay, utcMinute } from '../src/lib/utcStamp.js';
import { TerritoryEditor } from '../src/pages/admin/AdminLicences.jsx';
import { WhiteLabelPanel } from '../src/pages/hq/HqBranchOverlay.jsx';

const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('the deploy version: a live ok read wins over the stored one, and nothing is never a version', () => {
  assert.equal(deployVersionDisplay({ live_state: 'ok', live: { deploy_version: 'abc123' }, last_version: 'old999' }), 'abc123');
  assert.equal(deployVersionDisplay({ version_display: 'srv777', live_state: 'ok', live: { deploy_version: 'abc123' } }), 'srv777',
    'the Worker\'s version_display is taken as sent');
  assert.equal(deployVersionDisplay({ live_state: 'unreachable', live: null, last_version: 'old999' }), 'old999',
    'an unreachable branch falls back to the stored version');
  assert.equal(deployVersionDisplay({ live_state: 'ok', live: { deploy_version: null }, last_version: null }), null);
  assert.equal(deployVersionDisplay(null), null);
});

test('the kind filter: All, Axal and White-label, and an unknown value shows nothing', () => {
  const items = [{ uid: 'a', kind: 'subsidiary' }, { uid: 'b', kind: 'white_label' }, { uid: 'c', kind: 'subsidiary' }];
  assert.deepEqual(LICENCE_KINDS, ['all', 'subsidiary', 'white_label']);
  assert.deepEqual(filterByKind(items, 'all').map((l) => l.uid), ['a', 'b', 'c']);
  assert.deepEqual(filterByKind(items, 'subsidiary').map((l) => l.uid), ['a', 'c']);
  assert.deepEqual(filterByKind(items, 'white_label').map((l) => l.uid), ['b']);
  assert.deepEqual(filterByKind(items, 'franchise'), [], 'an unknown filter never widens to everything');
  assert.deepEqual(filterByKind(null, 'all'), []);
});

test('a territory clash offers Open the holder and Remove from list; Open only with a holder to open', () => {
  const held = [
    { licence_uid: 'L2', country_code: 'FR', licence_ref: 'AX-FR-01', status: 'active' },
    { licence_uid: null, country_code: 'BE', licence_ref: 'AX-BE-01', status: 'suspended' },
    { licence_uid: 'L1', country_code: 'LU', licence_ref: 'self', status: 'active' },
  ];
  const html = render(TerritoryEditor, { licence: { uid: 'L1', territories: ['FR', 'BE', 'LU', 'NL'] }, held, onOpenLicence: () => {} });
  assert.match(html, /data-testid="territory-clash-open-FR"/);
  assert.match(text(html), /Open AX-FR-01/);
  assert.match(html, /data-testid="territory-clash-remove-FR"/);
  assert.match(html, /data-testid="territory-clash-remove-BE"/);
  assert.doesNotMatch(html, /territory-clash-open-BE/, 'no uid to open, so no Open');
  assert.doesNotMatch(html, /territory-clash-(open|remove)-LU/, 'keeping your own country is not a clash');
  assert.doesNotMatch(html, /territory-clash-(open|remove)-NL/, 'an unheld country is not a clash');
  // Without an opener, only Remove is offered.
  const noOpen = render(TerritoryEditor, { licence: { uid: 'L1', territories: ['FR'] }, held });
  assert.doesNotMatch(noOpen, /territory-clash-open-/);
  assert.match(noOpen, /territory-clash-remove-FR/);
});

test('the white-label panel draws the brand colour it says it draws — not a mark', () => {
  const withColour = render(WhiteLabelPanel, { licence: { brand_name: 'Nordlys', brand_kit_reason: null }, code: 'NO', primaryHex: '#1a7f5a' });
  assert.match(withColour, /data-testid="hq-white-label-swatch"[^>]*style="background-color:#1a7f5a"/);
  assert.match(text(withColour), /Nordlys/);
  assert.match(text(withColour), /Their public name and brand colour inside HQ's frame/);
  assert.doesNotMatch(text(withColour), /\bmark\b/, 'no logo is read, so no mark is promised');
  const none = render(WhiteLabelPanel, { licence: { brand_name: null, brand_kit_reason: 'No brand kit is recorded.' }, code: 'NO', primaryHex: null });
  assert.doesNotMatch(none, /hq-white-label-swatch/);
  assert.match(text(none), /^NO /, 'the code stands in for a missing name');
  assert.match(text(none), /Their public name inside HQ's frame/);
  assert.doesNotMatch(text(none), /brand colour/);
  assert.match(text(none), /No brand kit is recorded\./);
});

test('a stored UTC health stamp is shown with its zone; no stamp is no date', () => {
  assert.equal(utcDay('2026-10-04 13:05:22'), '2026-10-04 UTC');
  assert.equal(utcMinute('2026-10-04 13:05:22'), '2026-10-04 13:05 UTC');
  assert.equal(utcMinute('2026-10-04T13:05:22Z'), '2026-10-04 13:05 UTC');
  for (const v of [null, undefined, '', 'yesterday']) {
    assert.equal(utcDay(v), null);
    assert.equal(utcMinute(v), null);
  }
});
