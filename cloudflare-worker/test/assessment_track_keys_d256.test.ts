/**
 * D256 — the assessment track key in code has to be the key the seed
 * migrations actually use.
 *
 * Originally `ASSESSMENT_TRACKS` existed twice — `cloudflare-worker/src/services/
 * assessmentSchema.ts` (whose own comment says "Keep in lockstep with the
 * seed migrations (108 / 110) — these are stable identifiers; never rename
 * one") and `frontend/src/pages/admin/assessment/jsonFields.js`, which
 * calls itself a mirror of the worker's list. Both named
 * `advisor_compass_v1`; migration 110 seeds the game, its chapters, items,
 * archetypes and badge criteria under `mentor_compass_v1`. HQ's create-game
 * suggestion list (`AdminAssessmentPage.jsx`, hinted "Stable track key —
 * drives result routing") offered the wrong one, and picking it would have
 * created a second, unseeded advisor track that no archetype or badge
 * matched.
 *
 * `routes/events.ts`'s `preferredEventTypes` uses the same vocabulary —
 * track-key prefixes — for a different purpose (suggesting event types by
 * track). It had its own miss: the investor/LP track's own game slug is
 * `thesis_lab_v1` (`assessmentSchema.ts`'s `INVESTOR_TRACK`), not
 * `investor_*`, so it fell through to the generic default set instead of
 * the investor-shaped one. Fixed alongside the rename, on the same
 * vocabulary mismatch.
 *
 * THIS TEST READS THE SEED MIGRATIONS OFF DISK, not the two lists against
 * each other — a test that only compared the lists could not have caught
 * this bug, since both lists agreed with each other and disagreed with the
 * data. The owner removed the editor and its jsonFields.js mirror on
 * 2026-10-21. The Worker list, seed evidence and event routing remain covered;
 * the deleted mirror no longer has a parity check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ASSESSMENT_TRACKS, INVESTOR_TRACK } from '../src/services/assessmentSchema.ts';
import { preferredEventTypes } from '../src/routes/events.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Every `assessment_games.slug` the seed migrations INSERT, off disk. */
function seededTrackSlugs(): string[] {
  const sql = read('cloudflare-worker/sql/migrations/108_assessment_play.sql')
    + '\n' + read('cloudflare-worker/sql/migrations/110_assessment_tracks.sql');
  const out = new Set<string>();
  // Matches `INSERT ... INTO assessment_games ... VALUES ('slug', 'slug', ...`
  // — the first quoted literal after each VALUES row inside an
  // assessment_games insert. Scoped per-statement so a slug appearing later
  // in a WHERE clause (dozens of times, for the chapters/items/archetypes
  // that belong to that game) is not double-counted or mistaken for a seed.
  const re = /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+assessment_games[\s\S]*?VALUES\s*\n?\s*\('([a-z0-9_]+)'/gi;
  for (const m of sql.matchAll(re)) out.add(m[1]);
  return [...out].sort();
}

test('the seed migrations still seed exactly 6 tracks — the evidence this test relies on', () => {
  const slugs = seededTrackSlugs();
  assert.equal(slugs.length, 6,
    `expected 6 seeded tracks in migrations 108+110, found ${slugs.length}: ${slugs.join(', ')}. `
    + 'Either a track was added or removed — update ASSESSMENT_TRACKS in '
    + 'assessmentSchema.ts — or the reader above stopped seeing '
    + 'one of the INSERTs.');
});

test('ASSESSMENT_TRACKS (worker) names exactly the tracks the seed migrations seed', () => {
  const seeded = seededTrackSlugs();
  assert.deepEqual([...ASSESSMENT_TRACKS].sort(), seeded,
    'cloudflare-worker/src/services/assessmentSchema.ts\'s ASSESSMENT_TRACKS names a track '
    + 'no seed migration creates, or is missing one that is seeded');
});

test('INVESTOR_TRACK is a track the seed migrations actually seed', () => {
  assert.ok(seededTrackSlugs().includes(INVESTOR_TRACK),
    `INVESTOR_TRACK ("${INVESTOR_TRACK}") names a track no seed migration creates`);
});

test('preferredEventTypes buckets every seeded track — the investor track by its real slug', () => {
  const DEFAULT = new Set(['demo_day', 'workshop', 'meetup']);
  const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

  // The investor/LP track's own slug is 'thesis_lab_v1', not 'investor_*' —
  // this is D256's actual fix in events.ts. It must NOT fall to the
  // default set.
  const investorTypes = preferredEventTypes(INVESTOR_TRACK);
  assert.ok(!setsEqual(investorTypes, DEFAULT),
    `preferredEventTypes(${INVESTOR_TRACK}) fell through to the generic default set — the `
    + 'investor track\'s own slug does not start with "investor"');
  assert.ok(investorTypes.has('lp_briefing'),
    `preferredEventTypes(${INVESTOR_TRACK}) must include lp_briefing, the event type built `
    + 'for exactly this track');

  // founder_origin_v1, partner_playbook_v1 and operators_path_v1 all match
  // their own name's prefix and were never broken — pinned here so a future
  // rename of any of them is caught the same way this one was missed.
  assert.ok(!setsEqual(preferredEventTypes('founder_origin_v1'), DEFAULT), 'founder_origin_v1 must not default');
  assert.ok(!setsEqual(preferredEventTypes('partner_playbook_v1'), DEFAULT), 'partner_playbook_v1 must not default');
  assert.ok(!setsEqual(preferredEventTypes('operators_path_v1'), DEFAULT), 'operators_path_v1 must not default');
});
