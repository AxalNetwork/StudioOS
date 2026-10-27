// D1106 (#2986) — Data room part 5: Home, Files with its bulk bar, the file
// and folder lightboxes, Upload and the dialogs. Each dialog says what it
// changes (and who gains or loses the file) before anything is sent; a failed
// block says Unreadable; nothing here calls prompt(), confirm() or alert().
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_files_d1106.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  accessRows, deleteFolderCopy, effectLine, folderNdaCopy, gainLose, gateCopy, grantOn, inScope, makeCurrentCopy, moveCopy, needsYou,
  queueEntry, recentFiles, removeCopy, storageLine, tableRows, treeRows, uploadRefusal, whoCanOpen,
} from '../src/pages/raise/dataroom/filesModel.js';

const h = React.createElement;
const NOW = Date.parse('2026-10-25T12:00:00Z');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ROOM = {
  project: { uid: 'p3uid', name: 'Harbor Ledger' },
  role: 'owner',
  folders: [
    { id: 1, uid: 'f1', name: 'Financials', parent_id: null, visibility: 'nda', display_order: 0 },
    { id: 2, uid: 'f2', name: 'Bank', parent_id: 1, visibility: 'open', display_order: 0 },
    { id: 3, uid: 'f3', name: 'Legal', parent_id: null, visibility: 'open', display_order: 1 },
  ],
  files: [
    { id: 11, uid: 'a1', name: 'Model.xlsx', folder_id: 1, visibility: 'nda', access_tier: 'invited', access_expires_at: null, downloads: 4, size_bytes: 2048, created_at: '2026-10-20 10:00:00' },
    { id: 12, uid: 'a2', name: 'Deck.pdf', folder_id: null, visibility: 'open', access_tier: 'nobody', access_expires_at: null, downloads: 0, size_bytes: 1024, created_at: '2026-10-22 10:00:00' },
    { id: 13, uid: 'a3', name: 'Statement.pdf', folder_id: 2, visibility: 'open', access_tier: 'invited', access_expires_at: null, downloads: 1, size_bytes: null, created_at: '2026-10-21 10:00:00' },
    { id: 14, uid: 'a4', name: 'Contract.pdf', folder_id: 3, visibility: 'open', access_tier: 'committed', access_expires_at: null, downloads: 0, size_bytes: 512, created_at: '2026-10-24 10:00:00' },
  ],
  grants: [
    { uid: 'g1', status: 'active', created_at: '2026-10-01 09:00:00', expires_at: '2026-10-30', investor_name: 'Bluefern Capital', investor_email: 'a@bluefern.example', nda_signed: true, committed: 1, folders: null },
    { uid: 'g2', status: 'active', created_at: '2026-10-02 09:00:00', expires_at: null, investor_name: 'Juniper Angels', investor_email: 'j@juniper.example', nda_signed: false, committed: 0, folders: ['f3'] },
    { uid: 'g3', status: 'active', created_at: '2026-09-01 09:00:00', expires_at: '2026-10-01', investor_name: 'Northwind', investor_email: 'n@northwind.example', nda_signed: false, committed: 0, folders: null },
  ],
  report_shares: [], recent_access: [], week: { opened: 0, downloaded: 0, blocked: 0 },
};
const file = (id) => ROOM.files.find((f) => f.id === id);

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('who can open a file: the investor rule, then each grant\'s folders; an unreadable scope is said', () => {
  // Mutation checked: inScope ignoring folders → Juniper opens Model; a top-level file opened by a scoped grant → Juniper opens Deck's peers.
  assert.equal(inScope(ROOM, file(13), ROOM.grants[1]), false, 'Legal only does not reach Financials › Bank');
  assert.equal(inScope(ROOM, file(14), ROOM.grants[1]), true);
  assert.equal(inScope(ROOM, file(13), ROOM.grants[0]), true, 'null opens every folder, subfolders included');
  assert.equal(inScope(ROOM, { folder_id: null }, ROOM.grants[1]), false, 'a scoped grant never opens the top level');
  assert.equal(inScope(ROOM, file(13), { ...ROOM.grants[0], folders_unreadable: true }), null);
  assert.deepEqual(whoCanOpen(ROOM, file(11), NOW).map((w) => [w.who, w.open, w.why]), [
    ['Bluefern Capital', true, 'Can open'], ['Juniper Angels', false, 'Its access does not include this folder'],
  ], 'an ended grant is not listed');
  assert.equal(grantOn(ROOM, file(14), ROOM.grants[1], NOW).why, 'Not committed');
  assert.equal(grantOn(ROOM, { ...file(14), access_tier: 'invited', visibility: 'nda' }, ROOM.grants[1], NOW).why, 'NDA needed');
  assert.equal(grantOn(ROOM, file(12), ROOM.grants[0], NOW).why, 'Private to you');
  assert.equal(grantOn(ROOM, file(11), ROOM.grants[2], NOW).why, 'Access ended');
});

