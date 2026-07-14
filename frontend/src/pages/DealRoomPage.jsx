import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reportError } from '../lib/log';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';
import {
  ArrowLeft, Download, FileText, Loader2, X, DollarSign, Send, Check,
  Users, Clock, ThumbsUp, ThumbsDown,
} from 'lucide-react';

function useCurrentRole() {
  const { role } = useAuth();
  if (role) return role;
  try { return safeReadJSON('user', {}).role || null; }
  catch { return null; }
}

const statusColors = {
  applied: 'bg-blue-100 text-blue-700 border-blue-500/30',
  scored: 'bg-yellow-100 text-yellow-700 border-yellow-500/30',
  active: 'bg-green-100 text-green-700 border-green-500/30',
  funded: 'bg-violet-100 text-violet-700 border-violet-500/30',
  rejected: 'bg-red-100 text-red-700 border-red-500/30',
};

function fmtMoney(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString()}`;
}

const TABS = ['Overview', 'Documents', 'Commitments', 'Activity'];

export default function DealRoomPage() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const role = useCurrentRole();
  const isInvestor = role === 'investor';
  const isAdmin = role === 'admin';

  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Overview');
  const [error, setError] = useState('');
  const [commitOpen, setCommitOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [myInvite, setMyInvite] = useState(null);

  const loadDeal = () => {
    api.getDeal(dealId)
      .then(d => { setDeal(d); document.title = `${d.project_name || 'Deal Room'} — axal`; })
      .catch(e => { setError(e.message || 'Deal not found'); reportError('DealRoom:getDeal', e); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDeal(); /* eslint-disable-next-line */ }, [dealId]);

  useEffect(() => {
    if (isInvestor) {
      api.myDealInvitations()
        .then(list => setMyInvite((list || []).find(i => Number(i.deal_id) === Number(dealId)) || null))
        .catch(() => {});
    }
  }, [isInvestor, dealId, commitOpen]);

  const respond = async (response) => {
    try {
      await api.respondDealInvitation(dealId, response);
      setMyInvite(m => (m ? { ...m, status: response } : m));
    } catch (e) { reportError('DealRoom:respond', e); }
  };

  if (loading) return <div className="text-center text-gray-500 py-16"><Loader2 className="animate-spin inline mr-2" size={18} /> Loading deal room…</div>;
  if (error || !deal) return (
    <div className="text-center py-16">
      <p className="text-gray-500 mb-4">{error || 'Deal not found'}</p>
      <button onClick={() => navigate('/deals')} className="text-violet-600 hover:underline">← Back to Deal Flow</button>
    </div>
  );

  const canInvite = isAdmin && (deal.status === 'active' || deal.status === 'scored');
  const pct = deal.progress_pct || 0;

  return (
    <div>
      <button onClick={() => navigate('/deals')} className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 mb-4 dark:text-gray-400">
        <ArrowLeft size={15} /> Back to Deal Flow
      </button>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{deal.project_name || `Deal #${deal.id}`}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${statusColors[deal.status]}`}>{deal.status}</span>
          </div>
          <p className="text-gray-600 dark:text-gray-400">{deal.project_sector || 'Deal Room'}</p>
        </div>
        <div className="flex items-center gap-2">
          {isInvestor && myInvite && myInvite.status === 'invited' && (
            <>
              <button onClick={() => respond('interested')} className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"><ThumbsUp size={14} /> Interested</button>
              <button onClick={() => respond('passed')} className="px-3 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 rounded-lg text-sm font-medium flex items-center gap-1 dark:border-gray-700 dark:text-gray-400"><ThumbsDown size={14} /> Pass</button>
            </>
          )}
          {isInvestor && myInvite && myInvite.status !== 'invited' && (
            <span className="text-xs text-gray-500 flex items-center gap-1"><Check size={13} /> You responded: {myInvite.status}</span>
          )}
          {canInvite && (
            <button onClick={() => setInviteOpen(true)} className="px-3 py-2 border border-violet-300 text-violet-700 hover:bg-violet-50 rounded-lg text-sm font-medium flex items-center gap-1 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/20"><Users size={14} /> Invite Investors</button>
          )}
          {isInvestor && (
            <button onClick={() => setCommitOpen(true)} className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"><DollarSign size={14} /> Commit Capital</button>
          )}
        </div>
      </div>

      {/* Progress banner */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex justify-between text-sm text-gray-500 mb-1">
          <span>Capital committed</span>
          <span>{fmtMoney(deal.capital_committed)} / {fmtMoney(deal.target_raise)} ({pct}%)</span>
        </div>
        <div className="w-full h-2.5 bg-gray-100 rounded-full dark:bg-gray-800">
          <div className="h-2.5 bg-violet-500 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-5">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-violet-600 text-violet-700 dark:text-violet-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab deal={deal} />}
      {tab === 'Documents' && <DocumentsTab dealId={deal.id} />}
      {tab === 'Commitments' && <CommitmentsTab dealId={deal.id} />}
      {tab === 'Activity' && <ActivityTab dealId={deal.id} />}

      {commitOpen && <CommitModal deal={deal} onClose={() => setCommitOpen(false)} onDone={() => { setCommitOpen(false); loadDeal(); setTab('Commitments'); }} />}
      {inviteOpen && <InviteModal dealId={deal.id} onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="py-2 border-b border-gray-50 dark:border-gray-800/60">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{value ?? '—'}</div>
    </div>
  );
}

