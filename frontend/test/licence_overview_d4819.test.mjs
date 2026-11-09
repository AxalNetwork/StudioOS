/**
 * D4819 (#4819), Build part 3 — a licence's identity header, its six sections
 * and its Overview (Licences v2 boards L03 healthy and L04 with operational
 * problems), the model and the detail view mounted on fake Worker reads.
 *
 *   - the header's facts (reference, territory, type, status, renewal,
 *     executed agreement, branch sync) each carry their own state;
 *   - the Overview keeps Licence, Agreement, Commercial, Access, Branch,
 *     Billing and Requests apart, never one badge, never 0 for unknown;
 *   - Not recorded, None, Unavailable (with Try again), Not instrumented and
 *     Reading are distinct;
 *   - the sections are keyboard tabs, URL-backed, and every tab the view had
 *     before is still reachable under one of them.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_overview_d4819.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { Detail } from '../src/pages/admin/licences/LicenceDetail.jsx';
import { deepLinkTarget } from '../src/pages/admin/licences/LicenceDeepLink.jsx';
import {
  DEFAULT_TAB, LICENCE_SECTIONS_NAV, LICENCE_TABS, sectionOfTab, sectionTabs,
} from '../src/pages/admin/licenceNavModel.js';
import { LICENCE_SECTIONS, tabForSection } from '../src/pages/admin/licenceLedgerModel.js';
import {
  accessFact, agreementFact, attentionItems, billingFact, branchFact, commercialFact, identityFacts, licenceFact,
  overviewFacts, requestsFact, sourcesOf,
} from '../src/pages/admin/licenceOverviewModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const h = React.createElement;
const NOW = '2026-11-09T12:00:00Z';

const SYNCED = {
  available: true, hq_revision: 143, branch_revision: 143, last_success_at: '2026-11-09 11:56:00',
  pending: null, pending_available: true, termination: null, termination_available: true,
};
const HEALTHY = {
  uid: 'lic_fr', licence_ref: 'AXL-FR-001', brand_name: 'Axal VC France', legal_entity_name: 'Axal VC France SAS', kind: 'subsidiary',
  status: 'active', territories: ['FR'], seats: { founder: 25, investor: 10, advisor: 5 }, seats_licensed: 40,
  annual_fee_cents: 10000000, currency: 'EUR', revenue_share_bps: 1200, token_split_bps: 5000, term_years: 3,
  starts_on: '2026-03-02', renews_on: '2099-03-01', terms_revision: 4, status_note: null,
  deployment: { hostname: 'fr.axal.vc', status: 'linked' }, deployment_available: true,
  domain: null, domain_available: true, sync: SYNCED, blockers: [], events: [],
};
const PENDING = {
  ...SYNCED, branch_revision: 142,
  pending: { revision: 143, failure_code: 'unreachable', attempts: 2, last_attempt_at: '2026-11-09 11:54:00' },
};
const SIGNED = { contracts_available: true, templates: [], contracts: [
  { uid: 'c1', status: 'signed', template_title: 'Subsidiary Licence Agreement', template_version: 4, signed_at: '2026-03-02', superseded_at: null },
] };
const DEPLOYED = { deployment: { phase: 'committed', last_failure: null } };
const PAID = { annual_fee_cents: 10000000, currency: 'EUR', starts_on: '2026-03-02', invoices: [
  { uid: 'i1', status: 'paid', period_label: '2026–27', currency: 'EUR', amount_cents: 10000000, paid_cents: 10000000, outstanding_cents: 0, due_at: '2026-04-01', paid_at: '2026-03-28' },
] };
const OVERDUE = { ...PAID, invoices: [
  { uid: 'i2', status: 'issued', period_label: '2026–27', currency: 'EUR', amount_cents: 9000000, paid_cents: 0, outstanding_cents: 9000000, due_at: '2026-10-01', paid_at: null },
  ...PAID.invoices,
] };
const NO_REQUESTS = { available: true, items: [], total: 0, next_cursor: null, branch_readable: true };
const TWO_REQUESTS = { available: true, items: [{ uid: 'r1', created_at: '2026-11-05 10:00:00' }], total: 2, next_cursor: 'x', branch_readable: true };
const ADMINS = { items: [{ user_id: 1, name: 'C. Martin', admin_role: 'admin', is_active: 1 }, { user_id: 2, name: 'L. Bernard', admin_role: 'admin', is_active: 1 }] };

const HEALTHY_READS = { contract: SIGNED, deployment: DEPLOYED, requests: NO_REQUESTS, invoices: PAID, admins: ADMINS };
const byKey = (facts) => Object.fromEntries(facts.map((f) => [f.key, f]));

// ── the model ───────────────────────────────────────────────────────────────

test('L03: a healthy licence reads seven separate facts, each in its own state, and nothing needs HQ', () => {
  const facts = overviewFacts(HEALTHY, HEALTHY_READS, NOW);
  assert.deepEqual(facts.map((f) => f.label), ['Licence', 'Agreement', 'Commercial', 'Access', 'Branch', 'Billing', 'Requests']);
  const f = byKey(facts);
  assert.equal(f.licence.word, 'Active'); assert.equal(f.licence.state, 'ok'); assert.equal(f.licence.detail, 'Since 2026-03-02');
  assert.equal(f.agreement.word, 'Executed'); assert.match(f.agreement.detail, /template v4 · signed 2026-03-02/);
  assert.equal(f.agreement.note, 'Whether today’s terms still match it: Not instrumented', 'a match is never guessed');
  assert.equal(f.commercial.word, '€100,000.00 / year · 12% revenue share');
  assert.equal(f.commercial.detail, 'Token split to the Licensee: 50%');
  assert.equal(f.access.word, '2 administrators'); assert.equal(f.access.detail, '40 seats licensed · utilisation not recorded');
  assert.equal(f.branch.word, 'Synced · revision 143'); assert.equal(f.branch.state, 'ok');
  assert.equal(f.billing.word, 'Paid'); assert.equal(f.requests.word, 'None'); assert.equal(f.requests.state, 'none');
  const a = attentionItems(HEALTHY, facts);
  assert.deepEqual(a.items, []); assert.deepEqual(a.unknown, []);
  const head = Object.fromEntries(identityFacts(HEALTHY, facts).map((r) => [r.key, r]));
  assert.deepEqual(Object.keys(head), ['ref', 'territory', 'type', 'status', 'renewal', 'agreement', 'branch']);
  assert.equal(head.ref.text, 'AXL-FR-001'); assert.equal(head.territory.text, 'FR'); assert.equal(head.type.text, 'Axal subsidiary');
  assert.equal(head.status.text, 'Active'); assert.equal(head.renewal.text, '2099-03-01');
  assert.equal(head.agreement.text, 'Executed · signed 2026-03-02'); assert.equal(head.branch.text, 'Synced · revision 143');
});

test('L04: active, executed, a branch update pending, an overdue invoice and two requests waiting, all at once and never collapsed', () => {
  const l = { ...HEALTHY, sync: PENDING };
  const facts = overviewFacts(l, { ...HEALTHY_READS, invoices: OVERDUE, requests: TWO_REQUESTS }, NOW);
  const f = byKey(facts);
  assert.equal(f.licence.word, 'Active');
  assert.equal(f.agreement.word, 'Executed');
  assert.equal(f.branch.word, 'Update pending'); assert.equal(f.branch.state, 'problem');
  assert.match(f.branch.detail, /^The branch did not answer\. · branch on 142 of 143 · last attempt 9 Nov 2026, 11:54 UTC$/);
  assert.equal(f.billing.word, 'Overdue · €90,000.00'); assert.equal(f.billing.detail, 'Due 2026-10-01 · 39 days overdue');
  assert.equal(f.requests.word, '2 waiting'); assert.equal(f.requests.detail, 'Oldest 4 days');
  assert.equal(new Set(facts.map((x) => x.state)).size > 2, true, 'not one badge');
  const a = attentionItems(l, facts);
  assert.deepEqual(a.items.map((i) => i.text), ['Branch has not received the current revision', 'Annual invoice overdue', '2 requests waiting']);
  // No pending row, but the branch has not accepted HQ's revision: out of sync, never "synced".
  const behind = branchFact({ ...HEALTHY, sync: { ...SYNCED, branch_revision: 141 } }, DEPLOYED);
  assert.equal(behind.word, 'Out of sync'); assert.equal(behind.detail, 'Revision 141 of 143'); assert.equal(behind.need, 'sync');
  // A failed provisioning outranks the sync record.
  const failed = branchFact(HEALTHY, { deployment: { phase: 'refused', last_failure: { settled_at: '2026-11-09 11:50:00' } } });
  assert.equal(failed.word, 'Deployment failed'); assert.equal(failed.need, 'deploy');
  // A renewal inside 90 days is an item too.
  const soon = { ...HEALTHY, renews_on: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) };
  assert.ok(attentionItems(soon, overviewFacts(soon, HEALTHY_READS, NOW)).items.some((i) => i.key === 'renewal'));
});

test('unknown is not zero: Not recorded, None, Unavailable with its read to try again, Not instrumented and Reading stay distinct', () => {
  // Commercial: nothing recorded is Not recorded; a recorded 0 fee is 0; no currency is never EUR.
  assert.equal(commercialFact({ annual_fee_cents: null, revenue_share_bps: null }).word, 'Not recorded');
  assert.equal(commercialFact({ annual_fee_cents: 0, currency: 'EUR', revenue_share_bps: null }).word, '€0.00 / year · revenue share not recorded');
  assert.equal(commercialFact({ annual_fee_cents: 500, currency: null, revenue_share_bps: 100 }).word, 'Not recorded currency · 1% revenue share');
  assert.equal(commercialFact({ ...HEALTHY, token_split_bps: null }).detail, 'Token split to the Licensee: Not recorded');
  // Access: no seat rows is Not recorded, not 0 seats; a running licence with nobody named needs HQ.
  assert.equal(accessFact({ ...HEALTHY, seats: {}, seats_licensed: 0 }, ADMINS).detail, 'Seats not recorded · utilisation not recorded');
  assert.equal(accessFact(HEALTHY, { items: [] }).need, 'admin');
  assert.equal(accessFact({ ...HEALTHY, status: 'draft' }, { items: [] }).state, 'none', 'a draft is issued before anyone is named');
  assert.equal(accessFact(HEALTHY, false).retry, 'admins');
  assert.equal(accessFact(HEALTHY, undefined).state, 'reading');
  // Agreement.
  assert.equal(agreementFact(undefined).state, 'reading');
  assert.deepEqual([agreementFact(false).word, agreementFact(false).retry], ['Unavailable', 'contract']);
  assert.equal(agreementFact({ contracts_available: false, contracts: [] }).state, 'unavailable', 'an unreadable store is not "none issued"');
  assert.equal(agreementFact({ contracts_available: true, contracts: [] }).word, 'None issued');
  assert.equal(agreementFact({ contracts_available: true, contracts: [{ status: 'signed', superseded_at: '2026-01-01', template_version: 3 }] }).word, 'None issued', 'a superseded agreement is not current');
  assert.equal(agreementFact({ contracts_available: true, contracts: [{ status: 'draft', template_version: 5, unfilled_fields: ['a', 'b'] }] }).detail, 'Licence agreement · template v5 · 2 fields not filled');
  // Branch.
  assert.equal(branchFact({ ...HEALTHY, deployment: null }, null).word, 'No branch deployed');
  assert.deepEqual([branchFact({ ...HEALTHY, deployment_available: false }, null).state, branchFact({ ...HEALTHY, deployment_available: false }, null).retry], ['unavailable', 'licence']);
  assert.equal(branchFact({ ...HEALTHY, sync: { ...SYNCED, available: false } }, DEPLOYED).state, 'unavailable');
  assert.equal(branchFact({ ...HEALTHY, sync: { ...SYNCED, hq_revision: null, branch_revision: null } }, DEPLOYED).word, 'Not recorded');
  // Billing.
  assert.equal(billingFact(false).retry, 'invoices');
  assert.equal(billingFact({ annual_fee_cents: null, invoices: [] }).detail, 'No annual fee is recorded, so nothing can be invoiced.');
  assert.equal(billingFact({ ...PAID, invoices: [{ ...OVERDUE.invoices[0], status: 'void' }] }, NOW).word, 'No invoices issued', 'a void invoice is not owed');
  assert.equal(billingFact({ ...PAID, invoices: [{ ...OVERDUE.invoices[0], due_at: '2026-12-01' }] }, NOW).word, 'Issued · €90,000.00 outstanding');
  // Requests.
  assert.equal(requestsFact({ available: false, reason: 'x' }).word, 'Unavailable');
  assert.equal(requestsFact(false).retry, 'requests');
  const partly = requestsFact({ ...NO_REQUESTS, branch_readable: false });
  assert.equal(partly.state, 'unavailable', 'none at HQ with the branch unread is not None');
  assert.match(partly.detail, /^None at HQ\. The branch’s own requests could not be looked up\.$/);
  // No fact ever reads a bare 0.
  const blank = { uid: 'x', status: 'draft', territories: [], seats: {}, seats_licensed: 0, deployment: null, deployment_available: true };
  for (const fct of overviewFacts(blank, { contract: false, requests: false, invoices: false, admins: false }, NOW)) {
    assert.doesNotMatch(String(fct.word), /^0\b|\b0 /, fct.key);
  }
  // A strip with nothing in it says what it could not read.
  const unread = attentionItems(HEALTHY, overviewFacts(HEALTHY, { ...HEALTHY_READS, requests: false }, NOW));
  assert.deepEqual(unread.unknown, ['Requests']);
  // The header: territory None, renewal Not recorded, type Not recorded.
  const head = Object.fromEntries(identityFacts({ ...blank, licence_ref: null, kind: null }, overviewFacts(blank, {}, NOW)).map((r) => [r.key, r]));
  assert.deepEqual([head.ref.text, head.territory.text, head.type.text, head.renewal.text, head.agreement.text],
    ['Not recorded', 'None', 'Not recorded', 'Not recorded', 'Reading…']);
  assert.equal(licenceFact({ status: 'active' }).detail, 'Start date not recorded');
});

test('Sources: the ledger read time, and the branch as its answer to the last push, never a live reading', () => {
  const s = sourcesOf(HEALTHY, '2026-11-09T14:30:00Z');
  assert.equal(s[0].text, 'Read 9 Nov 2026, 14:30 UTC');
  assert.equal(s[1].label, 'Branch at fr.axal.vc');
  assert.equal(s[1].text, 'Last accepted a copy 9 Nov 2026, 11:56 UTC · revision 143');
  assert.equal(sourcesOf({ ...HEALTHY, sync: { ...SYNCED, last_success_at: null, branch_revision: null } }, null)[1].text, 'Last accepted copy not recorded');
  assert.equal(sourcesOf({ ...HEALTHY, deployment_available: false }, null)[1].text, 'Unavailable');
});

test('the six sections hold every tab the view had, each exactly once, and the deep links open their first tab', () => {
  assert.deepEqual(LICENCE_SECTIONS_NAV.map((s) => s.key), [...LICENCE_SECTIONS]);
  assert.deepEqual(LICENCE_SECTIONS_NAV.map((s) => s.label), ['Overview', 'Terms', 'Agreement', 'Access', 'Operations', 'History']);
  // Every tab from before part 3 is still a tab, and sits under a section.
  for (const key of ['entity', 'territory', 'seats', 'terms', 'contract', 'deploy', 'schedule', 'brand', 'admins', 'notices', 'fee-invoices', 'history']) {
    const t = LICENCE_TABS.find((x) => x.key === key);
    assert.ok(t, `${key} is still a tab`);
    assert.ok(LICENCE_SECTIONS.includes(t.section), `${key} sits under a section`);
  }
  assert.equal(DEFAULT_TAB, 'overview');
  for (const s of LICENCE_SECTIONS) {
    assert.equal(tabForSection(s, null), sectionTabs(s, 'subsidiary')[0].key, `${s} opens its first tab`);
    assert.equal(sectionOfTab(tabForSection(s, null)), s);
  }
  assert.deepEqual(sectionTabs('overview', 'subsidiary').map((t) => t.key), ['overview', 'entity']);
  assert.deepEqual(sectionTabs('overview', 'white_label').map((t) => t.key), ['overview', 'entity', 'brand']);
  assert.deepEqual(sectionTabs('operations', 'subsidiary').map((t) => t.key), ['deploy', 'notices', 'fee-invoices']);
  assert.equal(deepLinkTarget('lic_fr', 'overview'), '/admin/licences?licence=lic_fr');
  assert.equal(deepLinkTarget('lic_fr', 'operations'), '/admin/licences?licence=lic_fr&tab=deploy');
});

// ── the detail view, mounted ────────────────────────────────────────────────

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

function worker({ licence = HEALTHY, contract = SIGNED, requests = NO_REQUESTS, invoices = PAID, admins = ADMINS, deployment = DEPLOYED, fail = {} } = {}) {
  const calls = [];
  const handle = (url, options = {}) => {
    const p = new URL(url, 'http://x').pathname.replace(/^\/api/, '');
    calls.push([options.method || 'GET', p]);
    const answer = (key, body) => (fail[key] ? response({ error: 'down' }, 500) : response(body));
    if (p === '/admin/licences/lic_fr') return response(licence);
    if (p === '/admin/licences/lic_fr/contract') return answer('contract', contract);
    if (p === '/admin/licences/lic_fr/requests') return answer('requests', requests);
    if (p === '/admin/licences/lic_fr/fee-invoices') return answer('invoices', invoices);
    if (p === '/admin/licences/lic_fr/admins') return answer('admins', admins);
    if (p === '/admin/licences/lic_fr/deployment') return answer('deployment', deployment);
    return response({ error: 'not_found' }, 404);
  };
  return { handle, calls };
}

async function mount(handle, startTab = DEFAULT_TAB) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, options = {}) => handle(String(u), options);
  const container = document.createElement('div'); document.body.appendChild(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const focused = [];
  document.getElementById = (id) => {
    const n = nodes().find((x) => props(x).id === id);
    return n ? { focus: () => focused.push(id) } : null;
  };
  const tabs = [];
  function Host() {
    const [tab, setTab] = useState(startTab);
    return h(Detail, { uid: 'lic_fr', held: new Map(), tab, onTab: (t) => { tabs.push(t); setTab(t); } });
  }
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(Host)));
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    tabs, focused, props, byId, nodes,
    text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)),
    stateOf: (id) => props(byId(id))['data-state'],
    async click(n) { const p = props(typeof n === 'string' ? byId(n) : n); assert.ok(p.onClick, 'nothing to click'); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async key(id, key) { await act(async () => { props(byId(id)).onKeyDown({ key, preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('L03 mounted: the identity header, six section tabs with Overview selected, seven facts and Sources; no Needs HQ strip', async () => {
  const v = await mount(worker().handle);
  try {
    const head = v.textOf('licence-identity');
    for (const s of ['Axal VC France', 'AXL-FR-001', 'FR', 'Axal subsidiary', 'Active', '2099-03-01', 'Executed · signed 2026-03-02', 'Synced · revision 143']) {
      assert.ok(head.includes(s), `header shows ${s}`);
    }
    const sections = v.nodes().filter((n) => v.props(n).role === 'tab' && String(v.props(n).id || '').startsWith('licence-section-'));
    assert.deepEqual(sections.map((n) => v.props(n)['aria-selected']), [true, false, false, false, false, false]);
    assert.deepEqual(sections.map((n) => v.props(n).tabIndex), [0, -1, -1, -1, -1, -1]);
    for (const k of ['licence', 'agreement', 'commercial', 'access', 'branch', 'billing', 'requests']) assert.ok(v.has(`licence-fact-${k}`), k);
    assert.equal(v.stateOf('licence-fact-branch-state'), 'ok');
    assert.equal(v.stateOf('licence-fact-requests-state'), 'none');
    assert.match(v.textOf('licence-sources'), /HQ ledger.*Read .* UTC.*Branch at fr\.axal\.vc.*Last accepted a copy 9 Nov 2026, 11:56 UTC · revision 143/);
    assert.equal(v.has('licence-attention'), false, 'nothing needs HQ, so no strip');
    // The status always has a word and a shape: every fact state carries an icon and text.
    for (const k of ['licence', 'agreement', 'branch', 'billing', 'requests']) {
      const n = v.byId(`licence-fact-${k}-state`);
      assert.equal(n.childNodes[0].tagName.toLowerCase(), 'svg', `${k} has a shape`);
      assert.ok(v.textOf(`licence-fact-${k}-state`).trim().length > 2, `${k} has a word`);
    }
  } finally { await v.close(); }
});

test('L04 mounted: the strip lists what needs HQ, and the facts each say their own problem', async () => {
  const v = await mount(worker({ licence: { ...HEALTHY, sync: PENDING }, invoices: OVERDUE, requests: TWO_REQUESTS }).handle);
  try {
    assert.match(v.textOf('licence-attention'), /^3 items need HQ · Branch has not received the current revision · Annual invoice overdue · 2 requests waiting$/);
    assert.match(v.textOf('licence-fact-branch'), /Update pending/);
    assert.match(v.textOf('licence-fact-billing'), /Overdue · €90,000\.00/);
    assert.match(v.textOf('licence-fact-requests'), /2 waiting/);
    assert.match(v.textOf('licence-fact-agreement'), /Executed/);
    assert.match(v.textOf('licence-identity-branch'), /Update pending/);
    assert.equal(v.stateOf('licence-fact-branch-state'), 'problem');
  } finally { await v.close(); }
});

test('a failed read is Unavailable with Try again, in the header and the Overview, and Try again re-reads only that store', async () => {
  const fail = { contract: true, invoices: true };
  const w = worker({ fail });
  const v = await mount(w.handle);
  try {
    assert.equal(v.stateOf('licence-fact-agreement-state'), 'unavailable');
    assert.match(v.textOf('licence-fact-agreement'), /Unavailable.*could not be read\. This is not a sign that there is none\..*Try again/);
    assert.match(v.textOf('licence-identity-agreement'), /Unavailable.*Try again/);
    assert.match(v.textOf('licence-fact-billing'), /Unavailable/);
    assert.match(v.textOf('licence-attention-unknown'), /Agreement, Billing could not be read/);
    const before = w.calls.filter(([, p]) => p.endsWith('/contract')).length;
    const invoicesBefore = w.calls.filter(([, p]) => p.endsWith('/fee-invoices')).length;
    fail.contract = false;
    const retry = v.nodes().find((n) => v.props(n)['aria-label'] === 'Try reading agreement again');
    await v.click(retry);
    assert.equal(w.calls.filter(([, p]) => p.endsWith('/contract')).length, before + 1);
    assert.equal(w.calls.filter(([, p]) => p.endsWith('/fee-invoices')).length, invoicesBefore, 'only the failed store is re-read');
    assert.equal(v.stateOf('licence-fact-agreement-state'), 'ok', 'and it recovers');
  } finally { await v.close(); }
});

test('the sections are keyboard tabs in the URL; every earlier tab is reachable from its section', async () => {
  const v = await mount(worker().handle);
  try {
    await v.click('licence-section-operations');
    assert.equal(v.tabs.at(-1), 'deploy', 'the section opens its first tab, in the URL');
    const sub = v.nodes().filter((n) => v.props(n).role === 'tab' && String(v.props(n).id || '').startsWith('licence-tab-'));
    assert.deepEqual(sub.map((n) => v.props(n).id), ['licence-tab-deploy', 'licence-tab-notices', 'licence-tab-fee-invoices']);
    assert.equal(v.props(v.byId('licence-subtabs'))['aria-label'], 'Operations views');
    assert.ok(v.has('licence-domain-strip'), 'the domain strip and its Detach stay reachable, on Branch and domain');
    assert.match(v.text(), /Could not read the deployment registry\./, 'the deploy step mounts there too (its registry is not faked here)');
    await v.key('licence-subtabs', 'ArrowRight');
    assert.equal(v.tabs.at(-1), 'notices');
    await v.key('licence-tabs', 'ArrowRight');
    assert.equal(v.tabs.at(-1), 'history', 'Operations → History');
    assert.deepEqual(v.focused.slice(-1), ['licence-section-history']);
    await v.key('licence-tabs', 'Home');
    assert.equal(v.tabs.at(-1), 'overview');
    // Every earlier tab: its section is selected and the tab itself is, where the section has more than one.
    for (const t of LICENCE_TABS.filter((x) => !x.whiteLabelOnly)) {
      // eslint-disable-next-line no-await-in-loop
      const u = await mount(worker().handle, t.key);
      try {
        assert.equal(u.props(u.byId(`licence-section-${t.section}`))['aria-selected'], true, `${t.key} selects ${t.section}`);
        if (sectionTabs(t.section, 'subsidiary').length > 1) {
          const own = u.nodes().find((n) => u.props(n).id === `licence-tab-${t.key}`);
          assert.equal(u.props(own)['aria-selected'], true, `${t.key} is selected`);
        }
      } finally { await u.close(); } // eslint-disable-line no-await-in-loop
    }
  } finally { await v.close(); }
});

test('no browser dialogs, and the new files keep the house rules', () => {
  const files = ['frontend/src/pages/admin/licenceOverviewModel.js', 'frontend/src/pages/admin/licences/LicenceOverview.jsx', 'frontend/src/pages/admin/licences/LicenceIdentity.jsx', 'frontend/src/pages/admin/licences/LicenceDetail.jsx'];
  for (const f of files) assert.doesNotMatch(read(f), /window\.(confirm|prompt|alert)\(/, f);
  // No synthetic health score: nothing reduces the facts to one number or one badge.
  const code = read('frontend/src/pages/admin/licenceOverviewModel.js').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /health|score/i);
});
