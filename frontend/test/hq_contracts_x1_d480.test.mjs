/**
 * Contracts · Super.dc.html — X1 hub artboard bounds (D480).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CANVAS = readFileSync(
  resolve(REPO, 'design/canvases/integrated/Contracts · Super.dc.html'),
  'utf8',
);
const PAGE = codeOnly(readFileSync(resolve(REPO, 'frontend/src/pages/hq/ContractRegistry.jsx'), 'utf8'));

const x1Start = CANVAS.indexOf('<section class="ab" id="x1">');
const x2Start = CANVAS.indexOf('<section class="ab" id="x2">');
assert.ok(x1Start >= 0 && x2Start > x1Start, 'X1/X2 artboards must exist in the canvas');
const X1 = CANVAS.slice(x1Start, x2Start);

test('X1 artboard is bounded between x1 and x2 markers', () => {
  assert.match(X1, /Super · Contracts hub/);
  assert.match(X1, /Doc-type registry/);
  assert.match(X1, /OVERLAP/);
});

test('the HQ page implements X1 hub elements', () => {
  assert.match(PAGE, /registry-health-tiles/);
  assert.match(PAGE, /registry-layer-cards/);
  assert.match(PAGE, /registry-new-doc-type/);
  const desk = codeOnly(readFileSync(resolve(REPO, 'frontend/src/pages/admin/contracts/ContractsDesk.jsx'), 'utf8'));
  assert.match(desk, /WorkerRail/);
  assert.match(desk, /hq-contracts-rail/);
  assert.match(PAGE, /pending owner decision/);
});
