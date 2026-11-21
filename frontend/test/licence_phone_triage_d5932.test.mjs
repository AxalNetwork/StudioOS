/**
 * D4819 part 20 (#5932) — Licences v2 board L20: on a phone (below `md`, the
 * `BELOW_MD_QUERY` of `ui/phone/usePhoneWidth.js`) a licence is a triage view,
 * not the desktop workstation.
 *
 *   - the order: search, identity, primary status, items that need HQ,
 *     requests and decisions, agreement, history (then the tabs);
 *   - no terms editor: Amend terms, the Territory picker and the Terms
 *     schedule form are not offered; the Terms read is, with a sentence why;
 *   - the six section tabs are a 3 × 2 grid of 44px tabs with the same keys,
 *     so the strip never scrolls the page sideways;
 *   - touch targets are at least 44px (the triage rows 56px, the primary 48px).
 *
 * The page is mounted on fake Worker reads with `matchMedia` answering the
 * phone query, and again with it not, so each phone assertion has a desk twin.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_phone_triage_d5932.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { Detail } from '../src/pages/admin/licences/LicenceDetail.jsx';
import AdminLicences from '../src/pages/admin/AdminLicences.jsx';
import { BELOW_MD_QUERY } from '../src/ui/phone/usePhoneWidth.js';
import {
  LICENCE_TABS, phoneSectionTabs, phoneStep, sectionTabs, stepOfTab,
} from '../src/pages/admin/licenceNavModel.js';
import { identityFacts, overviewFacts, phoneIdentity, phoneTriage } from '../src/pages/admin/licenceOverviewModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const h = React.createElement;
const NOW = '2026-11-09T12:00:00Z';

const PENDING = {
  available: true, hq_revision: 143, branch_revision: 142, last_success_at: '2026-11-09 11:56:00',
  pending: { revision: 143, failure_code: 'unreachable', attempts: 2, last_attempt_at: '2026-11-09 11:54:00' },
  pending_available: true, termination: null, termination_available: true,
};
const LICENCE = {
  uid: 'lic_fr', licence_ref: 'AXL-FR-001', brand_name: 'Axal VC France', legal_entity_name: 'Axal VC France SAS', kind: 'subsidiary',
  status: 'active', territories: ['FR'], seats: { founder: 25, investor: 10, advisor: 5 }, seats_licensed: 40,
  annual_fee_cents: 10000000, currency: 'EUR', revenue_share_bps: 1200, token_split_bps: 5000, term_years: 3,
  starts_on: '2026-03-02', renews_on: '2099-03-01', terms_revision: 4, status_note: null,
  deployment: { hostname: 'fr.axal.vc', status: 'linked' }, deployment_available: true,
  domain: null, domain_available: true, sync: PENDING, blockers: [], events: [],
};
const SIGNED = { contracts_available: true, templates: [], contracts: [
  { uid: 'c1', status: 'signed', template_title: 'Subsidiary Licence Agreement', template_version: 4, signed_at: '2026-03-02', superseded_at: null },
] };
const OVERDUE = { annual_fee_cents: 10000000, currency: 'EUR', starts_on: '2026-03-02', invoices: [
  { uid: 'i2', status: 'issued', period_label: '2026–27', currency: 'EUR', amount_cents: 9000000, paid_cents: 0, outstanding_cents: 9000000, due_at: '2026-10-01', paid_at: null },
] };
const TWO_REQUESTS = { available: true, items: [{ uid: 'r1', created_at: '2026-11-05 10:00:00' }], total: 2, next_cursor: null, branch_readable: true };
const NO_REQUESTS = { available: true, items: [], total: 0, next_cursor: null, branch_readable: true };
const ADMINS = { items: [{ user_id: 1, name: 'C. Martin', admin_role: 'admin', is_active: 1 }] };
const DEPLOYED = { deployment: { phase: 'committed', last_failure: null } };
const READS = { contract: SIGNED, deployment: DEPLOYED, requests: TWO_REQUESTS, invoices: OVERDUE, admins: ADMINS };

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

function worker({ requests = TWO_REQUESTS, fail = {} } = {}) {
  return (url) => {
    const u = new URL(url, 'http://x');
    const p = u.pathname.replace(/^\/api/, '');
    const answer = (key, body) => (fail[key] ? response({ error: 'down' }, 500) : response(body));
    if (p === '/admin/licences') return response({ items: [LICENCE], total: 1, next_cursor: null, limit: 50, seats_used_available: true });
    if (p === '/admin/licences/summary') return response({ coverage: [], renewals: { items: [], total: 0, complete: true }, counts: { total: 1, by_status: { active: 1 }, by_kind: { subsidiary: 1 } } });
    if (p === '/admin/licences/territories') return response({ items: [] });
    if (p === '/admin/licences/lic_fr') return response(LICENCE);
    if (p === '/admin/licences/lic_fr/contract') return answer('contract', SIGNED);
    if (p === '/admin/licences/lic_fr/requests') return answer('requests', requests);
    if (p === '/admin/licences/lic_fr/fee-invoices') return answer('invoices', OVERDUE);
    if (p === '/admin/licences/lic_fr/admins') return answer('admins', ADMINS);
    if (p === '/admin/licences/lic_fr/deployment') return answer('deployment', DEPLOYED);
    return response({ error: 'not_found' }, 404);
  };
}

/** `matchMedia` answering the phone query (`phone`) and nothing else. */
const media = (phone) => (query) => ({
  matches: phone && query === BELOW_MD_QUERY, media: query, addEventListener() {}, removeEventListener() {},
});