test('each dialog names who gains or loses, and says nothing changes when nothing does', () => {
  // Mutation checked: gainLose comparing after with after → nobody ever gains; the Trash sentence promising restore.
  assert.deepEqual(gainLose(ROOM, [file(14)], { access_tier: 'invited' }, NOW), { gain: ['Juniper Angels'], lose: [] });
  assert.match(gateCopy(ROOM, [file(14)], { tier: 'invited' }, NOW).body, /^Juniper Angels can open it after this\.$/);
  assert.equal(gateCopy(ROOM, [file(13)], { nda: true }, NOW).body, 'No investor gains or loses access by this.', 'Bluefern has the NDA');
  assert.deepEqual(gateCopy(ROOM, [file(13)], { nda: true }, NOW).patch, { visibility: 'nda' });
  assert.match(gateCopy(ROOM, [file(11), file(13)], { tier: 'nobody' }, NOW).body, /Bluefern Capital can no longer open them\./);
  const move = moveCopy(ROOM, [file(13)], 'f3', NOW);
  assert.equal(move.title, 'Move Statement.pdf to Legal?');
  assert.match(move.body, /Each file keeps its own gate\. Juniper Angels can open it after this\./, 'a grant limited to Legal gains it');
  assert.deepEqual(move.patch, { folder_uid: 'f3' });
  assert.deepEqual(moveCopy(ROOM, [file(13)], '', NOW).patch, { folder_uid: null });
  const rm = removeCopy([file(11)], 2);
  assert.equal(rm.body, 'Remove Model.xlsx and its 2 earlier versions? Investors stop seeing it now. Copies already saved are not recalled.');
  assert.match(rm.trash, /There is no Trash yet\. .*this deletes it\./);
  assert.match(removeCopy([file(11), file(12)]).body, /^Remove 2 files and every earlier version\?/);
  assert.match(makeCurrentCopy(file(11), 2).body, /kept as an earlier version; nothing is lost/);
  assert.equal(effectLine({ gain: ['A', 'B', 'C', 'D'], lose: [] }, 2), 'A, B, C and 1 more can open them after this.');
  assert.equal(effectLine({ gain: ['A', 'B'], lose: [] }, 1), 'A, B can open it after this.', 'the pronoun follows the files, not the investors');
});

test('folders: the NDA switch and delete say what they change; a folder with folders inside is not deleted here', () => {
  // Mutation checked: delete with subfolders allowed → the blocked line is missing; the scoped-only investor not named.
  assert.match(deleteFolderCopy(ROOM, ROOM.folders[0]).blocked, /Financials has 1 folder inside\. Move or delete it first\./);
  const legal = deleteFolderCopy(ROOM, ROOM.folders[2], NOW);
  assert.equal(legal.title, 'Delete Legal?');
  assert.match(legal.body, /^Its 1 file moves to the top level\. Nothing is deleted\. Juniper Angels, whose access names only this folder, then opens nothing\.$/);
  const nda = folderNdaCopy(ROOM, ROOM.folders[2], true, true, NOW);
  assert.deepEqual(nda.patch, { visibility: 'nda', apply_to_contents: true });
  assert.match(nda.body, /Every folder and file inside is set the same \(1 file\)/);
  assert.match(folderNdaCopy(ROOM, ROOM.folders[2], true, false, NOW).body, /Each file keeps its own gate/);
});

