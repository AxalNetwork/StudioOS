import React from 'react';
import { Link } from 'react-router-dom';
import { InfoStrip, Pill, Unrecorded } from '../../ui';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, byPosition, formatDay } from './learningModel';
import { completionCell, entryFor, subjectKindLabel } from './programModel';

const CELL_TONE = {
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  warn: 'bg-amber-50 text-axal-amber-deep dark:bg-amber-900/30 dark:text-amber-300',
  info: 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300',
  neutral: 'text-axal-ink dark:text-gray-200',
  none: 'text-axal-faint dark:text-gray-500',
  absent: 'italic text-gray-500 dark:text-gray-400',
};

/** A content row's title, or what became of it when its own row is gone. */
const titleOf = (c) => c?.title || (c?.status === 'missing' ? 'No longer exists' : 'Untitled');

/** "Read-only": the assigned admin's boundary, said once above the table. */
export function ReadOnlyStrip() {
  return (
    <InfoStrip dismissible={false} title="Read-only">
      Assigned to you by a Super Admin. Content and enrolment are managed at HQ.
    </InfoStrip>
  );
}

/**
 * A regional program's members against its content, for an admin assigned to
 * it and for the Super Admin (D562; D558's `GET /api/learning/programs/:uid/learners`).
 *
 * Props, in the route's shape:
 *   status       'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   program      `programView`: { uid, name, region, … }
 *   contents     [{ subject_kind, subject_uid, position, title, status, href }]
 *   learners     [{ uid, name, enrolled_at, completion: [{ subject_kind,
 *                subject_uid, status, … }] }], each entry `completionFor`'s
 *   selectedUid  the member whose record sits beside the table
 *   learnerHref  (uid) => where a member's name links, to open their record
 *
 * EACH CELL IS A TICK, A PERCENT, A SCORE OR A STATUS, AND NEVER A ZERO. A
 * member who never opened an item shows a dash, which the legend defines; an
 * exam never sat has no score. Members are named by name only: the route
 * sends a name and a uid, never an email, and nothing here would draw one.
 */
export default function ProgramLearnersTable({
  status, program, contents, learners, selectedUid, learnerHref, reason = NOT_LIVE.programs, onRetry,
}) {
  const columns = byPosition(contents);
  const rows = learners || [];
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the program’s members',
    claim: 'This is not a claim that nobody is enrolled.',
    isEmpty: rows.length === 0 || columns.length === 0,
    empty: rows.length === 0
      ? { title: 'No member enrolled', body: 'A Super Admin enrols members into this program at HQ.' }
      : { title: 'No content in this program', body: 'A Super Admin adds content to this program at HQ.' },
  });
  const meta = status === 'ready' && !block
    ? `${rows.length} member${rows.length === 1 ? '' : 's'} · ${columns.length} item${columns.length === 1 ? '' : 's'}`
    : null;
  return (
    <SectionCard title="Members against content" meta={meta} testid="program-learners">
      {block || (
        <>
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[36rem] border-separate border-spacing-y-1 text-[12px]" data-testid="program-learners-table">
              <caption className="sr-only">{program?.name || 'Program'}: each member’s completion of each item</caption>
              <thead>
                <tr className="text-left text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">
                  <th scope="col" className="sticky left-0 bg-white pr-3 dark:bg-gray-900">Member</th>
                  {columns.map((c) => (
                    <th key={`${c.subject_kind}:${c.subject_uid}`} scope="col" className="px-1 text-center" title={titleOf(c)}>
                      <span className="block">{subjectKindLabel(c.subject_kind)}</span>
                      <span className="block max-w-[7rem] truncate font-medium normal-case tracking-normal text-axal-muted dark:text-gray-400">{titleOf(c)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((learner, i) => {
                  const selected = Boolean(learner.uid) && learner.uid === selectedUid;
                  const name = learner.name || <Unrecorded>Name not recorded</Unrecorded>;
                  return (
                    <tr key={learner.uid || i} data-testid={`learner-row-${learner.uid}`} className={selected ? 'bg-axal-lavender/60 dark:bg-violet-900/20' : ''}>
                      <th scope="row" className="sticky left-0 bg-white pr-3 text-left font-semibold text-axal-ink dark:bg-gray-900 dark:text-gray-100">
                        {learnerHref && learner.uid
                          ? (
                            <Link
                              to={learnerHref(learner.uid)}
                              aria-current={selected ? 'true' : undefined}
                              className="hover:text-axal-violet-deep dark:hover:text-violet-300"
                              data-testid={`link-learner-${learner.uid}`}
                            >
                              {name}
                            </Link>
                          )
                          : name}
                      </th>
                      {columns.map((c) => {
                        const cell = completionCell(entryFor(learner.completion, c));
                        return (
                          <td key={`${c.subject_kind}:${c.subject_uid}`} className="px-1 text-center">
                            <span className={`inline-block min-w-[3rem] rounded-axal-xs px-1.5 py-1 tabular-nums ${CELL_TONE[cell.tone]}`} title={cell.label}>
                              <span aria-hidden="true">{cell.mark}</span>
                              <span className="sr-only">{cell.label}</span>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-axal-faint dark:text-gray-500" data-testid="program-learners-legend">
            ✓ completed · a percent for something started · the best score for an exam · the review for an exercise · — not started.
            A member who never opened an item shows a dash, not 0.
          </p>
        </>
      )}
    </SectionCard>
  );
}

/**
 * One member's record in the program (D558's `GET …/learners/:userUid`): each
 * content item in order with where they stand on it.
 *
 *   learner   { uid, name, enrolled_at, completion }, or null when none is chosen
 *   contents  the program's contents, as the table takes them
 *   notFound  the route's own sentence when the member chosen is not in the
 *             program ("No such learner in this program.")
 *
 * The route sends no role for a member (a learner is a name and a uid), so
 * none is drawn.
 */
export function LearnerRecord({ status, learner, contents, notFound = '', reason = NOT_LIVE.programs, onRetry }) {
  const rows = byPosition(contents);
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the member’s record',
    claim: 'This is not a claim that the member has done nothing.',
    isEmpty: !learner,
    empty: notFound
      ? { title: 'Not in this program', body: notFound }
      : { title: 'No member chosen', body: 'Choose a member in the table to see their record.' },
  });
  return (
    <SectionCard title="Member record" testid="learner-record">
      {block || (
        <>
          <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{learner.name || <Unrecorded>Name not recorded</Unrecorded>}</p>
          <p className="mb-3 text-[11.5px] text-axal-muted dark:text-gray-400">
            Enrolled {formatDay(learner.enrolled_at) || <Unrecorded>date not recorded</Unrecorded>}
          </p>
          {rows.length === 0 ? (
            <p className="text-[12px] text-axal-muted dark:text-gray-400">No content in this program yet.</p>
          ) : (
            <ul className="space-y-1.5" data-testid="learner-record-rows">
              {rows.map((c) => {
                const cell = completionCell(entryFor(learner.completion, c));
                return (
                  <li key={`${c.subject_kind}:${c.subject_uid}`} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Pill tone="neutral">{subjectKindLabel(c.subject_kind)}</Pill>
                      <span className="truncate text-axal-ink dark:text-gray-100">{titleOf(c)}</span>
                    </span>
                    <span className={`flex-none rounded-axal-xs px-1.5 py-0.5 tabular-nums ${CELL_TONE[cell.tone]}`}>{cell.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );
}
