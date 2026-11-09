/**
 * D5074 (#5074) — the canonical venture context and the Data room on it.
 *
 *   · every alias an address may carry (`?project_id=N`, legacy `?project=N`,
 *     a project UID in either key) resolves to the same context: `projectId`,
 *     `projectUid`, the project record and its company's identity;
 *   · a generated link uses one form, `?project_id=N`; a legacy address is
 *     replaced with it, every other query key and the hash kept, on the page;
 *   · the Data room reads its venture from that context only: no tool file
 *     parses the query or looks the UID up in the projects list itself;
 *   · the Data room draws its controls from the room read's `capabilities`
 *     (the Worker's map, `_data_room_capabilities.mjs`), never from `role`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/venture_context_5074.test.mjs
 */
import './_cycleSteps.mjs'; // D4574 (#4574, H5): CycleRoute's lazy steps, loaded before it mounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute, { useProject } from '../src/pages/cycles/CycleRoute.jsx';
import { VentureProvider, useVenture } from '../src/pages/cycles/VentureContext.jsx';
import {
  VENTURE_PARAM, canonicalVentureSearch, legacyVentureRedirect, resolveVenture, ventureOf, ventureRef, ventureSearch,
} from '../src/pages/cycles/ventureQuery.js';
import { roomCan, tabHref, tabSearch, TABS } from '../src/pages/raise/dataroom/dataRoomModel.js';
import DataRoomAccess from '../src/pages/raise/dataroom/DataRoomAccess.jsx';
import DataRoomFiles from '../src/pages/raise/dataroom/DataRoomFiles.jsx';
import DataRoomFile from '../src/pages/raise/dataroom/DataRoomFile.jsx';
import FolderLightbox from '../src/pages/raise/dataroom/DataRoomFolders.jsx';
import DataRoomDeckSource from '../src/pages/raise/dataroom/DataRoomDeckSource.jsx';
import DataRoomActivity from '../src/pages/raise/dataroom/DataRoomActivity.jsx';
import { api } from '../src/lib/api.js';
import { ROOM_CAPS } from './_data_room_capabilities.mjs';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const PROJECTS = [
  { id: 3, uid: 'p3uid', name: 'Harbor Ledger', company_id: 12, founder_id: 100 },
  { id: 4, uid: 'p4uid', name: 'Other', company_id: null, founder_id: 101 },
];

/* ------------------------------------------------------------------ *
 * The rules
 * ------------------------------------------------------------------ */

test('every alias names the same venture, and resolves to the same context', () => {
  const want = { projectId: 3, projectUid: 'p3uid', project: PROJECTS[0], company: { id: 12, founderId: 100, name: 'Harbor Ledger' } };
  for (const q of ['?project_id=3', '?project=3', '?project=p3uid', '?project_id=p3uid', 'project=3&x=1', '?x=1&project_id=3&project=9']) {
    assert.deepEqual(resolveVenture(PROJECTS, ventureRef(q)), want, q);
  }
  assert.deepEqual(resolveVenture({ items: PROJECTS }, { id: '3' }), want, 'a paged list too');
  assert.deepEqual(ventureOf(PROJECTS[0]), want);
  assert.deepEqual(ventureRef('?project_id=3'), { id: 3, uid: null, key: 'project_id', legacy: false });
  assert.deepEqual(ventureRef('?project=3'), { id: 3, uid: null, key: 'project', legacy: true });
  assert.deepEqual(ventureRef('?project=p3uid'), { id: null, uid: 'p3uid', key: 'project', legacy: true });
  assert.deepEqual(ventureRef('?project_id=p3uid'), { id: null, uid: 'p3uid', key: 'project_id', legacy: true }, 'a UID is never the canonical form');
  for (const q of ['', '?project_id=0', '?project_id=-3', '?project=a b', '?project=..', '?project=<x>', '?x=3']) assert.equal(ventureRef(q), null, q);
  assert.equal(resolveVenture(PROJECTS, ventureRef('?project=1e3')), null, 'not a number: a UID nobody has');
  assert.equal(resolveVenture(PROJECTS, { id: 9 }), null, 'a venture not in the list is no context');
  assert.equal(resolveVenture(PROJECTS, { id: null, uid: 'nope' }), null);
});

