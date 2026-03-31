import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Ticket, Plus, ChevronDown } from 'lucide-react';

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

export default function TicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium' });

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';

  const load = () => {
    setLoading(true);
    api.listTickets().then(setTickets).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async () => {
    try {
      await api.createTicket(form);
      setShowForm(false);
      setForm({ title: '', description: '', priority: 'medium' });
      load();
    } catch (e) { alert(e.message); }
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Support Hub</h1>
          <p className="text-sm text-gray-600">
            {isAdmin ? 'All user tickets — ticket management and operations support' : 'Your tickets — submit and track support requests'}
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm font-medium text-white transition-colors">
          <Plus size={14} /> New Ticket
        </button>
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
            <button onClick={submit} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm text-white font-medium transition-colors">Submit Ticket</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
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
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="text-gray-900">{t.title}</div>
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
      </div>
    </div>
  );
}
