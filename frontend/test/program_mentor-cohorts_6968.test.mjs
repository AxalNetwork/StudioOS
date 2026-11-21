/**
 * D6968 (#6968) — Mentor cohort access's presentation, on the #6966 kit: an admin assigns one
 * cohort, the mentor supports founders inside it, and supporting founders is not operating the
 * Lab. `program_presentations_6966.test.mjs` checks every map entry's PDF; this file checks what
 * is the program's own: the registry's words, the one participation action and where it lands,
 * the boundary journey, the contact topics main has, the advisor audience page linked rather than
 * restated, and no cohort, date or count anywhere.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_mentor-cohorts_6968.test.mjs
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
import { PROGRAMS as REGISTRY, HOW_IT_RUNS } from '../src/pages/admin/programs/programsModel.js';
import CONTENT, { SIGN_IN_HREF, ADVISE_HREF, LICENCE_HREF, FOR_ADVISORS_HREF, JOURNEY_ALT, STAGES, OUTSIDE } from '../src/pages/programs/content/mentor-cohorts.js';

const h = React.createElement;
const renderedText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const read = (p) => readFileSync(p, 'utf8');
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const MENTOR = programFor('mentor-cohorts');
const PDF = 'frontend/public/program-briefs/axal-vc-mentor-cohorts-v1.pdf';
const page = () => at('/programs/mentor-cohorts', h(ProgramPresentation, {
  program: MENTOR, content: CONTENT, panel: h(FixedPanel, { program: MENTOR, panel: CONTENT.panel }),
}));

test('the map: mentor-cohorts → /programs/mentor-cohorts → its committed five-slide PDF', () => {
  assert.ok(MENTOR, 'mentor-cohorts has no map entry');
  assert.equal(MENTOR.canonical, '/programs/mentor-cohorts');
  assert.equal(presentationHref('mentor-cohorts'), '/programs/mentor-cohorts');
  assert.equal(resolveKey('mentor-cohorts').kind, 'page');
  assert.equal(MENTOR.pdf, '/program-briefs/axal-vc-mentor-cohorts-v1.pdf');
  assert.equal(MENTOR.slides, 5);
  assert.equal(MENTOR.edition, 'Edition 1 · November 2026');
  const bytes = readFileSync(PDF);
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(bytes.length < 500 * 1024);
});

test('the registry\'s words: Access, "Assigned by an admin", for advisors', () => {
  const row = REGISTRY.find((p) => p.key === 'mentor-cohorts');
  assert.ok(row, 'the key is the registry\'s');
  assert.equal(row.name, MENTOR.name);
  assert.equal(row.group, MENTOR.group);
  assert.equal(row.join, 'Assigned by an admin');
  assert.equal(AVAILABILITY[MENTOR.avail].label, row.join, 'the label is the registry\'s join method, not "By invitation only"');
  assert.equal(MENTOR.availText, undefined);
  const how = HOW_IT_RUNS['mentor-cohorts'].flatMap((s) => s.lines || []).join(' ');
  assert.match(how, /An admin assigns one advisor to one cohort\./);
  assert.match(how, /Before a cohort starts: assign at least one mentor\./);
  assert.match(how, /A mentor sees a founder once that founder’s first week is recorded\./);
  const text = renderedText(page());
  assert.match(text, /Availability ◇ Assigned by an admin An admin assigns one advisor to one cohort\. This program takes no applications\./);
  assert.match(text, /Before a cohort starts Assign at least one mentor\./);
  assert.match(text, /Names and email addresses, once a founder’s first week is recorded\./);
});

test('one participation action: Sign in to your cohorts, to /login?next=/cohorts, which advisors and admins open', () => {
  const html = page();
  assert.equal(SIGN_IN_HREF, '/login?next=%2Fcohorts');
  assert.match(read('frontend/src/App.jsx'), /<Route path="\/cohorts" element=\{guard\(\['admin', 'advisor'\]/);
  const bright = html.match(/class="[^"]*ax-btn-bright[^"]*"[^>]*>[^<]*/g) || [];
  assert.equal(bright.length, 2, 'the panel and section 5, the same action');
  for (const b of bright) assert.match(b, /Sign in to your cohorts →/);
  assert.match(html, /data-testid="program-panel-action-signin" href="\/login\?next=%2Fcohorts"/);
  assert.match(html, /data-testid="program-action-signin" href="\/login\?next=%2Fcohorts"/);
  assert.deepEqual(CONTENT.next.actions.map((a) => [a.id, a.kind]), [['signin', 'primary'], ['advise', 'quiet'], ['licence', 'link']]);
  assert.doesNotMatch(html, /href="[^"]*apply/, 'no one applies');
});