test('the tree, the table and Home: counts with subfolders, the top level, search, and nothing invented', () => {
  // Mutation checked: the tree counting only a folder's own files → Financials shows 1; storage summed with a null size as 0 and claimed whole.
  const t = treeRows(ROOM);
  assert.deepEqual([t.all, t.top], [4, 1]);
  assert.deepEqual(t.folders.map((f) => [f.name, f.depth, f.files]), [['Financials', 0, 2], ['Bank', 1, 1], ['Legal', 0, 1]]);
  assert.deepEqual(tableRows(ROOM, { folder: 'f1' }, NOW).map((r) => r.name), ['Model.xlsx', 'Statement.pdf']);
  assert.deepEqual(tableRows(ROOM, { folder: 'top' }, NOW).map((r) => r.name), ['Deck.pdf']);
  assert.deepEqual(tableRows(ROOM, { q: 'state' }, NOW).map((r) => r.name), ['Statement.pdf']);
  const deck = tableRows(ROOM, {}, NOW).find((r) => r.name === 'Deck.pdf');
  assert.deepEqual([deck.opens, deck.gate], ['No one', 'Private to you']);
  const needs = needsYou(ROOM, NOW);
  assert.deepEqual(needs.map((n) => n.key), ['end-g1', 'nda'], 'Bluefern ends within 14 days; Juniper needs an NDA; a private file is not "shut"');
  assert.match(needs[1].text, /^1 investor needs an NDA to open 1 file$/);
  assert.deepEqual(accessRows(ROOM, NOW).map((a) => [a.who, a.folders, a.nda]), [['Bluefern Capital', 'Every folder', 'NDA signed'], ['Juniper Angels', 'Legal', 'NDA needed']]);
  assert.deepEqual(recentFiles(ROOM).map((f) => f.name), ['Contract.pdf', 'Deck.pdf', 'Statement.pdf', 'Model.xlsx']);
  assert.match(storageLine(ROOM), /3\.5 KB over the 3 of 4 files whose size is recorded\. Earlier versions are not totalled here, and no plan limit is recorded, so storage left is not shown\./);
  assert.equal(queueEntry({ name: 'v.mp4', size: 21 * 1024 * 1024 }, 0).state, 'refused');
  assert.equal(queueEntry({ name: 'a.pdf', size: 10 }, 0).state, 'waiting');
  assert.equal(uploadRefusal({ status: 413 }), 'Refused: larger than 20 MB');
  assert.equal(uploadRefusal({ status: 403, code: 'owner_only', message: 'Only the room’s owner can do this.' }), 'Refused: only the owner sets a gate');
  assert.equal(uploadRefusal({ status: 403, message: 'Only the owner…' }), 'Refused: the upload did not go through', 'the code, never the sentence (D258)');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const VERSIONS = { file: { uid: 'a1' }, current: { version: 3, created_at: '2026-10-08 10:00:00', uploaded_by_name: 'Founder B', size_bytes: 2516582 }, versions: [{ version: 2, created_at: '2026-09-02 10:00:00', uploaded_by_name: null, size_bytes: null }] };
const RECORD = { title: 'Model.xlsx', facts: [{ label: 'Answers', value: 'Financial model' }], sections: [{ key: 'opened', title: 'Who opened it', rows: [{ a: 'Bluefern Capital', b: '24 Oct 2026', c: 'Downloaded' }, { a: 'Juniper Angels', b: '21 Oct 2026', c: 'Blocked' }, { a: 'Larch', b: 'never', c: 'Not opened' }] }], actions: [] };

function handlerFor(room = ROOM, fail = {}) {
  return (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method !== 'GET') return response({ ok: true, partner: {} });
    if (/\/api\/projects(\?|$)/.test(url)) return response([{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }]);
    // D1284: D1104's queue, read by Home's Needs you.
    if (/\/data-room\/p3uid\/requests$/.test(url)) return fail.requests ? response({ detail: 'x' }, 503) : response(fail.requestsBody || { requests: [], open: 2, can_answer: true });
    if (/\/data-room\/p3uid\/files\/[^/]+\/versions/.test(url)) return fail.versions ? response({ detail: 'x' }, 500) : response(VERSIONS);
    if (/\/data-room\/p3uid(\?|$)/.test(url)) return fail.room ? response({ detail: 'x' }, 500) : response(room);
    if (/\/form-options/.test(url)) return response({ project_uid: 'p3uid', folders: [], requests: [{ value: 7, label: 'Burn and runway' }], checklist: [{ value: 'financial_model', label: 'Financial model' }] });
    if (/\/records\/11\?/.test(url)) return fail.record ? response({ detail: 'x' }, 500) : response(RECORD);
    if (url.includes('/cycles/raise/modules/')) return response({ module: { slug: 'data-room', name: 'Data room', records_title: 'Files' }, card: { state: 'empty', reason: 'No files yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } });
    return response({});
  };
}

function Where({ onAt }) { const l = useLocation(); onAt(l.pathname + l.search); return null; }

async function mounted(url, { handle = handlerFor() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, now: Date.now };
  const calls = [];
  globalThis.fetch = async (u, options = {}) => { calls.push({ url: String(u), method: options.method || 'GET', body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Date.now = () => NOW;
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  let where = url;
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/data-room/file/:id', element: h(CycleRoute, { cycle: 'raise', slug: 'data-room', record: true, dataRoomFile: true }) }),
    h(Route, { path: '/raise/:slug/new', element: h(CycleRoute, { cycle: 'raise', adding: true }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ), h(Where, { onAt: (x) => { where = x; } }))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const find = (id) => { const n = nodes().find((x) => props(x)['data-testid'] === id); assert.ok(n, `no ${id}`); return n; };
  return {
    calls, where: () => where, flush,
    has: (id) => nodes().some((x) => props(x)['data-testid'] === id),
    of: (id) => text(find(id)),
    prop: (id, k) => props(find(id))[k],
    async click(id) { await act(async () => { props(find(id)).onClick(); }); await flush(); },
    async change(id, target) { await act(async () => { props(find(id)).onChange({ target, preventDefault() {} }); }); await flush(); },
    writes: () => calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url.replace(/^.*?\/api\//, '/api/'), c.body && typeof c.body === 'string' ? JSON.parse(c.body) : c.body]),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, { fetch: previous.fetch, matchMedia: previous.matchMedia }); Date.now = previous.now; restore(); },
  };
}

test('Files: the bulk bar opens a dialog naming who gains, and only then patches each file', async () => {
  // Mutation checked: patching on Set gate before the dialog → a PATCH before the confirm; the patch body dropping the tier.
  const v = await mounted('/raise/data-room/files?project_id=3');
  try {
    assert.ok(v.has('dataroom-tree') && v.has('dataroom-files-table'));
    assert.equal(v.of('dataroom-tree-f1').replace(/\s+/g, ''), '🔒Financials2');
    await v.change('dataroom-pick-a4', {});
    assert.match(v.of('dataroom-bulk'), /1 selected/);
    await v.click('dataroom-bulk-gate');
    await v.change('dataroom-gate-invited', {});
    await v.change('dataroom-gate-nda', { checked: false });
    assert.match(v.of('dataroom-gate-body'), /Juniper Angels can open it after this\./);
    assert.deepEqual(v.writes(), [], 'nothing is sent before the confirm');
    await v.click('dataroom-gate-go');
    assert.deepEqual(v.writes(), [['PATCH', '/api/data-room/p3uid/files/a4', { access_tier: 'invited', visibility: 'open' }]]);
    assert.equal(v.of('dataroom-files-done'), 'Gate set on 1 file.');
  } finally { await v.close(); }
});

test('Files: Remove says there is no Trash and then deletes; a co-founder cannot set a gate or remove', async () => {
  // Mutation checked: the owner gate dropped → a co-founder's Set gate is enabled.
  const v = await mounted('/raise/data-room/files?project_id=3');
  try {
    await v.change('dataroom-pick-a1', {});
    await v.change('dataroom-pick-a2', {});
    await v.click('dataroom-bulk-remove');
    assert.match(v.of('dataroom-remove-body'), /^Remove 2 files and every earlier version\?/);
    assert.match(v.of('dataroom-remove-trash'), /There is no Trash yet/);
    await v.click('dataroom-remove-go');
    assert.deepEqual(v.writes().map((w) => w.slice(0, 2)), [['DELETE', '/api/data-room/p3uid/files/a1'], ['DELETE', '/api/data-room/p3uid/files/a2']]);
  } finally { await v.close(); }
  const co = await mounted('/raise/data-room/files?project_id=3', { handle: handlerFor({ ...ROOM, role: 'cofounder' }) });
  try {
    await co.change('dataroom-pick-a1', {});
    assert.equal(co.prop('dataroom-bulk-gate', 'disabled'), true);
    assert.equal(co.prop('dataroom-bulk-remove', 'disabled'), true);
    assert.equal(co.prop('dataroom-bulk-move', 'disabled'), undefined);
    assert.match(co.of('dataroom-bulk-owner'), /Only the venture’s owner changes a gate/);
  } finally { await co.close(); }
});

test('New folder is a field in a dialog, and a folder\'s lightbox asks before its NDA or delete', async () => {
  // Mutation checked: the NDA switch patching without apply_to_contents → the body differs; delete allowed with a subfolder.
  const v = await mounted('/raise/data-room/files?project_id=3');
  try {
    await v.click('dataroom-new-folder');
    assert.equal(v.prop('dataroom-newfolder-go', 'disabled'), true, 'a name is needed');
    await v.change('dataroom-newfolder-name', { value: 'Board consents' });
    await v.change('dataroom-newfolder-parent', { value: 'f3' });
    assert.match(v.of('dataroom-newfolder-body'), /created inside Legal/);
    await v.click('dataroom-newfolder-go');
    assert.deepEqual(v.writes(), [['POST', '/api/data-room/p3uid/folders', { name: 'Board consents', parent_uid: 'f3' }]]);
    await v.click('dataroom-folder-open-f3');
    assert.equal(v.prop('dataroom-folder', 'role'), 'dialog', 'D1317: the folder opens as the shared Sheet');
    assert.ok(v.prop('dataroom-folder', 'aria-labelledby'));
    assert.equal(v.prop('dataroom-folder', 'data-width'), 560);
    await v.click('dataroom-folder-nda-switch');
    assert.match(v.of('dataroom-folder-nda-body'), /Every folder and file inside is set the same/);
    await v.click('dataroom-folder-nda-go');
    assert.deepEqual(v.writes().at(-1), ['PATCH', '/api/data-room/p3uid/folders/f3', { visibility: 'nda', apply_to_contents: true }]);
    await v.click('dataroom-folder-open-f1');
    await v.click('dataroom-folder-delete-open');
    assert.match(v.of('dataroom-folder-delete-blocked-body'), /Financials has 1 folder inside/);
    assert.ok(!v.writes().some((w) => w[0] === 'DELETE'));
  } finally { await v.close(); }
});

test('the file lightbox: who can open it, answers, versions with Make current, links; each block fails alone', async () => {
  // Mutation checked: a failed versions read blanking the lightbox → no "who" block; Make current sent without its dialog.
  const v = await mounted('/raise/data-room/file/11?project_id=3');
  try {
    assert.ok(v.has('dataroom-files-table'), 'over Files');
    assert.equal(v.prop('dataroom-file', 'role'), 'dialog', 'D1317: the file opens as the shared Sheet over Files');
    assert.ok(v.prop('dataroom-file', 'aria-labelledby'));
    assert.equal(v.prop('dataroom-file', 'data-width'), 720);
    assert.match(v.of('dataroom-file-who'), /Bluefern Capital.*Can open.*Juniper Angels.*Its access does not include this folder/s);
    assert.match(v.of('dataroom-file-answers'), /✓ Financial model/);
    assert.match(v.of('dataroom-file-version-3'), /v3.*8 Oct 2026 · Founder B.*2\.4 MB.*Current/s);
    assert.match(v.of('dataroom-file-version-2'), /v2.*Not recorded.*Not recorded/s, 'a missing uploader and size say so, never 0');
    assert.match(v.of('dataroom-file-links'), /Bluefern Capital.*Link issued.*Juniper Angels.*Refused/s);
    assert.doesNotMatch(v.of('dataroom-file-links'), /Larch/, 'not opened is not a link issued');
    await v.click('dataroom-file-version-current-2');
    assert.deepEqual(v.writes(), []);
    assert.match(v.of('dataroom-file-current-body'), /nothing is lost/);
    await v.click('dataroom-file-current-go');
    assert.deepEqual(v.writes(), [['POST', '/api/data-room/p3uid/files/a1/versions/2/current', undefined]]);
    await v.click('dataroom-file-download');
    assert.ok(v.writes().some((w) => w[1] === '/api/data-room/p3uid/files/a1/download'));
    await v.click('dataroom-file-close');
    assert.equal(v.where(), '/raise/data-room/files?project_id=3', 'closing returns to Files');
    assert.ok(!v.has('dataroom-file') && v.has('dataroom-files-table'));
  } finally { await v.close(); }
  const half = await mounted('/raise/data-room/file/11?project_id=3', { handle: handlerFor(ROOM, { versions: true, record: true }) });
  try {
    assert.ok(half.has('dataroom-file-versions-unreadable') && half.has('dataroom-file-answers-unreadable'));
    assert.match(half.of('dataroom-file-who'), /Bluefern Capital/, 'the room\'s blocks still stand');
  } finally { await half.close(); }
  const gone = await mounted('/raise/data-room/file/99?project_id=3');
  try { assert.ok(gone.has('dataroom-file-gone')); } finally { await gone.close(); }
});

test('Upload at /new: the queue in states, a large file refused before sending, the gate sent for all files', async () => {
  // Mutation checked: the 20 MB check removed → the big file is POSTed; the NDA default off → visibility open; the owner test dropped → a co-founder sends a gate.
  const v = await mounted('/raise/data-room/new?project_id=3');
  try {
    assert.ok(v.has('dataroom-upload-sheet'));
    assert.match(v.of('dataroom-upload-storage'), /storage left is not shown/);
    const small = new File(['hello'], 'Pipeline.xlsx', { type: 'text/plain' });
    const big = { name: 'Demo.mp4', size: 21 * 1024 * 1024, type: 'video/mp4', arrayBuffer: async () => new ArrayBuffer(0) };
    await v.change('dataroom-upload-pick', { files: [small, big] });
    assert.match(v.of('dataroom-upload-queue'), /Pipeline\.xlsx.*○ Waiting.*Demo\.mp4.*✕ Refused: larger than 20 MB/s);
    await v.change('dataroom-upload-folder', { value: 'f3' });
    await v.change('dataroom-upload-answers', { value: 'item-financial_model' });
    await v.click('dataroom-upload-go');
    const posts = v.writes().filter((w) => w[0] === 'POST');
    assert.equal(posts.length, 1, 'only the file that fits is sent');
    const [, path, body] = posts[0];
    assert.equal(path, '/api/data-room/p3uid/files');
    assert.deepEqual(body, { name: 'Pipeline.xlsx', data: 'data:text/plain;base64,aGVsbG8=', folder_uid: 'f3', visibility: 'nda', access_tier: 'invited', access_expires_at: null, checklist_item: 'financial_model' });
    assert.ok(v.has('dataroom-upload-state-done'));
  } finally { await v.close(); }
  const co = await mounted('/raise/data-room/new?project_id=3', { handle: handlerFor({ ...ROOM, role: 'cofounder' }) });
  try {
    assert.ok(co.has('dataroom-upload-cofounder') && !co.has('dataroom-upload-nda'), 'a co-founder sets no gate');
    await co.change('dataroom-upload-pick', { files: [new File(['hi'], 'Notes.txt', { type: 'text/plain' })] });
    await co.click('dataroom-upload-go');
    const sent = co.writes().filter((w) => w[0] === 'POST');
    assert.deepEqual(sent.map((w) => w[2]), [{ name: 'Notes.txt', data: 'data:text/plain;base64,aGk=' }], 'the folder\'s gate applies; none is sent');
  } finally { await co.close(); }
});

test('Home: Needs you, who has access, what was added; a failed room read is Unreadable and the module page stands', async () => {
  // Mutation checked: Home drawing its blocks from nothing when the read fails → no Unreadable.
  const v = await mounted('/raise/data-room?project_id=3');
  try {
    assert.match(v.of('dataroom-needs'), /Bluefern Capital’s access ends 30 Oct 2026.*1 investor needs an NDA/s);
    // D1284: the open access requests from D1104's queue, the caller's to answer, with the door to Requests.
    assert.equal(v.of('dataroom-needs-requests'), '2 access requests wait for your answerShare the room or decline, on Requests.Open Requests');
    assert.equal(v.prop('dataroom-needs-requests-open', 'href'), '/raise/data-room/requests?project_id=3');
    assert.ok(!v.of('dataroom-needs').includes('not read here yet'), 'the wait that named the gap is gone');
    assert.match(v.of('dataroom-who'), /Juniper Angels.*NDA needed · Legal · No end date/s);
    assert.match(v.of('dataroom-recent'), /Contract\.pdf/);
    assert.match(v.of('dataroom-90-wait'), /part 4/);
    assert.ok(v.has('cycle-module'));
  } finally { await v.close(); }
  const f = await mounted('/raise/data-room?project_id=3', { handle: handlerFor(ROOM, { room: true }) });
  try {
    assert.ok(f.has('dataroom-home-unreadable') && f.has('cycle-module'));
  } finally { await f.close(); }
});

test('Home (D1284): Needs you reads the access requests: one, none, a failed read alone, and a viewer who cannot answer', async () => {
  const one = await mounted('/raise/data-room?project_id=3', { handle: handlerFor(ROOM, { requestsBody: { requests: [], open: 1, can_answer: true } }) });
  try { assert.match(one.of('dataroom-needs-requests'), /^1 access request waits for your answer/); } finally { await one.close(); }
  const none = await mounted('/raise/data-room?project_id=3', { handle: handlerFor(ROOM, { requestsBody: { requests: [], open: 0, can_answer: true } }) });
  try {
    assert.equal(none.of('dataroom-needs-requests'), 'No access request waits.');
    assert.ok(!none.has('dataroom-needs-requests-open'));
  } finally { await none.close(); }
  const failed = await mounted('/raise/data-room?project_id=3', { handle: handlerFor(ROOM, { requests: true }) });
  try {
    assert.ok(failed.has('dataroom-needs-requests-unreadable'));
    assert.match(failed.of('dataroom-needs-requests-unreadable'), /This is not a claim that nobody asked\./);
    assert.ok(!failed.has('dataroom-needs-requests'), 'no count, and no "none", from a failed read');
    // The rest of Home still draws.
    assert.match(failed.of('dataroom-needs'), /Bluefern Capital’s access ends 30 Oct 2026/);
    assert.match(failed.of('dataroom-who'), /Juniper Angels/);
  } finally { await failed.close(); }
  const shapeless = await mounted('/raise/data-room?project_id=3', { handle: handlerFor(ROOM, { requestsBody: { requests: [] } }) });
  try { assert.ok(shapeless.has('dataroom-needs-requests-unreadable'), 'a reply with no count is unreadable, never none'); } finally { await shapeless.close(); }
  const co = await mounted('/raise/data-room?project_id=3', { handle: handlerFor(ROOM, { requestsBody: { requests: [], open: 3, can_answer: false } }) });
  try {
    assert.equal(co.of('dataroom-needs-requests'), '3 access requests openThe venture’s owner answers them. You can read them on Requests.Open Requests');
    assert.doesNotMatch(co.of('dataroom-needs-requests'), /your answer/);
  } finally { await co.close(); }
});

test('the source: no browser pop-up anywhere in the tool, and the file route is the one added', () => {
  const dir = 'frontend/src/pages/raise/dataroom';
  for (const f of readdirSync(dir).filter((x) => /\.jsx?$/.test(x))) {
    assert.doesNotMatch(readFileSync(`${dir}/${f}`, 'utf8'), /\b(window\.)?(alert|confirm|prompt)\(/, f);
  }
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.ok(app.includes('<Route path="/raise/data-room/file/:id" element={guard(labRoles([\'admin\', \'founder\']), <CycleRoute cycle="raise" slug="data-room" record dataRoomFile />)} />'));
  assert.ok(app.indexOf('/raise/data-room/file/:id') < app.indexOf('path="/raise/:slug/:id"'));
});
