import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { StatusBadge, WeekBadge } from './Dashboard';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ name: '', description: '', sector: '', founder_email: '', founder_name: '', problem_statement: '', solution: '' });

  const load = () => {
    setLoading(true);
    api.listProjects().then(setProjects).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async () => {
    try {
      await api.createProject(form);
      setShowForm(false);
      setForm({ name: '', description: '', sector: '', founder_email: '', founder_name: '', problem_statement: '', solution: '' });
      load();
    } catch (e) { alert(e.message); }
  };

  const filtered = projects.filter(p =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.sector?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Projects</h1>
          <p className="text-sm text-gray-600">Venture pipeline & 4-week playbook tracking</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white transition-colors">
          <Plus size={14} /> New Project
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h2 className="font-semibold text-gray-900 text-sm mb-4">Add New Project</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Project Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
            <Input label="Sector" value={form.sector} onChange={v => setForm(f => ({ ...f, sector: v }))} />
            <Input label="Founder Name" value={form.founder_name} onChange={v => setForm(f => ({ ...f, founder_name: v }))} />
            <Input label="Founder Email" value={form.founder_email} onChange={v => setForm(f => ({ ...f, founder_email: v }))} />
            <div className="md:col-span-2">
              <Input label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} />
            </div>
            <Input label="Problem Statement" value={form.problem_statement} onChange={v => setForm(f => ({ ...f, problem_statement: v }))} />
            <Input label="Solution" value={form.solution} onChange={v => setForm(f => ({ ...f, solution: v }))} />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={submit} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm text-gray-900">Create</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm text-gray-900">Cancel</button>
          </div>
        </div>
      )}

      <div className="mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" placeholder="Filter projects..."
            value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full md:w-64 bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-gray-600 text-center py-10 text-sm">Loading...</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase">
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Sector</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Week</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3">
                    <Link to={`/projects/${p.id}`} className="text-gray-900 hover:text-violet-600 font-medium">{p.name}</Link>
                    <div className="text-xs text-gray-500 md:hidden">{p.sector}</div>
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell text-gray-600">{p.sector || '—'}</td>
                  <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-5 py-3 hidden md:table-cell"><WeekBadge week={p.playbook_week} /></td>
                  <td className="px-5 py-3 hidden md:table-cell text-gray-600 capitalize">{p.stage}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">No projects found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none"
      />
    </div>
  );
}
