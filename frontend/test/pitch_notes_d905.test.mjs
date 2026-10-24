/**
 * D905 (#2684) — the Pitch deck studio's Notes tab (PD21) and its boundary for
 * the roles it is not for (PD22): the words and derivations
 * (`pitchStudioModel.js`), the boundary rendered, and the wiring.
 *
 * Every name and line is a fixture.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_notes_d905.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BOUNDARY_ROLES, BOUNDARY_TITLE, NOTE_MAX, NOTES_EYEBROW, NOT_RECORDED, READ_ONLY,
  boundaryFor, cardLabel, noteRows, overrideRows, postNoteSentence,
} from '../src/pages/raise/pitch/pitchStudioModel.js';
import PitchBoundary from '../src/pages/raise/pitch/PitchBoundary.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

// GET /api/decks/:id/notes (routes/deck_notes.ts)
const notes = {
  viewer: 'admin',
  notes: [
    { id: 1, deck_id: 40, deck_version: 4, card_index: 7, body: 'Synthetic: card 8 has no record.', author: { name: 'Ada Admin', kind: 'admin' }, created_at: '2026-10-20 09:00:00' },
    { id: 2, deck_id: 40, deck_version: 4, card_index: 7, body: 'Synthetic: pulling it this week.', author: { name: 'Fay Founder', kind: 'founder' }, created_at: '2026-10-20 10:00:00' },
    { id: 3, deck_id: 41, deck_version: 5, card_index: null, body: 'Synthetic: reads well.', author: { name: null, kind: 'super_admin' }, created_at: '2026-10-21 08:00:00' },
  ],
};

test('PD21: the banner says notes are visible to the founder; the thread reads as the canvas draws it', () => {
  assert.equal(READ_ONLY, 'Read only. Notes are visible to the founder.');
  assert.equal(NOTES_EYEBROW, 'Notes · visible to the founder');
  assert.equal(NOTE_MAX, 2000, 'the Worker\'s limit');
  const rows = noteRows(notes);
  assert.deepEqual(rows.map((r) => [r.who, r.card, r.version, r.text]), [
    ['Ada Admin · Admin', 'Card 8', 'v4', 'Synthetic: card 8 has no record.'],
    ['Fay Founder · founder', 'Card 8', 'v4', 'Synthetic: pulling it this week.'],
    [`${NOT_RECORDED} · Axal VC HQ`, 'Whole deck', 'v5', 'Synthetic: reads well.'],
  ]);
  assert.ok(rows[0].when && rows[0].when !== NOT_RECORDED, 'a date');
  assert.deepEqual(noteRows(null), []);
  assert.deepEqual(noteRows({ notes: [{ id: 9, body: 'x', author: { kind: 'unknown' } }] }).map((r) => [r.who, r.version, r.card]), [[`${NOT_RECORDED} · ${NOT_RECORDED}`, NOT_RECORDED, 'Whole deck']]);
  assert.deepEqual([cardLabel(0), cardLabel(11), cardLabel(null), cardLabel(-1), cardLabel(1.5)], ['Card 1', 'Card 12', 'Whole deck', 'Whole deck', 'Whole deck']);
});

test('posting opens a dialog that says what it changes, for an admin and for a founder', () => {
  assert.equal(postNoteSentence('admin', 7), 'Your note is added to the thread on card 8. The founder reads it in the studio. Investors never see it, and it is in no export or share.');
  assert.equal(postNoteSentence('super_admin', null), 'Your note is added to the thread on the whole deck. The founder reads it in the studio. Investors never see it, and it is in no export or share.');
  assert.equal(postNoteSentence('founder', 2), 'Your answer is added to the thread on card 3. Your admins and your cofounders read it.');
});

test('PD22: an Advisor, an Operating Partner and an Explorer read a boundary; the Advisor\'s adds the NDA line', () => {
  assert.deepEqual(BOUNDARY_ROLES, ['advisor', 'partner', 'exploring']);
  assert.equal(BOUNDARY_TITLE, 'The Pitch deck studio is for the venture’s founders.');
  assert.deepEqual(boundaryFor('advisor'), { title: BOUNDARY_TITLE, line: 'Ask them to share a link. A shared deck opens in the viewer, with the NDA if they ask for one.' });
  assert.deepEqual(boundaryFor('partner'), { title: BOUNDARY_TITLE, line: 'Ask them to share a link.' });
  assert.deepEqual(boundaryFor('exploring'), { title: BOUNDARY_TITLE, line: 'Ask them to share a link.' });
  for (const role of ['founder', 'admin', 'investor', '', undefined]) assert.equal(boundaryFor(role), null, String(role));
  assert.equal(boundaryFor('exploring', true), null, 'an active Spin-Out Lab member uses the studio');
  const html = renderToStaticMarkup(React.createElement(PitchBoundary, { role: 'advisor' }));
  assert.match(html, /data-testid="pitch-studio-boundary"/);
  assert.ok(html.includes('The Pitch deck studio is for the venture’s founders.'));
  assert.ok(html.includes('with the NDA if they ask for one'));
  assert.equal(renderToStaticMarkup(React.createElement(PitchBoundary, { role: 'partner' })).includes('NDA'), false);
});

test("the Super Admin's defaults name each template, or its id when the list was not read", () => {
  const overrides = { overrides: [{ sector: 'Fintech', stage: 'seed', method_id: 'yc_seed' }, { sector: 'Health', stage: 'pre-seed', method_id: 'sequoia' }] };
  assert.deepEqual(overrideRows(overrides, { methods: [{ id: 'yc_seed', label: 'YC Seed' }] }).map((r) => [r.sector, r.stage, r.template]), [['Fintech', 'seed', 'YC Seed'], ['Health', 'pre-seed', 'sequoia']]);
  assert.deepEqual(overrideRows(overrides, null).map((r) => r.template), ['yc_seed', 'sequoia']);
  assert.deepEqual(overrideRows(null, null), []);
});

test('the wiring: the Notes tab and its route, the boundary inside the shell, and the help surface moved with the guard', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/raise/pitch" element={guard(labRoles(['admin', 'founder', 'advisor', 'partner', 'exploring'])`));
  assert.match(app, /boundaryFor\(effectiveRole, user\?\.spinout_lab_active === 1\)\s*\?\s*<PitchBoundary role=\{effectiveRole\} \/>/);
  assert.ok(app.includes(`<Route path="/raise/pitch/notes" element={guard(labRoles(['admin', 'founder']), founderEditor(<PitchStudio tab="notes" />))} />`));
  for (const p of ['/raise/pitch/edit', '/raise/pitch/analytics', '/raise/pitch/review']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(labRoles(['admin', 'founder'])`), `${p} keeps its guard: the boundary is the studio's home only`);
  }
  const help = read('frontend/src/pages/docs/guidePlacement.js');
  assert.ok(help.includes('"/raise/pitch": {"label": "Pitch Deck", "roles": ["admin", "founder", "advisor", "partner", "exploring"], "lab": true}'));
  const studio = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  assert.match(studio, /tab === 'notes' \?\s*\(\s*<PitchNotes reads=\{reads\} \/>/);
  const notesSrc = read('frontend/src/pages/raise/pitch/PitchNotes.jsx');
  assert.match(notesSrc, /api\.deckNotes\(deckId\)/);
  assert.match(notesSrc, /api\.deckPostNote\(deckId,/);
  assert.match(notesSrc, /viewer === 'super_admin' \?/, 'the defaults card is the Super Admin\'s, by the Worker\'s answer');
  assert.match(notesSrc, /title="Post this note\?"/, 'posting opens a dialog');
  assert.equal(/deckUpdate|deckShare\(|deckRestore/.test(notesSrc), false, 'the Notes tab writes nothing on the deck');
  const api = read('frontend/src/lib/api.js');
  assert.ok(api.includes("deckNotes: (id) => request(`/decks/${id}/notes`),"));
});
