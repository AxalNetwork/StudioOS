import React from 'react';
import {
  ShieldCheck, Users, Layers, Scale, Brain,
  TrendingUp, FileText, Globe, Database, PieChart,
} from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import useForcedLightTheme from '../../hooks/useForcedLightTheme';
import Hero from '../../templates/components/Hero';
import MetricsStrip from '../../templates/components/MetricsStrip';
import FeatureGrid from '../../templates/components/FeatureGrid';
import ProofBar from '../../templates/components/ProofBar';
import Timeline from '../../templates/components/Timeline';
import FAQ from '../../templates/components/FAQ';
import CTABlock from '../../templates/components/CTABlock';
import AccessBlock from '../../templates/components/AccessBlock';
import TestimonialBlock from '../../templates/components/TestimonialBlock';
import SectionHeader from '../../templates/components/SectionHeader';
import { DISPLAY_FONT } from '../../templates/brandKit';

const METRICS = [
  { value: 38, label: 'Companies Incorporated' },
  { value: 1200, label: 'Deals Scored', suffix: '+' },
  { value: 200, label: 'Venture Partners', suffix: '+' },
  { value: 4, label: 'Active Funds' },
];

const PROOF_BAR = [
  { value: 'AI · Blockchain · Quantum', label: 'Investment Thesis' },
  { value: '2%', label: 'Management Fee' },
  { value: '20%', label: 'Carried Interest' },
  { value: '8%', label: 'Hurdle Rate' },
];

const THESIS_SECTORS = [
  { icon: Brain, title: 'Artificial Intelligence', desc: 'Foundation models, applied AI, vertical SaaS, agentic systems, and AI infrastructure.' },
  { icon: Layers, title: 'Blockchain and Web3', desc: 'Infrastructure protocols, DeFi, tokenized assets, identity, and privacy-preserving computation.' },
  { icon: Globe, title: 'Quantum Computing', desc: 'Near-term applications in optimization, cryptography, sensing, and quantum networking.' },
  { icon: Database, title: 'Digital Infrastructure', desc: 'Dev tools, cloud-native platforms, observability, security, and data pipeline technology.' },
  { icon: TrendingUp, title: 'Frontier Software', desc: 'High-leverage automation, simulation, decision intelligence, and next-generation productivity.' },
  { icon: ShieldCheck, title: 'Trust and Compliance', desc: 'Identity verification, regulatory technology, financial compliance, and enterprise security.' },
];

const SCORING_LAYERS = [
  { n: 1, label: 'Layer 1', title: 'Trust Verification', desc: 'KYC, KYB, sanctions screening, and accreditation checks on all parties before any information is shared.' },
  { n: 2, label: 'Layer 2', title: 'Business Validation', desc: 'Revenue verified via Stripe and Plaid. Users, traction, churn, and engagement signals pulled from live integrations.' },
  { n: 3, label: 'Layer 3', title: 'Team Assessment', desc: 'Founder-market fit, domain depth, full-time commitment, and references from the network. No anonymous submissions.' },
  { n: 4, label: 'Layer 4', title: 'Market Sizing', desc: 'TAM/SAM/SOM documented with sources. Competitive landscape assessed by sector-specialist partners.' },
  { n: 5, label: 'Layer 5', title: 'Financial Due Diligence', desc: 'Cap table, unit economics, burn rate, and runway — reviewed before anything reaches your screen.' },
  { n: 6, label: 'Layer 6', title: 'Legal Readiness', desc: 'Incorporation status, IP ownership, contractual structure, and 83(b) election documentation reviewed.' },
];

const ROADMAP = [
  { n: 'Q3 2025', title: 'Fund II Launch', desc: 'Expanded LP base with institutional commitments. Target: $25M.' },
  { n: 'Q4 2025', title: 'AI Scoring Enhancement', desc: 'Next-generation ML scoring model trained on 1,200+ historical deals.' },
  { n: 'Q1 2026', title: 'International Expansion', desc: 'LP onboarding and compliance infrastructure for EU and APAC jurisdictions.' },
  { n: 'Q2 2026', title: 'Secondary Market', desc: 'Liquidity options for LP positions in seasoned portfolio companies.' },
];

