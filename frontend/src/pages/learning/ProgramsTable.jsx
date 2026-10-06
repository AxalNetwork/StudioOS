import React from 'react';
import { Link } from 'react-router-dom';
import { Unrecorded } from '../../ui';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE } from './learningModel';

const GRID = 'sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5.5rem_minmax(0,1fr)_5.5rem] sm:items-center sm:gap-3';

const count = (n, one, many) => {
  const v = Number(n);
  return n === null || n === undefined || !Number.isFinite(v) ? null : `${v} ${v === 1 ? one : many}`;
};

/**
 * Regional programs as a list (D562; data #1159). One component, two pages:
 *
 *   scope 'studio'    the Super Admin's `/learning/studio/programs`: every
 *                     program, with its admins, each row opening the editor;
 *   scope 'assigned'  an admin's `/learning/programs`: the programs a Super
 *                     Admin assigned them, each row opening the read-only view.
 *
 * Props, in the shape #1159 plans: `programs` is
 * `[{ uid, name, region, members_count, admins: [{ uid, name }], content_count }]`.
 * A count the route does not send is "Not recorded", never 0.
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
      ? { title: 'No program yet', body: 'A program groups content for a region. Create one to assign admins and enrol members.' }
      : { title: 'No program assigned', body: 'A Super Admin assigns regional programs to admins. When one is assigned to you, its content and member progress appear here, read-only.' },
  });
  return (
    <SectionCard title={studio ? 'Programs' : 'Assigned to you'} meta={status === 'ready' && rows.length ? `${rows.length}` : null} testid={`programs-${scope}`}>
      {block || (
        <>
          <div className={`hidden border-b border-axal-hairline pb-2 text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:border-gray-800 dark:text-gray-500 ${GRID}`} aria-hidden="true">
            <span>Program</span><span>Region</span><span>Members</span><span>{studio ? 'Admins' : 'Enrolment'}</span><span>Content</span>
          </div>
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
            {rows.map((p, i) => {
              const href = p.uid ? (studio ? `/learning/studio/programs/${encodeURIComponent(p.uid)}` : `/learning/programs/${encodeURIComponent(p.uid)}`) : null;
              const admins = Array.isArray(p.admins) ? (p.admins.length ? p.admins.map((a) => a.name).join(', ') : 'None assigned') : null;
              return (
                <li key={p.uid || i} className={`grid grid-cols-2 gap-x-3 gap-y-1 py-2.5 text-[12.5px] ${GRID}`} data-testid={`program-row-${p.uid}`}>
                  <span className="col-span-2 font-semibold sm:col-span-1">
                    {href
                      ? <Link to={href} className="text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{p.name || 'Untitled program'}</Link>
                      : <span className="text-axal-ink dark:text-gray-100">{p.name || 'Untitled program'}</span>}
                  </span>
                  <span className="text-axal-muted dark:text-gray-400">{p.region || <Unrecorded>Region not recorded</Unrecorded>}</span>
                  <span className="tabular-nums text-axal-muted dark:text-gray-400">{count(p.members_count, 'member', 'members') || <Unrecorded>Not recorded</Unrecorded>}</span>
                  <span className="text-axal-muted dark:text-gray-400">
                    {studio
                      ? (admins || <Unrecorded>Not recorded</Unrecorded>)
                      : (p.enrolment === 'open' ? 'Open' : p.enrolment === 'invite' ? 'By invitation' : <Unrecorded>Not recorded</Unrecorded>)}
                  </span>
                  <span className="tabular-nums text-axal-muted dark:text-gray-400">{count(p.content_count, 'item', 'items') || <Unrecorded>Not recorded</Unrecorded>}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SectionCard>
  );
}
