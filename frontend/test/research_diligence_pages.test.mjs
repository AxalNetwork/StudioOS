/**
 * The diligence room (canvas b6a5f992) and document (canvas 96463a46) pages,
 * D311, held to their canvases at both ends.
 *
 * Each element the pages claim is asserted TWICE: the canvas draws it, and the
 * page renders it. A canvas that stops drawing an element and a page that stops
 * rendering one fail the same test, so neither side can drift past the other.
 * The pure pieces (size from bytes, the three file states, a withheld name) run
 * here in Node rather than being pinned as text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activityLine, fileSize, roomFileState } from '../src/pages/research/diligenceRead.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ROOM_CANVAS = read('../../design/canvases/backlog/Pages · Diligence room.dc.html');
const FILE_CANVAS = read('../../design/canvases/backlog/Pages · Diligence file.dc.html');
const room = read('../src/pages/research/DiligenceRoom.jsx');
const file = read('../src/pages/research/DiligenceFile.jsx');
const zone = read('../src/pages/research/DiligenceZone.jsx');
const app = read('../src/App.jsx');
const api = read('../src/lib/api.js');
const dataRoom = read('../src/pages/raise/DataRoomPage.jsx');

/** Both ends: the canvas draws `drawn`, and the page renders `rendered` (default: the same words). */
function bothEnds(canvas, page, drawn, rendered = drawn) {
  assert.ok(canvas.includes(drawn), `the canvas no longer draws: ${drawn}`);
  assert.ok(page.includes(rendered), `the page no longer renders: ${rendered}`);
}

test('the room page renders every element the room canvas draws', () => {
  for (const s of [
    'Room access',
    'Open the room →',
    'You last opened it',
    'You have not opened this room',
    'Scope is what they staged, not what was asked',
    'Every document in this room is behind an NDA.',
    'Nothing staged in this room yet.',
    'The grant is live and the room is empty. That is a finding, not an error.',
    'Links are issued to you alone, work once, expire after two minutes. Not watermarked.',
    'Sign one with this company and they appear in the room. They are not listed here by name.',
    'Your activity',
    'your opens and downloads on this project only',
    'Room · what is thin',
    'Accept writes your memo. It does not email the founder or request files.',
    'What this page will not do',
    'This room is not open to you.',
    '‹ Back to Diligence',
  ]) bothEnds(ROOM_CANVAS, room, s);
  // The four tiles and the scope table's five columns.
  for (const k of ['Open to you', 'In the room', 'Behind an NDA', 'Last opened']) bothEnds(ROOM_CANVAS, room, k);
  for (const h of ['Company', 'You last opened']) bothEnds(ROOM_CANVAS, room, h);
  for (const h of ['File', 'Size', 'You last downloaded']) bothEnds(ROOM_CANVAS, room, h);
  // Deal stage is drawn as Not recorded with its reason, and the page renders
  // the worker's own sentence rather than a copy of it.
  bothEnds(ROOM_CANVAS, room, 'Deal stage');
  assert.match(room, /<Unrecorded reason=\{room\.deal_stage_note\} \/>/);
});

test('the document page renders every element the file canvas draws', () => {
  for (const s of [
    'Document',
    'Open to invited',
    'Download',
    'Single-use link, expires after two minutes. Not watermarked. The founder sees that you opened it.',
    'Last downloaded by you',
    'back to the grant and its counts',
    'Your downloads of this file',
    'this document only, not the room',
    'You have not downloaded this file',
    'This document is behind an NDA. It is counted on the room page and not named here.',
    '‹ Back to the room',
    'This page does not OCR, summarise, or attach the file to a deal.',
  ]) bothEnds(FILE_CANVAS, file, s);
});

test('a gated document has no name anywhere on the page', () => {
  // The worker sends none (research_diligence_room.test.ts proves the body);
  // the page must not reach for one either. The gated branch, the shell title
  // and the crumb are all built without `file.name` unless a file arrived.
  const gated = file.slice(file.indexOf("{state === 'gated' && ("), file.indexOf("{state === 'missing_file' && ("));
  assert.ok(gated.length > 200, 'the gated branch could not be found');
  assert.doesNotMatch(gated, /file\.name|file\?\.name|data\.file/);
  assert.match(file, /const title = file \? file\.name : \(projectName \? `\$\{projectName\} · document` : 'Document'\);/);
  assert.match(file, /e\?\.code === 'nda_required' \? 'gated'/);
});

