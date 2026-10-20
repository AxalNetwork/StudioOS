/**
 * D804 (#2241) — the Licences page's Contract, Statements and Requests tabs and
 * the "Request a change" sheet (canvas boards L3, L4, L5 and L8), drawn from
 * fixture answers shaped as D798 and D799 send them. No name, account number
 * or balance here is real.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licences_tabs_d804.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import {
  CHANGE_CHIPS, NOT_RECORDED, asItStands, bodyBlocks, buildChangeRequest, canSendNow, chipForTerm, contractSteps,
  contractSummary, dealTerms, disputeCents, payRows, renewalTimeline, requestRows, responseSentence, sectionIndex,
  statementRows, streamRows, usageRows,
} from '../src/pages/subsidiary/licence/licenceTabsModel.js';
import { ContractView, downloadContractPdf } from '../src/pages/subsidiary/licence/ContractTab.jsx';
import { StatementsView } from '../src/pages/subsidiary/licence/StatementsTab.jsx';
import { REQUEST_BUTTONS, RequestsView, simpleRequest } from '../src/pages/subsidiary/licence/RequestsTab.jsx';
import RequestChangeSheet, { SHEET_CLASS, requestChangeHref } from '../src/pages/subsidiary/licence/RequestChangeSheet.jsx';
import { pageKeyFor } from '../src/lib/railPages.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const text = (C, props) => renderedText(render(C, props));

// ───────────────────────────────────────────────────────────── fixtures

const BODY = [
  '# Subsidiary Licence Agreement',
  'Licence reference: LIC-1',
  '## 1. Parties',
  '1.1 The licensee is Licensee A, with its registered address at {{licence.registered_address}}.',
  '## 4. Fees',
  '4.1 The Licensee pays an annual fee of EUR 90,000, invoiced {{terms.fee_invoiced}}.',
  '## 19. Termination',
  '19.1 Either party may end it.',
].join('\n\n');
const contract = (o) => ({
  uid: 'c', template_title: 'Subsidiary licence agreement', template_version: 6, status: 'signed',
  drafted_at: '2025-02-12 10:00:00', sent_at: '2025-02-20 10:00:00', signed_at: '2025-03-02 10:00:00',
  unfilled_fields: [], body_md: BODY, ...o,
});
const CONTRACT = {
  available: true,
  in_force: contract({ uid: 'c_v6' }),
  pending: contract({ uid: 'c_v7', template_version: 7, status: 'sent', drafted_at: '2026-10-08 09:00:00', sent_at: '2026-10-12 09:00:00', signed_at: null }),
  earlier: [contract({ uid: 'c_v5', template_version: 5, superseded_at: '2025-07-02 00:00:00' })],
  sign_url: 'https://app.example.test/esign/tok', sign_reason: null,
};

const STREAMS = [
  { stream: 'subscriptions', gross_cents: 8020000, currency: 'EUR', available: true, is_estimate: false },
  { stream: 'licence_fees', gross_cents: 4020000, currency: 'EUR', available: true, is_estimate: true },
  { stream: 'token_margin', gross_cents: null, currency: 'EUR', available: false, is_estimate: false },
  { stream: 'platform_licence_royalties', gross_cents: 600000, currency: 'EUR', available: true, is_estimate: false },
];
const statement = (o) => ({
  uid: 's', period: '2026-Q3', status: 'issued', currency: 'EUR', gross_cents: 13040000, revenue_share_bps: 2000,
  owed_cents: 2408000, paid_cents: 0, paid_at: null, disputed_cents: 0, streams: STREAMS, payment_reference: 'AXAL-LIC-LIC-1-2026-Q3', ...o,
});
const PAYMENT = {
  method: 'Bank transfer', payee_entity: 'holdings', payee_name: 'Axal VC Holdings LLC',
  lines: [{ label: 'Bank', value: 'Bank A' }, { label: 'Account', value: 'ending 0000', mono: true }],
  reference: null, account_uid: 'acct', account_last4: '0000', warning: 'Check the account with HQ before a first payment.',
};
const STATEMENTS = {
  available: true,
  statements: [statement({ uid: 's_q3' }), statement({ uid: 's_q2', period: '2026-Q2', status: 'paid', paid_cents: 2408000 })],
  usage_reports: [],
  usage: {
    report_day: 5, report_day_reason: null, send_now: false, send_now_reason: 'Usage reports are sent by your branch.',
    periods: [{ period: '2026-Q3', status: 'late', sent_at: null, due_on: '2026-10-05', late: true }, { period: '2026-Q2', status: 'sent', sent_at: '2026-07-04 08:00:00', due_on: null, late: false }],
  },
  payment: PAYMENT,
};

const LIST = {
  items: [
    { uid: 'r1', kind: 'seat_increase', request: { seat_type: 'founder', seats: 20 }, status: 'open', sla: 'ok', created_at: '2026-10-12 09:00:00', answer: null },
    { uid: 'r2', kind: 'renewal', request: { term_years: null }, status: 'answered', sla: 'ok', created_at: '2026-09-03 09:00:00', answer: 'Renewal agreed on the same terms.' },
    { uid: 'r3', kind: 'delegate', request: { email: 'delegate@example.test', name: 'Delegate A' }, status: 'open', sla: 'past', created_at: '2026-08-01 09:00:00', answer: null },
    { uid: 'r4', kind: 'terms_change', request: { term: 'fee', current: 'x', asked: 'y' }, status: 'declined', sla: 'ok', created_at: '2026-06-02 09:00:00', answer: 'Reviewed at renewal.' },
  ],
  kinds_hidden: [],
  response_hours: { renewal: 72, terms_change: 120, seat_increase: 72, delegate: 72, non_renewal: 72 },
  requestable_terms: ['territory', 'seats', 'fee', 'term'],
  seat_types: ['founder', 'investor', 'advisor', 'partner'],
};
const MINE = {
  licence: {
    uid: 'lic_1', licence_ref: 'LIC-1', currency: 'EUR', annual_fee_cents: 9000000, term_years: 3, renews_on: '2028-03-01',
    territories: ['PT', 'ES'], seats: { founder: 60, investor: 0 }, seats_used_by_type: null,
  },
};

// ───────────────────────────────────────────────────────────── L3 contract

test('the contract in force and the one waiting show together, with Sign only when the Worker gave a link', () => {
  assert.deepEqual(contractSummary(CONTRACT), ['Sent 2026-10-12 · waiting for your signature', 'In force: v6, signed 2025-03-02']);
  const t = text(ContractView, { answer: CONTRACT });
  assert.ok(t.includes('Sent 2026-10-12 · waiting for your signature') && t.includes('In force: v6, signed 2025-03-02'));
  const html = render(ContractView, { answer: CONTRACT });
  assert.ok(html.includes('href="https://app.example.test/esign/tok"') && html.includes('data-testid="contract-sign"'));
  const noLink = render(ContractView, { answer: { ...CONTRACT, sign_url: null, sign_reason: 'HQ sent it to Principal A' } });
  assert.ok(!noLink.includes('data-testid="contract-sign"'), 'Sign without a sign_url');
  assert.ok(renderedText(noLink).includes('HQ sent it to Principal A'));
  assert.ok(t.includes('Download PDF'));
  // The shown body is the one waiting; earlier versions are read-only.
  assert.ok(t.includes('Subsidiary licence agreement · v7'));
  assert.ok(t.includes('v5, superseded 2025-07-02') && t.includes('Read-only'));
});

test('the status line runs Drafted → Sent → Signed, a step not reached reading Not recorded', () => {
  assert.deepEqual(contractSteps(CONTRACT.pending).map((s) => [s.t, s.d, s.reached]),
    [['Drafted', '2026-10-08', true], ['Sent', '2026-10-12', true], ['Signed', NOT_RECORDED, false]]);
  assert.deepEqual(contractSteps(CONTRACT.in_force).map((s) => s.d), ['2025-02-12', '2025-02-20', '2025-03-02']);
  assert.ok(text(ContractView, { answer: CONTRACT }).includes(`Signed${NOT_RECORDED}`));
});

test('the body is the stored text: a section index from its headings, and an unfilled field drawn [not filled]', () => {
  assert.deepEqual(sectionIndex(BODY).map((x) => `§${x.n} ${x.t}`), ['§1 Parties', '§4 Fees', '§19 Termination']);
  const blocks = bodyBlocks(BODY);
  const para = blocks.find((b) => b.kind === 'para' && b.runs.some((r) => r.gap));
  assert.deepEqual(para.runs.map((r) => r.gap || r.text), ['1.1 The licensee is Licensee A, with its registered address at ', 'licence.registered_address', '.']);
  const html = render(ContractView, { answer: CONTRACT });
  assert.equal((html.match(/\[not filled\]/g) || []).length, 2);
  assert.ok(html.includes('href="#contract-s19"') && html.includes('id="contract-s19"'));
  assert.ok(!html.includes('{{'), 'a merge token is never printed as written');
});

test('with nothing sent, the tab is the Waiting for HQ card; on a branch it gives the reason', () => {
  const w = text(ContractView, { answer: { available: true, in_force: null, pending: null, earlier: [], sign_url: null, sign_reason: 'Not sent yet' } });
  assert.ok(w.includes('Waiting for HQ') && w.includes('No contract has been sent yet'));
  assert.ok(text(ContractView, { answer: { available: false, reason: 'Read on HQ; this branch has no copy yet' } }).includes('Read on HQ'));
});

test('Download PDF reads D798\'s PDF and saves it', async () => {
  const saved = [];
  await downloadContractPdf('c_v7', { api: { contractPdfBlob: async (uid) => ({ blob: `blob:${uid}`, filename: 'LIC-1-contract-v7.pdf' }) }, save: (b, f) => saved.push([b, f]) });
  assert.deepEqual(saved, [['blob:c_v7', 'LIC-1-contract-v7.pdf']]);
});

// ───────────────────────────────────────────────────────────── L4 statements

test('the statements table opens its first row on the four streams, the royalty included, with their chips', () => {
  const rows = statementRows(STATEMENTS.statements);
  assert.deepEqual(rows.map((r) => [r.p, r.s, r.st, r.open]), [['2026-Q3', '20%', 'Issued', true], ['2026-Q2', '20%', 'Paid', false]]);
  assert.deepEqual(rows[0].streams.map((x) => [x.t, x.chip]), [
    ['Subscriptions', null], ['Licence fees', 'Estimated'], ['Token margin', 'Not reported'], ['Platform licence royalties', null],
  ]);
  // A stream HQ has not stored yet is listed and Not reported, never dropped.
  assert.deepEqual(streamRows([STREAMS[0]], 'EUR').map((x) => [x.key, x.chip]),
    [['subscriptions', null], ['licence_fees', 'Not reported'], ['token_margin', 'Not reported'], ['platform_licence_royalties', 'Not reported']]);
  const html = render(StatementsView, { answer: STATEMENTS });
  assert.ok(html.includes('data-testid="statement-streams-s_q3"'));
  assert.ok(!html.includes('data-testid="statement-streams-s_q2"'), 'only the first row is open');
  const t = renderedText(html);
  for (const h of ['Period', 'Gross', 'Share', 'Owed', 'Paid', 'Disputed', 'Status']) assert.ok(t.includes(h), h);
  assert.ok(t.includes('Platform licence royalties') && t.includes('Estimated') && t.includes('Not reported'));
  assert.ok(t.includes('AXAL-LIC-LIC-1-2026-Q3'));
});

test('How to pay HQ is the masked block, or the refusal\'s sentence when no account carries the fee', () => {
  const p = payRows(PAYMENT);
  assert.deepEqual(p.rows.map((r) => r.k), ['Method', 'Payee', 'Bank', 'Account']);
  const ok = text(StatementsView, { answer: STATEMENTS });
  assert.ok(ok.includes('ending 0000') && ok.includes('Axal VC Holdings LLC'));
  const refusal = 'No active checking account of Axal VC Holdings LLC is marked for the territory licence fee.';
  const html = render(StatementsView, { answer: { ...STATEMENTS, payment: { refusal, refusal_code: 'no_active_account' } } });
  assert.ok(html.includes('data-testid="pay-refusal"'));
  assert.ok(renderedText(html).includes(refusal));
  assert.equal(payRows(null).refusal, 'Payment instructions could not be read.');
});

test('Send now is hidden on HQ and shown where the Worker says a send is possible', () => {
  assert.equal(canSendNow(STATEMENTS.usage), false);
  const hq = render(StatementsView, { answer: STATEMENTS });
  assert.ok(!hq.includes('data-testid="usage-send-now"'));
  assert.ok(renderedText(hq).includes('Usage reports are sent by your branch.'));
  const branch = render(StatementsView, { answer: { available: false, reason: 'Read on HQ; this branch has no copy yet', usage: { send_now: true, send_now_reason: null } } });
  assert.ok(branch.includes('data-testid="usage-send-now"'));
  assert.deepEqual(usageRows(STATEMENTS.usage).map((u) => [u.m, u.st, u.late]), [['2026-Q3', 'Late', true], ['2026-Q2', 'Sent 2026-07-04', false]]);
});

test('annual fee invoices are D802\'s: listed when the answer carries them, said to be missing when it does not', () => {
  assert.ok(text(StatementsView, { answer: STATEMENTS }).includes('Annual fee invoices are not on this page yet'));
  const withInvoices = text(StatementsView, { answer: { ...STATEMENTS, fee_invoices: [{ uid: 'i1', title: 'Annual licence fee 2026–27', issued_on: '2026-03-01', amount: '€90,000.00', status: 'Issued', pdf_url: '/x.pdf' }] } });
  assert.ok(withInvoices.includes('Annual licence fee 2026–27') && withInvoices.includes('PDF'));
});

test('Dispute a line takes an amount in the statement\'s currency and a reason; a void statement offers none', () => {
  assert.deepEqual(disputeCents('1,200', 2408000), { ok: true, cents: 120000 });
  assert.deepEqual(disputeCents('12.5', 2408000), { ok: true, cents: 1250 });
  assert.equal(disputeCents('0', 2408000).ok, false);
  assert.equal(disputeCents('1.234', 2408000).ok, false);
  assert.equal(disputeCents('24081', 2408000).ok, false, 'more than owed');
  const rows = statementRows([statement({ uid: 'a' }), statement({ uid: 'b', status: 'paid' }), statement({ uid: 'c', status: 'void' })]);
  assert.deepEqual(rows.map((r) => r.disputable), [true, true, false]);
  const html = render(StatementsView, { answer: { ...STATEMENTS, statements: [statement({ uid: 'v', status: 'void' })] } });
  assert.ok(!renderedText(html).includes('Dispute a line'));
  const SRC = codeOnly(read('frontend/src/pages/subsidiary/licence/StatementsTab.jsx'));
  assert.ok(SRC.includes('api.disputeStatement(row.uid, c.cents, reason.trim())'), 'the dispute is D798\'s request');
});

// ───────────────────────────────────────────────────────────── L5 requests

test('the Requests tab has the five buttons, the renewal timeline and the requests with HQ\'s answer inline', () => {
  assert.deepEqual(REQUEST_BUTTONS.map((b) => b.t), ['Request renewal', 'Request a change', 'Request seats', 'Request a delegate', 'Give notice of non-renewal']);
  const t = text(RequestsView, { list: LIST, mine: MINE, today: '2026-10-20T10:00:00Z' });
  for (const b of REQUEST_BUTTONS) assert.ok(t.includes(b.t), b.t);
  assert.ok(t.includes('Today2026-10-20') && t.includes(`Notice deadline${NOT_RECORDED}`) && t.includes('Renewal2028-03-01'));
  assert.deepEqual(requestRows(LIST.items, LIST.response_hours).map((r) => [r.k, r.w, r.rt, r.st, r.a]), [
    ['Seats · Founder +20', '2026-10-12', '72 h', 'Open', 'Not recorded · awaiting HQ'],
    ['Renewal', '2026-09-03', '72 h', 'Answered', 'Renewal agreed on the same terms.'],
    ['Delegate · Delegate A', '2026-08-01', '72 h', 'Past response time', 'Not recorded · HQ is past its 72 h'],
    ['Change · Fee', '2026-06-02', '120 h', 'Declined', 'Reviewed at renewal.'],
  ]);
  assert.ok(t.includes('Renewal agreed on the same terms.'));
});

test('the notice deadline is the renewal less D797\'s notice period, once the terms carry it', () => {
  assert.deepEqual(renewalTimeline('2028-03-01', 90, '2026-10-20').map((p) => p.d), ['2026-10-20', '2027-12-02', '2028-03-01']);
  assert.deepEqual(renewalTimeline(null, 90, '2026-10-20').map((p) => p.d), ['2026-10-20', NOT_RECORDED, NOT_RECORDED]);
  const t = text(RequestsView, { list: LIST, mine: { ...MINE, terms: { non_renewal_notice_days: 90 } }, today: '2026-10-20' });
  assert.ok(t.includes('Notice deadline2027-12-02'));
});

test('a kind this licence does not offer is disabled with the Worker\'s reason; the simple requests send D799\'s bodies', () => {
  const html = render(RequestsView, { list: { ...LIST, kinds_hidden: [{ kind: 'delegate', reason: 'A white-label adds its own administrators.' }] }, mine: MINE, today: '2026-10-20' });
  assert.match(html, /<button[^>]*disabled=""[^>]*title="A white-label adds its own administrators\."[^>]*>Request a delegate<\/button>/);
  assert.deepEqual(simpleRequest('renewal'), { ok: true, body: { kind: 'renewal', subject: 'Renewal', request: {} } });
  assert.deepEqual(simpleRequest('non_renewal'), { ok: true, body: { kind: 'non_renewal', subject: 'Notice of non-renewal', request: {} } });
  assert.deepEqual(simpleRequest('delegate', { email: ' delegate@example.test ', name: 'Delegate A' }),
    { ok: true, body: { kind: 'delegate', subject: 'Delegate · Delegate A', request: { email: 'delegate@example.test', name: 'Delegate A' } } });
  assert.equal(simpleRequest('delegate', { email: '' }).ok, false);
});

// ───────────────────────────────────────────────────────────── the sheet

test('the sheet\'s chips map to D799\'s kinds, and each sends its request with the term as it stands', () => {
  assert.deepEqual(CHANGE_CHIPS.map((c) => [c.t, c.kind, c.term]), [
    ['Territory', 'terms_change', 'territory'], ['Seats', 'seat_increase', undefined], ['Fee', 'terms_change', 'fee'],
    ['Term', 'terms_change', 'term'], ['A deal term', 'terms_change', null],
  ]);
  assert.deepEqual(buildChangeRequest('fee', { asked: 'EUR 80,000', why: 'Market is smaller', current: 'Annual fee €90,000.00' }), {
    ok: true,
    body: { kind: 'terms_change', subject: 'Change · Fee', request: { term: 'fee', current: 'Annual fee €90,000.00', asked: 'EUR 80,000' }, detail: 'Market is smaller' },
  });
  assert.deepEqual(buildChangeRequest('seats', { seatType: 'founder', seats: 20, asked: '20 more from 1 Dec', why: 'Cohort 4' }), {
    ok: true,
    body: { kind: 'seat_increase', subject: 'Seats · Founder +20', request: { seat_type: 'founder', seats: 20 }, detail: '20 more from 1 Dec\n\nCohort 4' },
  });
  assert.equal(buildChangeRequest('seats', { seatType: 'founder', seats: 0 }).ok, false);
  assert.equal(buildChangeRequest('term', { asked: '  ' }).ok, false, 'nothing asked');
  assert.equal(buildChangeRequest('deal', { asked: 'x' }).ok, false, 'no deal term picked');
  assert.deepEqual(dealTerms(['territory', 'seats', 'fee', 'term']), []);
  assert.deepEqual(dealTerms(['territory', 'fee', 'carry_share_bps']), ['carry_share_bps']);
  assert.equal(buildChangeRequest('deal', { asked: '25%', dealTerm: 'carry_share_bps', current: 'x' }).body.request.term, 'carry_share_bps');
  assert.equal(asItStands('seats', { licence: MINE.licence }), 'Founder seats: 60 licensed');
  assert.equal(asItStands('seats', { licence: { ...MINE.licence, seats_used_by_type: { founder: 57 } }, sections: { seats: '6.1' } }), 'Founder seats: 60 licensed, 57 used · Contract §6.1');
  assert.equal(asItStands('territory', { licence: MINE.licence }), 'PT, ES');
  assert.equal(responseSentence('seats', LIST.response_hours), 'HQ answers seat requests within 72 hours. Nothing changes until HQ does.');
});

test('a term prefilled from the Terms tab opens the sheet on its chip, with that term as it stands', () => {
  assert.equal(requestChangeHref('fee'), '/admin/my-licence/requests?change=fee');
  assert.equal(chipForTerm('fee'), 'fee');
  assert.equal(chipForTerm('seats'), 'seats');
  assert.equal(chipForTerm('carry_share_bps'), 'deal');
  const html = render(RequestsView, { list: LIST, mine: MINE, today: '2026-10-20', initialChange: 'term' });
  assert.ok(html.includes('data-testid="request-change-sheet"'));
  assert.match(html, /aria-pressed="true"[^>]*data-chip="term"/);
  assert.ok(renderedText(html).includes('3 years, renews 2028-03-01'));
  assert.ok(!render(RequestsView, { list: LIST, mine: MINE, today: '2026-10-20' }).includes('data-testid="request-change-sheet"'), 'closed unless asked');
  const noDeal = render(RequestChangeSheet, { open: true, startChip: 'deal', licence: MINE.licence, requestable: LIST.requestable_terms, responseHours: LIST.response_hours });
  assert.ok(noDeal.includes('data-testid="no-deal-terms"'));
});

test('the sheet is the whole screen on a phone and a 460px panel from sm up', () => {
  assert.ok(SHEET_CLASS.split(' ').includes('inset-0'));
  assert.ok(SHEET_CLASS.split(' ').includes('fixed'));
  assert.ok(SHEET_CLASS.includes('sm:w-[460px]') && SHEET_CLASS.includes('sm:left-auto'));
  const html = render(RequestChangeSheet, { open: true, startChip: 'seats', licence: MINE.licence, responseHours: LIST.response_hours, seatTypes: LIST.seat_types });
  assert.ok(html.includes(`class="${SHEET_CLASS}"`));
  const t = renderedText(html);
  for (const w of ['What to change', 'As it stands · read-only', 'What you are asking for', 'Why', 'Send request', 'Cancel']) assert.ok(t.includes(w), w);
  assert.ok(t.includes('HQ answers seat requests within 72 hours. Nothing changes until HQ does.'));
  assert.equal(render(RequestChangeSheet, { open: false }), '');
});

// ───────────────────────────────────────────────────────────── routes and the rail

test('the three tabs are routes behind the admin guard, each in the Admin board\'s frame keyed Admin · Licences', () => {
  // D800 (#2233) merged second and resolved the routes, as D804 said it would:
  // each tab's path mounts the one Licences page, whose frame draws the rail
  // and mounts the tab (`LicenceTabRoute` is gone).
  const APP = codeOnly(read('frontend/src/App.jsx'));
  const PAGE = codeOnly(read('frontend/src/pages/subsidiary/MyLicencePage.jsx'));
  const C = { contract: 'ContractTab', statements: 'StatementsTab', requests: 'RequestsTab' };
  for (const tab of ['contract', 'statements', 'requests']) {
    assert.ok(APP.includes(`<Route path="/admin/my-licence/${tab}" element={guard(['admin'], <MyLicencePage />)} />`), tab);
    assert.equal(pageKeyFor(`/admin/my-licence/${tab}`, 'admin'), 'Admin · Licences');
    assert.ok(PAGE.includes(`{tab === '${tab}' && <${C[tab]} />}`), `${C[tab]} is not mounted`);
  }
  assert.ok(PAGE.includes('<AdminBoardFrame workspace="Licences"'));
  for (const f of ['ContractTab', 'StatementsTab', 'RequestsTab', 'RequestChangeSheet']) {
    assert.ok(!codeOnly(read(`frontend/src/pages/subsidiary/licence/${f}.jsx`)).includes('AdminBoardFrame'), `${f} draws a rail of its own`);
  }
  const RAIL = codeOnly(read('frontend/src/lib/railPages.js'));
  for (const tab of ['contract', 'statements', 'requests']) assert.ok(RAIL.includes(`alias('/admin/my-licence/${tab}', key(AD, 'Licences')`), tab);
  // No API method of its own: D798's and D799's modules only.
  for (const f of ['ContractTab', 'StatementsTab', 'RequestsTab', 'RequestChangeSheet']) {
    assert.doesNotMatch(codeOnly(read(`frontend/src/pages/subsidiary/licence/${f}.jsx`)), /fetch\(|request\(/, f);
  }
});
