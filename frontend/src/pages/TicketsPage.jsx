import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { safeReadJSON } from '../lib/storage';
import { api } from '../lib/api';
import {
  Ticket, Plus, ChevronDown, X, RefreshCw, MessageSquare, Clock, ArrowLeft,
  LifeBuoy, Search, Brain, Loader2, ArrowRight,
} from 'lucide-react';
import VirtualList from '../components/VirtualList';
import CustomerChatWidget from '../components/CustomerChatWidget';
import { useAuth } from '../hooks/useAuthSync';

// Mirrors the worker's tier gate: paid (Studio / Institutional) founders &
// investors, plus admin / mentor / partner, get live chat with the team.
function isChatEligible(user) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'mentor' || role === 'partner') return true;
  if (role === 'investor') return String(user.investor_tier || 'free').toLowerCase() === 'institutional';
  return String(user.subscription_tier || 'free').toLowerCase() === 'studio';
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

// "How can we help?" panel — the four options that used to live in the
// floating Help widget, now surfaced inside the Support Hub.
function SupportHelpPanel({ onOpenTicket }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Doc search — debounced, calls /api/docs/search.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setSearching(false); return; }
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
  }, [q]);

  const openDoc = (anchor) => {
    if (anchor) navigate(`/docs#${anchor}`);
    else navigate('/docs');
  };

  const showChat = isChatEligible(user);

  return (
    <aside className="lg:sticky lg:top-20">
      <div className="bg-white border border-gray-200 rounded-xl dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-200 dark:border-gray-800">
          <LifeBuoy size={18} className="text-violet-600 dark:text-violet-300" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">How can we help?</h2>
        </div>

        <div className="p-5 space-y-5">
          {/* Doc search */}
          <section>
            <label htmlFor="support-docs-search" className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 block">Search the docs</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="support-docs-search"
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
            <HelpRow icon={<Brain size={16} />} title="Ask Personal Advisor" hint="The AI advisor knows your projects." onClick={() => navigate('/studio?advisor=1')} />
            {showChat && (
              <HelpRow
                icon={<MessageSquare size={16} />}
                title="Chat with the Axal VC team"
                hint="Connects you to Slack — usually replies within a business day."
                onClick={() => setChatOpen(true)}
              />
            )}
            <HelpRow icon={<Ticket size={16} />} title="Open a ticket" hint="Files a tracked support ticket." onClick={onOpenTicket} />
          </section>

          {!showChat && (
            <section className="text-[11px] text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-3">
              Live chat with the Axal VC team is included on the Studio, Institutional, and Partner plans.
            </section>
          )}
        </div>
      </div>

      {showChat && <CustomerChatWidget open={chatOpen} onClose={() => setChatOpen(false)} />}
    </aside>
  );
}

// T24 — Title + 1-line description + py-3.
const TICKET_ROW_HEIGHT = 64;
// `RefreshCw` is still used by the in-detail "Refresh" button (TicketDetail).

function ModernSelect({ value, onChange, children, ...props }) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} {...props}
        className="w-full bg-white text-gray-900 border border-gray-300 rounded-lg px-4 py-2.5 text-sm appearance-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all cursor-pointer hover:border-gray-400 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">
        {children}
      </select>
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
    </div>
  );
}

