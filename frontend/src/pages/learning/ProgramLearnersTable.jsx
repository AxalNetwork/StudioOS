import React from 'react';
import { InfoStrip, Pill, Unrecorded } from '../../ui';
import { titleCase } from '../../lib/absence';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, byPosition, formatDay, learnerCell } from './learningModel';

const CELL_TONE = {
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  warn: 'bg-amber-50 text-axal-amber-deep dark:bg-amber-900/30 dark:text-amber-300',
  info: 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300',
  neutral: 'text-axal-ink dark:text-gray-200',
  none: 'text-axal-faint dark:text-gray-500',
  absent: 'italic text-gray-500 dark:text-gray-400',
};

/** "Read-only": the assigned admin's boundary, said once above the table. */
export function ReadOnlyStrip() {
  return (
    <InfoStrip dismissible={false} title="Read-only">
      Assigned to you by a Super Admin. Content and enrolment are managed at HQ.
    </InfoStrip>
  );
}

/**
 * A regional program's members against its content, for the admin a Super
 * Admin assigned to it (D562; data #1159, scores and statuses #1160).
 *
 * Props, in the shape #1159 plans for `GET /api/learning/programs/:uid/learners`:
 *   status    'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   program   { uid, name, region }
 *   contents  [{ subject_kind, subject_uid, title, position }]
 *   learners  [{ user_uid, name, role, enrolled_at, cells: { [subject_uid]:
 *               { status, percent, score_percent, passed, submission_status, unavailable } } }]
 *   selectedUid, onSelect(user_uid)  the member whose record sits beside it
 *
 * EACH CELL IS A TICK, A SCORE OR A STATUS, AND NEVER A ZERO. A member who
 * never opened an item shows a dash, which the legend defines; a cell whose
 * source is not there yet (#1160's tables, before they merge) says "Not
 * recorded". Members are named by name and uid only: #1159 never returns an
 * email, and nothing here would draw one.
 */
export default function ProgramLearnersTable({
  status, program, contents, learners, selectedUid, onSelect, reason = NOT_LIVE.programs, onRetry,
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
                    <th key={c.subject_uid} scope="col" className="px-1 text-center" title={c.title || undefined}>
                      <span className="block">{titleCase(c.subject_kind) || 'Item'}</span>
                      <span className="block max-w-[7rem] truncate font-medium normal-case tracking-normal text-axal-muted dark:text-gray-400">{c.title || 'Untitled'}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((learner) => (
                  <tr key={learner.user_uid} data-testid={`learner-row-${learner.user_uid}`} className={learner.user_uid === selectedUid ? 'bg-axal-lavender/60 dark:bg-violet-900/20' : ''}>
                    <th scope="row" className="sticky left-0 bg-white pr-3 text-left font-semibold text-axal-ink dark:bg-gray-900 dark:text-gray-100">
                      {onSelect
                        ? <button type="button" className="text-left hover:text-axal-violet-deep dark:hover:text-violet-300" onClick={() => onSelect(learner.user_uid)}>{learner.name || <Unrecorded>Name not recorded</Unrecorded>}</button>
                        : (learner.name || <Unrecorded>Name not recorded</Unrecorded>)}
                    </th>
                    {columns.map((c) => {
                      const cell = learnerCell(learner.cells?.[c.subject_uid], c.subject_kind);
                      return (
                        <td key={c.subject_uid} className="px-1 text-center">
                          <span className={`inline-block min-w-[3rem] rounded-axal-xs px-1.5 py-1 tabular-nums ${CELL_TONE[cell.tone]}`} title={cell.label}>
                            <span aria-hidden="true">{cell.mark}</span>
                            <span className="sr-only">{cell.label}</span>
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-axal-faint dark:text-gray-500" data-testid="program-learners-legend">
            ✓ completed · score for exams · status for exercises · — not started. A member who never opened an item shows a dash, not 0.
          </p>
        </>
      )}
    </SectionCard>
  );
}

/**
 * One member's record in the program (#1159 `GET …/learners/:userUid`):
 * `{ user_uid, name, role, enrolled_at, rows: [{ subject_kind, subject_uid, title, cell }] }`.
 */
export function LearnerRecord({ status, record, reason = NOT_LIVE.programs, onRetry }) {
  const rows = record?.rows || [];
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the member’s record',
    claim: 'This is not a claim that the member has done nothing.',
    isEmpty: !record,
    empty: { title: 'No member chosen', body: 'Choose a member in the table to see their record.' },
  });
  return (
    <SectionCard title="Member record" testid="learner-record">
      {block || (
        <>
          <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{record.name || <Unrecorded>Name not recorded</Unrecorded>}</p>
          <p className="mb-3 text-[11.5px] text-axal-muted dark:text-gray-400">
            {record.role ? titleCase(record.role) : 'Role not recorded'} · enrolled {formatDay(record.enrolled_at) || 'date not recorded'}
          </p>
          <ul className="space-y-1.5">
            {rows.map((r, i) => {
              const cell = learnerCell(r.cell, r.subject_kind);
              return (
                <li key={r.subject_uid || i} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Pill tone="neutral">{titleCase(r.subject_kind) || 'Item'}</Pill>
                    <span className="truncate text-axal-ink dark:text-gray-100">{r.title || 'Untitled'}</span>
                  </span>
                  <span className={`flex-none rounded-axal-xs px-1.5 py-0.5 tabular-nums ${CELL_TONE[cell.tone]}`}>{cell.label}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SectionCard>
  );
}
