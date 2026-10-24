/**
 * D774 (#2100) PR 1 — the Admin's boards draw the rail, and their options
 * are listed for D764.
 *
 * `frontend/src/lib/railOptions/admin.js` is checked against the canvas and
 * against the code, both ways:
 *   · the boards are the canvas's S1–S39, in its order and under its names;
 *   · every board's files exist, and its rail file mounts a `<WorkerRail>`;
 *     a board with no rail says why, is in `NO_RAIL_ROUTES`, and really has
 *     none;
 *   · the boards with a page of their own sit in `AdminBoardFrame` under
 *     their name, and that frame is a `RailFrame` with the viewer's tier;
 *   · `/admin` draws that frame once around its tabs, each tab named for the
 *     board D768's map gives it, for the Admin's boards and the Super Admin's
 *     alike, and its Spin-Out Lab tab draws none (D317);
 *   · every option exists where it says, in the shape #2097 gives, and a
 *     control that runs no model is a quiet control with its reason;
 *   · every upload, draft or report control in a board's files is in one
 *     list or the other, so a new control fails here until D764 is told.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_options_admin_d774.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { codeOnly } from './_codeOnly.mjs';
import { mountContracts } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { ADMIN_BOARDS, ADMIN_OPTIONS, ADMIN_PROFILE, ADMIN_QUIET_CONTROLS, railOptionsFor } from '../src/lib/railOptions/admin.js';
import { SUPER_ADMIN_BOARDS } from '../src/lib/railOptions/superAdmin.js';
import { NO_RAIL_ROUTES } from '../src/lib/railPages.js';
import AdminPage, { tabBoard } from '../src/pages/AdminPage.jsx';

const ROOT = process.cwd();
const src = (p) => resolve(ROOT, 'frontend/src', p);
const read = (p) => readFileSync(src(p), 'utf8');
const CANVAS = JSON.parse(readFileSync(resolve(ROOT, 'design/incoming/airail-every-page-data/canvas.json'), 'utf8'));
const KINDS = new Set(Object.values(CANVAS.task_kind));
const HANDLERS = new Set(['form', 'upload', 'draft', 'transcribe']);
const FRAME = 'pages/admin/AdminBoardFrame.jsx';
const ADMIN_PAGE = 'pages/AdminPage.jsx';

/** The `<WorkerRail …/>` tags in a file's code. */
const railMounts = (file) => [...codeOnly(read(file)).matchAll(/<WorkerRail\b[^>]*?\/>/gs)].map((m) => m[0]);

/** The `<AdminBoardFrame …>` tags in a file's code, with their `workspace` literal. */
const frames = (file) => [...codeOnly(read(file)).matchAll(/<AdminBoardFrame\b([^>]*)>/gs)]
  .map((m) => /\sworkspace="([^"]+)"/.exec(m[1])?.[1] ?? null);

/** The 1-based lines of a file on which `needle` starts. */
function linesOf(file, needle) {
  const text = read(file);
  const out = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) out.push(text.slice(0, at).split('\n').length);
  return out;
}

const nameOf = (b) => b.module || b.section;
const byId = (id) => ADMIN_BOARDS.find((b) => b.id === id);

test('the active boards preserve canvas IDs, excluding retired S22', () => {
  const profile = CANVAS.profiles[ADMIN_PROFILE];
  const expected = Object.entries(profile).flatMap(([section, modules]) => [
    { section, module: null }, ...modules.map((module) => ({ section, module })),
  ]);
  assert.equal(expected.length, 39, 'the canvas no longer draws 39 Admin boards');
  // The owner's page removal retires S22; frozen canvas IDs never shift.
  const active = expected.map((b, i) => ({ ...b, id: `S${i + 1}` })).filter((b) => b.id !== 'S22');
  assert.deepEqual(ADMIN_BOARDS.map(({ id, section, module }) => ({ id, section, module })), active);
});

