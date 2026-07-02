import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { Link } from 'react-router-dom';
import { Plus, Search, Trash2, Database } from 'lucide-react';
import SectorSelect from '../components/SectorSelect';
import { api } from '../lib/api';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import { StatusBadge, WeekBadge } from './Dashboard';
import VirtualList from '../components/VirtualList';
import { useToast } from '../components/useToast';
import { getPitchCopyLengthStatus } from '../lib/pitchCopyLength';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import { Rocket } from 'lucide-react';

// T24 — Single line per row with py-3.
const PROJECT_ROW_HEIGHT = 52;
const PROJECT_GRID = 'minmax(0, 2fr) minmax(0, 1fr) 110px 120px minmax(0, 1fr) 96px';

export default function ProjectsPage({ embedded = false }) {
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
    if (!window.confirm(`Delete "${project.name}"? It will be moved to the trash and permanently removed after 30 days.`)) return;
    try {
      await api.deleteProject(project.id);
      setProjects(prev => prev.filter(p => p.id !== project.id));
      // Task #7 (AM) — soft-delete UX: tell the user where to find it.
      showToast({ kind: 'success', msg: isAdmin ? 'Project moved to trash — restore within 30 days from Admin > Trash' : 'Project moved to trash — contact an admin within 30 days to restore' });
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Failed to delete project' });
    }
  };

  const canDelete = (p) => isAdmin || (!!currentUser?.founder_id && p.founder_id === currentUser.founder_id);
  const canEdit = canDelete; // matches ProjectDetail gating

  // Row-level Crunchbase quick-entry. Free-tier founders see the button as an
  // amber "UPGRADE" pill that fires the global tier-required event; everyone
  // else navigates straight to ProjectDetail with `?cb=1` so the slide-over
  // opens automatically.
  const tier = (currentUser?.tier || currentUser?.subscription_plan || 'free').toLowerCase();
  const isElevated = ['admin','partner','investor','mentor'].includes((currentUser?.role || '').toLowerCase());
  const cbTierLocked = !isElevated && tier !== 'growth' && tier !== 'studio';
  const onCbClick = (p, ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (cbTierLocked) {
      try {
        window.dispatchEvent(new CustomEvent('studioos:tier_required', {
          detail: { required: 'growth', message: 'Crunchbase enrichment is a growth-tier feature.' },
        }));
      } catch {}
      return;
    }
    window.location.assign(`/projects/${p.id}?cb=1`);
  };

  const filtered = projects.filter(p =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.sector?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div data-testid="projects-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          {!embedded && (
            <>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Projects</h1>
              <PageExplainer pageKey="projects" />
              <p className="text-sm text-gray-600">Venture pipeline & 4-week playbook tracking</p>
            </>
          )}
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white transition-colors">
          <Plus size={14} /> New Project
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 text-sm mb-4 dark:text-gray-100">Add New Project</h2>
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
            <PitchInput label="Problem Statement" fieldType="problem" value={form.problem_statement} onChange={v => setForm(f => ({ ...f, problem_statement: v }))} />
            <PitchInput label="Solution" fieldType="solution" value={form.solution} onChange={v => setForm(f => ({ ...f, solution: v }))} />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={submit} disabled={submitting} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors">{submitting ? 'Creating…' : 'Create'}</button>
            <button onClick={() => setShowForm(false)} disabled={submitting} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm text-gray-900 disabled:opacity-50 dark:text-gray-100">Cancel</button>
          </div>
        </div>
      )}

      <div className="mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" placeholder="Filter projects..."
            value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full md:w-64 bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-800 dark:text-gray-100"
          />
        </div>
      </div>

      {loading ? (
        <Skeleton.Table rows={6} cols={5} />
      ) : loadError ? (
        <ErrorState message={`Couldn't load projects — ${loadError}`} onRetry={load} supportTopic="projects" />
      ) : filtered.length === 0 && projects.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="No projects yet"
          body='Create your first venture project to start scoring, due-diligence, and pipeline tracking.'
          cta={{ label: 'New project', onClick: () => setShowForm(true) }}
          secondary={{ label: 'Learn more', to: '/docs#core/projects' }}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-500 text-sm">
              No projects match your filter
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
                      <Link to={`/projects/${p.id}`} className="text-gray-900 hover:text-violet-600 font-medium truncate block dark:text-gray-100">{p.name}</Link>
                      <div className="text-xs text-gray-500 md:hidden truncate">{p.sector}</div>
                    </div>
                    <div className="px-5 py-3 hidden md:block text-gray-600 truncate">{p.sector || '—'}</div>
                    <div className="px-5 py-3"><StatusBadge status={p.status} /></div>
                    <div className="px-5 py-3 hidden md:block"><WeekBadge week={p.playbook_week} /></div>
                    <div className="px-5 py-3 hidden md:block text-gray-600 capitalize truncate">{p.stage}</div>
                    <div className="px-3 py-3 flex items-center justify-end gap-1">
                      {canEdit(p) && (
                        <button
                          onClick={(ev) => onCbClick(p, ev)}
                          className={`p-1.5 rounded transition-colors ${
                            p.crunchbase_uuid ? 'text-violet-600 hover:bg-violet-50' :
                            cbTierLocked ? 'text-amber-600 hover:bg-amber-50' :
                            'text-gray-400 hover:text-violet-600 hover:bg-violet-50'
                          }`}
                          aria-label={`Crunchbase lookup for ${p.name}`}
                          title={
                            p.crunchbase_uuid ? 'Open Crunchbase profile' :
                            cbTierLocked ? 'Upgrade to growth — Crunchbase lookup' :
                            'Look up on Crunchbase'
                          }
                        >
                          <Database size={14} />
                        </button>
                      )}
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
                    <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase dark:border-gray-800">
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
                          <Link to={`/projects/${p.id}`} className="text-gray-900 hover:text-violet-600 font-medium dark:text-gray-100">{p.name}</Link>
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

function Input({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:text-gray-100"
      />
    </div>
  );
}

function PitchInput({ label, fieldType, value, onChange }) {
  const status = getPitchCopyLengthStatus(value, fieldType);
  const toneColors = {
    neutral: { bar: 'bg-gray-300 dark:bg-gray-600', text: 'text-gray-500 dark:text-gray-400' },
    amber:   { bar: 'bg-amber-500',                 text: 'text-amber-600 dark:text-amber-400' },
    green:   { bar: 'bg-emerald-500',               text: 'text-emerald-600 dark:text-emerald-400' },
    red:     { bar: 'bg-red-500',                   text: 'text-red-600 dark:text-red-400' },
  };
  const c = toneColors[status.tone] || toneColors.neutral;
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:text-gray-100"
      />
      <div className="mt-1.5">
        <div className="h-1 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div className={`h-full ${c.bar} transition-all duration-200`} style={{ width: `${status.progressPercent}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className={c.text}>{status.label}</span>
          <span className="text-gray-400 dark:text-gray-500 font-mono">{status.wordCount} {status.wordCount === 1 ? 'word' : 'words'}</span>
        </div>
      </div>
    </div>
  );
}

