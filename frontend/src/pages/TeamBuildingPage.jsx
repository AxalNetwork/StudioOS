/**
 * Team Building — the founder's single workspace for recruiting the people
 * around the company: advisors, a co-founder, and hires.
 *
 * This is an IA consolidation, not a rebuild. Three pre-existing surfaces are
 * composed here as tabs and reused as-is via an `embedded` prop that suppresses
 * each one's own page-level heading so a single "Team Building" title governs:
 *
 *   - Mentor / Advisor  → MentorsPage   (discovery + office-hours booking)
 *   - Co-Founder        → CofounderPage (mutual-interest matching + auto-NDA)
 *   - Jobs              → MyJobsPage     (post roles / open positions, hiring)
 *
 * The active tab is stored in the `?tab=` query string so every sub-surface is
 * deep-linkable and the legacy /mentors, /cofounder and /my/jobs routes can
 * redirect founders straight into the matching tab (see App.jsx).
 *
 * Tier gating that previously lived on the individual sidebar entries is
 * preserved at the tab level: a founder who lacks the required plan sees an
 * upgrade panel (which opens the same PaywallModal the old locked nav rows did)
 * instead of the gated feature.
 */
import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserCircle, Users, Briefcase, Lock, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { hasTier } from '../sidebarConfig';
import { openPaywall } from '../components/PaywallModal';
import PageExplainer from '../components/PageExplainer';
import MentorsPage from './MentorsPage';
import CofounderPage from './CofounderPage';
import MyJobsPage from './jobs/MyJobsPage';

// Tab registry. `requiredTier` mirrors the gate the standalone sidebar items
// carried before the merge (mentors → growth, cofounder → studio); Jobs is
// ungated. `blurb` sets the tone the brief asks for per section: discovery /
// matchmaking for advisors, founder-matching for co-founders, a real hiring
// surface for jobs.
const TABS = [
  {
    id: 'mentor',
    label: 'Mentor / Advisor',
    icon: UserCircle,
    requiredTier: 'growth',
    blurb: 'Discover operator-mentors and advisors, then book office hours to pressure-test the plan.',
  },
  {
    id: 'cofounder',
    label: 'Co-Founder',
    icon: Users,
    requiredTier: 'studio',
    blurb: 'Match with a complementary co-founder — identities stay private until interest is mutual.',
  },
  {
    id: 'jobs',
    label: 'Jobs',
    icon: Briefcase,
    blurb: 'Post open roles and manage applicants as you hire the team around your company.',
  },
];

const TIER_LABEL = { growth: 'Growth', studio: 'Studio' };

function tabAllowed(tab, user) {
  return !tab.requiredTier || hasTier(user, tab.requiredTier);
}

// Shown in place of a gated feature. Keeps the destination discoverable while
// routing the click through the shared PaywallModal, matching the locked-nav
// behaviour from before the consolidation.
function LockedTab({ tab }) {
  const tierLabel = TIER_LABEL[tab.requiredTier] || 'a higher';
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
        <Lock size={22} />
      </span>
      <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {tab.label} is a {tierLabel} feature
      </h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-600 dark:text-gray-400">{tab.blurb}</p>
      <button
        type="button"
        onClick={() => openPaywall(tab.requiredTier)}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
      >
        <Sparkles size={16} /> Upgrade to {tierLabel}
      </button>
    </div>
  );
}

export default function TeamBuildingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Resolve the active tab from ?tab=, falling back to the first tab the user
  // can actually access (so a free founder isn't dropped onto a paywall).
  const requested = searchParams.get('tab');
  const activeId = useMemo(() => {
    if (requested && TABS.some((t) => t.id === requested)) return requested;
    const firstAllowed = TABS.find((t) => tabAllowed(t, user));
    return (firstAllowed || TABS[TABS.length - 1]).id;
  }, [requested, user]);

  const activeTab = TABS.find((t) => t.id === activeId) || TABS[0];

  const selectTab = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="team-building-page">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Team Building</h1>
        <PageExplainer pageKey="team_building" />
        <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          One place to build the team around your company — recruit advice from mentors,
          find a co-founder, and hire for open roles.
        </p>
      </div>

      {/* Segmented tab bar. Deep-linkable via ?tab= and highlighted with the
          same violet accent the primary sidebar uses. */}
      <div
        role="tablist"
        aria-label="Team Building sections"
        className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeId;
          const locked = !tabAllowed(tab, user);
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
              {locked && <Lock size={12} className="text-gray-400 dark:text-gray-500" />}
            </button>
          );
        })}
      </div>

      <p className="-mt-2 text-sm text-gray-500 dark:text-gray-400">{activeTab.blurb}</p>

      {/* Each embedded page keeps its own loading / empty / results states. */}
      <div>
        {!tabAllowed(activeTab, user) ? (
          <LockedTab tab={activeTab} />
        ) : activeId === 'mentor' ? (
          <MentorsPage embedded />
        ) : activeId === 'cofounder' ? (
          <CofounderPage embedded />
        ) : (
          <MyJobsPage embedded />
        )}
      </div>
    </div>
  );
}
