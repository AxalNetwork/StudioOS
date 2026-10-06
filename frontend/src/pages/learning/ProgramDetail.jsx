import React from 'react';
import { GripVertical } from 'lucide-react';
import { Pill, Unrecorded } from '../../ui';
import { titleCase } from '../../lib/absence';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, byPosition, formatDay } from './learningModel';

const SMALL = 'rounded-axal-sm border border-axal-hairline px-2 py-1 text-[11.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200';
const WAITING = 'Programs are not live yet.';

/** A write control that is drawn disabled, with its reason, until the page passes its handler. */
function Action({ onClick, children, testid }) {
  return (
    <button type="button" className={SMALL} onClick={onClick} disabled={!onClick} title={onClick ? undefined : WAITING} data-testid={testid}>
      {children}
    </button>
  );
}

/**
 * One regional program, for the Super Admin: its content in order, its
 * assigned admins and its members (D562; data and writes #1159).
 *
 * Props, in the shape #1159 plans:
 *   status    'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   program   { uid, name, region, description, enrolment: 'invite' | 'open' }
 *   contents  [{ subject_kind, subject_uid, title, position }]
 *   admins    [{ user_uid, name, assigned_at }]
 *   members   [{ user_uid, name, role, enrolled_at, completed, total }]
 *   handlers  { onAddContent, onRemoveContent(uid), onAssign, onUnassign(uid),
 *               onEnrol, onUnenrol(uid), onToggleOpen }, each optional
 *
 * Admins see a program's content and each member's completion and author
 * nothing (the epic's call 1A); the note under the admins says so. Members are
 * named by name and uid, never an email.
 */
export default function ProgramDetail({
  status, program, contents, admins, members, handlers = {}, reason = NOT_LIVE.programs, onRetry,
}) {
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the program',
    claim: 'This is not a claim that the program is empty.',
    isEmpty: !program,
    empty: { title: 'No such program', body: 'This program does not exist, or it was archived.' },
  });
  if (block) return <SectionCard title="Program" testid="program-detail">{block}</SectionCard>;

  const items = byPosition(contents);
  const adminRows = admins || [];
  const memberRows = members || [];
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="program-detail">
      <SectionCard title="Content, in order" meta={`${items.length}`} testid="program-contents">
        {items.length === 0 ? (
          <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No content in this program yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {items.map((c, i) => (
              <li key={c.subject_uid || i} className="flex items-center gap-2 text-[12.5px]">
                <GripVertical size={14} aria-hidden="true" className="flex-none text-axal-faint dark:text-gray-500" />
                <Pill tone="neutral">{titleCase(c.subject_kind) || 'Item'}</Pill>
                <span className="min-w-0 flex-1 truncate text-axal-ink dark:text-gray-100">{c.title || 'Untitled'}</span>
                <Action onClick={handlers.onRemoveContent && (() => handlers.onRemoveContent(c.subject_uid))}>Remove</Action>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-3"><Action onClick={handlers.onAddContent} testid="button-program-add-content">Add content</Action></div>
      </SectionCard>

      <SectionCard title="Assigned admins" meta={`${adminRows.length}`} testid="program-admins">
        {adminRows.length === 0 ? (
          <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No admin assigned yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {adminRows.map((a, i) => (
              <li key={a.user_uid || i} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="min-w-0 truncate text-axal-ink dark:text-gray-100">
                  {a.name || <Unrecorded>Name not recorded</Unrecorded>}
                  {a.assigned_at && <span className="text-axal-faint dark:text-gray-500"> · since {formatDay(a.assigned_at)}</span>}
                </span>
                <Action onClick={handlers.onUnassign && (() => handlers.onUnassign(a.user_uid))}>Remove</Action>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11.5px] leading-relaxed text-axal-faint dark:text-gray-500">
          Admins see this program’s content and each member’s completion. They author nothing.
        </p>
        <div className="mt-2"><Action onClick={handlers.onAssign} testid="button-program-assign">Assign</Action></div>
      </SectionCard>

      <SectionCard title="Members" meta={`${memberRows.length}`} testid="program-members">
        <div className="mb-3 flex items-center justify-between gap-2 text-[12.5px]">
          <span className="text-axal-muted dark:text-gray-400">
            Open to self-enrolment: {program.enrolment === 'open' ? 'yes' : program.enrolment === 'invite' ? 'no' : <Unrecorded>not recorded</Unrecorded>}
          </span>
          <Action onClick={handlers.onToggleOpen} testid="button-program-toggle-open">{program.enrolment === 'open' ? 'Close' : 'Open'}</Action>
        </div>
        {memberRows.length === 0 ? (
          <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No member enrolled yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {memberRows.map((m, i) => (
              <li key={m.user_uid || i} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="min-w-0 truncate text-axal-ink dark:text-gray-100">
                  {m.name || <Unrecorded>Name not recorded</Unrecorded>}
                  <span className="text-axal-faint dark:text-gray-500"> · {m.role ? titleCase(m.role) : 'role not recorded'}</span>
                </span>
                <span className="flex flex-none items-center gap-2">
                  <span className="tabular-nums text-axal-muted dark:text-gray-400">
                    {m.completed !== null && m.completed !== undefined && m.total !== null && m.total !== undefined ? `${m.completed} of ${m.total}` : <Unrecorded>Not recorded</Unrecorded>}
                  </span>
                  <Action onClick={handlers.onUnenrol && (() => handlers.onUnenrol(m.user_uid))}>Remove</Action>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3"><Action onClick={handlers.onEnrol} testid="button-program-enrol">Enrol</Action></div>
      </SectionCard>
    </div>
  );
}
