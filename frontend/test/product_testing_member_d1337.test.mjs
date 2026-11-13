// D1337 (#3542, part 2 of the member flow, #3517 and #2318) — Product testing
// on Studio and in Inbox: the card's six states (PT-M1), Open programmes
// (PT-M2), My applications with Withdraw behind its confirm (PT-M3), the Inbox
// opening the matching Sheet (PT-M4), and each block's empty, reading and
// unreadable states (PT-M5). Every name and figure is made up.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_member_d1337.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ProductTestingStudio from '../src/pages/testing/member/ProductTestingStudio.jsx';
import { useInboxTesting } from '../src/pages/testing/member/InboxTesting.jsx';
import NotificationList from '../src/components/NotificationList.jsx';
import {
  applicationRow, dateRange, fmtDate, joinBody, noticeTarget, programmeRow, testerCard, withdrawQuestion,
} from '../src/pages/testing/member/testerModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const CONSENT = { version: 'd1336-1', text: 'I agree that the firm running a programme I join, and Axal VC, may email me about it, and that my answers go to that firm. I can withdraw from a programme, or leave the tester pool, at any time.' };
const pool = (tester, extra = {}) => ({ tester, consent: CONSENT, can_apply: tester.status == null, cannot_apply: null, ...extra });

async function mount(el) {
  const restore = installDocument();
  const prev = { alert: globalThis.alert, confirm: globalThis.confirm };
  const popups = [];
  globalThis.alert = (...a) => popups.push(a); globalThis.confirm = (...a) => { popups.push(a); return true; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, el)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    popups, has: (id) => Boolean(by(id)), text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(), all: () => txt(container).replace(/\s+/g, ' '),
    attr: (id, k) => pr(by(id))[k],
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async clickText(t) {
      const n = walk(container).find((x) => x.tagName === 'BUTTON' && txt(x).includes(t));
      if (!n) throw new Error(`No button reads ${t}`);
      await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle();
    },
    async change(id, value, checked) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onChange?.({ target: { value, checked } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); Object.assign(globalThis, prev); restore(); },
  };
}

const PROGRAMMES = [
  { uid: 'pa', product_name: 'Product Alpha', owner_name: 'Partner Firm A', summary: 'Try onboarding and tell us where you got stuck.', tester_tasks: 'Try onboarding in the first build.', testing_starts: '2026-11-01', testing_ends: '2026-11-15', closes_at: '2026-10-31T00:00:00.000Z', places: 20, places_left: 6, questions: ['What do you use today?'], my_status: null },
];
const APPS = [
  { uid: 'a1', programme_uid: 'pa', product_name: 'Product Alpha', owner_name: 'Partner Firm A', status: 'picked', finished: false, testing_starts: '2026-11-01', testing_ends: '2026-11-15', answers: ['A checklist'], questions: ['What do you use today?'], applied_at: '2026-10-18 09:00:00', updated_at: '2026-10-20 09:00:00', withdrawn_by: null },
  { uid: 'a2', programme_uid: 'pb', product_name: 'Product Beta', owner_name: 'Partner Firm B', status: 'applied', finished: false, decides_by: '2026-10-31T00:00:00.000Z', answers: ['Android'], questions: ['Which phone?'], applied_at: '2026-10-18 09:00:00', updated_at: '2026-10-18 09:00:00', withdrawn_by: null },
  { uid: 'a3', programme_uid: 'pd', product_name: 'Product Delta', owner_name: 'Partner Firm C', status: 'declined', finished: false, updated_at: '2026-10-15 09:00:00', withdrawn_by: null },
  { uid: 'a4', programme_uid: 'pe', product_name: 'Product Epsilon', owner_name: 'Partner Firm C', status: 'withdrawn', finished: false, updated_at: '2026-10-12 09:00:00', withdrawn_by: 'hq' },
  { uid: 'a5', programme_uid: 'pz', product_name: 'Product Zeta', owner_name: 'Partner Firm B', status: 'picked', finished: true, testing_starts: '2026-09-01', testing_ends: '2026-09-30', updated_at: '2026-09-30 09:00:00', withdrawn_by: null },
];

