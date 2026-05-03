import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Banknote, GitBranch, Radar, Scale,
  Handshake, Rocket, ArrowRight,
} from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import { BRAND, NETWORK_LAYERS, LANES } from '../brand/gvpn';

const LAYER_ICONS = {
  partners: Users,
  capital: Banknote,
  deals: GitBranch,
  intelligence: Radar,
  legal: Scale,
};

const LANE_ACCENT = {
  violet: { dot: 'bg-gvpn-violet', border: 'border-gvpn-violet/40', text: 'text-gvpn-violet', btn: 'bg-gvpn-violet hover:opacity-90' },
  mint:   { dot: 'bg-gvpn-mint',   border: 'border-gvpn-mint/40',   text: 'text-gvpn-mint',   btn: 'bg-gvpn-mint hover:opacity-90 text-gvpn-ink' },
  amber:  { dot: 'bg-gvpn-amber',  border: 'border-gvpn-amber/40',  text: 'text-gvpn-amber',  btn: 'bg-gvpn-amber hover:opacity-90 text-gvpn-ink' },
};

const LANE_BULLETS = {
  partner: [
    'Weighted community voting on every deal (your vote counts 2x)',
    'Referral codes + revenue share on closed deals',
    'Partner directory + integrations marketplace',
    'Direct line into deal flow before public announcement',
  ],
  lp: [
    'Track commitments, calls, distributions in one ledger',
    'Auto-generated LPAs (AI-drafted, human-reviewed)',
    'TVPI / DPI charts per fund vintage',
    'Secondary marketplace for early liquidity',
  ],
  founder: [
    'Get scored within 72 hours (100-point diligence)',
    'AI deal memo generated automatically',
    'If selected, enter Spin-Out Lab — funded in 30 days',
    'Lifetime founder portal: legal, capital, advisory',
  ],
};

const LANE_ICONS = { partner: Handshake, lp: Banknote, founder: Rocket };

const FALLBACK_STATS = {
  partners: 200,
  funds: 4,
  deals_scored: 1200,
  spinouts: 38,
};

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
      setValue(Math.round(target * (0.5 - 0.5 * Math.cos(Math.PI * t)))); // ease-in-out
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function StatCell({ label, value, suffix }) {
  const n = useCountUp(value);
  return (
    <div className="flex flex-col items-center text-center px-4">
      <div className="text-2xl md:text-3xl font-semibold text-white tabular-nums">
        {n.toLocaleString()}{suffix || ''}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-1">{label}</div>
    </div>
  );
}

function TrustBar() {
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
      } catch {
        /* silent — fallback already set */
      }
    })();
    return () => ctrl.abort();
  }, []);
  return (
    <section className="border-y border-white/10 bg-white/[0.02]">
      <div className="max-w-7xl mx-auto px-6 py-5 grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-white/10">
        <StatCell label="Partners in network" value={stats.partners} suffix="+" />
        <StatCell label="Funds under management" value={stats.funds} />
        <StatCell label="Deals scored" value={stats.deals_scored} suffix="+" />
        <StatCell label="Spin-outs completed" value={stats.spinouts} />
      </div>
    </section>
  );
}

function HeroLaneCard({ lane }) {
  const a = LANE_ACCENT[lane.accent];
  return (
    <Link
      to={lane.href}
      className={`flex flex-col gap-3 rounded-2xl bg-white/[0.03] border ${a.border} hover:bg-white/[0.06] p-5 transition-all`}
    >
      <span className={`inline-flex items-center gap-2 text-xs font-medium ${a.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${a.dot}`} /> {lane.short}
      </span>
      <div className={`inline-flex items-center justify-center gap-2 text-sm font-medium rounded-xl px-4 py-2.5 text-white ${a.btn}`}>
        {lane.label} <ArrowRight size={14} />
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">{lane.blurb}</p>
    </Link>
  );
}

