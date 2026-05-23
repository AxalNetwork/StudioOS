import React, { useCallback, useEffect, useState } from 'react';
import {
  Loader2, ShieldCheck, AlertCircle, ExternalLink, RefreshCw, DollarSign, Clock, Ban, FileText,
} from 'lucide-react';
import { api } from '../lib/api';

const fmtUSD = (cents) => `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_PILL = {
  pending:  { color: 'bg-amber-100 text-amber-800',   label: 'Pending' },
  approved: { color: 'bg-blue-100 text-blue-800',     label: 'Approved' },
  paid:     { color: 'bg-green-100 text-green-800',   label: 'Paid' },
  reversed: { color: 'bg-red-100 text-red-800',       label: 'Reversed' },
  blocked:  { color: 'bg-gray-200 text-gray-700',     label: 'Blocked' },
};

function StatusPill({ status }) {
  const s = STATUS_PILL[status] || STATUS_PILL.pending;
  return <span className={`px-2 py-0.5 text-xs rounded ${s.color}`}>{s.label}</span>;
}

function ConnectBanner({ connect, busy, onConnect, onLoginLink, onRefresh }) {
  if (!connect.connected) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <AlertCircle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
        <div className="flex-1">
          <div className="font-semibold text-amber-900">Complete payout setup</div>
          <div className="text-sm text-amber-800 mt-1">
            Connect a Stripe Express account to receive referral payouts. Stripe collects
            your tax + bank info — we never see it. Takes about 3 minutes.
          </div>
          <button
            onClick={onConnect}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-amber-700 text-white rounded hover:bg-amber-800 disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
            Start Stripe Connect onboarding
          </button>
        </div>
      </div>
    );
  }
  const reason = connect.payouts_blocked_reason;
  if (reason && reason !== 'verified') {
    const label = {
      connect_not_started: 'Connect onboarding not started',
      charges_not_enabled: 'Stripe is still verifying your account',
      verification_pending: 'Stripe verification pending',
    }[reason] || (reason.startsWith('sanctioned_country:') ? `Sanctioned region (${reason.split(':')[1]}) — payouts blocked` : 'Payouts blocked');
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <Clock className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
        <div className="flex-1">
          <div className="font-semibold text-amber-900">{label}</div>
          <div className="text-sm text-amber-800 mt-1">
            Verification status: <strong>{connect.verification_status || 'unknown'}</strong>.
            {connect.requirements_currently_due?.length ? (
              <> Stripe still needs: <code className="text-xs">{connect.requirements_currently_due.join(', ')}</code>.</>
            ) : null}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={onLoginLink} disabled={busy} className="px-3 py-1.5 text-sm bg-white border border-amber-300 rounded hover:bg-amber-100 disabled:opacity-60 dark:bg-gray-900">
              Manage payout method
            </button>
            <button onClick={onRefresh} disabled={busy} className="px-3 py-1.5 text-sm bg-white border border-amber-300 rounded hover:bg-amber-100 disabled:opacity-60 inline-flex items-center gap-1 dark:bg-gray-900">
              <RefreshCw size={14} /> Refresh status
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4 flex items-start gap-3">
      <ShieldCheck className="text-green-600 flex-shrink-0 mt-0.5" size={20} />
      <div className="flex-1">
        <div className="font-semibold text-green-900">Payouts enabled</div>
        <div className="text-sm text-green-800 mt-1">
          Your Stripe Connect account is verified and ready to receive transfers.
          {connect.country ? <> Country: <strong>{connect.country}</strong>.</> : null}
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={onLoginLink} disabled={busy} className="px-3 py-1.5 text-sm bg-white border border-green-300 rounded hover:bg-green-100 disabled:opacity-60 inline-flex items-center gap-1 dark:bg-gray-900">
            <ExternalLink size={14} /> Manage payout method &amp; tax docs
          </button>
          <button onClick={onRefresh} disabled={busy} className="px-3 py-1.5 text-sm bg-white border border-green-300 rounded hover:bg-green-100 disabled:opacity-60 inline-flex items-center gap-1 dark:bg-gray-900">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StripeConnectPayoutsPanel() {
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refreshConnect = false) => {
    try {
      if (refreshConnect) await api.referEarnConnectStatus().catch(() => null);
      const data = await api.referEarnDashboard();
      setDash(data);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const onConnect = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.referEarnConnectOnboard();
      if (r?.url) window.location.href = r.url;
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const onLoginLink = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.referEarnConnectLoginLink();
      if (r?.url) window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const onRefresh = async () => {
    setBusy(true); setError('');
    try { await load(true); }
    finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 flex items-center gap-2 text-gray-600 dark:text-gray-300">
        <Loader2 size={16} className="animate-spin" /> Loading payouts…
      </div>
    );
  }
  if (!dash) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-red-600">
        {error || 'Failed to load payouts.'}
      </div>
    );
  }

  const t = dash.totals || {};

  return (
    <div className="space-y-4" data-card>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <DollarSign size={20} /> Stripe Connect payouts
          </h3>
        </div>
        {error ? (
          <div className="mb-3 px-3 py-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>
        ) : null}
        <ConnectBanner
          connect={dash.connect}
          busy={busy}
          onConnect={onConnect}
          onLoginLink={onLoginLink}
          onRefresh={onRefresh}
        />

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs uppercase text-gray-500 dark:text-gray-400">Pending</div>
            <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">{fmtUSD(t.pending_cents)}</div>
          </div>
          <div className="rounded border border-blue-200 bg-blue-50/40 dark:bg-blue-900/10 p-3">
            <div className="text-xs uppercase text-blue-700 dark:text-blue-300">Approved</div>
            <div className="text-xl font-semibold text-blue-900 dark:text-blue-100">{fmtUSD(t.approved_cents)}</div>
          </div>
          <div className="rounded border border-green-200 bg-green-50/40 dark:bg-green-900/10 p-3">
            <div className="text-xs uppercase text-green-700 dark:text-green-300">Paid</div>
            <div className="text-xl font-semibold text-green-900 dark:text-green-100">{fmtUSD(t.paid_cents)}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs uppercase text-gray-500 dark:text-gray-400">Lifetime</div>
            <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">{fmtUSD(t.lifetime_cents)}</div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <FileText size={18} /> Referral payout history
        </h3>
        {(dash.history || []).length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No payouts yet. Earnings show up here as referrals hit their milestones.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2">Earned</th>
                  <th>Referred user</th>
                  <th>Source</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {dash.history.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 text-gray-700 dark:text-gray-300">{row.earned_at?.slice(0, 10)}</td>
                    <td className="text-gray-700 dark:text-gray-300">{row.referred_email_masked || '—'}</td>
                    <td className="text-gray-600 dark:text-gray-400">{row.source_type || '—'}</td>
                    <td className="font-medium text-gray-900 dark:text-gray-100">{fmtUSD(row.amount_usd_cents)}</td>
                    <td><StatusPill status={row.status} /></td>
                    <td className="text-xs text-gray-500 dark:text-gray-400">
                      {row.status === 'pending' && row.block_reason ? (
                        <span className="inline-flex items-center gap-1"><Clock size={12} />{row.block_reason}</span>
                      ) : row.status === 'reversed' ? (
                        <span className="inline-flex items-center gap-1 text-red-600"><Ban size={12} />reversed</span>
                      ) : row.paid_at ? `paid ${row.paid_at.slice(0, 10)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Auto-approval requires the referred user to be email-verified, KYC-passed (investors only), and past the 30-day refund window. Year-end 1099-MISC forms are generated by Stripe for US referrers earning ≥ $600.
        </div>
      </div>
    </div>
  );
}
