/**
 * D691 (#1700) test 17 — the founder's file tool says what the tiers do.
 *
 * Decision 6: a file's `access_tier` is `invited`, `committed` or `nobody`, and
 * `access_expires_at` hides it from that date. Every investor read applies one
 * predicate (`services/dataRoomAccess.ts`). The file tool restates it in the
 * browser: "With access now" lists only the investors who can open the file,
 * "No investor can open this" gives the rule that shuts them out, and nothing
 * on the page says the tiers are not built. A file with no `access_tier` reads
 * as `invited`, as every file did before 463.
 *
 * The founder read's fields (`access_tier`, `access_expires_at`, each grant's
 * `committed`) are tested on SQLite in `cloudflare-worker/test/raise_writes_d691.test.ts`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_tiers_d691.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ACCESS_TIERS, accessNow, noAccessReason, tierOf } from '../src/pages/raise/dataRoomRead.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-10-17T12:00:00Z');
const grants = [
  { uid: 'g-cal', status: 'active', nda_signed: true, committed: true },
  { uid: 'g-ivo', status: 'active', nda_signed: true, committed: false },
  { uid: 'g-una', status: 'active', nda_signed: false, committed: true },
  { uid: 'g-old', status: 'revoked', nda_signed: true, committed: true },
];
const who = (item) => accessNow(item, grants, NOW).map((g) => g.uid);

test('17: a file with no access_tier reads as today: every active grant, and the NDA gate on top', () => {
  assert.deepEqual(who({ visibility: 'open' }), ['g-cal', 'g-ivo', 'g-una']);
  assert.deepEqual(who({ visibility: 'nda' }), ['g-cal', 'g-ivo']);
  assert.deepEqual(who({ visibility: 'open', access_tier: 'invited' }), ['g-cal', 'g-ivo', 'g-una']);
  assert.equal(tierOf({}), 'invited');
  assert.equal(tierOf({ access_tier: 'committed' }), 'committed');
});

test('17: a committed file lists only committed grants, with the NDA gate still on top', () => {
  assert.deepEqual(who({ visibility: 'open', access_tier: 'committed' }), ['g-cal', 'g-una']);
  assert.deepEqual(who({ visibility: 'nda', access_tier: 'committed' }), ['g-cal']);
  const none = [{ uid: 'g-ivo', status: 'active', nda_signed: true, committed: false }];
  assert.deepEqual(accessNow({ visibility: 'open', access_tier: 'committed' }, none, NOW), []);
  assert.match(noAccessReason({ visibility: 'open', access_tier: 'committed' }, none, NOW), /for committed investors, and nobody with access has committed/);
});

test('17: a nobody file, or one past access_expires_at, lists no one, each with its own reason', () => {
  assert.deepEqual(who({ visibility: 'open', access_tier: 'nobody' }), []);
  assert.match(noAccessReason({ visibility: 'open', access_tier: 'nobody' }, grants, NOW), /private to you/);
  assert.deepEqual(who({ visibility: 'open', access_expires_at: '2026-10-01' }), []);
  assert.match(noAccessReason({ visibility: 'open', access_expires_at: '2026-10-01' }, grants, NOW), /access ended on 2026-10-01/);
  // The expiry day itself is past at midnight UTC, as the worker reads it.
  assert.deepEqual(who({ visibility: 'open', access_expires_at: '2026-10-17' }), []);
  assert.deepEqual(who({ visibility: 'open', access_expires_at: '2026-10-18' }), ['g-cal', 'g-ivo', 'g-una']);
  // A date nobody can read hides the file, as the worker's predicate does.
  assert.deepEqual(who({ visibility: 'open', access_expires_at: 'soon' }), []);
  assert.match(noAccessReason({ visibility: 'open', access_expires_at: 'soon' }, grants, NOW), /cannot be read/);
  // A mark the page does not know shuts everyone out rather than reading as invited.
  assert.deepEqual(who({ visibility: 'open', access_tier: 'everyone' }), []);
});

test('17: the reasons the room already gave still hold', () => {
  assert.match(noAccessReason({ visibility: 'open' }, [], NOW), /not shared with anyone yet/);
  assert.match(noAccessReason({ visibility: 'nda' }, [{ uid: 'x', status: 'active', nda_signed: false }], NOW), /needs a signed NDA/);
});

test('17: no ACCESS_TIERS note says "Not built", each says where the tier is set, and each maps to its stored value', () => {
  assert.deepEqual(ACCESS_TIERS.map((t) => t.key), ['invited', 'committed', 'nobody']);
  for (const t of ACCESS_TIERS) {
    assert.doesNotMatch(t.note, /not built/i, t.label);
    assert.match(t.note, /Set per file from Raise › Data room’s Upload and Edit file, not on this page\./, t.label);
  }
});

test('17: the page marks the file\'s own tier, says a folder has none, and no longer lists the tiers as unavailable', () => {
  const page = read('frontend/src/pages/raise/DataRoomPage.jsx');
  assert.doesNotMatch(page, /Committed-only and private tiers/);
  assert.doesNotMatch(page, /Not built/);
  assert.match(page, /const marked = kind === 'file' && tierOf\(item\) === t\.key;/);
  assert.match(page, /<Pill tone="info">This file<\/Pill>/);
  assert.match(page, /A folder has no tier: access is set per file\./);
  // The worker and the page read the same three values.
  const worker = read('cloudflare-worker/src/services/dataRoomAccess.ts');
  assert.match(worker, /export const ACCESS_TIERS = \['invited', 'committed', 'nobody'\] as const;/);
});