test('generated links carry one form; the canonical query keeps every other key', () => {
  assert.equal(VENTURE_PARAM, 'project_id');
  assert.equal(ventureSearch(3), '?project_id=3');
  assert.equal(ventureSearch('3'), '?project_id=3');
  for (const bad of [null, undefined, '', 0, 'p3uid']) assert.equal(ventureSearch(bad), '', String(bad));
  assert.equal(canonicalVentureSearch('?project=3&version=2', 3), '?version=2&project_id=3');
  assert.equal(canonicalVentureSearch('?a=1&project_id=p3uid&b=2', 3), '?a=1&project_id=3&b=2', 'in place when it was there');
  assert.equal(canonicalVentureSearch('?project=3&project_id=3', 3), '?project_id=3', 'never both');
  // The Data room's tabs: the venture only, in the one form, from any alias.
  for (const q of ['?project_id=3&version=2', '?project=3&mode=workspace#x']) assert.equal(tabSearch(q), '?project_id=3', q);
  for (const t of TABS) assert.match(tabHref(t, '?project=3'), /\?project_id=3$/, t.id);
});

test('a legacy address is redirected to the canonical one with its query and hash; a canonical one is left alone', () => {
  const at = (search, hash = '#files') => ({ pathname: '/raise/data-room/files', search, hash });
  assert.deepEqual(legacyVentureRedirect(at('?project=3&version=2'), 3), { pathname: '/raise/data-room/files', search: '?version=2&project_id=3', hash: '#files' });
  assert.deepEqual(legacyVentureRedirect(at('?project=p3uid&tab=x'), 3), { pathname: '/raise/data-room/files', search: '?tab=x&project_id=3', hash: '#files' });
  assert.deepEqual(legacyVentureRedirect(at('?project_id=p3uid'), 3), { pathname: '/raise/data-room/files', search: '?project_id=3', hash: '#files' });
  assert.deepEqual(legacyVentureRedirect(at('?project_id=3&project=9', ''), 3), { pathname: '/raise/data-room/files', search: '?project_id=3', hash: '' });
  assert.equal(legacyVentureRedirect(at('?project_id=3&version=2'), 3), null, 'canonical already');
  assert.equal(legacyVentureRedirect(at('?project=3'), null), null, 'not before the venture is known');
  assert.equal(legacyVentureRedirect(at('?project=4'), 3), null, 'never onto a venture the address did not name');
});

/* ------------------------------------------------------------------ *
 * The route helper and the provider, mounted
 * ------------------------------------------------------------------ */

function Where() { const l = useLocation(); return h('i', { 'data-testid': 'where' }, `${l.pathname}${l.search}${l.hash}`); }

async function mount(el) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  const ids = () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean);
  return { by, text: (id) => txt(by(id)), all: () => txt(container), ids, settle, async unmount() { await act(async () => root.unmount()); restore(); } };
}

function Probe() {
  const { projectId, status } = useProject();
  return h(VentureProvider, { projectId, status }, h(Ctx));
}
function Ctx() {
  const v = useVenture();
  return h('b', { 'data-testid': 'ctx' }, JSON.stringify({ projectId: v.projectId, projectUid: v.projectUid, company: v.company, status: v.status, name: v.project?.name ?? null }));
}

test('useProject: each alias lands on the canonical address, query and hash kept, and the provider gives one context', async () => {
  const saved = api.listProjects;
  api.listProjects = async () => PROJECTS;
  const want = { projectId: 3, projectUid: 'p3uid', company: { id: 12, founderId: 100, name: 'Harbor Ledger' }, status: 'ready', name: 'Harbor Ledger' };
  try {
    for (const [entry, landed] of [
      ['/raise/data-room/files?project_id=3&version=2#top', '/raise/data-room/files?project_id=3&version=2#top'],
      ['/raise/data-room/files?project=3&version=2#top', '/raise/data-room/files?version=2&project_id=3#top'],
      ['/raise/data-room/files?project=p3uid&version=2#top', '/raise/data-room/files?version=2&project_id=3#top'],
      ['/raise/data-room/files?version=2&project_id=p3uid#top', '/raise/data-room/files?version=2&project_id=3#top'],
    ]) {
      const m = await mount(h(MemoryRouter, { initialEntries: [entry] }, h(Probe), h(Where)));
      try {
        assert.equal(m.text('where'), landed, entry);
        assert.deepEqual(JSON.parse(m.text('ctx')), want, entry);
      } finally { await m.unmount(); }
    }
  } finally { api.listProjects = saved; }
});

