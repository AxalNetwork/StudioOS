import React, { useEffect, useState } from 'react';
import {
  Plus, Search, Filter, Briefcase, Clock, ShieldCheck, Edit3,
  Trash2, AlertCircle, X, Check, ExternalLink, Package, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { api } from '../lib/api';

const CATEGORIES = ['legal', 'accounting', 'design', 'recruiting', 'fractional_cfo', 'gtm', 'engineering', 'marketing'];
const CAT_LABEL = {
  legal: 'Legal', accounting: 'Accounting', design: 'Design', recruiting: 'Recruiting',
  fractional_cfo: 'Fractional CFO', gtm: 'GTM', engineering: 'Engineering', marketing: 'Marketing',
};

export default function ServiceCatalogPage({ user }) {
  const isPartner = user?.role === 'partner';
  const isFounder = user?.role === 'founder';
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState(isPartner ? 'mine' : 'browse');

  const tabs = [
    { key: 'browse', label: 'Browse catalogue', icon: Search },
    ...(isPartner || isAdmin ? [{ key: 'mine', label: 'My offerings', icon: Package }] : []),
    ...(isPartner ? [{ key: 'stripe', label: 'Stripe Connect', icon: ShieldCheck }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Service Catalogue</h1>
        <p className="text-sm text-gray-500 mt-1">
          Productised partner offerings — fixed price, fixed scope, fixed SLA. Founders book
          directly; engagements run through the same lifecycle as accepted quotes.
        </p>
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

      {tab === 'browse' && <BrowseTab user={user} isFounder={isFounder} />}
      {tab === 'mine' && (isPartner || isAdmin) && <MineTab user={user} />}
      {tab === 'stripe' && isPartner && <StripeTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse — public listings (founders, investors, admins, other partners)
// ---------------------------------------------------------------------------
export function BrowseTab({ user, isFounder }) {
  const [filters, setFilters] = useState({ category: '', q: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const params = {};
      if (filters.category) params.category = filters.category;
      const r = await api.listServiceOfferings(params);
      let list = r.offerings || [];
      if (filters.q) {
        const q = filters.q.toLowerCase();
        list = list.filter((o) => `${o.title} ${o.description} ${o.partner_name || ''}`.toLowerCase().includes(q));
      }
      setRows(list);
    } catch (e) {
      // 404 = catalogue route missing on this deployment (stale worker).
      // The empty-state card already covers "no offerings published yet" —
      // don't double up with a raw red banner above it.
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setRows([]);
      else setError(e.message);
    }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-2 dark:bg-gray-900 dark:border-gray-800">
        <Filter size={14} className="text-gray-500" />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search title / partner"
            className="pl-8 border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
        </div>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white dark:border-gray-700 dark:bg-gray-900">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
        </select>
        <button onClick={load} className="ml-auto bg-violet-600 hover:bg-violet-700 text-white rounded-md px-4 py-1.5 text-sm font-medium">Apply</button>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {!loading && rows.length === 0 && <Empty icon={Briefcase} text="No offerings published yet." />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((o) => <OfferingCard key={o.id} o={o} onClick={() => setSelected(o)} />)}
      </div>

      {selected && (
        <OfferingDetailModal
          offering={selected}
          user={user}
          isFounder={isFounder}
          onClose={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}

function OfferingCard({ o, onClick }) {
  return (
    <button onClick={onClick} className="text-left bg-white border border-gray-200 hover:border-violet-300 hover:shadow-sm transition rounded-xl p-4 flex flex-col gap-2 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{o.title}</div>
          <div className="text-xs text-gray-500 mt-0.5">{o.partner_name || 'Unknown partner'} · {CAT_LABEL[o.category] || o.category}</div>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full border bg-violet-50 text-violet-700 border-violet-200 whitespace-nowrap">
          ${o.price.toLocaleString()} {o.currency?.toUpperCase()}
        </span>
      </div>
      <p className="text-sm text-gray-700 line-clamp-3 dark:text-gray-300">{o.description}</p>
      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
        {o.sla_days != null && <span className="flex items-center gap-1"><Clock size={12} /> {o.sla_days}d SLA</span>}
        {o.partner_kyb_status === 'verified' && <span className="flex items-center gap-1 text-emerald-700"><ShieldCheck size={12} /> Verified</span>}
        {!o.listed && <span className="flex items-center gap-1 text-amber-700">Unlisted</span>}
      </div>
    </button>
  );
}

function OfferingDetailModal({ offering, user, isFounder, onClose }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!isFounder) return;
    api.listProjects().then((r) => {
      const list = Array.isArray(r) ? r : (r.projects || []);
      setProjects(list);
      if (list.length) setProjectId(String(list[0].id));
    }).catch(() => {});
  }, [isFounder]);

  async function engage() {
    setBusy(true); setError(null);
    try {
      const r = await api.engageServiceOffering(offering.id, { project_id: Number(projectId), notes });
      setDone(r);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={offering.title} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="text-xs text-gray-500">{offering.partner_name} · {CAT_LABEL[offering.category] || offering.category}</div>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">${offering.price.toLocaleString()} {offering.currency?.toUpperCase()}</span>
          {offering.sla_days != null && <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-50 text-gray-700 border-gray-200 dark:text-gray-300 dark:border-gray-800">SLA {offering.sla_days} days</span>}
        </div>
        <Field label="Description"><p className="text-gray-800 whitespace-pre-line dark:text-gray-200">{offering.description}</p></Field>
        <Field label="Deliverables"><p className="text-gray-800 whitespace-pre-line dark:text-gray-200">{offering.deliverables}</p></Field>

        {isFounder && !done && (
          <div className="border-t pt-4 space-y-3">
            <Field label="Charge to project">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white dark:border-gray-700 dark:bg-gray-900">
                {projects.length === 0 && <option value="">No startups</option>}
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Notes for the partner (optional)">
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
            </Field>
            {error && <ErrorBox message={error} />}
            <button disabled={busy || !projectId} onClick={engage} className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-md px-4 py-2 text-sm font-medium flex items-center gap-2">
              <Check size={14} /> {busy ? 'Booking…' : `Book this offering — $${offering.price.toLocaleString()}`}
            </button>
          </div>
        )}
        {done && (
          <div className="border-t pt-4">
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
              <Check size={16} className="mt-0.5" />
              <div>
                <div className="font-semibold">Engagement created (#{done.engagement_id})</div>
                <div className="text-xs mt-1">Status: <strong>{done.status}</strong>. Track it on the Needs Board → Engagements tab.</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Mine — partner manages their own offerings
// ---------------------------------------------------------------------------
export function MineTab({ user }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!user?.partner_id) { setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const r = await api.listPartnerOfferings(user.partner_id);
      setRows(r.offerings || []);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setRows([]);
      else setError(e.message);
    }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  async function toggleListed(o) {
    try {
      await api.updateServiceOffering(o.id, { listed: !o.listed });
      load();
    } catch (e) { setError(e.message); }
  }
  async function remove(o) {
    if (!window.confirm(`Delete "${o.title}"? If any engagements reference it, it will be unlisted instead.`)) return;
    try { await api.deleteServiceOffering(o.id); load(); } catch (e) { setError(e.message); }
  }

  if (!user?.partner_id && user?.role !== 'admin') {
    return <Empty icon={Briefcase} text="Only partner accounts can publish offerings." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{rows.length} offering{rows.length === 1 ? '' : 's'}</div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="bg-violet-600 hover:bg-violet-700 text-white rounded-md px-4 py-1.5 text-sm font-medium flex items-center gap-2">
          <Plus size={14} /> New offering
        </button>
      </div>
      {error && <ErrorBox message={error} />}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {!loading && rows.length === 0 && <Empty icon={Package} text="No offerings yet. Publish your first package to appear in the catalogue." />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((o) => (
          <div key={o.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2 dark:bg-gray-900 dark:border-gray-800">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{o.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{CAT_LABEL[o.category] || o.category} · ${o.price.toLocaleString()} {o.currency?.toUpperCase()}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${o.listed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                {o.listed ? 'Listed' : 'Unlisted'}
              </span>
            </div>
            <p className="text-sm text-gray-700 line-clamp-2 dark:text-gray-300">{o.description}</p>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => { setEditing(o); setShowForm(true); }} className="text-xs flex items-center gap-1 text-violet-700 hover:text-violet-900"><Edit3 size={12} /> Edit</button>
              <button onClick={() => toggleListed(o)} className="text-xs flex items-center gap-1 text-gray-600 hover:text-gray-900">
                {o.listed ? <ToggleRight size={14} /> : <ToggleLeft size={14} />} {o.listed ? 'Unlist' : 'List'}
              </button>
              <button onClick={() => remove(o)} className="text-xs flex items-center gap-1 text-rose-600 hover:text-rose-800 ml-auto"><Trash2 size={12} /> Delete</button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <OfferingFormModal
          offering={editing}
          onClose={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function OfferingFormModal({ offering, onClose }) {
  const [form, setForm] = useState({
    title: offering?.title || '',
    description: offering?.description || '',
    deliverables: offering?.deliverables || '',
    category: offering?.category || 'legal',
    price: offering?.price ?? '',
    currency: offering?.currency || 'usd',
    sla_days: offering?.sla_days ?? '',
    listed: offering?.listed ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      const payload = {
        ...form,
        price: Number(form.price),
        sla_days: form.sla_days === '' ? null : Number(form.sla_days),
      };
      if (offering) await api.updateServiceOffering(offering.id, payload);
      else await api.createServiceOffering(payload);
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal title={offering ? 'Edit offering' : 'New offering'} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <Field label="Title">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white dark:border-gray-700 dark:bg-gray-900">
              {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="SLA (days)">
            <input type="number" value={form.sla_days} onChange={(e) => setForm({ ...form, sla_days: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price">
            <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
          </Field>
          <Field label="Currency">
            <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} maxLength={4} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
          </Field>
        </div>
        <Field label="Description (what the founder gets)">
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
        </Field>
        <Field label="Deliverables (one per line)">
          <textarea rows={5} value={form.deliverables} onChange={(e) => setForm({ ...form, deliverables: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={!!form.listed} onChange={(e) => setForm({ ...form, listed: e.target.checked })} /> Listed in public catalogue
        </label>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700">Cancel</button>
          <button disabled={busy} onClick={save} className="px-4 py-1.5 text-sm rounded-md bg-violet-600 hover:bg-violet-700 text-white">
            {busy ? 'Saving…' : (offering ? 'Save changes' : 'Publish offering')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Stripe Connect onboarding tab
// ---------------------------------------------------------------------------
export function StripeTab() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try { setStatus(await api.getMyStripeStatus()); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function onboard() {
    setBusy(true); setError(null);
    try {
      const r = await api.startStripeOnboarding();
      if (r.url) {
        if (r.simulated) {
          alert('Stripe is in simulated mode (no STRIPE_SECRET_KEY configured). Pretend onboarding completed — click "Refresh status" next.');
        } else {
          window.location.href = r.url;
          return;
        }
      }
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setError(null);
    try { setStatus(await api.refreshStripeStatus()); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!status) return <div className="text-sm text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      {error && <ErrorBox message={error} />}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <ShieldCheck className={status.charges_enabled ? 'text-emerald-600' : 'text-gray-400'} size={20} />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Stripe Connect</h2>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${status.live_mode ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
            {status.live_mode ? 'Live mode' : 'Simulated'}
          </span>
        </div>
        <p className="text-sm text-gray-600">
          Connect a Stripe account to bill founders directly when an engagement reaches the
          <strong> delivered</strong> stage. Without this, the invoice button surfaces a
          simulated invoice URL for testing.
        </p>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-gray-500">Connected account</dt>
          <dd className="font-mono text-xs text-gray-800 dark:text-gray-200">{status.stripe_account_id || '—'}</dd>
          <dt className="text-gray-500">Charges enabled</dt>
          <dd className="text-gray-800 dark:text-gray-200">{status.charges_enabled ? 'Yes' : 'No'}</dd>
          <dt className="text-gray-500">Payouts enabled</dt>
          <dd className="text-gray-800 dark:text-gray-200">{status.payouts_enabled ? 'Yes' : 'No'}</dd>
          <dt className="text-gray-500">Onboarded at</dt>
          <dd className="text-gray-800 dark:text-gray-200">{status.onboarded_at ? new Date(status.onboarded_at).toLocaleString() : '—'}</dd>
        </dl>
        <div className="flex items-center gap-2 pt-2">
          <button disabled={busy} onClick={onboard} className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-md px-4 py-1.5 text-sm font-medium flex items-center gap-2">
            <ExternalLink size={14} /> {status.connected ? 'Re-open Stripe onboarding' : 'Connect Stripe'}
          </button>
          <button disabled={busy} onClick={refresh} className="border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md px-4 py-1.5 text-sm dark:border-gray-700 dark:text-gray-300">Refresh status</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits (small clones of NeedsBoardPage helpers — kept local for clarity)
// ---------------------------------------------------------------------------
function Modal({ title, onClose, children, wide }) {
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
