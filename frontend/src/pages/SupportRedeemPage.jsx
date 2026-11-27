// The branch landing for an HQ support session (D120).
//
// WHAT THIS PAGE IS FOR. An HQ operator needs to look at a subsidiary's account
// with that account's own eyes. HQ and the branch are separate Workers over
// separate databases with separate JWT secrets (D.2, D.4), so HQ's session does
// not merely lack permission here — it does not decode. HQ authorised the
// session over the private service binding; this page is the browser's half.
//
// THE CODE IS IN THE URL AND THE TOKEN NEVER IS. `?code=` is single-use and
// five minutes old at most; it buys exactly one POST to
// /api/auth/support/redeem, which answers with the session. A token in the URL
// would sit in history, in the next request's Referer, and in anything that
// reads the address bar — and, unlike this code, would still work afterwards.
//
// IT REDEEMS ON A CLICK, NOT ON MOUNT. A page that spent the code during its
// own first render would burn it on a preload, a prefetch, a link scanner, or
// the operator's own refresh — and the second attempt would then correctly
// refuse, which reads as a broken feature rather than a spent code. The click
// also gives the operator the one thing they should see before they start: who
// they are about to become and the reason that will be on the record.
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LifeBuoy, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import useForcedLightTheme from '../hooks/useForcedLightTheme';
import AuthShell, { AuthCard } from '../components/auth/AuthShell';

export default function SupportRedeemPage() {
  useForcedLightTheme();
  const [params] = useSearchParams();
  const code = params.get('code') || '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.redeemSupportSession(code);
      if (!res?.token) throw new Error('The branch did not return a session.');
      localStorage.setItem('token', res.token);
      // THE ACTOR AND THE REASON ARE STORED FOR THE BANNER, and they come from
      // the response rather than from a lookup: the operator is a person in
      // HQ's database, which this deployment cannot read at all. There is no
      // `realUser` row to find here, and an id sent across would resolve to
      // whoever holds that number locally.
      localStorage.setItem('supportSession', JSON.stringify({
        actor_name: res.actor_name || null,
        reason: res.reason || null,
        expires_at: res.expires_at || null,
        branch: res.branch || null,
      }));
      if (res.target) localStorage.setItem('user', JSON.stringify(res.target));
      window.location.href = '/dashboard';
    } catch (e) {
      // Says what did NOT happen: no session was opened, and the code — if it
      // was ever valid — is spent either way, so the next step is HQ's.
      setError(e?.message || 'That link could not be used. No support session was opened.');
      reportError('SupportRedeemPage:open', e);
      setBusy(false);
    }
  };

  return (
    <AuthShell platformNote="Support session">
      <AuthCard>
        <div className="flex items-start gap-3">
          <LifeBuoy className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#7c3aed' }} aria-hidden="true" />
          <div>
            {/* This page calls useForcedLightTheme(), like /login and
                /register: it renders inside AuthShell's hand-built light
                palette, so a dark: variant would never apply and would imply
                the card follows the viewer's theme. dark-mode-exempt */}
            <h1 className="text-lg font-semibold text-gray-900">Open a support session</h1>
            <p className="mt-1 text-sm text-gray-600">
              Axal VC HQ authorised a support session on this branch. Opening it signs you in as the
              account HQ named, for 30 minutes, and records who you are and why on this branch&apos;s
              audit trail.
            </p>
          </div>
        </div>

        {!code && (
          <p
            className="mt-5 rounded-lg px-3 py-2 text-sm"
            style={{ background: '#fef2f2', color: '#9f1239' }}
            data-testid="support-redeem-no-code"
          >
            This link carries no code, so there is nothing to open. Ask HQ to start the session again.
          </p>
        )}

        {error && (
          <p
            className="mt-5 flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: '#fef2f2', color: '#9f1239' }}
            data-testid="support-redeem-error"
          >
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <button
          type="button"
          onClick={open}
          disabled={!code || busy}
          data-testid="support-redeem-open"
          className="mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: '#7c3aed' }}
        >
          {busy ? 'Opening…' : 'Open the support session'}
        </button>

        <p className="mt-4 text-xs text-gray-500">
          Single use. The link stops working once it is opened, or five minutes after HQ created it,
          whichever comes first.
        </p>
      </AuthCard>
    </AuthShell>
  );
}
