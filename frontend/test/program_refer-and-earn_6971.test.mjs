/**
 * D6971 (#6971, part of #6965) — the Refer & Earn presentation: what is its own on top of the
 * kit that `program_presentations_6966.test.mjs` already checks for every map entry (the PDF
 * exists, starts %PDF-, has the promised page count and stays under 500 KB).
 *
 * Pinned here: the entry (open to all members, canonical /programs/refer-and-earn); the sign-in
 * handoff (`/login?next=%2Freferrals`, the one violet action in the panel and in Next step); one
 * referral in three steps, the credit each step earns, and perk credits as a separate event; the
 * two kinds of credit; and the held claims (perk-credit amounts, a paused state, a studio or
 * general enquiry, "no equity") absent from the page, the content and the PDF.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_refer-and-earn_6971.test.mjs
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
import CONTENT, { STEPS, INTRO_CREDIT, PERK_CREDITS, SIGN_IN_HREF } from '../src/pages/programs/content/refer-and-earn.js';

const h = React.createElement;
const renderedText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('D7962: rendered text preserves literal entities and ordinary characters', () => {
  const words = `Literal &quot; &#39; &#x27; &amp; &amp;quot; with "quotes", 'apostrophes' & text`;
  const html = renderToStaticMarkup(h('p', null, h('strong', null, 'Start'), ' ', words, ' ', h('em', null, 'End')));
  assert.equal(renderedText(html), `Start ${words} End`);
});
const read = (p) => readFileSync(p, 'utf8');
const RE = programFor('refer-and-earn');
const PDF = 'frontend/public/program-briefs/axal-vc-refer-and-earn-v1.pdf';

const pageHtml = () => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/programs/refer-and-earn'] },
  h(ProgramPresentation, { program: RE, content: CONTENT, panel: h(FixedPanel, { program: RE, panel: CONTENT.panel }) })));

test('the map entry: open to all members, its own canonical page, the v1 PDF, five slides, edition 1', () => {
  assert.ok(RE, 'refer-and-earn has no map entry');
  assert.equal(RE.avail, 'open');
  assert.equal(RE.canonical, '/programs/refer-and-earn');
  assert.equal(RE.alias, RE.canonical);
  assert.equal(RE.pdf, '/program-briefs/axal-vc-refer-and-earn-v1.pdf');
  assert.equal(RE.edition, 'Edition 1 · November 2026');
  assert.equal(RE.slides, 5);
  assert.deepEqual(resolveKey('refer-and-earn'), { kind: 'page', program: RE });
});

test('the sign-in handoff: one violet action in the panel and one in Next step, both to /login?next=/referrals', () => {
  const html = pageHtml();
  assert.equal(SIGN_IN_HREF, '/login?next=%2Freferrals');
  assert.match(html, /href="\/login\?next=%2Freferrals"[^>]*data-testid="program-panel-action-signin"|data-testid="program-panel-action-signin"[^>]*href="\/login\?next=%2Freferrals"/);
  assert.match(html, /data-testid="program-action-signin" href="\/login\?next=%2Freferrals"/);
  assert.equal(CONTENT.next.actions.filter((a) => a.kind === 'primary').length, 1);
  assert.equal(CONTENT.next.actions.find((a) => a.kind === 'primary').id, 'signin');
  assert.match(html, /data-testid="program-action-register" href="\/register"/);
  assert.match(html, /data-testid="program-action-partners" href="\/programs\/referral-partners"/);
});

test('one referral in three steps: no credit, no credit, then one introduction credit; perk credits apart', () => {
  assert.deepEqual(STEPS.map((s) => s.t), ['Share your link', 'Sign up through it', 'Verify their email']);
  assert.deepEqual(STEPS.map((s) => s.items.at(-1)), ['Credit: none yet.', 'Credit: none yet.', 'Credit: +1 introduction credit for you.']);
  const text = renderedText(pageHtml());
  assert.match(text, /axal\.vc\/register\?ref=\[CODE\]/);
  assert.match(text, /Perk credits are a separate event A sign-up earns no perk credits/);
  assert.match(text, /An account has one referrer, and no one can refer themselves/);
  assert.equal(INTRO_CREDIT.at(-1)[1], 'One per verified sign-up.');
  assert.equal(PERK_CREDITS.at(-1)[1], 'Set by HQ and shown on your Refer & Earn page. Not printed here.');
  for (let n = 1; n <= 5; n += 1) assert.match(pageHtml(), new RegExp(`data-testid="program-section-${n}"`));
});

test('the deck: cover, who it helps, the three steps, the two credits, the closing with three addresses', () => {
  const slides = deckSlides(RE, CONTENT);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'What happens', 'Which event earns which credit', 'Access and next step']);
  for (const s of slides) {
    assert.ok(s.alt && s.alt.length > 20, `${s.title} has its text alternative`);
    assert.ok(s.html.includes('axal.vc/programs/refer-and-earn'), `${s.title}'s footer carries the public page`);
  }
  assert.match(renderedText(slides[2].html), /Verify their email .*\+1 introduction credit for you/);
  const closing = renderedText(slides[4].html);
  for (const u of ['axal.vc/programs/refer-and-earn', 'axal.vc/referrals', 'axal.vc/programs']) assert.ok(closing.includes(u), u);
  const pdf = readFileSync(PDF).toString('latin1');
  assert.equal(pdf.slice(0, 5), '%PDF-');
  assert.equal((pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length, 5);
});

test('the held claims stay out: no perk-credit amount, no paused state, no enquiry, no equity line', () => {
  const sources = [read('frontend/src/pages/programs/catalog/refer-and-earn.js'), read('frontend/src/pages/programs/content/refer-and-earn.js')].map(codeOnly);
  const page = renderedText(pageHtml());
  const deck = deckSlides(RE, CONTENT).map((s) => renderedText(s.html)).join(' ');
  for (const src of [...sources, page, deck]) {
    assert.doesNotMatch(src, /takes no equity|Ask a question|\/contact|topic=|paused/i);
    // The only money in either format is the unit's definition, "1 credit is worth $1 of perk value".
    assert.deepEqual(src.match(/[$€£]\s?\d+/g) || [], src.includes('worth $1 of perk value') ? ['$1'] : []);
    assert.doesNotMatch(src, /\d\s?%/, 'a rate');
  }
});
