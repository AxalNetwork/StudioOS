import React, { useCallback, useState } from 'react';
import { api } from '../../../lib/api';
import { Send, Search, RefreshCw, Loader2, ShieldAlert, AlertTriangle, CreditCard } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import ToastMessage from '../../../components/ToastMessage';
import { REFUND_REASON_MIN, refundReasonOk } from '../../../lib/refundReason';
import { ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the Billing console (refunds and disputes).
 */

// Task #11 — Billing admin: refunds (per-product policy + referral commission
// clawback), dispute evidence, and customer LTV. Each action is step-up gated
// server-side; the api `request` helper transparently handles the challenge.
/** A dispute's evidence fields, empty. */
export const EMPTY_EVIDENCE = Object.freeze({ uncategorized_text: '', product_description: '', customer_communication: '', refund_policy_disclosure: '', receipt: '' });

/**
 * #1437 — choosing a dispute. Evidence written for one dispute must never be
 * carried into another and submitted there, so choosing a different dispute
 * starts its evidence empty. Choosing the same one again keeps what is typed.
 */
export function pickDispute(current, evidence, next) {
  if (current && next && current.id === next.id) return { selDispute: current, evidence };
  return { selDispute: next, evidence: { ...EMPTY_EVIDENCE } };
}

export function BillingPanel() {
  const { toast, showToast } = useToast(4000);
  const inputCls = 'rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500 w-full';
  const cardCls = 'bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800';
  const headerCls = 'px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800';

  // --- Refund state ---
  const [refForm, setRefForm] = useState({ target: '', amount: '', reason: '', stripe_reason: '', target_user_id: '', override: false });
  const [refBusy, setRefBusy] = useState(false);
  const [refResult, setRefResult] = useState(null);
  const setRef = (k, v) => setRefForm((f) => ({ ...f, [k]: v }));

  const issueRefund = async (e) => {
    e.preventDefault();
    if (refBusy) return;
    const target = refForm.target.trim();
    if (!target) { showToast({ kind: 'err', msg: 'Enter a PaymentIntent (pi_…) or Charge (ch_…) id' }); return; }
    if (!refundReasonOk(refForm.reason)) { showToast({ kind: 'err', msg: `Write the reason for this refund (at least ${REFUND_REASON_MIN} characters)` }); return; }
    setRefBusy(true);
    setRefResult(null);
    try {
      const body = {};
      if (target.startsWith('ch_')) body.charge = target; else body.payment_intent = target;
      if (refForm.amount) body.amount = Math.round(Number(refForm.amount) * 100);
      body.reason = refForm.reason.trim();
      if (refForm.stripe_reason) body.stripe_reason = refForm.stripe_reason;
      if (refForm.target_user_id) body.target_user_id = Number(refForm.target_user_id);
      if (refForm.override) body.override_policy = true;
      const r = await api.adminBillingRefund(body);
      setRefResult(r);
      const claw = r.clawback?.outcome;
      const clawMsg = claw && claw !== 'no_commission' ? ` · clawback: ${claw}` : '';
      showToast({ kind: 'ok', msg: `Refund ${r.refund?.status || 'ok'}${clawMsg}` });
    } catch (err) {
      // Surface the structured policy block so the admin knows to override.
      const data = err?.data || {};
      if (data.code === 'refund_policy_blocked') {
        setRefResult({ blocked: true, ...data });
        showToast({ kind: 'err', msg: `Blocked by policy (${data.reason || data.kind}). Tick override to force.` });
      } else {
        showToast({ kind: 'err', msg: err.message || 'Refund failed' });
      }
    } finally {
      setRefBusy(false);
    }
  };

  // --- Disputes state ---
  const [disputes, setDisputes] = useState([]);
  const [dispLoading, setDispLoading] = useState(false);
  // D648 — a failed read is said, never drawn as an empty list.
  const [failed, setFailed] = useState(false);
  const [selDispute, setSelDispute] = useState(null);
  const [evidence, setEvidence] = useState({ ...EMPTY_EVIDENCE });
  const [evBusy, setEvBusy] = useState(false);
  const setEv = (k, v) => setEvidence((s) => ({ ...s, [k]: v }));

  const loadDisputes = useCallback(async () => {
    setDispLoading(true);
    try {
      const r = await api.adminBillingListDisputes(25);
      setDisputes(r.disputes || []);
      setFailed(false);
    } catch (err) {
      showToast({ kind: 'err', msg: err.message || 'Failed to load disputes' });
      setFailed(true);
    } finally {
      setDispLoading(false);
    }
  }, [showToast]);

  const submitEvidence = async (doSubmit) => {
    if (!selDispute || evBusy) return;
    const payload = {};
    Object.entries(evidence).forEach(([k, v]) => { if (v && String(v).trim()) payload[k] = String(v).trim(); });
    if (Object.keys(payload).length === 0) { showToast({ kind: 'err', msg: 'Add at least one evidence field' }); return; }
    if (doSubmit && !window.confirm('Submit evidence to Stripe? After submission it can no longer be edited.')) return;
    setEvBusy(true);
    try {
      const r = await api.adminBillingSubmitEvidence(selDispute.id, { evidence: payload, submit: doSubmit });
      showToast({ kind: 'ok', msg: doSubmit ? 'Evidence submitted' : 'Evidence saved (draft)' });
      setSelDispute(r.dispute || selDispute);
      loadDisputes();
    } catch (err) {
      showToast({ kind: 'err', msg: err.message || 'Evidence update failed' });
    } finally {
      setEvBusy(false);
    }
  };

  // --- LTV state ---
  const [ltvUserId, setLtvUserId] = useState('');
  const [ltvBusy, setLtvBusy] = useState(false);
  const [ltv, setLtv] = useState(null);

  const lookupLtv = async (e) => {
    e.preventDefault();
    if (ltvBusy) return;
    const uid = Number(ltvUserId);
    if (!Number.isInteger(uid) || uid <= 0) { showToast({ kind: 'err', msg: 'Enter a numeric user id' }); return; }
    setLtvBusy(true);
    setLtv(null);
    try {
      const r = await api.adminBillingLTV(uid);
      setLtv(r);
    } catch (err) {
      showToast({ kind: 'err', msg: err.message || 'LTV lookup failed' });
    } finally {
      setLtvBusy(false);
    }
  };

  const fmtMoney = (cents, cur = 'usd') => `${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(cur).toUpperCase()}`;
  const fmtDate = (unixSec) => unixSec ? new Date(unixSec * 1000).toLocaleDateString() : '—';

  return (
    <div className="space-y-6">
      <ToastMessage toast={toast} />

      {/* Refund */}
      <div className={cardCls}>
        <div className={headerCls}>
          <RefreshCw size={16} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Issue Refund</h3>
          <span className="text-xs text-gray-500">Reverses the referral commission automatically · HQ's super admin only, after a step-up</span>
        </div>
        <form onSubmit={issueRefund} className="p-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-gray-600 dark:text-gray-400 sm:col-span-2">
            PaymentIntent or Charge id
            <input className={inputCls} placeholder="pi_… or ch_…" value={refForm.target} onChange={(e) => setRef('target', e.target.value)} data-testid="refund-target" />
          </label>
          <label className="text-xs text-gray-600 dark:text-gray-400">
            Amount (leave blank for full)
            <input className={inputCls} type="number" step="0.01" min="0" placeholder="e.g. 49.00" value={refForm.amount} onChange={(e) => setRef('amount', e.target.value)} data-testid="refund-amount" />
          </label>
          {/* D224 — the written reason is required, and the Stripe category is
              separate from it: "duplicate" says what Stripe files the refund
              under, not why HQ issued it. */}
          <label className="text-xs text-gray-600 dark:text-gray-400 sm:col-span-2">
            Reason (required, at least {REFUND_REASON_MIN} characters)
            <textarea className={inputCls} rows={2} required minLength={REFUND_REASON_MIN} placeholder="Why this money goes back" value={refForm.reason} onChange={(e) => setRef('reason', e.target.value)} data-testid="refund-reason" />
          </label>
          <label className="text-xs text-gray-600 dark:text-gray-400">
            Stripe category (optional)
            <select className={inputCls} value={refForm.stripe_reason} onChange={(e) => setRef('stripe_reason', e.target.value)}>
              <option value="">—</option>
              <option value="requested_by_customer">Requested by customer</option>
              <option value="duplicate">Duplicate</option>
              <option value="fraudulent">Fraudulent</option>
            </select>
          </label>
          <label className="text-xs text-gray-600 dark:text-gray-400">
            Target user id (optional, for audit)
            <input className={inputCls} type="number" min="1" placeholder="123" value={refForm.target_user_id} onChange={(e) => setRef('target_user_id', e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 sm:col-span-2">
            <input type="checkbox" checked={refForm.override} onChange={(e) => setRef('override', e.target.checked)} data-testid="refund-override" />
            Override product refund policy (force a blocked refund — recorded in audit)
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={refBusy}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm rounded-md inline-flex items-center gap-1.5" data-testid="refund-submit">
              {refBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Issue refund
            </button>
          </div>
        </form>
        {refResult && (
          <div className="px-4 pb-4 text-xs">
            {refResult.blocked ? (
              <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300">
                <AlertTriangle size={12} className="inline mr-1" /> Blocked by policy: <strong>{refResult.reason}</strong> ({refResult.kind}). Tick override to force.
              </div>
            ) : (
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 space-y-1">
                <div>Refund <strong>{refResult.refund?.status}</strong> · {fmtMoney(refResult.refund?.amount, refResult.refund?.currency)} · {refResult.refund?.id}</div>
                <div>Policy: {refResult.policy?.kind}{refResult.policy?.overridden ? ' (overridden)' : ''}{refResult.policy?.note ? ` — ${refResult.policy.note}` : ''}</div>
                <div>Commission clawback: <strong>{refResult.clawback?.outcome}</strong>{refResult.clawback?.reversed_amount_cents != null ? ` (${fmtMoney(refResult.clawback.reversed_amount_cents)})` : ''}{refResult.clawback?.detail ? ` — ${refResult.clawback.detail}` : ''}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Disputes */}
      <div className={cardCls}>
        <div className={headerCls}>
          <ShieldAlert size={16} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Disputes</h3>
          <div className="ml-auto">
            <button onClick={loadDisputes} disabled={dispLoading}
              className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md text-gray-700 inline-flex items-center gap-1 dark:bg-gray-800 dark:text-gray-300" data-testid="disputes-refresh">
              {dispLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Load disputes
            </button>
          </div>
        </div>
        <div className="p-4 grid gap-4 md:grid-cols-2">
          <div>
            {failed ? (
              <ConsoleUnreadable what="The disputes" onRetry={() => loadDisputes()} />
            ) : disputes.length === 0 ? (
              <p className="text-xs text-gray-500">No disputes loaded. Click “Load disputes”.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800 text-xs">
                {disputes.map((d) => (
                  <li key={d.id}>
                    <button onClick={() => { const n = pickDispute(selDispute, evidence, d); setSelDispute(n.selDispute); setEvidence(n.evidence); }}
                      className={`w-full text-left py-2 px-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded ${selDispute?.id === d.id ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{fmtMoney(d.amount, d.currency)}</span>
                        <span className="text-gray-500">{d.status}</span>
                      </div>
                      <div className="text-gray-500">{d.reason} · due {fmtDate(d.due_by)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            {selDispute ? (
              <div className="space-y-2">
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  <strong className="text-gray-900 dark:text-gray-100">{selDispute.id}</strong> · {selDispute.status} · {selDispute.reason}
                </div>
                {['uncategorized_text', 'product_description', 'customer_communication', 'refund_policy_disclosure', 'receipt'].map((f) => (
                  <label key={f} className="block text-[11px] text-gray-600 dark:text-gray-400">
                    {f === 'receipt' ? 'receipt (Stripe file id file_…)' : f}
                    {f === 'receipt' ? (
                      <input className={inputCls} value={evidence[f]} onChange={(e) => setEv(f, e.target.value)} placeholder="file_…" />
                    ) : (
                      <textarea className={`${inputCls} min-h-[48px]`} value={evidence[f]} onChange={(e) => setEv(f, e.target.value)} />
                    )}
                  </label>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={() => submitEvidence(false)} disabled={evBusy}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-800 text-xs rounded-md dark:bg-gray-800 dark:text-gray-200">Save draft</button>
                  <button onClick={() => submitEvidence(true)} disabled={evBusy}
                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs rounded-md inline-flex items-center gap-1.5">
                    {evBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Submit to Stripe
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Select a dispute to add evidence.</p>
            )}
          </div>
        </div>
      </div>

      {/* LTV */}
      <div className={cardCls}>
        <div className={headerCls}>
          <CreditCard size={16} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer Lifetime Value</h3>
        </div>
        <form onSubmit={lookupLtv} className="p-4 flex items-end gap-2 flex-wrap">
          <label className="text-xs text-gray-600 dark:text-gray-400">
            User id
            <input className={inputCls} type="number" min="1" placeholder="123" value={ltvUserId} onChange={(e) => setLtvUserId(e.target.value)} data-testid="ltv-user-id" />
          </label>
          <button type="submit" disabled={ltvBusy}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm rounded-md inline-flex items-center gap-1.5" data-testid="ltv-submit">
            {ltvBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Look up
          </button>
        </form>
        {ltv && (
          <div className="px-4 pb-4 text-xs space-y-3">
            <div className="text-gray-700 dark:text-gray-300">
              {ltv.user?.email || `user #${ltv.user?.id}`}{ltv.note === 'no_stripe_customer' ? ' — no Stripe customer on file' : ''}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 dark:bg-gray-800 dark:border-gray-700">
                <div className="text-gray-500">Net LTV</div>
                <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(ltv.ltv?.net_cents, ltv.ltv?.currency)}</div>
              </div>
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 dark:bg-gray-800 dark:border-gray-700">
                <div className="text-gray-500">Gross paid</div>
                <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(ltv.ltv?.gross_cents, ltv.ltv?.currency)}</div>
              </div>
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 dark:bg-gray-800 dark:border-gray-700">
                <div className="text-gray-500">Refunded</div>
                <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(ltv.ltv?.refunded_cents, ltv.ltv?.currency)}</div>
              </div>
            </div>
            <div className="text-gray-500">{ltv.ltv?.charge_count || 0} charges across {ltv.customer_ids?.length || 0} Stripe customer(s)</div>
            {ltv.mixed_currency && (
              <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300">
                <AlertTriangle size={12} className="inline mr-1" /> Multiple currencies — totals above are for {String(ltv.ltv?.currency).toUpperCase()} only.
                <div className="mt-1 space-x-2">
                  {ltv.by_currency?.map((b) => (
                    <span key={b.currency}>{fmtMoney(b.net_cents, b.currency)} ({b.charge_count})</span>
                  ))}
                </div>
              </div>
            )}
            {ltv.charges?.length > 0 && (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {ltv.charges.map((ch) => (
                  <li key={ch.id} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="text-gray-700 dark:text-gray-300 truncate">{fmtDate(ch.created)} · {ch.description || ch.id}</span>
                    <span className="text-gray-900 dark:text-gray-100">{fmtMoney(ch.amount - ch.amount_refunded, ch.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default BillingPanel;
