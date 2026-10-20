/**
 * D814 (#2260) — "Apply for Product Testing": the Studio card, `/product-testing`
 * (Open programmes, the application sheet, My applications) and where they
 * are reached from. The Worker is D812's (`product_testing_d812.test.ts`,
 * which also holds the bell's link to My applications).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_d814.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { productTestingApi } from '../src/lib/api.js';
import { pageKeyFor } from '../src/lib/railPages.js';
import { RENDER_NOT_YET } from './_airailRender.mjs';
import ProductTestingCard from '../src/pages/productTesting/ProductTestingCard.jsx';
import ProductTestingPage from '../src/pages/productTesting/ProductTestingPage.jsx';
import {
  MY_APPLICATIONS_PATH, applyBlock, canSubmit, openLine, placesLine, statusPill, tabOf, withdrawable,
} from '../src/pages/productTesting/productTestingModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-20T12:00:00Z');

const programme = (over = {}) => ({
  uid: 'p1', owner_kind: 'hq', owner_name: 'Axal VC', product_name: 'Ledger beta', summary: 'A new ledger.',
  tester_tasks: 'Reconcile a month', time_needed: '2 hours over 2 weeks', opens_at: '2026-10-01T00:00:00Z',
  closes_at: '2026-11-01T00:00:00Z', testing_starts: '2026-11-03T00:00:00Z', testing_ends: '2026-11-17T00:00:00Z',
  places: 20, places_left: 8, eligible_roles: ['founder'], questions: ['Why test it?', 'Your experience?'], status: 'open', my_status: null, ...over,
});

async function mount(el, { phone = false } = {}) {
  const restore = installDocument();
  const media = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, settle, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(n) { await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(n, value) { await act(async () => { pr(n).onChange({ target: { value } }); }); },
    async unmount() { await act(async () => root.unmount()); globalThis.matchMedia = media; restore(); },
  };
}

/** Stubs `productTestingApi` for one test; returns the calls and a restore. */
function stub(methods) {
  const orig = { ...productTestingApi };
  const calls = [];
  for (const [k, fn] of Object.entries(methods)) productTestingApi[k] = (...a) => { calls.push([k, ...a]); return fn(...a); };
  return { calls, restore: () => Object.assign(productTestingApi, orig) };
}

const page = (search = '', user = { role: 'founder' }) => h(MemoryRouter, { initialEntries: [`/product-testing${search}`] }, h(ProductTestingPage, { user }));

test('the rules: why Apply is held, in apply\'s order; the pills; what can be withdrawn; the words', () => {
  assert.equal(applyBlock(programme(), 'founder', NOW), null);
  assert.equal(applyBlock(programme({ my_status: 'applied' }), 'founder', NOW), 'You have applied: Applied.');
  assert.equal(applyBlock(programme({ status: 'closed' }), 'founder', NOW), 'Applications are closed.');
  assert.equal(applyBlock(programme({ closes_at: '2026-10-19T00:00:00Z' }), 'founder', NOW), 'Applications are closed.', 'past its close while the page was open');
  assert.equal(applyBlock(programme({ eligible_roles: ['investor'] }), 'founder', NOW), 'This programme is not open to your role.');
  assert.equal(applyBlock(programme({ places_left: 0 }), 'founder', NOW), 'Every place is taken.');
  assert.equal(applyBlock(programme({ status: 'closed', places_left: 0 }), 'founder', NOW), 'Applications are closed.', 'closed is said before full');
  assert.deepEqual(['applied', 'picked', 'declined', 'withdrawn'].map((s) => statusPill(s).label), ['Applied', 'Picked', 'Not this time', 'Withdrawn']);
  assert.deepEqual(['applied', 'picked', 'declined', 'withdrawn'].map((s) => withdrawable({ status: s })), [true, true, false, false]);
  assert.equal(openLine(1), '1 programme open');
  assert.equal(openLine(3), '3 programmes open');
  assert.equal(openLine(0), '0 programmes open');
  assert.equal(placesLine(programme()), '8 of 20 places left');
  assert.equal(placesLine({}), 'Places not recorded');
  assert.equal(tabOf('?tab=applications'), 'applications');
  assert.equal(tabOf('?tab=nope'), 'open');
  assert.equal(MY_APPLICATIONS_PATH, '/product-testing?tab=applications');
  assert.equal(canSubmit(['a', 'b'], ['x', 'y'], true), true);
  assert.equal(canSubmit(['a', 'b'], ['x', 'y'], false), false, 'the consent is required');
  assert.equal(canSubmit(['a', 'b'], ['x', '  '], true), false, 'every question answered');
  assert.equal(canSubmit(['a'], ['x'.repeat(2001)], true), false, 'within the Worker\'s 2000 characters');
  assert.equal(canSubmit([], [], true), true, 'a programme with no questions needs only the consent');
});

