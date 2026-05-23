import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Send, Check, X, AlertCircle, Search, Filter, Briefcase, Clock, DollarSign,
  ShieldCheck, FileText, Trash2, Edit3, ChevronRight, Inbox, Handshake,
  Play, Package, Star, Receipt, XCircle, ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api';
import { useEscapeClose } from '../components/useEscapeClose';

const CATEGORIES = ['legal', 'accounting', 'design', 'recruiting', 'fractional_cfo', 'gtm', 'engineering', 'marketing'];
const CAT_LABEL = {
  legal: 'Legal', accounting: 'Accounting', design: 'Design', recruiting: 'Recruiting',
  fractional_cfo: 'Fractional CFO', gtm: 'GTM', engineering: 'Engineering', marketing: 'Marketing',
};
const STATUS_TONE = {
  open: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  in_review: 'bg-amber-50 text-amber-700 border-amber-200',
  filled: 'bg-violet-50 text-violet-700 border-violet-200',
  closed: 'bg-gray-100 text-gray-600 border-gray-200',
};
const QUOTE_TONE = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  withdrawn: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function NeedsBoardPage({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isFounder = user?.role === 'founder';
  const isPartner = user?.role === 'partner';
  const defaultTab = isFounder ? 'mine' : 'browse';
  const [tab, setTab] = useState(searchParams.get('tab') || defaultTab);
  useEffect(() => { setSearchParams({ tab }, { replace: true }); }, [tab]);

  const tabs = [
    { key: 'browse', label: 'Browse open needs', icon: Search },
    ...(isFounder ? [{ key: 'mine', label: 'My needs', icon: Inbox }] : []),
    ...(isPartner ? [{ key: 'quotes', label: 'My quotes', icon: FileText }] : []),
    { key: 'engagements', label: 'Engagements', icon: Handshake },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Needs Board</h1>
        <p className="text-sm text-gray-500 mt-1">Founders post needs and RFPs. Partners submit quotes. Accepted quotes become engagements.</p>
      </div>

      <div className="border-b border-gray-200 flex gap-6 overflow-x-auto dark:border-gray-800">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-1 py-3 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? 'border-violet-600 text-violet-700 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'browse' && <BrowseTab user={user} />}
      {tab === 'mine' && isFounder && <MyNeedsTab user={user} />}
      {tab === 'quotes' && isPartner && <MyQuotesTab />}
      {tab === 'engagements' && <EngagementsTab user={user} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse — public open needs (partners + investors + admins)
// ---------------------------------------------------------------------------
function BrowseTab({ user }) {
  const [filters, setFilters] = useState({ category: '', q: '' });
  const [needs, setNeeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const params = {};
      if (filters.category) params.category = filters.category;
      const r = await api.listNeeds(params);
      let rows = r.needs || [];
      if (filters.q) {
        const q = filters.q.toLowerCase();
        rows = rows.filter((n) => `${n.title} ${n.description}`.toLowerCase().includes(q));
      }
      setNeeds(rows);
    } catch (e) {
      // 404 = needs route missing on this deployment (stale worker). The
      // empty-state card already covers "no open needs right now" — don't
      // double up with a raw red banner above it.
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setNeeds([]);
      else setError(e.message);
    }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  return (
    <div className="space-y-4">
      {/* T21 — wrapped in <form> so pressing Enter in the search input
          triggers Apply instead of being swallowed. */}
      <form onSubmit={(e) => { e.preventDefault(); load(); }}
        className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-2 dark:bg-gray-900 dark:border-gray-800">
        <Filter size={14} className="text-gray-500" />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search title / description"
            className="pl-8 border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
        </div>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white dark:border-gray-700 dark:bg-gray-900">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
        </select>
        <button type="submit" className="ml-auto bg-violet-600 hover:bg-violet-700 text-white rounded-md px-4 py-1.5 text-sm font-medium">Apply</button>
      </form>

      {error && <ErrorBox message={error} />}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {!loading && needs.length === 0 && <Empty icon={Briefcase} text="No open needs right now." />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {needs.map((n) => <NeedCard key={n.id} n={n} onClick={() => setSelected(n)} />)}
      </div>

      {selected && <NeedDetailModal needId={selected.id} user={user} onClose={() => { setSelected(null); load(); }} />}
    </div>
  );
}

function NeedCard({ n, onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-violet-300 hover:shadow-sm transition focus:outline-none focus:ring-2 focus:ring-violet-500 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-[10px] bg-violet-50 text-violet-700 rounded-full px-2 py-0.5">{CAT_LABEL[n.category] || n.category}</span>
          <div className="font-semibold text-gray-900 mt-1.5 dark:text-gray-100">{n.title}</div>
          {n.project_name && <div className="text-xs text-gray-500 mt-0.5">{n.project_name}</div>}
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_TONE[n.status] || STATUS_TONE.closed}`}>{n.status}</span>
      </div>
      <p className="text-sm text-gray-700 mt-2 line-clamp-2 dark:text-gray-300">{n.description}</p>
      <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
        <div className="flex items-center gap-3">
          {(n.budget_min || n.budget_max) && (
            <span className="flex items-center gap-1"><DollarSign size={12} />
              {n.budget_min ? `$${n.budget_min.toLocaleString()}` : '?'}–{n.budget_max ? `$${n.budget_max.toLocaleString()}` : '?'}
            </span>
          )}
          {n.timeline && <span className="flex items-center gap-1"><Clock size={12} /> {n.timeline}</span>}
          {n.rfp && <span className="flex items-center gap-1 text-violet-600"><FileText size={12} /> RFP</span>}
        </div>
        <span className="flex items-center gap-1 text-gray-500">{n.quote_count} {n.quote_count === 1 ? 'quote' : 'quotes'} <ChevronRight size={12} /></span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// My needs (founders) — post + manage
// ---------------------------------------------------------------------------
function MyNeedsTab({ user }) {
  const [needs, setNeeds] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try { const r = await api.listNeeds({ mine_only: true }); setNeeds(r.needs || []); }
    catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setNeeds([]);
      else setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{needs.length} need{needs.length === 1 ? '' : 's'}</div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-md text-sm font-medium"><Plus size={14} /> Post a need</button>
      </div>

      {error && <ErrorBox message={error} />}
      {needs.length === 0 && !error && <Empty icon={Briefcase} text="You haven't posted any needs yet." />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {needs.map((n) => <NeedCard key={n.id} n={n} onClick={() => setSelected(n)} />)}
      </div>

      {creating && <NeedFormModal user={user} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <NeedFormModal user={user} need={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {selected && (
        <NeedDetailModal
          needId={selected.id}
          user={user}
          onClose={() => { setSelected(null); load(); }}
          onEdit={() => { const n = selected; setSelected(null); setEditing(n); }}
        />
      )}
    </div>
  );
}

function NeedFormModal({ user, need, onClose, onSaved }) {
  useEscapeClose(onClose);
  const isEdit = !!need;
  const [projects, setProjects] = useState([]);
  const [draft, setDraft] = useState({
    project_id: need?.project_id || '',
    category: need?.category || 'legal',
    title: need?.title || '',
    description: need?.description || '',
    budget_min: need?.budget_min ?? '',
    budget_max: need?.budget_max ?? '',
    timeline: need?.timeline || '',
    status: need?.status || 'open',
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isEdit) return;
    api.listProjects?.().then((r) => {
      const list = Array.isArray(r) ? r : (r?.projects || []);
      const mine = list.filter((p) => !user?.founder_id || p.founder_id === user.founder_id);
      setProjects(mine);
      if (mine.length && !draft.project_id) setDraft((d) => ({ ...d, project_id: mine[0].id }));
    }).catch(() => {});
  }, []); // eslint-disable-line

  async function save() {
    setError(null);
    try {
      const payload = {
        ...draft,
        project_id: draft.project_id ? Number(draft.project_id) : null,
        budget_min: draft.budget_min === '' ? null : Number(draft.budget_min),
        budget_max: draft.budget_max === '' ? null : Number(draft.budget_max),
      };
      if (isEdit) {
        const { project_id, ...patch } = payload;
        await api.updateNeed(need.id, patch);
      } else {
        if (!payload.project_id) throw new Error('Pick a project to attach this need to.');
        await api.createNeed(payload);
      }
      onSaved();
    } catch (e) { setError(e.message); }
  }

  async function destroy() {
    if (!confirm('Delete this need? Pending quotes will be removed.')) return;
    try { await api.deleteNeed(need.id); onSaved(); } catch (e) { setError(e.message); }
  }

  return (
    <Modal title={isEdit ? 'Edit need' : 'Post a need'} onClose={onClose} wide>
      <div className="space-y-3">
        {!isEdit && (
          <Field label="Project">
            <select value={draft.project_id} onChange={(e) => setDraft({ ...draft, project_id: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white dark:border-gray-700 dark:bg-gray-900">
              <option value="">— select —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white dark:border-gray-700 dark:bg-gray-900">
              {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </Field>
          {isEdit && (
            <Field label="Status">
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white dark:border-gray-700 dark:bg-gray-900">
                {['open', 'in_review', 'filled', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Title"><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" /></Field>
        <Field label="Description"><textarea rows={5} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Budget min ($)"><input type="number" min="0" value={draft.budget_min} onChange={(e) => setDraft({ ...draft, budget_min: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" /></Field>
          <Field label="Budget max ($)"><input type="number" min="0" value={draft.budget_max} onChange={(e) => setDraft({ ...draft, budget_max: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" /></Field>
          <Field label="Timeline"><input value={draft.timeline} onChange={(e) => setDraft({ ...draft, timeline: e.target.value })} placeholder="e.g. 2 weeks, Q3" className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" /></Field>
        </div>
        {error && <div className="text-xs text-rose-600">{error}</div>}
      </div>
      <div className="flex items-center justify-between mt-5">
        {isEdit ? <button onClick={destroy} className="text-xs text-rose-600 hover:underline flex items-center gap-1"><Trash2 size={12} /> Delete</button> : <span />}
        <div className="flex gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-gray-700">Cancel</button>
          <button onClick={save} disabled={!draft.title.trim() || !draft.description.trim()}
            className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg">{isEdit ? 'Save' : 'Post need'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Need detail modal — RFP, quotes, accept/reject flow
// ---------------------------------------------------------------------------
function NeedDetailModal({ needId, user, onClose, onEdit }) {
  useEscapeClose(onClose);
  const [need, setNeed] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [error, setError] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [editingRfp, setEditingRfp] = useState(false);

  const isFounderOwner = user?.role === 'founder' && need && user.founder_id === need.founder_id;
  const isPartner = user?.role === 'partner';
  const isAdmin = user?.role === 'admin';

  async function reload() {
    try {
      const [n, q] = await Promise.all([api.getNeed(needId), api.listQuotesForNeed(needId).catch(() => ({ quotes: [] }))]);
      setNeed(n); setQuotes(q.quotes || []);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { reload(); }, [needId]);

  async function act(fn) {
    try { await fn(); await reload(); } catch (e) { setError(e.message); }
  }

  if (!need) return <Modal title="Loading…" onClose={onClose}><div className="text-sm text-gray-500">{error || 'Loading…'}</div></Modal>;

  return (
    <Modal title={need.title} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="bg-violet-50 text-violet-700 rounded-full px-2 py-0.5">{CAT_LABEL[need.category]}</span>
          <span className={`px-2 py-0.5 rounded-full border ${STATUS_TONE[need.status]}`}>{need.status}</span>
          {need.timeline && <span className="text-gray-600 flex items-center gap-1"><Clock size={11} /> {need.timeline}</span>}
          {(need.budget_min || need.budget_max) && (
            <span className="text-gray-600 flex items-center gap-1"><DollarSign size={11} />
              {need.budget_min ? `$${need.budget_min.toLocaleString()}` : '?'}–{need.budget_max ? `$${need.budget_max.toLocaleString()}` : '?'}
            </span>
          )}
          {need.project_name && <span className="text-gray-500">· {need.project_name}</span>}
          {(isFounderOwner || isAdmin) && onEdit && (
            <button onClick={onEdit} className="ml-auto text-xs text-violet-600 hover:underline flex items-center gap-1"><Edit3 size={11} /> Edit</button>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Brief</div>
          <p className="text-sm text-gray-700 whitespace-pre-line dark:text-gray-300">{need.description}</p>
        </div>

        {/* RFP */}
        <div className="border border-gray-200 rounded-xl p-4 dark:border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><FileText size={12} /> RFP — formal scope</div>
            {(isFounderOwner || isAdmin) && (
              <button onClick={() => setEditingRfp(true)} className="text-xs text-violet-600 hover:underline">{need.rfp ? 'Edit RFP' : 'Add RFP'}</button>
            )}
          </div>
          {need.rfp ? (
            <div className="space-y-2 text-sm">
              <pre className="text-xs whitespace-pre-wrap text-gray-700 bg-gray-50 rounded-lg p-3 border border-gray-100 dark:text-gray-300">{need.rfp.scope_md}</pre>
              {need.rfp.deliverables_md && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-2 mb-1">Deliverables</div>
                  <pre className="text-xs whitespace-pre-wrap text-gray-700 bg-gray-50 rounded-lg p-3 border border-gray-100 dark:text-gray-300">{need.rfp.deliverables_md}</pre>
                </div>
              )}
              {need.rfp.deadline_at && <div className="text-xs text-gray-500">Deadline: {new Date(need.rfp.deadline_at).toLocaleString()}</div>}
            </div>
          ) : <div className="text-xs text-gray-400 italic">No formal RFP attached.</div>}
        </div>

        {/* Quotes section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">Quotes ({quotes.length})</div>
            {isPartner && (need.status === 'open' || need.status === 'in_review') && (
              <button onClick={() => setQuoting(true)} className="text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-md px-3 py-1.5 flex items-center gap-1"><Send size={12} /> Submit quote</button>
            )}
          </div>
          {quotes.length === 0 ? (
            <div className="text-xs text-gray-400 italic">{isPartner ? 'No quotes yet — yours could be the first.' : 'No quotes yet.'}</div>
          ) : (
            <div className="space-y-2">
              {quotes.map((q) => (
                <div key={q.id} className="border border-gray-200 rounded-lg p-3 dark:border-gray-800">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{q.partner_name}</span>
                        {q.kyb_verified && <span title="KYB verified"><ShieldCheck size={12} className="text-violet-600" /></span>}
                        {q.partner_company && <span className="text-xs text-gray-500">— {q.partner_company}</span>}
                      </div>
                      <div className="text-xs text-gray-600 mt-1 flex items-center gap-3">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">${q.price.toLocaleString()}</span>
                        {q.timeline_weeks !== null && q.timeline_weeks !== undefined && <span>· {q.timeline_weeks}w</span>}
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${QUOTE_TONE[q.status]}`}>{q.status}</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-2 whitespace-pre-line dark:text-gray-300">{q.deliverables}</p>
                  {q.notes && <p className="text-xs text-gray-500 mt-1 italic">{q.notes}</p>}
                  <div className="mt-2 flex gap-2 justify-end">
                    {(isFounderOwner || isAdmin) && q.status === 'pending' && (
                      <>
                        <button onClick={() => act(() => api.rejectQuote(q.id))} className="text-xs px-3 py-1 border border-rose-200 text-rose-700 rounded-md hover:bg-rose-50 flex items-center gap-1"><X size={12} /> Reject</button>
                        <button onClick={() => act(() => api.acceptQuote(q.id))} className="text-xs px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md flex items-center gap-1"><Check size={12} /> Accept</button>
                      </>
                    )}
                    {isPartner && q.status === 'pending' && q.partner_id === user.partner_id && (
                      <button onClick={() => act(() => api.withdrawQuote(q.id))} className="text-xs px-3 py-1 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">Withdraw</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <ErrorBox message={error} />}
      </div>

      {quoting && <QuoteFormModal needId={need.id} onClose={() => setQuoting(false)} onSaved={() => { setQuoting(false); reload(); }} />}
      {editingRfp && <RFPFormModal need={need} onClose={() => setEditingRfp(false)} onSaved={() => { setEditingRfp(false); reload(); }} />}
    </Modal>
  );
}

function RFPFormModal({ need, onClose, onSaved }) {
  const [draft, setDraft] = useState({
    scope_md: need.rfp?.scope_md || '',
    deliverables_md: need.rfp?.deliverables_md || '',
    deadline_at: need.rfp?.deadline_at ? need.rfp.deadline_at.slice(0, 16) : '',
  });
  const [error, setError] = useState(null);
  async function save() {
    try {
      await api.upsertRfp(need.id, {
        scope_md: draft.scope_md,
        deliverables_md: draft.deliverables_md || null,
        deadline_at: draft.deadline_at ? new Date(draft.deadline_at).toISOString() : null,
      });
      onSaved();
    } catch (e) { setError(e.message); }
  }
  return (
    <Modal title="Formal RFP" onClose={onClose} wide>
      <div className="space-y-3">
        <Field label="Scope"><textarea rows={6} value={draft.scope_md} onChange={(e) => setDraft({ ...draft, scope_md: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700" placeholder="Describe what success looks like, in / out of scope, decision criteria…" /></Field>
        <Field label="Deliverables (markdown)"><textarea rows={4} value={draft.deliverables_md} onChange={(e) => setDraft({ ...draft, deliverables_md: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700" placeholder="- Item 1&#10;- Item 2" /></Field>
        <Field label="Deadline (optional)"><input type="datetime-local" value={draft.deadline_at} onChange={(e) => setDraft({ ...draft, deadline_at: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" /></Field>
        {error && <div className="text-xs text-rose-600">{error}</div>}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-gray-700">Cancel</button>
        <button onClick={save} disabled={!draft.scope_md.trim()} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg">Save RFP</button>
      </div>
    </Modal>
  );
}

function QuoteFormModal({ needId, onClose, onSaved }) {
  const [draft, setDraft] = useState({ price: '', timeline_weeks: '', deliverables: '', notes: '' });
  const [error, setError] = useState(null);
  async function save() {
    try {
      await api.submitQuote(needId, {
        price: Number(draft.price),
        timeline_weeks: draft.timeline_weeks === '' ? null : Number(draft.timeline_weeks),
        deliverables: draft.deliverables.trim(),
        notes: draft.notes.trim() || null,
      });
      onSaved();
    } catch (e) { setError(e.message); }
  }
  return (
    <Modal title="Submit a quote" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (USD)"><input type="number" min="0" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" /></Field>
          <Field label="Timeline (weeks)"><input type="number" min="0" value={draft.timeline_weeks} onChange={(e) => setDraft({ ...draft, timeline_weeks: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" /></Field>
        </div>
        <Field label="Deliverables"><textarea rows={5} value={draft.deliverables} onChange={(e) => setDraft({ ...draft, deliverables: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700" placeholder="What will you ship? Milestones, scope guarantees…" /></Field>
        <Field label="Notes (optional)"><textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700" /></Field>
        {error && <div className="text-xs text-rose-600">{error}</div>}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-gray-700">Cancel</button>
        <button onClick={save} disabled={!draft.price || !draft.deliverables.trim()} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-2"><Send size={13} /> Submit quote</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// My quotes (partners)
// ---------------------------------------------------------------------------
function MyQuotesTab() {
  const [quotes, setQuotes] = useState([]);
  const [error, setError] = useState(null);
  async function load() {
    try { const r = await api.myQuotes(); setQuotes(r.quotes || []); }
    catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setQuotes([]);
      else setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);
  async function withdraw(id) {
    try { await api.withdrawQuote(id); load(); } catch (e) { setError(e.message); }
  }
  return (
    <div className="space-y-3">
      {error && <ErrorBox message={error} />}
      {quotes.length === 0 && <Empty icon={FileText} text="You haven't submitted any quotes yet." />}
      {quotes.map((q) => (
        <div key={q.id} className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{q.need_title || `Need #${q.need_id}`}</div>
              <div className="text-xs text-gray-500 mt-0.5">Submitted {new Date(q.created_at).toLocaleDateString()}</div>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${QUOTE_TONE[q.status]}`}>{q.status}</span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-700 dark:text-gray-300">
            <span className="font-semibold">${q.price.toLocaleString()}</span>
            {q.timeline_weeks !== null && q.timeline_weeks !== undefined && <span>· {q.timeline_weeks}w</span>}
            {q.need_status && <span className="text-gray-500">· need: {q.need_status}</span>}
          </div>
          <p className="text-sm text-gray-700 mt-2 whitespace-pre-line line-clamp-3 dark:text-gray-300">{q.deliverables}</p>
          {q.status === 'pending' && (
            <div className="mt-3 flex justify-end">
              <button onClick={() => withdraw(q.id)} className="text-xs px-3 py-1 border border-gray-300 rounded-md hover:bg-gray-50 dark:border-gray-700">Withdraw</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engagements
// ---------------------------------------------------------------------------
const ENG_TONE = {
  accepted: 'bg-violet-50 text-violet-700 border-violet-200',
  active: 'bg-violet-50 text-violet-700 border-violet-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  delivered: 'bg-amber-50 text-amber-700 border-amber-200',
  reviewed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  invoiced: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
};
const ENG_LABEL = {
  accepted: 'Accepted', active: 'Accepted', in_progress: 'In progress',
  delivered: 'Delivered', reviewed: 'Reviewed', invoiced: 'Invoiced', cancelled: 'Cancelled',
};

function EngagementsTab({ user }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const isFounder = user?.role === 'founder';
  const isPartner = user?.role === 'partner';

  async function load() {
    try { const r = await api.listEngagements(); setRows(r.engagements || []); }
    catch (e) {
      // Defensive 404 — backend may return "Not found" if the engagements
      // route isn't shipped on this deployment or the user has no scope.
      // Treat as the existing empty state below ("No engagements yet…")
      // instead of stacking a raw red banner above it.
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 404 || msg.includes('not found')) {
        setRows([]);
      } else if (status === 401 || status === 403) {
        setError('Your session expired. Please sign in again to view engagements.');
      } else {
        setError("Couldn't load engagements right now. Please retry in a moment, or contact support if it persists.");
      }
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-3">
      {error && <ErrorBox message={error} />}
      {rows.length === 0 && <Empty icon={Handshake} text="No engagements yet. Accept a quote or book a service offering." />}
      {rows.map((e) => (
        <button key={e.id} onClick={() => setSelected(e.id)} className="w-full text-left bg-white border border-gray-200 hover:border-violet-300 rounded-xl p-4 flex items-start justify-between gap-3 dark:bg-gray-900 dark:border-gray-800">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate dark:text-gray-100">{e.partner_name} ↔ {e.project_name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Created {new Date(e.created_at).toLocaleDateString()}
              {e.service_offering_title && <> · from offering “{e.service_offering_title}”</>}
            </div>
            <p className="text-sm text-gray-700 mt-2 whitespace-pre-line line-clamp-2 dark:text-gray-300">{e.deliverables}</p>
          </div>
          <div className="text-right flex flex-col items-end gap-1 shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full border ${ENG_TONE[e.status] || ENG_TONE.cancelled}`}>{ENG_LABEL[e.status] || e.status}</span>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">${e.price.toLocaleString()}</div>
            {e.stripe_invoice_url && <a href={e.stripe_invoice_url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="text-[11px] text-violet-700 hover:underline flex items-center gap-1"><Receipt size={11} /> Invoice {e.invoice_simulated ? '(sim)' : ''}</a>}
          </div>
        </button>
      ))}
      {selected && (
        <EngagementDetailModal
          engagementId={selected}
          user={user}
          isFounder={isFounder}
          isPartner={isPartner}
          onClose={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}

function EngagementDetailModal({ engagementId, user, isFounder, isPartner, onClose }) {
  const [eng, setEng] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try { setEng(await api.getEngagement(engagementId)); }
    catch (e) {
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 404 || msg.includes('not found')) {
        setError('This engagement is no longer available. Close this dialog and refresh the list.');
      } else if (status === 401 || status === 403) {
        setError('Your session expired. Please sign in again to view this engagement.');
      } else {
        setError("Couldn't load this engagement right now. Please retry in a moment.");
      }
    }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [engagementId]);

  async function action(fn) {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) {
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 404 || msg.includes('not found')) {
        setError('This engagement is no longer available. Close this dialog and refresh the list.');
      } else if (status === 401 || status === 403) {
        setError('Your session expired. Please sign in again to perform this action.');
      } else if (status === 409 || msg.includes('conflict') || msg.includes('already')) {
        setError("This action conflicts with the engagement's current state. Refresh to see the latest status.");
      } else {
        setError("That action didn't complete. Please retry in a moment, or contact support if it persists.");
      }
    }
    finally { setBusy(false); }
  }

  if (!eng) return <Modal title="Engagement" onClose={onClose}><div className="text-sm text-gray-500">{error || 'Loading…'}</div></Modal>;

  const status = eng.status === 'active' ? 'accepted' : eng.status;
  const myReview = (eng.reviews || []).find((r) =>
    (isFounder && r.reviewer_role === 'founder') ||
    (isPartner && r.reviewer_role === 'partner')
  );
  const otherReview = (eng.reviews || []).find((r) =>
    (isFounder && r.reviewer_role === 'partner') ||
    (isPartner && r.reviewer_role === 'founder')
  );

  return (
    <Modal title={`Engagement #${eng.id} — ${eng.partner_name} ↔ ${eng.project_name}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {error && <ErrorBox message={error} />}

        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full border ${ENG_TONE[eng.status] || ENG_TONE.cancelled}`}>{ENG_LABEL[eng.status] || eng.status}</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">${eng.price.toLocaleString()} {eng.currency?.toUpperCase()}</span>
          {eng.sla_days != null && <span className="text-xs text-gray-500">SLA {eng.sla_days}d</span>}
          {eng.service_offering_title && <span className="text-xs text-gray-500">· From “{eng.service_offering_title}”</span>}
        </div>

        <Timeline eng={eng} />

        <Field label="Deliverables"><p className="whitespace-pre-line text-gray-800 dark:text-gray-200">{eng.deliverables}</p></Field>
        {eng.delivery_notes && <Field label="Delivery notes (from partner)"><p className="whitespace-pre-line text-gray-800 dark:text-gray-200">{eng.delivery_notes}</p></Field>}
        {eng.cancel_reason && <Field label="Cancel reason"><p className="text-gray-800 dark:text-gray-200">{eng.cancel_reason}</p></Field>}

        {/* State machine actions */}
        <div className="border-t pt-3 flex flex-wrap gap-2">
          {isPartner && status === 'accepted' && (
            <button disabled={busy} onClick={() => action(() => api.startEngagement(eng.id))}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-md px-3 py-1.5 text-sm flex items-center gap-1 disabled:bg-gray-300">
              <Play size={14} /> Start work
            </button>
          )}
          {isPartner && status === 'in_progress' && <DeliverButton busy={busy} onSubmit={(notes) => action(() => api.deliverEngagement(eng.id, { delivery_notes: notes }))} />}
          {isPartner && (status === 'delivered' || status === 'reviewed') && !eng.stripe_invoice_id && (
            <button disabled={busy} onClick={() => action(() => api.invoiceEngagement(eng.id))}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-md px-3 py-1.5 text-sm flex items-center gap-1 disabled:bg-gray-300">
              <Receipt size={14} /> Issue Stripe invoice
            </button>
          )}
          {!['invoiced', 'reviewed', 'cancelled'].includes(status) && (
            <CancelButton busy={busy} onSubmit={(reason) => action(() => api.cancelEngagement(eng.id, { reason }))} />
          )}
          {eng.stripe_invoice_url && (
            <a href={eng.stripe_invoice_url} target="_blank" rel="noreferrer"
              className="border border-violet-300 text-violet-700 hover:bg-violet-50 rounded-md px-3 py-1.5 text-sm flex items-center gap-1">
              <ExternalLink size={14} /> View invoice {eng.invoice_simulated && <span className="text-[10px] text-amber-700">(simulated)</span>}
            </a>
          )}
        </div>

        {/* Two-sided review — unlocked only after delivered */}
        {(isFounder || isPartner) && ['delivered', 'reviewed', 'invoiced'].includes(status) && (
          <div className="border-t pt-3 space-y-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Reviews</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ReviewSlot label={isFounder ? 'Your review' : 'Founder review'} review={isFounder ? myReview : otherReview} />
              <ReviewSlot label={isPartner ? 'Your review' : 'Partner review'} review={isPartner ? myReview : otherReview} />
            </div>
            {!myReview && (
              <ReviewForm
                role={isFounder ? 'founder' : 'partner'}
                busy={busy}
                onSubmit={(payload) => action(() => api.createEngagementReview(eng.id, payload))}
              />
            )}
          </div>
        )}
        {!['delivered', 'reviewed', 'invoiced', 'cancelled'].includes(status) && (
          <div className="text-[11px] text-gray-500 italic border-t pt-3">
            Two-sided ratings unlock once the partner marks the engagement as delivered.
          </div>
        )}
      </div>
    </Modal>
  );
}

function Timeline({ eng }) {
  const steps = [
    { key: 'accepted_at', label: 'Accepted' },
    { key: 'started_at', label: 'In progress' },
    { key: 'delivered_at', label: 'Delivered' },
    { key: 'reviewed_at', label: 'Reviewed' },
    { key: 'invoiced_at', label: 'Invoiced' },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
      {steps.map((s) => {
        const done = !!eng[s.key];
        return (
          <span key={s.key} className={`flex items-center gap-1 ${done ? 'text-gray-800' : 'text-gray-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${done ? 'bg-violet-500' : 'bg-gray-300'}`} />
            {s.label}{done && `: ${new Date(eng[s.key]).toLocaleDateString()}`}
          </span>
        );
      })}
      {eng.cancelled_at && (
        <span className="flex items-center gap-1 text-rose-600">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Cancelled: {new Date(eng.cancelled_at).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

function ReviewSlot({ label, review }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 dark:border-gray-800">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      {review ? (
        <>
          <div className="flex items-center gap-1 text-amber-500">
            {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} fill={n <= review.rating ? 'currentColor' : 'none'} />)}
            <span className="text-xs text-gray-600 ml-1">{review.rating}/5</span>
          </div>
          {review.comment && <p className="text-sm text-gray-700 mt-1 dark:text-gray-300">{review.comment}</p>}
        </>
      ) : <div className="text-xs text-gray-400 italic">Not yet submitted</div>}
    </div>
  );
}

function ReviewForm({ role, busy, onSubmit }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <div className="bg-white border border-violet-200 rounded-lg p-3 space-y-2 dark:bg-gray-900">
      <div className="text-xs text-gray-700 font-medium dark:text-gray-300">Submit your {role} review</div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} className="text-amber-500">
            <Star size={20} fill={n <= rating ? 'currentColor' : 'none'} />
          </button>
        ))}
        <span className="text-xs text-gray-600 ml-2">{rating}/5</span>
      </div>
      <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment"
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
      <button disabled={busy} onClick={() => onSubmit({ rating, comment })}
        className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-md px-3 py-1.5 text-sm">
        Submit review
      </button>
    </div>
  );
}

function DeliverButton({ busy, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  if (!open) {
    return (
      <button disabled={busy} onClick={() => setOpen(true)}
        className="bg-amber-600 hover:bg-amber-700 text-white rounded-md px-3 py-1.5 text-sm flex items-center gap-1 disabled:bg-gray-300">
        <Package size={14} /> Mark delivered
      </button>
    );
  }
  return (
    <div className="w-full bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
      <div className="text-xs text-gray-700 dark:text-gray-300">Add delivery notes (optional)</div>
      <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="border border-amber-200 rounded-md px-3 py-1.5 text-sm w-full" />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => { onSubmit(notes); setOpen(false); }}
          className="bg-amber-600 hover:bg-amber-700 text-white rounded-md px-3 py-1.5 text-sm">Confirm delivered</button>
        <button onClick={() => setOpen(false)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700">Cancel</button>
      </div>
    </div>
  );
}

function CancelButton({ busy, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <button disabled={busy} onClick={() => setOpen(true)}
        className="border border-rose-300 text-rose-700 hover:bg-rose-50 rounded-md px-3 py-1.5 text-sm flex items-center gap-1 disabled:opacity-50">
        <XCircle size={14} /> Cancel engagement
      </button>
    );
  }
  return (
    <div className="w-full bg-rose-50 border border-rose-200 rounded-lg p-3 space-y-2">
      <div className="text-xs text-gray-700 dark:text-gray-300">Reason for cancellation (optional)</div>
      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="border border-rose-200 rounded-md px-3 py-1.5 text-sm w-full" />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => { onSubmit(reason); setOpen(false); }}
          className="bg-rose-600 hover:bg-rose-700 text-white rounded-md px-3 py-1.5 text-sm">Confirm cancel</button>
        <button onClick={() => setOpen(false)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700">Keep open</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function Modal({ title, onClose, children, wide }) {
  useEscapeClose(onClose);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl ${wide ? 'max-w-2xl' : 'max-w-md'} w-full max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white dark:border-gray-800 dark:bg-gray-900">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function ErrorBox({ message }) {
  return <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-sm"><AlertCircle size={14} className="mt-0.5" />{message}</div>;
}

function Empty({ icon: Icon, text }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-700">
      <Icon size={28} className="mx-auto text-gray-300 mb-2" /> {text}
    </div>
  );
}
