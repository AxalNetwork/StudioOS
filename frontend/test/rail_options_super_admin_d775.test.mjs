/**
 * D775 (#2101) PR 1 — the Super Admin's boards draw the rail, and their
 * options are listed for D764.
 *
 * `frontend/src/lib/railOptions/superAdmin.js` is checked against the canvas
 * and against the code, both ways:
 *   · the boards are the canvas's H1–H37, in its order and under its names;
 *   · every board's files exist, and its rail file mounts a `<WorkerRail>`;
 *     a board with no rail yet says why, and really has none;
 *   · the seven rails this PR adds sit in `RailFrame`, named for their board;
 *   · every option exists where it says, in the folder's shape;
 *   · every model-running control in a board's files is a row, so a new one
 *     fails here until D764 is told about it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  SUPER_ADMIN_BOARDS, SUPER_ADMIN_PROFILE, SUPER_ADMIN_RAIL_OPTIONS, boardPage,
} from '../src/lib/railOptions/superAdmin.js';

const ROOT = process.cwd();
const src = (p) => resolve(ROOT, 'frontend/src', p);
const read = (p) => readFileSync(src(p), 'utf8');
const CANVAS = JSON.parse(readFileSync(resolve(ROOT, 'design/incoming/airail-every-page-data/canvas.json'), 'utf8'));
const KINDS = new Set(Object.values(CANVAS.task_kind));
const HANDLERS = new Set(['form', 'upload', 'draft', 'transcribe', 'none']);

/** The `<WorkerRail …>` tags in a file's code, with their `workspace` literal. */
function railMounts(file) {
  const code = codeOnly(read(file));
  return [...code.matchAll(/<WorkerRail\b([^>]*?)\/>/gs)].map((m) => ({
    tag: m[0],
    workspace: /\sworkspace="([^"]+)"/.exec(m[1])?.[1] ?? null,
  }));
}

test('the active boards preserve canvas IDs, excluding retired H21', () => {
  const profile = CANVAS.profiles[SUPER_ADMIN_PROFILE];
  const expected = Object.entries(profile).flatMap(([section, modules]) => [
    { section, module: null }, ...modules.map((module) => ({ section, module })),
  ]);
  assert.equal(expected.length, 37, 'the canvas no longer draws 37 Super Admin boards');
  // The owner's page removal retires H21; frozen canvas IDs never shift.
  const active = expected.map((b, i) => ({ ...b, id: `H${i + 1}` })).filter((b) => b.id !== 'H21');
  assert.deepEqual(SUPER_ADMIN_BOARDS.map(({ id, section, module }) => ({ id, section, module })), active);
});

