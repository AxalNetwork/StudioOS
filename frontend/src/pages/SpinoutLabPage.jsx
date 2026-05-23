import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Check, Loader2, Rocket, Sparkles, ArrowRight, BookOpen } from 'lucide-react';
import { spinoutLab } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import SpinoutLabMarketingPage from './SpinoutLabMarketingPage';

// Task #12 — Mid-sprint explainer cards rendered below the live tracker.
// Same content as SpinoutLabMarketingPage, condensed and collapsed by
// default so authed founders can re-read any section without losing
// scroll on the dashboard.
const EXPLAINER_CARDS = [
  {
    id: 'playbook',
    title: 'The 4-week playbook',
    body: (
      <div className="space-y-4 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <p>
          <span className="font-semibold text-gray-900 dark:text-gray-100">Week 1 — Idea & Customer.</span> Define the
          problem, ICP, market sizing seed, talk to ≥5 customers, log every interview. Unlocks{' '}
          <Link to="/projects" className="text-violet-700 hover:underline">Projects</Link>,{' '}
          <Link to="/customer-discovery" className="text-violet-700 hover:underline">Customer Discovery</Link>,{' '}
          <Link to="/market-intel" className="text-violet-700 hover:underline">Market Intelligence</Link>.
        </p>
        <p>
          <span className="font-semibold text-gray-900 dark:text-gray-100">Week 2 — Solution & Roadmap.</span> Scope the
          MVP, set 90-day OKRs, draft brand v1, draft pitch deck v1. Unlocks{' '}
          <Link to="/build/roadmap" className="text-violet-700 hover:underline">Roadmap</Link>,{' '}
          <Link to="/build/brand" className="text-violet-700 hover:underline">Brand Builder</Link>,{' '}
          <Link to="/build/deck" className="text-violet-700 hover:underline">Pitch Deck Builder</Link>.
        </p>
        <p>
          <span className="font-semibold text-gray-900 dark:text-gray-100">Week 3 — Validate & Team.</span> Run your
          first venture-readiness score, match with mentors, decide co-founder track. Unlocks{' '}
          <Link to="/scoring" className="text-violet-700 hover:underline">Scoring</Link>,{' '}
          <Link to="/mentors" className="text-violet-700 hover:underline">Mentors</Link>,{' '}
          <Link to="/office-hours" className="text-violet-700 hover:underline">Office Hours</Link>,{' '}
          <Link to="/cofounder" className="text-violet-700 hover:underline">Co-founder Match</Link>.
        </p>
        <p>
          <span className="font-semibold text-gray-900 dark:text-gray-100">Week 4 — Incorporate & Capital.</span>{' '}
          Incorporate, vest, file 83(b), sign cofounder agreement, lock the ask. Unlocks{' '}
          <Link to="/incorporate" className="text-violet-700 hover:underline">Incorporate</Link>,{' '}
          <Link to="/build/captable" className="text-violet-700 hover:underline">Cap Table</Link>,{' '}
          <Link to="/incorporate/83b" className="text-violet-700 hover:underline">Section 83(b)</Link>,{' '}
          <Link to="/incorporate/cofounder-agreement" className="text-violet-700 hover:underline">Cofounder Agreement</Link>,{' '}
          <Link to="/capital" className="text-violet-700 hover:underline">Capital</Link>,{' '}
          <Link to="/compliance" className="text-violet-700 hover:underline">Compliance</Link>, and{' '}
          <Link to="/kyc" className="text-violet-700 hover:underline">KYC</Link> (investor-side, before any wire).
        </p>
      </div>
    ),
  },
  {
    id: 'what-you-get',
    title: 'What you get',
    body: (
      <ul className="space-y-2 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <li>Personal Advisor on every page — Workers AI Llama 3.3 70B FP8.</li>
        <li>Three warm investor introductions in Week 4 for qualified founders (three-way NDA gated).</li>
        <li>Mentor track matched by expertise, availability, language, time zone, rating.</li>
        <li>Services partners (legal, design, recruiting, technical DD) at Axal-network rates.</li>
        <li>Sector + investor + sentiment + TALC + atlas + capital-velocity intelligence.</li>
        <li>Document automation: incorporation, 83(b), cofounder agreement, SAFE, NDAs.</li>
        <li>Alumni community for life.</li>
        <li>Equity-for-platform option for accepted ventures (separately negotiated, never automatic).</li>
      </ul>
    ),
  },
  {
    id: 'what-we-look-for',
    title: 'What we look for',
    body: (
      <div className="grid md:grid-cols-2 gap-6 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <div>
          <h4 className="text-xs uppercase tracking-wider text-violet-700 font-semibold mb-2">
            Strong signals
          </h4>
          <ul className="space-y-1.5">
            <li>Domain expertise — years in the target sector</li>
            <li>Customer access — warm intros to ICP from day 1</li>
            <li>Commitment level — full-time</li>
            <li>Lived insight — non-obvious view about what's broken</li>
            <li>Coachability — adjusts to evidence</li>
            <li>Founder + market fit — right person for this specific problem</li>
          </ul>
        </div>
        <div>
          <h4 className="text-xs uppercase tracking-wider text-violet-700 font-semibold mb-2">
            Filters
          </h4>
          <ul className="space-y-1.5">
            <li>Sector fit: AI · Blockchain · Quantum · Digital Infra · Frontier Software</li>
            <li>Geography we can support</li>
            <li>Founder ≥ 18</li>
            <li>No sanctions / PEP / bad-actor disqualifications</li>
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            Common reasons we say no: too generic a thesis, no customer access, part-time only,
            conflicts of interest, sector mismatch.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'network',
    title: 'Network',
    body: (
      <ul className="space-y-2 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <li>Operating partners — legal, GTM, design, recruiting, data, technical DD, finance.</li>
        <li>Investor signals from Axal's pipeline (anonymised until pairwise NDA signed).</li>
        <li>Mentor pool with expertise tags and availability calendars.</li>
        <li>Co-marketing partners across the network for distribution.</li>
        <li>Alumni founders from previous cohorts.</li>
      </ul>
    ),
  },
  {
    id: 'market-data',
    title: 'Market data',
    body: (
      <ul className="space-y-2 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <li>Sector compass — best sub-sectors given your profile.</li>
        <li>Investor signals — live aggregate of investor thesis + deployment (k-anonymity ≥ 5).</li>
        <li>TALC positioning — where the market is on the technology-adoption lifecycle.</li>
        <li>Demand & supply atlas — needs vs. offers across the network.</li>
        <li>Founder ↔ investor fit — embeddings-based thesis match.</li>
        <li>Capital velocity — deployment pace per stage per sector.</li>
        <li className="pt-2">
          <Link to="/market-intel" className="text-violet-700 hover:underline">Open Market Intelligence →</Link>
        </li>
      </ul>
    ),
  },
  {
    id: 'pricing',
    title: 'Pricing',
    body: (
      <p className="text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <span className="font-semibold text-gray-900 dark:text-gray-100">Free during the 30-day sprint.</span> After
        graduation: standard Founder tiers (Free / Growth / Studio). Services partners are
        separately priced.
      </p>
    ),
  },
  {
    id: 'faq',
    title: 'FAQ',
    body: (
      <ul className="space-y-3 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">I already have a co-founder.</span> Week 3
          is still useful for scoring and investor exposure.
        </li>
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">I missed a milestone.</span> You stay at
          the current week until you complete it. Personal Advisor will list what's missing.
        </li>
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">Do you take equity?</span> Only under a
          separately negotiated partnership / spin-out agreement. Never automatically.
        </li>
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">Can I bring an existing project?</span>{' '}
          Yes — fast-forward through weeks you've already completed.
        </li>
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">What jurisdictions?</span> Delaware C-Corp
          default; LLC, UK Ltd, French SAS, German GmbH supported with partner counsel.
        </li>
      </ul>
    ),
  },
];

function ExplainerCards() {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
        <BookOpen size={16} className="text-violet-600" /> Explainers
      </h2>
      <p className="text-xs text-gray-500 -mt-1">
        Same playbook your applicants see — collapsed by default so they don't crowd your sprint.
      </p>
      <div className="space-y-2">
        {EXPLAINER_CARDS.map((card) => (
          <details
            key={card.id}
            id={`explainer-${card.id}`}
            className="group bg-white border border-gray-200 rounded-xl p-4 open:border-violet-300 open:bg-violet-50/30 dark:bg-gray-900 dark:border-gray-800"
          >
            <summary className="cursor-pointer text-sm font-semibold text-gray-900 list-none flex items-center justify-between dark:text-gray-100">
              {card.title}
              <span className="text-violet-600 text-xs group-open:rotate-180 transition-transform">
                ▾
              </span>
            </summary>
            <div className="mt-4">{card.body}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

// Spin-Out Lab — authenticated dashboard.
//   - Unauthenticated visitors still see the public marketing page so the
//     /spinout-lab landing route works for cold traffic.
//   - Authenticated users with `spinout_lab_active === 1` see the 4-week
//     dashboard (progress bar, day counter, milestone checklist, per-week
//     feature explainers).
//   - Authenticated users without an active lab are bounced to '/'.
//   - When the lab flips off (Week 4 finished, server set
//     spinout_lab_active = 0 and is_incorporated = 1), we show the
//     "You're incorporated" success state with the exit CTA.

const WEEK_TITLES = {
  1: 'Week 1 — Discover',
  2: 'Week 2 — Build',
  3: 'Week 3 — Validate',
  4: 'Week 4 — Incorporate',
};

const MILESTONE_LABELS = {
  project_created: 'Create your first project',
  customer_interview_logged_1: 'Log customer interview #1',
  customer_interview_logged_2: 'Log customer interview #2',
  customer_interview_logged_3: 'Log customer interview #3',
  okrs_created: 'Set your quarter OKRs',
  brand_basics_filled: 'Fill in brand basics (name, tagline, colours)',
  pitch_deck_drafted: 'Draft your pitch deck',
  scoring_run_completed: 'Run the AI scoring engine',
  mentor_meeting_booked: 'Book a mentor meeting',
  cofounder_request_sent: 'Send a co-founder request',
  incorporation_completed: 'Complete incorporation',
};

// Per-week milestone catalogue must mirror cloudflare-worker/src/routes/spinout_lab.ts.
// Worker is the source of truth for advancement; this list only drives UI.
const WEEK_MILESTONES = {
  1: ['project_created', 'customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3'],
  2: ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'],
  3: ['scoring_run_completed', 'mentor_meeting_booked', 'cofounder_request_sent'],
  4: ['incorporation_completed'],
};

// Per-feature explainer copy. Keys match the strings in
// `unlocked_features` returned by /api/spinout-lab/state.
const FEATURE_EXPLAINERS = {
  'spinout-lab': {
    label: 'Spin-Out Lab dashboard',
    blurb: "Your home base for the 4-week sprint — track milestones, days remaining, and what unlocks next.",
  },
  projects: {
    label: 'Projects',
    blurb: 'Spin up your venture record. The whole platform hangs off this one project for the rest of the sprint.',
  },
  'customer-discovery': {
    label: 'Customer Discovery',
    blurb: 'Log interviews, hypotheses, and pains. Three logged interviews unlocks the next week.',
  },
  'market-intelligence': {
    label: 'Market Intelligence',
    blurb: 'Live macro indicators, private rounds, and studio benchmarks to pressure-test your market.',
  },
  roadmap: {
    label: 'Roadmap',
    blurb: 'Set quarterly OKRs and key results so the next two weeks have something concrete to deliver against.',
  },
  'brand-builder': {
    label: 'Brand Builder',
    blurb: 'Name, tagline, palette, and a one-page landing. Enough to start opening doors.',
  },
  'pitch-deck': {
    label: 'Pitch Deck',
    blurb: 'Generate a working seed deck from your project + market intel; iterate before mentors see it.',
  },
  'cofounder-match': {
    label: 'Co-founder Match',
    blurb: 'Search the cofounder pool and send your first intro requests — single-founder companies fundraise harder.',
  },
  mentors: {
    label: 'Mentors',
    blurb: 'Browse the mentor directory and request your first session.',
  },
  'office-hours': {
    label: 'Office Hours',
    blurb: 'Book recurring office hours with mentors and partners across the network.',
  },
  scoring: {
    label: 'AI Scoring',
    blurb: 'Run the 100-point scoring engine on your project. Tier 1 (≥85) unlocks the cohort offer.',
  },
  incorporate: {
    label: 'Incorporate',
    blurb: 'Stripe Atlas / Cooley GO incorporation flow. Picks state, files docs, registers EIN.',
  },
  captable: {
    label: 'Cap Table',
    blurb: 'Initialize founder vesting and seed the cap-table simulator with your real numbers.',
  },
  'section-83b': {
    label: 'Section 83(b) Tracker',
    blurb: '30-day filing deadline tracker so vesting starts clean. Upload your IRS receipt when it arrives.',
  },
  'cofounder-agreement': {
    label: 'Co-founder Agreement',
    blurb: 'Draft the IP / vesting / decision-rights agreement before equity gets messy.',
  },
  capital: {
    label: 'Capital',
    blurb: 'LP introductions, SAFE generation, and partner co-invest commitments.',
  },
  compliance: {
    label: 'Compliance Calendar',
    blurb: 'Standard post-incorporation events seeded for your jurisdiction (annual report, franchise tax, etc.).',
  },
  // Task #2 — KYC is now investor-only; founders never need it, so the
  // Spinout Lab no longer renders a kyc explainer card.
};

function ProgressBar({ week }) {
  const weeks = [1, 2, 3, 4];
  return (
    <div>
      <div className="flex items-center gap-2">
        {weeks.map((w, i) => {
          const done = w < week;
          const active = w === week;
          return (
            <React.Fragment key={w}>
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold border ${
                  done
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : active
                    ? 'bg-violet-600 text-white border-violet-600 ring-4 ring-violet-100'
                    : 'bg-white text-gray-500 border-gray-300'
                }`}
              >
                {done ? <Check size={14} /> : w}
              </div>
              {i < weeks.length - 1 && (
                <div className={`flex-1 h-1 rounded ${w < week ? 'bg-emerald-500' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] uppercase tracking-wider text-gray-500">
        <span>Discover</span>
        <span>Build</span>
        <span>Validate</span>
        <span>Incorporate</span>
      </div>
    </div>
  );
}

function ExitSuccess({ onContinue, busy }) {
  return (
    <div className="max-w-2xl mx-auto bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mb-4">
        <Check size={22} />
      </div>
      <h1 className="text-2xl font-bold text-emerald-900 mb-2">You're incorporated.</h1>
      <p className="text-sm text-emerald-800 mb-6">
        Spin-Out Lab is complete. Every founder feature is now unlocked — your
        sidebar will swap to the full set when you continue.
      </p>
      <button
        onClick={onContinue}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
      >
        {busy ? <Loader2 className="animate-spin" size={14} /> : <ArrowRight size={14} />}
        Continue to dashboard
      </button>
    </div>
  );
}

function Dashboard({ state, onComplete, completing, completeError }) {
  const week = Math.max(1, Math.min(4, state.week || 1));
  const completedKeys = new Set((state.milestones || []).map((m) => m.key));
  const weekKeys = WEEK_MILESTONES[week] || [];
  const startedAt = state.started_at;
  const dayNumber = startedAt
    ? Math.min(28, Math.max(1, 28 - (state.days_remaining ?? 28) + 1))
    : 1;
  const features = (state.unlocked_features || []).filter((f) => FEATURE_EXPLAINERS[f]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-violet-100 border border-violet-200 rounded-full text-[11px] text-violet-700 font-medium mb-3">
            <Rocket size={11} /> Spin-Out Lab
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{WEEK_TITLES[week]}</h1>
          <p className="text-sm text-gray-600 mt-1">
            Day <span className="font-semibold text-gray-900 dark:text-gray-100">{dayNumber}</span> of 28 ·{' '}
            <span className="text-gray-500">{state.days_remaining} day{state.days_remaining === 1 ? '' : 's'} left</span>
          </p>
        </div>
      </header>

      <ProgressBar week={week} />

      <section className="bg-white border border-gray-200 rounded-2xl p-6 dark:bg-gray-900 dark:border-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-gray-100">This week's milestones</h2>
        <ul className="space-y-2">
          {weekKeys.map((key) => {
            const done = completedKeys.has(key);
            return (
              <li
                key={key}
                className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border ${
                  done ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      done ? 'bg-emerald-500 text-white' : 'bg-white border border-gray-300 text-gray-400'
                    }`}
                  >
                    {done ? <Check size={14} /> : null}
                  </div>
                  <span className={`text-sm ${done ? 'text-emerald-900 line-through' : 'text-gray-900'}`}>
                    {MILESTONE_LABELS[key] || key}
                  </span>
                </div>
                {!done && (
                  <button
                    onClick={() => onComplete(key)}
                    disabled={completing === key}
                    className="inline-flex items-center gap-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-md"
                  >
                    {completing === key ? <Loader2 className="animate-spin" size={12} /> : null}
                    Mark complete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {completeError && (
          <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {completeError}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2 dark:text-gray-100">
          <Sparkles size={16} className="text-violet-600" /> Unlocked this sprint
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {features.map((f) => (
            <div key={f} className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{FEATURE_EXPLAINERS[f].label}</div>
              <div className="text-xs text-gray-600 mt-1 leading-relaxed">{FEATURE_EXPLAINERS[f].blurb}</div>
            </div>
          ))}
        </div>
      </section>

      <ExplainerCards />
    </div>
  );
}

export default function SpinoutLabPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(null);
  const [completeError, setCompleteError] = useState('');
  const [exiting, setExiting] = useState(false);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await spinoutLab.state();
      setState(next);
      setErrored(false);
    } catch (e) {
      reportError('spinout-lab:state', e);
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user, load]);

  // Task #15 — Refresh the dashboard whenever a milestone is marked
  // anywhere in the app (markMilestone in spinoutLabHooks.js dispatches
  // this). Local "Mark complete" clicks already update state inline; this
  // covers cross-page completions (pitch deck, mentor booking, etc.) that
  // happen while the user is sitting on the Lab page in another tab/route.
  useEffect(() => {
    const onAdvanced = () => { load(); };
    window.addEventListener('spinout-lab:advanced', onAdvanced);
    return () => window.removeEventListener('spinout-lab:advanced', onAdvanced);
  }, [load]);

  // Unauthenticated → keep showing the public marketing page so the
  // /spinout-lab URL still works for cold traffic.
  if (!user) return <SpinoutLabMarketingPage />;

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading your sprint…
      </div>
    );
  }

  // Lab is off and the user never started it (and isn't freshly incorporated
  // via Week 4 auto-exit) → bounce to standard dashboard. We treat
  // `is_incorporated && !active && state exists` as "just finished Week 4"
  // and show the success state instead.
  if (!state) {
    if (errored) return <Navigate to="/" replace />;
    return <Navigate to="/" replace />;
  }

  if (!state.active) {
    // If user.spinout_lab_active was 1 in cached auth but server says off,
    // they just finished Week 4 → show success. Otherwise bounce.
    const wasActive =
      user?.spinout_lab_active === 1 ||
      (state.is_incorporated && (state.milestones || []).some((m) => m.key === 'incorporation_completed'));
    if (!wasActive) return <Navigate to="/" replace />;

    const onContinue = async () => {
      setExiting(true);
      try {
        // Idempotent on the server — safe to call even though Week 4
        // auto-exit already flipped the flags.
        await spinoutLab.exit();
      } catch (e) {
        reportError('spinout-lab:exit', e);
      }
      try {
        await refresh({ force: true });
      } catch { /* no-op */ }
      navigate('/');
    };
    return (
      <div className="min-h-[60vh] flex items-center px-4 py-10">
        <ExitSuccess onContinue={onContinue} busy={exiting} />
      </div>
    );
  }

  const onComplete = async (key) => {
    setCompleting(key);
    setCompleteError('');
    try {
      const next = await spinoutLab.complete(key);
      setState(next);
      // Task #16 — Mirror the same event shape that markMilestone()
      // dispatches so the global SpinoutLabListener can show its
      // week-advance / completion celebration even when the founder
      // marks a milestone directly from this page.
      try {
        window.dispatchEvent(
          new CustomEvent('spinout-lab:advanced', {
            detail: { state: next, milestoneKey: key },
          }),
        );
      } catch { /* no-op */ }
      // Auto-advance may have flipped the lab off (Week 4) — refresh auth
      // so user.spinout_lab_active mirrors the server.
      if (!next.active) {
        try { await refresh({ force: true }); } catch { /* no-op */ }
      }
    } catch (e) {
      setCompleteError(e?.message || 'Could not mark milestone complete');
      reportError('spinout-lab:complete', e);
    } finally {
      setCompleting(null);
    }
  };

  return <Dashboard state={state} onComplete={onComplete} completing={completing} completeError={completeError} />;
}
