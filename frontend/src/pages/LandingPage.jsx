import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, Users, Banknote, GitBranch, Scale, Globe,
  Handshake, Rocket, ArrowRight, ChevronRight,
  Hammer, Sparkles, GraduationCap, HeartHandshake,
  ShieldCheck, BadgeCheck, LockKeyhole, Cloud, Cpu, Archive,
  UserPlus,
} from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import { NETWORK_LAYERS } from '../brand/gvpn';
import useForcedLightTheme from '../hooks/useForcedLightTheme';

const THESIS_PILLS = ['AI', 'Blockchain', 'Quantum', 'Digital Infrastructure', 'Frontier Software'];

const LAYER_ICONS = {
  trust: ShieldCheck,
  build: Hammer,
  validate_grow: Sparkles,
  capital: Banknote,
  legal: Scale,
  network: Globe,
};

const LANES = [
  {
    id: 'partner',
    title: 'For Partners',
    bullets: [
      'Source thesis-aligned companies',
      'Monetise services with portfolio companies',
      'Co-invest alongside the network',
      'KYB, conflicts, and contractual scaffolding handled',
    ],
    cta: 'Apply as Partner',
    href: '/register?lane=partner',
    btn: 'bg-violet-600 hover:bg-violet-700',
    tint: 'bg-violet-50/40 border-violet-200',
    color: '#c790e4',
    icon: Handshake,
  },
  {
    id: 'lp',
    title: 'For Capital',
    bullets: [
      'Disciplined, evidence-backed deal flow',
      'Founder numbers verified via Stripe + Plaid',
      'Sanctions-screened parties on every deal',
      'One ledger for commitments, calls, distributions',
    ],
    cta: 'Open LP Account',
    href: '/register?lane=lp',
    btn: 'bg-purple-700 hover:bg-purple-800',
    tint: 'bg-purple-50/40 border-purple-200',
    color: '#b771e4',
    icon: Banknote,
  },
  {
    id: 'founder',
    title: 'For Founders',
    bullets: [
      '30-day Spin-Out Lab to incorporate from an idea',
      'Pitch deck → cap table → fundraise for existing companies',
      'Personal Advisor + mentor track + investor exposure',
      'Lifetime alumni community',
    ],
    cta: 'Submit Your Pitch',
    href: '/register?lane=founder',
    btn: 'bg-indigo-600 hover:bg-indigo-700',
    tint: 'bg-indigo-50/40 border-indigo-200',
    color: '#a66fd2',
    icon: Rocket,
  },
  {
    id: 'mentor',
    title: 'For Mentors',
    bullets: [
      'Operators sharing time on their schedule',
      'Office Hours and one-off mentor sessions',
      'Advisor grants via the FAST template',
      'Pick the sectors and stages you care about',
    ],
    cta: 'Become a Mentor',
    href: '/register?lane=mentor',
    btn: 'bg-teal-600 hover:bg-teal-700',
    tint: 'bg-teal-50/40 border-teal-200',
    color: '#926dc0',
    icon: GraduationCap,
  },
  {
    id: 'coach',
    title: 'For Coaches',
    bullets: [
      'Executive, performance, and wellbeing coaching',
      'Founders match by category + rating + availability',
      'Booking, scheduling, and payments handled',
      'Build a reputation inside a vetted founder pool',
    ],
    cta: 'Join as Coach',
    href: '/register?lane=coach',
    btn: 'bg-rose-600 hover:bg-rose-700',
    tint: 'bg-rose-50/40 border-rose-200',
    color: '#7596b5',
    icon: HeartHandshake,
  },
];

const HOW_IT_WORKS = [
  {
    week: 'Step 1',
    title: 'Join the lane that fits',
    icon: UserPlus,
    desc: 'Founder, investor, partner, mentor, or coach — pick the door that matches what you do.',
  },
  {
    week: 'Step 2',
    title: 'The platform verifies you',
    icon: BadgeCheck,
    desc: 'KYC, KYB, accreditation, and NDAs only where the activity actually requires it.',
  },
  {
    week: 'Step 3',
    title: 'Unlock progressively',
    icon: LockKeyhole,
    desc: 'Introductions and deal data open up gated by signed pairwise NDAs and evidence-backed scoring.',
  },
];

