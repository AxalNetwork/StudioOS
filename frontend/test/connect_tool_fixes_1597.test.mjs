/**
 * #1597 — S1's fix list of 2026-10-14 12:09Z for Build's "Connect a tool":
 * the sign-in return is stripped (1), every panel path keeps the project's
 * company (2), `?tool=` opens where its row would (4, in connect_tool_d686),
 * a sync finished after the sheet closed still re-reads Build (5), Tools rows
 * return under Operating systems (6), the Worker's sync summary is shown (7),
 * Workspace's None says it removes Used by (8), focus follows a swap (9), and
 * the frame's dialog is one node across a swap (10); GitHub's Done and Open
 * close the whole lightbox (12).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connect_tool_fixes_1597.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { connectorsApi } from '../src/lib/api/connectors.js';
import { buildCatalogue } from '../src/pages/account/connectorsModel.js';
import ConnectToolSheet, { ConnectToolView } from '../src/pages/account/ConnectToolSheet.jsx';
import { useProject } from '../src/pages/cycles/CycleRoute.jsx';
import GithubSyncSheet from '../src/pages/account/GithubSyncSheet.jsx';
import ToolsHistory from '../src/pages/cycles/ToolsHistory.jsx';
import { systemOptions, UNMAP } from '../src/pages/cycles/forms.js';

const h = React.createElement;
const DAY = 86400000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** Mount through the stub DOM, with `querySelector`/`focus` so a Lightbox runs its effects. */
async function mount(el, { dom = false } = {}) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  if (dom) {
    const make = document.createElement.bind(document);
    document.createElement = (tag) => Object.assign(make(tag), { querySelector: () => null, querySelectorAll: () => [], focus() { this.focused = (this.focused || 0) + 1; document.activeElement = this; } });
    document.body = document.createElement('body');
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, walk: () => walk(container), settle, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
function Where() { const l = useLocation(); return h('i', { 'data-testid': 'where' }, `${l.pathname}${l.search}`); }

function stubReads({ companyId = 5, providers, items, companies = [{ id: 5, company_name: 'Acme' }] }) {
  const saved = {
    api: { getProject: api.getProject, googleCalStatus: api.googleCalStatus, microsoftCalStatus: api.microsoftCalStatus, linkedinStatus: api.linkedinStatus, listMyCompanies: api.listMyCompanies, listProjects: api.listProjects },
    c: { available: connectorsApi.available, list: connectorsApi.list, waitlist: connectorsApi.waitlist, suggestions: connectorsApi.suggestions, teammate: connectorsApi.teammate, oauthStart: connectorsApi.oauthStart, connect: connectorsApi.connect },
  };
  const calls = [];
  Object.assign(api, {
    getProject: async (id) => ({ id, company_id: companyId }), googleCalStatus: async () => ({ configured: false }), microsoftCalStatus: async () => ({ configured: false }),
    linkedinStatus: async () => null, listMyCompanies: async () => companies, listProjects: async () => [{ id: 3 }],
  });
  Object.assign(connectorsApi, {
    available: async () => ({ providers }), list: async () => ({ items }), waitlist: async () => ({ items: [] }), suggestions: async () => ({ suggestions: [] }),
    teammate: async (k, o) => { calls.push(['teammate', k, o ?? null]); return { teammate: null }; },
    oauthStart: async (k, p, o) => { calls.push(['oauthStart', k, p, o ?? null]); return {}; },
    connect: async (...a) => { calls.push(['connect', ...a]); return {}; },
  });
  return { calls, restore() { Object.assign(api, saved.api); Object.assign(connectorsApi, saved.c); } };
}

// ── 1. The return is stripped, whatever writes the venture ─────────────────

test('1. back from a sign-in with a kept venture, the address ends as /build/connect?project_id=7: oauth and provider never come back', async () => {
  const reads = stubReads({ providers: [{ key: 'hubspot', display_name: 'HubSpot', category: 'CRM', status: 'live', has_implementation: true }], items: [] });
  // The page as CycleRoute composes it: useProject (parent) over ConnectToolSheet (child).
  function Page() {
    const { projectId } = useProject(0, { kept: () => 7, drop: ['oauth', 'provider', 'reason'] });
    return h(React.Fragment, null, projectId ? h(ConnectToolSheet, { projectId, onClose() {} }) : null, h(Where));
  }
  const m = await mount(h(MemoryRouter, { initialEntries: ['/build/connect?oauth=ok&provider=hubspot'] }, h(Page)));
  try {
    assert.equal(m.text(m.by('where')), '/build/connect?project_id=7');
  } finally { reads.restore(); await m.unmount(); }

  // And with no venture kept: the first venture, still without the return's keys.
  const again = stubReads({ providers: [{ key: 'hubspot', display_name: 'HubSpot', category: 'CRM', status: 'live', has_implementation: true }], items: [] });
  function Fresh() {
    const { projectId } = useProject(0, { kept: () => null, drop: ['oauth', 'provider', 'reason'] });
    return h(React.Fragment, null, projectId ? h(ConnectToolSheet, { projectId, onClose() {} }) : null, h(Where));
  }
  const n = await mount(h(MemoryRouter, { initialEntries: ['/build/connect?oauth=error&provider=hubspot&reason=access_denied'] }, h(Fresh)));
  try {
    assert.equal(n.text(n.by('where')), '/build/connect?project_id=3');
  } finally { again.restore(); await n.unmount(); }
});

// ── 2. The project's company holds in every panel path ──────────────────────

test('2. a project whose company the member is not in: the deep link, Reconnect and Try again start nothing, and the banner shows', async () => {
  const providers = [
    { key: 'calendly', display_name: 'Calendly', category: 'Calendar', status: 'live', auth_type: 'oauth2', has_implementation: true },
    { key: 'hubspot', display_name: 'HubSpot', category: 'CRM', status: 'live', auth_type: 'oauth2', has_implementation: true },
  ];
  const items = [{ uid: 'u-hub', provider_key: 'hubspot', status: 'error', last_error: 'invalid_grant', company_ids: [12], last_synced_at: ago(DAY) }];
  const reads = stubReads({ companyId: 12, providers, items, companies: [{ id: 5, company_name: 'Acme' }] });
  const cat = buildCatalogue({ providers, items, firstParty: {} });
  const data = { status: 'ready', catalogue: cat, companies: [{ id: 5, company_name: 'Acme' }], reload() {} };
  try {
    for (const deepLink of ['?tool=calendly', '?tool=hubspot', '?oauth=error&provider=hubspot&reason=access_denied']) {
      const m = await mount(h(MemoryRouter, null, h(ConnectToolView, { data, project: { id: 7, company_id: 12 }, projectId: 7, onClose() {}, deepLink })));
      try {
        assert.ok(m.by('connect-tool-company-outside'), `${deepLink}: the company banner shows in the panel`);
        assert.equal(m.by('button-connect-continue'), undefined, `${deepLink}: no Continue`);
        assert.ok(m.by('button-blocked-close'), `${deepLink}: only Close`);
        if (m.by('button-connect-key')) assert.fail('no key connect');
      } finally { await m.unmount(); }
    }
    assert.deepEqual(reads.calls, [], 'no teammate lookup, no sign-in, no connect');
  } finally { reads.restore(); }
});

test('2b. a project whose company the member is in still connects from a deep link', async () => {
  const providers = [{ key: 'calendly', display_name: 'Calendly', category: 'Calendar', status: 'live', auth_type: 'oauth2', has_implementation: true }];
  const reads = stubReads({ providers, items: [] });
  const data = { status: 'ready', catalogue: buildCatalogue({ providers, items: [], firstParty: {} }), companies: [{ id: 5, company_name: 'Acme' }], reload() {} };
  const m = await mount(h(MemoryRouter, null, h(ConnectToolView, { data, project: { id: 7, company_id: 5 }, projectId: 7, onClose() {}, deepLink: '?tool=calendly' })));
  try {
    assert.equal(m.by('connect-tool-company-outside'), undefined);
    await m.click('button-connect-continue');
    assert.deepEqual(reads.calls.at(-1), ['oauthStart', 'calendly', { return_to: 'build', project_id: '7' }, { companyId: 5 }]);
  } finally { reads.restore(); await m.unmount(); }
});

// ── 5 & 12. GitHub's sheet ──────────────────────────────────────────────────

const GH = { key: 'github', display_name: 'GitHub', connection: { uid: 'u-gh' } };
function ghApi(over = {}) {
  return {
    repositories: async () => ({ available: [{ full_name: 'acme/app' }], selected: ['acme/app'], project_id: 7 }),
    setRepositories: async () => ({ ok: true }),
    sync: async () => ({ counts: { issues: 2, pull_requests: 1, releases: 0 } }),
    syncStatus: async () => null,
    ...over,
  };
}

test('5. a GitHub sync that finishes after the sheet closed still tells Build to re-read', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let changed = 0;
  const m = await mount(h(MemoryRouter, null, h(GithubSyncSheet, { p: GH, conn: GH.connection, projectId: 7, companyId: 5, onClose() {}, onChanged() { changed += 1; }, wait: () => new Promise((r) => setTimeout(r, 0)), api: ghApi({ sync: async () => { await gate; return { counts: { issues: 1, pull_requests: 0 } }; } }) })));
  // The click's handler awaits the gated sync, so it is started, not awaited.
  let done;
  await act(async () => { done = m.pr(m.by('button-sync-selected')).onClick(); });
  await m.settle();
  assert.match(m.text(), /Syncing/);
  await m.unmount();
  release();
  await done;
  assert.equal(changed, 1, 'closed during "Syncing…", re-read once the sync answers');
});

