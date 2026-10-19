import React, { useCallback, useEffect, useState } from 'react';
import {
  FileText, RefreshCw, Loader2, MessageSquare, CheckCircle2,
  XCircle, Edit3, Globe, RotateCcw, Eye, Clock,
} from 'lucide-react';
import { adminArticles as api } from '../../lib/api';
import { useToast } from '../../components/useToast';
import ToastMessage from '../../components/ToastMessage';
import { reportError } from '../../lib/log';
import { localInputValue, publishAtFromLocal, utcLabel } from './articlePublishAt';
import ReviewComments from '../../components/hqReview/ReviewComments';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { RailFrame, WorkerRail } from '../../ui';
import useRecordCrumb from './useRecordCrumb';

// Admin /admin/articles review queue — the single "Content Queue" (Task #3
// merged the former News + Articles admin queues). /admin/news redirects here.

const STATUS_TABS = [
  { id: '', label: 'All open' },
  { id: 'submitted', label: 'New submissions' },
  { id: 'in_review', label: 'In review' },
  { id: 'changes_requested', label: 'Changes requested' },
  { id: 'approved', label: 'Ready to publish' },
  { id: 'published', label: 'Published' },
  { id: 'rejected', label: 'Rejected' },
];

/**
 * D484 — the time an approved article goes out. Set, it is published by the
 * per-minute cron once the time passes; cleared, it waits for Publish, as
 * before. The input is read in this browser's zone and stored as UTC, and the
 * stored time is shown in both, so admins in two zones agree on it.
 */
export function PublishAtControl({ article, busy, onSet, onClear }) {
  const [value, setValue] = useState(() => localInputValue(article.publish_at));
  const next = publishAtFromLocal(value);
  const stored = utcLabel(article.publish_at);
  return (
    <div className="mt-2 w-full rounded border border-slate-200 p-2 text-xs dark:border-slate-700" data-testid="article-publish-at">
      <p className="flex items-center gap-1 text-slate-700 dark:text-slate-200" data-testid="article-publish-at-state">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {stored
          ? <>Goes out {new Date(article.publish_at).toLocaleString()} your time ({stored}), checked every minute.</>
          : <>No publish time set: it waits for Publish. Set one to have it go out on its own.</>}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span>Publish at</span>
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 dark:border-slate-600 dark:bg-slate-900"
            aria-label="Publish at, in your time zone"
          />
        </label>
        <button
          type="button"
          disabled={busy || !next}
          onClick={() => onSet(next)}
          className="rounded bg-violet-700 px-2 py-1 text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {stored ? 'Move time' : 'Set time'}
        </button>
        {stored && (
          <button
            type="button"
            disabled={busy}
            onClick={onClear}
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Clear time
          </button>
        )}
      </div>
    </div>
  );
}