function NetworkLayerCard({ layer }) {
  const Icon = LAYER_ICONS[layer.id] || Users;
  return (
    <a
      href={`#layer-${layer.id}`}
      className="group rounded-2xl bg-white/[0.02] border border-white/10 hover:border-gvpn-violet/40 p-6 transition-all"
    >
      <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-4 group-hover:border-gvpn-violet/40 transition-colors">
        <Icon size={18} className="text-gvpn-violet" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-1.5">{layer.name}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{layer.blurb}</p>
    </a>
  );
}

function LaneCard({ id, title, accent, bullets, ctaLabel, ctaHref }) {
  const a = LANE_ACCENT[accent];
  const Icon = LANE_ICONS[id] || Handshake;
  return (
    <div className={`rounded-2xl bg-white/[0.03] border ${a.border} p-6 flex flex-col`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={18} className={a.text} />
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      <ul className="space-y-2 mb-6 flex-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-300 leading-relaxed">
            <span className={`w-1 h-1 rounded-full ${a.dot} mt-2 shrink-0`} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Link to={ctaHref} className={`inline-flex items-center gap-2 text-sm font-medium rounded-xl px-4 py-2.5 ${a.btn} text-white justify-center`}>
        {ctaLabel} <ArrowRight size={14} />
      </Link>
    </div>
  );
}

const SPINOUT_WEEKS = [
  { n: 1, title: 'Diligence & scoring',  desc: '100-pt scoring, AI memo, reference checks.' },
  { n: 2, title: 'Legal formation',      desc: 'Delaware C-Corp via the legal engine.' },
  { n: 3, title: 'Capital match',        desc: 'LP introductions and SAFE generation.' },
  { n: 4, title: 'Public launch',        desc: 'First capital call + portal handoff.' },
];

const HOW_IT_WORKS = [
  { title: 'Sourcing', desc: 'Partners refer founders and deals through warm channels and shared diligence packs.' },
  { title: 'Scoring', desc: 'A 100-point engine plus AI memo turns intake into a decision in 72 hours.' },
  { title: 'Capital', desc: 'LPs commit through the Capital Lane; capital calls and distributions live in one ledger.' },
  { title: 'Build', desc: 'Selected founders enter Spin-Out Lab — incorporation, SAFE, advisor network in 30 days.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gvpn-ink text-gray-100">
      <PublicNav />

      {/* HERO */}
      <section className="px-6 pt-20 pb-16 md:pt-28 md:pb-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/15 bg-white/[0.03] text-[11px] uppercase tracking-wider text-gray-300 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-gvpn-violet" /> {BRAND.name}
            </div>
            <h1
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              className="text-4xl md:text-6xl font-semibold leading-[1.05] tracking-tight text-white mb-5"
            >
              Where venture builders meet capital,{' '}
              <span className="text-gvpn-violet">globally.</span>
            </h1>
            <p className="text-base md:text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
              One network. Three lanes — partners, capital, founders. Built on a 7-engine venture OS,
              with <span className="text-gvpn-amber">Spin-Out Lab</span> as our niche 30-day sprint.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10 max-w-4xl mx-auto">
            {LANES.map((l) => <HeroLaneCard key={l.id} lane={l} />)}
          </div>
        </div>
      </section>

      <TrustBar />

      {/* NETWORK LAYERS */}
      <section id="network" className="px-6 py-20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              className="text-3xl md:text-4xl font-semibold text-white mb-3"
            >
              Five layers, one operating system.
            </h2>
            <p className="text-gray-400">
              Every layer is live in StudioOS — the engine under the network.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {NETWORK_LAYERS.map((layer) => <NetworkLayerCard key={layer.id} layer={layer} />)}
          </div>
        </div>
      </section>

      {/* SPIN-OUT LAB NICHE CALLOUT */}
      <section className="px-6 pb-20">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-3xl bg-gvpn-amber/10 border border-gvpn-amber/40 p-8 md:p-12 grid md:grid-cols-3 gap-8">
            <div className="md:col-span-2">
              <span className="text-[11px] uppercase tracking-wider text-gvpn-amber font-medium">
                Niche product
              </span>
              <h2
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                className="text-2xl md:text-3xl font-semibold text-white mt-2 mb-4"
              >
                Spin-Out Lab — a focused 30-day venture sprint.
              </h2>
              <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
                <p>
                  Most of GVPN is a continuous network. Spin-Out Lab is the opposite — a finite,
                  30-day sprint for founders we underwrite from intake to incorporation.
                </p>
                <p>
                  Powered by the same engine: 100-point scoring, AI deal memos, automated diligence,
                  legal formation across 18 templates, capital match. Squeezed into four weeks.
                </p>
                <p>
                  Cohort-based. ~12 sprints/year. Apply once, get scored within 72 hours.
                </p>
              </div>
              <Link
                to="/spinout-lab"
                className="inline-flex items-center gap-2 mt-6 bg-gvpn-amber text-gvpn-ink hover:opacity-90 transition-opacity px-5 py-2.5 rounded-xl text-sm font-medium"
              >
                See the 4-week playbook <ArrowRight size={14} />
              </Link>
            </div>
            <div className="md:col-span-1">
              <ol className="space-y-4">
                {SPINOUT_WEEKS.map((w) => (
                  <li key={w.n} className="flex gap-3">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gvpn-amber text-gvpn-ink text-xs font-semibold flex items-center justify-center">
                      {w.n}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">Week {w.n} — {w.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{w.desc}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* THREE LANES */}
      <section id="lanes" className="px-6 pb-20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              className="text-3xl md:text-4xl font-semibold text-white mb-3"
            >
              Three lanes into the network.
            </h2>
            <p className="text-gray-400">
              Pick the door that fits — every lane is a first-class citizen.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <LaneCard
              id="partner"
              title="For Partners & Operators"
              accent="violet"
              bullets={LANE_BULLETS.partner}
              ctaLabel="Apply as Partner"
              ctaHref="/register?lane=partner"
            />
            <LaneCard
              id="lp"
              title="For LPs & Funds"
              accent="mint"
              bullets={LANE_BULLETS.lp}
              ctaLabel="Open LP Account"
              ctaHref="/register?lane=lp"
            />
            <LaneCard
              id="founder"
              title="For Founders"
              accent="amber"
              bullets={LANE_BULLETS.founder}
              ctaLabel="Submit Your Pitch"
              ctaHref="/register?lane=founder"
            />
          </div>
        </div>
      </section>

      {/* HOW THE NETWORK WORKS */}
      <section id="deals" className="px-6 pb-20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              className="text-3xl md:text-4xl font-semibold text-white mb-3"
            >
              How the network works.
            </h2>
            <p className="text-gray-400">
              Not a linear funnel. A loop — every deal feeds the next.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={i} className="rounded-2xl bg-white/[0.02] border border-white/10 p-5">
                <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">
                  Step {i + 1}
                </div>
                <h3 className="text-base font-semibold text-white mb-1.5">{s.title}</h3>
                <p className="text-xs text-gray-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section id="capital" className="px-6 pb-24">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-3xl bg-white/[0.02] border border-white/10 p-10 md:p-14">
            <div className="text-center max-w-2xl mx-auto mb-10">
              <span className="text-[11px] uppercase tracking-wider text-gray-500">
                Social proof
              </span>
              <h2
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                className="text-2xl md:text-3xl font-semibold text-white mt-2"
              >
                Operators, LPs, and founders already on the network.
              </h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 opacity-60 hover:opacity-100 transition-opacity mb-10">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 rounded bg-white/5 border border-white/10 flex items-center justify-center text-[10px] text-gray-500"
                >
                  partner {i + 1}
                </div>
              ))}
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <blockquote className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
                <p className="text-sm text-gray-300 leading-relaxed">
                  "The Capital Lane is the first LP portal where commitments, calls and distributions
                  actually reconcile. We stopped maintaining a parallel spreadsheet."
                </p>
                <footer className="text-xs text-gray-500 mt-3">— LP, multi-stage fund</footer>
              </blockquote>
              <blockquote className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
                <p className="text-sm text-gray-300 leading-relaxed">
                  "Spin-Out Lab took us from a thesis deck to incorporated, scored, and matched
                  with three LPs in 28 days."
                </p>
                <footer className="text-xs text-gray-500 mt-3">— Founder, Cohort 03</footer>
              </blockquote>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