test('every board\'s files exist, and its rail file mounts the rail', () => {
  for (const b of SUPER_ADMIN_BOARDS) {
    assert.ok(b.files.length > 0, `${b.id} names no file`);
    for (const f of b.files) assert.ok(existsSync(src(f)), `${b.id}: ${f} does not exist`);
    assert.match(b.route, /^\//, `${b.id} has no route`);
    if (b.rail) {
      assert.ok(existsSync(src(b.rail)), `${b.id}: ${b.rail} does not exist`);
      assert.ok(railMounts(b.rail).length > 0, `${b.id}: ${b.rail} mounts no <WorkerRail>`);
    } else {
      const reason = b.railAbsent || b.railPending;
      assert.ok(typeof reason === 'string' && reason.length > 20, `${b.id} has no rail and says not why`);
      for (const f of b.files) assert.equal(railMounts(f).length, 0, `${b.id} is listed as pending but ${f} mounts a rail`);
    }
  }
});

test('the seven rails this PR adds sit in RailFrame, named for their board', () => {
  const ADDED = { H1: 'pages/admin/AdminLicences.jsx', H19: 'pages/admin/ArticlesQueuePage.jsx', H20: 'pages/admin/PublicationsFrame.jsx', H25: 'pages/admin/AdminTeam.jsx', H31: 'pages/hq/CreditRulesRegistryPage.jsx', H33: 'pages/MonitoringPage.jsx', H34: 'pages/admin/AdminTelegram.jsx' };
  for (const [id, file] of Object.entries(ADDED)) {
    const board = SUPER_ADMIN_BOARDS.find((b) => b.id === id);
    assert.equal(board.rail, file, `${id}'s rail moved`);
    const name = board.module || board.section;
    const mounts = railMounts(file);
    assert.ok(mounts.length >= 1 && mounts.length <= 2, `${file}: ${mounts.length} rails`);
    for (const m of mounts) {
      assert.equal(m.workspace, name, `${file}: a rail is named "${m.workspace}", not the board's "${name}"`);
      assert.match(m.tag, /\srole="(super_admin|admin)"/, `${file}: a rail with no tier`);
    }
    // Two mounts are the viewer's tier, one of which renders: HQ's, or a plain admin's.
    if (mounts.length === 2) assert.ok(mounts.some((m) => /role="super_admin"/.test(m.tag)) && mounts.some((m) => /role="admin"/.test(m.tag)), `${file}: two rails of one tier`);
    assert.match(codeOnly(read(file)), /<RailFrame rail=\{rail\}/, `${file}: the rail is not in RailFrame`);
  }
  // Publications is one board on three routes, and each draws the shared frame.
  for (const f of ['pages/admin/Publications.jsx', 'pages/admin/PublicationNew.jsx', 'pages/admin/PublicationDetail.jsx']) {
    assert.match(codeOnly(read(f)), /<PublicationsFrame>/, `${f} no longer draws H20's frame`);
  }
});

test('every row is in the folder\'s shape and exists where it says', () => {
  const pages = new Map(SUPER_ADMIN_BOARDS.map((b) => [boardPage(b), b]));
  const seen = new Set();
  for (const o of SUPER_ADMIN_RAIL_OPTIONS) {
    const board = pages.get(o.page);
    assert.ok(board, `${o.key}: "${o.page}" is not a Super Admin board`);
    assert.match(o.key, /^[a-z]+:[a-z0-9]+(?:-[a-z0-9]+)*$/, `${o.key} is not <verb>:<object>`);
    assert.ok(!seen.has(`${o.page} ${o.key}`), `${o.key} twice on ${o.page}`);
    seen.add(`${o.page} ${o.key}`);
    assert.ok(o.label && o.label.trim() === o.label, `${o.key} has no label`);
    assert.ok(KINDS.has(o.kind), `${o.key}: "${o.kind}" is not one of the canvas's fourteen kinds`);
    assert.ok(HANDLERS.has(o.handler) && o.handler !== 'none', `${o.key}: handler "${o.handler}"`);
    assert.ok(board.files.includes(o.source.file), `${o.key}: ${o.source.file} is not one of ${board.id}'s files`);
    assert.equal(read(o.source.file).split(o.source.match).length - 1, 1, `${o.key}: ${o.source.match} is not exactly once in ${o.source.file}`);
  }
  assert.equal(KINDS.size, 14, 'the canvas no longer has fourteen kinds');
});

test('every model-running control on a Super Admin board is a row', () => {
  // A control that runs a model is a draft band or a draft call. Uploads that
  // only store a file are not rows (the folder's rule), so they are not found.
  const files = [...new Set(SUPER_ADMIN_BOARDS.flatMap((b) => b.files))];
  const listed = new Set(SUPER_ADMIN_RAIL_OPTIONS.map((o) => `${o.source.file}|${o.source.match}`));
  const found = [];
  for (const f of files) {
    const code = codeOnly(read(f));
    for (const m of code.matchAll(/<ZoneDraft\b[^>]*?\bsurface="([^"]+)"/gs)) found.push(`${f}|surface="${m[1]}"`);
    for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*\.draft)\(/g)) found.push(`${f}|${m[1]}(`);
  }
  assert.deepEqual(found.filter((k) => !listed.has(k)), [], 'these model-running controls are on a Super Admin board and not in railOptions/superAdmin.js');
  assert.deepEqual([...listed].filter((k) => !found.includes(k)), [], 'these rows match no control');
});

test('the one row reaches the model: the worker route runs the router', () => {
  assert.deepEqual(SUPER_ADMIN_RAIL_OPTIONS.map((o) => `${o.page} ${o.key}`), ['Super Admin · Content · Publications draft:publication-summary']);
  const route = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/admin_publications.ts'), 'utf8');
  assert.match(route, /draftSummary/, 'the publications draft no longer calls draftSummary');
});
