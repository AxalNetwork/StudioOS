import React, { useState } from 'react';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { COMMENT_DELETE_CONFIRM, COMMENTS } from './hqReviewCopy';

/**
 * D634 (#1392) — canvas `hq-comments`: an article's review comments, with
 * "Delete" beside "Resolve".
 *
 * Resolve stays the first action: it keeps the comment on record. Delete asks
 * first, saying the author loses the comment too and it cannot be undone, and
 * only the confirmation's own button sends `DELETE
 * /admin/articles/comments/:cid` (D617: the comment's author or a Super Admin;
 * the delete is logged). A refusal prints the route's sentence.
 *
 * `state` is `{ loading, error, comments }`. A failed read draws Unreadable,
 * never "No comments".
 */
export default function ReviewComments({ state, onRetry, onResolve, onDelete }) {
  if (state.loading && !state.comments) {
    return <p className="text-xs text-slate-500" data-testid="hq-comments-loading"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading comments…</p>;
  }
  if (state.error) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300" role="alert" data-testid="hq-comments-unreadable">
        Unreadable. {COMMENTS.unread}
        {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline"><RefreshCw className="h-3 w-3" /> Try again</button>}
      </p>
    );
  }
  if (!state.comments.length) return <p className="text-xs text-slate-500" data-testid="hq-comments-empty">{COMMENTS.empty}</p>;
  return (
    <ul className="space-y-2" data-testid="hq-comments">
      {state.comments.map((c) => (
        <ReviewComment key={c.id} comment={c} onResolve={onResolve} onDelete={onDelete} />
      ))}
    </ul>
  );
}

/** One comment. `initialConfirming` lets a test draw the confirmation. */
export function ReviewComment({ comment: c, onResolve, onDelete, initialConfirming = false }) {
  const [confirming, setConfirming] = useState(initialConfirming);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');

  const confirmDelete = async () => {
    setBusy(true); setRefusal('');
    try {
      await onDelete(c.id);
    } catch (e) {
      setRefusal(e?.message || 'The comment was not deleted. Try again.');
      setBusy(false);
    }
  };

  return (
    <li className={`rounded border p-2 text-sm ${c.resolved_at ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-slate-200 dark:border-slate-700'}`} data-testid="hq-comment">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
        <span>{c.author_name || 'admin'}</span>
        <span>{new Date(c.created_at).toLocaleString()}</span>
      </div>
      <div className="mt-0.5 text-xs text-slate-500" data-testid="hq-comment-anchor">
        {c.anchor ? `Section: ${c.anchor}` : COMMENTS.nrSection}
      </div>
      <div className="mt-1 whitespace-pre-wrap">{c.body}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => onResolve(c.id, !!c.resolved_at)} className="text-xs font-semibold text-violet-700 hover:underline dark:text-violet-300" data-testid="hq-comment-resolve">
          {c.resolved_at ? 'Mark unresolved' : 'Mark resolved'}
        </button>
        {!confirming && (
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline dark:text-red-300" data-testid="hq-comment-delete">
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30" role="alertdialog" data-testid="hq-comment-confirm">
          <div className="text-sm font-semibold text-red-800 dark:text-red-200">{COMMENT_DELETE_CONFIRM.title}</div>
          <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">{COMMENT_DELETE_CONFIRM.body}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setConfirming(false); setRefusal(''); }} className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600">Keep it</button>
            <button type="button" onClick={confirmDelete} disabled={busy} className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60" data-testid="hq-comment-confirm-delete">
              {busy && <Loader2 className="h-3 w-3 animate-spin" />} Delete for everyone
            </button>
          </div>
          {refusal && <p className="mt-1.5 text-xs text-red-700 dark:text-red-300" role="alert" data-testid="hq-comment-refusal">{refusal}</p>}
        </div>
      )}
    </li>
  );
}
