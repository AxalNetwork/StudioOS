/**
 * D648 (#1448) — the Admin Console is a shell; each console is its own
 * component, loads only its own data, and says so when that data could not be
 * read.
 *
 * Rendered, with effects run, on a minimal DOM (the one D473's test uses) and
 * with the `api` client's methods replaced by recorders. Three things per
 * console:
 *   · loading: its own first read is in flight, and nothing claims a result;
 *   · empty: the read answered with nothing, and the console says so;
 *   · unreadable: the read failed, and the console says it could not be read
 *     and offers Try again, never the empty list a failed read used to draw.
 * And for the shell: opening one tab calls that console's reads and no other.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_consoles_d648.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import AdminPage from '../src/pages/AdminPage.jsx';
import { LegalPanel, TemplateUsageModal } from '../src/pages/admin/consoles/LegalConsole.jsx';
import { renderToStaticMarkup } from 'react-dom/server';
import UsersConsole from '../src/pages/admin/consoles/UsersConsole.jsx';
import PartnerProfilesConsole from '../src/pages/admin/consoles/PartnerProfilesConsole.jsx';
import KycConsole from '../src/pages/admin/consoles/KycConsole.jsx';
import PersonasPanel from '../src/pages/admin/consoles/PersonasConsole.jsx';
import DirectoryPanel from '../src/pages/admin/consoles/DirectoryConsole.jsx';
import IntegrationKeysPanel from '../src/pages/admin/consoles/IntegrationKeysConsole.jsx';
import GithubSyncPanel from '../src/pages/admin/consoles/GithubSyncConsole.jsx';
import PromoCodesPanel from '../src/pages/admin/consoles/PromoCodesConsole.jsx';
import PaymentsPanel from '../src/pages/admin/consoles/PaymentsConsole.jsx';
import WellbeingExpertsPanel from '../src/pages/admin/consoles/WellbeingConsole.jsx';

// ── A DOM just large enough for React to mount into ─────────────────────────
function makeNode(tag) {
  return {
    tagName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    nodeType: tag === '#text' ? 3 : 1,
    nodeName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    childNodes: [], options: [], style: {}, parentNode: null, ownerDocument: null, textContent: '',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; },
    insertBefore(child, ref) {
      child.parentNode = this;
      const at = this.childNodes.indexOf(ref);
      if (at < 0) this.childNodes.push(child); else this.childNodes.splice(at, 0, child);
      return child;
    },
    removeChild(child) {
      const at = this.childNodes.indexOf(child);
      if (at >= 0) this.childNodes.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener() {}, removeEventListener() {}, contains() { return false; },
    get firstChild() { return this.childNodes[0] || null; },
  };
}
function installDocument(search = '') {
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'HTMLIFrameElement', 'location', 'localStorage', 'addEventListener', 'removeEventListener'];
  const previous = Object.fromEntries(keys.map((k) => [k, globalThis[k]]));
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  const document = {
    nodeType: 9, nodeName: '#document', activeElement: null, defaultView: globalThis,
    createElement(tag) { const n = makeNode(tag); n.ownerDocument = document; return n; },
    createElementNS(_ns, tag) { return document.createElement(tag); },
    createTextNode(text) { const n = makeNode('#text'); n.textContent = String(text); n.ownerDocument = document; return n; },
    addEventListener() {}, removeEventListener() {},
  };
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body');
  globalThis.document = document;
  globalThis.HTMLElement = function HTMLElement() {};
  globalThis.Element = function Element() {};
  globalThis.Node = function Node() {};
  globalThis.HTMLIFrameElement = function HTMLIFrameElement() {};
  globalThis.location = { search, pathname: '/admin', hash: '' };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.getSelection = () => null;
  return () => { for (const [k, v] of Object.entries(previous)) globalThis[k] = v; };
}
const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');

// ── The api client, replaced by recorders ───────────────────────────────────
const ORIGINAL = { ...api };
const NEVER = () => new Promise(() => {});
/** Every method records its name and answers from `answers`, or never answers. */
function stubApi(answers) {
  const calls = [];
  for (const k of Object.keys(ORIGINAL)) {
    if (typeof ORIGINAL[k] !== 'function') continue;
    api[k] = (...args) => { calls.push(k); return k in answers ? answers[k](...args) : NEVER(); };
  }
  return calls;
}
function restoreApi() { Object.assign(api, ORIGINAL); }