function OverviewTab({ deal }) {
  return (
    <div className="grid md:grid-cols-2 gap-x-8 gap-y-1">
      {deal.description && (
        <div className="md:col-span-2 mb-2 text-sm text-gray-600 dark:text-gray-400">{deal.description}</div>
      )}
      <Field label="Target Raise" value={fmtMoney(deal.target_raise)} />
      <Field label="Capital Committed" value={fmtMoney(deal.capital_committed)} />
      <Field label="Minimum Check" value={fmtMoney(deal.minimum_check)} />
      <Field label="Valuation Cap" value={fmtMoney(deal.valuation_cap)} />
      <Field label="Instrument" value={deal.instrument} />
      <Field label="SPV Jurisdiction" value={deal.spv_jurisdiction} />
      <Field label="Carry" value={deal.carry_pct != null ? `${deal.carry_pct}%` : null} />
      <Field label="Management Fee" value={deal.management_fee_pct != null ? `${deal.management_fee_pct}%` : null} />
      <Field label="Closing Deadline" value={deal.closing_deadline} />
      <Field label="Lead Partner" value={deal.lead_partner_name} />
      <Field label="Days in Stage" value={`${deal.days_in_stage ?? 0} days`} />
      <Field label="Website" value={deal.website ? <a href={deal.website} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">{deal.website}</a> : null} />
    </div>
  );
}

function DocumentsTab({ dealId }) {
  const [docs, setDocs] = useState(null);
  useEffect(() => { api.dealDocuments(dealId).then(setDocs).catch(() => setDocs([])); }, [dealId]);
  return (
    <div>
      <div className="flex justify-end mb-3">
        <button type="button" onClick={() => api.downloadDataRoom(dealId).catch(() => alert('Failed to download data room'))}
          className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2">
          <Download size={15} /> Download Data Room
        </button>
      </div>
      {docs == null ? (
        <div className="text-center text-gray-500 py-8"><Loader2 className="animate-spin inline" size={16} /></div>
      ) : docs.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No documents yet</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50 dark:bg-gray-900 dark:border-gray-800 dark:divide-gray-800">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-3 p-3">
              <FileText size={16} className="text-gray-400" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{d.title}</div>
                <div className="text-xs text-gray-500 capitalize">{(d.doc_type || '').replace(/_/g, ' ')} · {d.status}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommitmentsTab({ dealId }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.dealCommitments(dealId).then(setItems).catch(() => setItems([])); }, [dealId]);
  if (items == null) return <div className="text-center text-gray-500 py-8"><Loader2 className="animate-spin inline" size={16} /></div>;
  if (items.length === 0) return <div className="text-center text-gray-500 py-8">No commitments recorded yet</div>;
  return (
    <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50 dark:bg-gray-900 dark:border-gray-800 dark:divide-gray-800">
      {items.map(c => (
        <div key={c.id} className="flex items-center justify-between p-3">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.investor_name || `Investor #${c.investor_user_id}`}</div>
            {c.notes && <div className="text-xs text-gray-500">{c.notes}</div>}
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(c.amount)}</div>
            <div className="text-xs text-gray-500 capitalize">{c.status}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ dealId }) {
  const [events, setEvents] = useState(null);
  useEffect(() => { api.dealActivity(dealId).then(setEvents).catch(() => setEvents([])); }, [dealId]);
  if (events == null) return <div className="text-center text-gray-500 py-8"><Loader2 className="animate-spin inline" size={16} /></div>;
  if (events.length === 0) return <div className="text-center text-gray-500 py-8">No activity yet</div>;
  return (
    <div className="space-y-3">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="mt-0.5 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center dark:bg-gray-800"><Clock size={13} className="text-gray-500" /></div>
          <div>
            <div className="text-sm text-gray-900 dark:text-gray-100">{e.label}</div>
            <div className="text-xs text-gray-400">{e.at ? new Date(e.at).toLocaleString() : ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CommitModal({ deal, onClose, onDone }) {
  const [amount, setAmount] = useState(deal.minimum_check || '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr('Enter a positive amount.'); return; }
    if (deal.minimum_check && amt < deal.minimum_check) { setErr(`Minimum check is ${fmtMoney(deal.minimum_check)}.`); return; }
    setSaving(true); setErr('');
    try {
      await api.createCommitment(deal.id, { amount: amt, notes: notes || null });
      onDone();
    } catch (e) { setErr(e.message || 'Could not record commitment'); reportError('CommitModal', e); }
    finally { setSaving(false); }
  };
  const input = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100';
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md dark:bg-gray-900">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Commit Capital</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-500">Committing to <span className="font-medium text-gray-800 dark:text-gray-200">{deal.project_name}</span>. This records your intent — no funds move.</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400">Amount (USD)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className={input} placeholder="50000" />
              {deal.minimum_check ? <div className="text-xs text-gray-400 mt-1">Minimum check: {fmtMoney(deal.minimum_check)}</div> : null}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400">Notes (optional)</label>
              <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={input} />
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
          </div>
          <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
            <button onClick={submit} disabled={saving} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />} Confirm Commitment
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function InviteModal({ dealId, onClose }) {
  const [investors, setInvestors] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('We think this deal is a strong fit for your thesis. Take a look and let us know if you\'re interested.');
  const [sendEmail, setSendEmail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => { api.dealInvestorOptions().then(l => setInvestors(Array.isArray(l) ? l : [])).catch(() => {}); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? investors.filter(i => (i.name || '').toLowerCase().includes(q) || (i.email || '').toLowerCase().includes(q)) : investors;
  }, [investors, search]);

  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    if (selected.size === 0) { setErr('Select at least one investor.'); return; }
    setSaving(true); setErr('');
    try {
      const r = await api.createDealInvitations(dealId, { investor_user_ids: [...selected], message, send_email: sendEmail });
      setDone(r.invited || selected.size);
    } catch (e) { setErr(e.message || 'Could not send invitations'); reportError('InviteModal', e); }
    finally { setSaving(false); }
  };

  const input = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100';

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8 dark:bg-gray-900">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Invite Investors</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
          </div>
          {done > 0 ? (
            <div className="p-8 text-center">
              <Check size={40} className="text-green-500 mx-auto mb-3" />
              <p className="text-gray-800 dark:text-gray-200 font-medium">Sent {done} invitation{done === 1 ? '' : 's'}.</p>
              <button onClick={onClose} className="mt-4 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">Done</button>
            </div>
          ) : (
            <>
              <div className="p-5 space-y-3">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search investors…" className={input} />
                <div className="max-h-56 overflow-y-auto border border-gray-100 rounded-lg dark:border-gray-800">
                  {filtered.length === 0 ? (
                    <div className="text-center text-sm text-gray-400 py-6">No investors found</div>
                  ) : filtered.map(i => (
                    <label key={i.id} className="flex items-center gap-3 p-2.5 hover:bg-gray-50 cursor-pointer dark:hover:bg-gray-800">
                      <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} className="accent-violet-600" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{i.name}</div>
                        <div className="text-xs text-gray-500 truncate">{i.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400">Message</label>
                  <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} className={input} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} className="accent-violet-600" />
                  Also send an email notification
                </label>
                {err && <div className="text-sm text-red-600">{err}</div>}
              </div>
              <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
                <span className="text-xs text-gray-500">{selected.size} selected</span>
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400">Cancel</button>
                  <button onClick={submit} disabled={saving} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send Invitations
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