function fakeApi({ tester = pool({ status: 'active' }), programmes = { items: PROGRAMMES, consent: { version: 'd812-1', text: 'Axal may email me about this testing programme, including whether I was picked.' } }, apps = { items: APPS }, fail = {} } = {}) {
  const calls = [];
  const go = (name, value) => async (...a) => { calls.push([name, ...a]); if (fail[name]) throw Object.assign(new Error(fail[name].message || 'Request failed'), { status: fail[name].status || 500, code: fail[name].code }); return typeof value === 'function' ? value(...a) : value; };
  return {
    calls,
    api: {
      tester: go('tester', tester), programmes: go('programmes', programmes), myApplications: go('myApplications', apps),
      joinPool: go('joinPool', () => pool({ status: 'applied', applied_at: '2026-10-28 10:00:00', consent_version: 'd1336-1', consent_current: true }, { can_apply: false })),
      leavePool: go('leavePool', () => pool({ status: 'removed', left_by_member: true, reason: 'Left by the member' }, { can_apply: true })),
      apply: go('apply', (uid) => ({ application: { uid: 'new', programme_uid: uid, product_name: 'Product Alpha', status: 'applied', answers: ['Spreadsheets'] } })),
      withdraw: go('withdraw', (uid) => ({ application: { ...APPS.find((a) => a.uid === uid), status: 'withdrawn', withdrawn_by: 'member', updated_at: '2026-10-28 10:00:00' } })),
    },
  };
}

test('PT-M1: the card in each of its six states, words from the canvas; a declined member is told when they can apply again', () => {
  assert.deepEqual(['kind', 'pill', 'title'].map((k) => testerCard(pool({ status: null }))[k]), ['none', 'New', 'Become a Product tester']);
  assert.equal(testerCard(pool({ status: null })).action.label, 'See what testers do');
  assert.equal(testerCard(pool({ status: 'applied', applied_at: '2026-10-17 08:00:00' })).text, 'You applied on 17 Oct 2026. An Axal VC admin decides, and you’re told in Inbox.');
  assert.equal(testerCard(pool({ status: 'active' })).action.label, 'See open programmes');
  assert.equal(testerCard(pool({ status: 'paused' })).text, 'You won’t be picked for new programmes. Programmes you’re already in carry on.');
  const declined = testerCard(pool({ status: 'declined', reason: 'Not enough availability this quarter.', reapply_after: '2027-01-15' }, { can_apply: false }));
  assert.deepEqual([declined.pill, declined.text, declined.action], ['Not approved', 'Reason given: “Not enough availability this quarter.” You can apply again from 15 Jan 2027.', null]);
  assert.match(testerCard(pool({ status: 'declined', reason: null, reapply_after: '2026-10-01' }, { can_apply: true })).text, /^No reason was recorded\. You can apply again now\.$/);
  const removed = testerCard(pool({ status: 'removed', left_by_member: false }));
  assert.deepEqual([removed.pill, removed.action.label], ['Removed', 'Open a ticket']);
  assert.equal(testerCard(pool({ status: 'removed', left_by_member: true }, { can_apply: true })).kind, 'left');
  assert.equal(joinBody(pool({ status: null }), { agreed: false, availability: '' }), null, 'no consent, no body');
  assert.deepEqual(joinBody(pool({ status: null }), { agreed: true, availability: '3 hours a week' }), { consentVersion: 'd1336-1', availability: '3 hours a week' });
  assert.deepEqual([fmtDate('2026-10-17'), dateRange('2026-11-01', '2026-11-15'), dateRange('2026-10-28', '2026-11-04'), dateRange(null, null)], ['17 Oct 2026', '1–15 Nov 2026', '28 Oct – 4 Nov 2026', null]);
});

test('PT-M1 mounted: not applied → the Sheet with what testers do, who can apply and the consent with its version; Apply waits for the tick, then sends the version', async () => {
  const { calls, api } = fakeApi({ tester: pool({ status: null }) });
  const m = await mount(h(ProductTestingStudio, { user: { role: 'founder' }, api }));
  try {
    assert.equal(m.attr('pt-card', 'data-kind'), 'none');
    assert.equal(m.has('pt-programmes'), false, 'no programmes for a member who is not active');
    assert.equal(calls.some(([n]) => n === 'programmes'), false, 'nor read');
    await m.click('pt-card-action');
    assert.match(m.text('pt-become'), /What testers do.*Who can apply.*Any member with a profile can apply, Explorers included\. Admin accounts can’t\./);
    assert.equal(m.text('pt-become-consent'), CONSENT.text);
    assert.match(m.text('pt-become'), /Version d1336-1/);
    assert.equal(m.attr('pt-become-apply', 'disabled'), true, 'Apply waits for consent');
    await m.change('pt-become-agree', undefined, true);
    await m.change('pt-become-availability', '2 hours a week');
    await m.click('pt-become-apply');
    assert.deepEqual(calls.find(([n]) => n === 'joinPool'), ['joinPool', { consentVersion: 'd1336-1', availability: '2 hours a week' }]);
    assert.equal(m.attr('pt-card', 'data-kind'), 'applied');
    assert.match(m.text('pt-pool-text'), /You applied on 28 Oct 2026/);
    assert.deepEqual(m.popups, []);
  } finally { await m.unmount(); }
});

