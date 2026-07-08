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
import { Compass } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import PersonalAdvisor from '../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../components/profile/ProfileFitSection';

export default function ExploringDashboard() {
  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Welcome, {firstName}
          </h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700">
            <Compass size={12} /> Exploring
          </span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          You're all set for now — our team is reviewing your profile.
        </p>
      </div>

      {/* Status strip — what happens next. */}
      <div className="rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-4 py-3 text-sm text-sky-900 dark:text-sky-200">
        <strong>What happens next:</strong> the Axal team reviews your onboarding
        profile and will send you a membership agreement to sign. Once it's
        signed, your workspace unlocks with the tools that fit your role. In the
        meantime, keep chatting with your Personal Advisor below — the more we
        know, the better the fit.
      </div>

      {/* Personal Advisor — keeps collecting answers; its role detector
          refreshes the stored role suggestion while the user waits. */}
      <PersonalAdvisor disablePersistedFullscreen />

      {/* Best-Fit summary — skills / values / archetype / completion. */}
      <ProfileFitSection />
    </div>
  );
}
