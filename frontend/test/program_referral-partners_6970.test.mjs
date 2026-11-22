/**
 * D6970 (#6970, part of #6965) — the Referral partners presentation: what is its own on top of
 * the kit that `program_presentations_6966.test.mjs` already checks for every map entry (the
 * PDF exists, starts %PDF-, has the promised page count and stays under 500 KB).
 *
 * Pinned here: the entry (by invitation, canonical /programs/referral-partners); the page's
 * five sections, the three segments, the two paths kept apart, the event introduction; no
 * violet participation action anywhere (nothing on the page is an application); sign-in goes
 * to Refer & Earn through the login; and the held claims (amounts, the enquiry route, a
 * general "Ask a question", "no equity") are absent from the page, the content and the PDF.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_referral-partners_6970.test.mjs
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
import CONTENT, { PATH_A, PATH_B, SEGMENTS, INTRO_STEPS, SIGN_IN_HREF } from '../src/pages/programs/content/referral-partners.js';

const h = React.createElement;
const renderedText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('D7962: rendered text preserves literal entities and ordinary characters', () => {
  const words = `Literal &quot; &#39; &#x27; &amp; &amp;quot; with "quotes", 'apostrophes' & text`;
  const html = renderToStaticMarkup(h('p', null, h('strong', null, 'Start'), ' ', words, ' ', h('em', null, 'End')));
  assert.equal(renderedText(html), `Start ${words} End`);
});
const read = (p) => readFileSync(p, 'utf8');
const RP = programFor('referral-partners');
const PDF = 'frontend/public/program-briefs/axal-vc-referral-partners-v1.pdf';

const pageHtml = () => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/programs/referral-partners'] },
  h(ProgramPresentation, { program: RP, content: CONTENT, panel: h(FixedPanel, { program: RP, panel: CONTENT.panel }) })));

test('the map entry: by invitation, its own canonical page, the v1 PDF, five slides, edition 1', () => {
  assert.ok(RP, 'referral-partners has no map entry');
  assert.equal(RP.avail, 'invite');
  assert.equal(RP.canonical, '/programs/referral-partners');
  assert.equal(RP.alias, RP.canonical, 'no page of its own: /programs/referral-partners is the page');
  assert.equal(RP.pdf, '/program-briefs/axal-vc-referral-partners-v1.pdf');
  assert.equal(RP.edition, 'Edition 1 · November 2026');
  assert.equal(RP.slides, 5);
  assert.equal(RP.group, 'Network and referrals');
  assert.deepEqual(resolveKey('referral-partners'), { kind: 'page', program: RP });
});

test('the page: the five sections in order, the three segments, the two paths and the event introduction', () => {
  const html = pageHtml();
  const text = renderedText(html);
  for (let n = 1; n <= 5; n += 1) assert.match(html, new RegExp(`data-testid="program-section-${n}"`));
  assert.deepEqual(SEGMENTS.map(([t]) => t), ['Event organisers', 'Venture scouts', 'Deal makers']);
  for (const [t] of SEGMENTS) assert.ok(text.includes(t), `segment ${t}`);
  assert.match(text, /Influencers join through their own program/);
  assert.match(text, /Path A · Strategic referral access/);
  assert.match(text, /Path B · Referral-partner roster/);
  assert.match(text, /Two separate records\. Being granted strategic access does not make you a referral partner/);
  assert.equal(PATH_A[0][1], 'Any signed-in member, on Refer & Earn.');
  assert.equal(PATH_B.at(-1)[1], 'There is no form for it. HQ invites each partner.');
  assert.deepEqual(INTRO_STEPS.map((s) => s.t), ['Share your link', 'Someone joins', 'Identity check', 'Agreed terms']);
  assert.match(text, /By invitation only/);
  assert.match(text, /HQ invites each partner\. There is no public application/);
});

test('nothing on the page is an application: no violet action, sign-in goes to Refer & Earn through the login', () => {
  const html = pageHtml();
  assert.doesNotMatch(html, /ax-btn-bright/, 'a violet participation action on an invitation-only page');
  assert.ok(!CONTENT.next.actions.some((a) => a.kind === 'primary'));
  assert.equal(CONTENT.panel.action, undefined, 'the panel action would be violet (FixedPanel), which the canvas forbids here');
  assert.equal(SIGN_IN_HREF, '/login?next=%2Freferrals');
  assert.match(html, /data-testid="program-action-signin" href="\/login\?next=%2Freferrals"/);
  assert.match(html, /data-testid="program-action-strategic" href="\/login\?next=%2Freferrals"/);
  assert.deepEqual(CONTENT.next.actions.map((a) => a.id), ['signin', 'strategic']);
});

test('the deck: cover, segments, the two paths, the event introduction, the closing with two addresses', () => {
  const slides = deckSlides(RP, CONTENT);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'How participation works', 'What a partner does · an event introduction', 'Access and next step']);
  for (const s of slides) {
    assert.ok(s.alt && s.alt.length > 20, `${s.title} has its text alternative`);
    assert.ok(s.html.includes('axal.vc/programs/referral-partners'), `${s.title}'s footer carries the public page`);
  }
  const closing = renderedText(slides[4].html);
  assert.match(closing, /axal\.vc\/programs\/referral-partners/);
  assert.match(closing, /axal\.vc\/referrals/);
  assert.doesNotMatch(closing, /contact/);
  const pdf = readFileSync(PDF).toString('latin1');
  assert.equal(pdf.slice(0, 5), '%PDF-');
  assert.equal((pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length, 5);
});

test('the held claims stay out: no amount, no enquiry route or contact topic, no "Ask a question", no equity line', () => {
  const sources = [read('frontend/src/pages/programs/catalog/referral-partners.js'), read('frontend/src/pages/programs/content/referral-partners.js')].map(codeOnly);
  const page = renderedText(pageHtml());
  const deck = deckSlides(RP, CONTENT).map((s) => renderedText(s.html)).join(' ');
  for (const src of [...sources, page, deck]) {
    assert.doesNotMatch(src, /takes no equity|Ask a question|Enquire about partnering|\/contact|topic=/i);
    assert.doesNotMatch(src, /[$€£]\s?\d|\d\s?%|\bUSD\b/, 'an amount or a rate');
  }
  assert.match(page, /an enquiry route is not open yet/);
});
