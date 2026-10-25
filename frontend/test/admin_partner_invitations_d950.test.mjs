/**
 * D950 (#2726, part 7 of #2370) — Invitations complete: the tab on part 3's
 * server list (D926), the Email column, Export CSV, one invitation on part
 * 4's read (D927), New invitation's offer cards and lookup, Resend's
 * `signing_link`, and the phone layout (PI11b–c).
 *
 * What this file holds the page to:
 *   · every filter, the sort and the page are the Worker's, one debounced
 *     request per change, and a late reply for old filters is dropped;
 *   · the total is exact, so nothing says what it covered;
 *   · the Email column says Sent, Not sent with its reason, or Not recorded;
 *   · the CSV is the current view, every page of it, and never carries the
 *     invitation link or its token; a page that fails makes no file;
 *   · each step date with and without its row, the offers seen, the chosen
 *     deal, the refusals and the history, each block alone;
 *   · the dialog's five cards from the preview, and the lookup's warnings.
 * The fixtures are invented, in the Worker's shapes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PartnerInvitations from '../src/pages/admin/PartnerInvitations.jsx';
import { invitationRow, stageOf } from '../src/pages/admin/partners/partnersDeskModel.js';
import {
  CSV_COLUMNS, EXPORT_FAILED, NOT_RECORDED_SEND, PREVIEW_ASKS, PREVIEW_FAILED, blockOf, chosenDeal, csvCell, emailCell, historyLines,
  invitersOf, listReply, offersSeen, previewFor, previewReply, refusalLines, sendLine, serverPage, stepRows, toCsv,
} from '../src/pages/admin/partners/invitationsModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;
const NOW = Date.parse('2026-10-24T12:00:00Z');
const DAY = 86_400_000;
const d1 = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const isoAt = (ms) => new Date(ms).toISOString();
const ready = (data) => ({ status: 'ready', data, error: null });
const failed = (error = { status: 503 }) => ({ status: 'error', data: null, error });
const loading = () => ({ status: 'loading', data: null, error: null });

// GET /api/admin/partners/invitations — one row (D926), with part 1's send columns (D924).
const inv = (id, o = {}, now = NOW) => {
  const { createdMs = now - 4 * DAY, ...rest } = o;
  return {
    id, token: `tok${id}`, recipient_email: `p${id}@example.com`, recipient_name: `Partner ${id}`, allowed_deal_types: ['services_partnership'],
    status: 'sent', expires_at: isoAt(createdMs + 14 * DAY + 400), created_at: d1(createdMs), viewed_at: null, signed_at: null,
    resulting_user_id: null, resulting_deal_id: null, envelope_id: null, revoked_at: null, invited_by_name: 'Admin A', invited_by_user_id: 41,
    last_sent_at: isoAt(createdMs), send_count: 1, last_send_ok: 1, last_send_reason: null, personal_message: null,
    link: `https://axal.vc/partners/onboard?token=tok${id}`, is_expired: false, ...rest,
  };
};
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the Email column: Sent, Not sent with its reason, or Not recorded for a row from before migration 547', () => {
  assert.deepEqual(emailCell(inv(1)), { key: 'sent', text: 'Sent', title: 'Sent 20 Oct 2026', reason: null });
  assert.equal(emailCell(inv(1, { last_send_ok: true })).key, 'sent', 'a boolean from SQLite reads the same');
  for (const [reason, words] of [['suppressed', 'the address is suppressed'], ['not_configured', 'email is not set up'], ['refused', 'the mail service refused it'], ['failed', 'the send failed']]) {
    const c = emailCell(inv(2, { last_send_ok: 0, last_send_reason: reason }));
    assert.deepEqual([c.key, c.text, c.reason, c.title], ['not_sent', 'Not sent', words, `Not sent 20 Oct 2026: ${words}`], reason);
  }
  assert.equal(emailCell(inv(3, { last_send_ok: 0, last_send_reason: null })).reason, 'no reason was recorded');
  assert.deepEqual(emailCell(inv(4, { last_send_ok: null })), { key: 'not_recorded', text: 'Not recorded', title: NOT_RECORDED_SEND, reason: null });
  assert.equal(emailCell({}).key, 'not_recorded', 'never "Sent" without a result');
  assert.doesNotMatch(JSON.stringify([emailCell(inv(1)), emailCell(inv(2, { last_send_ok: 0, last_send_reason: 'failed' }))]), /Delivered/);
  assert.equal(sendLine(inv(5, { send_count: 3 })).line, 'Latest send: Sent 20 Oct 2026 · 3 sends');
  assert.equal(sendLine(inv(6, { last_send_ok: 0, last_send_reason: 'refused' })).line, 'Latest send: Not sent 20 Oct 2026, because the mail service refused it · 1 send');
  assert.equal(sendLine(inv(7, { last_send_ok: null })).line, `Latest send: Not recorded. ${NOT_RECORDED_SEND}`);
});

test('the CSV: the current view\'s rows in the canvas\'s words, quoted, formula-safe, and never the link or its token', () => {
  const rows = [
    inv(1, { recipient_name: '=HYPERLINK("x")', status: 'selected' }),
    inv(2, { recipient_name: null, last_send_ok: 0, last_send_reason: 'suppressed', resulting_deal_id: 12, status: 'signed' }),
  ];
  const csv = toCsv(rows, NOW);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], CSV_COLUMNS.map(csvCell).join(','));
  assert.equal(lines.length, 3);
  assert.doesNotMatch(csv, /tok1|tok2|token=|onboard|https?:/, 'no invitation link, no token');
  assert.ok(lines[1].startsWith('"\'=HYPERLINK(""x"")","p1@example.com"'), 'a formula is defused, and quotes are doubled');
  assert.match(lines[1], /"Offer chosen","Sent","","1","Admin A"/);
  assert.match(lines[2], /^"","p2@example\.com".*"Signed","Not sent","the address is suppressed".*"#12"$/, 'no name is an empty cell, never "No name given"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell('-1'), '"\'-1"');
});

test('one step date with and without its row: Not recorded once reached, Not reached past the stage, never a zero', () => {
  const steps = { available: true, sent: '2026-10-01 09:00:00', opened: '2026-10-02 09:00:00', profile_done: null, offers_shown: '2026-10-04 09:00:00',
    offer_chosen_first: '2026-10-05 09:00:00', offer_chosen_latest: '2026-10-07 09:00:00', agreement_out: null, signed: null };
  const at = (status, o = {}) => Object.fromEntries(stepRows({ ...steps, ...o }, stageOf(inv(1, { status }), { now: NOW, repair: false })).map((r) => [r.key, r.value]));
  assert.deepEqual(at('selected'), {
    sent: '1 Oct 2026', opened: '2 Oct 2026', profile_done: 'Not recorded', offers_shown: '4 Oct 2026',
    offer_chosen: 'First 5 Oct 2026 · latest 7 Oct 2026', agreement_out: 'Not reached', signed: 'Not reached',
  });
  assert.equal(at('selected', { offer_chosen_latest: '2026-10-05 09:00:00' }).offer_chosen, '5 Oct 2026', 'one choice, one date');
  assert.equal(at('viewed', { offer_chosen_first: null }).offer_chosen, 'Not reached');
  assert.equal(at('finalized').agreement_out, 'Not recorded', 'reached with no row');
  assert.equal(at('signed').agreement_out, 'Not recorded', 'a closed invitation keeps no stage, so a missing row is only "Not recorded"');
  assert.equal(at('revoked').signed, 'Not reached', 'a revoked invitation was never signed');
  assert.equal(at('revoked').agreement_out, 'Not recorded');
  const down = stepRows({ available: false, unreadable: true, reason: 'The step dates could not be read on this database. That is not the same as none.' }, stageOf(inv(1), { now: NOW }));
  assert.ok(down.every((r) => r.value === 'Could not be read' && r.failed), 'a failed block is said on every step, never as "Not reached"');
  assert.deepEqual(blockOf(undefined), { state: 'unreadable', reason: null });
});

test('the record\'s other blocks: the offers seen, the chosen deal, the refusals and the history, each alone', () => {
  const who = inv(1, { recipient_name: 'Ada Placeholder-Row' });
  assert.equal(offersSeen({ available: true, shown: false, offers: null }, who).state, 'not_shown');
  assert.match(offersSeen({ available: true, shown: false, offers: null }, who).text, /^Ada Placeholder-Row has not asked for offers yet/);
  const seen = offersSeen({ available: true, shown: true, offers: [{ deal_type: 'equity_partnership', label: 'Equity Partnership', summary: 'S.', terms: { equity_pct: '1%', time_commitment: '8 hrs/month' }, term_months: 24 }] }, who);
  assert.deepEqual(seen.offers[0].terms.map((t) => [t.label, t.value]), [['Equity', '1%'], ['Time', '8 hrs/month']]);
  assert.equal(seen.offers[0].term, '24 months');
  assert.deepEqual(offersSeen({ available: false, reason: 'R' }, who), { state: 'unreadable', reason: 'R' });
  assert.equal(chosenDeal({ available: true, deal: null, envelope: null }).state, 'none');
  const chosen = chosenDeal({ available: true, deal: { id: 9, deal_type: 'custom', proposal: { label: 'Custom', summary: 'Ours.' } }, envelope: { id: 3 } });
  assert.deepEqual([chosen.state, chosen.offer.label, chosen.envelope.id], ['ready', 'Custom', 3]);
  assert.equal(chosenDeal({ available: false, reason: 'down' }).state, 'unreadable');
  assert.deepEqual(refusalLines({ available: true, items: [{ at: '2026-10-09 10:00:00', code: 'template_fields_unfilled', fields: ['counterparty.name'] }] }).lines.map((l) => l.text),
    ['Could not be sent 9 Oct 2026: the agreement names fields the send leaves empty (counterparty.name).']);
  assert.deepEqual(refusalLines({ available: true, items: [] }).lines, []);
  const hist = historyLines({ available: true, items: [
    { at: '2026-10-01 09:00:00', action: 'created', by: 'Admin A', email_sent: true },
    { at: '2026-10-06 09:00:00', action: 'resent', by: null, email_sent: false, signing_link: 'not_renewed' },
    { at: '2026-10-03 09:00:00', action: 'resent', by: 'Admin B', email_sent: null },
    { at: '2026-10-08 09:00:00', action: 'revoked', by: 'Admin A', reason: 'Wrong person' },
    { at: '2026-10-07 09:00:00', action: 'resent', by: 'Admin A', email_sent: true, signing_link: null },
  ], signing_link_renewals: [{ at: '2026-10-06 09:00:01', by: 'Admin B', renewed: false, previous_link_restored: true }] });
  assert.deepEqual(hist.lines.map((l) => l.text), [
    'Sent by Admin A · 1 Oct 2026 · email sent',
    'Resent by Admin B · 3 Oct 2026 · email result not recorded',
    'Resent by an admin not recorded · 6 Oct 2026 · email not sent · renewing the signing link failed, so the link already sent still stands',
    'Signing link renewal failed; the earlier link was restored by Admin B · 6 Oct 2026',
    'Resent by Admin A · 7 Oct 2026 · email sent · no signature was pending, so the onboarding email went',
    'Revoked by Admin A · 8 Oct 2026 · reason: Wrong person',
  ], 'oldest first, with who, when and the send result');
  assert.equal(historyLines({ available: false, reason: 'H' }).state, 'unreadable');
});

test('the list and the record draw the stored stage: Guard I\'s repair is not applied (D924 keeps the stage)', () => {
  const row = inv(1, { status: 'viewed', envelope_id: 5 });
  assert.equal(invitationRow(row, { now: NOW, repair: false }).stage.stageWord, 'Opened', 'drawn as stored');
  assert.equal(invitationRow(row, { now: NOW }).stage.stageWord, 'Agreement out', 'the other tabs keep the repair until their parts');
  const resent = inv(2, { status: 'sent', createdMs: NOW - 20 * DAY, expires_at: isoAt(NOW + 10 * DAY) });
  assert.equal(stageOf(resent, { now: NOW, proposed: failed(), repair: false }).mayLag, false, 'a stored stage never "may lag"');
  assert.equal(stageOf(resent, { now: NOW, proposed: failed() }).mayLag, true, 'where Guard I still runs, an unreadable deal list makes it lag');
});

test('the list\'s helpers: a reply with no total is a failed read; the page, the inviters by id', () => {
  assert.throws(() => listReply({ items: [] }), /total/);
  assert.throws(() => listReply({}), /total/);
  assert.deepEqual(listReply({ items: [1], total: '7' }), { items: [1], total: 7 });
  assert.deepEqual(serverPage({ items: many(25, (i) => i), total: 60 }, 2), { rows: many(25, (i) => i), page: 2, pages: 3, from: 26, to: 50, total: 60 });
  assert.deepEqual(serverPage({ items: many(10, (i) => i), total: 60 }, 3), { rows: many(10, (i) => i), page: 3, pages: 3, from: 51, to: 60, total: 60 });
  assert.deepEqual(serverPage({ items: [], total: 0 }, 1), { rows: [], page: 1, pages: 1, from: 0, to: 0, total: 0 });
  assert.deepEqual(invitersOf([inv(1), inv(2, { invited_by_user_id: 7, invited_by_name: 'Zoe' }), inv(3, { invited_by_user_id: null })], [inv(4, { invited_by_user_id: 7 })]),
    [{ id: '41', name: 'Admin A' }, { id: '7', name: 'Zoe' }], 'by user id, once each; a row with no id is left out');
});

test('the preview: five cards from two asks of three types at most, joined by type; a card with no offer says so', () => {
  assert.deepEqual(PREVIEW_ASKS.map((a) => a.length), [3, 2]);
  assert.deepEqual(PREVIEW_ASKS.flat(), ['equity_partnership', 'services_partnership', 'deal_sourcing_revshare', 'capital_partnership', 'custom']);
  const by = previewReply([
    { offers: [{ deal_type: 'equity_partnership', label: 'Equity Partnership', terms: { equity_pct: '1%' }, profile_dependent: [{ field: 'terms.time_commitment', what: 'equity_hours' }, { field: 'contract_excerpt', what: 'equity_hours' }] }] },
    { offers: [{ deal_type: 'custom', label: 'Custom', terms: {}, profile_dependent: [{ what: 'custom_text' }] }] },
  ]);
  assert.deepEqual(previewFor(ready(by), 'equity_partnership').card.dependent, ['The hours come from their answers.'], 'one line per phrase, said once');
  assert.equal(previewFor(ready(by), 'services_partnership').state, 'none');
  assert.equal(previewFor(failed(), 'custom').state, 'unreadable');
  assert.equal(previewFor(loading(), 'custom').state, 'loading');
  assert.throws(() => previewReply([{ offers: [] }, {}]), /preview/);
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const LIVE = Date.now();
const live = (id, o = {}) => inv(id, o, LIVE);

const detailFor = (row, o = {}) => {
  const { token: _t, link: _l, ...invitation } = row;
  return {
    invitation: { ...invitation, is_lapsed: Boolean(row.is_expired) },
    steps: { available: true, sent: row.created_at, opened: row.viewed_at, profile_done: null, offers_shown: null, offer_chosen_first: null, offer_chosen_latest: null, agreement_out: null, signed: row.signed_at },
    offers_seen: { available: true, shown: false, offers: null },
    chosen_deal: { available: true, deal: null, envelope: null },
    agreement_refusals: { available: true, items: [] },
    history: { available: true, items: [], signing_link_renewals: [] },
    ...o,
  };
};

/** The Worker, as D926 and D927 answer: the list filters by `q` and pages; one invitation; the lookup; the preview. */
function worker({ rows = [], page, details = {}, preview, lookup } = {}) {
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    if (method === 'POST') return response({ ok: true });
    if (path === '/api/admin/partners/invitations') {
      if (page) return page(q);
      const needle = String(q.get('q') || '').toLowerCase();
      const hits = rows.filter((i) => !needle || `${i.recipient_name || ''} ${i.recipient_email}`.toLowerCase().includes(needle));
      const offset = Number(q.get('offset') || 0);
      return response({ items: hits.slice(offset, offset + (q.get('limit') ? Number(q.get('limit')) : 200)), total: hits.length });
    }
    if (path === '/api/admin/partners/invitations/lookup') return lookup ? lookup(q) : response({ open_invitation: null, member: null });
    if (path === '/api/admin/partners/offers/preview') {
      if (preview) return preview(q);
      const types = String(q.get('types') || '').split(',');
      return response({ offers: types.slice(0, 3).map((t) => ({ deal_type: t, label: `Offer ${t}`, summary: `About ${t}.`, terms: { rate: 'Negotiated' }, term_months: 12, profile_dependent: [] })) });
    }
    const one = /^\/api\/admin\/partners\/invitations\/(\d+)$/.exec(path);
    if (one) {
      if (details[one[1]]) return details[one[1]]();
      const row = rows.find((i) => String(i.id) === one[1]);
      return row ? response(detailFor(row)) : response({ error: 'Invitation not found' }, 404);
    }
    if (path === '/api/admin/partners/deals') return response({ items: [], total: 0 });
    if (path === '/api/admin/contracts/partner-deals') return response({ items: [], total: 0, limit: 500, offset: 0 });
    if (path === '/api/admin/partners/links') return response({ accounts: [], firms: [] });
    if (path === '/api/legal/esign/templates/partner_services') return response({ doc_type: 'partner_services', fields: [] });
    if (path === '/api/admin/partners/deals/top') return response({ items: [] });
    if (path === '/api/dd/cases') return response({ items: [] });
    return response({});
  };
}

