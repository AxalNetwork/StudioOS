import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FileText, Plus, RefreshCw, Loader2, Save, Send, ArrowLeft, ImageIcon,
  CheckCircle2, Trash2, Eye, MessageSquare, ChevronDown, ChevronRight,
  Copy, ExternalLink, ShieldAlert, Clock,
} from 'lucide-react';
import { articles as api } from '../lib/api';
import { useToast } from '../components/useToast';
import { reportError } from '../lib/log';

// Task #1 — Article author dashboard, scoped to the /articles surface
// (role-aware list, dynamic sector taxonomy from `/api/articles/sectors`,
// deep-linkable via /articles/edit/:id). The legacy /news author page
// redirects here (Task #3 — News & Articles merged).

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

const PUBLIC_ARTICLE_BASE = 'https://axal.vc/articles';
function publicArticleUrl(slug) {
  return `${PUBLIC_ARTICLE_BASE}/${slug}`;
}

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  published: 'Published',
  rejected: 'Rejected',
};

// Which collapsible rail section an article belongs to. Drafts also holds
// `rejected` (still editable + resubmittable); In review holds the whole
// review pipeline incl. `approved` (reviewed, awaiting publish).
function lifecycleGroup(status) {
  if (status === 'published') return 'published';
  if (['submitted', 'in_review', 'changes_requested', 'approved'].includes(status)) return 'in_review';
  return 'drafts';
}

// Compact relative time for row metadata + the editor save-state.
function relativeTime(value) {
  if (!value) return '';
  // D1 default timestamps are zone-less "YYYY-MM-DD HH:MM:SS" (UTC), while
  // our PUT/submit/retract writes use ISO-Z. Normalise the zone-less form to
  // UTC before parsing so never-saved drafts don't show skewed times.
  let v = value;
  if (typeof v === 'string' && !v.includes('T') && !v.endsWith('Z')
      && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v)) {
    v = `${v.replace(' ', 'T')}Z`;
  }
  const then = new Date(v).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Human label for each PII finding kind in the blocked-submission banner.
const PII_LABEL = {
  email: 'Email',
  phone: 'Phone',
  tax_id: 'Tax ID',
  bank_iban: 'Bank account',
  card_like: 'Card number',
  consent_missing: 'Person',
  private_in_public: 'Person',
};

// D1 timestamps can be zone-less "YYYY-MM-DD HH:MM:SS" (UTC); the worker's
// next_available_at is ISO-Z. Normalise the zone-less form before parsing.
function parseServerTs(value) {
  if (!value) return NaN;
  let v = value;
  if (typeof v === 'string' && !v.includes('T') && !v.endsWith('Z')
      && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v)) {
    v = `${v.replace(' ', 'T')}Z`;
  }
  return new Date(v).getTime();
}

// Forward-looking companion to relativeTime() for the rate-limit "next slot" copy.
function futureRelative(value) {
  const t = parseServerTs(value);
  if (Number.isNaN(t)) return '';
  const secs = Math.round((t - Date.now()) / 1000);
  if (secs <= 0) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

function absoluteWhen(value) {
  const t = parseServerTs(value);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleString();
}

// Split `text` into plain/marked segments for the highlight backdrop. Ranges
// are {offset,length}; out-of-bounds entries are dropped and overlaps merged.
function buildHighlightSegments(text, ranges) {
  const valid = (ranges || [])
    .filter((r) => Number.isInteger(r.offset) && Number.isInteger(r.length)
      && r.length > 0 && r.offset >= 0 && r.offset < text.length)
    .map((r) => ({ start: r.offset, end: Math.min(text.length, r.offset + r.length) }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of valid) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const segs = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) segs.push({ text: text.slice(cursor, r.start), mark: false });
    segs.push({ text: text.slice(r.start, r.end), mark: true });
    cursor = r.end;
  }
  if (cursor < text.length) segs.push({ text: text.slice(cursor), mark: false });
  return segs;
}

