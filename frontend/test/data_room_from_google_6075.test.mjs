// D6075 (#6075, canvas DR30) — From Google on the data room's Upload. Only a connected account sees the option; a
// copy reads "From Google Drive, as of <date>"; Sync copies each chosen file once and says what happened in counts; a
// deleted copy stays deleted; the 20 MB cap and the NDA/Nobody gate are the Worker's (D1094) and are said, not
// decided, here; a revoked connection reads as such with the copies kept; a failed read is Unreadable, never "none".
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_from_google_6075.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import DataRoomFromGoogle from '../src/pages/raise/dataroom/DataRoomFromGoogle.jsx';
import {
  COPY_ACCESS_LINE, chosenHere, copyRows, copySource, googleState, partlyOf, revokedLine, syncLine,
} from '../src/pages/raise/dataroom/dataRoomGoogleModel.js';

const h = React.createElement;
const PROJECT = 3;
const FILE = { uid: 'g1', module: 'data_room', project_id: PROJECT, kind: 'file', name: 'Customer contracts.pdf', status: 'active', last_synced_at: '2026-11-14 09:00:00' };
const mineOf = (state, items = [FILE]) => ({ state, account_email: null, items, ventures: 1 });
const PART = {
  module: 'data_room', files: [FILE], proposals: [],
  copies: [{ id: 41, uid: 'f41', name: 'Customer contracts.pdf', size_bytes: 2048, as_of: '2026-11-12T08:30:00.000Z' }],
  deleted_kept: 1,
};
const moduleOf = (google) => ({ module: { slug: 'data-room' }, records: { rows: [] }, ...(google === undefined ? {} : { parts: { google } }) });
const ready = (data) => ({ status: 'ready', data });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('copySource: "From Google Drive, as of <date>", and no invented date when Google gave none', () => {
  assert.equal(copySource('2026-11-12T08:30:00.000Z'), 'From Google Drive, as of 2026-11-12');
  assert.equal(copySource(null), 'From Google Drive, date not recorded');
  assert.equal(copySource('yesterday'), 'From Google Drive, date not recorded');
  assert.deepEqual(copyRows(PART), [{ id: 41, label: 'Customer contracts.pdf', cells: { name: 'Customer contracts.pdf', source: 'From Google Drive, as of 2026-11-12' } }]);
  assert.deepEqual(copyRows({}), []);
  assert.deepEqual(copyRows({ copies: [null, { name: 'x' }] }), [], 'a copy with no id is not drawn');
});

test('googleState: only a connected account sees the section; revoked, unavailable and unreadable are each said', () => {
  const s = (mine, module) => googleState({ mine, module }, PROJECT);
  assert.equal(s({ status: 'loading' }), 'reading');
  assert.equal(s({ status: 'error' }), 'unreadable', 'an unread connection is never read as "not connected"');
  assert.equal(s(ready(mineOf('google_not_connected', []))), 'hidden', 'not connected, nothing chosen: no option at all');
  assert.equal(s(ready(mineOf('workspace_not_allowed', [{ ...FILE, project_id: 9 }]))), 'hidden', 'a file chosen for another venture does not count');
  assert.equal(s(ready(mineOf('google_not_connected'))), 'revoked');
  assert.equal(s(ready(mineOf('workspace_not_allowed'))), 'revoked');
  assert.equal(s(ready(mineOf('ready')), { status: 'loading' }), 'reading');
  assert.equal(s(ready(mineOf('ready')), { status: 'error' }), 'unreadable');
  assert.equal(s(ready(mineOf('ready')), ready(moduleOf(undefined))), 'unavailable', 'no Google part: not offered on this venture');
  assert.equal(s(ready(mineOf('ready')), ready(moduleOf({ state: 'unreadable', reason: 'x' }))), 'unreadable');
  assert.equal(s(ready(mineOf('ready')), ready(moduleOf(PART))), 'section');
  assert.equal(chosenHere(mineOf('ready', [FILE, { ...FILE, module: 'pitch_deck' }]), '3').length, 1, 'only the data room’s files, by id as text or number');
});

test('revokedLine: what stopped, and that the copies stay', () => {
  assert.equal(revokedLine('google_not_connected', 1), 'Your Google account is no longer connected, so the file you chose is not read again. Copies already in the room stay.');
  assert.equal(revokedLine('workspace_not_allowed', 3), 'Google files are no longer allowed for your account, so the 3 files you chose are not read again. Copies already in the room stay.');
});

