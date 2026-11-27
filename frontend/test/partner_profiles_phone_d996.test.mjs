/**
 * D996 (#2807) — Partner profiles part 7, the phone layout (PRF11a–c):
 * below 1024px the queue and every profile are cards, Filters and the sort sit
 * in a bottom sheet, one profile is a full page with Verify and Reject in a
 * bar at the bottom, the agreement and notes are their own page, and every
 * tap target is at least 44 by 44 px. Mounted on a stubbed Worker at phone
 * width (React props read through `__reactProps$`), with a failed block in
 * each.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_profiles_phone_d996.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { agreementRowLine } from '../src/pages/admin/profiles/profileModel.js';
import { rowView } from '../src/pages/admin/profiles/ppModel.js';
import PartnerProfiles from '../src/pages/admin/profiles/PartnerProfiles.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ---------------------------------------------------------------- fixtures, as D990, D991 and D993 answer

const LISTED = (o) => ({ status: 'pending', sources: ['chat'], account: null, identity_check: null, reviewed_at: null, reviewed_by: null, ...o });
const ADA = {
  ref: 'pp_000000000a', email: 'ada@example.com', user_id: 7, full_name: 'Ada Example', persona: 'Founder', founder_track: 'Spin-Out (New)',
  legal_entity_name: 'Example Robotics Inc', chat_history: JSON.stringify([{ role: 'assistant', content: 'Hello', ts: 1 }]), masked: { ein: '••-•••4821' },
  admin_notes: null, agreement_type: null,
  listed: LISTED({ user_name: 'Ada Example', sources: ['chat', 'eadwyn'], account: { user_id: 7, role: 'founder' }, identity_check: { state: 'pending', label: 'Pending' } }),
  unbind: { eligible: false },
};
const BEN = {
  ref: 'pp_000000000b', email: 'ben@example.com', user_id: null, invitation_id: 3, full_name: 'Ben Sample', organization: 'Sample Capital LP',
  masked: { ein: null }, chat_history: null, listed: LISTED({ full_name: 'Ben Sample', sources: ['invitation'] }), unbind: { eligible: false },
};
const VAL = {
  ref: 'pp_000000000c', email: 'val@example.com', user_id: 8, full_name: 'Val Verified', persona: 'Advisor', chat_history: '[]', masked: { ein: null },
  listed: LISTED({ user_name: 'Val Verified', status: 'verified', reviewed_at: '2026-10-03 12:00:00', reviewed_by: { user_id: 900, name: 'Ada Admin' }, account: { user_id: 8, role: 'advisor' } }),
  unbind: { eligible: false },
};
const PROFILES = { [ADA.ref]: ADA, [BEN.ref]: BEN, [VAL.ref]: VAL };
const ROW = (p, o = {}) => ({
  ref: p.ref, email: p.email, user_name: p.listed.user_name || null, full_name: p.full_name, status: p.listed.status, sources: p.listed.sources,
  account: p.listed.account, created_at: '2026-10-20 08:00:00', submitted_at: '2026-10-20 08:00:00', persona: p.persona || null, founder_track: p.founder_track || null, ...o,
});
const AGREEMENTS = { groups: [{ label: 'Investors', options: [{ value: 'Subscription Booklet & LPA', label: 'Subscription Booklet & LPA', ready: true }, { value: 'Side letter', label: 'Side letter', ready: false }] }] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = () => json({ error: 'down', message: 'down' }, 503);

function stub(o = {}) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = init.method || 'GET';
    seen.push({ path: u.pathname, search: u.search, method, body: init.body || null });
    const p = u.pathname;
    if (p === '/api/admin/partner-profiles') {
      if (o.list) return o.list(u);
      const rows = u.searchParams.get('status') === 'verified' ? [ROW(VAL)] : [ROW(ADA), ROW(BEN)];
      return json({ rows, totals: { total: rows.length, draft: 0, pending: 2, verified: 1, rejected: 0, not_recorded: 0 }, page: 1, page_size: 25, options: { category: ['Founder', 'Investor'] } });
    }
    if (p === '/api/admin/partner-profiles/counts') return json({ as_of: '2026-10-25T12:00:00Z', waiting: { available: true, count: 2, over_24h: 2, over_72h: 2, oldest_at: '2026-10-20 08:00:00', drafts: 0 }, verified_30d: { available: false }, envelopes_out: { available: true, count: 0, not_delivered: 0 }, weekly: { available: false } });
    if (p === '/api/admin/partner-profiles/agreements') return o.agreements ? o.agreements() : json(AGREEMENTS);
    let m = p.match(/^\/api\/admin\/partner-profiles\/(pp_\w+)$/);
    if (m) return json(PROFILES[m[1]]);
    m = p.match(/^\/api\/admin\/partner-profiles\/(pp_\w+)\/history$/);
    if (m) return o.history ? o.history() : json({ items: [], total: 0 });
    if (p.endsWith('/verify')) return json({ updated: true, esign: { envelope_id: 9, email_sent: true }, member_notified: {} });
    if (p === '/api/integrations') return json([]);
    return json({});
  };
  return {
    seen,
    posts: () => seen.filter((q) => q.method === 'POST'),
    lists: () => seen.filter((q) => q.path === '/api/admin/partner-profiles'),
    restore() { globalThis.fetch = original; },
  };
}

function Where({ onPath }) { const loc = useLocation(); onPath(loc.pathname); return null; }

/** The page at phone width (or not), on the routes App.jsx gives it. */
async function page(url, { phone = true, state = null } = {}) {
  const restore = installDocument();
  const media = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let path = null;
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [state ? { pathname: url, state } : url] },
      h(Where, { onPath: (p) => { path = p; } }),
      h(Routes, null,
        h(Route, { path: '/admin/partner-profiles', element: h(PartnerProfiles) }),
        h(Route, { path: '/admin/partner-profiles/all', element: h(PartnerProfiles) }),
        h(Route, { path: '/admin/partner-profiles/:ref', element: h(PartnerProfiles) }))));
  });
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, handler, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n)[handler](arg); }); await settle(); };
  return {
    path: () => path,
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    all: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).map(textOf),
    props: (id) => props(byId(id)),
    ids: (id) => walk(byId(id)).map((n) => props(n)?.['data-testid']).filter(Boolean),
    /** Every control under `id` with its class, its text and its test id. */
    controls: (id) => {
      const top = byId(id);
      assert.ok(top, `no ${id}`);
      return walk(top).filter((n) => ['BUTTON', 'A', 'SELECT', 'TEXTAREA', 'INPUT'].includes(n.tagName))
        .map((n) => ({ tag: n.tagName, type: props(n)?.type, cls: String(props(n)?.className || ''), text: textOf(n).trim(), id: props(n)?.['data-testid'] || null, parentCls: String(props(n.parentNode)?.className || '') }));
    },
    press: (id) => fire(id, 'onClick', { preventDefault() {}, stopPropagation() {} }),
    type: (id, value) => fire(id, 'onChange', { target: { value } }),
    async unmount() { await act(async () => root.unmount()); globalThis.matchMedia = media; restore(); },
  };
}

