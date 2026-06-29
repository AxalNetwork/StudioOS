import React from 'react';
import {
  Users, Scale, Globe, Banknote, Zap,
  ShieldCheck, TrendingUp, CheckCircle, ArrowRight,
  Code, Megaphone, Search,
} from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import useForcedLightTheme from '../../hooks/useForcedLightTheme';
import Hero from '../../templates/components/Hero';
import ProofBar from '../../templates/components/ProofBar';
import FeatureGrid from '../../templates/components/FeatureGrid';
import OutcomeCards from '../../templates/components/OutcomeCards';
import Timeline from '../../templates/components/Timeline';
import TestimonialBlock from '../../templates/components/TestimonialBlock';
import FAQ from '../../templates/components/FAQ';
import CTABlock from '../../templates/components/CTABlock';
import SectionHeader from '../../templates/components/SectionHeader';
import { DISPLAY_FONT } from '../../templates/brandKit';

const PROOF_BAR = [
  { value: '200+', label: 'Active Partners' },
  { value: '38', label: 'Portfolio Companies' },
  { value: '6', label: 'Network Layers' },
  { value: 'Global', label: 'Coverage' },
];

const PARTNER_TYPES = [
  {
    icon: Scale,
    title: 'Professional Service Firms',
    desc: 'Legal, accounting, HR, and compliance firms serving early-stage companies. Access a curated pipeline of high-growth founders who need your expertise.',
  },
  {
    icon: Code,
    title: 'Technology Partners',
    desc: "SaaS vendors, API providers, cloud platforms, and developer tools. Reach founders who are actively building and need your infrastructure.",
  },
  {
    icon: Banknote,
    title: 'Financial Advisors',
    desc: 'Fund managers, wealth advisors, and alternative investment specialists. Source vetted deal flow and co-investment opportunities.',
  },
  {
    icon: Zap,
    title: 'Domain Experts',
    desc: 'Sector specialists, industry veterans, and technical advisors. Convert your expertise into advisory equity through our FAST template.',
  },
  {
    icon: Megaphone,
    title: 'Growth and Marketing',
    desc: 'Agencies, PR firms, and growth strategists. Serve a steady pipeline of portfolio companies at different growth stages.',
  },
  {
    icon: Search,
    title: 'Talent and Recruiting',
    desc: 'Executive search, technical recruiting, and team-building specialists. Founders building fast need trusted talent partners from day one.',
  },
];

const PARTNERSHIP_MODELS = [
  {
    title: 'Service Partner',
    badge: 'Most Common',
    desc: 'Provide services to Axal VC portfolio companies. Earn fees or equity. Get exclusive access to early-stage clients who are actively building.',
    bullets: [
      'Match with companies based on your expertise',
      'Negotiate rates directly (fees or equity)',
      'Platform handles billing and agreements',
      'Standard referral fee on matched engagements',
    ],
    cta: { label: 'Apply as Service Partner', href: '/register?lane=partner' },
    highlight: false,
  },
  {
    title: 'Venture Partner',
    badge: 'High Leverage',
    desc: 'Source deals, make introductions, co-invest alongside Fund I. Earn carry and referral fees on successful placements.',
    bullets: [
      'Full access to scored deal pipeline',
      'Carry on placed deals (terms vary)',
      'Co-investment rights on curated deals',
      'Monthly partner network sessions',
    ],
    cta: { label: 'Apply as Venture Partner', href: '/register?lane=partner' },
    highlight: true,
  },
  {
    title: 'Network Partner',
    badge: 'Low Commitment',
    desc: 'Refer companies and LPs to the Axal VC network. Earn referral fees on successful signups. Minimal time commitment required.',
    bullets: [
      'Referral fees on successful sign-ups',
      'No ongoing platform obligations',
      'Access to partner co-marketing materials',
      'Opt-in to deal flow as it becomes relevant',
    ],
    cta: { label: 'Apply as Network Partner', href: '/register?lane=partner' },
    highlight: false,
  },
];

const WHAT_PARTNERS_GET = [
  {
    icon: Users,
    title: 'Curated Company Access',
    desc: 'Access 200+ vetted founder companies matched to your specific expertise. No cold outreach required.',
  },
  {
    icon: Banknote,
    title: 'Revenue Opportunities',
    desc: 'Earn fees, equity, referral payments, or carry depending on your partnership model.',
    highlight: true,
  },
  {
    icon: ShieldCheck,
    title: 'Compliance Handled',
    desc: 'KYB verification, conflict of interest disclosure, and NDA management handled by the platform.',
  },
  {
    icon: TrendingUp,
    title: 'Network Effects',
    desc: 'Your reputation compounds inside the network. Great partners get more and better-matched introductions.',
  },
  {
    icon: Globe,
    title: 'Co-Investment Rights',
    desc: 'Venture Partners can co-invest on curated deal flow at preferential terms alongside Fund I.',
  },
  {
    icon: CheckCircle,
    title: 'Partner Community',
    desc: 'Monthly partner network sessions, co-marketing opportunities, and a directory listing in the partner portal.',
  },
];

