/**
 * D698 (#1660) — the Eadwyn AI rail.
 *
 * PR 1 pins the part that lands first: D402's INHERITED card and
 * `ui/railInheritance.js` are gone, so the rail offers a card and its
 * alternates on every page and #1666 has nothing to edit there. It also pins
 * the preferences client's three calls, which the Worker serves at
 * `/api/ai/rail-preferences` (migration 465). PR 2 adds the canvas's blocks.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/airail_d698.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';

test('16 · removed (PR 1): D402\'s inherited card and railInheritance.js are gone', () => {
  assert.equal(existsSync(resolve(process.cwd(), 'frontend/src/ui/railInheritance.js')), false,
    'railInheritance.js still exists');
  const code = codeOnly(read(RAIL));
  assert.doesNotMatch(code, /railInheritance/, 'the rail still works out an inherited view');
  assert.doesNotMatch(code, /INHERITED/, 'the rail still draws an INHERITED card');
  // With the card gone, a card and its alternates are offered on every page.
  assert.match(code, /onPick=\{card\.tasks\.length \? \(\) => pick\(card\.id, card\.tasks\) : null\}/);
  assert.match(code, /\{view\.alternates\.map\(\(alt\) => \(/);
});

test('the preferences client names the three Worker routes, each path written out', () => {
  // Each path is written out so the drift check (`check-api-drift.mjs`) reads
  // it and matches a mounted route in `routes/ai.ts`.
  const src = codeOnly(read('frontend/src/lib/api/railPrefs.js'));
  assert.match(src, /read: \(\) => request\('\/ai\/rail-preferences'\)/);
  assert.match(src, /setMode: \(section, mode\) =>\s+request\(`\/ai\/rail-preferences\/\$\{encodeURIComponent\(section\)\}`, \{\s+method: 'PUT'/);
  assert.match(src, /setModel: \(section, task, model\) =>\s+request\(`\/ai\/rail-preferences\/\$\{encodeURIComponent\(section\)\}\/\$\{encodeURIComponent\(task\)\}`, \{\s+method: 'PUT'/);
  const api = read('frontend/src/lib/api.js');
  assert.equal(api.split("export * from './api/railPrefs.js';").length - 1, 1, 'api.js has exactly one railPrefs.js line');
});
