// Task #9 — Holding-state dashboard for role='exploring' users.
//
// Chat-onboarded users land here after /api/profiling/save stores their
// inferred persona as a SUGGESTION (user_role_review) instead of promoting
// them. They stay in this holding state until an admin sends the binding
// agreement and assigns the final role from /admin/exploring.
//
// Deliberately lean: the Personal Advisor (which keeps refining the role
// suggestion via its role detector) + the Profile & Fit summary. Both
// components are self-contained (they fetch their own data) — see
// pages/Dashboard.jsx for the same mounts.
import React from 'react';
import { Link } from 'react-router-dom';
import { Compass, Rocket } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import PersonalAdvisor from '../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../components/profile/ProfileFitSection';

// What the applicant told us they were, at signup. `suggested_role` is the
// server's copy (users' own /me), stored by upsertSuggestedRole and never
// applied to users.role — only an admin assignment does that, behind a signed
// binding agreement. Showing it back changes nothing about access; it just
// stops every applicant seeing byte-identical copy that never mentions what
// they actually applied for.
const LANE_COPY = {
  founder: {
    label: 'Founder',
    next: 'reviews your venture profile and sends a membership agreement to sign. Once signed, a short venture setup opens your workspace with the Spin-Out Lab tools.',
    // Founder-journey audit — review used to be pure dead time for the founder
    // lane: nothing venture-shaped to do until an admin acted. The Spin-Out Lab
    // application is reachable in this holding state (the /spinout-lab route
    // admits any signed-in role) and is exactly what the admissions engine
    // reviews — so pointing at it turns the wait into the founder's actual
    // next step without weakening the review gate.
    cta: { to: '/spinout-lab', label: 'Apply to the Spin-Out Lab' },
  },
  investor: {
    label: 'Investor',
    next: 'reviews your investor profile and sends a membership agreement to sign. Once signed, deal flow and diligence surfaces open up.',
  },
  partner: {
    label: 'Partner',
    next: 'reviews your partner profile and sends a membership agreement to sign. Once signed, your partner workspace and referral tools open up.',
  },
};

export default function ExploringDashboard() {
  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
  // Absent for anyone who signed up before the lane was recorded, and for
  // Google signups predating the OAuth lane fix — those fall back to the
  // generic copy rather than guessing.
  const lane = LANE_COPY[user?.suggested_role] || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Welcome, {firstName}
          </h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            <Compass size={12} /> {lane ? `${lane.label} · under review` : 'Exploring'}
          </span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          You're all set for now — our team is reviewing your profile.
        </p>
      </div>

      {/* Status strip — what happens next. */}
      <div className="rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-4 py-3 text-sm text-sky-900 dark:text-sky-200">
        <strong>What happens next:</strong> the Axal team{' '}
        {lane
          ? lane.next
          : 'reviews your onboarding profile and will send you a membership agreement to sign. Once it\u2019s signed, your workspace unlocks with the tools that fit your role.'}
        {' '}In the meantime, keep chatting with your Personal Advisor below — the
        more we know, the better the fit.
      </div>

      {/* Lane-specific real next step while under review (see LANE_COPY). */}
      {lane?.cta && (
        <Link
          to={lane.cta.to}
          data-testid="exploring-lane-cta"
          className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
        >
          <Rocket size={15} /> {lane.cta.label}
        </Link>
      )}

      {/* Personal Advisor — keeps collecting answers; its role detector
          refreshes the stored role suggestion while the user waits. */}
      <PersonalAdvisor disablePersistedFullscreen />

      {/* Best-Fit summary — skills / values / archetype / completion. */}
      <ProfileFitSection />
    </div>
  );
}
