import React, { useEffect, useState } from 'react';
import { Scale, Banknote, Building2, ClipboardCheck, Plus, Loader2, X, FileText, Sparkles, ShieldCheck, Send, CheckCircle2, AlertTriangle, Rocket } from 'lucide-react';
import { api } from '../lib/api';

const DOC_TYPES = [
  { id: 'SAFE', label: 'SAFE Note' },
  { id: 'IP_license', label: 'IP License' },
  { id: 'equity_allocation', label: 'Equity Allocation' },
  { id: 'bylaws', label: 'Bylaws' },
  { id: '83b_election', label: '83(b) Election' },
];
const CHECKLIST_TYPES = ['legal', 'financial', 'tech', 'compliance'];

export default function LegalCapitalPage() {
  const [tab, setTab] = useState('legal');
  const [deals, setDeals] = useState([]);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setMe(await api.getCurrentUser());
        const d = await api.pipelineActive();
        setDeals(d);
        if (d.length) setSelectedDeal(d[0].id);
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  const canEdit = me && (me.role === 'admin' || me.role === 'partner');
  if (loading) return <Loading />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Scale className="text-violet-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Legal & Capital Engine</h1>
            <p className="text-sm text-gray-600">Automated SAFE/IP docs, capital calls, diligence, and one-click subsidiary spin-out.</p>
          </div>
        </div>
        {deals.length > 0 && (
          <select value={selectedDeal || ''} onChange={e => setSelectedDeal(parseInt(e.target.value))} className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm">
            {deals.map(d => <option key={d.id} value={d.id}>{d.name}{d.pipeline_stage === 'spinout_ready' ? ' 🚀' : ''}</option>)}
          </select>
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {[
          {id: 'legal', label: 'Legal Engine', icon: FileText},
          {id: 'capital', label: 'Capital Engine', icon: Banknote},
          {id: 'spinout', label: 'Spin-Out', icon: Rocket},
          {id: 'diligence', label: 'Diligence', icon: ClipboardCheck},
          {id: 'lp', label: 'LP Portal', icon: ShieldCheck},
        ].map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {!selectedDeal && tab !== 'lp' && <Empty text="No deals available. Create one in the Pipeline first." />}
      {tab === 'legal' && selectedDeal && <LegalTab dealId={selectedDeal} canEdit={canEdit} />}
      {tab === 'capital' && selectedDeal && <CapitalTab dealId={selectedDeal} canEdit={canEdit} />}
      {tab === 'spinout' && selectedDeal && <SpinoutTab dealId={selectedDeal} canEdit={canEdit} deal={deals.find(d => d.id === selectedDeal)} />}
      {tab === 'diligence' && selectedDeal && <DiligenceTab dealId={selectedDeal} canEdit={canEdit} />}
      {tab === 'lp' && <LPPortalTab />}
    </div>
  );
}

function LegalTab({ dealId, canEdit }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [err, setErr] = useState('');

  const reload = async () => { setLoading(true); try { setDocs(await api.legalDocs(dealId)); } finally { setLoading(false); } };
  useEffect(() => { reload(); }, [dealId]);

  const generate = async (type) => {
    setGenerating(type); setErr('');
    try { const d = await api.legalGenerate({ deal_id: dealId, type }); await reload(); setViewing(d); }
    catch (e) { setErr(e.message); }
    finally { setGenerating(null); }
  };
  const sign = async (id) => { try { await api.legalSign(id); reload(); } catch (e) { setErr(e.message); } };

  return (
    <div className="space-y-4">
      {err && <Alert text={err} />}
      {canEdit && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Sparkles size={14} className="text-violet-600" /> Generate Document</div>
          <div className="flex flex-wrap gap-2">
            {DOC_TYPES.map(t => (
              <button key={t.id} onClick={() => generate(t.id)} disabled={!!generating}
                className="text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg flex items-center gap-1">
                {generating === t.id ? <Loader2 className="animate-spin" size={12} /> : <Plus size={12} />} {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold text-sm">Documents ({docs.length})</div>
        {docs.length === 0 ? <Empty text="No documents yet. Generate one above." /> : (
          <div className="divide-y divide-gray-100">
            {docs.map(d => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <FileText size={16} className="text-violet-500" />
                <div className="flex-1">
                  <div className="font-medium text-sm">{DOC_TYPES.find(t => t.id === d.type)?.label || d.type} <span className="text-[10px] text-gray-400">v{d.version}</span></div>
                  <div className="text-[10px] text-gray-500">{new Date(d.created_at).toLocaleString()} {d.model && `• ${d.model}`}</div>
                </div>
                <DocStatusPill status={d.status} />
                <button onClick={() => setViewing(d)} className="text-xs text-violet-600 hover:text-violet-700">View</button>
                {canEdit && d.status === 'generated' && <button onClick={() => sign(d.id)} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded">Sign</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {viewing && <DocViewerModal doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CapitalTab({ dealId, canEdit }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  const reload = async () => {
    setLoading(true);
    try {
      const all = await api.capitalCalls();
      setCalls(all.filter(c => c.deal_id === dealId));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, [dealId]);

  const send = async (id) => { try { await api.capitalSend(id); reload(); } catch (e) { setErr(e.message); } };

  return (
    <div className="space-y-4">
      {err && <Alert text={err} />}
      {canEdit && (
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm px-3 py-2 rounded-lg">
          <Plus size={14} /> New Capital Call
        </button>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {calls.length === 0 ? <Empty text="No capital calls for this deal yet." /> : calls.map(c => {
          const responses = c.lp_responses || {};
          const totalCommitted = Object.values(responses).reduce((a, r) => a + (r.amount_cents || 0), 0);
          const pct = c.amount_cents ? Math.min(100, Math.round((totalCommitted / c.amount_cents) * 100)) : 0;
          return (
            <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-bold text-lg">${(c.amount_cents / 100).toLocaleString()} {c.currency}</div>
                  <div className="text-xs text-gray-500">{c.syndicate_name || c.deal_name || 'Direct'}</div>
                </div>
                <CallStatusPill status={c.status} />
              </div>
              <div className="text-xs text-gray-700 mb-2">Due: {new Date(c.due_date).toLocaleDateString()}</div>
              <div className="mb-2">
                <div className="flex justify-between text-[10px] text-gray-500 mb-1"><span>Committed: ${(totalCommitted/100).toLocaleString()}</span><span>{pct}%</span></div>
                <div className="bg-gray-100 rounded-full h-2 overflow-hidden"><div className="h-full bg-emerald-500" style={{width: `${pct}%`}} /></div>
              </div>
              <div className="text-[10px] text-gray-500">{Object.keys(responses).length} LP responses</div>
              {canEdit && c.status === 'draft' && (
                <button onClick={() => send(c.id)} className="mt-2 w-full text-xs bg-violet-600 hover:bg-violet-700 text-white py-1.5 rounded flex items-center justify-center gap-1"><Send size={11} /> Send to LPs</button>
              )}
            </div>
          );
        })}
      </div>
      {creating && <CreateCallModal dealId={dealId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
    </div>
  );
}

function SpinoutTab({ dealId, canEdit, deal }) {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ subsidiary_name: '', jurisdiction: 'Delaware_CCorp', capital_call_amount: 250000, force: false });

  const load = async () => { setLoading(true); try { setSub(await api.subsidiaryFor(dealId)); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [dealId]);

  const launch = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api.spinout({
        deal_id: dealId,
        subsidiary_name: form.subsidiary_name || `${deal?.name || 'NewCo'}, Inc.`,
        jurisdiction: form.jurisdiction,
        capital_call_amount_cents: Math.round(parseFloat(form.capital_call_amount) * 100),
        force: form.force,
      });
      setResult(r); load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <Loading />;

  if (sub) return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-emerald-100 text-emerald-600 w-12 h-12 rounded-full flex items-center justify-center"><CheckCircle2 size={24} /></div>
        <div>
          <h3 className="font-bold text-lg">{sub.subsidiary_name}</h3>
          <div className="text-xs text-gray-500">{sub.jurisdiction} • Holding: {sub.holding_company_id}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <KV k="Atlas Status" v={sub.stripe_atlas_status} />
        <KV k="Atlas Ref" v={sub.stripe_atlas_ref || '—'} />
        <KV k="EIN" v={sub.ein || 'Pending'} />
        <KV k="IP Transfer" v={sub.ip_transfer_complete ? 'Complete' : 'Pending'} />
      </div>
      <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-xs">
        <div className="font-semibold text-violet-900 mb-1">Equity Allocation</div>
        <div className="flex flex-wrap gap-2 text-violet-800">
          {Object.entries(sub.equity_allocated || {}).map(([k, v]) => <span key={k}>{k.replace('_', ' ')}: <b>{String(v)}{typeof v === 'number' ? '%' : ''}</b></span>)}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {err && <Alert text={err} />}
      <div className="bg-gradient-to-br from-violet-600 to-violet-800 text-white rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-3"><Rocket size={24} /><h2 className="text-xl font-bold">One-Click Subsidiary Spin-Out</h2></div>
        <p className="text-sm opacity-90">Generates SAFE + IP License + Equity Allocation, kicks off Stripe Atlas incorporation, creates a capital call, and opens a Studio Ops coordination workflow — all atomically.</p>
      </div>

      {canEdit ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
          <Field label="Subsidiary Name"><input value={form.subsidiary_name} onChange={e => setForm({...form, subsidiary_name: e.target.value})} placeholder={`${deal?.name || 'NewCo'}, Inc.`} className={inputCls} /></Field>
          <Field label="Jurisdiction">
            <select value={form.jurisdiction} onChange={e => setForm({...form, jurisdiction: e.target.value})} className={inputCls}>
              <option value="Delaware_CCorp">Delaware C-Corp</option>
              <option value="global">Global Subsidiary</option>
            </select>
          </Field>
          <Field label="Capital Call Amount (USD)"><input type="number" value={form.capital_call_amount} onChange={e => setForm({...form, capital_call_amount: e.target.value})} className={inputCls} /></Field>
          <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={form.force} onChange={e => setForm({...form, force: e.target.checked})} /> Override decision-gate requirement</label>
          <button onClick={launch} disabled={busy} className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium px-4 py-3 rounded-lg">
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Rocket size={16} />} Launch Spin-Out
          </button>
        </div>
      ) : <Empty text="Read-only view. Operators/admins can launch spin-out." />}

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm">
          <div className="font-bold text-emerald-900 mb-2 flex items-center gap-1"><CheckCircle2 size={14} /> Spin-out launched</div>
          <ul className="list-disc list-inside space-y-1 text-emerald-800 text-xs">
            <li>Subsidiary: {result.subsidiary.subsidiary_name} ({result.subsidiary.jurisdiction})</li>
            <li>Stripe Atlas: {result.stripe_atlas.status} (ref: {result.stripe_atlas.ref}, real API: {result.stripe_atlas.real_api ? 'yes' : 'mock'})</li>
            <li>Legal docs generated: {result.legal_docs.map(d => d.type).join(', ')}</li>
            {result.capital_call && <li>Capital call sent: ${(result.capital_call.amount_cents/100).toLocaleString()}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function DiligenceTab({ dealId, canEdit }) {
  const [items, setItems] = useState([]);
  const [type, setType] = useState('legal');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reload = async () => { try { setItems(await api.diligenceFor(dealId)); } catch (e) { setErr(e.message); } };
  useEffect(() => { reload(); }, [dealId]);

  const review = async () => {
    setBusy(true); setErr('');
    try { await api.diligenceReview({ deal_id: dealId, checklist_type: type }); reload(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {err && <Alert text={err} />}
      {canEdit && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-2 flex-wrap">
          <select value={type} onChange={e => setType(e.target.value)} className="bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm">
            {CHECKLIST_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
          <button onClick={review} disabled={busy} className="text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg flex items-center gap-1">
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} Run AI Review
          </button>
        </div>
      )}
      {items.length === 0 ? <Empty text="No diligence checklists yet. Run an AI review above." /> : (
        <div className="grid md:grid-cols-2 gap-3">
          {items.map(d => (
            <div key={d.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-xs uppercase text-gray-500">{d.checklist_type}</div>
                  <div className="text-xl font-bold text-violet-700">{Math.round(d.ai_score)}/100</div>
                </div>
                <span className="text-[10px] text-gray-500">{new Date(d.created_at).toLocaleDateString()}</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2 mb-3 overflow-hidden"><div className="h-full bg-violet-500" style={{width: `${d.ai_score}%`}} /></div>
              {d.ai_summary && <p className="text-xs text-gray-700 italic bg-violet-50 border border-violet-100 rounded p-2 mb-3">{d.ai_summary}</p>}
              <div className="space-y-1">
                {d.items.map((it, i) => (
                  <div key={i} className="text-xs flex items-center gap-2 py-1 border-b border-gray-100 last:border-0">
                    <StatusDot status={it.status} />
                    <span className="flex-1">{it.item}</span>
                    <span className="text-[10px] text-gray-500">{it.status}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LPPortalTab() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [responding, setResponding] = useState(null);

  const reload = async () => { setLoading(true); try { setCalls(await api.lpPortal()); } catch (e) { setErr(e.message); } finally { setLoading(false); } };
  useEffect(() => { reload(); }, []);

  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      {err && <Alert text={err} />}
      {calls.length === 0 ? <Empty text="No open capital calls for you." /> : (
        <div className="space-y-3">
          {calls.map(c => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-bold text-lg">${(c.amount_cents / 100).toLocaleString()} {c.currency}</div>
                  <div className="text-xs text-gray-500">{c.syndicate_name || c.deal_name}</div>
                </div>
                <CallStatusPill status={c.status} />
              </div>
              <div className="text-xs text-gray-700 mb-3">Due: {new Date(c.due_date).toLocaleDateString()}</div>
              {c.my_response ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-xs">
                  Your response: <b>{c.my_response.decision}</b> — ${(c.my_response.amount_cents/100).toLocaleString()} on {new Date(c.my_response.at).toLocaleDateString()}
                </div>
              ) : (
                <button onClick={() => setResponding(c)} className="bg-violet-600 hover:bg-violet-700 text-white text-xs px-3 py-1.5 rounded">Respond</button>
              )}
            </div>
          ))}
        </div>
      )}
      {responding && <RespondModal call={responding} onClose={() => setResponding(null)} onDone={() => { setResponding(null); reload(); }} />}
    </div>
  );
}

// ============== modals ==============

function DocViewerModal({ doc, onClose }) {
  return (
    <Modal onClose={onClose} title={`${DOC_TYPES.find(t => t.id === doc.type)?.label || doc.type}`} wide>
      <div className="text-[10px] text-gray-500 mb-2">v{doc.version} • {doc.status} • {new Date(doc.created_at).toLocaleString()}</div>
      <pre className="bg-gray-50 border border-gray-200 rounded p-4 text-xs whitespace-pre-wrap font-mono max-h-[60vh] overflow-y-auto">{doc.body}</pre>
    </Modal>
  );
}

function CreateCallModal({ dealId, onClose, onCreated }) {
  const [form, setForm] = useState({ amount: 250000, currency: 'USD', syndicate_id: '', notes: '', send: false });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await api.createCapitalCall({
        deal_id: dealId,
        syndicate_id: form.syndicate_id ? parseInt(form.syndicate_id) : undefined,
        amount_cents: Math.round(parseFloat(form.amount) * 100),
        currency: form.currency, notes: form.notes, send: form.send,
      });
      onCreated();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="New Capital Call">
      <Field label="Amount (USD)"><input type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className={inputCls} /></Field>
      <Field label="Syndicate ID (optional)"><input type="number" value={form.syndicate_id} onChange={e => setForm({...form, syndicate_id: e.target.value})} className={inputCls} placeholder="If linked to a syndicate" /></Field>
      <Field label="Notes"><textarea rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className={inputCls} /></Field>
      <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={form.send} onChange={e => setForm({...form, send: e.target.checked})} /> Send immediately to LPs</label>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="text-sm text-gray-700 hover:bg-gray-100 px-4 py-2 rounded">Cancel</button>
        <button onClick={submit} disabled={busy} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded">
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Create
        </button>
      </div>
    </Modal>
  );
}

function RespondModal({ call, onClose, onDone }) {
  const [decision, setDecision] = useState('committed');
  const [amount, setAmount] = useState((call.amount_cents / 100).toString());
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try { await api.respondCapitalCall(call.id, { decision, amount_cents: Math.round(parseFloat(amount) * 100) }); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Respond — $${(call.amount_cents/100).toLocaleString()}`}>
      <Field label="Decision">
        <select value={decision} onChange={e => setDecision(e.target.value)} className={inputCls}>
          <option value="committed">Commit</option><option value="paid">Paid</option><option value="declined">Decline</option>
        </select>
      </Field>
      <Field label="Amount ($)"><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} /></Field>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="text-sm text-gray-700 hover:bg-gray-100 px-4 py-2 rounded">Cancel</button>
        <button onClick={submit} disabled={busy} className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded">{busy ? '…' : 'Submit'}</button>
      </div>
    </Modal>
  );
}

function Modal({ onClose, title, children, wide }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full max-h-[90vh] overflow-y-auto ${wide ? 'max-w-3xl' : 'max-w-md'}`} onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button></div>
        <div className="p-6 space-y-3">{children}</div>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none';
function Field({ label, children }) { return <div><label className="text-xs text-gray-700 font-medium block mb-1">{label}</label>{children}</div>; }
function KV({ k, v }) { return <div className="bg-gray-50 rounded-lg p-2"><div className="text-[10px] uppercase text-gray-500">{k}</div><div className="text-sm font-medium text-gray-900 truncate">{String(v)}</div></div>; }
function Empty({ text }) { return <div className="text-sm text-gray-500 py-12 text-center">{text}</div>; }
function Loading() { return <div className="flex items-center gap-2 text-sm text-gray-500 py-20 justify-center"><Loader2 className="animate-spin" size={16} /> Loading…</div>; }
function Alert({ text }) { return <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-xs flex items-center gap-2"><AlertTriangle size={14} /> {text}</div>; }
function StatusDot({ status }) { const c = status === 'done' ? 'bg-emerald-500' : status === 'blocked' ? 'bg-red-500' : status === 'in_progress' ? 'bg-amber-500' : 'bg-gray-300'; return <span className={`w-2 h-2 rounded-full ${c} flex-shrink-0`} />; }
function DocStatusPill({ status }) {
  const c = status === 'signed' ? 'bg-emerald-100 text-emerald-700' : status === 'filed' ? 'bg-violet-100 text-violet-700' : status === 'generated' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700';
  return <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded ${c}`}>{status}</span>;
}
function CallStatusPill({ status }) {
  const c = status === 'paid' ? 'bg-emerald-100 text-emerald-700' : status === 'sent' ? 'bg-blue-100 text-blue-700' : status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700';
  return <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded ${c}`}>{status}</span>;
}
