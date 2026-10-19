/**
 * D753 (#1956, F3) — "Your connection" on a connector's own page: the first
 * row (account, status, last sync, Sync now), Companies, Now fed by, Settings
 * and Activity (the sheet's own groups), the band's "Manage ▾", Disconnect
 * behind a confirm, first-party rows on their own routes, the inline panel
 * kept only for GitHub and Mercury, and the request form as a centred dialog.
 * No test calls a provider or the network: `fetch` is stubbed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connector_page_connection_d753.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { buildCatalogue, disconnectNote } from '../src/pages/account/connectorsModel.js';
import { interimPanel, manageItems, pageAction } from '../src/pages/account/connectorPageModel.js';
import { ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import { RequestSheet } from '../src/pages/account/AccountConnectors.jsx';

const h = React.createElement;

const P = (key, display_name, extra = {}) => ({
  key, display_name, integration_type: 'data_feed', status: 'live', tier: 'free', auth_type: 'oauth2',
  description: `${display_name} description.`, capabilities: [], has_implementation: true, locked_for_user: false,
  connection_source: 'integrations', pulls: [], sends: [], feeds: [], ...extra,
});
const conn = (uid, provider_key, extra = {}) => ({
  uid, provider_key, status: 'active', last_synced_at: null, last_error: null, config: {},
  companies: [{ company_id: 10, name: 'Acme', enabled: true }, { company_id: 20, name: 'Beta', enabled: false }], ...extra,
});
const PROVIDERS = [
  P('stripe', 'Stripe'),
  P('hubspot', 'HubSpot', { supports_pat: true }),
  P('crunchbase', 'Crunchbase', { auth_type: 'api_key' }),
  P('slack', 'Slack'),
  P('github', 'GitHub'),
  P('mercury', 'Mercury', { auth_type: 'api_key' }),
];
const ITEMS = [
  conn('u-stripe', 'stripe', { external_account_name: 'Acme Payments' }),
  conn('u-hub', 'hubspot', { config: { pipeline_label: 'Raise' } }),
  conn('u-cb', 'crunchbase', { api_key_preview: 'ab12' }),
  conn('u-slack', 'slack', { status: 'error', last_error: 'invalid_grant: token expired' }),
  conn('u-gh', 'github'),
  conn('u-merc', 'mercury'),
];
const FIRST = {
  google: { configured: true, connected: true, google_email: 'me@example.test' },
  microsoft: { configured: true, connected: true },
  linkedin: { configured: true, connected: true },
};
const CAT = buildCatalogue({ providers: PROVIDERS, items: ITEMS, firstParty: FIRST, companies: [{ id: 10, company_name: 'Acme' }, { id: 20, company_name: 'Beta' }] });
const row = (key) => CAT.find((p) => p.key === key);
const ready = () => ({ status: 'ready', catalogue: CAT, items: [], itemsFailed: false, suggestions: [], suggestionsNote: '', reload() {} });

// ---------------------------------------------------------------- pure rules

test('manageItems: Sync now, Replace key or Reconnect, Disconnect; Reconnect leaves Manage when it is the primary action', () => {
  assert.deepEqual(manageItems(row('stripe')).map((i) => i.label), ['Sync now', 'Reconnect', 'Disconnect']);
  assert.deepEqual(manageItems(row('crunchbase')).map((i) => i.label), ['Sync now', 'Replace key', 'Disconnect']);
  assert.deepEqual(manageItems(row('hubspot')).map((i) => i.label), ['Sync now', 'Replace token', 'Disconnect']);
  assert.deepEqual(manageItems(row('google')).map((i) => i.label), ['Reconnect', 'Disconnect'], 'a first-party row has no registry sync');
  assert.deepEqual(manageItems(row('slack')).map((i) => i.label), ['Sync now', 'Disconnect'], 'needing attention, Reconnect is the band\'s');
  assert.equal(pageAction(row('slack')).kind, 'reconnect');
  assert.deepEqual(manageItems({ ...row('stripe'), connection: null }), []);
});

test('interimPanel: only GitHub, a member\'s Mercury and GitHub\'s sign-in landing keep F1\'s panel; never the entity row', () => {
  for (const key of ['stripe', 'hubspot', 'crunchbase', 'slack', 'google']) assert.equal(interimPanel(row(key)), false, key);
  assert.equal(interimPanel(row('github')), true);
  assert.equal(interimPanel(row('mercury')), true);
  assert.equal(interimPanel({ ...row('stripe'), connection: null }, 'sync'), true);
  assert.equal(interimPanel({ ...row('github'), connection: null }), false);
  assert.equal(interimPanel({ ...row('mercury'), connection_source: 'mercury_entity_connections' }), false, 'F5 draws the entities\' Mercury itself');
  assert.equal(interimPanel({ ...row('mercury'), connection_source: 'mercury_entity_connections' }, 'sync'), false);
});

// ---------------------------------------------------------------- the page

function stubFetch(answer = () => [200, {}]) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api/, '');
    const method = init.method || 'GET';
    const call = { method, path, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const [status, body] = await answer(call);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore() { globalThis.fetch = orig; } };
}

/** Mount with real effects. The document's keydown listeners are kept, so Escape reaches a Lightbox as the browser delivers it. */
async function mount(element, url) {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const docKeys = [];
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = function focus() { document.activeElement = this; };
    n.isConnected = true;
    return n;
  };
  document.addEventListener = (type, fn) => { if (type === 'keydown') docKeys.push(fn); };
  document.removeEventListener = (type, fn) => { const i = docKeys.indexOf(fn); if (i >= 0) docKeys.splice(i, 1); };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.dispatchEvent = () => true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element })))); });
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    by, props, settle,
    text: (n = container) => textOf(n).replace(/\s+/g, ' '),
    async click(id) {
      const n = by(id);
      if (!n) throw new Error(`Missing ${id}`);
      await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async escape() {
      const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      await act(async () => { for (const fn of [...docKeys]) fn(e); });
      await settle();
    },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}
