import React, { useEffect, useState } from 'react';
import { Wallet, DollarSign, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

const STATUS_META = {
  requested: { label: 'Requested', color: 'bg-amber-100 text-amber-700', icon: Clock },
  processing: { label: 'Processing', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700', icon: XCircle },
};

export default function PayoutsPage() {
  const [commissions, setCommissions] = useState({ balance_cents: 0, lifetime_cents: 0, commissions: [] });
  const [payouts, setPayouts] = useState([]);
  const [method, setMethod] = useState('wire');
  const [details, setDetails] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([api.commissionsMe(), api.payoutsMe()]);
      setCommissions(c);
      setPayouts(p);
      setAmount(((c.balance_cents || 0) / 100).toFixed(2));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

  const submit = async () => {
    setError(''); setSuccess('');
    const cents = Math.round(parseFloat(amount) * 100);
    if (!cents || cents < 1000) { setError('Minimum payout is $10.00'); return; }
    if (cents > commissions.balance_cents) { setError('Amount exceeds available balance'); return; }
    setSubmitting(true);
    try {
      await api.payoutRequest({
        amount_cents: cents,
        payout_method: method,
        payout_details: details ? { destination: details } : null,
      });
      setSuccess('Payout requested. An admin will process it shortly.');
      setDetails('');
      await load();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Wallet className="text-violet-600" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payouts</h1>
          <p className="text-sm text-gray-600">Request payouts of accrued referral commissions.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-xs text-emerald-700 mb-1 flex items-center gap-1.5"><DollarSign size={12} /> Available</div>
          <div className="text-2xl font-bold text-emerald-900">{fmt(commissions.balance_cents)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-600 mb-1">Lifetime Earned</div>
          <div className="text-2xl font-bold text-gray-900">{fmt(commissions.lifetime_cents)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-600 mb-1">Pending Payouts</div>
          <div className="text-2xl font-bold text-gray-900">
            {fmt(payouts.filter(p => ['requested', 'processing'].includes(p.status)).reduce((s, p) => s + (p.amount_cents || 0), 0))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Request a Payout</h2>

        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
        {success && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">{success}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs text-gray-600 block mb-1">Amount (USD)</label>
            <input type="number" step="0.01" min="10" max={(commissions.balance_cents / 100).toFixed(2)}
              value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
              <option value="wire">Bank Wire</option>
              <option value="stripe">Stripe Connect</option>
              <option value="crypto">Crypto (USDC)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">
              {method === 'wire' ? 'Bank/SWIFT details' : method === 'crypto' ? 'Wallet address (USDC)' : 'Stripe account ID (optional)'}
            </label>
            <input type="text" value={details} onChange={e => setDetails(e.target.value)}
              placeholder={method === 'crypto' ? '0x…' : method === 'wire' ? 'IBAN / Routing+Account' : 'acct_…'}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none" />
          </div>
        </div>

        <button onClick={submit} disabled={submitting || commissions.balance_cents < 1000}
          className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {submitting ? 'Requesting…' : 'Request Payout'}
        </button>
        <p className="text-[11px] text-gray-500 mt-2">Note: Amount must match the sum of available commissions (FIFO). Minimum $10. Stripe Connect integration is stubbed; admin processes payouts manually for now.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Payout History</h2>
        </div>
        {payouts.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No payouts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-600">
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Amount</th>
                  <th className="px-6 py-3 font-medium">Method</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payouts.map(p => {
                  const meta = STATUS_META[p.status] || STATUS_META.requested;
                  const Icon = meta.icon;
                  return (
                    <tr key={p.id}>
                      <td className="px-6 py-3 text-gray-700 text-xs">{new Date(p.created_at).toLocaleString()}</td>
                      <td className="px-6 py-3 font-medium text-gray-900">{fmt(p.amount_cents)}</td>
                      <td className="px-6 py-3 text-gray-700 capitalize">{p.payout_method}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${meta.color}`}>
                          <Icon size={11} className={p.status === 'processing' ? 'animate-spin' : ''} /> {meta.label}
                        </span>
                        {p.failure_reason && <div className="text-[10px] text-red-600 mt-1">{p.failure_reason}</div>}
                      </td>
                      <td className="px-6 py-3 text-gray-500 text-xs">{p.completed_at ? new Date(p.completed_at).toLocaleString() : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Commission Ledger</h2>
        </div>
        {commissions.commissions.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No commissions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-600">
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Source</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 font-medium">Amount</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {commissions.commissions.map(c => (
                  <tr key={c.id}>
                    <td className="px-6 py-3 text-xs text-gray-500">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-3 text-xs text-gray-700">{c.source_type}</td>
                    <td className="px-6 py-3 text-xs text-gray-700">{c.description || c.source_id}</td>
                    <td className="px-6 py-3 text-sm font-medium text-emerald-700">{fmt(c.amount_cents)}</td>
                    <td className="px-6 py-3">
                      <span className={`text-[11px] px-2 py-1 rounded ${c.status === 'paid' ? 'bg-gray-100 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
