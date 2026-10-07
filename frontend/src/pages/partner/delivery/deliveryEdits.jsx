import React, { useState } from 'react';
import { Pill, inputClass, buttonClass, ghostButtonClass, formatDay } from '../kit';
import { NotRecorded } from '../../../workspaces/canvasKit';

/**
 * D637 — the partner's delivery edits (Ops canvas `sp-delivery`).
 *
 * - A blocker has two actions that are not the same: **Clear** keeps it on
 *   record with the date it cleared; **Delete** removes one raised by mistake.
 * - A live seat's scope is edited in place. A revoked seat's is history.
 * - An hours entry is deleted, not set to 0. A month with no entry reads
 *   "Not recorded": nobody logged hours, which is not the claim that none were
 *   worked.
 *
 * Each piece is pure over its props; the zones own the calls.
 */

export const NO_HOURS_REASON = 'No entry for this month. Not the same as 0.';

/** One blocker, with Clear (or Reopen) and Delete as separate actions. */
export function BlockerRow({ b, busy = false, onClear, onReopen, onDelete }) {
  const cleared = !!b.cleared_at;
  return (
    <div data-testid={`blocker-${b.id}`} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-1.5 first:border-t-0 text-[12.5px]">
      <Pill tone={b.side === 'client' ? 'info' : 'warn'}>
        {b.side === 'client' ? 'Client side' : 'Our side'}
      </Pill>
      <span className={cleared ? 'text-axal-faint line-through' : ''}>{b.summary}</span>
      {cleared
        ? <span className="text-[11px] text-axal-faint">Cleared {formatDay(b.cleared_at)} · kept on record</span>
        : b.days_open != null && <span className="text-[11px] text-axal-faint">{b.days_open}d open</span>}
      <span className="ml-auto flex gap-1.5">
        {cleared ? (
          <button type="button" className={ghostButtonClass} disabled={busy} onClick={onReopen}
            title="Opens it again. The blocker was never removed.">
            Reopen
          </button>
        ) : (
          <button type="button" className={ghostButtonClass} disabled={busy} onClick={onClear}
            title="Marks it cleared today and keeps it on record.">
            Clear
          </button>
        )}
        <button type="button" disabled={busy} onClick={onDelete}
          title="Removes the blocker. Use it for one raised by mistake; Clear keeps a real one on record."
          className="rounded-lg border border-red-200 px-2.5 py-1 text-[12px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30">
          Delete
        </button>
      </span>
    </div>
  );
}

/** The confirm a Delete asks, so nobody deletes what they meant to clear. */
export function blockerDeleteQuestion(b) {
  return `Delete "${String(b?.summary || '').slice(0, 80)}"? It is removed, not cleared. To keep it on record, use Clear instead.`;
}

/** Scope words a client most often grants. A suggestion; the scope stays the client's own words. */
export const SCOPE_SUGGESTIONS = ['Board', 'KPIs', 'Roadmap', 'Data room'];

/** The scope's parts, split on commas. */
export function scopeParts(scope) {
  return String(scope || '').split(',').map((x) => x.trim()).filter(Boolean);
}

/** Adds `word` to the scope, or takes it out when it is there already. */
export function toggleScope(scope, word) {
  const parts = scopeParts(scope);
  const has = parts.some((p) => p.toLowerCase() === word.toLowerCase());
  return (has ? parts.filter((p) => p.toLowerCase() !== word.toLowerCase()) : [...parts, word]).join(', ');
}

/** A seat's scope, edited in place. A revoked seat shows its last scope and no editor. */
export function SeatScopeEditor({ seat, busy = false, onSave, initialEditing = false }) {
  const [editing, setEditing] = useState(initialEditing);
  const [draft, setDraft] = useState(seat.scope || '');
  if (seat.revoked_at) {
    return seat.scope
      ? <Pill tone="neutral">{seat.scope}</Pill>
      : <NotRecorded>Scope not recorded</NotRecorded>;
  }
  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {seat.scope ? <Pill tone="neutral">{seat.scope}</Pill> : <NotRecorded>Scope not recorded</NotRecorded>}
        <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => { setDraft(seat.scope || ''); setEditing(true); }}>
          Edit scope
        </button>
      </span>
    );
  }
  const parts = scopeParts(draft).map((p) => p.toLowerCase());
  return (
    <span data-testid={`seat-scope-editor-${seat.id}`} className="flex w-full flex-col gap-1.5 sm:w-auto">
      <span className="flex flex-wrap gap-1">
        {SCOPE_SUGGESTIONS.map((w) => {
          const on = parts.includes(w.toLowerCase());
          return (
            <button key={w} type="button" aria-pressed={on} onClick={() => setDraft(toggleScope(draft, w))}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${on
                ? 'border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40'
                : 'border-axal-hairline text-axal-muted hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'}`}>
              {w}
            </button>
          );
        })}
      </span>
      <span className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor={`seat-scope-${seat.id}`}>Scope</label>
        <input id={`seat-scope-${seat.id}`} className={inputClass} value={draft} maxLength={400}
          placeholder="In the client's words" onChange={(e) => setDraft(e.target.value)} />
        <button type="button" className={buttonClass} disabled={busy}
          onClick={async () => { await onSave?.(draft.trim()); setEditing(false); }}>
          Save
        </button>
        <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </span>
    </span>
  );
}

/**
 * Client hours by entry: one row per client × person, one column per month.
 * A month with no entry reads "Not recorded" with its reason; an entry can be
 * deleted, after which it reads the same.
 */
export function HoursEntries({ read, busy = false, onDelete, onRetry }) {
  if (read.kind === 'loading') {
    return <p className="text-[12.5px] text-axal-faint" data-testid="hours-entries-loading">Loading hours…</p>;
  }
  if (read.kind === 'unreadable') {
    return (
      <div data-testid="hours-entries-unreadable" className="text-[12.5px]">
        <p className="text-red-700 dark:text-red-300">Hours could not be read just now.</p>
        <button type="button" className={`${ghostButtonClass} mt-1`} onClick={onRetry}>Try again</button>
      </div>
    );
  }
  const { periods, entries } = read;
  if (!entries.length) {
    return <p className="text-[12.5px] text-axal-muted" data-testid="hours-entries-empty">No client hours are logged for these three months.</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid="hours-entries">
      <table className="w-full min-w-[480px] text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-axal-faint">
            <th className="py-1 pr-2 font-semibold">Client · person</th>
            {periods.map((p) => <th key={p} className="py-1 pr-2 font-semibold">{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.engagement_id}:${e.person_user_id}`} className="border-t border-axal-hairline">
              <td className="py-1.5 pr-2">
                <span className="font-semibold">{e.client || e.need_title || 'Client not named'}</span>
                <span className="text-axal-faint"> · {e.person_name || 'Unnamed'}</span>
              </td>
              {periods.map((p) => {
                const h = e.hours?.[p];
                return (
                  <td key={p} className="py-1.5 pr-2" data-testid={`hours-${e.engagement_id}-${e.person_user_id}-${p}`}>
                    {h == null ? (
                      <span title={NO_HOURS_REASON}><NotRecorded /></span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular-nums">{h} h</span>
                        <button type="button" disabled={busy} onClick={() => onDelete?.(e, p)}
                          aria-label={`Delete ${h} hours for ${e.person_name || 'this person'} in ${p}`}
                          className="text-[11px] text-red-700 underline hover:text-red-900 disabled:opacity-50 dark:text-red-300 dark:hover:text-red-200">
                          Delete
                        </button>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-axal-faint">Not recorded: {NO_HOURS_REASON} Deleting an entry is not logging 0.</p>
    </div>
  );
}
