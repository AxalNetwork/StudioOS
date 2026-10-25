/**
 * D1117 (#2997) — the Partner invitations gaps S1's check confirmed on D923:
 *   · the invitation record takes the Worker's agreement-ready rule (D928);
 *   · PI10b: a deal type HQ has not granted is locked in New invitation, and the
 *     Worker's refusal is said in its own words; the desk has a branch door;
 *   · a voided deal says its stored reason (D924);
 *   · C1 files Lapsed as "Lapsed, not closed", as tile T1 does;
 *   · the Deals list's Due diligence column and lapsed cross-check come with
 *     each row from the Worker, so they hold past any list cap.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_partner_invitations_d1117.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PartnerInvitations from '../src/pages/admin/PartnerInvitations.jsx';
import {
  AGREEMENT_NOT_READY, LAPSED_NOT_CLOSED, VOID_REASONS, agreementReady, dealTypesAllowed, isTypeLocked, notGranted, refusalText, stageChart, voidReason,
} from '../src/pages/admin/partners/partnersDeskModel.js';
import { ddFromRow, lapsedFromRow, serverDealRow } from '../src/pages/admin/partners/dealsReferralsModel.js';
import { COMMUNITY_CONSOLES } from '../src/pages/branch/BranchCommunity.jsx';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;
const DAY = 86_400_000;
const LIVE = Date.now();
const d1 = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const isoAt = (ms) => new Date(ms).toISOString();
const ready = (data) => ({ status: 'ready', data, error: null });
const failed = (error = { status: 503 }) => ({ status: 'error', data: null, error });
const loading = () => ({ status: 'loading', data: null, error: null });

const inv = (id, o = {}) => {
  const { createdMs = LIVE - 4 * DAY, ...rest } = o;
  return {
    id, token: `tok${id}`, recipient_email: `p${id}@example.com`, recipient_name: `Partner ${id}`, allowed_deal_types: ['services_partnership'],
    status: 'sent', expires_at: isoAt(createdMs + 14 * DAY + 400), created_at: d1(createdMs), viewed_at: null, signed_at: null,
    resulting_user_id: null, resulting_deal_id: null, envelope_id: null, revoked_at: null, invited_by_name: 'Admin A', invited_by_user_id: 41,
    last_sent_at: isoAt(createdMs), send_count: 1, last_send_ok: 1, last_send_reason: null, personal_message: null,
    link: `https://axal.vc/partners/onboard?token=tok${id}`, is_expired: false, ...rest,
  };
};
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const detailFor = (row, o = {}) => {
  const { token: _t, link: _l, ...invitation } = row;
  return {
    invitation: { ...invitation, is_lapsed: Boolean(row.is_expired) },
    steps: { available: true, sent: row.created_at, opened: null, profile_done: null, offers_shown: null, offer_chosen_first: null, offer_chosen_latest: null, agreement_out: null, signed: null },
    offers_seen: { available: true, shown: false, offers: null },
    chosen_deal: { available: true, deal: null, envelope: null },
    agreement_refusals: { available: true, items: [] },
    history: { available: true, items: [], signing_link_renewals: [] },
    ...o,
  };
};

/** The Worker as D926–D928 and D986 answer. `agreement`, `dealTypes` and `create` are what D1117 reads. */
function worker({ rows = [], details = {}, agreement = { ready: true, reason: null, fields: [] }, dealTypes = () => response({ error: 'no_licence' }, 404), create, deals = [] } = {}) {
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    if (method === 'POST' && path === '/api/admin/partners/invitations') return create ? create(JSON.parse(options.body || '{}')) : response({ id: 99 }, 201);
    if (method === 'POST') return response({ ok: true });
    if (path === '/api/admin/partners/invitations') return response({ items: rows, total: rows.length });
    if (path === '/api/admin/partners/invitations/lookup') return response({ open_invitation: null, member: null });
    if (path === '/api/admin/partners/offers/preview') return response({ offers: [] });
    if (path === '/api/licence/mine/partner-deal-types') return dealTypes();
    if (path === '/api/admin/partners/agreement-ready') return typeof agreement === 'function' ? agreement() : response(agreement);
    const one = /^\/api\/admin\/partners\/invitations\/(\d+)$/.exec(path);
    if (one) {
      if (details[one[1]]) return response(details[one[1]]);
      const row = rows.find((i) => String(i.id) === one[1]);
      return row ? response(detailFor(row)) : response({ error: 'Invitation not found' }, 404);
    }
    const oneDeal = /^\/api\/admin\/partners\/deals\/(\d+)$/.exec(path);
    if (oneDeal) {
      const d = deals.find((x) => String(x.id) === oneDeal[1]);
      return d ? response({ deal: d, invitation: null, envelope: null, due_diligence: { match: 'not_activated' }, obligations: { available: true, items: [] }, history: { available: true, items: [] } }) : response({ error: 'not_found' }, 404);
    }
    if (path === '/api/admin/partners/deals') return response({ items: deals, total: deals.length, limit: 25, offset: 0 });
    if (path === '/api/admin/contracts/partner-deals') return response({ items: [], total: 0, limit: 500, offset: 0 });
    if (path === '/api/admin/partners/links') return response({ accounts: [], firms: [] });
    if (path === '/api/admin/partners/deals/top') return response({ items: [] });
    return response({});
  };
}