const flushAll = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });

function harness(container) {
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  /** Where each test id first appears in document order, or -1. */
  const at = (id) => nodes().findIndex((n) => props(n)['data-testid'] === id);
  return { nodes, props, byId, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), at };
}

async function mountDetail({ phone, tab = 'overview', handle = worker() }) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u, options = {}) => handle(String(u), options);
  globalThis.matchMedia = media(phone);
  const container = document.createElement('div'); document.body.appendChild(container);
  const v = harness(container);
  const focused = [];
  document.getElementById = (id) => (v.nodes().some((x) => v.props(x).id === id) ? { focus: () => focused.push(id) } : null);
  const tabs = [];
  function Host() {
    const [t, setT] = useState(tab);
    return h(Detail, { uid: 'lic_fr', held: [], tab: t, onTab: (x) => { tabs.push(x); setT(x); } });
  }
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(MemoryRouter, null, h(Host))));
  await flushAll();
  return {
    ...v, tabs, focused,
    async click(id) { const p = v.props(v.byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flushAll(); },
    async key(id, key) { await act(async () => { v.props(v.byId(id)).onKeyDown({ key, preventDefault() {} }); }); await flushAll(); },
    async close() {
      await act(async () => rootNode.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      restore();
    },
  };
}

// ── the model ───────────────────────────────────────────────────────────────

test('L20 model: a phone drops the terms editors from Terms, and their tabs read as the Terms view', () => {
  assert.deepEqual(sectionTabs('terms', 'subsidiary').map((t) => t.key), ['terms', 'territory', 'schedule'], 'the desk keeps all three');
  assert.deepEqual(phoneSectionTabs('terms', 'subsidiary').map((t) => t.key), ['terms']);
  assert.equal(phoneStep(stepOfTab('territory')), stepOfTab('terms'));
  assert.equal(phoneStep(stepOfTab('schedule')), stepOfTab('terms'));
  // Every other tab is the phone's as it is the desk's: nothing else is taken away.
  for (const t of LICENCE_TABS.filter((x) => x.key !== 'territory' && x.key !== 'schedule')) {
    assert.equal(phoneStep(t.step), t.step, t.key);
    assert.ok(phoneSectionTabs(t.section, 'white_label').some((x) => x.key === t.key), `${t.key} still reachable`);
  }
  // Still filtered by kind: a subsidiary has no Brand kit on a phone either.
  assert.ok(!phoneSectionTabs('overview', 'subsidiary').some((t) => t.key === 'brand'));
});

test('L20 model: triage is requests and decisions, then the agreement, then history; requests waiting lead as the primary', () => {
  const facts = overviewFacts(LICENCE, READS, NOW);
  const rows = phoneTriage(facts);
  assert.deepEqual(rows.map((r) => r.key), ['requests', 'agreement', 'history']);
  assert.deepEqual(rows.map((r) => r.tab), ['notices', 'contract', 'history']);
  assert.equal(rows[0].kind, 'primary'); assert.equal(rows[0].title, 'Review 2 requests');
  assert.equal(phoneTriage(overviewFacts(LICENCE, { ...READS, requests: { ...TWO_REQUESTS, total: 1 } }, NOW))[0].title, 'Review 1 request');
  assert.equal(rows[1].word, 'Executed'); assert.equal(rows[1].state, 'ok');
  // None is a row that says None, never "Review 0 requests".
  const none = phoneTriage(overviewFacts(LICENCE, { ...READS, requests: NO_REQUESTS }, NOW))[0];
  assert.equal(none.kind, 'row'); assert.equal(none.word, 'None'); assert.equal(none.state, 'none');
  // A failed read is Unavailable with its retry; one still on its way is Reading.
  const down = phoneTriage(overviewFacts(LICENCE, { ...READS, requests: false, contract: false }, NOW));
  assert.equal(down[0].state, 'unavailable'); assert.equal(down[0].retry, 'requests');
  assert.equal(down[1].state, 'unavailable'); assert.equal(down[1].retry, 'contract');
  assert.equal(phoneTriage(overviewFacts(LICENCE, {}, NOW))[1].state, 'reading');
  assert.equal(phoneIdentity(identityFacts(LICENCE, facts)), 'AXL-FR-001 · FR');
});

// ── the licence, mounted at phone width ─────────────────────────────────────

test('L20 mounted: identity, status, Needs HQ, requests, agreement, history, then the tabs; the desk keeps its header', async () => {
  const v = await mountDetail({ phone: true });
  try {
    const order = ['licence-identity', 'licence-identity-status', 'licence-attention', 'licence-triage-requests', 'licence-triage-agreement', 'licence-triage-history', 'licence-tabs'];
    const at = order.map((id) => v.at(id));
    assert.ok(at.every((i) => i >= 0), `all drawn: ${order.filter((id, i) => at[i] < 0)}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, `in the board's order: ${at}`);
    assert.equal(v.textOf('licence-identity-line'), 'AXL-FR-001 · FR');
    for (const k of ['ref', 'territory', 'type', 'renewal', 'agreement', 'branch']) assert.equal(v.has(`licence-identity-${k}`), false, `${k} is not in the phone header`);
    assert.match(v.textOf('licence-identity-status'), /Active/);
    assert.ok(v.has('licence-attention-list'), 'each item that needs HQ is its own line');
    assert.equal(v.textOf('licence-triage-requests'), 'Review 2 requests');
    assert.match(v.textOf('licence-triage-agreement'), /Agreement.*Executed/);
    // The Overview does not repeat what sits above the tabs; the other facts stay.
    for (const k of ['licence', 'agreement', 'requests']) assert.equal(v.has(`licence-fact-${k}`), false, k);
    for (const k of ['commercial', 'access', 'branch', 'billing']) assert.ok(v.has(`licence-fact-${k}`), k);
    assert.equal(v.has('licence-requests'), false, 'the requests side panel steps aside for the Requests row');
    await v.click('licence-triage-requests');
    assert.equal(v.tabs.at(-1), 'notices', 'Review opens Requests and compliance');
    assert.equal(v.has('licence-phone-triage'), false, 'triage is the Overview’s');
  } finally { await v.close(); }
  const d = await mountDetail({ phone: false });
  try {
    assert.equal(d.has('licence-phone-triage'), false);
    assert.ok(d.has('licence-identity-agreement') && d.has('licence-kind-pill'), 'the desk header keeps its seven facts');
    assert.ok(d.has('licence-fact-requests') && d.has('licence-requests'));
    assert.equal(d.has('licence-attention-list'), false);
  } finally { await d.close(); }
});

test('L20 mounted: an unread agreement says Unavailable with its own Try again, outside the row', async () => {
  const v = await mountDetail({ phone: true, handle: worker({ requests: NO_REQUESTS, fail: { contract: true } }) });
  try {
    assert.match(v.textOf('licence-triage-requests'), /Requests and decisions.*None/);
    assert.match(v.textOf('licence-triage-agreement'), /Unavailable/);
    const retry = v.nodes().find((n) => v.props(n)['aria-label'] === 'Try reading agreement again');
    assert.ok(retry, 'Try again is offered');
    let p = retry; let inRow = false;
    while (p) { if (v.props(p)['data-testid'] === 'licence-triage-agreement') inRow = true; p = p.parentNode; }
    assert.equal(inRow, false, 'never a button inside a button');
  } finally { await v.close(); }
});

test('L20 mounted: no terms editor on a phone; Terms stay readable, even when the URL names an editor', async () => {
  for (const tab of ['terms', 'territory', 'schedule']) {
    // eslint-disable-next-line no-await-in-loop
    const v = await mountDetail({ phone: true, tab });
    try {
      assert.ok(v.has('licence-terms-workspace'), `${tab}: the Terms read is drawn`);
      assert.equal(v.has('licence-terms-amend'), false, `${tab}: Amend terms is not offered`);
      assert.match(v.textOf('licence-terms-phone-note'), /amended on a wider screen/);
      assert.equal(v.has('licence-terms-schedule'), false, `${tab}: the schedule form is not`);
      assert.equal(v.has('licence-subtabs'), false, `${tab}: no Territory or Terms schedule tab`);
      assert.equal(v.props(v.byId('licence-section-terms'))['aria-selected'], true);
    } finally { await v.close(); } // eslint-disable-line no-await-in-loop
  }
  const d = await mountDetail({ phone: false, tab: 'terms' });
  try {
    assert.ok(d.has('licence-terms-amend'), 'the desk still amends');
    assert.equal(d.has('licence-terms-phone-note'), false);
    assert.deepEqual(d.nodes().filter((n) => String(d.props(n).id || '').startsWith('licence-tab-')).map((n) => d.props(n).id),
      ['licence-tab-terms', 'licence-tab-territory', 'licence-tab-schedule']);
  } finally { await d.close(); }
});

test('L20 mounted: the section tabs are a 3 × 2 grid of 44px tabs, keyboard-reachable, with no sideways scroll', async () => {
  const v = await mountDetail({ phone: true });
  try {
    const strip = v.props(v.byId('licence-tabs'));
    assert.equal(strip.role, 'tablist');
    assert.match(strip.className, /^mt-6 grid grid-cols-3 /, 'a grid below md');
    assert.doesNotMatch(strip.className.replace(/md:\S+/g, ''), /overflow-x-auto|whitespace-nowrap|-mx-1/, 'nothing scrolls or overhangs below md');
    const sections = v.nodes().filter((n) => v.props(n).role === 'tab' && String(v.props(n).id || '').startsWith('licence-section-'));
    assert.equal(sections.length, 6);
    for (const s of sections) assert.match(v.props(s).className, /(^|\s)min-h-\[44px\](\s|$)/, v.props(s).id);
    assert.deepEqual(sections.map((n) => v.props(n).tabIndex), [0, -1, -1, -1, -1, -1], 'roving focus');
    await v.key('licence-tabs', 'ArrowRight');
    assert.equal(v.tabs.at(-1), 'terms');
    assert.deepEqual(v.focused.slice(-1), ['licence-section-terms']);
    await v.key('licence-tabs', 'End');
    assert.equal(v.tabs.at(-1), 'history');
    // The second row wraps below md, and each of its tabs is 44px too.
    await v.click('licence-section-operations');
    assert.match(v.props(v.byId('licence-subtabs')).className, /^mt-2 flex flex-wrap /);
    const sub = v.nodes().filter((n) => String(v.props(n).id || '').startsWith('licence-tab-'));
    for (const s of sub) assert.match(v.props(s).className, /(^|\s)min-h-\[44px\](\s|$)/, v.props(s).id);
    // The panel's grid is one minmax(0, 1fr) column below lg, so a wide child cannot widen the page.
    assert.ok(v.nodes().some((n) => /^mt-4 grid grid-cols-1 /.test(v.props(n).className || '')));
  } finally { await v.close(); }
});

test('L20 mounted: the triage rows are touch targets (56px rows, a 48px primary)', async () => {
  const v = await mountDetail({ phone: true });
  try {
    assert.match(v.props(v.byId('licence-triage-requests')).className, /min-h-\[48px\]/);
    for (const k of ['agreement', 'history']) assert.match(v.props(v.byId(`licence-triage-${k}`)).className, /min-h-\[56px\]/, k);
  } finally { await v.close(); }
});

// ── the page: search first, and 44px targets ────────────────────────────────

test('L20 page: search leads the licence view on a phone and returns to the ledger with the query', async () => {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => worker()(String(u));
  globalThis.matchMedia = media(true);
  const container = document.createElement('div'); document.body.appendChild(container);
  const v = harness(container);
  const loc = { path: '' };
  function Probe() { const l = useLocation(); loc.path = `${l.pathname}${l.search}`; return null; }
  const rootNode = createRoot(container);
  try {
    await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: ['/admin/licences?licence=lic_fr'] },
      h(Routes, null, h(Route, { path: '/admin/licences', element: h(React.Fragment, null, h(AdminLicences), h(Probe)) })))));
    await flushAll();
    assert.ok(v.at('licence-phone-search') >= 0 && v.at('licence-phone-search') < v.at('licence-breadcrumb'), 'search comes first');
    assert.ok(v.at('licence-breadcrumb') < v.at('licence-identity'), 'then the licence');
    assert.match(v.props(v.byId('licence-phone-search')).className, /md:hidden/, 'the desk keeps its ledger search');
    assert.match(v.props(v.byId('licence-phone-search-input')).className, /min-h-\[44px\]/);
    await act(async () => { v.props(v.byId('licence-phone-search-input')).onChange({ target: { value: ' AXL-FR ' } }); });
    await act(async () => { v.props(v.byId('licence-phone-search')).onSubmit({ preventDefault() {} }); });
    await flushAll();
    assert.equal(loc.path, '/admin/licences', 'back on the ledger');
    assert.equal(v.props(v.byId('licence-search')).value, 'AXL-FR', 'with the search typed in');
    // Every button, select and text field on the page is 44px below md.
    const page = read('frontend/src/pages/admin/AdminLicences.jsx');
    assert.match(page, /const PHONE_TARGETS = 'max-md:\[&_button\]:min-h-\[44px\] max-md:\[&_select\]:min-h-\[44px\] max-md:\[&_input:not\(\[type=checkbox\]\):not\(\[type=radio\]\)\]:min-h-\[44px\]';/);
    assert.equal((page.match(/max-w-6xl px-4 py-6 \$\{PHONE_TARGETS\}/g) || []).length, 3, 'on the licence, the zero state and the ledger');
    // A ledger row on a phone is one target: the licence link covers the row.
    assert.ok(v.nodes().some((n) => v.props(n)['data-testid'] === 'licence-list-row' && /min-h-\[56px\]/.test(v.props(n).className)));
    assert.ok(v.nodes().some((n) => v.props(n)['data-testid'] === 'licence-row-link' && /after:inset-0/.test(v.props(n).className)));
  } finally {
    await act(async () => rootNode.unmount());
    globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
    restore();
  }
});
