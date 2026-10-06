// D580 (#1207) — the Spin-Out Lab's "83(b) review" tab in HQ.
//
// An Axal admin is assigned to each startup as its 83(b) operator (the
// owner's answer 1A), and records reviews of the startup's 83(b) filing record
// (2A). A review does not gate graduation (3A). Every write goes through the
// Worker's `routes/admin_83b_review.ts`, which records the acting admin with
// logAdminAction. The founder sees the same operator, last review and next
// follow-up on /spinout-lab/83b.
//
// A failed list read says so with a retry; a refused write prints the
// Worker's error. Nothing on this tab is a default: the operator starts
// unassigned, and a review has no outcome until one is chosen.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { section83bReviewApi } from '../../lib/api/section83bReview.js';
import { reportError } from '../../lib/log';
import { Unrecorded, Unreadable } from '../../ui';
import { OPERATOR_ROLE_NOTE } from '../../components/spinout/OperatorAssistRow';

export const WRITE_ERRORS = {
  no_operator_assigned: 'Assign an operator before recording a review.',
  operator_not_an_admin: 'The operator must be an active Axal admin.',
  outcome_invalid: 'Choose whether the record is complete.',
  follow_up_date_invalid: 'The follow-up date is not a calendar date.',
  follow_up_date_past: 'The follow-up date is in the past.',
  tracker_not_on_project: 'That tracker belongs to another startup.',
};

/** A review can be sent once an outcome is chosen and the startup has an operator. */
export const canSubmitReview = ({ busy, outcome, operator }) => !busy && !!outcome && !!operator;

// `request` puts the Worker's code on `e.code` and its body on `e.data`.
export const errorText = (e) => WRITE_ERRORS[e?.code || e?.data?.error] || e?.message || 'The write failed.';

function ReviewForm({ startup, onSaved }) {
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await section83bReviewApi.adminReview(startup.project_id, {
        outcome, note: note || null, follow_up_date: followUp || null,
      });
      setOutcome(''); setNote(''); setFollowUp('');
      onSaved();
    } catch (e2) {
      reportError('AdminSection83bReview:review', e2);
      setErr(errorText(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-xs" data-testid={`form-83b-review-${startup.project_id}`}>
      <select value={outcome} onChange={(e) => setOutcome(e.target.value)} required aria-label="Outcome" className="border rounded px-1.5 py-1 dark:bg-gray-900">
        <option value="" disabled>Outcome…</option>
        <option value="complete">Record complete</option>
        <option value="incomplete">Record incomplete</option>
      </select>
      <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} aria-label="Next follow-up" className="border rounded px-1.5 py-1 dark:bg-gray-900" />
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" aria-label="Note" className="border rounded px-1.5 py-1 flex-1 min-w-[8rem] dark:bg-gray-900" />
      <button type="submit" disabled={!canSubmitReview({ busy, outcome, operator: startup.operator })} className="px-2 py-1 rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
        Record review
      </button>
      {!startup.operator && <span className="text-gray-500">{WRITE_ERRORS.no_operator_assigned}</span>}
      {err && <span role="alert" className="text-red-700 dark:text-red-300">{err}</span>}
    </form>
  );
}

export function StartupRow({ startup, operators, onSaved }) {
  const [err, setErr] = useState('');
  const assign = async (value) => {
    setErr('');
    try {
      await section83bReviewApi.adminAssign(startup.project_id, value === '' ? null : Number(value));
      onSaved();
    } catch (e) {
      reportError('AdminSection83bReview:assign', e);
      setErr(errorText(e));
    }
  };
  const last = startup.last_review;
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800 align-top" data-testid={`row-83b-review-${startup.project_id}`}>
      <td className="py-2 pr-3 font-semibold">{startup.project_name}</td>
      <td className="py-2 pr-3">
        <select value={startup.operator ? String(startup.operator.user_id) : ''} onChange={(e) => assign(e.target.value)} aria-label="Operator" className="border rounded px-1.5 py-1 text-xs dark:bg-gray-900">
          <option value="">Unassigned</option>
          {operators.map((o) => <option key={o.id} value={String(o.id)}>{o.name || o.email}</option>)}
        </select>
        {err && <div role="alert" className="text-xs text-red-700 dark:text-red-300">{err}</div>}
      </td>
      <td className="py-2 pr-3 text-xs">
        {last
          ? `${last.outcome === 'complete' ? 'Record complete' : 'Record incomplete'} · ${String(last.reviewed_at).slice(0, 10)}${last.note ? ` · ${last.note}` : ''}`
          : <Unrecorded reason="No review of this startup's filing record yet." />}
      </td>
      <td className="py-2 pr-3 text-xs">
        {startup.next_follow_up || <Unrecorded reason={last ? 'The last review set no follow-up date.' : 'No review yet.'} />}
      </td>
      <td className="py-2"><ReviewForm startup={startup} onSaved={onSaved} /></td>
    </tr>
  );
}

export default function AdminSection83bReview() {
  const [state, setState] = useState({ status: 'loading', startups: [], operators: [] });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const r = await section83bReviewApi.adminList();
      setState({ status: 'ready', startups: r?.startups || [], operators: r?.operators || [] });
    } catch (e) {
      reportError('AdminSection83bReview:list', e);
      setState({ status: 'unreadable', startups: [], operators: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div data-testid="admin-83b-review" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-600 dark:text-gray-300">{OPERATOR_ROLE_NOTE} A review does not gate graduation.</p>
        <button type="button" onClick={load} className="text-xs font-semibold text-gray-500 flex items-center gap-1.5"><RefreshCw size={12} /> Refresh</button>
      </div>
      {state.status === 'unreadable' ? (
        <Unreadable what="The 83(b) review list" claim="No startup is shown as unassigned while it cannot be read." onRetry={load} />
      ) : state.status === 'loading' ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : state.startups.length === 0 ? (
        <p className="text-xs text-gray-500">No startup has an 83(b) tracker yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-gray-500">
              <th className="pb-1 pr-3">Startup</th><th className="pb-1 pr-3">Operator</th>
              <th className="pb-1 pr-3">Last review</th><th className="pb-1 pr-3">Next follow-up</th><th className="pb-1">Record a review</th>
            </tr>
          </thead>
          <tbody>
            {state.startups.map((s) => <StartupRow key={s.project_id} startup={s} operators={state.operators} onSaved={load} />)}
          </tbody>
        </table>
      )}
    </div>
  );
}
