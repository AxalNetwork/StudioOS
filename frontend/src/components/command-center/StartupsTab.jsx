import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, KanbanSquare, Plus } from 'lucide-react';
import ProjectsPage from '../../pages/ProjectsPage';
import PipelinePage from '../../pages/PipelinePage';

// "Spin-outs" is a status filter, not a separate page — these are the same
// statuses the old Spin-Outs tab filtered on (SpinOutsPage).
const SPINOUT_STATUSES = ['spinout', 'spinout_ready', 'incorporated', 'active'];

// Command Center → Startups. Composes the existing ProjectsPage (list) and
// PipelinePage (board) behind a single view toggle, plus a status filter that
// folds the former Spin-Outs tab in. Both child pages are reused as-is via their
// `embedded` prop — no change to how they render standalone for other roles.
export default function StartupsTab({ initialFilter = 'all' }) {
  const navigate = useNavigate();
  const [view, setView] = useState('list'); // 'list' | 'board'
  const [statusFilter, setStatusFilter] = useState(initialFilter); // 'all' | 'spinouts'

  // Apply a URL-driven filter (e.g. arriving at ?tab=spin-outs) even when this
  // component is already mounted — initialFilter alone only seeds first render.
  useEffect(() => {
    setStatusFilter(initialFilter);
  }, [initialFilter]);

  // Creating a startup is the guided intake wizard (FounderPortal), reached as
  // an action rather than a persistent tab.
  const goIntake = () => navigate('/build/command-center?tab=founder-portal');

  const toggleBtn = (id, label, Icon) => (
    <button
      type="button"
      onClick={() => setView(id)}
      aria-pressed={view === id}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
        view === id
          ? 'bg-violet-600 text-white'
          : 'bg-white text-gray-600 hover:text-gray-900 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-white'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <div className="space-y-4" data-testid="startups-tab">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          {toggleBtn('list', 'List', List)}
          {toggleBtn('board', 'Board', KanbanSquare)}
        </div>

        {view === 'list' && (
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span className="sr-only">Filter startups by status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="all">All startups</option>
              <option value="spinouts">Spin-outs</option>
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={goIntake}
          className="ml-auto flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
        >
          <Plus size={14} /> New startup
        </button>
      </div>

      {view === 'list' ? (
        <ProjectsPage
          embedded
          hideCreate
          onNewStartup={goIntake}
          statusFilter={statusFilter === 'spinouts' ? SPINOUT_STATUSES : null}
        />
      ) : (
        <PipelinePage embedded />
      )}
    </div>
  );
}