async function mounted(url, handle, { phone = false } = {}) {
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, URL: globalThis.URL };
  const requests = [];
  const files = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET') }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  // The download: the blob is kept so its text can be read; nothing is written anywhere.
  globalThis.URL = Object.assign(Object.create(previous.URL), { createObjectURL: (blob) => { files.push(blob); return `blob:${files.length}`; }, revokeObjectURL: () => {} });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); if (tag === 'a') n.click = () => {}; return n; };
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(PartnerInvitations), h(Probe))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, files, at, flush,
    text: () => text(container),
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    lists: () => requests.filter((r) => r.url.startsWith('/api/admin/partners/invitations?') && /limit=25/.test(r.url)).map((r) => new URLSearchParams(r.url.split('?')[1])),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async press(label) {
      const node = nodes().find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim() === label);
      assert.ok(node, `no button "${label}"`);
      await act(async () => { await props(node).onClick(event); });
      await flush();
    },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); await flush(); },
    async wait(ms) { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('mounted: the list is the server\'s page with an exact total; Next asks for the next page', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({ rows: many(60, (i) => live(i)) }));
  try {
    assert.equal(view.textOf('partners-inv-range'), '1–25 of 60');
    assert.deepEqual([view.lists().at(-1).get('limit'), view.lists().at(-1).get('offset'), view.lists().at(-1).get('sort')], ['25', null, 'newest']);
    await view.press('Next');
    await view.wait(400);
    assert.equal(view.lists().at(-1).get('offset'), '25');
    assert.equal(view.textOf('partners-inv-range'), '26–50 of 60');
    assert.ok(view.has('partners-inv-row-26') && !view.has('partners-inv-row-25'));
  } finally { await view.close(); }
});

