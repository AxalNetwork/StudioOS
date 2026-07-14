import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { reportError } from '../lib/log';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';
import {
  Eye, Search, Plus, ArrowRight, X, Loader2, Check, ThumbsUp, ThumbsDown,
  ChevronUp, ChevronDown, TrendingUp, ArrowUpRight,
} from 'lucide-react';

// Task #18 — read role from the live AuthProvider so a stale localStorage
// user can't keep showing operator controls to a demoted viewer.
function useCurrentRole() {
  const { role } = useAuth();
  if (role) return role;
  try { return safeReadJSON('user', {}).role || null; }
  catch { return null; }
}

const PIPELINE = ['applied', 'scored', 'active', 'funded'];
const STATUSES = ['all', 'applied', 'scored', 'active', 'funded', 'rejected'];
const statusColors = {
  applied: 'bg-blue-100 text-blue-700 border-blue-500/30',
  scored: 'bg-yellow-100 text-yellow-700 border-yellow-500/30',
  active: 'bg-green-100 text-green-700 border-green-500/30',
  funded: 'bg-violet-100 text-violet-700 border-violet-500/30',
  rejected: 'bg-red-100 text-red-700 border-red-500/30',
};
const funnelAccent = {
  applied: 'border-blue-500/40',
  scored: 'border-yellow-500/40',
  active: 'border-green-500/40',
  funded: 'border-violet-500/40',
};

