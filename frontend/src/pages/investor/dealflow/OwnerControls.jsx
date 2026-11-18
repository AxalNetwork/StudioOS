/**
 * D6145 (#6145) — who owns a deal in the firm's flow, set from the page: the
 * peek's Owner picker (Me, a colleague, Unassigned) and the board's and the
 * table's "Assign to me". Both write through `PATCH /api/deals/flow/:dealId`
 * `{ owner_user_id }` (null is Unassigned) and offer only the people
 * `GET /api/deals/flow/owners` lists, which are the ones the Worker accepts.
 *
 * The board and the table reach "Assign to me" through `FlowOwnerContext`, so
 * neither threads a new prop through its rows. With no firm the only owner is
 * the investor: no picker and no shortcut. A list that could not be read says
 * Unreadable with Try again, never an empty picker.
 */
import React, { createContext, useContext, useState } from 'react';

/** `{ owners, me, onAssign(row, ownerId), busy }` from `DealFlow`; null where no page provides it. */
export const FlowOwnerContext = createContext(null);

const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const TARGET = 'max-sm:min-h-[44px]';
const SELECT = `rounded-md border border-axal-hairline bg-white px-1.5 py-0.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 ${TARGET}`;
const LINK = `w-fit text-[12px] font-semibold text-violet-700 underline hover:text-violet-900 disabled:opacity-50 dark:text-violet-300 dark:hover:text-violet-100 ${TARGET}`;
export const NAME_UNRECORDED = 'Name not recorded';
export const OWNERS_UNREADABLE = 'Who can own this deal could not be read. That is not the same as no one.';

/** The investor's own id from the owners read (the Worker's `you`), or null while it is not read. */
export function meOf(read) {
  if (read?.kind !== 'ok') return null;
  const you = (read.data?.owners || []).find((o) => o.you);
  return you ? Number(you.user_id) : null;
}

/**
 * The picker's options from the owners read: Me first, then colleagues, then
 * Unassigned where the Worker allows it. A current owner the read does not
 * list (a seat since removed) stays shown, so the picker never misnames them.
 */
export function ownerOptions(data, row) {
  const owners = data?.owners || [];
  const out = owners.map((o) => ({ value: String(o.user_id), label: o.you ? `Me · ${o.name || NAME_UNRECORDED}` : (o.name || NAME_UNRECORDED) }));
  const current = row?.owner?.id;
  if (current != null && !owners.some((o) => Number(o.user_id) === Number(current))) {
    out.push({ value: String(current), label: `${row.owner.name || NAME_UNRECORDED} (not in your firm now)`, disabled: true });
  }
  if (data?.can_unassign) out.push({ value: '', label: 'Unassigned' });
  return out;
}

/** True where "Assign to me" is offered: a row in the flow, the investor known, and someone else (or no one) owning it. */
export function assignable(row, me) {
  return !!row?.inFlow && me != null && Number(row.owner?.id) !== Number(me);
}

/** The board's and the table's shortcut. Nothing at all where it does not apply. */
export function AssignToMe({ row, testId }) {
  const ctx = useContext(FlowOwnerContext);
  if (!ctx || !assignable(row, ctx.me)) return null;
  return (
    <button type="button" className={LINK} disabled={ctx.busy} onClick={() => ctx.onAssign(row, ctx.me)} data-testid={testId}>
      Assign to me<span className="sr-only">: {row.name}</span>
    </button>
  );
}

/**
 * The peek's Owner row. `read` is the owners read (`{ kind, data }`), `onAssign`
 * resolves with the row as the Worker answered, or throws its refusal, which
 * stays here in its own words while the row keeps its owner.
 */
export function OwnerPicker({ row, read, onRetry, onAssign }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const shown = row.owner ? (row.owner.name || NAME_UNRECORDED) : 'Unassigned';
  if (!row.inFlow) return <span>Not on your deals</span>;
  if (!read || read.kind === 'loading') return <span data-testid="dealflow-peek-owner">{shown} <span className={MUTED}>· Reading who can own it…</span></span>;
  if (read.kind !== 'ok') {
    return (
      <span className="flex flex-col gap-1" data-testid="dealflow-peek-owner">
        <span>{shown}</span>
        <span className="text-[12px] text-amber-800 dark:text-amber-300" role="status" data-testid="dealflow-peek-owner-unreadable">{OWNERS_UNREADABLE}</span>
        <button type="button" className={LINK} onClick={onRetry} data-testid="dealflow-peek-owner-retry">Try again</button>
      </span>
    );
  }
  // With no firm, the investor owns every deal in their own flow: nothing to choose.
  if (read.data?.scope !== 'firm') return <span data-testid="dealflow-peek-owner">{shown}</span>;
  const choose = async (value) => {
    const next = value === '' ? null : Number(value);
    if (next === (row.owner ? Number(row.owner.id) : null)) return;
    setSaving(true); setError('');
    try { await onAssign(row, next); } catch (e) { setError(e?.message || 'The owner could not be changed. Nothing changed.'); } finally { setSaving(false); }
  };
  return (
    <span className="flex flex-col gap-1">
      <label className="flex items-center gap-1"><span className="sr-only">Owner of {row.name}</span>
        <select className={SELECT} value={row.owner ? String(row.owner.id) : ''} disabled={saving} onChange={(e) => choose(e.target.value)} data-testid="dealflow-peek-owner">
          {ownerOptions(read.data, row).map((o) => <option key={o.value || 'none'} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
        {saving && <span className={MUTED}>Saving…</span>}
      </label>
      {error && <span className="text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid="dealflow-peek-owner-error">{error}</span>}
    </span>
  );
}
