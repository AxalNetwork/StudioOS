// Task #106 — read-only admin preview of the full new-founder Spin-Out Lab
// journey, launched from Admin Console > Spin-Out Lab ("Preview founder
// journey"). Renders the REAL founder-facing components fed with simulated
// client-side state — nothing is fetched from /spinout-lab/state, nothing is
// written, no application is submitted, and no email is sent. A persistent
// stepper bar lets the admin jump between the six journey stages in any
// order and exit back to the Admin Console.
import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, X, Mail } from 'lucide-react';
import SpinoutLabMarketingPage from '../SpinoutLabMarketingPage';
import SpinoutLabApplyPage from '../SpinoutLabApplyPage';
import { CongratulationsScreen } from '../SpinoutLabPage';
import SpinoutLabWorkspace from '../SpinoutLabWorkspace';

const STAGES = [
  { key: 'marketing', label: 'Spin-Out Lab' },
  { key: 'apply', label: 'Apply' },
  { key: 'confirmation', label: 'Email confirmation' },
  { key: 'welcome', label: 'Welcome to cohort' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'graduation', label: 'Graduation' },
];

// Simulated founder states. Dates/cohorts mirror the workspace design
// handoff (attached_assets/Spin-Out_Lab_Workspace.dc_*.html): Cohort 3,
// started July 1 2026, Week 2, 19 days remaining, all weeks browsable.
const WORKSPACE_STATE = {
  active: true,
  admitted: true,
  week: 2,
  days_remaining: 19,
  started_at: '2026-07-01T00:00:00Z',
  cohort: 'Cohort 3',
  is_incorporated: false,
  milestones: [
    { key: 'project_created', week: 1 },
    { key: 'customer_interview_logged_1', week: 1 },
    { key: 'customer_interview_logged_2', week: 1 },
    { key: 'customer_interview_logged_3', week: 1 },
  ],
  unlocked_features: [],
};

const GRADUATION_STATE = {
  active: false,
  admitted: true,
  week: 4,
  days_remaining: 0,
  started_at: '2026-07-01T00:00:00Z',
  cohort: 'Cohort 3',
  is_incorporated: true,
  milestones: [{ key: 'incorporation_completed', week: 4 }],
  unlocked_features: [],
};

// Mirrors the production confirmation email template
// (cloudflare-worker/src/templates/email/registry.ts →
// spinout_application_received) with sample variables, so admins see the
// exact email a founder receives after applying. Keep the copy in lockstep
// with the Worker template.
function ConfirmationEmailCard() {
  return (
    <section className="max-w-[640px] mx-auto mt-8" data-testid="preview-confirmation-email">
      <div className="flex items-center gap-2 mb-2.5 text-gray-500 dark:text-gray-400">
        <Mail size={15} aria-hidden="true" />
        <span className="text-[13px] font-semibold">The confirmation email founders receive</span>
        <span className="text-[11.5px] text-gray-400">· sample data</span>
      </div>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 text-[12.5px] text-gray-500 dark:text-gray-400 space-y-0.5">
          <div><span className="font-semibold text-gray-700 dark:text-gray-300">From:</span> Axal VC &lt;support@axal.vc&gt;</div>
          <div><span className="font-semibold text-gray-700 dark:text-gray-300">Subject:</span> Application received — Spin-Out Lab (Cohort 4)</div>
        </div>
        <div className="px-6 py-6">
          <h2 className="m-0 mb-2 text-[22px] font-bold tracking-[-0.02em] text-gray-900 dark:text-gray-100">Application received</h2>
          <p className="m-0 mb-5 text-[14px] leading-relaxed text-gray-500 dark:text-gray-400">
            Hi Alex, we've received your <strong className="text-gray-900 dark:text-gray-100">Spin-Out Lab</strong> application
            for <strong className="text-gray-900 dark:text-gray-100">Northwind Labs</strong> (Cohort 4).
          </p>
          <div className="rounded-[14px] border border-[#e9d5ff] dark:border-violet-800/50 bg-[#faf5ff] dark:bg-violet-950/30 px-5 py-4 mb-6">
            <div className="text-[11px] uppercase tracking-[0.06em] text-[#7c3aed] dark:text-violet-300 font-semibold mb-2.5">What happens next</div>
            <div className="text-[14px] leading-[1.8] text-gray-900 dark:text-gray-100">
              1. <strong>Application review</strong> — a program manager reviews within 5 business days.<br />
              2. <strong>Founder interview</strong> — a 30-minute call to align on scope and readiness.<br />
              3. <strong>Cohort onboarding</strong> — accepted founders start at the Validate gate on day one.
            </div>
          </div>
          <p className="m-0 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">No equity taken by Axal VC. Acceptance is selective.</p>
        </div>
      </div>
    </section>
  );
}

