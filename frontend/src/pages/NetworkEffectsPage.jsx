import React, { useEffect, useState } from 'react';
import { TrendingUp, Users, Store, Layers, Plus, Loader2, Sparkles, X, Save, Search, Send, Brain, Star, Briefcase, ChevronDown, Building2 } from 'lucide-react';
import { api } from '../lib/api';
import CompanyProfilePanel from '../components/CompanyProfilePanel';

export default function NetworkEffectsPage() {
  const [tab, setTab] = useState('compounding');
  const [stats, setStats] = useState(null);

  useEffect(() => { (async () => { try { setStats(await api.networkFxEffects()); } catch {} })(); }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp className="text-violet-600" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Network Effects</h1>
          <p className="text-sm text-gray-600">Compounding referrals, syndicate formation, and operator/advisor marketplace.</p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Compounding Earnings" value={`$${(stats.compound_earnings_cents / 100).toFixed(2)}`} icon={Layers} />
          <Stat label="Direct Earnings" value={`$${(stats.direct_earnings_cents / 100).toFixed(2)}`} icon={TrendingUp} />
          <Stat label="Active Syndicates" value={stats.active_syndicates} icon={Users} />
          <Stat label="Available Operators" value={stats.marketplace_available} icon={Store} />
        </div>
      )}

      <div className="border-b border-gray-200 mb-6 flex gap-1 flex-wrap">
        {[
          { id: 'compounding', label: 'Compounding Referrals', icon: Layers },
          { id: 'syndicates', label: 'Syndicates', icon: Users },
          { id: 'marketplace', label: 'Marketplace', icon: Store },
          { id: 'companies', label: 'Companies', icon: Building2 },
        ].map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'compounding' && <Compounding />}
      {tab === 'syndicates' && <Syndicates />}
      {tab === 'marketplace' && <Marketplace />}
      {tab === 'companies' && <CompanyProfilePanel />}
    </div>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center"><Icon size={18} /></div>
      <div className="min-w-0">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-xl font-bold text-gray-900 truncate">{value}</div>
      </div>
    </div>
  );
}

// ---------- Compounding ----------

