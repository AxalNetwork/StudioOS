/**
 * D510 — the Friday retro band, and a band's run recorded against its page.
 *
 * The Worker half — what `build/retro` hands the model, that it reads only the
 * caller's own board, and that every run's usage row carries the page — is
 * `cloudflare-worker/test/founder_draft_surfaces.test.ts`. The desk's mount and
 * its place in the cadence card are pinned in `founder_build_overview_a3`, and
 * the switch sentence naming it in `validate_fills_the_blanks`. This file holds
 * the client half of the attribution:
 *
 *   - the band reads its page the way the rail does, so the rail's
 *     "This page this month" lookup matches the row the run wrote (D404);
 *   - `zoneDraftRun` sends that page, through the real `request()`, and sends
 *     nothing when there is none rather than a placeholder;
 *   - the page is read when the run is pressed, never on mount, so the read
 *     that loads a band still spends nothing.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_retro_d510.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { api } from '../src/lib/api.js';
import { bandPage } from '../src/workspaces/ZoneDraft.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// `request()` reads the auth token, the active company and the CSRF cookie on
// its way out. Signed out, no company, no cookie.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document ??= { cookie: '' };

/** Runs `fn` with `window.location.pathname` set, and always restores it. */
function atPath(pathname, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const real = globalThis.window;
  globalThis.window = pathname === undefined ? undefined : { location: { pathname } };
  try { return fn(); } finally {
    if (had) globalThis.window = real; else delete globalThis.window;
  }
}

test('D510: the band reads its page the way the router stores one', () => {
  assert.equal(atPath('/build', bandPage), '/build');
  // One page, not two: the rail strips the trailing slash, and so must the band.
  assert.equal(atPath('/build/', bandPage), '/build');
  assert.equal(atPath('/build//', bandPage), '/build');
  assert.equal(atPath('/', bandPage), '/');
  // No path is no page — never an empty string sent as one.
  assert.equal(atPath('', bandPage), undefined);
  assert.equal(atPath(undefined, bandPage), undefined, 'a band with no window invented a page');
});

/** The body `zoneDraftRun` sends, through the real `request()`. */
async function sentBody(...args) {
  const real = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ item: null }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  try {
    await api.research.zoneDraftRun(...args);
  } finally {
    globalThis.fetch = real;
  }
  return body;
}

test('D510: a run sends the page beside the surface, and nothing when there is none', async () => {
  assert.deepEqual(await sentBody('build/retro', '7', '/build'),
    { surface: 'build/retro', scope_key: '7', page: '/build' });
  // A mount with no page sends no key at all, which the Worker records as not
  // recorded; it never sends the draft key or an empty string in its place.
  assert.deepEqual(await sentBody('build/retro', '7', undefined), { surface: 'build/retro', scope_key: '7' });
  assert.deepEqual(await sentBody('research/ask', '', undefined), { surface: 'research/ask' });
});

test('D510: the band hands its page to the run, and only to the run', () => {
  const band = codeOnly(read('frontend/src/workspaces/ZoneDraft.jsx'));
  const run = band.slice(band.indexOf('const doRun = async'), band.indexOf('const doAccept = async'));
  assert.match(run, /api\.research\.zoneDraftRun\(surface, scopeKey, bandPage\(\)\)/,
    'the run does not send the page it was pressed on');
  // Reading the drafts spends nothing and records nothing, so it sends no page.
  const load = band.slice(band.indexOf('const load = useCallback'), band.indexOf('const doRun = async'));
  assert.doesNotMatch(load, /bandPage|zoneDraftRun/, 'loading the band reads the page or runs a draft');
  const api = codeOnly(read('frontend/src/lib/api.js'));
  assert.match(api, /zoneDraftRun: \(surface, scopeKey, page\) => request\('\/research\/drafts'/);
});

test('D510: the retro band says what the board cannot tell it', () => {
  const page = read('frontend/src/pages/founder/FounderBuildDesk.jsx');
  const at = page.indexOf('surface="build/retro"');
  assert.ok(at > 0, 'the retro band is not mounted');
  const mount = page.slice(at, page.indexOf('/>', at));
  // The canvas's fixture counts moves ("carried a third time"); the board
  // records none, and the band's own foot says so where the reader sees it.
  assert.match(mount, /foot="The board keeps no history of its moves/);
  assert.match(mount, /nothingToDraft="There are no cards on this board to summarise yet\."/);
  assert.doesNotMatch(mount, /carried|third time|moved three/i, 'the band repeats a count nothing records');
});
