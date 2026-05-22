import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText, Plus, RefreshCw, Loader2, Save, Send, ArrowLeft, ImageIcon,
  AlertTriangle, CheckCircle2, Trash2, Eye, MessageSquare, ShieldAlert,
} from 'lucide-react';
import { news as api } from '../lib/api';
import { useToast } from '../components/useToast';
import { reportError } from '../lib/log';

const SECTORS = ['fintech', 'healthtech', 'climate', 'ai', 'devtools', 'saas', 'consumer', 'deeptech', 'other'];
const MAX_COVER_MB = 5;

function statusBadge(s) {
  const map = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    in_review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    changes_requested: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    published: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200',
    rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${map[s] || map.draft}`}>{s.replace('_', ' ')}</span>;
}

function readFileAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(file);
  });
}

// Minimal markdown preview — matches the worker renderer enough for an
// editor preview. Headings/bold/italic/links/lists/code blocks.
function renderPreview(md) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = esc(md || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; out.push(`<pre class="bg-slate-100 dark:bg-slate-800 p-3 rounded text-sm overflow-x-auto"><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const lvl = Math.min(6, h[1].length);
      out.push(`<h${lvl} class="font-bold mt-4 mb-2 text-${['','3xl','2xl','xl','lg','base','sm'][lvl]}">${inline(h[2])}</h${lvl}>`);
      i++; continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`); i++; }
      out.push(`<ul class="list-disc ml-6 my-2">${buf.join('')}</ul>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>\s?|\s*[-*]\s+|```)/.test(lines[i])) { buf.push(lines[i]); i++; }
    if (buf.length) out.push(`<p class="my-2 leading-relaxed">${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, (_, c) => `<code class="bg-slate-100 dark:bg-slate-800 px-1 rounded text-sm">${c}</code>`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a class="text-emerald-600 underline" href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  }
}

