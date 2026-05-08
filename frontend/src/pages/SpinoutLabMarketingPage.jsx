import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Rocket } from 'lucide-react';
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
  { label: 'Market', weight: 25, bar: 'bg-violet-600' },
  { label: 'Team', weight: 20, bar: 'bg-violet-500' },
  { label: 'Product', weight: 15, bar: 'bg-purple-500' },
  { label: 'Capital', weight: 15, bar: 'bg-purple-600' },
  { label: 'Strategic Fit', weight: 15, bar: 'bg-indigo-500' },
  { label: 'Distribution', weight: 10, bar: 'bg-indigo-600' },
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
  { q: 'Do you lead follow-on rounds?', a: 'Axal partners frequently lead the seed round; we facilitate but do not require it.' },
];

export default function SpinoutLabMarketingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      {/* HERO */}
      <section className="pt-32 pb-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-violet-100 border border-violet-300 rounded-full text-xs text-violet-700 mb-6">
            <Rocket size={12} /> Niche product · Axal VC · Global Venture Partner Network
          </div>
          <h1
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            className="text-4xl md:text-6xl font-bold leading-tight tracking-tight text-gray-900 mb-5"
          >
            Spin-Out Lab — <span className="text-violet-600">30 days</span> from idea to funded.
          </h1>
          <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            A niche product inside the Global Venture Partner Network. Cohort-based, finite, and
            powered by the same engine that runs the rest of the platform.
          </p>
          <div className="mt-8">
            <Link
              to={APPLY_HREF}
              className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/30"
            >
              Apply for next cohort <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* PLAYBOOK */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-3 text-gray-900">The 4-week playbook.</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              Same engine as the rest of the platform — just compressed.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PLAYBOOK.map((w) => (
              <div key={w.n} className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-violet-300 hover:shadow-lg transition-all">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-full bg-violet-600 text-white text-sm font-bold flex items-center justify-center">
                    {w.n}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Week {w.n} — {w.title}</h3>
                </div>
                <ul className="space-y-2">
                  {w.bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                      <Check size={14} className="text-violet-600 mt-0.5 shrink-0" />
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
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto bg-violet-50/40 border-2 border-violet-200 rounded-3xl p-8 md:p-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3 text-center">
            How we score — <span className="text-violet-600">100 points</span>.
          </h2>
          <p className="text-gray-600 text-center max-w-xl mx-auto mb-8">
            One algorithm. Same weights for every founder.
          </p>
          <div className="flex w-full h-12 rounded-lg overflow-hidden border border-violet-200">
            {SCORE_BREAKDOWN.map((s) => (
              <div
                key={s.label}
                className={`${s.bar} flex items-center justify-center text-xs font-semibold text-white`}
                style={{ width: `${s.weight}%` }}
                title={`${s.label}: ${s.weight}`}
              >
                {s.weight}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
            {SCORE_BREAKDOWN.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-sm text-gray-700">
                <span className={`w-3 h-3 rounded-sm ${s.bar}`} />
                <span>{s.label} <span className="text-gray-500">({s.weight})</span></span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DELIVERABLES + TIERS */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">What you get</h3>
            <ul className="space-y-3">
              {DELIVERABLES.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <Check size={14} className="text-violet-600 mt-0.5 shrink-0" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">What we look for</h3>
            <ul className="space-y-3">
              {TIERS.map((t) => (
                <li key={t.tier} className="flex items-start gap-3">
                  <span className="text-xs uppercase tracking-wider text-violet-700 font-semibold w-16 shrink-0 mt-0.5">
                    {t.tier}
                  </span>
                  <div>
                    <div className="text-sm text-gray-900 font-semibold">{t.score}</div>
                    <div className="text-xs text-gray-600">{t.desc}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-10 text-center">FAQ.</h2>
          <div className="space-y-3">
            {FAQ.map((f, i) => (
              <details
                key={i}
                className="group bg-gray-50 border border-gray-200 rounded-xl p-5 open:border-violet-300 open:bg-violet-50/40"
              >
                <summary className="cursor-pointer text-sm font-semibold text-gray-900 list-none flex items-center justify-between">
                  {f.q}
                  <span className="text-violet-600 text-xs group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="text-sm text-gray-700 leading-relaxed mt-3">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link
              to={APPLY_HREF}
              className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/30"
            >
              Apply for next cohort <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