async function mounted(url, handle) {
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, h(PartnerInvitations))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests,
    text: () => text(container),
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * 1. The record takes the Worker's agreement-ready rule
 * ------------------------------------------------------------------ */

test('the record says the agreement is not ready from the Worker\'s answer, and nothing when the Worker cannot say', async () => {
  const row = inv(7, { status: 'selected' });
  const chosen = { chosen_deal: { available: true, deal: { id: 31, deal_type: 'services_partnership', status: 'proposed', proposal: { label: 'Services Partnership' } }, envelope: null } };
  const notReady = await mounted('/admin/partner-invitations/invitations/7', worker({ rows: [row], details: { 7: detailFor(row, chosen) }, agreement: { ready: false, reason: 'unfilled_fields', fields: [{ key: 'scope', label: 'Scope' }] } }));
  try {
    assert.ok(notReady.requests.some((r) => r.url === '/api/admin/partners/agreement-ready'), 'the desk asks the Worker');
    assert.ok(!notReady.requests.some((r) => r.url.startsWith('/api/legal/esign/templates/')), 'and no longer reads the template to work it out');
    assert.match(notReady.textOf('partners-invitation-not-ready'), new RegExp(`^${AGREEMENT_NOT_READY.replace(/[.]/g, '\\.')}`));
  } finally { await notReady.close(); }
  const isReady = await mounted('/admin/partner-invitations/invitations/7', worker({ rows: [row], details: { 7: detailFor(row, chosen) } }));
  try { assert.ok(!isReady.has('partners-invitation-not-ready')); } finally { await isReady.close(); }
  const unknown = await mounted('/admin/partner-invitations/invitations/7', worker({ rows: [row], details: { 7: detailFor(row, chosen) }, agreement: () => response({ ready: null, reason: 'unreadable' }, 503) }));
  try { assert.ok(!unknown.has('partners-invitation-not-ready'), 'a template that could not be read is no verdict'); } finally { await unknown.close(); }
});

test('the rule maps the Worker\'s three answers', () => {
  assert.deepEqual(agreementReady(ready({ ready: true })), { state: 'ready' });
  assert.equal(agreementReady(ready({ ready: false, reason: 'no_body', fields: [] })).state, 'not_ready');
  assert.equal(agreementReady(ready({ ready: null })).state, 'unknown');
  assert.equal(agreementReady(ready({ ready: 'yes' })).state, 'unknown', 'only the Worker\'s ready: true is ready');
  assert.equal(agreementReady(failed()).state, 'unknown');
  assert.equal(agreementReady(loading()).state, 'loading');
});

/* ------------------------------------------------------------------ *
 * 2. PI10b
 * ------------------------------------------------------------------ */

test('PI10b: the licence\'s deal types, read from the studio\'s own read; HQ-held and unset stay open', () => {
  assert.deepEqual(dealTypesAllowed(ready({ recorded: true, types: ['equity_partnership', 'custom'] })), { state: 'set', allowed: ['equity_partnership', 'custom'] });
  assert.deepEqual(dealTypesAllowed(ready({ recorded: false, types: null })), { state: 'open', why: 'not_recorded' });
  assert.deepEqual(dealTypesAllowed(ready({ recorded: false, types: [] })), { state: 'open', why: 'not_recorded' }, 'a list HQ has not set locks nothing, even when one comes back');
  assert.deepEqual(dealTypesAllowed(failed({ status: 404, code: 'no_licence' })), { state: 'open', why: 'hq_held' });
  assert.deepEqual(dealTypesAllowed(failed({ status: 503 })), { state: 'unreadable' });
  assert.equal(dealTypesAllowed(loading()).state, 'loading');
  const set = { state: 'set', allowed: ['custom'] };
  assert.equal(isTypeLocked(set, 'capital_partnership'), true);
  assert.equal(isTypeLocked(set, 'custom'), false);
  assert.equal(isTypeLocked({ state: 'open' }, 'capital_partnership'), false, 'an open licence locks nothing');
  assert.equal(isTypeLocked({ state: 'unreadable' }, 'capital_partnership'), false, 'a failed read locks nothing; the write still checks');
  assert.equal(notGranted('Capital partnership'), 'HQ has not granted Capital partnership to this studio.');
  const sentence = 'This studio\'s licence does not allow Capital partnership. HQ sets which partner deal types a studio may offer.';
  assert.equal(refusalText(Object.assign(new Error(sentence), { status: 422, code: 'deal_type_not_allowed' }), 'create'), sentence, 'the Worker\'s own words');
});

