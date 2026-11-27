/**
 * D8774 (#8774) — Build names a tool's account, company and venture scope
 * apart, and says it feeds this venture only when all three hold. The five
 * acceptance states (account connected with the venture in no company, bound
 * with no repository, healthy, failing, read only) across Connect a tool,
 * Operating systems › Tools and the Overview card's words.
 *
 * Every name, company and repository here is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connector_scope_8774.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  accountDisconnectNote, buildCatalogue, companiesWithout, linkPrompt, scopeLadder, stopForCompanyNote, toolRow, ventureFeed, ventureOwner,
} from '../src/pages/account/connectorsModel.js';
import { connectorsApi } from '../src/lib/api/connectors.js';
import { companyActionsApi } from '../src/lib/api/companyActions.js';
import { ConnectToolView } from '../src/pages/account/ConnectToolSheet.jsx';
import ToolsHistory from '../src/pages/cycles/ToolsHistory.jsx';
import { OperatingSystemsView, linkCompanyHref } from '../src/pages/cycles/OperatingSystemsHome.jsx';
import { accountOnlyText, bindingView } from '../src/pages/cycles/codeSystem.js';

const h = React.createElement;
const COMPANIES = [{ id: 5, company_name: 'Sample Orchard Inc.' }, { id: 9, company_name: 'Sample Ventures LLC' }];
const PROVIDERS = [
  { key: 'github', display_name: 'GitHub', status: 'live', tier: 'free', auth_type: 'oauth2', has_implementation: true, category: 'Code', feeds: ['product_roadmap', 'prototype_mvp'] },
  { key: 'hubspot', display_name: 'HubSpot', status: 'live', tier: 'free', auth_type: 'oauth2', has_implementation: true, category: 'CRM', feeds: ['operating_systems'] },
];
const SYNCED = '2026-11-20T11:00:00Z';
/** One catalogue with GitHub connected for these companies and this config. */
const catalogue = ({ companyIds = [5, 9], config = {}, status = 'active', lastError = null } = {}) => buildCatalogue({
  providers: PROVIDERS,
  items: [{ uid: 'u-gh', provider_key: 'github', status, company_ids: companyIds, config, last_synced_at: SYNCED, last_error: lastError, last_error_at: lastError ? SYNCED : null }],
  firstParty: {},
});
const gh = (cat) => cat.find((p) => p.key === 'github');
const OWNER = { id: 1, role: 'founder', founder_id: 11 };
const MEMBER = { id: 2, role: 'founder', founder_id: 22 };
const PROJECT = { id: 7, name: 'Sample Orchard', founder_id: 11, founder: { name: 'Maya Sample' } };
const ok = { state: 'ok', companyId: 5, name: 'Sample Orchard Inc.' };

