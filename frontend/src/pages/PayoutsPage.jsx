import React, { useEffect, useState } from 'react';
import { Wallet, DollarSign, Clock, CheckCircle2, XCircle, Loader2, ChevronDown } from 'lucide-react';
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

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError('');
    try {
      const r = await api.payoutsMe();
      setCommissions({
        balance_cents: r.balance_cents || 0,
        lifetime_cents: r.lifetime_cents || 0,
        commissions: r.commissions || [],
      });
      setPayouts(r.payouts || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true); setError(''); setSuccess('');
    try {
      await api.requestPayout({
        amount_usd: Number(amount),
        payout_method: method,
        details,
      });
      setAmount('');
      setDetails('');
      setSuccess('Payout request submitted.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading payouts…</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Available" value={`$${(commissions.balance_cents / 100).toFixed(2)}`} accent="emerald" />
        <Stat label="Lifetime Earned" value={`$${(commissions.lifetime_cents / 100).toFixed(2)}`} accent="violet" />
        <Stat label="Pending Payouts" value={`$${(payouts.filter(p => p.status !== 'completed').reduce((sum, p) => sum + Number(p.amount_cents || 0), 0) / 100).toFixed(2)}`} accent="blue" />
      </div>

      <form onSubmit={submit} className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Request a Payout</h2>
        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        {success && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-600 block mb-1">Amount (USD)</label>
            <input type="number" step="0.01" min="10" max={(commissions.balance_cents / 100).toFixed(2)}
              value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Method</label>
            <div className="relative">
              <select
                value={method}
                onChange={e => setMethod(e.target.value)}
                className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 pr-9 py-2 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition cursor-pointer"
              >
                <option value="wire">Bank Wire</option>
                <option value="stripe">Stripe Connect</option>
                <option value="crypto">Crypto (USDC)</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">
              {method === 'wire' ? 'Bank/SWIFT details' : method === 'crypto' ? 'Wallet address (USDC)' : 'Stripe account ID (optional)'}
            </label>
            <input type="text" value={details} onChange={e => setDetails(e.target.value)}
              placeholder={method === 'crypto' ? '0x…' : method === 'wire' ? 'IBAN / Routing+Account' : 'acct_…'}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition" />
          </div>
        </div>

        <button disabled={submitting} className="bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white px-4 py-2 rounded-lg font-medium transition-colors">
          {submitting ? 'Submitting…' : 'Request Payout'}
        </button>
        <p className="text-xs text-gray-500 leading-relaxed">
          Note: Amount must match the sum of available commissions (FIFO). Minimum $10. Stripe Connect integration is stubbed; admin processes payouts manually for now.
        </p>
      </form>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 font-semibold text-gray-900">Payout History</div>
        {payouts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No payouts yet.</div>
        ) : null}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 font-semibold text-gray-900">Commission Ledger</div>
        {commissions.commissions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No commissions yet.</div>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  const styles = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    violet: 'bg-violet-50 border-violet-200 text-violet-900',
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
  };
  return (
    <div className={`rounded-2xl border p-5 ${styles[accent] || styles.violet}`}>
      <div className="text-sm font-medium opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
