// D6913 part 4 (#6913, canvas `Investor Research v2 Data Room to Library`): Eadwyn's proposal of a room's open files
// not yet in the investor's Library (it adds nothing itself), RS-18 empty states, RS-19 states, RS-20 phone cards and
// sheets. Sample data only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/room_library_proposal_6913.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  RoomCardFacts, RoomFileActions, RoomLibraryNote, RoomLibraryProposal, RoomsEmpty,
} from '../src/pages/research/RoomLibrary.jsx';
import {
  addSelection, proposalFiles, proposalLine, proposalOutcome, roomOf, roomsEmpty,
} from '../src/pages/research/roomLibraryModel.js';
import { indexStateOf } from '../src/pages/research/researchStates.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FILES = [
  { uid: 'f-1', name: '[Pricing model.pdf]', visibility: 'open' },
  { uid: 'f-2', name: '[Customer list.csv]', visibility: 'open' },
  { uid: 'f-3', name: '[Cap table.xlsx]', visibility: 'nda' },
  { uid: 'f-4', name: '[Cohort retention.xlsx]', visibility: 'open' },
];
const ROOM = { project: { uid: 'p-1', name: '[Sample room]' }, files: FILES };
const READY = { state: 'ready', allowed: true, items: [{ file_uid: 'f-4', document_uid: 'd-4' }], at: '2026-11-14T10:40:00Z' };

test('Eadwyn proposes only open files not yet added; never an NDA file; nothing when copies are off or unread', () => {
  // Mutation checked: drop the visibility check → the NDA file is named.
  assert.deepEqual(proposalFiles(FILES, READY).map((f) => f.uid), ['f-1', 'f-2']);
  // Mutation checked: drop the "already in your Library" check → f-4 is proposed again.
  assert.equal(proposalFiles(FILES, READY).some((f) => f.uid === 'f-4'), false);
  // Mutation checked: ignore `allowed` → files are proposed in a room whose founder has not allowed copies.
  assert.deepEqual(proposalFiles(FILES, { ...READY, allowed: false }), []);
  assert.deepEqual(proposalFiles(FILES, { state: 'unreadable' }), []);
  assert.deepEqual(proposalFiles(FILES, { state: 'loading' }), []);
  assert.equal(proposalLine(proposalFiles(FILES, READY)),
    '2 files open to every invited investor in this room are not in your Library: [Pricing model.pdf], [Customer list.csv]. Add them?');
  assert.equal(proposalLine([FILES[0]]), '1 file open to every invited investor in this room is not in your Library: [Pricing model.pdf]. Add it?');
  assert.equal(proposalLine([]), null);
});

test('the proposal card says what it is, offers Add, Edit selection and Discard, and is silent when there is nothing', () => {
  const card = html(h(RoomLibraryProposal, { room: ROOM, read: READY, add: async () => ({}) }));
  assert.match(card, /Proposal · nothing is added until you accept/);
  assert.match(card, /\[Pricing model\.pdf\], \[Customer list\.csv\]\. Add them\?/);
  assert.doesNotMatch(card, /Cap table/);
  for (const words of ['>Add<', 'Edit selection', 'Discard', 'Eadwyn adds nothing itself', 'Read from: this room']) assert.ok(card.includes(words), words);
  assert.doesNotMatch(card, /advi[cs]e|recommend|fiduciary/i);
  assert.equal(html(h(RoomLibraryProposal, { room: ROOM, read: { ...READY, allowed: false } })), '');
  assert.equal(html(h(RoomLibraryProposal, { room: { ...ROOM, files: [FILES[2]] }, read: READY })), '');
  // Edit selection lists the proposed files as checkboxes.
  const editing = html(h(RoomLibraryProposal, { room: ROOM, read: READY, initial: { editing: true } }));
  assert.equal((editing.match(/type="checkbox"/g) || []).length, 2);
});

