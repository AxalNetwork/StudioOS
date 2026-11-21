/**
 * #4833 part 4 (D4833-p4, Practice UX 5/6): Delivery inside the Practice v2
 * shell (#4829, D4829), built to the Practice v2 canvas's PX-06 header
 * (`design/incoming/Practice v2 Page.dc.html`, D4874).
 *
 *   · the shell heads the zone "Delivery" with PX-06's own line, not the
 *     cockpit's bucket sentence, and the section row marks Delivery;
 *   · the header's one primary is New work product, the page's handler,
 *     portalled into the shell's slot, and there in every state of the list:
 *     loaded, empty (first work product) and unreadable (disabled, saying why);
 *   · the chips are drawn only over a list that was read and holds a card;
 *   · the body follows PX-06 A: cards, then Post-session reviews, then the
 *     receipt tiles and what Delivery cannot say (behind a disclosure);
 *   · a card's client opens the shared Client Sheet on its Delivery tab.
 *
 * Every record below is made up.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_delivery_shell_4833.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AdvisorBucketRoutes from '../src/workspaces/advisor/AdvisorBucketRoutes.jsx';
import DeliveryZone from '../src/pages/advisor/practice/DeliveryZone.jsx';
import { ADVISOR_ZONE_ACTIONS } from '../src/workspaces/advisorZoneActions.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// PX-06's header, read from the canvas: `hdr('Delivery', '<line>', '<primary>')`.
const CANVAS = read('design/incoming/Practice v2 Page.dc.html');
const HDR = /const delivery = \(\) => hdr\('([^']*)', '([^']*)', '([^']*)'\)/.exec(CANVAS);
const BUCKET_SENTENCE = 'What needs attention, what is committed, and what has moved.';

const V = (version, over = {}) => ({
  uid: `u${version}`, version, label: null, summary: `Change ${version}`, link_url: `https://docs.example/v${version}`,
  sent_at: null, opened_at: null, signed_off_at: null, recipient_user_id: null, recipient_name: null, ...over,
});
const SENT = { sent_at: '2026-11-06T10:00:00Z', recipient_user_id: 50, recipient_name: 'J. Park' };
const MEMO = {
  id: 1, title: 'Q4 Strategy Memo', client_name: 'Acme', engagement_id: 9, client_user_id: 50,
  client_user_name: 'J. Park', client_user_email: 'jpark@example.test', state: 'opened', version_count: 1,
  latest_version: V(1, { ...SENT, opened_at: '2026-11-06T12:00:00Z' }),
  versions: [V(1, { ...SENT, opened_at: '2026-11-06T12:00:00Z' })],
};
const UNLINKED = {
  id: 2, title: 'Board prep notes', client_name: 'Lumen', engagement_id: null, client_user_id: null,
  client_user_name: null, client_user_email: null, state: 'not_started', version_count: 1,
  latest_version: V(1), versions: [V(1)],
};

/** Mounts `element` at `path` with every read answered by `handle`. */
async function mount(element, handle, path = '/practice/delivery') {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const call = { method: (init.method || 'GET').toUpperCase(), path: url.pathname };
    seen.push(call);
    return handle(call);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  // A macrotask turn per round, so fetches and lazy imports resolve; no clock is read.
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, element)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const all = () => walk(document.body);
  return {
    walk, textOf, props, byTestId, all, settle, seen,
    text: () => textOf(document.body),
    async pressId(id) { const b = byTestId(id); assert.ok(b, `no ${id}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const answer = (deliverables) => (c) => {
  if (c.path === '/api/advisors/me/deliverables') return deliverables();
  if (c.path === '/api/advisors/me/engagements') return json({ items: [{ id: 9, client_name: 'Acme', founder_user_id: 50 }], totals: {} });
  if (c.path === '/api/advisors/me/bookings') return json({ items: [] });
  return json({ items: [] });
};
const listed = (items) => answer(() => json({ items, totals: { work_products: items.length, ready: 0 } }));

// ---------------------------------------------------------------- the canvas, read

test('PX-06\'s header is the shell\'s: "Delivery", its own line, and New work product as the one primary', () => {
  assert.ok(HDR, 'the canvas no longer declares PX-06\'s header as hdr(title, line, primary)');
  const [, title, line, primary] = HDR;
  assert.equal(title, 'Delivery');
  // The section row names the zone the shell heads with its pill label.
  assert.match(CANVAS, /const ZONES = \[[^\]]*'Delivery'/);
  const routes = read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx');
  assert.ok(routes.includes(`delivery: { sub: '${line}' }`), 'the shell carries PX-06\'s own line for Delivery');
  const primaries = ADVISOR_ZONE_ACTIONS['practice/delivery'].filter((r) => r.primary === true);
  assert.deepEqual(primaries.map((r) => r.label), [primary], 'the zone\'s one primary is the canvas\'s');
  assert.equal(primaries[0].kind, 'handler');
  assert.equal(primaries[0].handler, 'newWorkProduct');
});

// ---------------------------------------------------------------- mounted in the shell

test('mounted in the Practice shell: h1 Delivery, PX-06\'s line, the section row, and the primary in the header', async () => {
  const m = await mount(h(AdvisorBucketRoutes), listed([MEMO]));
  try {
    const h1 = m.all().filter((n) => n.tagName === 'H1');
    assert.equal(h1.length, 1, 'one h1 per page');
    assert.equal(m.textOf(h1[0]).trim(), 'Delivery');
    assert.ok(m.text().includes(HDR[2]), 'PX-06\'s line under the heading');
    assert.ok(!m.text().includes(BUCKET_SENTENCE), 'the cockpit\'s sentence is the root\'s, not Delivery\'s');
    assert.ok(m.byTestId('zone-nav-scroll'), 'the Practice v2 section row');
    const current = m.all().find((n) => m.props(n)?.['aria-current'] === 'page' && m.props(n)?.['data-testid'] === 'link-zone-delivery');
    assert.ok(current, 'Delivery is the current section');
    // The primary is portalled into the header's slot, not left in the body's toolbar.
    const slot = m.byTestId('zone-primary-slot');
    assert.ok(slot, 'the header has a primary slot');
    const button = m.walk(slot).find((n) => m.props(n)?.['data-testid'] === 'action-delivery-new-work-product');
    assert.ok(button, 'New work product sits in the header');
    assert.equal(m.textOf(button), 'New work product');
    assert.equal(m.props(button)['data-primary'], 'true');
    assert.ok(!m.byTestId('work-product-create'), 'the form is closed until asked for');
    await m.pressId('action-delivery-new-work-product');
    assert.ok(m.byTestId('work-product-create'), 'the primary opens the v1 form');
    assert.equal(m.seen.filter((c) => c.method !== 'GET').length, 0, 'opening it writes nothing');
    await m.pressId('new-work-product-cancel');
    assert.ok(!m.byTestId('work-product-create'), 'and Cancel closes it');
  } finally { await m.close(); }
});

test('first work product: the primary is in the header, no chip counts an empty list, reviews stand', async () => {
  const m = await mount(h(AdvisorBucketRoutes), listed([]));
  try {
    const slot = m.byTestId('zone-primary-slot');
    const button = m.walk(slot).find((n) => m.props(n)?.['data-testid'] === 'action-delivery-new-work-product');
    assert.ok(button, 'the primary is there with no work product');
    assert.notEqual(m.props(button).disabled, true);
    assert.match(m.text(), /No work product is on file/);
    assert.doesNotMatch(m.textOf(m.byTestId('zone-toolbar')), /Draft|Accepted|All/, 'no chip row over an empty list');
    assert.ok(m.byTestId('review-loop'), 'post-session reviews without a work product');
    assert.ok(!m.byTestId('delivery-receipts'), 'no receipt tiles over nothing');
    await m.pressId('action-delivery-new-work-product');
    assert.ok(m.byTestId('work-product-create'), 'the v1 form opens from the empty state');
  } finally { await m.close(); }
});

test('delivery source unreadable: Unavailable with Try again, the primary disabled and saying why, reviews stand', async () => {
  const m = await mount(h(AdvisorBucketRoutes), answer(() => json({ detail: 'down' }, 500)));
  try {
    // #5129's shared vocabulary (`SectionState`, D4828): the chip says Unavailable, and the rest of the page stands.
    const alert = m.all().find((n) => m.props(n)?.role === 'alert' && /could not be read|down/.test(m.textOf(n)));
    assert.ok(alert, 'the failed read is announced');
    assert.match(m.textOf(alert), /Unavailable/);
    assert.match(m.textOf(alert), /Other sections are unaffected\./);
    assert.doesNotMatch(m.text(), /This did not load/);
    assert.ok(m.all().find((n) => n.tagName === 'BUTTON' && /Try again/.test(m.textOf(n))), 'a retry');
    assert.doesNotMatch(m.text(), /No work product is on file/, 'an unreadable list is not an empty one');
    const button = m.byTestId('action-delivery-new-work-product');
    assert.ok(button, 'the primary is still drawn');
    assert.equal(m.props(button).disabled, true);
    assert.match(m.props(button).title, /could not be read/);
    assert.doesNotMatch(m.textOf(m.byTestId('zone-toolbar')), /Draft|Accepted|All/, 'no chip counts a list that was not read');
    assert.ok(m.byTestId('review-loop'), 'post-session reviews when Delivery cannot be read');
    assert.ok(!m.byTestId('delivery-receipts'), 'no receipt tiles over an unread list');
  } finally { await m.close(); }
});

test('PX-06 A\'s order: chips, cards, then post-session reviews; tiles after; the limits behind a disclosure', async () => {
  const m = await mount(h(DeliveryZone), listed([MEMO, UNLINKED]));
  try {
    const order = m.all().map((n) => m.props(n)?.['data-testid']).filter(Boolean);
    const at = (id) => { const i = order.indexOf(id); assert.ok(i >= 0, `no ${id}`); return i; };
    assert.ok(at('zone-toolbar') < at('delivery-cards'), 'the chips lead');
    assert.ok(at('delivery-cards') < at('review-loop'), 'the reviews follow the cards');
    assert.ok(at('review-loop') < at('delivery-receipts'), 'the receipt tiles come after the reviews');
    const limits = m.byTestId('delivery-limits');
    assert.equal(limits.tagName, 'DETAILS', 'what Delivery cannot say is a disclosure');
    assert.match(m.textOf(limits), /What Delivery cannot say/);
    assert.match(m.textOf(m.byTestId('zone-toolbar')), /Draft\s*1/);
    assert.equal(m.all().filter((n) => n.tagName === 'H2' && m.textOf(n) === 'Work products').length, 0,
      'the body draws no second heading under the shell\'s');
  } finally { await m.close(); }
});

test('a card\'s client opens the shared Client Sheet on its Delivery tab; a client with no account is plain text', async () => {
  const m = await mount(h(DeliveryZone), listed([MEMO, UNLINKED]));
  try {
    assert.ok(!m.byTestId('client-pr3-2'), 'no sheet for a client with no account');
    assert.match(m.textOf(m.byTestId('row-pr3-2')), /Lumen/);
    const client = m.byTestId('client-pr3-1');
    assert.equal(client.tagName, 'BUTTON');
    assert.equal(m.textOf(client), 'Acme');
    assert.match(m.props(client).className, /max-sm:min-h-\[44px\]/, 'a 44px target on a phone');
    await m.pressId('client-pr3-1');
    assert.ok(m.byTestId('client-sheet-50'), 'the Client Sheet for that account');
    const tab = m.all().find((n) => m.props(n)?.role === 'tab' && m.textOf(n) === 'Delivery');
    assert.equal(m.props(tab)['aria-selected'], true, 'opened on Delivery');
    assert.ok(!m.byTestId('deliverable-sheet-1'), 'the client, not the work product');
    assert.match(m.props(m.byTestId('open-pr3-1')).className, /max-sm:min-h-\[44px\]/, 'Open is a 44px target on a phone');
  } finally { await m.close(); }
});
