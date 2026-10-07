import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { INVITE_STATUS, STATES, whenLine } from './dealRoomCopy';
import { Loading, Empty, Unreadable, NotRecorded, StatusPill, BTN } from './DealRoomKit';

/**
 * D630 (#1388) — canvas `dr-invites`: the deal room's Invitations tab, for an
 * admin (`GET /deals/:id/invitations` is `requireAdmin`).
 *
 * Each invited investor: name, email, status, the message sent, whether an
 * email was asked for, when they were invited and when they answered.
 *
 * "EMAIL REQUESTED", NOT "EMAIL SENT". `deal_invitations.email_opt_in` records
 * that the inviter asked for an email; the send itself goes through `notify`
 * and its result is not stored on the invitation. The row says what the
 * record knows.
 */
export default function DealInvitationsTab({ dealId, onInvite }) {
  const [state, setState] = useState({ loading: true, error: false, rows: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const rows = await api.dealInvitations(dealId);
      setState({ loading: false, error: false, rows: Array.isArray(rows) ? rows : [] });
    } catch {
      setState({ loading: false, error: true, rows: null });
    }
  }, [dealId]);
  useEffect(() => { load(); }, [load]);
  return <InvitationsList state={state} onRetry={load} onInvite={onInvite} />;
}

const TONE = { invited: 'grey', interested: 'ok', passed: 'bad' };

export function InvitationsList({ state, onRetry, onInvite }) {
  const invite = onInvite
    ? <button type="button" onClick={onInvite} className={BTN.primary} data-testid="dr-invite-cta">Invite an investor</button>
    : null;
  if (state.loading && !state.rows) return <Loading what="invitations" />;
  if (state.error) return <Unreadable onRetry={onRetry}>{STATES.invites.unread}</Unreadable>;
  if (!state.rows.length) return <Empty action={invite}>{STATES.invites.empty}</Empty>;
  return (
    <div data-testid="dr-invites">
      {invite && <div className="mb-3 flex justify-end">{invite}</div>}
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
        {state.rows.map((r) => {
          const answered = whenLine(r.responded_at);
          return (
            <li key={r.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between" data-testid="dr-invite-row">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{r.investor_name || `Investor #${r.investor_user_id}`}</span>
                  <StatusPill tone={TONE[r.status] || 'grey'} testid="dr-invite-status">{INVITE_STATUS[r.status] || r.status}</StatusPill>
                </div>
                <div className="text-xs text-gray-500">{r.investor_email || 'No email on the account'}</div>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  {r.message ? `“${r.message}”` : 'No message was written.'}
                </p>
              </div>
              <dl className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-xs md:text-right">
                <dt className="text-gray-500">Email</dt>
                <dd data-testid="dr-invite-email">{Number(r.email_opt_in) ? 'Email requested' : 'No email'}</dd>
                <dt className="text-gray-500">Invited</dt>
                <dd>{whenLine(r.created_at) || <NotRecorded reason="Not recorded: no invitation time is stored." />}</dd>
                <dt className="text-gray-500">Answered</dt>
                <dd>{answered || <NotRecorded reason={STATES.invites.nrAnswered} />}</dd>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