test('PT-M1: an Admin sees no card and nothing is read; a 403 admin_account draws nothing either', async () => {
  const { calls, api } = fakeApi();
  const a = await mount(h(ProductTestingStudio, { user: { role: 'admin' }, api }));
  try { assert.equal(a.has('pt-studio'), false); assert.deepEqual(calls, []); } finally { await a.unmount(); }
  const viewing = fakeApi({ fail: { tester: { status: 403, code: 'admin_account' } } });
  const b = await mount(h(ProductTestingStudio, { user: { role: 'founder' }, api: viewing.api }));
  try { assert.equal(b.has('pt-studio'), false); assert.equal(b.has('pt-card'), false); } finally { await b.unmount(); }
});

test('PT-M1 mounted: Leave the tester pool asks first, in place; Stay keeps the place; Leave sends once and says picked places carry on', async () => {
  const { calls, api } = fakeApi({ tester: pool({ status: 'paused', applied_at: '2026-09-01', decided_at: '2026-10-01', consent_version: 'd1336-1', consent_current: true }), apps: { items: [] } });
  const m = await mount(h(ProductTestingStudio, { user: { role: 'investor' }, api }));
  try {
    await m.click('pt-card-action');
    await m.click('pt-pool-leave');
    assert.match(m.text('pt-leave-confirm-says'), /^Leave the tester pool\? .*Programmes you’re already in carry on\.$/);
    await m.click('pt-leave-confirm-keep');
    assert.equal(calls.some(([n]) => n === 'leavePool'), false);
    await m.click('pt-pool-leave');
    await m.click('pt-leave-confirm-go');
    assert.equal(calls.filter(([n]) => n === 'leavePool').length, 1);
    assert.ok(m.has('pt-pool-left'));
    assert.equal(m.attr('pt-card', 'data-kind'), 'left');
  } finally { await m.unmount(); }
});

test('PT-M2 mounted: an active tester reads Open programmes; a row opens the Sheet with its questions; Apply needs every answer', async () => {
  const { calls, api } = fakeApi();
  const m = await mount(h(ProductTestingStudio, { user: { role: 'founder' }, api }));
  try {
    const row = programmeRow(PROGRAMMES[0]);
    assert.deepEqual([row.product, row.firm, row.dates, row.places], ['Product Alpha', 'Partner Firm A', '1–15 Nov 2026', '6 of 20 left']);
    assert.match(m.text('pt-programmes'), /Product Alpha.*Partner Firm A.*1–15 Nov 2026.*6 of 20 left.*No other tester’s name or email is ever shown\./);
    await m.click('pt-programme-row-pa');
    assert.match(m.text('pt-programme'), /Run by Partner Firm A.*Testing 1–15 Nov 2026.*Places left 6 of 20.*What do you use today\?/);
    assert.match(m.text('pt-programme'), /Applications close 31 Oct 2026\./);
    assert.equal(m.attr('pt-programme-apply', 'disabled'), true, 'an unanswered question holds Apply');
    await m.change('pt-programme-answer-0', '  Spreadsheets  ');
    await m.click('pt-programme-apply');
    assert.deepEqual(calls.find(([n]) => n === 'apply'), ['apply', 'pa', { answers: ['Spreadsheets'], consentEmail: false }]);
    assert.ok(m.has('pt-application'), 'the new application opens');
  } finally { await m.unmount(); }
});

test('PT-M3: each status reads its own line, and Withdraw sits only on an open one', async () => {
  const lines = APPS.map((a) => { const r = applicationRow(a); return [r.pill, r.line, r.canWithdraw]; });
  assert.deepEqual(lines, [
    ['Picked', 'Testing 1–15 Nov 2026', true],
    ['Applied', 'Waiting on Partner Firm B · decides by 31 Oct 2026', true],
    ['Declined', 'Not picked this time · 15 Oct 2026', false],
    ['Withdrawn', 'Withdrawn for you by HQ · 12 Oct 2026', false],
    ['Finished', 'Programme closed · tested 1–30 Sep 2026', false],
  ]);
  assert.equal(applicationRow({ ...APPS[3], withdrawn_by: 'member' }).line, 'You withdrew · 12 Oct 2026');
  const { api } = fakeApi();
  const m = await mount(h(ProductTestingStudio, { user: { role: 'founder' }, api }));
  try {
    for (const uid of ['a1', 'a2']) assert.ok(m.has(`pt-application-withdraw-${uid}`), uid);
    for (const uid of ['a3', 'a4', 'a5']) assert.equal(m.has(`pt-application-withdraw-${uid}`), false, uid);
  } finally { await m.unmount(); }
});

