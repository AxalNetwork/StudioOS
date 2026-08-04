
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Loader2, Rocket, Sparkles, ArrowRight, BookOpen, Lock, FlaskConical, Bell, ChevronDown, CheckCircle2, Circle } from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { deckReadinessState } from '../lib/deckReadiness';
import { useAuth } from '../hooks/useAuthSync';
import SpinoutLabMarketingPage from './SpinoutLabMarketingPage';

const EXPLAINER_CARDS = [
  {
    id: 'playbook',
    title: 'The 4-week playbook',
    body: (
      <div className="space-y-4 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <p>
          <span className="font-semibold text-gray-900 dark:text-gray-100">Week 1 — Idea & Customer.</span> Define the
          problem, ICP, market sizing seed, talk to ≥5 customers, log every interview. Unlocks{' '}
          <Link to="/projects" className="text-violet-700 hover:underline">Startups</Link>,{' '}
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
          first venture-readiness score, match with advisors, decide co-founder track. Unlocks{' '}
          <Link to="/scoring" className="text-violet-700 hover:underline">Scoring</Link>,{' '}
          <Link to="/advisors" className="text-violet-700 hover:underline">Advisors</Link>,{' '}
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
        <li>Advisor track matched by expertise, availability, language, time zone, rating.</li>
        <li>Services partners (legal, design, recruiting, technical DD) at Axal VC network rates.</li>
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
        <li>Investor signals from Axal VC's pipeline (anonymised until pairwise NDA signed).</li>
        <li>Advisor pool with expertise tags and availability calendars.</li>
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
          <span className="font-semibold text-gray-900 dark:text-gray-100">Can I bring an existing startup?</span>{' '}
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

const HUB_WEEKS = [
  {
    week: 1,
    title: 'Idea & Customer',
    blurb: 'Define the problem, ICP and market — talk to real customers.',
    tools: [
      { to: '/projects', label: 'Startups', blurb: 'Create and manage your venture profile.' },
      { to: '/customer-discovery', label: 'Customer Discovery', blurb: 'Log interviews, extract pains and quotes.' },
      { to: '/market-intel', label: 'Market Intelligence', blurb: 'TAM/SAM/SOM, sector compass, investor signals.' },
    ],
  },
  {
    week: 2,
    title: 'Solution & Roadmap',
    blurb: 'Scope the MVP, set 90-day OKRs, draft brand and deck v1.',
    tools: [
      { to: '/build/roadmap', label: 'Roadmap & MVP Scope', blurb: '90-day OKRs plus value-ranked MVP prioritization.' },
      { to: '/build/brand', label: 'Brand Builder', blurb: 'Name shortlists, palette, brand v1.' },
      { to: '/build/deck', label: 'Pitch Deck Builder', blurb: 'Deck v1 assembled from your module data.' },
    ],
  },
  {
    week: 3,
    title: 'Validate & Team',
    blurb: 'Score venture readiness, match with advisors, decide the co-founder track.',
    tools: [
      { to: '/scoring', label: 'Scoring', blurb: 'Venture-readiness score across 6 dimensions.' },
      { to: '/advisors', label: 'Advisors', blurb: 'Matched by expertise, availability and time zone.' },
      { to: '/office-hours', label: 'Office Hours', blurb: 'Book time with operators and advisors.' },
      { to: '/cofounder', label: 'Co-founder Match', blurb: 'Find or formalize your co-founding team.' },
    ],
  },
  {
    week: 4,
    title: 'Incorporate & Capital',
    blurb: 'Incorporate, vest, file 83(b), sign agreements, lock the ask.',
    tools: [
      { to: '/incorporate', label: 'Incorporate', blurb: 'Delaware C-Corp default; other jurisdictions supported.' },
      { to: '/build/captable', label: 'Cap Table', blurb: 'Ownership, vesting and dilution scenarios.' },
      { to: '/incorporate/83b', label: 'Section 83(b)', blurb: 'Election filing, generated and tracked.' },
      { to: '/incorporate/cofounder-agreement', label: 'Cofounder Agreement', blurb: 'Signed roles, equity and vesting.' },
      { to: '/capital', label: 'Capital', blurb: 'SAFEs, the ask, and investor introductions.' },
      { to: '/compliance', label: 'Compliance', blurb: 'KYC and bad-actor checks before any wire.' },
    ],
  },
];

function LabHub() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      <header>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-violet-100 border border-violet-200 rounded-full text-[11px] text-violet-700 font-medium mb-3">
          <Rocket size={11} /> Spin-Out Lab
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">The 28-day venture pipeline</h1>
        <p className="text-sm text-gray-600 mt-2 max-w-2xl dark:text-gray-400">
          Everything the Lab unlocks, in one place — from first customer interview to incorporation.
          Each week of the sprint opens the tools below; you can explore any of them right now.
        </p>
      </header>

      {HUB_WEEKS.map((w) => (
        <section key={w.week} aria-label={`Week ${w.week} — ${w.title}`}>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-violet-600">Week {w.week}</span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{w.title}</h2>
            <span className="text-xs text-gray-500 hidden sm:inline">{w.blurb}</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {w.tools.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="group bg-white border border-gray-200 rounded-xl p-4 hover:border-violet-300 hover:shadow-sm transition dark:bg-gray-900 dark:border-gray-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900 group-hover:text-violet-700 dark:text-gray-100">{t.label}</span>
                  <ArrowRight size={13} className="text-gray-300 group-hover:text-violet-500" />
                </div>
                <div className="text-xs text-gray-600 mt-1 leading-relaxed dark:text-gray-400">{t.blurb}</div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <ExplainerCards />
    </div>
  );
}

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

const WEEK_TITLES = {
  1: 'Week 1 — Discover',
  2: 'Week 2 — Build',
  3: 'Week 3 — Validate',
  4: 'Week 4 — Incorporate',
};

const MILESTONE_LABELS = {
  project_created: 'Create your first startup',
  customer_interview_logged_1: 'Log customer interview #1',
  customer_interview_logged_2: 'Log customer interview #2',
  customer_interview_logged_3: 'Log customer interview #3',
  okrs_created: 'Set your quarter OKRs',
  brand_basics_filled: 'Fill in brand basics (name, tagline, colours)',
  pitch_deck_drafted: 'Draft your pitch deck',
  scoring_run_completed: 'Run the AI scoring engine',
  advisor_meeting_booked: 'Book an advisor meeting',
  cofounder_request_sent: 'Send a co-founder request',
  incorporation_completed: 'Complete incorporation',
};

const WEEK_MILESTONES = {
  1: ['project_created', 'customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3'],
  2: ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'],
  3: ['scoring_run_completed', 'advisor_meeting_booked', 'cofounder_request_sent'],
  4: ['incorporation_completed'],
};

const FEATURE_EXPLAINERS = {
  'spinout-lab': {
    label: 'Spin-Out Lab dashboard',
    blurb: "Your home base for the 4-week sprint — track milestones, days remaining, and what unlocks next.",
  },
  projects: {
    label: 'Startups',
    blurb: 'Spin up your venture record. The whole platform hangs off this one startup for the rest of the sprint.',
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
    blurb: 'Generate a working seed deck from your startup + market intel; iterate before advisors see it.',
  },
  'cofounder-match': {
    label: 'Co-founder Match',
    blurb: 'Search the cofounder pool and send your first intro requests — single-founder companies fundraise harder.',
  },
  advisors: {
    label: 'Advisors',
    blurb: 'Browse the advisor directory and request your first session.',
  },
  'office-hours': {
    label: 'Office Hours',
    blurb: 'Book recurring office hours with advisors and partners across the network.',
  },
  scoring: {
    label: 'AI Scoring',
    blurb: 'Run the 100-point scoring engine on your startup. Tier 1 (≥85) unlocks the cohort offer.',
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
};

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
        Continue
      </button>
    </div>
  );
}
