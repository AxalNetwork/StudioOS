// Accepting a move onto this branch (D441).
//
// THE TOKEN IS IN THE PATH AND A SESSION NEVER IS. /invite/:token is the
// events RSVP page, so a move invitation cannot live there. This page calls
// POST /api/branch/invitations/accept, which creates or reactivates the
// account and does not sign anyone in. Projects, deals and documents stay
// on the branch the person left (D121).
//
// IT ACCEPTS ON A CLICK, NOT ON MOUNT. The preview on mount does not spend
// the token. Spending it during the first render would burn it on a preload,
// a link scanner or a refresh, and the retry would then correctly refuse.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Mail, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import useForcedLightTheme from '../hooks/useForcedLightTheme';
import AuthShell, { AuthCard } from '../components/auth/AuthShell';
import { Unreadable } from '../ui';

/** The same shape inviteAccount issues and the accept route requires. */
export const INVITATION_TOKEN = /^invt_[0-9a-f]{64}$/;

export default function JoinBranchPage() {
  useForcedLightTheme();
  const { token: rawToken } = useParams();
  const token = String(rawToken || '');
  const tokenOk = INVITATION_TOKEN.test(token);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!tokenOk) return undefined;
    let cancelled = false;
    api.branchInvitationPreview(token).then((res) => {
      if (!cancelled) setPreview(res);
    }).catch((e) => {
      if (!cancelled) setError(e);
    });
    return () => { cancelled = true; };
  }, [token, tokenOk]);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.branchInvitationAccept(token);
      setDone(res);
    } catch (e) {
      setError(e);
      reportError('JoinBranchPage:accept', e);
      setBusy(false);
    }
  };

  const branchOnly = error?.message === 'Branch only';
  const open = preview && preview.status === 'pending' && !preview.expired && !done;

  return (
    <AuthShell platformNote="Branch invitation">
      <AuthCard>
        <div className="flex items-start gap-3">
          <Mail className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#7c3aed' }} aria-hidden="true" />
          <div>
            {/* This page calls useForcedLightTheme(), like /login: it renders
                inside AuthShell's hand-built light palette, so a dark:
                variant would never apply. dark-mode-exempt */}
            <h1 className="text-lg font-semibold text-gray-900">Join this branch</h1>
            <p className="mt-1 text-sm text-gray-600">
              Accepting creates your account here, or turns a closed one back on. It does not sign
              you in, and projects, deals and documents from the branch you left stay there.
            </p>
          </div>
        </div>

        {!tokenOk && (
          <p
            className="mt-5 rounded-lg px-3 py-2 text-sm"
            style={{ background: '#fef2f2', color: '#9f1239' }}
            data-testid="join-no-token"
          >
            This link is not a branch invitation.
          </p>
        )}

        {branchOnly && (
          <div className="mt-5" data-testid="join-branch-only">
            <Unreadable
              what="This invitation"
              claim="This page answers on a branch. An invitation is held where it was sent, and HQ does not hold it."
            />
          </div>
        )}

        {error && !branchOnly && (
          <p
            className="mt-5 flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: '#fef2f2', color: '#9f1239' }}
            data-testid="join-error"
          >
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error.message || 'That invitation could not be accepted.'}</span>
          </p>
        )}

        {preview && !done && !branchOnly && (
          // dark-mode-exempt: AuthShell's light palette, same as the heading above.
          <div className="mt-5 text-sm text-gray-700" data-testid="join-preview">
            <p>
              {preview.email}
              {preview.invited_by_name ? ` — invited by ${preview.invited_by_name}` : ''}
              {preview.moved_from_code ? `, arriving from ${preview.moved_from_code}` : ''}.
            </p>
            {preview.expired && (
              <p className="mt-2">This invitation has expired. Ask the person who invited you to send another.</p>
            )}
            {preview.status === 'accepted' && (
              <p className="mt-2">This invitation has already been used. Sign in with the email it was sent to.</p>
            )}
            {preview.status === 'revoked' && (
              <p className="mt-2">This invitation was withdrawn.</p>
            )}
          </div>
        )}

        {done && (
          // dark-mode-exempt: AuthShell's light palette, same as the heading above.
          <div className="mt-5 text-sm text-gray-700" data-testid="join-done">
            <p>
              {done.account === 'already_active'
                ? `An account for ${done.email} is already active here. This invitation did not change it.`
                : `Your account for ${done.email} is ready on this branch.`}
            </p>
            {done.role_note && <p className="mt-2">{done.role_note}</p>}
            <p className="mt-2">
              Sign in with that email. Projects, deals and documents from the branch you left did not come with you.
            </p>
            <Link to="/login" className="mt-3 inline-block font-medium underline" data-testid="join-sign-in">
              Sign in
            </Link>
          </div>
        )}

        {open && !branchOnly && (
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            data-testid="join-accept"
            className="mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: '#7c3aed' }}
          >
            {busy ? 'Accepting…' : 'Accept and create my account'}
          </button>
        )}

        {(error?.code === 'invitation_used' || (preview?.status === 'accepted' && !done)) && (
          <Link to="/login" className="mt-4 inline-block text-sm font-medium underline" data-testid="join-sign-in-used">
            Sign in
          </Link>
        )}
      </AuthCard>
    </AuthShell>
  );
}