async function mount(el) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onChange?.({ target: n }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const view = (cat, project, user, extra = {}) => h(MemoryRouter, null, h(ConnectToolView, {
  data: { status: 'ready', catalogue: cat, companies: COMPANIES, reload: extra.reload || (() => {}) }, project, projectId: 7, onClose() {}, user, onLinked: extra.onLinked,
}));

test('ventureFeed: no company, company off, another venture, no repository, effective', () => {
  // Mutation checked: the company check after GitHub's → company_off reads no_repo; `bound !== projectId` dropped → another venture reads effective.
  const none = { state: 'none', companyId: null, name: null };
  assert.equal(ventureFeed(gh(catalogue()), none, 7), 'no_company');
  assert.equal(ventureFeed(gh(catalogue({ companyIds: [9] })), ok, 7), 'company_off');
  assert.equal(ventureFeed(gh(catalogue({ config: { project_id: 8, repositories: ['acme/app'] } })), ok, 7), 'other_venture');
  assert.equal(ventureFeed(gh(catalogue({ config: { project_id: 7, repositories: [] } })), ok, 7), 'no_repo');
  assert.equal(ventureFeed(gh(catalogue({ config: {} })), ok, 7), 'no_repo');
  assert.equal(ventureFeed(gh(catalogue({ config: { project_id: 7, repositories: ['acme/app'] } })), ok, 7), 'effective');
  assert.equal(ventureFeed(gh(catalogue()), null, 7), null, 'no venture: the plain row');
  assert.equal(ventureFeed(gh(catalogue()), { state: 'outside', companyId: 5 }, 7), null, 'a scope that cannot be told is not guessed');
  assert.deepEqual(companiesWithout({ company_ids: [5, 9] }, 5), [9]);
});

test('a row says Feeds only when every scope holds; Disconnect is never its action while it feeds nothing', () => {
  // Mutation checked: scopedRow skipped → the unbound row says "Feeds Product roadmap" with Disconnect; the after-sync words dropped → no_repo says nothing of what will feed.
  const ctx = (scope) => ({ scope, projectId: 7, ventureName: 'Sample Orchard' });
  const unbound = toolRow(gh(catalogue()), ctx({ state: 'none', companyId: null, name: null }));
  assert.deepEqual([unbound.pill, unbound.action, unbound.feed], [['Account only', 'neutral'], null, 'no_company']);
  assert.equal(unbound.detail, 'Connected to your account · feeds nothing in Sample Orchard until it is in a company');
  assert.doesNotMatch(unbound.detail, /^Feeds/);
  const off = toolRow(gh(catalogue({ companyIds: [9] })), ctx(ok));
  assert.deepEqual([off.action, off.actionLabel], ['enable', 'Use for Sample Orchard Inc.']);
  const noRepo = toolRow(gh(catalogue({ config: { project_id: 7, repositories: [] } })), ctx(ok));
  assert.deepEqual([noRepo.pill[0], noRepo.action, noRepo.actionLabel], ['Choose repositories', 'choose', 'Choose repositories']);
  assert.match(noRepo.detail, /no repository chosen for Sample Orchard, so nothing is read yet · after a sync it will feed Product roadmap, Prototype mvp$/);
  const other = toolRow(gh(catalogue({ config: { project_id: 8, repositories: ['acme/app'] } })), ctx(ok));
  assert.match(other.detail, /feed another venture, not Sample Orchard/);
  const healthy = toolRow(gh(catalogue({ config: { project_id: 7, repositories: ['acme/app'] } })), ctx(ok));
  assert.deepEqual([healthy.pill[0], healthy.action], ['Connected', 'disconnect']);
  assert.match(healthy.detail, /^Feeds Product roadmap, Prototype mvp/);
  // Failing and bound: the failing row (Reconnect) stays; failing and in no company: it feeds nothing anyway.
  const failing = toolRow(gh(catalogue({ status: 'error', lastError: 'token_expired', config: { project_id: 7, repositories: ['acme/app'] } })), ctx(ok));
  assert.equal(failing.state, 'failing');
  assert.equal(failing.pill[0], 'Failing');
  assert.equal(toolRow(gh(catalogue({ status: 'error', lastError: 'x' })), ctx({ state: 'none' })).pill[0], 'Account only');
  // The ladder: three scopes, three lines.
  assert.deepEqual(scopeLadder(gh(catalogue({ config: { project_id: 7, repositories: ['a/b', 'a/c'] } })), ok, 7, 'Sample Orchard').map((l) => [l.label, l.value]),
    [['Your account', 'Connected'], ['Company', 'On for Sample Orchard Inc.'], ['Sample Orchard', 'Reads 2 repositories']]);
  assert.deepEqual(scopeLadder(gh(catalogue()), { state: 'none' }, 7).map((l) => l.value), ['Connected', 'This venture is in no company yet', 'Fed by nothing yet']);
});

test('who links the venture: the owner, or the owner named to anyone else (Q2 option A)', () => {
  assert.deepEqual(ventureOwner(PROJECT, OWNER), { canLink: true, name: 'Maya Sample' });
  assert.deepEqual(ventureOwner(PROJECT, MEMBER), { canLink: false, name: 'Maya Sample' });
  assert.equal(ventureOwner(PROJECT, { role: 'admin' }).canLink, true, 'the move route takes an admin too');
  assert.equal(ventureOwner({ ...PROJECT, founder_id: null }, { role: 'founder', founder_id: null }).canLink, false, 'no founder id is no ownership');
  assert.match(linkPrompt({ canLink: true }, 'Sample Orchard'), /^Link Sample Orchard to a company/);
  assert.equal(linkPrompt({ canLink: false, name: 'Maya Sample' }, 'Sample Orchard'),
    'Only Maya Sample can link Sample Orchard to a company. Ask them to, from Build › Connect a tool; until then no connected tool feeds it.');
});

test('the scoped stop and the account-wide disconnect say their scope and consequence (Q1 option A)', () => {
  const p = gh(catalogue({ config: { project_id: 7, repositories: ['acme/app'] } }));
  assert.equal(stopForCompanyNote(p, ok, COMPANIES),
    'GitHub stays connected to your account and keeps serving Sample Ventures LLC. It stops feeding Sample Orchard Inc.’s ventures. The repositories chosen for this venture are let go. Data already in StudioOS stays.');
  assert.equal(accountDisconnectNote(p, COMPANIES),
    'This removes GitHub from your account. It stops feeding every company it serves: Sample Orchard Inc. and Sample Ventures LLC. Data already in StudioOS stays. The stored credentials are deleted.');
  assert.match(accountDisconnectNote(gh(catalogue({ companyIds: [5, 77] })), COMPANIES), /Sample Orchard Inc\. and 1 other company\./, 'a company the member cannot see is counted, never named');
});

test('Connect a tool, account connected and venture in no company: the owner links it here and stays in the setup', async () => {
  // Mutation checked: the owner's Link button drawn for everyone → the member sees it; onLinked not called → the venture is never re-read.
  const saved = companyActionsApi.moveProject;
  const calls = [];
  let linked = 0;
  companyActionsApi.moveProject = async (id, body) => { calls.push([id, body]); return { project_id: id, company_id: body.company_id }; };
  const m = await mount(view(catalogue(), { ...PROJECT, company_id: null }, OWNER, { onLinked: () => { linked += 1; } }));
  try {
    assert.match(m.text(m.by('tool-row-github')), /Account only/);
    assert.match(m.text(m.by('tool-row-github')), /feeds nothing in Sample Orchard until it is in a company/);
    assert.equal(m.by('tool-action-github'), undefined, 'no Disconnect on a row that feeds nothing');
    assert.match(m.text(m.by('tool-scope-github-company')), /This venture is in no company yet/);
    await m.click('connect-tool-link-company');
    assert.ok(m.by('link-company-dialog-says'), 'the link dialog opens inside Build');
    await m.change('link-company-5');
    await m.click('link-company-dialog-confirm');
    assert.deepEqual(calls, [[7, { company_id: 5 }]], 'the one writer of the venture\'s company');
    assert.equal(linked, 1, 'the sheet re-reads the venture and carries on');
  } finally { companyActionsApi.moveProject = saved; await m.unmount(); }
  const member = await mount(view(catalogue({ companyIds: [] }), { ...PROJECT, company_id: null }, MEMBER));
  try {
    assert.equal(member.by('connect-tool-link-company'), undefined);
    assert.match(member.text(member.by('connect-tool-link-member')), /^Only Maya Sample can link Sample Orchard to a company\./);
    assert.ok(member.by('connect-tool-copy-link'));
  } finally { await member.unmount(); }
});

test('Connect a tool, bound with no repository, healthy, failing and read only', async () => {
  // Mutation checked: the scoped stop sending the whole set → setCompanies gets [5, 9]; `choose` falling through → Disconnect on the unbound row.
  const project = { ...PROJECT, company_id: 5 };
  const noRepo = await mount(view(catalogue({ config: { project_id: 7, repositories: [] } }), project, OWNER));
  try {
    assert.equal(noRepo.text(noRepo.by('tool-action-github')), 'Choose repositories');
    assert.match(noRepo.text(noRepo.by('tool-row-github')), /after a sync it will feed/);
  } finally { await noRepo.unmount(); }
  const saved = connectorsApi.setCompanies;
  const calls = [];
  connectorsApi.setCompanies = async (uid, ids) => { calls.push([uid, ids]); return { ok: true }; };
  const healthy = await mount(view(catalogue({ config: { project_id: 7, repositories: ['acme/app'] } }), project, OWNER));
  try {
    assert.match(healthy.text(healthy.by('tool-row-github')), /Feeds Product roadmap/);
    await healthy.click('tool-action-github');
    assert.match(healthy.text(healthy.by('tool-stop-github')), /keeps serving Sample Ventures LLC/);
    assert.match(healthy.text(healthy.by('tool-confirm-account-github')), /every company it serves: Sample Orchard Inc\. and Sample Ventures LLC/);
    await healthy.click('tool-review-github');
    await healthy.click('tool-confirm-stop-github');
    assert.deepEqual(calls, [['u-gh', [9]]], 'only this venture\'s company is turned off');
  } finally { connectorsApi.setCompanies = saved; await healthy.unmount(); }
  const failing = await mount(view(catalogue({ status: 'error', lastError: 'Sign-in expired', config: { project_id: 7, repositories: ['acme/app'] } }), project, OWNER));
  try { assert.match(failing.text(failing.by('tool-row-github')), /Failing/); } finally { await failing.unmount(); }
  const readOnly = await mount(view(catalogue({ companyIds: [12] }), { ...PROJECT, company_id: 12 }, MEMBER));
  try {
    assert.match(readOnly.text(readOnly.by('connect-tool-company-outside')), /^You are not a member/);
    assert.equal(readOnly.by('tool-action-hubspot'), undefined, 'nothing connects for a company the viewer is not in');
  } finally { await readOnly.unmount(); }
});

const BOUND = { state: 'healthy', effective: true, scopes: { account: 'connected', company: 'on', venture: 'bound' }, feeds_after_sync: ['Product roadmap'],
  last_good_read: { at: '2026-11-20 11:00:00', source: 'GitHub sync', repositories: ['acme/app'], partial: false }, stale: null, reason: '' };
const SYSTEM = { kind: 'code', system: 'Code', provider: 'GitHub', source_label: 'From the GitHub connection', state: 'Connected', repositories: ['acme/app'], repositories_total: 1,
  feeds: [{ module: 'product_roadmap', label: 'Product roadmap', href: '/build/product-roadmap?project_id=7', count: 2 }], owner: 'You', action: null };
const tools = (binding, extra = {}) => ({ cols: [], rows: [], total: 1, state: 'ok', code: { state: 'ok', systems: [{ ...SYSTEM, binding, ...extra }] }, syncs: { state: 'empty', rows: [] } });
const draw = (t) => renderToStaticMarkup(h(MemoryRouter, null, h(ToolsHistory, { tools: t, phone: false })));

test('Operating systems › Tools: the last successful read of the venture, Stale with its age, and Feeds only when effective', () => {
  // Mutation checked: feedsHeading always "Feeds" → the no-repository system claims to feed; the stale line dropped → no age.
  const healthy = draw(tools(BOUND));
  assert.match(healthy, /data-binding="healthy"/);
  assert.match(healthy, /Last successful read of this venture: 2026-11-20 11:00:00 · GitHub sync · acme\/app/);
  assert.match(healthy, /data-testid="tools-code-feeds">Feeds: <span><a/);
  const noRepo = draw(tools({ ...BOUND, state: 'no_repo', effective: false, last_good_read: null, reason: 'No repository is chosen for this venture yet.' }));
  assert.match(noRepo, /No repository chosen/);
  assert.match(noRepo, /Arrived earlier: /);
  assert.match(noRepo, /After a sync it will feed: Product roadmap/);
  assert.match(noRepo, /Last successful read of this venture: none recorded/);
  const stale = draw(tools({ ...BOUND, state: 'stale', stale: { since: '2026-11-18 09:00:00', hours: 50 } }));
  assert.match(stale, /data-testid="tools-code-stale"[^>]*>Stale · 50 h since the last good read</);
  const failing = draw(tools({ ...BOUND, state: 'failing', stale: { since: null, hours: null } }));
  assert.match(failing, /Failing/);
  assert.match(failing, /Stale · no good read recorded/);
  const zero = draw(tools({ ...BOUND, state: 'no_items' }, { feeds: [] }));
  assert.match(zero, /No items/);
  assert.equal(bindingView({}), null, 'a read from before D8774 draws as before');
  // No GitHub on for the company: the viewer's own is named at account scope.
  const account = draw({ cols: [], rows: [], total: 0, state: 'ok', code: { state: 'empty', systems: [], account: { provider: 'GitHub', state: 'connected' } } });
  assert.match(account, /data-testid="tools-code-account"[^>]*>GitHub is connected on your account\. It feeds nothing in this venture until/);
  assert.equal(accountOnlyText({ account: null }), null);
});

test('Operating systems with no company: Link to a company you have, and the account-only GitHub', () => {
  // Mutation checked: CompanyNotLinked without `code` → no account line.
  const data = { card: { state: 'not_recorded' }, parts: { systems: { state: 'not_recorded', rows: [] }, tools: { code: { state: 'not_recorded', systems: [], account: { provider: 'GitHub', state: 'failing' } } } } };
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(OperatingSystemsView, { section: 'tools', data, projectId: 7, search: '?project_id=7' })));
  assert.match(out, /href="\/build\/connect\?project_id=7&amp;link=company"[^>]*>Link to a company you have</);
  assert.match(out, /GitHub is connected, its last sync failed on your account/);
  assert.equal(linkCompanyHref(''), '/build/connect?link=company');
  const systems = renderToStaticMarkup(h(MemoryRouter, null, h(OperatingSystemsView, { section: 'systems', data, projectId: 7, search: '?project_id=7' })));
  assert.doesNotMatch(systems, /os-no-company-account/, 'the account line belongs to Tools');
});
