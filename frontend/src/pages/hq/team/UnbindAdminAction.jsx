/**
 * D5044 (#5044) — Unbind a branch's administrator (D262), on the shared action state model.
 *
 * An administrator is unbound, not moved: the branch refuses to move one (`moveAccountOut`, D133)
 * and says to unbind at HQ, so the hit draws Unbind instead of Move. The route takes the admin role
 * off the account on that branch and deactivates it there, with TOTP, a fresh step-up and a reason.
 */
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { useGovernedAction } from './governedAction';
import ActionNotice from './ActionNotice';

export const UNBIND_REASON_MIN = 10;

export default function UnbindAdminAction({ hit, from, onUnbound }) {
  const [unbindReason, setUnbindReason] = useState('');
  const unbind = useGovernedAction(
    (reason) => api.hqUnbindAdmin(from, hit.id, reason),
    { fallback: 'The unbind was refused.', tag: 'hq-team-unbind', initial: 'open' },
  );

  return (
    <form
      className="mt-2 grid gap-2 rounded-lg border border-axal-hairline bg-axal-ground p-2"
      data-testid="hq-team-unbind"
      data-state={unbind.state}
      onSubmit={async (e) => {
        e.preventDefault();
        const out = await unbind.submit(unbindReason.trim());
        if (out?.ok) onUnbound?.(out.res);
      }}
    >
      <p className="text-[11px] leading-relaxed text-axal-muted">
        Takes the admin role off {hit.name || hit.email} on {from} and deactivates the account there.
        It needs your authenticator and a fresh step-up. Their records stay with {from}.
      </p>
      <label className="text-[11px] text-axal-muted">
        Reason (at least 10 characters). It is recorded here and on the branch.
        <textarea className="mt-1 block w-full rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12px] dark:bg-gray-900" rows={2} value={unbindReason} disabled={unbind.busy} onChange={(e) => setUnbindReason(e.target.value)} />
      </label>
      <ActionNotice action={unbind} prefix="hq-team-unbind" />
      <button type="submit" disabled={unbind.busy || unbind.state === 'unknown' || unbindReason.trim().length < UNBIND_REASON_MIN} className="justify-self-start rounded-md bg-rose-700 px-3 py-1 text-[11.5px] font-bold text-white disabled:opacity-50">
        {unbind.busy ? 'Unbinding…' : `Unbind from ${from}`}
      </button>
    </form>
  );
}