/** 44 by 44 px below 1024px: the class that says so, or a fixed size at least that big. */
const TALL = /(?:^|\s)(?:max-lg:min-h-\[44px\]|max-lg:h-11|min-h-\[44px\]|min-h-\[56px\]|h-11)(?:\s|$)/;
function tooSmall(controls) {
  return controls.filter((c) => {
    // A radio or a checkbox is tapped through its label.
    if (c.tag === 'INPUT' && (c.type === 'radio' || c.type === 'checkbox')) return !TALL.test(c.parentCls);
    return !TALL.test(c.cls);
  }).map((c) => `${c.tag} ${c.id || c.text}`);
}

// ---------------------------------------------------------------- the model

test('the Agreement and notes row says what is chosen, whether it is ready, and whether a note is written', () => {
  // Mutation checked: a blank note counted as one; the readiness left out; an invitation's line as "No agreement".
  const groups = [{ label: 'Investors', options: [{ value: 'Sub', label: 'Subscription Booklet & LPA', ready: true, note: 'Ready' }, { value: 'Side', label: 'Side letter', ready: false, note: 'Not ready: no text in the library yet' }] }];
  assert.equal(agreementRowLine({ agreement: 'Sub', agreementLabel: 'Subscription Booklet & LPA', notes: 'Call on 21 Oct.' }, groups), 'Subscription Booklet & LPA · Ready · 1 note');
  assert.equal(agreementRowLine({ agreement: '', notes: '   ' }, groups), 'No agreement · No note', 'spaces are not a note');
  assert.equal(agreementRowLine({ agreement: 'Side', agreementLabel: 'Side letter', notes: '' }, groups), 'Side letter · Not ready: no text in the library yet · No note');
  assert.equal(agreementRowLine({ agreement: 'Gone', agreementLabel: 'Gone', notes: '' }, groups), 'Gone · Not in the agreements list · No note');
  assert.equal(agreementRowLine({ agreement: 'Sub', agreementLabel: 'Subscription Booklet & LPA', notes: '' }, null), 'Subscription Booklet & LPA · No note', 'unread agreements claim no readiness');
  assert.equal(agreementRowLine({ agreement: '', notes: 'x' }, groups, { invitation: true }), 'Sent by the invitation · 1 note');
});