async function mount(element, search = '') {
  const restoreDoc = installDocument(search);
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: [`/admin${search}`] }, element));
  });
  // Let a resolved or rejected read settle into state.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return {
    text: () => textOf(container),
    async click(label) {
      const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
      const button = walk(container).find((node) => node.tagName === 'BUTTON' && textOf(node).trim() === label);
      assert.ok(button, `No button: ${label}`);
      const props = Object.entries(button).find(([key]) => key.startsWith('__reactProps$'))?.[1];
      assert.equal(typeof props?.onClick, 'function');
      await act(async () => { props.onClick(); });
    },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

const fail = () => Promise.reject(new Error('read failed'));
const UNREADABLE = /could not be read\. This is not a sign that there are none\.\s*Try again/;

/** Each console: its reads, what an empty answer is, and what it then says. */
const CONSOLES = [
  { name: 'Contracts', el: () => React.createElement(LegalPanel), reads: ['adminContractStats', 'adminListContracts'],
    empty: { adminContractStats: async () => ({ total: 0, by_type: [] }), adminListContracts: async () => ({ items: [], total: 0 }) },
    says: /No contracts found/, loading: /Loading…/ },
  { name: 'Users', el: () => React.createElement(UsersConsole), reads: ['adminListUsers'],
    empty: { adminListUsers: async () => ({ results: [], total: 0, by_role: {} }) }, says: /No users found/, loading: /Loading admin console\.\.\./ },
  { name: 'Partner Profiles', el: () => React.createElement(PartnerProfilesConsole), reads: ['adminListProfiles'],
    empty: { adminListProfiles: async () => [] }, says: /No profiles captured yet/, loading: /Loading admin console\.\.\./ },
  { name: 'KYC', el: () => React.createElement(KycConsole), reads: ['kycAdminQueue'],
    empty: { kycAdminQueue: async () => [] }, says: /No submissions in pending status/, loading: /Loading admin console\.\.\./ },
  { name: 'Personas', el: () => React.createElement(PersonasPanel), reads: ['listPersonasAdmin'],
    empty: { listPersonasAdmin: async () => ({ users: [] }) }, says: /No users\./, loading: /Loading/ },
  { name: 'Directory', el: () => React.createElement(DirectoryPanel), reads: ['adminListDirectoryPartners'],
    empty: { adminListDirectoryPartners: async () => ({ partners: [] }) }, says: /No partners found\./, loading: /Loading/ },
  { name: 'Integration keys', el: () => React.createElement(IntegrationKeysPanel), reads: ['adminListIntegrationKeys'],
    empty: { adminListIntegrationKeys: async () => ({ providers: [] }) }, says: null, loading: /Loading providers/ },
  { name: 'GitHub Sync', el: () => React.createElement(GithubSyncPanel), reads: ['adminGetGithubConfig'],
    empty: { adminGetGithubConfig: async () => ({}) }, says: /Repository · set at deploy time/, loading: /Loading GitHub settings/ },
  { name: 'Promo codes', el: () => React.createElement(PromoCodesPanel), reads: ['adminListPromos'],
    empty: { adminListPromos: async () => ({ promos: [] }), catalogProducts: async () => ({ products: [] }) }, says: /No promo codes yet\./, loading: /Loading/ },
  { name: 'Payments', el: () => React.createElement(PaymentsPanel), reads: ['adminCatalogList'],
    empty: { adminCatalogList: async () => ({ products: [] }) }, says: /No products yet/, loading: /Loading catalog/,
    // A failed read also raises a toast, and Payments draws `{toast}` as a
    // child: that crash is #1437's (PR #1443 draws it through ToastMessage),
    // not this split's. Its Unreadable branch is pinned from source below.
    skipFailedRender: '#1437' },
  { name: 'Wellbeing', el: () => React.createElement(WellbeingExpertsPanel), reads: ['wellbeingExperts'],
    empty: { wellbeingExperts: async () => ({ matches: [] }) }, says: /No experts match the current filter\./, loading: /Loading experts/ },
];

