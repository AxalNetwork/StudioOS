// D6913 (#6913, canvas RS-13, RS-14, RS-16) — a data-room file in an investor's Library, over D6869's routes: the room
// row's Library cell and confirm sheet, the Library's Source filter, room chip, Read-only and the Source no longer
// available rows. Sample data only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/room_library_6913.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AddToLibrarySheet, RoomFileLibrary, RoomLibraryNote, libraryHref } from '../src/pages/research/RoomLibrary.jsx';
import {
  LAPSE_REASONS, NAMELESS, SOURCE_GONE, SOURCES, answerableLine, bySource, confirmLines, fileLibraryState, libraryError,
  roomOf, rowTitle, sourceKeyOf,
} from '../src/pages/research/roomLibraryModel.js';
import { answerabilityOf, filterLibrary, isFiltered, libraryFiltersFrom } from '../src/pages/research/researchStates.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(p, 'utf8');

const ROOM = { project: { uid: 'p-1', name: '[Sample room]' }, grant: { uid: 'g-1', created_at: '2026-10-12', expires_at: '2027-01-12T00:00:00Z' } };
const FILE = { uid: 'f-1', name: 'Cohort retention Q3.xlsx', visibility: 'all' };
const live = { uid: 'd-1', title: 'Cohort retention Q3.xlsx', source: 'own', read_only: true, in_ask: true, index_state: 'indexed',
  room: { project_uid: 'p-1', project_name: '[Sample room]', added_at: '2026-11-02T09:00:00Z', lost_at: null, lost_reason: null } };
const lapsed = (reason) => ({ ...live, uid: `d-${reason}`, in_ask: false, index_state: 'source_lost', room: { ...live.room, lost_at: '2026-11-20T00:00:00Z', lost_reason: reason } });
const ours = { uid: 'd-o', title: 'Our memo', source: 'own', read_only: false, in_ask: true, index_state: 'indexed', room: null };
const theirs = { uid: 'd-c', title: 'Client deck', source: 'client', read_only: true, in_ask: false, index_state: 'indexed', room: null };

test('RS-13: the row says In your Library with Open, or offers Add to my Library; a room with copies off offers nothing', () => {
  const ready = { state: 'ready', allowed: true, items: [{ file_uid: 'f-1', document_uid: 'd-1', added_at: '2026-11-02' }] };
  assert.deepEqual(fileLibraryState('f-1', ready), { state: 'added', documentUid: 'd-1', added: '2 Nov 2026' });
  assert.equal(fileLibraryState('f-2', ready).state, 'addable');
  // Mutation checked: ignore `allowed` → a room with copies off offers Add.
  assert.equal(fileLibraryState('f-2', { ...ready, allowed: false }).state, 'off');
  assert.equal(fileLibraryState('f-2', { state: 'unreadable' }).state, 'unreadable');
  const added = html(h(RoomFileLibrary, { file: FILE, read: ready, onAdd() {} }));
  assert.match(added, /In your Library/); assert.match(added, new RegExp(`href="${libraryHref('d-1').replace(/[#/]/g, (c) => `\\${c}`)}"`));
  assert.match(html(h(RoomFileLibrary, { file: { ...FILE, uid: 'f-2' }, read: ready, onAdd() {} })), /Add to my Library/);
  assert.equal(html(h(RoomFileLibrary, { file: { ...FILE, uid: 'f-2' }, read: { ...ready, allowed: false }, onAdd() {} })), '');
  assert.match(html(h(RoomLibraryNote, { read: { ...ready, allowed: false } })), /has not allowed Library copies/);
  assert.equal(html(h(RoomLibraryNote, { read: ready })), '');
});