test('mounted: each filter reaches the Worker, one debounced request per change, from page one', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({ rows: many(30, (i) => live(i, { invited_by_user_id: i % 2 ? 41 : 52, invited_by_name: i % 2 ? 'Admin A' : 'Admin B' })) }));
  try {
    await view.press('Next');
    await view.wait(400);
    const before = view.lists().length;
    for (const v of ['P', 'Pa', 'Par', 'Partner 2']) await view.change('partners-inv-search', { value: v });
    await view.wait(450);
    assert.equal(view.lists().length, before + 1, 'typing four characters is one request');
    assert.deepEqual([view.lists().at(-1).get('q'), view.lists().at(-1).get('offset')], ['Partner 2', null], 'and it starts from page one');
    await view.click('partners-inv-chip-lapsed');
    await view.click('partners-inv-chip-viewed');
    await view.wait(400);
    assert.deepEqual(view.lists().at(-1).getAll('stage'), ['lapsed', 'viewed']);
    await view.change('partners-inv-type', { value: 'custom' });
    await view.change('partners-inv-by', { value: '52' });
    await view.change('partners-inv-within', { value: '30' });
    await view.change('partners-inv-sort', { value: 'expires' });
    await view.wait(400);
    const last = view.lists().at(-1);
    assert.deepEqual([last.get('deal_type'), last.get('invited_by'), last.get('sent_within'), last.get('sort')], ['custom', '52', '30', 'expires_soonest']);
    const by = view.props('partners-inv-by');
    assert.ok(by, 'the inviter select');
  } finally { await view.close(); }
});