test('12. GitHub\'s Done and Open close the whole lightbox, and Open keeps the venture', async () => {
  const { SheetFrame } = await import('../src/pages/account/ConnectorSheet.jsx');
  let dismissed = 0; let stepped = 0;
  // FedGroup reads `connectorsApi.fed` itself.
  const savedFed = connectorsApi.fed;
  connectorsApi.fed = async () => ({ modules: [{ module: 'product_roadmap', label: 'Product roadmap', linked: 2, href: '/build/product-roadmap' }] });
  const m = await mount(h(MemoryRouter, null, h(SheetFrame.Provider, { value: { onDismiss() { dismissed += 1; } } },
    h(GithubSyncSheet, { p: GH, conn: GH.connection, projectId: 7, companyId: 5, onClose() { stepped += 1; }, onChanged() {}, api: ghApi() }))));
  try {
    await m.click('button-sync-selected');
    const open = m.walk().find((n) => m.pr(n)['data-testid'] === 'fed-open-product_roadmap');
    assert.ok(open, 'the success view lists what it fed');
    assert.equal(m.pr(open).href ?? m.pr(open).to, '/build/product-roadmap?project_id=7');
    await m.click('fed-open-product_roadmap');
    assert.equal(dismissed, 1, 'Open closes the lightbox');
    await m.click('button-connected-done');
    assert.equal(dismissed, 2, 'Done closes the lightbox');
    assert.equal(stepped, 0, 'neither only steps back');
  } finally { await m.unmount(); connectorsApi.fed = savedFed; }
});

