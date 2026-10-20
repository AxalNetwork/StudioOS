/**
 * D815 (#2261) — product testing, the owner's side: the partner's
 * `/offers/testing` zone (board D4) and HQ › Product testing (board D5), over
 * D812's module. Stubbed APIs only.
 *
 * What these prove:
 *   · The model: Waiting for HQ and Sent back, the places line, the form's
 *     checks, what each status allows, and refusals in words.
 *   · The partner's zone lists what its own read returns and nothing else,
 *     creates a draft, and Submit moves it to Waiting for HQ; HQ's note shows
 *     on a programme sent back; Unreadable has Try again; it draws on a phone.
 *   · Pick past the places shows the Worker's sentence; the owner reads no
 *     email address; the Mail note is there.
 *   · HQ approves; Send back needs a reason and sends it; New programme makes
 *     HQ's own; a plain admin is refused.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_ui_d815.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  byStatus, canDecline, canPick, formToPayload, hqSteps, isSubmittable, placesLine, refusalText, statusLabel, MAIL_NOTE,
} from '../src/pages/testing/programmeModel.js';
import ProgrammeApplicants from '../src/pages/testing/ProgrammeApplicants.jsx';
import TestingZone, { inView } from '../src/pages/partner/offers/TestingZone.jsx';
import { ProductTestingConsole, ProductTestingPanel, PRODUCT_TESTING_HOLDER_ONLY } from '../src/pages/admin/consoles/ProductTestingConsole.jsx';

const h = React.createElement;
const prog = (over = {}) => ({
  uid: 'p1', owner_kind: 'partner', owner_name: 'Acme Labs', product_name: 'Ledger beta', status: 'draft',
  places: 3, picked_count: 1, applicant_count: 2, eligible_roles: ['founder'], questions: ['What do you use today?'],
  opens_at: null, closes_at: null, testing_starts: null, testing_ends: null, review_note: null, ...over,
});

test('the model: status words, the places line, what each status allows, and refusals in words', () => {
  // Mutation checked: map submitted to "Submitted" → the label is not the board's "Waiting for HQ".
  assert.equal(statusLabel('submitted'), 'Waiting for HQ');
  assert.equal(statusLabel('rejected'), 'Sent back');
  assert.equal(placesLine(prog()), '1 of 3 places filled');
  assert.equal(placesLine({}), 'Places not recorded');
  assert.equal(isSubmittable(prog()), true);
  assert.equal(isSubmittable(prog({ status: 'rejected' })), false, 'a sent-back programme returns to draft first');
  assert.equal(isSubmittable(prog({ owner_kind: 'hq' })), false, "HQ's own needs no review");
  // Mutation checked: offer Open on a submitted partner programme → hqSteps gives ['approve','reject','open'].
  assert.deepEqual(hqSteps(prog({ status: 'submitted' })), ['approve', 'reject']);
  assert.deepEqual(hqSteps(prog({ status: 'approved' })), ['open']);
  assert.deepEqual(hqSteps(prog({ owner_kind: 'hq' })), ['open']);
  assert.deepEqual(hqSteps(prog({ status: 'draft' })), [], "a partner's draft is not HQ's to open");
  assert.deepEqual(hqSteps(prog({ status: 'open' })), ['close']);
  assert.deepEqual([canPick({ status: 'applied' }), canPick({ status: 'picked' }), canDecline({ status: 'picked' }), canDecline({ status: 'declined' })],
    [true, false, true, false]);
  assert.deepEqual(byStatus([prog({ uid: 'a', status: 'open' }), prog({ uid: 'b', status: 'submitted' })]).map((g) => g.label), ['Waiting for HQ', 'Open']);
  assert.deepEqual([inView('drafts', prog({ status: 'rejected' })), inView('live', prog({ status: 'closed' })), inView('all', prog())], [true, false, true]);
  // Never a bare code on the page.
  assert.equal(refusalText(Object.assign(new Error('programme_full'), { code: 'programme_full' }), 'fallback'), 'fallback');
  assert.equal(refusalText(new Error('Every place is taken. Decline someone first.'), 'fallback'), 'Every place is taken. Decline someone first.');
});

test('the form checks what D812 checks and sends its body', () => {
  // Mutation checked: drop the roles check → a programme open to nobody is sent.
  const good = { product_name: ' Ledger beta ', places: '3', eligible_roles: ['founder', 'admin'], questions: ['  Why?  ', ''], opens_at: '2026-11-01', closes_at: '2026-11-15' };
  const out = formToPayload(good);
  assert.deepEqual([out.payload.product_name, out.payload.places, out.payload.eligible_roles, out.payload.questions, out.payload.summary],
    ['Ledger beta', 3, ['founder'], ['Why?'], null]);
  for (const [bad, why] of [
    [{ ...good, product_name: ' ' }, /Name the product/],
    [{ ...good, places: '0' }, /whole number/],
    [{ ...good, places: '2.5' }, /whole number/],
    [{ ...good, eligible_roles: [] }, /who can apply/],
    [{ ...good, questions: ['1', '2', '3', '4', '5', '6'] }, /up to 5/],
    [{ ...good, closes_at: '2026-10-01' }, /close before they open/],
  ]) assert.match(formToPayload(bad).error, why, JSON.stringify(bad));
});

// ── mounting ───────────────────────────────────────────────────────────────

async function mount(element, { phone = false } = {}) {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.window.addEventListener = () => {};
  globalThis.window.removeEventListener = () => {};
  if (phone) {
    globalThis.window.innerWidth = 390;
    globalThis.window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(Routes, null, h(Route, { path: '*', element })))); });
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    by,
    text: () => textOf(container).replace(/\s+/g, ' '),
    prop: (id, name) => props(by(id) || {})[name],
    textIn: (id) => { const n = by(id); return n ? textOf(n).replace(/\s+/g, ' ').trim() : null; },
    async click(id) {
      const n = by(id);
      if (!n) throw new Error(`Missing ${id}`);
      await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async clickText(label) {
      const n = walk(container).find((x) => x.tagName === 'BUTTON' && textOf(x).trim() === label);
      if (!n) throw new Error(`Missing button ${label}`);
      await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async type(id, value) {
      const n = by(id);
      if (!n) throw new Error(`Missing ${id}`);
      await act(async () => { props(n).onChange?.({ target: { value } }); });
      await settle();
    },
    async submitForm(id) {
      const n = by(id);
      await act(async () => { await props(n).onSubmit?.({ preventDefault() {} }); });
      await settle();
    },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

/** A partner API over an in-memory list, recording every call. */
function partnerApi(items) {
  const calls = [];
  const list = items.map((p) => ({ ...p }));
  return {
    calls,
    programmes: async () => { calls.push('programmes'); return { items: list.map((p) => ({ ...p })) }; },
    create: async (body) => { calls.push(['create', body]); const p = prog({ uid: 'new1', ...body, status: 'draft', picked_count: 0, applicant_count: 0 }); list.unshift(p); return { programme: p }; },
    edit: async (uid, body) => { calls.push(['edit', uid, body]); return { programme: { ...list.find((p) => p.uid === uid), ...body, status: 'draft' } }; },
    submit: async (uid) => { calls.push(['submit', uid]); const p = list.find((x) => x.uid === uid); p.status = 'submitted'; return { programme: p }; },
    applicants: async () => ({ programme: prog(), items: [] }),
    pick: async () => ({}),
    decline: async () => ({}),
  };
}

