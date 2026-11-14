/**
 * D995 (#2806) — Partner profiles part 6: one profile as PRF3's lightbox at
 * its own address, PRF4's other sources, PRF5's dialogs (A–D, F, and E the
 * tax ID for 60 seconds) and PRF6's send results, replacing the console's
 * modal. Mounted on a stubbed Worker (React props read through
 * `__reactProps$`), with a failed block in each.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_profile_record_d995.test.mjs
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  INVITATION_FIELDS, NOT_GIVEN, PLAN_LINE, answers, dialogWords, historyLine, neighbours, recordPath, recordShape, refOfPath, sendResult,
  summaryOf, taxLine, trackDetails, turnsLine, whoFacts,
} from '../src/pages/admin/profiles/profileModel.js';
import PartnerProfiles from '../src/pages/admin/profiles/PartnerProfiles.jsx';
import ProfileRecord from '../src/pages/admin/profiles/ProfileRecord.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ---------------------------------------------------------------- fixtures, as D990, D991 and D993 answer

const turns = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `Turn ${i + 1}`, ts: 1000 + i }));
const LISTED = (o) => ({ status: 'pending', sources: ['chat'], account: null, identity_check: null, reviewed_at: null, reviewed_by: null, ...o });
const ADA = {
  ref: 'pp_000000000a', email: 'ada@example.com', user_id: 7, full_name: 'Ada Example', persona: 'Founder',
  founder_track: 'Strategic Scale (Existing)', legal_entity_name: 'Example Robotics Inc', entity_type: 'Delaware C-Corp',
  existing_jurisdiction: 'Delaware, United States', company_established: 1, signatory_name: 'Ada Example', signatory_title: 'CEO',
  current_stage: 'Seed, trading for two years', partnership_goal: 'Add a go-to-market partner', product_strategy: '', existing_investors: 'Two angels',
  organization: 'Placeholder Labs Ltd', role_title: 'Managing director', services_offered: 'Technical due diligence', dealflow_channels: '["Spin-out offices","Angel groups"]',
  extracted_data: JSON.stringify({ summary: 'Ada runs a robotics company and wants a go-to-market partner.' }),
  chat_history: JSON.stringify(turns(10)), masked: { ein: '••-•••4821' }, admin_notes: null, agreement_type: null,
  listed: LISTED({ user_name: 'Ada Example', sources: ['chat', 'eadwyn'], account: { user_id: 7, role: 'exploring', exploring: true }, identity_check: { state: 'pending', label: 'Pending' } }),
  unbind: { eligible: false, reason: 'address_still_theirs', holder: null },
};
const BEN = {
  ref: 'pp_000000000b', email: 'ben@example.com', user_id: null, invitation_id: 3, full_name: 'Ben Sample', organization: 'Sample Capital LP',
  role_title: 'Partner', sectors: '["Fintech","Climate"]', capital_capacity_usd: 250000, masked: { ein: null }, chat_history: null,
  listed: LISTED({ full_name: 'Ben Sample', sources: ['invitation'] }), unbind: { eligible: false, reason: 'not_bound', holder: null },
};
const VAL = {
  ref: 'pp_000000000c', email: 'val@example.com', user_id: 8, full_name: 'Val Verified', persona: 'Advisor', chat_history: '[]', masked: { ein: null },
  listed: LISTED({ user_name: 'Val Verified', status: 'verified', reviewed_at: '2026-10-03 12:00:00', reviewed_by: { user_id: 900, name: 'Ada Admin' }, account: { user_id: 8, role: 'advisor' } }),
  unbind: { eligible: true, reason: null, holder: { user_id: 11, name: 'Nell New' } },
};
const DRAFT = { ref: 'pp_000000000d', email: 'draft@example.com', full_name: 'Dee Draft', masked: { ein: null }, listed: LISTED({ status: 'draft', sources: [] }), unbind: { eligible: false } };
const PROFILES = { [ADA.ref]: ADA, [BEN.ref]: BEN, [VAL.ref]: VAL, [DRAFT.ref]: DRAFT };
const ROW = (p) => ({ ref: p.ref, email: p.email, user_name: p.listed.user_name || null, full_name: p.full_name, status: p.listed.status, sources: p.listed.sources, account: p.listed.account, created_at: '2026-10-20 08:00:00', persona: p.persona || null });
const HISTORY = { items: [
  { kind: 'captured', source: 'chat', reason: null, created_at: '2026-10-22 09:12:00', by: null },
  { kind: 'rejected', source: null, reason: 'Entity did not match', created_at: '2026-10-23 10:00:00', by: { user_id: 900, name: 'Ada Admin' } },
], total: 2 };
const AGREEMENTS = { groups: [
  { label: 'Investors', options: [{ value: 'Subscription Booklet & LPA', label: 'Subscription Booklet & LPA', ready: true }, { value: 'Side letter', label: 'Side letter', ready: false, readiness: 'Not ready: no text in the library yet' }] },
] };

// ---------------------------------------------------------------- the model

test('the record\'s address is its reference; a list position gives "3 of 7" with Previous and Next', () => {
  assert.equal(recordPath('pp_000000000a'), '/admin/partner-profiles/pp_000000000a');
  assert.equal(refOfPath('/admin/partner-profiles/pp_000000000a'), 'pp_000000000a');
  assert.equal(refOfPath('/admin/partner-profiles/all'), null, 'All profiles is not a record');
  assert.equal(refOfPath('/admin/partner-profiles/ada@example.com'), null, 'an email is never an address');
  const rows = [{ ref: 'pp_000000000a' }, { ref: 'pp_000000000b' }, { ref: 'pp_000000000c' }];
  assert.deepEqual(neighbours(rows, 'pp_000000000b'), { label: '2 of 3', prev: 'pp_000000000a', next: 'pp_000000000c' });
  assert.deepEqual(neighbours(rows, 'pp_000000000a'), { label: '1 of 3', prev: null, next: 'pp_000000000b' });
  assert.deepEqual(neighbours(rows, 'pp_000000000c'), { label: '3 of 3', prev: 'pp_000000000b', next: null }, 'the last record has no Next; it never wraps round');
  assert.deepEqual(neighbours(rows, 'pp_00000000ff'), { label: null, prev: null, next: null }, 'a record the list does not hold has no place');
});

test('PRF3 and PRF4\'s blocks: who they are, a Strategic Scale founder\'s details, the summary, and each source\'s answers', () => {
  const who = whoFacts(ADA);
  assert.deepEqual(who.map((f) => f.k), ['Onboarding category', 'Founder track', 'Legal entity', 'Entity type', 'Jurisdiction', 'Incorporated', 'Signatory']);
  assert.deepEqual(who.map((f) => f.v), ['Founder', 'Strategic Scale', 'Example Robotics Inc', 'Delaware C-Corp', 'Delaware, United States', 'Yes', 'Ada Example']);
  assert.equal(who[6].sub, 'CEO');
  assert.equal(whoFacts({ company_established: null }).find((f) => f.k === 'Incorporated').v, NOT_GIVEN, 'unanswered is Not given, never No');
  assert.deepEqual(trackDetails(ADA).map((f) => f.v), ['Seed, trading for two years', 'Add a go-to-market partner', NOT_GIVEN, 'Two angels']);
  assert.equal(trackDetails({ founder_track: 'Spin-Out (New)' }), null, 'only a Strategic Scale founder');
  assert.equal(summaryOf(ADA), 'Ada runs a robotics company and wants a go-to-market partner.');
  assert.equal(summaryOf({ extracted_data: 'not json' }), null);
  const inv = answers(BEN, INVITATION_FIELDS);
  assert.equal(inv.find((f) => f.k === 'Capital capacity').v, '$250,000');
  assert.equal(inv.find((f) => f.k === 'Sectors').v, 'Fintech, Climate');
  assert.equal(inv.find((f) => f.k === 'Expertise').v, NOT_GIVEN);
  assert.deepEqual(recordShape(ADA), { draft: false, who: true, chat: true, invitation: false, eadwyn: true, sources: ['chat', 'eadwyn'], status: 'pending' });
  assert.equal(recordShape(BEN).who, false, 'an invitation\'s profile shows its answers, not the chat\'s');
  assert.equal(recordShape(BEN).invitation, true);
  assert.equal(recordShape(DRAFT).draft, true);
  assert.equal(turnsLine(14, true), '● Live · the last 8 of 14 turns');
  assert.equal(turnsLine(3, false), '3 turns');
});

test('History, PRF5\'s dialogs and PRF6\'s results in the canvas\'s words', () => {
  assert.deepEqual(historyLine(HISTORY.items[0]), { glyph: '+', text: 'Captured from the onboarding chat', when: '22 Oct 2026, 09:12' });
  assert.equal(historyLine(HISTORY.items[1]).text, 'Rejected by Ada Admin: “Entity did not match”');
  assert.equal(historyLine({ kind: 'reopened', by: null, created_at: '2026-10-24 08:00:00' }).text, 'Put back in the queue');
  assert.equal(dialogWords('verify', { name: 'Chloé', email: 'c@example.com', agreement: 'Subscription Booklet & LPA' }).title, 'Verify Chloé’s profile and send the Subscription Booklet & LPA for signature?');
  assert.ok(dialogWords('verify', { name: 'Chloé', email: 'c@example.com', agreement: 'Subscription Booklet & LPA' }).lines.includes('The agreement goes from StudioOS signing to c@example.com.'));
  assert.deepEqual([dialogWords('verify', { name: 'Ada' }).title, dialogWords('verify', { name: 'Ada' }).sub], ['Verify Ada’s profile?', 'No agreement is sent.']);
  assert.equal(dialogWords('reject', { name: 'Eva' }).sub, 'They are told, and they read your reason.');
  assert.match(dialogWords('unbind', { holder: { name: 'Nell New' } }).sub, /now belongs to Nell New’s account/);
  assert.deepEqual(sendResult({ esign: { envelope_id: 4, email_sent: true }, member_notified: {} }, { status: 'verified', email: 'c@example.com' }),
    { tone: 'green', text: 'Verified. The agreement is out for signature, sent to c@example.com.' });
  const nd = sendResult({ esign: { envelope_id: 4, email_sent: false, signing_url: 'https://axal.vc/sign/k3f9' }, member_notified: {} }, { status: 'verified' });
  assert.equal(nd.tone, 'amber');
  assert.equal(nd.link, 'https://axal.vc/sign/k3f9');
  assert.match(sendResult({ esign_refusal: { message: 'It has no text in the library yet' }, member_notified: {} }, { status: 'verified' }).text, /^Verified\. The agreement was not sent: It has no text in the library yet\. Finish it in Contracts\.$/);
  assert.match(sendResult({ esign: null, member_notified: null }, { status: 'verified' }).text, /The notice to them could not be sent: tell them yourself\./, 'a failed notice is said, never hidden');
  assert.equal(taxLine(null), 'Masked. Showing it is recorded under your name.');
  assert.equal(taxLine({ shown_at: '2026-10-25T14:02:00Z' }, 48), 'Shown to you at 14:02. This is recorded. It hides again in 0:48.');
});

// ---------------------------------------------------------------- mounted

function stub(o = {}) {
  const original = globalThis.fetch;
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = init.method || 'GET';
    seen.push({ path: u.pathname, method, body: init.body || null });
    const p = u.pathname;
    if (p === '/api/admin/partner-profiles') return json({ rows: [ROW(ADA), ROW(BEN)], totals: { total: 2, draft: 0, pending: 2, verified: 0, rejected: 0, not_recorded: 0 }, page: 1, page_size: 25, options: {} });
    if (p === '/api/admin/partner-profiles/counts') return json({ as_of: '2026-10-25T12:00:00Z', waiting: { available: true, count: 2, over_24h: 2, over_72h: 2, oldest_at: '2026-10-20 08:00:00', drafts: 0 }, verified_30d: { available: false }, envelopes_out: { available: true, count: 0, not_delivered: 0 }, weekly: { available: false } });
    if (p === '/api/admin/partner-profiles/agreements') return o.agreements ? o.agreements() : json(AGREEMENTS);
    let m = p.match(/^\/api\/admin\/partner-profiles\/(pp_\w+)$/);
    if (m) return o.profile ? o.profile(m[1]) : json(PROFILES[m[1]]);
    m = p.match(/^\/api\/admin\/partner-profiles\/(pp_\w+)\/history$/);
    if (m) return o.history ? o.history() : json(HISTORY);
    m = p.match(/^\/api\/admin\/partner-profiles\/(pp_\w+)\/unbind$/);
    if (m) return o.unbind ? o.unbind() : json({ ok: true });
    if (p.endsWith('/verify')) return o.verify ? o.verify(JSON.parse(init.body)) : json({ updated: true, esign: null, member_notified: {} });
    if (p.endsWith('/sensitive/ein')) return json({ field: 'ein', value: '12-3454821', shown_at: '2026-10-25T14:02:00Z', shown_by: 'Ada Admin' });
    if (p === '/api/integrations') return json([]);
    return json({});
  };
  return { seen, posts: () => seen.filter((q) => q.method === 'POST'), restore() { globalThis.fetch = original; } };
}

function Where({ onPath }) { const loc = useLocation(); onPath(loc.pathname); return null; }

async function mountTree(tree) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(tree); });
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, handler, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n)[handler](arg); }); await settle(); };
  return {
    settle,
    text: () => textOf(container),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    all: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).map(textOf),
    props: (id) => props(byId(id)),
    press: (id) => fire(id, 'onClick', { preventDefault() {}, stopPropagation() {} }),
    type: (id, value) => fire(id, 'onChange', { target: { value } }),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

async function page(url, state = null) {
  let path = null;
  const v = await mountTree(h(MemoryRouter, { initialEntries: [state ? { pathname: url, state } : url] },
    h(Where, { onPath: (p) => { path = p; } }),
    h(Routes, null,
      h(Route, { path: '/admin/partner-profiles', element: h(PartnerProfiles) }),
      h(Route, { path: '/admin/partner-profiles/all', element: h(PartnerProfiles) }),
      h(Route, { path: '/admin/partner-profiles/:ref', element: h(PartnerProfiles) }))));
  v.path = () => path;
  return v;
}

async function record(refId, props = {}) {
  return mountTree(h(MemoryRouter, null, h(ProfileRecord, { refId, rows: [], onGo() {}, onClose() {}, ...props })));
}

test('mounted: Review opens the record at its own address over the queue; its place, Previous and Next walk the list', async () => {
  const s = stub();
  const v = await page('/admin/partner-profiles');
  try {
    assert.equal(v.all('pp-queue-row').length, 2);
    assert.match(v.all('pp-queue-row')[0], /Ada Example/);
  } finally { await v.unmount(); s.restore(); }
  const t = stub();
  const w = await page('/admin/partner-profiles/pp_000000000a', { from: 'review' });
  try {
    assert.ok(w.has('pp-queue'), 'the list stays under the record');
    assert.match(w.of('pp-record-head'), /Ada Example.*1 of 2 · Esc to close.*ada@example\.com · pp_000000000a/s);
    assert.match(w.of('pp-record-tags'), /Waiting.*Onboarding chat.*Eadwyn questions/s);
    assert.equal(w.props('pp-record-prev').disabled, true);
    assert.ok(t.seen.some((q) => q.path === '/api/admin/partner-profiles/pp_000000000a'), 'the record is read by its reference');
    assert.ok(!t.seen.some((q) => q.path.startsWith('/api/profiling/admin/') && !q.path.endsWith('/sensitive/ein')), 'never by email');
    await w.press('pp-record-next');
    assert.equal(w.path(), '/admin/partner-profiles/pp_000000000b');
    assert.match(w.of('pp-record-head'), /Ben Sample.*2 of 2/s);
  } finally { await w.unmount(); t.restore(); }
});

test('mounted PRF3: who they are, the track details, the summary, the conversation\'s last 8 turns, History and the Decision card', async () => {
  const s = stub();
  const v = await record('pp_000000000a', { rows: [ROW(ADA), ROW(BEN)] });
  try {
    assert.match(v.of('pp-who'), /Onboarding category.*Founder.*Founder track.*Strategic Scale.*Incorporated.*Yes.*Signatory.*Ada Example.*CEO/s);
    assert.match(v.of('pp-track'), /Current stage.*Seed, trading for two years.*Product strategy.*Not given/s);
    assert.match(v.of('pp-summary'), /Eadwyn’s summary.*Ada runs a robotics company/s);
    assert.match(v.of('pp-conversation'), /10 turns|the last 8 of 10 turns/);
    assert.ok(!/Turn 2(?!\d)/.test(v.of('pp-conversation')), 'only the last eight show first');
    assert.match(v.of('pp-conversation'), /Turn 3(?!\d).*Turn 10/s);
    await v.press('pp-conversation-all');
    assert.match(v.of('pp-conversation'), /Turn 1(?!\d).*Turn 2(?!\d)/s);
    assert.match(v.of('pp-eadwyn'), /These answers came in after the onboarding chat\..*Firm.*Placeholder Labs Ltd.*Dealflow channels.*Spin-out offices, Angel groups/s);
    assert.deepEqual(v.all('pp-history-item'), ['+Captured from the onboarding chat22 Oct 2026, 09:12', '✕Rejected by Ada Admin: “Entity did not match”23 Oct 2026, 10:00']);
    assert.match(v.of('pp-decision-account'), /Explorer.*Profile is given on the Exploring board, after the binding agreement is signed\..*Open the Exploring board/s);
    assert.match(v.of('pp-decision-identity'), /Pending.*KYC & KYB decides it\. This page never does\./s);
    assert.equal(v.props('pp-decision-exploring').href, '/admin/exploring');
    assert.match(v.of('pp-decision-send'), /StudioOS signing.*DocuSign is not offered here.*connect DocuSign/s);
    assert.equal(v.props('pp-provider-docusign').disabled, true, 'no DocuSign account is connected');
    assert.ok(v.has('pp-decision-verify') && v.has('pp-decision-reject'));
    assert.ok(!v.has('pp-decision-unbind') && !v.has('pp-decision-unbind-admin'), 'nothing to unbind here');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted PRF5e: the tax ID shows on a logged Show, then masks again after 60 seconds', async () => {
  const s = stub();
  const v = await record('pp_000000000a');
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    assert.equal(v.of('pp-tax-value'), '••-•••4821');
    assert.equal(v.of('pp-tax-line'), 'Masked. Showing it is recorded under your name.');
    await v.press('pp-tax-toggle');
    assert.ok(s.seen.some((q) => q.path === '/api/profiling/admin/ada%40example.com/sensitive/ein' || q.path === '/api/profiling/admin/ada@example.com/sensitive/ein'), 'Show is the logged read');
    assert.equal(v.of('pp-tax-value'), '12-3454821');
    assert.match(v.of('pp-tax-line'), /It hides again in 1:00\.$/);
    await act(async () => { mock.timers.tick(12_000); });
    assert.match(v.of('pp-tax-line'), /It hides again in 0:48\.$/);
    await act(async () => { mock.timers.tick(48_000); });
    assert.equal(v.of('pp-tax-value'), '••-•••4821', 'masked again after 60 seconds');
  } finally { mock.timers.reset(); await v.unmount(); s.restore(); }
});

test('mounted PRF5a and PRF6: Verify asks first, says who is told, sends the chosen agreement; a sent result opens the next waiting profile', async () => {
  const s = stub({ verify: (body) => new Response(JSON.stringify({ updated: true, esign: { envelope_id: 9, email_sent: true }, member_notified: {}, echo: body }), { status: 200 }) });
  const v = await page('/admin/partner-profiles/pp_000000000a', { from: 'review' });
  try {
    const opts = v.props('pp-agreement').children[1][0].props.children;
    assert.deepEqual(opts.map((o) => [o.props.value, o.props.disabled]), [['Subscription Booklet & LPA', false], ['Side letter', true]], 'a not-ready agreement cannot be picked');
    await v.type('pp-agreement', 'Subscription Booklet & LPA');
    await v.type('pp-notes', 'LP call on 21 Oct.');
    await v.press('pp-decision-verify');
    assert.match(v.of('pp-verify-dialog'), /Verify Ada Example’s profile and send the Subscription Booklet & LPA for signature\?.*They are told by email and in their activity\..*The agreement goes from StudioOS signing to ada@example\.com\..*recorded in the profile’s history under your name/s);
    assert.equal(s.posts().length, 0, 'nothing is written before the dialog\'s button');
    await v.press('pp-verify-dialog-go');
    const body = JSON.parse(s.posts()[0].body);
    assert.equal(s.posts()[0].path, '/api/profiling/admin/ada%40example.com/verify');
    assert.deepEqual(body, { status: 'verified', agreement_type: 'Subscription Booklet & LPA', admin_notes: 'LP call on 21 Oct.', provider: 'native' });
    assert.equal(v.path(), '/admin/partner-profiles/pp_000000000b', 'the next waiting profile opens');
    assert.match(v.of('pp-note'), /Verified\. The agreement is out for signature, sent to ada@example\.com\./);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted PRF6: not delivered stays with the link to copy; an agreement not ready says so; the plan check changes nothing', async () => {
  let answer = () => new Response(JSON.stringify({ updated: true, esign: { envelope_id: 9, email_sent: false, signing_url: 'https://axal.vc/sign/k3f9' }, member_notified: {} }), { status: 200 });
  const s = stub({ verify: () => answer() });
  const v = await record('pp_000000000a', { onDecided: () => { throw new Error('a result to read moved on'); } });
  try {
    await v.press('pp-decision-verify');
    await v.press('pp-verify-dialog-go');
    assert.match(v.of('pp-result'), /Verified\. The agreement was created, but the email did not go\. Copy the signing link and send it yourself\..*https:\/\/axal\.vc\/sign\/k3f9.*Copy/s);
    answer = () => new Response(JSON.stringify({ updated: true, esign_refusal: { code: 'template_body_missing', message: 'It has no text in the library yet' }, member_notified: {} }), { status: 200 });
    await v.press('pp-decision-verify');
    await v.press('pp-verify-dialog-go');
    assert.match(v.of('pp-result'), /The agreement was not sent: It has no text in the library yet\. Finish it in Contracts\..*Open in Contracts/s);
    answer = () => new Response(JSON.stringify({ error: 'tier_required', message: 'DocuSign sends require the Raise + Grow plan.' }), { status: 402 });
    await v.press('pp-decision-verify');
    await v.press('pp-verify-dialog-go');
    assert.equal(v.of('pp-plan-line'), `i${PLAN_LINE}`);
    assert.ok(v.has('pp-verify-dialog'), 'the dialog stays: nothing was changed');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted PRF5c: Reject needs a reason of 10 characters the member reads, and sends it', async () => {
  const s = stub();
  const v = await record('pp_000000000a', { onDecided() {} });
  try {
    await v.press('pp-decision-reject');
    assert.match(v.of('pp-reject-dialog'), /Reject Ada Example’s profile\?.*They are told, and they read your reason\./s);
    await v.type('pp-reject-reason', 'Too short');
    assert.equal(v.props('pp-reject-dialog-go').disabled, true, 'nine characters');
    await v.type('pp-reject-reason', 'The entity does not match the signatory.');
    assert.equal(v.props('pp-reject-dialog-go').disabled, false);
    await v.press('pp-reject-dialog-go');
    assert.deepEqual(JSON.parse(s.posts()[0].body), { status: 'rejected', agreement_type: '', admin_notes: '', provider: 'native', reject_reason: 'The entity does not match the signatory.' });
  } finally { await v.unmount(); s.restore(); }
});

test('mounted PRF4: an invitation\'s answers and its agreement; a Draft has nothing to review and no decision', async () => {
  const s = stub();
  const v = await record('pp_000000000b');
  try {
    assert.match(v.of('pp-invitation'), /Organisation.*Sample Capital LP.*Sectors.*Fintech, Climate.*Capital capacity.*\$250,000/s);
    assert.ok(!v.has('pp-who'), 'an invitation\'s profile shows its answers');
    assert.match(v.of('pp-decision-agreement'), /The partner agreement is sent by the invitation\. See it on Partner invitations\..*Open Partner invitations/s);
    assert.equal(v.props('pp-decision-invitations').href, '/admin/partner-invitations');
    assert.ok(!v.has('pp-agreement') && !v.has('pp-decision-send'), 'no agreement is picked here');
    assert.match(v.of('pp-decision-account'), /No account yet/);
  } finally { await v.unmount(); s.restore(); }
  const t = stub();
  const w = await record('pp_000000000d');
  try {
    assert.match(w.of('pp-record-draft'), /Nothing to review yet\.Eadwyn opened this record when Dee Draft started answering\. It joins the queue when they finish\./);
    assert.ok(!w.has('pp-decision') && !w.has('pp-record-prev'), 'no decision and no Previous or Next on a Draft');
  } finally { await w.unmount(); t.restore(); }
});

test('mounted: a decided profile offers Reopen; Unbind is a Super Admin\'s, with a reason, and an Admin reads one sentence', async () => {
  const s = stub();
  const v = await record('pp_000000000c', { viewerSuper: true });
  try {
    assert.match(v.of('pp-decision-verdict'), /^Verified 3 Oct by Ada Admin$/);
    assert.ok(v.has('pp-decision-reopen') && !v.has('pp-decision-verify'), 'a verdict reopens; it is not decided again');
    await v.press('pp-decision-unbind');
    assert.match(v.of('pp-unbind-dialog'), /Unbind this profile from the account\?.*now belongs to Nell New’s account.*fresh sign-in check and is recorded in Governance/s);
    assert.equal(v.props('pp-unbind-dialog-go').disabled, true, 'a reason is required');
    await v.type('pp-unbind-reason', 'The address moved to a new account.');
    await v.press('pp-unbind-dialog-go');
    assert.equal(s.posts()[0].path, '/api/admin/partner-profiles/pp_000000000c/unbind');
    assert.deepEqual(JSON.parse(s.posts()[0].body), { reason: 'The address moved to a new account.' });
    assert.match(v.of('pp-result'), /Unbound\./);
  } finally { await v.unmount(); s.restore(); }
  const t = stub();
  const w = await record('pp_000000000c', { viewerSuper: false });
  try {
    assert.ok(!w.has('pp-decision-unbind'));
    assert.match(w.of('pp-decision-unbind-admin'), /Only a Super Admin can unbind a profile from an account\./);
  } finally { await w.unmount(); t.restore(); }
});

test('mounted: each block that fails says so alone; a failed or missing record is said in the lightbox', async () => {
  const fail = () => new Response(JSON.stringify({ error: 'down', message: 'down' }), { status: 503 });
  let s = stub({ history: fail, agreements: fail });
  let v = await record('pp_000000000a');
  try {
    assert.match(v.of('pp-history-failed'), /Could not be read.*not the same as none.*Try again/s);
    assert.match(v.of('pp-agreements-failed'), /Could not be read.*Try again/s);
    assert.match(v.of('pp-who'), /Example Robotics Inc/, 'one failed block never blanks the record');
    assert.ok(v.has('pp-decision-verify'));
  } finally { await v.unmount(); s.restore(); }
  s = stub({ profile: fail });
  v = await record('pp_000000000a');
  try {
    assert.match(v.of('pp-record-failed'), /Could not be read.*This profile could not be read\..*Try again/s);
    assert.ok(!v.has('pp-decision'));
  } finally { await v.unmount(); s.restore(); }
  s = stub({ profile: () => new Response(JSON.stringify({ error: 'profile_not_found', message: 'No partner profile has that reference.' }), { status: 404 }) });
  v = await record('pp_00000000ff');
  try {
    assert.match(v.of('pp-record-failed'), /No partner profile has this address\./);
  } finally { await v.unmount(); s.restore(); }
});

test('the source: the console and its modal are retired; the record\'s address is a literal door; no browser pop-up', () => {
  assert.equal(existsSync(resolve(process.cwd(), 'frontend/src/pages/admin/consoles/PartnerProfilesConsole.jsx')), false);
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/admin\/partner-profiles\/:ref" element=\{guard\(\['admin'\], <PartnerProfiles \/>\)\} \/>/);
  const pageSrc = read('frontend/src/pages/admin/profiles/PartnerProfiles.jsx');
  assert.match(pageSrc, /navigate\(`\/admin\/partner-profiles\/\$\{row\.ref\}`/);
  assert.doesNotMatch(pageSrc, /ProfileReviewModal|adminGetProfile/);
  for (const f of ['ProfileRecord.jsx', 'ProfileDialogs.jsx', 'PartnerProfiles.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/admin/profiles/${f}`), /\balert\(|window\.confirm|\bconfirm\(/, f);
  }
});
