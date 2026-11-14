// D1614 W7 part 2 (#4419): a manager's review; Eadwyn never closes an item.
import React, { useState } from 'react';
import { workAdapter } from './workAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY } from '../team/teamUi.jsx';
import { reviewError } from './TaskTimeline.jsx';

export default function TaskReview({ task, projectId, canManage, onChanged, adapter = workAdapter }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!canManage || task.column !== 'in_review') return null;
  const decide = async (decision) => {
    if (busy) return;
    if (decision === 'request_changes' && !comment.trim()) { setError('Add a comment explaining the changes needed.'); return; }
    setBusy(true); setError('');
    try { const r = await adapter.review(projectId,task.task_number,{ decision, comment:comment.trim() });
      if (!r.available) { setError(r.reason); return; } onChanged?.(r.data?.task ?? r.data);
    } catch (e) { setError(reviewError(e)); } finally { setBusy(false); }
  };
  return <section aria-label="Review item" className="my-3 rounded border border-violet-300 p-3 dark:border-violet-700">
    <h3 className="font-semibold">Ready for your review</h3>
    <label className="block">Review comment<textarea value={comment} maxLength={20000} onChange={(e) => setComment(e.target.value)} className="block w-full rounded border p-2 dark:bg-gray-900 dark:border-gray-700" /></label>
    <div className="mt-2 flex gap-2"><button type="button" disabled={busy} className={BTN_PRIMARY} onClick={() => decide('approve')}>Approve and close</button>
      <button type="button" disabled={busy} className={BTN_SECONDARY} onClick={() => decide('request_changes')}>Request changes</button></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