const WHAT_WE_LOOK_FOR = [
  { icon: CheckCircle, label: 'Verified Track Record', text: 'Demonstrated expertise in your domain. We verify credentials as part of KYB.' },
  { icon: CheckCircle, label: 'Relevant Expertise', text: 'Directly applicable to the needs of early-stage companies at the frontier of tech.' },
  { icon: CheckCircle, label: 'Thesis Alignment', text: 'Understanding of and interest in AI, blockchain, quantum, and frontier software sectors.' },
  { icon: CheckCircle, label: 'Value Addition', text: 'Ability to add genuine value to portfolio companies — not just extract fees from a captive audience.' },
  { icon: CheckCircle, label: 'Long-Term Mindset', text: "We're building multi-year relationships. Short-term transactional partners aren't the right fit." },
  { icon: CheckCircle, label: 'Network Integrity', text: 'Full conflict of interest disclosure and willingness to operate within our partnership framework.' },
];

const PROCESS = [
  { n: 1, label: 'Apply', title: 'Complete the partner intake form', desc: "Tell us about your service offering, background, and what you're looking to build inside the network. Takes five minutes." },
  { n: 2, label: 'Verify', title: 'KYB review and conflict check', desc: 'We verify your business credentials, check for conflicts of interest, and review your track record.' },
  { n: 3, label: 'Connect', title: '30-minute intro call', desc: 'A conversation with our partnership team to discuss model, expectations, and mutual fit.' },
  { n: 4, label: 'Launch', title: 'Sign and access the platform', desc: 'Sign the partnership framework agreement and get dashboard access to matched portfolio companies.' },
];

const TESTIMONIALS = [
  {
    quote: "The platform handled all the KYB paperwork and NDA management. I just showed up and started delivering value. Three months in, I'm working with eight portfolio companies.",
    name: 'Rachel M.',
    role: 'Founding Partner',
    company: 'Legal Service Partner',
  },
  {
    quote: "Sourced three deals through the network in my first quarter. The scoring engine saved me weeks of diligence on each one. I co-invested in two.",
    name: 'Thomas H.',
    role: 'Independent Venture Partner',
    company: 'Frontier Tech Angel',
  },
  {
    quote: "We integrated our dev tools into eight portfolio companies in the first six months. The matched introductions were warm and the founders were qualified.",
    name: 'Wei L.',
    role: 'Head of Partnerships',
    company: 'Developer Tool SaaS',
  },
];

const FAQS = [
  {
    q: 'Is there a cost to join as a partner?',
    a: 'Basic partner membership is free. Revenue-sharing and co-investment arrangements are disclosed during onboarding. Some premium venture partner tiers may have annual fees, which are offset by deal flow access.',
  },
  {
    q: 'How does revenue sharing work?',
    a: 'Service partners negotiate rates directly with portfolio companies. The platform charges a standard referral fee on matched engagements. Co-investment and carry terms are set at the deal or fund level.',
  },
  {
    q: 'How are conflicts of interest handled?',
    a: 'We require full disclosure of potential conflicts at onboarding and on each deal. Competing service providers are kept compartmentalized. Our system flags overlap before introductions are made.',
  },
  {
    q: 'What is the time commitment?',
    a: 'As much or as little as you choose. Network partners might spend 2 hours per month. Active venture partners might spend 20+ hours per week. You set your own engagement level.',
  },
  {
    q: 'How do I access portfolio companies?',
    a: 'After partner verification, you receive dashboard access showing portfolio companies matched to your expertise and their stated needs. You can indicate interest and we facilitate the introduction.',
  },
  {
    q: 'Can I join as both a service provider and a venture partner?',
    a: 'Yes, with appropriate conflict disclosure. Dual-role partners are common — we structure the arrangements to avoid any direct conflict between advisory and financial interests.',
  },
];

