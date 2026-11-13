// #4715 — the exact offer stays visible through booking and confirmation. A
// booking made for one session type states that type's name, length and
// price, not the advisor's general hourly rate; the confirmation and the
// booking lists read the offer the worker copied onto the booking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';
import { offerFromType, offerLine, offerPrice } from '../src/pages/advisor/advisory/kit.jsx';

// One clock read: the detail lists a slot only when its length equals the type's.
const START = new Date(Date.now() + 2 * 86_400_000).toISOString();
const TYPE = { id: 301, name: 'Strategy call', duration_minutes: 45, price_cents: 15000, is_free_intro: false, is_included: false, cadence_note: 'One-off' };

test('offer helpers: the worker’s shape, every pricing mode, and the whole offer on one line', () => {
  assert.deepEqual(offerFromType(TYPE), { session_type_id: 301, name: 'Strategy call', duration_minutes: 45, pricing: 'price', price_cents: 15000, cadence_note: 'One-off' });
  assert.equal(offerLine(offerFromType(TYPE)), 'Strategy call · 45 min · $150');
  assert.equal(offerPrice({ pricing: 'price', price_cents: 15050 }), '$150.50');
  assert.equal(offerPrice(offerFromType({ ...TYPE, is_free_intro: true })), 'Free intro');
  assert.equal(offerPrice(offerFromType({ ...TYPE, is_included: true })), 'Included, no separate charge');
  assert.equal(offerPrice(offerFromType({ ...TYPE, price_cents: null })), 'Price not set');
  assert.equal(offerFromType(null), null);
  assert.equal(offerLine(null), null);
});

const API_IMPORT = "import { api } from '../lib/api';";

async function mountDetail(props, booked) {
  const src = readFileSync(new URL('../src/pages/AdvisorsPage.jsx', import.meta.url), 'utf8');
  assert.ok(src.includes(API_IMPORT));
  const calls = [];
  globalThis.__api4715offer = { api: {
    listAdvisorSlots: async () => ({ items: [{ id: 7, uid: 's-7', advisor_id: 1, starts_at: START, ends_at: new Date(Date.parse(START) + 45 * 60_000).toISOString(), capacity: 1, taken: 0, available: 1, is_cancelled: false, has_meeting_link: false }] }),
    bookAdvisorSlot: async (id, body) => { calls.push({ id, body }); return booked; },
  } };
  const mod = await sourceModule(src.replace(API_IMPORT, 'const { api } = globalThis.__api4715offer;'), 'pages/AdvisorsPage.jsx');
  const f = await mountForm(h(mod.AdvisorDetail, { advisor: { uid: 'a-1', display_name: 'Advisor', hourly_rate_usd: 400 }, onClose() {}, ...props }), { modal: true });
  await f.flush?.();
  return { f, calls };
}

test('AdvisorDetail for a session type states that offer, not the hourly rate; the form shows it before booking', async () => {
  const { f } = await mountDetail({ sessionType: TYPE, bookingLinkSlug: 'strategy' });
  try {
    await f.flush?.();
    assert.match(textOf(f.by('detail-offer')), /Strategy call · 45 min · \$150/);
    assert.ok(!f.text().includes('$400/hr'), 'the general rate is not shown for a typed booking');
    await f.click('Book');
    assert.match(textOf(f.by('booking-offer')), /You are booking: Strategy call · 45 min · \$150/);
    assert.match(textOf(f.by('booking-offer')), /One-off/);
  } finally { await f.unmount(); }
});

test('AdvisorDetail with no session type keeps the hourly rate and shows no offer', async () => {
  const { f } = await mountDetail({});
  try {
    await f.flush?.();
    assert.ok(f.text().includes('$400/hr'));
    assert.equal(f.by('detail-offer'), undefined);
    await f.click('Book');
    assert.equal(f.by('booking-offer'), undefined);
  } finally { await f.unmount(); }
});

test('the public confirmation names the offer the worker recorded', async () => {
  const { bookedNotice } = await import('../src/pages/advisor/PublicAdvisorBookingPage.jsx');
  assert.equal(bookedNotice({ offer: offerFromType(TYPE) }), 'Your booking request was recorded: Strategy call · 45 min · $150.');
  assert.equal(bookedNotice({ offer: null }), 'Your booking request was recorded.');
  assert.equal(bookedNotice(undefined), 'Your booking request was recorded.');
});

test('the founder’s booking list and the advisor’s request card read the recorded offer', () => {
  const page = readFileSync(new URL('../src/pages/AdvisorsPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /data-testid=\{`booking-offer-\$\{b\.id\}`\}[^>]*>\{offerLine\(b\.offer\)\}/);
  const zone = readFileSync(new URL('../src/pages/advisor/practice/OpportunitiesZone.jsx', import.meta.url), 'utf8');
  assert.match(zone, /data-testid=\{`request-offer-\$\{r\.raw\.id\}`\}[^>]*>\{offerLine\(r\.raw\.offer\)\}/);
});
