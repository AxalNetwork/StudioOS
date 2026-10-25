import React, { useCallback, useState } from 'react';
import { api } from '../../lib/api';
import { actionPrimary, usePhoneWidth } from '../../ui';
import AdminBoardFrame from './AdminBoardFrame';
import { AssignDialog, EndDialog } from './programs/MentorDialogs';
import { BlockFailed, CARD, H2, INPUT, Pill, SUB, Skeleton, TD, TH } from './programs/parts';
import { useRead } from './programs/useProgramReads';
import {
  HISTORY_LIMIT, NO_MENTORS, PAGE_SIZE, PEOPLE_FOOT, PEOPLE_FOOT_UNREAD, VISIBLE_WAITS, countLine, filterPeople, nextCohort,
  noMentorsLine, peopleRows,
} from './programs/programPagesModel';
import { NOT_READ_YET, WITHIN_500, cohortName, isReady } from './programs/programsModel';

/**
 * Admin — which advisor may read which Lab cohort's founders.
 *
 * WHAT THIS GRANTS, said plainly because it is the whole point: an assignment
 * lets one advisor read the NAMES AND EMAIL ADDRESSES of the founders in one
 * Lab cohort. It changes nothing in the Lab. It is the only way an advisor
 * gets that access, and ending it is the only way they lose it.
 *
 * WHY IT IS ITS OWN PAGE rather than a tab on the Spin-Out Lab console, which
 * is where an admin would naturally look. That console is a Lab-owned file
 * under a standing do-not-touch instruction, and the split matches how the
 * backend was already built: these endpoints live at
 * `/api/advisors/admin/cohort-assignments`, not under `/api/admin/cohort/*`.
 * The assignment is advisor-domain; the cohort it points at is the Lab's.
 *
 * IT SHOWS ENDED ROWS. Migration 206 soft-deletes precisely so the record of
 * who could see a batch, and when, survives the access itself. A list that hid
 * them could not answer the question the record exists for.
 *
 * IT SHOWS THE TARGET'S CURRENT ROLE. A still-active row beside a role that is
 * no longer advisor is a grant the worker now refuses at read time — the
 * access is already gone, but the row is not, and only a person can decide to
 * end it.
 */

/**
 * D962 (#2795): the console's body is People (PG6), mounted by Programs ›
 * Mentor cohort access › People with `embedded` (the program header replaces
 * the heading, and mounting the body rather than the default export leaves
 * the page one rail). It draws the toolbar (search, Cohort, Status, Role
 * changed, Sort), 25 rows a page with a count, and the canvas's columns; the
 * email is not drawn. Assign and End access are dialogs (`MentorDialogs`),
 * and each row's earlier episodes come from 565's history (N16).
 */
