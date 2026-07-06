/**
 * Task #7 (IG) — Cmd+K command palette.
 *
 * Four sources, fuzzy-matched client-side via Fuse.js:
 *   1. Pages — sidebar entries filtered by role + tier (and not locked).
 *   2. Recent activity — last 20 of the user's own activity_logs.
 *   3. Documentation anchors — flattened from the docs manifest.
 *   4. Quick actions — Create project / Send NDA / Run scoring / Open advisor.
 *
 * Index built on mount, refreshed every 5 minutes. Hotkey: Cmd+K / Ctrl+K
 * to toggle, Esc to close, ↑↓ to navigate, Enter to activate.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import {
  Search, ArrowRight, Compass, Activity, BookOpen, Sparkles, Loader2, FileText,
} from 'lucide-react';
import { api, articles as articlesApi } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { SIDEBAR_GROUPS, hasTier, hasInvestorTier } from '../sidebarConfig';
import { SECTIONS, filterSectionsForRole } from '../pages/docs/sections';

const REFRESH_MS = 5 * 60 * 1000;

const KIND_META = {
  page:     { label: 'Pages',           icon: Compass },
  action:   { label: 'Quick actions',   icon: Sparkles },
  article:  { label: 'Articles',        icon: FileText },
  activity: { label: 'Recent activity', icon: Activity },
  doc:      { label: 'Documentation',   icon: BookOpen },
};
const KIND_ORDER = ['page', 'action', 'article', 'activity', 'doc'];

// Quick actions — role/tier-gated. Handler receives (navigate) and is
// responsible for closing-side-effects (palette closes itself on any
// activation, so no need to call close() inside).
const QUICK_ACTIONS = [
  {
    id: 'qa.create-project',
    label: 'Create startup',
    hint: 'New venture-studio project',
    roles: ['admin', 'founder', 'partner'],
    run: (nav) => nav('/projects?new=1'),
  },
  {
    id: 'qa.send-nda',
    label: 'Send NDA',
    hint: 'Open the legal docs surface',
    roles: ['admin', 'founder', 'partner', 'investor'],
    run: (nav) => nav('/legal'),
  },
  {
    id: 'qa.run-scoring',
    label: 'Run scoring',
    hint: 'Score an opportunity',
    roles: ['admin', 'founder', 'partner', 'investor'],
    run: (nav) => nav('/scoring'),
  },
  {
    id: 'qa.open-advisor',
    label: 'Open Personal Advisor',
    hint: 'Ask the AI advisor',
    roles: ['admin', 'founder', 'partner', 'investor', 'advisor'],
    run: (nav) => nav('/studio?advisor=1'),
  },
  {
    id: 'qa.open-help',
    label: 'Open Help',
    hint: 'Docs, ticket, contact options',
    roles: ['admin', 'founder', 'partner', 'investor', 'advisor'],
    run: (nav) => nav('/tickets'),
  },
];

function buildPageItems(role, user) {
  const groups = SIDEBAR_GROUPS[role] || SIDEBAR_GROUPS.founder || [];
  const out = [];
  for (const g of groups) {
    for (const it of g.items || []) {
      // Drop items the user can't afford — Cmd+K should not jump into a
      // paywall flow, and the locked rail tile already provides that path.
      if (it.requiredTier && !hasTier(user, it.requiredTier)) continue;
      if (it.requiredInvestorTier && !hasInvestorTier(user, it.requiredInvestorTier)) continue;
      out.push({
        id: `page:${it.to}`,
        kind: 'page',
        label: it.label,
        hint: g.label,
        to: it.to,
      });
    }
  }
  return out;
}

function buildDocItems(role) {
  const sections = filterSectionsForRole(SECTIONS, role || 'founder');
  const out = [];
  for (const sec of sections) {
    for (const sub of sec.subsections || []) {
      out.push({
        id: `doc:${sec.id}/${sub.id}`,
        kind: 'doc',
        label: sub.title,
        hint: sec.title,
        to: `/docs#${sec.id}/${sub.id}`,
      });
    }
  }
  return out;
}

function buildQuickActions(role) {
  const r = String(role || '').toLowerCase();
  return QUICK_ACTIONS.filter((a) => !a.roles || a.roles.includes(r)).map((a) => ({
    id: a.id,
    kind: 'action',
    label: a.label,
    hint: a.hint,
    run: a.run,
  }));
}

function summarizeActivity(row) {
  const action = String(row?.action || 'event');
  let details = '';
  if (row?.details) {
    try {
      const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      if (d && typeof d === 'object') {
        details = d.summary || d.title || d.project_name || d.name || '';
      }
    } catch { details = String(row.details).slice(0, 80); }
  }
  const label = details ? `${action} — ${details}` : action;
  return label.length > 80 ? label.slice(0, 77) + '…' : label;
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [articleItems, setArticleItems] = useState([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const lastFetchRef = useRef(0);
  const lastArticlesFetchRef = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
    setActiveIdx(0);
  }, []);

  // Global hotkey listener — mounted once.
  useEffect(() => {
    function onKey(e) {
      const isToggle = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
      if (isToggle) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Recent activity fetch — on open and every REFRESH_MS while mounted.
  const refreshActivity = useCallback(async () => {
    if (!user) return;
    const now = Date.now();
    if (now - lastFetchRef.current < REFRESH_MS && activity.length > 0) return;
    lastFetchRef.current = now;
    setLoadingActivity(true);
    try {
      const res = await api.getRecentActivity(20);
      setActivity(Array.isArray(res?.items) ? res.items : []);
    } catch { /* silent — palette stays usable without activity */ }
    finally { setLoadingActivity(false); }
  }, [user, activity.length]);

  // Published articles — same 5-min refresh pattern as recent activity.
  // Fresh fetch on open if the cache is stale, otherwise reuse.
  const refreshArticles = useCallback(async () => {
    const now = Date.now();
    if (now - lastArticlesFetchRef.current < REFRESH_MS && articleItems.length > 0) return;
    lastArticlesFetchRef.current = now;
    setLoadingArticles(true);
    try {
      const res = await articlesApi.list({ limit: 50 });
      const items = Array.isArray(res?.items) ? res.items : [];
      setArticleItems(items.filter((a) => a && a.slug));
    } catch { /* silent — palette stays usable without articles */ }
    finally { setLoadingArticles(false); }
  }, [articleItems.length]);

  useEffect(() => {
    if (!open) return;
    refreshActivity();
    refreshArticles();
  }, [open, refreshActivity, refreshArticles]);

  // Focus + scroll input into view when opening.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Static-ish indexes — rebuilt only when role/user/activity changes.
  const allItems = useMemo(() => {
    if (!user) return [];
    const r = role || user.role || 'founder';
    const pages = buildPageItems(r, user);
    const actions = buildQuickActions(r);
    const docs = buildDocItems(r);
    const activityItems = activity.map((row, i) => ({
      id: `activity:${row.id || i}`,
      kind: 'activity',
      label: summarizeActivity(row),
      hint: row.created_at ? new Date(row.created_at).toLocaleString() : '',
      row,
    }));
    const articleResults = articleItems.map((a) => ({
      id: `article:${a.id || a.slug}`,
      kind: 'article',
      label: a.title || a.slug,
      hint: a.author || a.author_role || '',
      to: `/articles/${a.slug}`,
    }));
    return [...pages, ...actions, ...articleResults, ...activityItems, ...docs];
  }, [user, role, activity, articleItems]);

  const fuse = useMemo(() => {
    return new Fuse(allItems, {
      keys: [
        { name: 'label', weight: 0.7 },
        { name: 'hint', weight: 0.3 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: 1,
    });
  }, [allItems]);

  const grouped = useMemo(() => {
    const matched = q.trim()
      ? fuse.search(q.trim()).slice(0, 60).map((r) => r.item)
      : allItems.slice(0, 60);
    const out = { page: [], action: [], activity: [], doc: [] };
    for (const it of matched) {
      if (out[it.kind]) out[it.kind].push(it);
    }
    return out;
  }, [q, fuse, allItems]);

  const flat = useMemo(() => {
    const out = [];
    for (const k of KIND_ORDER) for (const it of grouped[k] || []) out.push(it);
    return out;
  }, [grouped]);

  useEffect(() => { setActiveIdx(0); }, [q, open]);

  const activate = useCallback((item) => {
    if (!item) return;
    if (item.kind === 'action' && typeof item.run === 'function') {
      try { item.run(navigate); } catch { /* ignore */ }
    } else if (item.to) {
      navigate(item.to);
    } else if (item.kind === 'activity') {
      // No deep-link for an activity row by default; just close.
    }
    close();
  }, [navigate, close]);

  // Arrow / Enter handling — only when palette is open.
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(flat[activeIdx]);
    }
  };

  // Scroll the active row into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  if (!open) return null;

  let cursor = -1;
  return (
    <div
      className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, action, doc, or recent event…"
            className="flex-1 bg-transparent text-sm outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
            aria-label="Search command palette"
          />
          {(loadingActivity || loadingArticles) && <Loader2 size={14} className="animate-spin text-gray-400" />}
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {flat.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-500 text-center">No matches.</div>
          )}
          {KIND_ORDER.map((kind) => {
            const items = grouped[kind] || [];
            if (items.length === 0) return null;
            const Meta = KIND_META[kind];
            const Icon = Meta.icon;
            return (
              <div key={kind} className="py-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 font-semibold flex items-center gap-1.5">
                  <Icon size={11} />{Meta.label}
                </div>
                {items.map((it) => {
                  cursor += 1;
                  const isActive = cursor === activeIdx;
                  const idx = cursor;
                  return (
                    <button
                      key={it.id}
                      data-idx={idx}
                      type="button"
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => activate(it)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2 text-sm ${
                        isActive
                          ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-200'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.hint && (
                        <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[40%]">{it.hint}</span>
                      )}
                      <ArrowRight size={12} className="text-gray-300 dark:text-gray-600 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-t border-gray-200 dark:border-gray-800 text-[10px] text-gray-400">
          <div className="flex gap-3">
            <span><kbd className="px-1 border border-gray-200 dark:border-gray-700 rounded">↑↓</kbd> navigate</span>
            <span><kbd className="px-1 border border-gray-200 dark:border-gray-700 rounded">Enter</kbd> open</span>
            <span><kbd className="px-1 border border-gray-200 dark:border-gray-700 rounded">Esc</kbd> close</span>
          </div>
          <span>{flat.length} result{flat.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