test('mounted: a late reply for filters no longer in the toolbar is dropped', async () => {
  const later = (ms, body) => new Promise((done) => setTimeout(() => done(response(body)), ms));
  const view = await mounted('/admin/partner-invitations/invitations', worker({
    page: (q) => (q.get('q') === 'old'
      ? later(900, { items: [live(1, { recipient_name: 'Old Reply' })], total: 1 })
      : q.get('q') === 'new' ? later(0, { items: [live(2, { recipient_name: 'New Reply' })], total: 1 }) : response({ items: [live(3)], total: 1 })),
  }));
  try {
    await view.change('partners-inv-search', { value: 'old' });
    await view.wait(400); // the request for "old" is out; it takes 900 ms
    await view.change('partners-inv-search', { value: 'new' });
    await view.wait(400);
    assert.ok(view.has('partners-inv-row-2'));
    await view.wait(800); // the reply for "old" lands now
    assert.ok(view.has('partners-inv-row-2') && !view.has('partners-inv-row-1'), 'the old reply never replaces the new one');
  } finally { await view.close(); }
});

test('mounted: the Email column says Sent, Not sent with its reason, or Not recorded; the list never says "newest 200"', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({ rows: [
    live(1), live(2, { last_send_ok: 0, last_send_reason: 'not_configured' }), live(3, { last_send_ok: null }),
  ] }));
  try {
    assert.equal(view.props('partners-inv-email-1').title.startsWith('Sent '), true);
    assert.equal(view.textOf('partners-inv-email-1'), 'Sent');
    assert.match(view.textOf('partners-inv-email-2'), /^Not sent, Not sent \d+ \w{3} \d{4}: email is not set up$/, 'the reason, on hover and to a screen reader');
    assert.equal(view.textOf('partners-inv-email-3'), `Not recorded, ${NOT_RECORDED_SEND}`);
    assert.doesNotMatch(view.text(), /newest 200|200\+/);
  } finally { await view.close(); }
});