const PLATFORM_FEATURES = [
  { icon: Users, title: 'Partner Matchmaking', desc: 'AI-powered matching with referral tracking and deal syndication.', to: '/matches' },
  { icon: Banknote, title: 'Capital & LP Portal', desc: 'Capital calls, LP ledger, TVPI/DPI per vintage, distributions.', to: '/funds' },
  { icon: GitBranch, title: 'Deal Flow', desc: 'Pipeline, scoring engine, AI memos, real-time pipeline updates.', to: '/deals' },
  { icon: Globe, title: 'Market Intelligence', desc: 'Real-time sector signals, competitive data, semantic search.', to: '/market-intel' },
  { icon: Scale, title: 'Legal Engine', desc: 'Auto incorporation, SAFE agreements, equity splits, IP licensing.', to: '/legal' },
  { icon: Sparkles, title: 'Personal AI Advisor', desc: 'Always-on advisor with full founder context — strategy, GTM, fundraising, and financial planning, with weekly check-ins and evidence-backed answers.', to: '/advisory' },
  { icon: Rocket, title: 'Spin-Out Lab', desc: 'Niche 30-day venture sprint — idea to funded in four weeks.', to: '/spinout-lab' },
  { icon: UserPlus, title: 'Co-founder Match', desc: 'Match by skill, sector, and working style — equity split + cofounder agreement included.', to: '/cofounder' },
  { icon: Handshake, title: 'Services Marketplace', desc: 'Services-for-equity / -fee partners, refer & earn, co-marketing.', to: '/marketplace' },
  { icon: ShieldCheck, title: 'Trust & Verification', desc: 'KYC, KYB, accreditation, NDAs, and sanctions screening on every party.', to: '/trust' },
  { icon: GraduationCap, title: 'Mentor Network', desc: 'Office Hours, mentor sessions, and advisor grants via the FAST template.', to: '/mentors' },
  { icon: HeartHandshake, title: 'Coaching Marketplace', desc: 'Executive, performance, and wellbeing coaches matched by category, rating, availability.', to: '/wellbeing' },
];

const FALLBACK_STATS = { partners: 200, funds: 4, deals_scored: 1200, spinouts: 38 };

function useCountUp(target, durationMs = 600) {
  const [value, setValue] = useState(0);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    if (typeof target !== 'number' || Number.isNaN(target)) return;
    startedRef.current = true;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (0.5 - 0.5 * Math.cos(Math.PI * t))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function StatCard({ value, label, suffix }) {
  const n = useCountUp(value);
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center dark:border-gray-800">
      <div className="text-2xl md:text-3xl font-bold text-violet-600 tabular-nums">
        {n.toLocaleString()}<span className="text-lg">{suffix || ''}</span>
      </div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

function StatsBar() {
  const [stats, setStats] = useState(FALLBACK_STATS);
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/dashboard/stats', { signal: ctrl.signal });
        if (!res.ok) throw new Error('non-200');
        const data = await res.json();
        setStats({
          partners: Number(data?.partners ?? FALLBACK_STATS.partners),
          funds: Number(data?.funds ?? FALLBACK_STATS.funds),
          deals_scored: Number(data?.deals_scored ?? FALLBACK_STATS.deals_scored),
          spinouts: Number(data?.spinouts ?? FALLBACK_STATS.spinouts),
        });
      } catch { /* silent */ }
    })();
    return () => ctrl.abort();
  }, []);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20 max-w-3xl mx-auto">
      <StatCard value={stats.partners} label="Network Partners" suffix="+" />
      <StatCard value={stats.funds} label="Active Funds" />
      <StatCard value={stats.deals_scored} label="Deals Scored" suffix="+" />
      <StatCard value={stats.spinouts} label="Spin-Outs Completed" />
    </div>
  );
}