// ---------------------------------------------------------------- PRF11a

test('PRF11a: the queue is cards with the age pill, the person, the category and sources and a ›; a card opens the profile', async () => {
  // Mutation checked: the table on a phone → no cards; the age pill dropped; the card opening nothing.
  const s = stub();
  const v = await page('/admin/partner-profiles');
  try {
    assert.ok(!v.has('pp-queue-row'), 'no table on a phone');
    const cards = v.all('pp-queue-card');
    assert.equal(cards.length, 2);
    const age = rowView(ROW(ADA)).age.text;
    assert.ok(cards[0].startsWith(age), `the age pill leads the card: ${cards[0]}`);
    assert.match(cards[0], /Ada Example.*ada@example\.com.*Founder.*Spin-Out.*Onboarding chat.*Eadwyn questions.*›$/s);
    assert.match(cards[1], /Ben Sample.*ben@example\.com.*No category captured.*Partner invitation.*›$/s);
    assert.match(v.of('pp-queue-count'), /1–2 of 2/);
    await v.press('pp-queue-card');
    assert.equal(v.path(), '/admin/partner-profiles/pp_000000000a');
  } finally { await v.unmount(); s.restore(); }
});

test('PRF11a: Filters opens a bottom sheet with the filters and the sort; the button counts what is set, and Clear clears it', async () => {
  // Mutation checked: the count read off All profiles' filters; Clear leaving the track set; the sort outside the sheet.
  const s = stub();
  const v = await page('/admin/partner-profiles');
  try {
    assert.equal(v.of('pp-filters'), 'Filters · 0');
    assert.equal(v.of('pp-sort-open'), 'Sort: Waiting longest ▾');
    assert.ok(!v.has('pp-filter-source') && !v.has('pp-sort'), 'the filters wait in the sheet');
    await v.press('pp-filters');
    assert.deepEqual(v.ids('pp-filters-sheet').filter((x) => /^pp-(filter-|sort$)/.test(x)), ['pp-filter-source', 'pp-filter-category', 'pp-filter-track', 'pp-sort']);
    await v.type('pp-filter-source', 'invitation');
    await v.type('pp-filter-track', 'not_recorded');
    assert.equal(v.of('pp-filters'), 'Filters · 2');
    assert.match(s.lists().at(-1).search, /source=invitation/);
    await v.type('pp-sort', 'name');
    assert.match(s.lists().at(-1).search, /sort=name/);
    await v.press('pp-filters-clear');
    assert.equal(v.of('pp-filters'), 'Filters · 0');
    assert.doesNotMatch(s.lists().at(-1).search, /source=|founder_track=/);
    assert.equal(v.props('pp-filters-clear').disabled, true, 'nothing left to clear');
    await v.press('pp-filters-done');
    assert.ok(!v.has('pp-filters-sheet'));
    assert.equal(v.of('pp-sort-open'), 'Sort: Name ▾', 'Clear keeps the sort');
  } finally { await v.unmount(); s.restore(); }
});

test('PRF11a on All profiles: cards with the status, and every filter and the sort in the sheet', async () => {
  const s = stub();
  const v = await page('/admin/partner-profiles/all');
  try {
    assert.ok(!v.has('pp-all-row') && !v.has('pp-columns') && !v.has('pp-check-all'), 'no table, columns or checkboxes on a phone');
    assert.match(v.all('pp-all-card')[0], /Ada Example.*◷ Waiting.*Founder.*›$/s);
    await v.press('pp-filters');
    assert.deepEqual(v.ids('pp-filters-sheet').filter((x) => /^pp-(filter-|sort$)/.test(x)), [
      'pp-filter-source', 'pp-filter-category', 'pp-filter-track', 'pp-filter-entity', 'pp-filter-agreement', 'pp-filter-account',
      'pp-filter-identity', 'pp-filter-from', 'pp-filter-to', 'pp-filter-reviewed', 'pp-sort',
    ]);
    await v.type('pp-filter-account', 'yes');
    await v.type('pp-filter-from', '2026-10-01');
    assert.equal(v.of('pp-filters'), 'Filters · 2');
    await v.press('pp-filters-clear');
    assert.equal(v.of('pp-filters'), 'Filters · 0');
    await v.press('pp-filters-done');
    await v.press('pp-chip-verified');
    assert.match(v.all('pp-all-card')[0], /Val Verified.*✓ Verified/s);
    await v.press('pp-all-card');
    assert.equal(v.path(), '/admin/partner-profiles/pp_000000000c');
  } finally { await v.unmount(); s.restore(); }
});

