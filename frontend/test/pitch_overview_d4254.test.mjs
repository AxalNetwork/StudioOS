// D4254 P1 (#4274): Raise › Pitch's Overview figures and the tile row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRIMARY_OF, BUILD_YOUR_DECK, NO_DECK_ITEMS, clock, lastRehearsal, latestHqNote, openComments, scriptCoverage,
} from '../src/pages/raise/pitch/pitchOverviewModel.js';
import { TABS, TITLE, LINE, STUDIO_PATH } from '../src/pages/raise/pitch/pitchStudioModel.js';

test('the tile row: five tiles in the canvas order; the Overview is not a tile', () => {
  assert.deepEqual(TABS.map((t) => t.label), ['Decks', 'Script & rehearsal', 'Review', 'Share & analytics', 'Notes']);
  assert.deepEqual(TABS.map((t) => t.path), ['/raise/pitch/decks', '/raise/pitch/script', '/raise/pitch/review', '/raise/pitch/share', '/raise/pitch/notes']);
  assert.ok(!TABS.some((t) => t.path === STUDIO_PATH), 'the Overview lights no tile');
  assert.equal(TITLE, 'Pitch');
  assert.equal(LINE, 'Your deck, what to say, and who has seen it, in one place.');
});

test('the header primary follows the tile; Review and Notes have none', () => {
  assert.equal(PRIMARY_OF.overview, 'New deck');
  assert.equal(PRIMARY_OF.decks, 'New deck');
  assert.equal(PRIMARY_OF.script, 'Rehearse');
  assert.equal(PRIMARY_OF.analytics, 'New link');
  assert.equal(PRIMARY_OF.review, undefined);
  assert.equal(PRIMARY_OF.notes, undefined);
  assert.equal(BUILD_YOUR_DECK, 'Build your deck');
});

test('script coverage counts written notes only; an unread deck is null, never 0', () => {
  assert.equal(scriptCoverage(null), null);
  assert.equal(scriptCoverage({}), null);
  assert.deepEqual(scriptCoverage({ slides: [{ notes: 'Hello' }, { notes: '  ' }, {}, { notes: 'x' }] }), { scripted: 2, cards: 4 });
  assert.deepEqual(scriptCoverage({ slides: [] }), { scripted: 0, cards: 0 });
});

test('clock: m:ss, and null for what is not a number', () => {
  assert.equal(clock(200), '3:20');
  assert.equal(clock(9), '0:09');
  assert.equal(clock(null), null);
  assert.equal(clock(-1), null);
  assert.equal(clock('soon'), null);
});

test('the last rehearsal: newest first; none is its own state; an unread list is null', () => {
  assert.equal(lastRehearsal(null), null);
  assert.deepEqual(lastRehearsal({ rehearsals: [] }), { none: true });
  const r = lastRehearsal({ rehearsals: [{ created_at: '2026-11-02 18:20:00', duration_ms: 192000, pitch_seconds: 180 }, { duration_ms: 1 }] });
  assert.equal(r.none, false);
  assert.equal(r.duration, '3:12');
  assert.equal(r.target, '3:00');
  assert.equal(r.over, true);
});

test('open comments: the read’s own count first, else top-level unresolved threads', () => {
  assert.equal(openComments(null), null);
  assert.equal(openComments({ open: 4, comments: [] }), 4);
  assert.equal(openComments({ comments: [{ parent_uid: null, resolved_at: null }, { parent_uid: 'a', resolved_at: null }, { parent_uid: null, resolved_at: 'x' }] }), 1);
  assert.equal(openComments({}), null);
});

test('the latest HQ note is an admin’s or the Super Admin’s, never a founder’s', () => {
  assert.equal(latestHqNote(null), null);
  assert.equal(latestHqNote({ notes: [{ body: 'mine', author: { kind: 'founder', name: 'Ada' } }] }), null);
  const n = latestHqNote({ notes: [
    { body: 'first', author: { kind: 'admin', name: 'A' }, created_at: '2026-10-29' },
    { body: 'reply', author: { kind: 'founder', name: 'Ada' } },
    { body: 'Name the source for the 42 teams.', author: { kind: 'super_admin', name: 'B' }, created_at: '2026-10-30', card_index: 6 },
  ] });
  assert.equal(n.body, 'Name the source for the 42 teams.');
  assert.equal(n.name, 'B');
  assert.equal(n.card, 6);
});

test('no deck: only the ways in that exist on main are drawn', () => {
  assert.deepEqual(NO_DECK_ITEMS.map((i) => i.id), ['records', 'template']);
});

test('the routes: Overview at /raise/pitch, the new tiles, and the old addresses redirect with the query', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/raise\/pitch"[\s\S]{0,400}<PitchStudio tab="overview" \/>/);
  assert.match(app, /path="\/raise\/pitch\/decks" element=\{guard\([^)]*\), <PitchStudio tab="decks" \/>\)\}/);
  assert.match(app, /path="\/raise\/pitch\/script" element=\{guard\([^)]*\), <PitchStudio tab="script" \/>\)\}/);
  assert.match(app, /path="\/raise\/pitch\/share" element=\{guard\([^)]*\), <PitchStudio tab="analytics" \/>\)\}/);
  assert.match(app, /path="\/raise\/pitch-deck" element=\{<KeepQueryRedirect to="\/raise\/pitch" \/>\}/);
  assert.match(app, /path="\/raise\/pitch\/analytics" element=\{<KeepQueryRedirect to="\/raise\/pitch\/share" \/>\}/);
  assert.match(app, /function KeepQueryRedirect\(\{ to \}\)[\s\S]{0,200}search: loc\.search, hash: loc\.hash/);
  assert.ok(app.indexOf('path="/raise/pitch-deck"') < app.indexOf('path="/raise/:slug"'), 'the static route ranks above /raise/:slug');
});