const page = (key, extra = {}) => h(ConnectorPageView, { data: ready(), connectorKey: key, ...extra });
const readsOk = (c) => {
  if (c.path.endsWith('/fed')) return [200, { ok: true, modules: [{ module: 'revenue', label: 'Revenue and traction', count: 3, linked: 3, unlanded: 0, reason: null }] }];
  if (c.path.includes('/logs')) return [200, { items: [{ id: 1, created_at: '2026-10-19 08:00:00', status: 'ok', event_type: 'sync', response_summary: 'Synced 3 charges' }] }];
  return [200, { ok: true }];
};

test('Your connection: the account, status, last sync and Sync now, then Companies, Now fed by, Settings and Activity', async () => {
  const f = stubFetch(readsOk);
  const m = await mount(page('stripe'), '/account/connectors/stripe');
  try {
    const section = m.by('connector-page-connection');
    assert.ok(section, 'Your connection');
    assert.equal(m.text(m.by('connector-page-account')).trim(), 'Acme Payments');
    assert.match(m.text(m.by('connector-page-connection-row')), /Connected/);
    assert.ok(m.by('connector-page-last-sync'));
    assert.ok(m.by('connector-page-sync'), 'Sync now');
    assert.match(m.text(section), /Companies Acme Beta/);
    assert.match(m.text(section), /Now fed by Stripe Revenue and traction 3 items/);
    assert.match(m.text(section), /Activity .*Synced 3 charges/);
    assert.equal(m.by('connector-sheet-detail'), undefined, 'no side sheet on the page');
    await m.click('connector-page-sync');
    assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path === '/connectors/u-stripe/sync').length, 1, 'Sync now syncs once');
  } finally { await m.unmount(); f.restore(); }
});

test('a missing account reads Not recorded with its reason; Settings opens its centred dialog from the page', async () => {
  const f = stubFetch(readsOk);
  const m = await mount(page('hubspot'), '/account/connectors/hubspot');
  try {
    const account = m.by('connector-page-account');
    assert.match(m.text(account), /Not recorded/);
    const mark = Object.values(account.childNodes || []).find((n) => m.props(n).title || m.props(n)['aria-label']);
    assert.ok(mark, 'the Not recorded mark carries its reason');
    assert.match(String(m.props(mark).title || m.props(mark)['aria-label']), /did not name the account/);
    assert.match(m.text(m.by('connector-page-connection')), /Settings Pipeline Raise Change/);
  } finally { await m.unmount(); f.restore(); }
});