test('mounted: Export CSV reads every page of the current view, and the file has no link or token; a failed page makes no file', async () => {
  const rows = many(230, (i) => live(i));
  const view = await mounted('/admin/partner-invitations/invitations', worker({ rows }));
  try {
    await view.change('partners-inv-search', { value: 'Partner' });
    await view.wait(400);
    await view.click('partners-inv-export');
    await view.wait(50);
    const pages = view.requests.filter((r) => /limit=100/.test(r.url)).map((r) => new URLSearchParams(r.url.split('?')[1]));
    assert.deepEqual(pages.map((p) => p.get('offset')), [null, '100', '200'], 'three pages of 100');
    assert.ok(pages.every((p) => p.get('q') === 'Partner'), 'of the current view');
    assert.equal(view.files.length, 1, 'one file');
    const csv = await view.files[0].text();
    assert.equal(csv.trimEnd().split('\r\n').length, 231, 'every row, and the header');
    assert.doesNotMatch(csv, /tok\d|token=|onboard|https?:/, 'never the link or its token');
    assert.match(view.textOf('partners-inv-export-state'), /^Exported 230 invitations\. The file has no invitation links\.$/);
  } finally { await view.close(); }
  let n = 0;
  const broken = await mounted('/admin/partner-invitations/invitations', worker({ page: (q) => {
    if (q.get('limit') === '100') { n += 1; return n === 2 ? response({ error: 'down' }, 503) : response({ items: many(100, (i) => live(i)), total: 230 }); }
    return response({ items: many(25, (i) => live(i)), total: 230 });
  } }));
  try {
    await broken.click('partners-inv-export');
    await broken.wait(50);
    assert.equal(broken.files.length, 0, 'no file from part of the view');
    assert.equal(broken.textOf('partners-inv-export-failed'), EXPORT_FAILED);
  } finally { await broken.close(); }
  // The rows ran out before the total (rows went while it read): no file that reads as the whole view.
  const short = await mounted('/admin/partner-invitations/invitations', worker({ page: (q) => {
    if (q.get('limit') === '100') return response({ items: q.get('offset') ? [] : many(100, (i) => live(i)), total: 230 });
    return response({ items: many(25, (i) => live(i)), total: 230 });
  } }));
  try {
    await short.click('partners-inv-export');
    await short.wait(50);
    assert.equal(short.files.length, 0);
    assert.equal(short.textOf('partners-inv-export-failed'), EXPORT_FAILED);
  } finally { await short.close(); }
});