for (const c of CONSOLES) {
  test(`${c.name}: loading, empty and unreadable, each on its own`, async () => {
    // Loading: the read never answers.
    stubApi({});
    let v = await mount(c.el());
    try {
      assert.match(v.text(), c.loading, `${c.name} does not say it is loading`);
      assert.doesNotMatch(v.text(), /could not be read/);
      if (c.says) assert.doesNotMatch(v.text(), c.says, `${c.name} claims a result before its read answered`);
    } finally { await v.unmount(); restoreApi(); }

    // Empty: the read answers with nothing.
    stubApi(c.empty);
    v = await mount(c.el());
    try {
      if (c.says) assert.match(v.text(), c.says, `${c.name} does not say it is empty`);
      assert.doesNotMatch(v.text(), /could not be read/, `${c.name} calls an empty answer unreadable`);
      assert.doesNotMatch(v.text(), c.loading);
    } finally { await v.unmount(); restoreApi(); }

    if (c.skipFailedRender) return;
    // Unreadable: the read fails.
    const failing = { ...c.empty };
    for (const r of c.reads) failing[r] = fail;
    stubApi(failing);
    v = await mount(c.el());
    try {
      assert.match(v.text(), UNREADABLE, `${c.name} does not say its read failed`);
      if (c.says) assert.doesNotMatch(v.text(), c.says, `${c.name} draws a failed read as an empty list`);
    } finally { await v.unmount(); restoreApi(); }
  });
}

test('Payments: a failed catalog read draws Unreadable, never "No products yet"', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/consoles/PaymentsConsole.jsx'), 'utf8');
  const load = src.slice(src.indexOf('const loadProducts'), src.indexOf('const loadWebhooks'));
  assert.match(load, /catch \(e\) \{[\s\S]*?setFailed\(true\);\s*\} finally/);
  assert.match(load, /setProducts\(r\.products \|\| \[\]\);\s*setFailed\(false\);/);
  const list = src.slice(src.indexOf('{productsLoading ? ('));
  assert.ok(list.indexOf('<ConsoleUnreadable') > 0 && list.indexOf('<ConsoleUnreadable') < list.indexOf('No products yet'),
    'the failed branch is not drawn before the empty one');
});

test('Billing: a failed disputes read draws Unreadable, never "No disputes loaded"', () => {
  // Billing reads its disputes on a click, not on mount, so this is pinned
  // from source: the click handler is not reachable on this minimal DOM.
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/consoles/BillingConsole.jsx'), 'utf8');
  const load = src.slice(src.indexOf('const loadDisputes'), src.indexOf('const submitEvidence'));
  assert.match(load, /catch \(err\) \{[\s\S]*?setFailed\(true\);\s*\} finally/);
  assert.match(load, /setDisputes\(r\.disputes \|\| \[\]\);\s*setFailed\(false\);/);
  const list = src.slice(src.indexOf('{failed ? ('));
  assert.ok(list.indexOf('<ConsoleUnreadable what="The disputes"') >= 0
    && list.indexOf('<ConsoleUnreadable') < list.indexOf('No disputes loaded'), 'the failed branch is not drawn before the empty one');
});

// ── The shell fetches only the open console's data ──────────────────────────
const OWN = {
  users: ['adminListUsers', 'trustScoreBatch'],
  profiles: ['adminListProfiles'],
  kyc: ['kycAdminQueue'],
  personas: ['listPersonasAdmin'],
  directory: ['adminListDirectoryPartners'],
  // Integration keys and GitHub Sync left the console for HQ's own page
  // (the owner's ruling, 2026-10-20); `integration_keys_hq_only.test.mjs`.
  promos: ['adminListPromos', 'catalogProducts'],
  payments: ['adminCatalogList', 'adminStripeGetConfig', 'adminStripeListWebhooks'],
  wellbeing: ['wellbeingExperts'],
};
/** The reads every tab used to make before it rendered anything. */
const SHARED_BEFORE = ['adminListUsers', 'adminListProfiles', 'kycAdminQueue', 'trustScoreBatch'];

