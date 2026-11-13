import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Zap, Layers, Target } from 'lucide-react';
import StartupList from '../components/StartupList';
import PipelinePage from './PipelinePage';
import RoadmapPage from './RoadmapPage';

// Founder-only Execution area (Task #14). A single, true-merge page that renders
// the Projects, Pipeline Board and Roadmap areas stacked together — every
// element and interaction from all three original pages at once, no tabs hiding
// content. The three underlying pages are reused as-is (via an `embedded` prop
// that only suppresses their own duplicate page title so a single "Execution"
// title governs the page); all functionality carries over unchanged. The
// standalone /projects, /pipeline and /build/roadmap routes stay intact for the
// other personas.
//
// A link names its section by hash (`#execution-board`, `#execution-roadmap`)
// and the page scrolls to it. The /execution/board and /execution/roadmap
// sub-routes that did this were removed (owner, #2297).

function SectionHeader({ icon: Icon, title, description }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
        <Icon size={18} />
      </span>
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
        {description && <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>}
      </div>
    </div>
  );
}

export default function ExecutionPage({ embedded = false }) {
  const location = useLocation();

  // A section's hash scrolls to it; otherwise the page scrolls to top.
  // Skip entirely when embedded (inside Command Center) so switching to the
  // Execution tab never yanks the window scroll position around.
  useEffect(() => {
    if (embedded) return;
    const hash = location.hash.replace(/^#/, '');
    const targetId = hash === 'execution-board' || hash === 'execution-roadmap' ? hash : null;

    const t = setTimeout(() => {
      if (targetId) {
        const el = document.getElementById(targetId);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 60);
    return () => clearTimeout(t);
  }, [location.hash, embedded]);

  return (
    <div data-testid="execution-page" className="space-y-10">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Execution</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Your startups, pipeline board and roadmap — all in one place.
          </p>
        </div>
      )}

      <section id="execution-projects" aria-label="Startups" className="scroll-mt-6">
        <SectionHeader icon={Zap} title="Startups" description="Venture pipeline & 4-week playbook tracking" />
        <StartupList />
      </section>

      <section id="execution-board" aria-label="Pipeline Board" className="scroll-mt-6 border-t border-gray-200 dark:border-gray-800 pt-8">
        <SectionHeader icon={Layers} title="Pipeline Board" description="Parallel MVP development with AI-driven decision gates" />
        <PipelinePage embedded />
      </section>

      <section id="execution-roadmap" aria-label="Roadmap" className="scroll-mt-6 border-t border-gray-200 dark:border-gray-800 pt-8">
        <SectionHeader icon={Target} title="Roadmap" description="Now / Next / Later kanban with OKR-style key results" />
        <RoadmapPage embedded />
      </section>
    </div>
  );
}
