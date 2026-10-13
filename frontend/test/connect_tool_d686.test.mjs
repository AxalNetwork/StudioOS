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

// ---------------------------------------------------------------- GitHub's sync view

import { repoLine, successBanner, syncFinished, syncProgress, syncRefusal } from '../src/pages/account/githubSync.js';
import GithubSyncSheet from '../src/pages/account/GithubSyncSheet.jsx';
import { readFileSync } from 'node:fs';

test('the sync view\'s rules: refusals in the Worker\'s words, a repository\'s line, a percentage only when reported, the banner only from a result', () => {
  assert.equal(syncRefusal({ status: 403, code: 'write_scope_refused', message: 'GitHub grants this connection more than read access. Change the StudioOS app to read-only in GitHub, then choose again.' }),
    'GitHub grants this connection more than read access. Change the StudioOS app to read-only in GitHub, then choose again.', 'the Worker\'s sentence as sent');
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
  const saved = { setCompanies: connectorsApi.setCompanies, teammate: connectorsApi.teammate };
  const calls = [];
  let reloads = 0;
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
