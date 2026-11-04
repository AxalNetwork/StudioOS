// D1614 W8 (#3994, frontend half) — the Assignees picker on a task's sheet.
// Two groups from GET /api/teams/project/:id/assignable (#4286): this project's
// Team (its people, each with a role badge in their licence's accent and an
// open-task count), then its AI agents (role and status). Only this Team: the
// owner (2026-11-02) — a person or agent not on it is never offered, and the
// Worker refuses one anyway (422 assignee_not_member), as it refuses an admin
// on HQ read-only access (422 read_only_admin). A refusal is shown in the
// Worker's own words.
import React, { useCallback, useEffect, useState } from 'react';
import { BTN_SECONDARY, BTN_TEXT, MUTED, HonestBlock } from '../team/teamUi.jsx';
import { workAdapter } from './workAdapter.js';
import { assigneeGroups, refusalWords } from './workModel.js';

export const NO_TEAM = 'Nobody is on this Team yet. Add people or agents on the Team page first.';

export default function AssignPicker({ projectId, taskUid, current = null, onAssigned, onCancel }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [busy, setBusy] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const load = useCallback(async () => {
    setRead({ status: 'loading' });
    try {
      const r = await workAdapter.assignable(projectId);
      setRead(r.available ? { status: 'ready', groups: assigneeGroups(r.data) } : { status: 'off', reason: r.reason });
    } catch (e) {
      setRead({ status: 'error', message: refusalWords(e, 'Who is on this Team could not be read.') });
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const pick = async (assignee) => {
    setBusy(assignee ? `${assignee.kind}:${assignee.uid}` : 'none');
    setRefusal(null);
    try {
      const r = await workAdapter.assign(taskUid, assignee);
      if (!r.available) { setRefusal(r.reason); return; }
      onAssigned?.(r.data);
    } catch (e) {
      setRefusal(refusalWords(e, 'That could not be assigned. Try again.'));
    } finally { setBusy(null); }
  };

  const currentKey = current?.uid ? `${current.kind === 'agent' || current.agent_uid ? 'agent' : 'person'}:${current.uid}` : null;
  const empty = read.status === 'ready' && read.groups.every((g) => !g.options.length);
  return (
    <div role="group" aria-label="Assign to" className="mb-3 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="work-assign-picker">
      {read.status === 'loading' ? <p className={MUTED} data-testid="work-assign-loading">Reading the Team…</p> : null}
      {read.status === 'off' ? <HonestBlock>{read.reason}</HonestBlock> : null}
      {read.status === 'error' ? <HonestBlock role="alert" action={<button type="button" className={BTN_SECONDARY} onClick={load}>Try again</button>}>{read.message}</HonestBlock> : null}
      {empty ? <p className={MUTED} data-testid="work-assign-empty">{NO_TEAM}</p> : null}
      {read.status === 'ready' && !empty ? read.groups.filter((g) => g.options.length).map((g) => (
        <div key={g.key} className="mb-2" data-testid={`work-assign-group-${g.key}`}>
          <h3 className="mb-1 text-[11.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">{g.label}</h3>
          <ul className="space-y-1">
            {g.options.map((o) => {
              const key = `${o.kind}:${o.uid}`;
              return (
                <li key={key}>
                  <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-axal-ground disabled:opacity-60 dark:hover:bg-gray-800"
                    onClick={() => pick({ kind: o.kind, uid: o.uid })} disabled={busy != null} aria-current={key === currentKey ? 'true' : undefined}
                    data-testid="work-assign-option" data-key={key}>
                    <span className="flex items-center gap-2 text-[13px] font-medium text-axal-ink dark:text-gray-100">
                      {o.name}
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${o.badge.className}`} data-testid="work-assign-badge">{o.badge.text}</span>
                      {key === currentKey ? <span className={MUTED}>· assigned</span> : null}
                    </span>
                    <span className={MUTED}>{o.line}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )) : null}
      <div className="flex gap-2">
        {current?.uid ? <button type="button" className={BTN_TEXT} onClick={() => pick(null)} disabled={busy != null} data-testid="work-assign-none">Unassign</button> : null}
        <button type="button" className={BTN_TEXT} onClick={onCancel} data-testid="work-assign-cancel">Cancel</button>
      </div>
      {refusal ? <p role="alert" className="mt-1 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" data-testid="work-assign-refusal">{refusal}</p> : null}
    </div>
  );
}
