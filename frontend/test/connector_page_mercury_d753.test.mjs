/**
 * D753 (#1991, F5) — Mercury on its own page, `/account/connectors/mercury`,
 * under D715's rules: an admin on HQ gets the four Axal entities' connections
 * as the page's body, with one audited read on mount and no header action; a
 * branch admin gets one sentence and no read; a founder's or a partner's own
 * Mercury draws its groups above the token form, then, once connected, in
 * "Your connection" (part 2, on F3 #1956), never in the interim panel.
 *
 * Every account ending and token here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connector_page_mercury_d753.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { buildCatalogue, connectionStatus } from '../src/pages/account/connectorsModel.js';
import { manageItems } from '../src/pages/account/connectorPageModel.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import { ADMIN_ONLY, BRANCH_MANAGED, ENTITY_AUDIT_FOOT, ENTITY_FEEDS, MEMBER_GROUPS, MEMBER_REPLACE } from '../src/pages/account/mercuryModel.js';
import { mercuryPersonalApi } from '../src/lib/api/mercuryPersonal.js';

const h = React.createElement;

const P = (key, display_name, extra = {}) => ({
  key, display_name, integration_type: 'data_feed', status: 'live', tier: 'free', auth_type: 'api_key',
  description: `${display_name} description.`, capabilities: [], docs_url: `https://example.test/${key}`,
  has_implementation: false, locked_for_user: false, category: 'Accounting and banking', pulls: [], sends: [], feeds: [], ...extra,
});
const ENTITY = P('mercury', 'Mercury', { connection_source: 'mercury_entity_connections' });
const PERSONAL = P('mercury', 'Mercury', { connection_source: 'integrations', has_implementation: true });
const STRIPE = P('stripe', 'Stripe', { auth_type: 'oauth2', connection_source: 'integrations', has_implementation: true });
const ready = (providers, items = []) => ({
  status: 'ready', catalogue: buildCatalogue({ providers, items, companies: [], firstParty: {} }),
  items, itemsFailed: false, suggestions: [], suggestionsNote: '', reload() {},
});

/** `GET /api/admin/mercury/connections`, as #1775 serves it. */
const READ = () => ({
  ok: true,
  entities: [
    { entity_key: 'fund', connection: null },
    { entity_key: 'gp', connection: null },
    { entity_key: 'holdings', connection: { status: 'active', mercury_org_name: 'Holdings Org', last_synced_at: null, last_error: null, accounts: [{ kind: 'checking', last_four: '9001' }] } },
    { entity_key: 'management', connection: null },
  ],
});

const HQ_ADMIN = { id: 1, role: 'admin', name: 'HQ Admin', is_super_admin: 0, branch: null };
const SUPER_ADMIN = { ...HQ_ADMIN, id: 2, is_super_admin: 1 };
const BRANCH_ADMIN = { id: 3, role: 'admin', name: 'Branch Admin', is_super_admin: 0, branch: { code: 'ldn', name: 'London' } };
const FOUNDER = { id: 41, role: 'founder', name: 'Ana Wren' };
const PARTNER = { id: 42, role: 'partner', name: 'Bo Lind' };

/** A member's own Mercury, connected (`GET /api/connectors` items). */
const MERC = (extra = {}) => ({
  uid: 'u-merc', provider_key: 'mercury', status: 'active', last_synced_at: null, last_error: null, config: {},
  external_account_name: 'Wren Studio', companies: [{ company_id: 10, name: 'Acme', enabled: true }], ...extra,
});
const connected = (item) => ({ ...ready([PERSONAL]), catalogue: buildCatalogue({ providers: [PERSONAL], items: [item], companies: [{ id: 10, company_name: 'Acme' }], firstParty: {} }) });

/** Mount the page as `user`, counting the entity reads the page makes. */
async function mount(el, user) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  localStorage.setItem('user', JSON.stringify(user));
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ method: init.method || 'GET', path: String(url).replace(/^.*\/api/, '') });
    return new Response(JSON.stringify(READ()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/account/connectors/mercury'] }, h(AuthProvider, null, el))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, walk,
    text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    reads: () => calls.filter((c) => c.path === '/admin/mercury/connections').length,
    async unmount() { await act(async () => root.unmount()); restore(); globalThis.fetch = origFetch; },
  };
}
const page = (data, extra = {}) => h(ConnectorPageView, { data, connectorKey: 'mercury', ...extra });
/** The header band's interactive children: an action would be one. */
const bandActions = (m) => m.walk(m.by('connector-page-band')).filter((n) => ['BUTTON', 'A'].includes(String(n.tagName || n.nodeName || '').toUpperCase()));

test('an admin on HQ: the entity connections are the page body, after one audited read, with no header action', async () => {
  const m = await mount(page(ready([ENTITY, STRIPE])), HQ_ADMIN);
  try {
    assert.equal(m.reads(), 1, 'the page\'s mount is the one read');
    assert.equal(m.pr(m.by('connector-page-connect'))['data-mode'], 'entity');
    const body = m.by('mercury-entity-page');
    assert.ok(body, 'the entity body is on the page');
    assert.equal(m.by('mercury-entity-sheet'), undefined, 'no sheet, in any layout');
    assert.deepEqual(bandActions(m), [], 'the band draws no action for the entity row');
    const t = m.text(body);
    for (const words of ['Axal entities', ENTITY_FEEDS, ENTITY_AUDIT_FOOT, ADMIN_ONLY, 'Open Banking']) assert.ok(t.includes(words), words);
    assert.ok(m.by('mercury-sync-holdings'), 'a plain admin syncs');
    assert.equal(m.by('mercury-connect-fund'), undefined, 'and connects nothing');
  } finally { await m.unmount(); }
});