export default function AdminSpinoutJourneyPreview() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const rawStage = params.get('stage');
  const stage = STAGES.some((s) => s.key === rawStage) ? rawStage : 'marketing';
  const setStage = (key) => setParams({ stage: key });
  const exit = () => navigate('/admin?tab=lab-applications');

  // Keep the walkthrough contained: the reused founder components carry
  // their real links (e.g. "Back to Spin-Out Lab" → /spinout-lab, marketing
  // CTA → /register, "Apply to Next Cohort" → /spinout-lab/apply). A
  // capture-phase intercept remaps those to preview stages instead of
  // navigating away from the stepper. React Router's <Link> respects
  // e.preventDefault(), and stopPropagation() keeps its own handler from
  // firing. External/mailto links keep their default behavior.
  const containNavigation = (e) => {
    const anchor = e.target.closest ? e.target.closest('a[href]') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (/^(https?:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('#')) return;
    e.preventDefault();
    e.stopPropagation();
    if (href.startsWith('/spinout-lab/apply') || href.startsWith('/register')) {
      setStage('apply');
    } else if (href.startsWith('/spinout-lab/brief')) {
      // The program brief is read-only; open it without leaving the preview.
      window.open(href, '_blank', 'noopener');
    } else if (href.startsWith('/spinout-lab')) {
      setStage('marketing');
    }
    // Any other internal link is swallowed — the preview stays on the stepper.
  };

  let content;
  switch (stage) {
    case 'apply':
      content = (
        <div className="min-h-[100dvh] bg-[#F8F8FA] dark:bg-gray-950 px-6 py-8">
          <SpinoutLabApplyPage previewMode="form" onPreviewSubmitted={() => setStage('confirmation')} />
        </div>
      );
      break;
    case 'confirmation':
      content = (
        <div className="min-h-[100dvh] bg-[#F8F8FA] dark:bg-gray-950 px-6 py-8 pb-16">
          <SpinoutLabApplyPage previewMode="submitted" />
          <ConfirmationEmailCard />
        </div>
      );
      break;
    case 'welcome':
      content = (
        <CongratulationsScreen
          cohort="Cohort 4"
          onStart={() => setStage('workspace')}
          starting={false}
          startError=""
        />
      );
      break;
    case 'workspace':
      content = <SpinoutLabWorkspace state={WORKSPACE_STATE} previewAllUnlocked />;
      break;
    case 'graduation':
      content = <SpinoutLabWorkspace state={GRADUATION_STATE} />;
      break;
    case 'marketing':
    default:
      content = <SpinoutLabMarketingPage />;
      break;
  }

  return (
    <div data-testid="admin-journey-preview">
      {/* Persistent stepper bar */}
      <div className="sticky top-0 z-50 bg-gray-900 text-white border-b border-gray-800 shadow-md">
        <div className="max-w-[1200px] mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-violet-300 whitespace-nowrap">
            <Eye size={14} aria-hidden="true" /> Admin preview
          </span>
          <span className="hidden sm:inline text-[11px] text-gray-400 whitespace-nowrap">Read-only · simulated founder data</span>
          <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0" role="tablist" aria-label="Founder journey stages">
            {STAGES.map((s, i) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={stage === s.key}
                onClick={() => setStage(s.key)}
                data-testid={`preview-stage-${s.key}`}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold whitespace-nowrap transition-colors ${
                  stage === s.key
                    ? 'bg-violet-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className={`tabular-nums w-[17px] h-[17px] rounded-full text-[10.5px] font-bold flex items-center justify-center ${stage === s.key ? 'bg-white/20' : 'bg-gray-700'}`}>{i + 1}</span>
                {s.label}
              </button>
            ))}
          </div>
          <button
            onClick={exit}
            data-testid="preview-exit"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold text-gray-300 hover:bg-gray-800 hover:text-white whitespace-nowrap"
          >
            <X size={14} aria-hidden="true" /> Exit preview
          </button>
        </div>
      </div>

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div onClickCapture={containNavigation}>{content}</div>
    </div>
  );
}
