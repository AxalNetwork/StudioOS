import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AdvisorCard } from '../src/pages/AdvisorsPage.jsx';
import { AdvisorProfileView } from '../src/pages/advisor/AdvisorProfilePage.jsx';
import { DeliverableEditor } from '../src/pages/advisor/practice/DeliverablesByClient.jsx';
import { LinkCard } from '../src/pages/advisor/practice/BookingLinksPanel.jsx';
import { PriceCell } from '../src/pages/advisor/practice/SessionTypesPanel.jsx';
import { deliverableEdit, deliverableStep, priceMode } from '../src/pages/advisor/practice/practiceTools.js';

const html = el => renderToStaticMarkup(h(MemoryRouter, null, el));

test('D573: the directory renders the Worker name, rate and active state without inventing a free price', () => {
  const row = { uid: 'practice-one', display_name: 'Practice One', hourly_rate_usd: 175, is_active: true, expertise: ['Product'] };
  const priced = html(h(AdvisorCard, { advisor: row }));
  assert.match(priced, /Practice One[\s\S]*\$175\/hr[\s\S]*Product/);
  assert.doesNotMatch(priced, /Not accepting bookings/);
  const unknown = html(h(AdvisorCard, { advisor: { ...row, hourly_rate_usd: null } }));
  assert.match(unknown, /Not recorded — no rate set/);
  assert.doesNotMatch(unknown, />Free</);
});

test('D573: due date and manual status reach the editor and payload, while receipt stamps determine delivery and acceptance', () => {
  const item = { id: 1, title: 'Plan', client_name: 'Synthetic client', due_date: '2026-12-31', manual_status: 'in_progress' };
  const editor = html(h(DeliverableEditor, { item }));
  assert.match(editor, /type="date"[^>]*value="2026-12-31"/);
  assert.match(editor, /value="in_progress" selected=""/);
  const payload = deliverableEdit(item, { ...item, due_date: '2027-01-15', manual_status: 'planned' });
  assert.deepEqual([payload.body.due_date, payload.body.manual_status, deliverableStep(item),
    deliverableStep({ ...item, latest_version: { signed_off_at: '2026-12-31T10:00:00Z' } })],
  ['2027-01-15', 'planned', 'in_progress', 'accepted']);
});

test('D573: included is an explicit fact, and recorded link counts and enabled controls reach the card', () => {
  assert.deepEqual([priceMode({ price_cents: 0 }), priceMode({ is_included: true, price_cents: null })], ['price', 'included']);
  assert.match(html(h(PriceCell, { type: { is_included: true } })), /Included/);
  const card = html(h(LinkCard, { link: { id: 1, slug: 'ada/practice', is_active: true, opens_count: 4, booking_count: 2 } }));
  assert.match(card, /Opens: 4[\s\S]*Bookings: 2 attributed/);
  assert.doesNotMatch(card, /disabled=""/);
});

test('D573: the approved public profile lists an actual type and links Book to its mounted booking page', () => {
  const page = html(h(AdvisorProfileView, { state: { status: 'ready', advisor: {
    uid: 'practice-one', display_name: 'Practice One', is_active: true,
    session_types: [{ id: 1, name: 'Strategy session', duration_minutes: 60, is_included: true }],
    booking_links: [{ slug: 'ada/practice', session_type_id: 1, is_active: true }],
  } } }));
  assert.match(page, /Strategy session[\s\S]*60 min[\s\S]*Included/);
  assert.match(page, /href="\/b\/ada\/practice"[^>]*>Book</);
});

test('D573: the new client methods use the mounted Worker endpoints and preserve directory expertise filtering', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, '')]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api, isPublicPath } = await import('../src/lib/api.js');
    await api.openAdvisorBookingLink('ada/practice'); await api.updateMyAdvisorBookingLink(1, { is_active: false });
    await api.listMyAdvisorAccessLog(); await api.acceptReceivedDeliverableVersion('version-one');
    await api.listAdvisors({ specialty: 'Product' });
    assert.deepEqual(calls, [['POST', '/advisors/booking-links/open'], ['PATCH', '/advisors/me/booking-links/1'],
      ['GET', '/advisors/me/access-log'], ['POST', '/advisors/received/deliverables/version-one/accept'],
      ['GET', '/advisors/?expertise=Product']]);
    assert.deepEqual([isPublicPath('/b/ada/practice'), isPublicPath('/advisors/practice-one')], [true, true]);
  } finally { globalThis.fetch = original; }
});
