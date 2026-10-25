import React, { useEffect, useMemo, useState } from 'react';
import { Lightbox } from '../../../ui';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { DIALOG_BODY, DIALOG_LINES, DialogButtons, FIELD_LABEL, Field, INPUT, Pill, SUB } from './parts';
import {
  ACTIVE_PAIR, ASSIGNED_DONE, ASSIGN_NOTE_MAX, ASSIGN_TOLD, ENDED_DONE, NO_PROFILE, assignGrants, assignableCohorts,
  endLines, isActivePair, refusalSentence,
} from './programPagesModel';
import { cohortName } from './programsModel';

/**
 * D962 (#2795) — Mentor cohort access's two writes, each a dialog (N9):
 * Assign a mentor (PG6d) and End access (item 8). Both answer in place: a
 * refusal is one sentence keyed on its code (D960's `account_inactive`,
 * `already_assigned`, `already_ended`, `admin_frozen`, `branch_suspended`),
 * and today's `{ detail }` 400s and 404s read the Worker's own sentence.
 * Neither shows a "founders told" figure: the canvas draws none, and D960
 * makes `founders_notified` null when the notice sweep fails.
 */

/** Assign is a full page below 1024 px (PG20d), with "‹ People" and a sticky Back and Assign. */
const pageBar = ({ onBack }) => (
  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-axal-hairline bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
    <button type="button" onClick={onBack} className="text-[13px] font-bold text-axal-violet dark:text-violet-300">‹ People</button>
  </div>
);

/**
 * PG6d. The advisor search runs over the assignable list (R6, which part 7
 * clears of deactivated accounts) and keeps "No advisor profile yet"; the
 * cohort picker offers scheduled or running cohorts with their dates; a pair
 * that is already active is marked, and nothing is sent for it.
 */
export function AssignDialog({ assignments, timeline, cycleId = null, onClose, onAssigned }) {
  const [advisors, setAdvisors] = useState({ status: 'loading', items: [] });
  const [q, setQ] = useState('');
  const [advisorId, setAdvisorId] = useState(null);
  const [cohort, setCohort] = useState(cycleId ? String(cycleId) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    let live = true;
    api.adminAssignableAdvisors().then(
      (r) => { if (live) setAdvisors({ status: Array.isArray(r?.items) ? 'ready' : 'error', items: Array.isArray(r?.items) ? r.items : [] }); },
      (e) => { reportError('admin-programs:assignable', e); if (live) setAdvisors({ status: 'error', items: [] }); },
    );
    return () => { live = false; };
  }, []);
  const cohorts = assignableCohorts(timeline);
  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return advisors.items.filter((a) => !needle || `${a.name || ''} ${a.email || ''}`.toLowerCase().includes(needle)).slice(0, 8);
  }, [advisors.items, q]);
  const advisor = advisors.items.find((a) => Number(a.id) === Number(advisorId)) || null;
  const chosen = cohorts.find((c) => String(c.id) === String(cohort)) || null;
  const active = Boolean(advisor && chosen && isActivePair(assignments, advisor.id, chosen.id));
  const go = async () => {
    if (!advisor || !chosen || active) return;
    setBusy(true);
    setRefusal('');
    try {
      await api.adminAssignAdvisorCohort({ advisor_user_id: Number(advisor.id), cohort_cycle_id: Number(chosen.id), note: note.trim() || null });
      setDone(ASSIGNED_DONE);
      onAssigned?.();
    } catch (e) {
      setRefusal(refusalSentence(e, 'That could not be assigned. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Lightbox label="Assign a mentor" title="Assign a mentor" onClose={onClose} pageBelow="lg" bar={pageBar} testId="programs-assign-dialog"
      footer={<DialogButtons onClose={onClose} action="Assign" busy={busy} disabled={!advisor || !chosen || active} onAction={go} refusal={refusal} done={done} testId="programs-assign-go" />}>
      <div className={DIALOG_BODY}>
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Mentor · advisors only</span>
          <input className={`${INPUT} w-full`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search advisors" aria-label="Search advisors" data-testid="programs-assign-search" />
          {advisors.status === 'loading' ? <span className={SUB}>Reading the advisors…</span> : null}
          {advisors.status === 'error' ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="programs-assign-advisors-unreadable">The advisors could not be read. That is not the same as none.</p> : null}
          {advisors.status === 'ready' && !advisors.items.length ? <span className={SUB} data-testid="programs-assign-no-advisors">No account has the Advisor role and an active account.</span> : null}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {found.map((a) => (
              <li key={a.id}>
                <button type="button" aria-pressed={Number(advisorId) === Number(a.id)} onClick={() => setAdvisorId(a.id)} data-testid={`programs-assign-advisor-${a.id}`}
                  className={`flex min-h-[44px] w-full flex-wrap items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-semibold text-axal-ink dark:text-gray-100 ${Number(advisorId) === Number(a.id) ? 'bg-axal-ground dark:bg-gray-800' : 'hover:bg-axal-ground dark:hover:bg-gray-800'}`}>
                  <span>{`${a.name || 'Name not recorded'} · Advisor`}</span>
                  {a.has_advisor_profile ? null : <Pill tone="amber"><span aria-hidden="true">!</span>{NO_PROFILE}</Pill>}
                  {Number(advisorId) === Number(a.id) ? <span className={SUB}>Selected</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Cohort</span>
          <select className={`${INPUT} w-full`} value={cohort} onChange={(e) => setCohort(e.target.value)} data-testid="programs-assign-cohort">
            <option value="">Choose a cohort…</option>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {!cohorts.length ? <span className={SUB}>No cohort is scheduled or running.</span> : null}
        </label>
        {active ? <p role="status" className="m-0 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid="programs-assign-active">{ACTIVE_PAIR}</p> : null}
        <Field label="Note" value={note} onChange={setNote} max={ASSIGN_NOTE_MAX} rows={3} placeholder="Why, for the record" testId="programs-assign-note" />
        <ul className={DIALOG_LINES} data-testid="programs-assign-grants">
          <li>{assignGrants(advisor?.name, chosen ? cohortName(chosen.cycle) : null)}</li>
          <li>{ASSIGN_TOLD}</li>
        </ul>
      </div>
    </Lightbox>
  );
}

/** Item 8: what ending does, said before it is done; offered on active rows only. */
export function EndDialog({ row, cohort, onClose, onEnded }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const name = row.advisor_name || null;
  const go = async () => {
    setBusy(true);
    setRefusal('');
    try {
      await api.adminEndAdvisorCohortAssignment(row.id);
      setDone(ENDED_DONE);
      onEnded?.();
    } catch (e) {
      setRefusal(refusalSentence(e, 'That access was not ended. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const label = `End ${name || 'this mentor'}’s access?`;
  return (
    <Lightbox label={label} title={label} sub={cohort} onClose={onClose} testId="programs-end-dialog"
      footer={<DialogButtons onClose={onClose} action="End access" tone="danger" busy={busy} onAction={go} refusal={refusal} done={done} testId="programs-end-go" />}>
      <div className={DIALOG_BODY}>
        <ul className={DIALOG_LINES} data-testid="programs-end-lines">{endLines(name, cohort).map((l) => <li key={l}>{l}</li>)}</ul>
      </div>
    </Lightbox>
  );
}