test('the card: the Worker\'s count and a badge for each programme the member was picked for', async () => {
  const s = stub({ summary: async () => ({ open_count: 3, picked: [{ programme_uid: 'p9', product_name: 'Payroll beta' }] }) });
  const m = await mount(h(MemoryRouter, null, h(ProductTestingCard)));
  try {
    assert.equal(m.text(m.by('product-testing-count')), '3 programmes open');
    assert.equal(m.text(m.by('badge-picked-p9')), 'You’re in: Payroll beta');
    assert.equal(m.pr(m.by('link-product-testing')).href, '/product-testing');
    assert.match(m.text(m.by('card-product-testing')), /^Test new products before they launch/);
  } finally { await m.unmount(); s.restore(); }

  const none = stub({ summary: async () => ({ open_count: 1, picked: [] }) });
  const n = await mount(h(MemoryRouter, null, h(ProductTestingCard)));
  try {
    assert.equal(n.text(n.by('product-testing-count')), '1 programme open');
    assert.ok(!n.by('product-testing-picked'), 'no badge when nobody picked them');
  } finally { await n.unmount(); none.restore(); }
});

test('the card: unreadable with Try again, and nothing at all in a role preview', async () => {
  let fail = true;
  const s = stub({ summary: async () => { if (fail) throw new Error('down'); return { open_count: 2, picked: [] }; } });
  const m = await mount(h(MemoryRouter, null, h(ProductTestingCard)));
  try {
    assert.equal(m.pr(m.by('card-product-testing'))['data-state'], 'unreadable');
    assert.ok(m.text(m.by('product-testing-unreadable')).includes('Unreadable'));
    fail = false;
    await m.click(m.by('product-testing-retry'));
    assert.equal(m.text(m.by('product-testing-count')), '2 programmes open');
  } finally { await m.unmount(); s.restore(); }

  const p = stub({ summary: async () => ({ open_count: 9, picked: [] }) });
  const v = await mount(h(MemoryRouter, null, h(ProductTestingCard, { previewing: true })));
  try {
    assert.ok(!v.by('card-product-testing'));
    assert.equal(p.calls.length, 0, 'an administrator\'s preview reads nothing of their own');
  } finally { await v.unmount(); p.restore(); }
});

test('Open programmes: Apply is held with its reason when full, closed or not for the role; the partner pill', async () => {
  const items = [
    programme({ uid: 'ok', owner_kind: 'partner', owner_name: 'Acme' }),
    programme({ uid: 'full', places_left: 0 }),
    programme({ uid: 'closed', closes_at: '2020-01-01T00:00:00Z' }),
    programme({ uid: 'role', eligible_roles: ['investor', 'advisor'] }),
  ];
  const s = stub({ programmes: async () => ({ items, consent: { version: 'd812-1', text: 'Axal may email me.' } }), myApplications: async () => ({ items: [] }) });
  const m = await mount(page());
  try {
    assert.equal(m.pr(m.by('apply-ok')).disabled, false);
    assert.ok(!m.by('apply-reason-ok'));
    assert.equal(m.text(m.by('pill-partner-ok')), 'Partner');
    assert.ok(!m.by('pill-partner-full'), 'Axal VC\'s own carries no Partner pill');
    for (const [uid, why] of [['full', 'Every place is taken.'], ['closed', 'Applications are closed.'], ['role', 'This programme is not open to your role.']]) {
      assert.equal(m.pr(m.by(`apply-${uid}`)).disabled, true, uid);
      assert.equal(m.text(m.by(`apply-reason-${uid}`)), why, uid);
    }
    assert.equal(m.text(m.by('places-ok')), '8 of 20 places left');
    assert.ok(m.text(m.by('programme-role')).includes('Investors, Advisors'));
    assert.equal(m.pr(m.by('product-testing-page'))['data-layout'], 'desktop');
  } finally { await m.unmount(); s.restore(); }
});

