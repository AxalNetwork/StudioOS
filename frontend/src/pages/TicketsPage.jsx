import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { Ticket, Plus, ChevronDown, X, RefreshCw, MessageSquare, Clock, ArrowLeft, ExternalLink } from 'lucide-react';

function ModernSelect({ value, onChange, children, ...props }) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} {...props}
        className="w-full bg-white text-gray-900 border border-gray-300 rounded-lg px-4 py-2.5 text-sm appearance-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all cursor-pointer hover:border-gray-400">
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

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900">{ticket.title}</h2>
            <div className="flex items-center gap-3 mt-2">
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${priorityColors[ticket.priority]}`}>{ticket.priority}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[ticket.status]}`}>{ticket.status?.replace('_', ' ')}</span>
              {ticket.github_issue_number && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  GitHub #{ticket.github_issue_number}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 text-gray-400 hover:text-violet-600 transition-colors" title="Refresh">
              <RefreshCw size={14} />
            </button>
            {ticket.github_issue_url && (
              <a href={ticket.github_issue_url} target="_blank" rel="noopener noreferrer"
                className="p-2 text-gray-400 hover:text-violet-600 transition-colors" title="View on GitHub">
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>

        {ticket.description && (
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-500">
          <div>
            <span className="block text-gray-400 mb-0.5">Submitted by</span>
            <span className="text-gray-700">{ticket.submitted_by || 'Unknown'}</span>
          </div>
          <div>
            <span className="block text-gray-400 mb-0.5">Created</span>
            <span className="text-gray-700">{ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : '—'}</span>
          </div>
          <div>
            <span className="block text-gray-400 mb-0.5">Last updated</span>
            <span className="text-gray-700">{ticket.updated_at ? new Date(ticket.updated_at).toLocaleDateString() : '—'}</span>
          </div>
          {ticket.assigned_to && (
            <div>
              <span className="block text-gray-400 mb-0.5">Assigned to</span>
              <span className="text-gray-700">{ticket.assigned_to}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <MessageSquare size={14} />
          Comments {ticket.comments?.length > 0 && <span className="text-gray-400 font-normal">({ticket.comments.length})</span>}
        </h3>

        {(!ticket.comments || ticket.comments.length === 0) ? (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500">No comments yet.</p>
            {ticket.github_issue_url && (
              <p className="text-xs text-gray-400 mt-1">Comments posted on the GitHub issue will appear here automatically.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {ticket.comments.map(comment => (
              <div key={comment.id} className="border border-gray-100 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {comment.author_avatar && (
                    <img src={comment.author_avatar} alt="" className="w-5 h-5 rounded-full" />
                  )}
                  <span className="text-xs font-medium text-gray-700">{comment.author}</span>
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock size={10} />
                    {new Date(comment.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{comment.body}</div>
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

  const user = JSON.parse(localStorage.getItem('user') || '{}');
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
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Support Hub</h1>
          <p className="text-sm text-gray-600">
            {isAdmin ? 'All user tickets — ticket management and operations support' : 'Your tickets — submit and track support requests'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncFromGithub} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-600 transition-colors disabled:opacity-50"
            title="Sync statuses from GitHub">
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm font-medium text-white transition-colors">
            <Plus size={14} /> New Ticket
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h2 className="font-semibold text-gray-900 text-sm mb-4">Submit a Support Ticket</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Title</label>
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Brief description of the issue"
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:border-violet-500 focus:outline-none" />
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
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 resize-vertical min-h-[100px] focus:border-violet-500 focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={submit} disabled={submitting} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm text-white font-medium transition-colors disabled:opacity-50">{submitting ? 'Submitting...' : 'Submit Ticket'}</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase">
                <th className="text-left px-5 py-3">Title</th>
                {isAdmin && <th className="text-left px-5 py-3 hidden md:table-cell">Submitted By</th>}
                <th className="text-left px-5 py-3">Priority</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3 hidden lg:table-cell">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tickets.map(t => (
                <tr key={t.id} className="hover:bg-violet-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedTicketId(t.id)}>
                  <td className="px-5 py-3">
                    <div className="text-gray-900 hover:text-violet-600 transition-colors">{t.title}</div>
                    {t.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{t.description}</div>}
                    {t.github_issue_number && (
                      <div className="text-[10px] text-gray-400 mt-0.5">GitHub #{t.github_issue_number}</div>
                    )}
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
      </div>
    </div>
  );
}