const DATA_ROOM_ITEMS = [
  { icon: FileText, label: 'Audited Financial Statements', desc: 'Fund I audited accounts and quarterly LP reports', status: 'On Request' },
  { icon: Scale, label: 'LP Agreement and Term Sheet', desc: 'Full limited partnership agreement and investment terms', status: 'On Request' },
  { icon: ShieldCheck, label: 'Regulatory Filings', desc: 'Form D, exempt offering documentation, and compliance certificates', status: 'On Request' },
  { icon: Database, label: 'Portfolio Data Room', desc: 'Individual company deal sheets, scoring breakdowns, and updates', status: 'After KYC' },
  { icon: PieChart, label: 'Scoring Methodology', desc: 'Full documentation of the 6-layer scoring engine and weights', status: 'Available' },
  { icon: Users, label: 'LP and Co-Investor List', desc: 'Existing LP roster and co-investment syndicate partners', status: 'NDA Required' },
];

const TESTIMONIALS = [
  {
    quote: "The scoring engine saved me weeks of diligence. By the time I saw a deal, every basic question was already answered with verified data. I make decisions faster and with more confidence.",
    name: 'Michael T.',
    role: 'Managing Partner',
    company: 'Family Office LP',
  },
  {
    quote: "I have been in venture for 14 years. This is the most rigorous pre-screening process I have seen at this stage. The sanctions checks and KYB alone put most funds to shame.",
    name: 'Aisha K.',
    role: 'Venture Partner',
    company: 'Global VP Network',
  },
  {
    quote: "The Spin-Out Lab companies come in with real customer evidence, clean cap tables, and founders who have already been stress-tested. Deal flow quality is exceptional.",
    name: 'Jonathan R.',
    role: 'Angel Investor',
    company: 'Frontier Tech Focus',
  },
];

const FAQS = [
  {
    q: 'Who is eligible to invest?',
    a: 'Accredited investors and qualified purchasers under US securities law. International LPs are welcome and subject to compliance review under their local jurisdiction. We handle the KYC and accreditation process on the platform.',
  },
  {
    q: 'What is the minimum investment?',
    a: 'Minimum LP commitment for Fund I is disclosed during onboarding. Co-investment minimums vary per deal and are set at the deal level. We accommodate a range of check sizes through our tiered access structure.',
  },
  {
    q: 'How is dealflow sourced?',
    a: 'Through our 200+ Global Venture Partner Network, direct inbound to the platform, and the Spin-Out Lab graduation pipeline. Every source is logged. Every company is scored before you see it.',
  },
  {
    q: 'How are companies scored?',
    a: 'Our 6-layer engine combines automated data verification (Stripe, Plaid for financials) with human expert assessment across trust, build, validation, capital, legal, and network dimensions. Scores are recalculated on each update.',
  },
  {
    q: 'Is this an SEC-registered fund?',
    a: 'Axal VC GP LLC manages Axal VC Fund I, LP as a private fund under applicable exemptions. We comply with all relevant securities regulations. Full regulatory documentation is available during due diligence.',
  },
  {
    q: 'How do co-investments work?',
    a: 'Professional and institutional LPs have co-investment rights on qualified deals. Co-investment terms are deal-specific and disclosed at the time of the opportunity. We do not charge additional management fees on co-investments.',
  },
];