test('the sheet: Submit waits for every answer and the consent; it sends consent_email; a refusal shows the Worker\'s words', async () => {
  let refuse = true;
  const s = stub({
    programmes: async () => ({ items: [programme()], consent: { version: 'd812-1', text: 'Axal may email me about this testing programme.' } }),
    myApplications: async () => ({ items: [] }),
    apply: async () => { if (refuse) throw Object.assign(new Error('Every place on this programme is taken.'), { code: 'programme_full' }); return { application: { uid: 'a1' } }; },
  });
  const m = await mount(page());
  try {
    await m.click(m.by('apply-p1'));
    assert.ok(m.by('apply-sheet'));
    assert.equal(m.text(m.by('apply-consent-text')), 'Axal may email me about this testing programme.');
    const submit = () => m.pr(m.by('apply-submit')).disabled;
    assert.equal(submit(), true, 'nothing answered');
    await m.type(m.by('apply-answer-0'), 'I run payroll');
    await m.type(m.by('apply-answer-1'), 'Ten years');
    assert.equal(submit(), true, 'answered, but no consent');
    await m.click(m.by('apply-consent'));
    assert.equal(m.pr(m.by('apply-consent'))['aria-checked'], true);
    assert.equal(submit(), false);
    await m.type(m.by('apply-answer-1'), '   ');
    assert.equal(submit(), true, 'a blank answer holds it again');
    await m.type(m.by('apply-answer-1'), 'Ten years');
    await m.type(m.by('apply-availability'), 'Evenings');
    await m.click(m.by('apply-submit'));
    assert.equal(m.text(m.by('apply-error')), 'Every place on this programme is taken.');
    assert.ok(m.by('apply-sheet'), 'the sheet stays open on a refusal');
    refuse = false;
    await m.click(m.by('apply-submit'));
    const sent = s.calls.filter(([k]) => k === 'apply');
    assert.deepEqual(sent[sent.length - 1], ['apply', 'p1', { answers: ['I run payroll', 'Ten years'], availability: 'Evenings', consentEmail: true }]);
    assert.ok(!m.by('apply-sheet'), 'closed once applied');
    assert.match(m.text(m.by('apply-notice')), /^You applied to test Ledger beta\./);
    assert.equal(s.calls.filter(([k]) => k === 'programmes').length, 2, 'the lists are read again');
  } finally { await m.unmount(); s.restore(); }
});

test('My applications: the status pills, Withdraw on an applied or picked one only, and a refusal on its row', async () => {
  let apps = [
    { uid: 'a1', product_name: 'Ledger beta', status: 'applied', applied_at: '2026-10-10T00:00:00Z' },
    { uid: 'a2', product_name: 'Payroll beta', status: 'picked' },
    { uid: 'a3', product_name: 'CRM beta', status: 'declined' },
    { uid: 'a4', product_name: 'Docs beta', status: 'withdrawn' },
  ];
  let refuse = false;
  const s = stub({
    programmes: async () => ({ items: [], consent: null }),
    myApplications: async () => ({ items: apps }),
    withdraw: async (uid) => {
      if (refuse) throw new Error('This application can no longer be withdrawn.');
      apps = apps.map((a) => (a.uid === uid ? { ...a, status: 'withdrawn' } : a));
      return { application: apps.find((a) => a.uid === uid) };
    },
  });
  const m = await mount(page('?tab=applications'));
  try {
    assert.equal(m.pr(m.by('tab-applications'))['aria-selected'], true);
    assert.deepEqual(['a1', 'a2', 'a3', 'a4'].map((u) => m.text(m.by(`status-${u}`))), ['Applied', 'Picked', 'Not this time', 'Withdrawn']);
    assert.deepEqual(['a1', 'a2', 'a3', 'a4'].map((u) => !!m.by(`withdraw-${u}`)), [true, true, false, false]);
    await m.click(m.by('withdraw-a1'));
    assert.deepEqual(s.calls.find(([k]) => k === 'withdraw'), ['withdraw', 'a1']);
    assert.equal(m.text(m.by('status-a1')), 'Withdrawn', 'read again after the withdraw');
    assert.ok(!m.by('withdraw-a1'));
    refuse = true;
    await m.click(m.by('withdraw-a2'));
    assert.equal(m.text(m.by('withdraw-error-a2')), 'This application can no longer be withdrawn.');
  } finally { await m.unmount(); s.restore(); }
});