test('partlyOf and syncLine: counts only; a stopped sync is Partly synced with its reason', () => {
  assert.equal(partlyOf({ partly_synced: false, copies_added: 2 }, 2), null);
  assert.deepEqual(partlyOf({ partly_synced: true, copies_added: 1, files_unreadable: 1 }, 4), { read: 2, total: 4, reason: 'Google’s read limit was reached. Sync again in a moment to carry on.' });
  assert.match(partlyOf({ partly_synced: true, stopped: 'storage_full' }, 2).reason, /storage is full/);
  assert.match(partlyOf({ partly_synced: true, stopped: 'storage_not_configured' }, 2).reason, /not set up/);
  assert.equal(partlyOf({ partly_synced: true, copies_added: 5 }, 2).total, 5, 'never fewer files than were read');
  assert.equal(syncLine({ copies_added: 2, copies_replaced: 1, copies_unchanged: 3, copies_kept_deleted: 1, files_unreadable: 1 }),
    '2 copied into the room, 1 replaced by a newer version, 3 unchanged, 1 you deleted stayed deleted, 1 could not be read.');
  assert.equal(syncLine({ copies_added: 0 }), 'Nothing new in your Google files.');
  assert.equal(syncLine(null), '');
});

test('the gate, the cap and the copy rules are the Worker’s and stated as they are', () => {
  assert.match(COPY_ACCESS_LINE, /behind the NDA and private to you \(Nobody\) until you open it/);
  assert.match(COPY_ACCESS_LINE, /20 MB a copy/);
  const raise = readFileSync('cloudflare-worker/src/services/google/raise.ts', 'utf8');
  assert.match(raise, /COPY_ACCESS = \{ visibility: 'nda', access_tier: 'nobody' \}/, 'the copy really waits behind NDA, Nobody');
  assert.match(readFileSync('cloudflare-worker/src/services/google/workspace.ts', 'utf8'), /MAX_COPY_BYTES/);
  assert.match(readFileSync('cloudflare-worker/src/services/google/workspace.ts', 'utf8'), /20 \* 1024 \* 1024|20 MB/);
});