function fmtMoney(n) {
  if (n == null || n === 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Number(n).toLocaleString()}`;
}

export default function DealsPage() {
  const navigate = useNavigate();
  const role = useCurrentRole();
  const isInvestor = role === 'investor';
  const isAdmin = role === 'admin';
  const canOperate = role === 'admin' || role === 'partner';

  const [deals, setDeals] = useState([]);
  const [funnel, setFunnel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [drawer, setDrawer] = useState(null); // selected deal
  const [scope, setScope] = useState('mine');
  const [draftOpen, setDraftOpen] = useState(false);
  const [invitations, setInvitations] = useState([]);

  useEffect(() => { document.title = 'Deal Flow — axal'; }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInvestor, isAdmin, canOperate, scope]);

  const load = async () => {
    try {
      const [d] = await Promise.all([
        api.listDeals(undefined, isInvestor ? scope : undefined),
      ]);
      setDeals(Array.isArray(d) ? d : []);
      if (isAdmin || canOperate || isInvestor) {
        api.dealFunnel().then(setFunnel).catch(() => setFunnel(null));
      }
      if (isInvestor) {
        api.myDealInvitations().then(r => setInvitations(Array.isArray(r) ? r : [])).catch(() => {});
      }
    } catch (e) {
      reportError('DealsPage:load', e);
    }
    setLoading(false);
  };

  const counts = useMemo(() => {
    const c = {};
    STATUSES.forEach(s => { c[s] = s === 'all' ? deals.length : deals.filter(d => d.status === s).length; });
    return c;
  }, [deals]);

  const funnelByStage = useMemo(() => {
    const map = {};
    (funnel?.stages || []).forEach(s => { map[s.stage] = s; });
    return map;
  }, [funnel]);

  const rows = useMemo(() => {
    let r = filter === 'all' ? deals : deals.filter(d => d.status === filter);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter(d => (d.project_name || '').toLowerCase().includes(q)
      || (d.project_sector || '').toLowerCase().includes(q));
    const dir = sortDir === 'asc' ? 1 : -1;
    r = [...r].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'project_name') { av = av || ''; bv = bv || ''; return av.localeCompare(bv) * dir; }
      if (sortKey === 'stage') { av = PIPELINE.indexOf(a.status); bv = PIPELINE.indexOf(b.status); }
      av = av == null ? -Infinity : (typeof av === 'string' ? new Date(av).getTime() || av : av);
      bv = bv == null ? -Infinity : (typeof bv === 'string' ? new Date(bv).getTime() || bv : bv);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return r;
  }, [deals, filter, search, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortHead = ({ label, k, align = 'left' }) => (
    <th className={`px-3 py-2 text-${align} font-medium text-gray-500 select-none`}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-gray-800 dark:hover:text-gray-200">
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>
    </th>
  );

  const advance = async (deal) => {
    try {
      const updated = await api.advanceDeal(deal.id);
      setDrawer(updated);
      load();
    } catch (e) { reportError('DealsPage:advance', e); }
  };

  const respond = async (dealId, response) => {
    try {
      await api.respondDealInvitation(dealId, response);
      api.myDealInvitations().then(r => setInvitations(Array.isArray(r) ? r : [])).catch(() => {});
    } catch (e) { reportError('DealsPage:respond', e); }
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-1 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1 dark:text-gray-100">Deal Flow</h1>
          <p className="text-gray-600 dark:text-gray-400">Track deals from application to funding</p>
        </div>
        {isAdmin && (
          <button onClick={() => setDraftOpen(true)}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
            <Plus size={16} /> Draft Deal
          </button>
        )}
      </div>

      {/* Investor invitation inbox */}
      {isInvestor && invitations.filter(i => i.status === 'invited').length > 0 && (
        <div className="mt-4 mb-5 bg-violet-50 border border-violet-200 rounded-xl p-4 dark:bg-violet-900/15 dark:border-violet-800">
          <div className="text-sm font-semibold text-violet-800 mb-2 dark:text-violet-300">Deal invitations</div>
          <div className="space-y-2">
            {invitations.filter(i => i.status === 'invited').map(inv => (
              <div key={inv.id} className="flex items-center justify-between gap-3 bg-white rounded-lg p-3 border border-violet-100 dark:bg-gray-900 dark:border-gray-800">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{inv.project_name || `Deal #${inv.deal_id}`}</div>
                  {inv.message && <div className="text-xs text-gray-500 truncate">{inv.message}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => navigate(`/deals/${inv.deal_id}`)} className="text-xs text-violet-600 hover:underline">View</button>
                  <button onClick={() => respond(inv.deal_id, 'interested')}
                    className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium flex items-center gap-1">
                    <ThumbsUp size={12} /> Interested
                  </button>
                  <button onClick={() => respond(inv.deal_id, 'passed')}
                    className="px-2.5 py-1 border border-gray-300 hover:bg-gray-50 text-gray-600 rounded text-xs font-medium flex items-center gap-1 dark:border-gray-700 dark:text-gray-400">
                    <ThumbsDown size={12} /> Pass
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Funnel cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-6">
        {PIPELINE.map((stage) => {
          const f = funnelByStage[stage];
          const count = f ? f.count : counts[stage];
          return (
            <div key={stage} className={`bg-white border rounded-xl p-4 dark:bg-gray-900 ${funnelAccent[stage]} border-gray-200 dark:border-gray-800`}>
              <div className="flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${statusColors[stage]}`}>{stage}</span>
                {f && f.added_7d > 0 && (
                  <span className="text-[11px] text-green-600 flex items-center gap-0.5"><TrendingUp size={11} /> +{f.added_7d}/7d</span>
                )}
              </div>
              <div className="text-3xl font-bold text-gray-900 mt-2 dark:text-gray-100">{count ?? 0}</div>
              {f && (
                <div className="text-xs text-gray-500 mt-1">
                  {fmtMoney(f.total_committed)} committed / {fmtMoney(f.total_target)} target
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search companies..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100" />
        </div>
        {isInvestor && (
          <div className="flex gap-1">
            {[['mine', 'My deals'], ['all', 'All deals']].map(([val, label]) => (
              <button key={val} onClick={() => setScope(val)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${scope === val ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${filter === s ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-700 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-300'}`}>
            {s} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        {loading ? (
          <div className="text-center text-gray-500 py-12"><Loader2 className="animate-spin inline mr-2" size={16} /> Loading deals...</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-500 py-12">No deals found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40">
                <tr>
                  <SortHead label="Company" k="project_name" />
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Sector</th>
                  <SortHead label="Stage" k="stage" />
                  <SortHead label="Target Raise" k="target_raise" />
                  <SortHead label="Committed" k="capital_committed" />
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Lead Partner</th>
                  <SortHead label="Days in Stage" k="days_in_stage" />
                  <th className="px-3 py-2 text-right font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(deal => (
                  <tr key={deal.id} className="border-b border-gray-50 dark:border-gray-800/60 hover:bg-gray-50/60 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-3 font-medium text-gray-900 dark:text-gray-100">{deal.project_name || `Startup #${deal.project_id}`}</td>
                    <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{deal.project_sector || '—'}</td>
                    <td className="px-3 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${statusColors[deal.status] || 'bg-gray-100 text-gray-600'}`}>{deal.status}</span>
                    </td>
                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{fmtMoney(deal.target_raise)}</td>
                    <td className="px-3 py-3">
                      <div className="text-gray-700 dark:text-gray-300">{fmtMoney(deal.capital_committed)}</div>
                      {deal.target_raise > 0 && (
                        <div className="w-24 h-1.5 bg-gray-100 rounded-full mt-1 dark:bg-gray-800">
                          <div className="h-1.5 bg-violet-500 rounded-full" style={{ width: `${Math.min(100, deal.progress_pct || 0)}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{deal.lead_partner_name || '—'}</td>
                    <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{deal.days_in_stage ?? 0}d</td>
                    <td className="px-3 py-3 text-right">
                      <button onClick={() => setDrawer(deal)} className="text-gray-400 hover:text-violet-600 p-1" aria-label="View deal">
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <DealDrawer
          deal={drawer}
          onClose={() => setDrawer(null)}
          onOpenRoom={() => navigate(`/deals/${drawer.id}`)}
          canOperate={canOperate}
          onAdvance={() => advance(drawer)}
        />
      )}

      {draftOpen && (
        <DraftDealModal onClose={() => setDraftOpen(false)} onCreated={() => { setDraftOpen(false); load(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deal detail drawer
// ---------------------------------------------------------------------------
function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 dark:border-gray-800/60 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium text-right dark:text-gray-100">{value ?? '—'}</span>
    </div>
  );
}

function DealDrawer({ deal, onClose, onOpenRoom, canOperate, onAdvance }) {
  const pct = deal.progress_pct || 0;
  const canAdvance = PIPELINE.includes(deal.status) && PIPELINE.indexOf(deal.status) < PIPELINE.length - 1;
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-xl z-50 overflow-y-auto dark:bg-gray-900">
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{deal.project_name || `Deal #${deal.id}`}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${statusColors[deal.status]}`}>{deal.status}</span>
            </div>
            {deal.project_sector && <div className="text-sm text-gray-500">{deal.project_sector}</div>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {deal.description && <p className="text-sm text-gray-600 dark:text-gray-400">{deal.description}</p>}

          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Capital committed</span>
              <span>{fmtMoney(deal.capital_committed)} / {fmtMoney(deal.target_raise)}</span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full dark:bg-gray-800">
              <div className="h-2 bg-violet-500 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <div className="text-right text-[11px] text-gray-400 mt-0.5">{pct}%</div>
          </div>

          <div>
            <Row label="Target Raise" value={fmtMoney(deal.target_raise)} />
            <Row label="Minimum Check" value={fmtMoney(deal.minimum_check)} />
            <Row label="Valuation Cap" value={fmtMoney(deal.valuation_cap)} />
            <Row label="Instrument" value={deal.instrument} />
            <Row label="SPV Jurisdiction" value={deal.spv_jurisdiction} />
            <Row label="Carry" value={deal.carry_pct != null ? `${deal.carry_pct}%` : null} />
            <Row label="Management Fee" value={deal.management_fee_pct != null ? `${deal.management_fee_pct}%` : null} />
            <Row label="Closing Deadline" value={deal.closing_deadline} />
            <Row label="Lead Partner" value={deal.lead_partner_name} />
            <Row label="Days in Stage" value={`${deal.days_in_stage ?? 0} days`} />
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={onOpenRoom}
              className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2">
              View Full Deal Room <ArrowUpRight size={15} />
            </button>
            {canOperate && canAdvance && (
              <button onClick={onAdvance}
                className="px-4 py-2 border border-violet-300 text-violet-700 hover:bg-violet-50 rounded-lg text-sm font-medium flex items-center gap-1 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/20">
                <ArrowRight size={15} /> Advance
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Admin "Draft Deal" modal
// ---------------------------------------------------------------------------
function DraftDealModal({ onClose, onCreated }) {
  const [projects, setProjects] = useState([]);
  const [leads, setLeads] = useState([]);
  const [form, setForm] = useState({
    project_id: '', lead_partner_id: '', status: 'applied', description: '', website: '',
    target_raise: '', minimum_check: '', valuation_cap: '', carry_pct: '', management_fee_pct: '',
    instrument: 'SAFE', spv_jurisdiction: '', closing_deadline: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.listProjects?.().then(p => setProjects(Array.isArray(p) ? p : [])).catch(() => {});
    api.dealLeadPartners().then(l => setLeads(Array.isArray(l) ? l : [])).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const num = (v) => (v === '' || v == null ? null : Number(v));

  const submit = async () => {
    if (!form.project_id) { setErr('Select a company/project.'); return; }
    setSaving(true); setErr('');
    try {
      await api.draftDeal({
        project_id: Number(form.project_id),
        lead_partner_id: form.lead_partner_id ? Number(form.lead_partner_id) : null,
        status: form.status,
        description: form.description || null,
        website: form.website || null,
        target_raise: num(form.target_raise),
        minimum_check: num(form.minimum_check),
        valuation_cap: num(form.valuation_cap),
        carry_pct: num(form.carry_pct),
        management_fee_pct: num(form.management_fee_pct),
        instrument: form.instrument || null,
        spv_jurisdiction: form.spv_jurisdiction || null,
        closing_deadline: form.closing_deadline || null,
      });
      onCreated();
    } catch (e) {
      setErr(e.message || 'Could not create deal');
      reportError('DraftDealModal:submit', e);
    } finally { setSaving(false); }
  };

  const input = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100';
  const label = 'block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400';

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8 dark:bg-gray-900">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Draft Deal</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className={label}>Company / Project *</label>
              <select value={form.project_id} onChange={e => set('project_id', e.target.value)} className={input}>
                <option value="">Select…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Lead Partner</label>
                <select value={form.lead_partner_id} onChange={e => set('lead_partner_id', e.target.value)} className={input}>
                  <option value="">Unassigned</option>
                  {leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Stage</label>
                <select value={form.status} onChange={e => set('status', e.target.value)} className={input}>
                  {PIPELINE.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={label}>Description</label>
              <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} className={input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Website</label><input value={form.website} onChange={e => set('website', e.target.value)} className={input} placeholder="https://" /></div>
              <div><label className={label}>Instrument</label>
                <select value={form.instrument} onChange={e => set('instrument', e.target.value)} className={input}>
                  {['SAFE', 'Convertible Note', 'Equity', 'SPV'].map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div><label className={label}>Target Raise ($)</label><input type="number" value={form.target_raise} onChange={e => set('target_raise', e.target.value)} className={input} /></div>
              <div><label className={label}>Minimum Check ($)</label><input type="number" value={form.minimum_check} onChange={e => set('minimum_check', e.target.value)} className={input} /></div>
              <div><label className={label}>Valuation Cap ($)</label><input type="number" value={form.valuation_cap} onChange={e => set('valuation_cap', e.target.value)} className={input} /></div>
              <div><label className={label}>SPV Jurisdiction</label><input value={form.spv_jurisdiction} onChange={e => set('spv_jurisdiction', e.target.value)} className={input} placeholder="Delaware" /></div>
              <div><label className={label}>Carry (%)</label><input type="number" value={form.carry_pct} onChange={e => set('carry_pct', e.target.value)} className={input} /></div>
              <div><label className={label}>Management Fee (%)</label><input type="number" value={form.management_fee_pct} onChange={e => set('management_fee_pct', e.target.value)} className={input} /></div>
              <div className="col-span-2"><label className={label}>Closing Deadline</label><input type="date" value={form.closing_deadline} onChange={e => set('closing_deadline', e.target.value)} className={input} /></div>
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
          </div>
          <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
            <button onClick={submit} disabled={saving}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />} Create Deal
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