test('each list: loading, unreadable with Try again, and empty', async () => {
  let fail = true;
  const s = stub({
    programmes: async () => { if (fail) throw new Error('down'); return { items: [], consent: null }; },
    myApplications: async () => ({ items: [] }),
  });
  const m = await mount(page());
  try {
    assert.ok(m.text(m.by('programmes-unreadable')).startsWith('Unreadable The open programmes could not be read.'));
    fail = false;
    await m.click(m.by('programmes-unreadable-retry'));
    assert.ok(m.by('programmes-empty'));
    await m.click(m.by('tab-applications'));
    assert.ok(m.by('applications-empty'));
  } finally { await m.unmount(); s.restore(); }

  const never = stub({ programmes: () => new Promise(() => {}), myApplications: () => new Promise(() => {}) });
  const w = await mount(page());
  try { assert.ok(w.by('programmes-loading')); } finally { await w.unmount(); never.restore(); }
});

test('the phone layout: one column, the same tabs and the same Apply', async () => {
  const s = stub({ programmes: async () => ({ items: [programme(), programme({ uid: 'p2' })], consent: null }), myApplications: async () => ({ items: [] }) });
  const m = await mount(page(), { phone: true });
  try {
    assert.equal(m.pr(m.by('product-testing-page'))['data-layout'], 'phone');
    assert.equal(m.pr(m.by('programmes')).className, 'grid gap-3', 'no second column on a phone');
    assert.ok(m.by('tab-open') && m.by('tab-applications'));
    assert.equal(m.pr(m.by('apply-p2')).disabled, false);
  } finally { await m.unmount(); s.restore(); }
});

test('reached from the card, the account menus and the bell; every signed-in role; its rail, with no RENDER_NOT_YET line', () => {
  const app = read('src/App.jsx');
  assert.match(app, /<Route path="\/product-testing" element=\{guard\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\], <ProductTestingPage user=\{user\} \/>\)\} \/>/);
  assert.match(app, /<Link to="\/product-testing" onClick=\{\(\) => setOpen\(false\)\}[^>]*role="menuitem">\s*Product testing\s*<\/Link>/, 'the desktop account menu');
  assert.match(read('src/ui/phone/AccountSheet.jsx'), /\['Product testing', '\/product-testing'\]/, 'the phone account sheet');
  for (const [p, role] of [['founder', 'Founder'], ['investor', 'Investor'], ['advisor', 'Advisor'], ['partner', 'Operating Partner']]) {
    assert.equal(pageKeyFor('/product-testing', { founder: 'founder', investor: 'investor', advisor: 'advisor', partner: 'partner' }[p]), `${role} · Product testing`);
  }
  // The four Studio pages carry the card.
  assert.match(read('src/pages/founder/FounderStudioHome.jsx'), /testingCard=\{<ProductTestingCard \/>\}/);
  assert.match(read('src/pages/founder/FounderStudioBody.jsx'), /<aside className="grid content-start gap-4">\s*\{\/\*[^*]*\*\/\}\s*\{testingCard\}/);
  for (const f of ['investor/InvestorStudioHome.jsx', 'advisor/AdvisorStudioHome.jsx', 'partner/PartnerStudioHome.jsx']) {
    assert.match(read(`src/pages/${f}`), /<ProductTestingCard previewing=\{previewing\} className="m[tb]-4" \/>/, f);
  }
  // The page draws its rail in the shared frame; D781's render ratchet renders it in every profile.
  assert.match(read('src/pages/productTesting/ProductTestingPage.jsx'), /<RailFrame rail=\{<WorkerRail workspace="Product testing"/);
  assert.ok(!Object.values(RENDER_NOT_YET).flat().some((n) => n.endsWith(' /product-testing')), 'no RENDER_NOT_YET line added');
  // The bell's member notifications link here (D812's notify call).
  assert.match(read('../cloudflare-worker/src/services/testing.ts'), /export const MY_APPLICATIONS_LINK = '\/product-testing\?tab=applications';/);
});