test('companies are ticked from the page, and the Worker\'s answer is what the boxes show (moved from the sheet, unchanged)', async () => {
  let changed = 0;
  const f = stubFetch((c) => (c.method === 'PUT' && c.path === '/connectors/u-stripe/companies' ? [200, { ok: true, company_ids: [10, 20] }] : readsOk(c)));
  const m = await mount(h(ConnectorPageView, { data: { ...ready(), reload() { changed += 1; } }, connectorKey: 'stripe' }), '/account/connectors/stripe');
  try {
    assert.equal(m.props(m.by('connector-company-10')).checked, true);
    assert.equal(m.props(m.by('connector-company-20')).checked, false);
    await act(async () => { await m.props(m.by('connector-company-20')).onChange({ target: { checked: true } }); });
    await m.settle();
    assert.deepEqual(f.calls.find((c) => c.method === 'PUT').body, { company_ids: [10, 20] });
    assert.equal(m.props(m.by('connector-company-20')).checked, true);
    assert.equal(changed, 1);
  } finally { await m.unmount(); f.restore(); }
});

test('Manage: a key provider offers Replace key, a sign-in provider Reconnect; needing attention, Reconnect is the primary action', async () => {
  const f = stubFetch(readsOk);
  let m = await mount(page('crunchbase'), '/account/connectors/crunchbase');
  try {
    await m.click('connector-page-manage');
    assert.match(m.text(m.by('connector-page-manage-menu')), /Sync now Replace key Disconnect/);
    await m.click('connector-page-manage-replace');
    assert.ok(m.by('connector-page-key-form'), 'Replace key opens the key form inline');
  } finally { await m.unmount(); }
  m = await mount(page('stripe'), '/account/connectors/stripe');
  try {
    await m.click('connector-page-manage');
    assert.match(m.text(m.by('connector-page-manage-menu')), /Sync now Reconnect Disconnect/);
  } finally { await m.unmount(); }
  m = await mount(page('slack'), '/account/connectors/slack');
  try {
    assert.equal(m.props(m.by('connector-page-connect-button'))['aria-label'], 'Reconnect Slack', 'the band\'s primary action');
    await m.click('connector-page-manage');
    assert.match(m.text(m.by('connector-page-manage-menu')), /^ ?Sync now Disconnect ?$/);
  } finally { await m.unmount(); }
  m = await mount(page('stripe', { phone: true }), '/account/connectors/stripe');
  try {
    assert.equal(m.by('connector-page-manage'), undefined, 'no menu button on a phone');
    assert.match(m.text(m.by('connector-page-manage-rows')), /Sync now Reconnect Disconnect/);
  } finally { await m.unmount(); f.restore(); }
});

test('Disconnect asks first with disconnectNote; Cancel and Escape send nothing; confirming disconnects once', async () => {
  const f = stubFetch(readsOk);
  const m = await mount(page('stripe'), '/account/connectors/stripe');
  const deletes = () => f.calls.filter((c) => c.method === 'DELETE');
  try {
    await m.click('connector-page-manage');
    await m.click('connector-page-manage-disconnect');
    const dialog = m.by('connector-page-disconnect-dialog');
    assert.ok(dialog, 'a confirm, not a disconnect');
    assert.equal(m.props(dialog).role, 'dialog');
    assert.equal(m.text(m.by('connector-page-disconnect-note')).trim(), disconnectNote(row('stripe')));
    assert.equal(deletes().length, 0);
    const cancel = [...(function* walk(n) { yield n; for (const c of n.childNodes || []) yield* walk(c); })(dialog)].find((n) => n.tagName === 'BUTTON' && m.text(n).trim() === 'Cancel');
    await act(async () => { m.props(cancel).onClick(); });
    await m.settle();
    assert.equal(m.by('connector-page-disconnect-dialog'), undefined, 'Cancel closes the confirm');
    assert.ok(m.by('connector-page-connection'), 'and only the confirm');

    await m.click('connector-page-manage');
    await m.click('connector-page-manage-disconnect');
    await m.escape();
    assert.equal(m.by('connector-page-disconnect-dialog'), undefined, 'Escape closes the confirm');
    assert.ok(m.by('connector-page-connection'), 'and only the confirm');
    assert.equal(deletes().length, 0, 'Cancel and Escape send nothing');

    await m.click('connector-page-manage');
    await m.click('connector-page-manage-disconnect');
    await m.click('connector-page-confirm-disconnect');
    assert.deepEqual(deletes().map((c) => c.path), ['/connectors/u-stripe'], 'one disconnect, by uid');
  } finally { await m.unmount(); f.restore(); }
});

