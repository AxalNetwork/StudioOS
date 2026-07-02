import React, { useEffect, useState } from 'react';
import { Users, Plus, RefreshCw, X, Send, ArrowUpRight, CheckSquare, Square } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';

const AUDIENCES = ['customer', 'investor', 'partner', 'advisor', 'mentor', 'cofounder'];
const STATUSES = ['new', 'invited', 'contacted', 'replied', 'qualified', 'active', 'passed'];
const ROUTED_LABEL = { discovery: 'Customer Discovery', raise: 'Raise pipeline', network: 'Network' };
const STATUS_BADGE = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  invited: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  contacted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  replied: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  qualified: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  passed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export default function ContactsPage() {
  useAuth();
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [audience, setAudience] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(null); // detail (full object from contactGet)
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ project_id: '', email: '', name: '', audience: 'customer', invite: false, message: '' });

  const load = () => {
    setLoading(true);
    api.contactsList({ audience: audience || undefined })
      .then((res) => { setItems(res?.items || []); setCounts(res?.counts || {}); })
      .catch((e) => setErr(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [audience]);

  const openDetail = async (uid) => {
    setErr(null);
    try { setOpen(await api.contactGet(uid)); }
    catch (e) { setErr(e.message); }
  };
  const refreshDetail = async () => { if (open) setOpen(await api.contactGet(open.uid)); };

  const onCreate = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null); setNotice(null);
    try {
      const payload = { project_id: Number(form.project_id), email: form.email, name: form.name || undefined, audience: form.audience };
      if (form.invite) {
        if (form.message) payload.message = form.message;
        const res = await api.contactInvite(payload);
        if (res && res.email_sent === false) {
          setErr(`Contact added, but the invite email couldn't be sent${res.email_error ? `: ${res.email_error}` : '.'}`);
        } else {
          setNotice(`Invitation email sent to ${form.email}.`);
        }
      } else {
        await api.contactCreate(payload);
      }
      setCreating(false);
      setForm({ project_id: '', email: '', name: '', audience: 'customer', invite: false, message: '' });
      load();
    } catch (e2) { setErr(e2.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const setStatus = async (uid, status) => {
    setBusy(true);
    try { await api.contactUpdate(uid, { status }); await refreshDetail(); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const promote = async (uid) => {
    setBusy(true); setErr(null);
    try { await api.contactPromote(uid); await refreshDetail(); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Users size={22} /> Contacts
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Every landing-page signup and invite in one inbox — routed to the right workflow, with status and follow-ups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-500 hover:text-gray-800" title="Refresh"><RefreshCw size={16} /></button>
          <button onClick={() => setCreating((v) => !v)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm">
            {creating ? <X size={14} /> : <Plus size={14} />} {creating ? 'Cancel' : 'Add / Invite'}
          </button>
        </div>
      </div>

      {err && <div className="mb-4 px-4 py-2 bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 rounded-lg text-sm">{err}</div>}
      {notice && <div className="mb-4 px-4 py-2 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 rounded-lg text-sm">{notice}</div>}

      {creating && (
        <form onSubmit={onCreate} className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <input value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} placeholder="Project ID" inputMode="numeric" required
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" required
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (optional)"
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
            <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm">
              {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 mb-3">
            <input type="checkbox" checked={form.invite} onChange={(e) => setForm({ ...form, invite: e.target.checked })} />
            Send as invitation (emails the contact & marks status “invited”)
          </label>
          {form.invite && (
            <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Optional personal message (included in the invite email)" rows={3}
              className="w-full px-3 py-2 mb-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
          )}
          <button disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm">
            {form.invite ? <Send size={14} /> : <Plus size={14} />} {busy ? 'Saving…' : form.invite ? 'Send invite' : 'Add contact'}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setAudience('')} className={`px-3 py-1 rounded-full text-xs ${audience === '' ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>All</button>
        {AUDIENCES.map((a) => (
          <button key={a} onClick={() => setAudience(a)} className={`px-3 py-1 rounded-full text-xs capitalize ${audience === a ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
            {a}{counts[a] ? ` (${counts[a]})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-16">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 text-center py-16">No contacts yet. Landing-page signups will appear here.</div>
      ) : (
        <div className="space-y-2">
          {items.map((ct) => (
            <button key={ct.uid} onClick={() => openDetail(ct.uid)}
              className="w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-violet-400 transition">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{ct.name || ct.email}</div>
                  <div className="text-xs text-gray-500 truncate">
                    <span className="capitalize">{ct.audience}</span> · → {ROUTED_LABEL[ct.routed_to] || ct.routed_to}{ct.cta ? ` · ${ct.cta}` : ''}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs shrink-0 ${STATUS_BADGE[ct.status] || ''}`}>{ct.status}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && <ContactDrawer contact={open} busy={busy} onClose={() => setOpen(null)} onStatus={setStatus} onPromote={promote} onChanged={() => { refreshDetail(); load(); }} setErr={setErr} />}
    </div>
  );
}

function ContactDrawer({ contact, busy, onClose, onStatus, onPromote, onChanged, setErr }) {
  const [reply, setReply] = useState('');
  const [task, setTask] = useState('');
  const canPromote = contact.audience === 'customer' || contact.audience === 'investor';

  const sendReply = async () => {
    if (!reply.trim()) return;
    try { await api.contactReply(contact.uid, { direction: 'outbound', body: reply }); setReply(''); onChanged(); }
    catch (e) { setErr(e.message); }
  };
  const addTask = async () => {
    if (!task.trim()) return;
    try { await api.contactAddTask(contact.uid, { title: task }); setTask(''); onChanged(); }
    catch (e) { setErr(e.message); }
  };
  const toggle = async (taskId) => {
    try { await api.contactToggleTask(contact.uid, taskId); onChanged(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 h-full p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{contact.name || contact.email}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800"><X size={18} /></button>
        </div>
        <div className="text-sm text-gray-500 mb-4">
          {contact.email} · <span className="capitalize">{contact.audience}</span> · → {ROUTED_LABEL[contact.routed_to] || contact.routed_to}
          {contact.promoted_to ? ` · promoted to ${contact.promoted_to}` : ''}
        </div>

        {/* Status */}
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1">Status</div>
          <select value={contact.status} onChange={(e) => onStatus(contact.uid, e.target.value)} disabled={busy}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm w-full">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {canPromote && (
          <button onClick={() => onPromote(contact.uid)} disabled={busy}
            className="mb-4 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm">
            <ArrowUpRight size={14} /> Promote to {contact.audience === 'customer' ? 'Customer Discovery' : 'Raise pipeline'}
          </button>
        )}

        {contact.message && <p className="mb-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap border-l-2 border-gray-200 dark:border-gray-700 pl-3">{contact.message}</p>}

        {/* Tasks */}
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Follow-ups</h3>
        <div className="flex gap-2 mb-2">
          <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add a follow-up…"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
          <button onClick={addTask} className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg text-sm">Add</button>
        </div>
        <ul className="mb-6">
          {(contact.tasks || []).map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-1 text-sm">
              <button onClick={() => toggle(t.id)} className="text-gray-500 hover:text-gray-800">
                {t.done ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>
              <span className={t.done ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}>{t.title}</span>
              {t.due_date && <span className="text-xs text-gray-400 ml-auto">{t.due_date}</span>}
            </li>
          ))}
          {(contact.tasks || []).length === 0 && <li className="text-sm text-gray-500 py-1">No follow-ups.</li>}
        </ul>

        {/* Replies */}
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Conversation</h3>
        <ul className="mb-2 space-y-2">
          {(contact.replies || []).map((rp) => (
            <li key={rp.id} className={`text-sm p-2 rounded-lg ${rp.direction === 'outbound' ? 'bg-violet-50 dark:bg-violet-900/20 ml-6' : 'bg-gray-50 dark:bg-gray-800 mr-6'}`}>
              <div className="text-[11px] text-gray-400 mb-0.5">{rp.direction}</div>
              {rp.body}
            </li>
          ))}
          {(contact.replies || []).length === 0 && <li className="text-sm text-gray-500">No messages logged.</li>}
        </ul>
        <div className="flex gap-2">
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Log a reply you sent…"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
          <button onClick={sendReply} className="inline-flex items-center gap-1 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm"><Send size={14} /></button>
        </div>
      </div>
    </div>
  );
}
