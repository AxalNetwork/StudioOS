/**
 * D970 (#2755) — the Spin-Out Lab's Hosts (SL9), Formation (SL10, SL10d) and
 * Graduation (SL11, SL11r) tabs, drawn to the canvas on the reads that exist.
 * What this file holds them to:
 *   · the canvas's words: Waiting, Declined, Removed; Paid, Packet in
 *     progress; Awaiting issue; "by an admin";
 *   · counts from the Worker, never from a capped list; a list at its cap
 *     says so; a failed read says Unreadable with a retry and never "none";
 *   · Emailed and Downloaded as "Not recorded" with their lines;
 *   · every write in an in-page dialog with nothing preselected, its refusal
 *     inside it, and no browser pop-up; Revoke needs a reason;
 *   · the Lab-ventures switch is not drawn, and nothing filters by venture.
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
import { codeOnly } from './_codeOnly.mjs';
import AdminLab from '../src/pages/admin/lab/AdminLab.jsx';
import {
  backfillLine, calendarDay, canRecordReview, etDay, etToday, filedOnProblem, filterGrads, filterHosts, filterOrders, filterReviews,
  gradRows, gradTiles, hostCounts, hostDecisions, hostDialog, hostRow, jurisdictionWord, orderRow, orderStep, refusalText, reviewRow,
} from '../src/pages/admin/lab/labDesksModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;
const NOW = Date.parse('2026-11-10T15:00:00Z'); // 10 Nov, 10:00 ET
const ready = (data) => ({ status: 'ready', data, error: null });
const failed = () => ({ status: 'error', data: null, error: { status: 503 } });
const loading = () => ({ status: 'loading', data: null, error: null });

// GET /api/admin/lab-hosts — one application.
const host = (uid, o = {}) => ({
  uid, host_kind: 'partner', capacity: 'investor', statement: 'I back pre-seed hardware.', status: 'pending', reviewed_at: null, review_note: null,
  created_at: '2026-11-08 14:00:00', applicant_user_id: 40, applicant_name: `Applicant ${uid}`, applicant_email: `${uid}@example.com`,
  applicant_role: 'partner', profile_name: `Host ${uid}`, profile_company: `Company ${uid}`, reviewed_by_name: 'Admin A', ...o,
});
// GET /api/admin/83b-review — one startup.
const startup = (id, o = {}) => ({ project_id: id, project_name: `Startup ${id}`, trackers: 1, operator: null, last_review: null, next_follow_up: null, ...o });
// GET /api/admin/incorporations — one order.
const order = (id, o = {}) => ({
  id, project_id: 100 + id, project_name: `Project ${id}`, user_id: 9, company_name: `Company ${id} Inc.`, jurisdiction_id: 'delaware', status: 'paid',
  paid_at: '2026-11-04 12:00:00', packet_document_id: null, packet_ready_at: null, filed_on: null, filed_recorded_at: null,
  documents: [{ id: 501, title: 'Certificate of incorporation draft.pdf' }, { id: 502, title: 'Packet.pdf' }], ...o,
});
// GET /api/spinout-lab/certificates — one row.
const cert = (id, o = {}) => ({
  id, user_id: 300 + id, credential_id: `AXL-SOL-C4-0${id}`, status: 'issued', public_token: `tok${id}`, public_share_enabled: 1,
  public_name: `Grad ${id}`, public_company: `Co ${id}`, public_issued_on: '2026-10-30', issued_at: '2026-10-30 10:00:00', ...o,
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('days are the Lab\'s clock: a stored stamp is UTC and drawn as its ET day; a calendar date is itself', () => {
  assert.equal(etDay('2026-11-08 03:30:00', NOW), '7 Nov', '03:30 UTC is still the 7th in New York');
  assert.equal(etDay('2025-12-31 12:00:00', NOW), '31 Dec 2025', 'another year says its year');
  assert.equal(calendarDay('2026-11-17', NOW), '17 Nov');
  assert.equal(etToday(Date.parse('2026-11-11T03:00:00Z')), '2026-11-10');
  assert.equal(etDay(null, NOW), null);
});

test('Hosts: the canvas\'s words, the Worker\'s decisions, and "by an admin"', () => {
  assert.deepEqual(['pending', 'approved', 'rejected', 'withdrawn', 'revoked'].map((s) => hostRow(host('a', { status: s }), NOW).status.word),
    ['Waiting', 'Approved', 'Declined', 'Withdrawn', 'Removed']);
  assert.deepEqual(hostDecisions('pending'), ['approve', 'reject']);
  assert.deepEqual(hostDecisions('approved'), ['revoke']);
  assert.deepEqual(hostDecisions('withdrawn'), []);
  assert.equal(hostRow(host('a', { status: 'approved', reviewed_at: '2026-11-05 15:00:00' }), NOW).reviewed.text, 'Approved by an admin 5 Nov');
  assert.equal(hostRow(host('a'), NOW).reviewed.text, 'Not reviewed yet', 'no dash for a value that is not there');
  assert.equal(hostRow(host('a', { profile_name: null, applicant_name: 'Ada' }), NOW).name, 'Ada');
  assert.equal(hostRow(host('a', { capacity: 'advisor' }), NOW).appliedAs, 'Advisor');
  const d = hostDialog('approve', hostRow(host('a', { capacity: 'advisor' }), NOW));
  assert.equal(d.title, 'Approve Host a as a host?');
  assert.equal(d.body, 'Host a will appear to Lab founders on Office Hours, as an advisor.');
  assert.equal(hostDialog('reject', hostRow(host('a'), NOW)).action, 'Decline');
  assert.equal(hostDialog('revoke', hostRow(host('a'), NOW)).action, 'Remove');
});

test('Hosts: counts are the Worker\'s, and none while unread; search, Applied as and Waiting longest', () => {
  assert.equal(hostCounts(loading()), null);
  assert.equal(hostCounts(failed()), null);
  assert.deepEqual(hostCounts(ready({ items: [], counts: { pending: 2, approved: 9, rejected: 1, withdrawn: 0, revoked: 1 } })), { pending: 2, approved: 9, rejected: 1, withdrawn: 0, revoked: 1 });
  assert.equal(hostCounts(ready({ items: [], counts: { pending: 3 } })).approved, null, 'a count the Worker did not send is not a zero');
  const rows = [host('a', { created_at: '2026-11-08 10:00:00' }), host('b', { created_at: '2026-11-01 10:00:00', capacity: 'advisor', profile_company: 'Acme' }), host('c', { created_at: '2026-11-09 10:00:00' })].map((a) => hostRow(a, NOW));
  assert.deepEqual(filterHosts(rows).map((r) => r.uid), ['b', 'a', 'c'], 'waiting longest first');
  assert.deepEqual(filterHosts(rows, { sort: 'newest' }).map((r) => r.uid), ['c', 'a', 'b']);
  assert.deepEqual(filterHosts(rows, { q: 'acme' }).map((r) => r.uid), ['b'], 'search reads the company');
  assert.deepEqual(filterHosts(rows, { appliedAs: 'investor' }).map((r) => r.uid).sort(), ['a', 'c']);
});

test('Formation: the 83(b) row, its filters, and a review only with an outcome and an operator', () => {
  const r = reviewRow(startup(1, { operator: { user_id: 7, name: 'Admin A' }, last_review: { outcome: 'incomplete', reviewed_at: '2026-11-03 14:00:00', note: null }, next_follow_up: '2026-11-17' }), NOW);
  assert.deepEqual([r.operator.name, r.last.outcome.word, r.last.day, r.followUp], ['Admin A', 'Incomplete', '3 Nov', '17 Nov']);
  const none = reviewRow(startup(2), NOW);
  assert.deepEqual([none.operator, none.last, none.followUp, none.followUpReason], [null, null, null, 'No review yet.']);
  const rows = [r, none, reviewRow(startup(3, { operator: { user_id: 8, name: 'Admin B' }, last_review: { outcome: 'complete', reviewed_at: '2026-11-07 14:00:00' }, next_follow_up: '2026-11-12' }), NOW)];
  assert.deepEqual(filterReviews(rows).map((x) => x.id), [3, 1, 2], 'next follow-up soonest, none last');
  assert.deepEqual(filterReviews(rows, { operator: 'unassigned' }).map((x) => x.id), [2]);
  assert.deepEqual(filterReviews(rows, { operator: '7' }).map((x) => x.id), [1]);
  assert.deepEqual(filterReviews(rows, { last: 'none' }).map((x) => x.id), [2]);
  assert.equal(canRecordReview({ busy: false, outcome: '', operator: r.operator }), false, 'nothing is preselected, so nothing is sent');
  assert.equal(canRecordReview({ busy: false, outcome: 'complete', operator: null }), false);
  assert.equal(canRecordReview({ busy: false, outcome: 'complete', operator: r.operator }), true);
});

test('Formation: the order row in the canvas\'s words, the next step, and a filing date the Worker would take', () => {
  assert.deepEqual(['paid', 'packet_processing', 'packet_ready', 'filed'].map((s) => orderRow(order(1, { status: s }), NOW).status.word), ['Paid', 'Packet in progress', 'Packet ready', 'Filed']);
  assert.deepEqual(['paid', 'packet_processing', 'packet_ready', 'filed'].map(orderStep), ['packet', 'packet', 'filed', null]);
  const r = orderRow(order(1, { status: 'packet_ready', packet_document_id: 502 }), NOW);
  assert.deepEqual([r.jurisdiction, r.paid, r.packet.title, r.paidDay], ['Delaware', '4 Nov', 'Packet.pdf', '2026-11-04']);
  assert.equal(jurisdictionWord('new_york'), 'New York');
  assert.equal(jurisdictionWord(''), 'Not recorded');
  assert.equal(filedOnProblem('2026-11-03', { paidDay: r.paidDay, now: NOW }), 'The filing date is before the order was paid.');
  assert.equal(filedOnProblem('2026-11-11', { paidDay: r.paidDay, now: NOW }), 'The filing date is in the future.');
  assert.equal(filedOnProblem('2026-11-10', { paidDay: r.paidDay, now: NOW }), null);
  const rows = [order(1, { paid_at: '2026-11-01 10:00:00' }), order(2, { jurisdiction_id: 'wyoming', status: 'filed' }), order(3, { paid_at: '2026-11-09 10:00:00' })].map((o) => orderRow(o, NOW));
  assert.deepEqual(filterOrders(rows).map((x) => x.id), [3, 2, 1]);
  assert.deepEqual(filterOrders(rows, { jurisdiction: 'wyoming' }).map((x) => x.id), [2]);
  assert.deepEqual(filterOrders(rows, { status: 'filed' }).map((x) => x.id), [2]);
});

test('Graduation: awaiting first, Emailed and Downloaded Not recorded with their lines, and a failed graduate read is never zero', () => {
  const data = { certificates: [cert(1), cert(2, { status: 'revoked', public_share_enabled: 0 })], awaiting: [{ user_id: 77, name: 'Wren', conferred_at: '2026-11-02 12:00:00' }], eligible_total: 3, unavailable: {} };
  const rows = gradRows(data, NOW);
  assert.deepEqual(rows.map((r) => [r.name, r.status.word, r.action]), [['Wren', 'Awaiting issue', 'issue'], ['Grad 1', 'Issued', 'revoke'], ['Grad 2', 'Revoked', null]]);
  assert.equal(rows[1].graduated, '30 Oct', 'a calendar date keeps its day');
  const t = Object.fromEntries(gradTiles(ready(data)).map((x) => [x.key, x]));
  assert.deepEqual([t.eligible.value, t.issued.value, t.issued.sub], ['3', '1', '1 revoked since']);
  assert.deepEqual([t.emailed.state, t.emailed.reason], ['unrecorded', 'No email is sent for a certificate yet.']);
  assert.deepEqual([t.downloaded.state, t.downloaded.reason], ['unrecorded', 'The certificate is built in the graduate’s browser.']);
  const blind = Object.fromEntries(gradTiles(ready({ ...data, awaiting: null, eligible_total: null, unavailable: { awaiting: 'The graduate list could not be read.' } })).map((x) => [x.key, x]));
  assert.equal(blind.eligible.state, 'unreadable');
  assert.deepEqual(gradTiles(failed()).slice(0, 2).map((x) => x.state), ['unreadable', 'unreadable']);
  const capped = Object.fromEntries(gradTiles(ready({ ...data, certificates: Array.from({ length: 500 }, (_, i) => cert(i + 1)) })).map((x) => [x.key, x]));
  assert.deepEqual([capped.issued.value, capped.issued.cover], ['500+', 'Counted over the newest 500 certificates.']);
  assert.deepEqual(filterGrads(rows, { publicPage: 'on' }).map((r) => r.name), ['Grad 1']);
  const older = gradRows({ ...data, awaiting: [{ user_id: 78, name: 'Ash', conferred_at: '2026-09-01 12:00:00' }] }, NOW);
  assert.equal(filterGrads(older)[0].name, 'Ash', 'a graduate waiting for a certificate comes first, however long ago they graduated');
  assert.equal(backfillLine({ scanned: 4, issued: 3, skipped: 1, remaining: 0 }), 'After Issue all eligible: 3 issued · 1 could not be issued: no name or date on record, or a revoked certificate holds the ID.');
});

test('a refusal is the Worker\'s sentence or the page\'s words for its code, never a bare code', () => {
  assert.equal(refusalText({ code: 'reissue_blocked' }, { reissue_blocked: 'No reissue.' }), 'No reissue.');
  assert.equal(refusalText({ data: { message: 'This application is approved; approve applies only to a pending one.' } }), 'This application is approved; approve applies only to a pending one.');
  assert.equal(refusalText({ message: 'some_code' }), 'The change was not saved. Nothing changed.');
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

function worker(o = {}) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const pick = (v, ...a) => { const out = typeof v === 'function' ? v(...a) : v; return out instanceof Response ? out : json(out); };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = String(init.method || 'GET').toUpperCase();
    if (u.pathname !== '/api/client-error') calls.push({ method, path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null });
    const p = u.pathname;
    if (method !== 'GET') {
      const w = (o.writes || {})[p];
      return w ? pick(w) : json({ ok: true });
    }
    if (p === '/api/admin/lab-hosts') return pick(o.hosts ?? { status: u.searchParams.get('status'), items: [], counts: { pending: 0, approved: 0, rejected: 0, withdrawn: 0, revoked: 0 } }, u.searchParams.get('status'));
    if (p === '/api/admin/83b-review') return pick(o.review ?? { startups: [], operators: [] });
    if (p === '/api/admin/incorporations') return pick(o.orders ?? { orders: [] });
    if (p === '/api/spinout-lab/certificates') return pick(o.certs ?? { certificates: [], awaiting: [], eligible_total: 0, unavailable: {} });
    return json({});
  };
  return calls;
}

async function mount(url, o) {
  const original = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, prompt: globalThis.prompt, confirm: globalThis.confirm };
  const restore = installDocument();
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  let popups = 0;
  globalThis.prompt = () => { popups += 1; return 'x'; };
  globalThis.confirm = () => { popups += 1; return true; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const calls = worker(o);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => { rootNode.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminLab))); });
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const ev = { preventDefault() {}, stopPropagation() {} };
  return {
    calls, popups: () => popups,
    has: (id) => Boolean(byId(id)),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    props: (id) => props(byId(id)),
    text: () => textOf(container),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(ev); }); await flush(); },
    async type(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async choose(id) { await act(async () => { props(byId(id)).onChange({ target: { checked: true } }); }); await flush(); },
    async close() {
      await act(async () => rootNode.unmount());
      Object.assign(globalThis, original);
      restore();
    },
  };
}

const HOSTS = (status) => ({
  status,
  items: status === 'pending' ? [host('h1'), host('h2', { capacity: 'advisor', created_at: '2026-11-01 10:00:00' })]
    : status === 'approved' ? [host('h3', { status: 'approved', reviewed_at: '2026-11-05 15:00:00' })] : [],
  counts: { pending: 2, approved: 9, rejected: 1, withdrawn: 0, revoked: 1 },
});

test('mounted Hosts: chips with the Worker\'s counts, the rows, and Approve in a dialog with an optional note', async () => {
  const v = await mount('/admin/programs/spinout-lab/hosts', { hosts: HOSTS });
  try {
    assert.equal(v.of('lab-hosts-chip-pending').replace(/\s+/g, ''), '◷Waiting2');
    assert.equal(v.of('lab-hosts-count-rejected'), '1');
    assert.equal(v.props('lab-hosts-chip-pending')['aria-pressed'], true, 'Waiting is the first chip, and on');
    assert.ok(v.has('lab-host-row-h1') && v.has('lab-host-row-h2'));
    assert.ok(v.has('lab-host-card-h1'), 'and a card per host on a phone');
    assert.ok(!v.has('admin-lab-hosts'), 'the old console is not mounted');
    await v.click('lab-host-approve-h1');
    assert.equal(v.of('lab-host-dialog-body'), 'Host h1 will appear to Lab founders on Office Hours, as an investor.');
    await v.type('lab-host-dialog-note', 'Welcome aboard.');
    await v.click('lab-host-dialog-approve-go');
    const post = v.calls.find((c) => c.method !== 'GET');
    assert.deepEqual([post.path, post.body], ['/api/admin/lab-hosts/h1/decision', { decision: 'approve', note: 'Welcome aboard.' }]);
    assert.ok(v.has('lab-host-dialog-approve-result'), 'the result stays in the dialog until Done');
    await v.click('lab-host-dialog-approve-done');
    assert.ok(!v.has('lab-host-dialog-approve'));
    await v.click('lab-hosts-chip-approved');
    assert.ok(v.calls.some((c) => c.path === '/api/admin/lab-hosts?status=approved'), 'a chip reads its status');
    assert.match(v.of('lab-host-row-h3'), /Approved by an admin 5 Nov( 2026)?/);
    assert.ok(v.has('lab-host-revoke-h3'));
    assert.equal(v.popups(), 0, 'no browser pop-up');
  } finally { await v.close(); }
});

test('mounted Hosts: a refused decision is said in the dialog; a failed read is Unreadable, never "No one is waiting"', async () => {
  const v = await mount('/admin/programs/spinout-lab/hosts', {
    hosts: HOSTS,
    writes: { '/api/admin/lab-hosts/h1/decision': () => new Response(JSON.stringify({ error: 'not_decidable', code: 'not_decidable', message: 'This application is approved; reject applies only to a pending one.' }), { status: 409, headers: { 'Content-Type': 'application/json' } }) },
  });
  try {
    await v.click('lab-host-reject-h1');
    await v.click('lab-host-dialog-reject-go');
    assert.equal(v.of('lab-host-dialog-reject-refusal'), 'This application is approved; reject applies only to a pending one.');
    assert.ok(v.has('lab-host-dialog-reject-go'), 'the dialog stays open on a refusal');
  } finally { await v.close(); }
  const down = await mount('/admin/programs/spinout-lab/hosts', { hosts: () => new Response('{}', { status: 503 }) });
  try {
    assert.ok(down.has('lab-hosts-read-unreadable'));
    assert.match(down.of('lab-hosts-read-unreadable'), /The host applications could not be read\. No host is shown as waiting while they cannot be read\./);
    assert.ok(!down.has('lab-hosts-empty') && !down.has('lab-hosts-count-pending'), 'no "none" and no zero count');
  } finally { await down.close(); }
  const many = await mount('/admin/programs/spinout-lab/hosts', { hosts: { items: Array.from({ length: 500 }, (_, i) => host(`x${i}`)), counts: { pending: 612 } } });
  try {
    assert.equal(many.of('lab-hosts-cap'), 'The newest 500 waiting applications. Search and sort cover only these.');
    assert.equal(many.of('lab-hosts-count-pending'), '612', 'the chip counts every one, not the loaded page');
    assert.ok(!many.has('lab-hosts-count-approved'), 'a count the Worker did not send draws nothing');
  } finally { await many.close(); }
});

const REVIEW = {
  startups: [
    startup(1, { operator: { user_id: 7, name: 'Admin A' }, last_review: { outcome: 'complete', reviewed_at: '2026-11-07 14:00:00' } }),
    startup(2),
  ],
  operators: [{ id: 7, name: 'Admin A', email: 'a@example.com' }, { id: 8, name: 'Admin B', email: 'b@example.com' }],
};

test('mounted Formation: both desks, no venture switch, and a review recorded with nothing preselected', async () => {
  const v = await mount('/admin/programs/spinout-lab/formation', { review: REVIEW, orders: { orders: [order(1), order(2, { status: 'packet_ready', packet_document_id: 502 })] } });
  try {
    assert.ok(v.has('lab-83b-table') && v.has('lab-orders-table'));
    assert.match(v.of('lab-formation-note'), /These two desks also serve startups outside the Lab\./);
    assert.doesNotMatch(v.text(), /Lab ventures ·|All startups/, 'the switch waits for part 4');
    assert.match(v.of('lab-83b-row-1'), /Complete7 Nov( 2026)? · an admin/);
    assert.match(v.of('lab-83b-row-2'), /Unassigned/);
    await v.click('lab-83b-record-1');
    assert.equal(v.props('lab-83b-review-outcome-complete').checked, false);
    assert.equal(v.props('lab-83b-review-outcome-incomplete').checked, false, 'no outcome is preselected');
    assert.equal(v.props('lab-83b-review-date').value, '', 'no date is prefilled');
    assert.equal(v.props('lab-83b-review-go').disabled, true, 'nothing is sent until an outcome is chosen');
    await v.choose('lab-83b-review-outcome-incomplete');
    await v.type('lab-83b-review-date', '2026-12-01');
    await v.click('lab-83b-review-go');
    const post = v.calls.find((c) => c.method === 'POST');
    assert.deepEqual([post.path, post.body], ['/api/admin/83b-review/projects/1/reviews', { outcome: 'incomplete', note: null, follow_up_date: '2026-12-01' }]);
    await v.click('lab-83b-review-done');
    await v.click('lab-83b-record-2');
    assert.ok(v.has('lab-83b-review-no-operator'), 'an unassigned startup says to assign first');
  } finally { await v.close(); }
});

test('mounted Formation: the operator is assigned in a dialog; the packet and the filing date each in theirs', async () => {
  // Mounted on the real clock, so the order was paid well before today.
  const v = await mount('/admin/programs/spinout-lab/formation', { review: REVIEW, orders: { orders: [order(1), order(2, { status: 'packet_ready', packet_document_id: 502, paid_at: '2026-01-15 12:00:00' })] } });
  try {
    await v.click('lab-83b-assign-2');
    assert.equal(v.props('lab-83b-assign-pick').value, '', 'no admin is preselected');
    await v.type('lab-83b-assign-pick', '8');
    await v.click('lab-83b-assign-go');
    assert.deepEqual(v.calls.filter((c) => c.method !== 'GET').at(-1), { method: 'PUT', path: '/api/admin/83b-review/projects/2/operator', body: { operator_user_id: 8 } });
    await v.click('lab-83b-assign-done');
    await v.click('lab-order-packet-1');
    assert.ok(['501', '502'].every((d) => v.props(`lab-order-packet-doc-${d}`).checked === false), 'no document is preselected');
    assert.equal(v.props('lab-order-packet-go').disabled, true);
    await v.choose('lab-order-packet-doc-502');
    await v.click('lab-order-packet-go');
    assert.deepEqual(v.calls.filter((c) => c.method === 'POST').at(-1), { method: 'POST', path: '/api/admin/incorporations/1/packet-ready', body: { document_id: 502 } });
    await v.click('lab-order-packet-done');
    await v.click('lab-order-filed-2');
    assert.equal(v.props('lab-order-filed-date').value, '', 'no date is prefilled');
    await v.type('lab-order-filed-date', '2026-01-14');
    assert.equal(v.of('lab-order-filed-problem'), 'The filing date is before the order was paid.');
    assert.equal(v.props('lab-order-filed-go').disabled, true);
  } finally { await v.close(); }
});

test('mounted Formation: one desk failing leaves the other standing', async () => {
  const v = await mount('/admin/programs/spinout-lab/formation', { review: () => new Response('{}', { status: 503 }), orders: { orders: [order(1)] } });
  try {
    assert.ok(v.has('lab-83b-read-unreadable'));
    assert.match(v.of('lab-83b-read-unreadable'), /The 83\(b\) review list could not be read\. No startup is shown as unassigned while it cannot be read\./);
    assert.ok(!v.has('lab-83b-empty'));
    assert.ok(v.has('lab-order-row-1'), 'the orders still draw');
  } finally { await v.close(); }
});

const CERTS = { certificates: [cert(1), cert(2, { status: 'revoked', public_share_enabled: 0 })], awaiting: [{ user_id: 77, name: 'Wren', conferred_at: '2026-11-02 12:00:00' }], eligible_total: 3, unavailable: {} };

test('mounted Graduation: the tiles, Not recorded columns, Issue all eligible with its result, and Revoke with a required reason', async () => {
  const v = await mount('/admin/programs/spinout-lab/graduation', { certs: CERTS, writes: { '/api/spinout-lab/certificates/backfill': { scanned: 1, issued: 1, skipped: 0, remaining: 0 } } });
  try {
    assert.match(v.of('lab-tile-eligible'), /Eligible3/);
    assert.match(v.of('lab-tile-issued'), /Issued11 revoked since/);
    assert.match(v.of('lab-tile-emailed'), /Not recordedNo email is sent for a certificate yet\./);
    assert.match(v.of('lab-tile-downloaded'), /Not recordedThe certificate is built in the graduate’s browser\./);
    assert.match(v.of('lab-grad-row-cert-1'), /Not recordedNot recorded/, 'Emailed and Downloaded are never counted');
    assert.equal(v.of('lab-grad-issue-all-line'), '1 graduate is waiting for a certificate.');
    await v.click('lab-grad-issue-all-open');
    await v.click('lab-cert-all-go');
    assert.deepEqual(v.calls.filter((c) => c.method === 'POST').at(-1), { method: 'POST', path: '/api/spinout-lab/certificates/backfill', body: { limit: 100 } });
    assert.equal(v.of('lab-cert-all-result'), 'After Issue all eligible: 1 issued.');
    await v.click('lab-cert-all-done');
    assert.equal(v.of('lab-grad-issue-all-line'), 'After Issue all eligible: 1 issued.', 'the result stays on the page');
    await v.click('lab-cert-revoke-1');
    assert.equal(v.props('lab-cert-revoke-go').disabled, true, 'a reason is required');
    await v.type('lab-cert-revoke-reason', 'Issued in error.');
    await v.click('lab-cert-revoke-go');
    assert.deepEqual(v.calls.filter((c) => c.method === 'POST').at(-1), { method: 'POST', path: '/api/spinout-lab/certificates/1/revoke', body: { reason: 'Issued in error.' } });
    assert.equal(v.popups(), 0, 'Revoke never asks through a browser pop-up');
  } finally { await v.close(); }
});

test('mounted Graduation: a failed read is Unreadable and the tiles say so; an unread graduate list is said, not zero', async () => {
  const down = await mount('/admin/programs/spinout-lab/graduation', { certs: () => new Response('{}', { status: 503 }) });
  try {
    assert.ok(down.has('lab-grad-read-unreadable'));
    assert.match(down.of('lab-tile-eligible'), /could not be read/);
    assert.ok(!down.has('lab-grad-empty'));
    assert.equal(down.props('lab-grad-issue-all-open').disabled, true);
  } finally { await down.close(); }
  const blind = await mount('/admin/programs/spinout-lab/graduation', { certs: { ...CERTS, awaiting: null, eligible_total: null, unavailable: { awaiting: 'The graduate list could not be read, so who is still waiting for a certificate is unknown.' } } });
  try {
    assert.match(blind.of('lab-grad-awaiting-unread'), /^The graduate list could not be read/);
    assert.equal(blind.of('lab-grad-issue-all-line'), 'Who is still waiting for a certificate could not be read.');
    assert.equal(blind.props('lab-grad-issue-all-open').disabled, true);
  } finally { await blind.close(); }
});

test('the source: no browser pop-up, no bare dash, no venture filter in the browser, and the tabs no longer mount the old consoles', () => {
  const files = ['LabHosts.jsx', 'LabFormation.jsx', 'LabGraduation.jsx', 'labParts.jsx', 'labDesksModel.js'].map((f) => codeOnly(read(`frontend/src/pages/admin/lab/${f}`))).join('\n');
  assert.doesNotMatch(files, /window\.(prompt|confirm|alert)|\balert\(|useToast|dangerouslySetInnerHTML/);
  assert.doesNotMatch(files, /'—'|"—"|>—</, 'no bare dash stands in for a value');
  assert.doesNotMatch(files, /venture_id|lab_venture|isLabVenture/, 'nothing filters by venture until part 4');
  const lab = read('frontend/src/pages/admin/lab/AdminLab.jsx');
  assert.match(lab, /const DESKS = \{ hosts: LabHosts, formation: LabFormation, graduation: LabGraduation,/);
  assert.doesNotMatch(lab, /hosts: \['hosts'\]|formation: \['review83b'|graduation: \['certificates'\]/);
});
