import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, Users, Banknote, GitBranch, Radar, Scale,
  Handshake, Rocket, ArrowRight, ChevronRight,
  Search, ClipboardCheck, Hammer, Sparkles,
} from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import { NETWORK_LAYERS } from '../brand/gvpn';

const THESIS_PILLS = ['AI', 'Blockchain', 'Quantum', 'Digital Infrastructure', 'Frontier Software'];

const LAYER_ICONS = {
  partners: Users,
  capital: Banknote,
  deals: GitBranch,
  intelligence: Radar,
  legal: Scale,
};

const LANES = [
  {
    id: 'partner',
    title: 'For Partners & Operators',
    bullets: [
      'Weighted community voting on every deal (your vote counts 2x)',
      'Referral codes + revenue share on closed deals',
      'Partner directory + integrations marketplace',
      'Direct line into deal flow before public announcement',
    ],
    cta: 'Apply as Partner',
    href: '/register?lane=partner',
    btn: 'bg-violet-600 hover:bg-violet-700',
    tint: 'bg-violet-50/40 border-violet-200',
    icon: Handshake,
  },
  {
    id: 'lp',
    title: 'For LPs & Funds',
    bullets: [
      'Track commitments, calls, distributions in one ledger',
      'Auto-generated LPAs (AI-drafted, human-reviewed)',
      'TVPI / DPI charts per fund vintage',
      'Secondary marketplace for early liquidity',
    ],
    cta: 'Open LP Account',
    href: '/register?lane=lp',
    btn: 'bg-purple-700 hover:bg-purple-800',
    tint: 'bg-purple-50/40 border-purple-200',
    icon: Banknote,
  },
  {
    id: 'founder',
    title: 'For Founders',
    bullets: [
      'Get scored within 72 hours (100-point diligence)',
      'AI deal memo generated automatically',
      'If selected, enter Spin-Out Lab — funded in 30 days',
      'Lifetime founder portal: legal, capital, advisory',
    ],
    cta: 'Submit Your Pitch',
    href: '/register?lane=founder',
    btn: 'bg-indigo-600 hover:bg-indigo-700',
    tint: 'bg-indigo-50/40 border-indigo-200',
    icon: Rocket,
  },
];

const HOW_IT_WORKS = [
  { week: 'Step 1', title: 'Sourcing', icon: Search, desc: 'Partners refer founders and deals through warm channels and shared diligence packs.' },
  { week: 'Step 2', title: 'Scoring', icon: ClipboardCheck, desc: 'A 100-point engine plus AI memo turns intake into a decision in 72 hours.' },
  { week: 'Step 3', title: 'Capital', icon: Banknote, desc: 'LPs commit through the Capital Lane; capital calls and distributions live in one ledger.' },
  { week: 'Step 4', title: 'Build', icon: Hammer, desc: 'Selected founders enter Spin-Out Lab — incorporation, SAFE, advisor network in 30 days.' },
];

