/**
 * D4841 (#4841) — the `/offers` root is an Offer Readiness dashboard (Offers V2
 * canvas OF-01 and OF-09a, #4872).
 *
 *   1. the five readiness figures reconcile with the zones they link to: each
 *      mirrored rule is held equal to the zone page's own function, and the
 *      figure is the zone's figure over the same read;
 *   2. a read that is loading, failed, or did not carry a field says so —
 *      never a zero;
 *   3. at most three items need attention, each from a recorded state, with
 *      its zone as the target; no state, no item;
 *   4. the rendered view: grouped previews (Sell · Prove · Target · Test) with
 *      every zone one click away, the board anchors kept, and the empty and
 *      new-firm states as the canvas draws them;
 *   5. the zone row groups the Offers pills, and only Offers;
 *   6. the readiness view is opt-in: only the Offers board asks for it.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/offer_readiness_4841.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import BOARDS, { boardFor } from '../src/workspaces/boards/index.js';
import {
  ATTENTION_CAP, LIVE_PROGRAMME_STATUSES, NOT_RECORDED, OFFER_GROUPS, UNREADABLE, ZONE_SOURCE,
  attentionItems, catalogCounts, isNewFirm, programmeCounts, readinessMetrics, serviceState, zonePreview,
} from '../src/workspaces/boards/offerReadiness.js';
import { bucketsFor } from '../src/workspaces/shellConfig.js';
import { perkListingCounts } from '../src/lib/perkListings.js';
import { catalogState } from '../src/pages/ServiceCatalogPage.jsx';
import { VIEW_STATUSES } from '../src/pages/partner/offers/TestingZone.jsx';
import ZoneNav from '../src/workspaces/ZoneNav.jsx';
import { OfferReadinessView } from '../src/workspaces/partner/OfferReadiness.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const STUB = new Proxy({}, { get: () => () => Promise.resolve({}) });
const OFFERS = bucketsFor('partner').find((b) => b.prefix === '/offers');
const board = () => boardFor('partner', '/offers', STUB);

// ── fixtures: one firm's reads, in the shapes the worker serves ─────────────

const SERVICES = [
  { id: 1, title: 'Go-to-market sprint', category: 'strategy', price_cents: 4800000, is_active: true },
  { id: 2, title: 'Fractional CFO', category: 'finance', price_cents: 650000, is_active: true },
  { id: 3, title: 'Data-room preparation', category: 'fundraising', price_cents: null, is_active: true },
  { id: 4, title: 'Pitch rehearsal day', category: 'fundraising', price_cents: 240000, is_active: false },
  { id: 5, title: 'Unpriced, unlisted', category: 'other', price_cents: null, is_active: false },
];
const PERKS = [
  { uid: 'a', offer: 'Twenty percent off', status: 'live', lifecycle: 'live' },
  { uid: 'b', offer: 'Brand audit', status: 'in_review', lifecycle: 'live' },
  { uid: 'c', offer: 'Launch kit', status: 'live', lifecycle: 'expired' },
  { uid: 'd', offer: 'Pricing workshop', status: 'rejected', lifecycle: 'live' },
];
const PROOF = {
  items: [
    { id: 1, title: 'Reduced onboarding from fourteen days to five', is_published: true, consents: [{ consent_given: true }] },
    { id: 2, title: 'Closed a seed round', is_published: false, consents: [{ consent_given: false, requested_at: 'x' }] },
    { id: 3, title: 'Cut monthly close', is_published: false, consents: [] },
  ],
  published_count: 1,
  self_stated_count: 2,
};
const FIT = {
  items: [
    { id: 1, kind: 'best_fit', value: 'B2B SaaS', statement: 'We love this', is_active: true },
    { id: 2, kind: 'budget_floor', floor_cents: 2500000, statement: null, is_active: true },
    { id: 3, kind: 'sector_declined', value: 'Gambling', statement: null, is_active: false },
  ],
  unstated_count: 1,
};
const PROGRAMMES = [
  { uid: 'p1', product_name: 'Founder onboarding pilot', status: 'open', places: 8, picked_count: 5 },
  { uid: 'p2', product_name: 'Pricing calculator beta', status: 'draft', owner_kind: 'partner', places: 12 },
  { uid: 'p3', product_name: 'Investor CRM', status: 'submitted', owner_kind: 'partner', places: 6 },
  { uid: 'p4', product_name: 'Board-pack template', status: 'closed', places: 5 },
  { uid: 'p5', product_name: 'Approved, not opened', status: 'approved', owner_kind: 'partner', places: 5 },
];
const VISIBILITY = { items: [{ id: 1, name: 'Founder referrals', engagement_count: 5, won_value: 96000 }], engagement_total: 9, unattributed_count: 4 };

const ready = (data) => ({ state: 'ready', data, error: null });
const loading = { state: 'loading', data: null, error: null };
const failed = { state: 'error', data: null, error: 'This section could not be read.' };
const populated = (over = {}) => ({
  catalog: ready({ items: SERVICES }),
  perks: ready({ items: PERKS }),
  visibility: ready(VISIBILITY),
  proof: ready(PROOF),
  fit: ready(FIT),
  testing: ready({ items: PROGRAMMES }),
  ...over,
});
const metric = (byKey, key) => readinessMetrics(byKey).find((m) => m.key === key);

// ── 1. reconciliation ──────────────────────────────────────────────────────

test('the mirrored catalogue rule is the Catalog zone’s catalogState, row for row', () => {
  // Mutation checked: `serviceState` returning Live for an unlisted priced row fails here.
  const cases = [
    ...SERVICES,
    { price_cents: 0, is_active: true }, { price_cents: 0, is_active: false },
    { price_cents: undefined, is_active: true }, {},
  ];
  for (const o of cases) assert.equal(serviceState(o), catalogState(o), JSON.stringify(o));
  const c = catalogCounts(SERVICES);
  assert.equal(c.live, SERVICES.filter((o) => catalogState(o) === 'Live').length);
  assert.deepEqual(c, { total: 5, live: 2, draft: 2, unlisted: 1 });
});

test('the live-programme rule is the Testing zone’s Live chip', () => {
  // Mutation checked: adding 'submitted' to LIVE_PROGRAMME_STATUSES fails here.
  assert.deepEqual([...LIVE_PROGRAMME_STATUSES].sort(), [...VIEW_STATUSES.live].sort());
  const c = programmeCounts(PROGRAMMES);
  assert.equal(c.live, PROGRAMMES.filter((p) => VIEW_STATUSES.live.includes(p.status)).length);
  assert.equal(c.waiting, PROGRAMMES.filter((p) => VIEW_STATUSES.waiting.includes(p.status)).length);
  assert.equal(c.drafts, PROGRAMMES.filter((p) => VIEW_STATUSES.drafts.includes(p.status)).length);
});

test('each readiness figure is the figure its zone prints, over the same read', () => {
  const byKey = populated();
  const m = Object.fromEntries(readinessMetrics(byKey).map((x) => [x.key, x]));
  assert.deepEqual(readinessMetrics(byKey).map((x) => x.key), ['services', 'perks', 'proof', 'fit', 'testing'],
    'the five figures are no longer in the canvas’s order');
  assert.equal(m.services.value, '2');
  assert.equal(m.services.note, 'of 5 · 2 draft · 1 unlisted');
  // Perk deals: Live is approved AND not ended — the zone's own count function.
  assert.equal(m.perks.value, `${perkListingCounts(PERKS).live} live`);
  assert.equal(m.perks.value, '1 live');
  assert.equal(m.perks.note, '1 in review · 4 submitted');
  // Proof: the worker's published_count, which the Proof zone's Published tile prints.
  assert.equal(m.proof.value, String(PROOF.published_count));
  assert.equal(m.proof.note, 'of 3 items');
  // Audience fit: active rules, the count the board section summarises as "in use".
  const fitSection = board().sections.find((s) => s.slug === 'audience-fit');
  assert.match(fitSection.summary(FIT), /^2 in use/);
  assert.equal(m.fit.value, '2 rules');
  assert.equal(m.fit.note, 'in use · 1 missing a reply');
  assert.equal(m.testing.value, '2 live');
  assert.equal(m.testing.note, '1 waiting for HQ · 1 draft');
  // Every figure links to the zone it reconciles with.
  for (const x of readinessMetrics(byKey)) assert.ok(OFFERS.zones.some((z) => z.slug === x.slug), `${x.key} links nowhere`);
});

test('the readiness view reads exactly the board’s sources, one per zone', () => {
  const b = board();
  for (const s of b.sections) assert.equal(ZONE_SOURCE[s.slug], s.source, `${s.slug} reads a different source at the root`);
  assert.deepEqual(Object.keys(ZONE_SOURCE).sort(), OFFERS.zones.map((z) => z.slug).sort());
});

// ── 2. honesty states ──────────────────────────────────────────────────────

test('a loading read is loading, a failed read is Unreadable, and neither is zero', () => {
  // Mutation checked: `pending()` returning value '0' for an error fails here.
  const m = metric(populated({ proof: failed, catalog: loading }), 'proof');
  assert.equal(m.state, 'unreadable');
  assert.equal(m.value, UNREADABLE);
  const c = metric(populated({ catalog: loading }), 'services');
  assert.equal(c.state, 'loading');
  assert.equal(c.value, null);
  for (const key of ['catalog', 'perks', 'proof', 'fit', 'testing']) {
    const all = readinessMetrics(populated({ [key]: failed }));
    const bad = all.filter((x) => x.state === 'unreadable');
    assert.equal(bad.length, 1, `${key}: a failed read did not read Unreadable`);
    assert.ok(!/^0/.test(String(bad[0].value)), `${key}: a failed read printed a zero`);
  }
});

test('a read that does not carry its field says Not recorded', () => {
  assert.equal(metric(populated({ proof: ready({ items: [] }) }), 'proof').value, NOT_RECORDED);
  assert.equal(metric(populated({ catalog: ready({}) }), 'services').value, NOT_RECORDED);
  assert.equal(metric(populated({ testing: ready(null) }), 'testing').value, NOT_RECORDED);
  assert.equal(metric(populated({ fit: ready({ items: [] }) }), 'fit').note, 'in use · replies not recorded');
});

test('a firm with nothing yet reads measured zeros, not absences', () => {
  const empty = {
    catalog: ready({ items: [] }), perks: ready({ items: [] }), visibility: ready({ items: [], unattributed_count: 0 }),
    proof: ready({ items: [], published_count: 0, self_stated_count: 0 }), fit: ready({ items: [], unstated_count: 0 }),
    testing: ready({ items: [] }),
  };
  assert.deepEqual(readinessMetrics(empty).map((x) => x.value), ['0', '0 live', '0', '0 rules', '0 live']);
  assert.equal(isNewFirm(empty), true);
  assert.equal(isNewFirm(populated()), false);
  assert.equal(isNewFirm(populated({ catalog: failed })), false, 'an unreadable catalogue is not an empty one');
});

// ── 3. what needs attention ────────────────────────────────────────────────

test('at most three items, most valuable first, with the rest counted', () => {
  // Mutation checked: ATTENTION_CAP = 4 fails the cap; dropping `.slice` fails it too.
  const a = attentionItems(populated());
  assert.equal(ATTENTION_CAP, 3);
  assert.equal(a.state, 'ready');
  assert.equal(a.items.length, 3);
  assert.ok(a.candidates > 3, 'the fixture should produce more candidates than the cap');
  assert.deepEqual(a.items.map((i) => i.key), ['proof-unapproved', 'fit-unstated', 'testing-draft']);
  assert.equal(a.items[0].body, '2 of 3 proof items have no client approval yet.');
  assert.equal(a.items[1].body, '1 rule in use has no reply for the leads it turns away.');
  for (const i of a.items) {
    assert.ok(OFFERS.zones.some((z) => z.slug === i.slug), `${i.key} targets no zone`);
    assert.ok(i.cta && i.title && i.body, `${i.key} has no direct action`);
  }
});

test('each item exists only while its recorded state does', () => {
  const quiet = populated({
    proof: ready({ items: PROOF.items.slice(0, 1), published_count: 1, self_stated_count: 0 }),
    fit: ready({ ...FIT, unstated_count: 0 }),
    testing: ready({ items: PROGRAMMES.filter((p) => p.status !== 'draft') }),
    catalog: ready({ items: SERVICES.filter((o) => o.price_cents != null) }),
    perks: ready({ items: PERKS.filter((p) => p.status !== 'rejected') }),
    visibility: ready({ ...VISIBILITY, unattributed_count: 0 }),
  });
  const a = attentionItems(quiet);
  assert.deepEqual(a.items, [], 'an item appeared with no state behind it');
  assert.equal(a.candidates, 0);
  // One state at a time brings back exactly its own item.
  const one = (over, key) => assert.deepEqual(attentionItems({ ...quiet, ...over }).items.map((i) => i.key), [key]);
  one({ visibility: ready(VISIBILITY) }, 'visibility-unattributed');
  one({ perks: ready({ items: PERKS }) }, 'perks-rejected');
  one({ catalog: ready({ items: SERVICES }) }, 'catalog-drafts');
  one({ testing: ready({ items: [{ uid: 'x', product_name: 'Beta', status: 'rejected' }] }) }, 'testing-sent-back');
  one({ proof: ready({ items: [], published_count: 0, self_stated_count: 0 }) }, 'proof-none');
  one({ fit: ready({ items: [], unstated_count: 0 }) }, 'fit-none');
  // HQ's own draft is not the firm's to submit.
  assert.deepEqual(attentionItems({ ...quiet, testing: ready({ items: [{ uid: 'h', status: 'draft', owner_kind: 'hq' }] }) }).items, []);
});

test('a failed read contributes no item, and the list waits for every read', () => {
  const a = attentionItems(populated({ proof: failed, fit: failed }));
  assert.ok(!a.items.some((i) => /^proof|^fit/.test(i.key)), 'an item was built on a read that failed');
  assert.equal(attentionItems(populated({ visibility: loading })).state, 'loading');
  assert.deepEqual(attentionItems(populated({ visibility: loading })).items, []);
});

test('a brand-new firm gets its first step, not a list of gaps', () => {
  const fresh = {
    catalog: ready({ items: [] }), perks: ready({ items: [] }), visibility: ready({ items: [], unattributed_count: 0 }),
    proof: ready({ items: [], published_count: 0, self_stated_count: 0 }), fit: ready({ items: [], unstated_count: 0 }),
    testing: ready({ items: [] }),
  };
  assert.deepEqual(attentionItems(fresh).items, [], 'the canvas’s new firm (OF-01 B) has no invented items');
});

test('the copy on this page never speaks in regulated terms', () => {
  const src = codeOnly(read('frontend/src/workspaces/boards/offerReadiness.js'))
    + codeOnly(read('frontend/src/workspaces/partner/OfferReadiness.jsx'));
  for (const [, quoted] of src.matchAll(/'([^'\\]*)'|`([^`]*)`|>([^<>{}]+)</g)) {
    if (quoted) assert.doesNotMatch(quoted, /recommend|advice|advis|fiduciary/i, quoted);
  }
});

// ── 4. the rendered view ───────────────────────────────────────────────────

const render = (byKey) => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/offers'] },
    React.createElement(OfferReadinessView, { bucket: OFFERS, board: board(), byKey })),
);

test('the populated view: figures, three items, then the four groups with every zone a link', () => {
  const html = render(populated());
  assert.ok(html.includes('aria-label="Commercial readiness"'));
  assert.equal((html.match(/data-testid="readiness-/g) || []).length, 5);
  assert.equal((html.match(/data-testid="attention-cta-/g) || []).length, 3, 'more than three items rendered');
  assert.equal(attentionItems(populated()).candidates, 6);
  assert.ok(html.includes('3 of 6'), 'the count line does not say how many are not shown');
  assert.ok(!html.includes('data-testid="offer-first-step"'));
  // Sell · Prove · Target · Test, in order, each holding its zones.
  const at = OFFER_GROUPS.map((g) => html.indexOf(`data-testid="offer-group-${g.key}"`));
  assert.ok(at.every((i) => i > 0) && at.every((i, k) => k === 0 || i > at[k - 1]), 'the groups are missing or out of order');
  for (const zone of OFFERS.zones) {
    assert.ok(html.includes(`href="/offers/${zone.slug}"`), `${zone.label} is not one click away`);
    const section = board().sections.find((s) => s.slug === zone.slug);
    assert.ok(html.includes(`id="${section.anchor}"`), `${zone.slug} lost its board anchor (D403)`);
  }
  // Zone notes are kept, behind a disclosure rather than as permanent prose.
  assert.ok(html.includes('<details'), 'the counting notes are gone');
  assert.ok(!/recommend/i.test(html));
});

test('the empty and failed states render as words, never as zeros or blank tables', () => {
  const fresh = render({
    catalog: ready({ items: [] }), perks: ready({ items: [] }), visibility: ready({ items: [], unattributed_count: 0 }),
    proof: ready({ items: [], published_count: 0, self_stated_count: 0 }), fit: ready({ items: [], unstated_count: 0 }),
    testing: ready({ items: [] }),
  });
  assert.ok(fresh.includes('data-testid="offer-first-step"'), 'the new firm has no first step');
  assert.ok(fresh.includes('href="/offers/catalog"'));
  assert.ok(fresh.includes('data-testid="offer-attention-empty"'), 'an empty list is not said in words');
  const broken = render(populated({ proof: failed }));
  assert.ok(broken.includes(UNREADABLE));
  assert.ok(broken.includes('Try again'));
  assert.match(broken, /data-testid="readiness-proof" data-state="unreadable"/);
});

// ── 5. the zone row ────────────────────────────────────────────────────────

const nav = (bucket, path, activeSlug) => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: [path] },
    React.createElement(ZoneNav, { bucket, role: 'partner', activeSlug })),
);

test('the Offers zone row groups its pills, keeps every route, and lights Overview on the root', () => {
  const root = nav(OFFERS, '/offers', null);
  assert.ok(root.includes('data-testid="zone-nav-grouped"'));
  for (const g of OFFER_GROUPS) assert.ok(root.includes(`role="group" aria-label="${g.label}"`), `${g.label} is not shown`);
  for (const zone of OFFERS.zones) assert.ok(root.includes(`href="/offers/${zone.slug}"`), `${zone.slug} lost its pill`);
  const current = root.match(/<a[^>]*aria-current="page"[^>]*>/g) || [];
  assert.equal(current.length, 1);
  assert.ok(current[0].includes('link-zone-overview'), 'the root does not light Overview');
  // On a zone, the zone is current and Overview is not.
  const proof = nav(OFFERS, '/offers/proof', undefined);
  const lit = proof.match(/<a[^>]*aria-current="page"[^>]*>/g) || [];
  assert.equal(lit.length, 1, 'Overview matched every zone under it');
  assert.ok(lit[0].includes('link-zone-proof'));
});

test('no other bucket groups its zone row', () => {
  // Mutation checked: giving Pipeline `groups` fails here.
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    for (const b of bucketsFor(role)) {
      if (b.prefix === '/offers') continue;
      assert.equal(b.groups, undefined, `${role} ${b.prefix} has groups`);
      if (b.zones.length) assert.ok(!nav(b, `${b.prefix}/${b.zones[0].slug}`).includes('zone-nav-grouped'));
    }
  }
  // The groups name each Offers zone once.
  assert.deepEqual(OFFER_GROUPS.flatMap((g) => g.zones).sort(), OFFERS.zones.map((z) => z.slug).sort());
});

// ── 6. opt-in ──────────────────────────────────────────────────────────────

test('only the Offers board asks for the readiness view, and the route honours it', () => {
  for (const key of Object.keys(BOARDS)) {
    const [role, prefix] = key.split(':');
    const want = key === 'partner:/offers' ? 'readiness' : undefined;
    assert.equal(boardFor(role, prefix, STUB).overview, want, `${key} overview`);
  }
  const routes = codeOnly(read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx'));
  assert.match(routes, /if \(board\?\.overview === 'readiness'\) return <OfferReadiness bucket=\{bucket\} board=\{board\} \/>;/);
});

test('zone previews draw from the zone’s own rows', () => {
  assert.deepEqual(zonePreview('catalog', { items: SERVICES }).map((r) => r.status), ['Live', 'Live', 'Draft']);
  assert.deepEqual(zonePreview('proof', PROOF).map((r) => r.status), ['Client approved', 'Not client-approved', 'Not client-approved']);
  assert.deepEqual(zonePreview('audience-fit', FIT).map((r) => r.label), ['We love this', null]);
  assert.deepEqual(zonePreview('testing', null), []);
});