function statusBadge(s) {
  const map = {
    draft: 'bg-slate-100 text-slate-700',
    submitted: 'bg-blue-100 text-blue-800',
    in_review: 'bg-amber-100 text-amber-800',
    changes_requested: 'bg-orange-100 text-orange-800',
    approved: 'bg-emerald-100 text-emerald-800',
    published: 'bg-emerald-200 text-emerald-900',
    rejected: 'bg-red-100 text-red-700',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${map[s] || map.draft}`}>{s.replace('_', ' ')}</span>;
}

function PromptModal({ title, placeholder, onConfirm, onCancel, confirmLabel = 'Confirm', confirmClass = 'bg-violet-600' }) {
  const [text, setText] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white dark:bg-slate-900 p-6 rounded-lg max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-3">{title}</h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          rows={5}
          autoFocus
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-950 text-sm"
        />
        <div className="text-xs text-slate-500 mt-1">Minimum 8 characters. Sent to the author.</div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded">Cancel</button>
          <button
            disabled={text.trim().length < 8}
            onClick={() => onConfirm(text.trim())}
            className={`px-3 py-1.5 text-sm text-white rounded disabled:opacity-50 ${confirmClass}`}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function ArticlesQueuePage() {
  const { toast: current, showToast, dismissToast } = useToast();
  const toast = {
    error: (m) => showToast({ kind: 'error', msg: m }),
    success: (m) => showToast({ kind: 'success', msg: m }),
  };
  const superAdmin = isSuperAdminUser(useAuth()?.user);
  const [tab, setTab] = useState('submitted');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  // D634 — a failed article read is Unreadable, not "Select an article".
  const [detailFailed, setDetailFailed] = useState(false);
  // D775 (#2101): the article under review is the rail's record.
  useRecordCrumb(detail?.article?.title, 'article', detail?.article?.id);
  const [newComment, setNewComment] = useState('');
  const [prompt, setPrompt] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.queue({ status: tab || undefined });
      setItems(r.items || []);
    } catch (e) {
      reportError('AdminArticles:queue', e);
      toast.error('Load failed');
    } finally {
      setLoading(false);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetail = useCallback(async (id) => {
    setDetailFailed(false);
    try {
      const r = await api.get(id);
      setDetail(r);
    } catch (e) {
      reportError('AdminArticles:detail', e);
      setDetail(null);
      setDetailFailed(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  const action = async (fn, successMsg) => {
    setBusy(true);
    try {
      await fn();
      if (selectedId) await loadDetail(selectedId);
      await refresh();
      toast.success(successMsg);
    } catch (e) {
      reportError('AdminArticles:action', e);
      // D258 — `e.message` is the refusal's sentence, or its code when the
      // route sends only a code (every admin_articles.ts refusal does today).
      // This read `e.body.error`, which nothing sets, so it always said
      // "Action failed".
      toast.error(e?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const startReview = (id) => action(() => api.startReview(id), 'Started review');
  const approve = (id) => action(() => api.approve(id), 'Approved');
  const publish = (id) => action(() => api.publish(id), 'Published');
  const schedule = (id, publishAt) => action(() => api.schedule(id, publishAt), publishAt ? 'Publish time set' : 'Publish time cleared');
  const unpublish = (id) => { if (!window.confirm('Unpublish this article?')) return; action(() => api.unpublish(id), 'Unpublished'); };
  const requestChanges = (id) => setPrompt({
    title: 'Request changes', placeholder: 'Describe what to change…',
    confirmLabel: 'Send request', confirmClass: 'bg-orange-600',
    onConfirm: (reason) => { setPrompt(null); action(() => api.requestChanges(id, reason), 'Changes requested'); },
  });
  const reject = (id) => setPrompt({
    title: 'Reject article', placeholder: 'Reason for rejection…',
    confirmLabel: 'Reject', confirmClass: 'bg-red-600',
    onConfirm: (reason) => { setPrompt(null); action(() => api.reject(id, reason), 'Rejected'); },
  });

  const addComment = async () => {
    if (!detail || !newComment.trim()) return;
    try {
      await api.addComment(detail.article.id, newComment.trim());
      setNewComment('');
      await loadDetail(detail.article.id);
    } catch (e) {
      reportError('AdminArticles:comment', e);
      toast.error('Comment failed');
    }
  };

  const toggleResolve = async (cid, resolved) => {
    try {
      await api.resolveComment(cid, !resolved);
      await loadDetail(detail.article.id);
    } catch (e) {
      reportError('AdminArticles:resolve', e);
      toast.error(e?.message || 'The comment was not updated.');
    }
  };

  // D634 — sent only from the comment's confirmation. A refusal is thrown
  // back so the comment prints the route's sentence beside the button.
  const deleteComment = async (cid) => {
    await api.deleteComment(cid);
    await loadDetail(detail.article.id);
    toast.success('Comment deleted');
  };

  // D775 (#2101): H19 drew no rail. A plain admin reviews here too, so the rail takes the viewer's tier, as ContractsDesk does.
  const railProps = { note: 'Eadwyn reads the queue on this page. Approving, rejecting and scheduling stay yours.' };
  const rail = superAdmin ? <WorkerRail {...railProps} workspace="Content queue" role="super_admin" data-testid="hq-content-queue-rail" /> : <WorkerRail {...railProps} workspace="Content queue" role="admin" data-testid="admin-content-queue-rail" />;

  return (
    <RailFrame rail={rail} data-testid="content-queue-page">
    <div className="max-w-7xl mx-auto p-6">
      <ToastMessage toast={current} onDismiss={dismissToast} />
      <header className="mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="w-6 h-6 text-violet-600" /> Content review queue
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Review author-proposed articles. Approve → Publish bursts the 60-day edge cache.
        </p>
      </header>

      <div className="flex gap-2 mb-4 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSelectedId(null); }}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 ${tab === t.id ? 'border-violet-600 text-violet-700 dark:text-violet-300' : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
          >{t.label}</button>
        ))}
        <button onClick={refresh} className="ml-auto p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">Nothing here.</div>
          ) : (
            <ul>
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    onClick={() => setSelectedId(it.id)}
                    className={`w-full text-left px-3 py-2 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 ${selectedId === it.id ? 'bg-violet-50 dark:bg-violet-900/20' : ''}`}
                  >
                    <div className="flex justify-between gap-2">
                      <div className="font-medium text-sm truncate">{it.title}</div>
                      {statusBadge(it.status)}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {it.author_name || it.author_email} · {it.word_count}w · {new Date(it.submitted_at || it.updated_at).toLocaleString()}
                    </div>
                    {it.reviewer_name && <div className="text-xs text-amber-700 dark:text-amber-300">Reviewer: {it.reviewer_name}</div>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-2">
          {!detail && selectedId && detailFailed ? (
            <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 rounded p-6 text-center text-sm text-red-700 dark:text-red-300" role="alert" data-testid="hq-article-unreadable">
              Unreadable. The article and its review comments could not be read just now.{' '}
              <button type="button" onClick={() => loadDetail(selectedId)} className="font-semibold underline">Try again</button>
            </div>
          ) : !detail ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-6 text-center text-slate-500">
              {selectedId ? 'Loading the article…' : 'Select an article to review.'}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold">{detail.article.title}</h2>
                    {detail.article.subtitle && <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{detail.article.subtitle}</p>}
                    <div className="text-xs text-slate-500 mt-2 flex items-center gap-2 flex-wrap">
                      {statusBadge(detail.article.status)}
                      <span>by {detail.article.author_name || detail.article.author_email}</span>
                      <span>· {detail.article.word_count} words · ~{detail.article.read_minutes} min</span>
                      {detail.article.sector && <span>· {detail.article.sector}</span>}
                      {(detail.article.tags || []).map((t) => (
                        <span key={t} className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  {detail.article.status === 'submitted' && (
                    <button disabled={busy} onClick={() => startReview(detail.article.id)} className="text-sm px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1">
                      <Eye className="w-4 h-4" /> Start review
                    </button>
                  )}
                  {['in_review', 'submitted'].includes(detail.article.status) && (
                    <>
                      <button disabled={busy} onClick={() => requestChanges(detail.article.id)} className="text-sm px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 flex items-center gap-1">
                        <Edit3 className="w-4 h-4" /> Request changes
                      </button>
                      <button disabled={busy} onClick={() => approve(detail.article.id)} className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </button>
                      <button disabled={busy} onClick={() => reject(detail.article.id)} className="text-sm px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-1">
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                    </>
                  )}
                  {detail.article.status === 'approved' && (
                    <button disabled={busy} onClick={() => publish(detail.article.id)} className="text-sm px-3 py-1.5 bg-violet-700 text-white rounded hover:bg-violet-800 disabled:opacity-50 flex items-center gap-1">
                      <Globe className="w-4 h-4" /> Publish
                    </button>
                  )}
                  {detail.article.status === 'approved' && (
                    <PublishAtControl
                      key={`${detail.article.id}:${detail.article.publish_at || ''}`}
                      article={detail.article}
                      busy={busy}
                      onSet={(at) => schedule(detail.article.id, at)}
                      onClear={() => schedule(detail.article.id, null)}
                    />
                  )}
                  {detail.article.status === 'published' && (
                    <button disabled={busy} onClick={() => unpublish(detail.article.id)} className="text-sm px-3 py-1.5 border border-orange-300 text-orange-700 dark:text-orange-300 rounded hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 flex items-center gap-1">
                      <RotateCcw className="w-4 h-4" /> Unpublish
                    </button>
                  )}
                </div>
              </div>

              {detail.article.cover_r2_key && (
                <img src={`/api/articles/cover/${detail.article.id}`} alt="cover" className="max-h-48 m-4 rounded border border-slate-200 dark:border-slate-700" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              )}

              <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-semibold mb-2">Body (markdown)</h3>
                <pre className="text-xs whitespace-pre-wrap bg-slate-50 dark:bg-slate-950 p-3 rounded border border-slate-200 dark:border-slate-800 max-h-96 overflow-y-auto font-mono">
                  {detail.article.body_markdown}
                </pre>
              </div>

              <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-1"><MessageSquare className="w-4 h-4" /> Review comments</h3>
                <p className="mb-2 text-xs text-slate-500">Resolve keeps a comment on record. Delete removes it for the author too and cannot be undone.</p>
                <div className="mb-3">
                  <ReviewComments
                    state={{ loading: false, error: false, comments: detail.comments || [] }}
                    onResolve={toggleResolve}
                    onDelete={deleteComment}
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addComment(); }}
                    placeholder="Add a review comment for the author…"
                    className="flex-1 px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-950 text-sm"
                  />
                  <button onClick={addComment} disabled={!newComment.trim()} className="px-3 py-1.5 bg-violet-600 text-white rounded text-sm disabled:opacity-50">
                    Send
                  </button>
                </div>
              </div>

              <div className="p-4">
                <h3 className="text-sm font-semibold mb-2">Revision history</h3>
                <ul className="text-xs space-y-1">
                  {(detail.revisions || []).map((r) => (
                    <li key={r.id} className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>rev #{r.rev} — {r.reason || 'manual'} ({r.status_at_save})</span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {prompt && <PromptModal {...prompt} onCancel={() => setPrompt(null)} />}
    </div>
    </RailFrame>
  );
}
