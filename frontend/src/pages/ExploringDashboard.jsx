// Task #9 — Holding-state dashboard for role='exploring' users.
//
// Auth v2 (A3d) — membership review runs in the background while the user
// keeps working. Three actions stay held; the rest of the workspace is live.
import React from 'react';
import { Link } from 'react-router-dom';
import { Compass, Lock, Rocket, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import PersonalAdvisor from '../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../components/profile/ProfileFitSection';

const LANE_COPY = {
  founder: {
    label: 'Founder',
    next: 'reviews your venture profile and sends a membership agreement to sign. Once signed, a short venture setup opens your workspace with the Spin-Out Lab tools.',
    cta: { to: '/spinout-lab', label: 'Apply to the Spin-Out Lab' },
    review: {
      held: [
        { t: 'Send an introduction', why: 'An intro carries our name to a third party — held until the licence is assigned.' },
        { t: 'Share a data room', why: 'Sharing grants an outside party access to your files. Held until the membership agreement is signed.' },
        { t: 'Apply to a cohort decision', why: 'A cohort place is an admin decision. Applications open once your account is a member.' },
      ],
      live: [
        { t: 'Validate · log interviews', to: '/validate', d: 'Open now. Interviews logged here count as evidence if you later apply to a cohort.' },
        { t: 'Build · this week', to: '/build', d: 'Open now. Commitments, board, roadmap, cadence.' },
        { t: 'Research · ask the library', to: '/research/ask', d: 'Open now, metered per question.' },
        { t: 'Company record', to: '/studio', d: 'Open now. Name, jurisdiction, stage — editable until incorporation is filed.' },
      ],
    },
  },
  investor: {
    label: 'Investor',
    next: 'reviews your investor profile and sends a membership agreement to sign. Once signed, deal flow and diligence surfaces open up.',
  },
  partner: {
    label: 'Partner',
    next: 'reviews your partner profile and sends a membership agreement to sign. Once signed, your partner workspace and referral tools open up.',
  },
  advisor: {
    label: 'Advisor',
    next: 'reviews your advisor profile and sends a membership agreement to sign. Once signed, your practice and office-hours surfaces open up.',
  },
};

export default function ExploringDashboard() {
  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
  const lane = LANE_COPY[user?.suggested_role] || null;
  const review = lane?.review;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Welcome, {firstName}
          </h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            <Compass size={12} /> {lane ? `${lane.label} · under review` : 'Exploring'}
          </span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {review
            ? 'Membership under review — you can keep working. We send an agreement to sign when it clears.'
            : "You're all set for now — our team is reviewing your profile."}
        </p>
      </div>

      <div className="rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-4 py-3 text-sm text-sky-900 dark:text-sky-200">
        <strong>What happens next:</strong> the Axal team{' '}
        {lane
          ? lane.next
          : 'reviews your onboarding profile and will send you a membership agreement to sign. Once it\u2019s signed, your workspace unlocks with the tools that fit your role.'}
        {!review && (
          <>
            {' '}In the meantime, keep chatting with your Personal Advisor below — the
            more we know, the better the fit.
          </>
        )}
      </div>

      {review && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-gray-500 mb-3">
              <Lock size={12} /> Held until the licence is assigned
            </div>
            <ul className="space-y-3">
              {review.held.map((item) => (
                <li key={item.t} className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-3 py-2 opacity-70">
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">{item.t}</div>
                  <div className="text-xs text-gray-500 mt-1">{item.why}</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-3">
              <CheckCircle2 size={12} /> Live now
            </div>
            <ul className="space-y-3">
              {review.live.map((item) => (
                <li key={item.t}>
                  <Link
                    to={item.to}
                    className="block rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-900 px-3 py-2 hover:border-emerald-400 transition-colors"
                  >
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.t}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{item.d}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {lane?.cta && (
        <Link
          to={lane.cta.to}
          data-testid="exploring-lane-cta"
          className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
        >
          <Rocket size={15} /> {lane.cta.label}
        </Link>
      )}

      <PersonalAdvisor disablePersistedFullscreen />
      <ProfileFitSection />
    </div>
  );
}