test('mounted: one invitation from its own read: the message, the step dates, what we offered, the refusals and the history', async () => {
  const row = live(7, { recipient_name: 'Ada Placeholder-Row', status: 'selected', personal_message: 'Glad to have you.', viewed_at: d1(LIVE - 3 * DAY), last_send_ok: 0, last_send_reason: 'refused' });
  const view = await mounted('/admin/partner-invitations/invitations/7', worker({ rows: [row], details: { 7: () => response(detailFor(row, {
    steps: { available: true, sent: row.created_at, opened: row.viewed_at, profile_done: d1(LIVE - 2 * DAY), offers_shown: null, offer_chosen_first: d1(LIVE - DAY), offer_chosen_latest: d1(LIVE - DAY), agreement_out: null, signed: null },
    offers_seen: { available: true, shown: true, offers: [{ deal_type: 'services_partnership', label: 'Services Partnership', summary: 'Engagement.', terms: { rate: 'Per SOW' }, term_months: 12 }] },
    chosen_deal: { available: true, deal: { id: 31, deal_type: 'services_partnership', proposal: { label: 'Services Partnership', summary: 'Engagement.' } }, envelope: null },
    agreement_refusals: { available: true, items: [{ at: d1(LIVE - DAY), code: 'template_has_no_body', fields: [] }] },
    history: { available: false, unreadable: true, reason: 'The admin history could not be read on this database. That is not the same as none.' },
  })) } }));
  try {
    assert.equal(view.textOf('partners-invitation-message-text'), 'Glad to have you.');
    assert.match(view.textOf('partners-progress-profile_done'), /^Profile done\d+ \w{3} \d{4}$/);
    assert.equal(view.textOf('partners-progress-offers_shown'), 'Offers shownNot recorded', 'reached with no row');
    assert.equal(view.textOf('partners-progress-agreement_out'), 'Agreement outNot reached');
    assert.match(view.textOf('partners-invitation-send'), /^Latest send: Not sent \d+ \w{3} \d{4}, because the mail service refused it · 1 send$/);
    assert.match(view.textOf('partners-invitation-offer-services_partnership'), /Services PartnershipEngagement\.RatePer SOWTerm: 12 months/);
    assert.match(view.textOf('partners-invitation-chosen'), /^Services PartnershipEngagement\.Deal #31 · /);
    assert.match(view.textOf('partners-invitation-refusals'), /^Could not be sent \d+ \w{3} \d{4}: the Partner Services template has no body\.$/);
    assert.equal(view.textOf('partners-invitation-history-failed'), 'The admin history could not be read on this database. That is not the same as none.', 'a failed block is said alone');
    assert.ok(view.has('partners-invitation-copy'), 'the link comes from the list row the page has');
    assert.doesNotMatch(view.text(), /Not read here yet/, 'nothing this part reads is "Not read here yet"');
  } finally { await view.close(); }
});

test('mounted: New invitation draws the five offer cards from the preview, and still sends when the preview fails', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({}));
  try {
    await view.click('partners-new-button');
    const asks = view.requests.filter((r) => r.url.startsWith('/api/admin/partners/offers/preview')).map((r) => decodeURIComponent(r.url.split('types=')[1]));
    assert.deepEqual(asks, ['equity_partnership,services_partnership,deal_sourcing_revshare', 'capital_partnership,custom']);
    for (const t of PREVIEW_ASKS.flat()) assert.match(view.textOf(`partners-new-type-${t}-card`), new RegExp(`^Offer ${t}About ${t}\\.Rate: NegotiatedTerm: 12 months`), t);
    assert.match(view.textOf('partners-new-type-capital_partnership-card'), /Needs KYC and accreditation after signing\./);
  } finally { await view.close(); }
  const down = await mounted('/admin/partner-invitations/invitations', worker({ preview: () => response({ error: 'down' }, 503) }));
  try {
    await down.click('partners-new-button');
    assert.match(down.textOf('partners-new-preview-failed'), new RegExp(`^${PREVIEW_FAILED}`));
    assert.match(down.textOf('partners-new-type-custom-card'), /The terms could not be read\./);
    await down.change('partners-new-email', { value: 'new@example.com' });
    await down.change('partners-new-type-custom-box', { checked: true });
    assert.equal(down.props('partners-new-send').disabled, false, 'the invitation can still be sent');
  } finally { await down.close(); }
});

