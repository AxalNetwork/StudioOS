import React from 'react';
import { Pill, Unreadable } from '../../ui';
import { BTN_TEXT, BTN_TEXT_BODY, MUTED } from './teamUi.jsx';
import { LINK_ONCE, PROJECT_RESEND_OFF, companyInvitationLine, invitationState, projectInvitationRow } from './teamModel.js';

/**
 * D1497 (#3727, TM1a/TM1b invitations, TM2c, TM9a1) — the Invitations panel
 * inside the People card. An editor's only: a member without the right never
 * reads it (the Worker answers 403), so it is not drawn for them.
 *
 * Company (wired): `GET /api/company/:uid/invitations`, every status, with
 * Resend (a new token, `POST …/resend`) and Revoke (`DELETE …/:inviteUid`) by
 * state: pending and resent offer both, expired offers Resend only, revoked
 * and accepted offer nothing. "Resent" is read from the invitation itself
 * (`wasResent`: its live link is newer than the first), so it survives a
 * reload, and is drawn only when that new link was mailed.
 *
 * Project: the pending invitations from `GET /api/projects/:id/members`, with
 * where each came from. Revoke is wired. Resend waits for #3841 and says so.
 * A link invitation's link is shown once, when it is made (only its hash is
 * stored), so "Copy link" says that rather than copying nothing.
 *
 * An unread list is "could not be read", never "No invitation is waiting."
 */
export default function InvitationsBlock({ kind, invitations, error, onRetry, onResend, onRevoke, busyKey, freshKey, now = new Date() }) {
  const rows = Array.isArray(invitations) ? invitations : [];
  return (
    <div className="mt-3 rounded-axal-md bg-axal-ground/70 px-3.5 py-3 dark:bg-gray-950/40" data-testid="team-invitations">
      <p className="m-0 mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">Invitations</p>
      {error ? <Unreadable what="The invitations" claim="That is not the same as none waiting." onRetry={onRetry} />
        : !rows.length ? <p className={`m-0 ${MUTED}`} data-testid="team-invitations-none">No invitation is waiting.</p>
          : (
            <ul className="m-0 flex list-none flex-col p-0">
              {rows.map((i) => (kind === 'company'
                ? <CompanyInvitation key={i.uid} i={i} now={now} fresh={freshKey === i.uid} busy={busyKey === i.uid} onResend={onResend} onRevoke={onRevoke} />
                : <ProjectInvitation key={i.id} i={i} busy={busyKey === `pi-${i.id}`} onRevoke={onRevoke} />))}
            </ul>
          )}
    </div>
  );
}

function CompanyInvitation({ i, now, fresh, busy, onResend, onRevoke }) {
  const st = invitationState(i, now);
  return (
    <li className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-axal-hairline py-2 last:border-b-0 dark:border-gray-800 ${fresh ? 'rounded-md bg-axal-lavender px-2 dark:bg-violet-900/20' : ''}`} data-testid={`invitation-${i.uid}`}>
      <span className={`min-w-0 font-mono text-[12.5px] ${st.muted ? 'text-axal-faint line-through dark:text-gray-500' : 'text-axal-ink dark:text-gray-200'}`}>{companyInvitationLine(i)}</span>
      <Pill tone={st.tone} data-testid={`invitation-state-${i.uid}`}>{st.label}</Pill>
      {fresh ? <span className={MUTED}>Sent just now.</span> : null}
      {st.note ? <span className={MUTED}>{st.note}</span> : null}
      <span className="ml-auto flex items-center gap-1">
        {st.resend ? <button type="button" className={BTN_TEXT} disabled={busy} onClick={() => onResend(i)} data-testid={`invitation-resend-${i.uid}`}>Resend</button> : null}
        {st.revoke ? <button type="button" className={BTN_TEXT_BODY} disabled={busy} onClick={() => onRevoke(i)} data-testid={`invitation-revoke-${i.uid}`}>Revoke</button> : null}
      </span>
    </li>
  );
}

function ProjectInvitation({ i, busy, onRevoke }) {
  const row = projectInvitationRow(i);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-axal-hairline py-2 last:border-b-0 dark:border-gray-800" data-testid={`invitation-${row.key}`}>
      <Pill>{row.source}</Pill>
      <span className="min-w-0 font-mono text-[12.5px] text-axal-ink dark:text-gray-200">{row.line}</span>
      <span className="ml-auto flex items-center gap-1">
        {row.sourceKey === 'link'
          ? <button type="button" className={BTN_TEXT} disabled title={LINK_ONCE} data-testid={`invitation-copy-${row.key}`}>Copy link</button>
          : <button type="button" className={BTN_TEXT} disabled title={PROJECT_RESEND_OFF} aria-describedby={`resend-off-${row.key}`} data-testid={`invitation-resend-${row.key}`}>Resend</button>}
        <span id={`resend-off-${row.key}`} className="sr-only">{row.sourceKey === 'link' ? LINK_ONCE : PROJECT_RESEND_OFF}</span>
        <button type="button" className={BTN_TEXT_BODY} disabled={busy} onClick={() => onRevoke(row)} data-testid={`invitation-revoke-${row.key}`}>Revoke</button>
      </span>
    </li>
  );
}
