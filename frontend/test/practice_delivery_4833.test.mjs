/**
 * #4833 (D4833, Practice UX 5/6): Delivery as an artifact and an immutable
 * version workspace, built to the Practice v2 canvas
 * (`design/incoming/Practice v2 Page.dc.html`, PX-06, D4874).
 *
 *   · cards carry the LATEST version's status: Draft, Sent, Opened, Accepted;
 *   · Ready (part 2, D4833-p2) is a filter over #5316's stored mark (D5316):
 *     it narrows on `ready_version`, counts `totals.ready`, and the latest
 *     unsent version can be marked or cleared, sending nothing;
 *   · Add version needs a change note and a document link (no empty version);
 *   · Send asks first, naming the recipient and the version;
 *   · older versions are read-only and keep their own recipient and receipts;
 *   · post-session reviews render with zero work products, and when the
 *     work-product read fails.
 *
 * Every record below is made up.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_delivery_4833.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import DeliveryZone from '../src/pages/advisor/practice/DeliveryZone.jsx';
import {
  DELIVERY_FILTERS, VERSION_STATUS_LABEL, cardReceiptLine, cardStatus, isReadyItem, readyAction, readyLine,
  readyMark, readyRefusal, receiptLine, recipientNote, sendConfirmation, statusCounts, versionStatus,
} from '../src/pages/advisor/practice/deliveryTrail.js';
import { ADVISOR_ZONE_FILTERS } from '../src/workspaces/advisorZoneFilters.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// ---------------------------------------------------------------- fixtures

const V = (version, over = {}) => ({
  uid: `u${version}`, version, label: null, summary: `Change ${version}`, link_url: `https://docs.example/v${version}`,
  sent_at: null, opened_at: null, signed_off_at: null, recipient_user_id: null, recipient_name: null, ...over,
});
const ITEM = (id, versions, over = {}) => ({
  id, title: `Work ${id}`, client_name: 'Acme', engagement_id: 9, client_user_id: 50,
  client_user_name: 'J. Park', client_user_email: 'jpark@example.test',
  state: versions.some((v) => v.opened_at) ? 'opened' : versions.some((v) => v.sent_at) ? 'sent' : 'not_started',
  version_count: versions.length, latest_version: versions[0] || null, versions, ...over,
});
const SENT = { sent_at: '2026-11-06T10:00:00Z', recipient_user_id: 50, recipient_name: 'J. Park' };

// Q4 memo: v3 accepted, v2 opened, v1 sent to an earlier client (M. Chen).
const MEMO = ITEM(1, [
  V(3, { ...SENT, opened_at: '2026-11-06T12:00:00Z', signed_off_at: '2026-11-07T09:00:00Z', summary: 'Updated pricing' }),
  V(2, { ...SENT, sent_at: '2026-10-28T10:00:00Z', opened_at: '2026-10-29T10:00:00Z' }),
  V(1, { sent_at: '2026-10-15T10:00:00Z', recipient_user_id: 61, recipient_name: 'M. Chen' }),
], { title: 'Q4 Strategy Memo' });
// Pricing model: v2 not sent; v1 opened.
const PRICING = ITEM(2, [V(2), V(1, { ...SENT, opened_at: '2026-10-28T10:00:00Z' })], { title: 'Pricing model', client_name: 'Northstar' });
const HIRING = ITEM(3, [V(1, { ...SENT, opened_at: '2026-11-05T10:00:00Z' })], { title: 'Hiring plan' });
const BOARD = ITEM(4, [V(2, { ...SENT, sent_at: '2026-10-12T10:00:00Z' }), V(1, { ...SENT, sent_at: '2026-10-01T10:00:00Z' })], { title: 'Board prep notes' });

// ---------------------------------------------------------------- pure rules

test('a card takes its LATEST version\'s status, from that version\'s own stamps', () => {
  assert.equal(versionStatus(null), null);
  assert.equal(versionStatus(V(1)), 'draft');
  assert.equal(versionStatus(V(1, SENT)), 'sent');
  assert.equal(versionStatus(V(1, { ...SENT, opened_at: 'x' })), 'opened');
  assert.equal(versionStatus(V(1, { ...SENT, opened_at: 'x', signed_off_at: 'y' })), 'accepted');
  // The endpoint folds every version into `opened`; the card does not.
  assert.equal(PRICING.state, 'opened');
  assert.equal(cardStatus(PRICING), 'draft', 'an unsent v2 over an opened v1 is a draft');
  assert.equal(cardStatus(MEMO), 'accepted');
  assert.equal(cardStatus({ latest_version: null }), 'draft', 'no version yet is a draft');
  assert.deepEqual(statusCounts([MEMO, PRICING, HIRING, BOARD]), { draft: 1, ready: null, sent: 1, opened: 1, accepted: 1, all: 4 },
    'with no totals the Ready count is unknown, never 0');
});

test('Ready is a filter over the stored mark, in the canvas\'s order (D4833-p2, D5316)', () => {
  // Mutation checked: dropping 'ready' from DELIVERY_FILTERS, or the `{ canvas: 'Ready' }`
  // row from the table, fails here.
  assert.deepEqual(DELIVERY_FILTERS, ['draft', 'ready', 'sent', 'opened', 'accepted', 'all']);
  assert.equal(VERSION_STATUS_LABEL.ready, 'Ready');
  const row = ADVISOR_ZONE_FILTERS['practice/delivery'];
  assert.deepEqual(row.map((r) => r.canvas), ['Draft', 'Ready', 'Sent', 'Opened', 'Accepted', 'All']);
  assert.deepEqual(row.map((r) => r.key), DELIVERY_FILTERS);
  // The canvas's own row, in its own order.
  const canvas = read('design/incoming/Practice v2 Page.dc.html');
  const section = canvas.slice(canvas.indexOf('const delivery = () =>'), canvas.indexOf('const delDetail'));
  assert.match(section, /chips\(\[\['Draft', 1\], \['Ready'\], \['Sent', 1\], \['Opened', 1\], \['Accepted', 1\], \['All', 4\]\]/);
  const page = codeOnly(read('frontend/src/pages/advisor/practice/DeliveryZone.jsx'));
  assert.match(page, /filter === 'ready'/, 'the page that mounts the chip narrows on its key');
  // The stale copy is gone. #5961 (D4833-p3) took the "no file upload yet" half away
  // when a version's document became a link or a stored file.
  const src = read('frontend/src/pages/advisor/practice/DeliveryZone.jsx');
  assert.doesNotMatch(src, /There is no Ready filter|There is no Ready state|no file upload/);
  assert.match(src, /A version&rsquo;s document is a web link or a stored file/);
});

// A draft v2 marked ready by Ada, over a v1 that was opened.
const READY = ITEM(5, [
  V(2, { ready_at: '2026-11-09T10:00:00Z', ready_by_user_id: 90, ready_by_name: 'Ada' }),
  V(1, { ...SENT, opened_at: '2026-10-28T10:00:00Z' }),
], { title: 'Pricing memo', ready_version: 2 });

test('a version marked ready and unsent is Ready; the count is the Worker\'s totals.ready', () => {
  // Mutation checked: `versionStatus` ignoring `ready_at` leaves READY a Draft;
  // counting Ready from the cards instead of `totals.ready` gives 1, not 3;
  // a missing `totals.ready` read as 0 fails the null.
  assert.equal(versionStatus(READY.latest_version), 'ready');
  assert.equal(versionStatus({ ...READY.latest_version, sent_at: '2026-11-10T10:00:00Z' }), 'sent', 'a sent version is never Ready');
  assert.equal(cardStatus(READY), 'ready');
  assert.equal(isReadyItem(READY), true);
  assert.equal(isReadyItem(PRICING), false);
  assert.equal(statusCounts([READY, PRICING], { ready: 3 }).ready, 3, 'the whole set\'s count, not this page\'s');
  assert.equal(statusCounts([READY, PRICING], { ready: 3 }).draft, 1, 'a Ready card is not also a Draft card');
  assert.equal(statusCounts([READY], { work_products: 1 }).ready, null, 'not carried: unknown, never 0');
  assert.equal(statusCounts([], { ready: 0 }).ready, 0);
});

test('who marked it and when is said; a name that does not read back is not invented', () => {
  assert.deepEqual(Object.keys(readyMark(READY.latest_version)), ['day', 'by']);
  assert.equal(readyMark(READY.latest_version).by, 'Ada');
  assert.match(readyLine(READY.latest_version), /^Marked ready to send \w+ \d+ by Ada$/);
  assert.equal(readyMark({ ...READY.latest_version, ready_by_name: null }).by, null);
  assert.match(readyLine({ ...READY.latest_version, ready_by_name: null }), /^Marked ready to send \w+ \d+$/);
  assert.equal(readyMark(V(1)), null, 'an unmarked version has no mark');
  assert.equal(readyMark({ ...READY.latest_version, sent_at: 'x' }), null, 'a sent version carries no mark');
});

test('the Ready control: mark or clear the latest unsent version, said with its consequence', () => {
  // Mutation checked: offering the control on a sent latest version, or enabling Mark
  // on a version with no document, fails here.
  const clear = readyAction(READY);
  assert.equal(clear.kind, 'clear');
  assert.equal(clear.label, 'Clear Ready');
  assert.equal(clear.version, 2);
  assert.match(clear.consequence, /v2 goes back to Draft\. Nothing is sent or deleted\./);
  const mark = readyAction(PRICING);
  assert.equal(mark.kind, 'mark');
  assert.equal(mark.label, 'Mark v2 ready');
  assert.equal(mark.enabled, true);
  assert.match(mark.consequence, /Nothing is sent: the client sees nothing until you send it, and sending clears the mark\./);
  assert.equal(readyAction(MEMO), null, 'a sent latest version cannot be marked or cleared');
  assert.equal(readyAction(ITEM(9, [])), null, 'no version, no control');
  const empty = readyAction(ITEM(9, [V(1, { link_url: null })]));
  assert.equal(empty.enabled, false);
  assert.match(empty.consequence, /no document, so it cannot be marked ready/);
  assert.equal(readyAction(ITEM(9, [V(1, { link_url: null, document: 'file' })])).enabled, true, 'a stored file is content too');
  // The Worker's refusals, as sentences.
  assert.match(readyRefusal(Object.assign(new Error('x'), { status: 409, code: 'already_sent' }), 'v2'),
    /^v2 has already been sent, so it can’t be marked ready or cleared\./);
  assert.match(readyRefusal(Object.assign(new Error('x'), { status: 422, code: 'empty_version' }), 'v2'), /no document/);
  assert.equal(readyRefusal(new Error('Server says no'), 'v2'), 'Server says no');
});

test('each version\'s receipt line is its own: recipient, opened and accepted', () => {
  assert.equal(receiptLine(V(2)), 'Not sent');
  const [v3, v2, v1] = MEMO.versions;
  assert.match(receiptLine(v3), /^Sent \w+ \d+ to J\. Park · opened \w+ \d+ · accepted \w+ \d+$/);
  assert.match(receiptLine(v2), /^Sent \w+ \d+ to J\. Park · opened \w+ \d+$/);
  assert.match(receiptLine(v1), /^Sent \w+ \d+ to M\. Chen$/, 'v1 keeps the person it went to');
  assert.match(cardReceiptLine(PRICING, Date.parse('2026-11-08T00:00:00Z')), /^v1 opened \w+ \d+$/);
  assert.match(cardReceiptLine(MEMO, Date.now()), /^Opened \w+ \d+ · Accepted \w+ \d+$/);
  assert.equal(cardReceiptLine(ITEM(9, [V(1)]), Date.now()), 'Never sent');
});

test('a sent version says when its recipient is not recorded, gone, or no longer the client', () => {
  const [, , v1] = MEMO.versions;
  assert.equal(recipientNote(MEMO, MEMO.versions[0]), null, 'the current client: nothing to say');
  assert.equal(recipientNote(MEMO, v1).kind, 'moved');
  assert.match(recipientNote(MEMO, v1).text, /Stays with M\. Chen/);
  assert.equal(recipientNote(MEMO, V(1, { sent_at: 'x', recipient_user_id: 61, recipient_name: null })).kind, 'missing');
  assert.equal(recipientNote(MEMO, V(1, { sent_at: 'x' })).kind, 'not_recorded');
  assert.equal(recipientNote(MEMO, V(1)), null, 'a draft has no recipient yet');
});

test('the send confirmation names the recipient, the client and the version', () => {
  const c = sendConfirmation(PRICING);
  assert.equal(c.sendable, true);
  assert.equal(c.heading, 'Send v2 to Northstar?');
  assert.equal(c.recipient, 'J. Park · Northstar');
  assert.equal(c.document, 'Pricing model v2');
  assert.equal(c.host, 'docs.example');
  assert.equal(c.confirm, 'Send v2 to J. Park');
  assert.match(c.after, /v2 can’t be edited after sending; add v3 for changes/);
  assert.equal(sendConfirmation(MEMO).sendable, false, 'a sent version is not sent twice');
  const empty = sendConfirmation(ITEM(9, [V(1, { link_url: null })]));
  assert.equal(empty.sendable, false);
  assert.match(empty.reason, /no content to send/);
  const unlinked = sendConfirmation(ITEM(9, [V(1)], { client_user_id: null, client_user_name: null, client_user_email: null }));
  assert.equal(unlinked.sendable, false);
  assert.equal(unlinked.recipient, null);
  assert.match(unlinked.reason, /No client account/);
});

// ---------------------------------------------------------------- mounted

async function mount(handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const call = { method: (init.method || 'GET').toUpperCase(), path: url.pathname, body: init.body ? JSON.parse(init.body) : null };
    seen.push(call);
    return handle(call);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(DeliveryZone))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const buttonWith = (re) => walk(document.body).find((n) => n.tagName === 'BUTTON' && typeof props(n)?.onClick === 'function' && re.test(textOf(n)));
  return {
    walk, textOf, props, byTestId, buttonWith, settle,
    text: () => textOf(document.body),
    writes: () => seen.filter((c) => c.method !== 'GET'),
    async press(re) { const b = buttonWith(re); assert.ok(b, `no button ${re}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async pressId(id) { const b = byTestId(id); assert.ok(b, `no ${id}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await settle(); },
    async submit(id) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n).onSubmit({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const base = (items) => (c) => {
  if (c.path === '/api/advisors/me/deliverables' && c.method === 'GET') {
    return typeof items === 'function' ? items(c) : json({ items, totals: { work_products: items.length } });
  }
  if (c.path === '/api/advisors/me/engagements') return json({ items: [{ id: 9, client_name: 'Acme', title: 'Growth retainer', founder_user_id: 50 }], totals: {} });
  if (c.path === '/api/advisors/me/bookings') return json({ items: [] });
  return json({});
};

test('mounted: four cards, each with the latest version\'s status; a chip narrows', async () => {
  // Mutation checked: narrowing on the folded `i.state` instead of `cardStatus(i)`
  // puts Pricing model under Opened and leaves Draft empty.
  const m = await mount(base([MEMO, PRICING, HIRING, BOARD]));
  try {
    for (const [id, status] of [[1, 'accepted'], [2, 'draft'], [3, 'opened'], [4, 'sent']]) {
      assert.equal(m.props(m.byTestId(`row-pr3-${id}`))['data-status'], status, `card ${id}`);
    }
    assert.match(m.textOf(m.byTestId('row-pr3-1')), /Q4 Strategy Memo.*Acme · Latest v3 · Sent/);
    assert.ok(m.buttonWith(/^Ready$/), 'the Ready chip, with no number: this read carried no totals.ready');
    assert.doesNotMatch(m.text(), /There is no Ready filter|Ready 0/);
    assert.match(m.text(), /Ready is your own mark on a draft that is ready to send\. It sends nothing; sending clears it\./);
    await m.press(/^Draft\s*1$/);
    assert.ok(m.byTestId('row-pr3-2'));
    for (const id of [1, 3, 4]) assert.equal(m.byTestId(`row-pr3-${id}`), undefined, `card ${id} is not a draft`);
    await m.press(/^Accepted\s*1$/);
    assert.ok(m.byTestId('row-pr3-1'));
    assert.equal(m.byTestId('row-pr3-2'), undefined);
  } finally { await m.close(); }
});

test('mounted: the detail sheet lists every version read-only, each with its own recipient and receipts', async () => {
  // Mutation checked: the history drawing the latest version's receipt for every row
  // shows "to J. Park" against v1, and a button inside the history list fails below.
  const m = await mount(base([MEMO]));
  try {
    await m.pressId('open-pr3-1');
    assert.ok(m.byTestId('deliverable-sheet-1'));
    assert.match(m.textOf(m.byTestId('latest-version-1')), /v3.*Accepted.*“Updated pricing”.*docs\.example/);
    const list = m.byTestId('history-list-1');
    assert.ok(list, 'the history is drawn');
    assert.equal(m.walk(list).filter((n) => n.tagName === 'BUTTON' || n.tagName === 'INPUT' || n.tagName === 'TEXTAREA').length, 0,
      'nothing in the history can be edited');
    assert.match(m.textOf(m.byTestId('history-1-v3')), /Sent \w+ \d+ to J\. Park · opened \w+ \d+ · accepted/);
    assert.match(m.textOf(m.byTestId('history-1-v2')), /to J\. Park · opened \w+ \d+Opened/);
    const v1 = m.textOf(m.byTestId('history-1-v1'));
    assert.match(v1, /Sent \w+ \d+ to M\. Chen/);
    assert.doesNotMatch(v1, /J\. Park ·|opened|accepted/, 'v1 does not borrow a later receipt');
    assert.match(v1, /Stays with M\. Chen; the engagement’s client has changed since/);
    assert.match(m.text(), /Version history · immutable/);
    assert.match(m.text(), /Work product · Acme · Growth retainer/);
    assert.equal(m.byTestId('send-pr3-1'), undefined, 'a sent latest version offers no Send');
  } finally { await m.close(); }
});

test('mounted: a recipient account that no longer reads back, or was never recorded, is said', async () => {
  const gone = ITEM(5, [V(1, { sent_at: '2026-11-01T10:00:00Z', recipient_user_id: 77, recipient_name: null })]);
  const unrecorded = ITEM(6, [V(1, { sent_at: '2026-11-01T10:00:00Z' })]);
  const m = await mount(base([gone, unrecorded]));
  try {
    await m.pressId('open-pr3-5');
    assert.equal(m.props(m.byTestId('latest-recipient-note-5'))['data-kind'], 'missing');
    assert.match(m.text(), /no longer active on Axal/);
    await m.pressId('deliverable-sheet-5-close');
    await m.pressId('open-pr3-6');
    assert.equal(m.props(m.byTestId('latest-recipient-note-6'))['data-kind'], 'not_recorded');
    assert.match(m.text(), /Recipient not recorded for this send/);
  } finally { await m.close(); }
});

test('mounted: Add version needs a change note AND a document; nothing empty is posted', async () => {
  // Mutation checked: dropping the link rule from `attachmentBody` posts a note-only version.
  const m = await mount((c) => {
    if (c.path === '/api/advisors/me/deliverables/4/versions') return json({ uid: 'n', version: 3, ...c.body }, 201);
    return base([BOARD])(c);
  });
  try {
    await m.pressId('open-pr3-4');
    await m.pressId('version-pr3-4');
    assert.ok(m.byTestId('add-version-form-4'));
    assert.match(m.text(), /Add version v3/);
    assert.match(m.text(), /Change note · required/);
    // #5961 (D4833-p3): the canvas's three fields, in its order.
    assert.match(m.text(), /Change note · required.*Document or URL · required.*Summary · optional/);
    assert.match(m.text(), /Save v3 as draft/);
    await m.submit('add-version-form-4');
    assert.equal(m.writes().length, 0, 'an empty version is refused');
    assert.match(m.text(), /Say what changed/);
    await m.type('add-version-note-4', 'Added the hiring appendix');
    await m.submit('add-version-form-4');
    assert.equal(m.writes().length, 0, 'a note without a document is refused');
    assert.match(m.text(), /https:\/\//);
    await m.type('add-version-link-4', 'https://docs.example/v3');
    await m.submit('add-version-form-4');
    assert.deepEqual(m.writes().map((c) => [c.method, c.path, c.body]), [
      ['POST', '/api/advisors/me/deliverables/4/versions', { link_url: 'https://docs.example/v3', summary: 'Added the hiring appendix' }],
    ]);
  } finally { await m.close(); }
});

test('mounted: Send asks "Send v2 to Northstar?" with the recipient and document, and sends only on confirm', async () => {
  // Mutation checked: Send calling the send route directly writes before the confirmation.
  const m = await mount((c) => {
    if (c.path.endsWith('/send')) return json({ version: 2, sent_at: '2026-11-09T10:00:00Z' });
    return base([PRICING])(c);
  });
  try {
    await m.pressId('open-pr3-2');
    await m.pressId('send-pr3-2');
    assert.equal(m.writes().length, 0, 'nothing is sent by Send itself');
    assert.ok(m.byTestId('send-confirm-2'));
    assert.match(m.text(), /Send v2 to Northstar\?/);
    assert.equal(m.textOf(m.byTestId('send-confirm-recipient-2')), 'J. Park · Northstar');
    assert.match(m.textOf(m.byTestId('send-confirm-document-2')), /^Pricing model v2 · opens docs\.example$/);
    await m.press(/^Cancel$/);
    assert.equal(m.byTestId('send-confirm-2'), undefined, 'Cancel closes it');
    assert.equal(m.writes().length, 0, 'and sends nothing');
    await m.pressId('send-pr3-2');
    assert.equal(m.textOf(m.byTestId('send-confirm-go-2')), 'Send v2 to J. Park');
    await m.pressId('send-confirm-go-2');
    assert.deepEqual(m.writes().map((c) => [c.method, c.path]), [['POST', '/api/advisors/me/deliverables/2/versions/2/send']]);
  } finally { await m.close(); }
});

test('mounted: post-session reviews render with zero work products, and when the work-product read fails', async () => {
  // Mutation checked: the review card moved inside ZoneBody is not drawn in either case.
  const session = { id: 7, topic: 'Strategy review', founder_name: 'Fran', slot_starts_at: '2026-11-03T10:00:00Z' };
  const sessions = (c) => {
    if (c.path === '/api/advisors/me/bookings') return json({ items: [session] });
    if (c.path === '/api/advisors/bookings/7/reviews') return json({ items: [] });
    return null;
  };
  const empty = await mount((c) => sessions(c) || base([])(c));
  try {
    assert.match(empty.text(), /No work product is on file/);
    assert.ok(empty.byTestId('review-loop'));
    assert.match(empty.text(), /Post-session reviews/);
    assert.match(empty.text(), /Independent of work products/);
    assert.ok(empty.buttonWith(/Review this session/));
  } finally { await empty.close(); }
  const down = await mount((c) => sessions(c) || base(() => json({ detail: 'down' }, 500))(c));
  try {
    assert.doesNotMatch(down.text(), /No work product is on file/, 'an unreadable source is not an empty one');
    assert.ok(down.byTestId('review-loop'), 'reviews stand when Delivery cannot be read');
    assert.ok(down.buttonWith(/Review this session/));
  } finally { await down.close(); }
});

// ---------------------------------------------------------------- Ready (part 2)

const readyBase = (items, totals) => (c) => {
  if (c.path === '/api/advisors/me/deliverables' && c.method === 'GET') {
    const list = typeof items === 'function' ? items() : items;
    return json({ items: list, totals: { work_products: list.length, ...totals } });
  }
  return base([])(c);
};

test('mounted: the Ready chip counts totals.ready and narrows to the marked work products', async () => {
  // Mutation checked: the chip narrowing on `cardStatus(i) === 'draft'`, or the page
  // counting Ready from its cards, fails here.
  const m = await mount(readyBase([MEMO, PRICING, READY], { ready: 1 }));
  try {
    assert.equal(m.props(m.byTestId('row-pr3-5'))['data-status'], 'ready');
    assert.match(m.textOf(m.byTestId('row-pr3-5')), /Ready/);
    assert.match(m.textOf(m.byTestId('ready-line-pr3-5')), /^Marked ready to send \w+ \d+ by Ada$/);
    assert.equal(m.byTestId('ready-line-pr3-2'), undefined, 'an unmarked draft says nothing about Ready');
    await m.press(/^Ready\s*1$/);
    assert.ok(m.byTestId('row-pr3-5'));
    for (const id of [1, 2]) assert.equal(m.byTestId(`row-pr3-${id}`), undefined, `card ${id} is not ready`);
    await m.press(/^Draft\s*1$/);
    assert.ok(m.byTestId('row-pr3-2'));
    assert.equal(m.byTestId('row-pr3-5'), undefined, 'a Ready card is not a Draft card');
  } finally { await m.close(); }
});

test('mounted: the sheet says who marked it ready; Clear and Mark write the mark and send nothing', async () => {
  // Mutation checked: Clear calling the mark route, or Mark calling the send route,
  // fails the write list; dropping the ReadyMark line fails the "by Ada" match.
  let items = [READY, PRICING];
  const m = await mount((c) => {
    if (c.path === '/api/advisors/me/deliverables/5/versions/2/ready' && c.method === 'DELETE') {
      items = [{ ...READY, ready_version: null, latest_version: { ...READY.latest_version, ready_at: null, ready_by_user_id: null, ready_by_name: null },
        versions: [{ ...READY.versions[0], ready_at: null, ready_by_user_id: null, ready_by_name: null }, READY.versions[1]] }, PRICING];
      return json({ version: 2, ready_at: null });
    }
    if (c.path === '/api/advisors/me/deliverables/2/versions/2/ready' && c.method === 'POST') return json({ version: 2, ready_at: 'x' });
    return readyBase(() => items, { ready: items.filter((i) => i.ready_version != null).length })(c);
  });
  try {
    await m.pressId('open-pr3-5');
    assert.match(m.textOf(m.byTestId('latest-ready-5')), /^Marked ready to send \w+ \d+ by Ada$/);
    assert.match(m.textOf(m.byTestId('history-ready-5-v2')), /by Ada/);
    assert.equal(m.byTestId('history-ready-5-v1'), undefined, 'a sent version carries no mark');
    assert.equal(m.props(m.byTestId('ready-toggle-5'))['data-kind'], 'clear');
    assert.match(m.textOf(m.byTestId('ready-consequence-5')), /v2 goes back to Draft\. Nothing is sent or deleted\./);
    await m.pressId('ready-toggle-5');
    assert.deepEqual(m.writes().map((c) => [c.method, c.path]), [['DELETE', '/api/advisors/me/deliverables/5/versions/2/ready']]);
    assert.match(m.textOf(m.byTestId('ready-answer-5')), /v2 of “Pricing memo” is a draft again\. Nothing was sent\./);
    assert.equal(m.props(m.byTestId('ready-toggle-5'))['data-kind'], 'mark', 'the sheet shows the cleared version');
    assert.equal(m.byTestId('latest-ready-5'), undefined);
    await m.pressId('deliverable-sheet-5-close');
    await m.pressId('open-pr3-2');
    assert.match(m.textOf(m.byTestId('ready-consequence-2')), /Marks v2 ready to send\. Nothing is sent/);
    await m.pressId('ready-toggle-2');
    assert.deepEqual(m.writes().map((c) => [c.method, c.path]).slice(1), [['POST', '/api/advisors/me/deliverables/2/versions/2/ready']]);
    assert.ok(!m.writes().some((c) => c.path.endsWith('/send')), 'marking ready sends nothing');
  } finally { await m.close(); }
});

test('mounted: a 409 already_sent is said in the sheet, the list is read again, and nothing pops up', async () => {
  // Mutation checked: dropping the reload on 409 leaves the sheet showing the version
  // as unsent; dropping `readyRefusal` shows the Worker's raw sentence instead.
  let items = [PRICING];
  let reads = 0;
  const popups = [];
  const prev = { alert: globalThis.alert, confirm: globalThis.confirm };
  globalThis.alert = (...a) => { popups.push(a); }; globalThis.confirm = (...a) => { popups.push(a); return true; };
  const m = await mount((c) => {
    if (c.path === '/api/advisors/me/deliverables/2/versions/2/ready') {
      items = [{ ...PRICING, latest_version: { ...PRICING.latest_version, ...SENT }, versions: [{ ...PRICING.versions[0], ...SENT }, PRICING.versions[1]] }];
      return json({ detail: 'That version has already been sent, so it is not waiting to be sent.', code: 'already_sent' }, 409);
    }
    if (c.path === '/api/advisors/me/deliverables' && c.method === 'GET') reads += 1;
    return readyBase(() => items, { ready: 0 })(c);
  });
  try {
    await m.pressId('open-pr3-2');
    const before = reads;
    await m.pressId('ready-toggle-2');
    assert.match(m.textOf(m.byTestId('ready-answer-2')), /^v2 has already been sent, so it can’t be marked ready or cleared\./);
    assert.equal(m.props(m.byTestId('ready-answer-2')).role, 'alert');
    assert.ok(reads > before, 'the list is read again');
    assert.equal(m.byTestId('ready-toggle-2'), undefined, 'the sent version offers no Ready control');
    assert.equal(popups.length, 0, 'no browser pop-up');
  } finally { await m.close(); Object.assign(globalThis, prev); }
});
