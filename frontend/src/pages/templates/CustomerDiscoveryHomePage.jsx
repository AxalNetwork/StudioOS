import React from 'react';
import {
  MessageSquare, Users, Layers, BarChart2, FileSearch,
  CheckCircle, Lightbulb, Calendar, ClipboardList, TrendingUp, Mic,
} from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import useForcedLightTheme from '../../hooks/useForcedLightTheme';
import Hero from '../../templates/components/Hero';
import ProofBar from '../../templates/components/ProofBar';
import OutcomeCards from '../../templates/components/OutcomeCards';
import Timeline from '../../templates/components/Timeline';
import TestimonialBlock from '../../templates/components/TestimonialBlock';
import FAQ from '../../templates/components/FAQ';
import CTABlock from '../../templates/components/CTABlock';
import ValidationBlock from '../../templates/components/ValidationBlock';
import SectionHeader from '../../templates/components/SectionHeader';
import { DISPLAY_FONT } from '../../templates/brandKit';

function Rocket({ size = 20, className }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
    </svg>
  );
}

function Clock({ size = 20, className }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

const PROOF_BAR = [
  { value: '47+', label: 'Interviews Completed' },
  { value: '12', label: 'Pain Patterns Identified' },
  { value: '8.2/10', label: 'Avg Pain Intensity' },
  { value: '3', label: 'Segments Validated' },
];

const WHO_ITS_FOR = [
  {
    icon: Rocket,
    title: 'Pre-Seed Founders',
    desc: "Validating product-market fit before building anything. You need customer signal, not more code.",
  },
  {
    icon: Layers,
    title: 'Early-Stage Operators',
    desc: "Running a team and spending too much time on coordination overhead, not strategic work.",
  },
  {
    icon: TrendingUp,
    title: 'Growth-Stage Teams',
    desc: "Scaling but losing efficiency. Your stack doesn't talk to each other and your ops team is overwhelmed.",
  },
  {
    icon: Users,
    title: 'Investors and Decision-Makers',
    desc: "Looking for better deal tracking, portfolio visibility, and cleaner data for LP reporting.",
  },
];

const PAIN_POINTS = [
  { icon: Layers, label: 'Tool Sprawl', text: "Using 5+ tools that don't talk to each other. Manual sync everywhere." },
  { icon: BarChart2, label: 'No Visibility', text: "No real-time view of what's working. Metrics are scattered across dashboards." },
  { icon: Clock, label: 'Admin Overload', text: 'Hours lost to copy-paste, status updates, and coordination that should be instant.' },
  { icon: FileSearch, label: 'No Validation System', text: "Shipping on instinct. No structured way to log and analyze customer signals." },
  { icon: MessageSquare, label: 'Communication Gaps', text: 'Stakeholders are misaligned. Updates live in Slack threads no one reads.' },
  { icon: ClipboardList, label: 'Documentation Debt', text: "Decisions aren't documented. Re-litigating resolved problems every sprint." },
];

const HOW_IT_WORKS = [
  {
    n: 1,
    label: 'Step 1',
    title: 'Fill out the interest form',
    desc: "Tell us about your role, company stage, and the specific problems you are running into. Takes three minutes.",
  },
  {
    n: 2,
    label: 'Step 2',
    title: 'We schedule a discovery call',
    desc: 'A 20-minute conversation with a member of our product team. We ask about your current workflow, pain points, and what you have tried.',
  },
  {
    n: 3,
    label: 'Step 3',
    title: 'Your feedback shapes what we build',
    desc: 'Validated insights go directly into our product roadmap. You get early access to features you influenced.',
  },
];

const OUTCOMES = [
  {
    icon: Lightbulb,
    title: 'Your Problem Gets Solved',
    desc: "Your specific workflow challenges directly inform the features we prioritize. You're not filling out a form — you're shaping the roadmap.",
  },
  {
    icon: CheckCircle,
    title: 'Early Access',
    desc: 'Discovery participants get first access to beta features before public launch.',
    highlight: true,
  },
  {
    icon: CheckCircle,
    title: 'Lifetime Discount',
    desc: 'All discovery participants receive a permanent discount on their platform subscription.',
  },
];

const EVIDENCE = [
  { icon: Mic, label: 'Interview Coverage', text: '47 discovery interviews across 3 segments: founder, operator, investor.' },
  { icon: BarChart2, label: 'Pain Validation', text: 'Average pain intensity of 8.2/10 across all five identified workflow problems.' },
  { icon: Layers, label: 'Pattern Recognition', text: '12 recurring workflow patterns identified — most appeared across all three segments.' },
  { icon: CheckCircle, label: 'Solution Fit', text: '91% of interviewees said they would switch tools if the solution addressed their top-ranked pain.' },
  { icon: Calendar, label: 'Discovery Velocity', text: 'Interviews conducted over 6 weeks across 4 countries. Remote-first methodology.' },
  { icon: ClipboardList, label: 'Documentation', text: 'All interviews logged, tagged, and scored in our Customer Discovery Log system.' },
];

const TESTIMONIALS = [
  {
    quote: "I wasn't expecting this to be useful, but the call was genuinely insightful. They asked the right questions and followed up within 24 hours with a summary of what they heard.",
    name: 'Alex M.',
    role: 'Founder',
    company: 'Early-stage SaaS',
  },
  {
    quote: "Two features I mentioned in the discovery call shipped three weeks later. That has never happened to me with any other product team.",
    name: 'Priya S.',
    role: 'Head of Operations',
    company: 'Growth-stage fintech',
  },
  {
    quote: "The early access to the cap table and discovery tools alone was worth the 20-minute call. I use them every week now.",
    name: 'Daniel R.',
    role: 'Angel Investor',
    company: 'Independent',
  },
];

const FAQS = [
  {
    q: 'What do I get from participating?',
    a: "Early access to beta features, a lifetime discount on your platform subscription, and credit in our customer discovery documentation. Most importantly — you help us build something that actually solves your problem.",
  },
  {
    q: 'How long does it take?',
    a: "The interest form takes three minutes. The discovery call is 20 minutes. We may follow up for a second round if your use case is particularly relevant to our current build cycle.",
  },
  {
    q: 'Is this a sales call?',
    a: "No. Discovery calls are information-gathering only. We won't pitch you anything. If you ask about pricing, we'll tell you what we know — but that's not the purpose of the call.",
  },
  {
    q: "What if I'm not a founder?",
    a: "That's fine. We want perspectives from operators, investors, advisors, and service providers too. The platform serves the full venture ecosystem — not just founders.",
  },
  {
    q: 'Will my input be kept confidential?',
    a: "Yes. We don't attribute specific quotes without permission. Insights are anonymized and aggregated. We'll never share your information with other participants.",
  },
  {
    q: 'How many people have you already spoken to?',
    a: "We've completed 47 interviews across three segments to date. We're continuing to expand the discovery panel as we enter the next build cycle.",
  },
];

export default function CustomerDiscoveryHomePage() {
  useForcedLightTheme();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      <Hero
        badge="Axal VC · Customer Discovery"
        headline={
          <>
            We're Building<br />
            <span className="text-[#6D5BFF]">What You Need.</span><br />
            Help Us Get It Right.
          </>
        }
        sub="We're conducting customer discovery for Axal VC's next product cycle. If you're a founder, operator, or investor — we want 20 minutes of your time."
        ctaPrimary={{ label: 'Share Your Challenge', href: '/register?lane=founder' }}
        ctaSecondary={{ label: "See What We're Building", href: '/register?lane=founder' }}
      />

      <ProofBar items={PROOF_BAR} />

      {/* WHO THIS IS FOR */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="Who This Is For"
            headline="You're probably one of these people."
            sub="We're looking for operators and decision-makers who are actively feeling the pain — not just curious observers."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {WHO_ITS_FOR.map((w, i) => {
              const Icon = w.icon;
              return (
                <div key={i} className="bg-gray-50 border border-gray-200 rounded-2xl p-6 hover:border-[#6D5BFF]/40 hover:bg-white hover:shadow-lg transition-all">
                  <div className="w-10 h-10 rounded-xl bg-[#EEF0FF] flex items-center justify-center mb-4">
                    <Icon size={18} className="text-[#6D5BFF]" />
                  </div>
                  <h3 style={DISPLAY_FONT} className="text-sm font-semibold text-gray-900 mb-2">{w.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{w.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* PAIN POINTS */}
      <ValidationBlock
        eyebrow="Top Pain Points"
        headline="Five problems we've confirmed are real."
        sub="Across 47 interviews. Not hypothetical. Not assumed. Documented."
        items={PAIN_POINTS}
        bg="bg-[#EEF0FF]"
      />

      {/* CURRENT WORKAROUND */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <SectionHeader
            eyebrow="Current Workaround"
            headline="What you're probably doing right now."
            sub="We hear the same answer across almost every segment."
          />
          <div className="rounded-3xl border-2 border-gray-200 bg-gray-50 p-10 text-center">
            <p className="text-xl md:text-2xl text-gray-700 leading-relaxed mb-6" style={DISPLAY_FONT}>
              "Right now I'm using{' '}
              <span className="text-[#6D5BFF] font-semibold">
                Notion + Airtable + DocuSign + Stripe + some random cap table tool
              </span>{' '}
              — and none of it talks to each other."
            </p>
            <p className="text-gray-500 text-sm">
              — Composite quote from 47 discovery interviews across founder, operator, and investor segments.
            </p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <Timeline
        eyebrow="How It Works"
        headline="Three steps. Starts with a form."
        sub="No commitment, no pitch, no sales follow-up. Just a genuine conversation about your workflow."
        steps={HOW_IT_WORKS}
        bg="bg-gray-50"
      />

      {/* OUTCOMES */}
      <OutcomeCards
        eyebrow="What You Get"
        headline="Discovery participants aren't just sources. They're co-builders."
        outcomes={OUTCOMES}
        cols={3}
        bg="bg-white"
      />

      {/* EVIDENCE */}
      <ValidationBlock
        eyebrow="Discovery Evidence"
        headline="Here's what we've found so far."
        sub="Public discovery signal from 47 interviews. Updated each sprint cycle."
        items={EVIDENCE}
        bg="bg-gray-50"
      />

      <TestimonialBlock
        eyebrow="Participant Feedback"
        headline="What discovery participants say."
        testimonials={TESTIMONIALS}
        bg="bg-white"
      />

      <FAQ
        items={FAQS}
        headline="Questions about the discovery program."
        bg="bg-gray-50"
      />

      <CTABlock
        headline="Be part of what we build."
        sub="Join the discovery panel. Your input directly shapes what ships next. Takes three minutes to start."
        ctaPrimary={{ label: 'Share Your Challenge', href: '/register?lane=founder' }}
        ctaSecondary={{ label: 'Learn About the Platform', href: '/' }}
        variant="dark"
        note="20-minute call. No sales. No commitment. Just a real conversation."
      />

      <PublicFooter />
    </div>
  );
}
