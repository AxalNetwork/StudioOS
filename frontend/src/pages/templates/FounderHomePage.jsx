import React from 'react';
import {
  Rocket, Brain, Users, FileText, BarChart2,
  Clock, Handshake,
} from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import useForcedLightTheme from '../../hooks/useForcedLightTheme';
import Hero from '../../templates/components/Hero';
import MetricsStrip from '../../templates/components/MetricsStrip';
import FeatureGrid from '../../templates/components/FeatureGrid';
import OutcomeCards from '../../templates/components/OutcomeCards';
import Timeline from '../../templates/components/Timeline';
import TestimonialBlock from '../../templates/components/TestimonialBlock';
import FAQ from '../../templates/components/FAQ';
import CTABlock from '../../templates/components/CTABlock';
import SectionHeader from '../../templates/components/SectionHeader';
import { DISPLAY_FONT } from '../../templates/brandKit';

const METRICS = [
  { value: 38, label: 'Spin-Outs Completed' },
  { value: 1200, label: 'Deals Scored', suffix: '+' },
  { value: 200, label: 'Venture Partners', suffix: '+' },
  { value: 30, label: 'Days Average' },
];

const PAIN_POINTS = [
  {
    icon: Clock,
    title: 'Admin Overload',
    desc: "Incorporation, cap table, NDAs, compliance — all before you've validated anything. Founders waste months on paperwork.",
  },
  {
    icon: BarChart2,
    title: 'Building Blind',
    desc: "No customer discovery system, no scoring framework, no signal on what actually matters. You're shipping on instinct.",
  },
  {
    icon: Handshake,
    title: 'No Warm Intros',
    desc: "Fundraising without access is a cold game. No credibility signal, no verified traction, no investor relationships.",
  },
];

const SOLUTION_PILLARS = [
  {
    icon: Rocket,
    title: 'Spin-Out Lab',
    desc: '30-day structured sprint: idea to Delaware C-Corp with cap table, 83(b) election, and pitch deck. Advisor-guided, milestone-driven.',
    tag: 'Flagship',
  },
  {
    icon: Brain,
    title: 'AI Advisor',
    desc: "Always-on strategic guidance with full company context — GTM strategy, fundraising prep, financial planning, weekly check-ins.",
  },
  {
    icon: Users,
    title: 'Investor Network',
    desc: 'Scored deal flow with warm intros to 200+ verified venture partners. Your company reaches investors already primed to care.',
  },
];

const HOW_IT_WORKS = [
  {
    n: 1,
    label: 'Submit',
    title: 'Submit your pitch',
    desc: 'Tell us about your idea, market, and team. Takes five minutes. We read every submission.',
    bullets: [
      'Brief company description',
      'Founding team background',
      'Target market and early hypothesis',
    ],
  },
  {
    n: 2,
    label: 'Build',
    title: 'Enter the Spin-Out Lab',
    desc: 'Four structured weeks. Four milestones. Your dedicated advisor guides every step.',
    bullets: [
      'Week 1: Customer discovery and market sizing',
      'Week 2: Solution scope, roadmap, and deck v1',
      'Week 3: Venture-readiness score, advisor matching',
      'Week 4: Incorporate, vest, file 83(b), warm intros',
    ],
  },
  {
    n: 3,
    label: 'Fund',
    title: 'Get investor-ready',
    desc: 'Walk away with a Delaware C-Corp, clean cap table, pitch deck, venture-readiness score, and three warm investor intros.',
  },
];

const BENEFITS = [
  {
    icon: Clock,
    title: 'Save Months',
    desc: "Legal, incorporation, and compliance handled in days — not months. We've done this 38 times.",
  },
  {
    icon: Brain,
    title: 'Expert Guidance',
    desc: "AI advisor, advisor network, and weekly office hours. You're never building alone.",
  },
  {
    icon: Handshake,
    title: 'Warm Intros',
    desc: 'Direct access to 200+ verified venture partners. No cold outreach required.',
    highlight: true,
  },
  {
    icon: BarChart2,
    title: 'Validated Build',
    desc: 'Customer Discovery Log plus scoring engine. Know what works before you over-invest.',
  },
  {
    icon: FileText,
    title: 'Real Documentation',
    desc: 'Cap table, 83(b), SAFE agreements, and cofounder agreements generated and reviewed.',
  },
  {
    icon: Users,
    title: 'Alumni Network',
    desc: 'Lifetime access to the Axal VC founder community, deal flow, and alumni resources.',
  },
];