test('the room says the three file states apart, and a missing size is not a size', () => {
  assert.equal(roomFileState({ file_open: 2, file_total: 3 }), 'open');
  assert.equal(roomFileState({ file_open: 0, file_total: 3 }), 'all_withheld');
  assert.equal(roomFileState({ file_open: 0, file_total: 0 }), 'empty');
  assert.equal(roomFileState(null), null);

  assert.equal(fileSize(1258291), '1.2 MB');
  assert.equal(fileSize(86016), '84 KB');
  assert.equal(fileSize(512), '512 B');
  assert.equal(fileSize(null), null);
  assert.equal(fileSize(undefined), null);
  assert.equal(fileSize('not a number'), null);
});

test('an activity line never re-serves a name the gate withholds', () => {
  assert.deepEqual(activityLine({ action: 'download', file_name: null, file_withheld: true }),
    { verb: 'Download link issued', what: 'a document now behind an NDA' });
  assert.deepEqual(activityLine({ action: 'download', file_name: null, file_removed: true }),
    { verb: 'Download link issued', what: 'a document no longer in the room' });
  assert.deepEqual(activityLine({ action: 'download', file_name: 'Deck.pdf' }),
    { verb: 'Download link issued', what: 'Deck.pdf' });
  assert.deepEqual(activityLine({ action: 'open_room' }), { verb: 'Opened the room', what: null });
});

test('the pages are routed for admin and investor, and read through the grant-keyed methods', () => {
  assert.match(app, /path="\/research\/diligence\/:grantUid" element=\{guard\(labRoles\(\['admin', 'investor'\]\), <DiligenceRoom /);
  assert.match(app, /path="\/research\/diligence\/:grantUid\/files\/:fileUid" element=\{guard\(labRoles\(\['admin', 'investor'\]\), <DiligenceFile /);
  assert.match(room, /api\.research\.diligenceRoom\(grantUid\)/);
  assert.match(file, /api\.research\.diligenceFile\(grantUid, fileUid\)/);
  // The download is the data room's own route, which re-checks grant and NDA.
  assert.match(file, /api\.dataRoomDownload\(data\.room\.project_uid, data\.file\.uid\)/);
  // A missing grant is its own state, not an error; the page branches on the code.
  assert.match(room, /e\?\.code === 'room_not_found' \? 'missing' : 'unreadable'/);
});

test('the list links each room to its page', () => {
  assert.match(zone, /to=\{`\/research\/diligence\/\$\{encodeURIComponent\(r\.grant_uid\)\}`\}/);
  assert.doesNotMatch(zone, /to="\/raise\/data-room"/);
});

test('the memo band is scoped to this room and drafts only on the press', () => {
  const band = room.slice(room.indexOf('<ZoneDraft'), room.indexOf('/>', room.indexOf('<ZoneDraft')));
  assert.match(band, /surface="research\/diligence"/);
  assert.match(band, /scopeKey=\{room\.grant\.uid\}/);
  assert.match(band, /\bscoped\b/, 'an unscoped band would show one room’s memo on another');
  assert.match(api, /zoneDrafts: \(surface, scopeKey\) => request\(`\/research\/drafts\?surface=/);
  assert.match(api, /&scope_key=\$\{encodeURIComponent\(scopeKey\)\}/);
});

test('the investor drawer is retired and its route redirects', () => {
  assert.doesNotMatch(dataRoom, /function SharedRooms\(/);
  assert.doesNotMatch(dataRoom, /dataRoomsSharedWithMe|dataRoomShared\(/);
  assert.doesNotMatch(api, /dataRoomsSharedWithMe:|dataRoomShared:/,
    'an api.js method nothing calls is left behind');
  assert.match(api, /dataRoomDownload: \(projectUid, uid\) =>/, 'the document page still downloads through this');
});

test('no fixture from either canvas reaches the pages', () => {
  for (const page of [room, file]) {
    assert.doesNotMatch(page, /Kelp Bio|Thornbury|gr_9k2|fl_2a|Pitch deck\.pdf|Cap table — Jun/);
  }
});