function Compounding() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => { try { setData(await api.networkFxCompounding()); } finally { setLoading(false); } })(); }, []);

  if (loading) return <Loading text="Loading your referral chain…" />;
  if (!data) return <div className="text-sm text-gray-500">No data.</div>;

  const total = data.counts.L1 + data.counts.L2 + data.counts.L3;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <LevelCard level={1} count={data.counts.L1} mult={data.multipliers_bps.L1} />
        <LevelCard level={2} count={data.counts.L2} mult={data.multipliers_bps.L2} />
        <LevelCard level={3} count={data.counts.L3} mult={data.multipliers_bps.L3} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Compounding Bonuses</h3>
          <div className="text-sm text-gray-700">Total: <span className="font-bold text-emerald-600">${(data.bonuses_cents / 100).toFixed(2)}</span></div>
        </div>
        {data.bonuses.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">No compounding bonuses yet. They'll fire when L2/L3 referrals convert.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.bonuses.map(b => (
              <div key={b.id} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium text-gray-900">{b.description}</div>
                  <div className="text-xs text-gray-500">{new Date(b.created_at).toLocaleString()}</div>
                </div>
                <div className="font-bold text-emerald-600">+${(b.amount_cents / 100).toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Referral Tree ({total} people)</h3>
        {total === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">Share your referral link to start building your chain.</div>
        ) : (
          [1, 2, 3].map(lvl => data.levels[lvl]?.length > 0 && (
            <div key={lvl} className="mb-4 last:mb-0">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Level {lvl} ({data.levels[lvl].length})</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {data.levels[lvl].map(p => (
                  <div key={p.id} className="bg-gray-50 rounded-lg p-2 text-xs">
                    <div className="font-medium text-gray-900 truncate">{p.name || p.email}</div>
                    <div className="text-gray-500 truncate">{p.email}</div>
                    <div className="mt-1"><Pill v={p.kyc_status || 'not_started'} /></div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LevelCard({ level, count, mult }) {
  return (
    <div className="bg-gradient-to-br from-violet-50 to-white border border-violet-200 rounded-xl p-4">
      <div className="text-xs uppercase tracking-wide text-violet-600 font-semibold">Level {level}</div>
      <div className="text-3xl font-bold text-gray-900 mt-1">{count}</div>
      <div className="text-xs text-gray-600 mt-1">{(mult / 100).toFixed(0)}% commission multiplier</div>
    </div>
  );
}

// ---------- Syndicates ----------

function Syndicates() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);

  const reload = async () => { setLoading(true); try { setList(await api.networkFxSyndicates()); } finally { setLoading(false); } };
  useEffect(() => { reload(); }, []);

  if (loading) return <Loading text="Loading syndicates…" />;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3 py-2 rounded-lg">
          <Plus size={14} /> Create Syndicate
        </button>
      </div>

      {list.length === 0 ? (
        <div className="text-sm text-gray-500 py-12 text-center bg-gray-50 border border-gray-200 rounded-xl">No syndicates yet. Create one to pool capital with other investors.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {list.map(s => <SyndicateCard key={s.id} s={s} onOpen={() => setOpenId(s.id)} />)}
        </div>
      )}

      {creating && <CreateSyndicateModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
      {openId && <SyndicateDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function SyndicateCard({ s, onOpen }) {
  const pct = s.target_cents ? Math.min(100, Math.round((s.committed_cents / s.target_cents) * 100)) : 0;
  return (
    <div onClick={onOpen} className="bg-white border border-gray-200 rounded-xl p-5 cursor-pointer hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-gray-900">{s.name}</h3>
        <span className={`text-xs px-2 py-0.5 rounded ${s.status === 'open' ? 'bg-emerald-100 text-emerald-700' : s.status === 'funded' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>{s.status}</span>
      </div>
      {s.description && <p className="text-xs text-gray-600 line-clamp-2 mb-3">{s.description}</p>}
      <div className="text-xs text-gray-500 mb-2">
        {s.members} members • ${(s.committed_cents / 100).toLocaleString()} committed
        {s.target_cents && <span> / ${(s.target_cents / 100).toLocaleString()} target</span>}
      </div>
      {s.target_cents && (
        <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="text-[10px] text-gray-400 mt-2">By {s.creator_name || `User #${s.created_by}`}</div>
    </div>
  );
}

function CreateSyndicateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', target_dollars: '', min_dollars: '1000', deal_id: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [projects, setProjects] = useState([]);
  useEffect(() => { (async () => { try { setProjects(await api.listProjects()); } catch {} })(); }, []);

  const submit = async () => {
    if (!form.name) { setErr('Name required'); return; }
    setBusy(true); setErr('');
    try {
      await api.networkFxCreateSyndicate({
        name: form.name, description: form.description,
        target_cents: form.target_dollars ? Math.round(parseFloat(form.target_dollars) * 100) : null,
        min_commitment_cents: form.min_dollars ? Math.round(parseFloat(form.min_dollars) * 100) : 100000,
        deal_id: form.deal_id || null,
      });
      onCreated();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal title="Create Syndicate" onClose={onClose} titleClassName="text-black">
      <div className="space-y-3">
        <Field label="Name *"><input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className={inputCls} /></Field>
        <Field label="Description"><textarea rows={2} value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target ($)"><input type="number" value={form.target_dollars} onChange={e => setForm(f => ({...f, target_dollars: e.target.value}))} className={inputCls} /></Field>
          <Field label="Min Commitment ($)"><input type="number" value={form.min_dollars} onChange={e => setForm(f => ({...f, min_dollars: e.target.value}))} className={inputCls} /></Field>
        </div>
        <Field label="Link to Deal (optional)">
          <select value={form.deal_id} onChange={e => setForm(f => ({...f, deal_id: e.target.value}))} className={`${inputCls} appearance-none pr-10 bg-[linear-gradient(45deg,transparent_50%,#6b7280_50%),linear-gradient(135deg,#6b7280_50%,transparent_50%),linear-gradient(to_right,#fff,#fff)] bg-[position:calc(100%_-_18px)_50%,calc(100%_-_12px)_50%,0_0] bg-[size:6px_6px,6px_6px,100%_100%] bg-no-repeat`}>
            <option value="">— None —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {err && <div className="text-xs text-red-600">{err}</div>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="text-sm text-gray-700 hover:bg-gray-100 px-4 py-2 rounded-lg">Cancel</button>
        <button onClick={submit} disabled={busy} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Create
        </button>
      </div>
    </Modal>
  );
}

function SyndicateDrawer({ id, onClose, onChanged }) {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commitDollars, setCommitDollars] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [recs, setRecs] = useState(null);
  const [recsBusy, setRecsBusy] = useState(false);

  const load = async () => { setLoading(true); try { setS(await api.networkFxSyndicate(id)); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [id]);

  const join = async () => {
    setBusy(true); setErr('');
    try {
      await api.networkFxJoinSyndicate(id, { commitment_cents: Math.round(parseFloat(commitDollars) * 100) });
      await load(); onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const fetchRecs = async () => {
    setRecsBusy(true);
    try { setRecs(await api.networkFxSyndicateRecs(id)); }
    catch (e) { setRecs({ error: e.message }); }
    finally { setRecsBusy(false); }
  };

  return (
    <Drawer title={s?.name || 'Loading…'} onClose={onClose}>
      {loading || !s ? <Loading text="" /> : (
        <div className="space-y-5">
          <div className="text-sm text-gray-700">{s.description}</div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <KV k="Status" v={s.status} />
            <KV k="Members" v={s.member_count} />
            <KV k="Committed" v={`$${(s.committed_cents / 100).toLocaleString()}`} />
            <KV k="Target" v={s.target_cents ? `$${(s.target_cents / 100).toLocaleString()}` : 'Open'} />
            <KV k="Min Check" v={`$${(s.min_commitment_cents / 100).toLocaleString()}`} />
            {s.project && <KV k="Deal" v={s.project.name} />}
          </div>

          {s.status === 'open' && (
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-medium text-gray-700 mb-2">Join this syndicate</div>
              <div className="flex gap-2">
                <input type="number" placeholder={`Min $${s.min_commitment_cents / 100}`} value={commitDollars} onChange={e => setCommitDollars(e.target.value)} className={inputCls} />
                <button onClick={join} disabled={busy || !commitDollars} className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  {busy ? <Loader2 className="animate-spin" size={14} /> : 'Commit'}
                </button>
              </div>
              {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Members ({s.members.length})</h4>
            {s.members.length === 0 ? <div className="text-xs text-gray-500">No members yet.</div> : (
              <div className="divide-y divide-gray-100">
                {s.members.map(m => (
                  <div key={m.id} className="py-2 flex items-center justify-between text-sm">
                    <div><div className="font-medium text-gray-900">{m.name}</div><div className="text-xs text-gray-500">{m.email}</div></div>
                    <div className="font-bold text-gray-900">${(m.commitment_cents / 100).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-4">
            <button onClick={fetchRecs} disabled={recsBusy} className="text-xs flex items-center gap-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-1.5 rounded">
              {recsBusy ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />} AI Investor Recommendations
            </button>
            {recs && !recs.error && (
              <div className="mt-3 space-y-2">
                <div className="text-xs text-gray-700 italic bg-violet-50 border border-violet-200 rounded p-2">{recs.rationale}</div>
                {recs.candidates.map(c => (
                  <div key={c.id} className="bg-gray-50 rounded p-2 text-xs flex items-center justify-between">
                    <div><div className="font-medium">{c.name}</div><div className="text-gray-500">{c.email} • {c.role}</div></div>
                    {c.score && <ScorePill score={c.score} />}
                  </div>
                ))}
                {recs.candidates.length === 0 && <div className="text-xs text-gray-500">No candidates available.</div>}
              </div>
            )}
            {recs?.error && <div className="text-xs text-red-600 mt-2">{recs.error}</div>}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ---------- Marketplace ----------

function Marketplace() {
  const [tab2, setTab2] = useState('search');
  return (
    <div>
      <div className="flex gap-1 mb-4">
        {[{id:'search', label:'Search Operators'}, {id:'me', label:'My Profile'}, {id:'match', label:'AI Match'}].map(t => (
          <button key={t.id} onClick={() => setTab2(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded ${tab2 === t.id ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{t.label}</button>
        ))}
      </div>
      {tab2 === 'search' && <MarketplaceSearch />}
      {tab2 === 'me' && <MyMarketplaceProfile />}
      {tab2 === 'match' && <AiMatch />}
    </div>
  );
}

function MarketplaceSearch() {
  const [results, setResults] = useState([]);
  const [filters, setFilters] = useState({ skill: '', role: '', availability: '', min_rating: '' });
  const [loading, setLoading] = useState(false);
  const [introTarget, setIntroTarget] = useState(null);

  const search = async () => {
    setLoading(true);
    try { setResults(await api.networkFxMarketplaceSearch(filters)); }
    finally { setLoading(false); }
  };
  useEffect(() => { search(); }, []);

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Skill</label>
          <input
            placeholder="e.g. React, GTM, Finance"
            value={filters.skill}
            onChange={e => setFilters(f => ({...f, skill: e.target.value}))}
            className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Role</label>
          <div className="relative">
            <select
              value={filters.role}
              onChange={e => setFilters(f => ({...f, role: e.target.value}))}
              className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-lg pl-3 pr-9 py-2 text-sm text-gray-800 focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition cursor-pointer"
            >
              <option value="">Any role</option>
              <option value="partner">Partner</option>
              <option value="founder">Founder</option>
              <option value="admin">Admin</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Availability</label>
          <div className="relative">
            <select
              value={filters.availability}
              onChange={e => setFilters(f => ({...f, availability: e.target.value}))}
              className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-lg pl-3 pr-9 py-2 text-sm text-gray-800 focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition cursor-pointer"
            >
              <option value="">Any availability</option>
              <option value="available">Available now</option>
              <option value="booked">Booked</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Min rating</label>
          <div className="flex gap-2 items-center">
            <input
              type="number" min="0" max="5" step="0.5"
              placeholder="0 – 5"
              value={filters.min_rating}
              onChange={e => setFilters(f => ({...f, min_rating: e.target.value}))}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition"
            />
            <button
              onClick={search}
              className="bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Search size={14} /> Search
            </button>
          </div>
        </div>
      </div>

      {loading ? <Loading text="Searching…" /> : results.length === 0 ? (
        <div className="text-sm text-gray-500 py-12 text-center bg-gray-50 border border-gray-200 rounded-xl">No operators match. Try clearing filters.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map(p => <ProfileCard key={p.id} p={p} onIntro={() => setIntroTarget(p)} />)}
        </div>
      )}

      {introTarget && <IntroModal target={introTarget} onClose={() => setIntroTarget(null)} />}
    </div>
  );
}

function ProfileCard({ p, onIntro }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-bold">{(p.name || '?')[0]}</div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 truncate">{p.name}</div>
          <div className="text-xs text-gray-500 truncate">{p.title || p.role}</div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded ${p.availability === 'available' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{p.availability}</span>
      </div>
      {p.bio && <p className="text-xs text-gray-600 line-clamp-2 mb-2">{p.bio}</p>}
      <div className="flex flex-wrap gap-1 mb-3">
        {(p.skills || []).slice(0, 5).map(s => <span key={s} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{s}</span>)}
      </div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1 text-amber-600">
          <Star size={12} fill="currentColor" /> {p.rating?.toFixed?.(1) || '—'} <span className="text-gray-400">({p.review_count || 0})</span>
        </div>
        {p.hourly_rate_cents && <div className="text-gray-700">${(p.hourly_rate_cents/100).toFixed(0)}/hr</div>}
      </div>
      <button onClick={onIntro} className="mt-3 w-full bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-1">
        <Send size={12} /> Request Intro
      </button>
    </div>
  );
}

function IntroModal({ target, onClose }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setBusy(true); setErr('');
    try { await api.networkFxRequestIntro({ target_user_id: target.user_id, message }); setDone(true); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`Request Intro: ${target.name}`} onClose={onClose}>
      {done ? (
        <div className="text-center py-8">
          <div className="text-emerald-600 text-3xl mb-2">✓</div>
          <div className="text-sm font-medium">Intro requested. An admin will follow up.</div>
          <button onClick={onClose} className="mt-4 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg">Close</button>
        </div>
      ) : (
        <>
          <Field label="Message (what you'd like to discuss)">
            <textarea rows={5} value={message} onChange={e => setMessage(e.target.value)} placeholder="Brief context, the project/topic, expected scope…" className={inputCls} />
          </Field>
          {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} className="text-sm text-gray-700 hover:bg-gray-100 px-4 py-2 rounded-lg">Cancel</button>
            <button onClick={submit} disabled={busy} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {busy ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Send Request
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function MyMarketplaceProfile() {
  const [p, setP] = useState(null);
  const [skillsInput, setSkillsInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    const me = await api.networkFxMarketplaceMe();
    setP(me); setSkillsInput((me.skills || []).join(', '));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setSaved(false); setErr('');
    try {
      await api.networkFxSaveMarketplace({
        ...p,
        skills: skillsInput.split(',').map(s => s.trim()).filter(Boolean),
        hourly_rate_cents: p.hourly_rate_cents ? parseInt(p.hourly_rate_cents) : null,
      });
      await load(); setSaved(true);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (!p) return <Loading text="Loading profile…" />;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-2xl">
      <h3 className="font-semibold text-gray-900 mb-4">My Marketplace Profile</h3>
      <div className="space-y-3">
        <Field label="Title (e.g. 'Growth Marketing Operator')"><input value={p.title || ''} onChange={e => setP({...p, title: e.target.value})} className={inputCls} /></Field>
        <Field label="Bio"><textarea rows={4} value={p.bio || ''} onChange={e => setP({...p, bio: e.target.value})} className={inputCls} /></Field>
        <Field label="Skills (comma-separated)"><input value={skillsInput} onChange={e => setSkillsInput(e.target.value)} placeholder="growth, fundraising, product strategy" className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hourly Rate (cents)"><input type="number" value={p.hourly_rate_cents || ''} onChange={e => setP({...p, hourly_rate_cents: e.target.value})} className={inputCls} placeholder="e.g. 30000 = $300" /></Field>
          <Field label="Availability">
            <div className="relative">
              <select
                value={p.availability}
                onChange={e => setP({ ...p, availability: e.target.value })}
                className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 pr-9 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition cursor-pointer"
              >
                <option value="available">Available</option>
                <option value="booked">Booked</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </Field>
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
        {saved && <div className="text-xs text-emerald-600">Saved.</div>}
        <button onClick={save} disabled={busy} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Save Profile
        </button>
      </div>
    </div>
  );
}

function AiMatch() {
  const [need, setNeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const run = async () => {
    setBusy(true); setErr(''); setResult(null);
    try { setResult(await api.networkFxMarketplaceMatch({ need })); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><Brain size={16} className="text-violet-500" /> AI Operator Match</h3>
        <p className="text-xs text-gray-600 mb-4">Describe what you need; AI picks the top 3 from the marketplace.</p>
        <textarea rows={4} value={need} onChange={e => setNeed(e.target.value)} placeholder="e.g. I need a part-time CFO for a fintech with $500K ARR who's done seed-to-Series-A fundraising" className={inputCls} />
        <button onClick={run} disabled={busy || !need.trim()} className="mt-3 flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} Find Match
        </button>
        {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
      </div>
      {result && (
        <div className="mt-4 space-y-3">
          {result.recommendations.map(r => (
            <div key={r.user_id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-bold">{(r.profile.name || '?')[0]}</div>
                <div><div className="font-semibold">{r.profile.name}</div><div className="text-xs text-gray-500">{r.profile.title}</div></div>
              </div>
              <div className="text-xs bg-violet-50 border border-violet-200 rounded p-2 text-gray-800">{r.reason}</div>
            </div>
          ))}
          <div className="text-[10px] text-gray-400">Model: {result.model}</div>
        </div>
      )}
    </div>
  );
}

// ---------- Shared UI ----------

const inputCls = 'w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none';

function Field({ label, children }) { return <div><label className="text-xs text-gray-700 font-medium block mb-1">{label}</label>{children}</div>; }
function KV({ k, v }) { return <div className="bg-gray-50 rounded-lg p-2"><div className="text-[10px] uppercase text-gray-500">{k}</div><div className="text-sm font-medium text-gray-900 truncate">{String(v)}</div></div>; }
function Pill({ v }) {
  const colors = { approved: 'bg-emerald-100 text-emerald-700', converted: 'bg-violet-100 text-violet-700', pending: 'bg-amber-100 text-amber-700', rejected: 'bg-red-100 text-red-700', not_started: 'bg-gray-100 text-gray-600' };
  return <span className={`text-[10px] px-2 py-0.5 rounded ${colors[v] || 'bg-gray-100 text-gray-600'}`}>{(v || '').replace('_', ' ')}</span>;
}
function ScorePill({ score }) {
  const c = score >= 80 ? 'bg-emerald-100 text-emerald-700' : score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
  return <span className={`text-xs font-bold px-2 py-1 rounded ${c}`}>{Math.round(score)}</span>;
}
function Loading({ text }) { return <div className="flex items-center gap-2 text-sm text-gray-500 py-12 justify-center"><Loader2 className="animate-spin" size={16} /> {text}</div>; }
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button></div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
function Drawer({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button></div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
