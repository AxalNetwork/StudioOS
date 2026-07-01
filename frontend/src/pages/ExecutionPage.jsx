import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Zap, Layers, Target } from 'lucide-react';
import ProjectsPage from './ProjectsPage';
import PipelinePage from './PipelinePage';
import RoadmapPage from './RoadmapPage';

// Founder-only Execution area (Task #12). Wraps the existing Projects,
// Pipeline (Board) and Roadmap pages behind one deep-linkable view switcher
// so founders get a single "Execution" nav item instead of three. The three
// underlying pages are reused as-is; only the tab chrome is added here. The
// standalone /projects, /pipeline and /build/roadmap routes stay intact for
// the other personas.
const VIEWS = [
  { key: 'projects', label: 'Projects', to: '/execution', icon: Zap },
  { key: 'board', label: 'Board', to: '/execution/board', icon: Layers },
  { key: 'roadmap', label: 'Roadmap', to: '/execution/roadmap', icon: Target },
];

function viewFromPath(pathname) {
  if (pathname.startsWith('/execution/board')) return 'board';
  if (pathname.startsWith('/execution/roadmap')) return 'roadmap';
  return 'projects';
}

export default function ExecutionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = viewFromPath(location.pathname);

  return (
    <div data-testid="execution-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Execution</h1>
        <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900" role="tablist" aria-label="Execution views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const isActive = active === v.key;
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => { if (!isActive) navigate(v.to); }}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-violet-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800'
                }`}
              >
                <Icon size={14} /> {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {active === 'projects' && <ProjectsPage />}
      {active === 'board' && <PipelinePage />}
      {active === 'roadmap' && <RoadmapPage />}
    </div>
  );
}
