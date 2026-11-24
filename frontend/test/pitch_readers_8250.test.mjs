// D8250 (#8250) — Share & analytics: PS07's "N investors" under Visits and the
// most-read card's average per reader, both counted by share link, the only
// identity a link has. Zero links, one link, many links and an unreadable read;
// with no data each reads Not recorded, never 0.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_readers_8250.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { OverviewTiles } from '../src/pages/raise/pitch/ShareBoard.jsx';
import {
  NO_PER_READER, NO_READERS, PER_READER_UNSENT, READERS_UNSENT, overviewFigures,
} from '../src/pages/raise/pitch/shareBoardModel.js';

const h = React.createElement;
const draw = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const stateIn = (html, id) => (new RegExp(`data-figure-state="([a-z_]+)" data-testid="${id}"`).exec(html) || [])[1];

const READ = (over = {}) => ({
  from: '2026-10-27', to: '2026-11-09',
  days: [
    { date: '2026-11-07', nda: 2, open: 0, first_nda: 1, first_open: 0 },
    { date: '2026-11-09', nda: 1, open: 1, first_nda: 0, first_open: 1 },
  ],
  readers: { by: 'link', count: 2 },
  funnels: { nda: { sent: 3, opened: 2, reached_ask: 1 }, open: { sent: 1, opened: 1, reached_ask: null } },
  dropoff: { current: { version: 7, cards: [
    { index: 0, title: 'Cover', seconds: 30, readers: 2, seconds_per_reader: 15 },
    { index: 2, title: 'Traction', seconds: 224, readers: 2, seconds_per_reader: 112 },
  ] } },
  ...over,
});

test('#8250 many links: N investor links opened under Visits; the most-read card per link on average', () => {
  const f = overviewFigures(READ());
  assert.deepEqual([f.investors.kind, f.investors.value], ['value', '2 investor links opened']);
  // Mutation checked: the card's total seconds in place of seconds_per_reader → "3 m 44 s" and this fails.
  assert.deepEqual([f.perReader.kind, f.perReader.value], ['value', '1 m 52 s per link on average · 2 links read it']);
  const html = draw(h(OverviewTiles, { data: READ() }));
  assert.match(textOf(html), /Visits 4 2 first views · 2 revisits 2 investor links opened Most-read card 3 · Traction .* 1 m 52 s per link on average · 2 links read it Reached the ask/);
  assert.equal(stateIn(html, 'share-board-investors'), 'value');
  assert.equal(stateIn(html, 'share-board-per-reader'), 'value');
});

test('#8250 one link: singular words; a revisit is still one reader', () => {
  const f = overviewFigures(READ({
    readers: { by: 'link', count: 1 },
    dropoff: { current: { version: 7, cards: [{ index: 1, title: 'Traction', seconds: 90, readers: 1, seconds_per_reader: 90 }] } },
  }));
  assert.equal(f.investors.value, '1 investor link opened');
  assert.equal(f.perReader.value, '1 m 30 s per link on average · 1 link read it');
});

test('#8250 zero links: no view, no count, no timed card: both read Not recorded, never 0', () => {
  const none = READ({ days: [{ date: '2026-11-01', nda: 0, open: 0, first_nda: 0, first_open: 0 }], readers: { by: 'link', count: null }, dropoff: { current: null } });
  const f = overviewFigures(none);
  assert.deepEqual([f.investors.kind, f.investors.why], ['not_recorded', NO_READERS]);
  assert.deepEqual([f.perReader.kind, f.perReader.why], ['not_recorded', NO_PER_READER]);
  const html = draw(h(OverviewTiles, { data: none }));
  assert.equal(stateIn(html, 'share-board-investors'), 'not_recorded');
  assert.equal(stateIn(html, 'share-board-per-reader'), 'not_recorded');
  assert.doesNotMatch(textOf(html), /\b0 investor|0 s per/);
  // Views counted but the read sent no reader count (an older read): Not recorded, not 0.
  // Mutation checked: `n > 0` loosened to `n != null` with a 0 count → "0 investor links opened".
  const unsent = overviewFigures(READ({ readers: { by: 'link', count: 0 } }));
  assert.deepEqual([unsent.investors.kind, unsent.investors.why], ['not_recorded', READERS_UNSENT]);
  const noField = overviewFigures(READ({ readers: undefined, dropoff: { current: { version: 7, cards: [{ index: 0, title: 'A', seconds: 40 }] } } }));
  assert.deepEqual([noField.investors.kind, noField.perReader.kind, noField.perReader.why], ['not_recorded', 'not_recorded', PER_READER_UNSENT]);
  assert.equal(noField.mostRead.kind, 'value', 'the most-read card still stands without its average');
});

test('#8250 an unreadable read: both are Unavailable, as D6062 keeps it; the line draws nothing beside the tile', () => {
  const f = overviewFigures(null);
  assert.deepEqual([f.investors.kind, f.perReader.kind], ['unreadable', 'unreadable']);
  const html = draw(h(OverviewTiles, { data: null }));
  assert.equal(stateIn(html, 'share-board-visits'), 'unreadable');
  assert.equal(stateIn(html, 'share-board-investors'), undefined);
  assert.doesNotMatch(textOf(html), /investor link|per link|\b0\b/);
});
