/**
 * D753 (#1991, F5) — Mercury on its own page, `/account/connectors/mercury`.
 * D880 (#2553): the page is the member's own Mercury only. An admin on HQ
 * reads one line, linking HQ › Bank accounts, and the page never draws or
 * reads Axal VC's own accounts (`/api/admin/mercury`), whichever row the
 * Worker serves; a branch admin gets one sentence; a founder's or a partner's
 * own Mercury draws its groups above the token form, then, once connected, in
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
import { BRANCH_MANAGED, HQ_ACCOUNTS, MEMBER_GROUPS, MEMBER_REPLACE } from '../src/pages/account/mercuryModel.js';
import { mercuryPersonalApi } from '../src/lib/api/mercuryPersonal.js';

const h = React.createElement;

const P = (key, display_name, extra = {}) => ({
  key, display_name, integration_type: 'data_feed', status: 'live', tier: 'free', auth_type: 'api_key',
  description: `${display_name} description.`, capabilities: [], docs_url: `https://example.test/${key}`,
  has_implementation: false, locked_for_user: false, category: 'Accounting and banking', pulls: [], sends: [], feeds: [], ...extra,
});
/** The row the Worker served an admin on HQ before D879, kept to show the page draws nothing of it. */
const LEGACY_ENTITY = P('mercury', 'Mercury', { connection_source: 'mercury_entity_connections' });
/** D879's admin preview: the member's page, nothing to connect. */
const PREVIEW = P('mercury', 'Mercury', { connection_source: 'integrations', has_implementation: false });
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

/** Nothing of Axal VC's own accounts on the page: no entity body, sheet or control, and no `/admin/mercury` read. */
function noEntityUi(m) {
  assert.equal(m.reads(), 0, 'no read of Axal VC\'s accounts');
  for (const id of ['mercury-entity-page', 'mercury-entity-sheet', 'mercury-entities', 'mercury-sync-holdings', 'mercury-connect-fund', 'mercury-audit-foot', 'mercury-open-banking']) {
    assert.equal(m.by(id), undefined, id);
  }
  assert.notEqual(m.pr(m.by('connector-page-connect') || {})['data-mode'], 'entity');
}

test('an admin on HQ: the member page as a preview, one line to HQ \u203a Bank accounts, and nothing of Axal VC\'s accounts', async () => {
  for (const [row, user] of [[PREVIEW, HQ_ADMIN], [PREVIEW, SUPER_ADMIN], [LEGACY_ENTITY, HQ_ADMIN], [LEGACY_ENTITY, SUPER_ADMIN]]) {
    const m = await mount(page(ready([row, STRIPE])), user);
    try {
      noEntityUi(m);
      const line = m.by('connector-page-hq-accounts');
      assert.ok(line, 'the line');
      assert.ok(m.text(line).startsWith(HQ_ACCOUNTS.text));
      assert.equal(m.pr(m.by('connector-page-hq-accounts-link')).href, '/admin/platform/bank-accounts');
      assert.equal(m.by('connector-page-connect-button'), undefined, 'nothing to connect');
    } finally { await m.unmount(); }
  }
});

test('a branch admin sees "Axal VC\'s own accounts are managed from HQ." and no read, whether or not the row is served', async () => {
  const served = await mount(page(ready([PREVIEW])), BRANCH_ADMIN);
  try {
    noEntityUi(served);
    assert.equal(served.by('connector-page-hq-accounts'), undefined, 'the HQ line is HQ\'s');
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
    noEntityUi(m);
    assert.equal(m.by('connector-page-hq-accounts'), undefined, 'a founder reads no HQ line');
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
    // D881 (#2554): no token to replace; a member signs in again.
    assert.deepEqual(manageItems(connected(MERC()).catalogue[0]).map((i) => i.label), ['Sync now', 'Sign in again', 'Disconnect']);
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