test('RS-19: Saving names the files; a failed add keeps the selection with Try again; a second add counts as added', async () => {
  const saving = html(h(RoomLibraryProposal, { room: ROOM, read: READY, initial: { busy: true } }));
  assert.match(saving, /Adding… \[Pricing model\.pdf\], \[Customer list\.csv\]/);
  const sent = [];
  const add = async ({ projectUid, fileUid }) => {
    sent.push(`${projectUid}/${fileUid}`);
    if (fileUid === 'f-2') throw Object.assign(new Error('x'), { code: 'server_error' });
    if (fileUid === 'f-9') throw Object.assign(new Error('x'), { code: 'already_added' });
    return { document_uid: `d-${fileUid}` };
  };
  const results = await addSelection({ files: [FILES[0], FILES[1], { uid: 'f-9' }], projectUid: 'p-1', add });
  assert.deepEqual(sent, ['p-1/f-1', 'p-1/f-2', 'p-1/f-9']);
  // Mutation checked: treat already_added as a failure → f-9 is kept for Try again.
  assert.deepEqual(results, [{ uid: 'f-1', ok: true }, { uid: 'f-2', ok: false }, { uid: 'f-9', ok: true }]);
  const partial = proposalOutcome(results);
  assert.equal(partial.added, 2); assert.deepEqual(partial.kept, ['f-2']); assert.equal(partial.tone, 'error');
  const failed = proposalOutcome([{ uid: 'f-1', ok: false }, { uid: 'f-2', ok: false }]);
  assert.equal(failed.title, 'The 2 files weren’t added'); assert.equal(failed.text, 'Nothing changed. Your selection is kept.');
  assert.deepEqual(failed.kept, ['f-1', 'f-2']);
  const ok = proposalOutcome([{ uid: 'f-1', ok: true }]);
  assert.equal(ok.tone, 'ok'); assert.equal(ok.title, '1 file added to your Library');
  const card = html(h(RoomLibraryProposal, { room: ROOM, read: READY, initial: { outcome: failed, picked: failed.kept } }));
  assert.match(card, /role="alert"/); assert.match(card, /weren’t added/); assert.match(card, />Try again</);
});

test('RS-18: From data rooms with nothing added says so; with no live grant it only offers to clear the filter', () => {
  const own = [{ uid: 'd-1', room: null }, { uid: 'd-2', room: null }];
  assert.equal(roomsEmpty({ source: '', items: own, rooms: null }), null);
  // Mutation checked: drop the room-row check → a Library with room files reads empty.
  assert.equal(roomsEmpty({ source: 'rooms', items: [...own, { uid: 'd-3', room: { project_uid: 'p-1' } }], rooms: null }), null);
  const none = roomsEmpty({ source: 'rooms', items: own, rooms: { state: 'ready', count: 0 } });
  assert.equal(none.kind, 'no-rooms'); assert.equal(none.title, 'No rooms are open to you'); assert.equal(none.action, 'Show all sources');
  const nothing = roomsEmpty({ source: 'rooms', items: own, rooms: { state: 'ready', count: 2 } });
  assert.equal(nothing.kind, 'no-room-files');
  assert.match(nothing.body, /From data rooms · 0 of 2 documents\.$/);
  // An unread room list never claims there are no rooms.
  assert.equal(roomsEmpty({ source: 'rooms', items: own, rooms: { state: 'unreadable' } }).kind, 'no-room-files');
  const noRooms = html(h(RoomsEmpty, { empty: none, onClear() {} }));
  assert.match(noRooms, /Show all sources/); assert.doesNotMatch(noRooms, /href="\/research\/diligence"/);
  assert.match(html(h(RoomsEmpty, { empty: nothing, onClear() {} })), /href="\/research\/diligence"[^>]*>Open your rooms/);
  assert.doesNotMatch(html(h(RoomsEmpty, { empty: nothing, onClear() {}, roomsLink: false })), /Open your rooms/);
});

