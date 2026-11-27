/**
 * The founder fund dossier — one row, owner-scoped, with an overlap sentence
 * that does not borrow the list's "missing low end counts as 0" rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fundOverlapNote } from '../src/services/researchFundRead.ts';

const routes = readFileSync(new URL('../src/routes/research.ts', import.meta.url), 'utf8');

test('a missing raise is not an overlap of zero', () => {
  assert.equal(
    fundOverlapNote({ cheque_min_cents: 100, cheque_max_cents: 500 }, null),
    'No raise target on the active company, so there is no ask to compare.',
  );
});

test('an unrecorded cheque is nothing to compare, not a range of zero', () => {
  assert.equal(
    fundOverlapNote({ cheque_min_cents: null, cheque_max_cents: null }, 1_500_000_00),
    'Your raise target is $1,500,000. Their cheque is not recorded, so there is nothing to compare it to yet.',
  );
});

test('the sentence leaves a missing end open', () => {
  assert.match(
    fundOverlapNote({ cheque_min_cents: 50_000_000, cheque_max_cents: 150_000_000 }, 150_000_000),
    /inside the range they state\. A note, not a score\.$/,
  );
  assert.match(
    fundOverlapNote({ cheque_min_cents: 50_000_000, cheque_max_cents: 150_000_000 }, 200_000_000),
    /outside the range they state/,
  );
  // Low end only: anything at or above it is inside. The list count would
  // treat a missing high as infinity too, but a missing LOW must not become 0
  // in this sentence — a target below a recorded high with no low is inside.
  assert.match(
    fundOverlapNote({ cheque_min_cents: null, cheque_max_cents: 100_000_000 }, 50_000_000),
    /inside/,
  );
  assert.match(
    fundOverlapNote({ cheque_min_cents: null, cheque_max_cents: 100_000_000 }, 200_000_000),
    /outside/,
  );
  assert.match(
    fundOverlapNote({ cheque_min_cents: 80_000_000, cheque_max_cents: null }, 90_000_000),
    /inside/,
  );
});

test('GET /funds/:uid is the owner and stays outside the sheet-route slice', () => {
  const getAt = routes.indexOf("research.get('/funds/:uid'");
  const patchAt = routes.indexOf("research.patch('/funds/:uid'");
  assert.ok(getAt > patchAt, 'the dossier read must stay after PATCH so the Super Admin sheet slice does not include it');
  const handler = routes.slice(getAt, routes.indexOf("research.get('/benchmarks'"));
  assert.match(handler, /requireAuth\(c\)/);
  assert.doesNotMatch(handler, /requireSuperAdmin/);
  assert.match(handler, /owner_user_id = \?/);
  assert.match(handler, /detail: 'Not found'/);
  assert.match(handler, /overlap_note: fundOverlapNote/);
  assert.match(handler, /raise_target_cents: askCents/);
});
