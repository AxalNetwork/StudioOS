/**
 * Spinout moderation console (D442).
 *
 * The approvals board reads open cases and does not decide them. This page
 * does: it lists cases that still have no resolved time, and an action goes
 * through the route that already writes `spinout_lab_active`. That write never
 * deactivates the platform account.
 *
 * A case that has been closed keeps the status it had. `under_review` plus a
 * resolved time is not open work, so it is not in this list.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Unreadable, Unrecorded } from '../../ui';

const REASONS = [
  'abuse', 'harassment', 'spam', 'fraudulent_application',
  'policy_violation', 'legal_compliance', 'inactivity', 'other',
];
const ACTIONS = [
  ['flag', 'Flag for review'],
  ['suspend', 'Suspend from the Lab'],
  ['eject', 'Eject from the Lab'],
  ['reinstate', 'Reinstate to the Lab'],
];
const SEVERITIES = ['low', 'medium', 'high'];

export default function SpinoutModerationPage() {
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(null);
  const [picked, setPicked] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [action, setAction] = useState('suspend');
  const [reason, setReason] = useState('policy_violation');
  const [severity, setSeverity] = useState('medium');
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState('');

  const load = useCallback(() => {
    setList(null);
    setListError(null);
    api.adminSpinoutModerationOpen().then(setList, (e) => {
      setListError(e);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const openMember = (userId) => {
    setPicked(userId);
    setHistory(null);
    setHistoryError(null);
    setActError('');
    api.adminSpinoutModeration(userId).then(setHistory, (e) => setHistoryError(e));
  };

  const apply = async (e) => {
    e.preventDefault();
    if (busy || !picked) return;
    setBusy(true);
    setActError('');
    try {
      await api.adminSpinoutModerate(picked, { action, reason_code: reason, severity });
      openMember(picked);
      load();
    } catch (err) {
      setActError(err?.message || 'The action could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const cases = Array.isArray(list?.cases) ? list.cases : [];
  const count = typeof list?.open_count === 'number' ? list.open_count : null;

  return (
    <div className="mx-auto max-w-4xl p-6" data-testid="spinout-moderation-page">
      <h1 className="text-[18px] font-extrabold tracking-tight text-axal-ink">Spinout moderation</h1>
      <p className="mt-1 text-[12.5px] leading-relaxed text-axal-muted">
        Open cases have no resolved time. Closing one records that time and leaves the status
        it already had, so a closed case can still say under review. This list is the unresolved
        ones. An action here changes Lab access only. It does not deactivate the account.
      </p>
      {!list && !listError && <p className="mt-2 text-[12px] text-axal-muted">Loading open cases…</p>}
      {list && (
        <p className="mt-2 text-[12px] text-axal-muted" data-testid="spinout-moderation-count">
          {count === null
            ? <Unrecorded reason="The open-case count was not in the response, so it is not shown as zero.">Count not recorded</Unrecorded>
            : <span className="tabular-nums">{count} open</span>}
        </p>
      )}

      {listError && (
        <div className="mt-4" data-testid="spinout-moderation-unreadable">
          <Unreadable
            what="Open moderation cases"
            claim="This is not a claim that no cases are open."
            onRetry={load}
          />
        </div>
      )}

      {list && cases.length === 0 && (
        <p className="mt-4 text-[12.5px] text-axal-muted" data-testid="spinout-moderation-empty">
          No open cases. The list was read and holds nothing.
        </p>
      )}

      {cases.length > 0 && (
        <ul className="mt-4 divide-y divide-axal-hairline rounded-xl border border-axal-hairline" data-testid="spinout-moderation-rows">
          {cases.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
              <span>
                <span className="text-[12.5px] font-semibold text-axal-ink">{row.who || 'Not recorded'}</span>
                <span className="ml-2 text-[11.5px] text-axal-muted">
                  {row.status} · {row.reason_code}
                  {row.severity ? ` · ${row.severity}` : ''}
                </span>
              </span>
              <button
                type="button"
                className="text-[12px] font-semibold text-axal-ink underline"
                onClick={() => openMember(row.user_id)}
              >
                Decide
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked && (
        <form className="mt-6 space-y-3" onSubmit={apply} data-testid="spinout-moderation-decide">
          <h2 className="text-[14px] font-extrabold text-axal-ink">This member</h2>
          {historyError && (
            <Unreadable
              what="This member's cases"
              claim="This is not a claim that they have no cases."
              onRetry={() => openMember(picked)}
            />
          )}
          {history && (
            <p className="text-[12px] text-axal-muted" data-testid="spinout-moderation-scope">
              {typeof history.lab_access === 'boolean'
                ? `Lab access is ${history.lab_access ? 'on' : 'off'}.`
                : <Unrecorded reason="The member read did not say whether Lab access is on.">Lab access not recorded</Unrecorded>}
              {' '}The account itself is not deactivated from here
              {history.moderation_scope ? ` (${history.moderation_scope})` : ''}.
            </p>
          )}
          <label className="block text-[12px] text-axal-muted">
            Action
            <select
              className="mt-1 block w-full rounded-lg border border-axal-hairline bg-transparent px-2 py-1 text-axal-ink"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-axal-muted">
            Reason
            <select
              className="mt-1 block w-full rounded-lg border border-axal-hairline bg-transparent px-2 py-1 text-axal-ink"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-axal-muted">
            Severity
            <select
              className="mt-1 block w-full rounded-lg border border-axal-hairline bg-transparent px-2 py-1 text-axal-ink"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {actError && <p className="text-[12px] text-red-700 dark:text-red-300" role="alert">{actError}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60 dark:bg-slate-200 dark:text-slate-900"
          >
            {busy ? 'Recording…' : 'Record this action'}
          </button>
        </form>
      )}
    </div>
  );
}
