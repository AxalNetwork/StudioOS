/**
 * D901 (#2680) — Pitch deck studio part 7: present mode and the export dialog.
 *
 * What this file holds them to:
 *   · a card shows what the version holds: an unfilled template field and an
 *     empty figure read "Not recorded", never the sample and never 0; a card
 *     with no notes says so;
 *   · the keys are the canvas's (arrows, Esc) and never step past either end;
 *     a swipe is across, not down;
 *   · the export dialog offers PDF, PowerPoint and HTML, draws Google Slides
 *     unavailable with its reason, says what the export records before it
 *     runs, and fails as PD25 says: "… Try again in a moment. Nothing was shared.";
 *   · the routes and buttons agree: Present on the current-deck card for
 *     everyone, Export only for a founder, and present writes nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FORMATS, NO_EXPORT_YET, NO_NOTES, NOTHING_SHARED, OPTIONS_HTML_ONLY, PRESENT_PATH, SOURCE_NOT_RECORDED,
  cardOf, cardsOf, clock, countLabel, dotsOf, exitHref, exportButton, exportFailure, exportFileName, exportedLine,
  lastExportLine, moveTo, notesOf, optionsApply, presentHref, stepFor, swipeLine, swipeStep, whatExportDoes,
} from '../src/pages/raise/pitch/presentExportModel.js';
import { NOT_RECORDED } from '../src/pages/raise/pitch/pitchStudioModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

// The Worker's shapes; invented content.
const DECK = {
  id: 10, project_id: 3, version: 4, title: 'Seed deck', is_current: true, created_at: '2026-10-20 09:00:00',
  slides: [
    { title: 'Problem', subtitle: 'Why it hurts', body: 'Line one', bullets: ['First', ''], image_url: 'https://img.example.test/a.png', notes: 'Open with the problem.' },
    {
      title: 'Traction', fields: [
        { key: 't', kind: 'title', value: 'Traction' },
        { key: 'm', label: 'Figures', kind: 'metric_grid', value: [{ label: 'Paying customers', value: '' }, { label: 'Pilots', value: '3' }] },
        { key: 'p', label: 'Why now', kind: 'paragraph', value: '[Your why now]', source: 'placeholder' },
        { key: 'i', kind: 'image', value: 'http://insecure.example.test/b.png' },
      ],
    },
    {},
  ],
};

test('a card is what the version holds: placeholders and empty figures are Not recorded, notes or the line that says there are none', () => {
  // Mutation checked: the placeholder value kept → the sample check fails; an empty figure as '0' → the figure check fails.
  const [a, b, c] = cardsOf(DECK);
  assert.deepEqual([a.n, a.title, a.sub, a.lines, a.bullets, a.image], ['01', 'Problem', 'Why it hurts', ['Line one'], ['First'], 'https://img.example.test/a.png']);
  assert.equal(notesOf(a), 'Open with the problem.');
  assert.deepEqual(b.figures, [{ k: 'Paying customers', v: NOT_RECORDED }, { k: 'Pilots', v: '3' }]);
  assert.deepEqual(b.lines, [`Why now: ${NOT_RECORDED}`]);
  assert.ok(!JSON.stringify(b).includes('[Your why now]'), 'a template sample never reaches a card');
  assert.equal(b.image, null, 'only an https image is drawn');
  assert.equal(notesOf(b), NO_NOTES);
  assert.equal(c.title, 'Card 3');
  assert.equal(c.empty, true);
  assert.deepEqual(cardsOf(null), []);
  assert.equal(SOURCE_NOT_RECORDED, 'Source: Not recorded', 'no card records a source yet, so Show sources says so');
  assert.equal(cardOf({ fields: [{ kind: 'bullets', label: 'Ask', value: [] }] }, 0).lines[0], `Ask: ${NOT_RECORDED}`);
});

test('the keys: arrows move one card and stop at the ends, Home and End, Esc exits; a swipe is across', () => {
  // Mutation checked: no clamp → moveTo past the end fails; Escape mapped to prev → the exit check fails.
  assert.equal(stepFor('ArrowRight'), 'next');
  assert.equal(stepFor('ArrowLeft'), 'prev');
  assert.equal(stepFor('Escape'), 'exit');
  assert.equal(stepFor('Home'), 'first');
  assert.equal(stepFor('End'), 'last');
  assert.equal(stepFor('a'), null);
  assert.equal(moveTo(0, 'prev', 3), 0);
  assert.equal(moveTo(2, 'next', 3), 2);
  assert.equal(moveTo(1, 'next', 3), 2);
  assert.equal(moveTo(1, 'first', 3), 0);
  assert.equal(moveTo(0, 'last', 3), 2);
  assert.equal(moveTo(5, null, 3), 2);
  assert.equal(moveTo(0, 'next', 0), 0);
  assert.equal(swipeStep(-80, 10), 'next');
  assert.equal(swipeStep(80, 10), 'prev');
  assert.equal(swipeStep(-30, 0), null, 'a nudge is not a swipe');
  assert.equal(swipeStep(-60, 90), null, 'scrolling down is not a swipe');
});

test('the presenter line, the dots and the phone line', () => {
  assert.equal(clock(252), '00:04:12');
  assert.equal(clock(3725), '01:02:05');
  assert.equal(clock(-1), '00:00:00');
  assert.equal(countLabel(4, 12), '5 / 12');
  assert.equal(swipeLine(4, 12), 'Swipe for the next card · 5 of 12');
  assert.deepEqual(dotsOf(1, 3).map((d) => d.on), [false, true, false]);
});

test('the addresses: present carries the venture and the version; Esc goes back to the studio', () => {
  assert.equal(PRESENT_PATH, '/raise/pitch/present');
  assert.equal(presentHref(3, 10), '/raise/pitch/present?project_id=3&deck=10');
  assert.equal(presentHref(null, 10), '/raise/pitch/present?deck=10');
  assert.equal(exitHref(3), '/raise/pitch?project_id=3');
});

test('the export dialog: four formats, Google Slides unavailable with its reason, what it records said first, PD25 on failure', () => {
  // Mutation checked: Google Slides available → the unavailable check fails; the failure without "Nothing was shared." → the PD25 check fails.
  assert.deepEqual(FORMATS.map((f) => [f.id, f.available]), [['pdf', true], ['pptx', true], ['google_slides', false], ['html', true]]);
  assert.match(FORMATS.find((f) => f.id === 'google_slides').reason, /^Not available yet: /);
  assert.equal(FORMATS.find((f) => f.id === 'html').line, 'One file, offline');
  assert.deepEqual(['pdf', 'pptx', 'html'].map(exportButton), ['Export PDF', 'Export PowerPoint', 'Export HTML']);
  assert.equal(optionsApply('html'), true);
  assert.equal(optionsApply('pdf'), false);
  assert.match(OPTIONS_HTML_ONLY, /HTML file/);
  assert.equal(whatExportDoes(DECK), "This makes a file of v4 and records the export in this venture's history: the format, the version and the file's fingerprint. Nothing is shared.");
  assert.equal(exportFailure('pdf', 502, { error: 'pdf_render_failed' }), 'The PDF could not be produced. Try again in a moment. Nothing was shared.');
  assert.equal(exportFailure('pdf', 503, { error: 'browser_binding_unavailable' }), 'The PDF could not be produced. Try again in a moment. Nothing was shared.');
  assert.equal(exportFailure('html', 0, null), `The HTML file could not be produced. ${NOTHING_SHARED}`);
  assert.equal(exportFailure('html', 503, { error: 'export_not_recorded', message: 'The export could not be recorded, so no file was made. Try again in a moment. Nothing was shared.' }),
    'The export could not be recorded, so no file was made. Try again in a moment. Nothing was shared.');
  assert.equal(exportFileName('Seed deck', 4, 'html'), 'Seed-deck-v4.html');
  assert.equal(exportFileName('', null, 'pptx'), 'pitch-deck.pptx');
  assert.equal(exportedLine('html', DECK), 'Exported HTML of v4. The export is recorded.');
});

test('the ledger line: the newest export, or none recorded', () => {
  assert.equal(lastExportLine([]), NO_EXPORT_YET);
  const line = lastExportLine([{ format: 'pptx', version: 4, by: 'Sam', created_at: '2026-10-21 10:00:00' }, { format: 'pdf', version: 3 }]);
  assert.match(line, /^Last exported .+ · PowerPoint · v4 · by Sam$/);
  assert.match(lastExportLine([{ format: 'html', version: null }]), /HTML · Version not recorded$/);
});

test('the routes and the buttons: Present for everyone, Export only for a founder, present writes nothing', () => {
  // Mutation checked: Export shown to a read-only viewer → the guard check fails.
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/raise\/pitch\/present" element=\{guard\(labRoles\(\['admin', 'founder'\]\), founderEditor\(<PitchPresent \/>\)\)\}/);
  const studio = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  assert.match(studio, /<Link to=\{presentHref\(project\?\.id, current\.id\)\}[^>]*data-testid="pitch-studio-present">Present<\/Link>/);
  assert.match(studio, /\{!readOnly \? <button .*?data-testid="pitch-studio-export">Export<\/button> : null\}/);
  const present = read('frontend/src/pages/raise/pitch/PitchPresent.jsx');
  const calls = [...present.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(calls)], ['deckGet', 'deckListVersions'], 'present only reads');
  const dialog = read('frontend/src/pages/raise/pitch/ExportDialog.jsx');
  assert.match(dialog, /whatExportDoes\(version\)/, 'the dialog says what the export records');
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /deckExportHtml: .*\n\s+fetch\(`\$\{BASE\}\/decks\/\$\{id\}\/export\/html`/);
  assert.match(api, /deckExportList: \(id\) => request\(`\/decks\/\$\{id\}\/exports`\)/);
});
