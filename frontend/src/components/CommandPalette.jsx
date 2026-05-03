import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Loader2, Briefcase, Handshake, Rocket, Users,
  FileText, GraduationCap, ArrowRight, X,
} from 'lucide-react';
import { api } from '../lib/api';

// Phase 0.2 — Global cmd-K command palette.
// Listens for ⌘K / Ctrl+K anywhere in the authed shell, calls
// /api/search?grouped=1, and renders one section per entity type with
// keyboard navigation (↑↓ + Enter, Esc to close). Hits deep-link via
// react-router so we never bounce through a full page load.

const TYPE_META = {
  project:        { label: 'Projects',        icon: Briefcase },
  deal:           { label: 'Deals',           icon: Handshake },
  founder:        { label: 'Founders',        icon: Rocket },
  partner:        { label: 'Partners',        icon: Users },
  document:       { label: 'Documents',       icon: FileText },
  academy_lesson: { label: 'Academy Lessons', icon: GraduationCap },
};

// Render order — projects/deals first because they dominate intent.
const TYPE_ORDER = ['project', 'deal', 'founder', 'partner', 'document', 'academy_lesson'];

export default function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  // Flatten groups in render order so ↑↓ traversal matches what's on screen.
  const flatHits = useMemo(() => {
    const out = [];
    for (const t of TYPE_ORDER) {
      const list = groups[t] || [];
      for (const h of list) out.push(h);
    }
    return out;
  }, [groups]);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
    setGroups({});
    setActiveIdx(0);
    setWarning('');
  }, []);

  // Global cmd-K / ctrl-K listener. Mounted once on the shell; toggles
  // open and selects the input on next paint so the user can type
  // immediately.
  useEffect(() => {
    function onKey(e) {
      const isToggle = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
      if (isToggle) {
        e.preventDefault();
        setOpen(o => !o);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Focus input when opening.
  useEffect(() => {
    if (open) {
      // requestAnimationFrame so the input is mounted before focus().
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced search. reqIdRef guards against out-of-order responses
  // when the user types fast enough to overlap requests.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) { setGroups({}); setLoading(false); setWarning(''); setActiveIdx(0); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    const myId = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.searchSemantic(term, undefined, 8, true);
        if (myId !== reqIdRef.current) return;
        setGroups(res.groups || {});
        setWarning(res.warning || '');
        setActiveIdx(0);
      } catch (e) {
        if (myId !== reqIdRef.current) return;
        setGroups({});
        setWarning(e.message || 'Search failed');
      } finally {
        if (myId === reqIdRef.current) setLoading(false);
      }
    }, 200);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [q, open]);

  const go = useCallback((hit) => {
    if (!hit) return;
    close();
    if (hit.url) navigate(hit.url);
  }, [close, navigate]);

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(flatHits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(flatHits[activeIdx]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <Search size={18} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search projects, deals, founders, partners, documents, lessons…"
            className="flex-1 outline-none text-sm bg-transparent placeholder-gray-400"
          />
          {loading && <Loader2 size={16} className="animate-spin text-gray-400" />}
          <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] text-gray-500 border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50">esc</kbd>
          <button onClick={close} className="text-gray-400 hover:text-gray-600 sm:hidden" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {warning && (
            <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">{warning}</div>
          )}
          {!q.trim() && (
            <div className="px-4 py-10 text-center text-sm text-gray-500">
              Start typing to search across the studio.
              <div className="mt-2 text-xs text-gray-400">
                Press <kbd className="border border-gray-200 rounded px-1 bg-gray-50">↑</kbd>
                {' '}<kbd className="border border-gray-200 rounded px-1 bg-gray-50">↓</kbd>{' '}to navigate,
                {' '}<kbd className="border border-gray-200 rounded px-1 bg-gray-50">enter</kbd>{' '}to open.
              </div>
            </div>
          )}
          {q.trim() && !loading && flatHits.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-gray-500">No matches for “{q}”.</div>
          )}

          {TYPE_ORDER.map(t => {
            const list = groups[t] || [];
            if (!list.length) return null;
            const meta = TYPE_META[t];
            const Icon = meta?.icon || Search;
            return (
              <div key={t} className="py-2">
                <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {meta?.label || t}
                </div>
                <ul>
                  {list.map((h) => {
                    const idx = flatHits.indexOf(h);
                    const isActive = idx === activeIdx;
                    return (
                      <li key={h.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setActiveIdx(idx)}
                          onClick={() => go(h)}
                          className={`w-full text-left px-4 py-2 flex items-start gap-3 ${
                            isActive ? 'bg-violet-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <Icon size={16} className={`mt-0.5 shrink-0 ${isActive ? 'text-violet-600' : 'text-gray-400'}`} />
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm font-medium truncate ${isActive ? 'text-violet-900' : 'text-gray-900'}`}>
                              {h.title}
                            </div>
                            {h.snippet && (
                              <div className="text-xs text-gray-500 truncate">{h.snippet}</div>
                            )}
                          </div>
                          <ArrowRight size={14} className={`mt-1 shrink-0 ${isActive ? 'text-violet-500' : 'text-gray-300'}`} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="hidden sm:flex items-center justify-between gap-3 px-4 py-2 border-t border-gray-100 text-[10px] text-gray-500 bg-gray-50">
          <div className="flex items-center gap-2">
            <kbd className="border border-gray-200 rounded px-1 bg-white">↑</kbd>
            <kbd className="border border-gray-200 rounded px-1 bg-white">↓</kbd>
            <span>navigate</span>
            <kbd className="border border-gray-200 rounded px-1 bg-white ml-2">enter</kbd>
            <span>open</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="border border-gray-200 rounded px-1 bg-white">⌘</kbd>
            <kbd className="border border-gray-200 rounded px-1 bg-white">K</kbd>
            <span>toggle</span>
          </div>
        </div>
      </div>
    </div>
  );
}
