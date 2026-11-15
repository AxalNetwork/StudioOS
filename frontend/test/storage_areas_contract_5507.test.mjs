/**
 * #5507 — the storage-area contract (`_storageAreasContract.mjs`, D5507)
 * against what the frontend draws and what the docs say. The Worker's read is
 * held to the same contract by `cloudflare-worker/test/usage_storage_d1169.test.ts`.
 *
 *   - visibility: the Usage card (`STORAGE_AREAS`, `storageView`) lists every
 *     contracted area, each with its own label, and no other;
 *   - access: the Storage page's largest files (`AREA_PLACE`) know where each
 *     area's file opens, as the contract says;
 *   - kinds: the Storage page's kinds are the canvas's six, in order;
 *   - docs: ROUTE_MAP's D642 section names every contracted key.
 *
 * Found on first run (2026-11-15): `grow_voice_notes` (D5332) and
 * `agent_compute` (D4557) were counted by the Worker but missing from the
 * Usage card, and `grow_voice_notes` had no place on the Storage page: the
 * old suites read the catalogue from the service's own source, so registry
 * and renderers drifted apart silently. Both are now listed.
 *
 * Replay (2026-11-15, mutation run over every storage/usage suite, frontend
 * and Worker):
 *   - add an unrelated area (`acme_files` in storageUsage.ts's AREAS and its
 *     type): only usage_storage_d1169 failed (membership). With the one
 *     contract row added, only this file failed, until the product listed it:
 *     the card's label, its AREA_PLACE and ROUTE_MAP's prose; then every
 *     suite was green. The contract row was the only TEST edit.
 *   - remove a required area (`grow_voice_notes` from STORAGE_AREAS): only
 *     this file failed (visibility).
 *   - drop a key from ROUTE_MAP's D642 prose (`agent_compute`): only this
 *     file failed (docs).
 *   - break one area's access (`deck_reviews` opens '/raise'): only this
 *     file failed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/storage_areas_contract_5507.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRouteMap } from '../../scripts/lib/routeMap.mjs';
import { STORAGE_AREAS, storageView } from '../src/pages/account/usageModel.js';
import { AREA_PLACE, KINDS } from '../src/pages/account/storagePageModel.js';
import { STORAGE_AREA_CONTRACT, STORAGE_AREA_KEYS, STORAGE_KIND_ORDER } from './_storageAreasContract.mjs';

const sorted = (xs) => [...xs].sort();

test('the Usage card lists every contracted area, each under its own label, and no other', () => {
  assert.deepEqual(sorted(STORAGE_AREAS.map(([key]) => key)), STORAGE_AREA_KEYS);
  const labels = STORAGE_AREAS.map(([, label]) => label);
  assert.ok(labels.every((l) => typeof l === 'string' && l.trim()), 'every area has a label');
  assert.equal(new Set(labels).size, labels.length, 'no two areas share a label');
  // Through the renderer's model: a read that returns every contracted area draws each as read.
  const v = storageView({ total_bytes: 0, files: 0, unknown_size_files: 0,
    areas: STORAGE_AREA_KEYS.map((key) => ({ key, files: 0, bytes: 0, unknown_size_files: 0, recorded: true })) });
  assert.deepEqual(sorted(v.places.map((p) => p.key)), STORAGE_AREA_KEYS);
  assert.equal(v.anyUnreadable, false);
  // A contracted area missing from the read is unreadable, never a silent zero.
  const missing = storageView({ total_bytes: 0, files: 0, unknown_size_files: 0, areas: [] });
  assert.ok(missing.places.every((p) => p.unreadable));
});

test('the Storage page knows where each contracted area\'s file opens', () => {
  assert.deepEqual(sorted(Object.keys(AREA_PLACE)), STORAGE_AREA_KEYS);
  for (const [key, , opens] of STORAGE_AREA_CONTRACT) {
    const [place, to] = AREA_PLACE[key];
    assert.ok(typeof place === 'string' && place.trim(), `${key} names its place`);
    assert.equal(to, opens, `${key} opens ${opens}`);
  }
});

test('the Storage page\'s kinds are the canvas\'s six, in order', () => {
  assert.deepEqual(KINDS.map(([key]) => key), [...STORAGE_KIND_ORDER]);
});

test('docs: ROUTE_MAP\'s D642 section names every contracted storage area', () => {
  const map = readRouteMap();
  const heading = '### Usage page and HQ allowances (D642, #1435)';
  const at = map.indexOf(heading);
  assert.ok(at >= 0, 'the D642 section is missing');
  const rest = map.slice(at + heading.length);
  const next = rest.search(/\n#{1,3} /);
  const prose = (next < 0 ? rest : rest.slice(0, next)).split('| Canvas |')[0];
  for (const key of STORAGE_AREA_KEYS) assert.ok(prose.includes(`\`${key}\``), `ROUTE_MAP does not name ${key}`);
});
