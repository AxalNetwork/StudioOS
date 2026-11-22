/**
 * D6972 (#6972, part of #6965) — the Perks presentation: what is its own on top of the kit that
 * `program_presentations_6966.test.mjs` already checks for every map entry (the PDF exists,
 * starts %PDF-, has the promised page count and stays under 500 KB).
 *
 * Pinned here: the entry (open to all members, six slides, canonical /programs/perks); the
 * sign-in links (`/login?next=%2Fperks`, the partner's `/login?next=%2Foffers%2Fperk-deals`,
 * because the route guard keeps no /perks destination); the offer anatomy in four parts with the
 * claim button's own five reasons; the four steps; the studio licence enquiry on
 * `/contact?topic=licence`; and no partner, offer, discount or count named anywhere.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_perks_6972.test.mjs
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
import CONTENT, { ANATOMY, CLAIM_REASONS, STEPS, SIGN_IN_HREF, PARTNER_SIGN_IN_HREF } from '../src/pages/programs/content/perks.js';

const h = React.createElement;
const renderedText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('D7962: rendered text preserves literal entities and ordinary characters', () => {
  const words = `Literal &quot; &#39; &#x27; &amp; &amp;quot; with "quotes", 'apostrophes' & text`;
  const html = renderToStaticMarkup(h('p', null, h('strong', null, 'Start'), ' ', words, ' ', h('em', null, 'End')));
  assert.equal(renderedText(html), `Start ${words} End`);
});
const read = (p) => readFileSync(p, 'utf8');
const PK = programFor('perks');
const PDF = 'frontend/public/program-briefs/axal-vc-perks-v1.pdf';

const pageHtml = () => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/programs/perks'] },
  h(ProgramPresentation, { program: PK, content: CONTENT, panel: h(FixedPanel, { program: PK, panel: CONTENT.panel }) })));

test('the map entry: open to all members, its own canonical page, the v1 PDF, six slides, edition 1', () => {
  assert.ok(PK, 'perks has no map entry');
  assert.equal(PK.avail, 'open');
  assert.equal(PK.group, 'Rewards');
  assert.equal(PK.canonical, '/programs/perks');
  assert.equal(PK.alias, PK.canonical);
  assert.equal(PK.pdf, '/program-briefs/axal-vc-perks-v1.pdf');
  assert.equal(PK.edition, 'Edition 1 · November 2026');
  assert.equal(PK.slides, 6);
  assert.deepEqual(resolveKey('perks'), { kind: 'page', program: PK });
});

test('sign in links its own destination: /perks for members, /offers/perk-deals for partners; one violet action', () => {
  const html = pageHtml();
  assert.equal(SIGN_IN_HREF, '/login?next=%2Fperks');
  assert.equal(PARTNER_SIGN_IN_HREF, '/login?next=%2Foffers%2Fperk-deals');
  assert.match(html, /data-testid="program-panel-action-signin"/);
  assert.match(html, /data-testid="program-action-signin" href="\/login\?next=%2Fperks"/);
  assert.match(html, /data-testid="program-action-partners" href="\/login\?next=%2Foffers%2Fperk-deals"/);
  assert.match(html, /data-testid="program-action-licence" href="\/contact\?topic=licence"/);
  assert.deepEqual(CONTENT.next.actions.map((a) => a.kind), ['primary', 'link', 'quiet']);
});

test('every offer reads the same way: four parts, bracketed samples, the claim button\'s own five reasons', () => {
  assert.deepEqual(ANATOMY.map(([k]) => k), ['1 · Provider', '2 · Eligibility', '3 · Redemption conditions', '4 · Next step']);
  for (const [, v] of ANATOMY) assert.match(v, /\[[^\]]+\]/, 'every value is a bracketed sample');
  assert.deepEqual(CLAIM_REASONS, ['Founders only', 'Upgrade to claim', 'Not enough credits', 'Claim limit reached', 'Offer ended']);
  const perksPage = read('frontend/src/pages/PerksPage.jsx');
  for (const r of CLAIM_REASONS) assert.ok(perksPage.includes(`'${r}'`), `"${r}" is a reason the claim button prints`);
  const text = renderedText(pageHtml());
  assert.match(text, /Labelled sample · not a real offer/);
  assert.match(text, /Founders only, Upgrade to claim, Not enough credits, Claim limit reached, Offer ended/);
  assert.deepEqual(STEPS.map((s) => s.t), ['Browse the catalogue', 'Read its conditions', 'Claim it in Perks', 'Use it with the partner']);
  assert.match(text, /The partner is not told who claimed/);
  for (let n = 1; n <= 5; n += 1) assert.match(pageHtml(), new RegExp(`data-testid="program-section-${n}"`));
});

test('the deck: six slides in the canvas order, the closing with two addresses', () => {
  const slides = deckSlides(PK, CONTENT);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'Every offer', 'What happens', 'How participation works', 'Access and next step']);
  for (const s of slides) {
    assert.ok(s.alt && s.alt.length > 20, `${s.title} has its text alternative`);
    assert.ok(s.html.includes('axal.vc/programs/perks'), `${s.title}'s footer carries the public page`);
  }
  assert.match(renderedText(slides[2].html), /Labelled sample · not a real offer/);
  const closing = renderedText(slides[5].html);
  assert.match(closing, /axal\.vc\/programs\/perks/);
  assert.match(closing, /axal\.vc\/perks/);
  const pdf = readFileSync(PDF).toString('latin1');
  assert.equal(pdf.slice(0, 5), '%PDF-');
  assert.equal((pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length, 6);
});

test('no partner, offer, discount or count is named; no general "Ask a question"; no equity line', () => {
  const sources = [read('frontend/src/pages/programs/catalog/perks.js'), read('frontend/src/pages/programs/content/perks.js')].map(codeOnly);
  const page = renderedText(pageHtml());
  const deck = deckSlides(PK, CONTENT).map((s) => renderedText(s.html)).join(' ');
  for (const src of [...sources, page, deck]) {
    assert.doesNotMatch(src, /takes no equity|Ask a question/i);
    assert.doesNotMatch(src, /\d\s?%|% off/, 'a discount');
    // The only money is the unit's definition, "1 credit is worth $1 of perk value" (migration 560).
    for (const m of src.match(/[$€£]\s?\d+/g) || []) assert.equal(m, '$1');
    assert.doesNotMatch(src, /\b[1-9]\d* (offers|partners|perks|claims)\b/i, 'a count');
  }
});
