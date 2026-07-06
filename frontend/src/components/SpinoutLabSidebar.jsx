import React, { useEffect, useId, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Info, Rocket, Zap, MessageSquare, Globe, Layers, Sparkles, Users,
  UserCircle, Calendar, Target, Scale, PieChart as PieIcon, DollarSign,
  Check, Loader2,
} from 'lucide-react';
import { useSpinoutLabState } from '../hooks/useSpinoutLabState';

// Per-feature catalogue. Keys MUST match the strings in
// `unlocked_features` returned by /api/spinout-lab/state — same set the
// authenticated dashboard (`SpinoutLabPage.jsx`) consumes.
const FEATURE_CATALOGUE = {
  'spinout-lab': {
    to: '/spinout-lab',
    icon: Rocket,
    label: 'Spin-Out Lab',
    blurb: "Your home base for the 4-week sprint — track milestones, days remaining, and what unlocks next.",
  },
  projects: {
    to: '/projects',
    icon: Zap,
    label: 'Startups',
    blurb: 'Spin up your venture record. The whole platform hangs off this one project for the rest of the sprint.',
  },
  'customer-discovery': {
    to: '/build/discovery',
    icon: MessageSquare,
    label: 'Customer Discovery',
    blurb: 'Log interviews, hypotheses, and pains. Three logged interviews unlocks the next week.',
  },
  'market-intelligence': {
    to: '/market-intel',
    icon: Globe,
    label: 'Market Intelligence',
    blurb: 'Live macro indicators, private rounds, and studio benchmarks to pressure-test your market.',
  },
  roadmap: {
    to: '/build/roadmap',
    icon: Layers,
    label: 'Roadmap',
    blurb: 'Set quarterly OKRs and key results so the next two weeks have something concrete to deliver against.',
  },
  'brand-builder': {
    to: '/build/brand',
    icon: Sparkles,
    label: 'Brand Builder',
    blurb: 'Name, tagline, palette, and a one-page landing. Enough to start opening doors.',
  },
  'pitch-deck': {
    to: '/build/deck',
    icon: Sparkles,
    label: 'Pitch Deck',
    blurb: 'Generate a working seed deck from your project + market intel; iterate before mentors see it.',
  },
  'cofounder-match': {
    to: '/cofounder',
    icon: Users,
    label: 'Co-founder Match',
    blurb: 'Search the cofounder pool and send your first intro requests — single-founder companies fundraise harder.',
  },
  mentors: {
    to: '/mentors',
    icon: UserCircle,
    label: 'Mentors',
    blurb: 'Browse the mentor directory and request your first session.',
  },
  'office-hours': {
    to: '/office-hours',
    icon: Calendar,
    label: 'Office Hours',
    blurb: 'Book recurring office hours with mentors and partners across the network.',
  },
  scoring: {
    to: '/scoring',
    icon: Target,
    label: 'AI Scoring',
    blurb: 'Run the 100-point scoring engine on your project. Tier 1 (≥85) unlocks the cohort offer.',
  },
  incorporate: {
    to: '/incorporate',
    icon: Scale,
    label: 'Incorporate',
    blurb: 'Stripe Atlas / Cooley GO incorporation flow. Picks state, files docs, registers EIN.',
  },
  captable: {
    to: '/build/captable',
    icon: PieIcon,
    label: 'Cap Table',
    blurb: 'Initialize founder vesting and seed the cap-table simulator with your real numbers.',
  },
  'section-83b': {
    to: '/incorporate/83b',
    icon: Calendar,
    label: 'Section 83(b)',
    blurb: '30-day filing deadline tracker so vesting starts clean. Upload your IRS receipt when it arrives.',
  },
  'cofounder-agreement': {
    to: '/incorporate/cofounder-agreement',
    icon: Users,
    label: 'Co-founder Agreement',
    blurb: 'Draft the IP / vesting / decision-rights agreement before equity gets messy.',
  },
  capital: {
    to: '/capital',
    icon: DollarSign,
    label: 'Capital',
    blurb: 'LP introductions, SAFE generation, and partner co-invest commitments.',
  },
  compliance: {
    to: '/compliance',
    icon: Calendar,
    label: 'Compliance Calendar',
    blurb: 'Standard post-incorporation events seeded for your jurisdiction (annual report, franchise tax, etc.).',
  },
  // Task #2 — KYC is now investor-only; founders never need it, so the
  // Spinout Lab no longer surfaces an Identity Verification week-4 item.
};

