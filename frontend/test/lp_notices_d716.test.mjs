/**
 * D716 (#1860) — the LP's notices on the LP workspace.
 *
 *   · the list: titles, amounts, due and cure dates, the Superseded pill and
 *     the changed-instructions line, empty and failed states, 44 px rows;
 *   · a capital-call notice opens on the amount and the due date, then its
 *     frozen tables; the masked block opens only after the tick and "Show
 *     wire instructions", and is drawn by whitelist;
 *   · the check is not offered on a superseded, changed or paid notice, nor
 *     on a distribution; a refused block says its sentence;
 *   · the PDF is fetched only on tap;
 *   · no long digit run before the check, and no full number ever;
 *   · the client is wired and nothing is stored.
 *
 * Every figure is synthetic. The routing numbers are the D716 Worker test's.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lp_notices_d716.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoticeDetail, NoticeList, openNoticePdf } from '../src/pages/SpinoutLabLpNotices.jsx';
import { fundNoticesApi } from '../src/lib/api/fundNotices.js';
import { PHONE_CHECK } from '../src/lib/lpWireGate.js';
import {
  NOTICE_COPY, gateReducer, initialGate, instructionsOffer, lineSettled, paymentRows,
} from '../src/lib/lpNoticesModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
// One pass, so an escaped ampersand is never decoded a second time.
const ENTITIES = { '&#x27;': "'", '&amp;': '&', '&quot;': '"' };
const unescape = (h) => h.replace(/&#x27;|&amp;|&quot;/g, (e) => ENTITIES[e]);
const html = (el) => unescape(renderToStaticMarkup(el));

const PLANTED = '987654321098';
const ACCOUNT_UID = 'acct-planted-uid';
const PAYMENT = {
  lines: [
    { label: 'Beneficiary', value: 'Axal VC Spin-Out Lab Fund I LP' },
    { label: 'Beneficiary address', value: '1 Example Way' },
    { label: 'Bank', value: 'Column N.A.' },
    { label: 'Bank address', value: '2 Example Way' },
    { label: 'Routing number (ABA)', value: '121145433', mono: true },
    { label: 'Alternate routing number', value: '121145307', mono: true },
    { label: 'Account', value: 'ending 6677', mono: true },
    { label: 'Full account number', value: 'The full account number is shown in your LP workspace, after you confirm these details by phone.' },
  ],
  reference: 'AXAL-CC-10-L101-11',
  account_uid: ACCOUNT_UID,
  account_last4: '6677',
  account_number: PLANTED,
};
const CALL = {
  uid: 'notice-call-a', type: 'capital_call_notice', title: 'Capital Call Notice', reference: 'AXAL-CC-10-L101-11',
  amount_cents: 25000, fund_id: 10, limited_partner_id: 101, notice_date: '2026-10-18', superseded: false,
  instructions_changed: false, call_number: '1', due_date: '2026-11-15',
  figures: {
    type: 'capital_call_notice', title: 'Capital Call Notice', notice_date: '2026-10-18', source_ref: 'call_line:11',
    key_figures: [
      { label: 'Notice date', value: '2026-10-18' }, { label: 'Call number', value: '1' },
      { label: 'Amount due', value: '$250.00', mono: true }, { label: 'Due date', value: '2026-11-15' },
    ],
    tables: [
      { title: 'This call', columns: [{ label: 'Purpose' }, { label: 'Amount' }], rows: [['Investment in Acme', '$250.00']] },
      { title: 'Your commitment', columns: [{ label: 'Item' }, { label: 'Amount' }], rows: [
        ['Commitment', '$1,000.00'], ['Called to date, including this call', '$250.00'], ['This call', '$250.00'], ['Unfunded after this call', '$750.00'],
      ] },
    ],
    payment: PAYMENT, reference: 'AXAL-CC-10-L101-11', amount_cents: 25000,
  },
};
const DEFAULT = {
  uid: 'notice-default-b', type: 'default_notice', title: 'Notice of Default', amount_cents: 25000, limited_partner_id: 101,
  notice_date: '2026-10-18', superseded: false, instructions_changed: false, call_number: '1', due_date: '2099-06-30',
  figures: {
    type: 'default_notice', notice_date: '2026-10-18', source_ref: 'call_line:11',
    key_figures: [{ label: 'Cure date', value: '2099-06-30' }, { label: 'LPA section', value: 'Section 3.4' }],
    tables: [], payment: PAYMENT,
  },
};
const DIST = {
  uid: 'notice-dist-c', type: 'distribution_notice', title: 'Distribution Notice', amount_cents: 5000, limited_partner_id: 101,
  notice_date: '2026-09-15', superseded: false, instructions_changed: false, call_number: null, due_date: null,
  figures: { type: 'distribution_notice', notice_date: '2026-09-15', source_ref: 'distribution:41', key_figures: [{ label: 'Amount', value: '$50.00', mono: true }], tables: [], payment: null },
};
const SUPERSEDED = { ...CALL, uid: 'notice-old-d', superseded: true };
const CHANGED = { ...CALL, uid: 'notice-changed-e', instructions_changed: true };

const minHeights = (s) => [...s.matchAll(/min-h-\[(\d+)px\]/g)].map((m) => Number(m[1]));
const list = (notices, opening = null) => html(React.createElement(NoticeList, { notices, onOpen() {}, opening }));
const detail = (notice, gate, portal = null) => html(React.createElement(NoticeDetail, { notice, portal, gate, dispatch() {}, pdf: {}, onPdf() {}, onBack() {} }));
const CLOSED = { ticked: false, shown: false };
const TICKED = { ticked: true, shown: false };
const OPEN = { ticked: true, shown: true };

test('the list draws each notice: title, amount, due or cure date, the pill and the changed line', () => {
  const h = list([CALL, DEFAULT, DIST, SUPERSEDED, CHANGED]);
  for (const s of ['Capital Call No. 1', '$250.00', 'Due 2026-11-15 · Dated 2026-10-18', 'Notice of Default', 'Cure by 2099-06-30 · Dated 2026-10-18', 'Distribution Notice', 'Dated 2026-09-15']) {
    assert.ok(h.includes(s), `missing ${s}`);
  }
  assert.ok(!h.includes('Distribution Notice</span></span><span class="block text-[12px] text-gray-500 dark:text-gray-400">Due'), 'a distribution has no due date');
  assert.equal(h.split(NOTICE_COPY.supersededPill).length - 1, 1, 'one Superseded pill');
  assert.equal(h.split(NOTICE_COPY.changed).length - 1, 1, 'the changed line on the changed notice only');
  const rows = [...h.matchAll(/<button[^>]*class="([^"]*)"[^>]*data-testid="notice-row-\d+"/g)];
  assert.equal(rows.length, 5);
  for (const [, cls] of rows) {
    const n = Number(cls.match(/min-h-\[(\d+)px\]/)?.[1]);
    assert.ok(n >= 44, `a row is ${n}px`);
  }
  assert.match(list([CALL], 0), /Opening…/);
  assert.match(list([]), new RegExp(NOTICE_COPY.empty));
});

test('a failed list read is Unreadable, with its claim', async () => {
  const { MyNotices } = await import('../src/pages/SpinoutLabLpNotices.jsx');
  const src = read('frontend/src/pages/SpinoutLabLpNotices.jsx');
  assert.match(src, /<Unreadable what="Your notices" claim="This is not a claim that no notice was issued to you\." onRetry=\{reload\} \/>/);
  assert.equal(typeof MyNotices, 'function');
});

test('a capital-call notice opens on the amount and the due date, then its frozen tables', () => {
  const h = detail(CALL, CLOSED);
  const at = (s) => { const i = h.indexOf(s); assert.ok(i >= 0, `missing ${s}`); return i; };
  assert.ok(at('‹ Capital Call No. 1') < at('Amount due'));
  assert.ok(h.includes('>PDF<'));
  assert.ok(at('Amount due') < at('$250.00'));
  assert.ok(at('$250.00') < at('Due 2026-11-15 · LP no. L101'));
  assert.ok(at('Due 2026-11-15 · LP no. L101') < at('This call'));
  assert.ok(at('This call') < at('Your commitment'));
  assert.ok(at('Your commitment') < at(PHONE_CHECK));
  for (const s of ['Investment in Acme', 'Unfunded after this call', '$750.00', 'Notice date 2026-10-18', NOTICE_COPY.pdfLine]) assert.ok(h.includes(s), s);
});

test('the gate opens the block only after the tick and "Show wire instructions"', () => {
  let s = initialGate();
  assert.equal(gateReducer(s, { type: 'show' }), s, 'show without a tick stays closed');
  s = gateReducer(s, { type: 'tick', value: true });
  s = gateReducer(s, { type: 'show' });
  assert.deepEqual(s, { ticked: true, shown: true });
  assert.deepEqual(gateReducer(s, { type: 'tick', value: false }), { ticked: false, shown: false });
  assert.deepEqual(gateReducer(s, { type: 'reset' }), initialGate());

  const closed = detail(CALL, CLOSED);
  assert.ok(closed.includes(PHONE_CHECK), 'the warning, word for word');
  const label = closed.match(/<label class="([^"]*)"[^>]*>(.*?)<\/label>/);
  assert.ok(label && /type="checkbox"/.test(label[2]) && /I confirmed by phone/.test(label[2]));
  assert.ok(Number(label[1].match(/min-h-\[(\d+)px\]/)?.[1]) >= 44);
  assert.match(closed, /<button[^>]*disabled=""[^>]*>Show wire instructions/);
  for (const s of ['Routing number', 'ending 6677', 'AXAL-CC-10-L101-11']) assert.ok(!closed.includes(s), `the closed gate shows ${s}`);

  const ticked = detail(CALL, TICKED);
  assert.doesNotMatch(ticked, /<button[^>]*disabled=""[^>]*>Show wire instructions/);
  assert.ok(ticked.includes('Show wire instructions'));
  assert.ok(!ticked.includes('ending 6677'), 'ticked alone does not open the block');

  const open = detail(CALL, OPEN);
  for (const l of PAYMENT.lines) assert.ok(open.includes(l.value), `missing ${l.label}`);
  for (const s of ['Reference', 'AXAL-CC-10-L101-11', 'As issued on 2026-10-18.', NOTICE_COPY.hide]) assert.ok(open.includes(s), s);
  assert.match(open, /<a href="#my-commitment"[^>]*>Go to My commitment<\/a>/);
});

test('the block is a whitelist: no planted number, no account uid', () => {
  const rows = paymentRows(PAYMENT);
  assert.deepEqual(rows.map((r) => r.label), [...PAYMENT.lines.map((l) => l.label), 'Reference']);
  for (const gate of [CLOSED, TICKED, OPEN]) {
    for (const n of [CALL, DEFAULT, DIST, SUPERSEDED, CHANGED]) {
      const h = detail(n, gate);
      assert.ok(!h.includes(PLANTED) && !h.includes(ACCOUNT_UID), `${n.uid} leaks`);
    }
  }
});

test('the check is not offered on a superseded, changed or paid notice, nor on a distribution', () => {
  const paidPortal = { capital_calls: [{ id: 11, status: 'paid' }] };
  const openPortal = { capital_calls: [{ id: 11, status: 'pending' }] };
  assert.deepEqual(instructionsOffer(SUPERSEDED, null).reason, 'superseded');
  assert.deepEqual(instructionsOffer(CHANGED, null).reason, 'changed');
  assert.deepEqual(instructionsOffer(CALL, paidPortal).reason, 'paid');
  assert.deepEqual(instructionsOffer(CALL, openPortal), { offer: true });
  assert.deepEqual(instructionsOffer(CALL, null), { offer: true }, 'an unread portal decides nothing');
  assert.equal(lineSettled({ capital_calls: [{ id: 11, status: 'pending' }] }, CALL.figures), false);
  assert.equal(instructionsOffer({ ...SUPERSEDED, instructions_changed: true }, null).reason, 'superseded', 'superseded comes first');
  const refused = { ...CALL, figures: { ...CALL.figures, payment: { refusal: 'No account yet. Do not send money.' } } };
  assert.equal(instructionsOffer(refused, null).sentence, 'No account yet. Do not send money.');
  assert.deepEqual(instructionsOffer(DIST, null), { offer: false, reason: 'no_payment', sentence: null });

  for (const [n, portal, sentence] of [[SUPERSEDED, null, NOTICE_COPY.superseded], [CHANGED, null, NOTICE_COPY.changed], [CALL, paidPortal, NOTICE_COPY.paid], [refused, null, 'No account yet. Do not send money.']]) {
    const h = detail(n, CLOSED, portal);
    assert.ok(h.includes(sentence), sentence);
    assert.ok(!h.includes('I confirmed by phone') && !h.includes('Show wire instructions'), `${n.uid} offers the check`);
  }
  const dist = detail(DIST, CLOSED);
  assert.ok(!dist.includes('I confirmed by phone') && !dist.includes('data-testid="notice-no-check"'));
  assert.ok(dist.includes('‹ Distribution Notice') && dist.includes('LP no. L101') && dist.includes('$50.00'));
});

test('the PDF is fetched only on tap', async () => {
  const orig = fundNoticesApi.minePdfBlob;
  let calls = 0;
  fundNoticesApi.minePdfBlob = async () => { calls += 1; return { blob: new Blob(['%PDF']), filename: 'x.pdf' }; };
  try {
    list([CALL, DEFAULT, DIST]);
    for (const gate of [CLOSED, TICKED, OPEN]) for (const n of [CALL, DEFAULT, DIST]) detail(n, gate);
    assert.equal(calls, 0);
  } finally { fundNoticesApi.minePdfBlob = orig; }

  const asked = [];
  const saved = [];
  const api = { minePdfBlob: async (uid) => { asked.push(uid); return { blob: new Blob(['%PDF']), filename: 'capital-call-1.pdf' }; } };
  await openNoticePdf('notice-call-a', { api, save: (blob, name) => saved.push(name) });
  assert.deepEqual(asked, ['notice-call-a']);
  assert.deepEqual(saved, ['capital-call-1.pdf']);

  const code = read('frontend/src/pages/SpinoutLabLpNotices.jsx').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const uses = [...code.matchAll(/minePdfBlob\(/g)];
  assert.equal(uses.length, 1, 'minePdfBlob is called in one place');
  const fn = code.slice(code.indexOf('export async function openNoticePdf'), code.indexOf('function saveBlob'));
  assert.ok(fn.includes('minePdfBlob('), 'that place is openNoticePdf');
  for (const m of code.matchAll(/useEffect\(([\s\S]*?)\);/g)) assert.ok(!/minePdfBlob|openNoticePdf/.test(m[1]), 'an effect fetches the PDF');
});

test('minePdfBlob asks the LP route with credentials, and a refusal throws the Worker\'s sentence', async () => {
  const realFetch = globalThis.fetch;
  const realStore = globalThis.localStorage;
  const seen = [];
  globalThis.localStorage = { getItem: () => null };
  try {
    globalThis.fetch = async (url, opts) => {
      seen.push([url, opts.credentials]);
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="capital-call-1.pdf"' } });
    };
    const out = await fundNoticesApi.minePdfBlob('notice-call-a');
    assert.deepEqual(seen, [['/api/fund-notices/mine/notice-call-a/pdf', 'include']]);
    assert.equal(out.filename, 'capital-call-1.pdf');
    assert.ok(out.blob instanceof Blob);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'notice_render_unavailable', message: 'The notice PDF could not be drawn right now. Try again in a moment.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(fundNoticesApi.minePdfBlob('notice-call-a'), /The notice PDF could not be drawn right now\. Try again in a moment\./);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.localStorage = realStore;
  }
});

test('no run of 8 or more digits before the check, and only the routing numbers after it', () => {
  const states = [list([CALL, DEFAULT, DIST, SUPERSEDED, CHANGED]), list([])];
  for (const n of [CALL, DEFAULT, DIST, SUPERSEDED, CHANGED]) states.push(detail(n, CLOSED), detail(n, TICKED));
  for (const h of states) assert.doesNotMatch(h, /\d{8,}/);
  for (const n of [CALL, DEFAULT]) {
    for (const m of detail(n, OPEN).matchAll(/\d{8,}/g)) assert.ok(['121145433', '121145307'].includes(m[0]), `unexpected run ${m[0]}`);
  }
});

test('the client is wired, and nothing is stored in the browser', () => {
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /export \* from '\.\/api\/fundLedger\.js';\nexport \* from '\.\/api\/fundNotices\.js';/);
  const client = read('frontend/src/lib/api/fundNotices.js');
  assert.ok(client.includes("request('/fund-notices/mine')"));
  assert.ok(client.includes('request(`/fund-notices/mine/${encodeURIComponent(uid)}`)'));
  assert.match(read('frontend/src/pages/SpinoutLabLpWorkspacePage.jsx'), /<MyNotices portal=\{portal\} \/>/);
  for (const f of ['frontend/src/pages/SpinoutLabLpNotices.jsx', 'frontend/src/lib/lpNoticesModel.js']) {
    assert.doesNotMatch(read(f), /localStorage|sessionStorage|indexedDB|document\.cookie/, f);
  }
});