// ---------------------------------------------------------------- PRF11b, c

test('PRF11b: one profile is a full page in the list\'s place, with Reject… and Verify… in the bar; back keeps the list', async () => {
  // Mutation checked: the list left showing under the page; the bar's order swapped; the back link naming the wrong list.
  const s = stub();
  const v = await page('/admin/partner-profiles/pp_000000000a', { state: { from: 'review' } });
  try {
    assert.equal(v.props('pp-list-area').hidden, true, 'the list is hidden, not gone');
    assert.ok(v.has('pp-queue'), 'and still mounted under the page');
    assert.ok(v.has('pp-record-page') && !v.has('pp-record-layer'), 'a page, not a dialog');
    assert.match(v.of('pp-record-head'), /^‹ To reviewAda Example.*Waiting.*Onboarding chat.*ada@example\.com · pp_000000000a · Opening this profile is recorded\.$/s);
    assert.ok(!v.has('pp-record-prev') && !v.has('pp-decision'), 'no Previous, Next or side card on a phone');
    assert.match(v.of('pp-phone-account'), /Account.*Identity check · read only.*Pending/s);
    assert.match(v.of('pp-phone-agreement-row'), /Agreement and notesNo agreement · No note›/);
    assert.deepEqual(v.controls('pp-record-bar').map((c) => c.text), ['Reject…', 'Verify…'], 'Reject on the left, Verify on the right');
    assert.match(v.props('pp-record-bar').className, /sticky bottom-0/);
    await v.press('pp-record-head-back');
    assert.equal(v.path(), '/admin/partner-profiles');
    assert.equal(v.props('pp-list-area').hidden, false);
  } finally { await v.unmount(); s.restore(); }
  const t = stub();
  const w = await page('/admin/partner-profiles/pp_000000000c', { state: { from: 'all' } });
  try {
    assert.match(w.of('pp-record-head'), /^‹ All profiles/);
    assert.deepEqual(w.controls('pp-record-bar').map((c) => c.text), ['Reopen…'], 'a verdict reopens; it is not decided again');
    assert.match(w.of('pp-record-bar'), /^Verified 3 Oct by Ada Admin/);
    await w.press('pp-record-head-back');
    assert.equal(w.path(), '/admin/partner-profiles/all');
  } finally { await w.unmount(); t.restore(); }
});

test('PRF11c: Agreement and notes is its own page; Back keeps what was there, Done keeps the change, and Verify sends it', async () => {
  // Mutation checked: Back keeping the draft; Done dropping it; the page's fields bound to the record's choice.
  const s = stub();
  const v = await page('/admin/partner-profiles/pp_000000000a', { state: { from: 'review' } });
  try {
    await v.press('pp-phone-agreement-open');
    assert.match(v.of('pp-agreement-head'), /^‹ Ada ExampleAgreement and notesChoose a first agreement if one fits, and leave a note for other admins\.$/);
    assert.ok(!v.has('pp-record-bar') && !v.has('pp-who'), 'the agreement page stands alone');
    assert.deepEqual(v.controls('pp-agreement-bar').map((c) => c.text), ['Back', 'Done']);
    await v.type('pp-agreement', 'Subscription Booklet & LPA');
    await v.type('pp-notes', 'LP call on 21 Oct.');
    await v.press('pp-agreement-back');
    assert.match(v.of('pp-phone-agreement-row'), /No agreement · No note/, 'Back changes nothing');
    await v.press('pp-phone-agreement-open');
    assert.equal(v.props('pp-notes').value, '', 'the page opens on the record\'s choice');
    await v.type('pp-agreement', 'Subscription Booklet & LPA');
    await v.type('pp-notes', 'LP call on 21 Oct.');
    await v.press('pp-agreement-done');
    assert.match(v.of('pp-phone-agreement-row'), /Subscription Booklet & LPA · Ready · 1 note/);
    await v.press('pp-decision-verify');
    assert.match(v.of('pp-verify-dialog'), /send the Subscription Booklet & LPA for signature/);
    await v.press('pp-verify-dialog-go');
    assert.deepEqual(JSON.parse(s.posts()[0].body), { status: 'verified', agreement_type: 'Subscription Booklet & LPA', admin_notes: 'LP call on 21 Oct.', provider: 'native' });
  } finally { await v.unmount(); s.restore(); }
});

