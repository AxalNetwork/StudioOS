/**
 * Stale-chunk recovery only works if we recognise the failure.
 *
 * Safari does not always say "Failed to fetch dynamically imported module".
 * After React.lazy settles a broken payload it throws
 * `undefined is not an object (evaluating 'e._result.default')`, and that
 * used to render as a generic "unexpected error" card across the platform
 * because RouteErrorBoundary and main.jsx each had incomplete detectors.
 * These pin the shared helper — including the Safari and Chrome React.lazy
 * shapes — so a deploy that retires a hashed chunk recovers with a reload
 * instead of a red card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { isChunkLoadError } from '../src/lib/chunkLoadError.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

test('Safari React.lazy _result.default TypeError is a chunk-load error', () => {
  const safari = new TypeError("undefined is not an object (evaluating 'e._result.default')");
  assert.equal(isChunkLoadError(safari), true);
});

test('Chrome React.lazy missing-module TypeError is a chunk-load error', () => {
  const chrome = new TypeError("Cannot read properties of undefined (reading 'default')");
  assert.equal(isChunkLoadError(chrome), true);
});

test('classic dynamic-import failures still count', () => {
  assert.equal(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://axal.vc/assets/X.js')), true);
  assert.equal(isChunkLoadError(new Error('Importing a module script failed.')), true);
  assert.equal(isChunkLoadError(Object.assign(new Error('Loading chunk 42 failed'), { name: 'ChunkLoadError' })), true);
});

test('ordinary render errors are not treated as chunk failures', () => {
  assert.equal(isChunkLoadError(new TypeError("undefined is not an object (evaluating 'user.name')")), false);
  assert.equal(isChunkLoadError(new Error('Cannot read properties of undefined (reading \'map\')')), false);
  assert.equal(isChunkLoadError(null), false);
});

test('main.jsx and RouteErrorBoundary share the helper', () => {
  const main = codeOnly(read('frontend/src/main.jsx'));
  const boundary = codeOnly(read('frontend/src/components/RouteErrorBoundary.jsx'));
  assert.match(main, /from '\.\/lib\/chunkLoadError'/);
  assert.match(boundary, /from '\.\.\/lib\/chunkLoadError'/);
  assert.doesNotMatch(main, /function isChunkLoadError/,
    'main.jsx must not keep a private detector that can drift');
  assert.doesNotMatch(boundary, /function isChunkLoadError/,
    'RouteErrorBoundary must not keep a private detector that can drift');
  assert.doesNotMatch(boundary, /CHUNK_LOAD_RE/,
    'the regex lives in chunkLoadError.js only');
});