test('PI10b mounted: a type HQ has not granted is a locked card, and a refusal is said in the Worker\'s words', async () => {
  const sentence = 'This studio\'s licence does not allow Custom deal. HQ sets which partner deal types a studio may offer.';
  const view = await mounted('/admin/partner-invitations/invitations', worker({
    dealTypes: () => response({ source: 'branch_copy', recorded: true, types: ['equity_partnership', 'services_partnership', 'custom'] }),
    create: () => response({ error: 'deal_type_not_allowed', message: sentence, not_allowed: ['custom'], allowed: ['equity_partnership'] }, 422),
  }));
  try {
    await view.click('partners-new-button');
    assert.equal(view.props('partners-new-type-capital_partnership')['data-locked'], 'true');
    assert.equal(view.textOf('partners-new-type-capital_partnership-locked'), 'HQ has not granted Capital partnership to this studio.');
    assert.ok(!view.has('partners-new-type-capital_partnership-box'), 'a locked type cannot be ticked');
    assert.ok(view.has('partners-new-type-custom-box'), 'a granted type can');
    await view.change('partners-new-email', { value: 'new@example.com' });
    await view.change('partners-new-type-custom-box', { checked: true });
    await view.click('partners-new-send');
    assert.match(view.text(), new RegExp(sentence.replace(/[.]/g, '\\.')));
  } finally { await view.close(); }
  const held = await mounted('/admin/partner-invitations/invitations', worker({}));
  try {
    await held.click('partners-new-button');
    assert.ok(!held.props('partners-new-type-capital_partnership')['data-locked'], 'HQ-held: every type open');
    assert.ok(!held.has('partners-new-types-unreadable'));
  } finally { await held.close(); }
});

test('PI10b: the desk has a branch door on Community, and the branch shell lights it', () => {
  const door = COMMUNITY_CONSOLES.find((c) => c.key === 'partner-invitations');
  assert.ok(door, 'the branch Community index lists Partner invitations');
  assert.equal(door.to, '/admin/partner-invitations');
  assert.equal(door.worker, 'admin_partners.ts');
  const row = SIDEBAR_GROUPS.branch_admin[0].items.find((i) => i.label === 'Community');
  assert.ok(row.match.includes('/admin/partner-invitations'), 'the branch Community row lights on the desk');
  assert.ok(row.match.includes('/branch/community'));
});

/* ------------------------------------------------------------------ *
 * 3. A voided deal's reason
 * ------------------------------------------------------------------ */

test('a voided deal says its stored reason, and a deal voided before D924 says it was not recorded', () => {
  assert.equal(voidReason({ status: 'voided', void_reason: 'link_lapsed' }), VOID_REASONS.link_lapsed);
  assert.equal(voidReason({ status: 'voided', void_reason: 'invitation_revoked' }), VOID_REASONS.invitation_revoked);
  assert.equal(voidReason({ status: 'voided', void_reason: 'admin_revoked' }), VOID_REASONS.admin_revoked);
  assert.equal(voidReason({ status: 'voided', void_reason: null }), 'Voided. The reason was not recorded.');
  assert.equal(voidReason({ status: 'active', void_reason: 'link_lapsed' }), null, 'only a voided deal');
  assert.deepEqual(Object.keys(VOID_REASONS).sort(), ['admin_revoked', 'invitation_revoked', 'link_lapsed'], 'the reasons D924 writes');
});

