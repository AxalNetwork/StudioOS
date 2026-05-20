import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, RefreshCw, CheckCircle, DollarSign, ArrowLeft, ShieldCheck, AlertTriangle, FileSpreadsheet,
} from 'lucide-react';
import { api } from '../../lib/api';

const fmtUSD = (cents) => `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_COLORS = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  paid:     'bg-green-100 text-green-800',
  reversed: 'bg-red-100 text-red-800',
  blocked:  'bg-gray-200 text-gray-700',
};

export default function AdminReferEarnPayouts() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineMsg, setEngineMsg] = useState('');
  const [taxYear, setTaxYear] = useState(new Date().getUTCFullYear() - 1);
  const [taxSummary, setTaxSummary] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.adminReferEarnPayouts(filter || undefined);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const runEngine = async () => {
    setEngineBusy(true); setEngineMsg('');
    try {
      const r = await api.adminReferEarnRunApprovalEngine();
      setEngineMsg(`Approval engine: scanned ${r.scanned}, approved ${r.approved}, still pending ${r.still_pending}`);
      await load();
    } catch (e) {
      setEngineMsg(`Error: ${e.message || e}`);
    } finally {
      setEngineBusy(false);
    }
  };

  const approve = async (id) => {
    setBusyId(id);
    try { await api.adminReferEarnApprove(id); await load(); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusyId(null); }
  };

  const pay = async (id) => {
    if (!confirm('Send Stripe Transfer for this payout? This action is auditable and idempotent but cannot be undone.')) return;
    setBusyId(id);
    try {
      const r = await api.adminReferEarnPay(id);
      if (r?.error) setError(`${r.error}: ${r.detail || r.country || ''}`);
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally { setBusyId(null); }
  };

  const loadTax = async () => {
    try { const r = await api.adminReferEarnTaxSummary(taxYear); setTaxSummary(r); }
    catch (e) { setError(e.message || String(e)); }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="mb-4">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft size={14} /> Back to admin
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
        <DollarSign size={22} /> Refer &amp; Earn payouts
      </h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Approve and pay referral commissions via Stripe Connect. Auto-approval runs daily; manual approve is for edge cases (compounding bonuses, orphan referrals, etc.). Sanctioned-region transfers are blocked at pay-time.
      </p>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700 dark:text-gray-300">Status:</label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="reversed">Reversed</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <button onClick={load} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded inline-flex items-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-700">
          <RefreshCw size={14} /> Refresh
        </button>
        <button
          onClick={runEngine}
          disabled={engineBusy}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded inline-flex items-center gap-1 hover:bg-blue-700 disabled:opacity-60"
        >
          {engineBusy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          Run approval engine
        </button>
        {engineMsg ? <span className="text-xs text-gray-600 dark:text-gray-300">{engineMsg}</span> : null}
      </div>

      {error ? (
        <div className="mb-3 px-3 py-2 rounded bg-red-50 text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      ) : null}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-gray-600 dark:text-gray-300">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-500 dark:text-gray-400">No rows.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="px-3 py-2">#</th>
                <th>Referrer</th>
                <th>Amount</th>
                <th>Earned</th>
                <th>Status</th>
                <th>Connect</th>
                <th>Reason / Transfer</th>
                <th className="text-right pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const connectOk = r.stripe_connect_account_id && (r.stripe_connect_charges_enabled === 1 || r.stripe_connect_charges_enabled === true);
                return (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800 align-top">
                    <td className="px-3 py-2 text-gray-500">{r.id}</td>
                    <td>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{r.referrer_name || r.referrer_email}</div>
                      <div className="text-xs text-gray-500">{r.referrer_email}</div>
                    </td>
                    <td className="font-medium text-gray-900 dark:text-gray-100">{fmtUSD(r.amount_usd_cents)}</td>
                    <td className="text-gray-700 dark:text-gray-300">{r.earned_at?.slice(0, 10)}</td>
                    <td>
                      <span className={`px-2 py-0.5 text-xs rounded ${STATUS_COLORS[r.status] || STATUS_COLORS.pending}`}>{r.status}</span>
                    </td>
                    <td className="text-xs">
                      {r.stripe_connect_account_id ? (
                        <div>
                          <div className={connectOk ? 'text-green-700' : 'text-amber-700'}>
                            {connectOk ? 'enabled' : 'pending'}
                          </div>
                          {r.stripe_connect_country ? <div className="text-gray-500">{r.stripe_connect_country}</div> : null}
                        </div>
                      ) : (
                        <span className="text-gray-400">not connected</span>
                      )}
                    </td>
                    <td className="text-xs text-gray-600 dark:text-gray-400">
                      {r.status === 'paid' && r.stripe_transfer_id ? <code>{r.stripe_transfer_id}</code> :
                       r.status === 'reversed' ? <span className="text-red-600">{r.failure_reason || 'failed'}</span> :
                       r.block_reason || '—'}
                    </td>
                    <td className="text-right pr-3">
                      {r.status === 'pending' ? (
                        <button onClick={() => approve(r.id)} disabled={busyId === r.id} className="px-2 py-1 text-xs border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-60">
                          Approve
                        </button>
                      ) : r.status === 'approved' ? (
                        <button onClick={() => pay(r.id)} disabled={busyId === r.id || !connectOk} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60 inline-flex items-center gap-1">
                          {busyId === r.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                          Pay
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
          <FileSpreadsheet size={18} /> Year-end 1099-MISC summary
        </h2>
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
          Cross-check against Stripe Connect's automatic 1099-MISC generation (Connect dashboard → Tax forms). Stripe issues the form directly; this view confirms our internal totals match.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <label className="text-sm text-gray-700 dark:text-gray-300">Tax year:</label>
          <input type="number" value={taxYear} onChange={(e) => setTaxYear(parseInt(e.target.value || '0', 10))} className="w-24 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
          <button onClick={loadTax} className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-200 dark:hover:bg-gray-600">Load</button>
        </div>
        {taxSummary ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2">Referrer</th>
                  <th>Country</th>
                  <th>Payouts</th>
                  <th>Total paid</th>
                  <th>Needs 1099?</th>
                </tr>
              </thead>
              <tbody>
                {(taxSummary.rows || []).length === 0 ? (
                  <tr><td colSpan={5} className="py-3 text-gray-500">No paid payouts in {taxSummary.year}.</td></tr>
                ) : taxSummary.rows.map((r) => (
                  <tr key={r.user_id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{r.name || r.email}</div>
                      <div className="text-xs text-gray-500">{r.email}</div>
                    </td>
                    <td className="text-gray-700 dark:text-gray-300">{r.country || '—'}</td>
                    <td className="text-gray-700 dark:text-gray-300">{r.payout_count}</td>
                    <td className="font-medium text-gray-900 dark:text-gray-100">{fmtUSD(r.total_paid_usd_cents)}</td>
                    <td>{r.needs_1099 ? <span className="px-2 py-0.5 text-xs rounded bg-orange-100 text-orange-800">Yes ($600+ US)</span> : <span className="text-gray-400 text-xs">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
