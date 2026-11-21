/**
 * D6969 (#6969) — Investor cohort access's presentation, on the #6966 kit: how an Administrator
 * gives a verified investor scoped, NDA-gated access to one cohort, kept apart from whether HQ
 * has opened it ("Not running yet": HQ has published no dated decision). The close is
 * informational. `program_presentations_6966.test.mjs` checks every map entry's PDF; this file
 * checks what is the program's own.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_investor-cohorts_6969.test.mjs
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
import { PROGRAMS as REGISTRY } from '../src/pages/admin/programs/programsModel.js';
import CONTENT, { STEPS, STEPS_ALT, EVERY_READ, NOT_RUNNING, FOR_INVESTORS_HREF } from '../src/pages/programs/content/investor-cohorts.js';

const h = React.createElement;
const renderedText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const read = (p) => readFileSync(p, 'utf8');
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const INV = programFor('investor-cohorts');
const PDF = 'frontend/public/program-briefs/axal-vc-investor-cohorts-v1.pdf';
const page = () => at('/programs/investor-cohorts', h(ProgramPresentation, {
  program: INV, content: CONTENT, panel: h(FixedPanel, { program: INV, panel: CONTENT.panel }),
}));

test('the map: investor-cohorts → /programs/investor-cohorts → its committed five-slide PDF', () => {
  assert.ok(INV, 'investor-cohorts has no map entry');
  assert.equal(INV.canonical, '/programs/investor-cohorts');
  assert.equal(presentationHref('investor-cohorts'), '/programs/investor-cohorts');
  assert.equal(resolveKey('investor-cohorts').kind, 'page');
  assert.equal(INV.pdf, '/program-briefs/axal-vc-investor-cohorts-v1.pdf');
  assert.equal(INV.slides, 5);
  assert.equal(INV.edition, 'Edition 1 · November 2026');
  const row = REGISTRY.find((p) => p.key === 'investor-cohorts');
  assert.ok(row, 'the key is the registry\'s');
  assert.equal(row.name, INV.name);
  assert.equal(AVAILABILITY[INV.avail].label, row.join, 'the label is the registry\'s join method');
  const bytes = readFileSync(PDF);
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(bytes.length < 500 * 1024);
});

test('the workflow is kept apart from availability: "Not running yet", no decision published, on the page and the closing slide', () => {
  const text = renderedText(page());
  assert.match(text, /Availability ◇ Assigned by an admin Not running yet\. HQ has not confirmed that participation is open, and has published no decision as of this edition\./);
  assert.equal(CONTENT.panel.text, NOT_RUNNING);
  assert.equal(CONTENT.panel.action, undefined, 'the panel has no action');
  assert.match(INV.og.description, /Not running yet\./);
  assert.match(INV.card.line, /^Not running yet\./);
  const closing = renderedText(deckSlides(INV, CONTENT)[4].html);
  assert.match(closing, /Availability Not running yet\. HQ has not published a decision to open participation, as of this edition\./);
  assert.doesNotMatch(JSON.stringify(CONTENT), /\b20\d\d\b|\[date|Demo Day/, 'no invented decision date, no Demo Day (J1)');
});

test('an informational close: no primary, no apply, no enquiry, no studio action', () => {
  const html = page();
  assert.doesNotMatch(html, /ax-btn-bright/, 'no violet participation action');
  assert.doesNotMatch(html, /href="[^"]*apply/);
  assert.doesNotMatch(html, /href="\/contact/, '"Ask HQ about investor cohorts" waits for HQ\'s approval');
  assert.deepEqual(CONTENT.next.actions.map((a) => [a.to, a.kind]), [['/for-investors', 'link'], ['/login', 'link']]);
  assert.match(html, /data-testid="program-action-investors" href="\/for-investors"/);
  assert.match(read('frontend/src/App.jsx'), /<Route path="\/for-investors" element=\{<DoorPage door="investors" \/>\} \/>/);
  assert.equal(FOR_INVESTORS_HREF, '/for-investors');
  assert.match(read('cloudflare-worker/src/services/programGrants.ts'), /key: 'investor-cohorts', [^}]*readiness: 'notready'/);
  assert.match(renderedText(html), /Studios Investor cohort access is run by Axal VC HQ\. It is not offered to studios\./);
  const text = renderedText(html);
  assert.doesNotMatch(text, /Ask (HQ|Axal VC|a question)|takes no equity|topic=/);
  assert.match(text, /What this page is not An explanation of how access works\. It is not an offer of securities or an invitation to invest\./);
  const closing = renderedText(deckSlides(INV, CONTENT)[4].html);
  assert.doesNotMatch(closing, /contact|login/);
  assert.match(closing, /axal\.vc\/programs\/investor-cohorts .*axal\.vc\/for-investors/);
});

test('the signature visual: eligibility, assignment, signature, scoped access, and the three checks on every read', () => {
  assert.deepEqual(STEPS.map((s) => s.k), ['Step 1 · Eligibility', 'Step 2 · Assignment', 'Step 3 · Signature', 'Step 4 · Scoped access']);
  const html = page();
  assert.ok(html.includes(`aria-label="${STEPS_ALT}"`), 'the journey is named by its text alternative');
  assert.match(renderedText(html), /Checked on every read verified now, the grant open and within its dates, the NDA signed\./);
  const slides = deckSlides(INV, CONTENT);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'What happens', 'How participation works', 'Access and next step']);
  assert.equal(slides[2].alt, STEPS_ALT);
  assert.ok(renderedText(slides[2].html).includes(`${EVERY_READ.label}: ${EVERY_READ.note}`));
  // The sources the steps restate.
  const admin = read('cloudflare-worker/src/routes/admin_investor_cohorts.ts');
  assert.match(admin, /Every route takes `requireAdmin`/);
  assert.match(admin, /\{ investor_user_id, cohort_cycle_id, ends_at, scope\?, note\? \}/);
  const access = read('cloudflare-worker/src/services/investorCohortAccess.ts');
  assert.match(access, /export const READABLE_SCOPES = \['summary', 'weekly_progress'\] as const;/);
  assert.match(access, /One cohort NDA per grant/);
  assert.match(read('cloudflare-worker/src/routes/investor_cohorts.ts'), /serves no founder's email address/);
});

test('the scope: venture summary and weekly progress, nothing else; founders stay in control', () => {
  const text = renderedText(page());
  assert.match(text, /What access covers Set on each grant\. Only these two can be opened\. Venture summary .* Weekly progress .* Nothing else No pitch decks, no deal materials, no founder email addresses\./);
  assert.match(text, /Contact details A founder’s email address is never shown to the investor\./);
  const slide4 = renderedText(deckSlides(INV, CONTENT)[3].html);
  assert.match(slide4, /What access covers Venture summary .* Weekly progress .* Nothing else/);
  assert.match(slide4, /What founders control Told .* Can hide .* Introductions/);
});

test('admin: the program\'s header gains View presentation', () => {
  assert.match(at('/admin/programs/investor-cohorts', h(ViewPresentationLink, { programKey: 'investor-cohorts' })), /href="\/programs\/investor-cohorts"[^>]*>.*View presentation/);
  assert.match(read('frontend/src/pages/admin/programs/ProgramPage.jsx'), /<ProgramFrame detail=\{detail\} program="investor-cohorts"/);
});