export default function PartnerPartnershipHomePage() {
  useForcedLightTheme();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      <Hero
        badge="Axal VC · For Partners"
        headline={
          <>
            Join the Network<br />
            That <span className="text-[#6D5BFF]">Builds</span><br />
            What Matters.
          </>
        }
        sub="Axal VC's Global Venture Partner Network connects service providers, investors, advisors, and operators with the best early-stage companies in frontier technology."
        ctaPrimary={{ label: 'Apply as Partner', href: '/register?lane=partner' }}
        ctaSecondary={{ label: 'See Partnership Models', href: '#models' }}
        pills={['Legal', 'Technology', 'Finance', 'Domain Expertise', 'Growth', 'Recruiting']}
      />

      <ProofBar items={PROOF_BAR} />

      <FeatureGrid
        eyebrow="Who We Partner With"
        headline="Six partner categories. One network."
        sub="Whether you provide services, source deals, or connect people — there's a model that fits the way you work."
        features={PARTNER_TYPES}
        cols={3}
        bg="bg-white"
      />

      {/* PARTNERSHIP MODELS */}
      <section id="models" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="Partnership Models"
            headline="Three ways to partner. One platform."
            sub="Choose the model that fits your goals, time, and expertise. You can evolve between models as the relationship deepens."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PARTNERSHIP_MODELS.map((model, i) => (
              <div
                key={i}
                className={`rounded-2xl p-8 border flex flex-col ${
                  model.highlight
                    ? 'bg-[#6D5BFF] border-[#6D5BFF] text-white shadow-2xl shadow-[#6D5BFF]/20'
                    : 'bg-white border-gray-200 hover:border-[#6D5BFF]/40 hover:shadow-lg transition-all'
                }`}
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 style={DISPLAY_FONT} className={`text-lg font-bold ${model.highlight ? 'text-white' : 'text-gray-900'}`}>
                    {model.title}
                  </h3>
                  <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold uppercase tracking-wide ${model.highlight ? 'bg-white/20 text-white' : 'bg-[#EEF0FF] text-[#6D5BFF]'}`}>
                    {model.badge}
                  </span>
                </div>
                <p className={`text-sm leading-relaxed mb-6 ${model.highlight ? 'text-white/80' : 'text-gray-600'}`}>
                  {model.desc}
                </p>
                <ul className="space-y-3 mb-8 flex-1">
                  {model.bullets.map((b, j) => (
                    <li key={j} className="flex items-start gap-2.5 text-sm">
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${model.highlight ? 'bg-white/20 text-white' : 'bg-[#EEF0FF] text-[#6D5BFF]'}`}>
                        ✓
                      </span>
                      <span className={model.highlight ? 'text-white/80' : 'text-gray-700'}>{b}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={model.cta.href}
                  className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
                    model.highlight
                      ? 'bg-white text-[#6D5BFF] hover:bg-gray-100'
                      : 'bg-[#6D5BFF] text-white hover:bg-[#5B4BE0]'
                  }`}
                >
                  {model.cta.label} <ArrowRight size={14} />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <OutcomeCards
        eyebrow="What Partners Get"
        headline="Real value, from day one."
        sub="We measure partnership success by what partners earn and the quality of introductions we facilitate — not vanity metrics."
        outcomes={WHAT_PARTNERS_GET}
        cols={3}
        bg="bg-white"
      />

      {/* WHAT WE LOOK FOR */}
      <section className="py-20 px-6 bg-[#EEF0FF]">
        <div className="max-w-5xl mx-auto">
          <SectionHeader
            eyebrow="What We Look For"
            headline="We're selective. That's why the network works."
            sub="Every partner goes through KYB and a conflict check. Here's what we look for before we extend an invitation."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {WHAT_WE_LOOK_FOR.map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-white rounded-xl p-5 border border-[#6D5BFF]/10 shadow-sm">
                <CheckCircle size={16} className="text-[#6D5BFF] shrink-0 mt-0.5" />
                <div>
                  <div style={DISPLAY_FONT} className="text-sm font-semibold text-gray-900 mb-0.5">{item.label}</div>
                  <p className="text-xs text-gray-600 leading-relaxed">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Timeline
        eyebrow="The Process"
        headline="From application to first introduction in under two weeks."
        sub="We've designed partner onboarding to be thorough but fast. Here's exactly what happens."
        steps={PROCESS}
        bg="bg-gray-50"
      />

      <TestimonialBlock
        eyebrow="Partner Stories"
        headline="What our partners say."
        testimonials={TESTIMONIALS}
        bg="bg-white"
      />

      <FAQ items={FAQS} headline="Partnership questions answered." bg="bg-gray-50" />

      <CTABlock
        headline="Ready to partner with Axal VC?"
        sub="Apply in five minutes. We review every submission and respond within five business days."
        ctaPrimary={{ label: 'Apply as Partner', href: '/register?lane=partner' }}
        ctaSecondary={{ label: 'Contact Our Team', href: '/contact' }}
        variant="dark"
        note="KYB verification required. Most partners are onboarded within 10 business days."
      />

      <PublicFooter />
    </div>
  );
}
