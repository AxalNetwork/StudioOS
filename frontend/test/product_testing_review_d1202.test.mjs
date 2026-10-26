/**
 * D1202 (#3152, part 7 of #2382) — HQ › Product testing's Review (TST2) and
 * Programs (TST4), the New program lightbox (TST7) and the dialogs A–I (TST3).
 * Stubbed APIs only.
 *
 * What these prove:
 *   · The ⋯ menu holds only the steps the Worker allows, per owner and status.
 *   · Each dialog says what it changes, who is told and what is recorded, makes
 *     its one request only on its button, and draws a refusal inside itself in
 *     the Worker's words (I). Never a browser pop-up.
 *   · Who was told comes back as counts only; no screen carries an email address.
 *   · Programs' search, filters, sort and pager; Review's full cards with the
 *     firm's earlier programmes and the last send-back, or why it is not shown.
 *   · New program opens over Programs from the header (?new=1), with the logo,
 *     which is uploaded once the programme has its uid.
 *   · HQ can withdraw an application (H); a partner cannot.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_review_d1202.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  FULL, PAGE_SIZE, dialogFor, earlierLine, fieldReady, menuFor, programsView, rowFigures, sentBackLine, statusChips, toldLine,
} from '../src/pages/admin/productTesting/reviewModel.js';
import { logoProblem } from '../src/pages/testing/ProgrammeForm.jsx';
import ProgrammeApplicants from '../src/pages/testing/ProgrammeApplicants.jsx';
import { ProductTestingConsole } from '../src/pages/admin/consoles/ProductTestingConsole.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const prog = (over = {}) => ({
  uid: 'p1', owner_kind: 'partner', owner_name: 'Acme Labs', product_name: 'Ledger beta', status: 'open',
  places: 4, picked_count: 1, applicant_count: 3, eligible_roles: ['founder'], questions: ['What do you use today?'],
  opens_at: '2026-11-01', closes_at: '2026-11-20', testing_starts: null, testing_ends: null, review_note: null,
  updated_at: '2026-10-20 09:00:00', ...over,
});
const keys = (p) => menuFor(p).map((i) => i.key);

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the ⋯ menu: only the steps the Worker allows, by owner and status', () => {
  const hq = { owner_kind: 'hq', owner_name: null };
  // Mutation checked: give a partner's draft Edit… → ['edit', 'history'].
  assert.deepEqual(keys(prog({ status: 'draft' })), ['history'], "a partner's draft is the firm's to edit");
  assert.deepEqual(keys(prog({ status: 'draft', ...hq })), ['edit', 'open', 'history']);
  assert.deepEqual(keys(prog({ status: 'submitted' })), ['approve', 'reject', 'history']);
  assert.deepEqual(keys(prog({ status: 'approved' })), ['open', 'history']);
  // Mutation checked: offer Move to testing on a testing programme → the menu gains 'testing'.
  assert.deepEqual(keys(prog({ status: 'open' })), ['program', 'close', 'testing', 'history']);
  assert.deepEqual(keys(prog({ status: 'closed' })), ['program', 'testing', 'history']);
  assert.deepEqual(keys(prog({ status: 'testing' })), ['program', 'close', 'history']);
  assert.deepEqual(keys(prog({ status: 'rejected' })), ['history']);
  assert.equal(menuFor(prog({ uid: 'a b' })).at(-1).to, '/admin/platform/product-testing/programs/a%20b?tab=activity');
  assert.deepEqual(menuFor(null), []);
});

test('each dialog says what it changes, who is told and what is recorded, and makes one request', async () => {
  const calls = [];
  const api = new Proxy({}, { get: (_t, k) => async (...a) => { calls.push([k, ...a]); return {}; } });
  const p = prog();
  const a = { uid: 'a1', name: 'Fran Ruiz' };
  const run = async (kind, ctx, value) => { const s = dialogFor(kind, ctx); await s.call(api, ctx, value); return s; };

  const A = await run('approve', { p }, '');
  assert.deepEqual([A.key, A.title, A.confirm], ['A', 'Approve Ledger beta from Acme Labs?', 'Approve']);
  assert.match(A.rows[0].t, /Acme Labs is told in their bell\. It is recorded/);
  const B = await run('reject', { p }, 'Add the dates');
  assert.equal(B.field.required, true);
  const C = await run('open', { p });
  assert.match(C.lead, /Applications close on 20 Nov 2026\./);
  assert.deepEqual(C.rows.map((r) => [r.t, !!r.nw]), [['Acme Labs is told.', true], ['It is recorded in the program’s history.', false]]);
  // Mutation checked: tell the owner of HQ's own programme → "Axal VC is told." on HQ's Open.
  assert.equal(dialogFor('open', { p: prog({ owner_kind: 'hq' }) }).rows[0].t, 'No one else is told: it is Axal VC’s own program.');
  assert.match(dialogFor('open', { p: prog({ closes_at: null }) }).lead, /No closing date is set\./);
  await run('close', { p });
  const E = await run('testing', { p });
  assert.equal(E.rows[0].t, 'Acme Labs and the picked testers are told.');
  const F = await run('pick', { p, a });
  assert.deepEqual([F.key, F.lead, F.refusal], ['F', '2 of 4 places will be filled.', null]);
  await run('decline', { p, a });
  const H = await run('withdraw', { p, a }, 'They asked to leave the programme.');
  assert.deepEqual([H.key, H.danger, H.field.min, H.field.max], ['H', true, 10, 500]);
  assert.deepEqual(calls, [
    ['approve', 'p1', null], ['reject', 'p1', 'Add the dates'], ['open', 'p1'], ['close', 'p1'], ['startTesting', 'p1'],
    ['pick', 'a1'], ['decline', 'a1'], ['withdraw', 'a1', 'They asked to leave the programme.'],
  ]);
  // I · a full programme's Pick shows the Worker's own sentence before any request.
  // Mutation checked: compare picked > places → a full programme's Pick has no refusal.
  assert.equal(dialogFor('pick', { p: prog({ places: 2, picked_count: 2 }), a }).refusal, FULL);
  assert.equal(FULL, 'Every place is taken. Decline someone first.');
  assert.match(read('cloudflare-worker/src/services/testing.ts'), /'programme_full', 'Every place is taken\. Decline someone first\.'/);
  assert.equal(dialogFor('pick', { p: prog({ places: null }), a }).lead, 'Places are not recorded for this program.');
  assert.equal(dialogFor('nope', { p }), null);
});

test('a field holds what its button needs; who was told is counts only', () => {
  const H = dialogFor('withdraw', { p: prog(), a: { uid: 'a1' } });
  // Mutation checked: drop the min → a nine-character reason is accepted.
  assert.deepEqual([fieldReady(H, 'Too short'), fieldReady(H, 'Long enough.'), fieldReady(H, 'x'.repeat(501))], [false, true, false]);
  assert.equal(fieldReady(dialogFor('reject', { p: prog() }), '   '), false);
  assert.equal(fieldReady(dialogFor('approve', { p: prog() }), ''), true, "Approve's note is optional");
  assert.equal(fieldReady(dialogFor('open', { p: prog() }), ''), true);
  // Mutation checked: treat null as 0 → "0 at the firm told" for HQ's own programme.
  assert.equal(toldLine({ owner: null, testers: 3, mail_reach: 2 }), '3 picked testers told · Axal VC Mail can reach 2.');
  assert.equal(toldLine({ owner: 1, testers: 1 }), '1 at the firm told · 1 picked tester told.');
  assert.equal(toldLine({ member: false }), 'The member’s bell did not take the notice.');
  assert.equal(toldLine(undefined), null);
  assert.equal(toldLine({ owner_email: 'x@example.com' }), null, 'nothing but counts is drawn');
});

test('Programs: search, status, owner and firm, role, places, closing window, sort and pages', () => {
  const items = [
    prog({ uid: 'a', product_name: 'Alpha', updated_at: '2026-10-01 10:00:00', closes_at: '2026-10-29' }),
    prog({ uid: 'b', product_name: 'Bravo', owner_kind: 'hq', owner_name: null, places: 2, picked_count: 2, updated_at: '2026-10-05 10:00:00', closes_at: null }),
    prog({ uid: 'c', product_name: 'Charlie', owner_name: 'Zed Co', status: 'draft', eligible_roles: ['investor'], updated_at: '2026-10-03 10:00:00', closes_at: '2026-10-01' }),
  ];
  const today = '2026-10-26';
  const uids = (f) => programsView(items, f, today).rows.map((p) => p.uid);
  assert.deepEqual(uids({}), ['b', 'c', 'a'], 'newest change first');
  assert.deepEqual(uids({ sort: 'name' }), ['a', 'b', 'c']);
  assert.deepEqual(uids({ sort: 'closes' }), ['c', 'a', 'b'], 'no closing date sorts last');
  assert.deepEqual(uids({ q: 'zed' }), ['c'], 'search reads the firm too');
  assert.deepEqual(uids({ q: 'axal' }), ['b'], "HQ's own reads as Axal VC");
  assert.deepEqual(uids({ status: 'draft' }), ['c']);
  assert.deepEqual(uids({ owner: 'hq' }), ['b']);
  assert.deepEqual(uids({ owner: 'partner', firm: 'Acme Labs' }), ['a']);
  assert.deepEqual(uids({ role: 'investor' }), ['c']);
  assert.deepEqual(uids({ places: 'full' }), ['b']);
  assert.deepEqual(uids({ places: 'not_full' }), ['c', 'a']);
  // Mutation checked: let a missing date fall in every window → Bravo closes "in the next 7 days".
  assert.deepEqual(uids({ closes: '7' }), ['a']);
  assert.deepEqual(uids({ closes: 'past' }), ['c']);
  const many = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => prog({ uid: `m${i}`, updated_at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')} 09:00:00` }));
  const p2 = programsView(many, { page: 2 }, today);
  assert.deepEqual([p2.page, p2.pages, p2.rows.length, p2.count], [2, 2, 3, `26–28 of ${PAGE_SIZE + 3}`]);
  assert.equal(programsView(many, { page: 9 }, today).page, 2, 'a page past the end is the last');
  assert.equal(programsView(items, { q: 'none' }, today).count, '0 of 3');
  assert.deepEqual(statusChips(items).slice(0, 3).map((c) => c.label), ['All 3', 'Waiting for HQ 0', 'Sent back 0']);
  // Never a zero for a figure that is not there yet.
  assert.deepEqual(Object.values((({ places, applicants }) => ({ places, applicants }))(rowFigures(prog({ status: 'draft' })))), ['4 places', 'Not open yet']);
  assert.equal(rowFigures(prog({ places: null })).places, 'Places not recorded');
  assert.equal(rowFigures(prog({ updated_at: null })).changed, 'Not recorded');
});

test("Review's lines: the firm's earlier programmes, and the last send-back or why it is not shown", () => {
  const p = prog({ uid: 'x', status: 'submitted' });
  const items = [p, prog({ uid: 'y', status: 'closed' }), prog({ uid: 'z', status: 'closed' }), prog({ uid: 'w', status: 'open' }), prog({ uid: 'v', status: 'draft' }), prog({ uid: 'o', owner_name: 'Other', status: 'closed' })];
  // Mutation checked: drop the same-firm check → Other's closed programme makes it "3 closed".
  assert.equal(earlierLine(p, items), 'Partner firm’s earlier programs: 2 closed, 1 open.');
  assert.equal(earlierLine(p, [p]), 'Partner firm’s earlier programs: none yet.');
  assert.equal(earlierLine(prog({ owner_kind: 'hq' }), items), null);
  assert.equal(sentBackLine(undefined), null);
  // Mutation checked: read a failed history as an empty one → "Last sent back: never." on a read that failed.
  assert.match(sentBackLine(false), /could not be read/);
  assert.equal(sentBackLine([]), 'Last sent back: never.');
  assert.equal(sentBackLine([{ action: 'rejected', at: '2026-09-02 10:00:00' }, { action: 'rejected', at: '2026-10-18 10:00:00' }, { action: 'approved', at: '2026-10-19' }]), 'Last sent back: 18 Oct 2026.');
});

test('the logo is a PNG or an SVG of at most 256 KB, in the Worker\'s words', () => {
  assert.equal(logoProblem(null), null);
  assert.equal(logoProblem({ name: 'l.png', type: 'image/png', size: 2048 }), null);
  assert.equal(logoProblem({ name: 'l.svg', type: '', size: 2048 }), null);
  assert.equal(logoProblem({ name: 'l.jpg', type: 'image/jpeg', size: 2048 }), 'A logo is a PNG or an SVG file.');
  // Mutation checked: allow LOGO_MAX_BYTES + 1 → a file one byte over passes.
  assert.equal(logoProblem({ name: 'l.png', type: 'image/png', size: 256 * 1024 + 1 }), 'A logo is at most 256 KB.');
  const worker = read('cloudflare-worker/src/services/testingLogo.ts');
  assert.match(worker, /LOGO_MAX_BYTES = 256 \* 1024/);
  assert.match(worker, /'A logo is a PNG or an SVG file\.'/);
});

/* ------------------------------------------------------------------ *
 * The screens
 * ------------------------------------------------------------------ */