test('PT-M3 mounted: Withdraw asks first with the confirm; Keep my place sends nothing; Withdraw sends once and shows the result', async () => {
  const { calls, api } = fakeApi();
  const m = await mount(h(ProductTestingStudio, { user: { role: 'founder' }, api }));
  try {
    await m.click('pt-application-row-a2');
    assert.match(m.text('pt-application'), /Applied.*Waiting on Partner Firm B.*Which phone\?.*Android.*Only Partner Firm B sees your answers\. No one sees your email\./);
    await m.click('pt-application-withdraw');
    assert.equal(m.text('pt-withdraw-confirm-says'), withdrawQuestion('Product Beta'));
    assert.equal(m.text('pt-withdraw-confirm-says'), 'Withdraw from Product Beta? The firm is told. You can’t apply to this programme again.');
    await m.click('pt-withdraw-confirm-keep');
    assert.equal(calls.some(([n]) => n === 'withdraw'), false, 'nothing before the confirm');
    await m.click('pt-application-withdraw');
    await m.click('pt-withdraw-confirm-go');
    assert.deepEqual(calls.filter(([n]) => n === 'withdraw'), [['withdraw', 'a2']]);
    assert.equal(m.text('pt-application-withdrawn'), '✓ You withdrew from Product Beta. Partner Firm B has been told.');
    assert.equal(m.text('pt-application-pill'), 'Withdrawn');
    assert.equal(m.has('pt-application-withdraw'), false, 'no second Withdraw');
    assert.equal(m.has('pt-application-apply-again'), false, 'no Apply again: one application per programme (D1336 §5)');
    assert.deepEqual(m.popups, []);
  } finally { await m.unmount(); }
});

test('PT-M5: empty, reading and unreadable each draw in their own block; one failed read costs one block', async () => {
  const empty = fakeApi({ programmes: { items: [], consent: null }, apps: { items: [] } });
  const e = await mount(h(ProductTestingStudio, { user: { role: 'founder' }, api: empty.api }));
  try {
    assert.equal(e.text('pt-programmes-empty'), 'No programmes are open right now. You’re told in Inbox when one opens.');
    assert.equal(e.text('pt-applications-empty'), 'You haven’t applied to a programme yet. Open programmes are listed above.');
  } finally { await e.unmount(); }
  const broken = fakeApi({ fail: { programmes: { status: 500 } } });
  const x = await mount(h(ProductTestingStudio, { user: { role: 'founder' }, api: broken.api }));
  try {
    assert.match(x.text('pt-programmes-unreadable'), /^Could not be read\. That isn’t the same as having none\./);
    assert.ok(x.has('pt-application-row-a1'), 'the applications still draw');
    assert.equal(x.attr('pt-card', 'data-kind'), 'active', 'and the card');
    await x.click('pt-programmes-unreadable-retry');
    assert.equal(broken.calls.filter(([n]) => n === 'programmes').length, 2, 'Try again reads again');
  } finally { await x.unmount(); }
  const cardDown = fakeApi({ fail: { tester: { status: 503 } } });
  const c = await mount(h(ProductTestingStudio, { user: { role: 'founder' }, api: cardDown.api }));
  try { assert.ok(c.has('pt-card-unreadable')); assert.ok(c.has('pt-applications'), 'the applications block still draws'); } finally { await c.unmount(); }
  const slow = { tester: () => new Promise(() => {}), myApplications: () => new Promise(() => {}), programmes: () => new Promise(() => {}) };
  const l = await mount(h(ProductTestingStudio, { user: { role: 'founder' }, api: slow }));
  try { assert.ok(l.has('pt-reading')); assert.match(l.text('pt-card'), /Reading…/); } finally { await l.unmount(); }
});

function InboxHarness({ items, api }) {
  const t = useInboxTesting(items, api);
  return h('div', null, h(NotificationList, { items, onItemClick: (n) => t.openFor(n), actionFor: t.actionFor }), t.sheet);
}

test('PT-M4: a member’s testing notice opens My application, HQ’s status notice opens the pool; the firm’s own notice opens nothing', () => {
  assert.deepEqual(noticeTarget({ type: 'testing_picked', link: '/inbox', payload: { programme_uid: 'pa' } }), { kind: 'application', programmeUid: 'pa', applicationUid: null });
  assert.deepEqual(noticeTarget({ type: 'testing_applied', link: '/inbox', payload: { programme_uid: 'pb', application_uid: 'a2' } }), { kind: 'application', programmeUid: 'pb', applicationUid: 'a2' });
  assert.equal(noticeTarget({ type: 'testing_programme_closed', link: null, payload: { programme_uid: 'pa' } }), null, 'the firm’s notice links nothing');
  assert.deepEqual(noticeTarget({ type: 'product_tester_approve', link: '/studio' }), { kind: 'pool' });
  assert.equal(noticeTarget({ type: 'contract_signed', link: '/x' }), null);
});

