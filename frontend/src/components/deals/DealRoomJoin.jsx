import React, { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { JOIN_NOTE, STATES, quotaLine, quotaFullLine } from './dealRoomCopy';
import { BTN } from './DealRoomKit';

/**
 * D630 (#1388) — joining and leaving a deal room, with the quota (canvas
 * `dr-pipeline` and `dr-header`).
 *
 * The quota is `GET /deals/dealroom/quota`: used against cap, "Unlimited" on a
 * plan without one, and the rooms this firm is in. It is the number the join
 * refuses on, so the line and the refusal cannot disagree. A quota that could
 * not be read says so; it never reads as 0 of anything.
 */

/** The quota read, with its own retry. */
export function useDealroomQuota() {
  const [state, setState] = useState({ loading: true, error: false, quota: null });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const quota = await api.dealroomQuota();
      setState({ loading: false, error: false, quota });
    } catch {
      setState({ loading: false, error: true, quota: null });
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return [state, reload];
}

/** "3 of 5 deal rooms", "Unlimited deal rooms", or the unreadable line. */
export function QuotaLine({ state, onRetry }) {
  if (state.loading && !state.quota) {
    return <span className="text-sm text-gray-500" data-testid="dr-quota">Reading your deal-room quota…</span>;
  }
  if (state.error || !state.quota) {
    return (
      <span className="text-sm text-red-700 dark:text-red-300" role="alert" data-testid="dr-quota">
        Unreadable. {STATES.pipeline.quotaUnread}{' '}
        {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>}
      </span>
    );
  }
  const q = state.quota;
  const pct = q.unlimited || !q.cap ? null : Math.min(100, Math.round((q.used / q.cap) * 100));
  return (
    <span className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300" data-testid="dr-quota">
      <span className="font-mono font-semibold">{quotaLine(q)}</span>
      {pct != null && (
        <span className="inline-block h-1.5 w-20 rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
          <span className={`block h-1.5 rounded-full ${q.full ? 'bg-amber-500' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}

/** The one line that says what joining does. */
export function JoinNote() {
  return <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="dr-join-note">{JOIN_NOTE}</p>;
}

/**
 * Join or Leave for one deal. `member` is whether this firm is in the room;
 * `onChanged` re-reads whatever the caller shows (the quota, the list).
 *
 * A full quota is said inline, under the button, naming the plan that raises
 * it — from the quota read, so the plan and its cap are the server's. The
 * join's 402 carries no `required` field, so the global paywall does not
 * open over it (lib/api.js, Task #82).
 */
export function JoinLeaveButton({ dealId, member, quotaState, onChanged, compact = false }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const q = quotaState?.quota;
  const full = !member && q && q.full;

  const act = async () => {
    setBusy(true); setRefusal('');
    try {
      if (member) await api.dealroomLeave(dealId);
      else await api.dealroomJoin(dealId);
      await onChanged?.();
    } catch (e) {
      if (e?.code === 'quota_dealrooms_exhausted') {
        // The quota moved under the page (another tab joined). Re-read it so
        // the inline line below names the plan from the server's numbers.
        await onChanged?.();
        setRefusal('quota');
      } else {
        setRefusal(e?.message || (member ? 'You could not leave this room. Try again.' : 'You could not join this room. Try again.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const fullLine = (full || refusal === 'quota') ? quotaFullLine(q) : null;
  return (
    <div className={compact ? 'text-right' : ''}>
      <button
        type="button"
        onClick={act}
        disabled={busy || Boolean(full)}
        className={member ? BTN.ghost : BTN.primary}
        data-testid={member ? 'dr-leave' : 'dr-join'}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : (member ? <LogOut size={14} /> : <LogIn size={14} />)}
        {member ? 'Leave' : 'Join deal room'}
      </button>
      {fullLine && (
        <p className="mt-1.5 max-w-xs text-xs text-amber-800 dark:text-amber-300" role="status" data-testid="dr-quota-full">{fullLine}</p>
      )}
      {refusal && refusal !== 'quota' && (
        <p className="mt-1.5 max-w-xs text-xs text-red-700 dark:text-red-300" role="alert" data-testid="dr-join-refusal">{refusal}</p>
      )}
      {refusal === 'quota' && !fullLine && (
        <p className="mt-1.5 max-w-xs text-xs text-amber-800 dark:text-amber-300" role="status" data-testid="dr-quota-full">
          Your deal-room quota is full. Leave a room, or change plan.
        </p>
      )}
    </div>
  );
}