test('RS-20: a Library room card carries the chip and Read-only, or No longer available with its reason; phone row sheet', () => {
  const live = { uid: 'd-1', room: { project_uid: 'p-1', project_name: '[Sample room]', added_at: '2026-11-02', lost_at: null, lost_reason: null } };
  const gone = { uid: 'd-2', room: { ...live.room, lost_at: '2026-11-20', lost_reason: 'revoked' } };
  const a = html(h(RoomCardFacts, { room: roomOf(live), uid: 'd-1', onRemove() {} }));
  assert.match(a, /From \[Sample room\] data room/); assert.match(a, /Read-only/); assert.match(a, /Added 2 Nov 2026/);
  assert.match(a, /Open in room/); assert.match(a, /Remove from Library/);
  const b = html(h(RoomCardFacts, { room: roomOf(gone), uid: 'd-2', onRemove() {} }));
  assert.match(b, /No longer available\./); assert.match(b, /The founder ended your access to this room\./);
  // Mutation checked: draw Open in room on a lapsed card → this fails.
  assert.doesNotMatch(b, /Open in room/); assert.doesNotMatch(b, /Read-only/); assert.match(b, /Remove from Library/);
  assert.equal(html(h(RoomCardFacts, { room: null, uid: 'd-3', onRemove() {} })), '');
  assert.equal(indexStateOf({ index_state: 'source_lost' }).label, 'Entries deleted');

  const read = { state: 'ready', allowed: true, items: [] };
  const fileHref = (uid) => `/research/diligence/g-1/files/${uid}`;
  const desk = html(h(RoomFileActions, { file: FILES[0], read, onAdd() {}, fileHref, phone: false }));
  assert.match(desk, /Add to my Library/); assert.doesNotMatch(desk, /More actions/);
  const closed = html(h(RoomFileActions, { file: FILES[0], read, onAdd() {}, fileHref, phone: true }));
  assert.match(closed, /aria-label="More actions for \[Pricing model\.pdf\]"/); assert.match(closed, /h-11 w-11/);
  const open = html(h(RoomFileActions, { file: FILES[0], read, onAdd() {}, fileHref, phone: true, initialOpen: true }));
  for (const words of ['Open file page', 'Add to my Library', 'Download', 'Cancel']) assert.ok(open.includes(words), words);
  assert.match(open, /href="\/research\/diligence\/g-1\/files\/f-1"/);
  const added = html(h(RoomFileActions, { file: FILES[0], read: { ...read, items: [{ file_uid: 'f-1', document_uid: 'd-1' }] }, onAdd() {}, fileHref, phone: true, initialOpen: true }));
  assert.match(added, /Open in your Library/); assert.doesNotMatch(added, /Add to my Library/);
});

test('RS-19: an unreadable room Library read has Try again; copies off reads Not allowed in your own Ask', () => {
  const un = html(h(RoomLibraryNote, { read: { state: 'unreadable' }, onRetry() {} }));
  assert.match(un, /Unreadable/); assert.match(un, />Try again</); assert.match(un, /role="alert"/);
  const off = html(h(RoomLibraryNote, { read: { state: 'ready', allowed: false, items: [] } }));
  assert.match(off, /Not allowed in your own Ask/); assert.match(off, /Add to my Library is not offered on this room/);
});

test('the room and the Library mount them: proposal, phone row sheet, skeleton, empty states and room cards', () => {
  const room = read('src/pages/research/DiligenceRoom.jsx');
  assert.match(room, /<RoomLibraryProposal key=\{room\.project\.uid\} room=\{room\} read=\{library\.read\}/);
  assert.match(room, /<RoomFileActions file=\{f\} read=\{library\.read\} onAdd=\{setAdding\} fileHref=\{fileHref\} phone=\{phone\} \/>/);
  assert.match(room, /<RoomLibraryNote read=\{library\.read\} onRetry=\{library\.reload\} \/>/);
  assert.match(room, /data-testid="room-loading"/);
  const lib = read('src/pages/research/LibraryZone.jsx');
  assert.match(lib, /<RoomsEmpty empty=\{roomsGap\}/);
  assert.match(lib, /<RoomCardFacts room=\{roomOf\(d\)\}/);
  assert.match(lib, /\{rowTitle\(d\)\}<\/p>/);
  assert.match(lib, /role === 'investor' && filters\.source === 'rooms' && noRoomRows/);
  // A lapsed reference's passages are deleted: no passage count under Entries deleted.
  assert.match(lib, /sub: d\.index_state === 'source_lost' \? null : d\.chunk_count == null \? null :/);
});
