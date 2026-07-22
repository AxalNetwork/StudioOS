import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Check,
  Loader2,
  Rocket,
  Sparkles,
  ArrowRight,
  BookOpen,
  Lock,
  FlaskConical,
  Bell,
  ChevronDown,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { api, spinoutLab } from "../lib/api";
import { deckReadinessState } from "../lib/deckReadiness";
import { useAuth } from "../hooks/useAuthSync";
import { reportError } from "../lib/log";
import SpinoutLabMarketingPage from "./SpinoutLabMarketingPage";

const EXPLAINER_CARDS = [
  {
    id: "playbook",
    title: "The 4-week playbook",
    body: (
      <div className="space-y-4 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <p>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Week 1 — Idea & Customer.
          </span>{" "}
          Define the problem, ICP, market sizing seed, talk to ≥5 customers, log
          every interview. Unlocks{" "}
          <Link to="/projects" className="text-violet-700 hover:underline">
            Startups
          </Link>
          ,{" "}
          <Link
            to="/customer-discovery"
            className="text-violet-700 hover:underline"
          >
            Customer Discovery
          </Link>
          ,{" "}
          <Link to="/market-intel" className="text-violet-700 hover:underline">
            Market Intelligence
          </Link>
          .
        </p>
        <p>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Week 2 — Solution & Roadmap.
          </span>{" "}
          Scope the MVP, set 90-day OKRs, draft brand v1, draft pitch deck v1.
          Unlocks{" "}
          <Link to="/build/roadmap" className="text-violet-700 hover:underline">
            Roadmap
          </Link>
          ,{" "}
          <Link to="/build/brand" className="text-violet-700 hover:underline">
            Brand Builder
          </Link>
          ,{" "}
          <Link to="/build/deck" className="text-violet-700 hover:underline">
            Pitch Deck Builder
          </Link>
          .
        </p>
        <p>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Week 3 — Validate & Team.
          </span>{" "}
          Run your first venture-readiness score, match with advisors, decide
          co-founder track. Unlocks{" "}
          <Link to="/scoring" className="text-violet-700 hover:underline">
            Scoring
          </Link>
          ,{" "}
          <Link to="/advisors" className="text-violet-700 hover:underline">
            Advisors
          </Link>
          ,{" "}
          <Link to="/office-hours" className="text-violet-700 hover:underline">
            Office Hours
          </Link>
          ,{" "}
          <Link to="/cofounder" className="text-violet-700 hover:underline">
            Co-founder Match
          </Link>
          .
        </p>
        <p>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Week 4 — Incorporate & Capital.
          </span>{" "}
          Incorporate, vest, file 83(b), sign cofounder agreement, lock the ask.
          Unlocks{" "}
          <Link to="/incorporate" className="text-violet-700 hover:underline">
            Incorporate
          </Link>
          ,{" "}
          <Link
            to="/build/captable"
            className="text-violet-700 hover:underline"
          >
            Cap Table
          </Link>
          ,{" "}
          <Link
            to="/incorporate/83b"
            className="text-violet-700 hover:underline"
          >
            Section 83(b)
          </Link>
          ,{" "}
          <Link
            to="/incorporate/cofounder-agreement"
            className="text-violet-700 hover:underline"
          >
            Cofounder Agreement
          </Link>
          ,{" "}
          <Link to="/capital" className="text-violet-700 hover:underline">
            Capital
          </Link>
          ,{" "}
          <Link to="/compliance" className="text-violet-700 hover:underline">
            Compliance
          </Link>
          , and{" "}
          <Link to="/kyc" className="text-violet-700 hover:underline">
            KYC
          </Link>{" "}
          (investor-side, before any wire).
        </p>
      </div>
    ),
  },
  {
    id: "what-you-get",
    title: "What you get",
    body: (
      <ul className="space-y-2 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <li>Personal Advisor on every page — Workers AI Llama 3.3 70B FP8.</li>
        <li>
          Three warm investor introductions in Week 4 for qualified founders
          (three-way NDA gated).
        </li>
        <li>
          Advisor track matched by expertise, availability, language, time zone,
          rating.
        </li>
        <li>
          Services partners (legal, design, recruiting, technical DD) at Axal VC
          network rates.
        </li>
        <li>
          Sector + investor + sentiment + TALC + atlas + capital-velocity
          intelligence.
        </li>
        <li>
          Document automation: incorporation, 83(b), cofounder agreement, SAFE,
          NDAs.
        </li>
        <li>Alumni community for life.</li>
        <li>
          Equity-for-platform option for accepted ventures (separately
          negotiated, never automatic).
        </li>
      </ul>
    ),
  },
  {
    id: "what-we-look-for",
    title: "What we look for",
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
            <li>
              Founder + market fit — right person for this specific problem
            </li>
          </ul>
        </div>
        <div>
          <h4 className="text-xs uppercase tracking-wider text-violet-700 font-semibold mb-2">
            Filters
          </h4>
          <ul className="space-y-1.5">
            <li>
              Sector fit: AI · Blockchain · Quantum · Digital Infra · Frontier
              Software
            </li>
            <li>Geography we can support</li>
            <li>Founder ≥ 18</li>
            <li>No sanctions / PEP / bad-actor disqualifications</li>
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            Common reasons we say no: too generic a thesis, no customer access,
            part-time only, conflicts of interest, sector mismatch.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "network",
    title: "Network",
    body: (
      <ul className="space-y-2 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <li>
          Operating partners — legal, GTM, design, recruiting, data, technical
          DD, finance.
        </li>
        <li>
          Investor signals from Axal VC's pipeline (anonymised until pairwise
          NDA signed).
        </li>
        <li>Advisor pool with expertise tags and availability calendars.</li>
        <li>Co-marketing partners across the network for distribution.</li>
        <li>Alumni founders from previous cohorts.</li>
      </ul>
    ),
  },
  {
    id: "market-data",
    title: "Market data",
    body: (
      <ul className="space-y-2 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <li>Sector compass — best sub-sectors given your profile.</li>
        <li>
          Investor signals — live aggregate of investor thesis + deployment
          (k-anonymity ≥ 5).
        </li>
        <li>
          TALC positioning — where the market is on the technology-adoption
          lifecycle.
        </li>
        <li>Demand & supply atlas — needs vs. offers across the network.</li>
        <li>Founder ↔ investor fit — embeddings-based thesis match.</li>
        <li>Capital velocity — deployment pace per stage per sector.</li>
        <li className="pt-2">
          <Link to="/market-intel" className="text-violet-700 hover:underline">
            Open Market Intelligence →
          </Link>
        </li>
      </ul>
    ),
  },
  {
    id: "pricing",
    title: "Pricing",
    body: (
      <p className="text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <span className="font-semibold text-gray-900 dark:text-gray-100">
          Free during the 30-day sprint.
        </span>{" "}
        After graduation: standard Founder tiers (Free / Growth / Studio).
        Services partners are separately priced.
      </p>
    ),
  },
  {
    id: "faq",
    title: "FAQ",
    body: (
      <ul className="space-y-3 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            I already have a co-founder.
          </span>{" "}
          Week 3 is still useful for scoring and investor exposure.
        </li>
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            I missed a milestone.
          </span>{" "}
          You stay at the current week until you complete it. Personal Advisor
          will list what's missing.
        </li>
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Do you take equity?
          </span>{" "}
          Only under a separately negotiated partnership / spin-out agreement.
          Never automatically.
        </li>
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Can I bring an existing startup?
          </span>{" "}
          Yes — fast-forward through weeks you've already completed.
        </li>
        <li>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            What jurisdictions?
          </span>{" "}
          Delaware C-Corp default; LLC, UK Ltd, French SAS, German GmbH
          supported with partner counsel.
        </li>
      </ul>
    ),
  },
];