export default function InvestorDealflowHomePage() {
  useForcedLightTheme();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      <Hero
        badge="Invitation-Only Dealflow"
        headline={
          <>
            The Most Disciplined<br />
            <span className="text-[#6D5BFF]">Dealflow</span> in<br />
            Frontier Tech.
          </>
        }
        sub="Every company scored, verified, and sanctions-screened before it reaches your desk. We screen everything so you see only what matters."
        ctaPrimary={{ label: 'Request Dealflow Access', href: '/register?lane=lp' }}
        ctaSecondary={{ label: 'View Investment Thesis', href: '/about' }}
        pills={['AI', 'Blockchain', 'Quantum', 'Digital Infrastructure', 'Frontier Software']}
      >
        <MetricsStrip metrics={METRICS} />
      </Hero>

      <ProofBar items={PROOF_BAR} />

      <FeatureGrid
        eyebrow="Market Opportunity"
        headline="Frontier tech is the next decade of value creation."
        sub="We invest at the earliest stage, when the signal-to-noise ratio is lowest and the potential return is highest."
        features={THESIS_SECTORS}
        cols={3}
        bg="bg-white"
      />

      {/* PROBLEM / SOLUTION */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-start">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-50 border border-red-200 rounded-full text-[11px] font-semibold text-red-600 uppercase tracking-wider mb-5">
                The Problem
              </div>
              <h2 style={DISPLAY_FONT} className="text-2xl md:text-3xl font-bold text-gray-900 mb-6">
                Most dealflow is noise.
              </h2>
              <ul className="space-y-4">
                {[
                  'Scouts share everything with no filter. LPs see the same companies everyone else sees.',
                  'Pre-screening is manual and inconsistent. Critical data is missing or unverified.',
                  '90% of inbound never gets properly diligenced before founders are introduced.',
                  'Sanctions exposure and cap table problems surface late in the process.',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                    <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center text-red-500 font-bold text-xs shrink-0 mt-0.5">✕</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#EEF0FF] border border-[#6D5BFF]/20 rounded-full text-[11px] font-semibold text-[#6D5BFF] uppercase tracking-wider mb-5">
                Our Solution
              </div>
              <h2 style={DISPLAY_FONT} className="text-2xl md:text-3xl font-bold text-gray-900 mb-6">
                We screen everything. You see what matters.
              </h2>
              <ul className="space-y-4">
                {[
                  'Every company passes a 6-layer scoring engine before appearing in your pipeline.',
                  'Financial data verified via Stripe and Plaid integrations — not self-reported.',
                  'Sanctions screening and KYB on all founders before any introduction is made.',
                  'Cap table, 83(b), and legal readiness reviewed before the deal profile is published.',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                    <span className="w-5 h-5 rounded-full bg-[#EEF0FF] flex items-center justify-center text-[#6D5BFF] font-bold text-xs shrink-0 mt-0.5">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <Timeline
        eyebrow="Scoring Engine"
        headline="Six layers. Every deal. No exceptions."
        sub="Our scoring engine runs every company through all six layers before it reaches investor view."
        steps={SCORING_LAYERS}
        bg="bg-white"
      />

      {/* ROADMAP */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <SectionHeader
            eyebrow="Roadmap"
            headline="What's coming next."
            sub="Fund II and beyond — what we're building for our LP base."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {ROADMAP.map((r, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6 relative overflow-hidden hover:border-[#6D5BFF]/40 hover:shadow-lg transition-all">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#6D5BFF] to-[#5DE0B8]" />
                <div className="text-[11px] text-[#6D5BFF] font-semibold uppercase tracking-wider mb-2">{r.n}</div>
                <h3 style={DISPLAY_FONT} className="text-sm font-semibold text-gray-900 mb-2">{r.title}</h3>
                <p className="text-xs text-gray-600 leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <TestimonialBlock
        eyebrow="LP and Partner Feedback"
        headline="What investors say about our dealflow."
        testimonials={TESTIMONIALS}
        bg="bg-white"
      />

      <AccessBlock
        headline="Request access to the data room."
        sub="Audited financials, LP agreement, portfolio deal sheets, scoring methodology, and regulatory documentation. Available after KYC verification."
        items={DATA_ROOM_ITEMS}
        cta={{ label: 'Request Dealflow Access', href: '/register?lane=lp' }}
        note="KYC and accreditation verification required. Typically completed within 2 business days."
        bg="bg-[#0B0B12]"
      />

      <FAQ items={FAQS} headline="Investor questions answered." bg="bg-gray-50" />

      <CTABlock
        headline="Ready to invest in what's coming?"
        sub="Request access to our dealflow and data room. Institutional-quality diligence. Frontier-stage returns."
        ctaPrimary={{ label: 'Request Dealflow Access', href: '/register?lane=lp' }}
        ctaSecondary={{ label: 'Talk to Our Team', href: '/contact' }}
        variant="dark"
        note="Accredited investors only. Subject to KYC and compliance review."
      />

      <PublicFooter />
    </div>
  );
}