async function mount(element, { url = '/' } = {}) {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.window.addEventListener = () => {};
  globalThis.window.removeEventListener = () => {};
  // Never a browser pop-up: any of these fails the test.
  const popups = {};
  for (const k of ['confirm', 'alert', 'prompt']) { popups[k] = globalThis.window[k]; globalThis.window[k] = () => { throw new Error(`window.${k} was called`); }; }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element })))); });
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const fire = async (id, name, arg) => {
    const n = by(id);
    if (!n) throw new Error(`Missing ${id}`);
    await act(async () => { await props(n)[name]?.(arg); });
    await settle();
  };
  return {
    by,
    ids: () => walk(container).map((n) => props(n)['data-testid']).filter(Boolean),
    text: () => textOf(container).replace(/\s+/g, ' '),
    textIn: (id) => { const n = by(id); return n ? textOf(n).replace(/\s+/g, ' ').trim() : null; },
    prop: (id, name) => props(by(id) || {})[name],
    click: (id) => fire(id, 'onClick', { preventDefault() {}, stopPropagation() {} }),
    type: (id, value) => fire(id, 'onChange', { target: { value } }),
    choose: (id, files) => fire(id, 'onChange', { target: { files } }),
    submit: (id) => fire(id, 'onSubmit', { preventDefault() {} }),
    async unmount() {
      await act(async () => root.unmount());
      for (const [k, f] of Object.entries(popups)) globalThis.window[k] = f;
      restoreDoc();
    },
  };
}