const HUB_WEEKS = [
  {
    week: 1,
    title: "Idea & Customer",
    blurb: "Define the problem, ICP and market — talk to real customers.",
    tools: [
      {
        to: "/projects",
        label: "Startups",
        blurb: "Create and manage your venture profile.",
      },
      {
        to: "/customer-discovery",
        label: "Customer Discovery",
        blurb: "Log interviews, extract pains and quotes.",
      },
      {
        to: "/market-intel",
        label: "Market Intelligence",
        blurb: "TAM/SAM/SOM, sector compass, investor signals.",
      },
    ],
  },
  {
    week: 2,
    title: "Solution & Roadmap",
    blurb: "Scope the MVP, set 90-day OKRs, draft brand and deck v1.",
    tools: [
      {
        to: "/build/roadmap",
        label: "Roadmap & MVP Scope",
        blurb: "90-day OKRs plus value-ranked MVP prioritization.",
      },
      {
        to: "/build/brand",
        label: "Brand Builder",
        blurb: "Name shortlists, palette, brand v1.",
      },
      {
        to: "/build/deck",
        label: "Pitch Deck Builder",
        blurb: "Deck v1 assembled from your module data.",
      },
    ],
  },
  {
    week: 3,
    title: "Validate & Team",
    blurb:
      "Score venture readiness, match with advisors, decide the co-founder track.",
    tools: [
      {
        to: "/scoring",
        label: "Scoring",
        blurb: "Venture-readiness score across 6 dimensions.",
      },
      {
        to: "/advisors",
        label: "Advisors",
        blurb: "Matched by expertise, availability and time zone.",
      },
      {
        to: "/office-hours",
        label: "Office Hours",
        blurb: "Book time with operators and advisors.",
      },
      {
        to: "/cofounder",
        label: "Co-founder Match",
        blurb: "Find or formalize your co-founding team.",
      },
    ],
  },
  {
    week: 4,
    title: "Incorporate & Capital",
    blurb: "Incorporate, vest, file 83(b), sign agreements, lock the ask.",
    tools: [
      {
        to: "/incorporate",
        label: "Incorporate",
        blurb: "Delaware C-Corp default; other jurisdictions supported.",
      },
      {
        to: "/build/captable",
        label: "Cap Table",
        blurb: "Ownership, vesting and dilution scenarios.",
      },
      {
        to: "/incorporate/83b",
        label: "Section 83(b)",
        blurb: "Election filing, generated and tracked.",
      },
      {
        to: "/incorporate/cofounder-agreement",
        label: "Cofounder Agreement",
        blurb: "Signed roles, equity and vesting.",
      },
      {
        to: "/capital",
        label: "Capital",
        blurb: "SAFEs, the ask, and investor introductions.",
      },
      {
        to: "/compliance",
        label: "Compliance",
        blurb: "KYC and bad-actor checks before any wire.",
      },
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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          The 28-day venture pipeline
        </h1>
        <p className="text-sm text-gray-600 mt-2 max-w-2xl dark:text-gray-400">
          Everything the Lab unlocks, in one place — from first customer
          interview to incorporation. Each week of the sprint opens the tools
          below; you can explore any of them right now.
        </p>
      </header>

      {HUB_WEEKS.map((w) => (
        <section key={w.week} aria-label={`Week ${w.week} — ${w.title}`}>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-violet-600">
              Week {w.week}
            </span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {w.title}
            </h2>
            <span className="text-xs text-gray-500 hidden sm:inline">
              {w.blurb}
            </span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {w.tools.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="group bg-white border border-gray-200 rounded-xl p-4 hover:border-violet-300 hover:shadow-sm transition dark:bg-gray-900 dark:border-gray-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900 group-hover:text-violet-700 dark:text-gray-100">
                    {t.label}
                  </span>
                  <ArrowRight
                    size={13}
                    className="text-gray-300 group-hover:text-violet-500"
                  />
                </div>
                <div className="text-xs text-gray-600 mt-1 leading-relaxed dark:text-gray-400">
                  {t.blurb}
                </div>
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
        Same playbook your applicants see — collapsed by default so they don't
        crowd your sprint.
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
  1: "Week 1 — Discover",
  2: "Week 2 — Build",
  3: "Week 3 — Validate",
  4: "Week 4 — Incorporate",
};

const MILESTONE_LABELS = {
  project_created: "Create your first startup",
  customer_interview_logged_1: "Log customer interview #1",
  customer_interview_logged_2: "Log customer interview #2",
  customer_interview_logged_3: "Log customer interview #3",
  okrs_created: "Set your quarter OKRs",
  brand_basics_filled: "Fill in brand basics (name, tagline, colours)",
  pitch_deck_drafted: "Draft your pitch deck",
  scoring_run_completed: "Run the AI scoring engine",
  advisor_meeting_booked: "Book an advisor meeting",
  cofounder_request_sent: "Send a co-founder request",
  incorporation_completed: "Complete incorporation",
};

const WEEK_MILESTONES = {
  1: [
    "project_created",
    "customer_interview_logged_1",
    "customer_interview_logged_2",
    "customer_interview_logged_3",
  ],
  2: ["okrs_created", "brand_basics_filled", "pitch_deck_drafted"],
  3: [
    "scoring_run_completed",
    "advisor_meeting_booked",
    "cofounder_request_sent",
  ],
  4: ["incorporation_completed"],
};

const FEATURE_EXPLAINERS = {
  "spinout-lab": {
    label: "Spin-Out Lab dashboard",
    blurb:
      "Your home base for the 4-week sprint — track milestones, days remaining, and what unlocks next.",
  },
  projects: {
    label: "Startups",
    blurb:
      "Spin up your venture record. The whole platform hangs off this one startup for the rest of the sprint.",
  },
  "customer-discovery": {
    label: "Customer Discovery",
    blurb:
      "Log interviews, hypotheses, and pains. Three logged interviews unlocks the next week.",
  },
  "market-intelligence": {
    label: "Market Intelligence",
    blurb:
      "Live macro indicators, private rounds, and studio benchmarks to pressure-test your market.",
  },
  roadmap: {
    label: "Roadmap",
    blurb:
      "Set quarterly OKRs and key results so the next two weeks have something concrete to deliver against.",
  },
  "brand-builder": {
    label: "Brand Builder",
    blurb:
      "Name, tagline, palette, and a one-page landing. Enough to start opening doors.",
  },
  "pitch-deck": {
    label: "Pitch Deck",
    blurb:
      "Generate a working seed deck from your startup + market intel; iterate before advisors see it.",
  },
  "cofounder-match": {
    label: "Co-founder Match",
    blurb:
      "Search the cofounder pool and send your first intro requests — single-founder companies fundraise harder.",
  },
  advisors: {
    label: "Advisors",
    blurb: "Browse the advisor directory and request your first session.",
  },
  "office-hours": {
    label: "Office Hours",
    blurb:
      "Book recurring office hours with advisors and partners across the network.",
  },
  scoring: {
    label: "AI Scoring",
    blurb:
      "Run the 100-point scoring engine on your startup. Tier 1 (≥85) unlocks the cohort offer.",
  },
  incorporate: {
    label: "Incorporate",
    blurb:
      "Stripe Atlas / Cooley GO incorporation flow. Picks state, files docs, registers EIN.",
  },
  captable: {
    label: "Cap Table",
    blurb:
      "Initialize founder vesting and seed the cap-table simulator with your real numbers.",
  },
  "section-83b": {
    label: "Section 83(b) Tracker",
    blurb:
      "30-day filing deadline tracker so vesting starts clean. Upload your IRS receipt when it arrives.",
  },
  "cofounder-agreement": {
    label: "Co-founder Agreement",
    blurb:
      "Draft the IP / vesting / decision-rights agreement before equity gets messy.",
  },
  capital: {
    label: "Capital",
    blurb:
      "LP introductions, SAFE generation, and partner co-invest commitments.",
  },
  compliance: {
    label: "Compliance Calendar",
    blurb:
      "Standard post-incorporation events seeded for your jurisdiction (annual report, franchise tax, etc.).",
  },
};

function ExitSuccess({ onContinue, busy }) {
  return (
    <div className="max-w-2xl mx-auto bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mb-4">
        <Check size={22} />
      </div>
      <h1 className="text-2xl font-bold text-emerald-900 mb-2">
        You're incorporated.
      </h1>
      <p className="text-sm text-emerald-800 mb-6">
        Spin-Out Lab is complete. Every founder feature is now unlocked — your
        sidebar will swap to the full set when you continue.
      </p>
      <button
        onClick={onContinue}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
      >
        {busy ? (
          <Loader2 className="animate-spin" size={14} />
        ) : (
          <ArrowRight size={14} />
        )}
        Continue
      </button>
    </div>
  );
}

function DeckReadinessCard() {
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const fetchPreview = useCallback((isAlive, { showLoading = false } = {}) => {
    if (showLoading) setPreviewLoading(true);
    return api
      .listProjects()
      .then((r) => {
        const list = Array.isArray(r) ? r : r?.projects || [];
        const projectId = list[0]?.id;
        if (!projectId)
          throw Object.assign(new Error("no-project"), { silent: true });
        return api.spinoutDeckPreview(projectId);
      })
      .then((r) => {
        if (!isAlive()) return;
        setPreview({
          gaps: Array.isArray(r?.gaps) ? r.gaps : [],
          draft: !!r?.draft,
          programDay: Number.isFinite(r?.program_day) ? r.program_day : null,
        });
      })
      .catch((e) => {
        if (!isAlive()) return;
        setPreview(null);
        if (e?.status !== 402 && !e?.silent)
          reportError("spinout-lab:deck-preview", e);
      })
      .finally(() => {
        if (isAlive() && showLoading) setPreviewLoading(false);
      });
  }, []);

  useEffect(() => {
    let alive = true;
    fetchPreview(() => alive, { showLoading: true }).finally(() => {
      if (alive) setPreviewLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fetchPreview]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const refreshPreview = () => {
      if (!alive || inFlight) return;
      inFlight = true;
      fetchPreview(() => alive).finally(() => {
        inFlight = false;
      });
    };
    window.addEventListener("spinout-lab:advanced", refreshPreview);
    window.addEventListener("focus", refreshPreview);
    return () => {
      alive = false;
      window.removeEventListener("spinout-lab:advanced", refreshPreview);
      window.removeEventListener("focus", refreshPreview);
    };
  }, [fetchPreview]);

  const readiness = deckReadinessState({
    previewLoading,
    deckPreview: preview,
  });
  if (readiness === "hidden") return null;

  const dayLabel =
    preview?.programDay != null ? `Day ${preview.programDay} of 28` : null;

  if (readiness === "loading") {
    return (
      <section
        aria-label="Demo Day deck readiness"
        className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-gray-900 dark:border-gray-800"
      >
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking your Demo Day
          deck…
        </div>
      </section>
    );
  }

  if (readiness === "gaps") {
    const n = preview.gaps.length;
    return (
      <section
        aria-label="Demo Day deck readiness"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/30 dark:border-amber-900"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Your Demo Day deck is {n} item{n === 1 ? "" : "s"} from ready
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            Draft
          </span>
        </div>
        {dayLabel && (
          <div className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
            Spin-Out Lab · {dayLabel}
          </div>
        )}
        <ul className="mt-2 space-y-1">
          {preview.gaps.slice(0, 4).map((g, i) => (
            <li
              key={i}
              className="text-xs text-amber-800 dark:text-amber-300 flex gap-2"
            >
              <span aria-hidden>•</span>
              <span>{g}</span>
            </li>
          ))}
          {n > 4 && (
            <li className="text-[11px] text-amber-700/70 dark:text-amber-400/70">
              +{n - 4} more
            </li>
          )}
        </ul>
        <Link
          to="/build/deck?method_id=axal_spinout_demoday"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
        >
          Open the deck builder to fill these <ArrowRight size={13} />
        </Link>
      </section>
    );
  }

  if (readiness === "draft") {
    return (
      <section
        aria-label="Demo Day deck readiness"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/30 dark:border-amber-900"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <Check className="w-4 h-4" /> Every deck section is filled
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            Draft
          </span>
        </div>
        <div className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
          {dayLabel
            ? `Still in the Lab (${dayLabel}), so exports are marked as a draft until you finish the 28-day program.`
            : "Your program isn’t complete yet, so exports are marked as a draft."}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Demo Day deck readiness"
      className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:bg-emerald-950/30 dark:border-emerald-900"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
        <Check className="w-4 h-4" /> Your Demo Day deck is ready
      </div>
      <div className="mt-1 text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
        {dayLabel ? `Spin-Out Lab · ${dayLabel}. ` : ""}Every section is filled
        — export a final-quality deck.
      </div>
    </section>
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
  const features = state.unlocked_features || [];
  const completedTotal = state.milestones ? state.milestones.length : 0;
  const milestonesTotal = Object.values(WEEK_MILESTONES).flat().length;
  const progressPct =
    milestonesTotal > 0
      ? Math.round((completedTotal / milestonesTotal) * 100)
      : 0;
  const startedAtStr = startedAt
    ? `Started ${new Date(startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
    : "Started recently";
  const allUnlocked = features.length >= Object.keys(FEATURE_EXPLAINERS).length;
  const progressRingText = allUnlocked
    ? "All weeks unlocked"
    : `${progressPct}% milestones completed`;

  const timelineWeeks = [
    {
      num: 1,
      name: "Idea & Customer",
      summary:
        "Define the problem, ICP, market sizing seed, talk to ≥5 customers, log every interview.",
    },
    {
      num: 2,
      name: "Solution & Roadmap",
      summary:
        "Scope the MVP, set 90-day OKRs, draft brand v1, draft pitch deck v1.",
    },
    {
      num: 3,
      name: "Validate & Team",
      summary:
        "Score venture readiness, match with advisors, decide the co-founder track.",
    },
    {
      num: 4,
      name: "Incorporate & Capital",
      summary: "Incorporate, vest, file 83(b), sign agreements, lock the ask.",
    },
  ].map((w) => {
    const isDone = w.num < week;
    const isCurrent = w.num === week;
    const isLocked = w.num > week;
    return {
      ...w,
      isDone,
      isCurrent,
      isLocked,
      badgeStyle: isDone
        ? { color: "#15803d", background: "#dcfce7" }
        : isCurrent
          ? { color: "#6d28d9", background: "#f5f3ff" }
          : { color: "#a1a1aa", background: "#f4f4f5" },
      badgeText: isDone
        ? "Completed"
        : isCurrent
          ? `Active · D${dayNumber}`
          : "Locked",
      badgeIcon: isDone ? (
        <Check size={12} strokeWidth={3} />
      ) : isCurrent ? (
        <Circle
          size={12}
          fill="currentColor"
          stroke="none"
          style={{ animation: "wsPulse 2s infinite" }}
        />
      ) : (
        <Lock size={12} strokeWidth={2.5} />
      ),
      borderColor: isCurrent ? "#c4b5fd" : "#ececf1",
      cardExtra: isCurrent
        ? { animation: "wsGlow 3s infinite" }
        : isDone
          ? { background: "#fafafa" }
          : { opacity: 0.6 },
      accent: isCurrent ? "#7c3aed" : "#71717a",
      features: (HUB_WEEKS.find((hw) => hw.week === w.num)?.tools || []).map(
        (t) => ({ label: t.label, locked: isLocked }),
      ),
      deliverables: (WEEK_MILESTONES[w.num] || []).map((m) => {
        const dDone = completedKeys.has(m);
        return {
          label: MILESTONE_LABELS[m] || m,
          style: dDone
            ? { background: "#dcfce7", color: "#15803d" }
            : { background: "#f4f4f5", color: "#71717a" },
          icon: dDone ? (
            <Check size={10} strokeWidth={3} />
          ) : (
            <Circle size={10} strokeWidth={2.5} />
          ),
        };
      }),
    };
  });

  const activeWeek = timelineWeeks.find((w) => w.num === week);

  const progressSegments = [1, 2, 3, 4].map((w) => {
    const isDone = w < week;
    const isCurrent = w === week;
    return {
      label: `Week ${w}`,
      track: isDone ? "#dcfce7" : isCurrent ? "#ede9fe" : "#e5e7eb",
      fill: isDone ? "#22c55e" : isCurrent ? "#8b5cf6" : "transparent",
      fillW: isDone ? "100%" : isCurrent ? "50%" : "0%",
      pulse: isCurrent ? { animation: "wsPulse 2s infinite" } : {},
      showDot: isCurrent,
      labelColor: isDone ? "#15803d" : isCurrent ? "#6d28d9" : "#a1a1aa",
    };
  });

  const deliverableRows = weekKeys.map((k) => {
    const done = completedKeys.has(k);
    return {
      key: k,
      name: MILESTONE_LABELS[k] || k,
      tag: done ? "Completed" : "Required",
      tagStyle: done
        ? { background: "#dcfce7", color: "#15803d" }
        : { background: "#fef3c7", color: "#b45309" },
      boxStyle: done
        ? { background: "#22c55e", color: "#fff" }
        : {
            border: "1px solid #d4d4d8",
            background: "#fafafa",
            color: "transparent",
          },
      boxIcon: done ? <Check size={14} strokeWidth={3} /> : null,
      action: done ? "Review" : "Complete",
      isCompleting: completing === k,
    };
  });

  const activeWeekTools = HUB_WEEKS.filter((hw) => hw.week <= week).map(
    (hw) => {
      return {
        heading:
          hw.week === week
            ? "Unlocked this week"
            : `Unlocked in Week ${hw.week}`,
        tools: hw.tools.map((t) => {
          return {
            ...t,
            badge:
              hw.week === week
                ? `Active · Cohort 3`
                : `Unlocked · Wk ${hw.week}`,
            badgeStyle:
              hw.week === week
                ? { background: "#f3effe", color: "#7c3aed" }
                : { background: "#f4f4f5", color: "#71717a" },
            bg: "#fff",
            border: "#ececf1",
            titleColor: "#27272a",
            active: true,
            locked: false,
          };
        }),
      };
    },
  );

  const [week1Open, setWeek1Open] = useState(false);

  const deckMilestoneDone = completedKeys.has("pitch_deck_v1");
  const showDemoDayCta = week === 4 || !deckMilestoneDone;

  return (
    <div className="min-h-screen bg-[#F8F8FA] dark:bg-gray-950 font-sans text-[#18181b] dark:text-gray-200">
      {/* PAGE HEADER (sticky) */}
      <div className="sticky top-0 z-20 bg-[#F8F8FA]/92 dark:bg-gray-950/92 backdrop-blur-md border-b border-[#ececf1] dark:border-gray-800">
        <div className="max-w-[1080px] mx-auto px-6 pt-[18px]">
          <div className="flex flex-wrap gap-[18px] items-center justify-between">
            <div className="flex items-center gap-[14px] flex-wrap">
              <div className="flex items-center gap-[10px]">
                <div className="w-[34px] h-[34px] rounded-[10px] bg-[#ede9fe] dark:bg-violet-900/40 flex items-center justify-center text-[#7c3aed] dark:text-violet-400">
                  <FlaskConical size={18} strokeWidth={2.5} />
                </div>
                <h1 className="m-0 text-[20px] font-extrabold tracking-[-.02em] dark:text-white">
                  Spin-Out Lab
                </h1>
              </div>
              <span className="tabular-nums text-[12px] font-semibold text-[#52525b] dark:text-gray-400 bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[8px] px-[10px] py-[5px]">
                Cohort 3 · {startedAtStr}
              </span>
              <span className="tabular-nums inline-flex items-center gap-[7px] text-[12px] font-bold text-[#6d28d9] dark:text-violet-300 bg-[#f5f3ff] dark:bg-violet-950/50 border border-[#ede9fe] dark:border-violet-900/50 rounded-[8px] px-[10px] py-[5px]">
                <span
                  className="w-[6px] h-[6px] rounded-full bg-[#7c3aed] dark:bg-violet-400"
                  style={{ animation: "wsPulse 2s infinite" }}
                ></span>
                Week {week} of 4 · Day {dayNumber}
              </span>
            </div>
            <div className="flex items-center gap-[18px]">
              <div className="flex items-center gap-[11px]">
                <div
                  className="w-[46px] h-[46px] rounded-full flex items-center justify-center flex-none"
                  style={{
                    background: `conic-gradient(#7c3aed 0% ${progressPct}%, #e5e7eb ${progressPct}% 100%)`,
                  }}
                >
                  <div className="tabular-nums w-[38px] h-[38px] rounded-full bg-[#F8F8FA] dark:bg-gray-950 flex items-center justify-center text-[10.5px] font-extrabold text-[#6d28d9] dark:text-violet-400 tracking-[-.02em]">
                    {progressPct}%
                  </div>
                </div>
                <div className="leading-[1.15]">
                  <div className="text-[13px] font-bold text-[#27272a] dark:text-gray-200">
                    {progressRingText}
                  </div>
                  <div className="tabular-nums text-[12px] text-[#71717a] dark:text-gray-500">
                    {state.days_remaining} days remaining
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Segmented progress bar */}
          <div className="flex gap-[6px] py-[16px] pb-[14px]">
            {progressSegments.map((seg, i) => (
              <div key={i} className="flex-1 flex flex-col gap-[5px]">
                <div
                  className="h-[7px] rounded-full relative overflow-hidden"
                  style={{ background: seg.track }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      width: seg.fillW,
                      background: seg.fill,
                      ...seg.pulse,
                    }}
                  ></div>
                </div>
                <div
                  className="flex items-center gap-[5px] text-[11px] font-semibold"
                  style={{ color: seg.labelColor }}
                >
                  {seg.showDot && (
                    <span
                      className="w-[5px] h-[5px] rounded-full bg-[#7c3aed]"
                      style={{ animation: "wsPulse 2s infinite" }}
                    ></span>
                  )}
                  {seg.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-[1080px] mx-auto px-6 pt-[28px] pb-[120px]">
        {/* SECTION 1 — WEEK TIMELINE */}
        <section className="mb-[36px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[12px]">
            Program timeline
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[14px]">
            {timelineWeeks.map((w, i) => (
              <div
                key={i}
                className="rounded-[16px] bg-white dark:bg-gray-900 border p-[16px] flex flex-col transition-shadow duration-150"
                style={{ borderColor: w.borderColor, ...w.cardExtra }}
              >
                <div className="flex items-start justify-between gap-[8px] flex-wrap mb-[10px]">
                  <div>
                    <div
                      className="text-[11px] font-bold uppercase tracking-[.04em]"
                      style={{ color: w.accent }}
                    >
                      Week {w.num}
                    </div>
                    <div className="text-[15px] font-bold text-[#27272a] dark:text-gray-100 tracking-[-.01em]">
                      {w.name}
                    </div>
                  </div>
                  <span
                    className="inline-flex items-center gap-[5px] flex-none text-[10.5px] font-bold rounded-full px-[9px] py-[3px] dark:bg-opacity-20"
                    style={w.badgeStyle}
                  >
                    <span className="w-[12px] h-[12px] flex items-center justify-center">
                      {w.badgeIcon}
                    </span>
                    {w.badgeText}
                  </span>
                </div>
                <p className="m-0 mb-[12px] text-[12.5px] leading-[1.4] text-[#71717a] dark:text-gray-400 line-clamp-2 overflow-hidden">
                  {w.summary}
                </p>
                <div className="flex flex-wrap gap-[5px] mb-[11px]">
                  {w.deliverables.map((d, di) => (
                    <span
                      key={di}
                      className="inline-flex items-center gap-[4px] text-[10.5px] font-semibold rounded-[6px] px-[7px] py-[3px] dark:bg-opacity-20"
                      style={d.style}
                    >
                      <span className="w-[10px] h-[10px] flex items-center justify-center">
                        {d.icon}
                      </span>
                      {d.label}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex flex-wrap gap-[5px] pt-[11px] border-t border-[#f4f4f5] dark:border-gray-800">
                  {w.features.map((f, fi) => (
                    <span
                      key={fi}
                      className="inline-flex items-center gap-[4px] text-[10px] font-semibold rounded-[6px] px-[7px] py-[3px] bg-[#f4f4f5] text-[#52525b] dark:bg-gray-800 dark:text-gray-400"
                    >
                      {f.locked && <Lock size={9} strokeWidth={2.5} />}
                      {f.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 2A — SELECTED WEEK HEADER */}
        <section className="mb-[20px]">
          <div className="rounded-[16px] bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 p-[24px] relative overflow-hidden">
            <div
              className="absolute top-0 left-0 bottom-0 w-[4px]"
              style={{ background: activeWeek.accent }}
            ></div>
            <div className="flex flex-wrap gap-[18px] justify-between items-start">
              <div className="min-w-[280px]">
                <div className="flex items-center gap-[9px] mb-[6px]">
                  <span
                    className="text-[10.5px] font-bold rounded-full px-[9px] py-[3px] inline-flex items-center gap-[5px]"
                    style={{ background: "#f5f3ff", color: "#6d28d9" }}
                  >
                    <span
                      className="w-[5px] h-[5px] rounded-full bg-[#7c3aed]"
                      style={{ animation: "wsPulse 2s infinite" }}
                    ></span>
                    Active · Day {dayNumber}
                  </span>
                </div>
                <h2 className="m-0 text-[22px] font-extrabold tracking-[-.02em] dark:text-white">
                  {activeWeek.name}
                </h2>
                <p className="my-[7px] mb-[16px] text-[14px] text-[#71717a] dark:text-gray-400 max-w-[520px]">
                  {activeWeek.summary}
                </p>
                <div className="flex flex-wrap gap-[8px]">
                  <span className="tabular-nums inline-flex items-center gap-[6px] text-[12px] font-semibold text-[#3f3f46] dark:text-gray-300 bg-[#fafafa] dark:bg-gray-800 border border-[#eeeef2] dark:border-gray-700 rounded-[8px] px-[11px] py-[6px]">
                    <span className="w-[14px] h-[14px] text-[#7c3aed] flex">
                      <BookOpen size={14} />
                    </span>
                    {
                      deliverableRows.filter((r) => r.tag === "Completed")
                        .length
                    }{" "}
                    of {deliverableRows.length} deliverables
                  </span>
                </div>
              </div>
              <div className="flex gap-[10px] flex-wrap">
                <Link
                  to={
                    activeWeek.features[0]
                      ? HUB_WEEKS[week - 1].tools[0].to
                      : "#"
                  }
                  className="h-[40px] px-[18px] rounded-[10px] border-none bg-[#7c3aed] text-white font-inherit text-[13.5px] font-semibold cursor-pointer inline-flex items-center gap-[7px] shadow-sm hover:bg-[#6d28d9]"
                >
                  Open workspace <span className="text-[15px]">→</span>
                </Link>
                {showDemoDayCta && (
                  <Link
                    to="/build/deck?method_id=axal_spinout_demoday"
                    className="h-[40px] px-[16px] rounded-[10px] border border-[#e4e4e7] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#3f3f46] dark:text-gray-200 font-inherit text-[13.5px] font-semibold cursor-pointer inline-flex items-center gap-[7px] hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    {deckMilestoneDone
                      ? "Refresh Demo Day deck"
                      : "Draft Demo Day deck"}{" "}
                    <span className="text-[15px]">→</span>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2 — TWO COLUMN */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-[20px] mb-[36px] items-start">
          {/* 2B DELIVERABLES */}
          <div className="md:col-span-1">
            <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[12px]">
              Week {week} Deliverables
            </div>
            <div className="flex flex-col gap-[10px]">
              {deliverableRows.map((d, i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[14px] p-[15px] px-[16px] shadow-sm flex gap-[13px] items-start"
                >
                  <span
                    className="w-[20px] h-[20px] flex-none mt-[1px] rounded-[6px] flex items-center justify-center dark:bg-opacity-20"
                    style={d.boxStyle}
                  >
                    {d.boxIcon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-[9px] flex-wrap">
                      <span className="text-[14.5px] font-semibold text-[#27272a] dark:text-gray-200">
                        {d.name}
                      </span>
                      <span
                        className="text-[10.5px] font-semibold rounded-full px-[8px] py-[2px] dark:bg-opacity-20"
                        style={d.tagStyle}
                      >
                        {d.tag}
                      </span>
                    </div>
                  </div>
                  {d.tag !== "Completed" && (
                    <button
                      onClick={() => onComplete(d.key)}
                      disabled={d.isCompleting}
                      className="flex-none h-[32px] px-[12px] rounded-[9px] border border-[#e4e4e7] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#6d28d9] dark:text-violet-400 font-inherit text-[12px] font-semibold cursor-pointer inline-flex items-center gap-[5px] disabled:opacity-60 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      {d.isCompleting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : null}
                      {d.action} <span className="text-[13px]">→</span>
                    </button>
                  )}
                </div>
              ))}
              {completeError && (
                <div className="mt-2 text-[12px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-[14px] p-[12px]">
                  {completeError}
                </div>
              )}
            </div>
          </div>

          {/* 2C TOOLS */}
          <div className="md:col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[12px]">
              Your unlocked tools
            </div>
            {activeWeekTools.map((g, gi) => (
              <div key={gi} className="mb-[16px]">
                {g.heading && (
                  <div className="text-[11px] font-semibold text-[#a1a1aa] dark:text-gray-500 mb-[8px]">
                    {g.heading}
                  </div>
                )}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-[10px]">
                  {g.tools.map((t, ti) => (
                    <Link
                      key={ti}
                      to={t.to}
                      className="rounded-[13px] p-[13px] bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 flex flex-col hover:border-[#c4b5fd] dark:hover:border-violet-800 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-[9px]">
                        <div className="w-[32px] h-[32px] rounded-[9px] flex items-center justify-center p-[6px] bg-[#f5f3ff] dark:bg-violet-900/40 text-[#7c3aed] dark:text-violet-400">
                          {/* fallback icon */}
                          <BookOpen size={16} strokeWidth={2.5} />
                        </div>
                      </div>
                      <div className="text-[12.5px] font-bold text-[#27272a] dark:text-gray-200 mb-[2px]">
                        {t.label}
                      </div>
                      <div className="text-[11px] leading-[1.35] text-[#a1a1aa] dark:text-gray-400 mb-[10px] flex-1">
                        {t.blurb}
                      </div>
                      <div className="flex items-center justify-between gap-[6px]">
                        <span
                          className="text-[9.5px] font-bold rounded-[6px] px-[6px] py-[2px] dark:bg-opacity-20"
                          style={t.badgeStyle}
                        >
                          {t.badge}
                        </span>
                        <div className="h-[26px] px-[10px] rounded-[7px] border border-[#e4e4e7] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#6d28d9] dark:text-violet-400 font-inherit text-[11px] font-semibold flex items-center">
                          Open →
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}

            <div className="mt-8">
              <DeckReadinessCard />
            </div>
          </div>
        </section>

        {/* SECTION 3 — SCORECARD (Mocked per prototype) */}
        <section className="mb-[36px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[12px]">
            30-day scorecard
          </div>
          <div className="bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[16px] overflow-hidden shadow-sm">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse min-w-[720px]">
                <thead>
                  <tr className="bg-[#fafafa] dark:bg-gray-800/50">
                    <th className="text-left text-[11px] font-semibold uppercase tracking-[.06em] text-[#a1a1aa] dark:text-gray-500 p-[12px] px-[16px] border-b border-[#ececf1] dark:border-gray-700"></th>
                    {[1, 2, 3, 4].map((n) => (
                      <th
                        key={n}
                        className="text-left text-[12px] font-bold text-[#27272a] dark:text-gray-300 p-[12px] px-[16px] border-b border-[#ececf1] dark:border-gray-700 border-l border-[#f4f4f5] dark:border-gray-800"
                      >
                        Week {n}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "Status",
                      cells: [
                        {
                          badge: true,
                          text: "Completed",
                          color: "#15803d",
                          bg: "#dcfce7",
                          Icon: Check,
                        },
                        {
                          badge: true,
                          text: "Active",
                          color: "#6d28d9",
                          bg: "#f5f3ff",
                          Icon: Circle,
                        },
                        {
                          badge: true,
                          text: "Unlocked",
                          color: "#15803d",
                          bg: "#dcfce7",
                          Icon: Check,
                        },
                        {
                          badge: true,
                          text: "Unlocked",
                          color: "#15803d",
                          bg: "#dcfce7",
                          Icon: Check,
                        },
                      ],
                    },
                    {
                      label: "Deliverables",
                      cells: [
                        {
                          bar: true,
                          text: "3 of 3",
                          w: "100%",
                          color: "#22c55e",
                        },
                        {
                          bar: true,
                          text: "1 of 5",
                          w: "20%",
                          color: "#7c3aed",
                        },
                        { text: "—", plain: true },
                        { text: "—", plain: true },
                      ],
                    },
                    {
                      label: "Tools unlocked",
                      cells: [
                        { plain: true, text: "4 of 4" },
                        { plain: true, text: "4 of 4" },
                        { plain: true, text: "5 of 5" },
                        { plain: true, text: "7 of 7" },
                      ],
                    },
                    {
                      label: "Key output",
                      cells: [
                        {
                          plain: true,
                          text: "1 startup · 5 interviews · TAM sized",
                          weight: "normal",
                        },
                        { plain: true, text: "OKRs set", weight: "normal" },
                        { text: "—", plain: true },
                        { text: "—", plain: true },
                      ],
                    },
                  ].map((r, ri) => (
                    <tr key={ri}>
                      <td className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 p-[13px] px-[16px] border-b border-[#f4f4f5] dark:border-gray-800 whitespace-nowrap">
                        {r.label}
                      </td>
                      {r.cells.map((cell, ci) => (
                        <td
                          key={ci}
                          className="p-[13px] px-[16px] border-b border-[#f4f4f5] dark:border-gray-800 border-l border-[#f4f4f5] dark:border-gray-800 align-top"
                        >
                          {cell.badge && (
                            <span
                              className="inline-flex items-center gap-[5px] text-[11px] font-bold rounded-full px-[9px] py-[3px] dark:bg-opacity-20"
                              style={{ background: cell.bg, color: cell.color }}
                            >
                              <span className="w-[11px] h-[11px] flex items-center justify-center">
                                <cell.Icon
                                  size={11}
                                  strokeWidth={cell.Icon === Circle ? 0 : 3}
                                  fill={
                                    cell.Icon === Circle
                                      ? "currentColor"
                                      : "none"
                                  }
                                />
                              </span>
                              {cell.text}
                            </span>
                          )}
                          {cell.bar && (
                            <>
                              <div className="tabular-nums text-[12.5px] font-semibold text-[#3f3f46] dark:text-gray-300 mb-[5px]">
                                {cell.text}
                              </div>
                              <div className="h-[6px] rounded-full bg-[#f1f1f5] dark:bg-gray-800 overflow-hidden max-w-[120px]">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: cell.w,
                                    background: cell.color,
                                  }}
                                ></div>
                              </div>
                            </>
                          )}
                          {cell.plain && (
                            <span
                              className="tabular-nums text-[12.5px] text-[#52525b] dark:text-gray-400"
                              style={{ fontWeight: cell.weight || 600 }}
                            >
                              {cell.text}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px] mt-[14px]">
            {[
              {
                label: "Total tools unlocked",
                value: `${features.length} of 20`,
              },
              {
                label: "Deliverables completed",
                value: `${completedTotal} of 18`,
              },
              { label: "Days remaining", value: state.days_remaining },
            ].map((k, ki) => (
              <div
                key={ki}
                className="bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[14px] p-[16px] px-[18px] shadow-sm"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[6px]">
                  {k.label}
                </div>
                <div className="tabular-nums text-[20px] font-semibold text-[#18181b] dark:text-white tracking-[-.01em]">
                  {k.value}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 4 — WEEK 1 SUMMARY (Mocked) */}
        <section className="mb-[36px]">
          <div className="bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[16px] shadow-sm overflow-hidden">
            <div
              onClick={() => setWeek1Open(!week1Open)}
              className="flex items-center justify-between gap-[12px] p-[16px] px-[20px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-center gap-[11px]">
                <span className="w-[22px] h-[22px] rounded-full bg-[#dcfce7] dark:bg-green-900/30 text-[#16a34a] dark:text-green-400 flex items-center justify-center p-[4px]">
                  <Check size={14} strokeWidth={3} />
                </span>
                <span className="text-[14.5px] font-bold text-[#27272a] dark:text-gray-200">
                  Week 1 Summary
                </span>
                <span className="tabular-nums text-[12px] text-[#a1a1aa] dark:text-gray-500">
                  Completed recently
                </span>
              </div>
              <span
                className="w-[18px] h-[18px] text-[#a1a1aa] flex transition-transform duration-200"
                style={{ transform: week1Open ? "rotate(180deg)" : "none" }}
              >
                <ChevronDown size={18} />
              </span>
            </div>
            {week1Open && (
              <div
                className="p-[4px] px-[20px] pb-[22px] border-t border-[#f4f4f5] dark:border-gray-800"
                style={{ animation: "wsFade .2s ease" }}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-[22px] mt-[18px]">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[8px]">
                      Startup record
                    </div>
                    <div className="flex items-center gap-[10px] bg-[#fafafa] dark:bg-gray-800 border border-[#eeeef2] dark:border-gray-700 rounded-[11px] p-[12px] px-[14px]">
                      <div className="w-[34px] h-[34px] rounded-[9px] bg-[#ede9fe] dark:bg-violet-900/40 text-[#6d28d9] dark:text-violet-400 font-extrabold text-[13px] flex items-center justify-center">
                        NC
                      </div>
                      <div>
                        <div className="text-[13.5px] font-bold text-[#27272a] dark:text-gray-200">
                          NovaCraft AI
                        </div>
                        <div className="text-[11.5px] text-[#a1a1aa] dark:text-gray-500">
                          Startup record created · Day 2
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 my-[18px] mb-[8px]">
                      TAM / SAM
                    </div>
                    <div className="flex gap-[10px] mb-[10px]">
                      <div className="tabular-nums flex-1 bg-[#fafafa] dark:bg-gray-800 border border-[#eeeef2] dark:border-gray-700 rounded-[11px] p-[11px] px-[14px]">
                        <div className="text-[18px] font-bold text-[#18181b] dark:text-white">
                          $2.4B
                        </div>
                        <div className="text-[11px] text-[#a1a1aa] dark:text-gray-500">
                          TAM
                        </div>
                      </div>
                      <div className="tabular-nums flex-1 bg-[#fafafa] dark:bg-gray-800 border border-[#eeeef2] dark:border-gray-700 rounded-[11px] p-[11px] px-[14px]">
                        <div className="text-[18px] font-bold text-[#18181b] dark:text-white">
                          $340M
                        </div>
                        <div className="text-[11px] text-[#a1a1aa] dark:text-gray-500">
                          SAM
                        </div>
                      </div>
                    </div>
                    <div className="text-[11.5px] text-[#71717a] dark:text-gray-400 leading-[1.5]">
                      Sources: Gartner 2025 Workflow Automation Report · CB
                      Insights SaaS Market Sizing Q1 2026
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 my-[18px] mb-[8px]">
                      Personal advisor
                    </div>
                    <div className="flex items-start gap-[10px] bg-[#f5f3ff] dark:bg-violet-900/20 border border-[#ede9fe] dark:border-violet-900/50 rounded-[11px] p-[12px] px-[14px]">
                      <span className="w-[16px] h-[16px] flex-none text-[#7c3aed] mt-[1px] flex">
                        <Sparkles size={16} />
                      </span>
                      <div className="text-[12px] text-[#52525b] dark:text-gray-300 leading-[1.45]">
                        <strong className="text-[#27272a] dark:text-white font-semibold">
                          Active
                        </strong>{" "}
                        — Week 1 question bank complete. Now operating in Week 2
                        mode.
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[8px]">
                      Interviews logged · 5
                    </div>
                    <div className="border border-[#eeeef2] dark:border-gray-700 rounded-[11px] overflow-hidden">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-[#fafafa] dark:bg-gray-800/50">
                            <th className="text-left text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#a1a1aa] dark:text-gray-500 p-[8px] px-[12px]">
                              Name
                            </th>
                            <th className="text-left text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#a1a1aa] dark:text-gray-500 p-[8px] px-[12px]">
                              Date
                            </th>
                            <th className="text-left text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#a1a1aa] dark:text-gray-500 p-[8px] px-[12px]">
                              Key insight
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            {
                              name: "Sarah T.",
                              date: "Jul 2",
                              insight:
                                "Current tools don’t handle async workflows",
                            },
                            {
                              name: "Marcus R.",
                              date: "Jul 3",
                              insight: "Price sensitivity at $200/mo threshold",
                            },
                            {
                              name: "Diana K.",
                              date: "Jul 4",
                              insight:
                                "Integration with Slack is non-negotiable",
                            },
                            {
                              name: "James W.",
                              date: "Jul 5",
                              insight:
                                "Discovery takes 3x longer than expected",
                            },
                            {
                              name: "Priya M.",
                              date: "Jul 6",
                              insight:
                                "No single source of truth for customer data",
                            },
                          ].map((iv, ivi) => (
                            <tr
                              key={ivi}
                              className="border-t border-[#f4f4f5] dark:border-gray-800"
                            >
                              <td className="text-[12px] font-semibold text-[#27272a] dark:text-gray-200 p-[9px] px-[12px] whitespace-nowrap">
                                {iv.name}
                              </td>
                              <td className="tabular-nums text-[12px] text-[#71717a] dark:text-gray-400 p-[9px] px-[12px] whitespace-nowrap">
                                {iv.date}
                              </td>
                              <td className="text-[12px] text-[#52525b] dark:text-gray-400 p-[9px] px-[12px] leading-[1.35]">
                                {iv.insight}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <ExplainerCards />
      </main>
    </div>
  );
}

export default function SpinoutLabPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(null);
  const [completeError, setCompleteError] = useState("");
  const [exiting, setExiting] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await spinoutLab.state();
      setState(next);
    } catch (e) {
      reportError("spinout-lab:state", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user, load]);

  useEffect(() => {
    const onAdvanced = () => {
      load();
    };
    window.addEventListener("spinout-lab:advanced", onAdvanced);
    return () => window.removeEventListener("spinout-lab:advanced", onAdvanced);
  }, [load]);

  if (!user) return <SpinoutLabMarketingPage />;

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading your sprint…
      </div>
    );
  }

  if (!state) {
    return <LabHub />;
  }

  if (!state.active) {
    const wasActive =
      user?.spinout_lab_active === 1 ||
      (state.is_incorporated &&
        (state.milestones || []).some(
          (m) => m.key === "incorporation_completed",
        ));
    if (!wasActive) return <LabHub />;

    const onContinue = async () => {
      setExiting(true);
      try {
        await spinoutLab.exit();
      } catch (e) {
        reportError("spinout-lab:exit", e);
      }
      try {
        await refresh({ force: true });
      } catch {
        /* no-op */
      }
      navigate("/");
    };
    return (
      <div className="min-h-[60vh] flex items-center px-4 py-10">
        <ExitSuccess onContinue={onContinue} busy={exiting} />
      </div>
    );
  }

  const onComplete = async (key) => {
    setCompleting(key);
    setCompleteError("");
    try {
      const next = await spinoutLab.complete(key);
      setState(next);
      try {
        window.dispatchEvent(
          new CustomEvent("spinout-lab:advanced", {
            detail: { state: next, milestoneKey: key },
          }),
        );
      } catch {
        /* no-op */
      }
      if (!next.active) {
        try {
          await refresh({ force: true });
        } catch {
          /* no-op */
        }
      }
    } catch (e) {
      setCompleteError(e?.message || "Could not mark milestone complete");
      reportError("spinout-lab:complete", e);
    } finally {
      setCompleting(null);
    }
  };

  return (
    <Dashboard
      state={state}
      onComplete={onComplete}
      completing={completing}
      completeError={completeError}
    />
  );
}