test('first-party rows disconnect through their own routes, never DELETE /api/connectors/:uid', async () => {
  for (const [key, path] of [['google', '/calendar/google'], ['microsoft', '/calendar/microsoft'], ['linkedin', '/linkedin/disconnect']]) {
    const f = stubFetch(readsOk);
    const m = await mount(page(key), `/account/connectors/${key}`);
    try {
      await m.click('connector-page-manage');
      await m.click('connector-page-manage-disconnect');
      await m.click('connector-page-confirm-disconnect');
      const writes = f.calls.filter((c) => c.method !== 'GET');
      assert.deepEqual(writes.map((c) => c.path), [path], key);
      assert.ok(!f.calls.some((c) => c.path.startsWith('/connectors/')), `${key} never reaches /api/connectors`);
    } finally { await m.unmount(); f.restore(); }
  }
});

test('the inline panel is gone for HubSpot, and kept for GitHub and Mercury only', async () => {
  const f = stubFetch(readsOk);
  try {
    let m = await mount(page('hubspot'), '/account/connectors/hubspot');
    try {
      assert.ok(m.by('connector-page-connection'));
      assert.equal(m.by('connector-page-connect'), undefined, 'no inline panel');
    } finally { await m.unmount(); }
    for (const key of ['github', 'mercury']) {
      m = await mount(page(key), `/account/connectors/${key}`);
      try {
        assert.equal(m.props(m.by('connector-page-connect'))['data-mode'], 'panel', key);
        assert.equal(m.by('connector-page-connection'), undefined, `${key}: F4 and F5 take its section over`);
      } finally { await m.unmount(); }
    }
  } finally { f.restore(); }
});

test('the request form is a centred dialog with aria-modal, and Escape closes it', async () => {
  const f = stubFetch(() => [200, {}]);
  let closed = 0;
  const m = await mount(h(RequestSheet, { tool: 'Notion', onClose() { closed += 1; } }), '/account/connectors');
  try {
    const dialog = m.by('connector-sheet-request');
    assert.equal(m.props(dialog).role, 'dialog');
    assert.equal(m.props(dialog)['aria-modal'], 'true');
    await m.escape();
    assert.equal(closed, 1);
  } finally { await m.unmount(); f.restore(); }
});

test('a Settings dialog takes Escape alone; the page itself has none (moved from the sheet, unchanged)', async () => {
  const f = stubFetch(readsOk);
  const m = await mount(page('hubspot'), '/account/connectors/hubspot');
  try {
    const section = m.by('connector-page-connection');
    const change = [...(function* walk(n) { yield n; for (const c of n.childNodes || []) yield* walk(c); })(section)].find((n) => n.tagName === 'BUTTON' && m.text(n).trim() === 'Change');
    await act(async () => { m.props(change).onClick(); });
    await m.settle();
    const modal = m.by('hubspot-config-modal');
    assert.ok(modal, 'the HubSpot dialog is open');
    assert.equal(m.props(modal)['aria-modal'], 'true');
    await m.escape();
    assert.equal(m.by('hubspot-config-modal'), undefined, 'Escape closes the dialog');
    assert.ok(m.by('connector-page-connection'), 'and only the dialog: the page stays');
    await m.escape();
    assert.ok(m.by('connector-page-connection'), 'the page has no Escape of its own');
  } finally { await m.unmount(); f.restore(); }
});