function adminApi(items, over = {}) {
  const calls = [];
  const list = items.map((p) => ({ ...p }));
  const set = (uid, status) => Object.assign(list.find((p) => p.uid === uid), { status });
  return {
    calls,
    programmes: async () => ({ items: list.map((p) => ({ ...p })) }),
    approve: async (uid, note) => { calls.push(['approve', uid, note]); set(uid, 'approved'); return {}; },
    reject: async (uid, note) => { calls.push(['reject', uid, note]); set(uid, 'rejected'); return {}; },
    open: async (uid) => { calls.push(['open', uid]); set(uid, 'open'); return { told: { owner: 1 } }; },
    close: async (uid) => { calls.push(['close', uid]); set(uid, 'closed'); return { told: { owner: 1 } }; },
    startTesting: async (uid) => { calls.push(['startTesting', uid]); set(uid, 'testing'); return { told: { owner: 1, testers: 2, mail_reach: 1 } }; },
    create: async (body) => { calls.push(['create', body.product_name]); list.push(prog({ ...body, uid: 'new1', owner_kind: 'hq', owner_name: null, status: 'draft' })); return { programme: { uid: 'new1' } }; },
    edit: async (uid) => { calls.push(['edit', uid]); return { programme: { uid } }; },
    uploadLogo: async (uid, file) => { calls.push(['uploadLogo', uid, file.name]); return {}; },
    removeLogo: async (uid) => { calls.push(['removeLogo', uid]); return {}; },
    events: async () => ({ events: { available: true, items: [{ action: 'rejected', at: '2026-10-18 10:00:00' }] } }),
    ...over,
  };
}

