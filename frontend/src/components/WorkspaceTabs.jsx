// Shared workspace chrome for the consolidated investor Support workspaces
// (Portfolio, Fund Ops, Fund Modeling). Each workspace renders one <WorkspaceHeader>
// plus a <WorkspaceTabs> bar whose tabs deep-link to sibling routes; the active
// tab is derived from the URL so every tab stays addressable and back/forward work.
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function WorkspaceHeader({ icon: Icon, title, description }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
        {Icon && <Icon className="w-6 h-6 text-violet-600" />} {title}
      </h1>
      {description && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{description}</p>}
    </div>
  );
}

export default function WorkspaceTabs({ tabs }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-6 overflow-x-auto [&>button]:whitespace-nowrap">
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = t.match
          ? t.match.some((m) => location.pathname === m || location.pathname.startsWith(m + '/'))
          : location.pathname === t.to;
        return (
          <button
            key={t.to}
            type="button"
            data-testid={t.testId}
            onClick={() => navigate(t.to)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-violet-600 text-violet-700 dark:text-violet-300'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {Icon && <Icon size={16} />} {t.label}
          </button>
        );
      })}
    </div>
  );
}
