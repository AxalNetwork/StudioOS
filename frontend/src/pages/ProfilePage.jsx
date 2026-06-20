// Task #20 — Consolidated profile/advisor flow. Replaces the standalone
// /skills and /values pages: the Personal Advisor conversation is now the
// single place to build your profile, and the Best-Fit section shows the
// results (skills radar, values lean, archetype, completion, matches).
import React from 'react';
import PersonalAdvisor from '../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../components/profile/ProfileFitSection';

export default function ProfilePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Profile</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Chat with your advisor to build your skills, values, and archetype — then see your Best-Fit results below.
        </p>
      </div>
      <PersonalAdvisor />
      <ProfileFitSection />
    </div>
  );
}