for (const [tab, own] of Object.entries(OWN)) {
  test(`opening ?tab=${tab} reads that console's data and nothing else`, async () => {
    const calls = stubApi({});
    const v = await mount(React.createElement(AdminPage), `?tab=${tab}`);
    try {
      const made = [...new Set(calls)];
      assert.ok(made.length > 0, `${tab} made no read at all`);
      for (const k of made) assert.ok(own.includes(k), `${tab} called ${k}, which is not its own read`);
      for (const k of SHARED_BEFORE) {
        if (!own.includes(k)) assert.ok(!made.includes(k), `${tab} still reads ${k} before it renders`);
      }
    } finally { await v.unmount(); restoreApi(); }
  });
}

test('the shell keeps its tabs, its ?tab= links and its admin-tab-* hooks', async () => {
  stubApi({});
  const v = await mount(React.createElement(AdminPage), '?tab=directory');
  try {
    assert.match(v.text(), /Admin Console/);
    assert.match(v.text(), /Directory/, 'the dropdown does not name the open console');
  } finally { await v.unmount(); restoreApi(); }
  const shell = readFileSync(resolve(process.cwd(), 'frontend/src/pages/AdminPage.jsx'), 'utf8');
  assert.match(shell, /data-testid=\{`admin-tab-\$\{s\.value\}`\}/);
  assert.ok(shell.split('\n').length < 300, 'the shell is a shell: the consoles live in their own files');
});

test('HQ · Accounts mounts the Users console alone, not the whole Admin Console', () => {
  const page = readFileSync(resolve(process.cwd(), 'frontend/src/pages/hq/AccountsPage.jsx'), 'utf8');
  assert.match(page, /<UsersConsole onImpersonate=\{onImpersonate\} \/>/);
  assert.doesNotMatch(page, /<AdminPage\b/);
  assert.doesNotMatch(page, /from '\.\.\/AdminPage'/);
});


test('D647: Contracts has a real formation-orders destination and no dead Incorporation tab', () => {
  const markup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(LegalPanel)));
  assert.match(markup, /href="\/admin\/spinout-lab"/);
  assert.match(markup, /Programs › Spin-Out Lab/);
  assert.match(markup, /Open its Formation orders tab/);
  assert.doesNotMatch(markup, /legal-sub-incorporation|legal-incorporation-placeholder|Incorporation packets will appear/);
});

test('D647: empty agreements and template usage point at the visible envelope action', async () => {
  for (const [element, answers, expected] of [
    [React.createElement(LegalPanel), {
      adminContractStats: async () => ({ total: 0, by_type: [] }),
      adminListContracts: async () => ({ items: [], total: 0 }),
    }, /No contracts found\. Use New envelope to send an agreement\./],
    [React.createElement(TemplateUsageModal, { docType: 'safe', onClose() {} }), {
      adminContractTemplateUsage: async () => ({ items: [], stats: { total: 0, by_status: { signed: 0, sent: 0, void: 0 } } }),
    }, /This template hasn't been used yet\. Use New envelope in Contracts to send an agreement\./],
  ]) {
    stubApi(answers);
    const v = await mount(element);
    try {
      assert.match(v.text(), expected);
      assert.doesNotMatch(v.text(), /Profiles tab/);
    } finally { await v.unmount(); restoreApi(); }
  }
});

test('D647: Contracts imports its own desk without the Admin Console module', () => {
  const page = readFileSync(resolve(process.cwd(), 'frontend/src/pages/hq/ContractsPage.jsx'), 'utf8');
  assert.match(page, /export \{ default \} from '\.\.\/admin\/contracts\/ContractsDesk\.jsx'/);
  assert.doesNotMatch(page, /from '\.\.\/AdminPage'/);
});


test('D647: retrying an unreadable agreement list loads again and clears the failed state', async () => {
  let calls = 0;
  let finish;
  stubApi({
    adminContractStats: async () => ({ total: 0, by_type: [] }),
    adminListContracts: () => ++calls === 1 ? fail() : new Promise((resolve) => { finish = resolve; }),
  });
  const v = await mount(React.createElement(LegalPanel));
  try {
    assert.match(v.text(), UNREADABLE);
    await v.click('Try again');
    assert.equal(calls, 2);
    assert.match(v.text(), /Loading…/);
    assert.doesNotMatch(v.text(), /could not be read|No contracts found/);
    await act(async () => { finish({ items: [], total: 0 }); });
    assert.match(v.text(), /No contracts found/);
    assert.doesNotMatch(v.text(), /could not be read|Loading…/);
  } finally { await v.unmount(); restoreApi(); }
});
