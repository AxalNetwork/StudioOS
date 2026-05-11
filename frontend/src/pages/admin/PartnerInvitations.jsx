import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Mail, Plus, RefreshCw, Ban, Send, Copy, CheckCircle2, Clock, AlertTriangle,
  X, Search, Handshake, ExternalLink, Loader2, ShieldAlert, TrendingUp, Users,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../components/useToast';
import { useEscapeClose } from '../../components/useEscapeClose';

const ALL_DEAL_TYPES = [
  { value: 'equity_partnership', label: 'Equity Partnership' },
  { value: 'services_partnership', label: 'Services Partnership' },
  { value: 'deal_sourcing_revshare', label: 'Deal Sourcing Rev-Share' },
  { value: 'capital_partnership', label: 'Capital Partnership' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_BADGE = {
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  viewed: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  profiled: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  proposed: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
  selected: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  finalized: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  signed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  revoked: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  expired: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const DEAL_BADGE = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  awaiting_signature: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  terminated: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  expired: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  voided: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  proposed: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
};

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}

export default function PartnerInvitations() {
  const [tab, setTab] = useState('invitations');
  const [invitations, setInvitations] = useState([]);
  const [deals, setDeals] = useState([]);
  const [dealsStatus, setDealsStatus] = useState('active');
  const [statusFilter, setStatusFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [terminateTarget, setTerminateTarget] = useState(null);
  const [busyIds, setBusyIds] = useState(new Set());
  // Task #26 — admin operational counters
  const [topDeals, setTopDeals] = useState([]);
  const [drilldownDeal, setDrilldownDeal] = useState(null);
  const { toast, showToast } = useToast();

  const loadInvitations = useCallback(async () => {
    try {
      const r = await api.adminPartners.listInvitations({
        status: statusFilter || undefined,
        email: emailFilter.trim() || undefined,
      });
      setInvitations(r.items || []);
    } catch (e) {
      showToast({ kind: 'error', msg: e.message || 'Failed to load invitations' });
    }
  }, [statusFilter, emailFilter, showToast]);

  const loadDeals = useCallback(async () => {
    try {
      const [r, top] = await Promise.all([
        api.adminPartners.listDeals(dealsStatus),
        // Task #26 — top deals by redemptions, ranked across all statuses
        // so admins can see the all-time leaders regardless of the filter.
        api.adminPartners.listTopDeals({ limit: 5, status: 'all' }).catch(() => ({ items: [] })),
      ]);
      setDeals(r.items || []);
      setTopDeals((top.items || []).filter((d) => (d.redemptions_count || 0) > 0));
    } catch (e) {
      showToast({ kind: 'error', msg: e.message || 'Failed to load deals' });
    }
  }, [dealsStatus, showToast]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadInvitations(), loadDeals()]).finally(() => setLoading(false));
  }, [loadInvitations, loadDeals]);

  const markBusy = (id, on) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const onResend = async (id) => {
    markBusy(`r-${id}`, true);
    try {
      const r = await api.adminPartners.resendInvitation(id);
      showToast({ kind: 'success', msg: r.email_sent ? 'Invitation re-sent' : 'Saved (email delivery skipped)' });
      await loadInvitations();
    } catch (e) {
      showToast({ kind: 'error', msg: e.message || 'Resend failed' });
    } finally { markBusy(`r-${id}`, false); }
  };

  const onCopyLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      showToast({ kind: 'success', msg: 'Link copied' });
    } catch {
      showToast({ kind: 'error', msg: 'Copy failed — long-press the link' });
    }
  };

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Handshake size={22} className="text-violet-600" /> Partner Invitations
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Invite partners, track onboarding progress, and manage signed deals.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
        >
          <Plus size={15} /> New Invitation
        </button>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-800 mb-4 flex gap-1">
        {[
          ['invitations', `Invitations (${invitations.length})`],
          ['deals', `Deals (${deals.length})`],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === k
                ? 'border-violet-600 text-violet-700 dark:text-violet-300'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'invitations' && (
        <div data-card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
          <div className="p-4 flex flex-wrap items-center gap-2 border-b border-gray-100 dark:border-gray-800">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={emailFilter}
                onChange={(e) => setEmailFilter(e.target.value)}
                placeholder="Filter by email…"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">All statuses</option>
              {Object.keys(STATUS_BADGE).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              type="button"
              onClick={loadInvitations}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left px-4 py-2">Recipient</th>
                  <th className="text-left px-4 py-2">Allowed</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Sent</th>
                  <th className="text-left px-4 py-2">Expires</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {loading ? (
                  <tr><td colSpan="6" className="px-4 py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></td></tr>
                ) : invitations.length === 0 ? (
                  <tr><td colSpan="6" className="px-4 py-10 text-center text-gray-400">No invitations yet.</td></tr>
                ) : invitations.map((inv) => {
                  const canResend = !['signed', 'revoked'].includes(inv.status);
                  const canRevoke = !['signed', 'revoked'].includes(inv.status);
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{inv.recipient_name || '—'}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{inv.recipient_email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(inv.allowed_deal_types || []).map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                              {t.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[inv.status] || 'bg-gray-100 text-gray-600'}`}>
                          {inv.status}
                          {inv.is_expired && inv.status !== 'signed' && inv.status !== 'revoked' && (
                            <AlertTriangle size={10} className="text-amber-600" />
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtDate(inv.created_at)}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtDate(inv.expires_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onCopyLink(inv.link)}
                            title="Copy link"
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          >
                            <Copy size={14} />
                          </button>
                          {canResend && (
                            <button
                              type="button"
                              disabled={busyIds.has(`r-${inv.id}`)}
                              onClick={() => onResend(inv.id)}
                              title="Resend"
                              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
                            >
                              {busyIds.has(`r-${inv.id}`) ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            </button>
                          )}
                          {canRevoke && (
                            <button
                              type="button"
                              onClick={() => setRevokeTarget(inv)}
                              title="Revoke"
                              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500 hover:text-red-700"
                            >
                              <Ban size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'deals' && topDeals.length > 0 && (
        <div data-card className="mb-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={15} className="text-violet-600" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Top deals by redemptions</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {topDeals.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDrilldownDeal(d)}
                className="text-left rounded-lg border border-gray-200 dark:border-gray-800 hover:border-violet-400 dark:hover:border-violet-700 p-3 bg-gray-50 dark:bg-gray-800/40 transition-colors"
              >
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{d.partner_name || d.partner_email || 'Unknown partner'}</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-semibold text-violet-700 dark:text-violet-300">{d.redemptions_count || 0}</span>
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">redemptions</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-1 font-mono truncate">{d.referral_code || '—'}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{String(d.deal_type || '').replace(/_/g, ' ')} · {d.status}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'deals' && (
        <div data-card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
          <div className="p-4 flex flex-wrap items-center gap-2 border-b border-gray-100 dark:border-gray-800">
            <select
              value={dealsStatus}
              onChange={(e) => setDealsStatus(e.target.value)}
              className="text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
            >
              {['active', 'awaiting_signature', 'expired', 'terminated', 'voided', 'proposed'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadDeals}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left px-4 py-2">Partner</th>
                  <th className="text-left px-4 py-2">Deal type</th>
                  <th className="text-left px-4 py-2">Tiers granted</th>
                  <th className="text-left px-4 py-2">Term</th>
                  <th className="text-left px-4 py-2">Referral</th>
                  <th className="text-left px-4 py-2">Redemptions</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {loading ? (
                  <tr><td colSpan="8" className="px-4 py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></td></tr>
                ) : deals.length === 0 ? (
                  <tr><td colSpan="8" className="px-4 py-10 text-center text-gray-400">No {dealsStatus} deals.</td></tr>
                ) : deals.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{d.partner_name || '—'}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{d.partner_email || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{String(d.deal_type || '').replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5 text-xs">
                        {d.granted_tier_founder && <span>Founder: <strong>{d.granted_tier_founder}</strong></span>}
                        {d.granted_tier_investor && <span>Investor: <strong>{d.granted_tier_investor}</strong></span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{d.term_months ? `${d.term_months} mo` : '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-violet-700 dark:text-violet-300">{d.referral_code || '—'}</td>
                    <td className="px-4 py-3">
                      {(d.redemptions_count || 0) > 0 ? (
                        <button
                          type="button"
                          onClick={() => setDrilldownDeal(d)}
                          className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-700 hover:underline"
                          title="View redeemers"
                        >
                          {d.redemptions_count} <Users size={12} />
                        </button>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full font-medium ${DEAL_BADGE[d.status] || 'bg-gray-100 text-gray-600'}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {d.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => setTerminateTarget(d)}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                        >
                          <Ban size={12} /> Terminate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateInvitationModal
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            showToast({ kind: 'success', msg: 'Invitation sent' });
            await loadInvitations();
          }}
          onError={(msg) => showToast({ kind: 'error', msg })}
        />
      )}

      {revokeTarget && (
        <RevokeModal
          invitation={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onDone={async (msg) => {
            setRevokeTarget(null);
            showToast({ kind: 'success', msg });
            await loadInvitations();
            await loadDeals();
          }}
          onError={(msg) => showToast({ kind: 'error', msg })}
        />
      )}

      {drilldownDeal && (
        <RedemptionsModal
          deal={drilldownDeal}
          onClose={() => setDrilldownDeal(null)}
          onError={(msg) => showToast({ kind: 'error', msg })}
        />
      )}

      {terminateTarget && (
        <TerminateModal
          deal={terminateTarget}
          onClose={() => setTerminateTarget(null)}
          onDone={async (msg) => {
            setTerminateTarget(null);
            showToast({ kind: 'success', msg });
            await loadDeals();
          }}
          onError={(msg) => showToast({ kind: 'error', msg })}
        />
      )}

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

function CreateInvitationModal({ onClose, onCreated, onError }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [allowed, setAllowed] = useState(['equity_partnership']);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdLink, setCreatedLink] = useState(null);
  const close = useCallback(() => { if (!submitting) onClose(); }, [submitting, onClose]);
  useEscapeClose(close);

  const toggle = (t) =>
    setAllowed((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || allowed.length === 0) return;
    setSubmitting(true);
    try {
      const r = await api.adminPartners.createInvitation({
        recipient_email: email.trim(),
        recipient_name: name.trim() || undefined,
        allowed_deal_types: allowed,
        personal_message: message.trim() || undefined,
      });
      setCreatedLink(r.link);
      // brief delay so the user can copy the link before the modal closes
      setTimeout(() => onCreated(r), 1500);
    } catch (err) {
      onError(err.message || 'Failed to create invitation');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={close}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Mail size={16} className="text-violet-600" /> New Partner Invitation
          </h2>
          <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        {createdLink ? (
          <div className="p-5 space-y-3">
            <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={18} className="mt-0.5" />
              <div>
                <div className="font-medium">Invitation created</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Share this magic link with the partner:</div>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <input
                readOnly
                value={createdLink}
                className="flex-1 bg-transparent text-xs font-mono text-gray-700 dark:text-gray-300 outline-none"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(createdLink)}
                className="text-xs px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-700"
              >
                Copy
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Recipient email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Recipient name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Allowed deal types *</label>
              <div className="space-y-1.5">
                {ALL_DEAL_TYPES.map((t) => (
                  <label key={t.value} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowed.includes(t.value)}
                      onChange={() => toggle(t.value)}
                      className="rounded text-violet-600 focus:ring-violet-500"
                    />
                    {t.label}
                  </label>
                ))}
              </div>
              {allowed.length === 0 && (
                <p className="text-xs text-red-600 mt-1">Pick at least one deal type.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Notes (optional)</label>
              <textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Hey — would love to bring you on as a partner…"
                className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Shown to the partner inside the onboarding wizard.</p>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <Clock size={12} /> Invitation link expires automatically after 14 days.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={close} disabled={submitting}
                className="px-4 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancel
              </button>
              <button type="submit" disabled={submitting || !email.trim() || allowed.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50">
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Send Invitation
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function RevokeModal({ invitation, onClose, onDone, onError }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const close = useCallback(() => { if (!submitting) onClose(); }, [submitting, onClose]);
  useEscapeClose(close);
  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await api.adminPartners.revokeInvitation(invitation.id, reason);
      const parts = ['Invitation revoked'];
      if (r.voided_deals) parts.push(`${r.voided_deals} deal(s) voided`);
      if (r.voided_envelopes) parts.push(`${r.voided_envelopes} envelope(s) voided`);
      onDone(parts.join(' · '));
    } catch (e) {
      onError(e.message || 'Revoke failed');
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={close}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ShieldAlert size={16} className="text-red-600" /> Revoke invitation
          </h2>
          <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Revoking <strong>{invitation.recipient_email}</strong> will void any in-flight deal and signing envelope.
            This is permanent.
          </p>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional, audited)"
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/40"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} disabled={submitting}
              className="px-4 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Revoke
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TerminateModal({ deal, onClose, onDone, onError }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const close = useCallback(() => { if (!submitting) onClose(); }, [submitting, onClose]);
  useEscapeClose(close);
  const submit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      const r = await api.adminPartners.terminateDeal(deal.id, reason.trim());
      const parts = ['Deal terminated'];
      if (r.tiers_revoked) parts.push('partner tier revoked');
      if (r.redemptions_revoked) parts.push(`${r.redemptions_revoked} downstream redemption(s) revoked`);
      onDone(parts.join(' · '));
    } catch (e) {
      onError(e.message || 'Terminate failed');
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={close}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ShieldAlert size={16} className="text-red-600" /> Terminate deal
          </h2>
          <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Terminating <strong>{deal.partner_email || `Deal #${deal.id}`}</strong> will revoke their granted tiers
            and cascade to every prior referral redemption. This cannot be undone.
          </p>
          <textarea
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, audited)"
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/40"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} disabled={submitting}
              className="px-4 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={submitting || !reason.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Terminate Deal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Task #26 — Per-deal redemption drill-down. Lists every user who has
// redeemed the deal's referral code with date + granted tiers. For
// `deal_sourcing_revshare` deals, also shows the per-redemption
// attribution window remaining (365 days from intro).
function RedemptionsModal({ deal, onClose, onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEscapeClose(onClose);
  useEffect(() => {
    let cancelled = false;
    api.adminPartners.dealRedemptions(deal.id)
      .then((r) => { if (!cancelled) { setData(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setLoading(false); onError(e.message || 'Failed to load redemptions'); } });
    return () => { cancelled = true; };
  }, [deal.id, onError]);

  const isRevshare = (data?.deal?.deal_type || deal.deal_type) === 'deal_sourcing_revshare';
  const items = data?.items || [];

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Users size={16} className="text-violet-600" /> Redemptions
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {deal.partner_name || deal.partner_email || `Deal #${deal.id}`} ·
              <span className="font-mono ml-1">{deal.referral_code || '—'}</span>
              {isRevshare && data?.revshare_attribution_days && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-400">
                  rev-share · {data.revshare_attribution_days}d window
                </span>
              )}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto">
          {loading ? (
            <div className="p-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">No redemptions yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left px-4 py-2">Redeemed by</th>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Granted tiers</th>
                  {isRevshare && <th className="text-right px-4 py-2">Rev-share window</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{r.redeemer_name || '—'}</div>
                      <div className="text-xs text-gray-500">{r.redeemer_email || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{fmtDate(r.redeemed_at)}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {r.granted_tier_founder && <div>Founder: <strong>{r.granted_tier_founder}</strong></div>}
                      {r.granted_tier_investor && <div>Investor: <strong>{r.granted_tier_investor}</strong></div>}
                      {!r.granted_tier_founder && !r.granted_tier_investor && <span className="text-gray-400">—</span>}
                    </td>
                    {isRevshare && (
                      <td className="px-4 py-2.5 text-right">
                        {r.revshare_window_remaining_days != null ? (
                          <span className={`text-xs font-medium ${
                            r.revshare_window_remaining_days <= 30 ? 'text-amber-600' : 'text-emerald-600'
                          }`}>
                            {r.revshare_window_remaining_days > 0
                              ? `${r.revshare_window_remaining_days}d left`
                              : 'Closed'}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