export function AdvisorCohortAssignmentsBody({ embedded = false, onChanged, refresh = 0 } = {}) {
  const phone = usePhoneWidth();
  const [own, setOwn] = useState(0);
  // `refresh` is the page's count of writes made from its header, so a grant made there reads here too.
  const tick = own + refresh;
  const reload = useCallback(() => { setOwn((t) => t + 1); onChanged?.(); }, [onChanged]);
  const assignments = useRead('assignments', 'assignments', tick, true, () => api.adminAdvisorCohortAssignments().then(listOf('The mentor assignments')));
  const timeline = useRead('timeline', 'timeline', tick, true, () => api.adminCohortTimeline().then(cyclesOf));
  const history = useRead('history', 'history', tick, true, () => api.adminAdvisorCohortHistory({ limit: HISTORY_LIMIT }).then(listOf('The access history')));
  const [q, setQ] = useState('');
  const [cohort, setCohort] = useState('');
  const [status, setStatus] = useState('both');
  const [roleChanged, setRoleChanged] = useState(false);
  const [sort, setSort] = useState('assigned');
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState(null);
  const now = Date.now();
  const p = peopleRows(assignments, timeline, history, now);
  const statuses = status === 'both' ? ['active', 'ended'] : [status];
  const rows = p.state === 'ready' ? filterPeople(p.rows, { q, cohort, status: statuses, roleChanged, sort }) : [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * PAGE_SIZE, at * PAGE_SIZE + PAGE_SIZE);
  const cycles = isReady(timeline) && Array.isArray(timeline.data?.cycles) ? timeline.data.cycles : [];
  const cohortOf = (r) => { const c = cycles.find((x) => Number(x.id) === Number(r.cohort_cycle_id)); return c ? cohortName(c) : `Cycle #${r.cohort_cycle_id}`; };
  const next = nextCohort(timeline);
  const reset = (fn) => (v) => { fn(v); setPage(0); };
  const openAssign = () => setDialog({ kind: 'assign' });

  return (
    <div className="flex flex-col gap-4" data-testid="advisor-cohort-assignments">
      {embedded ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 text-lg font-extrabold tracking-tight">Advisor cohort access</h1>
          <button type="button" className={actionPrimary} onClick={openAssign} data-testid="advisor-cohort-assign">Assign a mentor</button>
        </div>
      )}
      <p className={`m-0 ${SUB}`}>
        An assignment lets one advisor read the names and email addresses of the founders in one Spin-Out Lab cohort.
        It changes nothing in the Lab, and it is the only way an advisor gets that access.
      </p>
      {p.state === 'loading' ? <Skeleton lines={4} /> : null}
      {p.state === 'unreadable' ? (
        <BlockFailed what="The mentor assignments" onRetry={reload} testId="advisor-cohort-unreadable"
          claim="Nothing is listed rather than an empty list, because an empty list would say nobody has access." />
      ) : null}
      {p.state === 'ready' && !p.rows.length ? (
        <section className={`${CARD} flex flex-col items-center gap-2 px-6 py-10 text-center`} data-testid="advisor-cohort-none">
          <span aria-hidden="true" className="text-[22px] font-bold text-axal-violet dark:text-violet-300">+</span>
          <h2 className={H2}>{NO_MENTORS}</h2>
          {noMentorsLine(next) ? <p className={`m-0 ${SUB}`} data-testid="advisor-cohort-none-next">{noMentorsLine(next)}</p> : null}
          <button type="button" className={actionPrimary} onClick={openAssign} data-testid="advisor-cohort-none-assign">Assign a mentor</button>
        </section>
      ) : null}
      {p.state === 'ready' && p.rows.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2" data-testid="advisor-cohort-toolbar">
            <input type="search" className={`${INPUT} min-w-[200px] flex-1`} value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Search mentor or cohort" aria-label="Search mentor or cohort" data-testid="advisor-cohort-search" />
            <select className={INPUT} value={cohort} onChange={(e) => reset(setCohort)(e.target.value)} aria-label="Cohort" data-testid="advisor-cohort-filter-cohort">
              <option value="">Every cohort</option>
              {cycles.map((c) => <option key={c.id} value={c.id}>{cohortName(c)}</option>)}
            </select>
            <select className={INPUT} value={status} onChange={(e) => reset(setStatus)(e.target.value)} aria-label="Status" data-testid="advisor-cohort-filter-status">
              <option value="both">Status: Active, Ended</option>
              <option value="active">Active</option>
              <option value="ended">Ended</option>
            </select>
            <label className="flex min-h-[36px] items-center gap-2 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">
              <input type="checkbox" checked={roleChanged} onChange={(e) => reset(setRoleChanged)(e.target.checked)} data-testid="advisor-cohort-filter-role" />
              Role changed
            </label>
            <select className={INPUT} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" data-testid="advisor-cohort-sort">
              <option value="assigned">Sort: Assigned</option>
              <option value="cohort">Sort: Cohort</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>
          <p className="m-0 font-mono text-[12px] font-semibold text-axal-muted dark:text-gray-400" data-testid="advisor-cohort-count">
            {`${countLine(at * PAGE_SIZE, shown.length, rows.length)}${p.capped ? `, ${WITHIN_500}` : ''}`}
          </p>
          {phone ? <button type="button" className={`${actionPrimary} w-full`} onClick={openAssign} data-testid="advisor-cohort-phone-assign">Assign a mentor</button> : null}
          {!rows.length ? <p className={`m-0 ${SUB}`} data-testid="advisor-cohort-filtered-none">No assignment matches these filters.</p> : null}
          {rows.length && phone ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="advisor-cohort-cards">
              {shown.map((r) => (
                <li key={r.id} className={`${CARD} flex items-start justify-between gap-3 px-4 py-3 ${r.open ? '' : 'opacity-70'}`} data-testid={`advisor-cohort-card-${r.id}`}>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{r.name}</span>
                    <span className={SUB}>{`${r.cohort} · ${r.visible || NOT_READ_YET}${r.visible ? '' : ' visible'}`}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {r.notAdvisor && r.open ? <Pill tone="amber"><span aria-hidden="true">!</span>Not an Advisor now</Pill> : null}
                      {r.deactivated ? <Pill tone="amber"><span aria-hidden="true">!</span>Deactivated</Pill> : null}
                      {!r.notAdvisor && !r.deactivated ? <Pill tone={r.open ? 'green' : 'muted'}>{r.open ? 'Active' : 'Ended'}</Pill> : null}
                    </span>
                  </span>
                  {r.open ? (
                    <button type="button" aria-label={`End ${r.name}’s access`} onClick={() => setDialog({ kind: 'end', row: r.row })}
                      className="h-[44px] w-[44px] flex-none rounded-[9px] border border-axal-hairline bg-white text-[16px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid={`advisor-cohort-card-${r.id}-menu`}>⋯</button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {rows.length && !phone ? (
            <div className={`${CARD} overflow-x-auto`}>
              <table className="w-full min-w-[980px] border-collapse text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="advisor-cohort-table">
                <thead>
                  <tr className="border-b border-axal-hairline dark:border-gray-700">
                    {['Mentor', 'Cohort', 'Assigned', 'Ended', 'Founders visible', 'Note', ''].map((h) => <th key={h || 'actions'} className={TH}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className={`border-b border-axal-hairline last:border-0 dark:border-gray-800 ${r.open ? '' : 'text-axal-muted dark:text-gray-400'}`} data-testid={`advisor-cohort-row-${r.id}`}>
                      <td className={TD}>
                        <span className={`block ${r.open ? 'font-bold' : 'font-semibold'}`}>{r.name}</span>
                        <span className={`block ${SUB}`}>{r.role}</span>
                        {r.notAdvisor && r.open ? <span className="mt-1 block"><Pill tone="amber" testId={`advisor-cohort-row-${r.id}-role`}><span aria-hidden="true">!</span>Not an Advisor now</Pill></span> : null}
                        {r.deactivated ? <span className="mt-1 block"><Pill tone="amber" testId={`advisor-cohort-row-${r.id}-deactivated`}><span aria-hidden="true">!</span>Deactivated</Pill></span> : null}
                      </td>
                      <td className={TD}>
                        <span className="block">{r.cohort}</span>
                        {r.earlier.length ? <span className={`block ${SUB}`} data-testid={`advisor-cohort-row-${r.id}-earlier`}>{`Earlier: ${r.earlier.join(', ')}`}</span> : null}
                      </td>
                      <td className={TD}>{r.assigned}</td>
                      <td className={`${TD} font-mono`}>{r.ended}</td>
                      <td className={`${TD} font-mono`} data-testid={`advisor-cohort-row-${r.id}-visible`}>{r.visible || <span className="font-display italic">{NOT_READ_YET}</span>}</td>
                      <td className={TD}>{r.note}</td>
                      <td className={`${TD} text-right`}>
                        {r.open ? (
                          <button type="button" onClick={() => setDialog({ kind: 'end', row: r.row })} className="rounded-[9px] border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800" data-testid={`advisor-cohort-row-${r.id}-end`}>
                            End access
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {pages > 1 ? (
            <div className="flex items-center justify-end gap-2 text-[12px]">
              <button type="button" className="rounded-[9px] border border-axal-hairline px-2.5 py-1 font-semibold disabled:opacity-50 dark:border-gray-700" disabled={at <= 0} onClick={() => setPage(at - 1)}>Previous</button>
              <span className={SUB}>{`Page ${at + 1} of ${pages}`}</span>
              <button type="button" className="rounded-[9px] border border-axal-hairline px-2.5 py-1 font-semibold disabled:opacity-50 dark:border-gray-700" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} data-testid="advisor-cohort-next">Next</button>
            </div>
          ) : null}
          <p className={`m-0 ${SUB}`} data-testid="advisor-cohort-foot">
            {p.historyRead ? PEOPLE_FOOT : PEOPLE_FOOT_UNREAD}
            {p.historyCapped ? ' Earlier episodes are read from the newest 200 grants and ends.' : ''}
            {` Founders visible: ${VISIBLE_WAITS}`}
          </p>
        </>
      ) : null}
      {dialog?.kind === 'assign' ? <AssignDialog assignments={assignments} timeline={timeline} cycleId={dialog.cycleId} onClose={() => setDialog(null)} onAssigned={reload} /> : null}
      {dialog?.kind === 'end' ? <EndDialog row={dialog.row} cohort={cohortOf(dialog.row)} onClose={() => setDialog(null)} onEnded={reload} /> : null}
    </div>
  );
}

/** A reply without its list is a failed read, never an empty one. */
const listOf = (what) => (reply) => {
  if (!Array.isArray(reply?.items)) throw new Error(`${what} did not come back as a list.`);
  return reply;
};
const cyclesOf = (reply) => {
  if (!Array.isArray(reply?.cycles)) throw new Error('The cohort cycles did not come back as a list.');
  return reply;
};

// D774 (#2100): S18 drew no rail. The board's page, in the Admin boards' frame.
export default function AdvisorCohortAssignments() {
  return (
    <AdminBoardFrame workspace="Advisor cohort access" note="Eadwyn reads the advisors and cohorts on this page. Access changes only when you save it." data-testid="admin-board-advisor-cohort-access">
      <AdvisorCohortAssignmentsBody />
    </AdminBoardFrame>
  );
}
