import React, { useEffect, useState } from 'react';
import { Plus, Loader2, X, Award } from 'lucide-react';
import { api } from '../lib/api';
import { useEscapeClose } from '../components/useEscapeClose';

const REL_TYPES = [
  { id: 'co_investor', label: 'Co-Investor', color: 'bg-emerald-100 text-emerald-700' },
  { id: 'advisor_founder', label: 'Advisor ↔ Founder', color: 'bg-blue-100 text-blue-700' },
  { id: 'operator_partner', label: 'Operator ↔ Partner', color: 'bg-violet-100 text-violet-700' },
  { id: 'strategic_alliance', label: 'Strategic Alliance', color: 'bg-amber-100 text-amber-700' },
  { id: 'advisor_mentee', label: 'Advisor ↔ Mentee', color: 'bg-pink-100 text-pink-700' },
];

// Relationships tab body for the unified Network page. Self-contained: owns its
// partner summary, relationships grid, and create/edit modals. Rendered by
// NetworkPage as the "Relationships" tab. The page-level title lives in the
// NetworkPage container.
export function RelationshipsPanel() {
  const [summary, setSummary] = useState(null);
  const [rels, setRels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  const reload = async () => {
    setLoading(true); setErr('');
    const labels = ['Partner summary', 'Relationships'];
    const results = await Promise.allSettled([api.partnerSummary(), api.partnerRelationships()]);
    const [s, r] = results;
    if (s.status === 'fulfilled') setSummary(s.value); else setSummary(null);
    setRels(r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);
    const failures = results
      .map((res, i) => res.status === 'rejected' ? `${labels[i]}: ${res.reason?.message || 'failed'}` : null)
      .filter(Boolean);
    if (failures.length) setErr(failures.join(' • '));
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-400">Your partner graph and relationship strength.</p>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded p-2 text-sm">{err}</div>}

      {/* Partner summary card */}
      {summary && (
        <div className="bg-gradient-to-br from-violet-600 to-violet-700 text-white rounded-2xl p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs uppercase opacity-80 mb-1">Partner Profile</div>
              <div className="text-2xl font-bold">{summary.name || summary.email}</div>
              <div className="text-xs opacity-80 mt-1">
                {summary.partner_since ? `Partner since ${new Date(summary.partner_since).toLocaleDateString()}` : 'Newcomer'} • {summary.role}
              </div>
              {summary.verified_badges?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {summary.verified_badges.map(b => (
                    <span key={b} className="bg-white/20 text-[10px] uppercase font-bold px-2 py-1 rounded flex items-center gap-1">
                      <Award size={10} /> {b.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <SumStat label="Network Score" value={Math.round(summary.network_score || 0)} />
              <SumStat label="Relationships" value={summary.active_relationships || 0} />
              <SumStat label="Network Reach" value={summary.network_reach || 0} />
              <SumStat label="Lifetime $" value={`$${((summary.lifetime_earnings_cents || 0) / 100).toFixed(0)}`} />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Relationships ({rels.length})</h2>
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm px-3 py-2 rounded-lg">
          <Plus size={14} /> New Relationship
        </button>
      </div>

      <RelationshipsTab rels={rels} reload={reload} />

      {creating && <CreateRelModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
    </div>
  );
}

function RelationshipsTab({ rels, reload }) {
  const [editing, setEditing] = useState(null);
  if (rels.length === 0) return <Empty text="You haven't formed any partner relationships yet. Click 'New Relationship' to start." />;
  return (
    <>
    <div className="grid md:grid-cols-2 gap-3">
      {rels.map(r => {
        const t = REL_TYPES.find(x => x.id === r.relationship_type);
        return (
          <div key={r.id} className="bg-white border border-gray-200 rounded-lg p-4 hover:border-violet-400 transition-colors dark:bg-gray-900 dark:border-gray-800">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">{r.other.name || r.other.email}</div>
                <div className="text-xs text-gray-500">{r.other.email}</div>
              </div>
              <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded ${t?.color || 'bg-gray-100 text-gray-700'}`}>{t?.label || r.relationship_type}</span>
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span>Strength</span><span className="font-bold">{Math.round(r.strength_score)}/100</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-emerald-500" style={{ width: `${r.strength_score}%` }} />
              </div>
            </div>
            <div className="flex justify-between items-center mt-3 text-[10px] text-gray-500">
              <span>{new Date(r.created_at).toLocaleDateString()}</span>
              <button onClick={() => setEditing(r)} className="text-violet-600 hover:text-violet-700">Edit</button>
            </div>
          </div>
        );
      })}
    </div>
    {editing && <EditRelModal rel={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function CreateRelModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ partner_id: '', relationship_type: 'co_investor', strength_score: 50 });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try { await api.createRelationship({ partner_id: parseInt(form.partner_id), relationship_type: form.relationship_type, strength_score: parseFloat(form.strength_score) }); onCreated(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="New Partner Relationship" titleClassName="text-gray-900">
      <Field label="Partner User ID *"><input type="number" value={form.partner_id} onChange={e => setForm({...form, partner_id: e.target.value})} className={inputCls} placeholder="e.g. 42" /></Field>
      <Field label="Relationship Type">
        <select value={form.relationship_type} onChange={e => setForm({...form, relationship_type: e.target.value})} className={`${inputCls} appearance-none pr-10 bg-[linear-gradient(45deg,transparent_50%,#6b7280_50%),linear-gradient(135deg,#6b7280_50%,transparent_50%),linear-gradient(to_right,#fff,#fff)] bg-[position:calc(100%_-_18px)_50%,calc(100%_-_12px)_50%,0_0] bg-[size:6px_6px,6px_6px,100%_100%] bg-no-repeat`}>
          {REL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Field>
      <Field label={`Initial Strength: ${form.strength_score}/100`}>
        <input type="range" min="0" max="100" value={form.strength_score} onChange={e => setForm({...form, strength_score: e.target.value})} className="w-full" />
      </Field>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="text-sm text-gray-700 hover:bg-gray-100 px-4 py-2 rounded dark:text-gray-300">Cancel</button>
        <button onClick={submit} disabled={busy || !form.partner_id} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded">
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Create
        </button>
      </div>
    </Modal>
  );
}

function EditRelModal({ rel, onClose, onSaved }) {
  const [strength, setStrength] = useState(Math.round(rel.strength_score));
  const [type, setType] = useState(rel.relationship_type);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.updateRelationship(rel.id, { strength_score: strength, relationship_type: type }); onSaved(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Edit Relationship with ${rel.other.name || rel.other.email}`}>
      <Field label="Type"><select value={type} onChange={e => setType(e.target.value)} className={inputCls}>{REL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
      <Field label={`Strength: ${strength}/100`}><input type="range" min="0" max="100" value={strength} onChange={e => setStrength(parseInt(e.target.value))} className="w-full" /></Field>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="text-sm text-gray-700 hover:bg-gray-100 px-4 py-2 rounded dark:text-gray-300">Cancel</button>
        <button onClick={save} disabled={busy} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded">
          {busy ? <Loader2 className="animate-spin" size={14} /> : null} Save
        </button>
      </div>
    </Modal>
  );
}

function Modal({ onClose, title, children }) {
  useEscapeClose(onClose);
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto dark:bg-gray-900" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between dark:border-gray-800"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button></div>
        <div className="p-6 space-y-3">{children}</div>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none';
function Field({ label, children }) { return <div><label className="text-xs text-gray-700 font-medium block mb-1 dark:text-gray-300">{label}</label>{children}</div>; }
function SumStat({ label, value }) { return <div className="bg-white/15 rounded-lg p-2 min-w-[80px]"><div className="text-[10px] uppercase opacity-80">{label}</div><div className="text-xl font-bold">{value}</div></div>; }
function Empty({ text }) { return <div className="text-sm text-gray-500 py-12 text-center">{text}</div>; }
function Loading() { return <div className="flex items-center gap-2 text-sm text-gray-500 py-20 justify-center"><Loader2 className="animate-spin" size={16} /> Loading…</div>; }
