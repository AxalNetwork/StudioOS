import { useEffect, useRef, useState } from 'react';
import { Rocket, X, PartyPopper, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { useToast } from './useToast';
import { spinoutLab } from '../lib/api';
import { reportError } from '../lib/log';

// Mirror of cloudflare-worker/src/routes/spinout_lab.ts MILESTONES — used
// only as a fallback to classify the very first event of a session when
// we have no cached `prev` state to diff against. Keep in sync with the
// worker catalog and with frontend/src/pages/SpinoutLabPage.jsx.
const MILESTONE_WEEK = {
  project_created: 1,
  customer_interview_logged_1: 1,
  customer_interview_logged_2: 1,
  customer_interview_logged_3: 1,
  okrs_created: 2,
  brand_basics_filled: 2,
  pitch_deck_drafted: 2,
  scoring_run_completed: 3,
  mentor_meeting_booked: 3,
  cofounder_request_sent: 3,
  incorporation_completed: 4,
};

// Task #15 / #16 — Global listener for the `spinout-lab:advanced` window
// event dispatched from `frontend/src/lib/spinoutLabHooks.js` (and the
// SpinoutLabPage's own "Mark complete" button).
//
// Behaviour:
//   • Routine milestone (same week as before)        → small toast.
//   • Week advance (e.g. Week 1 → Week 2)            → larger banner with
//     the new week title, auto-dismisses after ~6s.
//   • Lab completion (active flipped to false on the
//     incorporation milestone)                       → confetti + a modal
//     recap that the founder must dismiss.
//
// Mounted once inside <AuthProvider> in App.jsx so it has access to the
// auth `refresh()` and stays alive across every route.

const WEEK_TITLES = {
  1: 'Week 1 — Discover',
  2: 'Week 2 — Build',
  3: 'Week 3 — Validate',
  4: 'Week 4 — Incorporate',
};

const WEEK_BLURB = {
  2: 'Customer discovery is locked in. Time to build — OKRs, brand, and your first pitch deck.',
  3: 'Build week shipped. Now validate: run the scoring engine and start the cofounder + mentor conversations.',
  4: 'You\'re in the home stretch. One milestone left: incorporate.',
};

function Confetti() {
  // 60 colored squares falling with staggered delays. Pure CSS, no deps.
  const COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899'];
  const pieces = Array.from({ length: 60 }, (_, i) => {
    const left = Math.random() * 100;
    const delay = Math.random() * 1.5;
    const duration = 3 + Math.random() * 2;
    const color = COLORS[i % COLORS.length];
    const size = 6 + Math.random() * 8;
    const rotate = Math.random() * 360;
    return (
      <span
        key={i}
        style={{
          position: 'absolute',
          left: `${left}%`,
          top: '-20px',
          width: `${size}px`,
          height: `${size}px`,
          background: color,
          transform: `rotate(${rotate}deg)`,
          animation: `spinout-confetti-fall ${duration}s ${delay}s linear forwards`,
          opacity: 0.9,
        }}
      />
    );
  });
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
      <style>{`
        @keyframes spinout-confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.2; }
        }
      `}</style>
      {pieces}
    </div>
  );
}

