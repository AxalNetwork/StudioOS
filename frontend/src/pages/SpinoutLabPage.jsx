import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';

const APPLY_HREF = '/register?lane=founder&product=spinout-lab';

const PLAYBOOK = [
  {
    n: 1,
    title: 'Diligence & scoring',
    bullets: [
      '100-point scoring across Market 25 / Team 20 / Product 15 / Capital 15 / Strategic Fit 15 / Distribution 10',
      'AI deal memo generated and reviewed by an Axal partner',
      'Reference + background checks; KYC initiated',
    ],
  },
  {
    n: 2,
    title: 'Legal formation',
    bullets: [
      'Delaware C-Corp incorporation via Stripe Atlas / Cooley GO integrations',
      'IP assignment + employment templates issued from the legal engine',
      'Cap table initialized; founder vesting installed',
    ],
  },
  {
    n: 3,
    title: 'Capital match',
    bullets: [
      'LP introductions routed through the Capital Lane',
      'SAFE generation and partner co-invest commitments',
      'Investor data room published from the diligence pack',
    ],
  },
  {
    n: 4,
    title: 'Public launch',
    bullets: [
      'First capital call cleared into the operating account',
      'Founder portal handoff: legal vault, advisor network, OKRs',
      'Inclusion in monthly partner-network update',
    ],
  },
];

const SCORE_BREAKDOWN = [
  { label: 'Market', weight: 25, color: 'bg-gvpn-violet' },
  { label: 'Team', weight: 20, color: 'bg-gvpn-mint' },
  { label: 'Product', weight: 15, color: 'bg-gvpn-amber' },
  { label: 'Capital', weight: 15, color: 'bg-violet-400' },
  { label: 'Strategic Fit', weight: 15, color: 'bg-emerald-400' },
  { label: 'Distribution', weight: 10, color: 'bg-amber-400' },
];

const DELIVERABLES = [
  'Delaware C-Corp registered & EIN issued',
  'Founder + employee SAFE / equity templates',
  'AI-generated deal memo (PDF + portal copy)',
  'Capital intro list with warm partner routing',
  'Founder portal: legal, capital, advisory, monitoring',
];

const TIERS = [
  { tier: 'Tier 1', score: '≥ 85', desc: 'Immediate cohort offer.' },
  { tier: 'Tier 2', score: '≥ 70', desc: 'Conditional — 1–2 milestones, then re-score.' },
  { tier: 'Tier 3', score: '< 70', desc: 'Declined for this cohort. Reapply with traction.' },
];

const FAQ = [
  { q: 'How big is each cohort?', a: '6–10 founders per sprint. ~12 sprints/year.' },
  { q: 'Is there a fee?', a: 'No upfront fee. Spin-Out Lab takes a standard founder-friendly equity stake at incorporation, disclosed in the term sheet.' },
  { q: 'How much equity does Spin-Out Lab take?', a: 'Negotiated per deal but anchored at studio-standard ranges. Disclosed before you sign.' },
  { q: 'What about my timezone?', a: 'Async-first. The capital match week requires a few synchronous LP calls.' },
  { q: 'Do you lead follow-on rounds?', a: 'GVPN partners frequently lead the seed round; we facilitate but do not require it.' },
];

