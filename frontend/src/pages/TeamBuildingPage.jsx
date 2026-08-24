/**
 * Team Building — the founder's single workspace for recruiting the people
 * around the company: advisors, a co-founder, and hires.
 *
 * This is an IA consolidation, not a rebuild. Three pre-existing surfaces are
 * composed here as tabs and reused as-is via an `embedded` prop that suppresses
 * each one's own page-level heading so a single "Team Building" title governs:
 *
 *   - Advisor  → AdvisorsPage   (discovery + office-hours booking)
 *   - Co-Founder        → CofounderPage (mutual-interest matching + auto-NDA)
 *   - Jobs              → MyJobsPage     (post roles / open positions, hiring)
 *
 * The active tab is stored in the `?tab=` query string so every sub-surface is
 * deep-linkable and the legacy /advisors, /cofounder and /my/jobs routes can
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
import IncomingLeadsStrip from '../components/IncomingLeadsStrip';
import AdvisorsPage from './AdvisorsPage';
import CofounderPage from './CofounderPage';
import MyJobsPage from './jobs/MyJobsPage';

// Tab registry. `requiredTier` mirrors the gate the standalone sidebar items
// carried before the merge (advisors → growth, cofounder → studio); Jobs is
// ungated. `blurb` sets the tone the brief asks for per section: discovery /
// matchmaking for advisors, founder-matching for co-founders, a real hiring
// surface for jobs.
const TABS = [
  {
    id: 'advisor',
    label: 'Advisor',
    icon: UserCircle,
    requiredTier: 'growth',
    blurb: 'Discover operator-advisors and advisors, then book office hours to pressure-test the plan.',
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

// Static, non-interactive skeleton card used inside the blurred locked
// preview. Deliberately fake: rendering the REAL embedded page here would
// fire its mount-time fetches against tier-gated endpoints and put real
// gated data in the DOM (trivially de-blurred via devtools).
function PreviewCard({ seed }) {
  const nameW = ['w-28', 'w-36', 'w-24'][seed % 3];
  const lineW = ['w-full', 'w-4/5', 'w-11/12'][(seed + 1) % 3];
  const tags = 2 + (seed % 3);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-violet-200 dark:bg-violet-900/50" />
        <div className="space-y-1.5">
          <div className={`h-3 ${nameW} rounded bg-gray-300 dark:bg-gray-700`} />
          <div className="h-2.5 w-20 rounded bg-gray-200 dark:bg-gray-800" />
        </div>
      </div>
      <div className={`mt-3 h-2.5 ${lineW} rounded bg-gray-200 dark:bg-gray-800`} />
      <div className="mt-1.5 h-2.5 w-2/3 rounded bg-gray-200 dark:bg-gray-800" />
      <div className="mt-3 flex gap-1.5">
        {Array.from({ length: tags }).map((_, i) => (
          <div key={i} className="h-4 w-14 rounded-full bg-violet-100 dark:bg-violet-900/40" />
        ))}
      </div>
    </div>
  );
}

// Shown in place of a gated feature: a blurred static preview of what the
// section looks like (skeleton people-cards, never real data) with the
// upgrade CTA overlaid, so founders see what they're unlocking instead of a
// bare lock panel. The CTA routes through the same shared PaywallModal the
// old locked nav rows used.
function LockedTab({ tab }) {
  const tierLabel = TIER_LABEL[tab.requiredTier] || 'a higher';
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <div aria-hidden="true" className="pointer-events-none select-none blur-sm p-4 bg-gray-50 dark:bg-gray-950">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <PreviewCard key={i} seed={i} />)}
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-gray-950/60">
        <div className="mx-4 max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
            <Lock size={22} />
          </span>
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {tab.label} is a {tierLabel} feature
          </h3>
          <p className="mx-auto mt-1 text-sm text-gray-600 dark:text-gray-400">{tab.blurb}</p>
          <button
            type="button"
            onClick={() => openPaywall(tab.requiredTier)}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            <Sparkles size={16} /> Upgrade to {tierLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeamBuildingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Resolve the active tab from ?tab=. EVERYONE lands on Advisors by default,
  // regardless of tier — a locked tab now shows a blurred preview + upgrade
  // CTA instead of being skipped, so people-first framing wins over gating.
  const requested = searchParams.get('tab');
  const activeId = useMemo(() => {
    if (requested && TABS.some((t) => t.id === requested)) return requested;
    return 'advisor';
  }, [requested]);

  const activeTab = TABS.find((t) => t.id === activeId) || TABS[0];

  const selectTab = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="team-building-page">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Your People</h1>
        <PageExplainer pageKey="team_building" />
        <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          The people who'll build this with you — advisors to pressure-test the plan,
          a co-founder to share the load, and your first hires.
        </p>
      </div>

      {/* Inbound co-founder leads captured on the founder's landing pages,
          routed here so they're visible where the founder acts on them. */}
      <IncomingLeadsStrip
        audience="cofounder"
        sectionLabel="INBOUND LEADS · BRAND & PAGES"
        title="New co-founder leads"
        blurb="People who reached out about co-founding via your landing pages."
      />

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
        ) : activeId === 'advisor' ? (
          <AdvisorsPage embedded />
        ) : activeId === 'cofounder' ? (
          <CofounderPage embedded />
        ) : (
          <MyJobsPage embedded />
        )}
      </div>
    </div>
  );
}
