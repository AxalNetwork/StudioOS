/**
 * D663 (#1476) — the share viewer sends seconds per slide with its
 * heartbeat. The Worker side (capping, storing, reading) is
 * `cloudflare-worker/test/cycle_raise_d663.test.ts`; this holds the client:
 * the api method carries the per-slide totals, and the viewer passes them.
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_slide_dwell_d663.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('deckShareHeartbeat sends the per-slide totals when it has them, and the old body when it does not', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body]);
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api } = await import('../src/lib/api.js');
    await api.deckShareHeartbeat('tok', 7, 60, { 0: 41, 3: 19 });
    await api.deckShareHeartbeat('tok', 7, 90);
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls.map(([m, u]) => [m, u]), [['POST', '/decks/share/tok/heartbeat'], ['POST', '/decks/share/tok/heartbeat']]);
  assert.deepEqual(JSON.parse(calls[0][2]), { view_id: 7, seconds: 60, slides: { 0: 41, 3: 19 } });
  assert.deepEqual(JSON.parse(calls[1][2]), { view_id: 7, seconds: 90 });
});

test('the share viewer counts a second per visible second on the slide being read, and sends the totals', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/PitchDeckPrintPage.jsx'), 'utf8');
  assert.match(src, /api\.deckShareHeartbeat\(token, vid, seconds, slideSecondsRef\.current\)/);
  assert.match(src, /slideSecondsRef\.current\[idx\] = \(slideSecondsRef\.current\[idx\] \|\| 0\) \+ 1;/);
  assert.match(src, /if \(document\.visibilityState !== 'visible' \|\| !viewIdRef\.current \|\| !stageRef\.current\) return;/);
});