test('the provider reads the projects list only when a tool asks, and a failed list is unreadable, never a venture', async () => {
  const saved = api.listProjects;
  let lists = 0;
  api.listProjects = async () => { lists += 1; return PROJECTS; };
  try {
    const quiet = await mount(h(MemoryRouter, null, h(VentureProvider, { projectId: 3 }, h('i', null, 'no tool'))));
    await quiet.unmount();
    assert.equal(lists, 0, 'no tool asked, so no read');
    const missing = await mount(h(MemoryRouter, null, h(VentureProvider, { projectId: 9 }, h(Ctx))));
    try { assert.equal(JSON.parse(missing.text('ctx')).status, 'missing'); } finally { await missing.unmount(); }
    api.listProjects = async () => { throw Object.assign(new Error('down'), { status: 500 }); };
    const down = await mount(h(MemoryRouter, null, h(VentureProvider, { projectId: 3 }, h(Ctx))));
    try { assert.deepEqual(JSON.parse(down.text('ctx')), { projectId: 3, projectUid: null, company: null, status: 'unreadable', name: null }); } finally { await down.unmount(); }
  } finally { api.listProjects = saved; }
});

/* ------------------------------------------------------------------ *
 * The Data room on the context
 * ------------------------------------------------------------------ */

const ROOM = (caps, role = 'owner') => ({
  project: { uid: 'p3uid', name: 'Harbor Ledger' }, role, capabilities: caps,
  folders: [{ id: 1, uid: 'f1', name: 'Financials', parent_id: null, visibility: 'open' }],
  files: [{ id: 11, uid: 'a1', name: 'Model.xlsx', folder_id: 1, visibility: 'open', access_tier: 'invited', downloads: 0, deck_source: false }],
  grants: [{ uid: 'g1', status: 'active', created_at: '2026-10-01', expires_at: null, investor_name: 'Bluefern Capital', investor_email: 'a@bluefern.example', nda_signed: false, nda_pending: false, committed: false, folders: null }],
  report_shares: [], recent_access: [], week: { opened: 0, downloaded: 0, blocked: 0 }, deck_sources_available: true,
});

