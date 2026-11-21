/**
 * D6967 (#6967) — AI-native Venture's presentation, on the #6966 kit: a proposed programme,
 * stated as not open in its first words, with four slides and no action to take part.
 * `program_presentations_6966.test.mjs` checks every map entry's PDF; this file checks what is
 * the program's own: the status first, nothing to apply for, no enquiry until #6987, the seven
 * unset playbook points as "To be confirmed", and the registry text quoted as written.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_ai-native-venture_6967.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { programFor, presentationHref } from '../src/pages/programs/registry.jsx';
import { AVAILABILITY } from '../src/pages/programs/collect.js';
import { deckSlides } from '../src/pages/programs/deck.js';
import { ProgramPresentation } from '../src/pages/programs/kit.jsx';
import { FixedPanel, resolveKey } from '../src/pages/programs/ProgramKeyPage.jsx';
import { ViewPresentationLink } from '../src/pages/programs/AdminPresentationLinks.jsx';
import CONTENT, { PAIRS, PAIR_ALT, TO_CONFIRM } from '../src/pages/programs/content/ai-native-venture.js';

const h = React.createElement;
const renderedText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const read = (p) => readFileSync(p, 'utf8');
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const AIV = programFor('ai-native-venture');
const PDF = 'frontend/public/program-briefs/axal-vc-ai-native-venture-v1.pdf';
const page = () => at('/programs/ai-native-venture', h(ProgramPresentation, {
  program: AIV, content: CONTENT, panel: h(FixedPanel, { program: AIV, panel: CONTENT.panel }),
}));

test('the map: ai-native-venture → /programs/ai-native-venture → its committed four-slide PDF', () => {
  assert.ok(AIV, 'ai-native-venture has no map entry');
  assert.equal(AIV.canonical, '/programs/ai-native-venture');
  assert.equal(AIV.canonical, AIV.alias, 'no page of its own: the alias is the page');
  assert.equal(presentationHref('ai-native-venture'), '/programs/ai-native-venture');
  assert.equal(AIV.pdf, '/program-briefs/axal-vc-ai-native-venture-v1.pdf');
  assert.equal(AIV.slides, 4);
  assert.equal(AIV.edition, 'Edition 1 · November 2026');
  assert.equal(AIV.avail, 'proposed');
  assert.equal(AVAILABILITY[AIV.avail].label, 'Proposed · not open');
  assert.equal(resolveKey('ai-native-venture').kind, 'page');
  const registry = read('frontend/src/pages/admin/programs/programsModel.js');
  assert.match(registry, /key: 'ai-native-venture'/, 'the key is the registry\'s');
  const bytes = readFileSync(PDF);
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(bytes.length < 500 * 1024);
});

test('the status comes first: the opening sentence, the label, the cover', () => {
  assert.match(AIV.purpose, /^A proposed programme, not yet open: /);
  assert.match(AIV.og.description, /^A proposed programme, not yet open: /);
  const text = renderedText(page());
  const h1 = text.indexOf('AI-native Venture A proposed programme, not yet open');
  assert.ok(h1 > 0, 'the proposal sentence follows the name');
  assert.ok(text.indexOf('Proposed · not open') < h1, 'the availability label is read before the name');
  assert.match(text, /Availability ◌ Proposed · not open Proposed\. Not open\. No applications are taken\. No dates, places or fees are set\./);
  const cover = renderedText(deckSlides(AIV, CONTENT)[0].html);
  assert.match(cover, /Proposed · not open AI-native Venture A proposed programme, not yet open/);
});

test('nothing to apply for: no violet primary, no apply, no enquiry, no equity line', () => {
  const html = page();
  assert.doesNotMatch(html, /ax-btn-bright/, 'no violet participation action');
  assert.doesNotMatch(html, /href="[^"]*apply/, 'no application link');
  assert.doesNotMatch(html, /href="\/contact/, 'no enquiry until #6987 ships the General topic');
  assert.doesNotMatch(renderedText(html), /Ask (Axal VC )?a question|takes no equity/);
  assert.ok(CONTENT.next.actions.every((a) => a.kind !== 'primary'));
  assert.deepEqual(CONTENT.next.actions.map((a) => a.to), ['/spinout-lab', '/administrators']);
  assert.match(html, /data-testid="program-action-spinout" href="\/spinout-lab"/);
  assert.match(html, /data-testid="program-action-studios" href="\/administrators"/);
  assert.equal(CONTENT.panel.action, undefined, 'the panel has no action');
  const closing = renderedText(deckSlides(AIV, CONTENT)[3].html);
  assert.doesNotMatch(closing, /contact|Ask a question/);
  assert.match(closing, /axal\.vc\/programs\/ai-native-venture/);
  assert.match(closing, /axal\.vc\/spinout-lab/);
  const pdf = readFileSync(PDF).toString('latin1');
  assert.doesNotMatch(pdf, /\/URI\s*\(https:\/\/axal\.vc\/contact/, 'the PDF links no enquiry');
});

test('the registry\'s words: purpose quoted, the seven unset playbook points to be confirmed', () => {
  const m593 = read('cloudflare-worker/sql/migrations/593_referral_partners_copy.sql');
  const purpose = m593.match(/SET purpose = '([^']+)',\s*who = 'Founders',\s*join_method = 'By application',[^;]*WHERE key = 'ai-native-venture'/);
  assert.ok(purpose, '593 still records the ai-native-venture purpose');
  const text = renderedText(page());
  assert.ok(text.includes(`Purpose ${purpose[1]}`), 'the purpose is quoted as the registry writes it');

  const m560 = read('cloudflare-worker/sql/migrations/560_program_registry.sql');
  const seven = [...m560.matchAll(/\('ai-native-venture', 0, '[a-z-]+', (\d), '([^']+)', NULL\)/g)].map((r) => r[2]);
  assert.equal(seven.length, 7, 'the registry\'s seven unset playbook sections');
  const PUBLIC = { 'Who it is for': 'Exactly who it is for', 'Seats per cohort': 'Places per cohort' };
  assert.deepEqual(TO_CONFIRM, seven.map((s) => PUBLIC[s] || s), 'in the registry\'s order, in public words');
  for (const t of TO_CONFIRM) assert.ok(text.includes(`${t} ◌ To be confirmed`), `${t} reads "To be confirmed"`);
  const slide3 = renderedText(deckSlides(AIV, CONTENT)[2].html);
  for (const t of TO_CONFIRM) assert.ok(slide3.includes(t), `slide 3 lists ${t}`);
});

test('the signature visual: four questions, each with a tool that exists today, named by its text alternative', () => {
  assert.equal(PAIRS.length, 4);
  const app = read('frontend/src/App.jsx');
  for (const p of PAIRS) assert.ok(app.includes(`<Route path="${p.route}"`), `${p.route} is a route on main`);
  const html = page();
  assert.ok(html.includes(`aria-label="${PAIR_ALT}"`), 'the list is named by its text alternative');
  for (const p of PAIRS) assert.ok(renderedText(html).includes(`${p.tool} · ${p.route} ${p.q}`), p.tool);
  assert.match(read('cloudflare-worker/src/services/decks/templateLibrary.ts'), /export const AI_NATIVE_LAST = 12;/, '"twelve templates" is the library\'s count');
  const slides = deckSlides(AIV, CONTENT);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'The proposal', 'Where it stands', 'Access and next step']);
  assert.equal(slides[1].alt, PAIR_ALT);
  assert.doesNotMatch(slides[1].html, /\/validate|\/raise\//, 'the slides name the tools, not member routes');
});

test('admin: the program\'s header gains View presentation', () => {
  assert.match(at('/admin/programs/ai-native-venture', h(ViewPresentationLink, { programKey: 'ai-native-venture' })), /href="\/programs\/ai-native-venture"[^>]*>.*View presentation/);
});