test('PT-M4 mounted: the Inbox opens the matching Sheet; Withdraw shows on an open application and opens the confirm', async () => {
  const { calls, api } = fakeApi();
  const items = [
    { id: 1, type: 'testing_picked', title: 'You were picked to test Product Alpha', link: '/inbox', payload: { programme_uid: 'pa' }, created_at: new Date().toISOString(), read_at: null },
    { id: 2, type: 'testing_not_picked', title: 'You were not picked to test Product Delta', link: '/inbox', payload: { programme_uid: 'pd' }, created_at: new Date().toISOString(), read_at: null },
    { id: 3, type: 'product_tester_approve', title: 'You are now an Axal product tester', link: '/studio', created_at: new Date().toISOString(), read_at: null },
  ];
  const m = await mount(h(InboxHarness, { items, api }));
  try {
    assert.ok(m.has('inbox-withdraw-1'), 'open: picked');
    assert.equal(m.has('inbox-withdraw-2'), false, 'declined: none');
    assert.equal(m.has('inbox-withdraw-3'), false);
    await m.click('inbox-withdraw-1');
    assert.equal(m.text('pt-withdraw-confirm-says'), withdrawQuestion('Product Alpha'), 'Withdraw opens the sheet at its confirm');
    await m.click('pt-withdraw-confirm-keep');
    assert.equal(calls.some(([n]) => n === 'withdraw'), false);
    await m.click('pt-application-close');
    // A click on the row itself opens the matching sheet: My application for a testing notice, the pool for HQ's.
    await m.clickText('You were not picked to test Product Delta');
    assert.equal(m.text('pt-application-pill'), 'Declined');
    assert.equal(m.has('pt-application-withdraw'), false);
    await m.click('pt-application-close');
    await m.clickText('You are now an Axal product tester');
    assert.equal(m.text('pt-pool-pill'), 'Active tester');
  } finally { await m.unmount(); }
  const down = fakeApi({ fail: { myApplications: { status: 503 } } });
  const n = await mount(h(InboxHarness, { items: items.slice(0, 1), api: down.api }));
  try {
    assert.equal(n.has('inbox-withdraw-1'), false, 'no Withdraw on what could not be read');
    await n.clickText('You were picked to test Product Alpha');
    assert.match(n.text('pt-notread-text'), /^Could not be read/);
  } finally { await n.unmount(); }
});

test('the wiring: Studio mounts the section for each member home and Explorers; Inbox routes testing notices to the sheet; house rules hold', () => {
  const dash = read('frontend/src/pages/Dashboard.jsx');
  assert.equal(dash.match(/<ProductTestingStudio user=\{authUser \|\| user\} \/>/g)?.length, 5, 'founder, investor, advisor, partner and the Lab member');
  const adminBranch = dash.slice(dash.indexOf("if (activeRole === 'admin' && authUser)"), dash.indexOf('if (loading) return ('));
  assert.doesNotMatch(adminBranch, /ProductTestingStudio/, 'Admin Studio draws no card');
  assert.match(read('frontend/src/pages/ExploringDashboard.jsx'), /<ProductTestingStudio user=\{user\} \/>/);
  const inbox = read('frontend/src/pages/InboxPage.jsx');
  assert.match(inbox, /if \(testing\.openFor\(n\)\) return;\n\s+if \(n\.link\) navigate\(n\.link\);/);
  assert.match(inbox, /actionFor=\{testing\.actionFor\}/);
  for (const f of ['ProductTestingStudio.jsx', 'TesterSheets.jsx', 'InboxTesting.jsx', 'testerModel.js']) {
    const src = read(`frontend/src/pages/testing/member/${f}`);
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/, `${f}: no pop-up`);
    assert.doesNotMatch(src, /(bg|text|border)-\[#/, `${f}: no raw hex`);
    assert.doesNotMatch(src, /\bemail\b\s*[:}]/, `${f}: reads no email field`);
    if (f.endsWith('.jsx')) {
      assert.match(src, /dark:/, `${f}: dark mode`);
      assert.match(src, /min-h-11/, `${f}: 44px targets on a phone`);
    }
  }
  assert.match(read('documentation/architecture/decisions/D1337.md'), /^## D1337/);
});
