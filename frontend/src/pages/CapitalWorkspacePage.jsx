import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DollarSign, PieChart, TrendingUp } from 'lucide-react';
import FinancialsPage from './FinancialsPage';
import CapTablePage from './CapTablePage';
import RaisePipelinePage from './RaisePipelinePage';

// RAISE Workspaces (Task #1) — Capital workspace.
//
// Collapses the former standalone founder nav items "Financial Model"
// (/build/financials), "Cap Table" (/build/captable) and "Raise Pipeline"
// (/raise) into one workspace with three tabs, reusing each existing page in
// `embedded` mode so a single workspace title governs. Financial Model is the
// default tab. Each tab is URL-addressable so it can be deep-linked and the
// legacy /raise route redirects into the pipeline tab (see App.jsx).
//
// Frontend-only — no page logic, data, or API changes. The standalone
// /build/financials and /build/captable pages are retired (#2339, #2340, the
// owner's "Remove"): both addresses forward to these tabs.

const TABS = [
  { id: 'model', to: '/raise/capital/model', label: 'Financial Model', icon: DollarSign },
  { id: 'cap-table', to: '/raise/capital/cap-table', label: 'Cap Table', icon: PieChart },
  { id: 'pipeline', to: '/raise/capital/pipeline', label: 'Raise Pipeline', icon: TrendingUp },
];

/**
 * D1016: the query a tab keeps — the venture (`?project=` or `?project_id=`) and nothing else, so
 * switching tabs never drops the startup the founder picked. Exported for its test.
 */
export function tabHref(to, search = '') {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const keep = new URLSearchParams();
  for (const k of ['project', 'project_id']) {
    const v = from.get(k);
    if (v) keep.set(k, v);
  }
  const q = keep.toString();
  return q ? `${to}?${q}` : to;
}

export default function CapitalWorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();

  const active = location.pathname.includes('/cap-table')
    ? 'cap-table'
    : location.pathname.includes('/pipeline')
    ? 'pipeline'
    : 'model';

  return (
    <div data-testid="capital-workspace" className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-violet-600" /> Capital
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Your financial model, cap table, and investor raise pipeline in one place.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-6">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`capital-tab-${t.id}`}
              onClick={() => navigate(tabHref(t.to, location.search))}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-violet-600 text-violet-700 dark:text-violet-300'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {active === 'model' && <FinancialsPage embedded />}
      {active === 'cap-table' && <CapTablePage embedded />}
      {active === 'pipeline' && <RaisePipelinePage embedded />}
    </div>
  );
}
