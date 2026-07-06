/**
 * Command Center — the founder's single workspace for running the whole venture
 * lifecycle. This is an IA consolidation, not a rebuild: four pre-existing
 * founder surfaces are composed here as deep-linkable tabs and reused as-is via
 * an `embedded` prop that suppresses each one's own page-level heading so a
 * single "Command Center" title governs.
 *
 * Tabs (lifecycle order):
 *   - Founder Portal → FounderPortal  (submit + auto-score a new startup)
 *   - Execution      → ExecutionPage  (startups, pipeline board, roadmap)
 *   - Studio Ops     → StudioOpsPage  (finance / HR / legal / compliance ops)
 *   - Spin-Outs      → SpinOutsPage   (ventures past the Decision Gate)
 *
 * The active tab is stored in `?tab=` so every sub-surface is deep-linkable and
 * the legacy /founder, /execution (+board/roadmap), /pipeline, /build/roadmap,
 * /studio-ops and /spinouts routes redirect founders straight into the matching
 * tab (see App.jsx). Mirrors the TeamBuildingPage / ReferralsPage pattern. There
 * is no tier gating here — all four surfaces are ungated for founders.
 */
import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, Zap, Briefcase, Rocket } from 'lucide-react';
import PageExplainer from '../components/PageExplainer';
import FounderPortal from './FounderPortal';
import ExecutionPage from './ExecutionPage';
import StudioOpsPage from './StudioOpsPage';
import SpinOutsPage from './SpinOutsPage';

const TABS = [
  {
    id: 'founder-portal',
    label: 'Founder Portal',
    icon: Sparkles,
    blurb: 'Submit a new startup and get an instant readiness score across market, team, product, capital and fit.',
  },
  {
    id: 'execution',
    label: 'Execution',
    icon: Zap,
    blurb: 'Run the build — your startups, the pipeline board and the roadmap, all in one place.',
  },
  {
    id: 'studio-ops',
    label: 'Studio Ops',
    icon: Briefcase,
    blurb: 'Strategic oversight plus finance, HR, legal and compliance workflows for operating the company.',
  },
  {
    id: 'spinouts',
    label: 'Spin-Outs',
    icon: Rocket,
    blurb: 'Ventures that have passed the Decision Gate and entered spin-out, incorporation or independent scaling.',
  },
];

export default function CommandCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Resolve the active tab from ?tab=, falling back to the first tab
  // (Founder Portal) so a fresh open lands at the top of the lifecycle.
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
          One workspace for the whole venture lifecycle — from intake and scoring through
          execution, studio operations and spin-out.
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
        {activeId === 'founder-portal' ? (
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