function TicketDetail({ ticketId, onBack }) {
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.getTicket(ticketId)
      .then(setTicket)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const priorityColors = {
    low: 'bg-gray-200 text-gray-700',
    medium: 'bg-blue-100 text-blue-700',
    high: 'bg-amber-100 text-amber-700',
    urgent: 'bg-red-100 text-red-700',
  };

  const statusColors = {
    open: 'bg-amber-100 text-amber-700',
    in_progress: 'bg-blue-100 text-blue-700',
    resolved: 'bg-emerald-100 text-emerald-700',
    closed: 'bg-gray-200 text-gray-700',
  };

  if (loading) return (
    <div className="p-8 text-center text-gray-600 text-sm">Loading ticket details...</div>
  );

  if (error) return (
    <div className="p-8 text-center">
      <p className="text-red-600 text-sm mb-4">{error}</p>
      <button onClick={onBack} className="text-violet-600 text-sm hover:underline">Back to tickets</button>
    </div>
  );

  if (!ticket) return null;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-violet-600 mb-4 transition-colors">
        <ArrowLeft size={14} /> Back to tickets
      </button>

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{ticket.title}</h2>
            <div className="flex items-center gap-3 mt-2">
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${priorityColors[ticket.priority]}`}>{ticket.priority}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[ticket.status]}`}>{ticket.status?.replace('_', ' ')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 text-gray-400 hover:text-violet-600 transition-colors" title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {ticket.description && (
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-700 whitespace-pre-wrap dark:text-gray-300">{ticket.description}</p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-500">
          <div>
            <span className="block text-gray-400 mb-0.5">Submitted by</span>
            <span className="text-gray-700 dark:text-gray-300">{ticket.submitted_by || 'Unknown'}</span>
          </div>
          <div>
            <span className="block text-gray-400 mb-0.5">Created</span>
            <span className="text-gray-700 dark:text-gray-300">{ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : '—'}</span>
          </div>
          <div>
            <span className="block text-gray-400 mb-0.5">Last updated</span>
            <span className="text-gray-700 dark:text-gray-300">{ticket.updated_at ? new Date(ticket.updated_at).toLocaleDateString() : '—'}</span>
          </div>
          {ticket.assigned_to && (
            <div>
              <span className="block text-gray-400 mb-0.5">Assigned to</span>
              <span className="text-gray-700 dark:text-gray-300">{ticket.assigned_to}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 dark:bg-gray-900 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2 dark:text-gray-100">
          <MessageSquare size={14} />
          Comments {ticket.comments?.length > 0 && <span className="text-gray-400 font-normal">({ticket.comments.length})</span>}
        </h3>

        {(!ticket.comments || ticket.comments.length === 0) ? (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500">No comments yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {ticket.comments.map(comment => (
              <div key={comment.id} className="border border-gray-100 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {comment.author_avatar && (
                    <img src={comment.author_avatar} alt="" className="w-5 h-5 rounded-full" />
                  )}
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{comment.author}</span>
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock size={10} />
                    {new Date(comment.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap dark:text-gray-300">{comment.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium' });
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const user = safeReadJSON('user', {});
  const isAdmin = user.role === 'admin';

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.listTickets()
      .then(setTickets)
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const syncFromGithub = useCallback(() => {
    setSyncing(true);
    api.syncTickets()
      .then(data => {
        if (data.tickets) setTickets(data.tickets);
      })
      .catch(() => {})
      .finally(() => setSyncing(false));
  }, []);

  useEffect(() => {
    load();
    syncFromGithub();
    const interval = setInterval(syncFromGithub, 60000);
    return () => clearInterval(interval);
  }, []);

  const submit = async () => {
    if (!form.title.trim()) return alert('Please enter a ticket title.');
    setSubmitting(true);
    try {
      await api.createTicket(form);
      setShowForm(false);
      setForm({ title: '', description: '', priority: 'medium' });
      load();
    } catch (e) { alert(e.message); }
    finally { setSubmitting(false); }
  };

  const priorityColors = {
    low: 'bg-gray-200 text-gray-700',
    medium: 'bg-blue-100 text-blue-700',
    high: 'bg-amber-100 text-amber-700',
    urgent: 'bg-red-100 text-red-700',
  };

  const statusColors = {
    open: 'bg-amber-100 text-amber-700',
    in_progress: 'bg-blue-100 text-blue-700',
    resolved: 'bg-emerald-100 text-emerald-700',
    closed: 'bg-gray-200 text-gray-700',
  };

  if (selectedTicketId) {
    return <TicketDetail ticketId={selectedTicketId} onBack={() => { setSelectedTicketId(null); load(); syncFromGithub(); }} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1 dark:text-gray-100">Support Hub</h1>
          <p className="text-sm text-gray-600">
            {isAdmin ? 'All user tickets — ticket management and operations support' : 'Your tickets — submit and track support requests'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm font-medium text-white transition-colors">
            <Plus size={14} /> New Ticket
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 text-sm mb-4 dark:text-gray-100">Submit a Support Ticket</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Title</label>
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Brief description of the issue"
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-medium">Priority</label>
              <ModernSelect value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </ModernSelect>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={4}
                placeholder="Provide details about the issue..."
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 resize-vertical min-h-[100px] focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:text-gray-100" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={submit} disabled={submitting} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm text-white font-medium transition-colors disabled:opacity-50">{submitting ? 'Submitting...' : 'Submit Ticket'}</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors dark:text-gray-300">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        {loadError ? (
          <div className="p-8 text-center">
            <p className="text-red-600 text-sm mb-2">Failed to load tickets</p>
            <button onClick={load} className="text-violet-600 text-sm hover:underline">Try again</button>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-gray-600 text-sm">Loading...</div>
        ) : tickets.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            {isAdmin ? 'No tickets submitted yet' : 'You have no tickets yet. Click "New Ticket" to submit one.'}
          </div>
        ) : (
          <VirtualList
            items={tickets}
            itemHeight={TICKET_ROW_HEIGHT}
            height={600}
            ariaLabel={`Tickets list, ${tickets.length} tickets`}
            virtualRow={(t, _i, style, ariaAttributes) => {
              const cols = isAdmin
                ? 'minmax(0, 2fr) minmax(0, 1fr) 100px 110px 110px'
                : 'minmax(0, 2fr) 100px 110px 110px';
              return (
                <div style={style} {...ariaAttributes}
                     onClick={() => setSelectedTicketId(t.id)}
                     className="hover:bg-violet-50 cursor-pointer transition-colors border-b border-gray-100 text-sm">
                  <div style={{ display: 'grid', gridTemplateColumns: cols, alignItems: 'center', height: '100%' }}>
                    <div className="px-5 py-3 min-w-0">
                      <div className="text-gray-900 hover:text-violet-600 transition-colors truncate dark:text-gray-100">{t.title}</div>
                      {t.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{t.description}</div>}
                    </div>
                    {isAdmin && <div className="px-5 py-3 hidden md:block text-gray-600 truncate">{t.submitted_by || '—'}</div>}
                    <div className="px-5 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${priorityColors[t.priority]}`}>{t.priority}</span>
                    </div>
                    <div className="px-5 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[t.status]}`}>{t.status?.replace('_', ' ')}</span>
                    </div>
                    <div className="px-5 py-3 hidden lg:block text-xs text-gray-500">
                      {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                    </div>
                  </div>
                </div>
              );
            }}
          >
            {(items) => (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase dark:border-gray-800">
                    <th className="text-left px-5 py-3">Title</th>
                    {isAdmin && <th className="text-left px-5 py-3 hidden md:table-cell">Submitted By</th>}
                    <th className="text-left px-5 py-3">Priority</th>
                    <th className="text-left px-5 py-3">Status</th>
                    <th className="text-left px-5 py-3 hidden lg:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map(t => (
                    <tr key={t.id} className="hover:bg-violet-50 cursor-pointer transition-colors"
                        onClick={() => setSelectedTicketId(t.id)}>
                      <td className="px-5 py-3">
                        <div className="text-gray-900 hover:text-violet-600 transition-colors dark:text-gray-100">{t.title}</div>
                        {t.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{t.description}</div>}
                      </td>
                      {isAdmin && <td className="px-5 py-3 hidden md:table-cell text-gray-600">{t.submitted_by || '—'}</td>}
                      <td className="px-5 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${priorityColors[t.priority]}`}>{t.priority}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[t.status]}`}>{t.status?.replace('_', ' ')}</span>
                      </td>
                      <td className="px-5 py-3 hidden lg:table-cell text-xs text-gray-500">
                        {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </VirtualList>
        )}
      </div>
        </div>

        <SupportHelpPanel
          onOpenTicket={() => {
            setShowForm(true);
            if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      </div>
    </div>
  );
}