test('RS-13: the confirm sheet says what is added, from which room, the access and its end, Read-only and the cost line', () => {
  const lines = Object.fromEntries(confirmLines({ file: FILE, room: ROOM }));
  assert.equal(lines.File, 'Cohort retention Q3.xlsx');
  assert.equal(lines.From, '[Sample room] data room');
  assert.equal(lines.Access, 'Your access, until 12 Jan 2027');
  assert.match(lines['In your Library'], /^Read-only\./);
  assert.equal(lines.Cost, 'Indexing: no charge. Each Ask answer is charged as today.');
  assert.equal(Object.fromEntries(confirmLines({ file: FILE, room: { ...ROOM, grant: {} } })).Access, 'Your access, with no end date recorded');
  const sheet = html(h(AddToLibrarySheet, { file: FILE, room: ROOM, onClose() {}, onAdded() {} }));
  assert.match(sheet, /Add to Library/); assert.match(sheet, /Cancel/); assert.match(sheet, /Indexing: no charge/);
  for (const [code, words] of [['library_off', /not allowed/], ['nda_required', /behind the NDA/], ['already_added', /already in your Library/]]) {
    assert.match(libraryError({ code }), words, code);
  }
  assert.equal(libraryError({}), 'Nothing was added. Try again.');
});

test('RS-14: the Source filter keeps ours, shared by clients or from data rooms; it is a URL parameter and narrows', () => {
  assert.deepEqual(SOURCES.map((s) => s.label), ['All sources', 'Ours', 'Shared by clients', 'From data rooms']);
  assert.deepEqual([live, ours, theirs].map(sourceKeyOf), ['rooms', 'ours', 'clients']);
  const f = libraryFiltersFrom(new URLSearchParams('source=rooms'));
  assert.equal(f.source, 'rooms'); assert.equal(isFiltered(f), true);
  // Mutation checked: drop the source check in filterLibrary → all three rows stay.
  assert.deepEqual(filterLibrary([live, ours, theirs], f).map((d) => d.uid), ['d-1']);
  assert.deepEqual(bySource([live, ours, theirs], 'clients').map((d) => d.uid), ['d-c']);
  assert.equal(answerableLine({ answerable: 18, not_answerable: 3 }), '18 answerable in Ask · 3 not answerable');
  assert.equal(answerableLine({}), null);
  const r = roomOf(live);
  assert.equal(r.chip, 'From [Sample room] data room'); assert.equal(r.lost, false); assert.equal(r.added, '2 Nov 2026');
  assert.equal(roomOf(ours), null);
});

test('RS-16: a lapsed row keeps its title and one reason in its own words; an NDA lapse is nameless; it is out of Ask', () => {
  for (const reason of ['revoked', 'expired', 'removed', 'moved', 'nda_lapsed', 'library_off']) {
    const r = roomOf(lapsed(reason));
    assert.equal(r.lost, true); assert.equal(r.reasonWords, LAPSE_REASONS[reason], reason);
    // Mutation checked: keep project_uid on a lapsed row → Open in room on a room it no longer reaches.
    assert.equal(r.projectUid, null);
  }
  assert.equal(new Set(Object.values(LAPSE_REASONS)).size, 6, 'each reason in its own words');
  assert.equal(rowTitle(lapsed('revoked')), 'Cohort retention Q3.xlsx');
  // Mutation checked: name an NDA-lapsed file → its title shows.
  assert.equal(rowTitle(lapsed('nda_lapsed')), NAMELESS);
  assert.equal(roomOf(lapsed('unknown')).reasonWords, SOURCE_GONE);
  const a = answerabilityOf(lapsed('expired'));
  assert.equal(a.label, 'Not answerable'); assert.equal(a.why, SOURCE_GONE);
  assert.equal(answerabilityOf(live).label, 'Answerable');
});

test('wiring: the room lists the Library cell; the Library draws the Source filter, Open in room and Remove from Library', () => {
  const room = read('frontend/src/pages/research/DiligenceRoom.jsx');
  assert.match(room, /const library = useRoomLibrary\(room\?\.project\?\.uid \|\| null\)/);
  assert.match(room, /<RoomFileLibrary file=\{f\} read=\{library\.read\} onAdd=\{setAdding\} \/>/);
  assert.match(room, /<AddToLibrarySheet file=\{adding\} room=\{room\}/);
  const lib = read('frontend/src/pages/research/LibraryZone.jsx');
  assert.match(lib, /data-testid="library-source-filter"/);
  assert.match(lib, /seam: room \? room\.chip/);
  // A room row is never downloaded from the Library: Open in room, or nothing once lapsed.
  assert.match(lib, /\{room\.lost \? null : \(\s*<Link to="\/research\/diligence"/);
  assert.match(lib, /Remove from Library/);
  assert.match(read('frontend/src/lib/api/roomLibrary.js'), /request\('\/room-library\/items'/);
});
