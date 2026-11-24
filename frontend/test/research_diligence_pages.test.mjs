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
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { activityLine, fileSize, folderNameOf, memoExport, roomFileState, roomNdaState, stagedSinceLastVisit } from '../src/pages/research/diligenceRead.js';
import { roomListing } from '../src/pages/deal/dealWorkModel.js';
import { LOOSE_FOLDER, roomFilesQuery } from '../src/pages/deal/roomFilesQuery.js';
import SharedRoomFiles from '../src/pages/deal/SharedRoomFiles.jsx';
import ZoneDraft from '../src/workspaces/ZoneDraft.jsx';
import { dataRoomApi } from '../src/lib/api/dataRoom.js';
import { api as apiClient } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ROOM_CANVAS = read('../../design/canvases/backlog/Pages · Diligence room.dc.html');
// #6270: the Investor Research v2 Rooms canvas (D6268, boards IRV-03 and IRV-04) the room and file page build to now.
const ROOMS_V2 = read('../../design/incoming/Investor Research v2 Rooms Page.dc.html');
const FILE_CANVAS = read('../../design/canvases/backlog/Pages · Diligence file.dc.html');
const room = read('../src/pages/research/DiligenceRoom.jsx');
const file = read('../src/pages/research/DiligenceFile.jsx');
const zone = read('../src/pages/research/DiligenceZone.jsx');
const app = read('../src/App.jsx');
const api = read('../src/lib/api.js');
// D1109 (#2989): the founder's room is the Data room tool now; DataRoomPage.jsx is retired.
const dataRoom = readdirSync(new URL('../src/pages/raise/dataroom/', import.meta.url)).filter((f) => f.endsWith('.jsx'))
  .map((f) => read(`../src/pages/raise/dataroom/${f}`)).join('\n');

/** Both ends: the canvas draws `drawn`, and the page renders `rendered` (default: the same words). */
function bothEnds(canvas, page, drawn, rendered = drawn) {
  assert.ok(canvas.includes(drawn), `the canvas no longer draws: ${drawn}`);
  assert.ok(page.includes(rendered), `the page no longer renders: ${rendered}`);
}