test('Upload: the stale "not added here yet" sentence is gone and the section is mounted once the room is read', () => {
  const src = readFileSync('frontend/src/pages/raise/dataroom/DataRoomUpload.jsx', 'utf8');
  assert.doesNotMatch(src, /not added here yet/);
  assert.match(src, /read\.status === 'ready' \? <DataRoomFromGoogle projectId=\{projectId\}/);
  assert.doesNotMatch(readFileSync('frontend/src/pages/raise/dataroom/DataRoomFromGoogle.jsx', 'utf8'), /fetch\(|request\(/, 'no new route: only the existing clients');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function fakeApi({ mine = mineOf('ready'), module = moduleOf(PART), sync = { ok: true, counts: { copies_added: 1, copies_unchanged: 0, partly_synced: false } }, files = { items: [FILE] }, mineFails = false, moduleFails = false } = {}) {
  const calls = [];
  const api = {
    googleWorkspace: {
      mine: async () => { calls.push('mine'); if (mineFails) throw Object.assign(new Error('x'), { status: 500 }); return mine; },
      files: async () => { calls.push('files'); return files; },
      pickerConfig: async () => ({ configured: false }),
      choose: async () => ({ added: 1 }),
    },
    cyclesApi: { module: async (cycle, project, slug) => { calls.push(`module:${cycle}:${project}:${slug}`); if (moduleFails) throw new Error('x'); return module; } },
    cyclesWrite: { raise: { googleSync: async (project) => { calls.push(`sync:${project}`); return sync; } } },
  };
  return { api, calls };
}

async function mount(api, { onCopied = () => {} } = {}) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  // FromGoogle reads `googleWorkspace.files` from its own import: route that through the same fake.
  const real = await import('../src/lib/api/googleWorkspace.js');
  const saved = { files: real.googleWorkspace.files, pickerConfig: real.googleWorkspace.pickerConfig };
  real.googleWorkspace.files = api.googleWorkspace.files;
  real.googleWorkspace.pickerConfig = api.googleWorkspace.pickerConfig;
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => root.render(h(MemoryRouter, null, h(DataRoomFromGoogle, { projectId: PROJECT, api, onCopied }))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => walk(container).filter((x) => props(x)['data-testid'] === id);
  const find = (id) => { const n = all(id)[0]; assert.ok(n, `no ${id}`); return n; };
  const click = async (id) => { await act(async () => { props(find(id)).onClick?.({ preventDefault() {} }); }); await flush(); };
  const retry = async () => {
    const b = walk(container).find((x) => String(x.nodeName || x.tagName || '').toUpperCase() === 'BUTTON' && /Retry|Try again/.test(text(x)));
    assert.ok(b, 'a Retry button');
    await act(async () => { props(b).onClick?.({ preventDefault() {} }); }); await flush();
  };
  return {
    text: () => text(container), all, find, click, retry, attr: (id, k) => find(id).getAttribute?.(k) ?? props(find(id))[k],
    done: async () => { await act(async () => root.unmount()); real.googleWorkspace.files = saved.files; real.googleWorkspace.pickerConfig = saved.pickerConfig; restore(); },
  };
}

test('not connected and nothing chosen: no From Google at all, and the module is never read', async () => {
  const { api, calls } = fakeApi({ mine: mineOf('google_not_connected', []) });
  const v = await mount(api);
  try {
    assert.equal(v.all('dataroom-google').length, 0);
    assert.doesNotMatch(v.text(), /From Google/);
    assert.deepEqual(calls, ['mine']);
  } finally { await v.done(); }
});

test('connected: the shared section with each copy "From Google Drive, as of <date>", the deleted note and the gate line', async () => {
  const { api, calls } = fakeApi();
  const v = await mount(api);
  try {
    assert.equal(v.attr('dataroom-google', 'data-state'), 'section');
    assert.ok(calls.includes(`module:raise:${PROJECT}:data-room`));
    assert.equal(v.attr('from-google', 'data-state'), 'ready');
    const t = v.text();
    assert.match(t, /Customer contracts\.pdf/);
    assert.match(t, /From Google Drive, as of 2026-11-12/);
    assert.match(t, /1 row you deleted stays deleted/);
    assert.match(v.text(), /behind the NDA and private to you \(Nobody\)/);
    assert.equal(v.all('from-google-delete-41').length, 0, 'a copy is removed from the room’s own list, not here');
  } finally { await v.done(); }
});

test('Sync copies once through the existing route, says what happened in counts, and refreshes storage', async () => {
  const { api, calls } = fakeApi();
  let copied = 0;
  const v = await mount(api, { onCopied: () => { copied += 1; } });
  try {
    await v.click('from-google-sync');
    assert.ok(calls.includes(`sync:${PROJECT}`));
    assert.equal(copied, 1, 'a new copy refreshes the storage line and marks the room changed');
    assert.match(v.find('dataroom-google-synced') && v.text(), /1 copied into the room\./);
  } finally { await v.done(); }
});

test('a sync that copies nothing new does not touch storage; a stopped one reads Partly synced', async () => {
  const { api } = fakeApi({ sync: { ok: true, counts: { copies_unchanged: 0, copies_kept_deleted: 1, partly_synced: true, stopped: 'storage_full' } } });
  let copied = 0;
  const v = await mount(api, { onCopied: () => { copied += 1; } });
  try {
    await v.click('from-google-sync');
    assert.equal(copied, 0);
    assert.equal(v.attr('from-google', 'data-state'), 'partly');
    assert.match(v.text(), /Partly synced: 1 of 1 rows read\./);
    assert.match(v.text(), /storage is full/);
    assert.match(v.text(), /1 you deleted stayed deleted/);
  } finally { await v.done(); }
});

test('revoked: chosen here but no longer connected reads as such, keeps the copies, and offers the Google page', async () => {
  const { api, calls } = fakeApi({ mine: mineOf('google_not_connected') });
  const v = await mount(api);
  try {
    assert.equal(v.attr('dataroom-google', 'data-state'), 'revoked');
    assert.match(v.text(), /no longer connected, so the file you chose is not read again\. Copies already in the room stay\./);
    assert.equal(v.attr('dataroom-google-reconnect', 'href'), '/account/connectors/google_workspace');
    assert.ok(!calls.some((c) => c.startsWith('module:') || c.startsWith('sync:')), 'nothing is read or synced');
  } finally { await v.done(); }
});

test('unreadable: a failed connection or module read says so, never "none", with Try again', async () => {
  for (const opts of [{ mineFails: true }, { moduleFails: true }, { module: moduleOf({ state: 'unreadable', reason: 'x' }) }]) {
    const { api, calls } = fakeApi(opts);
    const v = await mount(api);
    try {
      assert.equal(v.attr('dataroom-google', 'data-state'), 'unreadable', JSON.stringify(opts));
      assert.match(v.text(), /That is not the same as having none\./);
      assert.doesNotMatch(v.text(), /No Google files chosen/);
      const before = calls.filter((c) => c === 'mine').length;
      await v.retry();
      assert.ok(calls.filter((c) => c === 'mine').length > before, 'Retry reads again');
    } finally { await v.done(); }
  }
});

test('connected but this venture serves no Google part: nothing is offered', async () => {
  const { api } = fakeApi({ module: moduleOf(undefined) });
  const v = await mount(api);
  try { assert.equal(v.all('dataroom-google').length, 0); } finally { await v.done(); }
});