test('the partner zone lists its own read, makes a draft, and Submit moves it to Waiting for HQ', async () => {
  // Mutation checked: skip the reload after submit → the programme still reads Draft.
  const api = partnerApi([prog(), prog({ uid: 'p2', product_name: 'Payroll beta', status: 'rejected', review_note: 'Add the dates' })]);
  const v = await mount(h(TestingZone, { api }));
  try {
    assert.ok(v.text().includes('Ledger beta') && v.text().includes('Payroll beta'));
    assert.ok(v.text().includes('1 of 3 places filled'));
    assert.ok(v.textIn('testing-review-note-p2').includes('Add the dates'), "HQ's note on a programme sent back");
    assert.ok(!v.by('testing-submit-p2'), 'a sent-back programme is edited, not resubmitted as it stands');
    await v.click('testing-submit-p1');
    assert.deepEqual(api.calls.filter((c) => Array.isArray(c)), [['submit', 'p1']]);
    assert.ok(v.textIn('testing-group-submitted').includes('Ledger beta'), 'now under Waiting for HQ');
    assert.ok(!v.by('testing-submit-p1'));
    // New programme: the form refuses an empty name, then creates a draft.
    await v.click('testing-new-programme');
    await v.submitForm('programme-form');
    assert.match(v.textIn('programme-form-error') || '', /Name the product/);
    await v.type('programme-product_name', 'Invoice tool');
    await v.type('programme-places', '5');
    await v.type('programme-role-founder', true);
    await v.submitForm('programme-form');
    const created = api.calls.find((c) => Array.isArray(c) && c[0] === 'create');
    assert.deepEqual([created[1].product_name, created[1].places, created[1].eligible_roles], ['Invoice tool', 5, ['founder']]);
    assert.ok(v.by('testing-programme-new1'), 'the new draft is listed');
  } finally { await v.unmount(); }
});

