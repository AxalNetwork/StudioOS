/**
 * Command Center — the founder's single home for the whole venture lifecycle:
 * intake → build → operate → spin-out. This is an IA consolidation, not a
 * rebuild. Four pre-existing founder surfaces are composed here as deep-linkable
 * tabs and reused as-is via an `embedded` prop that suppresses each one's own
 * page-level heading so a single "Command Center" title governs:
 *
 *   - Founder Portal → FounderPortal  (submit + auto-score a new startup)
 *   - Execution      → ExecutionPage  (Startups / Pipeline Board / Roadmap)
 *   - Studio Ops     → StudioOpsPage  (finance / HR / legal / compliance)
 *   - Spin-Outs      → SpinOutsPage   (ventures past the Decision Gate)
 *
 * The active tab lives in the `?tab=` query string so every sub-surface is
 * deep-linkable and the legacy /founder, /execution (+ board/roadmap),
 * /studio-ops and /spinouts routes can redirect founders straight into the
 * matching tab (see App.jsx). None of the four pages carries a tier gate, so —
 * unlike TeamBuildingPage — there is no per-tab paywall here.
 */
import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, ClipboardCheck, Zap, Briefcase, Rocket } from 'lucide-react';
import PageExplainer from '../components/PageExplainer';
import OverviewTab from '../components/command-center/OverviewTab';
import FounderPortal from './FounderPortal';
import ExecutionPage from './ExecutionPage';
import StudioOpsPage from './StudioOpsPage';
import SpinOutsPage from './SpinOutsPage';

// Tab registry, ordered by the venture lifecycle: overview (where am I + what's
// next) → intake (Founder Portal) → build (Execution) → operate (Studio Ops) →
// graduate (Spin-Outs). `blurb` sets the tone shown under the tab bar. Overview
// is the default landing tab.
const TABS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    blurb: 'Where your venture stands right now — its lifecycle stage, next best action and live traction.',
  },
  {
    id: 'founder-portal',
    label: 'Founder Portal',
    icon: ClipboardCheck,
    blurb: 'Submit a new startup and get it scored instantly against the studio rubric.',
  },
  {
    id: 'execution',
    label: 'Execution',
    icon: Zap,
    blurb: 'Track your startups, pipeline board and roadmap — all in one place.',
  },
  {
    id: 'studio-ops',
    label: 'Studio Ops',
    icon: Briefcase,
    blurb: 'Run finance, HR, legal and compliance workflows with strategic oversight.',
  },
  {
    id: 'spin-outs',
    label: 'Spin-Outs',
    icon: Rocket,
    blurb: 'Ventures past the Decision Gate — spinning out, incorporating, or scaling independently.',
  },
];

export default function CommandCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Resolve the active tab from ?tab=, falling back to the first tab.
  const requested = searchParams.get('tab');
  const activeId = useMemo(() => {
    if (requested && TABS.some((t) => t.id === requested)) return requested;
    return TABS[0].id;
  }, [requested]);

  const activeTab = TABS.find((t) => t.id === activeId) || TABS[0];

  const selectTab = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="command-center-page">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Command Center</h1>
        <PageExplainer pageKey="command_center" />
        <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          One home for the whole venture lifecycle — submit and score a new startup, run
          execution, operate the studio, and manage spin-outs.
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
        ) : activeId === 'founder-portal' ? (
          <FounderPortal embedded />
        ) : activeId === 'execution' ? (
          <ExecutionPage embedded />
        ) : activeId === 'studio-ops' ? (
          <StudioOpsPage embedded />
        ) : (
          <SpinOutsPage embedded />
        )}
      </div>
    </div>
  );
}