test('Programs: chips, search and a ⋯ menu per row, each step through its dialog, who was told in counts', async () => {
  const api = adminApi([
    prog({ uid: 'p1', product_name: 'Ledger beta', status: 'open', owner_email: 'owner@example.com' }),
    prog({ uid: 'p2', product_name: 'Payroll beta', status: 'closed', updated_at: '2026-10-01 09:00:00' }),
    prog({ uid: 'p3', product_name: 'Axal Mail beta', owner_kind: 'hq', owner_name: null, status: 'draft', updated_at: '2026-10-02 09:00:00' }),
  ]);
  const v = await mount(h(ProductTestingConsole, { api, view: 'programs' }));
  try {
    assert.ok(v.by('testing-table'));
    assert.equal(v.textIn('testing-chip-all'), 'All 3');
    assert.equal(v.textIn('testing-count'), '1–3 of 3');
    assert.ok(!/@/.test(v.text()), 'no email address on Programs');
    await v.type('testing-search', 'payroll');
    assert.ok(v.by('testing-programme-p2') && !v.by('testing-programme-p1'));
    await v.type('testing-search', 'nothing like it');
    assert.ok(v.by('testing-none-match'));
    await v.type('testing-search', '');
    await v.click('testing-chip-draft');
    assert.ok(v.by('testing-programme-p3') && !v.by('testing-programme-p2'));
    await v.click('testing-chip-all');

    // The ⋯ menu draws only what applies; Move to testing opens E and sends nothing yet.
    await v.click('testing-menu-p1');
    assert.ok(v.by('testing-menu-p1-close') && v.by('testing-menu-p1-testing') && !v.by('testing-menu-p1-approve'));
    await v.click('testing-menu-p1-testing');
    assert.ok(v.by('testing-dialog-E'));
    assert.equal(api.calls.length, 0, 'a dialog sends nothing until its button');
    assert.ok(v.textIn('testing-dialog-rows').includes('New'), "what D1198 made new is marked");
    await v.click('testing-dialog-confirm');
    assert.deepEqual(api.calls, [['startTesting', 'p1']]);
    assert.ok(!v.by('testing-dialog-E'));
    // Mutation checked: drop toldLine from onDone → the notice has no counts.
    assert.equal(v.textIn('testing-notice'), 'Ledger beta is testing now. 1 at the firm told · 2 picked testers told · Axal VC Mail can reach 1.');

    // Cancel sends nothing.
    await v.click('testing-menu-p2');
    await v.click('testing-menu-p2-testing');
    await v.click('testing-dialog-cancel');
    assert.equal(api.calls.length, 1);
    assert.ok(!v.by('testing-dialog-E'));
  } finally { await v.unmount(); }
});

