/**
 * Task #4 — Admin X (Twitter) composer + accounts + aggregator.
 *
 * Twin of AdminTelegram. The PII linter is shared (server reuses
 * telegramRedactCheck.lintForSend with audience='public'); the wire
 * format is plain text (no MarkdownV2), the per-tweet ceiling is 280
 * chars and threading is supported.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Send, Plus, RefreshCw, Loader2, Trash2, Edit3, AlertTriangle, CheckCircle2,
  X as XIcon, Image as ImageIcon, Calendar, Sparkles, ExternalLink,
  ShieldAlert, Link2, Wifi, Undo2, Clock,
} from 'lucide-react';
import { adminX as api } from '../../lib/api';
import { useToast } from '../../components/useToast';
import { useEscapeClose } from '../../hooks/useEscapeClose';

const AUDIENCES = ['public', 'founders', 'investors', 'mentors', 'partners', 'alumni'];
const TABS = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'compose', label: 'Compose' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'history', label: 'History' },
  { id: 'aggregator', label: 'Aggregator' },
];

const MAX_BODY = 280;
const MAX_MEDIA = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

function countChars(s) {
  // Code-point count (matches the server's tweetLength()).
  let n = 0;
  for (const _ of String(s || '')) n++;
  return n;
}

function statusBadge(status) {
  const map = {
    draft: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
    scheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
    sending: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200',
    sent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
    retracted: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

async function fileToDataUri(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

// ----- Modals -----------------------------------------------------------

function OverrideModal({ findings, onClose, onConfirm }) {
  useEscapeClose(onClose);
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-lg w-full">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldAlert size={18} className="text-red-600" /> PII linter blocked the send
          </h3>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white">
            <XIcon size={18} />
          </button>
        </div>
        <div className="px-5 py-4">
          <ul className="text-sm space-y-1 mb-3 max-h-40 overflow-y-auto">
            {findings.map((f, i) => (
              <li key={i} className="text-red-700 dark:text-red-300">
                <span className="font-mono text-xs uppercase">{f.kind}</span> — {f.match}
              </li>
            ))}
          </ul>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Override reason (≥8 chars, audit-logged)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
            placeholder="Why is publishing safe despite the findings?"
          />
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded">Cancel</button>
          <button
            disabled={reason.trim().length < 8}
            onClick={() => onConfirm(reason.trim())}
            className="px-3 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-50"
          >
            Send anyway
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateAccountModal({ onClose, onCreated }) {
  useEscapeClose(onClose);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const out = await api.createAccount({ handle, display_name: displayName || null });
      onCreated(out);
    } catch (e) {
      setErr(e?.message || 'Failed to create account');
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white">Add X account</h3>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white"><XIcon size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Handle (no @)</label>
            <input value={handle} onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Display name (optional)</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
          </div>
          {err && <div className="text-sm text-red-600 dark:text-red-300">{err}</div>}
          <p className="text-xs text-gray-500 dark:text-gray-400">After creating, click "Authorise" to complete OAuth 2.0 PKCE on x.com.</p>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded">Cancel</button>
          <button disabled={busy || !handle} onClick={submit}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50 flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- X-style preview --------------------------------------------------

function XPreview({ handle, display, body, mediaPreviews }) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-900 max-w-md">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold">
          {(display || handle || 'X').slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm">
            <span className="font-bold text-gray-900 dark:text-white">{display || handle || 'Axal'}</span>{' '}
            <span className="text-gray-500 dark:text-gray-400">@{handle || 'axalvc'} · now</span>
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-gray-900 dark:text-white">
            {body || <span className="text-gray-400">Tweet preview…</span>}
          </div>
          {mediaPreviews && mediaPreviews.length > 0 && (
            <div className={`mt-2 grid gap-1 rounded-xl overflow-hidden ${mediaPreviews.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {mediaPreviews.map((src, i) => (
                <img key={i} src={src} alt={`media ${i + 1}`} className="w-full max-h-56 object-cover" />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----- Tabs -------------------------------------------------------------

function AccountsTab({ accounts, configOk, dailyCap, onReload, toast }) {
  const [showCreate, setShowCreate] = useState(false);

  const authorise = async (acc) => {
    try {
      const { url } = await api.oauthStart(acc.id);
      window.location.href = url;
    } catch (e) {
      toast(`Authorise failed: ${e?.message || e}`, 'error');
    }
  };
  const test = async (acc) => {
    try {
      const out = await api.testAccount(acc.id);
      toast(`Connected as @${out.me?.username}`, 'success');
      onReload();
    } catch (e) {
      toast(`Test failed: ${e?.message || e}`, 'error');
    }
  };
  const toggle = async (acc) => {
    await api.updateAccount(acc.id, { enabled: !acc.enabled });
    onReload();
  };
  const remove = async (acc) => {
    if (!confirm(`Delete @${acc.handle}? Only allowed when no sent posts attached.`)) return;
    try { await api.removeAccount(acc.id); toast('Deleted', 'success'); onReload(); }
    catch (e) { toast(`Delete failed: ${e?.message || e}`, 'error'); }
  };

  return (
    <div className="space-y-4">
      {!configOk && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle size={16} className="mt-0.5" />
          <div>
            <div className="font-medium">X OAuth not configured</div>
            X_CLIENT_ID / X_CLIENT_SECRET are not set on this worker. Provision via{' '}
            <code className="font-mono text-xs">wrangler secret put X_CLIENT_ID --env production</code>.
            Drafting + linting still work; sends will return <code>x_config_missing</code>.
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-300">
          Daily send cap (per account): <strong>{dailyCap}</strong>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white flex items-center gap-1">
          <Plus size={14} /> Add account
        </button>
      </div>
      <div className="grid gap-3">
        {accounts.map((a) => (
          <div key={a.id} className="border border-gray-200 dark:border-gray-700 rounded p-4 bg-white dark:bg-gray-900">
            {/* Mobile-first: stack info column on top of action row so the
                4 buttons get the full card width and don't get pushed off-
                screen by the handle/status block on narrow viewports. On
                sm+ we go back to the original side-by-side layout. */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0">
                <div className="text-base font-semibold text-gray-900 dark:text-white">
                  @{a.handle} {a.display_name && <span className="text-gray-500 dark:text-gray-400 font-normal">— {a.display_name}</span>}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>{a.enabled ? 'enabled' : 'disabled'}</span>
                  {a.x_user_id && <span>id={a.x_user_id}</span>}
                  {a.expires_at && <span>token exp {new Date(a.expires_at).toLocaleString()}</span>}
                  {a.last_test_at && <span>tested {new Date(a.last_test_at).toLocaleString()}</span>}
                </div>
                {a.last_error && (
                  <div className="text-xs text-red-600 dark:text-red-300 mt-1 break-words">last error: {a.last_error}</div>
                )}
              </div>
              {/* `flex-wrap` lets buttons drop to a 2nd row instead of
                  getting clipped. `min-h-[44px]` + `px-3 py-2` enforces
                  the iOS 44pt minimum tap target so taps reliably fire
                  on mobile Safari. */}
              <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                <button onClick={() => authorise(a)} className="min-h-[44px] px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded flex items-center gap-1 active:bg-gray-100 dark:active:bg-gray-800" title="OAuth PKCE">
                  <Link2 size={12} /> Authorise
                </button>
                <button onClick={() => test(a)} className="min-h-[44px] px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded flex items-center gap-1 active:bg-gray-100 dark:active:bg-gray-800" title="GET /users/me">
                  <Wifi size={12} /> Test
                </button>
                <button onClick={() => toggle(a)} className="min-h-[44px] px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded active:bg-gray-100 dark:active:bg-gray-800">
                  {a.enabled ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => remove(a)} className="min-h-[44px] px-3 py-2 text-xs border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 rounded active:bg-red-50 dark:active:bg-red-950/40">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="text-sm text-gray-500 dark:text-gray-400">No X accounts yet — add one to start authoring.</div>
        )}
      </div>
      {showCreate && (
        <CreateAccountModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); onReload(); }}
        />
      )}
    </div>
  );
}