test('mounted: an old `?project=<uid>` Data room address reads the room for that venture and lands on `?project_id=`', async () => {
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => {
    const url = String(u); requests.push(url);
    if (/\/data-room\/p3uid(\?|$)/.test(url)) return response(ROOM(ROOM_CAPS.owner));
    if (/\/api\/projects(\?|$)/.test(url)) return response(PROJECTS);
    if (url.includes('/cycles/raise/modules/')) return response({ module: { slug: 'data-room', name: 'Data room' }, card: { state: 'empty' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } });
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  try {
    const m = await mount(h(MemoryRouter, { initialEntries: ['/raise/data-room/files?project=p3uid#top'] }, h(Routes, null,
      h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
    ), h(Where)));
    try {
      assert.equal(m.text('where'), '/raise/data-room/files?project_id=3#top');
      assert.ok(requests.some((u) => /\/data-room\/p3uid$/.test(u)), 'the room is read by the context’s uid');
      assert.ok(m.ids().includes('dataroom-files-page') && m.ids().includes('dataroom-upload'));
    } finally { await m.unmount(); }
  } finally { Object.assign(globalThis, previous); }
});

test('the Data room parses no query and looks no UID up itself: the shared context is its only venture', () => {
  const dir = 'frontend/src/pages/raise/dataroom';
  for (const f of readdirSync(dir).filter((x) => /\.(jsx?|mjs)$/.test(x))) {
    const src = read(`${dir}/${f}`);
    assert.doesNotMatch(src, /project_id=\(|\[\?&\]project|get\('project(_id)?'\)/, `${f} parses the venture from the query`);
    assert.doesNotMatch(src, /listProjects|projectUidOf|project_uid/, `${f} looks the venture's uid up itself`);
  }
  const tool = read(`${dir}/DataRoomTool.jsx`);
  assert.match(tool, /const venture = useVenture\(\);/, 'Home asks the context');
  assert.match(tool, /useRoom\(useVenture\(projectId\), reload\)/, 'the tab pages ask the context');
  assert.match(read(`${dir}/DataRoomUpload.jsx`), /const venture = useVenture\(projectId\);/, 'Upload asks the context');
  // The model's tab query is the shared helper's.
  assert.match(read(`${dir}/dataRoomModel.js`), /return ventureSearch\(ventureRef\(search\)\?\.id\);/);
});

/* ------------------------------------------------------------------ *
 * Controls from capabilities, never the role
 * ------------------------------------------------------------------ */

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const has = (out, id) => new RegExp(`data-testid="${id}"`).test(out);
const disabled = (out, id) => new RegExp(`<[^>]*disabled=""[^>]*data-testid="${id}"|<[^>]*data-testid="${id}"[^>]*disabled=""`).test(out);

test('roomCan reads the map only: no map, an unknown key or a non-true value allows nothing', () => {
  assert.equal(roomCan(ROOM(ROOM_CAPS.owner), 'share'), true);
  assert.equal(roomCan(ROOM(ROOM_CAPS.cofounder), 'share'), false);
  assert.equal(roomCan({ role: 'owner' }, 'share'), false, 'a role without a map is no permission');
  assert.equal(roomCan(ROOM({ share: 'yes' }), 'share'), false);
  assert.equal(roomCan(ROOM(ROOM_CAPS.owner), 'fly'), false);
  assert.equal(roomCan(null, 'share'), false);
});

for (const [who, caps, role] of [
  ['the founder (owner)', ROOM_CAPS.owner, 'owner'],
  ['an accepted co-founder', ROOM_CAPS.cofounder, 'cofounder'],
  ['the support read', ROOM_CAPS.support, 'support'],
  // The role is a label: a map that disagrees with it wins, both ways.
  ['a co-founder label with the owner’s map', ROOM_CAPS.owner, 'cofounder'],
  ['an owner label with the co-founder’s map', ROOM_CAPS.cofounder, 'owner'],
]) {
  test(`${who}: every control is drawn exactly when the capabilities allow it`, () => {
    const room = ROOM(caps, role);
    const access = html(h(DataRoomAccess, { room, projectUid: 'p3uid', reload() {} }));
    assert.equal(has(access, 'access-share'), caps.share, 'Share');
    assert.equal(has(access, 'access-cofounder'), !caps.share, 'the co-founder line');
    assert.equal(has(access, 'access-advisor-grants'), caps.share, 'advisor grants');
    assert.equal(has(access, 'nda-send-g1'), caps.send_nda, 'Send the NDA');

    const files = html(h(DataRoomFiles, { room, projectUid: 'p3uid', projectId: 3, reload() {}, search: '?project_id=3' }));
    assert.equal(has(files, 'dataroom-upload'), caps.upload, 'Upload');
    assert.equal(has(files, 'dataroom-new-folder'), caps.edit, 'New folder');

    const folder = html(h(FolderLightbox, { room, uid: 'f1', projectUid: 'p3uid', onClose() {}, onDone() {} }));
    assert.equal(has(folder, 'dataroom-folder-delete-open'), caps.delete_folder, 'Delete folder');
    assert.equal(has(folder, 'dataroom-folder-rename-open'), caps.edit, 'Rename folder');
    assert.equal(disabled(folder, 'dataroom-folder-nda-switch'), !caps.set_gate, 'the folder gate');

    const file = html(h(DataRoomFile, { fileId: 11, room, projectUid: 'p3uid', projectId: 3, onClose() {}, onChanged() {} }));
    assert.equal(has(file, 'dataroom-file-download'), caps.download, 'Download');
    assert.equal(has(file, 'dataroom-file-move-open'), caps.edit, 'Move');
    assert.equal(has(file, 'dataroom-file-rename-open'), caps.edit, 'Rename');
    assert.equal(disabled(file, 'dataroom-file-remove-open'), !caps.delete, 'Remove');
    assert.equal(disabled(file, 'dataroom-file-nda'), false, 'the input itself is not disabled; its fieldset is');
    assert.equal(/<fieldset[^>]*disabled=""/.test(file), !caps.set_gate, 'the file gate');

    const deck = html(h(DataRoomDeckSource, { room, file: room.files[0], projectUid: 'p3uid', onChanged() {} }));
    assert.equal(disabled(deck, 'dataroom-deck-source-toggle'), !caps.deck_source, 'deck source');

    const activity = html(h(DataRoomActivity, { projectUid: 'p3uid', canExport: roomCan(room, 'export') }));
    assert.equal(has(activity, 'dataroom-activity-export'), caps.export, 'Export (CSV)');
  });
}

test('no Data room control reads the role any more', () => {
  const dir = 'frontend/src/pages/raise/dataroom';
  for (const f of readdirSync(dir).filter((x) => /\.(jsx?|mjs)$/.test(x))) {
    assert.doesNotMatch(read(`${dir}/${f}`), /\.role\s*[!=]==\s*'(owner|cofounder|support)'|isOwner\(/, `${f} decides a control from the role`);
  }
  assert.match(read('frontend/src/pages/raise/dataroom/DataRoomTool.jsx'), /canExport=\{roomCan\(read\.room, 'export'\)\}/);
});
