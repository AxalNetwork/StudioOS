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
  const bare = buildCatalogue({ providers: [], firstParty: {} });
  assert.equal(bare.find((p) => p.key === 'microsoft').category, 'Calendar and workspace');
  assert.equal(bare.find((p) => p.key === 'google').category, 'Calendar and workspace');
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

// ---------------------------------------------------------------- GitHub's sync view

import { repoLine, successBanner, syncFinished, syncProgress, syncRefusal } from '../src/pages/account/githubSync.js';
import GithubSyncSheet from '../src/pages/account/GithubSyncSheet.jsx';
import { readFileSync } from 'node:fs';

test('the sync view\'s rules: refusals in the Worker\'s words, a repository\'s line, a percentage only when reported, the banner only from a result', () => {
  assert.equal(syncRefusal({ status: 403, code: 'write_scope_refused', message: 'GitHub grants this connection more than read access. Change the StudioOS app to read-only in GitHub, then choose again.' }),
    'GitHub grants this connection more than read access. Change the StudioOS app to read-only in GitHub, then choose again.', 'the Worker\'s sentence as sent');
  assert.equal(syncRefusal({ status: 403, code: 'company_not_enabled', message: 'Turn Acme on for this connection first.' }), 'Turn Acme on for this connection first.', 'the Worker\'s sentence wins over the table');
  assert.match(syncRefusal({ status: 403, code: 'company_not_enabled', message: 'company_not_enabled' }), /^This connection is not enabled for this project’s company\./, 'a bare code gets its sentence');
  for (const code of ['repositories_not_supported', 'repositories_unreadable', 'project_not_enabled', 'grant_unreadable', 'repositories_required', 'too_many_repositories', 'repository_not_accessible', 'sync_failed']) {
    assert.doesNotMatch(syncRefusal({ code, message: code }), /_/, `${code} reads as a sentence`);
  }
  assert.equal(repoLine({ private: true, updated_at: '2026-10-03T08:00:00Z' }), 'Private · updated 3 Oct');
  assert.equal(repoLine({ private: false, updated_at: null }), 'Public · last update not recorded');
  assert.deepEqual(syncProgress({ state: 'running', pct: 42.4, reading: 'acme/app' }), { state: 'running', pct: 42, reading: 'acme/app' });
  assert.equal(syncProgress({ state: 'idle', pct: null }).pct, null, 'no percentage without one');
  assert.equal(syncProgress(null).state, 'idle');
  assert.equal(syncFinished({ state: 'done' }) && syncFinished({ state: 'failed' }) && !syncFinished({ state: 'running' }), true);
  assert.equal(successBanner('github', { counts: { issues: 12, pull_requests: 1, releases: 3 } }),
    'Synced 12 issues and 1 pull request. Product roadmap and Prototype / MVP now show them. 3 releases were read; Product roadmap has no store for them yet.');
  assert.equal(successBanner('github', { counts: { issues: 0, pull_requests: 4, releases: 0 } }), 'Synced 0 issues and 4 pull requests. Product roadmap and Prototype / MVP now show them.', 'no releases line at 0');
  assert.equal(successBanner('stripe', { summary: 'Synced 40 charges.' }), 'Synced 40 charges.', 'another provider\'s summary as given');
  assert.equal(successBanner('github', null), null, 'no result, no banner');
  assert.equal(successBanner('stripe', {}), null);
});

function fakeGithub(over = {}) {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  let status = { state: 'running', pct: null, reading: 'Reading acme/app' };
  const api = {
    repositories: async (uid, opts) => { calls.push(['repositories', uid, opts ?? null]); return { ok: true, available: [{ full_name: 'acme/app', private: true, updated_at: '2026-10-03T08:00:00Z' }, { full_name: 'acme/site', private: false, updated_at: null }], selected: ['acme/app'], project_id: null }; },
    setRepositories: async (uid, repos, pid, opts) => { calls.push(['setRepositories', uid, repos, pid, opts ?? null]); return { ok: true }; },
    sync: async (uid, opts) => { calls.push(['sync', uid, opts ?? null]); await gate; return { ok: true, summary: 'x', counts: { issues: 2, pull_requests: 1, releases: 0 } }; },
    syncStatus: async () => { calls.push(['syncStatus']); const s = status; status = { state: 'running', pct: 50, reading: 'Reading acme/app' }; return s; },
    ...over,
  };
  return { api, calls, release };
}

test('GitHub\'s sync view: preselected from GET, Sync disabled with nothing chosen, progress read before the sync answers, then the honest banner', async () => {
  const f = fakeGithub();
  const savedFed = connectorsApi.fed;
  connectorsApi.fed = async () => ({ ok: true, modules: [{ module: 'product_roadmap', label: 'Product roadmap', count: 3, linked: 2, unlanded: 1, reason: '1 arrived with no store to land in.', href: '/build/product-roadmap' }, { module: 'prototype_mvp', label: 'Prototype / MVP', count: 1, linked: 1, href: null }] });
  let waits = 0;
  const p = { key: 'github', display_name: 'GitHub' };
  const m = await mount(h(MemoryRouter, null, h(GithubSyncSheet, { p, conn: { uid: 'g1' }, projectId: 7, companyId: 5, eyebrow: 'Build', onClose() {}, api: f.api, wait: async () => { waits += 1; if (waits > 2) f.release(); await new Promise((r) => setTimeout(r, 0)); } })));
  try {
    assert.match(m.text(), /^Build Connect GitHub Choose what StudioOS reads\. You can change this later\./);
    assert.deepEqual(f.calls[0], ['repositories', 'g1', { companyId: 5 }], 'read for the project\'s company');
    assert.equal(m.pr(m.by('repo-acme/app'))['aria-pressed'], true, 'preselected from GET\'s selected');
    assert.equal(m.pr(m.by('repo-acme/site'))['aria-pressed'], false);
    assert.ok(m.text().includes('acme/app Private · updated 3 Oct'));
    assert.ok(m.text().includes('Reads issues, pull requests and releases only.'));
    await m.click('repo-acme/app');
    assert.equal(m.pr(m.by('button-sync-selected')).disabled, true, 'nothing chosen: Sync disabled');
    await m.click('repo-acme/site');
    await m.click('button-sync-selected');
    const order = f.calls.map((c) => c[0]);
    assert.deepEqual(f.calls.find((c) => c[0] === 'setRepositories'), ['setRepositories', 'g1', ['acme/site'], 7, { companyId: 5 }]);
    assert.ok(order.indexOf('syncStatus') > order.indexOf('sync'), 'polled after the sync started…');
    assert.ok(waits >= 1, '…and before it answered: the sync was still held open');
    assert.match(m.text(), /Synced 2 issues and 1 pull request\. Product roadmap and Prototype \/ MVP now show them\./);
    assert.ok(m.text().includes('Product roadmap 1 arrived with no store to land in. 2 items'), 'Now fed by counts the linked items, not every one that arrived');
    assert.equal(m.pr(m.by('fed-open-product_roadmap')).href, '/build/product-roadmap?project_id=7', 'Open carries the project');
    assert.equal(m.by('fed-open-prototype_mvp'), undefined, 'no href, no Open');
  } finally { connectorsApi.fed = savedFed; await m.unmount(); }
});