function ArticleList({ articles, selectedId, onSelect, onNew, refreshing, refresh }) {
  return (
    <div className="border-r border-slate-200 dark:border-slate-800 w-72 flex-shrink-0 overflow-y-auto bg-white dark:bg-slate-900">
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <button onClick={onNew} className="flex-1 flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm">
          <Plus className="w-4 h-4" /> New draft
        </button>
        <button onClick={refresh} disabled={refreshing} className="p-2 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800">
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>
      {(articles || []).length === 0 ? (
        <div className="p-4 text-sm text-slate-500 dark:text-slate-400">No drafts yet. Start your first one.</div>
      ) : (
        <ul>
          {articles.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => onSelect(a.id)}
                className={`w-full text-left px-3 py-2 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 ${selectedId === a.id ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm truncate">{a.title || 'Untitled'}</div>
                  {statusBadge(a.status)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {a.word_count} words · {new Date(a.updated_at).toLocaleDateString()}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NewsAuthorPage() {
  const { showToast } = useToast();
  const toast = { error: (m) => showToast({ kind: "error", msg: m }), success: (m) => showToast({ kind: "success", msg: m }) };
  const [trust, setTrust] = useState(null);
  const [trustLoading, setTrustLoading] = useState(true);
  const [articles, setArticles] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [article, setArticle] = useState(null);
  const [comments, setComments] = useState([]);
  const [editing, setEditing] = useState({ title: '', subtitle: '', body_markdown: '', sector: '', tags: [] });
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.mine();
      setArticles(r.items || []);
    } catch (e) {
      reportError('NewsAuthor:list', e);
      toast.error('Failed to load drafts');
    } finally {
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      try {
        const t = await api.trustMe();
        setTrust(t);
      } catch (e) {
        reportError('NewsAuthor:trust', e);
      } finally {
        setTrustLoading(false);
      }
    })();
    refresh();
  }, [refresh]);

  const loadOne = useCallback(async (id) => {
    try {
      const r = await api.draft(id);
      setArticle(r.article);
      setComments(r.comments || []);
      setEditing({
        title: r.article.title || '',
        subtitle: r.article.subtitle || '',
        body_markdown: r.article.body_markdown || '',
        sector: r.article.sector || '',
        tags: r.article.tags || [],
      });
    } catch (e) {
      reportError('NewsAuthor:load', e);
      toast.error('Failed to load article');
    }
  }, [toast]);

  useEffect(() => { if (selectedId) loadOne(selectedId); }, [selectedId, loadOne]);

  const onNew = async () => {
    if (!trust || trust.score < trust.min_required) {
      toast.error(`You need a trust score of ${trust?.min_required ?? 70} to author articles. Current: ${trust?.score ?? '?'}`);
      return;
    }
    try {
      const r = await api.createDraft({ title: 'Untitled draft', body_markdown: '' });
      setArticles((prev) => [r.article, ...prev]);
      setSelectedId(r.article.id);
    } catch (e) {
      if (e?.body?.error === 'trust_too_low') {
        toast.error('Trust score too low for authoring.');
      } else {
        reportError('NewsAuthor:create', e);
        toast.error('Failed to create draft');
      }
    }
  };

  const save = async () => {
    if (!article) return;
    setSaving(true);
    try {
      const patch = {
        title: editing.title,
        subtitle: editing.subtitle,
        body_markdown: editing.body_markdown,
        sector: editing.sector || null,
        tags: editing.tags,
      };
      const r = await api.updateDraft(article.id, patch);
      setArticle(r.article);
      setArticles((prev) => prev.map((a) => (a.id === r.article.id ? r.article : a)));
      toast.success('Saved');
    } catch (e) {
      reportError('NewsAuthor:save', e);
      toast.error(e?.body?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!article) return;
    if (!editing.title.trim()) { toast.error('Title is required'); return; }
    if ((editing.body_markdown || '').trim().length < 200) { toast.error('Body must be at least 200 characters'); return; }
    setSubmitting(true);
    try {
      // Save first to capture latest body
      await save();
      const r = await api.submit(article.id);
      setArticle(r.article);
      setArticles((prev) => prev.map((a) => (a.id === r.article.id ? r.article : a)));
      toast.success('Submitted for admin review');
    } catch (e) {
      if (e?.body?.error === 'pii_blocked') {
        const findings = e.body.findings || [];
        toast.error(`Blocked: detected ${findings.length} PII issue(s). Remove emails/phones/identifiers before submitting.`);
      } else if (e?.body?.error === 'rate_limited') {
        toast.error(`You've hit the limit of ${e.body.per_week} submissions per week. Try again later.`);
      } else if (e?.body?.error === 'body_too_short') {
        toast.error(`Body must be at least ${e.body.min_chars} characters.`);
      } else {
        reportError('NewsAuthor:submit', e);
        toast.error(e?.body?.error || 'Submit failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const retract = async () => {
    if (!article) return;
    try {
      await api.retract(article.id);
      await loadOne(article.id);
      await refresh();
      toast.success('Retracted to draft');
    } catch (e) {
      reportError('NewsAuthor:retract', e);
      toast.error('Retract failed');
    }
  };

  const uploadCover = async (file) => {
    if (!file) return;
    if (file.size > MAX_COVER_MB * 1024 * 1024) { toast.error(`Cover must be < ${MAX_COVER_MB} MB`); return; }
    try {
      const dataUri = await readFileAsDataUri(file);
      await api.uploadCover(article.id, dataUri);
      await loadOne(article.id);
      toast.success('Cover uploaded');
    } catch (e) {
      reportError('NewsAuthor:cover', e);
      toast.error('Upload failed');
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
    if (!t) return;
    if ((editing.tags || []).includes(t)) { setTagInput(''); return; }
    setEditing((prev) => ({ ...prev, tags: [...(prev.tags || []), t].slice(0, 8) }));
    setTagInput('');
  };

  const removeTag = (t) => setEditing((p) => ({ ...p, tags: (p.tags || []).filter((x) => x !== t) }));

  const isLocked = article && ['in_review', 'submitted', 'approved', 'published'].includes(article.status);
  const isEditable = !isLocked;
  const trustOk = trust && trust.score >= trust.min_required;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-emerald-600" />
            <h1 className="font-semibold">News authoring</h1>
          </div>
          {trustLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <div className={`text-sm flex items-center gap-2 px-3 py-1 rounded ${trustOk ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
              <ShieldAlert className="w-4 h-4" />
              Trust {trust?.score ?? 0} / {trust?.min_required ?? 70}
            </div>
          )}
        </div>
      </header>

      {!trustOk && !trustLoading && (
        <div className="mx-6 mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-sm text-amber-800 dark:text-amber-200 flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          Your trust score is below the minimum required to author articles. Complete KYC + email verification, KYB, or sign a partner deal to qualify.
        </div>
      )}

      <div className="flex" style={{ height: 'calc(100vh - 56px)' }}>
        <ArticleList
          articles={articles}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNew={onNew}
          refreshing={refreshing}
          refresh={refresh}
        />

        <main className="flex-1 overflow-y-auto p-6">
          {!article ? (
            <div className="text-center text-slate-500 dark:text-slate-400 mt-20">
              Select a draft or click <strong>New draft</strong> to start.
            </div>
          ) : (
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {statusBadge(article.status)}
                  <span className="text-xs text-slate-500">
                    {article.word_count} words · ~{article.read_minutes} min read
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPreview((p) => !p)} className="text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
                    <Eye className="w-4 h-4" /> {preview ? 'Edit' : 'Preview'}
                  </button>
                  {isEditable && (
                    <button onClick={save} disabled={saving} className="text-sm px-3 py-1.5 bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 rounded hover:opacity-90 flex items-center gap-1 disabled:opacity-50">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                    </button>
                  )}
                  {isEditable && (
                    <button onClick={submit} disabled={submitting || !trustOk} className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center gap-1 disabled:opacity-50">
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit
                    </button>
                  )}
                  {['submitted', 'changes_requested'].includes(article.status) && (
                    <button onClick={retract} className="text-sm px-3 py-1.5 border border-orange-300 text-orange-700 dark:text-orange-300 rounded hover:bg-orange-50 dark:hover:bg-orange-900/20 flex items-center gap-1">
                      <ArrowLeft className="w-4 h-4" /> Retract
                    </button>
                  )}
                </div>
              </div>

              {article.status === 'rejected' && article.rejection_reason && (
                <div className="p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm">
                  <div className="font-semibold text-red-800 dark:text-red-200">Rejected</div>
                  <div className="text-red-700 dark:text-red-300 mt-1">{article.rejection_reason}</div>
                  <div className="text-xs text-red-600 dark:text-red-400 mt-2">Your previous body is preserved — edit and resubmit.</div>
                </div>
              )}
              {article.status === 'changes_requested' && article.rejection_reason && (
                <div className="p-3 mb-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-sm">
                  <div className="font-semibold text-orange-800 dark:text-orange-200">Changes requested</div>
                  <div className="text-orange-700 dark:text-orange-300 mt-1">{article.rejection_reason}</div>
                </div>
              )}

              {preview ? (
                <div className="bg-white dark:bg-slate-900 p-8 rounded border border-slate-200 dark:border-slate-800">
                  <h1 className="text-3xl font-bold">{editing.title}</h1>
                  {editing.subtitle && <p className="text-lg text-slate-600 dark:text-slate-400 mt-2">{editing.subtitle}</p>}
                  <div className="mt-6 prose dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: renderPreview(editing.body_markdown) }} />
                </div>
              ) : (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={editing.title}
                    onChange={(e) => setEditing((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Article title"
                    disabled={!isEditable}
                    className="w-full text-2xl font-bold px-3 py-2 bg-transparent border-b border-slate-200 dark:border-slate-700 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                  />
                  <input
                    type="text"
                    value={editing.subtitle}
                    onChange={(e) => setEditing((p) => ({ ...p, subtitle: e.target.value }))}
                    placeholder="Subtitle (optional)"
                    disabled={!isEditable}
                    className="w-full text-base px-3 py-2 bg-transparent border-b border-slate-200 dark:border-slate-700 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                  />
                  <div className="flex gap-3 items-center">
                    <select
                      value={editing.sector}
                      onChange={(e) => setEditing((p) => ({ ...p, sector: e.target.value }))}
                      disabled={!isEditable}
                      className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
                    >
                      <option value="">Sector…</option>
                      {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div className="flex-1 flex flex-wrap gap-2 items-center">
                      {(editing.tags || []).map((t) => (
                        <span key={t} className="text-xs px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded flex items-center gap-1">
                          {t}
                          {isEditable && <button onClick={() => removeTag(t)} className="hover:text-red-600"><Trash2 className="w-3 h-3" /></button>}
                        </span>
                      ))}
                      {isEditable && (editing.tags || []).length < 8 && (
                        <input
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                          placeholder="Add tag…"
                          className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 w-24"
                        />
                      )}
                    </div>
                    {isEditable && (
                      <label className="text-sm px-3 py-2 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-1">
                        <ImageIcon className="w-4 h-4" /> Cover
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadCover(e.target.files?.[0])} />
                      </label>
                    )}
                  </div>
                  {article.cover_url && (
                    <img src={article.cover_url} alt="cover" className="max-h-48 rounded border border-slate-200 dark:border-slate-700" />
                  )}
                  <textarea
                    value={editing.body_markdown}
                    onChange={(e) => setEditing((p) => ({ ...p, body_markdown: e.target.value }))}
                    placeholder="Write your article in markdown…"
                    disabled={!isEditable}
                    rows={24}
                    className="w-full px-3 py-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded font-mono text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                  />
                  <div className="text-xs text-slate-500">
                    Markdown supported: # headings, **bold**, *italic*, [links](https://…), - lists, ```code blocks```.
                    Minimum 200 characters. Personal data (emails, phone numbers, IDs) will block submission.
                  </div>
                </div>
              )}

              {comments.length > 0 && (
                <div className="mt-8">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Review comments</h3>
                  <ul className="space-y-2">
                    {comments.map((c) => (
                      <li key={c.id} className={`p-3 border rounded ${c.resolved_at ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}>
                        <div className="text-xs text-slate-500 mb-1 flex justify-between">
                          <span>{c.author_name || 'Reviewer'} {c.author_role === 'admin' && '(admin)'}</span>
                          <span>{new Date(c.created_at).toLocaleString()}</span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap">{c.body}</div>
                        {c.resolved_at && <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Resolved</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
