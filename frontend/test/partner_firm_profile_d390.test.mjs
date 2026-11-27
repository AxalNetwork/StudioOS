/**
 * D390 — item 1a of retiring /partner/operations/*: the two jobs that existed
 * nowhere else get a canvas-built home BEFORE the old routes go.
 *
 *   1. The firm profile edit, the founder-introductions toggle and the partner
 *      agreement summary (Overview's whole job) → `PartnerFirmProfileCard`,
 *      for Firm Settings (`/company-settings`). Built and tested here; D395
 *      mounts it (partner_operations_retired_d395.test.mjs pins the mount).
 *   2. Founder reviews (Performance's and Portfolio's) → a section on
 *      Delivery · Health, mounted.
 *
 * Every state is rendered from its pure view, so these tests draw what a
 * reader would see without a network: ready, unlinked, unreadable, empty.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_firm_profile_d390.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import {
  PartnerFirmProfileView, NO_PARTNER_PROFILE,
} from '../src/pages/partner/PartnerFirmProfileCard.jsx';
import {
  FounderReviewsView, readFounderReviews, REVIEW_WINDOW,
} from '../src/pages/partner/delivery/FounderReviews.jsx';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), p), 'utf8'));
const cardSrc = read('frontend/src/pages/partner/PartnerFirmProfileCard.jsx');
const healthSrc = read('frontend/src/pages/partner/delivery/HealthZone.jsx');

const PROFILE = {
  id: 7, uid: 'p-7', name: 'Northwind Partners', company: null, email: 'ops@northwind.example',
  specialization: 'GTM, Pricing', referral_code: 'NW-TEST', referrals_count: 0,
  status: 'active', accepting_intros: true, created_at: '2026-03-02T10:00:00Z',
};
const DEAL = {
  deal: {
    deal_type: 'referral_partner', status: 'active', term_months: 12,
    granted_tier_founder: 'growth', granted_tier_investor: 'studio',
    activated_at: '2026-04-01T00:00:00Z', expires_at: null,
  },
  redemptions_count: 3,
};

const card = (props) => renderedText(renderToStaticMarkup(React.createElement(PartnerFirmProfileView, {
  profile: { status: 'ready', data: PROFILE },
  deal: { status: 'ready', data: DEAL },
  ...props,
})));

// ── The card ────────────────────────────────────────────────────────────────

test('D390: the card names its store — the partner profile, not the company record', () => {
  const t = card();
  assert.match(t, /Firm profile/);
  assert.match(t, /not the\s+company record/, 'the card must say it is not the company record');
});

test('D390: a ready profile draws every field Overview drew, and an absent one as absent', () => {
  const t = card();
  for (const s of ['Northwind Partners', 'ops@northwind.example', 'NW-TEST', 'active', 'GTM', 'Pricing']) {
    assert.ok(t.includes(s), `the ready card must show ${s}`);
  }
  // company is NULL → Not recorded, never a blank or a dash.
  const html = renderToStaticMarkup(React.createElement(PartnerFirmProfileView, {
    profile: { status: 'ready', data: PROFILE }, deal: { status: 'ready', data: DEAL },
  }));
  const company = html.slice(html.indexOf('data-testid="firm-company"'), html.indexOf('data-testid="firm-specialisations"'));
  assert.match(renderedText(company), /Not recorded/, 'a NULL company reads Not recorded');
  // A referral count of 0 is a stored count, so it prints.
  const refs = html.slice(html.indexOf('data-testid="firm-referrals"'));
  assert.match(renderedText(refs), /Referrals to date0/);
});

test('D390: the intro toggle states which way it is set and offers the other', () => {
  const on = card();
  assert.match(on, /Founder introductions/);
  assert.match(on, /On — founders can ask/);
  assert.match(on, /Turn off/);
  const off = card({ profile: { status: 'ready', data: { ...PROFILE, accepting_intros: false } } });
  assert.match(off, /Off — founders cannot ask/);
  assert.match(off, /Turn on/);
});

test('D390: Edit opens the three editable fields, prefilled from the row', () => {
  const html = renderToStaticMarkup(React.createElement(PartnerFirmProfileView, {
    profile: { status: 'ready', data: PROFILE }, deal: { status: 'ready', data: DEAL }, editing: true,
  }));
  assert.match(html, /data-testid="firm-profile-editor"/);
  assert.match(html, /value="Northwind Partners"/);
  assert.match(html, /value="GTM, Pricing"/);
  assert.equal((html.match(/<input/g) || []).length, 3, 'name, company and specialisation — nothing else is editable');
});

test('D390: an unlinked sign-in reads as a fact about the account, not a failure', () => {
  const t = card({ profile: { status: 'unlinked' } });
  assert.match(t, /No partner profile is attached to this sign-in/);
  assert.doesNotMatch(t, /could not be read/);
});

test('D390: a failed profile read is Unreadable with a retry, never an empty profile', () => {
  const html = renderToStaticMarkup(React.createElement(PartnerFirmProfileView, {
    profile: { status: 'unreadable' }, deal: { status: 'ready', data: DEAL }, onRetry: () => {},
  }));
  const t = renderedText(html);
  assert.match(t, /The firm profile could not be read/);
  assert.match(t, /Retry/);
  assert.doesNotMatch(html, /firm-profile-ready/);
  assert.doesNotMatch(t, /No partner profile is attached/, 'a failure must not claim the account is unlinked');
});

test('D390: the agreement is read-only, and "none on record" differs from "unreadable"', () => {
  const t = card();
  for (const s of ['referral partner', '12 months', 'growth', 'studio']) assert.ok(t.includes(s), s);
  assert.match(t, /Referral redemptions3/);
  const none = card({ deal: { status: 'ready', data: { deal: null, redemptions_count: 0 } } });
  assert.match(none, /No partner agreement is on record/);
  const bad = card({ deal: { status: 'unreadable' }, onRetryDeal: () => {} });
  assert.match(bad, /The partner agreement could not be read/);
  assert.doesNotMatch(bad, /No partner agreement is on record/);
});

test('D390: the card branches on the refusal CODE, and writes through the partners row only', () => {
  assert.equal(NO_PARTNER_PROFILE, 'no_partner_profile');
  assert.match(cardSrc, /e\?\.code === NO_PARTNER_PROFILE/);
  assert.doesNotMatch(cardSrc, /isNoPartnerProfile|\.message\s*\)?\s*\.?(match|test)\(|\/no partner profile\/i/,
    'the card must not match the refusal by its words');
  for (const m of ['partnerPortal.getProfile', 'partnerPortal.updateProfile', 'partnerPortal.setAcceptingIntros', 'partnerPortal.myDeal']) {
    assert.ok(cardSrc.includes(`api.${m}(`), `the card calls api.${m}`);
  }
  assert.doesNotMatch(cardSrc, /updateCompany|\/company\//, 'the card never writes the company record');
});

// ── Founder reviews on Delivery · Health ────────────────────────────────────

function fakeClient({ engagements, reviews = {}, failEngagements = false, failReviews = [] }) {
  return {
    partnerPortal: { getProfile: async () => ({ partner: { id: 7 } }) },
    listEngagements: async () => {
      if (failEngagements) throw new Error('down');
      return { items: engagements };
    },
    listEngagementReviews: async (id) => {
      if (failReviews.includes(id)) throw new Error('down');
      return { items: reviews[id] || [] };
    },
  };
}

test('D390: reviews are the signed-in firm\'s own, and the founder\'s only', async () => {
  const r = await readFounderReviews(fakeClient({
    engagements: [
      { id: 1, partner_id: 7, status: 'delivered', delivered_at: '2026-09-01' },
      { id: 2, partner_id: 8, status: 'delivered', delivered_at: '2026-09-02' }, // another firm (admin-wide list)
      { id: 3, partner_id: 7, status: 'in_progress' },                            // not completed
    ],
    reviews: {
      1: [{ id: 11, reviewer_role: 'founder', rating: 4, created_at: '2026-09-03' },
          { id: 12, reviewer_role: 'partner', rating: 5, created_at: '2026-09-04' }],
      2: [{ id: 21, reviewer_role: 'founder', rating: 1, created_at: '2026-09-05' }],
    },
  }));
  assert.deepEqual(r.reviews.map((x) => x.id), [11], 'only firm 7, only founder-authored');
  assert.equal(r.completed, 1);
  assert.equal(r.unread, 0);
});

test('D390: the read is windowed and counts what it could not read', async () => {
  const engagements = Array.from({ length: REVIEW_WINDOW + 3 }, (_, i) => ({
    id: i + 1, partner_id: 7, status: 'reviewed', delivered_at: `2026-08-${String(i + 1).padStart(2, '0')}`,
  }));
  const r = await readFounderReviews(fakeClient({ engagements, failReviews: [REVIEW_WINDOW + 3, REVIEW_WINDOW + 2] }));
  assert.equal(r.completed, REVIEW_WINDOW + 3);
  assert.equal(r.unread, 2, 'the two most recent failed, and both are counted');
  await assert.rejects(readFounderReviews(fakeClient({ engagements, failEngagements: true })),
    'a failed engagement list must surface, not become an empty list');
});

const reviewsText = (state) => renderedText(renderToStaticMarkup(
  React.createElement(FounderReviewsView, { state, onRetry: () => {} }),
));

test('D390: the reviews section draws each state honestly', () => {
  const bad = reviewsText({ status: 'unreadable' });
  assert.match(bad, /Founder reviews could not be read/);
  assert.doesNotMatch(bad, /No founder has reviewed/);

  const none = reviewsText({ status: 'ready', data: { reviews: [], completed: 2, unread: 0 } });
  assert.match(none, /No founder has reviewed these engagements yet/);
  assert.match(none, /Average rating Not recorded/, 'no ratings is an absent average, not 0');
  assert.doesNotMatch(none, /0\.0/);

  const some = reviewsText({ status: 'ready', data: {
    reviews: [{ id: 1, rating: 4, comment: 'Shipped on time', engagement: { need_title: 'Pricing sprint' } },
              { id: 2, rating: 5, engagement: { need_title: 'GTM plan' } }],
    completed: REVIEW_WINDOW + 5, unread: 1,
  } });
  assert.match(some, /4\.5 \/ 5/);
  assert.match(some, /Shipped on time/);
  assert.match(some, /could not be read, so they are missing/);
  assert.match(some, new RegExp(`${REVIEW_WINDOW} most recently delivered engagements of ${REVIEW_WINDOW + 5}`));
});

test('D390: Health mounts the reviews for a linked firm only', () => {
  assert.match(healthSrc, /import FounderReviews from '\.\/FounderReviews'/);
  assert.match(healthSrc, /\{!unlinked && <FounderReviews \/>\}/);
});
