import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, Users, DollarSign, Share2, ExternalLink, Network as NetworkIcon } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../lib/api';

export default function ReferEarnPage() {
  const [data, setData] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [commissions, setCommissions] = useState({ balance_cents: 0, lifetime_cents: 0, commissions: [] });
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const qrRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [code, refs, comms] = await Promise.all([
          api.referralCode(),
          api.referralList().catch(() => []),
          api.commissionsMe().catch(() => ({ balance_cents: 0, lifetime_cents: 0, commissions: [] })),
        ]);
        setData(code);
        setReferrals(refs);
        setCommissions(comms);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (data?.register_link && qrRef.current) {
      QRCode.toCanvas(qrRef.current, data.register_link, { width: 180, margin: 2 });
    }
  }, [data]);

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;
  const convertedCount = referrals.filter(r => r.status === 'converted').length;

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Share2 className="text-violet-600" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Refer & Earn</h1>
          <p className="text-sm text-gray-600">Invite founders, partners, and LPs. Earn commissions when they reach milestones.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Users} label="Total Referred" value={referrals.length} />
        <StatCard icon={Check} label="Converted" value={convertedCount} />
        <StatCard icon={DollarSign} label="Lifetime Earned" value={fmt(commissions.lifetime_cents)} highlight />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Your Referral Link</h2>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 flex items-center gap-3">
            <code className="text-xs text-violet-700 font-mono flex-1 truncate">{data.register_link}</code>
            <button onClick={() => copy(data.register_link)}
              className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
          </div>

          <div className="text-xs text-gray-600 mb-2">Referral code</div>
          <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-lg p-4 text-center">
            <div className="text-2xl font-mono font-bold text-violet-700 tracking-wider">{data.code}</div>
          </div>

          <div className="mt-4 text-xs text-gray-500">
            Anyone who registers with your code becomes attributed to you. Commissions accrue automatically when they hit milestones (KYC approval, deal funding, LP onboarding, etc.).
            <br />
            <Link to="/network" className="inline-flex items-center gap-1 text-violet-600 hover:underline mt-2">
              <NetworkIcon size={12} /> View your referral network
            </Link>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col items-center">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">QR Code</h2>
          <canvas ref={qrRef} className="rounded" />
          <p className="text-xs text-gray-500 text-center mt-3">Scan to register with your code pre-filled.</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Wallet</h2>
          <Link to="/payouts" className="text-xs text-violet-600 hover:underline flex items-center gap-1">
            Manage payouts <ExternalLink size={11} />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="text-xs text-emerald-700 mb-1">Available Balance</div>
            <div className="text-2xl font-bold text-emerald-900">{fmt(commissions.balance_cents)}</div>
            <div className="text-[11px] text-emerald-600 mt-1">Accrued commissions ready for payout</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-600 mb-1">Lifetime Earned</div>
            <div className="text-2xl font-bold text-gray-900">{fmt(commissions.lifetime_cents)}</div>
            <div className="text-[11px] text-gray-500 mt-1">Including paid-out amounts</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Your Referrals</h2>
        </div>
        {referrals.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No referrals yet. Share your link to start earning.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-600">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Email</th>
                  <th className="px-6 py-3 font-medium">KYC</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {referrals.map(r => (
                  <tr key={r.id}>
                    <td className="px-6 py-3 text-gray-900">{r.referred_name}</td>
                    <td className="px-6 py-3 text-gray-600">{r.referred_email}</td>
                    <td className="px-6 py-3"><Pill status={r.kyc_status || 'not_started'} /></td>
                    <td className="px-6 py-3"><Pill status={r.status} /></td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
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

function StatCard({ icon: Icon, label, value, highlight }) {
  return (
    <div className={`border rounded-xl p-4 ${highlight ? 'bg-gradient-to-br from-violet-50 to-indigo-50 border-violet-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
        <Icon size={14} /> {label}
      </div>
      <div className={`text-2xl font-bold ${highlight ? 'text-violet-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function Pill({ status }) {
  const colors = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-emerald-100 text-emerald-700',
    converted: 'bg-violet-100 text-violet-700',
    rejected: 'bg-red-100 text-red-700',
    not_started: 'bg-gray-100 text-gray-600',
  };
  return <span className={`text-[11px] px-2 py-1 rounded ${colors[status] || 'bg-gray-100 text-gray-600'}`}>{status.replace('_', ' ')}</span>;
}