export default function SpinoutLabPage() {
  return (
    <div className="min-h-screen bg-gvpn-ink text-gray-100">
      <PublicNav />

      {/* HERO */}
      <section className="px-6 pt-20 pb-14 md:pt-28">
        <div className="max-w-4xl mx-auto text-center">
          <span className="text-[11px] uppercase tracking-wider text-gvpn-amber font-medium">
            Niche product · Global Venture Partner Network
          </span>
          <h1
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            className="text-4xl md:text-5xl font-semibold leading-tight tracking-tight text-white mt-4 mb-4"
          >
            Spin-Out Lab — 30 days from idea to funded company.
          </h1>
          <p className="text-base md:text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
            A niche product inside the Global Venture Partner Network. Cohort-based, finite, and
            powered by the same engine that runs the rest of GVPN.
          </p>
          <div className="mt-8">
            <Link
              to={APPLY_HREF}
              className="inline-flex items-center gap-2 bg-gvpn-amber text-gvpn-ink hover:opacity-90 transition-opacity px-6 py-3 rounded-xl text-sm font-medium"
            >
              Apply for next cohort <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* PLAYBOOK */}
      <section className="px-6 pb-20">
        <div className="max-w-6xl mx-auto">
          <h2
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            className="text-2xl md:text-3xl font-semibold text-white mb-2 text-center"
          >
            The 4-week playbook.
          </h2>
          <p className="text-gray-400 text-center max-w-xl mx-auto mb-10">
            Same engine as the rest of GVPN — just compressed.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PLAYBOOK.map((w) => (
              <div key={w.n} className="rounded-2xl bg-white/[0.02] border border-white/10 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-gvpn-amber text-gvpn-ink text-sm font-semibold flex items-center justify-center">
                    {w.n}
                  </div>
                  <h3 className="text-lg font-semibold text-white">Week {w.n} — {w.title}</h3>
                </div>
                <ul className="space-y-2">
                  {w.bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300 leading-relaxed">
                      <Check size={14} className="text-gvpn-mint mt-0.5 shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SCORING */}
      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto rounded-3xl bg-white/[0.02] border border-white/10 p-8 md:p-12">
          <h2
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            className="text-2xl md:text-3xl font-semibold text-white mb-2 text-center"
          >
            How we score — 100 points.
          </h2>
          <p className="text-gray-400 text-center max-w-xl mx-auto mb-8">
            One algorithm. Same weights for every founder.
          </p>
          <div className="flex w-full h-10 rounded-lg overflow-hidden border border-white/10">
            {SCORE_BREAKDOWN.map((s) => (
              <div
                key={s.label}
                className={`${s.color} flex items-center justify-center text-[11px] font-medium text-gvpn-ink`}
                style={{ width: `${s.weight}%` }}
                title={`${s.label}: ${s.weight}`}
              >
                {s.weight}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
            {SCORE_BREAKDOWN.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-sm text-gray-300">
                <span className={`w-2.5 h-2.5 rounded-sm ${s.color}`} />
                <span>{s.label} <span className="text-gray-500">({s.weight})</span></span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DELIVERABLES + TIERS */}
      <section className="px-6 pb-20">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-white/[0.02] border border-white/10 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">What you get</h3>
            <ul className="space-y-2">
              {DELIVERABLES.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                  <Check size={14} className="text-gvpn-mint mt-0.5 shrink-0" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-white/[0.02] border border-white/10 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">What we look for</h3>
            <ul className="space-y-3">
              {TIERS.map((t) => (
                <li key={t.tier} className="flex items-start gap-3">
                  <span className="text-xs uppercase tracking-wider text-gvpn-amber font-medium w-16 shrink-0 mt-0.5">{t.tier}</span>
                  <div>
                    <div className="text-sm text-white font-medium">{t.score}</div>
                    <div className="text-xs text-gray-400">{t.desc}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 pb-20">
        <div className="max-w-3xl mx-auto">
          <h2
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            className="text-2xl md:text-3xl font-semibold text-white mb-8 text-center"
          >
            FAQ.
          </h2>
          <div className="space-y-3">
            {FAQ.map((f, i) => (
              <details key={i} className="group rounded-xl bg-white/[0.02] border border-white/10 p-5 open:border-gvpn-violet/40">
                <summary className="cursor-pointer text-sm font-medium text-white list-none flex items-center justify-between">
                  {f.q}
                  <span className="text-gvpn-violet text-xs group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="text-sm text-gray-400 leading-relaxed mt-3">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link
              to={APPLY_HREF}
              className="inline-flex items-center gap-2 bg-gvpn-amber text-gvpn-ink hover:opacity-90 transition-opacity px-6 py-3 rounded-xl text-sm font-medium"
            >
              Apply for next cohort <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