test('the Super Admin connects, replaces and disconnects from the page', async () => {
  const m = await mount(page(ready([ENTITY])), SUPER_ADMIN);
  try {
    assert.equal(m.reads(), 1);
    for (const id of ['mercury-connect-fund', 'mercury-replace-holdings', 'mercury-disconnect-holdings', 'mercury-sync-holdings']) assert.ok(m.by(id), id);
    assert.equal(m.by('mercury-admin-only'), undefined);
    assert.deepEqual(bandActions(m), []);
  } finally { await m.unmount(); }
});

test('a branch admin sees "Axal\'s entity accounts are managed from HQ." and no read, whether or not the row is served', async () => {
  const served = await mount(page(ready([ENTITY])), BRANCH_ADMIN);
  try {
    assert.equal(served.reads(), 0, 'a branch admin\'s page reads nothing');
    assert.ok(served.text().includes(BRANCH_MANAGED));
    assert.equal(served.by('mercury-audit-foot'), undefined, 'nothing read, so nothing recorded');
    assert.equal(served.by('mercury-open-banking'), undefined);
  } finally { await served.unmount(); }
  const withheld = await mount(page(ready([STRIPE]), { branchAdmin: true }), BRANCH_ADMIN);
  try {
    assert.equal(withheld.reads(), 0);
    assert.equal(withheld.text(withheld.by('connector-page-not-offered')), BRANCH_MANAGED);
  } finally { await withheld.unmount(); }
});

test('a founder\'s own Mercury: their groups, no entity body and no entity read', async () => {
  const saved = mercuryPersonalApi.status;
  mercuryPersonalApi.status = async () => ({ connected: false, connection: null, uses: [] });
  const m = await mount(page(ready([PERSONAL])), FOUNDER);
  try {
    assert.equal(m.reads(), 0, 'a member\'s page never reads the entities');
    assert.equal(m.by('mercury-entity-page'), undefined);
    assert.notEqual(m.pr(m.by('connector-page-connect'))['data-mode'], 'entity');
    const t = m.text(m.by('connector-page-connect'));
    for (const label of [MEMBER_GROUPS.uses, MEMBER_GROUPS.never]) assert.ok(t.includes(label), label);
  } finally { await m.unmount(); mercuryPersonalApi.status = saved; }
});

/** Stub the member's status read (`GET /api/mercury/personal/status`), counting it. */
function stubStatus() {
  const saved = mercuryPersonalApi.status;
  const s = { reads: 0, restore() { mercuryPersonalApi.status = saved; } };
  mercuryPersonalApi.status = async () => { s.reads += 1; return { connected: true, connection: null, uses: [] }; };
  return s;
}

test('a founder\'s connected Mercury: Your connection with its groups, no interim panel, one status read', async () => {
  const st = stubStatus();
  const m = await mount(page(connected(MERC())), FOUNDER);
  try {
    assert.equal(m.by('connector-page-connect'), undefined, 'no interim panel, no Connect and manage');
    const yours = m.by('connector-page-connection');
    assert.ok(yours, 'Your connection');
    assert.equal(m.text(m.by('connector-page-account')), 'Wren Studio');
    assert.ok(m.by('connector-page-sync'), 'Sync now');
    const groups = m.text(m.by('connector-page-mercury'));
    for (const label of [MEMBER_GROUPS.uses, MEMBER_GROUPS.never]) assert.ok(groups.includes(label), label);
    assert.equal(m.by('connector-company-10'), undefined, 'where it lands, not Companies (D715 decision 8)');
    assert.ok(m.text(yours).includes('Now fed by Mercury'), 'a founder\'s Mercury says what it feeds');
    assert.equal(st.reads, 1, 'the groups read the status once, on the page');
    assert.equal(m.reads(), 0, 'and never the entities');
    assert.deepEqual(manageItems(connected(MERC()).catalogue[0]).map((i) => i.label), ['Sync now', 'Replace token', 'Disconnect']);
  } finally { await m.unmount(); st.restore(); }
});

test('a partner\'s connected Mercury feeds no module, so it draws no Now fed by', async () => {
  const st = stubStatus();
  const m = await mount(page(connected(MERC())), PARTNER);
  try {
    assert.ok(m.by('connector-page-mercury'));
    assert.ok(!m.text(m.by('connector-page-connection')).includes('Now fed by'));
  } finally { await m.unmount(); st.restore(); }
});

test('a member\'s Mercury needing attention says how to fix it, never the raw error', async () => {
  const st = stubStatus();
  const item = MERC({ status: 'error', last_error: 'unauthorized: raw provider words' });
  const data = connected(item);
  const m = await mount(page(data), FOUNDER);
  try {
    const why = connectionStatus(data.catalogue[0].connection, data.catalogue[0]).why;
    assert.ok(why, 'the row needs attention');
    assert.equal(m.text(m.by('connector-page-attention')), `${why}. ${MEMBER_REPLACE}`);
    assert.ok(!m.text().includes('raw provider words'));
  } finally { await m.unmount(); st.restore(); }
});