// Local-only overlay-highlight textarea for the article body. A transparent
// textarea sits over a scroll-synced backdrop that mirrors the text with
// <mark> spans at the PII ranges, so blocked personal data is highlighted
// in place. Intentionally NOT a general editor component (see the separate
// editor-upgrades task) — just enough to satisfy this feedback flow.
function HighlightedTextarea({ value, onChange, disabled, ranges, textareaRef }) {
  const backdropRef = useRef(null);
  const marks = (ranges || []).filter(
    (r) => Number.isInteger(r.offset) && Number.isInteger(r.length) && r.length > 0,
  );
  const hasMarks = marks.length > 0;
  const segs = hasMarks ? buildHighlightSegments(value || '', marks) : null;
  // Identical box model on backdrop + textarea so the marks stay aligned.
  const box = 'px-3 py-3 font-mono text-sm leading-6';
  const syncScroll = () => {
    const ta = textareaRef.current;
    const bd = backdropRef.current;
    if (ta && bd) { bd.scrollTop = ta.scrollTop; bd.scrollLeft = ta.scrollLeft; }
  };
  return (
    <div className="relative rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 focus-within:border-violet-500">
      {hasMarks && (
        <div
          ref={backdropRef}
          aria-hidden="true"
          className={`${box} absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pointer-events-none select-none rounded text-transparent`}
        >
          {segs.map((s, i) => (s.mark
            ? <mark key={i} className="rounded-sm bg-red-300/80 text-transparent dark:bg-red-500/40">{s.text}</mark>
            : <span key={i}>{s.text}</span>))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onScroll={hasMarks ? syncScroll : undefined}
        disabled={disabled}
        placeholder="Write your article in markdown…"
        rows={24}
        className={`${box} relative block w-full resize-y rounded border-0 bg-transparent focus:outline-none focus:ring-0 disabled:opacity-60`}
      />
    </div>
  );
}

function readFileAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(file);
  });
}

// Cache-bust the stored cover URL with the article's updated_at so a re-upload
// is reflected immediately instead of serving the browser-cached old image.
function coverSrc(article) {
  if (!article?.cover_url) return null;
  const v = article.updated_at ? `?v=${encodeURIComponent(article.updated_at)}` : '';
  return `${article.cover_url}${v}`;
}

// Turn a failed-upload error into a specific, actionable message instead of a
// generic "Upload failed". The request() helper attaches `.status` and `.data`
// (the parsed worker JSON, e.g. { error: 'too_large' }).
function coverErrorMessage(e) {
  const code = e?.data?.error;
  if (e?.status === 413 || code === 'too_large') {
    return `That image is too large — covers must be under ${MAX_COVER_MB} MB.`;
  }
  if (code === 'unsupported_mime') return 'Unsupported image type. Use a PNG, JPEG, or WebP.';
  if (code === 'invalid_data_uri') return 'That file could not be read as an image. Try another.';
  if (code === 'r2_unavailable' || e?.status === 503) {
    return 'Image storage is temporarily unavailable. Please try again shortly.';
  }
  if (e?.status === 401 || e?.status === 403 || e?.message === 'Session expired') {
    return 'Your session expired. Sign in again to upload a cover.';
  }
  if (code === 'not_found_or_forbidden' || e?.status === 404) {
    return 'You can only change the cover on your own draft.';
  }
  return e?.message || 'Cover upload failed. Please try again.';
}

