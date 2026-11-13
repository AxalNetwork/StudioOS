/**
 * D5044 (#5044) — Sign an HQ-held administrator out everywhere (D165), on the shared action state model.
 *
 * The reason + acknowledge shape `SecurityPage.jsx`'s bulk force-reauth already uses. Two things
 * about WHERE it is drawn are load-bearing rather than incidental:
 *
 * ONLY ON THE HQ-HELD GROUP, and that is structural rather than a condition. `HqAdminRoster` is
 * rendered only when there is no view-as overlay, and a branch's hits render as a plain list, not
 * as rows of that table. The route behind this button writes HQ's `users` table: a branch admin's
 * account lives in the BRANCH's database, so a Sign-out control on a branch hit could only ever
 * refuse — the `still_an_admin` mistake D134 named. It is absent there rather than disabled.
 *
 * ONE FORM, NOT ONE PER ROW. The reason and the acknowledgement belong to the act, not to the
 * table, so the selected row expands and everything else stays a button.
 */
import React, { useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../../../lib/api';
import { useGovernedAction } from './governedAction';
import ActionNotice from './ActionNotice';
import { escapeCloses, useFocusOnMount } from './actionFocus';

export const SIGN_OUT_REASON_MIN = 8;

// The same translation the bulk control makes: a bare "TOTP required" is the server's word for a
// session minted the wrong way, and it reads as a fault rather than as the one thing to do about it.
const totpSentence = (ex) => (String(ex?.message || '') === 'TOTP required'
  ? 'This needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.'
  : null);

export default function SignOutAccountAction({ row, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const who = row.name || row.email;
  const signOut = useGovernedAction(
    (r) => api.hqForceReauthUser(row.user_id, r),
    { fallback: 'Request failed', translate: totpSentence, tag: 'hq-team:revoke', initial: 'open' },
  );
  const busy = signOut.busy;
  const firstField = useFocusOnMount();

  const submit = async (e) => {
    e.preventDefault();
    const out = await signOut.submit(reason.trim());
    if (out?.ok) onDone(out.res);
  };

  return (
    <form onSubmit={submit} onKeyDown={escapeCloses(busy, onCancel)} className="space-y-2 py-2" data-testid="hq-team-revoke-form" data-state={signOut.state}>
      <label className="block text-[11px] font-semibold text-axal-muted">
        Reason · required, stored with the action
        <input
          ref={firstField}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`e.g. ${who} reported a lost laptop`}
          className="mt-1 w-full max-w-xl rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-normal text-axal-ink dark:bg-gray-900"
        />
      </label>
      <label className="flex items-start gap-2 text-[11.5px] text-axal-muted">
        <input type="checkbox" checked={ack} disabled={busy} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        <span>
          I understand this signs {who} out of every session on every device. It does not deactivate
          the account, change their role, or touch anyone else.
        </span>
      </label>
      <ActionNotice action={signOut} prefix="hq-team-revoke" />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || signOut.state === 'unknown' || !ack || reason.trim().length < SIGN_OUT_REASON_MIN}
          className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-red-700 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} Sign {who} out
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-2 py-1.5 text-[12px] font-semibold text-axal-muted hover:text-axal-ink dark:hover:text-gray-100"
        >
          {signOut.state === 'unknown' ? 'Close' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}