test('I · a refusal is drawn inside the dialog in the Worker\'s words, and the dialog stays open', async () => {
  const refused = Object.assign(new Error('This programme cannot move to testing now.'), { status: 409, code: 'not_testable' });
  const api = adminApi([prog({ uid: 'p1', status: 'closed' })], { startTesting: async () => { throw refused; } });
  const v = await mount(h(ProductTestingConsole, { api, view: 'programs' }));
  try {
    await v.click('testing-menu-p1');
    await v.click('testing-menu-p1-testing');
    await v.click('testing-dialog-confirm');
    assert.equal(v.textIn('testing-dialog-refusal'), 'This programme cannot move to testing now.');
    assert.ok(v.by('testing-dialog-E') && !v.text().includes('not_testable') && !v.by('testing-notice'));
  } finally { await v.unmount(); }
});

test('Review: full cards with the firm\'s earlier programmes and the last send-back; an unreadable history says so', async () => {
  const items = [
    prog({ uid: 'w1', product_name: 'Ledger beta', status: 'submitted', summary: 'A ledger.', logo_key: 'testing/w1.png' }),
    prog({ uid: 'e1', status: 'closed' }),
  ];
  const api = adminApi(items);
  const v = await mount(h(ProductTestingConsole, { api, view: 'review' }));
  try {
    assert.equal(v.textIn('testing-earlier-w1'), 'Partner firm’s earlier programs: 1 closed. Last sent back: 18 Oct 2026.');
    assert.ok(v.textIn('testing-programme-w1').includes('A ledger.') && v.textIn('testing-programme-w1').includes('What do you use today?'));
    await v.click('testing-review-menu-w1');
    assert.ok(v.by('testing-review-menu-w1-approve') && v.by('testing-review-menu-w1-history'));
    await v.click('testing-reject-w1');
    assert.equal(v.prop('testing-dialog-confirm', 'disabled'), true, 'no note, no send');
    await v.type('testing-dialog-field', 'Say what to install.');
    await v.click('testing-dialog-confirm');
    assert.deepEqual(api.calls, [['reject', 'w1', 'Say what to install.']]);
  } finally { await v.unmount(); }
  const down = await mount(h(ProductTestingConsole, { api: adminApi(items, { events: async () => { throw new Error('down'); } }), view: 'review' }));
  try {
    assert.match(down.textIn('testing-earlier-w1'), /could not be read/);
    assert.ok(!down.textIn('testing-earlier-w1').includes('never'));
  } finally { await down.unmount(); }
});

