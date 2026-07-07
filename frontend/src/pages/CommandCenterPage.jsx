/**
 * Command Center — the founder's home for where the venture stands and what to do
 * next. Restructured (Founder UX Audit #1 part b) into four founder-language tabs,
 * lifecycle first:
 *
 *   - Overview   → OverviewTab   (lifecycle module + venture snapshot + traction)
 *   - Startups   → StartupsTab   (ProjectsPage list / PipelinePage board toggle +
 *                                 a "Spin-outs" status filter — the old Spin-Outs tab)
 *   - Roadmap    → RoadmapPage   (promoted out of the old stacked Execution tab)
 *   - Operations → StudioOpsPage (renamed Studio Ops; founder-softened verdicts)
 *
 * Intake (FounderPortal) is no longer a tab — it's an event, launched as the
 * "New startup" action and shown on its own hidden surface (?tab=founder-portal).
 *
 * Legacy ?tab= values from the pre-restructure Command Center (and the App.jsx
 * redirects that still emit them — /execution, /studio-ops, /spinouts, /founder)
 * are mapped onto the new tab set here so every old deep link keeps working. The
 * active tab lives in ?tab= so sub-surfaces stay deep-linkable. None of the
 * embedded pages carries a tier gate, so there is no per-tab paywall here.
 */
import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Rocket, Map, Briefcase, ArrowLeft } from 'lucide-react';
import PageExplainer from '../components/PageExplainer';
import OverviewTab from '../components/command-center/OverviewTab';
import StartupsTab from '../components/command-center/StartupsTab';
import RoadmapPage from './RoadmapPage';
import StudioOpsPage from './StudioOpsPage';
import FounderPortal from './FounderPortal';

// Visible tabs, ordered by the venture lifecycle: overview (where am I + what's
// next) → startups → roadmap → operations. Overview is the default landing tab.
const TABS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    blurb: 'Where your venture stands right now — its lifecycle stage, next best action and live traction.',
  },
  {
    id: 'startups',
    label: 'Startups',
    icon: Rocket,
    blurb: 'Your startups at a glance — switch between a list and the pipeline board, or filter to spin-outs.',
  },
  {
    id: 'roadmap',
    label: 'Roadmap',
    icon: Map,
    blurb: 'Your 90-day roadmap and milestones, all in one place.',
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: Briefcase,
    blurb: 'Run finance, hiring, legal and compliance — with an AI focus recommendation for each venture.',
  },
];

// Old tab ids → new tab ids, so legacy deep links (and the App.jsx redirects that
// still emit them) land on the right place instead of falling back to Overview.
const TAB_ALIASES = {
  execution: 'startups',
  'studio-ops': 'operations',
  'spin-outs': 'startups',
};

// Intake is a hidden surface reached via the "New startup" action, not a tab.
const INTAKE_IDS = new Set(['founder-portal', 'new']);

export default function CommandCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get('tab');
  const isIntake = INTAKE_IDS.has(requested || '');

  // Resolve the active tab from ?tab=, applying legacy aliases and falling back
  // to the first (Overview) tab.
  const activeId = useMemo(() => {
    const resolved = (requested && TAB_ALIASES[requested]) || requested;
    if (resolved && TABS.some((t) => t.id === resolved)) return resolved;
    return TABS[0].id;
  }, [requested]);

  const activeTab = TABS.find((t) => t.id === activeId) || TABS[0];
  // The old Spin-Outs tab folds into Startups as a pre-applied status filter.
  const startupsInitialFilter = requested === 'spin-outs' ? 'spinouts' : 'all';

  const selectTab = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  // Intake surface — FounderPortal on its own, with a way back to the tabs.
  if (isIntake) {
    return (
      <div className="space-y-6" data-testid="command-center-page">
        <div>
          <button
            type="button"
            onClick={() => selectTab('startups')}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
          >
            <ArrowLeft size={14} /> Back to Command Center
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">New startup</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
            Capture your concept and get it scored instantly against the studio playbook.
          </p>
        </div>
        <FounderPortal embedded />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="command-center-page">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Command Center</h1>
        <PageExplainer pageKey="command_center" />
        <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Where your venture stands and what to do next — track your startups, roadmap and
          operations from one home.
        </p>
      </div>

      {/* Segmented tab bar. Deep-linkable via ?tab= and highlighted with the
          same violet accent the primary sidebar uses. */}
      <div
        role="tablist"
        aria-label="Command Center sections"
        className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.id)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-violet-600 text-violet-700 dark:text-violet-300'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              <Icon size={16} /> {tab.label}
            </button>
          );
        })}
      </div>

      <p className="-mt-2 text-sm text-gray-500 dark:text-gray-400">{activeTab.blurb}</p>

      {/* Each embedded page keeps its own loading / empty / results states. */}
      <div>
        {activeId === 'overview' ? (
          <OverviewTab />
        ) : activeId === 'startups' ? (
          <StartupsTab initialFilter={startupsInitialFilter} />
        ) : activeId === 'roadmap' ? (
          <RoadmapPage embedded />
        ) : (
          <StudioOpsPage embedded founderCopy />
        )}
      </div>
    </div>
  );
}