test('mounted on a phone (PI11b): cards with the email result, the filters in a bottom sheet, the sort a select', async () => {
  const view = await mounted('/admin/partner-invitations/invitations', worker({ rows: [live(1), live(2, { last_send_ok: 0, last_send_reason: 'failed' })] }), { phone: true });
  try {
    assert.ok(view.has('partners-inv-cards') && !view.has('partners-inv-table'));
    assert.match(view.textOf('partners-inv-card-2'), /Not sent/);
    assert.ok(view.has('partners-inv-sort'), 'the sort stays a select');
    assert.ok(!view.has('partners-inv-type'), 'the filters wait behind Filters');
    await view.click('partners-inv-filters');
    assert.ok(view.has('partners-inv-sheet') && view.has('partners-inv-type') && view.has('partners-inv-chip-lapsed'));
    await view.click('partners-inv-chip-lapsed');
    await view.wait(400);
    assert.deepEqual(view.lists().at(-1).getAll('stage'), ['lapsed']);
    assert.equal(view.textOf('partners-inv-sheet-done'), 'Show 2 invitations');
    await view.click('partners-inv-sheet-done');
    assert.ok(!view.has('partners-inv-sheet'));
    assert.equal(view.textOf('partners-inv-filters'), 'Filters · 1', 'the button says how many filters are on');
  } finally { await view.close(); }
});

test('docs and wiring: D950 is written, the README names the new files, and the Invitations files read only existing clients', () => {
  assert.match(read('documentation/architecture/decisions/D950.md'), /^## D950 — /);
  const readme = read('frontend/src/pages/admin/partners/README.md');
  for (const f of ['invitationsModel.js', 'useInvitationList.js']) assert.match(readme, new RegExp(f.replace('.', '\\.')), f);
  for (const f of ['PartnersInvitations.jsx', 'InvitationRecord.jsx', 'NewInvitationDialog.jsx', 'useInvitationList.js']) {
    const src = read(`frontend/src/pages/admin/partners/${f}`);
    assert.doesNotMatch(src, /alert\(|confirm\(|useToast/, `${f}: no pop-up, no toast`);
  }
  assert.doesNotMatch(read('frontend/src/pages/admin/partners/invitationsModel.js'), /\.link\b|\.token\b|inv\?\.link|inv\?\.token/, 'the CSV never reads the link or the token');
});