const PLATFORM_FEATURES = [
  { icon: Users, title: 'Partner Matchmaking', desc: 'AI-powered matching with referral tracking and deal syndication.', to: '/matches' },
  { icon: Banknote, title: 'Capital & LP Portal', desc: 'Capital calls, LP ledger, TVPI/DPI per vintage, distributions.', to: '/funds' },
  { icon: GitBranch, title: 'Deal Flow', desc: 'Pipeline, scoring engine, AI memos, real-time pipeline updates.', to: '/deals' },
  { icon: Radar, title: 'Market Intelligence', desc: 'Real-time sector signals, competitive data, semantic search.', to: '/market-intel' },
  { icon: Scale, title: 'Legal Engine', desc: 'Auto incorporation, SAFE agreements, equity splits, IP licensing.', to: '/legal' },
  { icon: Sparkles, title: 'AI Advisory', desc: 'Strategy, GTM, fundraising advice and financial planning for founders.', to: '/advisory' },
  { icon: Rocket, title: 'Spin-Out Lab', desc: 'Niche 30-day venture sprint — idea to funded in four weeks.', to: '/spinout-lab' },
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
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
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

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
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
              className="text-5xl md:text-7xl font-bold leading-tight mb-6 text-gray-900"
            >
              Where venture builders meet{' '}
              <span className="text-violet-600">capital</span>
              <br />globally.
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-8 leading-relaxed">
              One network. Three lanes — partners, capital, founders. Built on a 7-engine venture OS,
              with <span className="text-violet-700 font-medium">Spin-Out Lab</span> as our niche 30-day sprint.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
              {THESIS_PILLS.map((p) => (
                <span key={p} className="text-xs px-3 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-700">
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
                className="flex items-center gap-2 bg-white hover:bg-violet-50 border border-violet-300 text-violet-700 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium"
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
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">
              Five layers, one operating system.
            </h2>
            <p className="text-gray-600 leading-relaxed">
              Every layer is live in production — built, integrated, and ready for partners,
              LPs, and founders to use day one.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {NETWORK_LAYERS.map((layer) => {
              const Icon = LAYER_ICONS[layer.id] || Users;
              return (
                <div
                  key={layer.id}
                  className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-violet-300 hover:shadow-lg transition-all"
                >
                  <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center mb-5">
                    <Icon size={22} className="text-violet-600" />
                  </div>
                  <h3 className="text-base font-semibold mb-2 text-gray-900">{layer.name}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{layer.blurb}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SPIN-OUT LAB NICHE CALLOUT */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-3xl border-2 border-violet-200 bg-violet-50/40 p-10 md:p-14 grid md:grid-cols-3 gap-10">
            <div className="md:col-span-2">
              <span className="inline-block text-[11px] uppercase tracking-wider font-semibold text-violet-700 bg-violet-100 px-2.5 py-1 rounded">
                Niche product
              </span>
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mt-4 mb-4">
                Spin-Out Lab — a focused 30-day venture sprint.
              </h2>
              <div className="space-y-3 text-base text-gray-700 leading-relaxed">
                <p>
                  Most of the network is a continuous platform. <strong>Spin-Out Lab</strong> is the opposite —
                  a finite, 30-day cohort sprint for founders we underwrite from intake to incorporation.
                </p>
                <p>
                  Powered by the same engine: 100-point scoring, AI deal memos, automated diligence,
                  legal formation across 18 templates, capital match. Squeezed into four weeks.
                </p>
                <p className="text-sm text-gray-600">
                  Cohort-based · ~12 sprints/year · Apply once, get scored within 72 hours.
                </p>
              </div>
              <Link
                to="/spinout-lab"
                className="inline-flex items-center gap-2 mt-6 bg-violet-600 hover:bg-violet-700 transition-colors px-6 py-3 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/20"
              >
                See the 4-week playbook <ArrowRight size={16} />
              </Link>
            </div>
            <div className="md:col-span-1">
              <ol className="space-y-4">
                {[
                  { n: 1, title: 'Diligence & scoring', desc: '100-pt scoring, AI memo, references.' },
                  { n: 2, title: 'Legal formation', desc: 'Delaware C-Corp via the legal engine.' },
                  { n: 3, title: 'Capital match', desc: 'LP intros and SAFE generation.' },
                  { n: 4, title: 'Public launch', desc: 'First capital call + portal handoff.' },
                ].map((w) => (
                  <li key={w.n} className="flex gap-3">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">
                      {w.n}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Week {w.n} — {w.title}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{w.desc}</div>
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
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">
              Three lanes into the network.
            </h2>
            <p className="text-gray-600">
              Pick the door that fits — every lane is a first-class citizen.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {LANES.map((lane) => {
              const Icon = lane.icon;
              return (
                <div key={lane.id} className={`rounded-2xl border ${lane.tint} p-6 flex flex-col bg-white`}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
                      <Icon size={18} className="text-violet-700" />
                    </div>
                    <h3 className="text-base font-semibold text-gray-900">{lane.title}</h3>
                  </div>
                  <ul className="space-y-2 mb-6 flex-1">
                    {lane.bullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to={lane.href}
                    className={`inline-flex items-center justify-center gap-2 ${lane.btn} text-white text-sm font-medium rounded-xl px-4 py-2.5 transition-colors`}
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
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">How the network works.</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              Not a linear funnel. A loop — every deal feeds the next.
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl p-6 hover:shadow-lg hover:border-violet-300 transition-all">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 to-violet-600 rounded-t-2xl" />
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-500 font-medium">{step.week}</div>
                  <step.icon size={16} className="text-violet-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">{step.title}</h3>
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
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">The Platform Underneath</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              Seven integrated engines powering the entire venture lifecycle. Spin-Out Lab is one of them.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PLATFORM_FEATURES.map((f, i) => (
              <Link
                key={i}
                to={f.to}
                className="flex items-start gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:border-violet-300 hover:shadow-lg transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                  <f.icon size={18} className="text-violet-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold mb-1 text-gray-900 flex items-center gap-1.5">
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

      {/* CTA */}
      <section className="py-20 px-6 bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Building in <span className="text-violet-400">AI</span>, <span className="text-violet-400">Blockchain</span>, <span className="text-violet-400">Quantum</span>, <span className="text-violet-400">Digital Infrastructure</span>, or <span className="text-violet-400">Frontier Software</span>?
          </h2>
          <p className="text-gray-300 max-w-2xl mx-auto mb-8 leading-relaxed">
            Whether you're a partner sourcing the next thesis-aligned company, an LP looking for
            disciplined deal flow, or a founder going global from day one — start with a 30-second intake.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/register"
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-all px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/30"
            >
              Get Started <ArrowRight size={16} />
            </Link>
            <Link
              to="/login"
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium text-white"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
