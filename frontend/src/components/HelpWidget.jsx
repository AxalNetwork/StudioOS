/**
 * Task #7 (IG) — Help widget.
 *
 * Floating bottom-right button on every signed-in page. Opens a slide-over
 * with:
 *   • Doc search (re-uses `/api/docs/search`).
 *   • "Ask Personal Advisor" deep-link.
 *   • "Open a ticket" → /tickets (the form opens a GitHub Issue).
 *   • Context-scoped mailto rows to security@ / legal@ / billing@.
 *
 * Studio / Institutional / Partner-tier users additionally get a
 * "Chat with the Axal team" entry that opens the CustomerChatWidget.
 *
 * Hotkeys: ? opens (when no input focused), Esc closes.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LifeBuoy, X, Search, Brain, Ticket, MessageSquare, Loader2, ArrowRight,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import CustomerChatWidget from './CustomerChatWidget';

function isChatEligible(user) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'mentor' || role === 'partner') return true;
  if (role === 'investor') return String(user.investor_tier || 'free').toLowerCase() === 'institutional';
  return String(user.subscription_tier || 'free').toLowerCase() === 'studio';
}

export default function HelpWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Allow Cmd+K palette (and other components) to open the widget.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('open-help-widget', onOpen);
    return () => window.removeEventListener('open-help-widget', onOpen);
  }, []);

  // Close on Esc; "?" hotkey opens the widget when no input is focused.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
      if (e.key === '?' && !open) {
        const t = e.target;
        const tag = (t && t.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Doc search — debounced, calls /api/docs/search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/docs/search?q=${encodeURIComponent(term)}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('search failed');
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items
          : Array.isArray(data?.results) ? data.results
          : [];
        setResults(items.slice(0, 6));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  // Context-scoped mailto subject so support gets the page + role.
  const mailtoBody = useMemo(() => {
    const lines = [
      `Path: ${location.pathname}${location.search || ''}`,
      `Role: ${user?.role || 'unknown'}`,
      `User: ${user?.email || ''}`,
      '',
      '— please describe your question below —',
    ];
    return encodeURIComponent(lines.join('\n'));
  }, [location, user]);

  const mailto = useCallback((to, subject) =>
    `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${mailtoBody}`,
  [mailtoBody]);

  const goAdvisor = () => { setOpen(false); navigate('/dashboard?advisor=1'); };
  const goTicket = () => { setOpen(false); navigate('/tickets'); };
  const openDoc = (anchor) => {
    setOpen(false);
    if (anchor) navigate(`/docs#${anchor}`);
    else navigate('/docs');
  };

  if (!user) return null;
  const showChat = isChatEligible(user);

  return (
    <>
      {/* Floating launcher — hidden when the slide-over is open to avoid overlap. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open help"
          title="Help (?)"
          className="fixed bottom-5 right-5 z-[150] w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-lg flex items-center justify-center transition-colors print:hidden"
        >
          <LifeBuoy size={20} />
        </button>
      )}

      {/* Slide-over panel. */}
      {open && (
        <div
          className="fixed inset-0 z-[160] flex justify-end print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Help"
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md h-full bg-white dark:bg-gray-900 shadow-2xl flex flex-col border-l border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <LifeBuoy size={18} className="text-violet-600 dark:text-violet-300" />
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">How can we help?</h2>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close help" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Doc search */}
              <section>
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 block">Search the docs</label>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="e.g. invite a co-founder"
                    className="w-full pl-8 pr-2 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  />
                  {searching && <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
                </div>
                {results.length > 0 && (
                  <ul className="mt-2 border border-gray-200 dark:border-gray-800 rounded-md divide-y divide-gray-100 dark:divide-gray-800">
                    {results.map((r, i) => {
                      const anchor = r.anchor || (r.sectionId && r.subsectionId ? `${r.sectionId}/${r.subsectionId}` : '');
                      const title = r.subsectionTitle || r.title || r.label || anchor;
                      const hint = r.sectionTitle || '';
                      return (
                        <li key={r.id || anchor || i}>
                          <button
                            type="button"
                            onClick={() => openDoc(anchor)}
                            className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                          >
                            <span className="flex-1 truncate">{title}</span>
                            {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
                            <ArrowRight size={12} className="text-gray-300" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {q.trim().length >= 2 && !searching && results.length === 0 && (
                  <div className="mt-2 text-xs text-gray-500">No matching docs. Try another phrase or open a ticket below.</div>
                )}
              </section>

              {/* Primary actions */}
              <section className="space-y-2">
                <HelpRow icon={<Brain size={16} />} title="Ask Personal Advisor" hint="The AI advisor knows your projects." onClick={goAdvisor} />
                {showChat && (
                  <HelpRow
                    icon={<MessageSquare size={16} />}
                    title="Chat with the Axal team"
                    hint="Connects you to Slack — usually replies within a business day."
                    onClick={() => setChatOpen(true)}
                  />
                )}
                <HelpRow icon={<Ticket size={16} />} title="Open a ticket" hint="Files a tracked support ticket." onClick={goTicket} />
              </section>

              {!showChat && (
                <section className="mt-2 text-[11px] text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-3">
                  Live chat with the Axal team is included on the Studio, Institutional, and Partner plans.
                </section>
              )}
            </div>
            <div className="px-5 py-2 border-t border-gray-200 dark:border-gray-800 text-[10px] text-gray-400 flex justify-between">
              <span>Press <kbd className="px-1 border border-gray-200 dark:border-gray-700 rounded">?</kbd> to open</span>
              <span>Press <kbd className="px-1 border border-gray-200 dark:border-gray-700 rounded">Esc</kbd> to close</span>
            </div>
          </div>
        </div>
      )}

      {showChat && <CustomerChatWidget open={chatOpen} onClose={() => setChatOpen(false)} />}
    </>
  );
}

function HelpRow({ icon, title, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-gray-200 dark:border-gray-800 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50/40 dark:hover:bg-violet-900/20 text-left transition-colors"
    >
      <span className="text-violet-600 dark:text-violet-300">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{title}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
      <ArrowRight size={14} className="text-gray-300" />
    </button>
  );
}
