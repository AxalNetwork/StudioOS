/**
 * D4856 (#4856): HQ › Platform › Storage draws members, staff and unattributed
 * as separate populations, and no figure pairs one population's numerator with
 * another's denominator.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_populations_4856.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { populationRows, tiles } from '../src/pages/hq/platformStorageModel.js';

const MB = 1024 ** 2;
const pop = (accounts, withFiles, files, bytes, unknown) => ({ accounts, accounts_with_files: withFiles, files, measured_bytes: bytes, unknown_size_files: unknown });
const read = (over = {}) => ({
  complete: true,
  totals: { files: 3, measured_bytes: 1000 * MB, unknown_size_files: 1, complete: true },
  populations: {
    members: pop(4, 1, 1, 100 * MB, 0), staff: pop(1, 1, 2, 900 * MB, 1), unattributed: pop(0, 0, 0, 0, 0),
    total: { files: 3, measured_bytes: 1000 * MB, unknown_size_files: 1 },
  },
  by_tier: [], ...over,
});

test('100 MB of members and 900 MB of staff: the total says which is which, and the members tile counts members only', () => {
  // Mutation checked: the note built from the total alone → the split disappears.
  // Mutation checked: members' stored figure read from the total → "of 4 members · 1000 MB stored".
  const t = Object.fromEntries(tiles(read()).map((x) => [x.key, x]));
  assert.equal(t.stored.value, '1000 MB');
  assert.equal(t.stored.note, 'members 100 MB · staff 900 MB');
  assert.equal(t.members.value, '1');
  assert.equal(t.members.note, 'of 4 members · 100 MB stored · staff not counted');
});

test('the populations table: one row per holder, the total last, unattributed only when it holds files', () => {
  // Mutation checked: the unattributed filter dropped → an empty "Not an account" row is drawn.
  const rows = populationRows(read());
  assert.deepEqual(rows.map((r) => [r.key, r.files, r.stored, r.unknown]), [
    ['members', '1', '100 MB', '0'], ['staff', '2', '900 MB', '1'], ['total', '3', '1000 MB', '1'],
  ]);
  const withOrphans = populationRows(read({ populations: { ...read().populations, unattributed: pop(1, 1, 2, 5 * MB, 2) } }));
  assert.deepEqual(withOrphans.map((r) => r.key), ['members', 'staff', 'unattributed', 'total']);
});

test('plans unreadable: no split and no member count, never a zero', () => {
  // Mutation checked: a missing populations block defaulted to zeros → the members tile reads "0".
  const gone = read({ populations: null, populations_reason: 'The plans could not be read.' });
  const t = Object.fromEntries(tiles(gone).map((x) => [x.key, x]));
  assert.equal(t.members.value, null);
  assert.equal(t.members.reason, 'The plans could not be read.');
  assert.equal(t.stored.note, 'Who holds it: not read');
  assert.equal(populationRows(gone), null);
});

test('an unreadable area makes the total a floor, as before', () => {
  const t = Object.fromEntries(tiles(read({ complete: false })).map((x) => [x.key, x]));
  assert.equal(t.stored.value, 'at least 1000 MB');
});