test('the partner zone: Unreadable with Try again, the empty state, and the phone width', async () => {
  // Mutation checked: render a failed read as the empty state → "No testing programmes yet" shows on a failure.
  let fail = true;
  const api = { ...partnerApi([]), programmes: async () => { if (fail) throw new Error('D1 is down'); return { items: [] }; } };
  const v = await mount(h(TestingZone, { api }));
  try {
    assert.ok(v.text().includes('This did not load'));
    assert.ok(!v.text().includes('No testing programmes yet'));
    fail = false;
    await v.clickText('Try again');
    assert.ok(v.text().includes('No testing programmes yet'), 'Try again reads again');
  } finally { await v.unmount(); }
  const empty = await mount(h(TestingZone, { api: partnerApi([]) }));
  try { assert.ok(empty.text().includes('No testing programmes yet')); } finally { await empty.unmount(); }
  const phone = await mount(h(TestingZone, { api: partnerApi([prog()]) }), { phone: true });
  try {
    assert.ok(phone.by('testing-programme-p1') && phone.by('testing-submit-p1'), 'the list and its actions draw at 390px');
  } finally { await phone.unmount(); }
  // The SlideOver is full width below its max, so the form fits a phone.
  assert.match(readFileSync('frontend/src/pages/advisor/network/kit.jsx', 'utf8'), /relative w-full max-w-lg h-full/);
});

test('applicants: the counter, the Mail note, no email, and a pick past the places in the Worker\'s words', async () => {
  // Mutation checked: show the error's code instead of its sentence → "programme_full" reaches the page.
  const full = Object.assign(new Error('Every place is taken. Decline someone first.'), { status: 409, code: 'programme_full' });
  const api = {
    applicants: async () => ({
      programme: prog({ status: 'open', places: 1, picked_count: 1 }),
      items: [
        { uid: 'a1', name: 'Fran Ruiz', role: 'founder', answers: ['Spreadsheets'], availability: 'Evenings', consented: true, status: 'picked' },
        { uid: 'a2', name: 'Finn Oak', role: 'founder', answers: ['Paper'], availability: null, consented: false, status: 'applied' },
      ],
    }),
    pick: async () => { throw full; },
    decline: async () => ({}),
  };
  const v = await mount(h(ProgrammeApplicants, { uid: 'p1', api }));
  try {
    assert.equal(v.textIn('applicants-places'), '1 of 1 places filled');
    assert.equal(v.textIn('applicants-mail-note'), MAIL_NOTE);
    assert.ok(v.text().includes('Spreadsheets') && v.text().includes('What do you use today?'));
    assert.ok(!/@/.test(v.text()), 'no email address');
    assert.ok(!v.by('applicant-pick-a1') && v.by('applicant-decline-a1'), 'a picked tester is declined, not picked again');
    await v.click('applicant-pick-a2');
    assert.equal(v.textIn('applicants-refusal'), 'Every place is taken. Decline someone first.');
    assert.ok(!v.text().includes('programme_full'));
  } finally { await v.unmount(); }
  // Before it opens, nobody is picked.
  const closed = await mount(h(ProgrammeApplicants, { uid: 'p1', api: { ...api, applicants: async () => ({ programme: prog({ status: 'approved' }), items: [{ uid: 'a2', name: 'Finn', role: 'founder', status: 'applied', answers: [] }] }) } }));
  try {
    // Mutation checked: drop the isPickable gate → Pick shows on an approved programme.
    assert.ok(!closed.by('applicant-pick-a2') && closed.by('applicants-not-open'));
  } finally { await closed.unmount(); }
  const broken = await mount(h(ProgrammeApplicants, { uid: 'p1', api: { ...api, applicants: async () => { throw new Error('down'); } } }));
  try { assert.ok(broken.by('applicants-unreadable') && broken.by('applicants-retry')); } finally { await broken.unmount(); }
});

function adminApi(items) {
  const calls = [];
  const list = items.map((p) => ({ ...p }));
  const set = (uid, status, extra = {}) => Object.assign(list.find((p) => p.uid === uid), { status, ...extra });
  return {
    calls,
    programmes: async () => ({ items: list.map((p) => ({ ...p })) }),
    approve: async (uid) => { calls.push(['approve', uid]); set(uid, 'approved'); return {}; },
    reject: async (uid, note) => { calls.push(['reject', uid, note]); set(uid, 'rejected', { review_note: note }); return {}; },
    open: async (uid) => { calls.push(['open', uid]); set(uid, 'open'); return {}; },
    close: async (uid) => { calls.push(['close', uid]); set(uid, 'closed'); return {}; },
    create: async (body) => { calls.push(['create', body]); list.push(prog({ uid: 'hq1', owner_kind: 'hq', owner_name: 'Axal VC', ...body })); return {}; },
    edit: async () => ({}),
    applicants: async () => ({ programme: prog({ owner_kind: 'hq', status: 'open' }), items: [] }),
    pick: async () => ({}),
    decline: async () => ({}),
  };
}