test('mounted: the deal record and the invitation record each say why a deal was voided', async () => {
  const voided = { id: 31, deal_type: 'services_partnership', status: 'voided', void_reason: 'link_lapsed', user_id: null, created_at: d1(LIVE - 3 * DAY), proposal: null, proposal_unreadable: false };
  const dealView = await mounted('/admin/partner-invitations/deals/31', worker({ deals: [voided] }));
  try { assert.equal(dealView.textOf('partners-deal-void-reason'), VOID_REASONS.link_lapsed); } finally { await dealView.close(); }
  const row = inv(7, { status: 'expired' });
  const invView = await mounted('/admin/partner-invitations/invitations/7', worker({ rows: [row], details: { 7: detailFor(row, { chosen_deal: { available: true, deal: voided, envelope: null } }) } }));
  try { assert.equal(invView.textOf('partners-invitation-void-reason'), VOID_REASONS.link_lapsed); } finally { await invView.close(); }
});

/* ------------------------------------------------------------------ *
 * 4. Lapsed is not closed, in C1 as in T1
 * ------------------------------------------------------------------ */

test('C1 files Lapsed as "Lapsed, not closed", apart from Signed and Revoked, as tile T1 does', () => {
  const b = stageChart(ready({ c1: { available: true, stages: {}, closed: { signed: 4, lapsed: 1, revoked: 2, signed_after_lapse: 0 } } }));
  assert.equal(b.state, 'ready');
  assert.deepEqual(b.closed.map((c) => c.key), ['signed', 'revoked'], 'a lapsed invitation is not on the closed line');
  assert.deepEqual([b.lapsed.key, b.lapsed.word, b.lapsed.n], ['lapsed', LAPSED_NOT_CLOSED, 1]);
  assert.equal(LAPSED_NOT_CLOSED, 'Lapsed, not closed');
  assert.match(read('frontend/src/pages/admin/partners/partnersDeskModel.js'), /tile\('lapsed', LAPSED_NOT_CLOSED, 'lapsed'/, 'T1 reads the same words');
});

/* ------------------------------------------------------------------ *
 * 5. The Deals list's joins come with each row
 * ------------------------------------------------------------------ */

test('the Due diligence column and the lapsed cross-check are the row\'s own, never a capped list\'s', () => {
  assert.deepEqual(ddFromRow({ due_diligence: { state: 'case', uid: 'dd_1', status: 'open' } }), { text: 'Open', uid: 'dd_1', open: true });
  assert.deepEqual(ddFromRow({ due_diligence: { state: 'case', uid: 'dd_2', status: 'in_review' } }), { text: 'Open', uid: 'dd_2', open: true });
  assert.deepEqual(ddFromRow({ due_diligence: { state: 'case', uid: 'dd_3', status: 'archived' } }), { text: 'Archived', uid: 'dd_3' });
  assert.deepEqual(ddFromRow({ due_diligence: { state: 'case', uid: 'dd_4', status: 'completed' } }), { text: 'Completed', uid: 'dd_4' });
  assert.deepEqual(ddFromRow({ due_diligence: { state: 'none' } }), { text: 'No case on record' });
  assert.deepEqual(ddFromRow({ due_diligence: { state: 'not_opened' } }), { text: 'Not opened before signing' });
  assert.equal(ddFromRow({}).failed, true, 'a row with no block is not read, never "No case on record"');
  assert.equal(lapsedFromRow({ status: 'proposed', invitation_lapsed: true }), 'Lapsed before signing · Resend to continue');
  assert.equal(lapsedFromRow({ status: 'awaiting_signature', invitation_lapsed: true }), 'Lapsed before signing · Resend to continue');
  assert.equal(lapsedFromRow({ status: 'active', invitation_lapsed: true }), null, 'a signed deal is not lapsed');
  assert.equal(lapsedFromRow({ status: 'proposed', invitation_lapsed: null }), null, 'not known is not lapsed');
  // Past the 200 cases the browser held: the row still names its case, with no list passed in.
  const row = serverDealRow({ id: 5, status: 'active', user_id: 10, due_diligence: { state: 'case', uid: 'dd_251', status: 'open' }, invitation_lapsed: false }, {});
  assert.equal(row.dd.uid, 'dd_251');
  assert.doesNotMatch(read('frontend/src/pages/admin/partners/usePartnerDesk.js'), /dd\.listCases\(/, 'R9 is no longer read for the list');
});

test('docs: D1117 is written and names each gap', () => {
  const doc = read('documentation/architecture/decisions/D1117.md');
  for (const word of ['agreement-ready', 'PI10b', 'void_reason', 'Lapsed, not closed', 'due_diligence', 'invitation_lapsed', 'UNVERIFIED']) assert.match(doc, new RegExp(word), word);
});
