/**
 * D4824 (#4824, EX-06 / EX-07) — Services as cards with the publication state
 * the Worker stores (Draft, Published, Hidden; D5315 part 3), one action to
 * move it with an Undo, a Preview that only opens for a Published service, the
 * price with its currency written out, and the public profile listing what was
 * published. Booking stays with Practice › Sessions (#4832): no card says
 * "Bookable".
 *
 * The zone is the real file, mounted with only `lib/api` replaced. Fixtures
 * are synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';
import {
  SERVICE_PUBLICATION, publicationCounts, publicationOf, servicePrice, servicePublicationAction, serviceRemoveLines,
} from '../src/pages/advisor/expertise/expertiseModel.js';
import { AdvisorProfileView } from '../src/pages/advisor/AdvisorProfilePage.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const API_IMPORT = "import { api } from '../../../lib/api';";

async function servicesZone(apiImpl) {
  globalThis.__api4824 = { api: apiImpl };
  const src = read('frontend/src/pages/advisor/expertise/ServicesZone.jsx');
  assert.ok(src.includes(API_IMPORT));
  const mod = await sourceModule(src.replace(API_IMPORT, 'const { api } = globalThis.__api4824;'), 'pages/advisor/expertise/ServicesZone.jsx');
  const f = await mountForm(h(mod.default));
  await f.flush();
  return f;
}
const click = async (f, id) => { const n = f.by(id); assert.ok(n, id); assert.ok(!f.props(n).disabled, `${id} is enabled`); await act(async () => f.props(n).onClick?.({ preventDefault() {}, stopPropagation() {} })); };
const svc = (id, extra = {}) => ({ id, uid: `svc-${id}`, title: `Synthetic service ${id}`, kind: 'fixed', duration_note: null, price_cents: 45000, currency: 'CHF', scope: null, is_active: true, publication_state: 'draft', units_sold: null, updated_at: 'r1', ...extra });

test('the publication state is the stored one, never derived from Active / Inactive', () => {
  // Mutation checked: publicationOf reading is_active → an inactive published row reads Draft.
  assert.equal(publicationOf({ publication_state: 'published', is_active: false }), 'published');
  assert.equal(publicationOf({ publication_state: 'hidden', is_active: true }), 'hidden');
  assert.equal(publicationOf({ is_active: true }), 'draft', 'a row without the column is the column default');
  assert.equal(publicationOf({ publication_state: 'bookable' }), 'draft', 'an unknown state is not shown as one');
  assert.deepEqual(Object.keys(SERVICE_PUBLICATION), ['draft', 'published', 'hidden']);
  assert.ok(!JSON.stringify(SERVICE_PUBLICATION).includes('Bookable'), 'Published never claims Bookable');
});

test('each state offers one move: Publish, Hide, Publish again', () => {
  assert.deepEqual(servicePublicationAction({ publication_state: 'draft' }), { to: 'published', label: 'Publish', done: 'published on your public profile' });
  assert.deepEqual(servicePublicationAction({ publication_state: 'published' }), { to: 'hidden', label: 'Hide', done: 'hidden from your public profile' });
  assert.equal(servicePublicationAction({ publication_state: 'hidden' }).label, 'Publish again');
  assert.equal(servicePublicationAction({ publication_state: 'hidden' }).to, 'published');
});

test('a price is written with its currency code and its own decimals, and no price is null', () => {
  // Mutation checked: servicePrice using moneyCents → "$450" for USD and "CHF 12,000" (decimals trimmed).
  assert.equal(servicePrice(1200000, 'CHF'), 'CHF 12,000.00');
  assert.equal(servicePrice(45050, 'usd'), 'USD 450.50');
  assert.equal(servicePrice(5000, 'JPY'), 'JPY 5,000');
  assert.equal(servicePrice(0, 'EUR'), 'EUR 0.00', 'zero is a price someone set');
  assert.equal(servicePrice(null, 'EUR'), null);
  assert.match(servicePrice(1234, 'XYZ'), /minor units/, 'an unlisted code names the stored count');
});

test('counts are the whole list from the Worker, else the rows on screen', () => {
  assert.deepEqual(publicationCounts({ publication_counts: { draft: 7, published: 2, hidden: 1 } }, []), { draft: 7, published: 2, hidden: 1 });
  assert.deepEqual(publicationCounts({}, [svc(1), svc(2, { publication_state: 'published' }), svc(3, { publication_state: 'hidden' })]),
    { draft: 1, published: 1, hidden: 1 });
});

test('removing a published service says it comes off the public profile', () => {
  assert.ok(serviceRemoveLines(svc(1, { publication_state: 'published' })).includes('It comes off your public profile.'));
  assert.ok(!serviceRemoveLines(svc(1)).includes('It comes off your public profile.'));
});

test('cards show state, explicit price and booking through Sessions; Hide moves the state and Undo puts it back', async () => {
  // The defect: services showed Active / Inactive only, and nothing published one.
  // Mutation checked: Undo sending the action's own target → the second PATCH says hidden;
  // the toast dropped → no Undo button; Preview enabled for a Draft → the draft's Preview is a link.
  let rows = [svc(1, { publication_state: 'published' }), svc(2), svc(3, { publication_state: 'hidden', price_cents: null })];
  const patches = [];
  const f = await servicesZone({
    async listMyAdvisorServices() { return { items: rows, page: { offset: 0, limit: 200, total: rows.length, next_offset: null } }; },
    async updateMyAdvisorService(id, body) { patches.push([id, body]); rows = rows.map((r) => (r.id === id ? { ...r, ...body } : r)); return rows.find((r) => r.id === id); },
    async getMyAdvisor() { return { uid: 'adv-1' }; },
  });
  try {
    assert.deepEqual([1, 2, 3].map((id) => textOf(f.by(`advisor-service-publication-${id}`))), ['Published', 'Draft', 'Hidden']);
    assert.equal(textOf(f.by('advisor-service-price-1')), 'CHF 450.00');
    assert.equal(textOf(f.by('advisor-service-price-3')), '— No price set');
    assert.match(textOf(f.by('advisor-service-booking-1')), /a session type in Practice › Sessions/);
    assert.deepEqual([1, 2, 3].map((id) => textOf(f.by(`advisor-service-state-${id}`))), ['Hide', 'Publish', 'Publish again']);
    assert.equal(textOf(f.by('advisor-services-publication-counts')), '1 published · 1 draft · 1 hidden');
    assert.ok(!f.text().includes('Bookable'));
    assert.ok(!f.text().includes('Mark inactive'), 'Active / Inactive is not a second state control');

    const preview1 = f.by('advisor-service-preview-1');
    assert.equal(preview1.tagName, 'A', 'a Published service previews its public profile');
    assert.equal(f.props(preview1).href, '/advisors/adv-1');
    assert.equal(f.by('advisor-service-preview-2').tagName, 'BUTTON');
    assert.ok(f.props(f.by('advisor-service-preview-2')).disabled, 'a Draft is not on the public profile');

    await click(f, 'advisor-service-state-1');
    await f.flush();
    assert.deepEqual(patches, [[1, { publication_state: 'hidden' }]]);
    assert.equal(textOf(f.by('advisor-service-publication-1')), 'Hidden');
    assert.match(textOf(f.by('advisor-service-undo')), /“Synthetic service 1” is hidden from your public profile\./);

    await click(f, 'advisor-service-undo-button');
    await f.flush();
    assert.deepEqual(patches[1], [1, { publication_state: 'published' }], 'Undo puts the previous state back');
    assert.equal(textOf(f.by('advisor-service-publication-1')), 'Published');
    assert.equal(textOf(f.by('advisor-service-undo')), '', 'an Undo offers no Undo of its own');
    assert.match(textOf(f.by('advisor-services-note')), /published on your public profile again/);
  } finally { await f.unmount(); delete globalThis.__api4824; }
});

test('a Draft published by mistake goes back to Draft, not to Hidden', async () => {
  let rows = [svc(2)];
  const patches = [];
  const f = await servicesZone({
    async listMyAdvisorServices() { return { items: rows, page: { offset: 0, limit: 200, total: rows.length, next_offset: null } }; },
    async updateMyAdvisorService(id, body) { patches.push(body); rows = rows.map((r) => (r.id === id ? { ...r, ...body } : r)); return rows[0]; },
    async getMyAdvisor() { return null; },
  });
  try {
    await click(f, 'advisor-service-state-2');
    await f.flush();
    assert.ok(f.props(f.by('advisor-service-preview-2')).disabled, 'no public page yet, so no Preview even when Published');
    await click(f, 'advisor-service-undo-button');
    await f.flush();
    assert.deepEqual(patches, [{ publication_state: 'published' }, { publication_state: 'draft' }]);
    assert.match(textOf(f.by('advisor-services-note')), /back to Draft/);
  } finally { await f.unmount(); delete globalThis.__api4824; }
});

test('the editor has no state field: state moves on the card, the form edits the record', async () => {
  const f = await servicesZone({
    async listMyAdvisorServices() { return { items: [svc(4)], page: { offset: 0, limit: 200, total: 1, next_offset: null } }; },
    async getMyAdvisor() { return null; },
  });
  try {
    await click(f, 'advisor-service-edit-4');
    assert.ok(f.by('advisor-service-form-4'));
    assert.ok(!f.by('advisor-service-edit-state'), 'no Active / Inactive select in the editor');
    assert.ok(f.by('advisor-service-edit-currency') && f.by('advisor-service-edit-price'));
  } finally { await f.unmount(); delete globalThis.__api4824; }
});

test('the public profile lists the published services the Worker returns, with explicit prices', () => {
  // Mutation checked: the Services card removed from AdvisorProfileView → no advisor-profile-services.
  const view = (services) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AdvisorProfileView, {
    state: { status: 'ready', advisor: { uid: 'adv-1', display_name: 'Synthetic Advisor', session_types: [], booking_links: [], services } },
  })));
  const page = view([
    { uid: 's1', title: 'Pricing review', kind: 'fixed', duration_note: '2 sessions', price_cents: 45000, currency: 'CHF', scope: null },
    { uid: 's2', title: 'Board readiness', kind: 'fixed', duration_note: null, price_cents: null, currency: 'EUR', scope: null },
  ]);
  assert.match(page, /data-testid="advisor-profile-services"/);
  assert.match(page, /Pricing review/);
  assert.match(page, /CHF 450\.00/);
  assert.match(page, /No price set/);
  assert.match(page, /book a session type/);
  assert.doesNotMatch(view([]), /advisor-profile-services/, 'nothing published, no section');
});
