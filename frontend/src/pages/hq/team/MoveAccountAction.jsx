/**
 * D5044 (#5044) — Move a branch account to another branch (D121, H9), on the shared action state model.
 *
 * `POST /api/admin/branches/:code/accounts/:userId/move` needs a source branch code and a different
 * destination code, each a live binding, plus TOTP and a recent step-up, and a reason, because a
 * move changes which subsidiary earns revenue share. Once the route answers, the hit shows the
 * move's outcome instead of its controls (`../AccountMoveRecovery.jsx`, D5043), so this form is
 * never drawn twice for one account. An answer that never arrived is "unknown": the source may have
 * closed the account, so the form says to check before moving again, and HQ's record of the move
 * (Moves to finish) is where that is checked.
 */
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { useGovernedAction } from './governedAction';
import ActionNotice from './ActionNotice';
import { escapeCloses, useFocusOnMount } from './actionFocus';

export const MOVE_REASON_MIN = 10;

export default function MoveAccountAction({ hit, from, destinations, onMoved, onCancel }) {
  const [to, setTo] = useState(destinations[0] || '');
  const [reason, setReason] = useState('');
  const firstField = useFocusOnMount();
  const move = useGovernedAction(
    (body) => api.hqMoveAccount(from, hit.id, body),
    { fallback: 'The move was refused.', tag: 'hq-team-move', initial: 'open' },
  );

  return (
    <form
      className="mt-2 grid gap-2 rounded-lg border border-axal-hairline bg-axal-ground p-2"
      data-testid="hq-team-move"
      data-state={move.state}
      onKeyDown={escapeCloses(move.busy, onCancel)}
      onSubmit={async (e) => {
        e.preventDefault();
        const out = await move.submit({ destination_code: to, reason: reason.trim() });
        if (out?.ok) onMoved?.(out.res);
      }}
    >
      <label className="text-[11px] text-axal-muted">
        Destination
        <select className="mt-1 block w-full rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12px] dark:bg-gray-900" ref={firstField} value={to} disabled={move.busy} onChange={(e) => setTo(e.target.value)}>
          {destinations.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label className="text-[11px] text-axal-muted">
        Reason (at least 10 characters). This changes which subsidiary earns revenue share.
        <textarea className="mt-1 block w-full rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12px] dark:bg-gray-900" rows={2} value={reason} disabled={move.busy} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ActionNotice action={move} prefix="hq-team-move" />
      <button type="submit" disabled={move.busy || move.state === 'unknown' || reason.trim().length < MOVE_REASON_MIN} className="justify-self-start rounded-md bg-axal-violet px-3 py-1 text-[11.5px] font-bold text-white disabled:opacity-50">
        {move.busy ? 'Moving…' : `Move to ${to || '…'}`}
      </button>
    </form>
  );
}
