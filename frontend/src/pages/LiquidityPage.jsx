import React, { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, Briefcase, Sparkles, Plus, RefreshCw, Wallet, Tag, ShieldCheck, X, AlertTriangle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../lib/api';

const fmt = (cents) => {
  const v = Number(cents || 0) / 100;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
const POLL_MS = 15000;

function StatusPill({ status }) {
  const map = {
    open: 'bg-emerald-100 text-emerald-800',
    matched: 'bg-blue-100 text-blue-800',
    sold: 'bg-gray-200 text-gray-700',
    cancelled: 'bg-red-100 text-red-700',
    listed: 'bg-violet-100 text-violet-800',
    executed: 'bg-emerald-100 text-emerald-800',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
}

function MatchesPanel({ listingId, onClose, currentUser }) {
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [executing, setExecuting] = useState(null);

  const load = async () => {
    try { const r = await api.liquidityListingMatches(listingId); setMatches(r.items || []); }
    catch (e) { setErr(e.message); }
  };
  const trigger = async () => {
    setBusy(true);
    try { await api.liquidityMatch(listingId); setTimeout(load, 1500); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const execute = async (m) => {
    if (!confirm(`Execute exit at ${fmt(m.proposed_price_cents)} to ${m.buyer_email}?`)) return;
    setExecuting(m.buyer_user_id);
    try {
      await api.liquidityExecuteExit({
        listing_id: listingId,
        buyer_user_id: m.buyer_user_id,
        executed_price_cents: m.proposed_price_cents,
        buyer_type: m.buyer_type,
      });
      onClose(true);
    } catch (e) { setErr(e.message); }
    finally { setExecuting(null); }
  };

  useEffect(() => { load(); }, [listingId]);

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-3" onClick={() => onClose()}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-5 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles size={16} className="text-violet-600" /> AI Buyer Matches · Listing #{listingId}
            </div>
            <p className="text-xs text-gray-500">Top candidates ranked by sector fit, capital and role.</p>
          </div>
          <button onClick={() => onClose()}><X size={18} className="text-gray-400 hover:text-gray-700" /></button>
        </div>
        {err && <div className="bg-red-50 text-red-700 text-xs rounded px-2 py-1 mb-2">{err}</div>}
        <div className="flex gap-2 mb-3">
          <button onClick={trigger} disabled={busy}
            className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-1.5">
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Run AI Match
          </button>
        </div>
        {!matches?.length ? (
          <div className="text-xs text-gray-400 text-center py-8">No matches yet. Click "Run AI Match" to rank buyers.</div>
        ) : (
          <div className="space-y-2">
            {matches.map(m => (
              <div key={m.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{m.buyer_name || m.buyer_email}</div>
                    <div className="text-xs text-gray-500">{m.buyer_type} · score {(m.match_score * 100).toFixed(0)}%</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900">{fmt(m.proposed_price_cents)}</div>
                    <StatusPill status={m.status} />
                  </div>
                </div>
                {m.ai_explanation && <p className="text-xs text-gray-700 mt-2">{m.ai_explanation}</p>}
                {isAdmin && m.status === 'proposed' && (
                  <div className="mt-2 flex justify-end">
                    <button onClick={() => execute(m)} disabled={executing === m.buyer_user_id}
                      className="px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded">
                      {executing === m.buyer_user_id ? 'Executing…' : 'Execute exit'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ListWizard({ onClose }) {
  const [subsidiaryId, setSubsidiaryId] = useState('');
  const [shares, setShares] = useState('');
  const [askingDollars, setAskingDollars] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!subsidiaryId || !shares || !askingDollars) return setErr('All fields required.');
    setBusy(true);
    try {
      await api.liquidityList({
        subsidiary_id: parseInt(subsidiaryId, 10),
        shares: Number(shares),
        asking_price_cents: Math.round(Number(askingDollars) * 100),
        notes,
      });
      onClose(true);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-3" onClick={() => onClose()}>
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Tag size={16} className="text-violet-600" /> List my shares
          </div>
          <button type="button" onClick={() => onClose()}><X size={18} className="text-gray-400 hover:text-gray-700" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-3">AI will value your asset asynchronously after listing.</p>
        {err && <div className="bg-red-50 text-red-700 text-xs rounded px-2 py-1 mb-2 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Subsidiary ID</label>
            <input type="number" value={subsidiaryId} onChange={e => setSubsidiaryId(e.target.value)}
              required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Shares</label>
            <input type="number" step="any" value={shares} onChange={e => setShares(e.target.value)}
              required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Asking price (USD)</label>
            <input type="number" step="0.01" value={askingDollars} onChange={e => setAskingDollars(e.target.value)}
              required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => onClose()}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">Cancel</button>
          <button type="submit" disabled={busy}
            className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg">
            {busy ? 'Listing…' : 'Create listing'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function LiquidityPage({ currentUser }) {
  const [tab, setTab] = useState('marketplace');
  const [marketplace, setMarketplace] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [events, setEvents] = useState(null);
  const [showMatches, setShowMatches] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const isPrivileged = ['admin', 'partner'].includes(currentUser?.role);

  const load = async () => {
    setRefreshing(true); setErr('');
    try {
      const tasks = [api.liquidityMarketplace(), api.liquidityMyPortfolio()];
      if (isPrivileged) tasks.push(api.liquidityEvents());
      const [m, p, e] = await Promise.all(tasks);
      setMarketplace(m?.items || []);
      setPortfolio(p);
      if (e) setEvents(e?.items || []);
    } catch (e) { setErr(e.message); }
    finally { setRefreshing(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role]);

  const portfolioValueCents = useMemo(() => {
    return (portfolio?.lp_holdings || []).reduce(
      (sum, lp) => sum + Math.round((Number(lp.commitment_amount || 0) - Number(lp.invested_amount || 0)) * 100),
      0,
    );
  }, [portfolio]);

  const exitPipeline = useMemo(() => {
    const buckets = { listed: 0, matched: 0, executed: 0 };
    (events || []).forEach(e => { buckets[e.status] = (buckets[e.status] || 0) + 1; });
    return Object.entries(buckets).map(([status, count]) => ({ status, count }));
  }, [events]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp size={22} className="text-violet-600" /> Liquidity & Exits
          </h1>
          <p className="text-sm text-gray-600 mt-1">Secondary marketplace, AI valuations, and exit automation.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowWizard(true)}
            className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg flex items-center gap-1.5">
            <Plus size={13} /> List my shares
          </button>
          <button onClick={load} disabled={refreshing}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg flex items-center gap-1.5">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {err && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{err}</div>}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card icon={Briefcase} label="My Holdings" value={portfolio?.lp_holdings?.length ?? 0} sub="LP positions" accent="violet" />
        <Card icon={Wallet} label="Uncalled Capital" value={fmt(portfolioValueCents)} sub="Across funds" accent="emerald" />
        <Card icon={Tag} label="Open Listings" value={(marketplace || []).filter(l => l.status === 'open').length} sub="In marketplace" accent="blue" />
        <Card icon={ShieldCheck} label="My Listings" value={portfolio?.my_listings?.length ?? 0} sub="Created by you" accent="amber" />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-1">
        {[
          { id: 'marketplace', label: 'Marketplace' },
          { id: 'portfolio', label: 'My Portfolio' },
          ...(isPrivileged ? [{ id: 'pipeline', label: 'Exit Pipeline' }] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>{t.label}</button>
        ))}
      </div>

      {tab === 'marketplace' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(marketplace || []).map(l => (
            <div key={l.id} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{l.subsidiary_name}</div>
                  <div className="text-xs text-gray-500">{l.sector || 'Sector n/a'} · {l.jurisdiction || '—'}</div>
                </div>
                <StatusPill status={l.status} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                <div>
                  <div className="text-gray-500">Shares</div>
                  <div className="font-medium text-gray-900">{l.shares}</div>
                </div>
                <div>
                  <div className="text-gray-500">Asking</div>
                  <div className="font-medium text-gray-900">{fmt(l.asking_price_cents)}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-gray-500 flex items-center gap-1"><Sparkles size={10} className="text-violet-600" /> AI Valuation</div>
                  <div className="font-medium text-gray-900">{l.ai_valuation_cents ? fmt(l.ai_valuation_cents) : '— pending'}</div>
                </div>
              </div>
              {isPrivileged && (
                <button onClick={() => setShowMatches(l.id)}
                  className="mt-1 w-full px-3 py-1.5 text-xs bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg flex items-center justify-center gap-1.5">
                  <Sparkles size={12} /> AI Match buyers
                </button>
              )}
              <div className="text-[10px] text-gray-400 mt-1">By {l.seller_email || `user#${l.user_id}`}</div>
            </div>
          ))}
          {!marketplace?.length && (
            <div className="col-span-full text-sm text-gray-400 text-center py-12">No open listings yet.</div>
          )}
        </div>
      )}

      {tab === 'portfolio' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-sm font-semibold text-gray-900 mb-3">LP Holdings</div>
            {(portfolio?.lp_holdings || []).length === 0
              ? <div className="text-xs text-gray-400 text-center py-4">No LP positions on file.</div>
              : (
                <table className="w-full text-xs">
                  <thead className="text-gray-500"><tr>
                    <th className="text-left py-1 font-medium">Fund</th>
                    <th className="text-right font-medium">Commitment</th>
                    <th className="text-right font-medium">Invested</th>
                    <th className="text-right font-medium">Returns</th>
                    <th className="text-left font-medium">Status</th>
                  </tr></thead>
                  <tbody>
                    {portfolio.lp_holdings.map(lp => (
                      <tr key={lp.id} className="border-t border-gray-100">
                        <td className="py-1.5 text-gray-900">{lp.fund_name}</td>
                        <td className="text-right">${Number(lp.commitment_amount || 0).toLocaleString()}</td>
                        <td className="text-right">${Number(lp.invested_amount || 0).toLocaleString()}</td>
                        <td className="text-right text-emerald-700">${Number(lp.returns || 0).toLocaleString()}</td>
                        <td><StatusPill status={lp.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-sm font-semibold text-gray-900 mb-3">My Listings</div>
            {(portfolio?.my_listings || []).length === 0
              ? <div className="text-xs text-gray-400 text-center py-4">You haven't listed any shares.</div>
              : portfolio.my_listings.map(l => (
                <div key={l.id} className="border-t border-gray-100 first:border-t-0 py-2 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium text-gray-900">{l.subsidiary_name}</div>
                    <div className="text-gray-500">{l.shares} shares · ask {fmt(l.asking_price_cents)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {l.ai_valuation_cents != null && <span className="text-violet-700">AI {fmt(l.ai_valuation_cents)}</span>}
                    <StatusPill status={l.status} />
                  </div>
                </div>
              ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-sm font-semibold text-gray-900 mb-3">Exit History</div>
            {(portfolio?.exit_history || []).length === 0
              ? <div className="text-xs text-gray-400 text-center py-4">No exit events yet.</div>
              : portfolio.exit_history.map(e => (
                <div key={e.id} className="border-t border-gray-100 first:border-t-0 py-2 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium text-gray-900">{e.event_type}</div>
                    <div className="text-gray-500">{new Date(e.created_at + 'Z').toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {e.executed_price_cents != null && <span className="text-emerald-700">{fmt(e.executed_price_cents)}</span>}
                    <StatusPill status={e.status} />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {tab === 'pipeline' && isPrivileged && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm font-semibold text-gray-900 mb-3">Exit Pipeline (last 100 events)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={exitPipeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="status" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#7c3aed" />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500 sticky top-0 bg-white"><tr>
                <th className="text-left py-1 font-medium">Type</th>
                <th className="text-left font-medium">Subsidiary</th>
                <th className="text-right font-medium">Valuation</th>
                <th className="text-left font-medium">Status</th>
                <th className="text-left font-medium">When</th>
              </tr></thead>
              <tbody>
                {(events || []).map(e => (
                  <tr key={e.id} className="border-t border-gray-100">
                    <td className="py-1.5">{e.event_type}</td>
                    <td>#{e.subsidiary_id}</td>
                    <td className="text-right">{fmt(e.valuation_cents)}</td>
                    <td><StatusPill status={e.status} /></td>
                    <td className="text-gray-500">{new Date(e.created_at + 'Z').toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showWizard && <ListWizard onClose={(refresh) => { setShowWizard(false); if (refresh) load(); }} />}
      {showMatches && (
        <MatchesPanel listingId={showMatches} currentUser={currentUser}
          onClose={(refresh) => { setShowMatches(null); if (refresh) load(); }} />
      )}
    </div>
  );
}

function Card({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">{label}</span>
        {Icon && <Icon size={14} className={`text-${accent}-600`} />}
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