test('New program: the header opens it over Programs, with the logo uploaded once the programme has its uid', async () => {
  const api = adminApi([]);
  const v = await mount(h(ProductTestingConsole, { api, view: 'programs' }), { url: '/admin/platform/product-testing/programs?new=1' });
  try {
    assert.ok(v.by('testing-form-dialog') && v.by('programme-logo-file'));
    await v.choose('programme-logo-file', [{ name: 'logo.jpg', type: 'image/jpeg', size: 10 }]);
    assert.ok(v.text().includes('A logo is a PNG or an SVG file.'));
    await v.choose('programme-logo-file', [{ name: 'logo.png', type: 'image/png', size: 2048 }]);
    await v.type('programme-product_name', 'Axal Mail beta');
    await v.type('programme-places', '10');
    await v.type('programme-role-investor', true);
    await v.submit('programme-form');
    // Mutation checked: skip the upload after save → only create is called.
    assert.deepEqual(api.calls, [['create', 'Axal Mail beta'], ['uploadLogo', 'new1', 'logo.png']]);
    assert.ok(!v.by('testing-form-dialog'));
    assert.match(v.textIn('testing-notice'), /Axal Mail beta is saved as a draft/);
  } finally { await v.unmount(); }
  // A logo the Worker refuses: the programme is saved, and the notice says why the logo is not.
  const bad = adminApi([], { uploadLogo: async () => { throw new Error('The logo must be square.'); } });
  const w = await mount(h(ProductTestingConsole, { api: bad, view: 'programs' }), { url: '/admin/platform/product-testing/programs?new=1' });
  try {
    await w.choose('programme-logo-file', [{ name: 'logo.png', type: 'image/png', size: 2048 }]);
    await w.type('programme-product_name', 'Axal Mail beta');
    await w.type('programme-places', '10');
    await w.type('programme-role-investor', true);
    await w.submit('programme-form');
    assert.match(w.textIn('testing-notice'), /The logo was not saved: The logo must be square\./);
  } finally { await w.unmount(); }
  // Review never opens the form.
  const r = await mount(h(ProductTestingConsole, { api: adminApi([]), view: 'review' }), { url: '/admin/platform/product-testing/review?new=1' });
  try { assert.ok(!r.by('testing-form-dialog')); } finally { await r.unmount(); }
});

test('H · HQ withdraws an application with a reason; a partner has no Withdraw', async () => {
  const calls = [];
  const base = {
    applicants: async () => ({ programme: prog({ status: 'open' }), items: [{ uid: 'a1', name: 'Fran Ruiz', role: 'founder', status: 'picked', answers: [] }] }),
    pick: async () => ({}), decline: async () => ({}),
  };
  const hq = await mount(h(ProgrammeApplicants, { uid: 'p1', api: { ...base, withdraw: async (uid, reason) => { calls.push([uid, reason]); return { told: { member: true } }; } } }));
  try {
    await hq.click('applicant-withdraw-a1');
    assert.ok(hq.by('testing-dialog-H'));
    await hq.type('testing-dialog-field', 'Too short');
    assert.equal(hq.prop('testing-dialog-confirm', 'disabled'), true);
    await hq.type('testing-dialog-field', 'They asked to leave the programme.');
    await hq.click('testing-dialog-confirm');
    assert.deepEqual(calls, [['a1', 'They asked to leave the programme.']]);
    assert.equal(hq.textIn('applicants-notice'), 'Fran Ruiz’s application is withdrawn. The member was told.');
  } finally { await hq.unmount(); }
  const partner = await mount(h(ProgrammeApplicants, { uid: 'p1', api: base }));
  try { assert.ok(!partner.by('applicant-withdraw-a1') && partner.by('applicant-decline-a1')); } finally { await partner.unmount(); }
  // D1203 (#3153): the one-program page draws its own table; HQ's own rows open Withdraw (H) with the page's full api.
  assert.match(read('frontend/src/pages/admin/productTesting/ProductTestingTabs.jsx'), /setAsking\(\{ kind: 'withdraw', a: r\.raw \}\)/);
});

test('wiring: the header action, no browser pop-up, no new /api method', () => {
  assert.match(read('frontend/src/pages/admin/ConsolePages.jsx'), /to="\/admin\/platform\/product-testing\/programs\?new=1"[\s\S]*?data-testid="testing-new-programme"/);
  for (const f of [
    'frontend/src/pages/admin/consoles/ProductTestingConsole.jsx', 'frontend/src/pages/admin/productTesting/TestingDialog.jsx',
    'frontend/src/pages/admin/productTesting/reviewModel.js', 'frontend/src/pages/testing/ProgrammeApplicants.jsx', 'frontend/src/pages/testing/ProgrammeForm.jsx',
  ]) {
    const src = read(f);
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)|\b(alert|prompt)\(/, f);
    assert.doesNotMatch(src, /request\(/, f);
  }
});