test('other readers: the contact topics main has, and the advisor page linked, not restated', () => {
  const contact = read('frontend/src/pages/ContactPage.jsx');
  for (const topic of [ADVISE_HREF, LICENCE_HREF].map((x) => x.split('=')[1])) {
    assert.match(contact, new RegExp(`value: '${topic}'`), `${topic} is a contact topic on main`);
  }
  const html = page();
  assert.match(html, /data-testid="program-action-advise" href="\/contact\?topic=advise"/);
  assert.match(html, /data-testid="program-action-licence" href="\/contact\?topic=licence"/);
  assert.equal(FOR_ADVISORS_HREF, '/for-advisors');
  assert.match(read('frontend/src/App.jsx'), /<Route path="\/for-advisors" element=\{<DoorPage door="advisors" \/>\} \/>/);
  assert.match(html, /href="\/for-advisors"[^>]*>For advisors</);
  assert.match(renderedText(html), /Advisors are reviewed before they are admitted, and being admitted does not assign a cohort\./);
  assert.doesNotMatch(renderedText(html), /Ask (Axal VC )?a question|takes no equity|topic=general/);
});

test('the journey: three stages, the last two inside one assigned cohort, and what stays outside', () => {
  assert.deepEqual(STAGES.map((s) => s.t), ['An admin assigns', 'Founders are told', 'The mentor supports']);
  const html = page();
  assert.ok(html.includes(`aria-label="${JOURNEY_ALT}"`), 'the journey is named by its text alternative');
  const text = renderedText(html);
  assert.match(text, /Boundary · one assigned cohort Stages 2 and 3 happen inside one named cohort and its founders\./);
  assert.match(text, /Outside the boundary: Other cohorts, admission and graduation, week results and deadlines, assigning yourself\./);
  assert.equal(OUTSIDE.length, 4);
  assert.match(text, /✓ A mentor can .* × The Lab keeps/);
  const slides = deckSlides(MENTOR, CONTENT);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'What happens', 'The difference', 'Access and next step']);
  assert.equal(slides[2].alt, JOURNEY_ALT);
  assert.match(renderedText(slides[2].html), /Boundary · one assigned cohort:.*Outside the boundary/);
  assert.match(renderedText(slides[3].html), /Supporting founders is not operating the Lab\./);
});

test('no cohort, date or count: the page and the PDF are evergreen', () => {
  const words = JSON.stringify(CONTENT) + JSON.stringify(MENTOR).replace(MENTOR.edition, '');
  assert.doesNotMatch(words, /\b20\d\d\b|\[cohort name\]|January|February|March|April|June|July|August|September|October|November|December/);
  const closing = renderedText(deckSlides(MENTOR, CONTENT)[4].html);
  assert.match(closing, /axal\.vc\/programs\/mentor-cohorts/);
  assert.match(closing, /axal\.vc\/cohorts/);
  assert.match(closing, /axal\.vc\/contact/);
});

test('admin: the program\'s header gains View presentation; Assign a mentor stays', () => {
  assert.match(at('/admin/programs/mentor-cohorts', h(ViewPresentationLink, { programKey: 'mentor-cohorts' })), /href="\/programs\/mentor-cohorts"[^>]*>.*View presentation/);
  const admin = read('frontend/src/pages/admin/programs/MentorCohortAccess.jsx');
  assert.match(admin, /<ProgramFrame\s+detail=\{detail\}\s+program="mentor-cohorts"/);
  assert.match(admin, />Assign a mentor</);
});