function renderPreview(md) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = esc(md || '').split('\n');
  const out = [];
  let i = 0;
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, (_, c) => `<code class="bg-slate-100 dark:bg-slate-800 px-1 rounded text-sm">${c}</code>`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a class="text-violet-600 underline" href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  }
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
    if (buf.length) out.push(`<p class="my-2 leading-relaxed">${buf.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

function ArticleRow({ a, selected, onSelect, onCopyUrl }) {
  return (
    <li>
      <button
        onClick={() => onSelect(a.id)}
        className={`w-full text-left px-3 py-2 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 ${selected ? 'bg-violet-50 dark:bg-violet-900/20' : ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium text-sm truncate">{a.title || 'Untitled'}</div>
          {statusBadge(a.status)}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {a.word_count} words · {relativeTime(a.updated_at)}
        </div>
      </button>
      {a.status === 'published' && a.slug && (
        <div className="px-3 pb-2 flex items-center gap-3 text-xs border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={() => onCopyUrl(a.slug)}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-violet-700 dark:hover:text-violet-300"
          >
            <Copy className="w-3 h-3" /> Copy link
          </button>
          <a
            href={publicArticleUrl(a.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-slate-500 hover:text-violet-700 dark:hover:text-violet-300"
          >
            <ExternalLink className="w-3 h-3" /> View live
          </a>
        </div>
      )}
    </li>
  );
}

const RAIL_SECTIONS = [
  { key: 'drafts', label: 'Drafts' },
  { key: 'in_review', label: 'In review' },
  { key: 'published', label: 'Published' },
];

function ArticleList({ items, selectedId, onSelect, onNew, refreshing, refresh, onCopyUrl }) {
  const [open, setOpen] = useState({ drafts: true, in_review: true, published: true });
  const groups = { drafts: [], in_review: [], published: [] };
  for (const a of items || []) groups[lifecycleGroup(a.status)].push(a);

  return (
    <div className="border-r border-slate-200 dark:border-slate-800 w-72 flex-shrink-0 overflow-y-auto bg-white dark:bg-slate-900">
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <button onClick={onNew} className="flex-1 flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 text-sm">
          <Plus className="w-4 h-4" /> New draft
        </button>
        <button onClick={refresh} disabled={refreshing} className="p-2 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800">
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>
      {(items || []).length === 0 ? (
        <div className="p-4 text-sm text-slate-500 dark:text-slate-400">No articles yet. Click <strong>New draft</strong> to start.</div>
      ) : (
        <div>
          {RAIL_SECTIONS.map(({ key, label }) => {
            const list = groups[key];
            const isOpen = open[key];
            return (
              <section key={key}>
                <button
                  onClick={() => setOpen((p) => ({ ...p, [key]: !p[key] }))}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-1.5">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {label}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-normal">{list.length}</span>
                </button>
                {isOpen && (list.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">None yet</div>
                ) : (
                  <ul>
                    {list.map((a) => (
                      <ArticleRow key={a.id} a={a} selected={selectedId === a.id} onSelect={onSelect} onCopyUrl={onCopyUrl} />
                    ))}
                  </ul>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ArticleAuthorPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const toast = {
    error: (m) => showToast({ kind: 'error', msg: m }),
    success: (m) => showToast({ kind: 'success', msg: m }),
  };
  const [sectors, setSectors] = useState([]);
  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedIdState] = useState(routeId ? Number(routeId) : null);
  const [article, setArticle] = useState(null);
  const [comments, setComments] = useState([]);
  const [editing, setEditing] = useState({ title: '', subtitle: '', body_markdown: '', sector: '', tags: [] });
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverPreview, setCoverPreview] = useState(null);
  const [coverError, setCoverError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [piiFindings, setPiiFindings] = useState(null);
  const [rateLimit, setRateLimit] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const bodyRef = useRef(null);
  const [, setNowTick] = useState(0);

  const setSelectedId = useCallback((id) => {
    setSelectedIdState(id);
    if (id) navigate(`/articles/edit/${id}`, { replace: true });
    else navigate('/articles/draft', { replace: true });
  }, [navigate]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.mine();
      setItems(r.items || []);
    } catch (e) {
      reportError('ArticleAuthor:list', e);
      toast.error('Failed to load drafts');
    } finally {
      setRefreshing(false);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        const s = await api.sectors();
        setSectors(s.sectors || []);
      } catch (e) {
        reportError('ArticleAuthor:boot', e);
      }
    })();
    refresh();
  }, [refresh]);

  // Keep relative times ("Saved 12s ago", row updated times) ticking without
  // a network round-trip.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const loadOne = useCallback(async (id) => {
    setCoverPreview(null);
    setCoverError(null);
    setLastSavedAt(null);
    setPiiFindings(null);
    setRateLimit(null);
    setSubmitSuccess(false);
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
      reportError('ArticleAuthor:load', e);
      toast.error('Failed to load article');
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (selectedId) loadOne(selectedId); }, [selectedId, loadOne]);

  const onNew = async () => {
    try {
      const r = await api.createDraft({ title: 'Untitled draft', body_markdown: '' });
      setItems((prev) => [r.article, ...prev]);
      setSelectedId(r.article.id);
    } catch (e) {
      reportError('ArticleAuthor:create', e);
      toast.error('Failed to create draft');
    }
  };

  // Persist the draft and report success/failure via the return value (no
  // toast on success). `save` wraps it for the explicit Save button; `submit`
  // uses it directly so it can ABORT when the save fails — otherwise the
  // server would lint stale stored text and any PII offsets we highlight
  // would be misaligned against what the author actually sees.
  const persist = async () => {
    if (!article) return false;
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
      setItems((prev) => prev.map((a) => (a.id === r.article.id ? r.article : a)));
      setLastSavedAt(Date.now());
      return true;
    } catch (e) {
      reportError('ArticleAuthor:save', e);
      toast.error(e?.data?.error || 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const ok = await persist();
    if (ok) toast.success('Saved');
    return ok;
  };

  const submit = async () => {
    if (!article) return;
    if (!editing.title.trim()) { toast.error('Title is required'); return; }
    if ((editing.body_markdown || '').trim().length < 200) { toast.error('Body must be at least 200 characters'); return; }
    setSubmitting(true);
    setPiiFindings(null);
    setRateLimit(null);
    setSubmitSuccess(false);
    try {
      const ok = await persist();
      if (!ok) { setSubmitting(false); return; }
      const r = await api.submit(article.id);
      setArticle(r.article);
      setItems((prev) => prev.map((a) => (a.id === r.article.id ? r.article : a)));
      setSubmitSuccess(true);
      toast.success('Submitted for admin review');
    } catch (e) {
      const code = e?.data?.error;
      if (code === 'pii_blocked') {
        const findings = e.data?.findings || [];
        setPiiFindings(findings);
        toast.error(`Submission blocked — ${findings.length} item${findings.length === 1 ? '' : 's'} of personal data found.`);
      } else if (code === 'rate_limited') {
        setRateLimit({
          per_week: e.data?.per_week,
          used: e.data?.used,
          next_available_at: e.data?.next_available_at || null,
        });
        toast.error('Weekly submission limit reached.');
      } else if (code === 'body_too_short') {
        toast.error(`Body must be at least ${e.data?.min_chars || 200} characters.`);
      } else if (code === 'title_required') {
        toast.error('Title is required.');
      } else if (code === 'invalid_status') {
        toast.error('This article can no longer be submitted from its current state — refresh and try again.');
      } else {
        reportError('ArticleAuthor:submit', e);
        toast.error(e?.message || 'Submit failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const retract = async () => {
    if (!article) return;
    try {
      await api.retract(article.id);
      setSubmitSuccess(false);
      await loadOne(article.id);
      await refresh();
      toast.success('Retracted to draft');
    } catch (e) {
      reportError('ArticleAuthor:retract', e);
      toast.error('Retract failed');
    }
  };

  // Editing the body invalidates the server-supplied PII offsets, so clear the
  // highlights/banner the moment the author starts removing the flagged data.
  const onBodyChange = (e) => {
    const v = e.target.value;
    setEditing((p) => ({ ...p, body_markdown: v }));
    if (piiFindings) setPiiFindings(null);
  };

  // Clicking a finding jumps the caret to it and selects the offending text.
  const jumpToFinding = (f) => {
    if (typeof f?.offset !== 'number') return;
    if (preview) setPreview(false);
    setTimeout(() => {
      const ta = bodyRef.current;
      if (!ta) return;
      const end = typeof f.length === 'number' ? f.offset + f.length : f.offset;
      ta.focus();
      try { ta.setSelectionRange(f.offset, end); } catch { /* noop */ }
      // Textareas can't scrollIntoView a range — approximate by line number.
      const before = (editing.body_markdown || '').slice(0, f.offset);
      const line = before.split('\n').length;
      ta.scrollTop = Math.max(0, (line - 3) * 24);
      const bd = ta.previousElementSibling;
      if (bd) bd.scrollTop = ta.scrollTop;
    }, 0);
  };

  const uploadCover = async (file) => {
    if (!file || !article) return;
    setCoverError(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setCoverError('Use a PNG, JPEG, or WebP image for the cover.');
      return;
    }
    if (file.size > MAX_COVER_MB * 1024 * 1024) {
      setCoverError(`That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB — covers must be under ${MAX_COVER_MB} MB.`);
      return;
    }
    let dataUri;
    try {
      dataUri = await readFileAsDataUri(file);
    } catch {
      setCoverError('Could not read that image file. Try another.');
      return;
    }
    // Optimistic thumbnail from the local file (renders immediately), swapped
    // for the stored image once the upload resolves.
    setCoverPreview(dataUri);
    setCoverUploading(true);
    const articleId = article.id;
    try {
      const r = await api.uploadCover(articleId, dataUri);
      // Apply the stored URL straight from the worker response and swap the
      // optimistic data-URI preview for it. Guarded against the user switching
      // articles mid-upload, so a slow response can't clobber another draft. A
      // cover upload changes only the cover, so no full reload is needed.
      setArticle((prev) => (prev && prev.id === articleId
        ? { ...prev, cover_url: r?.cover_url || prev.cover_url, updated_at: new Date().toISOString() }
        : prev));
      setCoverPreview((prev) => (prev === dataUri ? null : prev));
      toast.success('Cover updated');
    } catch (e) {
      reportError('ArticleAuthor:cover', e);
      setCoverPreview(null); // revert to the previously stored cover, if any
      setCoverError(coverErrorMessage(e));
    } finally {
      setCoverUploading(false);
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

  const copyUrl = async (slug) => {
    const url = publicArticleUrl(slug);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no_clipboard');
      await navigator.clipboard.writeText(url);
      toast.success('Public link copied');
    } catch {
      toast.error(`Could not copy automatically — the link is ${url}`);
    }
  };

  const isLocked = article && ['in_review', 'submitted', 'approved', 'published'].includes(article.status);
  const isEditable = !isLocked;
  const dirty = !!article && (
    editing.title.trim() !== (article.title || '')
    || editing.subtitle !== (article.subtitle || '')
    || editing.body_markdown !== (article.body_markdown || '')
    || (editing.sector || '') !== (article.sector || '')
    || JSON.stringify(editing.tags || []) !== JSON.stringify(article.tags || [])
  );
  const savedAt = lastSavedAt || (article ? article.updated_at : null);
  let reviewerNote = '';
  if (article && article.status === 'changes_requested') {
    const adminCmts = [...comments].reverse().filter((c) => c.author_role === 'admin');
    const adminCmt = adminCmts.find((c) => !c.resolved_at) || adminCmts[0];
    reviewerNote = (adminCmt && adminCmt.body)
      || (comments.length ? comments[comments.length - 1].body : '')
      || article.rejection_reason || '';
  }
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-violet-600" />
            <h1 className="font-semibold">Article authoring</h1>
            <Link to="/articles" className="text-xs text-slate-500 hover:text-violet-700 underline">View public feed</Link>
          </div>
        </div>
      </header>

      <div className="flex" style={{ height: 'calc(100vh - 56px)' }}>
        <ArticleList
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNew={onNew}
          refreshing={refreshing}
          refresh={refresh}
          onCopyUrl={copyUrl}
        />

        <main className="flex-1 overflow-y-auto p-6">
          {!article ? (
            <div className="text-center text-slate-500 dark:text-slate-400 mt-20">
              Select a draft or click <strong>New draft</strong> to start.
            </div>
          ) : (
            <div className="max-w-4xl mx-auto">
              <div className="mb-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {statusBadge(article.status)}
                    <span className="text-sm font-medium">{STATUS_LABEL[article.status] || article.status}</span>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    {saving ? (
                      <span className="text-xs inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>
                    ) : dirty ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>
                    ) : (
                      <span className="text-xs inline-flex items-center gap-1 text-slate-500 dark:text-slate-400"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Saved {relativeTime(savedAt)}</span>
                    )}
                    <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">·</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">{article.word_count} words · ~{article.read_minutes} min read</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPreview((p) => !p)} className="text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
                      <Eye className="w-4 h-4" /> {preview ? 'Edit' : 'Preview'}
                    </button>
                    {isEditable && (
                      <button onClick={save} disabled={saving || !dirty} className="text-sm px-3 py-1.5 bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 rounded hover:opacity-90 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                      </button>
                    )}
                    {article.status === 'published' ? (
                      <a href={publicArticleUrl(article.slug)} target="_blank" rel="noopener noreferrer" className="text-sm px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 flex items-center gap-1">
                        <ExternalLink className="w-4 h-4" /> View live
                      </a>
                    ) : article.status === 'submitted' ? (
                      <button onClick={retract} className="text-sm px-3 py-1.5 border border-orange-300 text-orange-700 dark:text-orange-300 rounded hover:bg-orange-50 dark:hover:bg-orange-900/20 flex items-center gap-1">
                        <ArrowLeft className="w-4 h-4" /> Retract
                      </button>
                    ) : (article.status === 'in_review' || article.status === 'approved') ? (
                      <button disabled title="This article is with the review team — you can't change it right now." className="text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 rounded flex items-center gap-1 opacity-70 cursor-not-allowed">
                        {STATUS_LABEL[article.status]}
                      </button>
                    ) : (
                      <button onClick={submit} disabled={submitting} className="text-sm px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 flex items-center gap-1 disabled:opacity-50">
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {article.status === 'draft' ? 'Submit' : 'Resubmit'}
                      </button>
                    )}
                    {article.status === 'changes_requested' && (
                      <button onClick={retract} className="text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
                        <ArrowLeft className="w-4 h-4" /> Retract
                      </button>
                    )}
                  </div>
                </div>

                {article.status === 'changes_requested' && reviewerNote && (
                  <div className="px-4 py-3 border-t border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-900/20 text-sm rounded-b-lg">
                    <div className="font-semibold text-orange-800 dark:text-orange-200 flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Reviewer asked for changes</div>
                    <div className="text-orange-700 dark:text-orange-300 mt-1 whitespace-pre-wrap">{reviewerNote}</div>
                  </div>
                )}
                {article.status === 'published' && article.slug && (
                  <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2 text-sm rounded-b-lg">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Public link</span>
                    <code className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded break-all">{publicArticleUrl(article.slug)}</code>
                    <button onClick={() => copyUrl(article.slug)} className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline"><Copy className="w-3.5 h-3.5" /> Copy</button>
                  </div>
                )}
              </div>

              {piiFindings && piiFindings.length > 0 && (
                <div className="p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded text-sm">
                  <div className="font-semibold text-red-800 dark:text-red-200 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4" /> Submission blocked: remove the highlighted personal data.
                  </div>
                  <p className="text-red-700 dark:text-red-300 mt-1">
                    We found {piiFindings.length} {piiFindings.length === 1 ? 'item' : 'items'} that look like personal data (emails, phone numbers, IDs, or named people who haven&apos;t opted in). Remove them from the body, then submit again.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {piiFindings.map((f, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => jumpToFinding(f)}
                          className="text-left inline-flex items-start gap-2 hover:underline"
                          title={typeof f.offset === 'number' ? 'Jump to this in the editor' : undefined}
                        >
                          <span className="shrink-0 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
                            {PII_LABEL[f.kind] || f.kind}
                          </span>
                          <span className="font-mono text-red-700 dark:text-red-300 break-all">
                            {f.match}
                            {f.context ? <span className="text-red-500/80 dark:text-red-400/80"> — …{f.context}…</span> : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {rateLimit && (
                <div className="p-3 mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded text-sm">
                  <div className="font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                    <Clock className="w-4 h-4" /> Weekly submission limit reached
                  </div>
                  <p className="text-amber-700 dark:text-amber-300 mt-1">
                    You&apos;ve used all {rateLimit.per_week ?? ''} of your weekly submissions.
                    {rateLimit.next_available_at
                      ? <> You can submit again {futureRelative(rateLimit.next_available_at)} (around {absoluteWhen(rateLimit.next_available_at)}).</>
                      : ' Please try again in a few days.'}
                  </p>
                </div>
              )}

              {submitSuccess && (article.status === 'submitted' || article.status === 'in_review') && (
                <div className="p-4 mb-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-800 rounded text-sm">
                  <div className="font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Submitted — now in review
                  </div>
                  <p className="text-emerald-700 dark:text-emerald-300 mt-1">
                    Your article is locked while the team reviews it. Here&apos;s what happens next:
                  </p>
                  <ul className="list-disc ml-5 mt-2 space-y-0.5 text-emerald-700 dark:text-emerald-300">
                    <li>An admin reviewer reads your draft and either approves it or requests changes.</li>
                    <li>If they ask for changes, their notes appear here and the draft unlocks for editing.</li>
                    <li>Once approved and published, you&apos;ll get a public link to share.</li>
                    <li>Need to make a quick edit now? Use <strong>Retract</strong> to pull it back to draft.</li>
                  </ul>
                </div>
              )}

              {article.status === 'rejected' && article.rejection_reason && (
                <div className="p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm">
                  <div className="font-semibold text-red-800 dark:text-red-200">Rejected</div>
                  <div className="text-red-700 dark:text-red-300 mt-1">{article.rejection_reason}</div>
                  <div className="text-xs text-red-600 dark:text-red-400 mt-2">Your draft is preserved — edit and resubmit.</div>
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
                    className="w-full text-2xl font-bold px-3 py-2 bg-transparent border-b border-slate-200 dark:border-slate-700 focus:outline-none focus:border-violet-500 disabled:opacity-60"
                  />
                  <input
                    type="text"
                    value={editing.subtitle}
                    onChange={(e) => setEditing((p) => ({ ...p, subtitle: e.target.value }))}
                    placeholder="Subtitle (optional)"
                    disabled={!isEditable}
                    className="w-full text-base px-3 py-2 bg-transparent border-b border-slate-200 dark:border-slate-700 focus:outline-none focus:border-violet-500 disabled:opacity-60"
                  />
                  <div className="flex flex-wrap gap-3 items-center">
                    <select
                      value={editing.sector}
                      onChange={(e) => setEditing((p) => ({ ...p, sector: e.target.value }))}
                      disabled={!isEditable}
                      className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
                    >
                      <option value="">Sector…</option>
                      {sectors.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    <div className="flex-1 min-w-[180px] flex flex-wrap gap-2 items-center">
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
                      <label className={`text-sm px-3 py-2 border border-slate-300 dark:border-slate-700 rounded flex items-center gap-1 ${coverUploading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer'}`}>
                        {coverUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                        {coverUploading ? 'Uploading…' : 'Cover'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          disabled={coverUploading}
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; uploadCover(f); }}
                        />
                      </label>
                    )}
                  </div>
                  {(coverPreview || article.cover_url) && (
                    <div className="relative inline-block">
                      <img
                        src={coverPreview || coverSrc(article)}
                        alt="cover"
                        className={`max-h-48 rounded border border-slate-200 dark:border-slate-700 transition-opacity ${coverUploading ? 'opacity-50' : ''}`}
                      />
                      {coverUploading && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
                        </span>
                      )}
                    </div>
                  )}
                  {coverError && (
                    <div className="text-sm rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2">
                      {coverError}
                    </div>
                  )}
                  <HighlightedTextarea
                    value={editing.body_markdown}
                    onChange={onBodyChange}
                    disabled={!isEditable}
                    ranges={piiFindings}
                    textareaRef={bodyRef}
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