function LatestArticles() {
  const [items, setItems] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    import('../lib/api').then(({ articles }) =>
      articles.list({ limit: 3 })
        .then((r) => { if (alive) setItems(r.items || []); })
        .catch(() => { if (alive) setItems([]); }),
    );
    return () => { alive = false; };
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <section className="py-20 px-6 bg-white dark:bg-gray-900">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100">Latest from the network</h2>
            <p className="mt-2 text-sm text-gray-600">Long-form writing from Axal VC founders, investors, partners, and the studio.</p>
          </div>
          <Link to="/articles" className="hidden sm:inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-800 font-medium">
            All articles <ChevronRight size={14} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((a) => (
            <Link
              key={a.id}
              to={`/articles/${a.slug}`}
              className="group block rounded-xl border border-gray-200 bg-white overflow-hidden hover:border-violet-400 transition dark:border-gray-800 dark:bg-gray-900"
            >
              {a.cover_url ? (
                <img src={a.cover_url} alt="" className="w-full aspect-[16/9] object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <div className="w-full aspect-[16/9] bg-gradient-to-br from-violet-100 to-violet-50" />
              )}
              <div className="p-4">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {a.sector && <span>{a.sector.replace(/_/g, ' ')}</span>}
                  {a.read_minutes ? <><span>·</span><span>{a.read_minutes} min</span></> : null}
                </div>
                <h3 className="font-semibold text-base text-gray-900 group-hover:text-violet-700 line-clamp-2 dark:text-gray-100">{a.title}</h3>
                {a.subtitle && <p className="mt-1 text-sm text-gray-600 line-clamp-2">{a.subtitle}</p>}
                <p className="mt-3 text-xs text-gray-500">by {a.author || '—'}</p>
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-6 text-center sm:hidden">
          <Link to="/articles" className="inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-800 font-medium">
            All articles <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  useForcedLightTheme();
  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <PublicNav />

      {/* HERO */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-violet-100 border border-violet-300 rounded-full text-xs text-violet-700 mb-8">
              <Zap size={12} /> Axal VC · Global Venture Partner Network
            </div>
            <h1
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              className="text-5xl md:text-7xl font-bold leading-tight mb-6 text-gray-900 dark:text-gray-100"
            >
              Where venture builders meet{' '}
              <span className="text-violet-600">capital</span>
              <br />globally.
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-8 leading-relaxed">
              One network connecting partners, capital, founders, mentors, and coaches. Built on a six-layer
              venture OS, with <span className="text-violet-700 font-medium">Spin-Out Lab</span> as our niche 30-day sprint.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
              {THESIS_PILLS.map((p) => (
                <span key={p} className="text-xs px-3 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-700 dark:border-gray-800 dark:text-gray-300">
                  {p}
                </span>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/register?lane=partner"
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-all px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/20 hover:shadow-violet-600/40"
              >
                Become a Partner <ArrowRight size={16} />
              </Link>
              <Link
                to="/register?lane=lp"
                className="flex items-center gap-2 bg-purple-700 hover:bg-purple-800 transition-all px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-purple-700/20 hover:shadow-purple-700/40"
              >
                Open LP Account <ArrowRight size={16} />
              </Link>
              <Link
                to="/register?lane=founder"
                className="flex items-center gap-2 bg-white hover:bg-violet-50 border border-violet-300 text-violet-700 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium dark:bg-gray-900"
              >
                Apply as Founder <ChevronRight size={16} />
              </Link>
            </div>
          </div>

          <StatsBar />
        </div>
      </section>

      {/* NETWORK LAYERS */}
      <section id="network" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Six layers, one operating system.
            </h2>
            <p className="text-gray-600 leading-relaxed">
              Every layer is live in production — built, integrated, and ready for partners,
              LPs, founders, mentors, and coaches to use day one.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {NETWORK_LAYERS.map((layer) => {
              const Icon = LAYER_ICONS[layer.id] || Users;
              return (
                <div
                  key={layer.id}
                  className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-violet-300 hover:shadow-lg transition-all dark:bg-gray-900 dark:border-gray-800"
                >
                  <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center mb-5">
                    <Icon size={22} className="text-violet-600" />
                  </div>
                  <h3 className="text-base font-semibold mb-2 text-gray-900 dark:text-gray-100">{layer.name}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{layer.blurb}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SPIN-OUT LAB NICHE CALLOUT
          Task #13 — copy aligned 1:1 with /spinout-lab. Each sub-block
          deep-links into the matching anchor on the full Lab page for
          depth. Layout (2/3 + 1/3 grid) and styling are unchanged. */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-3xl border-2 border-violet-200 bg-violet-50/40 p-10 md:p-14 grid md:grid-cols-3 gap-10">
            <div className="md:col-span-2 space-y-8">
              <div>
                <span className="inline-block text-[11px] uppercase tracking-wider font-semibold text-violet-700 bg-violet-100 px-2.5 py-1 rounded">
                  Niche product
                </span>
                <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mt-4 mb-4 dark:text-gray-100">
                  Spin-Out Lab — 30-day venture sprint.
                </h2>
                <p className="text-base text-gray-700 leading-relaxed dark:text-gray-300">
                  For founders with an idea and no incorporated company yet. Four weeks. Four
                  milestones. Ends with a Delaware C-Corp (or alt), cap table, 83(b), pitch deck,
                  and venture-readiness score.
                </p>
              </div>

              {/* Trimmed copy — landing page now teases What you get / What we
                  look for in one sentence each; full list lives on /spinout-lab. */}
              <div>
                <h3 className="text-sm uppercase tracking-wider text-violet-700 font-semibold mb-2">
                  What you get
                </h3>
                <p className="text-sm text-gray-700 leading-relaxed dark:text-gray-300">
                  A high-touch spin-out program with advisor support, warm intros,
                  mentor matching, and the tooling founders need to move fast.{' '}
                  <Link
                    to="/spinout-lab#what-you-get"
                    className="inline-flex items-center gap-1 text-violet-700 hover:text-violet-900 font-medium"
                  >
                    See full list <ArrowRight size={12} />
                  </Link>
                </p>
              </div>

              <div>
                <h3 className="text-sm uppercase tracking-wider text-violet-700 font-semibold mb-2">
                  What we look for
                </h3>
                <p className="text-sm text-gray-700 leading-relaxed dark:text-gray-300">
                  Strong founder-market fit, deep domain insight, customer access,
                  full-time commitment, and clear reasons to say yes or no.{' '}
                  <Link
                    to="/spinout-lab#what-we-look-for"
                    className="inline-flex items-center gap-1 text-violet-700 hover:text-violet-900 font-medium"
                  >
                    See full criteria <ArrowRight size={12} />
                  </Link>
                </p>
              </div>

              <Link
                to="/spinout-lab"
                className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-colors px-6 py-3 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/20"
              >
                See the full Lab <ArrowRight size={16} />
              </Link>
            </div>

            {/* The 4-week playbook — one bullet per week with anchor deep-links. */}
            <div className="md:col-span-1">
              <h3 className="text-sm uppercase tracking-wider text-violet-700 font-semibold mb-4">
                The 4-week playbook
              </h3>
              <ol className="space-y-4">
                {[
                  {
                    n: 1,
                    title: 'Idea & Customer',
                    desc: 'Frame the problem, size the market, log ≥5 customer interviews.',
                  },
                  {
                    n: 2,
                    title: 'Solution & Roadmap',
                    desc: 'Scope the MVP, set 90-day OKRs, draft brand v1 + deck v1.',
                  },
                  {
                    n: 3,
                    title: 'Validate & Team',
                    desc: 'First venture-readiness score, mentor cadence, co-founder track.',
                  },
                  {
                    n: 4,
                    title: 'Incorporate & Capital',
                    desc: 'Incorporate, vest, file 83(b), lock the ask, three warm intros.',
                  },
                ].map((w) => (
                  <li key={w.n} className="flex gap-3">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">
                      {w.n}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Week {w.n} — {w.title}
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5">{w.desc}</div>
                      <Link
                        to={`/spinout-lab#week${w.n}`}
                        className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium text-violet-700 hover:text-violet-900"
                      >
                        See Week {w.n} <ArrowRight size={10} />
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* THREE LANES */}
      <section id="lanes" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mx-auto text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Five lanes into the network.
            </h2>
            <p className="text-gray-600">
              Pick the door that fits — every lane is a first-class citizen.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            {LANES.map((lane) => {
              const Icon = lane.icon;
              return (
                <div key={lane.id} className={`rounded-2xl border ${lane.tint} p-6 flex flex-col bg-white`} style={{ borderColor: lane.color }}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
                      <Icon size={18} className="text-violet-700" />
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{lane.title}</h3>
                  </div>
                  <ul className="space-y-2 mb-6 flex-1">
                    {lane.bullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to={lane.href}
                    className="inline-flex items-center justify-center gap-2 text-white text-sm font-medium rounded-xl px-4 py-2.5 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: lane.color }}
                  >
                    {lane.cta} <ArrowRight size={14} />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW THE NETWORK WORKS */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-violet-100 border border-violet-200 rounded-full text-[11px] text-violet-700 mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-600 animate-pulse" /> Live in Production
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-gray-100">How the network works.</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              Three steps. Join, get verified, unlock progressively.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={i} className="relative bg-white border border-gray-200 rounded-2xl p-6 hover:shadow-lg hover:border-violet-300 transition-all dark:bg-gray-900 dark:border-gray-800">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 to-violet-600 rounded-t-2xl" />
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-500 font-medium">{step.week}</div>
                  <step.icon size={16} className="text-violet-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">{step.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLATFORM */}
      <section id="platform" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-gray-100">The Platform Underneath</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              Integrated engines powering the entire venture lifecycle. Spin-Out Lab is one of them.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PLATFORM_FEATURES.map((f, i) => (
              <Link
                key={i}
                to={f.to}
                className="flex items-start gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:border-violet-300 hover:shadow-lg transition-all group dark:bg-gray-900 dark:border-gray-800"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                  <f.icon size={18} className="text-violet-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold mb-1 text-gray-900 flex items-center gap-1.5 dark:text-gray-100">
                    {f.title}
                    <ChevronRight size={12} className="text-gray-400 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all" />
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{f.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Task #1 — Latest from the network (3 most recent published articles).
          Public surface; renders nothing on empty/fetch error so it never breaks the page. */}
      <LatestArticles />

      {/* CTA */}
      <section className="py-20 px-6 bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Building the <span className="text-violet-400">Future of Digital Transformation</span>?
          </h2>
          <p className="text-gray-300 max-w-2xl mx-auto mb-8 leading-relaxed">
            Whether you're a partner sourcing the next thesis-aligned company, an LP looking for
            disciplined deal flow, or a founder going global from day one — start with a 30-second intake.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="https://axal.vc/signup"
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-all px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/30"
            >
              Get Started <ArrowRight size={16} />
            </a>
            <Link
              to="/contact"
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium text-white"
            >
              Talk to us <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
