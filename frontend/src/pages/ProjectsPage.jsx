import React, { useEffect, useState, useRef } from 'react';
import PageExplainer from '../components/PageExplainer';
import { Link } from 'react-router-dom';
import { Plus, Search, ChevronDown, X, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import { StatusBadge, WeekBadge } from './Dashboard';
import VirtualList from '../components/VirtualList';
import { useToast } from '../components/useToast';

// T24 — Single line per row with py-3.
const PROJECT_ROW_HEIGHT = 52;
const PROJECT_GRID = 'minmax(0, 2fr) minmax(0, 1fr) 110px 120px minmax(0, 1fr) 56px';

export default function ProjectsPage() {
  const { user, refresh } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ name: '', description: '', sector: '', founder_email: '', founder_name: '', problem_statement: '', solution: '' });
  const { toast, showToast } = useToast();
  // Founder/investor users always submit projects under their own identity —
  // hide the founder name/email inputs (worker forces founder_id from JWT).
  const currentUser = user || safeReadJSON('user', null);
  const canPickFounder = currentUser?.role === 'admin' || currentUser?.role === 'partner';
  const isAdmin = currentUser?.role === 'admin';

  const load = () => {
    setLoading(true);
    setLoadError('');
    api.listProjects()
      .then((rows) => setProjects(Array.isArray(rows) ? rows : []))
      .catch((e) => setLoadError(e?.message || 'Failed to load projects'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async () => {
    if (!form.name.trim()) {
      showToast({ kind: 'error', msg: 'Project name is required' });
      return;
    }
    setSubmitting(true);
    try {
      await api.createProject({ ...form, name: form.name.trim() });
      setShowForm(false);
      setForm({ name: '', description: '', sector: '', founder_email: '', founder_name: '', problem_statement: '', solution: '' });
      // Worker's resolveFounderIdForCreate may have just back-filled
      // users.founder_id for a first-time founder. Force-refresh /auth/me
      // (bypassing the 5-min throttle in useAuthSync) so canEdit/canDelete
      // gating reflects the new founder_id immediately — otherwise the
      // founder can't see edit/delete on the project they just created.
      try { if (typeof refresh === 'function') await refresh({ force: true }); } catch {}
      load();
      showToast({ kind: 'success', msg: 'Project created' });
      await markMilestone(currentUser, 'project_created');
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Failed to create project' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (project) => {
    if (!project?.id) return;
    if (!window.confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteProject(project.id);
      setProjects(prev => prev.filter(p => p.id !== project.id));
      showToast({ kind: 'success', msg: 'Project deleted' });
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Failed to delete project' });
    }
  };

  const canDelete = (p) => isAdmin || (!!currentUser?.founder_id && p.founder_id === currentUser.founder_id);

  const filtered = projects.filter(p =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.sector?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Projects</h1>
        <PageExplainer pageKey="projects" />
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
            <SectorSelect value={form.sector} onChange={v => setForm(f => ({ ...f, sector: v }))} />
            {canPickFounder && (
              <>
                <Input label="Founder Name" value={form.founder_name} onChange={v => setForm(f => ({ ...f, founder_name: v }))} />
                <Input label="Founder Email" value={form.founder_email} onChange={v => setForm(f => ({ ...f, founder_email: v }))} />
              </>
            )}
            <div className="md:col-span-2">
              <Input label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} />
            </div>
            <Input label="Problem Statement" value={form.problem_statement} onChange={v => setForm(f => ({ ...f, problem_statement: v }))} />
            <Input label="Solution" value={form.solution} onChange={v => setForm(f => ({ ...f, solution: v }))} />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={submit} disabled={submitting} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors">{submitting ? 'Creating…' : 'Create'}</button>
            <button onClick={() => setShowForm(false)} disabled={submitting} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm text-gray-900 disabled:opacity-50">Cancel</button>
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
      ) : loadError ? (
        <div className="bg-white border border-red-200 rounded-xl px-5 py-8 text-center text-sm">
          <div className="text-red-600 mb-2">Couldn't load projects</div>
          <div className="text-gray-600 mb-4">{loadError}</div>
          <button onClick={load} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-white text-sm">Retry</button>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-500 text-sm">
              {projects.length === 0 ? 'No projects yet — click "New Project" to get started.' : 'No projects match your filter'}
            </div>
          ) : (
            <VirtualList
              items={filtered}
              itemHeight={PROJECT_ROW_HEIGHT}
              height={600}
              ariaLabel={`Projects list, ${filtered.length} projects`}
              virtualRow={(p, _i, style, ariaAttributes) => (
                <div style={style} {...ariaAttributes}
                     className="hover:bg-gray-50/50 transition-colors border-b border-gray-100 text-sm">
                  <div style={{ display: 'grid', gridTemplateColumns: PROJECT_GRID, alignItems: 'center', height: '100%' }}>
                    <div className="px-5 py-3 min-w-0">
                      <Link to={`/projects/${p.id}`} className="text-gray-900 hover:text-violet-600 font-medium truncate block">{p.name}</Link>
                      <div className="text-xs text-gray-500 md:hidden truncate">{p.sector}</div>
                    </div>
                    <div className="px-5 py-3 hidden md:block text-gray-600 truncate">{p.sector || '—'}</div>
                    <div className="px-5 py-3"><StatusBadge status={p.status} /></div>
                    <div className="px-5 py-3 hidden md:block"><WeekBadge week={p.playbook_week} /></div>
                    <div className="px-5 py-3 hidden md:block text-gray-600 capitalize truncate">{p.stage}</div>
                    <div className="px-3 py-3 flex items-center justify-end">
                      {canDelete(p) && (
                        <button
                          onClick={() => handleDelete(p)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          aria-label={`Delete ${p.name}`}
                          title="Delete project"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            >
              {(items) => (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase">
                      <th className="text-left px-5 py-3">Name</th>
                      <th className="text-left px-5 py-3 hidden md:table-cell">Sector</th>
                      <th className="text-left px-5 py-3">Status</th>
                      <th className="text-left px-5 py-3 hidden md:table-cell">Week</th>
                      <th className="text-left px-5 py-3 hidden md:table-cell">Stage</th>
                      <th className="px-3 py-3 w-14" aria-label="Actions"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3">
                          <Link to={`/projects/${p.id}`} className="text-gray-900 hover:text-violet-600 font-medium">{p.name}</Link>
                          <div className="text-xs text-gray-500 md:hidden">{p.sector}</div>
                        </td>
                        <td className="px-5 py-3 hidden md:table-cell text-gray-600">{p.sector || '—'}</td>
                        <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                        <td className="px-5 py-3 hidden md:table-cell"><WeekBadge week={p.playbook_week} /></td>
                        <td className="px-5 py-3 hidden md:table-cell text-gray-600 capitalize">{p.stage}</td>
                        <td className="px-3 py-3 text-right">
                          {canDelete(p) && (
                            <button
                              onClick={() => handleDelete(p)}
                              className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                              aria-label={`Delete ${p.name}`}
                              title="Delete project"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </VirtualList>
          )}
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toast.kind === 'error' ? 'bg-red-600' : 'bg-violet-600'
        }`} role="status">
          {toast.msg || (typeof toast === 'string' ? toast : '')}
        </div>
      )}
    </div>
  );
}

const SECTORS = [
  '3D Printing / Additive Manufacturing', 'AdTech', 'Advanced Manufacturing', 'Advanced Materials', 'Aerospace',
  'AgTech / AgriTech', 'AI / Machine Learning', 'AI Agents / Agentic Systems', 'AI Infrastructure', 'Alternative Energy',
  'AR / VR / XR / Spatial Computing', 'Audiotech', 'Autonomous Robotics', 'Autonomous Vehicles', 'Battery Tech',
  'B2B SaaS', 'Beauty Tech', 'Big Data / Analytics', 'Bio-Automation', 'Bioinformatics',
  'Biotech / Life Sciences', 'Blockchain / Crypto / Web3', 'Carbon Capture', 'Clean Energy', 'Climate Intelligence / Climate Tech',
  'Cloud Computing', 'Construction Tech (ConTech)', 'Consumer Electronics', 'Consumer Internet / Apps', 'Consumer Tech',
  'Cybersecurity', 'Data Infrastructure', 'Defense Tech / GovTech', 'DeFi', 'Digital Health',
  'Digital Twins', 'Drone Tech', 'E-commerce / Marketplace', 'EdTech', 'Edge Computing',
  'Electric Vehicles', 'Embedded Finance', 'Energy Storage / Renewables', 'Energy Tech', 'Enterprise AI Software',
  'Enterprise Software', 'FinTech', 'Food Tech', 'Gaming / eSports / Entertainment', 'GovTech',
  'Hardware', 'HealthTech / MedTech', 'HR Tech', 'Industrial IoT', 'InsurTech',
  'IoT', 'Legal Tech', 'Logistics / Supply Chain Tech', 'Marine Tech', 'Mobility / Transportation Tech',
  'Music Tech', 'Nanotechnology', 'Neurotech', 'Photonics', 'Precision Medicine',
  'PropTech / Real Estate Tech', 'Quantum Computing / Infrastructure', 'Regenerative Medicine', 'Robotics & Automation', 'Satellite / Space Tech',
  'Semiconductors', 'Social Tech / Social Media', 'Sports Tech', 'Supply Chain Tech', 'Sustainability / Cleantech',
  'Synthetic Biology', 'Vertical SaaS', 'Wearables', 'Web3 / Metaverse'
];

function Input({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none"
      />
    </div>
  );
}

function SectorSelect({ label = 'Sector', value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);

  const filtered = SECTORS.filter(s => s.toLowerCase().includes(search.toLowerCase()));

  const handleSelect = (sector) => {
    onChange(sector);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 hover:border-violet-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-colors"
      >
        <span className={value ? 'text-gray-900' : 'text-gray-500'}>{value || 'Select a sector...'}</span>
        <div className="flex items-center gap-1">
          {value && (
            <X size={14} className="text-gray-400 hover:text-gray-600" onClick={handleClear} />
          )}
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-300 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-200">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search sectors..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length > 0 ? (
              filtered.map(sector => (
                <button
                  key={sector}
                  onClick={() => handleSelect(sector)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-violet-50 ${
                    value === sector ? 'bg-violet-100 text-violet-700 font-medium' : 'text-gray-900'
                  }`}
                >
                  {sector}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-sm text-gray-500">No sectors found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