// ── 6. Tools rows return under Operating systems ────────────────────────────

test('6. a Tools row\'s Open carries the page it sits on, so closing returns there', () => {
  const tools = { cols: [{ key: 'tool', label: 'Tool' }, { key: 'action', label: 'Action' }], rows: [{ id: 'tool-0', cells: { tool: 'HubSpot', action: { text: 'Open', href: '/build/connect?tool=hubspot&project_id=7' } } }], total: 1, state: 'ok' };
  let seen = null;
  function Peek() { const l = useLocation(); if (l.pathname === '/build/connect') seen = l.state; return null; }
  const out = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/operating-systems?project_id=7'] }, h(ToolsHistory, { tools }), h(Peek)));
  assert.match(out, /href="\/build\/connect\?tool=hubspot&amp;project_id=7"/);
  assert.equal(seen, null);
  return (async () => {
    const m = await mount(h(MemoryRouter, { initialEntries: ['/build/operating-systems?project_id=7'] }, h(Routes, null,
      h(Route, { path: '/build/operating-systems', element: h(ToolsHistory, { tools }) }),
      h(Route, { path: '/build/connect', element: h(Peek) }))));
    try {
      const link = m.walk().find((n) => m.pr(n).href === '/build/connect?tool=hubspot&project_id=7');
      await act(async () => { m.pr(link).onClick({ preventDefault() {}, button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false, currentTarget: link, target: link }); });
      await m.settle();
      assert.deepEqual(seen, { under: '/build/operating-systems?project_id=7' });
    } finally { await m.unmount(); }
  })();
});

// ── 7. The Worker's summary after Sync now and Try again ────────────────────

