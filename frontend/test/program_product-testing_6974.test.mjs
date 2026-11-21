/**
 * D6974 (#6974, part of #6965) — Product testing's presentation: its map entry, the page at
 * /programs/product-testing, and the committed five-slide PDF. What is Product testing's own:
 * the two paths that meet at one HQ-opened campaign, every step saying who decides it; the two
 * decisions kept apart (approved as a tester, picked for a campaign); a fixed panel with no
 * count; no studio enquiry (readiness `hq`); and no promised place, reward or payment.
 *
 * The shared checks (the PDF exists, starts %PDF-, has the promised pages, is under 500 KB) run
 * over every map entry in program_presentations_6966.test.mjs.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_product-testing_6974.test.mjs
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
import { FixedPanel, resolveKey } from '../src/pages/programs/ProgramKeyPage.jsx';
import CONTENT, { AFTER, PARTNER_PATH, TESTER_PATH } from '../src/pages/programs/content/product-testing.js';

const h = React.createElement;
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const P = programFor('product-testing');
const page = () => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/programs/product-testing'] },
  h(ProgramPresentation, { program: P, content: CONTENT, panel: h(FixedPanel, { program: P, panel: CONTENT.panel }) })));

test('the map: product-testing → /programs/product-testing → its committed PDF, by application', () => {
  assert.ok(P, 'product-testing has no map entry');
  assert.equal(P.canonical, '/programs/product-testing');
  assert.equal(P.pdf, '/program-briefs/axal-vc-product-testing-v1.pdf');
  assert.equal(P.edition, 'Edition 1 · November 2026');
  assert.equal(P.slides, 5);
  assert.equal(P.avail, 'apply');
  assert.match(readFileSync('frontend/src/pages/admin/programs/programsModel.js', 'utf8'), /key: 'product-testing'/);
  assert.deepEqual(resolveKey('product-testing'), { kind: 'page', program: P });
});

test('every step of the two paths says in words who decides it', () => {
  for (const [, x] of [...TESTER_PATH, ...PARTNER_PATH]) assert.match(x, /Decides: (Member|HQ|Partner firm)\.$/);
  assert.deepEqual(AFTER.map((s) => s.k.replace(/^\d · /, '')), ['Decides: Active tester', 'Decides: Campaign owner', 'Decides: HQ']);
  const t = text(page());
  assert.match(t, /Both paths meet: one approved campaign, opened by HQ/);
  assert.match(t, /A declined member can apply again after 90 days\./);
  assert.match(t, /Up to five questions\./);
  assert.match(t, /never more than the places/);
});

test('the two decisions are kept apart: approval is not a place, applying reserves none', () => {
  const t = text(page());
  assert.match(t, /Approved as a tester HQ decides, once\. It lets you apply to campaigns\. It is not a place on any campaign\./);
  assert.match(t, /Picked for a campaign The campaign’s owner decides, for that campaign only, up to its places\. Applying does not reserve a place\./);
});

test('the panel is fixed: two steps, the live list is in Studio, and one violet action', () => {
  const html = page();
  const t = text(html);
  assert.match(t, /Open campaigns are listed in Studio for active testers, after sign-in, not on this page\./);
  assert.doesNotMatch(t, /\b\d+ (open )?campaigns?\b/, 'no count of campaigns');
  assert.equal((html.match(/ax-btn-bright/g) || []).length, 2, 'the one violet action, in the panel and the close');
  assert.match(html, /href="\/login\?next=%2Fstudio"/);
  assert.match(html, /href="\/register"/);
  assert.match(html, /href="\/login\?next=%2Foffers%2Ftesting"/);
  assert.match(html, /href="\/program-briefs\/axal-vc-product-testing-v1\.pdf" download="axal-vc-product-testing-v1\.pdf"/);
});

test('no studio enquiry, no general contact, and nothing promised', () => {
  const html = page();
  assert.doesNotMatch(html, /topic=licence|\/contact/);
  const srcs = [readFileSync('frontend/src/pages/programs/catalog/product-testing.js', 'utf8'), readFileSync('frontend/src/pages/programs/content/product-testing.js', 'utf8')].map(codeOnly);
  for (const s of [...srcs, text(html)]) assert.doesNotMatch(s, /takes no equity|Ask a question|guaranteed|you will be paid|earn rewards/i);
  assert.match(text(html), /This page promises no place, reward or payment/);
});

test('the deck: cover, who it helps, the two paths, the two decisions, access — nothing live', () => {
  const slides = deckSlides(P, CONTENT);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'What happens', 'How participation works', 'Access and next step']);
  for (const s of slides) {
    assert.ok(s.alt && s.alt.length > 20, `${s.title} has its text alternative`);
    assert.ok(s.html.includes('axal.vc/programs/product-testing'), `${s.title}'s footer carries the public page`);
    assert.ok(s.html.includes('Edition 1 · November 2026'));
  }
  const paths = text(slides[2].html);
  for (const step of ['T1 · Join the tester pool', 'T2 · Approved as a tester', 'P1 · Propose a campaign', 'P2 · Reviewed by HQ', 'Decides: Campaign owner']) assert.ok(paths.includes(step), step);
  assert.match(text(slides[3].html), /It is not a place on any campaign\./);
  const closing = text(slides[4].html);
  assert.match(closing, /axal\.vc\/login\?next=\/studio/);
  assert.match(closing, /No place, reward or open campaign is promised\./);
  assert.doesNotMatch(closing, /contact\?topic=/);
});