test('HQ approves, sends back only with a reason, and makes its own programme', async () => {
  // Mutation checked: let Send back go with an empty reason → reject is called with ''.
  const api = adminApi([prog({ status: 'submitted' }), prog({ uid: 'p2', product_name: 'Payroll beta', status: 'submitted' })]);
  const v = await mount(h(ProductTestingConsole, { api }));
  try {
    assert.ok(v.textIn('testing-waiting').includes('Ledger beta'));
    assert.ok(v.text().includes('What do you use today?'), 'the screening questions are reviewed');
    await v.click('testing-approve-p1');
    assert.deepEqual(api.calls[0], ['approve', 'p1']);
    assert.ok(v.by('testing-open-p1'), 'approved, it can now be opened');
    await v.click('testing-reject-p2');
    assert.equal(v.prop('testing-reject-send', 'disabled'), true, 'no reason, no send');
    await v.click('testing-reject-send');
    assert.equal(api.calls.length, 1);
    await v.type('testing-reject-reason', 'Add the dates');
    await v.click('testing-reject-send');
    assert.deepEqual(api.calls[1], ['reject', 'p2', 'Add the dates']);
    assert.ok(v.by('testing-waiting-empty'));
    // HQ's own.
    await v.click('testing-new-programme');
    await v.type('programme-product_name', 'Axal Mail beta');
    await v.type('programme-places', '10');
    await v.type('programme-role-investor', true);
    await v.submitForm('programme-form');
    assert.equal(api.calls[2][0], 'create');
    assert.ok(v.by('testing-applicants-hq1') && v.by('testing-open-hq1'), "HQ's own draft opens without review and has its Pick screen");
    // Mutation checked: let the waiting list take HQ's own drafts → Axal Mail beta waits for approval.
    assert.ok(v.by('testing-waiting-empty') && !v.textIn('testing-waiting').includes('Axal Mail beta'), "HQ's own never waits for approval");
  } finally { await v.unmount(); }
  const broken = await mount(h(ProductTestingConsole, { api: { ...adminApi([]), programmes: async () => { throw new Error('down'); } } }));
  try { assert.ok(broken.by('admin-console-unreadable') && broken.by('admin-console-retry')); } finally { await broken.unmount(); }
  const none = await mount(h(ProductTestingConsole, { api: adminApi([]) }));
  try { assert.ok(none.by('testing-all-empty') && none.by('testing-waiting-empty')); } finally { await none.unmount(); }
});

test('a plain admin is refused HQ › Product testing', () => {
  // Mutation checked: drop the holder gate → the console renders for a signed-out reader.
  assert.ok(renderToStaticMarkup(h(ProductTestingPanel, { api: adminApi([]) })).includes(PRODUCT_TESTING_HOLDER_ONLY));
});

test('wiring: the zone, the route, the rail key, the HQ tab and its strip', () => {
  const read = (p) => readFileSync(p, 'utf8');
  assert.match(read('frontend/src/App.jsx'), /<Route path="\/offers\/testing" element=\{guard\(\['admin', 'partner'\], <PartnerBucketRoutes \/>\)\} \/>/);
  assert.match(read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx'), /testing: \(\) => <PartnerTesting \/>/);
  assert.match(read('frontend/src/workspaces/shellConfig.js'), /\{ slug: 'testing', label: 'Product testing', archetype: A\.COLLECTION \}/);
  assert.match(read('frontend/src/lib/railPages.js'), /off\('\/offers\/testing', key\(O, 'Offers', 'Product testing'\)\)/);
  assert.match(read('frontend/src/pages/AdminPage.jsx'), /\{tab === 'product-testing' && <div data-testid="admin-product-testing-panel"><ProductTestingPanel \/><\/div>\}/);
  // No new /api method: both pages use D812's module.
  for (const f of ['frontend/src/pages/partner/offers/TestingZone.jsx', 'frontend/src/pages/admin/consoles/ProductTestingConsole.jsx']) {
    assert.match(read(f), /from '\.\.\/\.\.\/\.\.\/lib\/api\/productTesting'/);
    assert.doesNotMatch(read(f), /request\(/);
  }
});
