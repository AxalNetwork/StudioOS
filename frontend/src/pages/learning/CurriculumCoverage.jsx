import React from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded } from '../../ui';
import { LearningEmpty, LearningLoading, LearningUnreadable, SectionCard } from './LearningStates';
import { coverageNotes, coverageRows } from './coverageModel';
import { readCoverage } from './studioActions';
import useLearningRead from './useLearningRead';

/**
 * D4650 (#4650, part 4): the studio's curriculum coverage record. For each of
 * the founder, investor, advisor and partner journeys, its state (published,
 * not reachable, unknown or missing) and the courses behind it, from
 * `GET /api/admin/learning/coverage` (Super Admin). It reads the catalogue
 * only, never a learner's record.
 *
 * Four states: loading; Unreadable (the read failed, which is not a claim that
 * any journey has no material); empty (no courses at all); and the table. A
 * count the route does not send reads "Not recorded", never 0.
 */

const courseLink = (c) => (
  <Link
    to={`/learning/studio?course=${encodeURIComponent(c.uid)}`}
    className="font-semibold text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300"
    data-testid={`link-coverage-course-${c.uid}`}
  >
    {c.title}
  </Link>
);

function CourseList({ courses, testid, why = false }) {
  if (!courses.length) return <span className="text-axal-faint dark:text-gray-500">None</span>;
  return (
    <ul className="space-y-0.5" data-testid={testid}>
      {courses.map((c) => (
        <li key={c.uid}>
          {courseLink(c)}
          {why ? <span className="text-axal-muted dark:text-gray-400"> ({c.why})</span> : null}
          {!why && c.stage ? <span className="text-axal-muted dark:text-gray-400"> · {c.stage}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function CoverageView({ state, onRetry }) {
  let body;
  let meta = null;
  if (!state || state.status === 'loading' || state.status === 'idle') {
    body = <LearningLoading what="the coverage record" rows={4} />;
  } else if (state.status !== 'ready') {
    body = <LearningUnreadable what="The coverage record" claim="This is not a claim that any journey has no material." onRetry={onRetry} />;
  } else if (state.coverage?.courses === 0) {
    body = <LearningEmpty title="No courses yet" body="The catalogue has no courses, so every journey is missing material." />;
  } else {
    const rows = coverageRows(state.coverage);
    const notes = coverageNotes(state.coverage);
    const n = state.coverage?.courses;
    meta = Number.isInteger(n) ? `${n} course${n === 1 ? '' : 's'} in the catalogue` : null;
    body = (
      <>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[40rem] border-separate border-spacing-y-1 text-[12px]" data-testid="coverage-table">
            <caption className="sr-only">Curriculum coverage: each journey, its state, and the courses behind it</caption>
            <thead>
              <tr className="text-left text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">
                <th scope="col" className="pr-3">Journey</th>
                <th scope="col" className="pr-3">Coverage</th>
                <th scope="col" className="pr-3">Published</th>
                <th scope="col" className="pr-3">Not reachable</th>
                <th scope="col">Audience not recorded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.journey} className="align-top" data-testid={`coverage-row-${r.journey}`}>
                  <th scope="row" className="pr-3 text-left font-semibold text-axal-ink dark:text-gray-100">{r.label}</th>
                  <td className="pr-3">
                    <Pill tone={r.tone}>{r.stateLabel}</Pill>
                    <span className="mt-1 block text-[11.5px] leading-snug text-axal-muted dark:text-gray-400">{r.line}</span>
                  </td>
                  <td className="pr-3">
                    <CourseList courses={r.published} testid={`coverage-published-${r.journey}`} />
                    {r.stageNotRecorded ? (
                      <span className="mt-0.5 block text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`coverage-stage-${r.journey}`}>
                        {r.stageNotRecorded} without a stage recorded
                      </span>
                    ) : null}
                  </td>
                  <td className="pr-3"><CourseList courses={r.inaccessible} testid={`coverage-inaccessible-${r.journey}`} why /></td>
                  <td className="tabular-nums text-axal-ink dark:text-gray-200" data-testid={`coverage-unknown-${r.journey}`}>
                    {r.unknown === null
                      ? <Unrecorded reason="The coverage record did not send this count." />
                      : `${r.unknown} course${r.unknown === 1 ? '' : 's'}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {notes.length ? (
          <ul className="mt-2 space-y-1 text-[12px] text-axal-muted dark:text-gray-400" data-testid="coverage-notes">
            {notes.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}
      </>
    );
  }
  return (
    <SectionCard title="Curriculum coverage" meta={meta} testid="learning-coverage">
      <p className="mb-3 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">
        How far the course catalogue covers each journey, from each course's status, visibility and who it is for. Read from the catalogue only.
      </p>
      {body}
    </SectionCard>
  );
}

export default function CurriculumCoverage() {
  const [state, retry] = useLearningRead(readCoverage, [], { scope: 'studio-coverage' });
  return <CoverageView state={state} onRetry={retry} />;
}
