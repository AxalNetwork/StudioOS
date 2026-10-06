/** D592: synthetic-only before/after; never connects to a deployment. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildProfile } from '../src/services/profileHistory.ts';
import { scoringItemsFor } from '../src/services/archetypeScoring.ts';
import { ageWeight, axisState } from '../src/services/skillEvidence.ts';

export const COMPARISON_DAY = '2026-10-06';
const fixture = JSON.parse(readFileSync(new URL('../test/fixtures/profiling-v2-personas.json', import.meta.url), 'utf8'));

export function personaProfiles(enabled = false, fixedDay = null) {
  const profiles = [];
  for (const p of fixture.personas) {
    const dates = fixedDay ? [fixedDay] : p.checkpoints?.map(c => c.at) ?? [COMPARISON_DAY];
    for (const day of dates) {
      const at = Date.parse(`${day}T23:59:59.999Z`);
      const weights = {};
      // The fixture's historic dotted source names carry one action each.
      // Production snapshots likewise give an unknown source weight one.
      for (const e of p.evidence ?? []) {
        const time = Date.parse(e.occurred_at);
        if (time <= at) weights[e.axis] = (weights[e.axis] ?? 0) + ageWeight(time, at);
      }
      profiles.push({ key: p.key, day, profile: buildProfile(p.role, scoringItemsFor(p.role), p.answers, day, weights, enabled) });
    }
  }
  return profiles;
}

/** Same shape/order as the independent, pre-change byte baseline. */
export function offBaseline() {
  const axes = [];
  for (const self of [null, 0, 1, 2, 3, 4, 5]) {
    for (const weight of [0, 0.1, 1, 2.99, 3, 5, 10]) axes.push({ self, weight, result: axisState(self, weight, false) });
  }
  return { profiles: personaProfiles(false), axes };
}

const split = profiles => {
  const result = { not_recorded: 0, self_rated_only: 0, some_evidence: 0, corroborated: 0, evidence_only: 0 };
  for (const row of profiles) for (const axis of Object.values(row.profile.skills)) result[axis.state] += 1;
  return result;
};

export function comparison() {
  const before = personaProfiles(false);
  const after = personaProfiles(true);
  return {
    synthetic_only: true,
    day: COMPARISON_DAY,
    rows: before.map((row, i) => {
      const next = after[i].profile;
      const changes = Object.keys(row.profile.skills).flatMap(axis => {
        const a = row.profile.skills[axis].blended;
        const b = next.skills[axis].blended;
        return a === b ? [] : [{ axis, before: a, after: b }];
      });
      return { key: row.key, day: row.day, before: row.profile.displayed_slug, after: next.displayed_slug, changes };
    }),
    trends: {
      basis: '23 synthetic fixture personas, primary role only, as of 2026-10-06; no production aggregates',
      before: split(personaProfiles(false, COMPARISON_DAY)),
      after: split(personaProfiles(true, COMPARISON_DAY)),
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(comparison(), null, 2));
}
