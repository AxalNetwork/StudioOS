/**
 * D1234 (#3242) — KYC part 6: Businesses (KYC6, KYC17a) and one business's
 * case (KYC7, KYC7b) with its decisions (KYC8 A, B, C, E): the queue on part
 * 3's read with its tiles and filters, the case's blocks each read, missing
 * or unreadable, and every decision in a dialog carrying the case's
 * `review_token`.
 *
 * Mounted against the Worker's own shapes (`routes/kyb_admin.ts` GET /,
 * GET /:id, the PATCH decisions) through a stubbed fetch. Every business,
 * person and reason is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/kyc_businesses_d1234.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import KycBusinesses from '../src/pages/admin/kyc/KycBusinesses.jsx';
import { KycBusinessCase } from '../src/pages/admin/kyc/BusinessCase.jsx';
import {
  actionsOf, approveBlocker, approveBody, approveProblem, blockOf, businessHref, businessStatusWord, countText, kindChips, kindWord,
  ownerRows, queueQuery, reasonProblem, refusalOf, requestText, rowOf, tiles, waitingFor,
} from '../src/pages/admin/kyc/businessModel.js';
import { viewOf } from '../src/pages/admin/kyc/kycModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const NOW = '2026-10-26T10:00:00Z';
const NOW_MS = Date.parse(NOW);

const response = (body, status = 200, type = 'application/json') => ({
  ok: status < 400, status, type: 'basic', redirected: false,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? type : null) },
  json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['img'], { type }),
});

const ITEM = (uid, name, extra = {}) => ({
  id: Number(uid.split('-')[1]), uid, kind: 'founder_company', entity_name: name, entity_type: 'Private limited', jurisdiction: 'GB', status: 'in_review',
  registration_number: '••••4821', submitted_at: '2026-10-15 09:00:00', reviewed_at: null, expires_at: null, company_id: 3, linked_user_id: 41,
  licence_ref: null, owners_disclosed: true, high_risk_country: false, version: 2, can_review: true, ...extra,
});
const LIST = () => ({
  items: [
    ITEM('company-12', 'Lumen Testworks Ltd'),
    ITEM('account-4', 'Quill Demo Partners LLP', { kind: 'partner_firm', jurisdiction: 'US', owners_disclosed: false, submitted_at: '2026-10-24 09:00:00' }),
    ITEM('import-9', 'Old Example Advisors', { kind: 'imported_partner', linked_user_id: null, status: 'needs_info', high_risk_country: true }),
  ],
  page: 1, limit: 25, total: 3,
  counts: [
    { status: 'in_review', n: 2, oldest_at: '2026-10-15 09:00:00' },
    { status: 'not_started', n: 1, oldest_at: '2026-10-10 09:00:00' },
    { status: 'needs_info', n: 1, oldest_at: '2026-10-01 09:00:00' },
    { status: 'approved', n: 7, oldest_at: null },
    { status: 'expired', n: 2, oldest_at: null },
  ],
});
const missing = (reason) => ({ available: true, recorded: false, reason });
const ok = (value) => ({ available: true, recorded: true, value });
const CASE = (extra = {}) => ({
  ...ITEM('company-12', 'Lumen Testworks Ltd'),
  review_token: 'tok-v2',
  entity: { registered_address: '••• London', tax_id: '••••1937', signing_authority_name: 'Rae Invented', signing_authority_title: 'Director' },
  owners: ok([
    { index: 0, name: 'Rae Invented', ownership_pct: 60, nationality: 'GB', date_of_birth: '••/••/19••', user_id: 41, account_name: 'Rae Invented', kyc_status: 'approved', kyc_reason: null, sanctions: missing('No owner screening is recorded.') },
    { index: 1, name: 'Sol Madeup', ownership_pct: 30, nationality: 'FR', date_of_birth: null, user_id: null, account_name: null, kyc_status: null, kyc_reason: 'No account is linked to this owner.', sanctions: missing('No owner screening is recorded.') },
    { index: 2, name: 'Tia Fiction', ownership_pct: 10, nationality: 'ES', date_of_birth: null, user_id: null, account_name: null, kyc_status: null, kyc_reason: 'No account is linked to this owner.', sanctions: missing('No owner screening is recorded.') },
  ]),
  directors: [{ name: 'Rae Invented', title: 'Director' }],
  documents: ok([{ uid: 'doc-a1', kind: 'incorporation', content_type: 'application/pdf', size_bytes: 9000, created_at: '2026-10-15 09:00:00' }]),
  history: ok([{ action: 'kyb_documents_requested', created_at: '2026-10-16 10:00:00', actor_name: 'Ada Admin' }]),
  registry: missing('No registry check has been recorded.'),
  due_diligence: ok([{ uid: 'dd-77', status: 'open', kyb_section_status: 'in_progress', items: 4, waiting: 2, read_only: true }]),
  sanctions_last_checked_at: null, requested_documents: [{ kind: 'shareholders' }], decision_reason: null, unchecked_owner_reason: null,
  ...extra,
});

function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, v] of Object.entries(over)) if (url.includes(k) && (v.method || 'GET') === method) return v.answer(url, options);
    if (/\/api\/kyc\/businesses\?/.test(url)) return response(LIST());
    if (/\/api\/kyc\/businesses\/company-12\/documents\/doc-a1$/.test(url)) return response(null, 200, 'image/png');
    if (/\/api\/kyc\/businesses\/company-12\/sensitive\/address$/.test(url)) return response({ field: 'address', value: '1 Invented Row, London', shown_at: NOW });
    if (/\/api\/kyc\/businesses\/[\w-]+\/(approve|reject|request-documents|dismiss|link-account)$/.test(url)) return response({ uid: 'company-12', status: 'approved' });
    if (/\/api\/kyc\/businesses\/company-12$/.test(url)) return response(CASE());
    return response({});
  };
}

async function mounted(element, { handle = handler() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, open: globalThis.open, alert: globalThis.alert, confirm: globalThis.confirm };
  const requests = [];
  const popups = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, headers: options.headers || {} });
    return handle(String(u), options);
  };
  globalThis.open = (...a) => { popups.push(['open', ...a]); return null; };
  globalThis.alert = (...a) => popups.push(['alert', ...a]);
  globalThis.confirm = (...a) => { popups.push(['confirm', ...a]); return true; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  return {
    requests, popups, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(container),
    count: (id) => nodes().filter((n) => props_(n)['data-testid'] === id).length,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value, checked: value } }); }); await flush(); },
    submit: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onSubmit({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (r) => r.requests.filter((q) => q.method !== 'GET' && q.url !== '/api/client-error');
const header = (q, k) => q.headers[k] ?? q.headers?.get?.(k);

// ---------------------------------------------------------------- model

test('a business’s address is its uid; anything else opens the queue', () => {
  assert.equal(businessHref('company-12'), '/admin/kyc/businesses/company-12');
  assert.equal(businessHref('studio-3'), '/admin/kyc/businesses/studio-3');
  for (const bad of ['company-0', 'firm-2', '../1', null, 'company-12/x']) assert.equal(businessHref(bad), '/admin/kyc/businesses', String(bad));
  assert.equal(viewOf('/admin/kyc/businesses/import-9').business, 'import-9');
  assert.equal(viewOf('/admin/kyc/businesses/import-0').business, null);
  assert.equal(viewOf('/admin/kyc/businesses/import-9/more').business, null);
  assert.equal(viewOf('/admin/kyc/people/7').business, null);
});

test('the words: kinds, statuses, licensed studios only for the Super Admin', () => {
  assert.equal(kindWord('imported_partner'), 'Imported');
  assert.equal(kindWord('odd'), 'Not recorded');
  assert.deepEqual(['in_review', 'needs_info', 'dismissed', 'odd'].map(businessStatusWord), ['Waiting', 'Needs information', 'Dismissed', 'Not recorded']);
  assert.ok(!kindChips(false).some(([k]) => k === 'licensed_studio'));
  assert.ok(kindChips(true).some(([k]) => k === 'licensed_studio'));
  assert.deepEqual(queueQuery({ q: '  lumen ', status: 'in_review', kind: '' }, 2), { q: 'lumen', status: 'in_review', kind: '', page: 2, limit: 25 });
});

test('the tiles from the counts; a read without counts draws no zero', () => {
  const t = tiles(LIST(), NOW_MS);
  assert.deepEqual(t.map((x) => [x.key, x.value]), [['waiting', '3'], ['needs', '1'], ['approved', '7'], ['rejected', '0']]);
  assert.equal(t[0].note, 'Oldest: 16 days', 'the oldest of Waiting and Not started');
  assert.equal(t[3].note, '2 expired');
  assert.equal(tiles({ items: [] }), null);
  assert.equal(tiles(null), null);
  assert.equal(waitingFor('2026-10-26 08:00:00', NOW_MS), 'Today');
  assert.equal(waitingFor('2026-10-25 09:00:00', NOW_MS), '1 day');
  assert.equal(waitingFor(null, NOW_MS), null);
});

test('a row: owners disclosed, not disclosed, or no account yet; the wait only while waiting', () => {
  const [a, b, c] = LIST().items.map((x) => rowOf(x, NOW_MS));
  assert.deepEqual([a.owners, b.owners, c.owners], ['Disclosed', 'Not disclosed', 'No account yet']);
  assert.equal(a.waiting, '11 days');
  assert.equal(rowOf(ITEM('company-1', 'X', { status: 'approved' }), NOW_MS).waiting, '—');
  assert.equal(rowOf(ITEM('company-1', 'X', { submitted_at: null }), NOW_MS).waiting, 'Not recorded');
  assert.equal(a.sub, 'Private limited · ••••4821');
  assert.ok(c.highRisk && b.ownersWarn && !a.ownersWarn);
  assert.equal(countText(LIST()), '1–3 of 3');
  assert.equal(countText({ total: 0 }), '0 businesses');
  assert.equal(countText({}), 'Count not recorded');
});

test('the case: blocks, owners of 25% or more, and what each case allows', () => {
  assert.deepEqual(blockOf({ available: false }), { state: 'unreadable' });
  assert.deepEqual(blockOf(missing('Not yet.')), { state: 'missing', reason: 'Not yet.' });
  assert.deepEqual(blockOf([1]), { state: 'ok', value: [1] });
  const o = ownerRows(CASE().owners);
  assert.deepEqual(o.unchecked.map((x) => x.name), ['Sol Madeup'], 'Tia holds 10%: below the line');
  assert.equal(o.relevantCount, 2);
  assert.equal(o.total, 100);
  assert.ok(ownerRows(ok([{ index: 0, name: 'N', ownership_pct: null }])).unchecked.length === 1, 'a share not recorded counts');
  assert.deepEqual(actionsOf(CASE()), ['documents', 'reject', 'approve']);
  assert.deepEqual(actionsOf(CASE({ status: 'approved' })), ['reject']);
  assert.deepEqual(actionsOf(CASE({ kind: 'imported_partner', linked_user_id: null })), ['link', 'dismiss', 'documents', 'reject', 'approve']);
  assert.deepEqual(actionsOf(CASE({ can_review: false })), []);
  assert.deepEqual(actionsOf(CASE({ status: 'dismissed' })), []);
  assert.equal(approveBlocker(CASE(), o), null);
  assert.match(approveBlocker(CASE({ owners_disclosed: false }), o), /not disclosed/);
  assert.match(approveBlocker(CASE(), { state: 'unreadable' }), /could not be read/);
  assert.match(approveBlocker(CASE(), { state: 'missing' }), /not been recorded/);
});

test('approve sends the three checks, and the unchecked-owner reason only when one is needed', () => {
  const o = ownerRows(CASE().owners);
  const f = { registry: true, identified: true, checked: true, goodStanding: '', reason: '', note: '' };
  assert.match(approveProblem(f, o), /Sol Madeup \(30%\) has no approved identity check/);
  assert.match(approveProblem({ ...f, checked: false }, o), /three checks/);
  assert.equal(approveProblem({ ...f, reason: 'Passport seen in person.' }, o), null);
  assert.deepEqual(approveBody({ ...f, reason: ' Passport seen in person. ', goodStanding: 'yes' }, o),
    { registry_matches: true, owners_identified: true, owners_checked_or_explained: true, good_standing: true, unchecked_owner_reason: 'Passport seen in person.' });
  const all = ownerRows(ok([{ index: 0, name: 'A', ownership_pct: 100, kyc_status: 'approved' }]));
  assert.equal(approveProblem(f, all), null);
  assert.deepEqual(approveBody({ ...f, reason: 'ignored', goodStanding: 'no', note: ' fine ' }, all),
    { registry_matches: true, owners_identified: true, owners_checked_or_explained: true, good_standing: false, note: 'fine' });
  assert.equal(reasonProblem('abcd'), 'Give a reason of at least 5 characters.');
  assert.equal(reasonProblem('abcde'), null);
  assert.match(reasonProblem('x'.repeat(2001)), /2000/);
  assert.equal(requestText('Lumen', ['incorporation', 'shareholders']), 'To finish the business check for Lumen, we need certificate of incorporation and a certified register of shareholders.');
  assert.equal(requestText('Lumen', []), '');
  assert.deepEqual(refusalOf({ status: 409, data: { error: 'kyb_changed' } }).changed, true);
  assert.deepEqual(refusalOf({ status: 400, data: { error: 'kyb_checks_required', detail: 'Confirm the registry.' } }), { changed: false, line: 'Confirm the registry.' });
});

// ---------------------------------------------------------------- mounted queue

test('mounted KYC6: the queue from part 3’s read, its tiles, chips and the door to each case; nothing written', async () => {
  const r = await mounted(h(KycBusinesses, { now: NOW_MS }));
  try {
    assert.equal(r.requests[0].url, '/api/kyc/businesses?page=1&limit=25');
    assert.match(r.textOf('kyc-biz-tile-waiting'), /Waiting3Oldest: 16 days/);
    assert.match(r.textOf('kyc-biz-tile-rejected'), /Rejected02 expired/);
    assert.equal(r.count('kyc-biz-row'), 3);
    assert.equal(r.props('kyc-biz-open-company-12').href, '/admin/kyc/businesses/company-12');
    assert.equal(r.textOf('kyc-biz-count'), '1–3 of 3');
    assert.match(r.all(), /No account yet/);
    assert.ok(!r.has('kyc-biz-kind-licensed_studio'), 'an admin is not offered licensed studios');
    await r.click('kyc-biz-status-needs_info');
    assert.equal(r.requests.at(-1).url, '/api/kyc/businesses?status=needs_info&page=1&limit=25');
    await r.click('kyc-biz-kind-partner_firm');
    assert.equal(r.requests.at(-1).url, '/api/kyc/businesses?status=needs_info&kind=partner_firm&page=1&limit=25');
    await r.change('kyc-biz-q', 'Lumen');
    await r.submit('kyc-biz-search');
    assert.equal(r.requests.at(-1).url, '/api/kyc/businesses?q=Lumen&status=needs_info&kind=partner_firm&page=1&limit=25');
    assert.deepEqual(writes(r), []);
    assert.deepEqual(r.popups, []);
  } finally { await r.close(); }
});

test('mounted KYC6: paging, and a new filter starts again at page 1', async () => {
  const r = await mounted(h(KycBusinesses, { now: NOW_MS }), { handle: handler({ '/kyc/businesses?': { answer: () => response({ ...LIST(), total: 60 }) } }) });
  try {
    assert.equal(r.props('kyc-biz-prev').disabled, true);
    await r.click('kyc-biz-next');
    assert.equal(r.requests.at(-1).url, '/api/kyc/businesses?page=2&limit=25');
    await r.click('kyc-biz-status-approved');
    assert.equal(r.requests.at(-1).url, '/api/kyc/businesses?status=approved&page=1&limit=25');
  } finally { await r.close(); }
});

test('mounted KYC6: a failed read is Unreadable with Try again, never an empty table; an empty one says so', async () => {
  const r = await mounted(h(KycBusinesses, { now: NOW_MS }), { handle: handler({ '/kyc/businesses?': { answer: () => response({ error: 'kyb_queue_unreadable' }, 503) } }) });
  try {
    assert.ok(r.has('kyc-businesses-unreadable'));
    assert.ok(!r.has('kyc-biz-empty') && !r.has('kyc-biz-table') && !r.has('kyc-biz-tiles'), 'no zero tiles, no empty table');
  } finally { await r.close(); }
  const e = await mounted(h(KycBusinesses, { now: NOW_MS }), { handle: handler({ '/kyc/businesses?': { answer: () => response({ items: [], page: 1, limit: 25, total: 0, counts: [] }) } }) });
  try {
    assert.match(e.textOf('kyc-biz-empty'), /Nothing is waiting/);
    assert.equal(e.textOf('kyc-biz-count'), '0 businesses');
  } finally { await e.close(); }
});

// ---------------------------------------------------------------- mounted case

test('mounted KYC7: the case’s blocks, each read, missing with its reason, or unreadable', async () => {
  const r = await mounted(h(KycBusinessCase, { id: 'company-12', nowIso: NOW }));
  try {
    assert.equal(r.requests[0].url, '/api/kyc/businesses/company-12');
    assert.equal(r.textOf('kyb-case-name'), 'Lumen Testworks Ltd');
    assert.equal(r.textOf('kyb-case-waiting'), 'Waiting 11 days');
    assert.equal(r.props('kyb-case-back').href, '/admin/kyc/businesses');
    assert.equal(r.textOf('kyb-decision-line'), 'Approving satisfies Entity verification (KYB) for 24 months.');
    assert.equal(r.count('kyb-owners-table'), 1);
    assert.match(r.textOf('kyb-owners-summary'), /1 of 2 owners of 25% or more has no approved identity check\. Recorded shares add to 100%\./);
    assert.match(r.textOf('kyb-owner-kyc-0'), /Approved/);
    assert.match(r.textOf('kyb-registry-missing'), /Not recorded · No registry check has been recorded\./);
    assert.ok(!r.has('kyb-registry-ok'), 'no registry check is never a match');
    assert.match(r.textOf('kyb-docs-requested'), /A certified register of shareholders/);
    assert.match(r.textOf('kyb-history-row'), /Documents asked for · Ada Admin/);
    assert.match(r.textOf('kyb-diligence-row'), /dd-77.*2 of 4 waiting/);
    assert.match(r.textOf('kyb-case-sanctions'), /No sanctions check is recorded/);
    assert.deepEqual(writes(r), [], 'reading a case writes nothing');
  } finally { await r.close(); }

  const broken = await mounted(h(KycBusinessCase, { id: 'company-12', nowIso: NOW }), {
    handle: handler({ '/company-12': { answer: (u) => (/company-12$/.test(u) ? response(CASE({ documents: { available: false }, history: { available: false }, owners: { available: false } })) : handler()(u)) } }),
  });
  try {
    assert.ok(broken.has('kyb-docs-unreadable') && broken.has('kyb-history-unreadable'));
    assert.ok(!broken.has('kyb-docs-none') && !broken.has('kyb-history-none'), 'unreadable is never "nothing on file"');
    assert.match(broken.textOf('kyb-case-owners'), /could not be read/);
    assert.equal(broken.props('kyb-act-approve').disabled, true, 'owners unread: no approval');
  } finally { await broken.close(); }

  const gone = await mounted(h(KycBusinessCase, { id: 'company-99', nowIso: NOW }), { handle: () => response({ error: 'not_found' }, 404) });
  try { assert.ok(gone.has('kyb-case-missing')); } finally { await gone.close(); }
  const down = await mounted(h(KycBusinessCase, { id: 'company-12', nowIso: NOW }), { handle: () => response({ error: 'down' }, 503) });
  try { assert.ok(down.has('kyb-case-unreadable')); } finally { await down.close(); }
});

test('mounted KYC8 A: approve asks a reason for an unchecked owner and sends the review token', async () => {
  const r = await mounted(h(KycBusinessCase, { id: 'company-12', nowIso: NOW }));
  try {
    await r.click('kyb-act-approve');
    assert.equal(r.props('kyb-approve-go').disabled, true);
    for (const t of ['registry', 'identified', 'checked']) await r.change(`kyb-approve-${t}`, true);
    assert.match(r.textOf('kyb-approve-unchecked'), /Sol Madeup \(30%\) has no approved identity check/);
    assert.equal(r.props('kyb-approve-go').disabled, true, 'a reason first');
    await r.change('kyb-approve-reason', 'Passport seen in person on 20 Oct.');
    await r.click('kyb-approve-go');
    const w = writes(r);
    assert.equal(w.length, 1);
    assert.equal(w[0].method, 'PATCH');
    assert.equal(w[0].url, '/api/kyc/businesses/company-12/approve');
    assert.deepEqual(w[0].body, { registry_matches: true, owners_identified: true, owners_checked_or_explained: true, unchecked_owner_reason: 'Passport seen in person on 20 Oct.' });
    assert.equal(header(w[0], 'If-Match'), 'tok-v2', 'the token of the case read');
    assert.ok(!r.has('kyb-approve'), 'the dialog closes on a decision');
    assert.ok(r.requests.filter((q) => q.url === '/api/kyc/businesses/company-12').length >= 2, 'the case is read again');
    assert.deepEqual(r.popups, []);
  } finally { await r.close(); }
});

test('mounted KYC8: a case that changed is refused with 409 and asks for a fresh read; never retried', async () => {
  const r = await mounted(h(KycBusinessCase, { id: 'company-12', nowIso: NOW }), {
    handle: handler({ '/reject': { method: 'PATCH', answer: () => response({ error: 'kyb_changed', detail: 'This case changed.' }, 409) } }),
  });
  try {
    await r.click('kyb-act-reject');
    await r.click('kyb-reject-go');
    assert.deepEqual(writes(r), [], 'no reason, no write, even if the button is pressed');
    assert.match(r.textOf('kyb-reject-problem'), /at least 5 characters/);
    await r.change('kyb-reject-reason', 'The register does not match.');
    await r.click('kyb-reject-go');
    assert.equal(writes(r).length, 1, 'one write, no silent retry');
    assert.deepEqual(writes(r)[0].body, { reason: 'The register does not match.' });
    assert.match(r.textOf('kyb-reject-refused'), /changed while you had it open/);
    const reads = r.requests.filter((q) => q.url === '/api/kyc/businesses/company-12').length;
    await r.click('kyb-reject-reread');
    assert.ok(!r.has('kyb-reject'));
    assert.equal(r.requests.filter((q) => q.url === '/api/kyc/businesses/company-12').length, reads + 1);
  } finally { await r.close(); }
});

test('mounted KYC8 C, E and KYC7b: ask for documents, dismiss an import, link it to an account', async () => {
  const r = await mounted(h(KycBusinessCase, { id: 'company-12', nowIso: NOW }));
  try {
    await r.click('kyb-act-documents');
    assert.equal(r.props('kyb-docs-go').disabled, true);
    await r.change('kyb-docs-incorporation', true);
    assert.equal(r.props('kyb-docs-message').value, 'To finish the business check for Lumen Testworks Ltd, we need certificate of incorporation.');
    await r.click('kyb-docs-go');
    assert.deepEqual([writes(r)[0].url, writes(r)[0].body], ['/api/kyc/businesses/company-12/request-documents',
      { kinds: ['incorporation'], message: 'To finish the business check for Lumen Testworks Ltd, we need certificate of incorporation.' }]);
    assert.equal(header(writes(r)[0], 'If-Match'), 'tok-v2');
  } finally { await r.close(); }

  const IMPORT = CASE({ uid: 'import-9', kind: 'imported_partner', linked_user_id: null, review_token: 'tok-i' });
  const imp = await mounted(h(KycBusinessCase, { id: 'import-9', nowIso: NOW }), {
    handle: handler({ '/import-9': { answer: (u, o) => (/import-9$/.test(u) ? response(IMPORT) : handler()(u, o)) } }),
  });
  try {
    assert.match(imp.textOf('kyb-case-owner'), /not linked to an account/);
    await imp.click('kyb-act-dismiss');
    await imp.change('kyb-dismiss-reason', 'Duplicate of company-12.');
    await imp.click('kyb-dismiss-go');
    assert.deepEqual([writes(imp)[0].url, writes(imp)[0].body], ['/api/kyc/businesses/import-9/dismiss', { reason: 'Duplicate of company-12.' }]);
    await imp.click('kyb-act-link');
    await imp.change('kyb-link-id', 'abc');
    assert.equal(imp.props('kyb-link-go').disabled, true);
    await imp.change('kyb-link-id', '41');
    await imp.click('kyb-link-go');
    assert.deepEqual([writes(imp)[1].url, writes(imp)[1].body], ['/api/kyc/businesses/import-9/link-account', { user_id: 41 }]);
    assert.equal(header(writes(imp)[1], 'If-Match'), 'tok-i');
    assert.deepEqual(imp.popups, []);
  } finally { await imp.close(); }
});

test('mounted KYC7: a masked value shows through its logged route; a document opens in the page', async () => {
  const r = await mounted(h(KycBusinessCase, { id: 'company-12', nowIso: NOW }));
  try {
    assert.ok(!r.all().includes('1 Invented Row'));
    const shows = () => r.requests.filter((q) => q.url.includes('/sensitive/'));
    const before = shows().length;
    const n = r.all();
    assert.match(n, /••• London/);
    // the second Show on the entity is the address
    const nodes = [];
    const walk = (x) => { const p = Object.entries(x).find(([k]) => k.startsWith('__reactProps$'))?.[1]; if (p?.['data-testid'] === 'hq-sensitive-show') nodes.push(p); (x.childNodes || []).forEach(walk); };
    walk(document.body);
    await act(async () => { nodes[1].onClick(); }); await r.flush();
    assert.equal(shows().length, before + 1);
    assert.equal(shows().at(-1).url, '/api/kyc/businesses/company-12/sensitive/address');
    assert.match(r.all(), /1 Invented Row, London/);

    await r.click('kyb-doc-view-doc-a1');
    assert.ok(r.requests.some((q) => q.url === '/api/kyc/businesses/company-12/documents/doc-a1'));
    assert.ok(r.has('kyc-viewer'));
    assert.deepEqual(r.popups, [], 'no new tab');
  } finally { await r.close(); }
});

// ---------------------------------------------------------------- guards and wiring

const FILES = [
  'frontend/src/pages/admin/kyc/KycBusinesses.jsx',
  'frontend/src/pages/admin/kyc/BusinessCase.jsx',
  'frontend/src/pages/admin/kyc/BusinessDialogs.jsx',
  'frontend/src/pages/admin/kyc/businessModel.js',
];

test('no browser pop-up, no new tab, no raw hex colour; every light hover has its dark pair', () => {
  for (const f of FILES) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\s*\(/, `${f}: a browser pop-up`);
    assert.doesNotMatch(src, /window\.open|target="_blank"/, `${f}: a new tab`);
    assert.doesNotMatch(src, /-\[#[0-9a-fA-F]{3,8}\]/, `${f}: a raw hex colour`);
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] || m[2];
      if (/(^|\s)hover:(bg|text|border)-/.test(cls)) assert.match(cls, /dark:hover:/, `${f}: ${cls}`);
    }
  }
  for (const c of [/const BTN = '([^']*)'/, /const CHIP_OFF = `([^`]*)`/]) {
    const m = read('frontend/src/pages/admin/kyc/KycBusinesses.jsx').match(c);
    assert.ok(m && /dark:hover:/.test(m[1]), String(c));
  }
});

test('every business write sends If-Match from the case read; the Worker keeps step-up on each', () => {
  const dialogs = read('frontend/src/pages/admin/kyc/BusinessDialogs.jsx');
  assert.equal((dialogs.match(/review_token: c\.review_token|c\.review_token\)/g) || []).length, 5);
  assert.match(read('frontend/src/lib/api/kyb.js'), /'If-Match': review_token/);
  const worker = read('cloudflare-worker/src/routes/kyb_admin.ts');
  assert.match(worker, /kyb_changed/);
  assert.match(worker, /requireStepUp/);
});

test('the wiring: the tab, the case route, the door, the docs', () => {
  const tabs = read('frontend/src/pages/admin/kyc/KycTabs.jsx');
  assert.match(tabs, /if \(view\.business\) return <KycBusinessCase id=\{view\.business\} \/>;/);
  assert.match(tabs, /if \(view\.tab === 'businesses'\) return <div [^>]*>\{businesses\}<\/div>;/);
  assert.match(read('frontend/src/pages/admin/ConsolePages.jsx'), /people=\{<KycConsole \/>\} businesses=\{<KycBusinesses \/>\} \/>/);
  assert.match(read('frontend/src/App.jsx'), /<Route path="\/admin\/kyc\/businesses\/:id" element=\{guard\(\['admin'\], <KycPage \/>\)\} \/>/);
  assert.match(read('frontend/test/admin_route_reachability.test.mjs'), /kyc\/KycBusinesses\.jsx/);
  assert.match(read('frontend/src/lib/api/kyb.js'), /documentBlob: \(id, documentId\) => fetchKycDocument\(/);
  assert.match(read('documentation/architecture/decisions/D1234.md'), /## D1234/);
  assert.match(read('documentation/architecture/ROUTE_MAP.md'), /D1234/);
  assert.match(read('frontend/src/pages/admin/kyc/README.md'), /BusinessCase\.jsx/);
});
