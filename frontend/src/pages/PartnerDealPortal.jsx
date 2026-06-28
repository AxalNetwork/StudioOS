import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Handshake, Copy, Loader2, AlertTriangle, CheckCircle2, Clock,
  Users, ShieldAlert, RefreshCw, Sparkles, ListChecks, Circle, CircleDot,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { useToast } from '../components/useToast';

/**
 * Task #9 (X-2) — Authenticated Partner Portal showing the partner's
 * deal terms, granted tiers, referral code, and redemption count.
 */
export default function PartnerDealPortal() {
  const { user } = useAuth();
  const { toast, showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ deal: null, redemptions_count: 0, redemptions: [], next_milestones: [] });
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.partnerPortal.myDeal();
      setData(r);
    } catch (e) {
      setErr(e.message || 'Failed to load partner portal');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); showToast({ kind: 'success', msg: 'Copied' }); }
    catch { showToast({ kind: 'error', msg: 'Copy failed' }); }
  };

  if (loading) {
    return <div className="px-6 py-12 text-center text-gray-400"><Loader2 size={24} className="animate-spin inline" /></div>;
  }

  if (err) {
    return (
      <div className="px-6 py-10 max-w-2xl mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/20 p-4 flex items-start gap-3">
          <AlertTriangle className="text-red-600 mt-0.5" size={18} />
          <div>
            <div className="font-medium text-red-900 dark:text-red-200">Couldn't load your portal</div>
            <p className="text-sm text-red-700 dark:text-red-300">{err}</p>
            <button onClick={load} className="text-sm mt-2 inline-flex items-center gap-1 text-red-700 underline">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const deal = data.deal;

  if (!deal) {
    return (
      <div className="px-6 py-10 max-w-2xl mx-auto">
        <div data-card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600 mb-3">
            <Handshake size={22} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">No active partnership</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            You don't have an active partner deal yet. If you have an invitation link in your inbox,
            open it to begin onboarding.
          </p>
        </div>
      </div>
    );
  }

  const proposal = deal.proposal || {};
  const isActive = deal.status === 'active';
  const isAwaiting = deal.status === 'awaiting_signature';
  const isTerminated = deal.status === 'terminated';
  const isExpired = deal.status === 'expired';

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Handshake size={22} className="text-violet-600" /> Partner Portal
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Your partnership terms, granted tiers, and referral activity.
          </p>
        </div>
        <StatusPill status={deal.status} />
      </div>

      {isAwaiting && (
        <Banner kind="warning" icon={<Clock size={16} />}
          title="Awaiting your signature"
          message="Your envelope was sent. Once signed, your tier benefits and referral code activate immediately." />
      )}
      {isTerminated && (
        <Banner kind="error" icon={<ShieldAlert size={16} />}
          title="Deal terminated"
          message={deal.termination_reason || 'Your partnership was terminated. Contact your admin for details.'} />
      )}
      {isExpired && (
        <Banner kind="info" icon={<Clock size={16} />}
          title="Deal expired"
          message="Your partnership term has ended. Contact your admin to renew." />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Stat label="Granted founder tier" value={deal.granted_tier_founder || '—'} />
        <Stat label="Granted investor tier" value={deal.granted_tier_investor || '—'} />
        <Stat label="Term" value={deal.term_months ? `${deal.term_months} months` : '—'}
          sub={deal.expires_at ? `Expires ${new Date(deal.expires_at).toLocaleDateString()}` : null} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          <Card title="Deal terms" icon={<Sparkles size={15} className="text-violet-600" />}>
            <div className="mb-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">{String(deal.deal_type).replace(/_/g, ' ')}</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{proposal.label || '—'}</div>
              {proposal.summary && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{proposal.summary}</p>}
            </div>
            {proposal.terms && Object.keys(proposal.terms).length > 0 && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {Object.entries(proposal.terms).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-gray-500 dark:text-gray-400 capitalize">{k.replace(/_/g, ' ')}</dt>
                    <dd className="text-gray-800 dark:text-gray-200 font-medium text-right">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {deal.activated_at && (
              <p className="mt-3 text-xs text-gray-500">Activated {new Date(deal.activated_at).toLocaleDateString()}</p>
            )}
          </Card>

          {/* Task #9 (X-2) — Next milestones panel: signature → tier
              activation → first referral → renewal. Computed server-side
              so the partner always sees what's done, what's pending, and
              what's coming up. */}
          {Array.isArray(data.next_milestones) && data.next_milestones.length > 0 && (
            <Card title="Next milestones" icon={<ListChecks size={15} className="text-violet-600" />}>
              <ol className="space-y-2">
                {data.next_milestones.map((m) => (
                  <Milestone key={m.id} milestone={m} />
                ))}
              </ol>
            </Card>
          )}

          <Card title={`Recent redemptions (${data.redemptions_count})`} icon={<Users size={15} className="text-violet-600" />}>
            {data.redemptions.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                No one has redeemed your referral code yet. Share <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs">{deal.referral_code || '—'}</code> to start tracking signups.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {data.redemptions.map((r) => (
                  <li key={r.id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{r.redeemer_name || 'New user'}</div>
                      <div className="text-xs text-gray-500">
                        {r.granted_tier_founder && <span className="mr-2">Founder: {r.granted_tier_founder}</span>}
                        {r.granted_tier_investor && <span>Investor: {r.granted_tier_investor}</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">{new Date(r.redeemed_at).toLocaleDateString()}</div>
                      {/* Task #26 — revshare attribution window remaining */}
                      {r.revshare_window_remaining_days != null && (
                        <div className={`text-[11px] font-medium mt-0.5 ${
                          r.revshare_window_remaining_days <= 30 ? 'text-amber-600' : 'text-emerald-600'
                        }`}>
                          {r.revshare_window_remaining_days > 0
                            ? `${r.revshare_window_remaining_days}d rev-share left`
                            : 'Rev-share window closed'}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Your referral code" icon={<Sparkles size={15} className="text-violet-600" />}>
            {deal.referral_code ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800 p-3 text-center">
                  <div className="font-mono text-lg font-semibold text-violet-700 dark:text-violet-300 tracking-wider">
                    {deal.referral_code}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copy(deal.referral_code)}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md bg-violet-600 text-white font-medium hover:bg-violet-700"
                >
                  <Copy size={14} /> Copy code
                </button>
                <p className="text-xs text-gray-500 text-center">
                  Founders or investors who register with this code unlock the granted tier instantly.
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Your referral code activates once your e-signature is recorded.
              </p>
            )}
          </Card>

          {isActive && (
            <Card title="Quick actions" icon={<CheckCircle2 size={15} className="text-emerald-600" />}>
              <div className="space-y-2 text-sm">
                <Link to="/refer" className="block px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-800 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-gray-700 dark:text-gray-300">
                  Refer & earn dashboard →
                </Link>
                <Link to="/studio" className="block px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-800 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-gray-700 dark:text-gray-300">
                  Open my workspace →
                </Link>
                <Link to="/settings" className="block px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-800 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-gray-700 dark:text-gray-300">
                  Settings & profile →
                </Link>
              </div>
            </Card>
          )}

          {/* Task #15 — Partner opt-out toggle */}
          {data.partner && (
            <Card title="Availability" icon={<Users size={15} className="text-violet-600" />}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium text-gray-900 dark:text-gray-100">Accept new introductions</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Founders can request a match when this is on</div>
                </div>
                <Toggle
                  checked={data.partner.accepting_intros === 1}
                  onChange={async (val) => {
                    try {
                      await api.partnerPortal.setAcceptingIntros(val);
                      setData((prev) => ({ ...prev, partner: { ...prev.partner, accepting_intros: val ? 1 : 0 } }));
                      showToast({ kind: 'success', msg: val ? 'Open to introductions' : 'Not accepting introductions' });
                    } catch (e) {
                      showToast({ kind: 'error', msg: 'Update failed' });
                    }
                  }}
                />
              </div>
            </Card>
          )}
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-[80] px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
          toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
        }`}>
          {typeof toast === 'string' ? toast : toast.msg}
        </div>
      )}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform translate-y-1 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function Card({ title, icon, children }) {
  return (
    <section data-card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-3">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div data-card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    awaiting_signature: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    terminated: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    expired: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    voided: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    proposed: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
  };
  return (
    <span className={`text-xs font-medium px-3 py-1 rounded-full ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {String(status).replace(/_/g, ' ')}
    </span>
  );
}

function Milestone({ milestone }) {
  const { title, hint, status, due } = milestone;
  const styles = {
    done: { icon: <CheckCircle2 size={16} />, ring: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300', label: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', text: 'Done' },
    pending: { icon: <CircleDot size={16} />, ring: 'text-amber-600 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300', label: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', text: 'Action needed' },
    upcoming: { icon: <Circle size={16} />, ring: 'text-gray-400 bg-gray-100 dark:bg-gray-800 dark:text-gray-500', label: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', text: 'Upcoming' },
  };
  const s = styles[status] || styles.upcoming;
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full ${s.ring}`}>
        {s.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{title}</span>
          <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${s.label}`}>{s.text}</span>
          {due && <span className="text-xs text-gray-500">due {new Date(due).toLocaleDateString()}</span>}
        </div>
        {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{hint}</p>}
      </div>
    </li>
  );
}

function Banner({ kind, icon, title, message }) {
  const colors = {
    info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-200',
    warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200',
    error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200',
  };
  return (
    <div className={`mb-5 rounded-lg border p-4 flex items-start gap-3 ${colors[kind] || colors.info}`}>
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-sm opacity-90">{message}</div>
      </div>
    </div>
  );
}
