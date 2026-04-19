import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, Save, X, Search, UserPlus, Trash2, Loader2, Globe, Linkedin, Users, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';

const STAGE_OPTIONS = ['Idea', 'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Growth', 'Established'];
const REVENUE_OPTIONS = ['Pre-Revenue', '<$100k', '$100k-$500k', '$500k-$1M', '$1M-$5M', '$5M-$10M', '$10M-$50M', '$50M+'];

export default function CompanyProfilePanel() {
  const [view, setView] = useState('mine'); // 'mine' | 'directory' | 'detail'
  const [me, setMe] = useState(undefined); // undefined=loading, null=none, object=data
  const [detailUid, setDetailUid] = useState(null);

  useEffect(() => { loadMe(); }, []);
  async function loadMe() {
    try { setMe(await api.companyMe()); } catch { setMe(null); }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => { setView('mine'); setDetailUid(null); }}
          className={`px-3 py-1.5 text-sm rounded-lg ${view === 'mine' ? 'bg-violet-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>
          My Company
        </button>
        <button onClick={() => { setView('directory'); setDetailUid(null); }}
          className={`px-3 py-1.5 text-sm rounded-lg ${view === 'directory' ? 'bg-violet-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>
          Directory
        </button>
      </div>

      {view === 'mine' && me === undefined && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500">
          <Loader2 className="animate-spin mx-auto mb-2" size={20} /> Loading…
        </div>
      )}
      {view === 'mine' && me === null && <CreateCompanyForm onCreated={(c) => { setMe({ ...c, my_role: 'Admin', is_primary_admin: true }); }} />}
      {view === 'mine' && me && <CompanyDetail company={me} onChange={loadMe} canEdit={me.is_primary_admin || ['Admin', 'Owner', 'Founder'].includes(me.my_role)} />}

      {view === 'directory' && !detailUid && (
        <CompanyDirectory onOpen={(uid) => { setDetailUid(uid); setView('detail'); }} />
      )}
      {view === 'detail' && detailUid && (
        <CompanyDetailLoader uid={detailUid} onBack={() => { setView('directory'); setDetailUid(null); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------
function CreateCompanyForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
      <Building2 className="mx-auto text-violet-600 mb-3" size={32} />
      <h3 className="text-lg font-semibold text-black mb-1">No company profile yet</h3>
      <p className="text-sm text-gray-600 mb-5">Create one to unlock Growth Sprints, partner matching, and market intel.</p>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
        <Plus size={16} /> Create company profile
      </button>
      {open && <CompanyFormModal onClose={() => setOpen(false)} onSaved={(c) => { setOpen(false); onCreated(c); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail (own or any) with edit + members
// ---------------------------------------------------------------------------
function CompanyDetail({ company, onChange, canEdit }) {
  const [editing, setEditing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-14 h-14 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {company.logo_url ? <img src={company.logo_url} alt="" className="w-full h-full object-cover" /> : <Building2 size={24} />}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-black truncate">{company.company_name}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                {company.stage && <Pill>{company.stage}</Pill>}
                {company.revenue_range && <Pill>{company.revenue_range}</Pill>}
                {company.employee_count != null && <Pill>{company.employee_count} employees</Pill>}
              </div>
              {company.description && <p className="text-sm text-gray-600 mt-2 max-w-2xl">{company.description}</p>}
            </div>
          </div>
          {canEdit && (
            <button onClick={() => setEditing(true)} className="text-sm bg-white border border-gray-300 hover:border-violet-400 text-gray-700 px-3 py-1.5 rounded-lg">
              Edit
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <Field label="Current products">{company.current_products || <Empty />}</Field>
          <Field label="International presence">{company.international_presence || <Empty />}</Field>
          <Field label="Expansion goals">{company.expansion_goals || <Empty />}</Field>
          <Field label="Links">
            <div className="flex flex-wrap gap-3">
              {company.website && <a href={company.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-600 hover:underline"><Globe size={14}/> website</a>}
              {company.linkedin_url && <a href={company.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-600 hover:underline"><Linkedin size={14}/> linkedin</a>}
              {!company.website && !company.linkedin_url && <Empty />}
            </div>
          </Field>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-black">Team members ({company.member_count || 0})</h3>
          </div>
          {canEdit && (
            <button onClick={() => setShowAdd(true)} className="text-xs inline-flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-1.5 rounded-lg">
              <UserPlus size={12}/> Add member
            </button>
          )}
        </div>
        <div className="divide-y divide-gray-100">
          {(company.members || []).map(m => (
            <div key={m.user_id} className="py-2.5 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-black truncate">{m.name || m.email}</div>
                <div className="text-xs text-gray-500 truncate">{m.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={m.is_primary_admin ? 'violet' : 'gray'}>
                  {m.is_primary_admin ? `${m.role_in_company} • Primary` : m.role_in_company}
                </Pill>
                {canEdit && !m.is_primary_admin && (
                  <button
                    onClick={async () => { if (confirm(`Remove ${m.name || m.email}?`)) { await api.removeCompanyMember(company.uid, m.user_id); onChange(); } }}
                    className="text-gray-400 hover:text-red-600 p-1" title="Remove">
                    <Trash2 size={14}/>
                  </button>
                )}
              </div>
            </div>
          ))}
          {(!company.members || company.members.length === 0) && <div className="text-sm text-gray-500 py-4">No team members yet.</div>}
        </div>
      </div>

      {editing && (
        <CompanyFormModal initial={company} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChange(); }} />
      )}
      {showAdd && (
        <AddMemberModal companyUid={company.uid} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); onChange(); }} />
      )}
    </div>
  );
}

function CompanyDetailLoader({ uid, onBack }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { (async () => { try { setC(await api.getCompany(uid)); } catch (e) { setErr(e.message); } })(); }, [uid]);
  if (err) return <div className="bg-white border border-gray-200 rounded-xl p-8 text-sm text-red-600">{err}</div>;
  if (!c) return <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500"><Loader2 className="animate-spin mx-auto"/></div>;
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm text-violet-600 hover:underline">← Back to directory</button>
      <CompanyDetail company={c} onChange={() => {}} canEdit={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------
function CompanyDirectory({ onOpen }) {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [revenue, setRevenue] = useState('');
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try { setData(await api.listCompanies({ q, stage, revenue_range: revenue })); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);
  useEffect(() => { const t = setTimeout(reload, 300); return () => clearTimeout(t); }, [q, stage, revenue]);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-gray-50 border border-gray-200 rounded-lg px-3">
          <Search size={14} className="text-gray-400"/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search companies"
            className="bg-transparent w-full py-2 text-sm text-black placeholder:text-gray-400 outline-none"/>
        </div>
        <select value={stage} onChange={e => setStage(e.target.value)} className="text-sm bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-black">
          <option value="">All stages</option>
          {STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={revenue} onChange={e => setRevenue(e.target.value)} className="text-sm bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-black">
          <option value="">All revenue</option>
          {REVENUE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500"><Loader2 className="animate-spin mx-auto"/></div>
      ) : data.items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500 text-sm">No companies match your filters.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.items.map(c => (
            <button key={c.uid} onClick={() => onOpen(c.uid)}
              className="text-left bg-white border border-gray-200 hover:border-violet-300 rounded-xl p-4 transition-colors">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {c.logo_url ? <img src={c.logo_url} alt="" className="w-full h-full object-cover"/> : <Building2 size={18}/>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-black truncate">{c.company_name}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.stage && <Pill>{c.stage}</Pill>}
                    {c.revenue_range && <Pill>{c.revenue_range}</Pill>}
                  </div>
                  {c.description && <div className="text-xs text-gray-500 mt-2 line-clamp-2">{c.description}</div>}
                </div>
                <ChevronRight size={16} className="text-gray-300 flex-shrink-0 mt-1"/>
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="text-xs text-gray-500">{data.total} total</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function CompanyFormModal({ initial, onClose, onSaved }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(() => ({
    company_name: initial?.company_name || '',
    stage: initial?.stage || '',
    revenue_range: initial?.revenue_range || '',
    employee_count: initial?.employee_count ?? '',
    current_products: initial?.current_products || '',
    international_presence: initial?.international_presence || '',
    expansion_goals: initial?.expansion_goals || '',
    logo_url: initial?.logo_url || '',
    website: initial?.website || '',
    linkedin_url: initial?.linkedin_url || '',
    description: initial?.description || '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!form.company_name.trim()) { setErr('Company name is required'); return; }
    setBusy(true); setErr('');
    try {
      const payload = { ...form, employee_count: form.employee_count === '' ? null : Number(form.employee_count) };
      const result = isEdit
        ? await api.updateCompany(initial.uid, payload)
        : await api.createCompany(payload);
      onSaved(result);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal onClose={onClose} title={isEdit ? 'Edit company profile' : 'Create company profile'}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Company name *" value={form.company_name} onChange={v => setForm({...form, company_name: v})} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Stage" value={form.stage} onChange={v => setForm({...form, stage: v})} options={['', ...STAGE_OPTIONS]} />
          <Select label="Revenue range" value={form.revenue_range} onChange={v => setForm({...form, revenue_range: v})} options={['', ...REVENUE_OPTIONS]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Employees" type="number" value={form.employee_count} onChange={v => setForm({...form, employee_count: v})}/>
          <Input label="Logo URL" value={form.logo_url} onChange={v => setForm({...form, logo_url: v})}/>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Website" value={form.website} onChange={v => setForm({...form, website: v})}/>
          <Input label="LinkedIn URL" value={form.linkedin_url} onChange={v => setForm({...form, linkedin_url: v})}/>
        </div>
        <Textarea label="Description" value={form.description} onChange={v => setForm({...form, description: v})}/>
        <Textarea label="Current products" value={form.current_products} onChange={v => setForm({...form, current_products: v})}/>
        <Textarea label="International presence" value={form.international_presence} onChange={v => setForm({...form, international_presence: v})}/>
        <Textarea label="Expansion goals" value={form.expansion_goals} onChange={v => setForm({...form, expansion_goals: v})}/>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={busy} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddMemberModal({ companyUid, onClose, onAdded }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.addCompanyMember(companyUid, { email: email.trim(), role_in_company: role });
      onAdded();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <Modal onClose={onClose} title="Add team member">
      <form onSubmit={submit} className="space-y-3">
        <Input label="User email *" value={email} onChange={setEmail} placeholder="founder@example.com"/>
        <Select label="Role" value={role} onChange={setRole} options={['Founder', 'Admin', 'Advisor', 'Member']}/>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="text-xs text-gray-500">User must already have a StudioOS account.</div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={busy || !email.trim()} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin"/> : <UserPlus size={14}/>} Add
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tiny UI primitives
// ---------------------------------------------------------------------------
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 sticky top-0 bg-white">
          <h3 className="font-semibold text-black">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18}/></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      <div className="text-sm text-gray-800 whitespace-pre-wrap">{children}</div>
    </div>
  );
}
function Empty() { return <span className="text-gray-400 italic">—</span>; }

function Pill({ children, tone = 'gray' }) {
  const tones = { gray: 'bg-gray-100 text-gray-700', violet: 'bg-violet-100 text-violet-700' };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${tones[tone] || tones.gray}`}>{children}</span>;
}

function Input({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 block mb-1">{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-black focus:border-violet-500 focus:outline-none"/>
    </label>
  );
}
function Textarea({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 block mb-1">{label}</span>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-black focus:border-violet-500 focus:outline-none"/>
    </label>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 block mb-1">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-black focus:border-violet-500 focus:outline-none">
        {options.map(o => <option key={o} value={o}>{o || '—'}</option>)}
      </select>
    </label>
  );
}