test('the room page renders every element the room canvas draws', () => {
  for (const s of [
    'Room access',
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
  // The four tiles. #6270: the one-row scope table and its in-page "Open the room →" are gone —
  // the Rooms canvas (IRV-03) draws neither — and the file table is the shared room component.
  for (const k of ['Open to you', 'In the room', 'Behind an NDA', 'Last opened']) bothEnds(ROOM_CANVAS, room, k);
  assert.doesNotMatch(room, /Open the room|href="#open-to-you"|<table/);
  // D6266: Deal stage draws the room's own deals (stage and Open the deal), and
  // with none, the worker's own sentence rather than a copy of it.
  bothEnds(ROOM_CANVAS, room, 'Deal stage');
  assert.match(room, /<RoomDeals deals=\{room\.deals\} note=\{room\.deal_stage_note\} \/>/);
  assert.doesNotMatch(room, /no key between them/);
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

test('the pages are routed for the investor alone (#6265), and read through the grant-keyed methods', () => {
  assert.match(app, /path="\/research\/diligence\/:grantUid" element=\{adminToResearch\(guard\(\['investor'\], <DiligenceRoom /);
  assert.match(app, /path="\/research\/diligence\/:grantUid\/files\/:fileUid" element=\{adminToResearch\(guard\(\['investor'\], <DiligenceFile /);
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

// ---------------------------------------------------------------- #6270 · IRV-03 and IRV-04

const h = React.createElement;
const ROOM = {
  last_opened_at: '2026-11-10 14:12:00',
  folders: [{ uid: 'fo-fin', name: 'Financials' }, { uid: 'fo-co', name: 'Company' }, { uid: 'fo-ip', name: 'IP' }],
  files: [
    { uid: 'f-model', name: 'Financial model v4.xlsx', folder_uid: 'fo-fin', size_bytes: 2048, created_at: '2026-11-12 09:00:00' },
    { uid: 'f-deck', name: 'Pitch deck.pdf', folder_uid: 'fo-co', size_bytes: 4096, created_at: '2026-11-01 09:00:00' },
    { uid: 'f-bios', name: 'Appendix notes', folder_uid: null, size_bytes: null, created_at: null },
  ],
};
const roomView = () => { const l = roomListing(ROOM); return { ...l, folders: l.folders.filter((f) => f.count > 0) }; };

test('#6270: the page builds to the Rooms canvas, both ends', () => {
  // The page end is pinned as rendered markup, so a docblock that names the words cannot stand in for them.
  bothEnds(ROOMS_V2, room, 'NDA with this founder', '<div className={eyebrow}>NDA with this founder</div>');
  bothEnds(ROOMS_V2, room, 'Review and sign', '>Review and sign</Link>');
  bothEnds(ROOMS_V2, room, 'staged after your previous visit', '`New · staged after your previous visit, ${when(room.last_opened_at)}');
  bothEnds(ROOMS_V2, read('../src/pages/research/diligenceRead.js'), 'NDA out for signature', "label: 'NDA out for signature'");
  bothEnds(ROOMS_V2, file, 'About this file', '<div className={eyebrow}>About this file</div>');
  bothEnds(ROOMS_V2, file, 'Staged on', '>Staged on</dt>');
  bothEnds(ROOMS_V2, file, 'Shown when you arrive from the room', '>Shown when you arrive from the room</span>');
  bothEnds(ROOMS_V2, file, 'carried from the room', '`${folder} · carried from the room`');
  // The room is the deal tab's own component (DE10, #5907), searched through the shared DataRoomSearch.
  assert.match(room, /import SharedRoomFiles from '\.\.\/deal\/SharedRoomFiles\.jsx';/);
  assert.match(read('../src/pages/deal/SharedRoomFiles.jsx'), /<DataRoomSearch key=\{projectUid\} projectUid=\{projectUid\} shared allowedFileUids=\{listing\.files\.map/);
  // A folder that lists no file is never drawn, so no heading or count stands for a withheld file.
  assert.match(room, /folders: l\.folders\.filter\(\(f\) => f\.count > 0\)/);
  // No Ask over the room (owner, D6268 Q2).
  assert.doesNotMatch(room, /AskZone|askRoom|Ask over/);
});

test('#6270: new since the visit before this one, and nothing new without a previous visit or a staged date', () => {
  assert.equal(stagedSinceLastVisit('2026-11-12 09:00:00', '2026-11-10 14:12:00'), true);
  assert.equal(stagedSinceLastVisit('2026-11-01T09:00:00Z', '2026-11-10T14:12:00Z'), false);
  assert.equal(stagedSinceLastVisit('2026-11-10 14:12:00', '2026-11-10 14:12:00'), false, 'staged at the visit is not after it');
  assert.equal(stagedSinceLastVisit('2026-11-12 09:00:00', null), null, 'a first visit marks nothing new');
  assert.equal(stagedSinceLastVisit(null, '2026-11-10 14:12:00'), null, 'an unrecorded staged date is not new');
  assert.equal(stagedSinceLastVisit('not a date', '2026-11-10 14:12:00'), null);
});

test('#6270: the NDA in its three states, and a read without one is not "No NDA"', () => {
  assert.deepEqual(roomNdaState({ status: 'none', valid_until: null }), { status: 'none', label: 'No NDA', line: 'No NDA is active between you and this founder.' });
  assert.equal(roomNdaState({ status: 'out_for_signature' }).label, 'NDA out for signature');
  assert.match(roomNdaState({ status: 'on_file', valid_until: '2027-03-01' }).line, /on file until 01 Mar 2027/);
  assert.match(roomNdaState({ status: 'on_file', valid_until: null }).line, /no end date recorded/);
  assert.equal(roomNdaState(undefined), null);
  assert.equal(roomNdaState({ status: 'something else' }), null);
  // Review and sign links to the deal's Data room tab, only where a deal is open to the reader.
  assert.match(room, /needsSigning && deal \? \(\s*<Link to=\{tabHref\(deal\.id, 'documents'\)\}[^>]*>Review and sign<\/Link>/);
  assert.match(room, /const needsSigning = st && st\.status !== 'on_file' && \(withheld > 0 \|\| st\.status === 'out_for_signature'\);/);
});

test('#6270: files group by folder in the listing order, a file outside every folder last in its own group', () => {
  const listing = roomView();
  assert.deepEqual(listing.folders.map((f) => f.name), ['Financials', 'Company'], 'the folder with no listed file is not drawn');
  assert.equal(listing.loose, 1);
  const grouped = roomFilesQuery(listing, ROOM.files, { grouped: true, sort: 'name' });
  assert.deepEqual(grouped.rows.map((f) => f.uid), ['f-model', 'f-deck', 'f-bios']);
  assert.deepEqual(roomFilesQuery(listing, ROOM.files, { sort: 'name' }).rows.map((f) => f.uid), ['f-bios', 'f-model', 'f-deck'], 'ungrouped, the deal tab sorts across folders');
  assert.deepEqual(roomFilesQuery(listing, ROOM.files, { folder: LOOSE_FOLDER }).rows.map((f) => f.uid), ['f-bios']);
  assert.equal(folderNameOf(ROOM.folders, 'fo-fin'), 'Financials');
  assert.equal(folderNameOf(ROOM.folders, null), null);
});

test('#6270: the room component, as the Research room mounts it — groups, staged dates, file links, hits from the listing only', async () => {
  const original = dataRoomApi.sharedSearch;
  dataRoomApi.sharedSearch = async () => ({ available: true, value: { hits: [
    { file_uid: 'f-deck', file_name: 'Pitch deck.pdf', snippet: 'Allowed excerpt' },
    { file_uid: 'f-secret', file_name: 'Withheld term sheet.pdf', snippet: 'Private excerpt' }] } });
  const opened = [];
  const listing = roomView();
  const view = await mountContracts(h(SharedRoomFiles, {
    projectUid: 'p-6270', listing, rawFiles: ROOM.files, withheld: 2, grouped: true, addedLabel: 'Staged ',
    fileLink: (f, { folder }) => ({ to: `/research/diligence/g-1/files/${f.uid}`, state: { folder } }),
    onOpen: (f) => opened.push(f.uid), onDownload() { throw new Error('a room row must not download'); },
    rowExtra: (f) => h('span', { 'data-testid': `extra-${f.uid}` }, 'extra'),
  }), '/research/diligence/g-1');
  try {
    const byId = (id) => view.nodes().filter((n) => view.props(n)?.['data-testid'] === id);
    const text = (n) => (n.childNodes || []).map((c) => (c.nodeType === 3 ? c.textContent : text(c))).join('') || n.textContent || '';
    assert.deepEqual(byId('room-file-group').map(text), ['Financials', 'Company', 'Not in a folder']);
    assert.match(view.text(), /Not in a folder · 1/);
    assert.deepEqual(byId('deal-room-file-meta').map(text).map((t) => t.split(' · ').pop()), ['Staged 12 Nov 2026', 'Staged 1 Nov 2026', 'Staged Not recorded']);
    const links = view.nodes().filter((n) => n.tagName === 'A');
    assert.deepEqual(links.map((n) => view.props(n)?.href), ['/research/diligence/g-1/files/f-model', '/research/diligence/g-1/files/f-deck', '/research/diligence/g-1/files/f-bios']);
    assert.equal(view.nodes().filter((n) => n.tagName === 'BUTTON' && /^Open /.test(view.props(n)?.['aria-label'] || '')).length, 0, 'a room row opens its page, not a download');
    assert.equal(byId('extra-f-model').length, 1);
    assert.match(view.text(), /2 files need your NDA/);

    const input = view.nodes().find((n) => view.props(n)?.['aria-label'] === 'Search inside the files');
    await act(async () => view.props(input).onChange({ target: { value: 'pilot' } }));
    const form = view.nodes().find((n) => view.props(n)?.onSubmit);
    await act(async () => view.props(form).onSubmit({ preventDefault() {} }));
    assert.match(view.text(), /Allowed excerpt/);
    assert.doesNotMatch(view.text(), /Withheld term sheet|Private excerpt/);
    const hit = view.nodes().find((n) => n.tagName === 'BUTTON' && view.props(n)?.children === 'Pitch deck.pdf');
    await act(async () => view.props(hit).onClick());
    assert.deepEqual(opened, ['f-deck'], 'a hit opens the file page');
  } finally { await view.unmount(); dataRoomApi.sharedSearch = original; }
});

test('#6270: the deal tab keeps its own rows — no group headings, Open downloads', async () => {
  const downloads = [];
  const view = await mountContracts(h(SharedRoomFiles, { projectUid: 'p-deal', listing: roomView(), rawFiles: ROOM.files, onDownload: (f) => downloads.push(f.uid) }), '/deals/1/data-room');
  try {
    assert.equal(view.nodes().filter((n) => view.props(n)?.['data-testid'] === 'room-file-group').length, 0);
    const open = view.nodes().find((n) => n.tagName === 'BUTTON' && view.props(n)?.['aria-label'] === 'Open Pitch deck.pdf');
    await act(async () => view.props(open).onClick());
    assert.deepEqual(downloads, ['f-deck']);
  } finally { await view.unmount(); }
});

test('#6270: Copy and Export appear on an accepted memo only, and export the accepted text', async () => {
  const out = memoExport({ company: 'Kelp Bio', body: '  Six of eleven files are open.  ', acceptedAt: '2026-11-14 10:02:00' });
  assert.equal(out.filename, 'room-memo-kelp-bio-2026-11-14.txt');
  assert.match(out.text, /^Room memo · Kelp Bio · accepted 14 Nov 2026, 10:02\n\nSix of eleven files are open\.\n$/);
  assert.equal(memoExport({ company: '', body: 'x', acceptedAt: null }).filename, 'room-memo-room.txt');

  const saved = { ...apiClient.research };
  try {
    for (const accepted of [true, false]) {
      apiClient.research.zoneDrafts = async () => ({ items: [{ uid: 'd1', body: 'The memo.', accepted, accepted_at: accepted ? '2026-11-14 10:02:00' : null }] });
      const view = await mountContracts(h(ZoneDraft, { surface: 'research/diligence', scopeKey: 'g-1', scoped: true, label: 'Room · what is thin',
        acceptedActions: (item) => h('span', { 'data-testid': 'memo-actions' }, `Copy ${item.uid}`) }), '/research/diligence/g-1');
      try {
        await act(async () => { await new Promise((r) => setImmediate(r)); });
        await act(async () => { await new Promise((r) => setImmediate(r)); });
        assert.match(view.text(), /The memo\./);
        assert.equal(view.nodes().filter((n) => view.props(n)?.['data-testid'] === 'memo-actions').length, accepted ? 1 : 0,
          accepted ? 'an accepted memo offers Copy and Export' : 'a proposal is never offered as the reader’s memo');
      } finally { await view.unmount(); }
    }
  } finally { Object.assign(apiClient.research, saved); }
  assert.match(room, /acceptedActions=\{\(item\) => <MemoCopyExport item=\{item\} company=\{room\.project\.name\} \/>\}/);
});

test('#6270: at 390px the file and activity rows stack, with nothing that scrolls sideways', () => {
  for (const page of [room, file]) {
    assert.doesNotMatch(page, /min-w-\[\d+px\]|overflow-x-auto|<table/, 'a fixed-width table scrolls sideways on a phone');
  }
  assert.match(room, /className="flex min-w-0 flex-col gap-1 text-\[12px\] sm:flex-row/, 'activity stacks below sm');
  assert.match(read('../src/pages/deal/SharedRoomFiles.jsx'), /flex min-w-0 flex-col gap-1 border-t border-axal-hairline pt-2 md:flex-row/, 'file rows stack below md');
});