function ComposeTab({ accounts, onSaved, toast }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [body, setBody] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [threadMode, setThreadMode] = useState(false);
  const [threadParts, setThreadParts] = useState(['']);  // additional tweets after head
  const [media, setMedia] = useState([]);  // array of { dataUri, name, alt }
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const headLen = countChars(body + (hashtags ? `\n\n${hashtags}` : ''));

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!IMAGE_MIME.includes(file.type)) { toast('Unsupported image type', 'error'); return; }
    if (file.size > MAX_IMAGE_BYTES) { toast(`Image too large (max ${(MAX_IMAGE_BYTES/1024/1024).toFixed(0)}MB)`, 'error'); return; }
    if (media.length >= MAX_MEDIA) { toast(`Max ${MAX_MEDIA} images`, 'error'); return; }
    const dataUri = await fileToDataUri(file);
    setMedia((m) => [...m, { dataUri, name: file.name, alt: '' }]);
  };

  const save = async () => {
    if (!accountId) { toast('Pick an account', 'error'); return; }
    if (!body.trim()) { toast('Body required', 'error'); return; }
    setBusy(true);
    try {
      const headBody = hashtags ? `${body.trim()}\n\n${hashtags.trim()}` : body.trim();
      if (countChars(headBody) > MAX_BODY) { toast(`Head tweet exceeds ${MAX_BODY} chars`, 'error'); return; }
      const head = await api.createPost({ account_id: Number(accountId), body: headBody, hashtags: hashtags || null });
      // Attach media to head.
      for (const m of media) await api.addMedia(head.id, m.dataUri, m.alt);
      // Thread children.
      if (threadMode) {
        for (const part of threadParts) {
          const t = String(part || '').trim();
          if (!t) continue;
          if (countChars(t) > MAX_BODY) { toast(`A thread tweet exceeds ${MAX_BODY} chars`, 'error'); break; }
          await api.createPost({ account_id: Number(accountId), body: t, thread_continuation_of: head.id });
        }
      }
      toast(`Draft #${head.id} saved`, 'success');
      setBody(''); setHashtags(''); setMedia([]); setThreadParts(['']); setThreadMode(false);
      onSaved();
    } catch (e) {
      toast(`Save failed: ${e?.message || e}`, 'error');
    } finally { setBusy(false); }
  };

  const account = accounts.find((a) => a.id === Number(accountId));
  const mediaPreviews = media.map((m) => m.dataUri);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Account</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>@{a.handle} {a.enabled ? '' : '(disabled)'}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Body</label>
            <span className={`text-xs ${headLen > MAX_BODY ? 'text-red-600' : headLen > MAX_BODY - 20 ? 'text-amber-600' : 'text-gray-500'}`}>
              {headLen}/{MAX_BODY}
            </span>
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
            placeholder="What's happening?"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Hashtags (appended to body, counted in length)
          </label>
          <input value={hashtags} onChange={(e) => setHashtags(e.target.value)}
            placeholder="#VentureStudio #Startups"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Media ({media.length}/{MAX_MEDIA})</label>
            <label className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded cursor-pointer flex items-center gap-1">
              <ImageIcon size={12} /> Add image
              <input type="file" accept={IMAGE_MIME.join(',')} className="hidden" onChange={onPickImage} />
            </label>
          </div>
          {media.length > 0 && (
            <div className="space-y-2">
              {media.map((m, i) => (
                <div key={i} className="flex items-start gap-2 border border-gray-200 dark:border-gray-700 rounded p-2">
                  <img src={m.dataUri} alt="" className="w-16 h-16 object-cover rounded" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{m.name}</div>
                    <input value={m.alt} onChange={(e) => setMedia((arr) => arr.map((x, j) => j === i ? { ...x, alt: e.target.value } : x))}
                      placeholder="Alt text (accessibility)"
                      className="mt-1 w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                  </div>
                  <button onClick={() => setMedia((arr) => arr.filter((_, j) => j !== i))}
                    className="text-red-600 hover:text-red-800"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Tip: save the draft first, then use "Auto alt-text" in the drafts list to caption images with Workers AI.
          </p>
        </div>
        <div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={threadMode} onChange={(e) => setThreadMode(e.target.checked)} />
            Thread mode
          </label>
          {threadMode && (
            <div className="mt-2 space-y-2">
              {threadParts.map((p, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500">Reply #{i + 1}</span>
                    <span className={`text-xs ${countChars(p) > MAX_BODY ? 'text-red-600' : 'text-gray-500'}`}>{countChars(p)}/{MAX_BODY}</span>
                  </div>
                  <textarea value={p} rows={3}
                    onChange={(e) => setThreadParts((arr) => arr.map((x, j) => j === i ? e.target.value : x))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono" />
                </div>
              ))}
              <button onClick={() => setThreadParts((arr) => [...arr, ''])}
                className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded flex items-center gap-1">
                <Plus size={12} /> Add another tweet
              </button>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button disabled={busy || !body.trim() || !accountId} onClick={save}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white disabled:opacity-50 flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />} Save draft
          </button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Preview</div>
        <XPreview
          handle={account?.handle}
          display={account?.display_name}
          body={hashtags ? `${body}\n\n${hashtags}` : body}
          mediaPreviews={mediaPreviews}
        />
        {threadMode && threadParts.some((p) => p.trim()) && (
          <div className="space-y-2 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
            {threadParts.filter((p) => p.trim()).map((p, i) => (
              <XPreview key={i} handle={account?.handle} display={account?.display_name} body={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PostsTab({ posts, accounts, onReload, toast, mode }) {
  const [busyId, setBusyId] = useState(null);
  const [overrideFor, setOverrideFor] = useState(null);  // { id, findings }
  const [editId, setEditId] = useState(null);
  const [editBody, setEditBody] = useState('');

  const send = async (id, override_reason) => {
    setBusyId(id);
    try {
      await api.sendPost(id, override_reason ? { override_reason } : {});
      toast('Sent', 'success');
      setOverrideFor(null);
      onReload();
    } catch (e) {
      if (e?.status === 422 || /pii_linter_blocked/.test(e?.message || '')) {
        const findings = e?.data?.findings || e?.body?.findings || [];
        setOverrideFor({ id, findings });
        return;
      }
      if (e?.status === 429 || /daily_cap_reached/.test(e?.message || '')) {
        toast('Daily send cap reached for this account', 'error');
        onReload();
        return;
      }
      toast(`Send failed: ${e?.message || e}`, 'error');
      onReload();
    } finally { setBusyId(null); }
  };

  const approve = async (id) => {
    try { await api.approvePost(id); toast('Approved', 'success'); onReload(); }
    catch (e) { toast(`Approve failed: ${e?.message || e}`, 'error'); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this draft?')) return;
    try { await api.removePost(id); toast('Deleted', 'success'); onReload(); }
    catch (e) { toast(`Delete failed: ${e?.message || e}`, 'error'); }
  };

  const retract = async (id) => {
    const reason = prompt('Retraction reason (audit-logged):', '');
    if (reason === null) return;
    try { await api.retractPost(id, reason); toast('Retracted on X', 'success'); onReload(); }
    catch (e) { toast(`Retract failed: ${e?.message || e}`, 'error'); }
  };

  const startEdit = (p) => { setEditId(p.id); setEditBody(p.body); };
  const saveEdit = async (id) => {
    try {
      if (countChars(editBody) > MAX_BODY) { toast(`Exceeds ${MAX_BODY} chars`, 'error'); return; }
      await api.updatePost(id, { body: editBody });
      setEditId(null);
      onReload();
    } catch (e) { toast(`Edit failed: ${e?.message || e}`, 'error'); }
  };

  const genAlt = async (id, idx) => {
    try {
      const out = await api.generateAltText(id, idx);
      toast(`Alt-text: ${out.alt_text.slice(0, 60)}…`, 'success');
      onReload();
    } catch (e) { toast(`Alt-text failed: ${e?.message || e}`, 'error'); }
  };

  return (
    <div className="space-y-3">
      {posts.map((p) => (
        <div key={p.id} className="border border-gray-200 dark:border-gray-700 rounded p-3 bg-white dark:bg-gray-900">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm">
              {statusBadge(p.status)}
              <span className="text-gray-600 dark:text-gray-300">@{p.handle}</span>
              {p.thread_continuation_of && <span className="text-xs text-indigo-600">↳ thread #{p.thread_position}</span>}
              {p.source === 'aggregator' && <span className="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200 rounded">aggregator · {p.source_kind}</span>}
              <span className="text-xs text-gray-500">{new Date(p.created_at).toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1">
              {p.tweet_link && (
                <a href={p.tweet_link} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded flex items-center gap-1">
                  <ExternalLink size={12} /> View
                </a>
              )}
              {mode === 'drafts' && (
                <>
                  {p.status === 'draft' && (
                    <button onClick={() => approve(p.id)} className="px-2 py-1 text-xs border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 rounded flex items-center gap-1">
                      <CheckCircle2 size={12} /> Approve
                    </button>
                  )}
                  {!p.thread_continuation_of && ['draft', 'approved', 'scheduled', 'failed'].includes(p.status) && (
                    <button disabled={busyId === p.id} onClick={() => send(p.id)}
                      className="px-2 py-1 text-xs rounded bg-blue-600 text-white disabled:opacity-50 flex items-center gap-1">
                      {busyId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send
                    </button>
                  )}
                  {!p.thread_continuation_of && ['draft', 'approved', 'scheduled', 'failed'].includes(p.status) && (
                    <button
                      onClick={async () => {
                        const def = p.scheduled_for
                          ? new Date(p.scheduled_for).toISOString().slice(0, 16)
                          : new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
                        const v = window.prompt('Schedule for (YYYY-MM-DDTHH:MM, local time):', def);
                        if (!v) return;
                        const iso = new Date(v).toISOString();
                        try {
                          await api.schedulePost(p.id, iso);
                          toast(`Scheduled for ${new Date(iso).toLocaleString()}`, 'success');
                          onReload();
                        } catch (e) {
                          toast(e?.message || 'Failed to schedule', 'error');
                        }
                      }}
                      className="px-2 py-1 text-xs border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 rounded flex items-center gap-1"
                    >
                      <Clock size={12} /> {p.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
                    </button>
                  )}
                  {p.status !== 'sent' && p.status !== 'sending' && (
                    <button onClick={() => startEdit(p)} className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded flex items-center gap-1">
                      <Edit3 size={12} /> Edit
                    </button>
                  )}
                  {p.status !== 'sent' && p.status !== 'sending' && (
                    <button onClick={() => remove(p.id)} className="px-2 py-1 text-xs border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 rounded">
                      <Trash2 size={12} />
                    </button>
                  )}
                </>
              )}
              {mode === 'history' && p.status === 'sent' && (
                <button onClick={() => retract(p.id)} className="px-2 py-1 text-xs border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 rounded flex items-center gap-1">
                  <Undo2 size={12} /> Retract
                </button>
              )}
            </div>
          </div>
          {editId === p.id ? (
            <div>
              <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={4}
                className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono" />
              <div className="flex justify-between mt-1 text-xs">
                <span className={countChars(editBody) > MAX_BODY ? 'text-red-600' : 'text-gray-500'}>{countChars(editBody)}/{MAX_BODY}</span>
                <div className="flex gap-2">
                  <button onClick={() => setEditId(null)} className="px-2 py-0.5 border border-gray-300 dark:border-gray-600 rounded">Cancel</button>
                  <button onClick={() => saveEdit(p.id)} className="px-2 py-0.5 bg-blue-600 text-white rounded">Save</button>
                </div>
              </div>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm font-mono text-gray-800 dark:text-gray-200">{p.body}</pre>
          )}
          {p.media_r2_keys?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {p.media_r2_keys.map((k, i) => (
                <div key={i} className="border border-gray-200 dark:border-gray-700 rounded px-2 py-1 flex items-center gap-2">
                  <ImageIcon size={12} />
                  <span className="font-mono text-gray-500 truncate max-w-[200px]">{k.split('/').pop()}</span>
                  {!p.alt_texts?.[i] && (
                    <button onClick={() => genAlt(p.id, i)} className="text-purple-600 dark:text-purple-300 flex items-center gap-1" title="Generate alt-text via Workers AI">
                      <Sparkles size={12} /> Alt
                    </button>
                  )}
                  {p.alt_texts?.[i] && <span className="text-gray-500 italic truncate max-w-[280px]">"{p.alt_texts[i]}"</span>}
                </div>
              ))}
            </div>
          )}
          {p.send_error && <div className="mt-2 text-xs text-red-600 dark:text-red-300">error: {p.send_error}</div>}
          {p.override_reason && <div className="mt-2 text-xs text-amber-600 dark:text-amber-300">override: {p.override_reason}</div>}
        </div>
      ))}
      {posts.length === 0 && <div className="text-sm text-gray-500 dark:text-gray-400">No posts.</div>}
      {overrideFor && (
        <OverrideModal
          findings={overrideFor.findings}
          onClose={() => setOverrideFor(null)}
          onConfirm={(reason) => send(overrideFor.id, reason)}
        />
      )}
    </div>
  );
}

function AggregatorTab({ accounts, onReload, toast }) {
  const [periodDays, setPeriodDays] = useState(7);
  const [kind, setKind] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [drafts, setDrafts] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const preview = async () => {
    setBusy(true);
    try {
      const out = await api.previewAggregator({ period_days: periodDays, kind: kind || undefined });
      setDrafts(out.drafts || []);
    } catch (e) { toast(`Preview failed: ${e?.message || e}`, 'error'); }
    finally { setBusy(false); }
  };

  const run = async () => {
    if (!accountId) { toast('Pick an account', 'error'); return; }
    if (!confirm(`Persist ${drafts.length || 'all'} per-audience drafts as x_posts rows for @${accounts.find(a => a.id === Number(accountId))?.handle}?`)) return;
    setBusy(true);
    try {
      const out = await api.runAggregator({ account_id: Number(accountId), period_days: periodDays });
      toast(`Drafted ${out.drafted?.length || 0} threads`, 'success');
      onReload();
    } catch (e) { toast(`Run failed: ${e?.message || e}`, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Period (days)</label>
          <input type="number" min="1" max="90" value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value) || 7)}
            className="w-24 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Audience</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
            <option value="">All</option>
            {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Persist to account</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
            {accounts.map((a) => <option key={a.id} value={a.id}>@{a.handle}</option>)}
          </select>
        </div>
        <button disabled={busy} onClick={preview} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded flex items-center gap-1">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Preview
        </button>
        <button disabled={busy || drafts.length === 0} onClick={run} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded flex items-center gap-1 disabled:opacity-50">
          <Calendar size={12} /> Persist as drafts
        </button>
      </div>
      <div className="space-y-3">
        {drafts.map((d, i) => (
          <div key={i} className="border border-gray-200 dark:border-gray-700 rounded p-3 bg-white dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm mb-2">
              <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 text-xs">{d.audience}</span>
              <span className="text-gray-500">{d.kind}</span>
              {d.thread.length > 1 && <span className="text-xs text-amber-600">thread × {d.thread.length}</span>}
              {d.needs_media && <span className="text-xs text-purple-600">+media suggested</span>}
            </div>
            <div className="space-y-2">
              {d.thread.map((t, j) => (
                <pre key={j} className="whitespace-pre-wrap text-sm font-mono p-2 bg-gray-50 dark:bg-gray-800 rounded text-gray-800 dark:text-gray-200">{t}</pre>
              ))}
            </div>
          </div>
        ))}
        {drafts.length === 0 && <div className="text-sm text-gray-500 dark:text-gray-400">Click Preview to see audience-by-audience drafts.</div>}
      </div>
    </div>
  );
}

// ----- Page root --------------------------------------------------------

export default function AdminX() {
  const [tab, setTab] = useState('accounts');
  const [accounts, setAccounts] = useState([]);
  const [configOk, setConfigOk] = useState(true);
  const [dailyCap, setDailyCap] = useState(20);
  const [posts, setPosts] = useState([]);
  const [historyPosts, setHistoryPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const { toast, Toast } = useToast();

  const loadAccounts = useCallback(async () => {
    try {
      const out = await api.listAccounts();
      setAccounts(out.accounts || []);
      setConfigOk(!!out.config_ok);
      setDailyCap(Number(out.daily_cap || 20));
    } catch (e) { toast(`Load accounts failed: ${e?.message || e}`, 'error'); }
  }, [toast]);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      // Drafts tab must surface every still-manageable state — scheduled +
      // approved + failed all need to remain visible so Reschedule/Send/Edit
      // stay reachable after the first state transition.
      const [d, h] = await Promise.all([
        api.listPosts({ status: 'draft,approved,scheduled,failed', limit: 100 }),
        api.listPosts({ status: 'sent', limit: 50 }),
      ]);
      setPosts(d.posts || []);
      setHistoryPosts(h.posts || []);
    } catch (e) { toast(`Load posts failed: ${e?.message || e}`, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadAccounts(); loadPosts(); }, [loadAccounts, loadPosts]);

  // Surface ?x_oauth_linked / ?x_oauth_error from the callback redirect.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('x_oauth_linked')) {
      toast(`X account #${sp.get('x_oauth_linked')} authorised`, 'success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (sp.get('x_oauth_error')) {
      toast(`OAuth failed: ${sp.get('x_oauth_error')}`, 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [toast]);

  const reload = useCallback(() => { loadAccounts(); loadPosts(); }, [loadAccounts, loadPosts]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">X (Twitter) broadcaster</h1>
        <button onClick={reload} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded flex items-center gap-1">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>
      <div className="border-b border-gray-200 dark:border-gray-700 mb-4">
        <nav className="flex gap-1 -mb-px">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm border-b-2 ${tab === t.id ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-600 dark:text-gray-300 hover:text-gray-900'}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {tab === 'accounts' && (
        <AccountsTab accounts={accounts} configOk={configOk} dailyCap={dailyCap} onReload={loadAccounts} toast={toast} />
      )}
      {tab === 'compose' && (
        <ComposeTab accounts={accounts.filter((a) => a.enabled)} onSaved={loadPosts} toast={toast} />
      )}
      {tab === 'drafts' && (
        <PostsTab posts={posts} accounts={accounts} onReload={loadPosts} toast={toast} mode="drafts" />
      )}
      {tab === 'history' && (
        <PostsTab posts={historyPosts} accounts={accounts} onReload={loadPosts} toast={toast} mode="history" />
      )}
      {tab === 'aggregator' && (
        <AggregatorTab accounts={accounts.filter((a) => a.enabled)} onReload={loadPosts} toast={toast} />
      )}
      {Toast}
    </div>
  );
}
