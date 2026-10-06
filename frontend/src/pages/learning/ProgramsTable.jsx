import React from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded } from '../../ui';
import { titleCase } from '../../lib/absence';
import { SectionCard, stateBlock } from './LearningStates';
import { CONTENT_STATUS_TONE, NOT_LIVE } from './learningModel';

const GRID = 'sm:grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_6.5rem_minmax(0,1fr)_6.5rem] sm:items-center sm:gap-3';

/** "12 members", the route's zero in words ("None enrolled"), or null when the route sent no count. */
const count = (n, one, many, none) => {
  const v = Number(n);
  if (n === null || n === undefined || n === '' || !Number.isFinite(v)) return null;
  return v === 0 ? none : `${v} ${v === 1 ? one : many}`;
};

const ENROLMENT = { open: 'Open enrolment', invite: 'By invitation' };

/**
 * Regional programs as a list (D562; D558's routes). One component, two pages:
 *
 *   scope 'studio'    the Super Admin's `/learning/studio/programs`, from
 *                     `GET /api/admin/learning/programs`: every program, drafts
 *                     and archived included, each row opening its editor;
 *   scope 'assigned'  an admin's `/learning/programs`, from `GET
 *                     /api/learning/programs/mine`: the programs assigned to
 *                     them (the Super Admin: every one), each row opening the
 *                     read-only view.
 *
 * Props, in the routes' shape: `programs` is `[{ uid, name, region,
 * description, enrolment, status, learners, … }]`, where `learners` counts
 * the active members, the studio's rows add `admins` (a count) and the
 * assigned rows add `contents` (a count).
 *
 * EACH LIST DRAWS WHAT ITS ROUTE COUNTS. The studio list counts admins and
 * not content, the assigned list content and not admins, so each scope draws
 * its own columns, and the studio says once that content is not counted here
 * rather than "Not recorded" on every row. A count the route does not send is
 * "Not recorded", never 0.
 */
export default function ProgramsTable({ status, scope = 'studio', programs, reason = NOT_LIVE.programs, onRetry }) {
  const rows = programs || [];
  const studio = scope === 'studio';
  const block = stateBlock({
    status, reason, onRetry,
    what: studio ? 'the programs' : 'your programs',
    claim: studio ? 'This is not a claim that no program exists.' : 'This is not a claim that no program is assigned to you.',
    isEmpty: rows.length === 0,
    empty: studio
      ? { title: 'No program yet', body: 'A program groups content for a region. Create one to assign admins and enrol members.', cta: { label: 'New program', to: '/learning/studio/programs?new=program' } }
      : {
        title: 'No program assigned',
        body: 'A Super Admin assigns regional programs to admins. When one is assigned to you, its content and member progress appear here, read-only.',
        cta: { label: 'Ask HQ: open a ticket', to: '/help/tickets' },
      },
  });
  const notRecorded = <Unrecorded>Not recorded</Unrecorded>;
  return (
    <SectionCard title={studio ? 'Programs' : 'Assigned to you'} meta={status === 'ready' && rows.length ? `${rows.length}` : null} testid={`programs-${scope}`}>
      {block || (
        <>
          <div className={`hidden border-b border-axal-hairline pb-2 text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:border-gray-800 dark:text-gray-500 ${GRID}`} aria-hidden="true">
            <span>Program</span><span>Region</span><span>Members</span><span>{studio ? 'Admins' : 'Enrolment'}</span><span>{studio ? 'Enrolment' : 'Content'}</span>
          </div>
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
            {rows.map((p, i) => {
              const href = p.uid ? (studio ? `/learning/studio/programs/${encodeURIComponent(p.uid)}` : `/learning/programs/${encodeURIComponent(p.uid)}`) : null;
              const enrolment = ENROLMENT[p.enrolment] || notRecorded;
              return (
                <li key={p.uid || i} className={`grid grid-cols-2 gap-x-3 gap-y-1 py-2.5 text-[12.5px] ${GRID}`} data-testid={`program-row-${p.uid}`}>
                  <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 font-semibold sm:col-span-1">
                    {href
                      ? <Link to={href} className="text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{p.name || 'Untitled program'}</Link>
                      : <span className="text-axal-ink dark:text-gray-100">{p.name || 'Untitled program'}</span>}
                    <Pill tone={CONTENT_STATUS_TONE[p.status] || 'neutral'}>{titleCase(p.status) || 'Status not recorded'}</Pill>
                  </span>
                  <span className="text-axal-muted dark:text-gray-400">{p.region || <Unrecorded>Region not recorded</Unrecorded>}</span>
                  <span className="tabular-nums text-axal-muted dark:text-gray-400">{count(p.learners, 'member', 'members', 'None enrolled') || notRecorded}</span>
                  <span className="tabular-nums text-axal-muted dark:text-gray-400">
                    {studio ? (count(p.admins, 'admin', 'admins', 'None assigned') || notRecorded) : enrolment}
                  </span>
                  <span className="tabular-nums text-axal-muted dark:text-gray-400">
                    {studio ? enrolment : (count(p.contents, 'item', 'items', 'No content') || notRecorded)}
                  </span>
                </li>
              );
            })}
          </ul>
          {studio && (
            <p className="mt-3 border-t border-axal-hairline pt-3 text-[11.5px] text-axal-faint dark:border-gray-800 dark:text-gray-500" data-testid="programs-content-note">
              <Unrecorded reason="The program list counts members and admins only.">Content is not counted in this list.</Unrecorded> Open a program to see its content in order.
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}