test('7. Try again shows what the Worker says it synced', async () => {
  const providers = [{ key: 'stripe', display_name: 'Stripe', category: 'Payments', status: 'live', has_implementation: true }];
  const items = [{ uid: 'u-str', provider_key: 'stripe', status: 'error', last_error: 'HTTP 500 upstream', company_ids: [5], last_synced_at: ago(DAY) }];
  const saved = connectorsApi.sync;
  connectorsApi.sync = async () => ({ ok: true, summary: '12 charges synced.' });
  const data = { status: 'ready', catalogue: buildCatalogue({ providers, items, firstParty: {} }), companies: [{ id: 5, company_name: 'Acme' }], reload() {} };
  const m = await mount(h(MemoryRouter, null, h(ConnectToolView, { data, project: { id: 7, company_id: 5 }, projectId: 7, onClose() {} })));
  try {
    await m.click('tool-action-stripe');
    assert.equal(m.text(m.by('tool-note-stripe')), '12 charges synced.');
    connectorsApi.sync = async () => ({ ok: true });
    await m.click('tool-action-stripe');
    assert.equal(m.text(m.by('tool-note-stripe')), 'Synced.', 'no summary: the plain word');
  } finally { connectorsApi.sync = saved; await m.unmount(); }
});

test('7b. the panel\'s Sync now shows what the Worker says it synced', async () => {
  const providers = [{ key: 'stripe', display_name: 'Stripe', category: 'Payments', status: 'live', has_implementation: true }];
  const items = [{ uid: 'u-str', provider_key: 'stripe', status: 'active', company_ids: [5], last_synced_at: ago(DAY) }];
  const saved = { sync: connectorsApi.sync, fed: connectorsApi.fed };
  connectorsApi.sync = async () => ({ ok: true, summary: '12 charges synced.' });
  connectorsApi.fed = async () => ({ modules: [] });
  const data = { status: 'ready', catalogue: buildCatalogue({ providers, items, firstParty: {} }), companies: [{ id: 5, company_name: 'Acme' }], reload() {} };
  const m = await mount(h(MemoryRouter, null, h(ConnectToolView, { data, project: { id: 7, company_id: 5 }, projectId: 7, onClose() {}, deepLink: '?tool=stripe' })));
  try {
    await m.click('button-sync-now');
    assert.match(m.text(), /12 charges synced\./);
  } finally { Object.assign(connectorsApi, saved); await m.unmount(); }
});

// ── 8. Workspace's None says what it removes ────────────────────────────────

test('8. choosing None for Workspace says Used by goes with it; the other systems keep theirs', () => {
  const read = { kinds: [{ kind: 'workspace', label: 'Workspace', choices: [] }, { kind: 'crm', label: 'CRM', choices: [] }] };
  assert.deepEqual(systemOptions(read, 'workspace').options.at(-1), { value: UNMAP, label: '— None (removes Workspace, Used by included) —' });
  assert.deepEqual(systemOptions(read, 'crm').options.at(-1), { value: UNMAP, label: '— None (unmap) —' });
});

// ── 9 & 10. One dialog across a swap; focus follows ─────────────────────────

test('9–10. the frame\'s dialog is the same node from list to tool and back, and focus moves into the new view', async () => {
  const providers = [{ key: 'stripe', display_name: 'Stripe', category: 'Payments', status: 'live', has_implementation: true }];
  const items = [{ uid: 'u-str', provider_key: 'stripe', status: 'active', company_ids: [5], last_synced_at: ago(DAY) }];
  const saved = connectorsApi.fed;
  connectorsApi.fed = async () => ({ modules: [] });
  const data = { status: 'ready', catalogue: buildCatalogue({ providers, items, firstParty: {} }), companies: [{ id: 5, company_name: 'Acme' }], reload() {} };
  const m = await mount(h(MemoryRouter, null, h(ConnectToolView, { data, project: { id: 7, company_id: 5 }, projectId: 7, onClose() {} })), { dom: true });
  try {
    const dialog = () => m.walk().find((n) => m.pr(n)['data-testid'] === 'connect-tool-lightbox');
    const first = dialog();
    assert.ok(first);
    const before = first.focused || 0;
    document.activeElement = document.body;
    await m.click('tool-name-stripe');
    assert.equal(dialog(), first, 'list → tool: the same dialog node');
    assert.ok((first.focused || 0) > before, 'focus moved into the tool\'s view, not left on <body>');
    const mid = first.focused;
    document.activeElement = document.body;
    const back = m.walk().find((n) => m.pr(n).children === 'Back' || (n.textContent === 'Back' && m.pr(n).onClick));
    if (back) { await act(async () => { m.pr(back).onClick(); }); await m.settle(); }
    else { await act(async () => { m.pr(m.by('sheet-close')).onClick?.(); }); await m.settle(); }
    assert.equal(dialog() ?? first, first, 'tool → list: still the same node');
    assert.ok(first.focused > mid || !dialog(), 'and focus follows again');
  } finally { connectorsApi.fed = saved; await m.unmount(); }
});
