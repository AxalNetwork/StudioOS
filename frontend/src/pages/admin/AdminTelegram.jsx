import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Send, Plus, RefreshCw, Loader2, Trash2, Edit3, AlertTriangle, CheckCircle2,
  X, Eye, EyeOff, Wifi, Image as ImageIcon, Paperclip, Calendar, Sparkles,
  ExternalLink, ShieldAlert,
} from 'lucide-react';
import { adminTelegram as api } from '../../lib/api';
import { useToast } from '../../components/useToast';
import { useEscapeClose } from '../../hooks/useEscapeClose';

const AUDIENCES = ['public', 'founders', 'investors', 'mentors', 'partners', 'alumni'];
const TABS = [
  { id: 'channels', label: 'Channels' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'compose', label: 'Compose' },
  { id: 'history', label: 'History' },
];

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const DOC_MIME = ['application/pdf', 'text/csv', 'text/plain'];

function readFileAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(file);
  });
}

function statusBadge(status) {
  const styles = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    scheduled: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    sent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status] || styles.draft}`}>{status}</span>;
}

// ============================================================
// Channels Tab
// ============================================================
function ChannelsTab({ channels, refresh, toast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [testingId, setTestingId] = useState(null);

  const test = async (id) => {
    setTestingId(id);
    try {
      const res = await api.testChannel(id);
      toast.success(`Sent hello to channel (msg #${res.message_id})`);
      refresh();
    } catch (e) {
      const msg = e?.body?.message || e?.body?.code || e.message;
      toast.error(`Test failed: ${msg}`);
      refresh();
    } finally {
      setTestingId(null);
    }
  };

  const remove = async (ch) => {
    if (!confirm(`Delete channel "${ch.label}"? This is permanent.`)) return;
    try {
      await api.removeChannel(ch.id);
      toast.success('Channel removed');
      refresh();
    } catch (e) {
      toast.error(e?.body?.message || e?.body?.error || 'Delete failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600 dark:text-slate-400">
          Bot must already be added as ADMIN with "Post Messages" permission in each channel.
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700"
        >
          <Plus className="w-4 h-4" /> Add channel
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Label</th>
              <th className="px-3 py-2">Audience</th>
              <th className="px-3 py-2">Chat ID</th>
              <th className="px-3 py-2">Enabled</th>
              <th className="px-3 py-2">Last test</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No channels yet.</td></tr>
            )}
            {channels.map((ch) => (
              <ChannelRow key={ch.id} ch={ch} testingId={testingId} onTest={test} onRemove={remove} onSaved={refresh} toast={toast} />
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddChannelModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); }}
          toast={toast}
        />
      )}
    </div>
  );
}

