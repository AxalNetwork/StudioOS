// What one office-hours session left behind — D355. Used on the founder's
// Office Hours page and the partner's /partner/office-hours, so both parties
// see the same list.
//
//   * Action items: either party adds one and ticks any item done; each item
//     says who added it. Only the author sees Delete — the Worker refuses the
//     other party too, and its sentence is what prints if one is tried.
//   * Rating: the founder rates a completed session (1–5, optional comment);
//     the partner sees that rating on the session, comment included. No
//     rating yet is "Not rated yet", never zero stars.
//
// No request here carries a user id: the Worker takes the actor, and their
// side of the booking, from the session.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Unrecorded, Unreadable } from '../../ui';
import {
  LINKED_TOOL_LABELS, toolLink, ownerLabel, sortItems, canRate, takesItems,
} from '../../lib/sessionFollowups';

const INPUT = 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-[12px] text-gray-900 dark:text-gray-100';

export function SessionRating({ booking, viewerSide, onRated }) {
  const [draft, setDraft] = useState(booking.rating ?? null);
  const [comment, setComment] = useState(booking.rating_comment || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canRate(booking, viewerSide)) {
    if (booking.status !== 'completed') return null;
    return (
      <div className="mt-1.5 text-[11.5px]" data-testid={`rating-${booking.id}`}>
        {booking.rating != null ? (
          <>
            <span className="font-semibold text-amber-600 dark:text-amber-400">{'★'.repeat(booking.rating)}{'☆'.repeat(5 - booking.rating)}</span>
            <span className="text-gray-500 dark:text-gray-400"> · founder’s rating</span>
            {booking.rating_comment && <div className="text-gray-600 dark:text-gray-300 mt-0.5 italic">“{booking.rating_comment}”</div>}
          </>
        ) : (
          <Unrecorded reason="The founder has not rated this session.">Not rated yet</Unrecorded>
        )}
      </div>
    );
  }

  const save = async () => {
    if (draft == null) return;
    setBusy(true);
    setError('');
    try {
      const out = await api.rateBooking(booking.id, { rating: draft, comment });
      onRated?.(out);
    } catch (e) {
      setError(e?.message || 'Your rating was not saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid={`rate-${booking.id}`}>
      <span className="text-[11px] text-gray-500 dark:text-gray-400">{booking.rating != null ? 'Your rating' : 'Rate this session'}</span>
      <span className="inline-flex" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={draft === n}
            aria-label={`${n} of 5`}
            onClick={() => setDraft(n)}
            className={draft != null && n <= draft ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600'}
            data-testid={`star-${booking.id}-${n}`}
          >
            <Star size={14} fill={draft != null && n <= draft ? 'currentColor' : 'none'} />
          </button>
        ))}
      </span>
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment for the partner"
        className={`${INPUT} flex-1 min-w-[160px]`}
        data-testid={`input-rating-comment-${booking.id}`}
      />
      <button
        type="button"
        onClick={save}
        disabled={busy || draft == null}
        className="inline-flex items-center gap-1 text-[11.5px] font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 rounded-lg px-2.5 py-1"
        data-testid={`button-save-rating-${booking.id}`}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
      </button>
      {error && <p className="w-full text-[11px] text-rose-600 dark:text-rose-400" role="alert">{error}</p>}
    </div>
  );
}

export function SessionActionItems({ booking, onChange }) {
  const [read, setRead] = useState({ state: 'loading' });
  const [title, setTitle] = useState('');
  const [tool, setTool] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.listBookingActionItems(booking.id);
      setRead({ state: 'ok', data });
    } catch {
      setRead({ state: 'failed' });
    }
  }, [booking.id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      onChange?.();
    } catch (e) {
      setError(e?.message || 'That change was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const add = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    run(async () => {
      await api.addBookingActionItem(booking.id, { title: title.trim(), linked_tool: tool, due_date: due });
      setTitle(''); setTool(''); setDue('');
    });
  };

  if (read.state === 'loading') return <div className="text-[11.5px] text-gray-400 mt-2"><Loader2 size={12} className="inline animate-spin" /> Loading action items…</div>;
  if (read.state === 'failed') return <div className="mt-2"><Unreadable what="This session's action items" claim="Nothing is shown in their place." onRetry={load} /></div>;

  const items = sortItems(read.data?.items);
  return (
    <div className="mt-2 rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5" data-testid={`session-actions-${booking.id}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">Action items from this session</div>
      {items.length === 0 ? (
        <div className="text-[11.5px] text-gray-500 dark:text-gray-400">None yet — either of you can add one.</div>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => {
            const link = toolLink(it.linked_tool);
            return (
              <li key={it.id} className="flex items-start gap-2 text-[12px]" data-testid={`session-action-${it.id}`}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => api.updateBookingActionItem(it.id, { done: !it.done }))}
                  aria-label={it.done ? 'Mark not done' : 'Mark done'}
                  className={`mt-0.5 w-4 h-4 rounded grid place-items-center border shrink-0 ${it.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}
                  data-testid={`toggle-action-${it.id}`}
                >
                  {it.done && <Check className="w-3 h-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={it.done ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200'}>{it.title}</div>
                  <div className="text-[10.5px] text-gray-400 flex flex-wrap gap-x-2">
                    <span data-testid={`action-owner-${it.id}`}>Added by {ownerLabel(it)}</span>
                    {it.due_date && <span>Due {it.due_date}</span>}
                    {link && <Link to={link.to} className="font-semibold text-teal-700 dark:text-teal-300">→ {link.label}</Link>}
                  </div>
                </div>
                {it.added_by_you && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => api.deleteBookingActionItem(it.id))}
                    aria-label="Delete action item"
                    className="text-gray-400 hover:text-rose-600"
                    data-testid={`delete-action-${it.id}`}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {takesItems(booking) && (
        <form onSubmit={add} className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-1.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Add an action item" className={`${INPUT} flex-1 min-w-[160px]`} data-testid={`input-action-title-${booking.id}`} />
          <select value={tool} onChange={(e) => setTool(e.target.value)} className={INPUT} aria-label="Linked tool" data-testid={`select-action-tool-${booking.id}`}>
            <option value="">No tool</option>
            {Object.entries(LINKED_TOOL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={INPUT} aria-label="Due date" data-testid={`input-action-due-${booking.id}`} />
          <button type="submit" disabled={busy || !title.trim()} className="inline-flex items-center gap-1 text-[11.5px] font-bold text-teal-700 dark:text-teal-300 border border-teal-600 rounded-lg px-2.5 py-1 disabled:opacity-40" data-testid={`button-add-action-${booking.id}`}>
            <Plus size={12} /> Add
          </button>
        </form>
      )}
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1.5" role="alert">{error}</p>}
    </div>
  );
}
