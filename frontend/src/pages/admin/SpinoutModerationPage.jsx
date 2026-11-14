/**
 * Spinout moderation console (D442, D448).
 *
 * The approvals board counts cases awaiting a decision and does not decide
 * them. This page does. Awaiting a decision is a flag that has not been
 * closed. A suspension or an ejection that has not been closed is a sanction
 * in force, listed apart from that count, so the two screens agree on a flag.
 * Closing stamps a resolved time and does not change Lab access. Reinstating
 * turns Lab access back on. Neither deactivates the platform account.
 *
 * `resolved` is the already-read payload a test paints. The page itself
 * loads through the api when it is omitted.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  ['close', 'Close the case'],
];
const SEVERITIES = ['low', 'medium', 'high'];

function countSentence(shown, total, noun) {
  if (typeof total !== 'number') {
    return (
      <Unrecorded reason="The count was not in the response, so it is not shown as zero.">
        Count not recorded
      </Unrecorded>
    );
  }
  if (shown < total) {
    return <span className="tabular-nums">Showing {shown} of {total} {noun}</span>;
  }
  return <span className="tabular-nums">{total} {noun}</span>;
}

export default function SpinoutModerationPage({ resolved = null } = {}) {
  const [list, setList] = useState(resolved ? resolved.list ?? null : null);
  const [listError, setListError] = useState(resolved ? resolved.error ?? null : null);
  const [picked, setPicked] = useState(resolved?.picked ?? null);
  const [pickedWho, setPickedWho] = useState(resolved?.who ?? '');
  const [history, setHistory] = useState(resolved?.history ?? null);
  const [historyError, setHistoryError] = useState(resolved?.historyError ?? null);
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('policy_violation');
  const [severity, setSeverity] = useState('medium');
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState(resolved?.actError ?? null);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    if (resolved) return;
    setList(null);
    setListError(null);
    api.adminSpinoutModerationOpen().then(setList, (e) => {
      setListError(e);
    });
  }, [resolved]);
  useEffect(() => { load(); }, [load]);

  const openMember = (userId, who) => {
    const mine = requestSeq.current + 1;
    requestSeq.current = mine;
    setPicked(userId);
    setPickedWho(who || '');
    setHistory(null);
    setHistoryError(null);
    setActError(null);
    api.adminSpinoutModeration(userId).then((body) => {
      if (requestSeq.current !== mine) return;
      setHistory(body);
    }, (e) => {
      if (requestSeq.current !== mine) return;
      setHistoryError(e);
    });
  };

  const apply = async (e) => {
    e.preventDefault();
    if (busy || !picked || !action) return;
    setBusy(true);
    setActError(null);
    try {
      await api.adminSpinoutModerate(picked, { action, reason_code: reason, severity });
      openMember(picked, pickedWho);
      load();
    } catch (err) {
      setActError(err);
    } finally {
      setBusy(false);
    }
  };

  const casesReadable = !!(list && Array.isArray(list.cases));
  const cases = casesReadable ? list.cases : [];
  const sanctionsReadable = !!(list && Array.isArray(list.sanctions));
  const sanctions = sanctionsReadable ? list.sanctions : [];
  const count = typeof list?.open_count === 'number' ? list.open_count : null;
  const sanctionsCount = typeof list?.sanctions_count === 'number' ? list.sanctions_count : null;
  const historyCases = history && Array.isArray(history.cases) ? history.cases : null;

  return (
    <div className="mx-auto max-w-4xl p-6" data-testid="spinout-moderation-page">
      <h1 className="text-[18px] font-extrabold tracking-tight text-axal-ink">Spinout moderation</h1>
      <p className="mt-1 text-[12.5px] leading-relaxed text-axal-muted">
        Awaiting a decision means flagged and not yet closed. That is the count the approvals
        lane reads. A suspension or an ejection that has not been closed is a sanction in force,
        listed apart from that count. Closing a case records a resolved time and does not change
        Lab access. Reinstating turns Lab access back on. An action here does not deactivate
        the account.
      </p>
      {!list && !listError && <p className="mt-2 text-[12px] text-axal-muted">Loading open cases…</p>}
      {casesReadable && (
        <p className="mt-2 text-[12px] text-axal-muted" data-testid="spinout-moderation-count">
          {countSentence(cases.length, count, 'awaiting a decision')}
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

      {list && !casesReadable && (
        <div className="mt-4" data-testid="spinout-moderation-cases-unreadable">
          <Unreadable
            what="Open moderation cases"
            claim="This is not a claim that no cases are open."
            onRetry={load}
          />
        </div>
      )}

      {casesReadable && cases.length === 0 && (
        <p className="mt-4 text-[12.5px] text-axal-muted" data-testid="spinout-moderation-empty">
          No cases are awaiting a decision. The list was read and holds nothing.
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
                aria-label={`Decide on ${row.who}`}
                onClick={() => openMember(row.user_id, row.who)}
              >
                Decide
              </button>
            </li>
          ))}
        </ul>
      )}

      {list && (
        <section className="mt-6" data-testid="spinout-moderation-sanctions">
          <h2 className="text-[14px] font-extrabold text-axal-ink">Sanctions in force</h2>
          <p className="mt-1 text-[12px] text-axal-muted">
            {sanctionsReadable
              ? countSentence(sanctions.length, sanctionsCount, 'sanctions in force')
              : (
                <Unreadable
                  what="Sanctions in force"
                  claim="This is not a claim that no sanction is in force."
                  onRetry={load}
                />
              )}
          </p>
          {sanctions.length > 0 && (
            <ul className="mt-2 divide-y divide-axal-hairline rounded-xl border border-axal-hairline">
              {sanctions.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                  <span>
                    <span className="text-[12.5px] font-semibold text-axal-ink">{row.who || 'Not recorded'}</span>
                    <span className="ml-2 text-[11.5px] text-axal-muted">
                      {row.status} · {row.reason_code}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-axal-ink underline"
                    aria-label={`Decide on ${row.who}`}
                    onClick={() => openMember(row.user_id, row.who)}
                  >
                    Decide
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {picked && (
        <form className="mt-6 space-y-3" onSubmit={apply} data-testid="spinout-moderation-decide">
          <h2 className="text-[14px] font-extrabold text-axal-ink">{pickedWho || 'Not recorded'}</h2>
          {historyError && (
            <Unreadable
              what="This member's cases"
              claim="This is not a claim that they have no cases."
              onRetry={() => openMember(picked, pickedWho)}
            />
          )}
          {history && historyCases === null && (
            <Unreadable
              what="This member's case history"
              claim="This is not a claim that they have no cases."
              onRetry={() => openMember(picked, pickedWho)}
            />
          )}
          {historyCases && (
            <ul className="text-[12px] text-axal-muted" data-testid="spinout-moderation-history">
              {historyCases.length === 0 && <li>No cases on record for this member.</li>}
              {historyCases.map((row) => (
                <li key={row.id}>
                  {row.status} · {row.reason_code}
                  {row.resolved_at ? ' · closed' : ' · unresolved'}
                </li>
              ))}
            </ul>
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
              <option value="">Choose an action</option>
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
          {actError && (
            <p
              className="text-[12px] text-red-700 dark:text-red-300"
              role="alert"
              data-testid={actError.code === 'super_admin_required' ? 'spinout-moderation-super-admin' : 'spinout-moderation-act-error'}
            >
              {actError.code === 'super_admin_required'
                ? (actError.message || 'Only a super admin can decide a moderation case on another admin.')
                : (actError.message || 'The action could not be recorded.')}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !action}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60 dark:bg-slate-200 dark:text-slate-900"
          >
            {busy ? 'Recording…' : 'Record this action'}
          </button>
        </form>
      )}
    </div>
  );
}