function ChannelRow({ ch, testingId, onTest, onRemove, onSaved, toast }) {
  const [editingChat, setEditingChat] = useState(false);
  const [chatId, setChatId] = useState(ch.chat_id || '');
  const [editingSig, setEditingSig] = useState(false);
  const [signature, setSignature] = useState(ch.signature || '');
  const [busy, setBusy] = useState(false);

  const saveChat = async () => {
    setBusy(true);
    try {
      await api.updateChannel(ch.id, { chat_id: chatId.trim() || null });
      toast.success('Chat ID saved');
      setEditingChat(false);
      onSaved();
    } catch (e) {
      toast.error(e?.body?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveSignature = async () => {
    setBusy(true);
    try {
      await api.updateChannel(ch.id, { signature: signature.trim() || null });
      toast.success('Signature saved');
      setEditingSig(false);
      onSaved();
    } catch (e) {
      toast.error(e?.body?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async () => {
    try {
      await api.updateChannel(ch.id, { enabled: !ch.enabled });
      onSaved();
    } catch (e) {
      toast.error(e?.body?.message || 'Toggle failed');
    }
  };

  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td className="px-3 py-2 font-mono text-xs">{ch.slug}</td>
      <td className="px-3 py-2">
        {ch.label}
        {editingSig ? (
          <div className="flex items-center gap-1 mt-1">
            <input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Signed by (e.g. Guillaume Lauzier)"
              maxLength={100}
              className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 w-56"
            />
            <button onClick={saveSignature} disabled={busy} className="text-xs px-2 py-1 rounded bg-violet-600 text-white">Save</button>
            <button onClick={() => { setEditingSig(false); setSignature(ch.signature || ''); }} className="text-xs px-2 py-1">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setEditingSig(true)}
            className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5 hover:underline"
            title="Appended to every sent post (— Name)"
          >
            {ch.signature ? <>signed: <span className="italic">{ch.signature}</span></> : <span className="text-amber-700 dark:text-amber-400">+ add signature</span>}
          </button>
        )}
        {ch.last_error && (
          <div className="text-xs text-red-600 dark:text-red-400 mt-0.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {ch.last_error}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{ch.audience}</span>
        {ch.is_invite_only && <span className="ml-1 text-xs text-slate-500">private</span>}
      </td>
      <td className="px-3 py-2">
        {editingChat ? (
          <div className="flex items-center gap-1">
            <input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="@channel or -100..."
              className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
            />
            <button onClick={saveChat} disabled={busy} className="text-xs px-2 py-1 rounded bg-violet-600 text-white">Save</button>
            <button onClick={() => { setEditingChat(false); setChatId(ch.chat_id || ''); }} className="text-xs px-2 py-1">Cancel</button>
          </div>
        ) : ch.chat_id ? (
          <button onClick={() => setEditingChat(true)} className="font-mono text-xs hover:underline">{ch.chat_id}</button>
        ) : (
          <button onClick={() => setEditingChat(true)} className="text-xs text-amber-700 dark:text-amber-400 hover:underline">Set chat ID</button>
        )}
      </td>
      <td className="px-3 py-2">
        <button onClick={toggleEnabled} className="inline-flex items-center gap-1">
          {ch.enabled ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
        </button>
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">
        {ch.last_test_at ? new Date(ch.last_test_at).toLocaleString() : '—'}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex items-center gap-1">
          <button
            onClick={() => onTest(ch.id)}
            disabled={testingId === ch.id || !ch.chat_id}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
            title="Send hello probe"
          >
            {testingId === ch.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
            Test
          </button>
          <button
            onClick={() => onRemove(ch)}
            className="text-xs p-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            title="Remove"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddChannelModal({ onClose, onSaved, toast }) {
  useEscapeClose(onClose);
  const [form, setForm] = useState({ slug: '', label: '', audience: 'public', chat_id: '', signature: 'Guillaume Lauzier', is_invite_only: true });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createChannel({
        slug: form.slug.trim().toLowerCase(),
        label: form.label.trim(),
        audience: form.audience,
        chat_id: form.chat_id.trim() || null,
        signature: form.signature.trim() || null,
        is_invite_only: form.is_invite_only,
      });
      toast.success('Channel added');
      onSaved();
    } catch (e) {
      toast.error(e?.body?.message || e?.body?.error || 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-md w-full p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Add Telegram channel</h3>
          <button type="button" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <Field label="Slug" hint="lowercase, hyphens; stable identifier">
          <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required className={inputCls} />
        </Field>
        <Field label="Label">
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required className={inputCls} />
        </Field>
        <Field label="Audience">
          <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className={inputCls}>
            {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Chat ID (optional)" hint="@channel for public, -100... for private; can set later">
          <input value={form.chat_id} onChange={(e) => setForm({ ...form, chat_id: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Signature (optional)" hint="Appended to every sent post as &mdash; Name. Leave blank to send unsigned.">
          <input value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} maxLength={100} className={inputCls} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_invite_only} onChange={(e) => setForm({ ...form, is_invite_only: e.target.checked })} />
          Invite-only (private)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="px-3 py-1.5 rounded bg-violet-600 text-white text-sm">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls = 'w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800';

function Field({ label, hint, children }) {
  return (
    <label className="block text-sm">
      <div className="font-medium mb-1">{label}</div>
      {children}
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </label>
  );
}

// ============================================================
// Drafts Tab — aggregator queue + open drafts
// ============================================================
function DraftsTab({ channels, refresh, toast, onEdit }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState(7);
  const [running, setRunning] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listPosts({ status: 'draft', limit: 100 });
      setDrafts(res.posts || []);
    } catch (e) {
      toast.error(e?.body?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [toast.error]);

  useEffect(() => { reload(); }, [reload]);

  const runAgg = async () => {
    setRunning(true);
    try {
      const res = await api.runAggregator({ period_days: periodDays });
      toast.success(`Aggregator ran — drafted ${res.drafted.length} posts`);
      reload();
    } catch (e) {
      toast.error(e?.body?.message || 'Aggregator failed');
    } finally {
      setRunning(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this draft?')) return;
    try {
      await api.removePost(id);
      reload();
    } catch (e) {
      toast.error(e?.body?.message || 'Delete failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
        <Sparkles className="w-5 h-5 text-violet-600" />
        <div className="flex-1">
          <div className="text-sm font-medium">Aggregator</div>
          <div className="text-xs text-slate-500">Produces one draft per active audience from platform signals.</div>
        </div>
        <label className="text-xs text-slate-600 dark:text-slate-400">
          Period (days)
          <input
            type="number" min={1} max={90} value={periodDays}
            onChange={(e) => setPeriodDays(Math.max(1, Math.min(90, Number(e.target.value) || 7)))}
            className="ml-2 w-16 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
          />
        </label>
        <button
          onClick={runAgg}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Run aggregator
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-8 text-slate-500">No drafts. Run the aggregator or compose one.</div>
      ) : (
        <div className="space-y-2">
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} onEdit={() => onEdit(d.id)} onRemove={() => remove(d.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({ draft, onEdit, onRemove }) {
  return (
    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{draft.channel_label}</span>
            <span className="text-xs text-slate-500">{draft.audience}</span>
            {draft.source === 'aggregator' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                aggregator · {draft.source_kind}
              </span>
            )}
          </div>
          {draft.title && <div className="font-medium text-sm">{draft.title}</div>}
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-3 whitespace-pre-wrap font-mono">
            {draft.body_md}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="text-xs px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 inline-flex items-center gap-1">
            <Edit3 className="w-3 h-3" /> Open
          </button>
          <button onClick={onRemove} className="text-xs p-1.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Compose Tab — composer for a single draft
// ============================================================
function ComposeTab({ channels, toast, editingId, setEditingId, onSent }) {
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lintResult, setLintResult] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');

  // New-post form state (used when editingId is null).
  const [newForm, setNewForm] = useState({ channel_id: '', title: '', body_md: '' });

  const loadDraft = useCallback(async (id) => {
    setLoading(true);
    try {
      // Fetch by id directly. Previously we listed the latest 200 and
      // `.find()`d, which silently missed drafts beyond that window once
      // aggregator runs accumulated history — Open then rendered
      // "Draft not found" while the post existed.
      const res = await api.getPost(id);
      const found = res?.post || null;
      setPost(found);
      setLintResult(null);
      setOverrideReason('');
      setShowOverride(false);
      setScheduleAt(found?.scheduled_for || '');
    } catch (e) {
      setPost(null);
      toast.error(e?.body?.error || e?.body?.message || 'Load draft failed');
    } finally {
      setLoading(false);
    }
  }, [toast.error]);

  useEffect(() => {
    if (editingId) loadDraft(editingId);
    else setPost(null);
  }, [editingId, loadDraft]);

  const createNew = async () => {
    if (!newForm.channel_id || !newForm.body_md.trim()) {
      toast.error('Pick a channel and write a body');
      return;
    }
    setBusy(true);
    try {
      const res = await api.createPost({
        channel_id: Number(newForm.channel_id),
        title: newForm.title || null,
        body_md: newForm.body_md,
      });
      toast.success('Draft created');
      setEditingId(res.id);
      setNewForm({ channel_id: '', title: '', body_md: '' });
    } catch (e) {
      toast.error(e?.body?.message || 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = async () => {
    if (!post) return;
    setBusy(true);
    try {
      await api.updatePost(post.id, { title: post.title || null, body_md: post.body_md });
      toast.success('Saved');
      loadDraft(post.id);
    } catch (e) {
      toast.error(e?.body?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const runLint = async () => {
    if (!post) return;
    setBusy(true);
    try {
      await api.updatePost(post.id, { body_md: post.body_md });
      const res = await api.lintPost(post.id);
      setLintResult(res);
      if (res.ok) toast.success('Linter passed — no PII detected');
      else toast.error(`Linter flagged ${res.findings.length} issue(s)`);
    } catch (e) {
      toast.error(e?.body?.message || 'Lint failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadMedia = async (file) => {
    if (!file) return;
    if (![...PHOTO_MIME, ...DOC_MIME].includes(file.type)) {
      toast.error(`Unsupported file type: ${file.type}`);
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      toast.error(`File too large (max ${(MAX_MEDIA_BYTES / 1024 / 1024).toFixed(0)} MB)`);
      return;
    }
    setBusy(true);
    try {
      const dataUri = await readFileAsDataUri(file);
      await api.uploadMedia(post.id, dataUri);
      toast.success('Media attached');
      loadDraft(post.id);
    } catch (e) {
      toast.error(e?.body?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!post) return;
    if (lintResult && !lintResult.ok && !showOverride) {
      setShowOverride(true);
      return;
    }
    setBusy(true);
    try {
      await api.updatePost(post.id, { body_md: post.body_md, title: post.title || null });
      const opts = showOverride && overrideReason ? { override_reason: overrideReason } : {};
      const res = await api.sendPost(post.id, opts);
      toast.success(`Sent! Message ID ${res.message_id}`);
      setEditingId(null);
      onSent();
    } catch (e) {
      if (e?.body?.code === 'pii_linter_blocked') {
        setLintResult({ ok: false, findings: e.body.findings || [] });
        setShowOverride(true);
        toast.error('Linter blocked the send — provide an override reason.');
      } else {
        toast.error(e?.body?.message || e?.body?.code || 'Send failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    if (!post || !scheduleAt) return;
    setBusy(true);
    try {
      const iso = new Date(scheduleAt).toISOString();
      await api.schedulePost(post.id, iso);
      toast.success(`Scheduled for ${new Date(iso).toLocaleString()}`);
      loadDraft(post.id);
    } catch (e) {
      toast.error(e?.body?.message || 'Schedule failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;

  if (!editingId) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-slate-600 dark:text-slate-400">
          Compose a new draft. Pick a channel; you can edit and send from this same view.
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
          <Field label="Channel">
            <select value={newForm.channel_id} onChange={(e) => setNewForm({ ...newForm, channel_id: e.target.value })} className={inputCls}>
              <option value="">— pick one —</option>
              {channels.filter((c) => c.enabled).map((c) => (
                <option key={c.id} value={c.id}>{c.label} ({c.audience})</option>
              ))}
            </select>
          </Field>
          <Field label="Title (internal only)">
            <input value={newForm.title} onChange={(e) => setNewForm({ ...newForm, title: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Body (Telegram MarkdownV2)" hint="Special chars _ * [ ] ( ) ~ ` > # + - = | { } . ! must be escaped with \\">
            <textarea
              rows={10}
              value={newForm.body_md}
              onChange={(e) => setNewForm({ ...newForm, body_md: e.target.value })}
              className={`${inputCls} font-mono`}
              placeholder="*Headline*\n\nBody copy with escaped \\. punctuation."
            />
          </Field>
          <div className="flex justify-end">
            <button onClick={createNew} disabled={busy} className="px-4 py-1.5 rounded bg-violet-600 text-white text-sm hover:bg-violet-700">
              {busy ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!post) return <div className="text-center py-8 text-slate-500">Draft not found.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setEditingId(null)} className="text-sm text-slate-600 hover:underline">← Back</button>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">{post.channel_label}</span>
          {statusBadge(post.status)}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
        <Field label="Title (internal)">
          <input value={post.title || ''} onChange={(e) => setPost({ ...post, title: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Body (MarkdownV2)">
          <textarea
            rows={14}
            value={post.body_md}
            onChange={(e) => setPost({ ...post, body_md: e.target.value })}
            className={`${inputCls} font-mono`}
          />
          <div className="text-xs text-slate-500 mt-1">{post.body_md.length}/4000</div>
        </Field>

        {post.media_r2_key && (
          <div className="flex items-center gap-2 text-xs p-2 rounded bg-slate-50 dark:bg-slate-800">
            <Paperclip className="w-3 h-3" />
            <span className="font-mono truncate flex-1">{post.media_r2_key}</span>
            <span className="text-slate-500">{post.media_kind}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button onClick={saveEdits} disabled={busy} className="text-sm px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600">
            Save
          </button>
          <label className="text-sm px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 inline-flex items-center gap-1 cursor-pointer">
            <ImageIcon className="w-3 h-3" /> Attach
            <input
              type="file"
              hidden
              accept={[...PHOTO_MIME, ...DOC_MIME].join(',')}
              onChange={(e) => uploadMedia(e.target.files?.[0])}
            />
          </label>
          <button onClick={runLint} disabled={busy} className="text-sm px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 inline-flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> Lint
          </button>
          <div className="flex-1" />
          <input
            type="datetime-local"
            value={scheduleAt ? scheduleAt.slice(0, 16) : ''}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="text-sm px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
          />
          <button onClick={schedule} disabled={busy || !scheduleAt} className="text-sm px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Schedule
          </button>
          <button
            onClick={send}
            disabled={busy}
            className="text-sm px-4 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Send now
          </button>
        </div>
      </div>

      {lintResult && (
        <div className={`rounded-lg border p-3 ${
          lintResult.ok
            ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700'
            : 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700'
        }`}>
          <div className="font-medium text-sm flex items-center gap-2">
            {lintResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
            PII Linter: {lintResult.ok ? 'Passed' : `${lintResult.findings.length} finding(s)`}
          </div>
          {!lintResult.ok && (
            <ul className="mt-2 space-y-1 text-xs">
              {lintResult.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="font-mono px-1.5 py-0.5 rounded bg-white dark:bg-slate-800">{f.kind}</span>
                  <span className="text-slate-700 dark:text-slate-300 break-all">"{f.match}"</span>
                  {f.context && <span className="text-slate-500">— {f.context}</span>}
                </li>
              ))}
            </ul>
          )}
          {showOverride && (
            <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-700">
              <div className="text-xs font-medium mb-1">Override reason (min 8 chars — audited)</div>
              <textarea
                rows={2}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why is this safe to send despite the findings?"
                className={inputCls}
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={send}
                  disabled={busy || overrideReason.length < 8}
                  className="text-sm px-3 py-1.5 rounded bg-red-600 text-white disabled:opacity-50"
                >
                  Override and send
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// History Tab
// ============================================================
function HistoryTab({ toast }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listPosts({ status: 'sent', limit: LIMIT, offset });
      setPosts(res.posts || []);
      setTotal(res.total || 0);
    } catch (e) {
      toast.error(e?.body?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [offset, toast.error]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : posts.length === 0 ? (
        <div className="text-center py-8 text-slate-500">No sent posts yet.</div>
      ) : (
        posts.map((p) => (
          <div key={p.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{p.channel_label}</span>
              <span>{p.audience}</span>
              <span>·</span>
              <span>{new Date(p.sent_at).toLocaleString()}</span>
              {p.override_reason && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> override
                </span>
              )}
            </div>
            {p.title && <div className="font-medium text-sm">{p.title}</div>}
            <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-3 whitespace-pre-wrap font-mono">
              {p.body_md}
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs">
              {p.telegram_link ? (
                <a href={p.telegram_link} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> View on Telegram
                </a>
              ) : (
                <span className="text-slate-400">no public link</span>
              )}
              {p.body_hash && <span className="font-mono text-slate-400">hash {p.body_hash.slice(0, 12)}</span>}
            </div>
          </div>
        ))
      )}
      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} className="px-2 py-1 disabled:opacity-30">← Prev</button>
          <span className="text-slate-500">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
          <button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)} className="px-2 py-1 disabled:opacity-30">Next →</button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main page
// ============================================================
export default function AdminTelegram() {
  const [tab, setTab] = useState('channels');
  const [channels, setChannels] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const res = await api.listChannels();
      setChannels(res.channels || []);
    } catch (e) {
      toast.error(e?.body?.message || 'Load failed');
    }
  }, [toast.error]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Send className="w-6 h-6 text-violet-600" /> Telegram
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Manage the public @axalvc channel and the five invite-only cohort channels.
          All sends are admin-gated and audited; the PII linter blocks leaky drafts.
        </p>
      </header>

      <nav className="border-b border-slate-200 dark:border-slate-700 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.id
                ? 'border-violet-600 text-violet-700 dark:text-violet-300 font-medium'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'channels' && <ChannelsTab channels={channels} refresh={refresh} toast={toast} />}
      {tab === 'drafts' && (
        <DraftsTab
          channels={channels} refresh={refresh} toast={toast}
          onEdit={(id) => { setEditingId(id); setTab('compose'); }}
        />
      )}
      {tab === 'compose' && (
        <ComposeTab
          channels={channels} toast={toast}
          editingId={editingId} setEditingId={setEditingId}
          onSent={() => { setTab('history'); }}
        />
      )}
      {tab === 'history' && <HistoryTab toast={toast} />}
    </div>
  );
}