// Per-week ordering. The sidebar shows every unlocked feature returned by
// the server, but renders them in a stable, week-grouped order so Week-1
// items always sit at the top.
const WEEK_ORDER = {
  1: ['spinout-lab', 'projects', 'customer-discovery', 'market-intelligence'],
  2: ['roadmap', 'brand-builder', 'pitch-deck'],
  3: ['cofounder-match', 'mentors', 'office-hours', 'scoring'],
  4: ['incorporate', 'captable', 'section-83b', 'cofounder-agreement', 'capital', 'compliance'],
};

function orderFeatures(unlocked) {
  const set = new Set(unlocked || []);
  const ordered = [];
  for (const week of [1, 2, 3, 4]) {
    for (const key of WEEK_ORDER[week]) {
      if (set.has(key)) {
        ordered.push(key);
        set.delete(key);
      }
    }
  }
  // Anything the server returns that isn't in our catalogue ordering
  // still surfaces at the end so we never silently hide an unlock.
  for (const key of set) ordered.push(key);
  return ordered.filter((k) => FEATURE_CATALOGUE[k]);
}

function ProgressBar({ week }) {
  const weeks = [1, 2, 3, 4];
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {weeks.map((w, i) => {
          const done = w < week;
          const active = w === week;
          return (
            <React.Fragment key={w}>
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold border ${
                  done
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : active
                      ? 'bg-violet-600 text-white border-violet-600 ring-2 ring-violet-100'
                      : 'bg-white text-gray-500 border-gray-300'
                }`}
              >
                {done ? <Check size={11} /> : w}
              </div>
              {i < weeks.length - 1 && (
                <div className={`flex-1 h-0.5 rounded ${w < week ? 'bg-emerald-500' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function FeatureTooltip({ label, blurb }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-gray-400 hover:text-violet-600 focus:text-violet-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-full"
      >
        <Info size={12} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={tooltipId}
          className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 w-56 bg-gray-900 text-white text-[11px] leading-snug px-3 py-2 rounded-md shadow-lg pointer-events-none"
        >
          {blurb}
        </span>
      )}
    </span>
  );
}

export default function SpinoutLabSidebar({ onNavigate }) {
  const { state, loading } = useSpinoutLabState({ enabled: true });
  const week = Math.max(1, Math.min(4, state?.week || 1));
  const daysRemaining = state?.days_remaining ?? null;
  const features = orderFeatures(state?.unlocked_features);

  return (
    <nav className="flex-1 py-3 overflow-y-auto" aria-label="Spin-Out Lab navigation">
      <div className="px-5 pb-3 mb-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
          <Rocket size={11} /> Spin-Out Lab
        </div>
        <div className="mt-2 text-xs font-semibold text-gray-900 dark:text-gray-100">Week {week} of 4</div>
        {daysRemaining != null && (
          <div className="text-[11px] text-gray-500 mb-2">
            {daysRemaining} day{daysRemaining === 1 ? '' : 's'} left
          </div>
        )}
        <div className="mt-2"><ProgressBar week={week} /></div>
      </div>

      {loading && !state && (
        <div className="px-5 py-4 text-xs text-gray-500 flex items-center gap-2">
          <Loader2 className="animate-spin" size={12} /> Loading…
        </div>
      )}

      {features.map((key) => {
        const f = FEATURE_CATALOGUE[key];
        const Icon = f.icon;
        return (
          <div key={key} className="group relative flex items-stretch">
            <NavLink
              to={f.to}
              end
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex-1 min-w-0 flex items-center gap-3 pl-5 pr-2 py-2 text-sm transition-colors ${
                  isActive
                    ? 'text-violet-600 bg-violet-50 border-r-2 border-violet-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              <Icon size={16} />
              <span className="truncate">{f.label}</span>
            </NavLink>
            <div className="flex items-center pr-3 pl-1">
              <FeatureTooltip label={f.label} blurb={f.blurb} />
            </div>
          </div>
        );
      })}
    </nav>
  );
}