test('every board\'s files exist, and its rail file mounts the rail', () => {
  for (const b of ADMIN_BOARDS) {
    assert.ok(b.files.length > 0, `${b.id} names no file`);
    for (const f of b.files) assert.ok(existsSync(src(f)), `${b.id}: ${f} does not exist`);
    assert.match(b.route, /^\//, `${b.id} has no route`);
    if (b.rail) {
      assert.ok(existsSync(src(b.rail)), `${b.id}: ${b.rail} does not exist`);
      assert.ok(railMounts(b.rail).length > 0, `${b.id}: ${b.rail} mounts no <WorkerRail>`);
    } else {
      assert.ok(typeof b.noRail === 'string' && b.noRail.length > 20, `${b.id} has no rail and says not why`);
      assert.ok(NO_RAIL_ROUTES.some((n) => n.route === b.route && n.roles.includes('admin')), `${b.id}: ${b.route} is not in NO_RAIL_ROUTES`);
      for (const f of b.files) {
        assert.equal(railMounts(f).length, 0, `${b.id} has no rail but ${f} mounts one`);
        assert.equal(frames(f).length, 0, `${b.id} has no rail but ${f} draws the Admin frame`);
      }
    }
  }
});

test('a board on a shared route names the board that owns it, which the canvas lists first', () => {
  for (const b of ADMIN_BOARDS.filter((x) => x.alias)) {
    const owner = byId(b.alias);
    assert.ok(owner, `${b.id}: no board ${b.alias}`);
    assert.ok(ADMIN_BOARDS.indexOf(owner) < ADMIN_BOARDS.indexOf(b), `${b.id}: its owner ${owner.id} comes after it`);
    assert.ok(!owner.alias, `${b.id}: ${owner.id} is an alias itself`);
    assert.equal(b.route.split('?')[0], owner.route.split('?')[0], `${b.id} and ${owner.id} are not on one route`);
    assert.deepEqual(b.files, owner.files);
    assert.equal(b.rail, owner.rail);
  }
});

test('the boards with a page of their own sit in AdminBoardFrame under their own name', () => {
  const framed = ADMIN_BOARDS.filter((b) => b.rail === FRAME && !b.alias && !b.host);
  // D953 (#2371): S19, the Programs catalogue, left HeldZone for the frame.
  assert.deepEqual(framed.map((b) => b.id), ['S3', 'S4', 'S8', 'S9', 'S10', 'S11', 'S15', 'S16', 'S17', 'S18', 'S19', 'S23', 'S31', 'S39']);
  for (const b of framed) {
    for (const f of b.files) {
      assert.deepEqual(frames(f), [nameOf(b)], `${f}: the frame is not named "${nameOf(b)}", once`);
      // The frame is the page's outermost element: the default export is only the frame around the page.
      assert.match(codeOnly(read(f)), /export default function \w+\(\) \{\s*return \(\s*<AdminBoardFrame\b/, `${f}: the frame is not the page's outermost element`);
    }
  }
});

test('/admin draws the frame once around its tabs, each named for its board in D768\'s map', () => {
  // Every board on an /admin tab, of either profile, is hosted by AdminPage.
  const tabbed = [...ADMIN_BOARDS.map((b) => ['admin', b]), ...SUPER_ADMIN_BOARDS.map((b) => ['super_admin', b])]
    .filter(([, b]) => b.route.startsWith('/admin?tab='));
  // H27 and H28 left with the keys for HQ's own page (the owner's ruling, 2026-10-20);
  // S29 and H23 for Advisors & Partners' own page (D972, #2369).
  assert.deepEqual(tabbed.map(([, b]) => b.id), ['S2', 'S6', 'S7', 'S28', 'S30', 'H11', 'H22', 'H24', 'H29', 'H30']);
  const code = codeOnly(read(ADMIN_PAGE));
  for (const [role, b] of tabbed) {
    assert.equal(b.host, ADMIN_PAGE, `${b.id} is not hosted by AdminPage`);
    assert.equal(b.rail, FRAME, `${b.id} does not draw the Admin frame`);
    const tab = new URLSearchParams(b.route.split('?')[1]).get('tab');
    assert.match(code, new RegExp(`\\{ value: '${tab}',`), `${b.id}: ${tab} is not one of AdminPage's sections`);
    assert.equal(tabBoard(tab, role), b.module || b.section, `${b.id}: /admin?tab=${tab} is not named for its board`);
  }
  // One frame, named from the tab, around the whole page unless a host locked it to one section.
  assert.equal([...code.matchAll(/<AdminBoardFrame\b/g)].length, 1, 'AdminPage draws the frame more than once');
  assert.match(code, /const board = section \? null : tabBoard\(tab, isSuperAdminUser\(user\) \? 'super_admin' : user\?\.role\);/,
    'the board is not the open tab\'s, in the viewer\'s tier');
  assert.match(code, /if \(!board\) return page;\s*return \(\s*<AdminBoardFrame workspace=\{board\} [^>]*data-testid="admin-tab-frame">\s*\{page\}\s*<\/AdminBoardFrame>/,
    'the frame is not the outermost element around the whole page');
  // Off-canvas tabs and the Lab retain D775's page-alone contract.
  for (const role of ['admin', 'super_admin']) {
    assert.equal(tabBoard('billing', role), null);
    assert.equal(tabBoard('bank-accounts', role), null);
    assert.equal(tabBoard('lab-applications', role), null);
  }
});

test('on /admin a plain admin and a Super Admin each get the rail of their tier, named for the tab\'s board; the Lab tab gets none', async () => {
  const fetchWas = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  const CASES = [
    [{ id: 902, role: 'admin', is_super_admin: 0 }, '/admin?tab=kyc', 'admin-board-rail', 'Identity checks'],
    [{ id: 902, role: 'admin', is_super_admin: 0 }, '/admin', 'admin-board-rail', 'Users'],
    [{ id: 901, role: 'admin', is_super_admin: 1 }, '/admin?tab=personas', 'hq-board-rail', 'Personas'],
    [{ id: 902, role: 'admin', is_super_admin: 0 }, '/admin?tab=lab-applications', null, null],
  ];
  try {
    for (const [user, url, rail, name] of CASES) {
      const v = await mountContracts(React.createElement(AuthProvider, null, React.createElement(AdminPage)), url, user);
      try {
        await v.flush();
        const tagged = (id) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === id);
        assert.equal(tagged('admin-tab-frame').length, rail ? 1 : 0, `${url}: wrong frame count`);
        const rails = v.nodes().filter((n) => /^(admin|hq)-board-rail$/.test(v.props(n)?.['data-testid'] || ''));
        if (!rail) { assert.equal(rails.length, 0, `${url}: the Spin-Out Lab tab draws a rail`); continue; }
        assert.equal(rails.length, 1, `${url}: ${rails.length} rails`);
        assert.equal(v.props(rails[0])['data-testid'], rail, `${url}: the rail is not the viewer's tier`);
        assert.equal(v.props(rails[0])['aria-label'], `Eadwyn AI · ${name}`, `${url}: the rail is not named for its board`);
      } finally { await v.unmount(); }
    }
  } finally { globalThis.fetch = fetchWas; }
});

test('the frame is a RailFrame whose rail takes the viewer\'s tier, and none outside it', () => {
  const code = codeOnly(read(FRAME));
  const mounts = railMounts(FRAME);
  assert.equal(mounts.length, 2, 'one rail for each admin tier');
  assert.ok(mounts.some((m) => /\srole="super_admin"/.test(m)) && mounts.some((m) => /\srole="admin"/.test(m)), 'the two rails are not HQ\'s and an admin\'s');
  for (const m of mounts) assert.match(m, /\sworkspace=\{workspace\}/, 'a rail not named for its board');
  assert.match(code, /if \(isSuperAdminUser\(user\)\)/, 'a Super Admin does not get HQ\'s rail');
  assert.match(code, /else if \(user\?\.role === 'admin'\)/, 'the admin\'s rail is not limited to the admin tier');
  assert.match(code, /<RailFrame rail=\{rail\}/, 'the rail is not in RailFrame');
});

test('every option is in #2097\'s shape and exists where it says', () => {
  const seen = new Set();
  for (const o of ADMIN_OPTIONS) {
    const board = byId(o.page);
    assert.ok(board, `${o.key}: no board ${o.page}`);
    assert.ok(!board.alias, `${o.key}: ${o.page} is an alias; list the option on ${board.alias}`);
    assert.match(o.key, /^[a-z]+:[a-z0-9-]+(\/[a-z0-9-]+)*$/, `${o.key} is not <verb>:<object>`);
    assert.ok(!seen.has(`${o.page} ${o.key}`), `${o.key} twice on ${o.page}`);
    seen.add(`${o.page} ${o.key}`);
    assert.ok(o.label && o.label.trim() === o.label, `${o.key} has no label`);
    assert.ok(KINDS.has(o.kind), `${o.key}: "${o.kind}" is not one of the canvas's fourteen kinds`);
    assert.ok(HANDLERS.has(o.handler), `${o.key}: handler "${o.handler}"`);
    assert.ok(board.files.includes(o.file), `${o.key}: ${o.file} is not one of ${o.page}'s files`);
    assert.equal(linesOf(o.file, o.anchor).length, 1, `${o.key}: its anchor is not exactly once in ${o.file}`);
    assert.ok(linesOf(o.file, o.label).length >= 1 || o.key.startsWith('upload:'), `${o.key}: "${o.label}" is not on the page`);
  }
  assert.equal(KINDS.size, 14, 'the canvas no longer has fourteen kinds');
  for (const q of ADMIN_QUIET_CONTROLS) {
    const board = byId(q.page);
    assert.ok(board && !board.alias, `${q.label}: no owning board ${q.page}`);
    assert.ok(board.files.includes(q.file), `${q.label}: ${q.file} is not one of ${q.page}'s files`);
    assert.equal(linesOf(q.file, q.anchor).length, 1, `${q.label}: its anchor is not exactly once in ${q.file}`);
    assert.ok(linesOf(q.file, q.label).length >= 1 || /upload/i.test(q.label), `${q.label} is not on the page`);
    assert.ok(typeof q.why === 'string' && q.why.length > 20, `${q.label} says not why it runs no model`);
  }
});

test('every upload, draft or report control in a board\'s files is listed', () => {
  // A control is a file input, a draft call or a report call. Each is matched
  // to the option whose anchor sits within a few lines of it.
  const CONTROLS = ['type="file"', '.draft(', 'dd.generateReport('];
  const files = [...new Set(ADMIN_BOARDS.flatMap((b) => b.files))];
  const unlisted = [];
  const matched = new Set();
  for (const f of files) {
    const options = [...ADMIN_OPTIONS, ...ADMIN_QUIET_CONTROLS].filter((o) => o.file === f).map((o) => ({ o, line: linesOf(f, o.anchor)[0] }));
    const lines = [...new Set(CONTROLS.flatMap((c) => linesOf(f, c)))];
    for (const line of lines) {
      const hit = options.find(({ line: at }) => Math.abs(at - line) <= 6);
      if (hit) matched.add(hit.o); else unlisted.push(`${f}:${line}`);
    }
  }
  assert.deepEqual(unlisted, [], 'these controls are on an Admin board and not in railOptions/admin.js');
  assert.deepEqual([...ADMIN_OPTIONS, ...ADMIN_QUIET_CONTROLS].filter((o) => !matched.has(o)).map((o) => o.key || o.label), [], 'these rows match no control');
});

test('the rail lists no option, because none of them runs a model today', () => {
  assert.deepEqual(ADMIN_OPTIONS, []);
  for (const b of ADMIN_BOARDS) assert.deepEqual(railOptionsFor(b.id), [], `${b.id} lists an option`);
  // Due diligence's report is read from the case's recorded sections and findings, not written by a model.
  const dd = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/dd.ts'), 'utf8');
  const report = dd.slice(dd.indexOf("dd.post('/cases/:uid/report'"), dd.indexOf("dd.post('/cases/:uid/report/share'"));
  assert.ok(report.length > 0, 'the report route moved');
  assert.doesNotMatch(report, /\.run\(|env\.AI\b|aiRun|runModel/, 'the report route now calls a model: make it an option');
});
