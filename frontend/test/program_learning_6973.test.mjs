/**
 * D6973 (#6973, part of #6965) — Learning's presentation: its map entry, the page at
 * /programs/learning, and the committed five-slide PDF. What is Learning's own: no Join and no
 * violet participation action (joining happens in Learning after sign-in), the course outline
 * labelled an illustration with bracketed samples, "No certificate is issued", and no cohort
 * organisers' contact door (no contact topic exists; held in D6973).
 *
 * The shared checks (the PDF exists, starts %PDF-, has the promised pages, is under 500 KB) run
 * over every map entry in program_presentations_6966.test.mjs.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_learning_6973.test.mjs
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
import CONTENT, { COURSE, ILLUSTRATION, SIGN_IN_HREF } from '../src/pages/programs/content/learning.js';

const h = React.createElement;
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('D7962: rendered text preserves literal entities and ordinary characters', () => {
  const words = `Literal &quot; &#39; &#x27; &amp; &amp;quot; with "quotes", 'apostrophes' & text`;
  const html = renderToStaticMarkup(h('p', null, h('strong', null, 'Start'), ' ', words, ' ', h('em', null, 'End')));
  assert.equal(text(html), `Start ${words} End`);
});
const P = programFor('learning');
const page = () => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/programs/learning'] },
  h(ProgramPresentation, { program: P, content: CONTENT, panel: h(FixedPanel, { program: P, panel: CONTENT.panel }) })));
const PDF = 'frontend/public/program-briefs/axal-vc-learning-v1.pdf';

test('the map: learning → /programs/learning (its own page) → its committed PDF, in the canvas\'s words', () => {
  assert.ok(P, 'learning has no map entry');
  assert.equal(P.key, 'learning');
  assert.equal(P.canonical, '/programs/learning');
  assert.equal(P.pdf, '/program-briefs/axal-vc-learning-v1.pdf');
  assert.equal(P.edition, 'Edition 1 · November 2026');
  assert.equal(P.slides, 5);
  assert.equal(P.availText, 'Open or by invitation · per program');
  assert.match(readFileSync('frontend/src/pages/admin/programs/programsModel.js', 'utf8'), /key: 'learning'/, 'the registry key is programsModel.js\'s');
  assert.deepEqual(resolveKey('learning'), { kind: 'page', program: P });
});

test('the page: the name, the canvas\'s availability words, Download PDF, and no Join or violet action', () => {
  const html = page();
  const t = text(html);
  assert.match(html, /<h1[^>]*>Learning<\/h1>/);
  assert.match(t, /Open or by invitation · per program/);
  assert.match(html, /href="\/program-briefs\/axal-vc-learning-v1\.pdf" download="axal-vc-learning-v1\.pdf"/);
  assert.doesNotMatch(html, /ax-btn-bright/, 'no violet participation action: joining happens in Learning');
  assert.doesNotMatch(t, /Join (this|now|Learning)|Apply/);
  assert.match(html, new RegExp(`href="${SIGN_IN_HREF.replace(/[?]/g, '\\?')}"`), 'Sign in to Learning goes to /learning after sign-in');
  assert.match(t, /Signing in does not enrol you in anything\./);
  assert.match(t, /This page reads nothing live/);
});

test('the course outline is an illustration: labelled, bracketed samples, and no certificate', () => {
  const t = text(page());
  assert.match(t, new RegExp(ILLUSTRATION));
  for (const s of COURSE) assert.match(s.t, /^\[.+\]$/, `${s.t} is a bracketed sample`);
  assert.deepEqual(COURSE.map((s) => s.k.split(' · ')[1]), ['Lesson', 'Exercise', 'Assessment']);
  assert.match(t, /\[70%\] in this example/);
  assert.match(t, /No certificate is issued: certificates are not issued for courses yet\./);
});

test('next step: members sign in and studios enquire; no cohort organisers\' door, no General contact', () => {
  assert.deepEqual(CONTENT.next.actions.map((a) => [a.id, a.kind, a.to]), [
    ['signin', 'link', '/login?next=%2Flearning'],
    ['licence', 'quiet', '/contact?topic=licence'],
  ]);
  const html = page();
  assert.doesNotMatch(html, /topic=learning|Ask HQ about a program/);
  assert.equal(CONTENT.panel.action, undefined, 'the panel offers no action of its own');
});

test('no unapproved claim on the page, in the sources or in the PDF', () => {
  const srcs = [readFileSync('frontend/src/pages/programs/catalog/learning.js', 'utf8'), readFileSync('frontend/src/pages/programs/content/learning.js', 'utf8')].map(codeOnly);
  for (const s of [...srcs, text(page())]) {
    assert.doesNotMatch(s, /takes no equity|Ask a question|(?<!No )certificates? (is|are) issued|guarantee/i);
  }
  const bytes = readFileSync(PDF);
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(bytes.length < 500 * 1024);
});

test('the deck: cover, who it helps, the parent, the course, access — with both addresses and the edition', () => {
  const slides = deckSlides(P, CONTENT);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'How participation works', 'What a learner does · one course', 'Access and next step']);
  for (const s of slides) {
    assert.ok(s.alt && s.alt.length > 20, `${s.title} has its text alternative`);
    assert.ok(s.html.includes('axal.vc/programs/learning'), `${s.title}'s footer carries the public page`);
    assert.ok(s.html.includes('Edition 1 · November 2026'), `${s.title}'s footer carries the edition`);
  }
  assert.match(text(slides[3].html), /Illustration · not a published course/);
  assert.match(text(slides[3].html), /No certificate is issued\./);
  const closing = text(slides[4].html);
  assert.match(closing, /axal\.vc\/learning\b/);
  assert.doesNotMatch(closing, /contact\?topic=/, 'the PDF carries no enquiry link (PGL06)');
});
