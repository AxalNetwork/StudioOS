import React, { useEffect, useState } from 'react';
import { adminStatementActionsApi } from '../../../lib/api/adminStatementActions.js';
import { ACTION_LABEL } from './statementActionModel.js';
import { money } from './revenueModel.js';
import { BTN, StateMark } from './RevenueStates.jsx';

/** Read the opened statement's actual governed receipts, with bounded pagination (#5039). */
export function StatementActionHistory({ uid, revision }) {
  const [state, setState] = useState(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setState(null);
    setBusy(false);
    adminStatementActionsApi.history(uid).then(
      (r) => { if (current) setState(r?.available === true && Array.isArray(r.items) ? r : { error: true }); },
      () => { if (current) setState({ error: true }); },
    );
    return () => { current = false; };
  }, [uid, revision, retry]);
  const more = async () => {
    if (busy || !state?.next_cursor) return;
    setBusy(true);
    try {
      const r = await adminStatementActionsApi.history(uid, state.next_cursor);
      if (r?.available !== true || !Array.isArray(r.items)) throw new Error('History unavailable');
      setState((s) => ({ ...r, items: [...s.items, ...r.items] }));
    } catch { setState((s) => ({ ...s, moreError: true })); }
    finally { setBusy(false); }
  };
  return <section data-testid="hq-statement-action-history" aria-label="Action history">
    <h3 className="mb-2 text-[13px] font-bold">Action history</h3>
    {state === null ? <StateMark state="loading" /> : state.error ? <div role="alert">Action history is unreadable. <button className={BTN} onClick={() => setRetry((n) => n + 1)}>Retry history</button></div> : <>
      {!state.items?.length && <p>No governed actions recorded. Earlier changes have no action receipt.</p>}
      <ol className="divide-y divide-axal-hairline dark:divide-gray-700">
        {(state.items || []).map((a) => <li key={a.uid} className="break-words py-3 text-[13px]">
          <b>{ACTION_LABEL[a.action] || a.action}</b> · {a.created_at} · actor #{a.actor_user_id}
          <p>{a.reason}</p>
          <p>Revision {a.before?.revision ?? 'Not recorded'} → {a.after?.revision ?? 'Not recorded'}</p>
          {a.action === 'set_due_date' ? <p>Due {a.before?.due_on || 'Not recorded'} → {a.after?.due_on || 'Not recorded'}</p>
            : <p>Outstanding {money(a.before?.outstanding_cents, a.currency)} → {money(a.after?.outstanding_cents, a.currency)}</p>}
          <p className="font-mono text-[12px]">Receipt {a.uid}</p>
        </li>)}
      </ol>
      {state.moreError && <p role="alert">Earlier actions could not be read. Retry loading earlier actions.</p>}
      {state.next_cursor && <button className={BTN} disabled={busy} onClick={more}>{busy ? 'Reading…' : 'Load earlier actions'}</button>}
    </>}
  </section>;
}
