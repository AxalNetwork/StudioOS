/**
 * D686 §5.4 (#1597) — Build's "Connect a tool": the catalogue fixes, the row
 * copy and actions, the GitHub sync view, the project's company, the
 * core-systems mapping and the Tools history.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connect_tool_d686.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD_CATEGORY_ORDER, CATEGORY_ORDER, REGISTRY_ALIAS, buildCatalogue, discoverSections, feedsLabel, oauthReturn, toolGroups,
} from '../src/pages/account/connectorsModel.js';

// The live `/available` shape: the registry lists google_calendar and
// microsoft_365 beside the providers that connect through it (D650).
const REGISTRY = [
  { key: 'github', display_name: 'GitHub', status: 'beta', tier: 'growth', auth_type: 'oauth2', has_implementation: true, category: 'Code', feeds: ['product_roadmap', 'prototype_mvp'] },
  { key: 'google_calendar', display_name: 'Google Calendar', status: 'live', tier: 'free', auth_type: 'oauth2', has_implementation: true,
    description: 'Calendar events and interview slots from your existing Google Calendar connection.', capabilities: ['Calendar events'],
    category: 'Calendar and workspace', verified: true, pulls: [{ what: 'Events', module: 'customer_research' }], sends: [], feeds: ['customer_research', 'operating_systems'],
    permissions: ['Create and update your calendar events.'] },
  { key: 'microsoft_365', display_name: 'Microsoft 365', status: 'live', tier: 'free', auth_type: 'oauth2', has_implementation: true,
    category: 'Calendar and workspace', verified: true, feeds: ['customer_research', 'operating_systems'], permissions: ['Confirm your Microsoft sign-in identity.'] },
];

test('one row each for Google Calendar and Microsoft 365: the registry entries merge into the first-party rows', () => {
  const cat = buildCatalogue({ providers: REGISTRY, firstParty: { google: { configured: true, connected: true, google_email: 'a@b.example' }, microsoft: { configured: false, connected: false }, linkedin: null } });
  const keys = cat.map((p) => p.key);
  assert.equal(keys.filter((k) => k === 'google').length, 1);
  assert.equal(keys.filter((k) => k === 'microsoft').length, 1);
  assert.ok(!keys.includes('google_calendar') && !keys.includes('microsoft_365'), 'the aliased registry entries are not listed');
  const g = cat.find((p) => p.key === 'google');
  assert.equal(g.category, 'Calendar and workspace');
  assert.equal(g.verified, true);
  assert.deepEqual(g.feeds, ['customer_research', 'operating_systems'], 'the registry\'s feeds merge in');
  assert.deepEqual(g.permissions, ['Create and update your calendar events.']);
  assert.equal(g.display_name, 'Google Calendar');
  assert.match(g.description, /Continue with Google/, 'the first-party description stays');
  assert.deepEqual(g.capabilities, ['Calendar', 'Gmail invites', 'Sign in with Google'], 'and its capabilities');
  assert.equal(g.first_party, true);
  assert.equal(g.connection.external_account_name, 'a@b.example', 'the connection is the first-party read');
  const m = cat.find((p) => p.key === 'microsoft');
  assert.equal(m.available, false, 'not configured here: unavailable, whatever the registry says');
  assert.equal(m.connection, null);
  const sections = discoverSections(cat, 'All');
  assert.equal(sections.flatMap((s) => s.cards).filter((p) => /Google Calendar/.test(p.display_name)).length, 1, 'no duplicate in Discover');
  assert.deepEqual(REGISTRY_ALIAS, { google_calendar: 'google', microsoft_365: 'microsoft' });
  // An exact-key registry entry still wins over the first-party row.
  const exact = buildCatalogue({ providers: [...REGISTRY, { key: 'google', display_name: 'Google (registry)', status: 'live', has_implementation: true }], firstParty: {} });
  assert.equal(exact.filter((p) => p.key === 'google').length, 1);
  assert.equal(exact.find((p) => p.key === 'google').display_name, 'Google (registry)');
  // A first-party row with no registry entry keeps its own category.
  assert.equal(buildCatalogue({ providers: [], firstParty: {} }).find((p) => p.key === 'microsoft').category, 'Calendar and workspace');
  assert.ok(CATEGORY_ORDER.includes('Calendar and workspace'), 'a Connectors chip for it');
});

test('a sign-in return: the Worker\'s scope_overreach is the overreach view, and GitHub lands on choosing its repositories', () => {
  assert.equal(oauthReturn('?oauth=error&provider=hubspot&reason=scope_overreach').view, 'overreach');
  assert.equal(oauthReturn('?oauth=error&provider=hubspot&reason=overreach').view, 'overreach');
  assert.equal(oauthReturn('?oauth=error&provider=hubspot&reason=nope').view, 'refused');
  assert.equal(oauthReturn('?oauth=ok&provider=github').view, 'sync');
  assert.equal(oauthReturn('?oauth=ok&provider=hubspot').view, 'connected');
});

test('Build\'s group order and the pin; the feeds label from feed_modules first', () => {
  assert.deepEqual(BUILD_CATEGORY_ORDER.slice(0, 7), ['Code', 'Design', 'Payments', 'Accounting and banking', 'Payroll', 'CRM', 'Calendar and workspace']);
  const cat = buildCatalogue({ providers: [...REGISTRY, { key: 'stripe', display_name: 'Stripe', category: 'Payments', status: 'live', has_implementation: true }, { key: 'zz', display_name: 'Zed', category: 'Oddities', status: 'live', has_implementation: true }], firstParty: {} });
  assert.deepEqual(toolGroups(cat).groups.map((g) => g.label), ['Code', 'Payments', 'Calendar and workspace', 'Data', 'Other']);
  assert.deepEqual(toolGroups(cat, { pin: 'Calendar and workspace' }).groups.map((g) => g.label), ['Calendar and workspace', 'Code', 'Payments', 'Data', 'Other']);
  assert.deepEqual(toolGroups(cat, { pin: 'Other' }).groups.map((g) => g.label)[0], 'Other');
  assert.equal(feedsLabel({ feeds: ['product_roadmap'], feed_modules: [{ key: 'product_roadmap', label: 'Product roadmap' }, { key: 'prototype_mvp', label: 'Prototype / MVP' }] }), 'Product roadmap, Prototype / MVP');
  assert.equal(feedsLabel({ feeds: ['product_roadmap', 'prototype_mvp'] }), 'Product roadmap, Prototype mvp', 'the fallback: the keys made readable');
  assert.equal(feedsLabel({ feeds: [], feed_modules: [] }), null);
});
