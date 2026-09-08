/**
 * The startups list, which outlived the page that used to hold it.
 *
 * `/projects` retired in task #101, but `ProjectsPage` was never only a route:
 * `ExecutionPage` renders it as `<ProjectsPage embedded />`, so deleting the
 * file broke the build — the one check that reads the tree as a module graph
 * rather than as text (`check-frontend-builds.mjs`) is what caught it.
 *
 * So the page became a component, and only the parts that were about being a
 * page were dropped: the `<h1>`, the PageExplainer, the "New Startup" button
 * and the create form. The form did not disappear — it moved to
 * `components/CreateStartupForm.jsx`, because it held the SPA's only
 * `api.createProject` call. `hideCreate` went with it: every remaining caller
 * embeds this list, and a prop whose only value is now the default is a prop
 * that will be read as a live switch by the next person.
 *
 * What stayed is everything that makes it a list: the fetch, the filter box,
 * the virtualised rows, the status and week badges, delete with its role
 * gating, and the empty and error states.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Trash2, Database } from 'lucide-react';
import { api } from '../lib/api';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { StatusBadge, WeekBadge } from '../pages/Dashboard';
import VirtualList from './VirtualList';
import { useToast } from './useToast';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import Skeleton from './Skeleton';
import { Rocket } from 'lucide-react';

// T24 — Single line per row with py-3.
const PROJECT_ROW_HEIGHT = 52;
const PROJECT_GRID = 'minmax(0, 2fr) minmax(0, 1fr) 110px 120px minmax(0, 1fr) 96px';

export default function StartupList({ statusFilter = null, onNewStartup = null }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('');
  const { toast, showToast } = useToast();
  // `form`/`setForm` and `canPickFounder` lived here until the create form moved
  // to components/CreateStartupForm.jsx; they went with it. `isAdmin` stays —
  // the delete gating below still reads it.
  const currentUser = user || safeReadJSON('user', null);
  const isAdmin = currentUser?.role === 'admin';

  const load = () => {
    setLoading(true);
    setLoadError('');
    api.listProjects()
      .then((rows) => setProjects(Array.isArray(rows) ? rows : []))
      .catch((e) => setLoadError(e?.message || 'Failed to load startups'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);


  const handleDelete = async (project) => {
    if (!project?.id) return;
    if (!window.confirm(`Delete "${project.name}"? It will be moved to the trash and permanently removed after 30 days.`)) return;
    try {
      await api.deleteProject(project.id);
      setProjects(prev => prev.filter(p => p.id !== project.id));
      // Task #7 (AM) — soft-delete UX: tell the user where to find it.
      showToast({ kind: 'success', msg: isAdmin ? 'Startup moved to trash — restore within 30 days from Admin > Trash' : 'Startup moved to trash — contact an admin within 30 days to restore' });
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Failed to delete startup' });
    }
  };

  const canDelete = (p) => isAdmin || (!!currentUser?.founder_id && p.founder_id === currentUser.founder_id);
  const canEdit = canDelete; // matches ProjectDetail gating

  // Row-level Crunchbase quick-entry. Free-tier founders see the button as an
  // amber "UPGRADE" pill that fires the global tier-required event; everyone
  // else navigates straight to ProjectDetail with `?cb=1` so the slide-over
  // opens automatically.
  const tier = (currentUser?.tier || currentUser?.subscription_plan || 'free').toLowerCase();
  const isElevated = ['admin','partner','investor','advisor'].includes((currentUser?.role || '').toLowerCase());
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
    (!statusFilter || (Array.isArray(statusFilter) && statusFilter.includes(String(p.status || '').toLowerCase()))) &&
    (!filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.sector?.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    // The testid stays `projects-page`: it is an address other code holds, and
    // renaming it would break the e2e spec for no gain the reader can see.
    <div data-testid="projects-page">
      <div className="mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" placeholder="Filter startups..."
            value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full md:w-64 bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-900 dark:border-gray-800 dark:text-gray-100"
          />
        </div>
      </div>

      {loading ? (
        <Skeleton.Table rows={6} cols={5} />
      ) : loadError ? (
        <ErrorState message={`Couldn't load startups — ${loadError}`} onRetry={load} supportTopic="projects" />
      ) : filtered.length === 0 && projects.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="No startups yet"
          body='Create your first startup to start scoring, due-diligence, and pipeline tracking.'
          cta={{ label: 'New startup', onClick: () => (onNewStartup ? onNewStartup() : setShowForm(true)) }}
          secondary={{ label: 'Learn more', to: '/help#core/projects' }}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-500 text-sm">
              No startups match your filter
            </div>
          ) : (
            <VirtualList
              items={filtered}
              itemHeight={PROJECT_ROW_HEIGHT}
              height={600}
              ariaLabel={`Startups list, ${filtered.length} startups`}
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
                          title="Delete startup"
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
                              title="Delete startup"
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