test('the sync view\'s refusals, in the Worker\'s words; the Connectors page picks a project when none is chosen', async () => {
  const refused = fakeGithub({ repositories: async () => { throw Object.assign(new Error('company_not_enabled'), { status: 403, code: 'company_not_enabled' }); } });
  const a = await mount(h(MemoryRouter, null, h(GithubSyncSheet, { p: { key: 'github', display_name: 'GitHub' }, conn: { uid: 'g1' }, projectId: 7, onClose() {}, api: refused.api })));
  try { assert.match(a.text(a.by('sync-refused')), /^This connection is not enabled for this project’s company\./); } finally { await a.unmount(); }
  const scope = fakeGithub({ setRepositories: async () => { throw Object.assign(new Error('GitHub grants this connection more than read access.'), { status: 403, code: 'write_scope_refused' }); } });
  const b = await mount(h(MemoryRouter, null, h(GithubSyncSheet, { p: { key: 'github', display_name: 'GitHub' }, conn: { uid: 'g1' }, projectId: 7, onClose() {}, api: scope.api })));
  try {
    await b.click('button-sync-selected');
    assert.equal(b.text(b.by('sync-error')), 'GitHub grants this connection more than read access.');
    assert.equal(scope.calls.some((c) => c[0] === 'sync'), false, 'nothing synced after a refused choice');
  } finally { await b.unmount(); }
  const failed = fakeGithub({ sync: async () => { throw Object.assign(new Error('The sync did not complete. Check the connection and try again.'), { status: 502, code: 'sync_failed' }); } });
  const c = await mount(h(MemoryRouter, null, h(GithubSyncSheet, { p: { key: 'github', display_name: 'GitHub' }, conn: { uid: 'g1' }, projectId: 7, onClose() {}, api: failed.api, wait: async () => {} })));
  try {
    await c.click('button-sync-selected');
    assert.equal(c.text(c.by('sync-error')), 'The sync did not complete. Check the connection and try again.');
    assert.equal(c.by('connect-success-banner'), undefined, 'no result, no banner');
  } finally { await c.unmount(); }
  const pick = fakeGithub();
  const listed = [];
  const d = await mount(h(MemoryRouter, null, h(GithubSyncSheet, { p: { key: 'github', display_name: 'GitHub' }, conn: { uid: 'g1' }, onClose() {}, api: pick.api, wait: async () => { pick.release(); }, projectsApi: { listProjects: async () => { listed.push(1); return [{ id: 3, name: 'Acme' }, { id: 4, name: 'Beta' }]; } } })));
  try {
    assert.equal(listed.length, 1, 'no project from Build or GET: the member\'s projects are read');
    assert.equal(d.pr(d.by('button-sync-selected')).disabled, true, 'no project yet: nothing can sync');
    await act(async () => { d.pr(d.by('sync-project-select')).onChange({ target: { value: '4' } }); });
    await d.click('button-sync-selected');
    assert.equal(pick.calls.find((x) => x[0] === 'setRepositories')[3], 4);
    assert.equal(pick.calls.find((x) => x[0] === 'setRepositories')[4], null, 'no company header off Build');
  } finally { await d.unmount(); }
  const src = readFileSync('frontend/src/lib/api/connectors.js', 'utf8');
  assert.match(src, /setRepositories: \(uid, repositories, projectId, opts\) => request\(`\/connectors\/\$\{enc\(uid\)\}\/repositories`, \{\s*method: 'PUT', body: JSON\.stringify\(\{ repositories, project_id: projectId \}\), \.\.\.co\(opts\),/);
  assert.match(src, /syncStatus: \(uid\) => request\(`\/connectors\/\$\{enc\(uid\)\}\/sync-status`\)/);
  assert.match(src, /const co = \(opts\) => \(opts\?\.companyId \? \{ headers: \{ 'X-Company-Id': String\(opts\.companyId\) \} \} : \{\}\);/);
  assert.doesNotMatch(readFileSync('frontend/src/pages/account/ConnectToolSheet.jsx', 'utf8'), /is not built here/, 'the old note is gone');
});

// ---------------------------------------------------------------- the project's company

import { companiesWith, companyBanner, projectCompany, servesCompany } from '../src/pages/account/connectorsModel.js';

test('the project\'s company decides whom Build connects for', () => {
  const companies = [{ id: 5, company_name: 'Acme' }, { id: 9, company_name: 'Beta' }];
  assert.deepEqual(projectCompany({ id: 7, company_id: 5 }, companies), { state: 'ok', companyId: 5, name: 'Acme' });
  assert.deepEqual(projectCompany({ id: 7, company_id: null }, companies), { state: 'none', companyId: null, name: null });
  assert.deepEqual(projectCompany({ id: 7, company_id: 12 }, companies), { state: 'outside', companyId: 12, name: null });
  assert.equal(projectCompany(null, companies).state, 'unreadable');
  assert.equal(projectCompany({ company_id: 5 }, null).state, 'unreadable', 'memberships unread: not guessed');
  assert.equal(projectCompany(undefined, companies).state, 'loading');
  assert.equal(companyBanner({ state: 'none' }), 'This project has no company, so connected tools cannot feed it.');
  assert.match(companyBanner({ state: 'outside' }), /^You are not a member of this project’s company/);
  assert.equal(companyBanner({ state: 'ok' }), null);
  assert.equal(servesCompany({ company_ids: [9] }, 5), false);
  assert.equal(servesCompany({ company_ids: [9, 5] }, 5), true);
  assert.equal(servesCompany({ first_party: true }, 5), null, 'first-party connections are personal');
  assert.deepEqual(companiesWith({ company_ids: [9, 3] }, 5), [9, 3, 5], 'the PUT replaces the set: the enabled ones go too');
  assert.deepEqual(companiesWith({ company_ids: [5] }, 5), [5]);
});

test('Build\'s list for the project\'s company: Use for it keeps the others, outside it nothing connects, the teammate is looked up for it', async () => {
  const cat = buildCatalogue({
    providers: [
      { key: 'hubspot', display_name: 'HubSpot', category: 'CRM', status: 'live', has_implementation: true },
      { key: 'calendly', display_name: 'Calendly', category: 'Calendar', status: 'live', has_implementation: true },
    ],
    items: [{ uid: 'u-hub', provider_key: 'hubspot', status: 'active', company_ids: [9], last_synced_at: ago(3600000) }],
    firstParty: {},
  });
  const companies = [{ id: 5, company_name: 'Acme' }, { id: 9, company_name: 'Beta' }];
  const saved = { setCompanies: connectorsApi.setCompanies, teammate: connectorsApi.teammate, oauthStart: connectorsApi.oauthStart };
  const calls = [];
  let reloads = 0;
  connectorsApi.oauthStart = async (key, params, opts) => { calls.push(['oauthStart', key, opts ?? null]); return {}; };
  connectorsApi.setCompanies = async (uid, ids) => { calls.push(['setCompanies', uid, ids]); return { ok: true }; };
  connectorsApi.teammate = async (key, opts) => { calls.push(['teammate', key, opts ?? null]); return { teammate: { name: 'Ana' } }; };
  const view = (project) => h(MemoryRouter, null, h(ConnectToolView, { data: { status: 'ready', catalogue: cat, companies, reload: () => { reloads += 1; } }, project, projectId: 7, onClose() {} }));
  const m = await mount(view({ id: 7, company_id: 5 }));
  try {
    assert.equal(m.by('connect-tool-company-ok'), undefined, 'no banner when Build can connect');
    assert.equal(m.text(m.by('tool-action-hubspot')), 'Use for Acme');
    await m.click('tool-action-hubspot');
    assert.deepEqual(calls[0], ['setCompanies', 'u-hub', [9, 5]], 'Beta stays on, Acme is added');
    assert.equal(reloads, 1);
    await m.click('tool-action-calendly');
    assert.deepEqual(calls.at(-1), ['teammate', 'calendly', { companyId: 5 }], 'asked for the project\'s company, not the sidebar\'s');
    assert.ok(m.text().includes('Ana already connected Calendly for Acme. Use theirs, or connect your own.'));
    await m.click('button-connect-own');
    await m.click('button-connect-continue');
    assert.deepEqual(calls.at(-1), ['oauthStart', 'calendly', { companyId: 5 }], 'the sign-in starts for the project\'s company');
  } finally { await m.unmount(); }
  const out = await mount(view({ id: 7, company_id: 12 }));
  try {
    assert.match(out.text(out.by('connect-tool-company-outside')), /^You are not a member of this project’s company/);
    assert.equal(out.by('tool-action-calendly'), undefined, 'outside the company: no Connect');
  } finally { await out.unmount(); }
  const none = await mount(view({ id: 7, company_id: null }));
  try {
    assert.equal(none.text(none.by('connect-tool-company-none')), 'This project has no company, so connected tools cannot feed it.');
    assert.equal(none.text(none.by('tool-action-calendly')), 'Connect', 'still connectable, for the member');
  } finally { Object.assign(connectorsApi, saved); await none.unmount(); }
});

// ---------------------------------------------------------------- core systems and the Tools history

import { EDITS, SYSTEM_KINDS, UNMAP, systemOptions } from '../src/pages/cycles/forms.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';
import RecordFormSheet from '../src/pages/cycles/RecordFormSheet.jsx';
import ToolsHistory from '../src/pages/cycles/ToolsHistory.jsx';
import { renderToStaticMarkup } from 'react-dom/server';

const CHOICES = { kinds: [
  { kind: 'crm', label: 'CRM', choices: [{ uid: 'u-hub', provider_key: 'hubspot', display_name: 'HubSpot', category: 'CRM' }] },
  { kind: 'workspace', label: 'Workspace', choices: [{ uid: null, provider_key: 'google_calendar', display_name: 'Google Calendar' }] },
  { kind: 'bank', label: 'Bank', choices: [] },
] };

test('a core system\'s connector: its choices, unmapping, the body each kind takes, and no Edit without a company', () => {
  const edit = EDITS.build['operating-systems'];
  assert.equal(edit.button, 'Choose connector');
  assert.deepEqual(SYSTEM_KINDS, ['bank', 'accounting', 'payroll', 'crm', 'workspace']);
  assert.equal(edit.idOf({ id: 'crm' }), 'crm', 'the row\'s id is its kind');
  assert.equal(edit.idOf({ id: 'product_analytics' }), null, 'not a kind: no Edit');
  assert.equal(edit.idOf({ id: 4 }), null);
  assert.deepEqual(systemOptions(CHOICES, 'crm'), { options: [{ value: 'uid:u-hub', label: 'HubSpot' }, { value: UNMAP, label: '— None (unmap) —' }], note: null });
  assert.deepEqual(systemOptions(CHOICES, 'workspace').options[0], { value: 'provider:google_calendar', label: 'Google Calendar' });
  assert.deepEqual(systemOptions(CHOICES, 'bank'), { options: [{ value: UNMAP, label: '— None (unmap) —' }], note: { text: 'No connected Bank tool is enabled for this company.', href: '/build/connect' } });
  assert.deepEqual(edit.toBody({ choice: 'uid:u-hub', used_by: ' Sales ' }, 'crm'), { integration_uid: 'u-hub', used_by: 'Sales' });
  assert.deepEqual(edit.toBody({ choice: 'provider:microsoft_365', used_by: '' }, 'workspace'), { provider_key: 'microsoft_365', used_by: null });
  assert.deepEqual(edit.toBody({ choice: UNMAP, used_by: '' }, 'crm'), { integration_uid: null, used_by: null }, 'unmap a connector kind');
  assert.deepEqual(edit.toBody({ choice: UNMAP, used_by: '' }, 'workspace'), { provider_key: null, used_by: null }, 'unmap Workspace by its key');
  assert.equal(edit.hiddenFor({ card: { state: 'not_recorded' } }), true, 'no company: no row action');
  assert.equal(edit.hiddenFor({ card: { state: 'ok' } }), false);
  assert.equal(edit.valuesOf({ cells: { used_by: 'Finance' } }).used_by, 'Finance');
  const calls = [];
  const w = makeCycleWrites((path, opts) => { calls.push([path, opts?.method || 'GET', opts?.body ? JSON.parse(opts.body) : null]); return Promise.resolve(CHOICES); });
  edit.submit(w, 7, 'crm', { choice: 'uid:u-hub', used_by: 'Sales' });
  w.build.systemChoices(7);
  assert.deepEqual(calls, [
    ['/cycles/build/systems/crm?project=7', 'PUT', { integration_uid: 'u-hub', used_by: 'Sales' }],
    ['/cycles/build/systems/choices?project=7', 'GET', null],
  ]);
});

test('the mapping sheet reads the choices before it draws, validates against them, and says when there is none', async () => {
  const edit = EDITS.build['operating-systems'];
  let resolve;
  const loading = new Promise((r) => { resolve = r; });
  const sent = [];
  const m = await mount(h(MemoryRouter, null, h(RecordFormSheet, {
    form: edit, current: edit.valuesOf({ cells: { used_by: 'Finance' } }), cycle: 'Build',
    loadOptions: () => loading.then(() => edit.loadOptions({ build: { systemChoices: async () => CHOICES } }, 7, 'bank')),
    onSubmit: async (v) => { sent.push(v); }, onClose() {},
  })));
  try {
    assert.ok(m.by('cycle-form-loading'), 'nothing to choose from until the choices are read');
    assert.equal(m.pr(m.by('cycle-form-save')).disabled, true);
    resolve();
    await m.settle();
    assert.equal(m.by('cycle-form-loading'), undefined);
    assert.equal(m.text(m.by('cycle-form-note-choice')), 'No connected Bank tool is enabled for this company. Connect a tool');
    await act(async () => { m.pr(m.by('cycle-form-save')).onClick?.(); });
    const form = (n) => (n.tagName === 'FORM' ? n : null);
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const f = walk(document.body).map(form).find(Boolean);
    await act(async () => { await m.pr(f).onSubmit({ preventDefault() {} }); });
    assert.deepEqual(sent, [], 'no choice made: nothing is sent');
    assert.ok(m.text().includes('Connector is required.'));
    await act(async () => { m.pr(walk(document.body).find((n) => m.pr(n).id === 'cycle-form-choice')).onChange({ target: { value: 'uid:someone-else' } }); });
    await act(async () => { await m.pr(f).onSubmit({ preventDefault() {} }); });
    assert.deepEqual(sent, [], 'a value the read did not offer is refused before sending');
    assert.ok(m.text().includes('Pick one of the choices for connector.'));
    await act(async () => { m.pr(walk(document.body).find((n) => m.pr(n).id === 'cycle-form-choice')).onChange({ target: { value: UNMAP } }); });
    await act(async () => { await m.pr(f).onSubmit({ preventDefault() {} }); });
    assert.deepEqual(sent, [{ choice: UNMAP, used_by: 'Finance' }], 'unmapping is a choice');
  } finally { await m.unmount(); }
});

test('the Tools history on Operating systems: one row per connection with its Open link, the Worker\'s reason without a company, and the note', () => {
  const tools = {
    cols: [{ key: 'tool', label: 'Tool' }, { key: 'state', label: 'State' }, { key: 'owner', label: 'Owner' }, { key: 'action', label: 'Action' }],
    rows: [{ id: 'tool-0', cells: { tool: 'HubSpot', state: 'Failing', owner: 'You', action: { text: 'Open', href: '/build/connect?tool=hubspot' } } }, { id: 'tool-1', cells: { tool: 'Stripe', state: 'Connected', owner: null, action: null } }],
    total: 2, state: 'ok', note: 'Google Calendar and Microsoft 365 are personal connections and are listed only in Connect a tool.',
  };
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(ToolsHistory, { tools })));
  assert.match(out, /<section id="tools"/, 'anchored, for the Tools tab');
  assert.match(out, /href="\/build\/connect\?tool=hubspot"[^>]*>Open</);
  assert.equal((out.match(/data-testid="tools-row-/g) || []).length, 2);
  assert.match(out, />Not recorded</, 'an owner the viewer may not see is not named, and says so');
  assert.match(out, /data-testid="tools-note"[^>]*>Google Calendar and Microsoft 365 are personal connections/);
  assert.match(out, />2 tools</);
  const none = renderToStaticMarkup(h(MemoryRouter, null, h(ToolsHistory, { tools: { cols: tools.cols, rows: [], total: null, state: 'not_recorded', reason: 'This project has no company scope for connectors.' } })));
  assert.match(none, /data-testid="tools-not-recorded"[^>]*>This project has no company scope for connectors\./);
  assert.doesNotMatch(none, /tools<\/span>/, 'no count without a company');
  assert.equal(renderToStaticMarkup(h(ToolsHistory, { tools: null })), '', 'no part, nothing drawn');
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.match(route, /'operating-systems': \(data\) => <ToolsHistory tools=\{data\?\.parts\?\.tools\} \/>/);
  assert.match(route, /loadOptions=\{edit\.loadOptions \? \(\) => edit\.loadOptions\(cyclesWrite, projectId, edit\.idOf\(editing\)\) : null\}/);
});

import { moduleHref } from '../src/pages/account/ConnectorSheet.jsx';

test('a fed module\'s Open link stays inside StudioOS and carries the project', () => {
  assert.equal(moduleHref('/build/roadmap', 7), '/build/roadmap?project_id=7');
  assert.equal(moduleHref('/build/roadmap?project_id=3', 7), '/build/roadmap?project_id=3');
  assert.equal(moduleHref('/build/roadmap', null), '/build/roadmap');
  for (const bad of ['//evil.example/x', 'https://evil.example/x', 'build/roadmap', null]) assert.equal(moduleHref(bad, 7), null, `${bad} is not a StudioOS path`);
});

// ---------------------------------------------------------------- S1's review of 2026-10-14 (#1597)

import {
  BUILD_PROJECT_KEY, FREE_KEEPS_CONNECTORS, FREE_KEEPS_TOOLS, coreSystemOffer, failedAt, keepBuildProject, takeBuildProject, toolDeepLink,
} from '../src/pages/account/connectorsModel.js';
import { startFirstParty } from '../src/pages/account/ConnectorSheet.jsx';
import { cyclesWrite } from '../src/lib/api/cycles.js';

test('a deep link opens one tool where its row would; a sign-in\'s return opens its view; only catalogue keys open anything', () => {
  assert.deepEqual(toolDeepLink('?tool=stripe&project_id=7', ROWS), { panel: { key: 'stripe', view: 'detail', ret: {} }, strip: ['tool'] }, 'connected: its detail');
  assert.deepEqual(toolDeepLink('?tool=hubspot', ROWS).panel.view, 'pre', 'failing: the reconnect flow');
  assert.deepEqual(toolDeepLink('?tool=figma', ROWS).panel, { key: 'figma', view: 'pre', ret: {} }, 'not connected: the flow');
  assert.deepEqual(toolDeepLink('?tool=STRIPE', ROWS).panel.key, 'stripe');
  assert.deepEqual(toolDeepLink('?tool=nope', ROWS), { panel: null, strip: ['tool'] }, 'an unknown key opens nothing, and is still stripped');
  assert.deepEqual(toolDeepLink('?tool=constructor', ROWS).panel, null);
  assert.equal(toolDeepLink('?project_id=7', ROWS), null, 'nothing to open, nothing to strip');
  assert.equal(toolDeepLink('', ROWS), null);
  const back = toolDeepLink('?oauth=ok&provider=github&project_id=7', ROWS);
  assert.deepEqual([back.panel.key, back.panel.view, back.strip], ['github', 'sync', ['oauth', 'provider', 'reason']], 'GitHub returns to choosing its repositories');
  assert.equal(back.panel.ret.view, 'sync', 'the return rides on the panel');
  assert.deepEqual(toolDeepLink('?oauth=error&provider=hubspot&reason=access_denied', ROWS).panel.view, 'cancelled');
  assert.deepEqual(toolDeepLink('?oauth=ok&provider=nope', ROWS), { panel: null, strip: ['oauth', 'provider', 'reason'] }, 'a provider the catalogue lacks opens nothing');
  assert.equal(toolDeepLink('?oauth=ok&provider=github', null).panel, null, 'no catalogue: nothing opens');
});

test('the venture is kept across a sign-in and taken back once', () => {
  const store = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const s = store();
  keepBuildProject(7, s);
  assert.equal(s.m.get(BUILD_PROJECT_KEY), '7');
  assert.equal(takeBuildProject(s), 7);
  assert.equal(takeBuildProject(s), null, 'taken once');
  for (const bad of [null, 0, -3, 'x', 1.5]) { keepBuildProject(bad, s); assert.equal(s.m.size, 0, `${bad} is not kept`); }
  s.m.set(BUILD_PROJECT_KEY, 'abc');
  assert.equal(takeBuildProject(s), null, 'a stored value that is no id is dropped');
  assert.equal(s.m.size, 0);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => keepBuildProject(7, broken));
  assert.equal(takeBuildProject(broken), null, 'storage off: no venture, no error');
  assert.equal(takeBuildProject(null), null);
});

test('the failed banner says when the sync failed, in the viewer\'s zone; without a time it keeps the last good sync', () => {
  assert.equal(failedAt('2026-10-03 14:05:00', 'UTC'), '3 Oct · 14:05', 'the Worker\'s UTC time without a zone');
  const tz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles'; // a machine away from UTC: the zone-less time is still read as UTC
  try { assert.equal(failedAt('2026-10-03 14:05:00', 'UTC'), '3 Oct · 14:05'); } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
  assert.equal(failedAt('2026-10-03T14:05:00Z', 'UTC'), '3 Oct · 14:05');
  assert.equal(failedAt('2026-10-03T23:30:00Z', 'Asia/Tokyo'), '4 Oct · 08:30', 'drawn in the viewer\'s zone');
  assert.equal(failedAt('2026-10-03T14:05:00+02:00', 'UTC'), '3 Oct · 12:05');
  for (const bad of [null, '', 'yesterday', undefined]) assert.equal(failedAt(bad, 'UTC'), null);
  const cat = (items, feeds = ['capital_relationships']) => buildCatalogue({ providers: [{ key: 'hubspot', display_name: 'HubSpot', category: 'CRM', status: 'live', has_implementation: true, feeds }], items, firstParty: {} });
  assert.deepEqual(toolBanner(cat([{ uid: 'u', provider_key: 'hubspot', status: 'error', last_error: 'invalid_grant', last_error_at: '2026-10-03 14:05:00', last_synced_at: ago(DAY) }]), { timeZone: 'UTC' }),
    { tone: 'danger', view: 'failed', key: 'hubspot', text: 'HubSpot sync failed at 3 Oct · 14:05. Capital relationships shows the last good data.' });
  assert.equal(toolBanner(cat([{ uid: 'u', provider_key: 'hubspot', status: 'error', last_error_at: '2026-10-03 14:05:00' }], ['capital_relationships', 'network']), { timeZone: 'UTC' }).text,
    'HubSpot sync failed at 3 Oct · 14:05. Capital relationships, Network show the last good data.', 'two modules: show');
  assert.equal(toolBanner(cat([{ uid: 'u', provider_key: 'hubspot', status: 'error', last_error_at: '2026-10-03 14:05:00' }], []), { timeZone: 'UTC' }).text,
    'HubSpot sync failed at 3 Oct · 14:05. What it feeds shows the last good data.', 'no feeds recorded: no module is named');
  assert.match(toolBanner(cat([{ uid: 'u', provider_key: 'hubspot', status: 'error', last_error: 'invalid_grant', last_synced_at: ago(DAY) }])).text,
    /^HubSpot: .+\. The last good sync was .+; what it feeds keeps the last good data\.$/, 'no failure time: the last good sync is the sentence');
});

test('Free keeps what is connected: the locked banner and the paid-plan panel say so (a manual sync has no tier gate since #1611)', () => {
  assert.equal(FREE_KEEPS_TOOLS, 'Free keeps every tool you have already connected.');
  assert.equal(FREE_KEEPS_CONNECTORS, 'Free keeps every connector you already have.');
  const locked = toolBanner(ROWS.filter((p) => p.key === 'carta'));
  assert.equal(locked.text, `Cap table connections are part of the Studio plan. ${FREE_KEEPS_TOOLS}`);
});

test('the first-party sign-ins and the registry\'s come back to Build when started there', async () => {
  const calls = [];
  const client = {
    googleCalConnect: async (b) => { calls.push(['google', b]); return { redirect_url: 'https://g' }; },
    microsoftCalConnect: async (b) => { calls.push(['microsoft', b]); return { auth_url: 'https://m' }; },
    linkedinOAuthStart: async (b) => { calls.push(['linkedin', b]); return { authorize_url: 'https://l' }; },
  };
  assert.equal(await startFirstParty('google', 'build', client), 'https://g');
  assert.equal(await startFirstParty('microsoft', 'build', client), 'https://m');
  assert.equal(await startFirstParty('linkedin', 'build', client), 'https://l');
  await startFirstParty('google', undefined, client);
  await startFirstParty('google', 'evil', client);
  assert.deepEqual(calls, [['google', { return_to: 'build' }], ['microsoft', { return_to: 'build' }], ['linkedin', { return_to: 'build' }], ['google', { return_to: 'integrations' }], ['google', { return_to: 'integrations' }]]);
});

test('Use as your <kind>: only one unmapped kind the Worker says fits, keeping its Used by', () => {
  const hub = { key: 'hubspot', display_name: 'HubSpot' };
  const read = (crm = {}) => ({ kinds: [
    { kind: 'bank', label: 'Bank', mapped: false, used_by: null, choices: [] },
    { kind: 'crm', label: 'CRM', mapped: false, used_by: 'Sales', choices: [{ uid: 'u-hub', provider_key: 'hubspot', display_name: 'HubSpot' }], ...crm },
    { kind: 'workspace', label: 'Workspace', mapped: false, used_by: null, choices: [{ uid: null, provider_key: 'google_calendar', display_name: 'Google Calendar' }] },
  ] });
  assert.deepEqual(coreSystemOffer(read(), hub, { uid: 'u-hub' }), { kind: 'crm', label: 'CRM', body: { integration_uid: 'u-hub', used_by: 'Sales' } });
  assert.equal(coreSystemOffer(read({ mapped: true }), hub, { uid: 'u-hub' }), null, 'already mapped: nothing offered');
  assert.equal(coreSystemOffer(read({ mapped: undefined }), hub, { uid: 'u-hub' }), null, 'a read that does not say: nothing offered');
  assert.equal(coreSystemOffer(read(), hub, { uid: 'u-other' }), null, 'a connection the choices do not hold');
  assert.equal(coreSystemOffer(read(), hub, null), null);
  const two = read(); two.kinds[0].choices = [{ uid: 'u-hub', provider_key: 'hubspot' }];
  assert.equal(coreSystemOffer(two, hub, { uid: 'u-hub' }), null, 'two kinds fit: the founder chooses on Operating systems');
  assert.deepEqual(coreSystemOffer(read(), { key: 'google', display_name: 'Google Calendar' }, { first_party: true }), { kind: 'workspace', label: 'Workspace', body: { provider_key: 'google_calendar', used_by: null } }, 'Google is the Workspace provider');
  assert.equal(coreSystemOffer(null, hub, { uid: 'u-hub' }), null);
  assert.deepEqual(systemOptions(CHOICES, 'bank', 7).note, { text: 'No connected Bank tool is enabled for this company.', href: '/build/connect?project_id=7' }, 'the no-choice note keeps the venture');
  assert.equal(systemOptions(CHOICES, 'bank', 'x').note.href, '/build/connect');
});

test('Build\'s lightbox: a deep link opens its tool, Try again syncs for the project\'s company, a sign-in returns to Build with the venture kept', async () => {
  const cat = buildCatalogue({
    providers: [
      { key: 'hubspot', display_name: 'HubSpot', category: 'CRM', status: 'live', auth_type: 'oauth2', has_implementation: true },
      { key: 'salesforce', display_name: 'Salesforce', category: 'CRM', status: 'live', has_implementation: true },
    ],
    items: [{ uid: 'u-sf', provider_key: 'salesforce', status: 'error', last_error: 'HTTP 500 upstream', company_ids: [5], last_synced_at: ago(DAY) }],
    firstParty: {},
  });
  const companies = [{ id: 5, company_name: 'Acme' }];
  const saved = { sync: connectorsApi.sync, oauthStart: connectorsApi.oauthStart, teammate: connectorsApi.teammate };
  const kept = globalThis.sessionStorage;
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const calls = [];
  connectorsApi.sync = async (uid, opts) => { calls.push(['sync', uid, opts ?? null]); return { ok: true }; };
  connectorsApi.oauthStart = async (key, params, opts) => { calls.push(['oauthStart', key, params, opts ?? null]); return {}; };
  connectorsApi.teammate = async () => ({ teammate: null });
  const data = { status: 'ready', catalogue: cat, companies, reload() {} };
  const m = await mount(h(MemoryRouter, null, h(ConnectToolView, { data, project: { id: 7, company_id: 5 }, projectId: 7, onClose() {} })));
  try {
    await m.click('tool-action-salesforce');
    assert.deepEqual(calls[0], ['sync', 'u-sf', { companyId: 5 }], 'the project\'s company, not the sidebar\'s');
    await m.unmount();
    const linked = await mount(h(MemoryRouter, null, h(ConnectToolView, { data, project: { id: 7, company_id: 5 }, projectId: 7, onClose() {}, deepLink: '?tool=hubspot' })));
    try {
      assert.ok(linked.by('button-connect-continue'), '?tool=hubspot opens HubSpot\'s flow');
      await linked.click('button-connect-continue');
      assert.deepEqual(calls.at(-1), ['oauthStart', 'hubspot', { return_to: 'build' }, { companyId: 5 }], 'the sign-in returns to /build/connect');
      assert.equal(store.get(BUILD_PROJECT_KEY), '7', 'and the venture is kept for it');
    } finally { await linked.unmount(); }
  } finally {
    Object.assign(connectorsApi, saved);
    if (kept === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = kept;
  }
});

test('the success view: Use as your CRM writes the mapping, and Now fed by\'s Open links keep the venture and close the lightbox', async () => {
  const cat = buildCatalogue({
    providers: [{ key: 'hubspot', display_name: 'HubSpot', category: 'CRM', status: 'live', auth_type: 'oauth2', has_implementation: true }],
    items: [{ uid: 'u-hub', provider_key: 'hubspot', status: 'active', company_ids: [5], last_synced_at: ago(60000) }],
    firstParty: {},
  });
  const saved = { fed: connectorsApi.fed };
  const savedW = { systemChoices: cyclesWrite.build.systemChoices, system: cyclesWrite.build.system };
  const calls = [];
  let closed = 0;
  let answer = null;
  connectorsApi.fed = async () => ({ modules: [{ module: 'capital_relationships', label: 'Capital relationships', linked: 3, href: '/raise/capital-relationships' }] });
  cyclesWrite.build.systemChoices = async (projectId) => { calls.push(['choices', projectId]); return { kinds: [{ kind: 'crm', label: 'CRM', mapped: false, used_by: 'Sales', choices: [{ uid: 'u-hub', provider_key: 'hubspot' }] }] }; };
  cyclesWrite.build.system = async (projectId, kind, body) => { calls.push(['system', projectId, kind, body]); if (answer) throw answer; return { ok: true }; };
  const data = { status: 'ready', catalogue: cat, companies: [{ id: 5, company_name: 'Acme' }], reload() {} };
  const m = await mount(h(MemoryRouter, null, h(ConnectToolView, { data, project: { id: 7, company_id: 5 }, projectId: 7, onClose() { closed += 1; }, deepLink: '?oauth=ok&provider=hubspot' })));
  try {
    assert.match(m.text(), /HubSpot is connected/);
    assert.equal(m.pr(m.by('fed-open-capital_relationships')).href, '/raise/capital-relationships?project_id=7', 'the Open link keeps the venture');
    await m.click('fed-open-capital_relationships');
    assert.equal(closed, 1, 'and closes the lightbox');
    assert.deepEqual(calls[0], ['choices', 7]);
    answer = Object.assign(new Error('That connector is not a crm tool.'), { status: 400 });
    await m.click('button-use-as-crm');
    assert.match(m.text(), /That connector is not a crm tool\./, 'a refusal in the Worker\'s words');
    answer = null;
    await m.click('button-use-as-crm');
    assert.deepEqual(calls.at(-1), ['system', 7, 'crm', { integration_uid: 'u-hub', used_by: 'Sales' }]);
    assert.match(m.text(), /HubSpot is now your CRM\./);
    assert.equal(m.by('button-use-as-crm'), undefined, 'done: no second write');
    await m.click('button-connected-done');
    assert.equal(closed, 2, 'Done closes the lightbox, not only the tool');
  } finally {
    Object.assign(connectorsApi, saved);
    Object.assign(cyclesWrite.build, savedW);
    await m.unmount();
  }
});

import { useLocation } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import ConnectToolSheet from '../src/pages/account/ConnectToolSheet.jsx';
import { useProject } from '../src/pages/cycles/CycleRoute.jsx';

/** Prints the address, so a test sees what the page wrote into it. */
function Where() { const l = useLocation(); return h('i', { 'data-testid': 'where' }, `${l.pathname}${l.search}`); }

test('back from a sign-in at /build/connect with no venture named, Build takes the kept one; a named one wins', async () => {
  const saved = api.listProjects;
  const lists = [];
  api.listProjects = async () => { lists.push(1); return [{ id: 3 }]; };
  function Probe({ kept }) { const r = useProject(0, { kept }); return h('b', { 'data-testid': 'probe' }, `${r.projectId}:${r.status}`); }
  const run = async (entry, kept) => {
    const m = await mount(h(MemoryRouter, { initialEntries: [entry] }, h(Probe, { kept }), h(Where)));
    const out = [m.text(m.by('probe')), m.text(m.by('where'))];
    await m.unmount();
    return out;
  };
  try {
    let takes = 0;
    const take = () => { takes += 1; return 7; };
    assert.deepEqual(await run('/build/connect?oauth=ok&provider=hubspot', take), ['7:ready', '/build/connect?oauth=ok&provider=hubspot&project_id=7'], 'the kept venture, written into the address');
    assert.equal(lists.length, 0, 'no guess from the project list');
    assert.equal(takes, 1, 'taken once');
    assert.deepEqual(await run('/build/connect?project_id=9', take), ['9:ready', '/build/connect?project_id=9'], 'a named venture wins');
    assert.equal(takes, 1, 'and the kept one is left alone');
    assert.deepEqual(await run('/build/connect', () => null), ['3:ready', '/build/connect?project_id=3'], 'nothing kept: the first venture');
    assert.deepEqual(await run('/build/connect', null), ['3:ready', '/build/connect?project_id=3']);
  } finally { api.listProjects = saved; }
});

test('/build/connect?tool=<key> opens that tool once, and the key leaves the address while the venture stays', async () => {
  const savedApi = { getProject: api.getProject, googleCalStatus: api.googleCalStatus, microsoftCalStatus: api.microsoftCalStatus, linkedinStatus: api.linkedinStatus, listMyCompanies: api.listMyCompanies };
  const savedC = { available: connectorsApi.available, list: connectorsApi.list, waitlist: connectorsApi.waitlist, suggestions: connectorsApi.suggestions };
  Object.assign(api, {
    getProject: async () => ({ id: 7, company_id: 5 }), googleCalStatus: async () => ({ configured: false }), microsoftCalStatus: async () => ({ configured: false }),
    linkedinStatus: async () => null, listMyCompanies: async () => [{ id: 5, company_name: 'Acme' }],
  });
  Object.assign(connectorsApi, {
    available: async () => ({ providers: [{ key: 'stripe', display_name: 'Stripe', category: 'Payments', status: 'live', has_implementation: true }] }),
    list: async () => ({ items: [{ uid: 'u-str', provider_key: 'stripe', status: 'active', company_ids: [5], last_synced_at: ago(60000) }] }),
    waitlist: async () => ({ items: [] }), suggestions: async () => ({ suggestions: [] }),
  });
  const m = await mount(h(MemoryRouter, { initialEntries: ['/build/connect?tool=stripe&project_id=7'] }, h(ConnectToolSheet, { projectId: 7, onClose() {} }), h(Where)));
  try {
    await m.settle();
    assert.ok(m.text().includes('On disconnect:'), 'Stripe\'s detail is open');
    assert.equal(m.text(m.by('where')), '/build/connect?project_id=7', 'tool= is stripped, project_id stays');
  } finally {
    Object.assign(api, savedApi);
    Object.assign(connectorsApi, savedC);
    await m.unmount();
  }
});

test('the frame: one lightbox; × and Done close it all; Escape steps back from a tool and closes from the list', async () => {
  // The stub DOM gains what the Lightbox needs to join the Escape stack:
  // `querySelector` on each node, and the document's keydown listeners.
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const make = document.createElement.bind(document);
  document.createElement = (tag) => Object.assign(make(tag), { querySelector: () => null, querySelectorAll: () => [], focus() {} });
  document.body = document.createElement('body');
  const keys = new Set();
  document.addEventListener = (type, fn) => { if (type === 'keydown') keys.add(fn); };
  document.removeEventListener = (type, fn) => { if (type === 'keydown') keys.delete(fn); };
  const escape = () => act(async () => { const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of [...keys]) fn(e); });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const click = async (id) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); };
  const saved = { fed: connectorsApi.fed };
  connectorsApi.fed = async () => ({ modules: [] });
  let closed = 0;
  const data = { status: 'ready', catalogue: ROWS, reload() {} };
  try {
    await act(async () => { root.render(h(MemoryRouter, null, h(ConnectToolView, { data, onClose() { closed += 1; } }))); });
    await settle();
    const dialogs = () => walk(container).filter((n) => pr(n).role === 'dialog');
    assert.equal(dialogs().length, 1, 'one dialog: the list');
    assert.equal(pr(dialogs()[0])['data-testid'], 'connect-tool-lightbox');
    assert.equal(pr(dialogs()[0])['aria-label'], 'Connect a tool');
    assert.ok(by('connect-tool-sheet'), 'the list is the ActionSheet');
    await click('tool-name-stripe');
    assert.equal(dialogs().length, 1, 'a tool opens inside the same lightbox');
    assert.equal(by('connect-tool-sheet'), undefined);
    assert.equal(walk(container).filter((n) => pr(n)['data-layout'] === 'lightbox').length, 1, 'the panel draws only its header, body and footer');
    await escape(); await settle();
    assert.equal(closed, 0, 'Escape from a tool steps back');
    assert.ok(by('connect-tool-sheet'), 'to the list');
    await escape(); await settle();
    assert.equal(closed, 1, 'Escape from the list closes');
    await click('tool-name-stripe');
    await click('sheet-close');
    assert.equal(closed, 2, 'the tool\'s × closes the lightbox, not only the tool');
  } finally {
    connectorsApi.fed = saved.fed;
    await act(async () => root.unmount());
    restore();
  }
});
