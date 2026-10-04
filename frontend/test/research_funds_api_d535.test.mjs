/**
 * D535 (#1081), step 2 — the D527 client module for the fund directory.
 * The pages that will call it wait for the owner's approval of the canvas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

test('researchFunds.js calls the two Worker routes and drops empty filters', () => {
  const mod = read('frontend/src/lib/api/researchFunds.js');
  assert.match(mod, /request\(`\/research\/fund-directory\$\{qs \? `\?\$\{qs\}` : ''\}`\)/);
  assert.match(mod, /request\(`\/research\/fund-directory\/\$\{encodeURIComponent\(uid\)\}`\)/);
  assert.match(mod, /filter\(\(\[, v\]\) => v !== undefined && v !== null && v !== ''\)/);
});

test('api.js re-exports it in its D527 block', () => {
  const api = read('frontend/src/lib/api.js');
  const block = api.slice(api.indexOf('// api-modules:begin'), api.indexOf('// api-modules:end'));
  assert.match(block, /^export \* from '\.\/api\/researchFunds\.js';$/m);
});