export default function SpinoutLabListener() {
  const { user, refresh } = useAuth();
  const { toast, showToast, dismissToast } = useToast(4000);
  const lastStateRef = useRef(null);
  const seedingRef = useRef(false);
  const [weekBanner, setWeekBanner] = useState(null); // { week }
  const [completion, setCompletion] = useState(null); // { milestoneCount }
  const [confetti, setConfetti] = useState(false);

  // Seed lastStateRef from /api/spinout-lab/state on mount (and when the
  // user becomes a Lab participant) so the very first milestone event of
  // a session can be correctly classified as a routine, week-advance, or
  // completion transition. Without this baseline, the first event always
  // diffs against `null` and incorrectly falls through to the small
  // routine toast — even on a week-advance or final-incorporation event.
  useEffect(() => {
    if (!user || user.spinout_lab_active !== 1) return;
    if (lastStateRef.current || seedingRef.current) return;
    seedingRef.current = true;
    spinoutLab
      .state()
      .then((s) => { if (s) lastStateRef.current = s; })
      .catch((e) => reportError('spinout-lab:listener:seed', e))
      .finally(() => { seedingRef.current = false; });
  }, [user]);

  useEffect(() => {
    const onAdvanced = (e) => {
      try { refresh({ force: true }); } catch { /* no-op */ }

      const next = e?.detail?.state || null;
      const milestoneKey = e?.detail?.milestoneKey || null;
      const prev = lastStateRef.current;
      lastStateRef.current = next;

      if (!next) {
        showToast('Milestone completed — Spin-Out Lab updated');
        return;
      }

      // Completion: server flipped active off OR (no prior baseline) the
      // next state already says inactive with the incorporation milestone
      // recorded. The active-off check works on the very first event of a
      // session where `prev` was never seeded.
      const completedKeys = new Set((next.milestones || []).map((m) => m.key));
      const justCompleted =
        next.active === false &&
        (
          (prev && prev.active === true) ||
          !prev ||
          milestoneKey === 'incorporation_completed' ||
          completedKeys.has('incorporation_completed')
        );

      // Week-advance: prefer prev->next diff. When prev is missing, fall
      // back to the milestone-key catalog: a milestone whose week is less
      // than next.week means the server auto-advanced past it.
      let weekAdvanced = false;
      if (prev && typeof prev.week === 'number' && typeof next.week === 'number') {
        weekAdvanced = next.week > prev.week;
      } else if (!prev && milestoneKey && typeof next.week === 'number') {
        const milestoneWeek = MILESTONE_WEEK[milestoneKey];
        if (typeof milestoneWeek === 'number' && next.week > milestoneWeek) {
          weekAdvanced = true;
        }
      }

      if (justCompleted) {
        setCompletion({ milestoneCount: (next.milestones || []).length });
        setConfetti(true);
        // Confetti runs for ~5s, then we drop the DOM nodes.
        window.setTimeout(() => setConfetti(false), 5500);
        return;
      }

      if (weekAdvanced) {
        setWeekBanner({ week: next.week });
        window.setTimeout(() => {
          setWeekBanner((cur) => (cur && cur.week === next.week ? null : cur));
        }, 6000);
        return;
      }

      // First event of the session, or same-week milestone — quiet toast.
      showToast('Milestone completed — Spin-Out Lab updated');
    };
    window.addEventListener('spinout-lab:advanced', onAdvanced);
    return () => window.removeEventListener('spinout-lab:advanced', onAdvanced);
  }, [refresh, showToast]);

  const dismissCompletion = () => {
    setCompletion(null);
    setConfetti(false);
  };

  return (
    <>
      {confetti && <Confetti />}

      {toast && (
        <div
          className="fixed bottom-4 right-4 z-50 max-w-sm bg-violet-600 text-white shadow-lg rounded-lg px-4 py-3 flex items-start gap-3"
          role="status"
          aria-live="polite"
        >
          <Rocket size={16} className="mt-0.5 shrink-0" />
          <div className="text-sm flex-1">{toast}</div>
          <button
            type="button"
            onClick={dismissToast}
            aria-label="Dismiss"
            className="text-white/80 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {weekBanner && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,520px)] bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-2xl rounded-xl px-5 py-4 flex items-start gap-3 ring-1 ring-white/20"
          role="status"
          aria-live="polite"
        >
          <div className="shrink-0 mt-0.5">
            <Sparkles size={20} />
          </div>
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-wider text-white/80 font-semibold">
              Welcome to
            </div>
            <div className="text-lg font-bold leading-tight">
              {WEEK_TITLES[weekBanner.week] || `Week ${weekBanner.week}`}
            </div>
            {WEEK_BLURB[weekBanner.week] && (
              <div className="text-sm text-white/90 mt-1 leading-snug">
                {WEEK_BLURB[weekBanner.week]}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setWeekBanner(null)}
            aria-label="Dismiss"
            className="text-white/80 hover:text-white shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {completion && (
        <div
          className="fixed inset-0 z-[55] bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="spinout-lab-completion-title"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-7 text-center relative dark:bg-gray-900">
            <div className="mx-auto w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center mb-4">
              <PartyPopper size={26} />
            </div>
            <h2
              id="spinout-lab-completion-title"
              className="text-2xl font-bold text-gray-900 mb-2 dark:text-gray-100"
            >
              You incorporated!
            </h2>
            <p className="text-sm text-gray-600 mb-1">
              Spin-Out Lab is complete. Four weeks, {completion.milestoneCount} milestones,
              one real company.
            </p>
            <p className="text-sm text-gray-600 mb-6">
              Every founder feature is now unlocked across the platform.
            </p>
            <button
              type="button"
              onClick={dismissCompletion}
              className="inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg w-full"
            >
              Keep building
            </button>
          </div>
        </div>
      )}
    </>
  );
}
