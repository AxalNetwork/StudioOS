/** #6185: admitted files only, stable sort/page state and independent shared content search. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { roomListing } from '../src/pages/deal/dealWorkModel.js';
import { roomFilesQuery } from '../src/pages/deal/roomFilesQuery.js';
import SharedRoomFiles from '../src/pages/deal/SharedRoomFiles.jsx';
import { dataRoomApi } from '../src/lib/api/dataRoom.js';
import { DealDocuments } from '../src/pages/deal/DealWorkTabs.jsx';
import { dealWorkroomApi } from '../src/lib/api/dealWorkroom.js';
import { api } from '../src/lib/api.js';

const files = Array.from({ length: 60 }, (_, i) => ({ uid: `f-${String(i).padStart(2, '0')}`, name: `File ${String(i).padStart(2, '0')}.pdf`, folder_uid: i < 55 ? 'folder-a' : 'folder-b',
  size_bytes: i * 100, created_at: `2026-10-${String(i % 28 + 1).padStart(2, '0')}T10:00:00Z` }));
const listing = roomListing({ files, folders: [{ uid: 'folder-a', name: 'Finance' }, { uid: 'folder-b', name: 'Other' }] });
const node = (v, id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);
const press = (v, id) => act(async () => v.props(node(v, id)).onClick());
const change = (v, id, value) => act(async () => v.props(node(v, id)).onChange({ target: { value } }));

test('sorting uses raw size/date, keeps zero measured, pages at 25 and never introduces unlisted raw files', () => {
  const result = roomFilesQuery(listing, [...files, { uid: 'withheld', name: 'Private name', size_bytes: 9999999 }], { sort: 'size', page: 2 });
  assert.equal(result.range, '26–50 of 60'); assert.equal(result.rows.length, 25); assert.equal(result.rows[0].uid, 'f-34');
  assert.equal(roomFilesQuery(listing, files, { sort: 'name' }).rows[0].uid, 'f-00');
  assert.equal(roomFilesQuery(listing, files, { sort: 'added' }).rows[0].uid, 'f-27');
  assert.equal(roomFilesQuery(listing, files, { q: 'no such file' }).range, '0 of 0');
  assert.equal(roomFilesQuery(listing, files, { sort: 'name', folder: 'folder-b', page: 4 }).range, '1–5 of 5');
  assert.doesNotMatch(JSON.stringify(result), /withheld|Private name/);
  const tiny = { files: [{ uid: 'zero', name: 'Zero' }, { uid: 'unknown', name: 'Unknown' }] };
  assert.deepEqual(roomFilesQuery(tiny, [{ uid: 'zero', size_bytes: 0 }], { sort: 'size' }).rows.map((f) => f.uid), ['zero', 'unknown']);
});

test('folder changes retain sort and requested page, including returning from a small folder', async () => {
  const view = await mountContracts(React.createElement(SharedRoomFiles, { projectUid: 'p-6185', listing, rawFiles: files, withheld: 3, onDownload() {} }));
  try {
    await change(view, 'room-sort', 'name'); await press(view, 'room-page-next');
    assert.match(view.text(), /26–50 of 60/);
    await press(view, 'room-folder-folder-a'); assert.match(view.text(), /26–50 of 55/);
    assert.equal(view.props(node(view, 'room-sort')).value, 'name');
    await press(view, 'room-folder-folder-b'); assert.match(view.text(), /1–5 of 5/);
    await press(view, 'room-folder-all'); assert.match(view.text(), /26–50 of 60/);
    await change(view, 'room-name-filter', 'no such file'); assert.match(view.text(), /No file matches/);
    assert.match(view.text(), /3 files need your NDA/); assert.doesNotMatch(view.text(), /Private name/);
  } finally { await view.unmount(); }
});

test('content search renders and opens only listing UIDs, even if a search response contains an extra hit', async () => {
  const original = dataRoomApi.sharedSearch; const reads = [], opened = [];
  dataRoomApi.sharedSearch = async (...args) => { reads.push(args); return { available: true, value: { hits: [
    { file_uid: 'f-00', file_name: 'File 00.pdf', snippet: 'Allowed excerpt' },
    { file_uid: 'secret', file_name: 'Withheld filename', snippet: 'Private excerpt' }] } }; };
  const view = await mountContracts(React.createElement(SharedRoomFiles, { projectUid: 'p-6185', listing, rawFiles: files, onDownload: (f) => opened.push(f.uid) }));
  try {
    const input = view.nodes().find((n) => view.props(n)?.['aria-label'] === 'Search inside the files');
    await act(async () => view.props(input).onChange({ target: { value: 'runway' } }));
    const form = view.nodes().find((n) => view.props(n)?.onSubmit);
    await act(async () => view.props(form).onSubmit({ preventDefault() {} }));
    assert.deepEqual(reads, [['p-6185', 'runway']]); assert.match(view.text(), /Allowed excerpt/); assert.doesNotMatch(view.text(), /Withheld filename|Private excerpt/);
    const hit = view.nodes().find((n) => n.tagName === 'BUTTON' && view.props(n)?.children === 'File 00.pdf');
    await act(async () => view.props(hit).onClick()); assert.deepEqual(opened, ['f-00']);
  } finally { await view.unmount(); dataRoomApi.sharedSearch = original; }
});

test('index off and failed search stay distinct and keep the name filter usable', async () => {
  const original = dataRoomApi.sharedSearch;
  try {
    for (const fail of [false, true]) {
      dataRoomApi.sharedSearch = async () => { if (fail) throw new Error('synthetic search unavailable'); return { available: false }; };
      const view = await mountContracts(React.createElement(SharedRoomFiles, { projectUid: 'p-6185', listing, rawFiles: files, onDownload() {} }));
      try {
        const input = view.nodes().find((n) => view.props(n)?.['aria-label'] === 'Search inside the files');
        await act(async () => view.props(input).onChange({ target: { value: 'cash' } }));
        const form = view.nodes().find((n) => view.props(n)?.onSubmit);
        await act(async () => view.props(form).onSubmit({ preventDefault() {} }));
        assert.match(view.text(), fail ? /could not be searched|synthetic search unavailable/ : /Search inside files is not switched on yet/);
        if (fail) assert.doesNotMatch(view.text(), /not switched on yet/);
        await change(view, 'room-name-filter', 'File 59'); assert.match(view.text(), /1–1 of 1/);
      } finally { await view.unmount(); }
    }
  } finally { dataRoomApi.sharedSearch = original; }
});

test('Documents mounts the new listing only after the existing access gate admits it', async () => {
  const original = { access: dealWorkroomApi.roomAccess, room: dealWorkroomApi.sharedRoom, paper: api.esignList };
  try {
    for (const granted of [true, false]) {
      const reads = [];
      dealWorkroomApi.roomAccess = async () => ({ granted: granted ? {} : null, project_uid: 'p-6185' });
      dealWorkroomApi.sharedRoom = async (uid) => { reads.push(uid); return { files, folders: [{ uid: 'folder-a', name: 'Finance' }], withheld_behind_nda: 3, nda_signed: false }; };
      api.esignList = async () => ({ envelopes: [] });
      const view = await mountContracts(React.createElement(DealDocuments, { deal: { id: 7 } }));
      try {
        await view.flush();
        assert.equal(Boolean(node(view, 'shared-room-files')), granted);
        assert.equal(Boolean(node(view, 'room-name-filter')), granted);
        assert.deepEqual(reads, granted ? ['p-6185'] : []);
        if (!granted) assert.match(view.text(), /not opened their data room to you/);
      } finally { await view.unmount(); }
    }
  } finally { dealWorkroomApi.roomAccess = original.access; dealWorkroomApi.sharedRoom = original.room; api.esignList = original.paper; }
});
