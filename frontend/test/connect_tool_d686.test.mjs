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
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  BUILD_CATEGORY_ORDER, CATEGORY_ORDER, REGISTRY_ALIAS, buildCatalogue, discoverSections, feedsLabel, moduleLabel, oauthReturn, retryOutcome,
  toolBanner, toolGroups, toolRow,
} from '../src/pages/account/connectorsModel.js';
import { connectorsApi } from '../src/lib/api/connectors.js';
import { ConnectToolView } from '../src/pages/account/ConnectToolSheet.jsx';

const h = React.createElement;
const DAY = 86400000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** Mount a view through the stub DOM; `by(testid)`, `click`, `text`. */
async function mount(el) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, settle, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async render(next) { await act(async () => { root.render(next); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

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

// ---------------------------------------------------------------- the rows

const ROWS = buildCatalogue({
  providers: [
    { key: 'hubspot', display_name: 'HubSpot', category: 'CRM', status: 'live', has_implementation: true, feeds: ['capital_relationships'] },
    { key: 'salesforce', display_name: 'Salesforce', category: 'CRM', status: 'live', has_implementation: true, feeds: ['capital_relationships'] },
    { key: 'calendly', display_name: 'Calendly', category: 'Calendar', status: 'live', has_implementation: true, feeds: ['customer_research'] },
    { key: 'stripe', display_name: 'Stripe', category: 'Payments', status: 'live', has_implementation: true, feeds: ['revenue_and_traction'] },
    { key: 'github', display_name: 'GitHub', category: 'Code', status: 'beta', tier: 'growth', locked_for_user: true, has_implementation: true, feeds: ['product_roadmap'] },
    { key: 'carta', display_name: 'Carta', category: 'Cap table', status: 'live', tier: 'studio', locked_for_user: true, has_implementation: true },
    { key: 'figma', display_name: 'Figma', category: 'Design', status: 'coming_soon', has_implementation: false, feed_modules: [{ key: 'prototype_mvp', label: 'Prototype / MVP' }] },
  ],
  items: [
    { uid: 'u-hub', provider_key: 'hubspot', status: 'error', last_error: 'invalid_grant', last_synced_at: ago(3 * DAY) },
    { uid: 'u-sf', provider_key: 'salesforce', status: 'error', last_error: 'HTTP 500 upstream', last_synced_at: ago(2 * DAY) },
    { uid: 'u-cal', provider_key: 'calendly', status: 'error', last_error: 'rate_limited: daily cap', last_synced_at: ago(DAY) },
    { uid: 'u-str', provider_key: 'stripe', status: 'active', last_synced_at: ago(3600000) },
  ],
  firstParty: {},
});
const row = (k) => toolRow(ROWS.find((p) => p.key === k));

test('each row: failing by its reason, connected, locked by its real tier, coming soon with what it will feed', () => {
  assert.deepEqual([row('hubspot').action, row('hubspot').actionLabel], ['reconnect', 'Reconnect'], 'Sign-in expired → Reconnect');
  assert.deepEqual([row('salesforce').action, row('salesforce').actionLabel], ['retry', 'Try again'], 'Last sync failed → Try again');
  assert.equal(row('calendly').action, null, 'Daily limit reached: no retry, waiting is the fix');
  assert.match(row('calendly').detail, /^Daily limit reached · last good sync 1 day ago$/);
  assert.deepEqual(row('stripe').pill, ['Connected', 'ok']);
  assert.deepEqual([row('stripe').action, row('stripe').actionLabel], ['disconnect', 'Disconnect']);
  assert.match(row('stripe').detail, /^Feeds Revenue and traction · synced 1 h ago$/);
  assert.deepEqual([row('github').pill[0], row('github').actionLabel], ['Growth', 'Upgrade to Growth']);
  assert.deepEqual([row('carta').pill[0], row('carta').actionLabel], ['Studio', 'Upgrade to Studio']);
  assert.equal(toolRow({ key: 'x', display_name: 'X', locked: true, available: true, tier: 'pro' }).actionLabel, 'See plans', 'a tier the Worker does not name is never printed');
  assert.equal(toolRow({ key: 'x', display_name: 'X', locked: true, available: true, tier: 'pro' }).pill[0], 'Paid plan');
  assert.deepEqual([row('figma').pill[0], row('figma').detail, row('figma').action], ['Coming soon', 'Will feed Prototype / MVP', null]);
  assert.equal(moduleLabel({ feed_modules: [{ key: 'prototype_mvp', label: 'Prototype / MVP' }] }, 'prototype_mvp'), 'Prototype / MVP');
  assert.equal(moduleLabel({}, 'customer_research'), 'Customer research');
  assert.deepEqual(retryOutcome(null), { tone: 'ok', text: 'Synced.', reconnect: false });
  assert.equal(retryOutcome({ status: 422, code: 'sync_not_supported', message: 'x' }).reconnect, true);
  assert.deepEqual(retryOutcome({ status: 403, code: 'company_not_enabled', message: 'This connector is not enabled for that company.' }), { tone: 'danger', text: 'This connector is not enabled for that company.', reconnect: false });
  assert.equal(retryOutcome({ status: 502, code: 'sync_failed', message: 'GitHub did not answer.' }).text, 'GitHub did not answer.', 'the Worker\'s words');
  assert.equal(toolBanner(ROWS).key, 'hubspot', 'the failed banner names its tool, so its group is pinned');
});

test('the list: Try again syncs and says how it went, a tool with no sync falls back to Reconnect, Disconnect asks first, the name opens the detail', async () => {
  const calls = [];
  let reloads = 0;
  const saved = { sync: connectorsApi.sync, disconnect: connectorsApi.disconnect, teammate: connectorsApi.teammate };
  let syncAnswer = null;
  connectorsApi.sync = async (uid) => { calls.push(['sync', uid]); if (syncAnswer) throw syncAnswer; return { ok: true }; };
  connectorsApi.disconnect = async (uid) => { calls.push(['disconnect', uid]); return { ok: true }; };
  connectorsApi.teammate = async () => ({ teammate: null });
  const data = { status: 'ready', catalogue: ROWS, reload: () => { reloads += 1; } };
  const m = await mount(h(MemoryRouter, null, h(ConnectToolView, { data, onClose() {} })));
  try {
    assert.match(m.text(), /^Build Connect a tool/);
    assert.ok(m.text().indexOf('CRM') < m.text().indexOf('Code'), 'the failing tool\'s group first while the banner shows');
    await m.click('tool-action-salesforce');
    assert.deepEqual(calls, [['sync', 'u-sf']]);
    assert.equal(m.text(m.by('tool-note-salesforce')), 'Synced.');
    assert.equal(reloads, 1, 'a good sync re-reads the list');
    syncAnswer = Object.assign(new Error('Salesforce has no sync of its own.'), { status: 422, code: 'sync_not_supported' });
    await m.click('tool-action-salesforce');
    assert.equal(m.text(m.by('tool-action-salesforce')), 'Reconnect', 'no sync of its own: Reconnect instead');
    assert.equal(reloads, 1, 'a refused sync re-reads nothing');
    syncAnswer = null;
    assert.equal(m.by('tool-action-calendly'), undefined, 'the daily limit offers no retry');
    await m.click('tool-action-stripe');
    assert.ok(m.text(m.by('tool-confirm-stripe')).startsWith('Disconnect Stripe? Data already in StudioOS stays.'), 'the confirm says what stays');
    assert.equal(calls.some((c) => c[0] === 'disconnect'), false, 'nothing is disconnected by the first click');
    await m.click('tool-confirm-disconnect-stripe');
    assert.deepEqual(calls.at(-1), ['disconnect', 'u-str']);
    assert.equal(reloads, 2);
    await m.click('tool-name-stripe');
    assert.ok(m.text().includes('On disconnect:'), 'the name opens the tool\'s detail');
  } finally {
    Object.assign(connectorsApi, saved);
    await m.unmount();
  }
});
