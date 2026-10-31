import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Loader2, Save, Send, ArrowLeft, ImageIcon,
  CheckCircle2, Eye, MessageSquare, Sparkles, Wand2,
  Copy, ExternalLink, ShieldAlert, Clock, Globe,
} from 'lucide-react';
import { api as appApi, articles as api, adminArticles as adminApi } from '../lib/api';
import { useToast } from '../components/useToast';
import ToastMessage from '../components/ToastMessage';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import ReactMarkdown from 'react-markdown';
import { wordsAndMinutes } from '../lib/articleMarkdown';
import { appOrigin } from '../lib/branchHost';
import { isSuperAdminUser, readHqView, shellRoleFor } from '../lib/shellRole';
import Lightbox from '../ui/Lightbox';
import { RailFrame, WorkerRail } from '../ui';
import ArticleLibrary from './articles/ArticleLibrary';
import ArticleWritingPanel from './articles/ArticleWritingPanel';
import ArticleImageSheet from './articles/ArticleImageSheet';
import ArticlePublishSheet from './articles/ArticlePublishSheet';
import {
  FORMAT_BUTTONS, LIBRARY_TABS, SLASH_BLOCKS, draftAudience, formatMarkdown, imageMarkdown, placeText, proposalMarkdown, tabOf,
} from './articles/articleCanvas';
import { ghost as actionGhost, primary as actionPrimary } from '../ui/ActionSheet';

// Task #1 — Article author dashboard, scoped to the /articles surface
// (role-aware list, dynamic sector taxonomy from `/api/articles/sectors`,
// deep-linkable via /articles/edit/:id). The legacy /news author page
// redirects here (Task #3 — News & Articles merged).
//
// D1408 (#3694) — the Article Authoring canvas (boards AR1–AR6): the
// library at /articles/draft (AR1), the editor at /articles/edit/:id (AR2),
// Eadwyn's writing panel (AR3), the image sheet (AR4) and Publish… (AR5),
// inside the page's own rail (`<Profile> · Articles`, D1409). The parts live
// in `pages/articles/`; this file keeps the store, the save, the submit and
// the D1292 publish chain.

const MAX_COVER_MB = 5;

/** D1292 — the shortest reason a Super Admin may give to decide their own article (the Worker's `OVERRIDE_REASON_MIN`). */
export const OVERRIDE_REASON_MIN = 8;

/**
 * D1292 — what the admin publish chain may do on this article. An admin
 * deciding their own article is refused by the Worker, so the page never
 * offers it: an Admin is told to ask another admin, and a Super Admin gives
 * a reason first, which the Worker records.
 *   'none'     not an admin, or already published: no chain
 *   'blocked'  an Admin's own article: no chain, ask another admin
 *   'override' a Super Admin's own article: the chain, after a reason
 *   'direct'   someone else's article: the chain as before
 */
export function publishChainFor({ user, article }) {
  if (!article || article.status === 'published' || user?.role !== 'admin') return 'none';
  const own = article.author_user_id != null && Number(article.author_user_id) === Number(user?.id);
  if (!own) return 'direct';
  return isSuperAdminUser(user) ? 'override' : 'blocked';
}

/** D1292 — the Super Admin's reason, asked in the page before the chain runs. */
function OverrideDialog({ onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const short = reason.trim().length < OVERRIDE_REASON_MIN;
  return (
    <Lightbox label="Publish your own article" title="Publish your own article?" onClose={onCancel} width={520} testId="article-override"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={onCancel}>Cancel</button>
          <button type="button" className={actionPrimary} disabled={short} onClick={() => onConfirm(reason.trim())} data-testid="article-override-go">Approve and publish</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="m-0">You wrote this article. Another admin normally approves and publishes it. As Super Admin you can do it yourself; your reason is recorded with the approval and the publish.</p>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Reason · required</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" data-testid="article-override-reason" />
        </label>
        {short ? <p className="m-0 text-[12px] text-slate-500 dark:text-slate-400" data-testid="article-override-problem">Give a reason of at least {OVERRIDE_REASON_MIN} characters.</p> : null}
      </div>
    </Lightbox>
  );
}

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

// D106 — a function, not a module const: the value is read per render from
// the host actually serving the page, so a branch links into itself.
const publicArticleBase = () => `${appOrigin()}/articles`;
function publicArticleUrl(slug) {
  return `${publicArticleBase()}/${slug}`;
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

/** D1408 — a heading field in the article's own type that grows with its text (AR2). */
function GrowingField({ value, onChange, className, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))} className={`w-full resize-none overflow-hidden bg-transparent focus:outline-none disabled:opacity-80 ${className}`} {...rest} />;
}