test('PRF11b for an invitation: the row says the invitation sends it, and its page picks nothing', async () => {
  const s = stub();
  const v = await page('/admin/partner-profiles/pp_000000000b', { state: { from: 'review' } });
  try {
    assert.match(v.of('pp-phone-agreement-row'), /Sent by the invitation · No note/);
    await v.press('pp-phone-agreement-open');
    assert.match(v.of('pp-agreement-page'), /The partner agreement is sent by the invitation\./);
    assert.ok(!v.has('pp-agreement') && !v.has('pp-decision-send'));
  } finally { await v.unmount(); s.restore(); }
});

// ---------------------------------------------------------------- 44 px, failures, and the desktop unchanged

test('every tap target on the phone layout is at least 44 by 44 px', async () => {
  // Mutation checked: TAP dropped from the shared button class; the Filters button back to 32px; the card below 56px.
  const s = stub();
  const v = await page('/admin/partner-profiles');
  try {
    assert.deepEqual(tooSmall(v.controls('pp-queue')), []);
    await v.press('pp-filters');
    assert.deepEqual(tooSmall(v.controls('pp-filters-sheet')), []);
  } finally { await v.unmount(); s.restore(); }
  const t = stub();
  const w = await page('/admin/partner-profiles/pp_000000000a', { state: { from: 'review' } });
  try {
    assert.deepEqual(tooSmall(w.controls('pp-record-page')), []);
    await w.press('pp-phone-agreement-open');
    assert.deepEqual(tooSmall(w.controls('pp-record-page')), []);
  } finally { await w.unmount(); t.restore(); }
  const u = stub();
  const x = await page('/admin/partner-profiles/all');
  try {
    assert.deepEqual(tooSmall(x.controls('pp-all')), []);
  } finally { await x.unmount(); u.restore(); }
});

test('a failed block says so alone on a phone, with Try again', async () => {
  let s = stub({ list: fail });
  let v = await page('/admin/partner-profiles');
  try {
    assert.match(v.of('pp-list-failed'), /Try again/);
    assert.ok(v.has('pp-filters'), 'the tools stay');
    assert.ok(!v.has('pp-queue-cards'));
  } finally { await v.unmount(); s.restore(); }
  s = stub({ history: fail, agreements: fail });
  v = await page('/admin/partner-profiles/pp_000000000a', { state: { from: 'review' } });
  try {
    assert.match(v.of('pp-history-failed'), /Could not be read.*Try again/s);
    assert.match(v.of('pp-phone-agreement-row'), /The agreements could not be read\./);
    assert.ok(v.has('pp-who') && v.has('pp-record-bar'), 'the rest of the page answers');
    await v.press('pp-phone-agreement-open');
    assert.match(v.of('pp-agreements-failed'), /Could not be read.*Try again/s);
  } finally { await v.unmount(); s.restore(); }
});

test('at desktop width nothing changes: the table, the toolbar filters and the record as a lightbox', async () => {
  const s = stub();
  const v = await page('/admin/partner-profiles', { phone: false });
  try {
    assert.equal(v.all('pp-queue-row').length, 2);
    assert.ok(v.has('pp-filter-source') && !v.has('pp-filters') && !v.has('pp-queue-cards'));
  } finally { await v.unmount(); s.restore(); }
  const t = stub();
  const w = await page('/admin/partner-profiles/pp_000000000a', { phone: false, state: { from: 'review' } });
  try {
    assert.ok(w.has('pp-record-layer') && !w.has('pp-record-page'));
    assert.ok(w.has('pp-decision') && w.has('pp-record-prev') && !w.has('pp-record-bar'));
    assert.equal(w.props('pp-list-area').hidden, false, 'the list shows under the lightbox');
  } finally { await w.unmount(); t.restore(); }
});

test('the source: PRF11 is drawn from the shared phone pieces, and no browser pop-up', () => {
  const src = read('frontend/src/pages/admin/profiles/PartnerProfiles.jsx');
  assert.match(src, /usePhoneWidth\(\)/);
  assert.match(src, /<PhoneSheet title="Filters and sort"/);
  const rec = read('frontend/src/pages/admin/profiles/ProfileRecord.jsx');
  assert.match(rec, /pageBelow="lg"/);
  assert.match(read('frontend/src/pages/admin/profiles/ppStyles.js'), /export const TAP = 'max-lg:min-h-\[44px\] max-lg:min-w-\[44px\]'/);
  for (const f of ['PartnerProfiles.jsx', 'ProfileRecord.jsx']) assert.doesNotMatch(read(`frontend/src/pages/admin/profiles/${f}`), /\balert\(|window\.confirm|\bconfirm\(/, f);
});
