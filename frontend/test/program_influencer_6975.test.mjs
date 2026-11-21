/**
 * D6975 (#6975, part of #6965) — Influencers' presentation: the existing `/influencers`, drawn
 * with the program kit (PGF01 to PGF03), its map entry (`/programs/influencer` resolves there)
 * and the committed five-slide PDF. What is the programme's own: #6993's purpose sentence, the
 * live tier table that shows no number when the read fails, the panel for where the visitor
 * stands with the one Apply (still `REGISTER_TO_APPLY` signed out), Apply never offered beside an
 * open application or a membership, and a PDF that prints no rate.
 *
 * The page's reads and the sheet are covered by influencer_public_d4297 and
 * influencers_earn_copy_6993; the shared PDF checks run in program_presentations_6966.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_influencer_6975.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import { programFor } from '../src/pages/programs/registry.jsx';
import { deckSlides } from '../src/pages/programs/deck.js';
import { ProgramPresentation } from '../src/pages/programs/kit.jsx';
import { resolveKey } from '../src/pages/programs/ProgramKeyPage.jsx';
import CONTENT, { SAMPLE_DISCLOSURE, STAGES } from '../src/pages/programs/content/influencer.js';
import { InfluencerPanel, contentFor, tierBlocks } from '../src/pages/influencer/InfluencersPage.jsx';
import { HERO_LINE, REGISTER_TO_APPLY, STRATEGIC_NOTE, disclosureFor } from '../src/pages/influencer/influencerPublicModel.js';

const h = React.createElement;
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const P = programFor('influencer');
const AFFILIATE = { tier: 'affiliate_creator', label: 'Affiliate Creator', percentage_bps: 2000, duration_invoices: 12 };
const STRATEGIC = { tier: 'strategic_partner', label: 'Strategic Partner', percentage_bps: null, duration_invoices: null };
const READY = { status: 'ready', data: { tiers: [AFFILIATE] } };
const FAILED = { status: 'error', data: null };
const OFF = { status: 'off', data: null };
const ME = { status: 'ready', data: {} };

const render = ({ signedIn = false, me = OFF, state = null, tiers = READY } = {}) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/influencers'] },
  h(ProgramPresentation, {
    program: P, content: contentFor({ signedIn, state, tiers }),
    panel: h(InfluencerPanel, { program: P, signedIn, me, state, tiers, onApply() {}, onAddDetails() {} }),
  })));

test('the map: influencer → the existing /influencers → its committed PDF; /programs/influencer resolves there', () => {
  assert.ok(P, 'influencer has no map entry');
  assert.equal(P.canonical, '/influencers');
  assert.equal(P.pdf, '/program-briefs/axal-vc-influencer-v1.pdf');
  assert.equal(P.edition, 'Edition 1 · November 2026');
  assert.equal(P.avail, 'apply');
  assert.equal(P.purpose, HERO_LINE, '#6993\'s corrected sentence');
  assert.match(readFileSync('frontend/src/pages/admin/programs/programsModel.js', 'utf8'), /key: 'influencer'/);
  assert.deepEqual((({ kind, to }) => ({ kind, to }))(resolveKey('influencer', '?apply=1')), { kind: 'redirect', to: '/influencers?apply=1' });
});

test('signed out: the name is the one h1, the set period is said, Apply keeps its sign-up handoff, Download PDF is the file', () => {
  const html = render();
  const t = text(html);
  assert.match(html, /<h1[^>]*>Influencers<\/h1>/);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.match(t, /you earn a share of their subscription for a set period/);
  assert.doesNotMatch(t, /every invoice|Earn recurring revenue/i);
  const apply = html.match(/<a [^>]*data-testid="influencers-apply"[^>]*>/)?.[0] || '';
  assert.ok(apply.includes(`href="${REGISTER_TO_APPLY.replace(/&/g, '&amp;')}"`), 'Apply registers for the program, then comes back to the sheet');
  assert.match(html, /href="\/program-briefs\/axal-vc-influencer-v1\.pdf" download="axal-vc-influencer-v1\.pdf"/);
  assert.match(html, /href="\/login\?next=%2Finfluencers%3Fapply%3D1"/, 'Already a member? Sign in comes back to the sheet');
  assert.match(t, /20% of each subscription, for 12 invoices per member\./);
});

test('the tier table: every value the read\'s; a failed read shows no number; a strategic tier adds its line', () => {
  const [table] = tierBlocks(READY);
  assert.deepEqual(table.block.items, [['Affiliate Creator', '20% · 12 invoices · Anyone admitted']]);
  assert.ok(tierBlocks({ status: 'ready', data: { tiers: [AFFILIATE, STRATEGIC] } })[1].text.includes(STRATEGIC_NOTE));
  assert.ok(!tierBlocks(READY)[1].text.includes(STRATEGIC_NOTE));
  const downHtml = render({ tiers: FAILED });
  const down = text(downHtml);
  assert.match(down, /⊘ Unavailable/);
  assert.match(down, /Rates unavailable\. See the tiers below\./);
  assert.doesNotMatch(down, /\d+(–\d+)?\s*%|\d+\s+invoices?/, 'no rate or period anywhere');
  assert.match(downHtml, /data-testid="influencers-apply"/, 'Apply still works');
});

test('Apply is offered only to someone who may apply; never beside an open application or a membership', () => {
  const ids = (o) => contentFor({ tiers: READY, ...o }).next.actions.map((a) => `${a.id}:${a.to}`);
  assert.deepEqual(ids({ signedIn: false }), [`apply:${REGISTER_TO_APPLY}`, 'section:/influencer', 'refer:/programs/refer-and-earn']);
  assert.deepEqual(ids({ signedIn: true, state: { kind: 'none' } }), ['apply:/influencers?apply=1', 'section:/influencer', 'refer:/programs/refer-and-earn']);
  for (const kind of ['review', 'more', 'declined', 'admitted']) {
    assert.ok(!ids({ signedIn: true, state: { kind } }).some((x) => x.startsWith('apply:')), kind);
  }
  const review = render({ signedIn: true, me: ME, state: { kind: 'review', sent: '12 Nov 2026' } });
  assert.doesNotMatch(review, /data-testid="(influencers-apply|program-action-apply)"/);
  assert.match(text(review), /In review/);
  const admitted = render({ signedIn: true, me: ME, state: { kind: 'admitted', tier: 'Affiliate Creator', handle: 'creator-a', paused: false } });
  assert.match(admitted, /data-testid="influencers-open-section"/);
  assert.match(text(admitted), /Tier Affiliate Creator Handle @creator-a/);
  assert.doesNotMatch(admitted, /data-testid="influencers-apply"/);
  const unread = render({ signedIn: true, me: { status: 'error' }, state: null });
  assert.match(text(unread), /could not be read just now\. That is not the same as having none\./);
});

test('the path: five stages, each naming whose step it is, ending in a share for a set period', () => {
  assert.deepEqual(STAGES.map(([k]) => k.split(' · ').slice(0, 2).join(' · ')), ['Stage 1 · You', 'Stage 2 · HQ', 'Stage 3 · You', 'Stage 4 · You', 'Stage 5 · They']);
  assert.equal(SAMPLE_DISCLOSURE, disclosureFor('[Creator A]'), 'the handle page\'s own sentence');
  const t = text(render());
  assert.match(t, /Your share, for a set period/);
  assert.match(t, /Paid partnership · #ad/);
});

test('nothing unapproved: no other benefits, no studio enquiry, no general contact, no promised figure', () => {
  const srcs = [readFileSync('frontend/src/pages/programs/catalog/influencer.js', 'utf8'), readFileSync('frontend/src/pages/programs/content/influencer.js', 'utf8'), readFileSync('frontend/src/pages/influencer/InfluencersPage.jsx', 'utf8')].map(codeOnly);
  const page = text(render());
  for (const s of [...srcs, page]) assert.doesNotMatch(s, /premium research|private events|takes no equity|Ask a question|topic=licence/i);
  assert.match(page, /While you are active Investor Pro is included\./);
});

test('the deck: cover, who, the path, the share, access — and it prints no rate', () => {
  const slides = deckSlides(P, CONTENT);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'What happens', 'How a share is earned', 'Access and next step']);
  for (const s of slides) {
    assert.ok(s.alt && s.alt.length > 20);
    assert.ok(s.html.includes('axal.vc/influencers'));
    assert.ok(s.html.includes('Edition 1 · November 2026'));
    assert.doesNotMatch(text(s.html), /\d+(–\d+)?\s*%|\d+\s+(paid )?invoices?/, `${s.title} prints no rate or period`);
  }
  assert.match(text(slides[3].html), /This PDF prints none\./);
  const closing = text(slides[4].html);
  for (const u of ['axal.vc/influencers', 'axal.vc/influencer', 'axal.vc/programs']) assert.ok(closing.includes(u), u);
  const pdf = readFileSync('frontend/public/program-briefs/axal-vc-influencer-v1.pdf');
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
});