const TESTIMONIALS = [
  {
    quote: "The Spin-Out Lab gave us structure when we had none. We went from a rough idea to a term sheet in 45 days. The advisor caught two critical mistakes before we made them.",
    name: 'Sarah K.',
    role: 'Founder & CEO',
    company: 'DataFlow AI',
  },
  {
    quote: "I had been trying to incorporate for three months. Axal handled it in four days. The cap table came out clean and the 83(b) was filed on time. That alone saved us thousands.",
    name: 'Marcus L.',
    role: 'Co-Founder',
    company: 'BuildLayer',
  },
  {
    quote: "We logged 23 customer interviews in week one using their Discovery Log. It completely changed our roadmap. The investor intro we got at week four led to our pre-seed.",
    name: 'Jennifer P.',
    role: 'Founder',
    company: 'Stackform',
  },
];

const FAQS = [
  {
    q: 'Do I need to have a company already?',
    a: 'No. The Spin-Out Lab is designed specifically for founders who have an idea but no incorporated entity. We take you from zero to Delaware C-Corp. Existing companies can access the broader platform without entering the Lab.',
  },
  {
    q: 'Is this an accelerator?',
    a: 'No. Axal VC is a venture studio and operating platform. The Spin-Out Lab is a structured 28-day sprint with dedicated advisors, advisors, and capital access — not a cohort-based accelerator with demo days and mass batches.',
  },
  {
    q: 'What does it cost?',
    a: 'Platform access starts free. The Spin-Out Lab has a participation fee disclosed during application review. We believe in transparent pricing — no surprises at signing.',
  },
  {
    q: 'Who are the investors?',
    a: 'Our Global Venture Partner Network includes 200+ verified partners across AI, blockchain, quantum, and frontier software. All partners are KYB-verified and NDA-bound before seeing your deal.',
  },
  {
    q: "What if my idea isn't ready?",
    a: "Apply anyway. We assess founder-market fit, not idea maturity. If you are not ready for the Lab, we will tell you exactly what to do first and when to reapply.",
  },
  {
    q: 'What happens after 30 days?',
    a: 'You leave with a Delaware C-Corp (or equivalent), cap table, 83(b) election, pitch deck, venture-readiness score, and three warm investor intros — if you qualify. Alumni access to the network is lifetime.',
  },
];

export default function FounderHomePage() {
  useForcedLightTheme();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      <Hero
        badge="Axal VC · For Founders"
        headline={
          <>
            Build Something<br />
            <span className="text-[#6D5BFF]">Worth Funding.</span>
          </>
        }
        sub="From idea to investor-ready in 28 days. One platform covering everything — legal, product, team, and capital."
        ctaPrimary={{ label: 'Submit Your Pitch', href: '/register?lane=founder' }}
        ctaSecondary={{ label: 'See the Spin-Out Lab', href: '/spinout-lab' }}
        pills={['AI', 'Blockchain', 'Quantum', 'Frontier Software', 'Web3']}
      >
        <MetricsStrip metrics={METRICS} />
      </Hero>

      {/* PROBLEM */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="The Problem"
            headline="Most founders waste months on the wrong things."
            sub="Before you write a single line of code or talk to your first customer, the administrative weight of starting a company can sink you."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PAIN_POINTS.map((p, i) => {
              const Icon = p.icon;
              return (
                <div key={i} className="bg-white border border-gray-200 rounded-2xl p-7 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-400 to-orange-400" />
                  <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center mb-5">
                    <Icon size={20} className="text-red-500" />
                  </div>
                  <h3 style={DISPLAY_FONT} className="text-base font-semibold text-gray-900 mb-2">{p.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{p.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SOLUTION */}
      <FeatureGrid
        eyebrow="The Solution"
        headline="One platform. Everything founders need."
        sub="Axal VC gives founders the infrastructure, advisors, and capital access to build, validate, and fund — in one place."
        features={SOLUTION_PILLARS}
        cols={3}
        bg="bg-white"
      />

      {/* HOW IT WORKS */}
      <Timeline
        eyebrow="How It Works"
        headline="Three steps. Zero guesswork."
        sub="From your first pitch to your first term sheet — here's exactly what happens."
        steps={HOW_IT_WORKS}
        bg="bg-gray-50"
      />

      {/* BENEFITS */}
      <OutcomeCards
        eyebrow="What You Get"
        headline="Built for founders who move fast."
        sub="Every feature on the platform exists to help you ship faster, raise smarter, and build more durably."
        outcomes={BENEFITS}
        cols={3}
        bg="bg-white"
      />

      <TestimonialBlock
        eyebrow="Founder Stories"
        headline="What founders say."
        sub="From the 38 companies that have completed the Spin-Out Lab."
        testimonials={TESTIMONIALS}
        bg="bg-gray-50"
      />

      <FAQ items={FAQS} bg="bg-white" />

      <CTABlock
        headline="Ready to build something worth funding?"
        sub="Submit your pitch in five minutes. We read every submission and respond within five business days."
        ctaPrimary={{ label: 'Submit Your Pitch', href: '/register?lane=founder' }}
        ctaSecondary={{ label: 'See the Spin-Out Lab', href: '/spinout-lab' }}
        variant="dark"
        note="No commitment required. Platform access starts free."
      />

      <PublicFooter />
    </div>
  );
}