/**
 * D1408 — the page's rail, `<Profile> · Articles`, in the viewer's accent.
 * Each mount names its role literally (`branch_rail_mount`); a branch admin
 * takes the admin's.
 */
const ARTICLE_RAIL_NOTE = 'Eadwyn outlines, rewrites, suggests headlines and draws images when you ask. Nothing goes into your article until you place it.';
function ArticleRail({ role }) {
  switch (role) {
    case 'investor': return <WorkerRail workspace="Articles" role="investor" note={ARTICLE_RAIL_NOTE} data-testid="article-rail" />;
    case 'advisor': return <WorkerRail workspace="Articles" role="advisor" note={ARTICLE_RAIL_NOTE} data-testid="article-rail" />;
    case 'partner': return <WorkerRail workspace="Articles" role="partner" note={ARTICLE_RAIL_NOTE} data-testid="article-rail" />;
    case 'super_admin': return <WorkerRail workspace="Articles" role="super_admin" note={ARTICLE_RAIL_NOTE} data-testid="article-rail" />;
    case 'admin':
    case 'branch_admin': return <WorkerRail workspace="Articles" role="admin" note={ARTICLE_RAIL_NOTE} data-testid="article-rail" />;
    default: return <WorkerRail workspace="Articles" role="founder" note={ARTICLE_RAIL_NOTE} data-testid="article-rail" />;
  }
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

export default function ArticleAuthorPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { toast: current, showToast, dismissToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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
  const [editing, setEditing] = useState({ title: '', subtitle: '', body_markdown: '', sector: '', tags: [], excerpt: '', seo_title: '', canonical_url: '', slug: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverPreview, setCoverPreview] = useState(null);
  const [coverError, setCoverError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [piiFindings, setPiiFindings] = useState(null);
  const [rateLimit, setRateLimit] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [overrideAsk, setOverrideAsk] = useState(false);
  const [imageError, setImageError] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [listError, setListError] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [creating, setCreating] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelRun, setPanelRun] = useState(null);
  const [waiting, setWaiting] = useState(0);
  const [imageSheet, setImageSheet] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [followers, setFollowers] = useState(null);
  const bodyRef = useRef(null);
  const articleRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const [, setNowTick] = useState(0);

  // D1408 — the library and the editor are two addresses, so Back returns
  // from an article to the library.
  const setSelectedId = useCallback((id) => {
    setSelectedIdState(id);
    if (id) navigate(`/articles/edit/${id}`);
    else navigate('/articles/draft');
  }, [navigate]);

  useEffect(() => {
    const id = routeId ? Number(routeId) : null;
    setSelectedIdState(id);
    if (!id) {
      setArticle(null);
      articleRef.current = null;
      setPanelOpen(false);
      setPublishOpen(false);
      setImageSheet(null);
    }
  }, [routeId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.mine();
      setItems(r.items || []);
      setListError(false);
    } catch (e) {
      reportError('ArticleAuthor:list', e);
      // D1408 (AR6e): a failed read is said, never drawn as an empty library.
      setListError(true);
    } finally {
      setRefreshing(false);
      setListLoaded(true);
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

  // D1408 — AR1's followers card: the member's public follower count.
  useEffect(() => {
    if (!user?.id) return undefined;
    let live = true;
    appApi.followStatus('user', user.id)
      .then((r) => { if (live && Number.isFinite(Number(r?.followers))) setFollowers(Number(r.followers)); })
      .catch(() => {});
    return () => { live = false; };
  }, [user?.id]);

  // Keep relative times ("Saved 12s ago", row updated times) ticking without
  // a network round-trip.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const loadOne = useCallback(async (id) => {
    setCoverPreview(null);
    setCoverError(null);
    setImageError(null);
    setLastSavedAt(null);
    setPiiFindings(null);
    setRateLimit(null);
    setSubmitSuccess(false);
    setSlugTouched(false);
    if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
    try {
      const r = await api.draft(id);
      setArticle(r.article);
      articleRef.current = r.article;
      setComments(r.comments || []);
      setEditing({
        title: r.article.title || '',
        subtitle: r.article.subtitle || '',
        body_markdown: r.article.body_markdown || '',
        sector: r.article.sector || '',
        tags: r.article.tags || [],
        excerpt: r.article.excerpt || '',
        seo_title: r.article.seo_title || '',
        canonical_url: r.article.canonical_url || '',
        slug: r.article.slug || '',
      });
    } catch (e) {
      reportError('ArticleAuthor:load', e);
      toast.error('Failed to load article');
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (selectedId) loadOne(selectedId); }, [selectedId, loadOne]);

  const onNew = async () => {
    setCreating(true);
    try {
      const r = await api.createDraft({ title: 'Untitled draft', body_markdown: '' });
      setItems((prev) => [r.article, ...prev]);
      setSelectedId(r.article.id);
    } catch (e) {
      reportError('ArticleAuthor:create', e);
      toast.error('Failed to create draft');
    } finally {
      setCreating(false);
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
        excerpt: editing.excerpt || null,
        seo_title: editing.seo_title || null,
        canonical_url: editing.canonical_url || null,
        slug: editing.slug || null,
      };
      const r = await api.updateDraft(article.id, patch);
      // D1292 — an edit to a submitted or approved article sends it back to Submitted.
      if (r.returned_to_queue) {
        toast.error(r.returned_to_queue.publish_at_cleared
          ? 'Edited after submission: it is back in the review queue, and its publish time was cleared.'
          : 'Edited after submission: it is back in the review queue.');
      }
      setArticle(r.article);
      articleRef.current = r.article;
      setItems((prev) => prev.map((a) => (a.id === r.article.id ? r.article : a)));
      setEditing((prev) => ({
        ...prev,
        slug: r.article.slug || prev.slug,
      }));
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

  // Declared before scheduleAutosave to avoid TDZ: useCallback dep-array
  // is evaluated on mount, so all closed-over consts must be initialized first.
  const isLocked = useMemo(() => article && ['in_review', 'submitted', 'approved', 'published'].includes(article.status), [article]);
  const isEditable = useMemo(() => !isLocked, [isLocked]);
  const dirty = useMemo(() => !!article && (
    editing.title.trim() !== (article.title || '')
    || editing.subtitle !== (article.subtitle || '')
    || editing.body_markdown !== (article.body_markdown || '')
    || (editing.sector || '') !== (article.sector || '')
    || JSON.stringify(editing.tags || []) !== JSON.stringify(article.tags || [])
    || editing.excerpt !== (article.excerpt || '')
    || editing.seo_title !== (article.seo_title || '')
    || editing.canonical_url !== (article.canonical_url || '')
    || editing.slug !== (article.slug || '')
  ), [article, editing]);

  // Task #4 — debounced autosave (~2.5s) when editable+dirty. No toast.
  // Guard against race: capture articleId at schedule time and compare to
  // the current article ref when the timer fires.
  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    if (!isEditable || !dirty || saving || submitting) return;
    const capturedId = articleRef.current?.id;
    autosaveTimerRef.current = setTimeout(() => {
      if (articleRef.current?.id !== capturedId) return;
      if (saving || submitting) return;
      persist();
    }, 2500);
  }, [isEditable, dirty, saving, submitting]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    scheduleAutosave();
  }, [editing, scheduleAutosave]);

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

  // Admin-only end-to-end publish. Regular authors still go through the
  // submit → review → approve → publish queue; an admin can take one of
  // their own drafts all the way to public in one action by chaining the
  // existing (unchanged) transition endpoints: submit → approve → publish.
  // The PII linter + weekly cap on /submit are deliberately left intact.
  //
  // D1292 — the chain follows the self-approval rule (`publishChainFor`): it
  // never runs on an Admin's own article, and on a Super Admin's own article
  // it runs only with the reason the override dialog collected.
  const chain = publishChainFor({ user, article });
  const adminPublish = async (overrideReason = null) => {
    if (!article || !isAdmin) return;
    if (chain === 'none' || chain === 'blocked') return;
    if (chain === 'override' && !overrideReason) { setOverrideAsk(true); return; }
    if (!editing.title.trim()) { toast.error('Title is required'); return; }
    if ((editing.body_markdown || '').trim().length < 200) { toast.error('Body must be at least 200 characters'); return; }
    setPublishing(true);
    setPiiFindings(null);
    setRateLimit(null);
    setSubmitSuccess(false);
    try {
      // Persist latest edits first — except when the article is locked in
      // review (PUT would 409 `locked_for_review`); there we publish the
      // stored content as-is.
      if ((articleRef.current?.status || article.status) !== 'in_review') {
        const ok = await persist();
        if (!ok) { setPublishing(false); return; }
      }
      let status = articleRef.current?.status || article.status;
      if (['draft', 'changes_requested', 'rejected'].includes(status)) {
        const r = await api.submit(article.id);
        status = r.article.status;
      }
      if (['submitted', 'in_review'].includes(status)) {
        await adminApi.approve(article.id, overrideReason);
        status = 'approved';
      }
      if (status === 'approved') {
        await adminApi.publish(article.id, overrideReason);
      }
      await loadOne(article.id);
      await refresh();
      toast.success('Published — live on the public page');
    } catch (e) {
      const code = e?.data?.error;
      if (code === 'pii_blocked') {
        const findings = e.data?.findings || [];
        setPiiFindings(findings);
        toast.error(`Publish blocked — ${findings.length} item${findings.length === 1 ? '' : 's'} of personal data found.`);
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
      } else if (code === 'self_approval' || code === 'self_approval_reason_required') {
        toast.error(e.data?.detail || 'Another admin must approve and publish your own article.');
      } else {
        reportError('ArticleAuthor:adminPublish', e);
        toast.error(e?.data?.error || e?.message || 'Publish failed');
      }
      // Reflect any partial transition (e.g. submitted but approve failed).
      await loadOne(article.id).catch(() => {});
      await refresh().catch(() => {});
    } finally {
      setPublishing(false);
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

  // Task #4 — inline body image upload (drag/paste or file picker)
  const insertImageMarkdown = (url) => {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const before = editing.body_markdown.slice(0, start);
    const after = editing.body_markdown.slice(end);
    const insert = `![image](${url})\n`;
    const next = before + insert + after;
    setEditing((p) => ({ ...p, body_markdown: next }));
    setTimeout(() => {
      if (bodyRef.current) {
        const pos = start + insert.length;
        bodyRef.current.focus();
        bodyRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const handleImageUpload = async (file) => {
    if (!file || !article) return;
    setImageError(null);
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setImageError('Use a PNG, JPEG, WebP, or GIF image for inline uploads.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError('That image is too large — must be under 5 MB.');
      return;
    }
    let dataUri;
    try {
      dataUri = await readFileAsDataUri(file);
    } catch {
      setImageError('Could not read that image file. Try another.');
      return;
    }
    setImageUploading(true);
    const articleId = article.id;
    try {
      const r = await api.uploadImage(articleId, dataUri);
      if (articleRef.current?.id === articleId) {
        insertImageMarkdown(r.url);
      }
      toast.success('Image inserted');
    } catch (e) {
      reportError('ArticleAuthor:image', e);
      setImageError(e?.data?.error || 'Image upload failed');
    } finally {
      setImageUploading(false);
    }
  };

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

  const savedAt = lastSavedAt || (article ? article.updated_at : null);
  const liveStats = useMemo(() => {
    const { words, minutes } = wordsAndMinutes(editing.body_markdown || '');
    return { words, minutes };
  }, [editing.body_markdown]);
  let reviewerNote = '';
  if (article && article.status === 'changes_requested') {
    const adminCmts = [...comments].reverse().filter((c) => c.author_role === 'admin');
    const adminCmt = adminCmts.find((c) => !c.resolved_at) || adminCmts[0];
    reviewerNote = (adminCmt && adminCmt.body)
      || (comments.length ? comments[comments.length - 1].body : '')
      || article.rejection_reason || '';
  }
  // D1408 — what the writing panel is working on: the selection, the text
  // before the caret, and the heading of the section the caret is in.
  const getContext = useCallback(() => {
    const ta = bodyRef.current;
    const body = ta?.value ?? '';
    const start = ta?.selectionStart ?? body.length;
    const end = ta?.selectionEnd ?? start;
    const heads = [...body.slice(0, start).matchAll(/^#{1,3}\s+(.+)$/gm)];
    return {
      start, end,
      selection: body.slice(start, end),
      cursorContext: body.slice(0, end),
      section: heads.length ? heads[heads.length - 1][1].trim() : '',
    };
  }, []);

  const focusBody = (start, end = start) => setTimeout(() => {
    const ta = bodyRef.current;
    if (!ta) return;
    ta.focus();
    try { ta.setSelectionRange(start, end); } catch { /* noop */ }
  }, 0);

  // D1408 — Insert or Replace: the proposal's text goes into the draft, which
  // the page's autosave writes. A rewrite whose selection has changed since
  // the run is inserted below instead of replacing other text.
  const onPlace = (item, mode) => {
    const md = proposalMarkdown(item.proposal);
    if (!md) return;
    const body = editing.body_markdown || '';
    const range = item.range || { start: item.at ?? body.length, end: item.at ?? body.length };
    let how = mode;
    if (how === 'replace' && body.slice(range.start, range.end) !== (item.proposal.payload?.before ?? '')) {
      how = 'below';
      toast.error('The selected text changed since Eadwyn read it, so the rewrite went below it instead.');
    }
    const r = placeText(body, md, { start: range.start, end: range.end, mode: how });
    setEditing((p) => ({ ...p, body_markdown: r.body }));
    if (piiFindings) setPiiFindings(null);
    focusBody(r.caret);
  };

  const onApplySeo = (payload) => setEditing((p) => ({
    ...p,
    ...(payload.seo_title ? { seo_title: String(payload.seo_title).slice(0, 120) } : {}),
    ...(payload.excerpt ? { excerpt: String(payload.excerpt).slice(0, 200) } : {}),
  }));
  const onApplyHeadline = (h) => setEditing((p) => ({ ...p, title: h }));

  const applyFormat = (kind) => {
    const ta = bodyRef.current;
    const body = editing.body_markdown || '';
    const r = formatMarkdown(body, ta?.selectionStart ?? body.length, ta?.selectionEnd ?? body.length, kind);
    setEditing((p) => ({ ...p, body_markdown: r.body }));
    focusBody(r.start, r.end);
  };

  const onImagePlaced = (img, target, coverUrl) => {
    setImageSheet(null);
    if (target === 'cover') {
      // The cover is served from its own copy; a new `updated_at` busts the cached one (`coverSrc`).
      setCoverPreview(null);
      setArticle((prev) => (prev ? { ...prev, cover_url: coverUrl || prev.cover_url || `/api/articles/cover/${prev.id}`, updated_at: new Date().toISOString() } : prev));
      toast.success('Cover updated');
    } else {
      const ta = bodyRef.current;
      const body = editing.body_markdown || '';
      const at = ta?.selectionEnd ?? body.length;
      const r = placeText(body, imageMarkdown(img), { start: at, end: at, mode: 'below' });
      setEditing((p) => ({ ...p, body_markdown: r.body }));
      toast.success('Image placed');
    }
  };

  const openAsk = (option = null) => {
    setPublishOpen(false);
    setPanelRun(option);
    setPanelOpen(true);
  };

  // D1408 (AR5, admin): an approved article another member wrote can be given a
  // publish time (D484). The Worker refuses an admin's own article (D1292).
  const scheduleAt = async (iso) => {
    if (!article || chain !== 'direct') return false;
    setScheduling(true);
    try {
      await adminApi.schedule(article.id, iso);
      await loadOne(article.id);
      await refresh();
      toast.success('Scheduled. It publishes at that time.');
      return true;
    } catch (e) {
      reportError('ArticleAuthor:schedule', e);
      toast.error(e?.data?.message || 'Could not schedule. Try again.');
      return false;
    } finally {
      setScheduling(false);
    }
  };

  const backToLibrary = async () => {
    if (dirty && isEditable) await persist();
    setSelectedId(null);
    refresh();
  };

  const rail = <ArticleRail role={shellRoleFor(user?.role, user, readHqView())} />;
  const tabLabel = article ? (LIBRARY_TABS.find((t) => t.key === tabOf(article)) || LIBRARY_TABS[0]).label : '';
  const canSendForReview = article && ['draft', 'changes_requested', 'rejected'].includes(article.status);
  const coverImg = coverPreview || (article?.cover_url ? coverSrc(article) : null);

  return (
    <RailFrame rail={rail} data-testid="article-author-page">
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <ToastMessage toast={current} onDismiss={dismissToast} />
      {overrideAsk && <OverrideDialog onCancel={() => setOverrideAsk(false)} onConfirm={(r) => { setOverrideAsk(false); adminPublish(r); }} />}

      {!selectedId ? (
        <ArticleLibrary
          items={items}
          loading={!listLoaded}
          loadError={listError}
          refreshing={refreshing}
          onRefresh={refresh}
          onOpen={setSelectedId}
          onNew={onNew}
          creating={creating}
          statusPill={statusBadge}
          relativeTime={relativeTime}
          coverSrc={coverSrc}
          onCopyUrl={copyUrl}
          publicUrl={publicArticleUrl}
          followers={followers}
        />
      ) : !article ? (
        <div className="text-center text-slate-500 dark:text-slate-400 mt-20"><Loader2 className="w-5 h-5 animate-spin inline" /> Opening the article…</div>
      ) : (
        <div className="flex flex-col lg:flex-row min-h-screen">
          <main className="flex-1 min-w-0">
            <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-2.5">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    <button type="button" onClick={backToLibrary} className="hover:text-violet-700 dark:hover:text-violet-300" data-testid="article-crumb">Articles</button>
                    <span aria-hidden="true"> › </span>{tabLabel}
                  </div>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-semibold truncate max-w-[320px]">{editing.title || 'Untitled draft'}</span>
                    {statusBadge(article.status)}
                    {saving ? (
                      <span className="text-xs inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>
                    ) : dirty ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>
                    ) : (
                      <span className="text-xs inline-flex items-center gap-1 text-slate-500 dark:text-slate-400"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Saved · {relativeTime(savedAt)}</span>
                    )}
                  </div>
                </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setPreview((p) => !p)} className="text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
                      <Eye className="w-4 h-4" /> {preview ? 'Edit' : 'Preview'}
                    </button>
                    {isEditable && (
                      <button onClick={save} disabled={saving || !dirty} className="text-sm px-3 py-1.5 bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 rounded hover:opacity-90 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                      </button>
                    )}
                    {chain === 'blocked' && (
                      <span className="text-xs text-slate-500 dark:text-slate-400" data-testid="article-self-approval-note">You wrote this. Another admin approves and publishes it.</span>
                    )}
                    {(chain === 'direct' || chain === 'override') && (
                      <button
                        onClick={() => adminPublish()}
                        disabled={publishing || submitting}
                        title="Admin: publish this article straight to the public page"
                        className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center gap-1 disabled:opacity-50"
                      >
                        {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Publish now
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
                    ) : (article.status === 'approved' && chain === 'direct') ? (
                      <button onClick={() => setPublishOpen(true)} className="text-sm px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 flex items-center gap-1" data-testid="article-schedule-open">
                        <Clock className="w-4 h-4" /> Schedule…
                      </button>
                    ) : (article.status === 'in_review' || article.status === 'approved') ? (
                      <button disabled title="This article is with the review team — you can't change it right now." className="text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 rounded flex items-center gap-1 opacity-70 cursor-not-allowed">
                        {STATUS_LABEL[article.status]}
                      </button>
                    ) : (
                      <button onClick={() => setPublishOpen(true)} className="text-sm px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 flex items-center gap-1" data-testid="article-publish-open">
                        <Send className="w-4 h-4" /> Publish…
                      </button>
                    )}
                    {article.status === 'changes_requested' && (
                      <button onClick={retract} className="text-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
                        <ArrowLeft className="w-4 h-4" /> Retract
                      </button>
                    )}
                    <button type="button" onClick={() => (panelOpen ? setPanelOpen(false) : openAsk())} aria-pressed={panelOpen}
                      className="text-sm px-3 py-1.5 rounded border border-violet-300 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 flex items-center gap-1" data-testid="article-ask">
                      <Sparkles className="w-4 h-4" /> Ask
                      {waiting > 0 && <span className="ml-1 text-[11px] px-1.5 rounded-full bg-violet-600 text-white" data-testid="article-ask-waiting">{waiting} waiting</span>}
                    </button>
                  </div>
              </div>
            </div>

            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
                {article.status === 'changes_requested' && reviewerNote && (
                  <div className="mb-4 px-4 py-3 border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-900/20 text-sm rounded-lg">
                    <div className="font-semibold text-orange-800 dark:text-orange-200 flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Reviewer asked for changes</div>
                    <div className="text-orange-700 dark:text-orange-300 mt-1 whitespace-pre-wrap">{reviewerNote}</div>
                  </div>
                )}
                {article.status === 'published' && article.slug && (
                  <div className="mb-4 px-4 py-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-2 text-sm rounded-lg">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Public link</span>
                    <code className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded break-all">{publicArticleUrl(article.slug)}</code>
                    <button onClick={() => copyUrl(article.slug)} className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline"><Copy className="w-3.5 h-3.5" /> Copy</button>
                  </div>
                )}
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
                <article className="bg-white dark:bg-slate-900 p-8 rounded-lg border border-slate-200 dark:border-slate-800" data-testid="article-preview">
                  {coverImg && <img src={coverImg} alt="" className="w-full rounded-lg mb-6 max-h-[360px] object-cover" />}
                  <h1 className="text-3xl font-bold">{editing.title}</h1>
                  {editing.subtitle && <p className="text-lg text-slate-600 dark:text-slate-400 mt-2">{editing.subtitle}</p>}
                  <div className="mt-6 prose dark:prose-invert max-w-none"><ReactMarkdown>{editing.body_markdown || ''}</ReactMarkdown></div>
                </article>
              ) : (
                <div className="space-y-4" data-testid="article-editor">
                  {/* AR2 — the cover slot, with Replace and Generate (AR4). */}
                  <div className="relative group">
                    {coverImg ? (
                      <img src={coverImg} alt="" className={`w-full max-h-[320px] object-cover rounded-lg border border-slate-200 dark:border-slate-700 transition-opacity ${coverUploading ? 'opacity-50' : ''}`} />
                    ) : (
                      <div className="w-full h-40 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-sm text-slate-500">No cover yet</div>
                    )}
                    {coverUploading && <span className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-600" /></span>}
                    {isEditable && (
                      <div className="absolute bottom-2 right-2 flex gap-1.5" data-testid="article-cover-toolbar">
                        <label className={`text-xs px-2.5 py-1 rounded bg-white/95 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-700 inline-flex items-center gap-1 ${coverUploading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                          <ImageIcon className="w-3.5 h-3.5" /> {coverImg ? 'Replace' : 'Upload'}
                          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={coverUploading}
                            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; uploadCover(f); }} />
                        </label>
                        <button type="button" onClick={() => setImageSheet('cover')} className="text-xs px-2.5 py-1 rounded bg-white/95 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-700 inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800">
                          <Wand2 className="w-3.5 h-3.5" /> Generate
                        </button>
                      </div>
                    )}
                  </div>
                  {coverError && (
                    <div className="text-sm rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2">{coverError}</div>
                  )}

                  {/* AR2 — the article in public type: title, subtitle, author line, tags. */}
                  <GrowingField value={editing.title} onChange={(v) => setEditing((p) => ({ ...p, title: v }))} placeholder="Title" aria-label="Title"
                    disabled={!isEditable} className="text-3xl sm:text-4xl font-bold leading-tight" />
                  <GrowingField value={editing.subtitle} onChange={(v) => setEditing((p) => ({ ...p, subtitle: v }))} placeholder="Subtitle (optional)" aria-label="Subtitle"
                    disabled={!isEditable} className="text-lg text-slate-600 dark:text-slate-300" />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>By {user?.name || user?.full_name || 'you'}</span>
                    <span>·</span>
                    <span>{liveStats.words.toLocaleString()} words · {liveStats.minutes} min read</span>
                    {(editing.tags || []).map((t) => <span key={t} className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">{t}</span>)}
                  </div>

                  {/* AR2 — the format bar and the insert menu; the body stays Markdown. */}
                  {isEditable && (
                    <div className="sticky top-[64px] z-[5] flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1.5 shadow-sm" role="toolbar" aria-label="Format" data-testid="article-format-bar">
                      {FORMAT_BUTTONS.map((b) => (
                        <button key={b.kind} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat(b.kind)} aria-label={b.label} title={b.label}
                          className={`text-xs min-w-[28px] px-1.5 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 ${b.kind === 'bold' ? 'font-bold' : b.kind === 'italic' ? 'italic' : ''}`}>{b.short}</button>
                      ))}
                      <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" aria-hidden="true" />
                      <div className="relative">
                        <button type="button" onClick={() => setSlashOpen((o) => !o)} aria-expanded={slashOpen} className="text-xs px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Insert…</button>
                        {slashOpen && (
                          <ul className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1 z-20" role="menu" data-testid="article-insert-menu">
                            {SLASH_BLOCKS.map((b) => (
                              <li key={b.kind}><button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { setSlashOpen(false); applyFormat(b.kind); }} className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">{b.label}</button></li>
                            ))}
                            <li>
                              <label className="block text-xs px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                                Upload an image
                                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={imageUploading}
                                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; setSlashOpen(false); handleImageUpload(f); }} />
                              </label>
                            </li>
                            <li><button type="button" role="menuitem" onClick={() => { setSlashOpen(false); setImageSheet('body'); }} className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">Generate an image</button></li>
                          </ul>
                        )}
                      </div>
                      <div className="flex-1" />
                      {imageUploading && <span className="text-xs inline-flex items-center gap-1 text-amber-600"><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</span>}
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => openAsk()} className="text-xs px-2 py-1 rounded text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 inline-flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> Ask
                      </button>
                    </div>
                  )}

                  <div className="relative rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 min-h-[480px] flex flex-col"
                    onDrop={(e) => {
                      e.preventDefault();
                      const files = e.dataTransfer.files;
                      if (files?.length) handleImageUpload(files[0]);
                    }}
                    onPaste={(e) => {
                      if (!e.clipboardData.files?.length) return;
                      e.preventDefault();
                      handleImageUpload(e.clipboardData.files[0]);
                    }}
                  >
                    <div className="flex-1 relative">
                      <HighlightedTextarea
                        value={editing.body_markdown}
                        onChange={onBodyChange}
                        disabled={!isEditable}
                        ranges={piiFindings}
                        textareaRef={bodyRef}
                      />
                    </div>
                    {imageError && (
                      <div className="text-xs px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-t border-red-200 dark:border-red-800">{imageError}</div>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400" data-testid="article-editor-footer">
                    <span>{liveStats.words.toLocaleString()} words · {liveStats.minutes} min read · Markdown; drag or paste images in. At least 200 characters to send.</span>
                    <span>{draftAudience(article.status)}</span>
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
          </main>
          {panelOpen && (
            <ArticleWritingPanel
              key={`${article.id}:${panelRun || ''}`}
              articleId={article.id}
              editable={isEditable}
              autoRun={panelRun}
              getContext={getContext}
              onPlace={onPlace}
              onApplySeo={onApplySeo}
              onApplyHeadline={onApplyHeadline}
              onWaiting={setWaiting}
              onClose={() => { setPanelOpen(false); setPanelRun(null); }}
            />
          )}
        </div>
      )}

      {publishOpen && article && (
        <ArticlePublishSheet
          article={article}
          editing={editing}
          setEditing={setEditing}
          sectors={sectors}
          editable={isEditable}
          slugTouched={slugTouched}
          setSlugTouched={setSlugTouched}
          saving={saving}
          submitting={submitting}
          coverSrc={coverImg}
          onClose={() => setPublishOpen(false)}
          onSave={save}
          onSubmit={async () => { await submit(); setPublishOpen(false); }}
          onAsk={canSendForReview ? openAsk : null}
          chain={chain}
          onPublishNow={() => { setPublishOpen(false); adminPublish(); }}
          publishing={publishing}
          onSchedule={scheduleAt}
          scheduling={scheduling}
        />
      )}
      {imageSheet && article && (
        <ArticleImageSheet articleId={article.id} target={imageSheet} onClose={() => setImageSheet(null)} onPlaced={onImagePlaced} />
      )}
      </div>
    </RailFrame>
  );
}
