/**
 * D4650 (#4650, part 4) — the curriculum coverage record's words, pure. It reads
 * `GET /api/admin/learning/coverage` (`services/learningCoverage.ts`) and says,
 * for each of the four journeys, which state it is in and what is behind it.
 *
 * A count the route does not send reads "Not recorded", never 0; a course with
 * no audience is "may serve this journey", never missing.
 */

export const JOURNEY_LABEL = { founder: 'Founders', investor: 'Investors', advisor: 'Advisors', partner: 'Partners' };

/** The four states, their pill tone and the sentence that says what each means. */
export const COVERAGE_STATE = {
  published: { label: 'Published', tone: 'ok', line: 'At least one published course open to members names this journey.' },
  inaccessible: { label: 'Not reachable', tone: 'warn', line: 'Courses name this journey, but each is a draft, archived, or for program members only.' },
  unknown: { label: 'Unknown', tone: 'info', line: 'No course names this journey, but some courses record no audience and may serve it.' },
  missing: { label: 'Missing', tone: 'danger', line: 'Every course records its audience, and none names this journey.' },
};

export const INACCESSIBLE_REASON = { draft: 'draft', archived: 'archived', program_only: 'program members only' };

const count = (n) => (Number.isInteger(n) && n >= 0 ? n : null);

/**
 * One row per journey, in the route's order. `state` falls back to `unknown`
 * when the route sends one this page does not know, so nothing reads missing
 * that the route did not call missing.
 */
export function coverageRows(coverage) {
  const journeys = Array.isArray(coverage?.journeys) ? coverage.journeys : [];
  return journeys.map((j) => {
    const state = COVERAGE_STATE[j?.state] ? j.state : 'unknown';
    const published = Array.isArray(j?.published) ? j.published : [];
    const inaccessible = Array.isArray(j?.inaccessible) ? j.inaccessible : [];
    return {
      journey: j?.journey,
      label: JOURNEY_LABEL[j?.journey] || String(j?.journey ?? 'Journey'),
      state,
      stateLabel: COVERAGE_STATE[state].label,
      tone: COVERAGE_STATE[state].tone,
      line: COVERAGE_STATE[state].line,
      published,
      inaccessible: inaccessible.map((c) => ({ ...c, why: INACCESSIBLE_REASON[c?.reason] || 'not reachable' })),
      unknown: count(j?.unknown),
      stages: Array.isArray(j?.stages) ? j.stages : [],
      stageNotRecorded: count(j?.stage_not_recorded),
    };
  });
}

/** The notes under the table: what the record could not see. */
export function coverageNotes(coverage) {
  const notes = [];
  if (coverage?.audience_recorded === false) {
    notes.push('This catalogue does not record audiences yet, so every journey reads unknown.');
  }
  if (coverage?.truncated === true) {
    notes.push('The catalogue is larger than one read takes, so no journey is called missing.');
  }
  const untagged = Array.isArray(coverage?.audience_not_recorded) ? coverage.audience_not_recorded.length : 0;
  if (untagged > 0) {
    notes.push(`${untagged} course${untagged === 1 ? ' records' : 's record'} no audience. Name who each is for in its "About this course" to settle the unknowns.`);
  }
  return notes;
}
